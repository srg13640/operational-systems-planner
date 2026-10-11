/* OSP model — schema constants, scenario normalization/validation, graph building, phase logic.
   Pure module: no DOM access. Attaches to window.OSP.model. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  /* 1.1 added node.arch_class (DoDAF DM2 classification, derived from node_type when absent)
     and layout.views (per-architecture-view pinned positions).
     1.2 adds link.link_class (flow | dependency | org | effect, derived from relationship_type
     when absent), link.resource / resource_kind / protocol (the named thing a needline or
     interface carries), node.parent_relationship (OV-4 qualifier), and meta.mission_statement /
     purpose / architect / version / as_of (AV-1 fields). 1.0 and 1.1 files load unchanged. */
  var SCHEMA_VERSION = '1.2';

  var NODE_TYPES = ['unit', 'headquarters', 'command_post', 'directorate', 'office', 'system',
    'platform', 'sensor', 'shooter', 'network', 'application', 'database', 'data_feed',
    'satellite', 'ground_station', 'relay', 'person_role', 'process', 'location', 'facility',
    'logistics_node', 'other'];

  /* DoDAF 2.0 architecture class. Performers are the operational nodes of the OV models
     (organizations, posts, roles, functioning facilities); systems are the materiel of the SV
     models; locations are geography with no behavior of their own. */
  var ARCH_CLASSES = ['performer', 'system', 'location', 'other'];
  var ARCH_CLASS_OF_NODE_TYPE = {
    unit: 'performer', headquarters: 'performer', command_post: 'performer', directorate: 'performer',
    office: 'performer', person_role: 'performer', facility: 'performer',
    logistics_node: 'performer',
    system: 'system', platform: 'system', sensor: 'system', shooter: 'system', network: 'system',
    application: 'system', database: 'system', data_feed: 'system', satellite: 'system',
    ground_station: 'system', relay: 'system',
    location: 'location',
    process: 'other',   // DM2: a process is an Activity, not a Performer
    other: 'other'
  };

  var RELATIONSHIP_TYPES = ['commands', 'controls', 'supports', 'depends_on', 'communicates_with',
    'provides_data_to', 'receives_data_from', 'uplinks_to', 'downlinks_from', 'relays_through',
    'hosts', 'uses', 'protects', 'targets', 'supplies', 'other'];

  /* Link classes decide which views a link appears on and how the analytics treat it.
       flow        — a resource actually moves (data, materiel, transport). OV-2 needlines and
                     SV-1/SV-2 interfaces are flow links; derived needlines walk through them.
       dependency  — an analytic assertion that one thing needs another, with no exchange named.
                     Feeds the criticality/SPOF engine; never drawn as an interface.
       org         — authority: commands / controls / supports. OV-4 only. Not a dependency: a
                     headquarters is not a "provider" its subordinates can lose an alternate for.
       effect      — targets / protects. Adversarial or protective relations, not exchanges.
                     Excluded from every metric so an enemy brigade cannot inherit the failure
                     impact of the things it targets. */
  var LINK_CLASSES = ['flow', 'dependency', 'org', 'effect'];
  var LINK_CLASS_OF_RELATIONSHIP = {
    provides_data_to: 'flow', receives_data_from: 'flow', communicates_with: 'flow',
    relays_through: 'flow', uplinks_to: 'flow', downlinks_from: 'flow', hosts: 'flow',
    supplies: 'flow', other: 'flow',
    depends_on: 'dependency', uses: 'dependency',
    commands: 'org', controls: 'org', supports: 'org',
    targets: 'effect', protects: 'effect'
  };
  var ORG_RELATIONSHIP_TYPES = Object.keys(LINK_CLASS_OF_RELATIONSHIP).filter(function (k) { return LINK_CLASS_OF_RELATIONSHIP[k] === 'org'; });
  var NON_FLOW_RELATIONSHIP_TYPES = Object.keys(LINK_CLASS_OF_RELATIONSHIP).filter(function (k) {
    return LINK_CLASS_OF_RELATIONSHIP[k] === 'org' || LINK_CLASS_OF_RELATIONSHIP[k] === 'effect';
  });

  /* Which way a derived-needline walk may cross a link. Content relations move one way
     (provides_data_to, supplies) or both (uses, hosts, communicates_with: the user reads and
     writes). Transport and dependency relations are walked only from the client toward the
     provider — never from a relay back out to another of its clients, or every performer on a
     shared trunk would acquire a "need" for every other one. */
  var ONE_WAY_FORWARD = { provides_data_to: 1, supplies: 1 };
  var ONE_WAY_BACKWARD = { receives_data_from: 1 };
  var TOWARD_PROVIDER_ONLY = { depends_on: 1, relays_through: 1, uplinks_to: 1, downlinks_from: 1 };

  var RESOURCE_KINDS = ['information', 'materiel', 'personnel', 'funding', 'other'];

  /* OV-4 qualifier on a node's parent relationship (Army/joint task-organization terms). */
  var PARENT_RELATIONSHIPS = ['organic', 'assigned', 'attached', 'opcon', 'tacon', 'adcon', 'supporting'];

  var COMM_METHODS = ['UHF/VHF/HF Radio', 'SATCOM', 'Fiber', 'Microwave', 'LTE/5G',
    'Tactical Data Link', 'LAN', 'WAN', 'Mesh', 'Courier', 'Voice', 'API',
    'Database Replication', 'Other'];

  var CLASSIFICATIONS = ['UNCLASSIFIED', 'CUI', 'SECRET', 'TOP SECRET', 'Other'];
  var SIDES = ['Friendly', 'Enemy', 'Neutral', 'Unknown'];
  var STATUSES = ['Active', 'Degraded', 'Offline', 'Planned', 'Unknown'];
  var DOMAINS = ['space', 'air', 'ems', 'cyber', 'c2', 'strike', 'sustain', 'land', 'maritime', 'data', 'other'];
  var CONTACT_FORMS = ['direct', 'indirect', 'air', 'maritime', 'electronic', 'cyber', 'information', 'sensing'];

  /* Caps are absolute, not dataset-relative, so scores compare across time and scenarios.
     betweenness caps the normalized Brandes value (max observed on planning-scale graphs is
     ~0.25; without the cap a 20-point weight could contribute at most ~5). */
  var DEFAULT_CRITICALITY_MODEL = {
    weights: { mission: 20, echelon: 15, degree: 20, betweenness: 20, failure: 15, shared: 10 },
    caps: { degree: 12, dependency: 8, cascade: 12, shared: 6, betweenness: 0.25 },
    thresholds: { mission_critical: 70, high: 50, moderate: 30 },
    betweenness_node_limit: 250
  };

  /* For these relationship types the TARGET is the provider (the thing depended on); for the
     rest of the flow/dependency types the SOURCE is. Org and effect links have no provider:
     command authority and protection are not inputs a dependent can lose. */
  var TARGET_IS_PROVIDER = { depends_on: 1, uses: 1, receives_data_from: 1, relays_through: 1, uplinks_to: 1, downlinks_from: 1 };
  var SOURCE_IS_PROVIDER = { provides_data_to: 1, hosts: 1, supplies: 1 };

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
      schema_version: SCHEMA_VERSION,   // normalized output always carries the current contract
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
        mission_statement: str(meta.mission_statement),
        purpose: str(meta.purpose),
        architect: str(meta.architect),
        version: str(meta.version),
        as_of: str(meta.as_of),
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
      layout: { graph_positions: {}, views: {}, view: 'ov1', t: 0, map_viewport: { x: 0, y: 0, k: 1 } }
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
      if (!isRecord(p)) { issues.push({ level: 'error', where: 'timeline', message: 'Phase[' + i + '] is not an object (dropped)' }); return; }
      var id = str(p.id, 'phase-' + (i + 1));
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
      if (!isRecord(n)) { issues.push({ level: 'error', where: where, message: 'Node is not an object (dropped)' }); return; }
      var id = str(n.id).trim();
      if (!id) { issues.push({ level: 'error', where: where, message: 'Node missing id (dropped)' }); return; }
      if (nodeIds[id]) { issues.push({ level: 'error', where: where, message: 'Duplicate node id "' + id + '" (dropped)' }); return; }
      nodeIds[id] = 1;
      where = 'node ' + id;
      var nodeType = pickEnum(n.node_type, NODE_TYPES, 'other', issues, where, 'node_type');
      scenario.nodes.push({
        id: id,
        name: str(n.name, id),
        node_type: nodeType,
        arch_class: pickEnum(n.arch_class, ARCH_CLASSES, ARCH_CLASS_OF_NODE_TYPE[nodeType] || 'other', issues, where, 'arch_class'),
        side: pickEnum(n.side, SIDES, 'Friendly', issues, where, 'side'),
        service: str(n.service),
        echelon: str(n.echelon),
        unit: str(n.unit),
        parent_id: str(n.parent_id).trim(),
        parent_relationship: pickEnum(n.parent_relationship, PARENT_RELATIONSHIPS, 'organic', issues, where, 'parent_relationship'),
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
    var nodeById = {};
    scenario.nodes.forEach(function (n) { nodeById[n.id] = n; });
    linksRaw.forEach(function (l, i) {
      var where = 'link[' + i + ']';
      if (!isRecord(l)) { issues.push({ level: 'error', where: where, message: 'Link is not an object (dropped)' }); return; }
      var id = str(l.id).trim() || ('link-' + i);
      if (linkIds[id]) { issues.push({ level: 'error', where: where, message: 'Duplicate link id "' + id + '" (dropped)' }); return; }
      var source = str(l.source).trim(), target = str(l.target).trim();
      if (!nodeIds[source] || !nodeIds[target]) {
        issues.push({ level: 'error', where: 'link ' + id, message: 'Link endpoint missing (' + source + ' -> ' + target + ') (dropped)' });
        return;
      }
      if (source === target) {
        issues.push({ level: 'error', where: 'link ' + id, message: 'Link connects "' + source + '" to itself (dropped)' });
        return;
      }
      linkIds[id] = 1;
      where = 'link ' + id;
      var relType = pickEnum(l.relationship_type, RELATIONSHIP_TYPES, 'other', issues, where, 'relationship_type');
      var linkClass = pickEnum(l.link_class, LINK_CLASSES, LINK_CLASS_OF_RELATIONSHIP[relType] || 'flow', issues, where, 'link_class');
      var method = pickEnum(l.communication_method, COMM_METHODS, 'Other', issues, where, 'communication_method');
      var resourceKindDefault = (relType === 'supplies') ? 'materiel' : 'information';
      var link = {
        id: id, source: source, target: target,
        relationship_type: relType,
        link_class: linkClass,
        resource: str(l.resource).trim(),
        resource_kind: pickEnum(l.resource_kind, RESOURCE_KINDS, resourceKindDefault, issues, where, 'resource_kind'),
        direction: (str(l.direction) === 'bidirectional') ? 'bidirectional' : 'directed',
        communication_method: method,
        bandwidth: str(l.bandwidth), latency: str(l.latency), protocol: str(l.protocol),
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
      };
      scenario.links.push(link);
      // DM2 sanity: authority runs between performers; you cannot command materiel
      if (linkClass === 'org') {
        var sCls = archClassOf(nodeById[source]), tCls = archClassOf(nodeById[target]);
        if (sCls !== 'performer' || tCls !== 'performer') {
          issues.push({ level: 'warning', where: where, message: relType + ' link joins a non-performer (' + sCls + ' -> ' + tCls + '); authority relations belong between performers' });
        }
      }
    });

    // Vulnerabilities (analyst-asserted)
    var vulnsRaw = Array.isArray(raw.vulnerabilities) ? raw.vulnerabilities : [];
    vulnsRaw.forEach(function (v, i) {
      if (!isRecord(v)) { issues.push({ level: 'error', where: 'vulnerability[' + i + ']', message: 'Vulnerability is not an object (dropped)' }); return; }
      var id = str(v.id).trim() || ('vuln-' + i);
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
      if (!isRecord(a)) { issues.push({ level: 'error', where: 'activity[' + i + ']', message: 'Activity is not an object (dropped)' }); return; }
      var id = str(a.id).trim() || ('activity-' + i);
      var where = 'activity ' + id;
      ['source_node_id', 'target_node_id'].forEach(function (f) {
        if (a[f] && !nodeIds[a[f]]) {
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
      if (!isRecord(an)) { issues.push({ level: 'warning', where: 'annotation[' + i + ']', message: 'Annotation is not an object (dropped)' }); return; }
      var lat = clampNum(an.lat, -90, 90, NaN), lon = clampNum(an.lon, -180, 180, NaN);
      if (!isFinite(lat) || !isFinite(lon)) { issues.push({ level: 'warning', where: 'annotation[' + i + ']', message: 'Annotation missing lat/lon (dropped)' }); return; }
      scenario.overlays.annotations.push({
        id: str(an.id, 'ann-' + i), text: str(an.text), lat: lat, lon: lon,
        phase_ids: normalizePhaseIds(an.phase_ids, phaseIds, issues, 'annotation ' + str(an.id, i))
      });
    });
    (Array.isArray(ov.zones) ? ov.zones : []).forEach(function (z, i) {
      if (!isRecord(z)) { issues.push({ level: 'warning', where: 'zone[' + i + ']', message: 'Zone is not an object (dropped)' }); return; }
      var pts = (Array.isArray(z.points) ? z.points : []).filter(isRecord).map(function (p) {
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
    (Array.isArray(raw.notes) ? raw.notes : []).filter(isRecord).forEach(function (n, i) {
      scenario.notes.push({
        id: str(n.id, 'note-' + i), ts: str(n.ts), author: str(n.author),
        kind: pickEnum(n.kind, ['decision', 'assumption', 'narrative', 'risk'], 'narrative', null),
        text: str(n.text),
        refs: (Array.isArray(n.refs) ? n.refs : []).filter(isRecord).map(function (r) { return { type: str(r.type), id: str(r.id) }; })
      });
    });

    // Layout passthrough
    var lay = raw.layout || {};
    scenario.layout.graph_positions = (lay.graph_positions && typeof lay.graph_positions === 'object') ? lay.graph_positions : {};
    // per-view pinned positions: { viewId: { positions: { nodeId: {x, y, pinned} } } }
    scenario.layout.views = {};
    if (lay.views && typeof lay.views === 'object') {
      Object.keys(lay.views).forEach(function (vid) {
        var v = lay.views[vid];
        if (v && typeof v === 'object' && v.positions && typeof v.positions === 'object') {
          scenario.layout.views[vid] = { positions: v.positions };
        }
      });
    }
    // 1.0 files persisted the generic surfaces; map them onto the architecture views
    var legacyView = { map: 'ov1', graph: 'graph' };
    var viewName = str(lay.view, 'ov1');
    scenario.layout.view = legacyView[viewName] || viewName;
    scenario.layout.t = clampNum(lay.t, 0, scenario.timeline.duration_hours, 0);
    if (lay.map_viewport) scenario.layout.map_viewport = lay.map_viewport;

    // Isolated-node warning (no links, no children, no parent)
    var linked = {};
    scenario.links.forEach(function (l) { linked[l.source] = 1; linked[l.target] = 1; });
    scenario.nodes.forEach(function (n) { if (n.parent_id) { linked[n.id] = 1; linked[n.parent_id] = 1; } });
    scenario.nodes.forEach(function (n) {
      if (!linked[n.id]) issues.push({ level: 'warning', where: 'node ' + n.id, message: 'Node has no links and no hierarchy connection (isolated)' });
    });

    // The banner must be the high-water mark of everything it frames.
    var over = scenario.nodes.concat(scenario.links).filter(function (e) {
      return markingRank(e.classification) > markingRank(scenario.meta.classification.marking);
    });
    if (over.length) {
      var hw = highestMarking(over.map(function (e) { return e.classification; }));
      issues.push({ level: 'warning', where: 'meta', message: over.length + ' ' + (over.length === 1 ? 'entity is' : 'entities are') + ' marked above the scenario banner (' + hw + ' > ' + scenario.meta.classification.marking + '); the banner rolls up to the highest marking shown' });
    }

    return { scenario: scenario, issues: issues };
  }

  function isRecord(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /* ---- Classification roll-up ---- */

  var MARKING_RANK = { 'UNCLASSIFIED': 1, 'CUI': 2, 'SECRET': 3, 'TOP SECRET': 4, 'Other': 2 };
  function markingRank(marking) { return MARKING_RANK[marking] || 1; }
  function highestMarking(markings) {
    var best = 'UNCLASSIFIED', bestRank = 0;
    (markings || []).forEach(function (m) {
      var r = markingRank(m);
      if (r > bestRank) { bestRank = r; best = (MARKING_RANK[m] ? m : 'Other'); }
    });
    return best;
  }
  /* The marking a banner must carry for a set of displayed entities: max(meta, entities). */
  function bannerMarking(scenario, entities) {
    var list = [scenario.meta.classification.marking];
    (entities || []).forEach(function (e) { if (e && e.classification) list.push(e.classification); });
    return highestMarking(list);
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

  /* ---- Architecture-view helpers ---- */

  function archClassOf(node) {
    if (node && node.arch_class && ARCH_CLASSES.indexOf(node.arch_class) >= 0) return node.arch_class;
    return ARCH_CLASS_OF_NODE_TYPE[node && node.node_type] || 'other';
  }

  function linkClassOf(link) {
    if (link && link.derived) return 'flow';
    if (link && link.link_class && LINK_CLASSES.indexOf(link.link_class) >= 0) return link.link_class;
    return LINK_CLASS_OF_RELATIONSHIP[link && link.relationship_type] || 'flow';
  }

  /* Links that create a provider -> dependent relation for the analytics. */
  function isDependencyLink(link) {
    var c = linkClassOf(link);
    return c === 'flow' || c === 'dependency';
  }

  /* { provider, dependent } for flow/dependency links; null for org/effect and for symmetric
     flows (communicates_with, other) that name no provider. */
  function dependencyProvider(link) {
    if (!isDependencyLink(link)) return null;
    if (TARGET_IS_PROVIDER[link.relationship_type]) return { provider: link.target, dependent: link.source };
    if (SOURCE_IS_PROVIDER[link.relationship_type]) return { provider: link.source, dependent: link.target };
    return null;
  }

  /* The key two links must share to be substitutes for each other: the named resource when the
     author gave one, otherwise the relationship family. "Intel DB provides targeting data" is not
     an alternate for "Ground Station KILO relays theater reach-back". */
  function resourceKeyOf(link) {
    var r = String(link.resource || '').trim().toLowerCase();
    return r ? 'r:' + r : 't:' + link.relationship_type;
  }

  /* Can a resource travel source->target (forward) / target->source (backward) along this link?
     Used by the derived-needline walk. */
  function isTransportLink(link) { return !!TOWARD_PROVIDER_ONLY[link && link.relationship_type]; }

  function flowDirections(link) {
    if (link.direction === 'bidirectional') return { forward: true, backward: true };
    if (ONE_WAY_FORWARD[link.relationship_type]) return { forward: true, backward: false };
    if (ONE_WAY_BACKWARD[link.relationship_type]) return { forward: false, backward: true };
    if (TOWARD_PROVIDER_ONLY[link.relationship_type]) {
      var towardTarget = !!TARGET_IS_PROVIDER[link.relationship_type];
      return { forward: towardTarget, backward: !towardTarget };
    }
    return { forward: true, backward: true };
  }

  /* Pinned-position table for a view. The generic dependency graph keeps its 1.0 home in
     layout.graph_positions; every architecture view gets its own table so the same system can
     sit in different places on SV-1 and OV-2. Created on demand. */
  function viewPositions(scenario, viewId) {
    if (!viewId || viewId === 'graph') return scenario.layout.graph_positions;
    scenario.layout.views = scenario.layout.views || {};
    if (!scenario.layout.views[viewId]) scenario.layout.views[viewId] = { positions: {} };
    return scenario.layout.views[viewId].positions;
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

    var adjacency = {};   // nodeId -> [{ link, otherId }] — every link, all classes (rendering, comms rules)
    var providersOf = {}; // nodeId -> [providerNodeId] (things this node depends on; flow/dependency links only)
    var dependentsOf = {};// nodeId -> [dependentNodeId] (things that depend on this node)
    var providerLinksOf = {}; // nodeId -> [{ link, provider }] for the same relations, keyed for resource matching
    nodes.forEach(function (n) { adjacency[n.id] = []; providersOf[n.id] = []; dependentsOf[n.id] = []; providerLinksOf[n.id] = []; });

    links.forEach(function (l) {
      adjacency[l.source].push({ link: l, otherId: l.target });
      adjacency[l.target].push({ link: l, otherId: l.source });
      var dep = dependencyProvider(l);
      if (dep) {
        providersOf[dep.dependent].push(dep.provider);
        dependentsOf[dep.provider].push(dep.dependent);
        providerLinksOf[dep.dependent].push({ link: l, provider: dep.provider });
        if (l.direction === 'bidirectional') {
          providersOf[dep.provider].push(dep.dependent);
          dependentsOf[dep.dependent].push(dep.provider);
          providerLinksOf[dep.provider].push({ link: l, provider: dep.dependent });
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
      providerLinksOf: providerLinksOf,
      children: children,
      roots: roots,
      statusOf: function (entity) { return effectiveStatus(entity, phaseId); }
    };
  }

  OSP.model = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    NODE_TYPES: NODE_TYPES,
    ARCH_CLASSES: ARCH_CLASSES,
    ARCH_CLASS_OF_NODE_TYPE: ARCH_CLASS_OF_NODE_TYPE,
    RELATIONSHIP_TYPES: RELATIONSHIP_TYPES,
    LINK_CLASSES: LINK_CLASSES,
    LINK_CLASS_OF_RELATIONSHIP: LINK_CLASS_OF_RELATIONSHIP,
    RESOURCE_KINDS: RESOURCE_KINDS,
    PARENT_RELATIONSHIPS: PARENT_RELATIONSHIPS,
    ORG_RELATIONSHIP_TYPES: ORG_RELATIONSHIP_TYPES,
    NON_FLOW_RELATIONSHIP_TYPES: NON_FLOW_RELATIONSHIP_TYPES,
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
    archClassOf: archClassOf,
    linkClassOf: linkClassOf,
    isDependencyLink: isDependencyLink,
    dependencyProvider: dependencyProvider,
    resourceKeyOf: resourceKeyOf,
    flowDirections: flowDirections,
    isTransportLink: isTransportLink,
    markingRank: markingRank,
    highestMarking: highestMarking,
    bannerMarking: bannerMarking,
    viewPositions: viewPositions,
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
