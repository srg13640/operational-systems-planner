/* OSP inspector — click-persistent selection detail panel shared by all views.
   Explains criticality with a component breakdown and plain-English rationale.
   Attaches to OSP.inspector. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var ctx = null;
  var body = null;

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function chip(label, sel) {
    if (!sel) return '<span class="tag">' + escapeHtml(label) + '</span>';
    return '<span class="chip" data-sel-type="' + sel.type + '" data-sel-id="' + escapeHtml(sel.id) + '">' + escapeHtml(label) + '</span>';
  }

  function kvRow(k, v, mono) {
    if (v === undefined || v === null || v === '') return '';
    return '<dt>' + escapeHtml(k) + '</dt><dd' + (mono ? ' class="mono"' : '') + '>' + escapeHtml(v) + '</dd>';
  }

  function levelColor(level) {
    if (level === 'Mission Critical') return 'var(--crit)';
    if (level === 'High') return 'var(--warn)';
    if (level === 'Moderate') return 'var(--fg-mute)';
    return 'var(--fg-dim)';
  }

  function phaseMembership(entity) {
    var st = ctx.state;
    if (entity.phase_ids === 'all') return 'all phases';
    return entity.phase_ids.map(function (pid) {
      var p = null;
      st.scenario.timeline.phases.forEach(function (ph) { if (ph.id === pid) p = ph; });
      return p ? p.label : pid;
    }).join(', ');
  }

  function nodeHtml(n) {
    var st = ctx.state;
    var g = st.graph;
    var active = !!g.nodesById[n.id];
    var eff = active ? g.statusOf(n) : null;
    var m = active ? n.metrics : null;

    var html = '<div class="inspHeader"><h2>' + escapeHtml(n.name) + '</h2><div class="subRow">' +
      '<span class="tag">' + escapeHtml(n.node_type) + '</span>' +
      (n.echelon ? '<span class="tag">' + escapeHtml(n.echelon) + '</span>' : '') +
      '<span class="tag">' + escapeHtml(n.side) + '</span>' +
      (active
        ? '<span class="tag" style="color:' + (eff === 'Active' ? 'var(--ok)' : eff === 'Degraded' ? 'var(--warn)' : 'var(--crit)') + '">' + eff + ' at H+' + Math.round(st.t) + '</span>'
        : '<span class="tag">inactive this phase</span>') +
      '</div></div>';

    if (m) {
      html += '<div class="inspSection"><h3>Criticality — active phase</h3>' +
        '<div style="display:flex; align-items:center; gap:10px">' +
        '<span class="critBadge" style="background:' + levelColor(m.criticality_level) + '; color:#fff">' + Math.round(m.criticality_score) + '</span>' +
        '<div><b>' + m.criticality_level + '</b><div style="font-size:11px; color:var(--fg-dim)">cascade reaches ' + m.cascade_blast_radius + ' node' + (m.cascade_blast_radius === 1 ? '' : 's') + '</div></div>' +
        '</div><div style="margin-top:8px">';
      var order = ['mission', 'echelon', 'degree', 'betweenness', 'failure', 'shared'];
      var labels = { mission: 'Mission', echelon: 'Echelon', degree: 'Connectivity', betweenness: 'Betweenness', failure: 'Failure impact', shared: 'Shared load' };
      order.forEach(function (k) {
        var c = m.components[k];
        if (!c) return;
        html += '<div class="compRow"><span>' + labels[k] + '</span>' +
          '<span class="bar"><i style="width:' + Math.round(c.value * 100) + '%"></i></span>' +
          '<span class="val">' + c.contribution.toFixed(1) + '</span></div>';
      });
      html += '</div><div class="rationale">' + escapeHtml(m.rationale) + '</div></div>';
    } else if (!active) {
      html += '<div class="inspSection"><h3>Criticality</h3><div class="hint" style="color:var(--fg-dim); font-size:12px">' +
        'Not part of the fight in the current phase — no score computed. Scrub the timeline to a phase where it is active.</div></div>';
    }

    html += '<div class="inspSection"><h3>Overview</h3><dl class="kv">' +
      kvRow('Mission', n.mission) +
      kvRow('WFF', n.warfighting_function) +
      kvRow('Domain', n.domain) +
      kvRow('Owner', n.owner) +
      kvRow('Location', n.geo.location_name) +
      (OSP.geo.hasLatLon(n.geo) ? kvRow('Coordinates', OSP.geo.formatLatLon(n.geo.lat, n.geo.lon), true) : kvRow('Coordinates', n.geo.non_geographic ? 'non-geographic' : 'not placed')) +
      kvRow('Phases', phaseMembership(n)) +
      kvRow('Classification', n.classification, true) +
      kvRow('Importance', 'mission ' + n.mission_importance + '/5 · echelon ' + n.echelon_importance + '/5') +
      '</dl></div>';

    // Relations
    var full = st.fullGraph;
    var providers = [], dependents = [], peers = [];
    (full.adjacency[n.id] || []).forEach(function (e) {
      var other = full.nodesById[e.otherId];
      if (!other) return;
      var provs = full.providersOf[n.id] || [];
      var deps = full.dependentsOf[n.id] || [];
      if (provs.indexOf(e.otherId) >= 0) providers.push(other);
      else if (deps.indexOf(e.otherId) >= 0) dependents.push(other);
      else peers.push(other);
    });
    function chipList(arr) {
      var seen = {};
      return arr.filter(function (o) { if (seen[o.id]) return false; seen[o.id] = 1; return true; })
        .map(function (o) { return chip(o.name, { type: 'node', id: o.id }); }).join('') || '<span class="hint" style="color:var(--fg-dim)">none</span>';
    }
    var parent = n.parent_id && full.nodesById[n.parent_id];
    var kids = (full.children[n.id] || []).map(function (id) { return full.nodesById[id]; }).filter(Boolean);
    html += '<div class="inspSection"><h3>Relations</h3>' +
      '<div style="font-size:11px; color:var(--fg-dim); margin-bottom:2px">Depends on</div><div>' + chipList(providers) + '</div>' +
      '<div style="font-size:11px; color:var(--fg-dim); margin:6px 0 2px">Depended on by</div><div>' + chipList(dependents) + '</div>' +
      (peers.length ? '<div style="font-size:11px; color:var(--fg-dim); margin:6px 0 2px">Connected</div><div>' + chipList(peers) + '</div>' : '') +
      (parent ? '<div style="font-size:11px; color:var(--fg-dim); margin:6px 0 2px">Higher HQ</div><div>' + chip(parent.name, { type: 'node', id: parent.id }) + '</div>' : '') +
      (kids.length ? '<div style="font-size:11px; color:var(--fg-dim); margin:6px 0 2px">Subordinate</div><div>' + chipList(kids) + '</div>' : '') +
      '</div>';

    // Findings touching this node
    var touching = st.findings.filter(function (f) { return f.affected_node_ids.indexOf(n.id) >= 0; });
    if (touching.length) {
      html += '<div class="inspSection"><h3>Findings involving this node</h3>' + touching.map(function (f) {
        return '<div style="margin:3px 0">' + chip('[SEV ' + f.severity + '] ' + f.title, { type: 'finding', id: f.id }) + '</div>';
      }).join('') + '</div>';
    }

    if (n.vulnerability_notes || n.notes) {
      html += '<div class="inspSection"><h3>Notes</h3>' +
        (n.vulnerability_notes ? '<p style="font-size:12px; color:var(--warn)">' + escapeHtml(n.vulnerability_notes) + '</p>' : '') +
        (n.notes ? '<p style="font-size:12px; color:var(--fg-mute)">' + escapeHtml(n.notes) + '</p>' : '') + '</div>';
    }

    html += '<div class="inspSection">' +
      (OSP.geo.hasLatLon(n.geo) ? '<button class="inspBtn" data-act="show-map">Show on map</button>' : '') +
      '<button class="inspBtn" data-act="show-graph">Show in graph</button>' +
      '<button class="inspBtn" data-act="isolate">' + (st.isolate ? 'Exit isolate' : 'Isolate 2-hop (I)') + '</button>' +
      '<button class="inspBtn" data-edit-act="edit-node" data-edit-id="' + escapeHtml(n.id) + '">Edit</button>' +
      '<button class="inspBtn" data-edit-act="add-link-from" data-edit-id="' + escapeHtml(n.id) + '">+ Link from here</button>' +
      '</div>';
    return html;
  }

  function linkHtml(l) {
    var st = ctx.state;
    var full = st.fullGraph;
    var a = full.nodesById[l.source], b = full.nodesById[l.target];
    var activeNow = st.graph.links.some(function (x) { return x.id === l.id; });
    var eff = activeNow ? st.graph.statusOf(l) : null;
    return '<div class="inspHeader"><h2>' + escapeHtml((a ? a.name : l.source) + ' → ' + (b ? b.name : l.target)) + '</h2>' +
      '<div class="subRow"><span class="tag">' + escapeHtml(l.relationship_type) + '</span>' +
      '<span class="tag">' + escapeHtml(l.communication_method) + '</span>' +
      (activeNow ? '<span class="tag" style="color:' + (eff === 'Active' ? 'var(--ok)' : 'var(--warn)') + '">' + eff + '</span>'
                 : '<span class="tag">inactive this phase</span>') +
      '</div></div>' +
      '<div class="inspSection"><h3>Attributes</h3><dl class="kv">' +
      kvRow('Direction', l.direction) +
      kvRow('Resilience', l.resilience + '/5') +
      kvRow('Dependency', l.dependency_strength + '/5') +
      kvRow('Failure impact', l.failure_impact + '/5') +
      kvRow('Bandwidth', l.bandwidth) +
      kvRow('Latency', l.latency) +
      kvRow('Encryption', l.encryption || 'none recorded') +
      kvRow('Classification', l.classification, true) +
      kvRow('Phases', phaseMembership(l)) +
      kvRow('Provenance', l.provenance) +
      '</dl>' +
      (l.notes ? '<div class="rationale">' + escapeHtml(l.notes) + '</div>' : '') +
      '</div>' +
      '<div class="inspSection">' +
      '<div style="font-size:11px; color:var(--fg-dim); margin-bottom:2px">Endpoints</div>' +
      (a ? chip(a.name, { type: 'node', id: a.id }) : '') + (b ? chip(b.name, { type: 'node', id: b.id }) : '') +
      '</div>' +
      '<div class="inspSection">' +
      '<button class="inspBtn" data-edit-act="edit-link" data-edit-id="' + escapeHtml(l.id) + '">Edit</button>' +
      '</div>';
  }

  function findingHtml(f) {
    var html = '<div class="inspHeader"><h2>' + escapeHtml(f.title) + '</h2><div class="subRow">' +
      '<span class="tag ' + f.source + '">' + (f.source === 'auto' ? 'AUTO-DETECTED' : 'ANALYST-ASSERTED') + '</span>' +
      '<span class="tag sev">SEV ' + f.severity + '</span>' +
      '<span class="tag">' + escapeHtml(f.type) + '</span>' +
      '</div></div>' +
      '<div class="inspSection"><h3>Evidence</h3><p style="font-size:12.5px; color:var(--fg-mute)">' + escapeHtml(f.evidence || '—') + '</p></div>' +
      '<div class="inspSection"><h3>So what</h3><p style="font-size:12.5px">' + escapeHtml(f.implication || '—') + '</p></div>' +
      '<div class="inspSection"><h3>Mitigation</h3><p style="font-size:12.5px; color:var(--fg-mute)">' + escapeHtml(f.mitigation || '—') + '</p></div>';
    html += '<div class="inspSection"><h3>Affected</h3>' + f.affected_node_ids.map(function (id) {
      var n = ctx.state.fullGraph.nodesById[id];
      return chip(n ? n.name : id, { type: 'node', id: id });
    }).join('') + '</div>';
    if (f.source === 'auto') {
      html += '<div class="inspSection"><div class="hint" style="color:var(--fg-dim); font-size:11.5px">' +
        'Rule-based detection — verify before briefing. Thresholds are listed in the help card and configurable per scenario.</div></div>';
    }
    html += '<div class="inspSection">' +
      '<button class="inspBtn" data-act="show-graph">Highlight in graph</button>' +
      '<button class="inspBtn" data-act="show-map">Highlight on map</button>' +
      '</div>';
    return html;
  }

  function activityHtml(act) {
    var st = ctx.state;
    var full = st.fullGraph;
    var src = act.source_node_id && full.nodesById[act.source_node_id];
    var tgt = act.target_node_id && full.nodesById[act.target_node_id];
    return '<div class="inspHeader"><h2>' + escapeHtml(act.name) + '</h2><div class="subRow">' +
      '<span class="tag">activity</span><span class="tag">' + escapeHtml(act.contact) + '</span>' +
      '<span class="tag">H+' + act.from_hours + ' – H+' + act.to_hours + '</span></div></div>' +
      '<div class="inspSection"><h3>Overview</h3><dl class="kv">' +
      kvRow('Echelon', act.echelon) +
      (act.position ? kvRow('Effect location', OSP.geo.formatLatLon(act.position.lat, act.position.lon), true) : '') +
      '</dl>' + (act.note ? '<div class="rationale">' + escapeHtml(act.note) + '</div>' : '') + '</div>' +
      ((src || tgt) ? '<div class="inspSection"><h3>Chain</h3>' +
        (src ? '<div style="font-size:11px; color:var(--fg-dim)">Source</div>' + chip(src.name, { type: 'node', id: src.id }) : '') +
        (tgt ? '<div style="font-size:11px; color:var(--fg-dim); margin-top:6px">Target</div>' + chip(tgt.name, { type: 'node', id: tgt.id }) : '') +
        '</div>' : '');
  }

  function render() {
    if (!body) return;
    // the editor owns the panel while a form is open — do not repaint over it
    if (OSP.editor && OSP.editor.isEditing()) return;
    var st = ctx.state;
    var s = st.selection;
    if (!s) {
      body.innerHTML = '<div class="empty">Select a node, link, or finding to inspect it. Click empty space or press Esc to deselect.</div>';
      return;
    }
    if (s.type === 'node') {
      var n = st.fullGraph.nodesById[s.id];
      body.innerHTML = n ? nodeHtml(n) : '<div class="empty">Node not found.</div>';
    } else if (s.type === 'link') {
      var l = null;
      st.fullGraph.links.forEach(function (x) { if (x.id === s.id) l = x; });
      body.innerHTML = l ? linkHtml(l) : '<div class="empty">Link not found.</div>';
    } else if (s.type === 'finding') {
      var f = null;
      st.findings.forEach(function (x) { if (x.id === s.id) f = x; });
      body.innerHTML = f ? findingHtml(f) : '<div class="empty">Finding no longer present at this hour — it may be phase-dependent. Scrub the timeline.</div>';
    } else if (s.type === 'activity') {
      var act = null;
      st.scenario.activities.forEach(function (x) { if (x.id === s.id) act = x; });
      body.innerHTML = act ? activityHtml(act) : '<div class="empty">Activity not found.</div>';
    }
  }

  function wire() {
    body.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== body) {
        if (el.getAttribute) {
          var selType = el.getAttribute('data-sel-type');
          if (selType) { ctx.select({ type: selType, id: el.getAttribute('data-sel-id') }); return; }
          var act = el.getAttribute('data-act');
          if (act === 'show-map') { ctx.setView('map'); return; }
          if (act === 'show-graph') { ctx.setView('graph'); return; }
          if (act === 'isolate') { ctx.toggleIsolate(); return; }
        }
        el = el.parentNode;
      }
    });
  }

  OSP.inspector = {
    init: function (context) {
      ctx = context;
      body = document.getElementById('inspectorBody');
      wire();
    },
    render: render
  };
})();
