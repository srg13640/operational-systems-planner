/* OSP model — schema constants, scenario normalization/validation, graph building, phase logic.
   Pure module: no DOM access. Attaches to window.OSP.model. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var SCHEMA_VERSION = '1.0';

  var NODE_TYPES = ['unit', 'headquarters', 'command_post', 'directorate', 'office', 'system',
    'platform', 'sensor', 'shooter', 'network', 'application', 'database', 'data_feed',
    'satellite', 'ground_station', 'relay', 'person_role', 'process', 'location', 'facility',
    'logistics_node', 'other'];

  var RELATIONSHIP_TYPES = ['commands', 'controls', 'supports', 'depends_on', 'communicates_with',
    'provides_data_to', 'receives_data_from', 'uplinks_to', 'downlinks_from', 'relays_through',
    'hosts', 'uses', 'protects', 'targets', 'supplies', 'other'];

  var COMM_METHODS = ['UHF/VHF/HF Radio', 'SATCOM', 'Fiber', 'Microwave', 'LTE/5G',
    'Tactical Data Link', 'LAN', 'WAN', 'Mesh', 'Courier', 'Voice', 'API',
    'Database Replication', 'Other'];

  var CLASSIFICATIONS = ['UNCLASSIFIED', 'CUI', 'SECRET', 'TOP SECRET', 'Other'];
  var SIDES = ['Friendly', 'Enemy', 'Neutral', 'Unknown'];
  var STATUSES = ['Active', 'Degraded', 'Offline', 'Planned', 'Unknown'];
  var DOMAINS = ['space', 'air', 'ems', 'cyber', 'c2', 'strike', 'sustain', 'land', 'maritime', 'data', 'other'];
  var CONTACT_FORMS = ['direct', 'indirect', 'air', 'maritime', 'electronic', 'cyber', 'information', 'sensing'];

  var DEFAULT_CRITICALITY_MODEL = {
    weights: { mission: 20, echelon: 15, degree: 20, betweenness: 20, failure: 15, shared: 10 },
    caps: { degree: 12, dependency: 8, cascade: 20, shared: 6 },
    thresholds: { mission_critical: 75, high: 50, moderate: 25 },
    betweenness_node_limit: 250
  };

  /* For these relationship types the TARGET is the provider (the thing depended on);
     for the rest the SOURCE is the provider. Ported from the source tool. */
  var TARGET_IS_PROVIDER = { depends_on: 1, uses: 1, receives_data_from: 1, relays_through: 1, uplinks_to: 1, downlinks_from: 1 };
  var SOURCE_IS_PROVIDER = { provides_data_to: 1, hosts: 1, supports: 1, supplies: 1, protects: 1, commands: 1, controls: 1 };

  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function clampNum(v, lo, hi, dflt) {
    var n = parseFloat(v);
    if (!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function str(v, dflt) { return (v === undefined || v === null) ? (dflt || '') : String(v); }
  function parseList(v) {
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (v === undefined || v === null || v === '') return [];
    return String(v).split(/[;,]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  function pickEnum(v, list, dflt, issues, where, field) {
    var s = str(v, '').trim();
    if (!s) return dflt;
    var hit = list.find(function (e) { return e.toLowerCase() === s.toLowerCase(); });
    if (hit) return hit;
    if (issues) issues.push({ level: 'warning', where: where, message: 'Unknown ' + field + ' "' + s + '" (kept as-is)' });
    return s;
  }

  function normalizePhaseIds(v, phaseIds, issues, where) {
    if (v === undefined || v === null || v === '' || v === 'all' || v === 'All') return 'all';
    var list = parseList(v);
    if (!list.length) return 'all';
    var out = [];
    list.forEach(function (p) {
      if (phaseIds.indexOf(p) >= 0) out.push(p);
      else issues.push({ level: 'warning', where: where, message: 'Unknown phase id "' + p + '" in phase_ids (dropped)' });
    });
    return out.length ? out : 'all';
  }

  function normalizeStatusByPhase(v, phaseIds, issues, where) {
    if (!v || typeof v !== 'object') return {};
    var out = {};
    Object.keys(v).forEach(function (pid) {
      if (phaseIds.indexOf(pid) < 0) {
        issues.push({ level: 'warning', where: where, message: 'status_by_phase references unknown phase "' + pid + '"' });
        return;
      }
      out[pid] = pickEnum(v[pid], STATUSES, 'Active', issues, where, 'status');
    });
    return out;
  }

  function normalizeGeo(g) {
    g = g || {};
    var lat = clampNum(g.lat, -90, 90, NaN);
    var lon = clampNum(g.lon, -180, 180, NaN);
    return {
      location_name: str(g.location_name),
      lat: isFinite(lat) ? lat : null,
      lon: isFinite(lon) ? lon : null,
      non_geographic: !!g.non_geographic
    };
  }

  /* Normalize a raw parsed object into a valid scenario. Never throws on bad rows:
     collects {level, where, message} issues and keeps going (drops only what cannot resolve). */
  function normalizeScenario(raw) {
    var issues = [];
    raw = raw || {};
    var meta = raw.meta || {};
    var cls = meta.classification || {};
    if (typeof cls === 'string') cls = { marking: cls };

    var scenario = {
      kind: 'osp-scenario',
      schema_version: str(raw.schema_version, SCHEMA_VERSION),
      meta: {
        id: str(meta.id, 'osp-' + Math.abs(hashString(JSON.stringify(meta))).toString(36)),
        name: str(meta.name, 'Untitled Scenario'),
        description: str(meta.description),
        scenario_name: str(meta.scenario_name, str(meta.name, '')),
        turn: str(meta.turn),
        side: pickEnum(meta.side, SIDES, 'Friendly', null),
        created_by: str(meta.created_by),
        created_at: str(meta.created_at),
        modified_at: str(meta.modified_at),
        assumptions: parseList(meta.assumptions),
        tags: parseList(meta.tags),
        classification: {
          marking: pickEnum(cls.marking, CLASSIFICATIONS, 'UNCLASSIFIED', issues, 'meta', 'classification'),
          banner_caveat: str(cls.banner_caveat),
          prototype: cls.prototype !== false
        }
      },
      timeline: { duration_hours: 96, phases: [] },
      nodes: [], links: [], vulnerabilities: [], activities: [],
      overlays: { annotations: [], zones: [] },
      criticality_model: null,
      notes: [],
      layout: { graph_positions: {}, view: 'map', t: 0, map_viewport: { x: 0, y: 0, k: 1 } }
    };

    if (raw.schema_version && parseFloat(raw.schema_version) > parseFloat(SCHEMA_VERSION)) {
      issues.push({ level: 'warning', where: 'file', message: 'File schema_version ' + raw.schema_version + ' is newer than this app (' + SCHEMA_VERSION + '); loading best-effort' });
    }

    // Timeline
    var tl = raw.timeline || {};
    scenario.timeline.duration_hours = clampNum(tl.duration_hours, 1, 100000, 96);
    var phasesRaw = Array.isArray(tl.phases) ? tl.phases : [];
    var seenPhase = {};
    phasesRaw.forEach(function (p, i) {
      var id = str(p && p.id, 'phase-' + (i + 1));
      if (seenPhase[id]) { issues.push({ level: 'error', where: 'timeline', message: 'Duplicate phase id "' + id + '" (dropped)' }); return; }
      seenPhase[id] = 1;
      var from = clampNum(p.from_hours, 0, scenario.timeline.duration_hours, 0);
      var to = clampNum(p.to_hours, 0, scenario.timeline.duration_hours, scenario.timeline.duration_hours);
      if (to <= from) { issues.push({ level: 'warning', where: 'timeline/' + id, message: 'Phase "' + id + '" has to_hours <= from_hours' }); }
      scenario.timeline.phases.push({
        id: id, label: str(p.label, id), from_hours: from, to_hours: to,
        main_effort: str(p.main_effort), notes: str(p.notes)
      });
    });
    scenario.timeline.phases.sort(function (a, b) { return a.from_hours - b.from_hours; });
    for (var pi = 1; pi < scenario.timeline.phases.length; pi++) {
      if (scenario.timeline.phases[pi].from_hours < scenario.timeline.phases[pi - 1].to_hours) {
        issues.push({ level: 'warning', where: 'timeline', message: 'Phases "' + scenario.timeline.phases[pi - 1].id + '" and "' + scenario.timeline.phases[pi].id + '" overlap' });
      }
    }
    var phaseIds = scenario.timeline.phases.map(function (p) { return p.id; });

    // Nodes
    var nodesRaw = Array.isArray(raw.nodes) ? raw.nodes : [];
    var nodeIds = {};
    nodesRaw.forEach(function (n, i) {
      var where = 'node[' + i + ']';
      var id = str(n && n.id).trim();
      if (!id) { issues.push({ level: 'error', where: where, message: 'Node missing id (dropped)' }); return; }
      if (nodeIds[id]) { issues.push({ level: 'error', where: where, message: 'Duplicate node id "' + id + '" (dropped)' }); return; }
      nodeIds[id] = 1;
      where = 'node ' + id;
      scenario.nodes.push({
        id: id,
        name: str(n.name, id),
        node_type: pickEnum(n.node_type, NODE_TYPES, 'other', issues, where, 'node_type'),
        side: pickEnum(n.side, SIDES, 'Friendly', issues, where, 'side'),
        service: str(n.service),
        echelon: str(n.echelon),
        unit: str(n.unit),
        parent_id: str(n.parent_id).trim(),
        warfighting_function: str(n.warfighting_function),
        domain: pickEnum(n.domain, DOMAINS, 'other', issues, where, 'domain'),
        mission: str(n.mission),
        mission_importance: clampInt(n.mission_importance, 1, 5, 3),
        echelon_importance: clampInt(n.echelon_importance, 1, 5, 3),
        phase_ids: normalizePhaseIds(n.phase_ids, phaseIds, issues, where),
        status: pickEnum(n.status, STATUSES, 'Active', issues, where, 'status'),
        status_by_phase: normalizeStatusByPhase(n.status_by_phase, phaseIds, issues, where),
        geo: normalizeGeo(n.geo),
        symbol: normalizeSymbol(n.symbol),
        classification: pickEnum(n.classification, CLASSIFICATIONS, 'UNCLASSIFIED', issues, where, 'classification'),
        owner: str(n.owner),
        vulnerability_notes: str(n.vulnerability_notes),
        tags: parseList(n.tags),
        notes: str(n.notes)
      });
    });

    // Parent refs + cycles
    scenario.nodes.forEach(function (n) {
      if (n.parent_id && !nodeIds[n.parent_id]) {
        issues.push({ level: 'warning', where: 'node ' + n.id, message: 'parent_id "' + n.parent_id + '" does not exist (hierarchy link ignored)' });
        n.parent_id = '';
      }
    });
    detectHierarchyCycles(scenario.nodes, issues);

    // Links
    var linksRaw = Array.isArray(raw.links) ? raw.links : [];
    var linkIds = {};
    linksRaw.forEach(function (l, i) {
      var where = 'link[' + i + ']';
      var id = str(l && l.id).trim() || ('link-' + i);
      if (linkIds[id]) { issues.push({ level: 'error', where: where, message: 'Duplicate link id "' + id + '" (dropped)' }); return; }
      var source = str(l.source).trim(), target = str(l.target).trim();
      if (!nodeIds[source] || !nodeIds[target]) {
        issues.push({ level: 'error', where: 'link ' + id, message: 'Link endpoint missing (' + source + ' -> ' + target + ') (dropped)' });
        return;
      }
      linkIds[id] = 1;
      where = 'link ' + id;
      scenario.links.push({
        id: id, source: source, target: target,
        relationship_type: pickEnum(l.relationship_type, RELATIONSHIP_TYPES, 'other', issues, where, 'relationship_type'),
        direction: (str(l.direction) === 'bidirectional') ? 'bidirectional' : 'directed',
        communication_method: pickEnum(l.communication_method, COMM_METHODS, 'Other', issues, where, 'communication_method'),
        bandwidth: str(l.bandwidth), latency: str(l.latency),
        resilience: clampInt(l.resilience, 1, 5, 3),
        encryption: str(l.encryption),
        dependency_strength: clampInt(l.dependency_strength, 1, 5, 3),
        failure_impact: clampInt(l.failure_impact, 1, 5, 3),
        provenance: pickEnum(l.provenance, ['doctrinal', 'synthetic', 'assessed'], 'assessed', null),
        phase_ids: normalizePhaseIds(l.phase_ids, phaseIds, issues, where),
        status: pickEnum(l.status, STATUSES, 'Active', issues, where, 'status'),
        status_by_phase: normalizeStatusByPhase(l.status_by_phase, phaseIds, issues, where),
        classification: pickEnum(l.classification, CLASSIFICATIONS, 'UNCLASSIFIED', issues, where, 'classification'),
        tags: parseList(l.tags), notes: str(l.notes)
      });
    });

    // Vulnerabilities (analyst-asserted)
    var vulnsRaw = Array.isArray(raw.vulnerabilities) ? raw.vulnerabilities : [];
    vulnsRaw.forEach(function (v, i) {
      var id = str(v && v.id).trim() || ('vuln-' + i);
      var where = 'vulnerability ' + id;
      var nodeRefs = parseList(v.affected_node_ids).filter(function (r) {
        if (!nodeIds[r]) { issues.push({ level: 'warning', where: where, message: 'References missing node "' + r + '"' }); return false; }
        return true;
      });
      var linkRefs = parseList(v.affected_link_ids).filter(function (r) {
        if (!linkIds[r]) { issues.push({ level: 'warning', where: where, message: 'References missing link "' + r + '"' }); return false; }
        return true;
      });
      scenario.vulnerabilities.push({
        id: id, title: str(v.title, id),
        vulnerability_type: str(v.vulnerability_type, 'other'),
        affected_node_ids: nodeRefs, affected_link_ids: linkRefs,
        severity: clampInt(v.severity, 1, 5, 3),
        likelihood: clampInt(v.likelihood, 1, 5, 3),
        detectability: clampInt(v.detectability, 1, 5, 3),
        operational_impact: str(v.operational_impact),
        mitigation: str(v.mitigation),
        status: pickEnum(v.status, ['open', 'mitigated', 'accepted'], 'open', null),
        notes: str(v.notes)
      });
    });

    // Activities
    var actsRaw = Array.isArray(raw.activities) ? raw.activities : [];
    actsRaw.forEach(function (a, i) {
      var id = str(a && a.id).trim() || ('activity-' + i);
      var where = 'activity ' + id;
      ['source_node_id', 'target_node_id'].forEach(function (f) {
        if (a && a[f] && !nodeIds[a[f]]) {
          issues.push({ level: 'warning', where: where, message: f + ' "' + a[f] + '" does not exist (cleared)' });
          a[f] = '';
        }
      });
      var pos = a.position || {};
      var lat = clampNum(pos.lat, -90, 90, NaN), lon = clampNum(pos.lon, -180, 180, NaN);
      scenario.activities.push({
        id: id, name: str(a.name, id), echelon: str(a.echelon),
        contact: pickEnum(a.contact, CONTACT_FORMS, 'direct', issues, where, 'contact'),
        from_hours: clampNum(a.from_hours, 0, scenario.timeline.duration_hours, 0),
        to_hours: clampNum(a.to_hours, 0, scenario.timeline.duration_hours, scenario.timeline.duration_hours),
        geographic: a.geographic !== false,
        position: (isFinite(lat) && isFinite(lon)) ? { lat: lat, lon: lon } : null,
        source_node_id: str(a.source_node_id), target_node_id: str(a.target_node_id),
        note: str(a.note)
      });
    });

    // Overlays
    var ov = raw.overlays || {};
    (Array.isArray(ov.annotations) ? ov.annotations : []).forEach(function (an, i) {
      var lat = clampNum(an && an.lat, -90, 90, NaN), lon = clampNum(an && an.lon, -180, 180, NaN);
      if (!isFinite(lat) || !isFinite(lon)) { issues.push({ level: 'warning', where: 'annotation[' + i + ']', message: 'Annotation missing lat/lon (dropped)' }); return; }
      scenario.overlays.annotations.push({
        id: str(an.id, 'ann-' + i), text: str(an.text), lat: lat, lon: lon,
        phase_ids: normalizePhaseIds(an.phase_ids, phaseIds, issues, 'annotation ' + str(an.id, i))
      });
    });
    (Array.isArray(ov.zones) ? ov.zones : []).forEach(function (z, i) {
      var pts = (Array.isArray(z && z.points) ? z.points : []).map(function (p) {
        return { lat: clampNum(p.lat, -90, 90, 0), lon: clampNum(p.lon, -180, 180, 0) };
      });
      if (pts.length < 3) { issues.push({ level: 'warning', where: 'zone[' + i + ']', message: 'Zone has fewer than 3 points (dropped)' }); return; }
      scenario.overlays.zones.push({
        id: str(z.id, 'zone-' + i),
        kind: pickEnum(z.kind, ['deep', 'close', 'rear', 'custom'], 'custom', null),
        label: str(z.label),
        phase_ids: normalizePhaseIds(z.phase_ids, phaseIds, issues, 'zone ' + str(z.id, i)),
        points: pts
      });
    });

    // Criticality model
    var cm = raw.criticality_model || {};
    scenario.criticality_model = {
      weights: mergeNums(DEFAULT_CRITICALITY_MODEL.weights, cm.weights),
      caps: mergeNums(DEFAULT_CRITICALITY_MODEL.caps, cm.caps),
      thresholds: mergeNums(DEFAULT_CRITICALITY_MODEL.thresholds, cm.thresholds),
      betweenness_node_limit: clampInt(cm.betweenness_node_limit, 10, 100000, DEFAULT_CRITICALITY_MODEL.betweenness_node_limit)
    };

    // Notes
    (Array.isArray(raw.notes) ? raw.notes : []).forEach(function (n, i) {
      scenario.notes.push({
        id: str(n.id, 'note-' + i), ts: str(n.ts), author: str(n.author),
        kind: pickEnum(n.kind, ['decision', 'assumption', 'narrative', 'risk'], 'narrative', null),
        text: str(n.text),
        refs: (Array.isArray(n.refs) ? n.refs : []).map(function (r) { return { type: str(r.type), id: str(r.id) }; })
      });
    });

    // Layout passthrough
    var lay = raw.layout || {};
    scenario.layout.graph_positions = (lay.graph_positions && typeof lay.graph_positions === 'object') ? lay.graph_positions : {};
    scenario.layout.view = str(lay.view, 'map');
    scenario.layout.t = clampNum(lay.t, 0, scenario.timeline.duration_hours, 0);
    if (lay.map_viewport) scenario.layout.map_viewport = lay.map_viewport;

    // Isolated-node warning (no links, no children, no parent)
    var linked = {};
    scenario.links.forEach(function (l) { linked[l.source] = 1; linked[l.target] = 1; });
    scenario.nodes.forEach(function (n) { if (n.parent_id) { linked[n.id] = 1; linked[n.parent_id] = 1; } });
    scenario.nodes.forEach(function (n) {
      if (!linked[n.id]) issues.push({ level: 'warning', where: 'node ' + n.id, message: 'Node has no links and no hierarchy connection (isolated)' });
    });

    return { scenario: scenario, issues: issues };
  }

  function normalizeSymbol(s) {
    s = s || {};
    var out = {
      branch_type: str(s.branch_type, 'none'),
      echelon_mark: str(s.echelon_mark),
      hq: !!s.hq,
      cp: str(s.cp)
    };
    // optional explicit MIL-STD-2525C code; overrides the derived mapping when present
    if (s.sidc) out.sidc = str(s.sidc);
    return out;
  }

  function mergeNums(defaults, over) {
    var out = {};
    Object.keys(defaults).forEach(function (k) {
      var v = over && parseFloat(over[k]);
      out[k] = (over && isFinite(v)) ? v : defaults[k];
    });
    return out;
  }

  function detectHierarchyCycles(nodes, issues) {
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    nodes.forEach(function (n) {
      var seen = {};
      var cur = n;
      while (cur && cur.parent_id) {
        if (seen[cur.id]) {
          issues.push({ level: 'error', where: 'node ' + n.id, message: 'Circular hierarchy through "' + cur.id + '" (parent link cut)' });
          cur.parent_id = '';
          break;
        }
        seen[cur.id] = 1;
        cur = byId[cur.parent_id];
      }
    });
  }

  function hashString(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return h;
  }

  /* ---- Phase / time logic ---- */

  function phaseAt(scenario, t) {
    var phases = scenario.timeline.phases;
    for (var i = 0; i < phases.length; i++) {
      if (t >= phases[i].from_hours && t < phases[i].to_hours) return phases[i];
    }
    if (phases.length && t >= phases[phases.length - 1].to_hours) return phases[phases.length - 1];
    return phases.length ? phases[0] : null;
  }

  function isActiveInPhase(entity, phaseId) {
    if (!phaseId) return true;
    if (entity.phase_ids === 'all') return true;
    return Array.isArray(entity.phase_ids) && entity.phase_ids.indexOf(phaseId) >= 0;
  }

  function effectiveStatus(entity, phaseId) {
    if (phaseId && entity.status_by_phase && entity.status_by_phase[phaseId]) {
      return entity.status_by_phase[phaseId];
    }
    return entity.status || 'Active';
  }

  function activityActiveAt(activity, t) {
    return t >= activity.from_hours && t <= activity.to_hours;
  }

  /* Build the effective graph at time t (or the full graph when t is null).
     Nodes/links outside the active phase are excluded; statuses are resolved per phase. */
  function buildGraph(scenario, t) {
    var phase = (t === null || t === undefined) ? null : phaseAt(scenario, t);
    var phaseId = phase ? phase.id : null;

    var nodes = scenario.nodes.filter(function (n) { return isActiveInPhase(n, phaseId); });
    var nodesById = {};
    nodes.forEach(function (n) { nodesById[n.id] = n; });

    var links = scenario.links.filter(function (l) {
      return isActiveInPhase(l, phaseId) && nodesById[l.source] && nodesById[l.target];
    });

    var adjacency = {};   // nodeId -> [{ link, otherId, isProvider }] (isProvider: the OTHER node provides to this one)
    var providersOf = {}; // nodeId -> [providerNodeId] (things this node depends on)
    var dependentsOf = {};// nodeId -> [dependentNodeId] (things that depend on this node)
    nodes.forEach(function (n) { adjacency[n.id] = []; providersOf[n.id] = []; dependentsOf[n.id] = []; });

    links.forEach(function (l) {
      adjacency[l.source].push({ link: l, otherId: l.target });
      adjacency[l.target].push({ link: l, otherId: l.source });
      var provider = null, dependent = null;
      if (TARGET_IS_PROVIDER[l.relationship_type]) { provider = l.target; dependent = l.source; }
      else if (SOURCE_IS_PROVIDER[l.relationship_type]) { provider = l.source; dependent = l.target; }
      if (provider && dependent) {
        providersOf[dependent].push(provider);
        dependentsOf[provider].push(dependent);
        if (l.direction === 'bidirectional') {
          providersOf[provider].push(dependent);
          dependentsOf[dependent].push(provider);
        }
      }
    });

    var children = {};
    var roots = [];
    nodes.forEach(function (n) { children[n.id] = []; });
    nodes.forEach(function (n) {
      if (n.parent_id && nodesById[n.parent_id]) children[n.parent_id].push(n.id);
      else roots.push(n.id);
    });

    return {
      t: (t === null || t === undefined) ? null : t,
      phase: phase,
      phaseId: phaseId,
      nodes: nodes,
      nodesById: nodesById,
      links: links,
      adjacency: adjacency,
      providersOf: providersOf,
      dependentsOf: dependentsOf,
      children: children,
      roots: roots,
      statusOf: function (entity) { return effectiveStatus(entity, phaseId); }
    };
  }

  OSP.model = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    NODE_TYPES: NODE_TYPES,
    RELATIONSHIP_TYPES: RELATIONSHIP_TYPES,
    COMM_METHODS: COMM_METHODS,
    CLASSIFICATIONS: CLASSIFICATIONS,
    SIDES: SIDES,
    STATUSES: STATUSES,
    DOMAINS: DOMAINS,
    CONTACT_FORMS: CONTACT_FORMS,
    DEFAULT_CRITICALITY_MODEL: DEFAULT_CRITICALITY_MODEL,
    TARGET_IS_PROVIDER: TARGET_IS_PROVIDER,
    SOURCE_IS_PROVIDER: SOURCE_IS_PROVIDER,
    normalizeScenario: normalizeScenario,
    phaseAt: phaseAt,
    isActiveInPhase: isActiveInPhase,
    effectiveStatus: effectiveStatus,
    activityActiveAt: activityActiveAt,
    buildGraph: buildGraph,
    parseList: parseList,
    clampInt: clampInt,
    clampNum: clampNum
  };
})();
