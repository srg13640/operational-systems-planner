/* OSP risk board — ranked criticality, finding cards, and the BLUF block.
   DOM renderer; findings marked "emergent" when they do not exist at H+0 but exist now
   (the phase-aware payoff). Attaches to OSP.renderRisk. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var ctx = null;
  var board = null;
  var baselineIds = null;   // finding ids at H+0, cached per scenarioRev
  var baselineRev = -1;

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function levelClass(level) {
    if (level === 'Mission Critical') return 'level-mc';
    if (level === 'High') return 'level-high';
    if (level === 'Moderate') return 'level-mod';
    return 'level-low';
  }

  function ensureBaseline() {
    var st = ctx.state;
    if (baselineRev === st.scenarioRev && baselineIds) return;
    baselineRev = st.scenarioRev;
    baselineIds = {};
    var g0 = OSP.model.buildGraph(st.scenario, 0);
    OSP.metrics.computeMetrics(g0, st.scenario.criticality_model);
    OSP.findings.detectFindings(g0, st.scenario).forEach(function (f) { baselineIds[f.id] = 1; });
    // restore live metrics (computeMetrics annotates shared node objects)
    OSP.metrics.computeMetrics(st.graph, st.scenario.criticality_model);
  }

  function isEmergent(f) {
    if (f.source === 'analyst') return false;
    return !baselineIds[f.id];
  }

  function nodeName(id) {
    var n = ctx.state.fullGraph.nodesById[id];
    return n ? n.name : id;
  }

  function visibleFindings() {
    var st = ctx.state;
    return st.findings.filter(function (f) {
      if (f.severity < st.riskFilters.minSeverity) return false;
      if (f.source === 'auto' && !st.riskFilters.showAuto) return false;
      if (f.source === 'analyst' && !st.riskFilters.showAnalyst) return false;
      return true;
    });
  }

  function blufHtml() {
    var st = ctx.state;
    ensureBaseline();
    var g = st.graph;
    var phase = g.phase ? g.phase.label : '—';
    var parts = [];
    parts.push('At <b>H+' + Math.round(st.t) + '</b> (' + escapeHtml(phase) + ') the effective system has <b>' +
      g.nodes.length + ' nodes</b> and <b>' + g.links.length + ' active links</b>.');
    var topId = st.metricsInfo.ranked[0];
    var top = topId && g.nodesById[topId];
    if (top && top.metrics) {
      parts.push('<b>' + escapeHtml(top.name) + '</b> is the most critical node (score ' +
        Math.round(top.metrics.criticality_score) + ', ' + top.metrics.criticality_level +
        '); its loss would affect ' + top.metrics.cascade_blast_radius + ' downstream node' +
        (top.metrics.cascade_blast_radius === 1 ? '' : 's') + '.');
    }
    var vis = visibleFindings();
    var auto = vis.filter(function (f) { return f.source === 'auto'; });
    var emergent = auto.filter(isEmergent);
    var analyst = vis.filter(function (f) { return f.source === 'analyst'; });
    parts.push(auto.length + ' auto-detected finding' + (auto.length === 1 ? '' : 's') +
      (emergent.length ? ' (<b>' + emergent.length + ' emerged since H+0</b>)' : '') +
      ' and ' + analyst.length + ' analyst-asserted vulnerabilit' + (analyst.length === 1 ? 'y' : 'ies') + '.');
    if (emergent.length) {
      parts.push('Most severe new risk: <b>' + escapeHtml(emergent[0].title) + '</b>');
    }
    return '<div id="bluf"><h2>BLUF — ' + escapeHtml(st.scenario.meta.name) + '</h2><p>' + parts.join(' ') + '</p>' +
      '<div class="caveat">Structural estimate from topology and analyst-entered importance values. ' +
      'Rule-based findings require analyst review; this is not a simulation.' +
      (st.metricsInfo.betweennessSkipped ? ' Betweenness centrality omitted (node count over limit).' : '') + '</div></div>';
  }

  function findingCardHtml(f) {
    var st = ctx.state;
    var sel = st.selection && st.selection.type === 'finding' && st.selection.id === f.id;
    var chips = f.affected_node_ids.slice(0, 6).map(function (id) {
      return '<span class="chip" data-chip-node="' + escapeHtml(id) + '">' + escapeHtml(nodeName(id)) + '</span>';
    }).join('');
    var more = f.affected_node_ids.length > 6 ? '<span class="chip">+' + (f.affected_node_ids.length - 6) + '</span>' : '';
    return '<div class="findingCard sev' + f.severity + (sel ? ' selected' : '') + '" data-finding="' + escapeHtml(f.id) + '">' +
      '<div class="fMeta">' +
        '<span class="tag ' + f.source + '">' + (f.source === 'auto' ? 'AUTO' : 'ANALYST') + '</span>' +
        '<span class="tag sev">SEV ' + f.severity + '</span>' +
        (isEmergent(f) ? '<span class="tag emergent">EMERGED AT H+' + Math.round(st.t) + '</span>' : '') +
      '</div>' +
      '<h4>' + escapeHtml(f.title) + '</h4>' +
      '<dl class="fBody">' +
        '<dt>Evidence</dt><dd>' + escapeHtml(f.evidence || '—') + '</dd>' +
        '<dt>So what</dt><dd class="soWhat">' + escapeHtml(f.implication || '—') + '</dd>' +
        '<dt>Mitigation</dt><dd>' + escapeHtml(f.mitigation || '—') + '</dd>' +
      '</dl>' +
      '<div>' + chips + more + '</div>' +
      '</div>';
  }

  function scoreBarHtml(m) {
    var comps = m.components;
    var order = ['mission', 'echelon', 'degree', 'betweenness', 'failure', 'shared'];
    var colors = { mission: 'var(--info)', echelon: 'var(--rear)', degree: 'var(--close)', betweenness: 'var(--ramp4)', failure: 'var(--crit)', shared: 'var(--warn)' };
    var html = '<div class="scoreBar" title="' + order.map(function (k) {
      return k + ' ' + (comps[k] ? comps[k].contribution.toFixed(1) : '0');
    }).join(' · ') + '">';
    order.forEach(function (k) {
      var c = comps[k];
      if (!c || c.contribution <= 0) return;
      html += '<i style="width:' + c.contribution + '%; background:' + colors[k] + '"></i>';
    });
    return html + '</div>';
  }

  function tableHtml() {
    var st = ctx.state;
    var g = st.graph;
    var rows = '';
    st.metricsInfo.ranked.slice(0, 25).forEach(function (id, i) {
      var n = g.nodesById[id];
      if (!n || !n.metrics) return;
      var sel = st.selection && st.selection.type === 'node' && st.selection.id === id;
      rows += '<tr class="row' + (sel ? ' selected' : '') + '" data-node="' + escapeHtml(id) + '">' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td>' + escapeHtml(n.name) + '</td>' +
        '<td class="score">' + Math.round(n.metrics.criticality_score) + '</td>' +
        '<td>' + scoreBarHtml(n.metrics) + '</td>' +
        '<td><span class="levelChip ' + levelClass(n.metrics.criticality_level) + '">' + n.metrics.criticality_level + '</span></td>' +
        '</tr>';
    });
    return '<table id="critTable"><thead><tr>' +
      '<th></th><th>Node</th><th>Score</th><th>Components</th><th>Level</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function render() {
    if (!board || !ctx.state.scenario) return;
    var vis = visibleFindings();
    var html = '<div class="riskCols">' + blufHtml() +
      '<div class="riskPanel"><h2>Findings — ' + vis.length + ' at H+' + Math.round(ctx.state.t) + '</h2>' +
      (vis.length ? vis.map(findingCardHtml).join('') : '<div class="hint" style="color:var(--fg-dim)">No findings pass the current filter at this hour.</div>') +
      '</div>' +
      '<div class="riskPanel"><h2>Criticality ranking (active phase)</h2>' + tableHtml() + '</div>' +
      '</div>';
    board.innerHTML = html;
  }

  function wire() {
    board.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== board) {
        if (el.getAttribute) {
          var chipNode = el.getAttribute('data-chip-node');
          if (chipNode) { ctx.select({ type: 'node', id: chipNode }); e.stopPropagation(); return; }
          var fid = el.getAttribute('data-finding');
          if (fid) { ctx.select({ type: 'finding', id: fid }); return; }
          var nid = el.getAttribute('data-node');
          if (nid) { ctx.select({ type: 'node', id: nid }); return; }
        }
        el = el.parentNode;
      }
    });
  }

  OSP.renderRisk = {
    init: function (context) {
      ctx = context;
      board = document.getElementById('riskBoard');
      wire();
    },
    render: render,
    invalidateBaseline: function () { baselineRev = -1; },
    findingsSummaryMarkdown: function () {
      var st = ctx.state;
      ensureBaseline();
      var g = st.graph;
      var lines = [];
      lines.push('# ' + st.scenario.meta.name + ' — findings summary');
      lines.push('');
      lines.push('- Classification: ' + st.scenario.meta.classification.marking +
        (st.scenario.meta.classification.banner_caveat ? ' // ' + st.scenario.meta.classification.banner_caveat : ''));
      lines.push('- Time: H+' + Math.round(st.t) + (g.phase ? ' (' + g.phase.label + ')' : ''));
      lines.push('- Effective system: ' + g.nodes.length + ' nodes, ' + g.links.length + ' links');
      lines.push('');
      lines.push('## Top critical nodes');
      lines.push('');
      lines.push('| # | Node | Score | Level | Cascade |');
      lines.push('|---|------|-------|-------|---------|');
      st.metricsInfo.ranked.slice(0, 10).forEach(function (id, i) {
        var n = g.nodesById[id];
        if (!n || !n.metrics) return;
        lines.push('| ' + (i + 1) + ' | ' + n.name + ' | ' + Math.round(n.metrics.criticality_score) +
          ' | ' + n.metrics.criticality_level + ' | ' + n.metrics.cascade_blast_radius + ' |');
      });
      lines.push('');
      lines.push('## Findings at H+' + Math.round(st.t));
      visibleFindings().forEach(function (f) {
        lines.push('');
        lines.push('### [' + (f.source === 'auto' ? 'AUTO' : 'ANALYST') + ' / SEV ' + f.severity + '] ' +
          f.title + (isEmergent(f) ? ' (emerged since H+0)' : ''));
        lines.push('');
        lines.push('- Evidence: ' + (f.evidence || '-'));
        lines.push('- So what: ' + (f.implication || '-'));
        lines.push('- Mitigation: ' + (f.mitigation || '-'));
        lines.push('- Affected: ' + f.affected_node_ids.map(nodeName).join(', '));
      });
      lines.push('');
      lines.push('---');
      lines.push('Structural estimate from topology and analyst-entered importance values; not a simulation. Generated by OSP.');
      return lines.join('\n');
    }
  };
})();
