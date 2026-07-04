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
    spof_min_dependents: 3,          // dependents before a node is a SPOF candidate
    spof_min_cascade: 5,             // blast radius that qualifies a critical node as SPOF
    spof_cascade_min_score: 55,      // ...but only when criticality is at least this (source gate)
    spof_severe_dependents: 5,       // escalate SPOF severity to 5 at this fan-in
    spof_severe_cascade: 8,          // or at this blast radius
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
    classification_rank: { 'UNCLASSIFIED': 1, 'CUI': 2, 'SECRET': 3, 'TOP SECRET': 4, 'Other': 2 },
    classification_default_rank: 1,
    /* Statuses that make a provider a usable fallback: a Degraded or Offline alternate
       is not a healthy alternate path for SPOF purposes. */
    alternate_healthy_statuses: ['Active', 'Unknown'],
    /* Relationship types that carry information. Classification-boundary and
       encryption rules only apply to these — a "targets" or "protects" link is an
       effect, not a data path, and flagging it reads as a false positive. */
    info_flow_relationships: ['commands', 'controls', 'communicates_with', 'provides_data_to',
      'receives_data_from', 'uplinks_to', 'downlinks_from', 'relays_through', 'depends_on', 'uses', 'hosts']
  };

  /* Mirrors OSP.model.TARGET_IS_PROVIDER / SOURCE_IS_PROVIDER so the per-link
     dependency direction matches how graph.providersOf/dependentsOf were built. */
  var TARGET_IS_PROVIDER = { depends_on: 1, uses: 1, receives_data_from: 1, relays_through: 1, uplinks_to: 1, downlinks_from: 1 };
  var SOURCE_IS_PROVIDER = { provides_data_to: 1, hosts: 1, supports: 1, supplies: 1, protects: 1, commands: 1, controls: 1 };

  function dependencyProvider(link) {
    if (TARGET_IS_PROVIDER[link.relationship_type]) return { provider: link.target, dependent: link.source };
    if (SOURCE_IS_PROVIDER[link.relationship_type]) return { provider: link.source, dependent: link.target };
    return null;
  }

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

  /* Ported hasAlternatePath BFS, adapted to provider semantics: does the dependent
     keep at least one provider whose upstream provider chain never routes through
     the blocked node? */
  function isHealthy(graph, nodeId) {
    var n = graph.nodesById[nodeId];
    if (!n) return false;
    return RULES.alternate_healthy_statuses.indexOf(graph.statusOf(n)) >= 0;
  }

  function hasAlternateProviderPath(graph, dependentId, blockedNodeId) {
    var providers = distinctSorted(graph.providersOf[dependentId]);
    for (var i = 0; i < providers.length; i++) {
      var p = providers[i];
      if (p === blockedNodeId) continue;
      if (!isHealthy(graph, p)) continue;
      if (!providerChainReaches(graph, p, blockedNodeId)) return true;
    }
    return false;
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

  /* Ported hasAlternatePath BFS in its original form: is there still a route between
     the two endpoints when one link is removed? Treats the graph as undirected. */
  function hasAlternateLinkPath(graph, sourceId, targetId, blockedLinkId) {
    var visited = {};
    visited[sourceId] = 1;
    var queue = [sourceId];
    for (var qi = 0; qi < queue.length; qi++) {
      var edges = graph.adjacency[queue[qi]] || [];
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (e.link.id === blockedLinkId) continue;
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
    var sortedNodes = graph.nodes.slice().sort(function (a, b) { return compareIds(a.id, b.id); });
    var sortedLinks = graph.links.slice().sort(function (a, b) { return compareIds(a.id, b.id); });

    /* Dependency links grouped by provider node (sorted, for evidence and ids). */
    var providerLinks = {};
    sortedNodes.forEach(function (n) { providerLinks[n.id] = []; });
    sortedLinks.forEach(function (l) {
      var dep = dependencyProvider(l);
      if (dep && providerLinks[dep.provider]) providerLinks[dep.provider].push(l);
    });

    sortedNodes.forEach(function (node) {
      var dependents = distinctSorted(graph.dependentsOf[node.id]);
      var depLinkIds = providerLinks[node.id].map(function (l) { return l.id; });
      var cascade = (node.metrics && isFinite(node.metrics.cascade_blast_radius))
        ? node.metrics.cascade_blast_radius : 0;

      /* 1. Single point of failure: heavy fan-in, or a large blast radius on an
         already-critical node — and in BOTH cases at least one dependent must be
         genuinely trapped (no alternate provider path). Fan-in or cascade alone is
         not a SPOF; that reads as noise (source-review lesson). */
      var score = (node.metrics && isFinite(node.metrics.criticality_score))
        ? node.metrics.criticality_score : 0;
      var spofCandidate = dependents.length >= RULES.spof_min_dependents ||
        (cascade >= RULES.spof_min_cascade && score >= RULES.spof_cascade_min_score);
      var trapped = [];
      if (spofCandidate) {
        dependents.forEach(function (depId) {
          if (!hasAlternateProviderPath(graph, depId, node.id)) trapped.push(depId);
        });
      }
      var byFanIn = dependents.length >= RULES.spof_min_dependents && trapped.length > 0;
      var byCascade = cascade >= RULES.spof_min_cascade && score >= RULES.spof_cascade_min_score && trapped.length > 0;
      if (byFanIn || byCascade) {
        var spofSeverity = (dependents.length >= RULES.spof_severe_dependents || cascade >= RULES.spof_severe_cascade) ? 5 : 4;
        var evidenceParts = [];
        if (dependents.length) {
          evidenceParts.push(dependents.length + ' ' + plural(dependents.length, 'system depends', 'systems depend') + ' directly on ' + node.name + ' (' + listNodeNames(graph, dependents, 4) + ')');
        }
        if (trapped.length) {
          evidenceParts.push(trapped.length + ' of them ' + plural(trapped.length, 'has', 'have') + ' no alternate provider path (' + listNodeNames(graph, trapped, 4) + ')');
        }
        evidenceParts.push('its downstream blast radius is ' + cascade + ' ' + plural(cascade, 'node', 'nodes'));
        var hit = trapped.length ? trapped : dependents;
        addFinding(findings, seen, {
          id: 'spof-' + node.id,
          type: 'single_point_of_failure',
          title: node.name + ' is a single point of failure',
          severity: spofSeverity,
          affected_node_ids: distinctSorted([node.id].concat(trapped)),
          affected_link_ids: depLinkIds,
          evidence: evidenceParts.join('; ') + '.',
          implication: 'Loss of ' + node.name + ' would cut a required input to ' + listNodeNames(graph, hit, 4) + (trapped.length ? ', which have no fallback path,' : '') + ' and the effect would propagate to ' + cascade + ' downstream ' + plural(cascade, 'node', 'nodes') + '.',
          mitigation: 'Add an alternate provider or redundant path for the systems that depend on ' + node.name + ', and rehearse degraded-mode operations.',
          source: 'auto'
        });
      }

      /* 2. Shared dependency: multiple systems converge on one provider. */
      if (dependents.length >= RULES.shared_dep_min_dependents) {
        addFinding(findings, seen, {
          id: 'shared-dep-' + node.id,
          type: 'shared_dependency',
          title: node.name + ' is a shared dependency for ' + dependents.length + ' systems',
          severity: (dependents.length >= RULES.shared_dep_severe_dependents) ? 5 : 4,
          affected_node_ids: distinctSorted([node.id].concat(dependents)),
          affected_link_ids: depLinkIds,
          evidence: dependents.length + ' systems converge on ' + node.name + ' as a common provider: ' + listNodeNames(graph, dependents, 4) + '.',
          implication: 'A single outage at ' + node.name + ' would simultaneously disrupt ' + listNodeNames(graph, dependents, 4) + ' across otherwise separate mission threads.',
          mitigation: 'Identify alternate providers for the heaviest consumers and diversify the paths into ' + node.name + '.',
          source: 'auto'
        });
      }

      /* 3a. Degraded/Offline node that other systems still depend on. */
      var nodeStatus = graph.statusOf(node);
      if ((nodeStatus === 'Degraded' || nodeStatus === 'Offline') && dependents.length >= RULES.degraded_min_dependents) {
        addFinding(findings, seen, {
          id: 'degraded-' + node.id,
          type: 'degraded_dependency',
          title: node.name + ' is ' + nodeStatus + ' with ' + dependents.length + ' dependent ' + plural(dependents.length, 'system', 'systems'),
          severity: (nodeStatus === 'Offline') ? 5 : 4,
          affected_node_ids: distinctSorted([node.id].concat(dependents)),
          affected_link_ids: depLinkIds,
          evidence: node.name + ' has effective status ' + nodeStatus + ' in this phase, and ' + dependents.length + ' ' + plural(dependents.length, 'system depends', 'systems depend') + ' on it (' + listNodeNames(graph, dependents, 4) + ').',
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
      var infoFlow = RULES.info_flow_relationships.indexOf(link.relationship_type) >= 0;

      /* 3b. Degraded/Offline link that carries a dependency. */
      var linkStatus = graph.statusOf(link);
      if ((linkStatus === 'Degraded' || linkStatus === 'Offline') && dep) {
        addFinding(findings, seen, {
          id: 'degraded-' + link.id,
          type: 'degraded_dependency',
          title: link.communication_method + ' link from ' + s.name + ' to ' + t.name + ' is ' + linkStatus,
          severity: (linkStatus === 'Offline') ? 5 : 4,
          affected_node_ids: distinctSorted([link.source, link.target]),
          affected_link_ids: [link.id],
          evidence: 'Link status this phase is ' + linkStatus + '; dependency strength ' + link.dependency_strength + ' of 5, failure impact ' + link.failure_impact + ' of 5.',
          implication: nodeName(graph, dep.dependent) + ' is depending on a path that is currently ' + linkStatus + '.',
          mitigation: 'Verify alternate path capacity and update the communications status before briefing.',
          source: 'auto'
        });
      }

      /* 4. Classification boundary: endpoint classifications differ in rank on an
         information-bearing link. Collected per lower-classified node and emitted
         after the loop — one card per boundary node, not one per link. */
      var sRank = classificationRank(s.classification);
      var tRank = classificationRank(t.classification);
      if (infoFlow && sRank !== tRank) {
        var low = (sRank < tRank) ? s : t;
        var high = (sRank < tRank) ? t : s;
        var rec = boundaries[low.id];
        if (!rec) { rec = boundaries[low.id] = { low: low, highIds: [], linkIds: [], spillRisk: false }; }
        rec.highIds.push(high.id);
        rec.linkIds.push(link.id);
        if (sRank > tRank) rec.spillRisk = true;  // data originates on the higher side
      }

      /* 5. Encryption gap: SECRET-or-higher information path with empty or "None"
         encryption. Effects links (targets/protects/...) are exempt — they carry
         no traffic to encrypt. */
      var linkRank = classificationRank(link.classification);
      var pathRank = Math.max(sRank, tRank, linkRank);
      var enc = String(link.encryption || '').trim();
      if (infoFlow && pathRank >= RULES.encryption_min_rank && (enc === '' || enc.toLowerCase() === 'none')) {
        addFinding(findings, seen, {
          id: 'encryption-gap-' + link.id,
          type: 'encryption_gap',
          title: 'Encryption gap between ' + s.name + ' and ' + t.name,
          severity: 4,
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
      if (link.resilience <= RULES.low_resilience_max && link.failure_impact >= RULES.low_resilience_min_impact
        && !hasAlternateLinkPath(graph, link.source, link.target, link.id)) {
        addFinding(findings, seen, {
          id: 'low-resilience-' + link.id,
          type: 'low_resilience_path',
          title: 'Sole path between ' + s.name + ' and ' + t.name + ' is low-resilience',
          severity: Math.max(4, link.failure_impact),
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

    /* 8. Comms concentration: many same-method links through a single node. */
    sortedNodes.forEach(function (node) {
      var edges = graph.adjacency[node.id] || [];
      var byMethod = {};
      var seenLink = {};
      edges.forEach(function (e) {
        if (seenLink[e.link.id]) return;
        seenLink[e.link.id] = 1;
        var method = e.link.communication_method || 'Other';
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
          affected_node_ids: distinctSorted(endpointIds),
          affected_link_ids: group.map(function (l) { return l.id; }),
          evidence: group.length + ' links incident to ' + node.name + ' use ' + method + '; average resilience is ' + avgResilience.toFixed(1) + ' of 5.',
          implication: 'One ' + method + ' disruption at ' + node.name + ' (jamming, weather, provider outage) degrades all of these flows at once.',
          mitigation: 'Diversify transport methods through ' + node.name + ' and test cross-band or alternate-transport failover.',
          source: 'auto'
        });
      });
    });

    findings.sort(function (a, b) {
      if (b.severity !== a.severity) return b.severity - a.severity;
      return compareIds(a.id, b.id);
    });
    return findings;
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
        affected_node_ids: activeNodes,
        affected_link_ids: activeLinks,
        evidence: v.operational_impact || 'Analyst-asserted vulnerability record.',
        implication: v.operational_impact || 'Potential mission degradation if exploited or failed.',
        mitigation: v.mitigation || 'Validate redundancy, procedures, and alternate paths.',
        source: 'analyst'
      });
    });
    var combined = analyst.concat(findings || []);
    combined.sort(function (a, b) {
      if (b.severity !== a.severity) return b.severity - a.severity;
      if (a.source !== b.source) return (a.source === 'analyst') ? -1 : 1;
      return compareIds(a.id, b.id);
    });
    return combined;
  }

  OSP.findings = {
    RULES: RULES,
    detectFindings: detectFindings,
    mergeAnalystVulnerabilities: mergeAnalystVulnerabilities
  };
})();
