/* OSP export — briefable artifacts. PNG is a full redraw from the data model (never a pixel
   copy of the live canvas), stamped with the classification banner and a title block.
   Attaches to OSP.exporter. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var ctx = null;
  var SCALE = 2;
  var HEADER_H = 34;
  var FOOTER_H = 30;

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
  }

  function bannerText() {
    var c = ctx.state.scenario.meta.classification;
    var t = c.marking || 'UNCLASSIFIED';
    if (c.banner_caveat) t += ' // ' + c.banner_caveat;
    if (c.prototype) t += ' // PROTOTYPE';
    return t;
  }

  function stampFrame(c2d, w, h) {
    var st = ctx.state;
    // header banner
    c2d.fillStyle = cssVar('--banner-bg') || '#1f7a33';
    c2d.fillRect(0, 0, w, HEADER_H * SCALE);
    c2d.fillStyle = '#ffffff';
    c2d.font = '700 ' + (13 * SCALE) + 'px ' + (cssVar('--mono') || 'monospace');
    c2d.textAlign = 'center';
    c2d.textBaseline = 'middle';
    c2d.fillText(bannerText(), w / 2, (HEADER_H * SCALE) / 2);
    // footer
    c2d.fillStyle = cssVar('--bg1');
    c2d.fillRect(0, h - FOOTER_H * SCALE, w, FOOTER_H * SCALE);
    c2d.strokeStyle = cssVar('--line');
    c2d.lineWidth = SCALE;
    c2d.beginPath();
    c2d.moveTo(0, h - FOOTER_H * SCALE);
    c2d.lineTo(w, h - FOOTER_H * SCALE);
    c2d.stroke();
    var phase = st.graph.phase ? st.graph.phase.label : '';
    c2d.fillStyle = cssVar('--fg');
    c2d.font = '600 ' + (11 * SCALE) + 'px ' + cssVar('--sans');
    c2d.textAlign = 'left';
    c2d.fillText(st.scenario.meta.name + '  ·  ' + phase + '  ·  H+' + Math.round(st.t) +
      '  ·  ' + st.view.toUpperCase() + ' view', 12 * SCALE, h - (FOOTER_H * SCALE) / 2);
    c2d.fillStyle = cssVar('--fg-dim');
    c2d.textAlign = 'right';
    c2d.fillText('OSP · structural estimate, not a simulation · exported ' +
      new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z', w - 12 * SCALE, h - (FOOTER_H * SCALE) / 2);
    c2d.textBaseline = 'alphabetic';
    c2d.textAlign = 'left';
  }

  function exportPng() {
    var st = ctx.state;
    var area = document.getElementById('canvasArea');
    var w = Math.max(960, area.clientWidth) * SCALE;
    var contentH = Math.max(600, area.clientHeight) * SCALE;
    var h = contentH + (HEADER_H + FOOTER_H) * SCALE;
    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var c2d = canvas.getContext('2d');
    c2d.fillStyle = cssVar('--bg0');
    c2d.fillRect(0, 0, w, h);

    // content area, redrawn from the model
    c2d.save();
    c2d.translate(0, HEADER_H * SCALE);
    if (st.view === 'graph') {
      OSP.renderGraph.exportDraw(c2d, w, contentH);
    } else if (st.view === 'stack') {
      OSP.renderStack.exportDraw(c2d, w, contentH);
    } else {
      OSP.renderMap.exportDraw(c2d, w, contentH);
    }
    c2d.restore();
    stampFrame(c2d, w, h);

    var name = OSP.io.safeFilename(st.scenario.meta.name + '-' + st.view + '-h' + Math.round(st.t)) + '.png';
    canvas.toBlob(function (blob) {
      if (blob) OSP.io.downloadBlob(name, 'image/png', blob);
    }, 'image/png');
    return name;
  }

  function criticalitySnapshot() {
    var st = ctx.state;
    return st.metricsInfo.ranked.map(function (id) {
      var n = st.graph.nodesById[id];
      if (!n || !n.metrics) return null;
      return {
        node_id: id,
        score: n.metrics.criticality_score,
        level: n.metrics.criticality_level,
        cascade: n.metrics.cascade_blast_radius,
        components: {
          mission: n.metrics.components.mission.contribution,
          echelon: n.metrics.components.echelon.contribution,
          degree: n.metrics.components.degree.contribution,
          betweenness: n.metrics.components.betweenness.contribution,
          failure: n.metrics.components.failure.contribution,
          shared: n.metrics.components.shared.contribution
        }
      };
    }).filter(function (x) { return !!x; });
  }

  function exportJson(withSnapshot) {
    var st = ctx.state;
    var opts = {
      includeLayout: true,
      appVersion: OSP.APP_VERSION || '1.0',
      exportedAt: new Date().toISOString()
    };
    if (withSnapshot) opts.criticalitySnapshot = criticalitySnapshot();
    var json = OSP.io.scenarioToJson(st.scenario, opts);
    var name = OSP.io.safeFilename(st.scenario.meta.name) + (withSnapshot ? '-snapshot' : '') + '.json';
    OSP.io.downloadBlob(name, 'application/json', json);
    return name;
  }

  function exportCsv() {
    var st = ctx.state;
    var tables = OSP.io.exportCsvTables(st.scenario);
    var base = OSP.io.safeFilename(st.scenario.meta.name);
    var names = Object.keys(tables);
    // stagger downloads so the browser accepts all three
    names.forEach(function (fname, i) {
      setTimeout(function () {
        OSP.io.downloadBlob(base + '-' + fname, 'text/csv', tables[fname]);
      }, i * 350);
    });
    return names.length + ' CSV files';
  }

  function exportFindings() {
    var st = ctx.state;
    var md = OSP.renderRisk.findingsSummaryMarkdown();
    var name = OSP.io.safeFilename(st.scenario.meta.name + '-findings-h' + Math.round(st.t)) + '.md';
    OSP.io.downloadBlob(name, 'text/markdown', md);
    return name;
  }

  OSP.exporter = {
    init: function (context) { ctx = context; },
    exportPng: exportPng,
    exportJson: exportJson,
    exportCsv: exportCsv,
    exportFindings: exportFindings,
    exportCurrentView: function () {
      if (ctx.state.view === 'risk') return exportFindings();
      return exportPng();
    }
  };
})();
