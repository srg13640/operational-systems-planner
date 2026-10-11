/* OSP export — briefable artifacts. PNG is a full redraw from the data model (never a pixel
   copy of the live canvas), stamped with the classification banner and a title block.
   Attaches to OSP.exporter. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var ctx = null;
  var SCALE = 2;
  var HEADER_H = 34;
  var FOOTER_H = 46;

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
  }

  /* Same high-water-mark banner the app shows: the export must never be marked lower than
     the content it carries. */
  function bannerText() {
    if (OSP.bannerText) return OSP.bannerText();
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
    var def = OSP.dodaf.viewDef(st.view);
    var title = def.code + ' ' + def.title.replace(/ \(fit-for-purpose\)$/, '');
    var caption = st.archView ? '  ·  ' + OSP.dodaf.caption(st.archView) : '';
    var line1 = h - FOOTER_H * SCALE + 15 * SCALE;
    var line2 = h - 13 * SCALE;
    c2d.fillStyle = cssVar('--fg');
    c2d.font = '600 ' + (11 * SCALE) + 'px ' + cssVar('--sans');
    c2d.textAlign = 'left';
    c2d.fillText(title + '  ·  ' + st.scenario.meta.name + '  ·  ' + phase + '  ·  H+' + Math.round(st.t) + caption, 12 * SCALE, line1);
    c2d.fillStyle = cssVar('--fg-dim');
    c2d.textAlign = 'right';
    var isArch = OSP.dodaf.isArchitectureView(st.view);
    c2d.fillText('OSP · ' + (isArch ? 'derived from one architecture repository' : 'structural estimate, not a simulation') +
      ' · exported ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z', w - 12 * SCALE, line1);
    // legend strip: the reading rules for this view, so the picture survives on its own
    c2d.textAlign = 'left';
    c2d.font = '500 ' + (10 * SCALE) + 'px ' + cssVar('--sans');
    c2d.fillStyle = cssVar('--fg-mute');
    c2d.fillText(legendText(), 12 * SCALE, line2);
    c2d.textBaseline = 'alphabetic';
  }

  function legendText() {
    var st = ctx.state;
    var surf = OSP.dodaf.surfaceOf(st.view);
    var parts = [];
    if (surf === 'graph') {
      if (OSP.dodaf.isArchitectureView(st.view)) {
        parts.push('Rounded box: performer (operational node)', 'Rectangle: system');
        if (st.view === 'ov4') parts.push('Solid tree: task organization from parent', 'Dotted: command / control / support relationship');
        else parts.push('Solid arrow: recorded exchange', 'Dashed arrow: derived through systems (inferred)');
        parts.push('Blue frame: friendly', 'Red frame: enemy');
        if (st.archLens) parts.push('Fill / size: structural criticality');
      } else {
        parts.push('Circle: entity, colored by ' + (st.colorBy || 'criticality'), 'Size: criticality score', 'Line weight: failure impact');
      }
    } else if (surf === 'map') {
      parts.push('Symbols: units and systems at their locations', 'Lines: recorded relationships', 'Shaded areas: deep / close / rear zones');
    } else if (surf === 'stack') {
      parts.push('Tiers: operating domains from surface to space', 'Ticks: criticality');
    }
    var dimmed = 'Dimmed: outside the selected phase';
    parts.push(dimmed);
    return parts.join('     ');
  }

  /* Content size: the live canvas area, or a 16:9 slide frame (1920x1080 content) when the
     brief preset is asked for — that is what lands in a PowerPoint. */
  function contentSize(preset) {
    var area = document.getElementById('canvasArea');
    if (preset === 'slide') return { w: 1920, h: 1080 - HEADER_H - FOOTER_H };
    return { w: Math.max(960, area.clientWidth), h: Math.max(600, area.clientHeight) };
  }

  /* Paint one frame; resolves when the content surface has finished drawing (the graph
     surface rasterizes its SVG asynchronously). */
  function paint(canvas, w, contentH, h, drawOpts) {
    var st = ctx.state;
    var c2d = canvas.getContext('2d');
    c2d.fillStyle = cssVar('--bg0');
    c2d.fillRect(0, 0, w, h);
    var surf = OSP.dodaf.surfaceOf(st.view);
    c2d.save();
    c2d.translate(0, HEADER_H * SCALE);
    var drawn;
    if (surf === 'graph') {
      drawn = OSP.renderGraph.exportDraw(c2d, w, contentH);
    } else if (surf === 'stack') {
      drawn = OSP.renderStack.exportDraw(c2d, w, contentH);
    } else {
      drawn = OSP.renderMap.exportDraw(c2d, w, contentH, drawOpts);
    }
    return Promise.resolve(drawn).then(function () {
      c2d.restore();
      stampFrame(c2d, w, h);
    });
  }

  function toBlobPromise(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (blob) { blob ? resolve(blob) : reject(new Error('empty image')); }, 'image/png');
      } catch (e) { reject(e); }
    });
  }

  /* Resolves to the file name (plus a caveat when the basemap had to be omitted). */
  function exportPng(opts) {
    opts = opts || {};
    var st = ctx.state;
    var size = contentSize(opts.preset);
    var w = size.w * SCALE;
    var contentH = size.h * SCALE;
    var h = contentH + (HEADER_H + FOOTER_H) * SCALE;
    function freshCanvas() {
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    var name = OSP.io.safeFilename(st.scenario.meta.name + '-' + OSP.dodaf.viewDef(st.view).code + '-h' + Math.round(st.t)) + '.png';

    var canvas = freshCanvas();
    return paint(canvas, w, contentH, h, {}).then(function () {
      return toBlobPromise(canvas).then(function (blob) {
        OSP.io.downloadBlob(name, 'image/png', blob);
        return name;
      }, function (e) {
        /* Over file:// the basemap tiles are cross-origin and taint the canvas, so toBlob throws
           a SecurityError. A tainted canvas stays tainted: redraw on a fresh one without tiles
           (graticule instead) and say so. */
        if (OSP.dodaf.surfaceOf(st.view) !== 'map') throw e;
        var clean = freshCanvas();
        return paint(clean, w, contentH, h, { noBasemap: true }).then(function () {
          return toBlobPromise(clean);
        }).then(function (blob) {
          OSP.io.downloadBlob(name, 'image/png', blob);
          return name + ' (basemap omitted: tiles cannot be exported over file://; open via http to include them)';
        });
      });
    });
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
      appVersion: OSP.APP_VERSION || '1.1',
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
    exportCurrentView: function (opts) {
      if (OSP.dodaf.surfaceOf(ctx.state.view) === 'risk') return exportFindings();
      return exportPng(opts);
    }
  };
})();
