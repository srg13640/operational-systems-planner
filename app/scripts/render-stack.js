/* OSP stack view — multi-domain 3D stack rendered with a hand-rolled perspective
   projection on canvas 2D (painter's algorithm). Domain layers come from the data;
   nodes sit on their domain plane at their geographic position; cross-domain
   dependencies draw as vertical arcs. Shares the global selection, timeline, and
   finding highlights. No WebGL, no libraries, deterministic per frame — so the
   model-redraw PNG exporter works unchanged. Attaches to OSP.renderStack. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  /* Canonical vertical order, top plane first. Only domains present in the
     scenario get a plane. Colors match the graph view's domain palette. */
  var DOMAIN_ORDER = ['space', 'air', 'ems', 'cyber', 'c2', 'data', 'strike', 'land', 'sustain', 'maritime', 'other'];
  var DOMAIN_COLORS = {
    c2: '#5b8dd6', strike: '#e4574f', sustain: '#61a56c', space: '#b03a9e',
    air: '#45d6b4', ems: '#e0a33c', cyber: '#9a6dd6', land: '#8a9aa8',
    maritime: '#2e9bd6', data: '#c9a13b', other: '#6b8091'
  };
  var CONTACT_COLORS = {
    direct: '#e4574f', indirect: '#e0a33c', air: '#45d6b4', maritime: '#2e9bd6',
    electronic: '#9a6dd6', cyber: '#b03a9e', information: '#c9a13b', sensing: '#61a56c'
  };

  var PLANE_W = 1150;    // world units, x (longitude axis)
  var PLANE_D = 760;     // world units, z (latitude axis)

  var canvas, c2d, ctx = null;
  var dpr = 1;
  var hits = [];
  var drag = null;
  var orbitTimer = null;

  /* Camera + display state (view state, not scenario state). */
  var cam = { yaw: -0.72, pitch: 0.92, dist: 1950, panX: 0, panY: 30 };
  var opts = { separation: 110, labels: true, crossEmphasis: true, orbit: false };
  var hiddenDomains = {};

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
  }

  /* ---- scene assembly (pure functions of state) ---- */

  function activeDomains() {
    var present = {};
    ctx.state.fullGraph.nodes.forEach(function (n) { present[n.domain || 'other'] = 1; });
    return DOMAIN_ORDER.filter(function (d) { return present[d]; });
  }

  function geoBBox() {
    var pts = [];
    ctx.state.fullGraph.nodes.forEach(function (n) {
      if (OSP.geo.hasLatLon(n.geo)) pts.push(n.geo);
    });
    if (!pts.length) return { latN: 1, latS: 0, lonW: 0, lonE: 1 };
    var latN = -1e9, latS = 1e9, lonW = 1e9, lonE = -1e9;
    pts.forEach(function (g) {
      if (g.lat > latN) latN = g.lat;
      if (g.lat < latS) latS = g.lat;
      if (g.lon < lonW) lonW = g.lon;
      if (g.lon > lonE) lonE = g.lon;
    });
    var padLat = Math.max(1, (latN - latS) * 0.12);
    var padLon = Math.max(1, (lonE - lonW) * 0.12);
    return { latN: latN + padLat, latS: latS - padLat, lonW: lonW - padLon, lonE: lonE + padLon };
  }

  /* World position for a node: x/z from geography within the scenario bbox,
     y from its domain plane. Nodes without coordinates line up in a tray row
     along the near edge of their plane (never dropped, same rule as the map). */
  function nodeWorld(n, domains, bbox, unplacedIndex) {
    var li = domains.indexOf(n.domain || 'other');
    if (li < 0) li = domains.length - 1;
    var y = (domains.length - 1 - li) * opts.separation;   // bottom plane at y=0
    if (OSP.geo.hasLatLon(n.geo)) {
      var fx = (n.geo.lon - bbox.lonW) / (bbox.lonE - bbox.lonW || 1);
      var fz = (bbox.latN - n.geo.lat) / (bbox.latN - bbox.latS || 1);
      return { x: (fx - 0.5) * PLANE_W, y: y, z: (fz - 0.5) * PLANE_D };
    }
    return { x: -PLANE_W / 2 + 60 + unplacedIndex * 96, y: y, z: PLANE_D / 2 + 60 };
  }

  /* ---- projection ---- */

  function project(p, w, h) {
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    // center the stack vertically on its own height
    var yMid = ((activeDomainsCount - 1) * opts.separation) / 2;
    var x = p.x, y = p.y - yMid, z = p.z;
    var x1 = x * cy - z * sy;
    var z1 = x * sy + z * cy;
    var y2 = y * cp - z1 * sp;
    var z2 = y * sp + z1 * cp;
    var depth = z2 + cam.dist;
    if (depth < 60) depth = 60;
    var f = 1050 / depth;
    return {
      x: w / 2 + (x1 * f) + cam.panX,
      y: h / 2 - (y2 * f) + cam.panY,
      s: f,
      depth: depth
    };
  }

  var activeDomainsCount = 1;

  /* ---- drawing helpers ---- */

  function hexA(hex, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  function bezierPoints(p1, c1, c2, p2, segs) {
    var out = [];
    for (var i = 0; i <= segs; i++) {
      var t = i / segs, mt = 1 - t;
      out.push({
        x: mt * mt * mt * p1.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p2.x,
        y: mt * mt * mt * p1.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p2.y,
        z: mt * mt * mt * p1.z + 3 * mt * mt * t * c1.z + 3 * mt * t * t * c2.z + t * t * t * p2.z
      });
    }
    return out;
  }

  var labelBoxes = [];
  function tryLabel(text, x, y, color, size, force) {
    var wpx = String(text).length * 6.0 + 6;
    var box = { x0: x - wpx / 2, x1: x + wpx / 2, y0: y - 10, y1: y + 3 };
    if (!force) {
      for (var i = 0; i < labelBoxes.length; i++) {
        var b = labelBoxes[i];
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) return;
      }
    }
    labelBoxes.push(box);
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    c2d.font = '600 ' + size + 'px ' + cssVar('--sans');
    c2d.textAlign = 'center';
    c2d.strokeStyle = isLight ? 'rgba(242,245,247,0.85)' : 'rgba(6,10,16,0.85)';
    c2d.lineWidth = 3;
    c2d.strokeText(text, x, y);
    c2d.fillStyle = color;
    c2d.fillText(text, x, y);
    c2d.textAlign = 'left';
  }

  /* ---- render ---- */

  function resize() {
    dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
  }

  function render() {
    if (!canvas || !c2d || !ctx.state.scenario) return;
    resize();
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderInto(canvas.clientWidth, canvas.clientHeight, true);
  }

  function renderInto(w, h, interactive) {
    var st = ctx.state;
    c2d.clearRect(0, 0, w, h);
    c2d.fillStyle = cssVar('--bg0');
    c2d.fillRect(0, 0, w, h);
    if (interactive) hits = [];
    labelBoxes = [];

    var domains = activeDomains().filter(function (d) { return !hiddenDomains[d]; });
    if (!domains.length) return;
    activeDomainsCount = domains.length;
    var bbox = geoBBox();
    var selId = (st.selection && st.selection.type === 'node') ? st.selection.id : null;
    var selLink = (st.selection && st.selection.type === 'link') ? st.selection.id : null;
    var finding = null;
    if (st.selection && st.selection.type === 'finding') {
      st.findings.forEach(function (f) { if (f.id === st.selection.id) finding = f; });
    }
    var fNodes = {}, fLinks = {};
    if (finding) {
      finding.affected_node_ids.forEach(function (id) { fNodes[id] = 1; });
      (finding.affected_link_ids || []).forEach(function (id) { fLinks[id] = 1; });
    }

    // node world positions (unplaced nodes indexed per plane, sorted-id order)
    var world = {};
    var unplacedCount = {};
    st.fullGraph.nodes.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (n) {
      var d = domains.indexOf(n.domain || 'other') >= 0 ? (n.domain || 'other') : null;
      if (!d) return;   // domain hidden
      var ui = 0;
      if (!OSP.geo.hasLatLon(n.geo)) {
        ui = unplacedCount[d] || 0;
        unplacedCount[d] = ui + 1;
      }
      world[n.id] = nodeWorld(n, domains, bbox, ui);
    });

    var drawables = [];

    // planes
    domains.forEach(function (d, li) {
      var y = (domains.length - 1 - li) * opts.separation;
      var corners = [
        { x: -PLANE_W / 2, y: y, z: -PLANE_D / 2 }, { x: PLANE_W / 2, y: y, z: -PLANE_D / 2 },
        { x: PLANE_W / 2, y: y, z: PLANE_D / 2 }, { x: -PLANE_W / 2, y: y, z: PLANE_D / 2 }
      ];
      drawables.push({
        depth: cam.dist + y * 0.001 + 4000,   // planes always behind entities at same y-ish
        kind: 'plane', corners: corners, domain: d, y: y
      });
    });

    // links
    var phaseId = st.graph.phaseId;
    st.fullGraph.links.forEach(function (l) {
      var a = world[l.source], b = world[l.target];
      if (!a || !b) return;
      var active = OSP.model.isActiveInPhase(l, phaseId) &&
        st.graph.nodesById[l.source] && st.graph.nodesById[l.target];
      var cross = Math.abs(a.y - b.y) > 1;
      var lift = cross ? Math.abs(a.y - b.y) * 0.22 : 26;
      var c1 = { x: a.x + (b.x - a.x) * 0.25, y: a.y + (cross ? (b.y - a.y) * 0.25 + lift : lift), z: a.z + (b.z - a.z) * 0.25 };
      var c2 = { x: a.x + (b.x - a.x) * 0.75, y: b.y + (cross ? (a.y - b.y) * 0.25 + lift : lift), z: a.z + (b.z - a.z) * 0.75 };
      var pts = bezierPoints(a, c1, c2, b, 22);
      var mid = pts[11];
      drawables.push({
        depth: depthOf(mid), kind: 'link', pts: pts, link: l, active: active, cross: cross,
        emphasized: selLink === l.id || fLinks[l.id] || (selId && (l.source === selId || l.target === selId))
      });
    });

    // activity vectors at t
    st.scenario.activities.forEach(function (act) {
      if (!OSP.model.activityActiveAt(act, st.t)) return;
      var a = act.source_node_id && world[act.source_node_id];
      var b = act.target_node_id && world[act.target_node_id];
      if (!a || !b) return;
      var c1 = { x: a.x + (b.x - a.x) * 0.3, y: Math.max(a.y, b.y) + 70, z: a.z + (b.z - a.z) * 0.3 };
      var c2 = { x: a.x + (b.x - a.x) * 0.7, y: Math.max(a.y, b.y) + 70, z: a.z + (b.z - a.z) * 0.7 };
      var pts = bezierPoints(a, c1, c2, b, 22);
      drawables.push({ depth: depthOf(pts[11]), kind: 'activity', pts: pts, act: act });
    });

    // nodes
    st.fullGraph.nodes.forEach(function (n) {
      var p = world[n.id];
      if (!p) return;
      drawables.push({
        depth: depthOf(p), kind: 'node', node: n, world: p,
        active: !!st.graph.nodesById[n.id],
        isSel: selId === n.id || fNodes[n.id]
      });
    });

    function depthOf(p) {
      var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      var yMid = ((activeDomainsCount - 1) * opts.separation) / 2;
      var z1 = p.x * sy + p.z * cy;
      return (p.y - yMid) * sp + z1 * cp + cam.dist;
    }

    // painter: far to near
    drawables.sort(function (a, b) { return b.depth - a.depth; });

    drawables.forEach(function (d) {
      if (d.kind === 'plane') drawPlane(d, w, h, domains);
      else if (d.kind === 'link') drawLink(d, w, h, finding);
      else if (d.kind === 'activity') drawActivity(d, w, h);
      else drawNode(d, w, h, interactive);
    });

    // labels last (screen space, collision culled): selected first, then active nodes
    if (opts.labels) {
      var queue = [];
      st.fullGraph.nodes.forEach(function (n) {
        var p = world[n.id];
        if (!p) return;
        var s = project(p, w, h);
        queue.push({
          n: n, x: s.x, y: s.y + 16 * s.s + 11,
          force: selId === n.id || fNodes[n.id],
          pri: (selId === n.id || fNodes[n.id]) ? 0 : (st.graph.nodesById[n.id] ? 1 : 2),
          color: st.graph.nodesById[n.id] ? cssVar('--fg') : cssVar('--fg-dim')
        });
      });
      queue.sort(function (a, b) { return a.pri - b.pri; });
      queue.forEach(function (q) { tryLabel(q.n.name, q.x, q.y, q.color, 10.5, q.force); });
    }
  }

  function drawPlane(d, w, h, domains) {
    var col = DOMAIN_COLORS[d.domain] || DOMAIN_COLORS.other;
    var pts = d.corners.map(function (c) { return project(c, w, h); });
    c2d.beginPath();
    pts.forEach(function (p, i) { if (i === 0) c2d.moveTo(p.x, p.y); else c2d.lineTo(p.x, p.y); });
    c2d.closePath();
    c2d.fillStyle = hexA(col, 0.04);
    c2d.fill();
    c2d.strokeStyle = hexA(col, 0.26);
    c2d.lineWidth = 1;
    c2d.stroke();
    // faint depth grid (3 x 2 interior lines)
    c2d.strokeStyle = hexA(col, 0.07);
    c2d.beginPath();
    for (var gx = 1; gx <= 3; gx++) {
      var fx = -PLANE_W / 2 + (PLANE_W / 4) * gx;
      var a = project({ x: fx, y: d.y, z: -PLANE_D / 2 }, w, h);
      var b = project({ x: fx, y: d.y, z: PLANE_D / 2 }, w, h);
      c2d.moveTo(a.x, a.y); c2d.lineTo(b.x, b.y);
    }
    for (var gz = 1; gz <= 2; gz++) {
      var fz = -PLANE_D / 2 + (PLANE_D / 3) * gz;
      var a2 = project({ x: -PLANE_W / 2, y: d.y, z: fz }, w, h);
      var b2 = project({ x: PLANE_W / 2, y: d.y, z: fz }, w, h);
      c2d.moveTo(a2.x, a2.y); c2d.lineTo(b2.x, b2.y);
    }
    c2d.stroke();
    // plane name tag anchored at the back-left corner, clear of the content
    // (clamped so edge planes never clip out of the canvas)
    var tag = project({ x: -PLANE_W / 2, y: d.y, z: -PLANE_D / 2 }, w, h);
    c2d.font = '600 10.5px ' + cssVar('--mono');
    c2d.fillStyle = hexA(col, 0.95);
    c2d.textAlign = 'right';
    c2d.fillText('// ' + d.domain.toUpperCase(), Math.max(tag.x - 8, 92), tag.y + 3);
    c2d.textAlign = 'left';
  }

  function drawLink(d, w, h, finding) {
    var l = d.link;
    var accent = cssVar('--accent');
    var base = d.cross && opts.crossEmphasis ? hexA(DOMAIN_COLORS[ctx.state.fullGraph.nodesById[l.target].domain] || '#6b8091', 0.5) : cssVar('--line-strong');
    var stroke = d.emphasized ? accent : base;
    var op = !d.active ? 0.08 : (d.emphasized ? 0.95 : (finding || isSelection() ? 0.16 : (d.cross && opts.crossEmphasis ? 0.55 : 0.3)));
    var width = d.emphasized ? 2.4 : (d.cross && opts.crossEmphasis ? 1.4 : 0.9);
    c2d.beginPath();
    d.pts.forEach(function (p, i) {
      var s = project(p, w, h);
      if (i === 0) c2d.moveTo(s.x, s.y); else c2d.lineTo(s.x, s.y);
    });
    c2d.strokeStyle = stroke;
    c2d.globalAlpha = op;
    c2d.lineWidth = width;
    c2d.stroke();
    c2d.globalAlpha = 1;
  }

  function isSelection() {
    return !!ctx.state.selection;
  }

  function drawActivity(d, w, h) {
    var color = CONTACT_COLORS[d.act.contact] || cssVar('--info');
    var fade = Math.min(1, Math.min(ctx.state.t - d.act.from_hours, d.act.to_hours - ctx.state.t) / 1.5 + 0.34);
    c2d.beginPath();
    d.pts.forEach(function (p, i) {
      var s = project(p, w, h);
      if (i === 0) c2d.moveTo(s.x, s.y); else c2d.lineTo(s.x, s.y);
    });
    c2d.strokeStyle = color;
    c2d.globalAlpha = 0.65 * Math.max(0.25, fade);
    c2d.lineWidth = 1.6;
    c2d.setLineDash([7, 5]);
    c2d.stroke();
    c2d.setLineDash([]);
    // arrowhead at target
    var end = project(d.pts[d.pts.length - 1], w, h);
    var prev = project(d.pts[d.pts.length - 2], w, h);
    var ang = Math.atan2(end.y - prev.y, end.x - prev.x);
    c2d.beginPath();
    c2d.moveTo(end.x, end.y);
    c2d.lineTo(end.x - 8 * Math.cos(ang - 0.4), end.y - 8 * Math.sin(ang - 0.4));
    c2d.lineTo(end.x - 8 * Math.cos(ang + 0.4), end.y - 8 * Math.sin(ang + 0.4));
    c2d.closePath();
    c2d.fillStyle = color;
    c2d.fill();
    c2d.globalAlpha = 1;
  }

  function drawNode(d, w, h, interactive) {
    var n = d.node;
    var st = ctx.state;
    var s = project(d.world, w, h);
    var score = (n.metrics && d.active) ? n.metrics.criticality_score : 0;
    var r = (7 + (score / 100) * 6) * s.s * 1.9;
    r = Math.max(4.5, Math.min(16, r));
    var domCol = DOMAIN_COLORS[n.domain] || DOMAIN_COLORS.other;
    var alpha = d.active ? 1 : 0.28;

    c2d.globalAlpha = alpha;
    if (d.isSel) {
      c2d.beginPath();
      c2d.arc(s.x, s.y, r + 6, 0, Math.PI * 2);
      c2d.strokeStyle = cssVar('--accent');
      c2d.lineWidth = 2.2;
      c2d.stroke();
    }
    var eff = d.active ? st.graph.statusOf(n) : null;
    if (eff === 'Degraded' || eff === 'Offline') {
      c2d.beginPath();
      c2d.arc(s.x, s.y, r + 3, 0, Math.PI * 2);
      c2d.strokeStyle = eff === 'Offline' ? cssVar('--crit') : cssVar('--warn');
      c2d.lineWidth = 1.6;
      c2d.setLineDash([3, 3]);
      c2d.stroke();
      c2d.setLineDash([]);
    }
    // criticality halo for high scorers — the stack's "what matters" cue
    if (score >= 50) {
      c2d.beginPath();
      c2d.arc(s.x, s.y, r + 2.5, 0, Math.PI * 2);
      c2d.fillStyle = hexA(score >= 75 ? '#e4574f' : '#e0a33c', 0.28);
      c2d.fill();
    }
    c2d.beginPath();
    if (n.side === 'Enemy') {
      c2d.save();
      c2d.translate(s.x, s.y);
      c2d.rotate(Math.PI / 4);
      c2d.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
      c2d.restore();
    } else {
      c2d.arc(s.x, s.y, r, 0, Math.PI * 2);
    }
    c2d.fillStyle = domCol;
    c2d.fill();
    c2d.strokeStyle = n.side === 'Enemy' ? cssVar('--enemy') : cssVar('--friendly');
    c2d.lineWidth = 1.6;
    c2d.stroke();
    if (r > 7.5) {
      c2d.fillStyle = '#0a1017';
      c2d.font = '700 ' + Math.max(6.5, r * 0.62) + 'px ' + cssVar('--mono');
      c2d.textAlign = 'center';
      c2d.fillText(OSP.symbols.nodeGlyph(n.node_type).slice(0, 3), s.x, s.y + r * 0.24);
      c2d.textAlign = 'left';
    }
    c2d.globalAlpha = 1;

    if (interactive) {
      hits.push({
        x: s.x, y: s.y, r: Math.max(10, r + 3),
        sel: { type: 'node', id: n.id }, name: n.name,
        sub: (n.domain || 'other') + ' · ' + n.node_type + (score ? ' · crit ' + Math.round(score) : '')
      });
    }
  }

  /* ---- interaction ---- */

  function hitAt(sx, sy) {
    var best = null, bestD = 1e9;
    for (var i = hits.length - 1; i >= 0; i--) {   // nearest-drawn (front) first
      var t = hits[i];
      var d = Math.sqrt((t.x - sx) * (t.x - sx) + (t.y - sy) * (t.y - sy));
      if (d <= t.r + 3 && d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  function wire() {
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      cam.dist = Math.max(650, Math.min(4200, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      render();
    }, { passive: false });

    canvas.addEventListener('mousedown', function (e) {
      var rect = canvas.getBoundingClientRect();
      drag = { sx: e.clientX - rect.left, sy: e.clientY - rect.top, yaw: cam.yaw, pitch: cam.pitch, moved: false };
      stopOrbit();
    });

    window.addEventListener('mousemove', function (e) {
      if (document.body.getAttribute('data-view') !== 'stack') return;
      var rect = canvas.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (drag) {
        var dx = sx - drag.sx, dy = sy - drag.sy;
        if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        drag.moved = true;
        cam.yaw = drag.yaw + dx * 0.006;
        cam.pitch = Math.max(0.14, Math.min(1.32, drag.pitch + dy * 0.005));
        render();
        return;
      }
      var t = hitAt(sx, sy);
      if (t) {
        ctx.hoverTip('<b>' + escapeHtml(t.name) + '</b><div class="tSub">' + escapeHtml(t.sub) + '</div>', e.clientX, e.clientY);
        canvas.style.cursor = 'pointer';
      } else {
        ctx.hideTip();
        canvas.style.cursor = '';
      }
    });

    window.addEventListener('mouseup', function (e) {
      if (!drag) return;
      var d = drag;
      drag = null;
      if (d.moved) { restartOrbit(); return; }
      var rect = canvas.getBoundingClientRect();
      var t = hitAt(e.clientX - rect.left, e.clientY - rect.top);
      ctx.select(t ? t.sel : null);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* Auto-orbit: a slow briefing rotation. Pauses while dragging; renders through
     the normal pipeline so selection and timeline stay live. */
  function stopOrbit() {
    if (orbitTimer) { cancelAnimationFrame(orbitTimer); orbitTimer = null; }
  }
  function restartOrbit() {
    stopOrbit();
    if (!opts.orbit) return;
    var step = function () {
      if (!opts.orbit || document.body.getAttribute('data-view') !== 'stack') { orbitTimer = null; return; }
      cam.yaw += 0.0022;
      render();
      orbitTimer = requestAnimationFrame(step);
    };
    orbitTimer = requestAnimationFrame(step);
  }

  function fit() {
    cam.yaw = -0.72;
    cam.pitch = 0.92;
    cam.dist = 1950;
    cam.panX = 0;
    cam.panY = 30;
    render();
  }

  /* ---- export: same painter render at export size, mirrored camera ---- */

  function exportDraw(target, w, h) {
    var savedCanvas = canvas, savedC2d = c2d, savedDpr = dpr;
    canvas = { clientWidth: w, clientHeight: h, width: w, height: h, style: {},
      getBoundingClientRect: function () { return { left: 0, top: 0 }; } };
    c2d = target;
    dpr = 1;
    try {
      renderInto(w, h, false);
    } finally {
      canvas = savedCanvas; c2d = savedC2d; dpr = savedDpr;
    }
  }

  OSP.renderStack = {
    init: function (context) {
      ctx = context;
      canvas = document.getElementById('stackCanvas');
      c2d = canvas.getContext('2d');
      wire();
      window.addEventListener('resize', function () {
        if (document.body.getAttribute('data-view') === 'stack') render();
      });
    },
    render: render,
    fit: fit,
    zoomIn: function () { cam.dist = Math.max(650, cam.dist * 0.82); render(); },
    zoomOut: function () { cam.dist = Math.min(4200, cam.dist * 1.22); render(); },
    exportDraw: exportDraw,
    activeDomains: activeDomains,
    setDomainHidden: function (d, hidden) { hiddenDomains[d] = !!hidden; render(); },
    setSeparation: function (v) { opts.separation = Math.max(40, Math.min(170, v)); render(); },
    setLabels: function (v) { opts.labels = !!v; render(); },
    setCrossEmphasis: function (v) { opts.crossEmphasis = !!v; render(); },
    setOrbit: function (v) { opts.orbit = !!v; if (v) restartOrbit(); else stopOrbit(); },
    getCamera: function () { return cam; }
  };
})();
