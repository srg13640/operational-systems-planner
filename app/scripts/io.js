/* OSP io — JSON/CSV import-export, column aliases, download helpers.
   Pure module except downloadBlob (the one DOM touch). Attaches to window.OSP.io.
   CSV parser and alias map ported from the Systems Viz Tool; imports MERGE by id
   (the source's destructive table replace is deliberately not replicated). */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  /* Canonical OSP field -> accepted CSV header aliases. Ported from the source
     columnAliases, adapted to OSP field names (operational_phase folds into
     phase_ids; symbol/geo columns added). The canonical name always wins over
     any alias claimed by another field. */
  var COLUMN_ALIASES = {
    id: ['id', 'node_id', 'link_id', 'vulnerability_id', 'unique_id'],
    name: ['name', 'node_name', 'system', 'system_name', 'unit_name', 'title'],
    title: ['title'],
    node_type: ['node_type', 'type', 'entity_type', 'category'],
    service: ['service', 'branch'],
    side: ['side', 'affiliation', 'force', 'blue_red', 'friendly_enemy'],
    echelon: ['echelon', 'level'],
    unit: ['unit', 'organization', 'org', 'owning_unit'],
    parent_id: ['parent_id', 'parent', 'superior_id', 'owning_unit_id', 'contains_in', 'reports_to'],
    warfighting_function: ['warfighting_function', 'wff', 'function', 'warfighting'],
    domain: ['domain', 'operational_domain'],
    mission: ['mission', 'purpose'],
    mission_importance: ['mission_importance', 'mission_value', 'importance'],
    echelon_importance: ['echelon_importance', 'echelon_value'],
    phase_ids: ['phase_ids', 'phases', 'phase_id', 'operational_phase', 'phase'],
    status: ['status', 'state'],
    status_by_phase: ['status_by_phase', 'phase_status'],
    location_name: ['location_name', 'location'],
    lat: ['lat', 'latitude'],
    lon: ['lon', 'lng', 'longitude', 'long'],
    non_geographic: ['non_geographic', 'nongeo'],
    branch_type: ['branch_type', 'branch_symbol', 'symbol_branch'],
    echelon_mark: ['echelon_mark', 'echelon_symbol'],
    hq: ['hq', 'is_hq'],
    cp: ['cp', 'command_post_role'],
    classification: ['classification', 'class', 'security'],
    owner: ['owner', 'proponent', 'responsible'],
    vulnerability_notes: ['vulnerability_notes', 'risk_notes', 'vulnerabilities'],
    tags: ['tags', 'tag'],
    notes: ['notes', 'comment', 'comments'],
    source: ['source', 'from', 'source_id', 'src'],
    target: ['target', 'to', 'target_id', 'dst', 'destination'],
    relationship_type: ['relationship_type', 'relationship', 'relation', 'link_type'],
    direction: ['direction', 'directedness'],
    communication_method: ['communication_method', 'communication', 'comms', 'link_method', 'method'],
    bandwidth: ['bandwidth', 'capacity'],
    latency: ['latency', 'delay'],
    resilience: ['resilience', 'redundancy', 'reliability'],
    encryption: ['encryption', 'crypto'],
    dependency_strength: ['dependency_strength', 'dependency', 'strength'],
    failure_impact: ['failure_impact', 'impact'],
    provenance: ['provenance', 'origin'],
    vulnerability_type: ['vulnerability_type', 'risk_type', 'finding_type'],
    affected_node_ids: ['affected_node_ids', 'affected_nodes', 'node_ids'],
    affected_link_ids: ['affected_link_ids', 'affected_links', 'link_ids'],
    severity: ['severity', 'sev'],
    likelihood: ['likelihood', 'probability'],
    detectability: ['detectability', 'detect'],
    operational_impact: ['operational_impact', 'ops_impact', 'impact_statement'],
    mitigation: ['mitigation', 'recommendation', 'recommended_mitigation']
  };

  var NODE_CSV_FIELDS = ['id', 'name', 'node_type', 'side', 'service', 'echelon', 'unit',
    'parent_id', 'warfighting_function', 'domain', 'mission', 'mission_importance',
    'echelon_importance', 'phase_ids', 'status', 'status_by_phase', 'location_name',
    'lat', 'lon', 'branch_type', 'echelon_mark', 'hq', 'cp', 'classification', 'owner',
    'vulnerability_notes', 'tags', 'notes'];

  var LINK_CSV_FIELDS = ['id', 'source', 'target', 'relationship_type', 'direction',
    'communication_method', 'bandwidth', 'latency', 'resilience', 'encryption',
    'dependency_strength', 'failure_impact', 'provenance', 'phase_ids', 'status',
    'status_by_phase', 'classification', 'tags', 'notes'];

  var VULN_CSV_FIELDS = ['id', 'title', 'vulnerability_type', 'affected_node_ids',
    'affected_link_ids', 'severity', 'likelihood', 'detectability', 'operational_impact',
    'mitigation', 'status', 'notes'];

  /* ---- Small helpers ---- */

  function str(v, dflt) { return (v === undefined || v === null) ? (dflt || '') : String(v); }

  function normKey(value) {
    return str(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

  function parseBool(value) {
    if (value === true) return true;
    if (value === false || value === undefined || value === null) return false;
    var s = String(value).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'x';
  }

  function parseStatusByPhase(value) {
    if (value && typeof value === 'object') return value;
    var out = {};
    str(value).split(';').forEach(function (part) {
      var idx = part.indexOf(':');
      if (idx <= 0) return;
      var pid = part.slice(0, idx).trim();
      var status = part.slice(idx + 1).trim();
      if (pid && status) out[pid] = status;
    });
    return out;
  }

  function statusByPhaseToText(map) {
    if (!map || typeof map !== 'object') return '';
    return Object.keys(map).map(function (pid) { return pid + ':' + map[pid]; }).join(';');
  }

  function phaseIdsToText(v) {
    if (v === undefined || v === null || v === '' || v === 'all') return 'all';
    if (Array.isArray(v)) return v.join(';');
    return String(v);
  }

  function schemaVersion() {
    return (window.OSP.model && OSP.model.SCHEMA_VERSION) ? OSP.model.SCHEMA_VERSION : '1.0';
  }

  /* Header alias lookup: normalized alias -> canonical field. Canonical names are
     registered first so they can never be shadowed by another field's alias. */
  var ALIAS_LOOKUP = buildAliasLookup();

  function buildAliasLookup() {
    var lookup = {};
    Object.keys(COLUMN_ALIASES).forEach(function (field) {
      lookup[normKey(field)] = field;
    });
    Object.keys(COLUMN_ALIASES).forEach(function (field) {
      COLUMN_ALIASES[field].forEach(function (alias) {
        var key = normKey(alias);
        if (!lookup[key]) lookup[key] = field;
      });
    });
    return lookup;
  }

  function mapColumn(header) {
    var key = normKey(header);
    if (!key) return '';
    if (ALIAS_LOOKUP[key]) return ALIAS_LOOKUP[key];
    return str(header).trim();
  }

  /* ---- CSV parsing (RFC-4180 state machine, ported verbatim) ---- */

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    var s = str(text);
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var next = s.charAt(i + 1);
      if (quoted) {
        if (ch === '"' && next === '"') {
          cell += '"';
          i++;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(cell);
        cell = '';
      } else if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (ch !== '\r') {
        cell += ch;
      }
    }
    row.push(cell);
    rows.push(row);
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    });
  }

  /* Header-signature table detection (ported). Takes the header row (array). */
  function detectCsvType(headerRow) {
    var keys = (Array.isArray(headerRow) ? headerRow : []).map(normKey);
    function hasAny(list) {
      return keys.some(function (k) { return list.indexOf(k) >= 0; });
    }
    if (hasAny(['source', 'from', 'target', 'to', 'communication_method', 'comms'])) return 'links';
    if (hasAny(['vulnerability_type', 'severity', 'affected_node_ids', 'affected_nodes'])) return 'vulnerabilities';
    if (hasAny(['node_type', 'parent_id', 'echelon', 'warfighting_function'])) return 'nodes';
    return null;
  }

  /* Rows -> plain objects using the alias map. Unknown headers are kept as-is. */
  function csvToObjects(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return [];
    var headers = rows[0].map(mapColumn);
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        if (!headers[c]) continue;
        obj[headers[c]] = (rows[r][c] === undefined || rows[r][c] === null) ? '' : rows[r][c];
      }
      out.push(obj);
    }
    return out;
  }

  /* ---- CSV import (merge by id — never wipes other tables) ---- */

  function adaptNodeRow(row) {
    var out = {};
    var geo = null;
    var symbol = null;
    Object.keys(row).forEach(function (k) {
      if (k === 'lat' || k === 'lon' || k === 'location_name') {
        geo = geo || {};
        geo[k] = row[k];
      } else if (k === 'non_geographic') {
        geo = geo || {};
        geo.non_geographic = parseBool(row[k]);
      } else if (k === 'branch_type' || k === 'echelon_mark' || k === 'cp') {
        symbol = symbol || {};
        symbol[k] = row[k];
      } else if (k === 'hq') {
        symbol = symbol || {};
        symbol.hq = parseBool(row[k]);
      } else if (k === 'status_by_phase') {
        out.status_by_phase = parseStatusByPhase(row[k]);
      } else {
        out[k] = row[k];
      }
    });
    if (out.title !== undefined) {
      if (out.name === undefined) out.name = out.title;
      delete out.title;
    }
    if (geo) out.geo = geo;
    if (symbol) out.symbol = symbol;
    return out;
  }

  function adaptLinkRow(row) {
    var out = {};
    Object.keys(row).forEach(function (k) {
      if (k === 'status_by_phase') out.status_by_phase = parseStatusByPhase(row[k]);
      else out[k] = row[k];
    });
    return out;
  }

  /* Overlay imported fields onto an existing record: every column the CSV carries
     replaces the stored value; columns not present survive. geo/symbol merge at
     the sub-key level so a lat/lon update does not clear location_name. */
  function overlayRecord(existing, imported) {
    var out = deepClone(existing);
    Object.keys(imported).forEach(function (k) {
      if ((k === 'geo' || k === 'symbol') &&
          out[k] && typeof out[k] === 'object' &&
          imported[k] && typeof imported[k] === 'object') {
        Object.keys(imported[k]).forEach(function (sk) { out[k][sk] = imported[k][sk]; });
      } else {
        out[k] = imported[k];
      }
    });
    return out;
  }

  function mergeById(table, incoming) {
    var indexById = {};
    table.forEach(function (rec, i) {
      var id = str(rec && rec.id).trim();
      if (id) indexById[id] = i;
    });
    incoming.forEach(function (rec) {
      var id = str(rec && rec.id).trim();
      if (id && indexById[id] !== undefined) {
        table[indexById[id]] = overlayRecord(table[indexById[id]], rec);
      } else {
        if (id) indexById[id] = table.length;
        table.push(rec);
      }
    });
  }

  /* Parse CSV text, detect table type, map to objects, and merge into a deep
     clone of the given scenario. Returns { kind, count, raw }. Never touches
     tables other than the imported one. */
  function importCsv(text, scenario) {
    var rows = parseCsv(text);
    if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row.');
    var kind = detectCsvType(rows[0]);
    if (kind !== 'nodes' && kind !== 'links' && kind !== 'vulnerabilities') {
      throw new Error('Could not detect CSV table type from the header row. Expected nodes, links, or vulnerabilities columns.');
    }
    var objects = csvToObjects(rows);
    if (kind === 'nodes') objects = objects.map(adaptNodeRow);
    else if (kind === 'links') objects = objects.map(adaptLinkRow);
    var raw = deepClone(scenario || {});
    if (!Array.isArray(raw[kind])) raw[kind] = [];
    mergeById(raw[kind], objects);
    return { kind: kind, count: objects.length, raw: raw };
  }

  /* ---- JSON import (osp-scenario native + Systems Viz legacy adapter) ---- */

  function isOspScenario(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.kind === 'osp-scenario') return true;
    return !!(data.schema_version && Array.isArray(data.nodes));
  }

  function isLegacyDataset(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.meta || typeof data.meta !== 'object') return false;
    return Array.isArray(data.nodes) || Array.isArray(data.links) || Array.isArray(data.vulnerabilities);
  }

  function parseListLoose(v) {
    if (window.OSP.model && OSP.model.parseList) return OSP.model.parseList(v);
    if (Array.isArray(v)) return v.slice();
    if (v === undefined || v === null || v === '') return [];
    return String(v).split(/[;,]/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* Move a legacy operational_phase string into tags ('phase:<value>') and
     default phase_ids to 'all' — there is no phase table to map to. */
  function adaptLegacyPhase(out, legacy) {
    out.phase_ids = 'all';
    var phase = str(legacy.operational_phase).trim();
    if (phase && phase.toLowerCase() !== 'all') {
      var tags = parseListLoose(legacy.tags);
      tags.push('phase:' + phase);
      out.tags = tags;
    }
  }

  var LEGACY_NODE_SKIP = { lat: 1, lon: 1, location_name: 1, operational_phase: 1,
    hierarchy_label: 1, x: 1, y: 1, vx: 1, vy: 1, fx: 1, fy: 1, pinned: 1 };

  function adaptLegacyDataset(data) {
    var meta = data.meta || {};
    var marking = (typeof meta.classification === 'string')
      ? meta.classification
      : str(meta.classification && meta.classification.marking, 'UNCLASSIFIED');
    var name = str(meta.dataset_name, str(meta.name, 'Imported Systems Viz Dataset'));
    var raw = {
      kind: 'osp-scenario',
      schema_version: schemaVersion(),
      meta: {
        name: name,
        scenario_name: name,
        description: str(meta.description),
        turn: str(meta.turn),
        created_by: str(meta.created_by),
        created_at: str(meta.date, str(meta.created_at)),
        tags: parseListLoose(meta.tags),
        classification: { marking: marking }
      },
      nodes: [],
      links: [],
      vulnerabilities: []
    };

    (Array.isArray(data.nodes) ? data.nodes : []).forEach(function (n) {
      if (!n || typeof n !== 'object') return;
      var node = {};
      Object.keys(n).forEach(function (k) {
        if (!LEGACY_NODE_SKIP[k]) node[k] = n[k];
      });
      node.geo = {
        location_name: str(n.location_name),
        lat: n.lat,
        lon: n.lon
      };
      adaptLegacyPhase(node, n);
      raw.nodes.push(node);
    });

    (Array.isArray(data.links) ? data.links : []).forEach(function (l) {
      if (!l || typeof l !== 'object') return;
      var link = {};
      Object.keys(l).forEach(function (k) {
        if (k !== 'operational_phase') link[k] = l[k];
      });
      adaptLegacyPhase(link, l);
      raw.links.push(link);
    });

    raw.vulnerabilities = Array.isArray(data.vulnerabilities) ? deepClone(data.vulnerabilities) : [];

    if (data.layout_positions && typeof data.layout_positions === 'object') {
      raw.layout = { graph_positions: deepClone(data.layout_positions) };
    }
    return raw;
  }

  /* Parse JSON text and return { raw, format } where format is 'osp' or
     'svt-legacy'. The raw object is ready for OSP.model.normalizeScenario. */
  function importJson(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new Error('Could not parse JSON: ' + err.message);
    }
    if (isOspScenario(data)) return { raw: data, format: 'osp' };
    if (isLegacyDataset(data)) return { raw: adaptLegacyDataset(data), format: 'svt-legacy' };
    throw new Error('JSON is not an osp-scenario file or a legacy Systems Viz dataset (expected kind "osp-scenario" or a meta/nodes/links structure).');
  }

  /* ---- JSON export ---- */

  /* Serialize the canonical scenario. opts:
     includeLayout (default true), criticalitySnapshot (array), appVersion, exportedAt.
     The "export" block is advisory output only — never read back on import. */
  function scenarioToJson(scenario, opts) {
    opts = opts || {};
    var out = deepClone(scenario || {});
    out.kind = 'osp-scenario';
    out.schema_version = str(out.schema_version, schemaVersion()) || schemaVersion();
    if (opts.includeLayout === false) delete out.layout;
    if (opts.exportedAt) {
      out.meta = out.meta || {};
      out.meta.modified_at = String(opts.exportedAt);
    }
    if (opts.criticalitySnapshot) {
      out.export = {
        exported_at: opts.exportedAt ? String(opts.exportedAt) : new Date().toISOString(),
        app_version: str(opts.appVersion),
        schema_version: out.schema_version,
        criticality_snapshot: deepClone(opts.criticalitySnapshot)
      };
    }
    return JSON.stringify(out, null, 2);
  }

  /* ---- CSV export ---- */

  function csvCell(value) {
    var s = str(value);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsvText(fields, rows) {
    var lines = [fields.join(',')];
    rows.forEach(function (row) {
      lines.push(row.map(csvCell).join(','));
    });
    return lines.join('\n');
  }

  function nodeToRow(n) {
    var geo = n.geo || {};
    var sym = n.symbol || {};
    return [
      str(n.id), str(n.name), str(n.node_type), str(n.side), str(n.service),
      str(n.echelon), str(n.unit), str(n.parent_id), str(n.warfighting_function),
      str(n.domain), str(n.mission), str(n.mission_importance), str(n.echelon_importance),
      phaseIdsToText(n.phase_ids), str(n.status), statusByPhaseToText(n.status_by_phase),
      str(geo.location_name),
      (geo.lat === null || geo.lat === undefined) ? '' : String(geo.lat),
      (geo.lon === null || geo.lon === undefined) ? '' : String(geo.lon),
      str(sym.branch_type), str(sym.echelon_mark), sym.hq ? 'true' : '', str(sym.cp),
      str(n.classification), str(n.owner), str(n.vulnerability_notes),
      parseListLoose(n.tags).join(';'), str(n.notes)
    ];
  }

  function linkToRow(l) {
    return [
      str(l.id), str(l.source), str(l.target), str(l.relationship_type), str(l.direction),
      str(l.communication_method), str(l.bandwidth), str(l.latency), str(l.resilience),
      str(l.encryption), str(l.dependency_strength), str(l.failure_impact),
      str(l.provenance), phaseIdsToText(l.phase_ids), str(l.status),
      statusByPhaseToText(l.status_by_phase), str(l.classification),
      parseListLoose(l.tags).join(';'), str(l.notes)
    ];
  }

  function vulnToRow(v) {
    return [
      str(v.id), str(v.title), str(v.vulnerability_type),
      parseListLoose(v.affected_node_ids).join(';'),
      parseListLoose(v.affected_link_ids).join(';'),
      str(v.severity), str(v.likelihood), str(v.detectability),
      str(v.operational_impact), str(v.mitigation), str(v.status), str(v.notes)
    ];
  }

  /* Flatten the scenario tables back to CSV text keyed by filename. */
  function exportCsvTables(scenario) {
    scenario = scenario || {};
    var nodes = Array.isArray(scenario.nodes) ? scenario.nodes : [];
    var links = Array.isArray(scenario.links) ? scenario.links : [];
    var vulns = Array.isArray(scenario.vulnerabilities) ? scenario.vulnerabilities : [];
    return {
      'nodes.csv': toCsvText(NODE_CSV_FIELDS, nodes.map(nodeToRow)),
      'links.csv': toCsvText(LINK_CSV_FIELDS, links.map(linkToRow)),
      'vulnerabilities.csv': toCsvText(VULN_CSV_FIELDS, vulns.map(vulnToRow))
    };
  }

  /* ---- Filenames and downloads ---- */

  function safeFilename(name) {
    var s = str(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (s.length > 60) s = s.slice(0, 60).replace(/-+$/g, '');
    return s || 'osp-export';
  }

  function downloadBlob(filename, mime, data) {
    var blob = (typeof Blob !== 'undefined' && data instanceof Blob)
      ? data
      : new Blob([data], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 500);
  }

  OSP.io = {
    COLUMN_ALIASES: COLUMN_ALIASES,
    parseCsv: parseCsv,
    detectCsvType: detectCsvType,
    csvToObjects: csvToObjects,
    importCsv: importCsv,
    importJson: importJson,
    scenarioToJson: scenarioToJson,
    exportCsvTables: exportCsvTables,
    safeFilename: safeFilename,
    downloadBlob: downloadBlob
  };
})();
