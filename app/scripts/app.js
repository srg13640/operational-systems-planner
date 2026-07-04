/* OSP application shell — state store, view orchestration, timeline, keyboard,
   persistence, import/export wiring, boot. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};
  OSP.APP_VERSION = '1.0';

  var AUTOSAVE_KEY = 'osp-autosave-v1';
  var THEME_KEY = 'osp-theme';
  var SEEN_HELP_KEY = 'osp-seen-help';

  var state = {
    scenario: null,
    issues: [],
    scenarioRev: 0,
    t: 0,
    view: 'map',
    graphMode: 'network',
    colorBy: 'criticality',
    selection: null,
    isolate: false,
    briefMode: false,
    playing: false,
    playSpeed: 2, // hours per second
    fullGraph: null,
    graph: null,
    metricsInfo: { ranked: [], betweennessSkipped: false },
    findings: [],
    layers: { links: true, zones: true, activities: true, annotations: true, labels: true, chains: true, graphLabels: true },
    riskFilters: { showAuto: true, showAnalyst: true, minSeverity: 1 }
  };
  OSP.state = state;

  var saveTimer = null;
  var pendingImport = null;
  var playHandle = null;
  var lastFrame = 0;

  function $(id) { return document.getElementById(id); }

  /* ---------- context passed to render modules ---------- */

  var ctx = {
    state: state,
    select: select,
    setView: setView,
    toggleIsolate: toggleIsolate,
    hoverTip: hoverTip,
    hideTip: hideTip,
    onUserChange: markDirty,
    onViewportChange: function () { markDirty(); }
  };

  function hoverTip(html, x, y) {
    var tip = $('tooltip');
    tip.innerHTML = html;
    tip.style.display = 'block';
    var pad = 14;
    var vw = window.innerWidth, vh = window.innerHeight;
    var r = tip.getBoundingClientRect();
    tip.style.left = Math.min(x + pad, vw - r.width - 8) + 'px';
    tip.style.top = Math.min(y + pad, vh - r.height - 8) + 'px';
  }
  function hideTip() { $('tooltip').style.display = 'none'; }

  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  /* ---------- scenario lifecycle ---------- */

  /* Replace the scenario preserving the working view/time — the editor's path.
     Selection survives when it still resolves; renderers guard stale ids. */
  function replaceScenario(raw, opts) {
    var keepT = state.t, keepView = state.view, keepSel = state.selection;
    var res = OSP.model.normalizeScenario(raw);
    state.scenario = res.scenario;
    state.issues = res.issues;
    state.scenarioRev++;
    if (opts && opts.keepView) {
      state.t = Math.min(keepT, res.scenario.timeline.duration_hours);
      state.view = keepView;
      state.selection = keepSel;
    } else {
      state.selection = null;
      state.t = 0;
    }
    state.isolate = false;
    OSP.renderGraph.invalidateLayout();
    OSP.renderRisk.invalidateBaseline();
    buildTimelineUI();
    buildWeightSliders();
    recompute();
    renderAll();
    markDirty();
  }

  function loadScenario(raw, opts) {
    var res = OSP.model.normalizeScenario(raw);
    state.scenario = res.scenario;
    state.issues = res.issues;
    state.scenarioRev++;
    state.selection = null;
    state.isolate = false;
    state.t = OSP.model.clampNum(res.scenario.layout.t, 0, res.scenario.timeline.duration_hours, 0);
    if (res.scenario.layout.view === 'map' || res.scenario.layout.view === 'graph' || res.scenario.layout.view === 'risk') {
      state.view = res.scenario.layout.view;
    }
    OSP.renderGraph.invalidateLayout();
    OSP.renderRisk.invalidateBaseline();
    buildTimelineUI();
    buildWeightSliders();
    recompute();
    if (!opts || !opts.silent) renderAll();
  }

  function recompute() {
    var sc = state.scenario;
    state.fullGraph = OSP.model.buildGraph(sc, null);
    state.graph = OSP.model.buildGraph(sc, state.t);
    state.metricsInfo = OSP.metrics.computeMetrics(state.graph, sc.criticality_model);
    var auto = OSP.findings.detectFindings(state.graph, sc);
    state.findings = OSP.findings.mergeAnalystVulnerabilities(auto, sc, state.graph);
  }

  function renderAll() {
    var sc = state.scenario;
    document.body.setAttribute('data-view', state.view);
    document.body.classList.toggle('no-selection', !state.selection);

    // top chrome
    $('scenarioName').textContent = sc.meta.name;
    $('scenarioName').title = sc.meta.description || sc.meta.name;
    var cls = sc.meta.classification;
    var bannerText = cls.marking + (cls.banner_caveat ? ' // ' + cls.banner_caveat : '') + (cls.prototype ? ' // PROTOTYPE' : '');
    $('banner').textContent = bannerText;

    // view tabs
    var tabs = $('viewTabs').querySelectorAll('button');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === state.view);
    }

    // rail sections
    $('railMap').style.display = state.view === 'map' ? '' : 'none';
    $('railGraph').style.display = state.view === 'graph' ? '' : 'none';
    $('railStack').style.display = state.view === 'stack' ? '' : 'none';
    $('railRisk').style.display = state.view === 'risk' ? '' : 'none';
    var railMeta = {
      map: ['Operational map', 'Entities at real coordinates. Scrub time to change the fight.'],
      graph: ['System graph', 'Structure is stable across time; dimmed entities are out of the current phase.'],
      stack: ['Multi-domain stack', 'One system across every domain — vertical arcs are cross-domain dependencies.'],
      risk: ['Risk board', 'What matters now, what breaks, and why.']
    };
    $('railTitle').textContent = railMeta[state.view][0];
    $('railHint').textContent = railMeta[state.view][1];
    rebuildStackLayers();

    // per-view chrome
    $('betweennessCaveat').style.display = state.metricsInfo.betweennessSkipped ? 'block' : 'none';
    $('zoomCluster').style.display = state.view === 'risk' ? 'none' : 'flex';
    var pc = $('phaseCaption');
    var curPhase = state.graph.phase;
    if (state.view !== 'risk' && curPhase && curPhase.notes) {
      pc.innerHTML = '<b>' + curPhase.label.toUpperCase().replace(/</g, '&lt;') + '</b> — ' +
        String(curPhase.notes).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      pc.style.display = 'block';
    } else {
      pc.style.display = 'none';
    }
    updateCountsPill();
    updateUnplacedTray();
    updateGraphLegend();
    updateStatusBar();
    updateTimelineUI();

    // active view
    if (state.view === 'map') OSP.renderMap.render();
    else if (state.view === 'graph') OSP.renderGraph.render();
    else if (state.view === 'stack') OSP.renderStack.render();
    else OSP.renderRisk.render();
    OSP.inspector.render();
  }

  function updateCountsPill() {
    var g = state.graph;
    var full = state.fullGraph;
    var warnCount = state.issues.filter(function (x) { return x.level === 'warning'; }).length;
    var errCount = state.issues.filter(function (x) { return x.level === 'error'; }).length;
    var txt = g.nodes.length + '/' + full.nodes.length + ' nodes · ' + g.links.length + '/' + full.links.length + ' links';
    if (errCount || warnCount) txt += ' · ' + (errCount ? errCount + ' err ' : '') + (warnCount ? warnCount + ' warn' : '');
    $('countsPill').innerHTML = '<span id="pillCounts"></span><span id="mapCursor"></span>';
    $('pillCounts').textContent = txt;
  }

  function updateUnplacedTray() {
    var tray = $('unplacedTray');
    var un = OSP.renderMap.unplacedNodes();
    if (!un.length) {
      tray.innerHTML = '<div class="hint">All entities placed.</div>';
      return;
    }
    tray.innerHTML = un.map(function (n) {
      return '<div class="trayItem" data-node="' + n.id + '" title="' + (n.geo.non_geographic ? 'Non-geographic entity' : 'No coordinates recorded') + '">' +
        '<span class="swatch round" style="background: var(--fg-dim)"></span>' +
        n.name.replace(/&/g, '&amp;').replace(/</g, '&lt;') +
        (n.geo.non_geographic ? ' <span style="color:var(--fg-dim)">(orbital/virtual)</span>' : '') +
        '</div>';
    }).join('');
  }

  function updateGraphLegend() {
    var el = $('graphLegend');
    if (state.colorBy === 'criticality') {
      el.innerHTML =
        '<div class="legendRow"><span class="swatch" style="background:var(--ramp4)"></span> 90+ extreme</div>' +
        '<div class="legendRow"><span class="swatch" style="background:var(--ramp3)"></span> 75+ mission critical</div>' +
        '<div class="legendRow"><span class="swatch" style="background:var(--ramp2)"></span> 50+ high</div>' +
        '<div class="legendRow"><span class="swatch" style="background:var(--ramp1)"></span> 25+ moderate</div>' +
        '<div class="legendRow"><span class="swatch" style="background:var(--ramp0)"></span> low / inactive</div>';
    } else if (state.colorBy === 'status') {
      el.innerHTML =
        '<div class="legendRow"><span class="swatch" style="background:var(--ok)"></span> Active</div>' +
        '<div class="legendRow"><span class="swatch" style="background:var(--warn)"></span> Degraded</div>' +
        '<div class="legendRow"><span class="swatch" style="background:var(--crit)"></span> Offline</div>';
    } else {
      var doms = ['c2', 'strike', 'sustain', 'space', 'air', 'ems', 'cyber', 'land', 'maritime', 'data'];
      var colors = { c2: '#5b8dd6', strike: '#e4574f', sustain: '#61a56c', space: '#b03a9e', air: '#45d6b4', ems: '#e0a33c', cyber: '#9a6dd6', land: '#8a9aa8', maritime: '#2e9bd6', data: '#c9a13b' };
      el.innerHTML = doms.map(function (d) {
        return '<div class="legendRow"><span class="swatch" style="background:' + colors[d] + '"></span> ' + d + '</div>';
      }).join('');
    }
  }

  function selectionLabel() {
    var s = state.selection;
    if (!s) return 'no selection';
    if (s.type === 'node') {
      var n = state.fullGraph.nodesById[s.id];
      return n ? n.name : s.id;
    }
    if (s.type === 'finding') {
      for (var i = 0; i < state.findings.length; i++) {
        if (state.findings[i].id === s.id) return 'finding: ' + state.findings[i].title;
      }
    }
    return s.type + ': ' + s.id;
  }

  function updateStatusBar() {
    $('stScenario').textContent = state.scenario.meta.name;
    $('stPhase').textContent = state.graph.phase ? state.graph.phase.label.toUpperCase() : 'NO PHASE';
    $('stTime').textContent = 'H+' + Math.round(state.t);
    $('stView').textContent = state.view.toUpperCase() + (state.view === 'graph' ? '/' + state.graphMode.toUpperCase() : '');
    $('stCounts').textContent = state.findings.length + ' findings';
    $('stSelection').textContent = selectionLabel();
  }

  /* ---------- timeline ---------- */

  function buildTimelineUI() {
    var sc = state.scenario;
    var dur = sc.timeline.duration_hours;
    var scrub = $('scrub');
    scrub.max = dur;
    scrub.value = state.t;

    var chips = $('phaseChips');
    chips.innerHTML = '';
    sc.timeline.phases.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'phaseChip';
      b.textContent = p.label;
      b.title = p.label + ' — H+' + p.from_hours + ' to H+' + p.to_hours + (p.main_effort ? ' · main effort: ' + p.main_effort : '');
      b.style.flexGrow = String(Math.max(1, p.to_hours - p.from_hours));
      b.addEventListener('click', function () { setT(p.from_hours + 0.01); });
      b.setAttribute('data-phase', p.id);
      chips.appendChild(b);
    });

    var ticks = $('phaseTicks');
    ticks.innerHTML = '';
    sc.timeline.phases.forEach(function (p, i) {
      var seg = document.createElement('i');
      seg.style.width = ((p.to_hours - p.from_hours) / dur * 100) + '%';
      seg.style.opacity = i % 2 ? '0.45' : '0.7';
      ticks.appendChild(seg);
    });
  }

  function updateTimelineUI() {
    var h = Math.floor(state.t);
    var m = Math.round((state.t - h) * 60);
    var mm = m < 10 ? '0' + m : String(m);
    var hh = h < 10 ? '0' + h : String(h);
    $('timecode').innerHTML = 'H+' + hh + ':' + mm + '<span class="phase">' +
      (state.graph.phase ? state.graph.phase.label : '—') + '</span>';
    $('scrub').value = state.t;
    var chips = $('phaseChips').querySelectorAll('.phaseChip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('current', !!(state.graph.phase && chips[i].getAttribute('data-phase') === state.graph.phase.id));
    }
    $('btnPlay').textContent = state.playing ? '❚❚' : '▶';
    $('btnPlay').classList.toggle('active', state.playing);
  }

  function setT(t) {
    var dur = state.scenario.timeline.duration_hours;
    state.t = Math.max(0, Math.min(dur, t));
    state.scenario.layout.t = state.t;
    recompute();
    renderAll();
    markDirty();
  }

  function togglePlay() {
    state.playing = !state.playing;
    if (state.playing) {
      lastFrame = performance.now();
      playHandle = requestAnimationFrame(playTick);
      if (state.t >= state.scenario.timeline.duration_hours - 0.01) state.t = 0;
    } else if (playHandle) {
      cancelAnimationFrame(playHandle);
      playHandle = null;
      updateTimelineUI();
    }
  }

  function playTick(now) {
    if (!state.playing) return;
    var dt = (now - lastFrame) / 1000;
    lastFrame = now;
    var nt = state.t + dt * state.playSpeed;
    if (nt >= state.scenario.timeline.duration_hours) {
      nt = state.scenario.timeline.duration_hours;
      state.playing = false;
    }
    setT(nt);
    if (state.playing) playHandle = requestAnimationFrame(playTick);
  }

  /* ---------- selection / view ---------- */

  function select(sel) {
    state.selection = sel;
    if (!sel) state.isolate = false;
    renderAll();
  }

  function setView(v) {
    state.view = v;
    state.scenario.layout.view = v;
    renderAll();
    markDirty();
  }

  function toggleIsolate() {
    if (!state.selection || state.selection.type !== 'node') return;
    state.isolate = !state.isolate;
    if (state.view !== 'graph') state.view = 'graph';
    renderAll();
  }

  /* ---------- persistence ---------- */

  function markDirty() {
    $('saveDot').className = 'dirty';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 500);
  }

  function autosave() {
    try {
      var json = JSON.stringify(state.scenario);
      if (json.length > 4000000) {
        toast('Scenario too large for autosave — use Export JSON.');
        return;
      }
      localStorage.setItem(AUTOSAVE_KEY, json);
      $('saveDot').className = 'saved';
    } catch (e) {
      $('saveDot').className = '';
    }
  }

  function readSeed(which) {
    var el = $(which === 'baltic' ? 'seed-scenario-baltic' : 'seed-scenario');
    return JSON.parse(el.textContent);
  }

  function loadBuiltin(which, label) {
    if (!window.confirm('Replace the working session with the built-in ' + label + ' scenario?')) return;
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
    loadScenario(readSeed(which));
    closeModal('dataModal');
    requestAnimationFrame(function () {
      if (state.view === 'graph') OSP.renderGraph.fit();
      else if (state.view === 'map') OSP.renderMap.fit();
    });
    toast(label + ' loaded.');
  }

  /* Fingerprint of the embedded baselines, so a restored autosave can warn when
     the built-in scenarios changed underneath it (stale-session detection). */
  function seedFingerprint() {
    var s = $('seed-scenario').textContent + ($('seed-scenario-baltic') ? $('seed-scenario-baltic').textContent : '');
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return s.length + '-' + Math.abs(h).toString(36);
  }

  /* ---------- import flow ---------- */

  function stageImport(text) {
    var report = $('validationReport');
    var confirmRow = $('importConfirmRow');
    pendingImport = null;
    var raw = null;
    var summary = [];
    try {
      var trimmed = String(text || '').replace(/^\s+/, '');
      if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
        var res = OSP.io.importJson(text);
        raw = res.raw;
        summary.push('Format: ' + (res.format === 'svt-legacy' ? 'legacy Systems Viz dataset (adapted)' : 'OSP scenario'));
      } else {
        var csv = OSP.io.importCsv(text, state.scenario);
        raw = csv.raw;
        summary.push('Format: CSV → ' + csv.kind + ' table, ' + csv.count + ' rows merged by id');
      }
    } catch (e) {
      report.style.display = 'block';
      report.innerHTML = '<div class="err">Import failed: ' + String(e.message || e).replace(/</g, '&lt;') + '</div>';
      confirmRow.style.display = 'none';
      return;
    }
    var norm = OSP.model.normalizeScenario(raw);
    var errs = norm.issues.filter(function (x) { return x.level === 'error'; });
    var warns = norm.issues.filter(function (x) { return x.level === 'warning'; });
    summary.push(norm.scenario.nodes.length + ' nodes, ' + norm.scenario.links.length + ' links, ' +
      norm.scenario.vulnerabilities.length + ' vulnerabilities, ' + norm.scenario.activities.length + ' activities, ' +
      norm.scenario.timeline.phases.length + ' phases');
    var html = '<div class="okline">' + summary.join(' · ') + '</div>';
    if (errs.length) html += errs.map(function (x) { return '<div class="err">ERROR ' + x.where + ': ' + x.message + '</div>'; }).join('');
    if (warns.length) html += warns.map(function (x) { return '<div class="warn">warn ' + x.where + ': ' + x.message + '</div>'; }).join('');
    if (!errs.length && !warns.length) html += '<div class="okline">Validation clean — no issues.</div>';
    report.style.display = 'block';
    report.innerHTML = html;
    pendingImport = raw;
    confirmRow.style.display = 'flex';
  }

  /* ---------- wiring ---------- */

  function wireChrome() {
    // view tabs
    var tabs = $('viewTabs').querySelectorAll('button');
    for (var i = 0; i < tabs.length; i++) {
      (function (b) {
        b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
      })(tabs[i]);
    }

    // top actions
    $('btnAddNode').addEventListener('click', function () { OSP.editor.addNode(); });
    $('btnData').addEventListener('click', function () { openModal('dataModal'); });
    $('btnExport').addEventListener('click', function () {
      var name = OSP.exporter.exportCurrentView();
      toast('Exported ' + name);
    });
    $('btnBrief').addEventListener('click', toggleBrief);
    $('btnTheme').addEventListener('click', toggleTheme);
    $('btnHelp').addEventListener('click', function () { openModal('helpOverlay'); });

    // search
    var search = $('searchBox');
    search.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var q = search.value.trim().toLowerCase();
      if (!q) return;
      var best = null;
      state.fullGraph.nodes.forEach(function (n) {
        var name = n.name.toLowerCase();
        if (name === q) best = best || n;
      });
      if (!best) {
        state.fullGraph.nodes.forEach(function (n) {
          if (!best && n.name.toLowerCase().indexOf(q) >= 0) best = n;
        });
      }
      if (best) {
        select({ type: 'node', id: best.id });
        search.blur();
      } else {
        toast('No node matches "' + search.value + '"');
      }
    });

    // rail: graph mode + color-by
    wireSegmented('graphModeSeg', 'data-mode', function (v) {
      state.graphMode = v;
      OSP.renderGraph.invalidateLayout();
      renderAll();
      OSP.renderGraph.fit();
    });
    wireSegmented('colorBySeg', 'data-color', function (v) {
      state.colorBy = v;
      renderAll();
    });

    // layer checkboxes
    bindCheck('lyrLinks', 'links'); bindCheck('lyrZones', 'zones');
    bindCheck('lyrActivities', 'activities'); bindCheck('lyrAnnotations', 'annotations');
    bindCheck('lyrLabels', 'labels'); bindCheck('chkChains', 'chains');
    bindCheck('chkGraphLabels', 'graphLabels');

    // stack controls
    $('stackSep').addEventListener('input', function () {
      $('sepVal').textContent = this.value;
      OSP.renderStack.setSeparation(parseFloat(this.value));
    });
    $('chkStackLabels').addEventListener('change', function () { OSP.renderStack.setLabels(this.checked); });
    $('chkCrossDomain').addEventListener('change', function () { OSP.renderStack.setCrossEmphasis(this.checked); });
    $('chkOrbit').addEventListener('change', function () { OSP.renderStack.setOrbit(this.checked); });

    // risk filters
    $('chkShowAuto').addEventListener('change', function () { state.riskFilters.showAuto = this.checked; renderAll(); });
    $('chkShowAnalyst').addEventListener('change', function () { state.riskFilters.showAnalyst = this.checked; renderAll(); });
    $('minSeverity').addEventListener('input', function () {
      state.riskFilters.minSeverity = parseInt(this.value, 10);
      $('minSevVal').textContent = this.value;
      renderAll();
    });

    // unplaced tray clicks
    $('unplacedTray').addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== this) {
        if (el.getAttribute && el.getAttribute('data-node')) {
          select({ type: 'node', id: el.getAttribute('data-node') });
          return;
        }
        el = el.parentNode;
      }
    });

    // zoom cluster
    $('zoomIn').addEventListener('click', function () { activeRenderer().zoomIn(); });
    $('zoomOut').addEventListener('click', function () { activeRenderer().zoomOut(); });
    $('zoomFit').addEventListener('click', function () { activeRenderer().fit(); });

    // timeline
    $('scrub').addEventListener('input', function () { setT(parseFloat(this.value)); });
    $('btnPlay').addEventListener('click', togglePlay);
    $('btnStepBack').addEventListener('click', function () { setT(state.t - 1); });
    $('btnStepFwd').addEventListener('click', function () { setT(state.t + 1); });
    var speeds = $('speedBtns').querySelectorAll('button');
    for (var s = 0; s < speeds.length; s++) {
      (function (b) {
        b.addEventListener('click', function () {
          state.playSpeed = parseFloat(b.getAttribute('data-speed'));
          for (var j = 0; j < speeds.length; j++) speeds[j].classList.remove('active');
          b.classList.add('active');
        });
      })(speeds[s]);
    }

    // modals
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeModal(b.getAttribute('data-close')); });
    });
    document.querySelectorAll('.modalBack').forEach(function (m) {
      m.addEventListener('mousedown', function (e) { if (e.target === m) closeModal(m.id); });
    });

    // data modal
    $('importFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { stageImport(String(reader.result)); };
      reader.readAsText(f);
    });
    $('btnImportPaste').addEventListener('click', function () { stageImport($('importText').value); });
    $('btnImportApply').addEventListener('click', function () {
      if (!pendingImport) return;
      loadScenario(pendingImport);
      pendingImport = null;
      $('importConfirmRow').style.display = 'none';
      $('validationReport').style.display = 'none';
      $('importText').value = '';
      $('importFile').value = '';
      closeModal('dataModal');
      markDirty();
      toast('Import applied.');
    });
    $('btnImportCancel').addEventListener('click', function () {
      pendingImport = null;
      $('importConfirmRow').style.display = 'none';
      $('validationReport').style.display = 'none';
    });
    $('btnExportJson').addEventListener('click', function () { toast('Exported ' + OSP.exporter.exportJson(false)); });
    $('btnExportJsonSnapshot').addEventListener('click', function () { toast('Exported ' + OSP.exporter.exportJson(true)); });
    $('btnExportCsv').addEventListener('click', function () { toast('Exporting ' + OSP.exporter.exportCsv()); });
    $('btnExportFindings').addEventListener('click', function () { toast('Exported ' + OSP.exporter.exportFindings()); });
    $('btnLoadPacific').addEventListener('click', function () { loadBuiltin('pacific', 'PACIFIC SENTINEL'); });
    $('btnLoadBaltic').addEventListener('click', function () { loadBuiltin('baltic', 'BALTIC SENTINEL'); });

    // keyboard
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', function () { renderAll(); });
  }

  function wireSegmented(id, attr, fn) {
    var seg = $(id);
    var btns = seg.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        b.addEventListener('click', function () {
          for (var j = 0; j < btns.length; j++) btns[j].classList.remove('active');
          b.classList.add('active');
          fn(b.getAttribute(attr));
        });
      })(btns[i]);
    }
  }

  function bindCheck(id, layerKey) {
    $(id).addEventListener('change', function () {
      state.layers[layerKey] = this.checked;
      renderAll();
    });
  }

  function activeRenderer() {
    if (state.view === 'graph') return OSP.renderGraph;
    if (state.view === 'stack') return OSP.renderStack;
    return OSP.renderMap;
  }

  /* Stack rail: one visibility checkbox per domain actually present in the
     scenario, with live node counts. Rebuilt only when the scenario changes. */
  var stackLayersRev = -1;
  function rebuildStackLayers() {
    if (stackLayersRev === state.scenarioRev) return;
    stackLayersRev = state.scenarioRev;
    var box = $('stackLayers');
    var counts = {};
    state.fullGraph.nodes.forEach(function (n) {
      var d = n.domain || 'other';
      counts[d] = (counts[d] || 0) + 1;
    });
    box.innerHTML = '';
    OSP.renderStack.activeDomains().forEach(function (d) {
      var label = document.createElement('label');
      label.className = 'checkRow';
      label.innerHTML = '<input type="checkbox" checked> ' + d + ' <span style="color:var(--fg-dim)">(' + (counts[d] || 0) + ')</span>';
      label.querySelector('input').addEventListener('change', function () {
        OSP.renderStack.setDomainHidden(d, !this.checked);
      });
      box.appendChild(label);
    });
  }

  function openModal(id) { $(id).classList.add('open'); }
  function closeModal(id) { $(id).classList.remove('open'); }
  function anyModalOpen() {
    var open = false;
    document.querySelectorAll('.modalBack').forEach(function (m) { if (m.classList.contains('open')) open = true; });
    return open;
  }
  function closeAllModals() {
    document.querySelectorAll('.modalBack').forEach(function (m) { m.classList.remove('open'); });
  }

  function toggleBrief() {
    state.briefMode = !state.briefMode;
    document.body.classList.toggle('brief', state.briefMode);
    $('btnBrief').classList.toggle('active', state.briefMode);
    renderAll();
    if (state.view !== 'risk') activeRenderer().fit();
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'light' ? null : 'light';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(THEME_KEY, next || 'dark'); } catch (e) { /* ignore */ }
    renderAll();
  }

  function onKey(e) {
    var tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    var k = e.key;
    if ((e.metaKey || e.ctrlKey) && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (!OSP.editor.undo()) toast('Nothing to undo.');
      return;
    }
    if (k === '1') setView('map');
    else if (k === '2') setView('graph');
    else if (k === '3') setView('stack');
    else if (k === '4') setView('risk');
    else if (k === ' ') { e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowLeft') setT(state.t - 1);
    else if (k === 'ArrowRight') setT(state.t + 1);
    else if (k === '[') setT(state.t - 6);
    else if (k === ']') setT(state.t + 6);
    else if (k === '0') setT(0);
    else if (k === 'f' || k === 'F') { if (state.view !== 'risk') activeRenderer().fit(); }
    else if (k === 'i' || k === 'I') toggleIsolate();
    else if (k === 'b' || k === 'B') toggleBrief();
    else if (k === '/') { e.preventDefault(); $('searchBox').focus(); $('searchBox').select(); }
    else if (k === '?') openModal('helpOverlay');
    else if (k === '\\') document.body.classList.toggle('rail-collapsed');
    else if (k === 'Escape') {
      if (OSP.editor.isPlacing()) { OSP.editor.cancelPlacing(); toast('Placement cancelled.'); }
      else if (anyModalOpen()) closeAllModals();
      else if (state.briefMode) toggleBrief();
      else if (state.isolate) { state.isolate = false; renderAll(); }
      else if (state.selection) select(null);
    }
  }

  /* ---------- weights ---------- */

  function buildWeightSliders() {
    var box = $('weightSliders');
    var weights = state.scenario.criticality_model.weights;
    var labels = {
      mission: 'Mission importance', echelon: 'Echelon', degree: 'Connectivity',
      betweenness: 'Betweenness', failure: 'Failure impact', shared: 'Shared dependency'
    };
    box.innerHTML = '';
    Object.keys(labels).forEach(function (key) {
      var row = document.createElement('div');
      row.className = 'sliderRow';
      row.innerHTML = '<label>' + labels[key] + ' <b id="wv-' + key + '">' + weights[key] + '</b></label>' +
        '<input type="range" min="0" max="40" step="1" value="' + weights[key] + '" id="w-' + key + '">';
      box.appendChild(row);
      $('w-' + key).addEventListener('input', function () {
        weights[key] = parseFloat(this.value);
        $('wv-' + key).textContent = this.value;
        OSP.renderRisk.invalidateBaseline();
        recompute();
        renderAll();
        markDirty();
      });
    });
  }

  /* ---------- boot ---------- */

  function boot() {
    var raw = null;
    var restored = false;
    try {
      var saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) {
        raw = JSON.parse(saved);
        restored = true;
      }
    } catch (e) { raw = null; restored = false; }
    if (!raw) raw = readSeed();

    OSP.renderGraph.init(ctx);
    OSP.renderMap.init(ctx);
    OSP.renderRisk.init(ctx);
    OSP.renderStack.init(ctx);
    OSP.inspector.init(ctx);
    OSP.exporter.init(ctx);
    OSP.editor.init(ctx, { replaceScenario: replaceScenario, toast: toast });

    wireChrome();
    loadScenario(raw, { silent: true });
    renderAll();
    // initial fit must wait one frame: at boot the canvas has no layout yet
    requestAnimationFrame(function () {
      if (state.view === 'graph') OSP.renderGraph.fit();
      else OSP.renderMap.fit();
    });
    $('saveDot').className = restored ? 'saved' : '';

    if (restored) {
      var fp = seedFingerprint();
      var prevFp = null;
      try { prevFp = localStorage.getItem('osp-seed-fp'); } catch (e) { /* ignore */ }
      if (prevFp && prevFp !== fp) {
        toast('Restored autosaved session — the built-in scenarios have been UPDATED since. Data manager → Built-in scenarios to load the new version.');
      } else {
        toast('Restored autosaved session. Data manager → Built-in scenarios to reset.');
      }
    }
    try { localStorage.setItem('osp-seed-fp', seedFingerprint()); } catch (e) { /* ignore */ }
    var seenHelp = null;
    try { seenHelp = localStorage.getItem(SEEN_HELP_KEY); } catch (e) { /* ignore */ }
    if (!seenHelp) {
      openModal('helpOverlay');
      try { localStorage.setItem(SEEN_HELP_KEY, '1'); } catch (e) { /* ignore */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
