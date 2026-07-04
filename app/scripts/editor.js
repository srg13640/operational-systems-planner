/* OSP editor — in-app editing of nodes and links: field forms in the inspector,
   add/delete with reference cleanup, place-on-map, and a snapshot undo stack.
   Every mutation goes back through the normalizer, so edited data obeys the same
   contract as imported data. Attaches to OSP.editor. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var ctx = null;          // app context (select, setView, refresh hooks)
  var app = null;          // richer app hooks injected at init
  var editing = null;      // { type: 'node'|'link', id } while a form is open
  var placing = null;      // node id awaiting a map click for coordinates
  var undoStack = [];
  var UNDO_MAX = 20;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- undo ---- */

  function snapshot(label) {
    undoStack.push({ label: label, json: JSON.stringify(ctx.state.scenario) });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }

  function undo() {
    var last = undoStack.pop();
    if (!last) return false;
    editing = null;
    placing = null;
    app.replaceScenario(JSON.parse(last.json), { keepView: true });
    app.toast('Undid: ' + last.label);
    return true;
  }

  /* ---- mutation plumbing ---- */

  /* skipSnapshot: saving a just-created entity folds into its "add" snapshot,
     so add + first save is one atomic undo step. */
  function applyEdit(label, mutate, skipSnapshot) {
    if (!skipSnapshot) snapshot(label);
    var raw = JSON.parse(JSON.stringify(ctx.state.scenario));
    mutate(raw);
    app.replaceScenario(raw, { keepView: true });
  }

  function nextId(prefix, list) {
    var used = {};
    list.forEach(function (e) { used[e.id] = 1; });
    var n = list.length + 1;
    while (used[prefix + '-' + n]) n++;
    return prefix + '-' + n;
  }

  /* ---- field descriptors ---- */

  function nodeFields(sc) {
    var phaseOpts = sc.timeline.phases.map(function (p) { return { v: p.id, l: p.label }; });
    return [
      { k: 'name', label: 'Name', type: 'text' },
      { k: 'node_type', label: 'Type', type: 'select', opts: OSP.model.NODE_TYPES },
      { k: 'side', label: 'Side', type: 'select', opts: OSP.model.SIDES },
      { k: 'echelon', label: 'Echelon', type: 'text' },
      { k: 'domain', label: 'Domain', type: 'select', opts: OSP.model.DOMAINS },
      { k: 'warfighting_function', label: 'WFF', type: 'text' },
      { k: 'mission', label: 'Mission', type: 'textarea' },
      { k: 'mission_importance', label: 'Mission importance', type: 'range15' },
      { k: 'echelon_importance', label: 'Echelon importance', type: 'range15' },
      { k: 'status', label: 'Status', type: 'select', opts: OSP.model.STATUSES },
      { k: 'parent_id', label: 'Higher HQ', type: 'noderef', allowEmpty: true },
      { k: 'phase_ids', label: 'Phases', type: 'phases', opts: phaseOpts },
      { k: 'geo.location_name', label: 'Location name', type: 'text' },
      { k: 'geo.lat', label: 'Latitude', type: 'number' },
      { k: 'geo.lon', label: 'Longitude', type: 'number' },
      { k: 'classification', label: 'Classification', type: 'select', opts: OSP.model.CLASSIFICATIONS },
      { k: 'owner', label: 'Owner', type: 'text' },
      { k: 'vulnerability_notes', label: 'Vulnerability notes', type: 'textarea' },
      { k: 'notes', label: 'Notes', type: 'textarea' }
    ];
  }

  function linkFields(sc) {
    var phaseOpts = sc.timeline.phases.map(function (p) { return { v: p.id, l: p.label }; });
    return [
      { k: 'source', label: 'Source', type: 'noderef' },
      { k: 'target', label: 'Target', type: 'noderef' },
      { k: 'relationship_type', label: 'Relationship', type: 'select', opts: OSP.model.RELATIONSHIP_TYPES },
      { k: 'communication_method', label: 'Comms method', type: 'select', opts: OSP.model.COMM_METHODS },
      { k: 'direction', label: 'Direction', type: 'select', opts: ['directed', 'bidirectional'] },
      { k: 'resilience', label: 'Resilience', type: 'range15' },
      { k: 'dependency_strength', label: 'Dependency', type: 'range15' },
      { k: 'failure_impact', label: 'Failure impact', type: 'range15' },
      { k: 'encryption', label: 'Encryption', type: 'text' },
      { k: 'status', label: 'Status', type: 'select', opts: OSP.model.STATUSES },
      { k: 'phase_ids', label: 'Phases', type: 'phases', opts: phaseOpts },
      { k: 'classification', label: 'Classification', type: 'select', opts: OSP.model.CLASSIFICATIONS },
      { k: 'notes', label: 'Notes', type: 'textarea' }
    ];
  }

  function getPath(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === undefined || cur === null) return '';
      cur = cur[parts[i]];
    }
    return cur;
  }

  function setPath(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  /* ---- form rendering ---- */

  function fieldHtml(f, entity, sc) {
    var val = getPath(entity, f.k);
    var id = 'ef-' + f.k.replace(/\./g, '-');
    var inner = '';
    if (f.type === 'text') {
      inner = '<input type="text" id="' + id + '" value="' + esc(val) + '">';
    } else if (f.type === 'number') {
      inner = '<input type="number" step="0.01" id="' + id + '" value="' + esc(val === null ? '' : val) + '">';
    } else if (f.type === 'textarea') {
      inner = '<textarea id="' + id + '" rows="2">' + esc(val) + '</textarea>';
    } else if (f.type === 'range15') {
      inner = '<select id="' + id + '">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<option value="' + n + '"' + (Number(val) === n ? ' selected' : '') + '>' + n + '</option>';
      }).join('') + '</select>';
    } else if (f.type === 'select') {
      var opts = f.opts.map(function (o) {
        return '<option value="' + esc(o) + '"' + (val === o ? ' selected' : '') + '>' + esc(o) + '</option>';
      }).join('');
      inner = '<select id="' + id + '">' + opts + '</select>';
    } else if (f.type === 'noderef') {
      var options = (f.allowEmpty ? '<option value=""' + (!val ? ' selected' : '') + '>— none —</option>' : '');
      sc.nodes.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (n) {
        options += '<option value="' + esc(n.id) + '"' + (val === n.id ? ' selected' : '') + '>' + esc(n.name) + '</option>';
      });
      inner = '<select id="' + id + '">' + options + '</select>';
    } else if (f.type === 'phases') {
      var isAll = val === 'all';
      inner = '<label class="checkRow" style="display:inline-flex; margin-right:8px"><input type="checkbox" data-phase-all id="' + id + '-all"' + (isAll ? ' checked' : '') + '> all</label>';
      f.opts.forEach(function (p) {
        var on = !isAll && Array.isArray(val) && val.indexOf(p.v) >= 0;
        inner += '<label class="checkRow" style="display:inline-flex; margin-right:8px"><input type="checkbox" data-phase-id="' + esc(p.v) + '"' + (on ? ' checked' : '') + (isAll ? ' disabled' : '') + '> ' + esc(p.l) + '</label>';
      });
      inner = '<div id="' + id + '" data-phases>' + inner + '</div>';
    }
    return '<div class="editRow"><label for="' + id + '">' + esc(f.label) + '</label>' + inner + '</div>';
  }

  function readField(f) {
    var id = 'ef-' + f.k.replace(/\./g, '-');
    var el = document.getElementById(id);
    if (!el) return undefined;
    if (f.type === 'phases') {
      if (el.querySelector('[data-phase-all]').checked) return 'all';
      var out = [];
      el.querySelectorAll('[data-phase-id]').forEach(function (cb) {
        if (cb.checked) out.push(cb.getAttribute('data-phase-id'));
      });
      return out.length ? out : 'all';
    }
    if (f.type === 'number') {
      var n = parseFloat(el.value);
      return isFinite(n) ? n : null;
    }
    if (f.type === 'range15') return parseInt(el.value, 10);
    return el.value;
  }

  function formHtml(kind, entity, sc, isNew) {
    var fields = kind === 'node' ? nodeFields(sc) : linkFields(sc);
    var title = (isNew ? 'New ' : 'Edit ') + kind + (isNew ? '' : ' — ' + esc(entity.name || entity.id));
    var html = '<div class="inspHeader"><h2>' + title + '</h2>' +
      '<div class="subRow"><span class="tag">' + esc(entity.id) + '</span></div></div>' +
      '<div class="inspSection">' + fields.map(function (f) { return fieldHtml(f, entity, sc); }).join('') + '</div>' +
      '<div class="inspSection">' +
      '<button class="btn primary" data-edit-act="save">Save</button> ' +
      '<button class="btn" data-edit-act="cancel">Cancel</button>' +
      (kind === 'node' ? ' <button class="inspBtn" data-edit-act="place" title="Click the map to set coordinates">Set position on map</button>' : '') +
      (!isNew ? ' <button class="btn danger" data-edit-act="delete" style="float:right">Delete</button>' : '') +
      '</div>' +
      '<div class="inspSection"><div class="hint" style="color:var(--fg-dim); font-size:11.5px">' +
      'Edits re-run validation and recompute analytics. Cmd/Ctrl+Z undoes the last ' + undoStack.length + '/' + UNDO_MAX + ' change' + (undoStack.length === 1 ? '' : 's') + '.</div></div>';
    return html;
  }

  /* ---- open/save/cancel ---- */

  function openEditor(type, id, isNew) {
    editing = { type: type, id: id, isNew: !!isNew };
    var sc = ctx.state.scenario;
    var entity = findEntity(sc, type, id);
    if (!entity) { editing = null; return; }
    document.getElementById('inspectorBody').innerHTML = formHtml(type, entity, sc, isNew);
    wirePhaseAll();
    document.body.classList.remove('no-selection');
  }

  function wirePhaseAll() {
    document.querySelectorAll('[data-phases]').forEach(function (box) {
      var all = box.querySelector('[data-phase-all]');
      all.addEventListener('change', function () {
        box.querySelectorAll('[data-phase-id]').forEach(function (cb) { cb.disabled = all.checked; });
      });
    });
  }

  function findEntity(sc, type, id) {
    var list = type === 'node' ? sc.nodes : sc.links;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function saveEditor() {
    if (!editing) return;
    var e = editing;
    var fields = e.type === 'node' ? nodeFields(ctx.state.scenario) : linkFields(ctx.state.scenario);
    applyEdit((e.isNew ? 'add ' : 'edit ') + e.type + ' ' + e.id, function (raw) {
      var entity = findEntity(raw, e.type, e.id);
      if (!entity) return;
      fields.forEach(function (f) {
        var v = readField(f);
        if (v !== undefined) setPath(entity, f.k, v);
      });
    }, e.isNew);
    editing = null;
    ctx.select({ type: e.type, id: e.id });
  }

  function cancelEditor() {
    if (editing && editing.isNew) {
      // discard the just-created entity (its snapshot predates creation)
      undo();
      ctx.select(null);
    } else {
      var e = editing;
      editing = null;
      ctx.select(e ? { type: e.type, id: e.id } : null);
    }
  }

  /* ---- add / delete ---- */

  function addNode() {
    var sc = ctx.state.scenario;
    var id = nextId('node', sc.nodes);
    applyEdit('add node ' + id, function (raw) {
      raw.nodes.push({
        id: id, name: 'New node', node_type: 'system', side: 'Friendly',
        domain: 'other', mission: '', mission_importance: 3, echelon_importance: 3,
        phase_ids: 'all', status: 'Active', geo: {}, symbol: {}, tags: []
      });
    });
    openEditor('node', id, true);
  }

  function addLink(sourceId) {
    var sc = ctx.state.scenario;
    if (sc.nodes.length < 2) { app.toast('Need at least two nodes to link.'); return; }
    var id = nextId('link', sc.links);
    var src = sourceId || sc.nodes[0].id;
    var tgt = sc.nodes.filter(function (n) { return n.id !== src; })[0].id;
    applyEdit('add link ' + id, function (raw) {
      raw.links.push({
        id: id, source: src, target: tgt, relationship_type: 'depends_on',
        direction: 'directed', communication_method: 'Other', resilience: 3,
        dependency_strength: 3, failure_impact: 3, provenance: 'assessed',
        phase_ids: 'all', status: 'Active', tags: []
      });
    });
    openEditor('link', id, true);
  }

  function deleteEntity() {
    if (!editing) return;
    var e = editing;
    if (!window.confirm('Delete this ' + e.type + '? Links and references to it are cleaned up.')) return;
    applyEdit('delete ' + e.type + ' ' + e.id, function (raw) {
      if (e.type === 'node') {
        raw.nodes = raw.nodes.filter(function (n) { return n.id !== e.id; });
        raw.links = raw.links.filter(function (l) { return l.source !== e.id && l.target !== e.id; });
        raw.nodes.forEach(function (n) { if (n.parent_id === e.id) n.parent_id = ''; });
        raw.vulnerabilities.forEach(function (v) {
          v.affected_node_ids = (v.affected_node_ids || []).filter(function (r) { return r !== e.id; });
        });
        raw.activities.forEach(function (a) {
          if (a.source_node_id === e.id) a.source_node_id = '';
          if (a.target_node_id === e.id) a.target_node_id = '';
        });
        if (raw.layout && raw.layout.graph_positions) delete raw.layout.graph_positions[e.id];
      } else {
        raw.links = raw.links.filter(function (l) { return l.id !== e.id; });
        raw.vulnerabilities.forEach(function (v) {
          v.affected_link_ids = (v.affected_link_ids || []).filter(function (r) { return r !== e.id; });
        });
      }
    });
    editing = null;
    ctx.select(null);
  }

  /* ---- place on map ---- */

  function beginPlace() {
    if (!editing || editing.type !== 'node') return;
    placing = editing.id;
    ctx.setView('map');
    app.toast('Click the map to place the node. Esc cancels.');
  }

  /* Returns true when the click was consumed as a placement. */
  function handleMapClick(lat, lon) {
    if (!placing) return false;
    var id = placing;
    placing = null;
    applyEdit('place node ' + id, function (raw) {
      var n = null;
      raw.nodes.forEach(function (x) { if (x.id === id) n = x; });
      if (!n) return;
      n.geo = n.geo || {};
      n.geo.lat = Math.round(lat * 10000) / 10000;
      n.geo.lon = Math.round(lon * 10000) / 10000;
      n.geo.non_geographic = false;
    });
    openEditor('node', id, false);
    return true;
  }

  function wire() {
    document.getElementById('inspectorBody').addEventListener('click', function (ev) {
      var el = ev.target;
      while (el && el.getAttribute) {
        var act = el.getAttribute('data-edit-act');
        if (act === 'save') { saveEditor(); return; }
        if (act === 'cancel') { cancelEditor(); return; }
        if (act === 'delete') { deleteEntity(); return; }
        if (act === 'place') { beginPlace(); return; }
        if (act === 'edit-node') { openEditor('node', el.getAttribute('data-edit-id')); return; }
        if (act === 'edit-link') { openEditor('link', el.getAttribute('data-edit-id')); return; }
        if (act === 'add-link-from') { addLink(el.getAttribute('data-edit-id')); return; }
        el = el.parentNode;
      }
    });
  }

  OSP.editor = {
    init: function (context, appHooks) {
      ctx = context;
      app = appHooks;
      wire();
    },
    isEditing: function () { return !!editing; },
    isPlacing: function () { return !!placing; },
    cancelPlacing: function () { placing = null; },
    openEditor: openEditor,
    addNode: addNode,
    addLink: addLink,
    handleMapClick: handleMapClick,
    undo: undo,
    undoDepth: function () { return undoStack.length; }
  };
})();
