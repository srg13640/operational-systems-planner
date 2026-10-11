/* OSP findings — rule-based vulnerability detection ported from the Systems Viz tool,
   adapted to the OSP schema. Phase-aware by construction: detectFindings runs on
   whatever graph it is given (already phase-filtered, statuses resolved through
   graph.statusOf). Pure module: no DOM access. Attaches to window.OSP.findings.
   Prerequisite: OSP.metrics.computeMetrics(graph, model) should run first — the SPOF
   rule reads node.metrics.cascade_blast_radius. It degrades gracefully (cascade
   treated as 0) when metrics are missing.
   Deterministic: same graph in, identical array out (sorted-id iteration, stable
   finding ids, output sorted by severity desc then id). */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  /* Every threshold the rules use lives here — nothing below is a magic number. */
  var RULES = {
    spof_min_dependents: 3,          // dependents before a node is a SPOF candidate by fan-in
    spof_min_cascade: 4,             // sole-source blast radius that makes a node a SPOF on its own
    spof_severe_dependents: 5,       // escalate SPOF severity to 5 at this fan-in
    spof_severe_trapped: 3,          // or when this many dependents lose their only source
    spof_severe_cascade: 6,          // or at this sole-source blast radius
    shared_dep_min_dependents: 3,    // dependents before a node is a shared dependency
    shared_dep_severe_dependents: 5, // escalate shared-dependency severity to 5
    degraded_min_dependents: 1,      // dependents before a Degraded/Offline entity is flagged
    encryption_min_rank: 3,          // classification rank (SECRET) that demands encryption
    low_resilience_max: 2,           // resilience at or below this is "low"
    low_resilience_min_impact: 4,    // ...when failure impact is at least this
    manual_methods: ['Courier', 'Voice'],
    manual_relationship_types: ['depends_on', 'provides_data_to'],
    manual_high_impact: 4,           // failure impact that escalates a manual gate to severity 4
    comms_concentration_min: 4,      // same-method links through one node before flagging
    comms_concentration_severe: 6,   // escalate comms concentration severity to 4
    comms_concentration_skip_methods: ['Other'],  // "4 Other links" is not a transport concentration
    classification_rank: { 'UNCLASSIFIED': 1, 'CUI': 2, 'SECRET': 3, 'TOP SECRET': 4, 'Other': 2 },
    classification_default_rank: 1,
    /* Statuses that make a provider a usable fallback: a Degraded or Offline alternate
       is not a healthy alternate path for SPOF purposes. */
    alternate_healthy_statuses: ['Active', 'Unknown']
  };

  /* Per-link dependency direction, shared with buildGraph so providersOf/dependentsOf
     and the rules agree. Null for org/effect links and symmetric flows. */
  function dependencyProvider(link) { return OSP.model.dependencyProvider(link); }
  function linkClassOf(link) { return OSP.model.linkClassOf(link); }
  /* Information-bearing links: flow and dependency classes. Classification-boundary and
     encryption rules apply only to these — an effect link carries no traffic. */
  function isInfoFlow(link) { var c = linkClassOf(link); return c === 'flow' || c === 'dependency'; }
  function isAdversary(node) { return !!node && node.side === 'Enemy'; }

  function classificationRank(value) {
    return RULES.classification_rank[value] || RULES.classification_default_rank;
  }

  function distinctSorted(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (id) {
      if (!seen[id]) { seen[id] = 1; out.push(id); }
    });
    out.sort();
    return out;
  }

  function compareIds(a, b) { return (a < b) ? -1 : ((a > b) ? 1 : 0); }

  function nodeName(graph, id) {
    var n = graph.nodesById[id];
    return n ? n.name : id;
  }

  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    if (names.length === 2) return names[0] + ' and ' + names[1];
    return names.slice(0, names.length - 1).join(', ') + ', and ' + names[names.length - 1];
  }

  function listNodeNames(graph, ids, max) {
    var names = ids.map(function (id) { return nodeName(graph, id); });
    if (names.length > max) {
      var extra = names.length - max;
      return names.slice(0, max).join(', ') + ' and ' + extra + ' more';
    }
    return joinNames(names);
  }

  function plural(count, singular, pluralWord) {
    return (count === 1) ? singular : pluralWord;
  }

  function normKey(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function addFinding(findings, seen, finding) {
    if (seen[finding.id]) return;
    seen[finding.id] = 1;
    findings.push(finding);
  }

  function isHealthy(graph, nodeId) {
    var n = graph.nodesById[nodeId];
    if (!n) return false;
    return RULES.alternate_healthy_statuses.indexOf(graph.statusOf(n)) >= 0;
  }

  /* Resource keys `dependentId` draws from `providerId` (strength >= the need floor). */
  function needsFrom(graph, dependentId, providerId) {
    var keys = {};
    (graph.providerLinksOf[dependentId] || []).forEach(function (pl) {
      if (pl.provider !== providerId) return;
      if (pl.link.dependency_strength < OSP.metrics.MIN_NEED_STRENGTH) return;
      keys[OSP.model.resourceKeyOf(pl.link)] = 1;
    });
    return Object.keys(keys).sort();
  }

  /* Nodes that fall with `blockedId` (sole-source cascade from the metrics pass). A provider
     inside that set cannot be an alternate for anything. Falls back to a provider-chain walk
     when metrics have not run. */
  function fallsWith(graph, blockedId) {
    var n = graph.nodesById[blockedId];
    var set = {};
    set[blockedId] = 1;
    if (n && n.metrics && Array.isArray(n.metrics.cascade_affected)) {
      n.metrics.cascade_affected.forEach(function (id) { set[id] = 1; });
      return set;
    }
    graph.nodes.forEach(function (x) { if (providerChainReaches(graph, x.id, blockedId)) set[x.id] = 1; });
    return set;
  }

  /* The resources `dependentId` loses outright when `blockedId` goes down: no other healthy
     provider of the SAME resource that survives the loss. "Any provider is a substitute for
     any other" is the assumption this replaces — Intel DB is not an alternate for a SATCOM
     ground station. Returns [{ key, label }]. */
  function starvedResources(graph, dependentId, blockedId, downSet) {
    var keys = needsFrom(graph, dependentId, blockedId);
    var out = [];
    keys.forEach(function (key) {
      var label = '';
      var hasAlternate = (graph.providerLinksOf[dependentId] || []).some(function (pl) {
        if (OSP.model.resourceKeyOf(pl.link) !== key) { return false; }
        if (!label) label = resourceLabel(pl.link);
        if (pl.provider === blockedId || downSet[pl.provider]) return false;
        if (RULES.alternate_healthy_statuses.indexOf(graph.statusOf(pl.link)) < 0) return false;
        return isHealthy(graph, pl.provider);
      });
      if (!hasAlternate) out.push({ key: key, label: label });
    });
    return out;
  }

  function resourceLabel(link) {
    if (link.resource) return link.resource;
    return String(link.relationship_type).replace(/_/g, ' ');
  }

  function providerChainReaches(graph, startId, targetId) {
    var visited = {};
    visited[startId] = 1;
    var queue = [startId];
    for (var qi = 0; qi < queue.length; qi++) {
      var cur = queue[qi];
      if (cur === targetId) return true;
      var ups = distinctSorted(graph.providersOf[cur]);
      for (var i = 0; i < ups.length; i++) {
        if (!visited[ups[i]]) { visited[ups[i]] = 1; queue.push(ups[i]); }
      }
    }
    return false;
  }

  /* Is there still a route between the two endpoints when one link is removed? Undirected,
     but only over links that carry something (flow/dependency) — a command relationship is
     not a comms path. */
  function hasAlternateLinkPath(graph, sourceId, targetId, blockedLinkId) {
    var visited = {};
    visited[sourceId] = 1;
    var queue = [sourceId];
    for (var qi = 0; qi < queue.length; qi++) {
      var edges = graph.adjacency[queue[qi]] || [];
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (e.link.id === blockedLinkId) continue;
        if (!isInfoFlow(e.link)) continue;
        if (!visited[e.otherId]) {
          visited[e.otherId] = 1;
          if (e.otherId === targetId) return true;
          queue.push(e.otherId);
        }
      }
    }
    return false;
  }

  function detectFindings(graph, scenario) {
    var findings = [];
    var seen = {};
    /* Adversary nodes are described, not diagnosed: the risk board is about our architecture.
       Links touching them (targets, enemy-internal C2) never produce cards either. */
    var sortedNodes = graph.nodes.filter(function (n) { return !isAdversary(n); })
      .sort(function (a, b) { return compareIds(a.id, b.id); });
    var sortedLinks = graph.links.filter(function (l) {
      if (linkClassOf(l) === 'effect') return false;
      return !isAdversary(graph.nodesById[l.source]) && !isAdversary(graph.nodesById[l.target]);
    }).sort(function (a, b) { return compareIds(a.id, b.id); });

    /* Dependency links grouped by provider node (sorted, for evidence and ids). */
    var providerLinks = {};
    sortedNodes.forEach(function (n) { providerLinks[n.id] = []; });
    sortedLinks.forEach(function (l) {
      var dep = dependencyProvider(l);
      if (dep && providerLinks[dep.provider]) providerLinks[dep.provider].push(l);
    });

    sortedNodes.forEach(function (node) {
      var dependents = distinctSorted(graph.dependentsOf[node.id]).filter(function (id) { return !isAdversary(graph.nodesById[id]); });
      var depLinkIds = providerLinks[node.id].map(function (l) { return l.id; });
      var cascade = (node.metrics && isFinite(node.metrics.cascade_blast_radius))
        ? node.metrics.cascade_blast_radius : 0;

      /* 1. Single point of failure. A node qualifies by fan-in (>= 3 direct dependents) or by
         sole-source blast radius alone — no criticality-score gate, because whether something
         is a SPOF is a fact about the topology, not about the weight sliders. In both cases at
         least one dependent must be genuinely trapped: it loses a resource for which no other
         healthy provider survives the loss. */
      var spofCandidate = dependents.length >= RULES.spof_min_dependents || cascade >= RULES.spof_min_cascade;
      var trapped = [];       // [{ id, resources: [label] }]
      if (spofCandidate) {
        var downSet = fallsWith(graph, node.id);
        dependents.forEach(function (depId) {
          var starved = starvedResources(graph, depId, node.id, downSet);
          if (starved.length) trapped.push({ id: depId, resources: starved.map(function (r) { return r.label; }) });
        });
      }
      var trappedIds = trapped.map(function (x) { return x.id; });
      var byFanIn = dependents.length >= RULES.spof_min_dependents && trapped.length > 0;
      var byCascade = cascade >= RULES.spof_min_cascade && trapped.length > 0;
      var isSpof = byFanIn || byCascade;
      if (isSpof) {
        var spofSeverity = (dependents.length >= RULES.spof_severe_dependents || trapped.length >= RULES.spof_severe_trapped || cascade >= RULES.spof_severe_cascade) ? 5 : 4;
        var evidenceParts = [];
        evidenceParts.push(dependents.length + ' ' + plural(dependents.length, 'node draws', 'nodes draw') + ' directly on ' + node.name + ' (' + listNodeNames(graph, dependents, 4) + ')');
        evidenceParts.push(trapped.length + ' of them ' + plural(trapped.length, 'has', 'have') + ' no other source for what it provides: ' + trapped.slice(0, 4).map(function (x) {
          return nodeName(graph, x.id) + ' (' + x.resources.join(', ') + ')';
        }).join('; ') + (trapped.length > 4 ? ' and ' + (trapped.length - 4) + ' more' : ''));
        evidenceParts.push('sole-source blast radius ' + cascade + ' ' + plural(cascade, 'node', 'nodes'));
        addFinding(findings, seen, {
          id: 'spof-' + node.id,
          type: 'single_point_of_failure',
          title: node.name + ' is a single point of failure',
          severity: spofSeverity,
          impact: trapped.length * 2 + cascade + dependents.length,
          affected_node_ids: distinctSorted([node.id].concat(trappedIds)),
          affected_link_ids: depLinkIds,
          evidence: evidenceParts.join('; ') + '.',
          implication: 'Loss of ' + node.name + ' would cut ' + listNodeNames(graph, trappedIds, 4) + ' off from ' + (trapped.length === 1 ? 'an input with no fallback' : 'inputs with no fallback') + (cascade > trapped.length ? ', and ' + (cascade - trapped.length) + ' more ' + plural(cascade - trapped.length, 'node', 'nodes') + ' would fall with them' : '') + '.',
          mitigation: 'Give ' + listNodeNames(graph, trappedIds, 2) + ' a second source for ' + distinctSorted(trapped.reduce(function (a, x) { return a.concat(x.resources); }, [])).slice(0, 3).join(', ') + ', and rehearse degraded-mode operations at ' + node.name + '.',
          source: 'auto'
        });
      }

      /* 2. Shared dependency: multiple systems converge on one provider. When the node is
         already a SPOF this is the same fact stated weaker, so it folds into that card. */
      if (dependents.length >= RULES.shared_dep_min_dependents && !isSpof) {
        addFinding(findings, seen, {
          id: 'shared-dep-' + node.id,
          type: 'shared_dependency',
          title: node.name + ' is a shared dependency for ' + dependents.length + ' nodes',
          severity: (dependents.length >= RULES.shared_dep_severe_dependents) ? 4 : 3,
          impact: dependents.length,
          affected_node_ids: distinctSorted([node.id].concat(dependents)),
          affected_link_ids: depLinkIds,
          evidence: dependents.length + ' nodes converge on ' + node.name + ' as a common provider: ' + listNodeNames(graph, dependents, 4) + '. Each has an alternate source today, so this is concentration, not a single point of failure.',
          implication: 'A single outage at ' + node.name + ' would stress ' + listNodeNames(graph, dependents, 4) + ' at once, and the alternates they fall back on were not sized for all of them.',
          mitigation: 'Confirm the alternates for the heaviest consumers have the capacity to carry them simultaneously, and diversify the paths into ' + node.name + '.',
          source: 'auto'
        });
      }

      /* 3a. Degraded/Offline node that other systems still depend on. */
      var nodeStatus = graph.statusOf(node);
      if ((nodeStatus === 'Degraded' || nodeStatus === 'Offline') && dependents.length >= RULES.degraded_min_dependents) {
        addFinding(findings, seen, {
          id: 'degraded-' + node.id,
          type: 'degraded_dependency',
          title: node.name + ' is ' + nodeStatus.toLowerCase() + ' with ' + dependents.length + ' dependent ' + plural(dependents.length, 'node', 'nodes'),
          severity: (nodeStatus === 'Offline') ? 5 : 4,
          impact: dependents.length,
          affected_node_ids: distinctSorted([node.id].concat(dependents)),
          affected_link_ids: depLinkIds,
          evidence: node.name + ' is ' + nodeStatus.toLowerCase() + ' this phase; ' + dependents.length + ' ' + plural(dependents.length, 'node still draws', 'nodes still draw') + ' on it (' + listNodeNames(graph, dependents, 4) + ').',
          implication: (nodeStatus === 'Offline')
            ? listNodeNames(graph, dependents, 4) + ' ' + plural(dependents.length, 'has', 'have') + ' lost this input entirely.'
            : listNodeNames(graph, dependents, 4) + ' ' + plural(dependents.length, 'is', 'are') + ' drawing on a degraded input; apparent redundancy overstates real capacity.',
          mitigation: 'Confirm current status, shift dependents to alternate providers where available, and update the recovery plan.',
          source: 'auto'
        });
      }
    });

    var boundaries = {};   // lower-classified node id -> aggregated boundary record

    sortedLinks.forEach(function (link) {
      var s = graph.nodesById[link.source];
      var t = graph.nodesById[link.target];
      if (!s || !t) return;
      var dep = dependencyProvider(link);
      var infoFlow = isInfoFlow(link);

      /* 3b. Degraded/Offline link that carries a dependency. */
      var linkStatus = graph.statusOf(link);
      if ((linkStatus === 'Degraded' || linkStatus === 'Offline') && dep) {
        addFinding(findings, seen, {
          id: 'degraded-' + link.id,
          type: 'degraded_dependency',
          title: link.communication_method + ' link from ' + s.name + ' to ' + t.name + ' is ' + linkStatus,
          severity: (linkStatus === 'Offline') ? 5 : 4,
          impact: link.failure_impact,
          affected_node_ids: distinctSorted([link.source, link.target]),
          affected_link_ids: [link.id],
          evidence: 'Link status this phase is ' + linkStatus + '; dependency strength ' + link.dependency_strength + ' of 5, failure impact ' + link.failure_impact + ' of 5.',
          implication: nodeName(graph, dep.dependent) + ' is depending on a path that is currently ' + linkStatus.toLowerCase() + '.',
          mitigation: 'Verify alternate path capacity and update the communications status before briefing.',
          source: 'auto'
        });
      }

      /* 4. Classification boundary: two SYSTEMS at different classification levels exchange
         data. A performer's marking is not an enclave, so performer endpoints are skipped.
         Spill direction follows the data (provider -> dependent), not the arrow the author
         happened to draw. Collected per lower-classified system, one card each. */
      var sRank = classificationRank(s.classification);
      var tRank = classificationRank(t.classification);
      var bothSystems = OSP.model.archClassOf(s) === 'system' && OSP.model.archClassOf(t) === 'system';
      if (infoFlow && bothSystems && sRank !== tRank) {
        var low = (sRank < tRank) ? s : t;
        var high = (sRank < tRank) ? t : s;
        var rec = boundaries[low.id];
        if (!rec) { rec = boundaries[low.id] = { low: low, highIds: [], linkIds: [], spillRisk: false }; }
        rec.highIds.push(high.id);
        rec.linkIds.push(link.id);
        var dataFrom = dep ? dep.provider : link.source;
        if (dataFrom === high.id || link.direction === 'bidirectional') rec.spillRisk = true;
      }

      /* 5. Encryption gap: SECRET-or-higher information path with empty or "None"
         encryption. Only information moves over crypto — a materiel or personnel flow
         (Class V by convoy) is exempt, as are effect links. */
      var linkRank = classificationRank(link.classification);
      var pathRank = Math.max(sRank, tRank, linkRank);
      var enc = String(link.encryption || '').trim();
      var carriesInfo = infoFlow && (link.resource_kind || 'information') === 'information';
      if (carriesInfo && pathRank >= RULES.encryption_min_rank && (enc === '' || enc.toLowerCase() === 'none')) {
        addFinding(findings, seen, {
          id: 'encryption-gap-' + link.id,
          type: 'encryption_gap',
          title: 'Encryption gap between ' + s.name + ' and ' + t.name,
          severity: 4,
          impact: link.failure_impact,
          affected_node_ids: distinctSorted([link.source, link.target]),
          affected_link_ids: [link.id],
          evidence: 'The link is marked ' + link.classification + ' and connects ' + s.name + ' (' + s.classification + ') to ' + t.name + ' (' + t.classification + '); recorded encryption is ' + (enc === '' ? 'blank' : '"' + enc + '"') + '.',
          implication: 'Classified traffic may be moving without confirmed cryptographic protection, exposing it to intercept.',
          mitigation: 'Confirm approved encryption for this path and record the authoritative status on the link.',
          source: 'auto'
        });
      }

      /* 6. Low-resilience path carrying high failure impact with no alternate route.
         When an alternate path exists this is a watch item, not a finding — flagging
         every fragile-but-backed-up link buries the real ones (source-review lesson). */
      if (infoFlow && link.resilience <= RULES.low_resilience_max && link.failure_impact >= RULES.low_resilience_min_impact
        && !hasAlternateLinkPath(graph, link.source, link.target, link.id)) {
        addFinding(findings, seen, {
          id: 'low-resilience-' + link.id,
          type: 'low_resilience_path',
          title: 'Sole path between ' + s.name + ' and ' + t.name + ' is low-resilience',
          severity: Math.max(4, link.failure_impact),
          impact: link.failure_impact,
          affected_node_ids: distinctSorted([link.source, link.target]),
          affected_link_ids: [link.id],
          evidence: 'Resilience ' + link.resilience + ' of 5 against failure impact ' + link.failure_impact + ' of 5; no alternate path connects these nodes.',
          implication: 'A single link loss severs the only path between ' + s.name + ' and ' + t.name + '.',
          mitigation: 'Add a parallel communications path or harden the link before it is stressed.',
          source: 'auto'
        });
      }

      /* 7. Manual process gate: Courier/Voice carrying a data dependency. */
      if (RULES.manual_methods.indexOf(link.communication_method) >= 0
        && RULES.manual_relationship_types.indexOf(link.relationship_type) >= 0) {
        addFinding(findings, seen, {
          id: 'manual-gate-' + link.id,
          type: 'manual_process_gate',
          title: link.communication_method + ' handoff gates ' + s.name + ' to ' + t.name,
          severity: (link.failure_impact >= RULES.manual_high_impact) ? 4 : 3,
          impact: link.failure_impact,
          affected_node_ids: distinctSorted([link.source, link.target]),
          affected_link_ids: [link.id],
          evidence: 'A ' + link.relationship_type + ' relationship runs over ' + link.communication_method + ' with failure impact ' + link.failure_impact + ' of 5.',
          implication: (dep ? nodeName(graph, dep.dependent) : s.name) + ' waits on a human relay for this input; tempo drops and transcription errors become possible.',
          mitigation: 'Digitize the handoff where appropriate, or add verification steps and priority procedures.',
          source: 'auto'
        });
      }
    });

    /* 4 (emit). One classification-boundary card per boundary node. */
    Object.keys(boundaries).sort().forEach(function (lowId) {
      var rec = boundaries[lowId];
      var highs = distinctSorted(rec.highIds);
      addFinding(findings, seen, {
        id: 'class-boundary-' + lowId,
        type: 'classification_boundary',
        title: rec.low.name + ' (' + rec.low.classification + ') sits on a classification boundary',
        severity: rec.spillRisk ? 4 : 3,
        impact: highs.length,
        affected_node_ids: distinctSorted([lowId].concat(highs)),
        affected_link_ids: distinctSorted(rec.linkIds),
        evidence: rec.low.name + ' is ' + rec.low.classification + ' and exchanges data with ' +
          highs.length + ' higher-classified ' + plural(highs.length, 'system', 'systems') + ': ' +
          listNodeNames(graph, highs, 4) + '.',
        implication: 'Every exchange across this boundary needs a guard, release authority, or manual review, which adds delay and failure modes' +
          (rec.spillRisk ? ' — and higher-classified data flows toward the lower enclave.' : '.'),
        mitigation: 'Confirm the cross-domain workflow and release authority for ' + rec.low.name + ', and rehearse the manual fallback.',
        source: 'auto'
      });
    });

    /* 8. Comms concentration: many same-method links through a single node. Only links that
       carry traffic count, and a method of "Other" says nothing about shared transport. */
    sortedNodes.forEach(function (node) {
      var edges = graph.adjacency[node.id] || [];
      var byMethod = {};
      var seenLink = {};
      edges.forEach(function (e) {
        if (seenLink[e.link.id]) return;
        seenLink[e.link.id] = 1;
        if (!isInfoFlow(e.link)) return;
        if (isAdversary(graph.nodesById[e.otherId])) return;
        var method = e.link.communication_method || 'Other';
        if (RULES.comms_concentration_skip_methods.indexOf(method) >= 0) return;
        if (!byMethod[method]) byMethod[method] = [];
        byMethod[method].push(e.link);
      });
      Object.keys(byMethod).sort().forEach(function (method) {
        var group = byMethod[method];
        if (group.length < RULES.comms_concentration_min) return;
        group.sort(function (a, b) { return compareIds(a.id, b.id); });
        var resSum = 0;
        var endpointIds = [node.id];
        group.forEach(function (l) {
          resSum += l.resilience;
          endpointIds.push(l.source);
          endpointIds.push(l.target);
        });
        var avgResilience = resSum / group.length;
        addFinding(findings, seen, {
          id: 'comms-conc-' + node.id + '-' + normKey(method),
          type: 'comms_concentration',
          title: group.length + ' ' + method + ' links concentrate through ' + node.name,
          severity: (group.length >= RULES.comms_concentration_severe) ? 4 : 3,
          impact: group.length,
          affected_node_ids: distinctSorted(endpointIds),
          affected_link_ids: group.map(function (l) { return l.id; }),
          evidence: group.length + ' links incident to ' + node.name + ' use ' + method + '; average resilience is ' + avgResilience.toFixed(1) + ' of 5.',
          implication: 'One ' + method + ' disruption at ' + node.name + ' (jamming, weather, provider outage) degrades all of these flows at once.',
          mitigation: 'Diversify transport methods through ' + node.name + ' and test cross-band or alternate-transport failover.',
          source: 'auto'
        });
      });
    });

    findings.sort(compareFindings);
    return findings;
  }

  /* Severity first, then the size of what is at stake, then id — so the headline at equal
     severity is the card with the most trapped nodes, not the one that sorts first. */
  function compareFindings(a, b) {
    if (b.severity !== a.severity) return b.severity - a.severity;
    var ai = a.impact || 0, bi = b.impact || 0;
    if (bi !== ai) return bi - ai;
    if (a.source !== b.source) return (a.source === 'analyst') ? -1 : 1;
    return compareIds(a.id, b.id);
  }

  /* Merge analyst-asserted scenario.vulnerabilities with auto findings. Analyst
     records keep their own ids ('analyst-' prefix) and sort before auto findings at
     equal severity. Vulns whose every affected node/link is absent from the current
     (phase-filtered) graph are skipped; ones with at least one active ref are kept
     with the refs filtered to the active set. */
  function mergeAnalystVulnerabilities(findings, scenario, graph) {
    var linkIds = {};
    graph.links.forEach(function (l) { linkIds[l.id] = 1; });
    var analyst = [];
    ((scenario && scenario.vulnerabilities) || []).forEach(function (v) {
      var nodeRefs = v.affected_node_ids || [];
      var linkRefs = v.affected_link_ids || [];
      var activeNodes = nodeRefs.filter(function (id) { return !!graph.nodesById[id]; });
      var activeLinks = linkRefs.filter(function (id) { return !!linkIds[id]; });
      if ((nodeRefs.length + linkRefs.length) > 0 && (activeNodes.length + activeLinks.length) === 0) return;
      analyst.push({
        id: 'analyst-' + v.id,
        type: v.vulnerability_type || 'other',
        title: v.title || v.id,
        severity: v.severity || 3,
        likelihood: v.likelihood || null,
        detectability: v.detectability || null,
        impact: (v.severity || 3) * (v.likelihood || 3),
        affected_node_ids: activeNodes,
        affected_link_ids: activeLinks,
        evidence: v.notes || 'Analyst-asserted record (' + (v.vulnerability_type || 'other').replace(/_/g, ' ') + ')' + (v.likelihood ? '; likelihood ' + v.likelihood + ' of 5' : '') + (v.detectability ? ', detectability ' + v.detectability + ' of 5' : '') + '.',
        implication: v.operational_impact || 'Potential mission degradation if exploited or failed.',
        mitigation: v.mitigation || 'Validate redundancy, procedures, and alternate paths.',
        source: 'analyst'
      });
    });
    var combined = analyst.concat(findings || []);
    combined.sort(compareFindings);
    return combined;
  }

  /* Where each finding first appears across the timeline, and what has resolved or escalated
     since the start. `now` is the merged finding list at hour t; detectAt(h) returns the list
     at an earlier boundary hour (H+0 and each phase start up to t), so a SPOF that only exists
     in Phase II reads "emerged H+36 (Close Operations)" whatever the scrubber says. Returns
     { firstSeen: {id: hour}, resolved: [finding], escalated: [{finding, from}] }. */
  function timelineDiff(scenario, t, now, detectAt) {
    var hours = [0];
    (scenario.timeline.phases || []).forEach(function (p) { if (p.from_hours > 0 && p.from_hours <= t) hours.push(p.from_hours + 0.001); });
    hours.sort(function (a, b) { return a - b; });
    var firstSeen = {}, severityAt0 = {}, baseline = {};
    hours.forEach(function (h, i) {
      detectAt(h).forEach(function (f) {
        if (firstSeen[f.id] === undefined) firstSeen[f.id] = (i === 0) ? 0 : Math.floor(h);
        if (i === 0) { severityAt0[f.id] = f.severity; baseline[f.id] = f; }
      });
    });
    var nowIds = {};
    now.forEach(function (f) { nowIds[f.id] = f; if (firstSeen[f.id] === undefined) firstSeen[f.id] = Math.floor(t); });
    var resolved = Object.keys(baseline).filter(function (id) { return !nowIds[id]; }).map(function (id) { return baseline[id]; });
    var escalated = now.filter(function (f) { return severityAt0[f.id] !== undefined && f.severity > severityAt0[f.id]; })
      .map(function (f) { return { finding: f, from: severityAt0[f.id] }; });
    return { firstSeen: firstSeen, resolved: resolved, escalated: escalated };
  }

  OSP.findings = {
    RULES: RULES,
    detectFindings: detectFindings,
    mergeAnalystVulnerabilities: mergeAnalystVulnerabilities,
    compareFindings: compareFindings,
    timelineDiff: timelineDiff,
    starvedResources: starvedResources
  };
})();
