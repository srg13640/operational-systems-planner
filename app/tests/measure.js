/* OSP smoke gate — pass/fail (exit code). Run: npm i jsdom && node tests/measure.js
   Gates: console-clean boot, demo data loads with pinned counts, all views switch clean,
   deterministic graph layout across two cold loads, no node overlap, phase-aware finding
   emergence (the H+0 vs H+48 reveal), risk board renders, weight slider recompute. */
'use strict';

const H = require('./harness');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  console.log('OSP smoke gate');

  // ---- load 1 ----
  const app1 = await H.loadApp();
  check('boot: zero console/window errors', app1.errors.length === 0, app1.errors.slice(0, 5).join(' | ') || 'clean');

  const OSP = app1.window.OSP;
  check('modules present', !!(OSP && OSP.model && OSP.metrics && OSP.findings && OSP.layout && OSP.geo && OSP.io && OSP.symbols && OSP.dodaf), '');

  const sc = OSP.state.scenario;
  check('demo scenario loaded', !!sc && sc.meta.name.indexOf('PACIFIC SENTINEL') >= 0, sc && sc.meta.name);
  check('demo counts: nodes 39-42', sc.nodes.length >= 39 && sc.nodes.length <= 42, String(sc.nodes.length));
  check('demo counts: links 65-72', sc.links.length >= 65 && sc.links.length <= 72, String(sc.links.length));
  check('demo counts: activities 15-17', sc.activities.length >= 15 && sc.activities.length <= 17, String(sc.activities.length));
  check('phase captions present', sc.timeline.phases.every(p => p.notes && p.notes.length > 10), '');
  check('demo counts: 3 phases', sc.timeline.phases.length === 3, String(sc.timeline.phases.length));
  check('demo validation clean', OSP.state.issues.length === 0,
    OSP.state.issues.slice(0, 5).map(i => i.level + ' ' + i.where + ': ' + i.message).join(' | ') || 'clean');
  check('classification banner rendered from meta', app1.document.getElementById('banner').textContent.indexOf(sc.meta.classification.marking) === 0,
    app1.document.getElementById('banner').textContent);

  // ---- phase-aware finding emergence (the demo reveal) ----
  const g0 = OSP.model.buildGraph(sc, 12);
  OSP.metrics.computeMetrics(g0, sc.criticality_model);
  const f0 = OSP.findings.detectFindings(g0, sc);
  const g48 = OSP.model.buildGraph(sc, 48);
  OSP.metrics.computeMetrics(g48, sc.criticality_model);
  const f48 = OSP.findings.detectFindings(g48, sc);
  const spof0 = f0.filter(f => f.type === 'single_point_of_failure');
  const spof48 = f48.filter(f => f.type === 'single_point_of_failure');
  const kilo48 = f48.filter(f => f.affected_node_ids.some(id => /kilo|ground/i.test(id)) && (f.type === 'single_point_of_failure' || f.type === 'shared_dependency'));
  const kiloSpof0 = f0.filter(f => f.affected_node_ids.some(id => /kilo|ground/i.test(id)) && f.type === 'single_point_of_failure');
  check('H+48 has more findings than H+12', f48.length > f0.length, f0.length + ' -> ' + f48.length);
  check('ground-station SPOF/shared finding EMERGES at H+48', kilo48.length > 0 && kiloSpof0.length === 0,
    'H+12: ' + kiloSpof0.length + ', H+48: ' + kilo48.length);
  check('SPOF findings exist at H+48', spof48.length > 0, spof48.map(f => f.id).join(','));
  const ranked48 = OSP.metrics.computeMetrics(g48, sc.criticality_model).ranked;
  check('a ground-station node ranks top-3 at H+48', ranked48.slice(0, 3).some(id => /kilo|ground|gs/i.test(id)), ranked48.slice(0, 3).join(','));

  // determinism of analytics
  const f48b = OSP.findings.detectFindings(OSP.model.buildGraph(sc, 48), sc);
  check('findings deterministic', JSON.stringify(f48.map(f => f.id)) === JSON.stringify(f48b.map(f => f.id)), '');

  // ---- view switching ----
  const before = app1.errors.length;
  check('stack module present with export hook',
    !!(app1.window.OSP.renderStack && app1.window.OSP.renderStack.exportDraw && app1.window.OSP.renderStack.activeDomains().length >= 5),
    app1.window.OSP.renderStack ? app1.window.OSP.renderStack.activeDomains().join(',') : 'missing');
  const allViews = OSP.dodaf.VIEWS.map(v => v.id);
  check('view registry: OV-1, OV-2, OV-4, SV-1, SV-2 plus three analysis views',
    ['ov1', 'ov2', 'ov4', 'sv1', 'sv2', 'graph', 'stack', 'risk'].every(v => allViews.indexOf(v) >= 0), allViews.join(','));
  check('view tabs generated from the registry',
    app1.document.querySelectorAll('#viewTabs button').length === allViews.length &&
    app1.document.querySelectorAll('#viewTabs .tabGroup').length === OSP.dodaf.GROUPS.length, '');
  allViews.concat(['graph', 'stack', 'risk', 'ov1', 'stack', 'graph', 'risk', 'graph']).forEach(v => H.clickView(app1, v));
  check('view switching A→B→A clean (all views)', app1.errors.length === before, app1.errors.slice(before).join(' | ') || 'clean');
  check('graph rendered nodes', app1.document.querySelectorAll('#gNodes g.node').length >= 30,
    String(app1.document.querySelectorAll('#gNodes g.node').length));

  const pos1 = H.graphNodePositions(app1);
  const minD = H.minPairDistance(pos1);
  check('no node overlap (min pair distance ≥ 50px)', minD >= 50, minD.toFixed(1) + 'px');

  // ---- DoDAF views are filters over the one repository ----
  const full = OSP.state.fullGraph;
  const classOf = id => OSP.model.archClassOf(full.nodesById[id]);
  const ov2 = OSP.dodaf.buildView('ov2', sc, full, { deriveNeedlines: true });
  const sv1 = OSP.dodaf.buildView('sv1', sc, full, { svContext: false });
  const ov4 = OSP.dodaf.buildView('ov4', sc, full, {});
  check('OV-2 contains only performers', ov2.nodes.length > 0 && ov2.nodes.every(n => OSP.model.archClassOf(n) === 'performer'),
    ov2.nodes.length + ' performers');
  check('OV-2 needlines join performers only', ov2.links.every(l => classOf(l.source) === 'performer' && classOf(l.target) === 'performer'),
    ov2.links.length + ' needlines');
  const derived = ov2.links.filter(l => l.derived);
  check('OV-2 derives needlines through systems (each records its via path)',
    derived.length > 0 && derived.every(l => l.via && l.via.length >= 1 && l.via.every(id => classOf(id) === 'system')),
    derived.length + ' derived');
  const ov2NoDerive = OSP.dodaf.buildView('ov2', sc, full, { deriveNeedlines: false });
  check('OV-2 without derivation has only direct needlines', ov2NoDerive.links.every(l => !l.derived) &&
    ov2NoDerive.links.length === ov2.links.length - derived.length, ov2NoDerive.links.length + ' direct');
  check('SV-1 contains only systems', sv1.nodes.length > 0 && sv1.nodes.every(n => OSP.model.archClassOf(n) === 'system'),
    sv1.nodes.length + ' systems');
  check('SV-1 interfaces join systems only', sv1.links.every(l => classOf(l.source) === 'system' && classOf(l.target) === 'system'),
    sv1.links.length + ' interfaces');
  check('OV-2 ∪ SV-1 partitions performers and systems (no entity in both)',
    ov2.nodes.every(n => !sv1.nodesById[n.id]) && sv1.nodes.every(n => !ov2.nodesById[n.id]), '');
  check('every SV-1 interface exists in the repository (views never invent data)',
    sv1.links.every(l => full.links.some(x => x.id === l.id)), '');
  check('OV-4 hierarchy edges derive from parent_id',
    ov4.parentEdges.length > 0 && ov4.parentEdges.every(e => full.nodesById[e.child] && full.nodesById[e.child].parent_id === e.parent), ov4.parentEdges.length + ' edges');
  check('OV-4 shows only org relationships', ov4.links.every(l => OSP.dodaf.isOrgLink(l)), ov4.links.length + ' org links');
  check('view captions and hidden summaries are strings',
    [ov2, sv1, ov4].every(v => typeof OSP.dodaf.caption(v) === 'string' && typeof OSP.dodaf.hiddenSummary(v) === 'string'), OSP.dodaf.caption(ov2));

  // per-view pinned layouts: a pin on OV-2 does not move the node in SV-1 or the graph
  H.clickView(app1, 'ov2');
  const pinTarget = ov2.nodes[0].id;
  OSP.model.viewPositions(OSP.state.scenario, 'ov2')[pinTarget] = { x: 123, y: 456, pinned: true };
  OSP.renderGraph.invalidateLayout();
  H.clickView(app1, 'ov2');
  const ov2Pos = H.graphNodePositions(app1)[pinTarget];
  H.clickView(app1, 'graph');
  const graphPos = H.graphNodePositions(app1)[pinTarget];
  check('per-view pinned layout: OV-2 pin applied on OV-2 only',
    ov2Pos && Math.abs(ov2Pos.x - 123) < 0.5 && Math.abs(ov2Pos.y - 456) < 0.5 && graphPos && Math.abs(graphPos.x - pos1[pinTarget].x) < 0.5,
    JSON.stringify(ov2Pos) + ' vs graph ' + JSON.stringify(graphPos));
  delete OSP.model.viewPositions(OSP.state.scenario, 'ov2')[pinTarget];
  OSP.renderGraph.invalidateLayout();
  H.clickView(app1, 'graph');

  // OV-1 concept mode: on-canvas title identifies the model; toggling the lens is clean
  H.clickView(app1, 'ov1');
  check('OV-1 title block rendered', app1.document.getElementById('viewTitleCode').textContent === 'OV-1' &&
    app1.document.body.getAttribute('data-view') === 'map' && app1.document.body.getAttribute('data-model') === 'ov1', '');
  const errLens = app1.errors.length;
  const chkConcept = app1.document.getElementById('chkConcept');
  chkConcept.checked = false; chkConcept.dispatchEvent(new app1.window.Event('change', { bubbles: true }));
  chkConcept.checked = true; chkConcept.dispatchEvent(new app1.window.Event('change', { bubbles: true }));
  H.clickView(app1, 'sv1');
  const chkCtx = app1.document.getElementById('chkSvContext');
  chkCtx.checked = true; chkCtx.dispatchEvent(new app1.window.Event('change', { bubbles: true }));
  check('SV-1 with owning-performer context draws more nodes than systems alone',
    app1.document.querySelectorAll('#gNodes g.node').length > sv1.nodes.length, String(app1.document.querySelectorAll('#gNodes g.node').length));
  chkCtx.checked = false; chkCtx.dispatchEvent(new app1.window.Event('change', { bubbles: true }));
  const chkLens = app1.document.getElementById('chkArchLens');
  chkLens.checked = true; chkLens.dispatchEvent(new app1.window.Event('change', { bubbles: true }));
  chkLens.checked = false; chkLens.dispatchEvent(new app1.window.Event('change', { bubbles: true }));
  check('concept mode / context / lens toggles clean', app1.errors.length === errLens, app1.errors.slice(errLens).join(' | ') || 'clean');

  // ---- scrub while on risk view, check emergence tag ----
  H.clickView(app1, 'risk');
  H.setScrub(app1, 48);
  const boardHtml = app1.document.getElementById('riskBoard').innerHTML;
  check('risk board renders finding cards at H+48', app1.document.querySelectorAll('#riskBoard .findingCard').length > 0,
    String(app1.document.querySelectorAll('#riskBoard .findingCard').length) + ' cards');
  check('risk board marks EMERGED finding', boardHtml.indexOf('EMERGED AT H+') >= 0, '');
  check('criticality table renders', app1.document.querySelectorAll('#critTable tr.row').length >= 10,
    String(app1.document.querySelectorAll('#critTable tr.row').length) + ' rows');
  check('BLUF present', app1.document.getElementById('bluf') !== null, '');

  // weight slider recompute keeps working
  const wSlider = app1.document.getElementById('w-failure');
  if (wSlider) {
    const errBefore = app1.errors.length;
    wSlider.value = '30';
    wSlider.dispatchEvent(new app1.window.Event('input', { bubbles: true }));
    check('weight slider recompute clean', app1.errors.length === errBefore, '');
  } else {
    check('weight slider present', false, 'w-failure not found');
  }

  // inspector: select the top-ranked node via search box path (direct select call)
  app1.window.OSP.state.selection = { type: 'node', id: ranked48[0] };
  H.clickView(app1, 'graph');
  const inspText = app1.document.getElementById('inspectorBody').textContent;
  check('inspector shows criticality rationale', /Scores?\s|score/i.test(inspText) && inspText.length > 200, String(inspText.length) + ' chars');

  // JSON round-trip through io
  const json = OSP.io.scenarioToJson(sc, { includeLayout: true, appVersion: 'test' });
  const re = OSP.model.normalizeScenario(OSP.io.importJson(json).raw);
  check('JSON round-trip: counts identical, no errors',
    re.scenario.nodes.length === sc.nodes.length &&
    re.scenario.links.length === sc.links.length &&
    re.scenario.vulnerabilities.length === sc.vulnerabilities.length &&
    re.issues.filter(i => i.level === 'error').length === 0,
    re.scenario.nodes.length + ' nodes, ' + re.issues.length + ' issues');
  check('schema 1.2: arch_class survives round-trip and export is stamped with the current schema',
    re.scenario.schema_version === OSP.model.SCHEMA_VERSION && re.scenario.nodes.every((n, i) => n.arch_class === sc.nodes[i].arch_class) &&
    OSP.model.ARCH_CLASSES.indexOf(re.scenario.nodes[0].arch_class) >= 0, re.scenario.schema_version);
  check('schema 1.2: link_class and resource survive round-trip; metrics never serialize',
    re.scenario.links.every((l, i) => l.link_class === sc.links[i].link_class && (l.resource || '') === (sc.links[i].resource || '')) &&
    OSP.io.scenarioToJson(sc).indexOf('"metrics"') < 0,
    re.scenario.links.filter(l => l.resource).length + ' links carry a named resource');
  // a 1.0 file with no arch_class classifies from node_type
  const legacy = JSON.parse(json); legacy.schema_version = '1.0'; legacy.nodes.forEach(n => { delete n.arch_class; });
  const legacyNorm = OSP.model.normalizeScenario(legacy);
  check('schema 1.0 import: arch_class defaults from node_type, no errors',
    legacyNorm.issues.filter(i => i.level === 'error').length === 0 &&
    legacyNorm.scenario.nodes.every(n => n.arch_class === (OSP.model.ARCH_CLASS_OF_NODE_TYPE[n.node_type] || 'other')),
    legacyNorm.scenario.nodes.filter(n => n.arch_class === 'performer').length + ' performers / ' +
    legacyNorm.scenario.nodes.filter(n => n.arch_class === 'system').length + ' systems');
  const csv = OSP.io.exportCsvTables(sc)['nodes.csv'];
  const csvBack = OSP.model.normalizeScenario(OSP.io.importCsv(csv, sc).raw).scenario;
  check('CSV round-trip carries arch_class', csv.split(/\r?\n/)[0].indexOf('arch_class') >= 0 &&
    csvBack.nodes.length === sc.nodes.length && csvBack.nodes.every((n, i) => n.arch_class === sc.nodes[i].arch_class),
    csv.split(/\r?\n/)[0].slice(0, 60));

  // ---- stack view: land and maritime must sit at (nearly) the same altitude, not
  // stacked like the abstract domains — a coastline is one surface, not two layers ----
  check('stack: land/maritime coplanar (surface tier, not stacked)',
    Math.abs(OSP.renderStack.getDomainAlt('land') - OSP.renderStack.getDomainAlt('maritime')) <= 5,
    OSP.renderStack.getDomainAlt('land') + ' vs ' + OSP.renderStack.getDomainAlt('maritime'));
  check('stack: surface tier well below the nearest abstract domain',
    OSP.renderStack.getDomainAlt('sustain') - OSP.renderStack.getDomainAlt('land') > 40, '');

  // ---- second built-in scenario (Baltic) embeds clean and carries its own reveal ----
  const balticRaw = JSON.parse(app1.document.getElementById('seed-scenario-baltic').textContent);
  const balticNorm = OSP.model.normalizeScenario(balticRaw);
  check('baltic scenario embeds clean', balticNorm.issues.length === 0 &&
    balticNorm.scenario.meta.name.indexOf('BALTIC SENTINEL') >= 0 &&
    balticNorm.scenario.nodes.length >= 30, balticNorm.scenario.nodes.length + ' nodes, ' + balticNorm.issues.length + ' issues');
  const bg12 = OSP.model.buildGraph(balticNorm.scenario, 12);
  const bg48 = OSP.model.buildGraph(balticNorm.scenario, 48);
  const portDeps = id => t => { const g = t === 12 ? bg12 : bg48; return (g.dependentsOf[id] || []).filter((v, i, a) => a.indexOf(v) === i).length; };
  check('baltic port SPOF emerges (deps 2 at H+12 -> >=4 at H+48)',
    portDeps('port-log')(12) <= 2 && portDeps('port-log')(48) >= 4,
    portDeps('port-log')(12) + ' -> ' + portDeps('port-log')(48));

  // ---- editor: add node, edit it, add link, undo back to baseline ----
  const nodes0 = OSP.state.scenario.nodes.length;
  const links0 = OSP.state.scenario.links.length;
  OSP.editor.addNode();
  const nameField = app1.document.getElementById('ef-name');
  check('editor: add-node form opens', !!nameField, '');
  if (nameField) {
    nameField.value = 'Test Uplink Node';
    app1.document.querySelector('[data-edit-act="save"]').dispatchEvent(new app1.window.Event('click', { bubbles: true }));
  }
  check('editor: node added and named', OSP.state.scenario.nodes.length === nodes0 + 1 &&
    OSP.state.scenario.nodes.some(n => n.name === 'Test Uplink Node'), String(OSP.state.scenario.nodes.length));
  OSP.editor.addLink(OSP.state.scenario.nodes[nodes0].id);
  const relField = app1.document.getElementById('ef-relationship_type');
  check('editor: add-link form opens', !!relField, '');
  if (relField) {
    app1.document.querySelector('[data-edit-act="save"]').dispatchEvent(new app1.window.Event('click', { bubbles: true }));
  }
  check('editor: link added', OSP.state.scenario.links.length === links0 + 1, String(OSP.state.scenario.links.length));
  check('editor: no error-level issues after edits',
    OSP.state.issues.filter(i => i.level === 'error').length === 0, '');
  OSP.editor.undo();
  OSP.editor.undo();
  check('editor: undo restores baseline counts',
    OSP.state.scenario.nodes.length === nodes0 && OSP.state.scenario.links.length === links0,
    OSP.state.scenario.nodes.length + '/' + OSP.state.scenario.links.length);

  // ---- load 2: cold-load determinism ----
  const app2 = await H.loadApp();
  H.clickView(app2, 'graph');
  const pos2 = H.graphNodePositions(app2);
  const delta = H.maxDelta(pos1, pos2);
  check('layout determinism across cold loads (≤1px)', delta <= 1, delta.toFixed(3) + 'px');
  check('second load also error-free', app2.errors.length === 0, app2.errors.slice(0, 3).join(' | ') || 'clean');

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('HARNESS ERROR: ' + (e && e.stack || e));
  process.exit(1);
});
