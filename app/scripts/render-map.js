/* OSP map view — canvas renderer for the operational planning surface.
   World space = basemap pixel space (see geo.js). Entities render at lat/lon; nodes without
   coordinates surface in the unplaced tray, never silently dropped. Attaches to OSP.renderMap. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var canvas, c2d, ctx = null;
  var viewport = null;
  var hits = [];        // screen-space hit targets, rebuilt each render
  var drag = null;
  var dpr = 1;

  /* ---- Global basemap tile pyramid (lib/basemap/world/) ----
     L0 world_4096.jpg always loaded; L1 (2700 world px, 8x4) and L2 (1350
     world px, 16x8) tiles load on demand and draw progressively over the base,
     so memory stays bounded (a single full-res world image would decode to
     ~900MB). Deleting the t2_* files degrades gracefully to L1 sharpness. */
  var TILE_DIR = 'lib/basemap/world/';
  var L1_WORLD = 2700;
  var L2_WORLD = 1350;
  var baseImg = null;
  var baseReady = false;
  var tiles = {};       // key -> { img, ready, lastUsed }
  var tileTick = 0;

  function tileFor(key) {
    var t = tiles[key];
    if (t) { t.lastUsed = ++tileTick; return t; }
    t = tiles[key] = { img: new Image(), ready: false, lastUsed: ++tileTick };
    t.img.onload = function () { t.ready = true; render(); };
    t.img.src = TILE_DIR + key + '.jpg';
    evictTiles();
    return t;
  }

  function evictTiles() {
    var keys = Object.keys(tiles);
    if (keys.length <= 48) return;
    keys.sort(function (a, b) { return tiles[a].lastUsed - tiles[b].lastUsed; });
    for (var i = 0; i < keys.length - 40; i++) delete tiles[keys[i]];
  }

  function drawTileLevel(level, tileWorld) {
    var cols = OSP.geo.WORLD_W / tileWorld;
    var rows = OSP.geo.WORLD_H / tileWorld;
    var tl = viewport.screenToWorld(0, 0);
    var br = viewport.screenToWorld(canvas.clientWidth, canvas.clientHeight);
    var x0 = Math.max(0, Math.floor(tl.x / tileWorld));
    var x1 = Math.min(cols - 1, Math.floor(br.x / tileWorld));
    var y0 = Math.max(0, Math.floor(tl.y / tileWorld));
    var y1 = Math.min(rows - 1, Math.floor(br.y / tileWorld));
    for (var ty = y0; ty <= y1; ty++) {
      for (var tx = x0; tx <= x1; tx++) {
        var t = tileFor('t' + level + '_' + tx + '_' + ty);
        if (t.ready) c2d.drawImage(t.img, tx * tileWorld, ty * tileWorld, tileWorld, tileWorld);
      }
    }
  }

  function drawBasemap(w, h) {
    if (!baseReady) {
      c2d.fillStyle = cssVar('--fg-dim');
      c2d.font = '12px ' + cssVar('--sans');
      c2d.fillText('Loading basemap…', 16, 24);
      return;
    }
    c2d.save();
    viewport.applyTo(c2d);
    c2d.drawImage(baseImg, 0, 0, OSP.geo.WORLD_W, OSP.geo.WORLD_H);
    var eff = viewport.containLayout().s * viewport.k;   // screen px per world px
    if (eff > 0.15) drawTileLevel(1, L1_WORLD);          // L1 native ratio 0.5
    if (eff > 0.45) drawTileLevel(2, L2_WORLD);          // L2 native ratio 1.0
    c2d.restore();
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    c2d.fillStyle = isLight ? 'rgba(240,245,248,0.14)' : 'rgba(4,8,14,0.30)';
    c2d.fillRect(0, 0, w, h);
  }

  var CONTACT_COLORS = {
    direct: '#e4574f', indirect: '#e0a33c', air: '#45d6b4', maritime: '#2e9bd6',
    electronic: '#9a6dd6', cyber: '#b03a9e', information: '#c9a13b', sensing: '#61a56c'
  };

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
  }
  function sideColor(side) {
    if (side === 'Enemy') return cssVar('--enemy');
    if (side === 'Neutral') return cssVar('--neutral');
    if (side === 'Unknown') return cssVar('--unknown');
    return cssVar('--friendly');
  }
  function zoneColor(kind) {
    if (kind === 'deep') return cssVar('--deep');
    if (kind === 'close') return cssVar('--close');
    if (kind === 'rear') return cssVar('--rear');
    return cssVar('--info');
  }
  function statusColor(st) {
    if (st === 'Offline') return cssVar('--crit');
    if (st === 'Degraded') return cssVar('--warn');
    return null;
  }

  function resize() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
  }

  function isUnit(n) {
    return n.node_type === 'unit' || n.node_type === 'headquarters' || n.node_type === 'command_post';
  }

  function placedNodes() {
    // full structural node set: placement is independent of phase; phase drives styling
    return ctx.state.fullGraph.nodes.filter(function (n) { return OSP.geo.hasLatLon(n.geo); });
  }

  function unplacedNodes() {
    return ctx.state.fullGraph.nodes.filter(function (n) { return !OSP.geo.hasLatLon(n.geo); });
  }

  function isActive(entity) {
    return OSP.model.isActiveInPhase(entity, ctx.state.graph.phaseId);
  }

  function nodeScreenRaw(n) {
    var w = OSP.geo.latLonToWorld(n.geo.lat, n.geo.lon);
    return viewport.worldToScreen(w.x, w.y);
  }

  /* Deterministic screen-space declutter: markers co-located at the same base
     (a real and common case) are relaxed apart just enough to read, like a
     planner nudging stacked unit icons. Runs per render in sorted-id order —
     no randomness, so exports stay reproducible. Links, activities, and hit
     targets all use the adjusted anchor so nothing points at a ghost. */
  var screenPos = {};
  function markerRadius(n) {
    if (OSP.symbols.sidcForNode(n) || isUnit(n)) {
      return Math.round(Math.min(isUnit(n) ? 28 : 22, Math.max(15, 11 * viewport.k))) * 0.85;
    }
    return 11;
  }
  function computeScreenPositions() {
    screenPos = {};
    var placed = placedNodes().slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    var pts = placed.map(function (n) {
      var p = nodeScreenRaw(n);
      return { id: n.id, x: p.x, y: p.y, r: markerRadius(n) };
    });
    for (var pass = 0; pass < 6; pass++) {
      var moved = false;
      for (var i = 0; i < pts.length; i++) {
        for (var j = i + 1; j < pts.length; j++) {
          var a = pts[i], b = pts[j];
          var dx = b.x - a.x, dy = b.y - a.y;
          var d = Math.sqrt(dx * dx + dy * dy);
          var minSep = a.r + b.r + 4;
          if (d >= minSep) continue;
          if (d < 0.01) { dx = 1; dy = 0; d = 1; }   // exactly coincident: fixed axis
          var push = (minSep - d) / 2;
          var ux = dx / d, uy = dy / d;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
    pts.forEach(function (p) { screenPos[p.id] = { x: p.x, y: p.y }; });
  }

  function nodeScreen(n) {
    return screenPos[n.id] || nodeScreenRaw(n);
  }

  function render() {
    if (!canvas || !c2d || !ctx.state.scenario) return;
    resize();
    viewport.clamp();   // canvas resizes and programmatic fits must never expose void
    var st = ctx.state;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2d.clearRect(0, 0, w, h);
    c2d.fillStyle = cssVar('--bg0');
    c2d.fillRect(0, 0, w, h);
    hits = [];

    drawBasemap(w, h);

    computeScreenPositions();
    drawZones();
    if (st.layers.links) drawLinks();
    if (st.layers.activities) drawActivities();
    drawNodes();
    if (st.layers.annotations) drawAnnotations();
  }

  function drawZones() {
    var st = ctx.state;
    if (!st.layers.zones) return;
    st.scenario.overlays.zones.forEach(function (z) {
      if (!isActive(z)) return;
      var color = zoneColor(z.kind);
      c2d.beginPath();
      z.points.forEach(function (p, i) {
        var wpt = OSP.geo.latLonToWorld(p.lat, p.lon);
        var s = viewport.worldToScreen(wpt.x, wpt.y);
        if (i === 0) c2d.moveTo(s.x, s.y); else c2d.lineTo(s.x, s.y);
      });
      c2d.closePath();
      c2d.globalAlpha = 0.10;
      c2d.fillStyle = color;
      c2d.fill();
      c2d.globalAlpha = 0.55;
      c2d.strokeStyle = color;
      c2d.lineWidth = 1.5;
      c2d.stroke();
      c2d.globalAlpha = 1;
      if (z.label || z.kind !== 'custom') {
        var cx = 0, cy = 0;
        z.points.forEach(function (p) {
          var wpt = OSP.geo.latLonToWorld(p.lat, p.lon);
          var s = viewport.worldToScreen(wpt.x, wpt.y);
          cx += s.x; cy += s.y;
        });
        cx /= z.points.length; cy /= z.points.length;
        c2d.fillStyle = color;
        c2d.globalAlpha = 0.8;
        c2d.font = '600 11px ' + cssVar('--sans');
        c2d.textAlign = 'center';
        c2d.fillText((z.label || z.kind).toUpperCase(), cx, cy);
        c2d.globalAlpha = 1;
      }
    });
  }

  function drawLinks() {
    var st = ctx.state;
    var byId = st.fullGraph.nodesById;
    var selId = (st.selection && st.selection.type === 'node') ? st.selection.id : null;
    var selLink = (st.selection && st.selection.type === 'link') ? st.selection.id : null;
    var finding = currentFinding();
    var fLinks = {};
    if (finding) (finding.affected_link_ids || []).forEach(function (id) { fLinks[id] = 1; });

    st.fullGraph.links.forEach(function (l) {
      var a = byId[l.source], b = byId[l.target];
      if (!a || !b || !OSP.geo.hasLatLon(a.geo) || !OSP.geo.hasLatLon(b.geo)) return;
      var active = isActive(l) && isActive(a) && isActive(b);
      if (!active) return;
      var pa = nodeScreen(a), pb = nodeScreen(b);
      var emphasized = selLink === l.id || fLinks[l.id] || (selId && (l.source === selId || l.target === selId));
      c2d.beginPath();
      var mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2 - 12;
      c2d.moveTo(pa.x, pa.y);
      c2d.quadraticCurveTo(mx, my, pb.x, pb.y);
      c2d.strokeStyle = emphasized ? cssVar('--accent') : cssVar('--fg-dim');
      c2d.globalAlpha = emphasized ? 0.9 : ((selId || selLink || finding) ? 0.15 : 0.35);
      c2d.lineWidth = emphasized ? 2 : 1;
      if (l.communication_method === 'SATCOM' || l.communication_method === 'UHF/VHF/HF Radio') c2d.setLineDash([6, 4]);
      c2d.stroke();
      c2d.setLineDash([]);
      c2d.globalAlpha = 1;
    });
  }

  function currentFinding() {
    var s = ctx.state.selection;
    if (!s || s.type !== 'finding') return null;
    for (var i = 0; i < ctx.state.findings.length; i++) {
      if (ctx.state.findings[i].id === s.id) return ctx.state.findings[i];
    }
    return null;
  }

  function drawActivities() {
    var st = ctx.state;
    var byId = st.fullGraph.nodesById;
    st.scenario.activities.forEach(function (act) {
      if (!OSP.model.activityActiveAt(act, st.t)) return;
      // fade near window edges (1.5h)
      var fade = Math.min(1, Math.min(st.t - act.from_hours, act.to_hours - st.t) / 1.5 + 0.34);
      fade = Math.max(0.25, Math.min(1, fade));
      var pos = null;
      if (act.position) {
        var wp = OSP.geo.latLonToWorld(act.position.lat, act.position.lon);
        pos = viewport.worldToScreen(wp.x, wp.y);
      } else if (act.target_node_id && byId[act.target_node_id] && OSP.geo.hasLatLon(byId[act.target_node_id].geo)) {
        pos = nodeScreen(byId[act.target_node_id]);
      }
      var color = CONTACT_COLORS[act.contact] || cssVar('--info');
      // source -> effect vector
      if (act.source_node_id && byId[act.source_node_id] && OSP.geo.hasLatLon(byId[act.source_node_id].geo) && pos) {
        var ps = nodeScreen(byId[act.source_node_id]);
        c2d.beginPath();
        c2d.moveTo(ps.x, ps.y);
        c2d.lineTo(pos.x, pos.y);
        c2d.strokeStyle = color;
        c2d.globalAlpha = 0.55 * fade;
        c2d.lineWidth = 1.6;
        c2d.setLineDash([8, 5]);
        c2d.stroke();
        c2d.setLineDash([]);
        // arrowhead
        var ang = Math.atan2(pos.y - ps.y, pos.x - ps.x);
        c2d.beginPath();
        c2d.moveTo(pos.x, pos.y);
        c2d.lineTo(pos.x - 9 * Math.cos(ang - 0.4), pos.y - 9 * Math.sin(ang - 0.4));
        c2d.lineTo(pos.x - 9 * Math.cos(ang + 0.4), pos.y - 9 * Math.sin(ang + 0.4));
        c2d.closePath();
        c2d.fillStyle = color;
        c2d.fill();
        c2d.globalAlpha = 1;
      }
      if (!pos) return;
      // diamond marker
      c2d.save();
      c2d.translate(pos.x, pos.y);
      c2d.rotate(Math.PI / 4);
      c2d.globalAlpha = fade;
      c2d.fillStyle = color;
      c2d.fillRect(-5, -5, 10, 10);
      c2d.strokeStyle = cssVar('--bg0');
      c2d.lineWidth = 1.5;
      c2d.strokeRect(-5, -5, 10, 10);
      c2d.restore();
      var selA = ctx.state.selection && ctx.state.selection.type === 'activity' && ctx.state.selection.id === act.id;
      if (selA) {
        c2d.beginPath();
        c2d.arc(pos.x, pos.y, 12, 0, Math.PI * 2);
        c2d.strokeStyle = cssVar('--accent');
        c2d.lineWidth = 2;
        c2d.stroke();
      }
      if (ctx.state.layers.labels) {
        c2d.globalAlpha = 0.9 * fade;
        haloText(act.name, pos.x + 12, pos.y - 8, color, '10.5px');
        c2d.globalAlpha = 1;
      }
      hits.push({ x: pos.x, y: pos.y, r: 12, sel: { type: 'activity', id: act.id }, name: act.name, sub: act.contact + ' · H+' + act.from_hours + '–' + act.to_hours });
    });
  }

  /* Greedy screen-space label placement: draw in priority order, skip labels whose
     box would collide with one already drawn. Co-located clusters stay readable. */
  var labelBoxes = [];
  function tryLabel(text, x, y, color, size, force) {
    var wpx = String(text).length * 6.4 + 6;
    var box = { x0: x - wpx / 2, x1: x + wpx / 2, y0: y - 11, y1: y + 3 };
    if (!force) {
      for (var i = 0; i < labelBoxes.length; i++) {
        var b = labelBoxes[i];
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) return false;
      }
    }
    labelBoxes.push(box);
    haloText(text, x, y, color, size, 'center');
    return true;
  }

  function drawNodes() {
    var st = ctx.state;
    var selId = (st.selection && st.selection.type === 'node') ? st.selection.id : null;
    var finding = currentFinding();
    var fNodes = {};
    if (finding) finding.affected_node_ids.forEach(function (id) { fNodes[id] = 1; });
    labelBoxes = [];
    var labelQueue = [];

    placedNodes().forEach(function (n) {
      var p = nodeScreen(n);
      var active = isActive(n);
      var alpha = active ? 1 : 0.3;
      var isSel = selId === n.id || fNodes[n.id];
      var eff = active ? ctx.state.graph.statusOf(n) : null;
      var score = (n.metrics && active) ? n.metrics.criticality_score : 0;
      var has2525 = !!OSP.symbols.sidcForNode(n);
      // symbol size follows zoom so theater view stays uncluttered and close-in
      // work gets full-size frames (integer sizes keep the render cache small)
      var symSize = Math.round(Math.min(isUnit(n) ? 28 : 22, Math.max(15, 11 * viewport.k)));
      var ringR = has2525 || isUnit(n) ? symSize + 5 : 15;

      c2d.globalAlpha = alpha;
      if (isSel) {
        c2d.beginPath();
        c2d.arc(p.x, p.y, ringR, 0, Math.PI * 2);
        c2d.strokeStyle = cssVar('--accent');
        c2d.lineWidth = 2.5;
        c2d.stroke();
      }
      var sc = eff && statusColor(eff);
      if (sc) {
        c2d.beginPath();
        c2d.arc(p.x, p.y, ringR - 3, 0, Math.PI * 2);
        c2d.strokeStyle = sc;
        c2d.lineWidth = 2;
        c2d.setLineDash([4, 3]);
        c2d.stroke();
        c2d.setLineDash([]);
      }

      // MIL-STD-2525 first (vendored milsymbol); FM 1-02.2 canvas frames, then
      // criticality circles as the fallbacks.
      var drew = OSP.symbols.drawNodeSymbol2525(c2d, n, p.x, p.y, symSize);
      if (drew) {
        // criticality tick for high-scoring physical nodes so the analytic
        // signal survives the switch to doctrinal symbology
        if (score >= 50) {
          c2d.beginPath();
          c2d.arc(p.x + ringR - 6, p.y - ringR + 6, 4, 0, Math.PI * 2);
          c2d.fillStyle = score >= 75 ? cssVar('--crit') : cssVar('--warn');
          c2d.fill();
          c2d.strokeStyle = 'rgba(6,10,16,0.85)';
          c2d.lineWidth = 1.2;
          c2d.stroke();
        }
        hits.push({ x: p.x, y: p.y, r: symSize, sel: { type: 'node', id: n.id }, name: n.name, sub: n.node_type + (n.echelon ? ' · ' + n.echelon : '') + (score ? ' · crit ' + Math.round(score) : '') });
      } else if (isUnit(n)) {
        OSP.symbols.drawUnitSymbol(c2d, {
          x: p.x, y: p.y, size: symSize + 4,
          side: n.side,
          branch: n.symbol.branch_type,
          echelon_mark: n.symbol.echelon_mark,
          hq: n.symbol.hq,
          cp: n.symbol.cp,
          designation: '',
          color: sideColor(n.side)
        });
        hits.push({ x: p.x, y: p.y, r: 20, sel: { type: 'node', id: n.id }, name: n.name, sub: n.node_type + (n.echelon ? ' · ' + n.echelon : '') });
      } else {
        c2d.beginPath();
        c2d.arc(p.x, p.y, 7.5, 0, Math.PI * 2);
        c2d.fillStyle = score >= 75 ? cssVar('--crit') : score >= 50 ? cssVar('--warn') : cssVar('--bg3');
        c2d.fill();
        c2d.strokeStyle = sideColor(n.side);
        c2d.lineWidth = 1.8;
        c2d.stroke();
        hits.push({ x: p.x, y: p.y, r: 11, sel: { type: 'node', id: n.id }, name: n.name, sub: n.node_type + (score ? ' · crit ' + Math.round(score) : '') });
      }
      if (st.layers.labels) {
        labelQueue.push({
          text: n.name,
          x: p.x, y: p.y + (drew || isUnit(n) ? symSize + 9 : 20),
          color: active ? cssVar('--fg') : cssVar('--fg-dim'),
          alpha: alpha,
          priority: (isSel ? 0 : 0) + (isUnit(n) ? 1 : 2) + (active ? 0 : 2),
          force: !!isSel
        });
      }
      c2d.globalAlpha = 1;
    });

    // selected first, then units, then systems; inactive last — colliding labels are skipped
    labelQueue.sort(function (a, b) { return a.force !== b.force ? (a.force ? -1 : 1) : a.priority - b.priority; });
    labelQueue.forEach(function (L) {
      c2d.globalAlpha = L.alpha;
      tryLabel(L.text, L.x, L.y, L.color, '11px', L.force);
      c2d.globalAlpha = 1;
    });
  }

  function drawAnnotations() {
    var st = ctx.state;
    st.scenario.overlays.annotations.forEach(function (an) {
      if (!isActive(an)) return;
      var wpt = OSP.geo.latLonToWorld(an.lat, an.lon);
      var p = viewport.worldToScreen(wpt.x, wpt.y);
      c2d.strokeStyle = cssVar('--fg-mute');
      c2d.globalAlpha = 0.75;
      c2d.lineWidth = 1.2;
      c2d.beginPath();
      c2d.moveTo(p.x - 5, p.y); c2d.lineTo(p.x + 5, p.y);
      c2d.moveTo(p.x, p.y - 5); c2d.lineTo(p.x, p.y + 5);
      c2d.stroke();
      haloText(an.text, p.x + 8, p.y - 6, cssVar('--fg-mute'), '10.5px');
      c2d.globalAlpha = 1;
    });
  }

  function haloText(text, x, y, color, size, align) {
    c2d.font = '600 ' + (size || '11px') + ' ' + cssVar('--sans');
    c2d.textAlign = align || 'left';
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    c2d.strokeStyle = isLight ? 'rgba(242,245,247,0.85)' : 'rgba(6,10,16,0.85)';
    c2d.lineWidth = 3;
    c2d.strokeText(text, x, y);
    c2d.fillStyle = color;
    c2d.fillText(text, x, y);
    c2d.textAlign = 'left';
  }

  /* ---- events ---- */

  function hitAt(sx, sy) {
    var best = null, bestD = 1e9;
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i];
      var d = Math.sqrt((h.x - sx) * (h.x - sx) + (h.y - sy) * (h.y - sy));
      if (d <= h.r + 3 && d < bestD) { best = h; bestD = d; }
    }
    return best;
  }

  function wire() {
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = canvas.getBoundingClientRect();
      viewport.zoomAbout(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 0.87);
      render();
    }, { passive: false });

    canvas.addEventListener('mousedown', function (e) {
      var rect = canvas.getBoundingClientRect();
      drag = { sx: e.clientX - rect.left, sy: e.clientY - rect.top, moved: false };
      canvas.classList.add('dragging');
    });

    window.addEventListener('mousemove', function (e) {
      if (document.body.getAttribute('data-view') !== 'map') return;
      var rect = canvas.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (drag) {
        var dx = sx - drag.sx, dy = sy - drag.sy;
        if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
        drag.moved = true;
        viewport.panBy(dx, dy);
        drag.sx = sx; drag.sy = sy;
        render();
        return;
      }
      // cursor readout + tooltip
      var wpt = viewport.screenToWorld(sx, sy);
      var ll = OSP.geo.worldToLatLon(wpt.x, wpt.y);
      var el = document.getElementById('mapCursor');
      if (el) el.textContent = ' · ' + OSP.geo.formatLatLon(ll.lat, ll.lon);
      var h = hitAt(sx, sy);
      if (h) {
        ctx.hoverTip('<b>' + escapeHtml(h.name) + '</b><div class="tSub">' + escapeHtml(h.sub) + '</div>', e.clientX, e.clientY);
        canvas.style.cursor = 'pointer';
      } else {
        ctx.hideTip();
        canvas.style.cursor = '';
      }
    });

    window.addEventListener('mouseup', function (e) {
      if (!drag) return;
      canvas.classList.remove('dragging');
      var d = drag;
      drag = null;
      if (d.moved) { ctx.onViewportChange(); return; }
      var rect = canvas.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      if (OSP.editor && OSP.editor.isPlacing()) {
        var wpt = viewport.screenToWorld(sx, sy);
        var ll = OSP.geo.worldToLatLon(wpt.x, wpt.y);
        if (OSP.editor.handleMapClick(ll.lat, ll.lon)) return;
      }
      var h = hitAt(sx, sy);
      ctx.select(h ? h.sel : null);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---- export drawing ---- */

  function exportDraw(target, w, h) {
    // Redraw the map from the model at export size using a temporary viewport state.
    var savedCanvas = canvas, savedC2d = c2d, savedViewport = viewport, savedDpr = dpr;
    canvas = { clientWidth: w, clientHeight: h, width: w, height: h, classList: { add: function () {}, remove: function () {} } };
    c2d = target;
    dpr = 1;
    viewport = OSP.geo.makeViewport(function () { return { w: w, h: h }; });
    // mirror the live viewport proportionally
    viewport.x = savedViewport.x * (w / (savedCanvas.clientWidth || w));
    viewport.y = savedViewport.y * (h / (savedCanvas.clientHeight || h));
    viewport.k = savedViewport.k;
    hits = [];
    try {
      renderInner(w, h);
    } finally {
      canvas = savedCanvas; c2d = savedC2d; viewport = savedViewport; dpr = savedDpr;
    }
  }

  function renderInner(w, h) {
    computeScreenPositions();
    c2d.fillStyle = cssVar('--bg0');
    c2d.fillRect(0, 0, w, h);
    if (baseReady) drawBasemap(w, h);
    drawZones();
    if (ctx.state.layers.links) drawLinks();
    if (ctx.state.layers.activities) drawActivities();
    drawNodes();
    if (ctx.state.layers.annotations) drawAnnotations();
  }

  /* Fit the viewport to the placed data (nodes + annotations), not the whole basemap —
     the operating area is what the planner needs on screen. */
  function fitToData() {
    var pts = [];
    placedNodes().forEach(function (n) { pts.push(OSP.geo.latLonToWorld(n.geo.lat, n.geo.lon)); });
    (ctx.state.scenario ? ctx.state.scenario.overlays.annotations : []).forEach(function (an) {
      pts.push(OSP.geo.latLonToWorld(an.lat, an.lon));
    });
    if (!pts.length) { viewport.fit(); render(); return; }
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    pts.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    var cw = Math.max(1, canvas.clientWidth), ch = Math.max(1, canvas.clientHeight);
    var margin = 90;
    viewport.k = 1;
    var lay = viewport.containLayout();
    var k = Math.min((cw - margin * 2) / (Math.max(40, (maxX - minX)) * lay.s),
                     (ch - margin * 2) / (Math.max(40, (maxY - minY)) * lay.s));
    k = Math.max(1, Math.min(8, k));
    viewport.k = k;
    viewport.x = cw / 2 - (lay.x + ((minX + maxX) / 2) * lay.s) * k;
    viewport.y = ch / 2 - (lay.y + ((minY + maxY) / 2) * lay.s) * k;
    viewport.clamp();
    render();
  }

  OSP.renderMap = {
    init: function (context) {
      ctx = context;
      canvas = document.getElementById('mapCanvas');
      c2d = canvas.getContext('2d');
      viewport = OSP.geo.makeViewport(function () {
        return { w: canvas.clientWidth, h: canvas.clientHeight };
      });
      baseImg = new Image();
      baseImg.onload = function () { baseReady = true; render(); };
      baseImg.src = TILE_DIR + 'world_4096.jpg';
      wire();
      window.addEventListener('resize', function () {
        if (document.body.getAttribute('data-view') === 'map') render();
      });
    },
    render: render,
    fit: fitToData,
    fitBasemap: function () { viewport.fit(); render(); },
    zoomIn: function () { viewport.zoomAbout(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.25); render(); },
    zoomOut: function () { viewport.zoomAbout(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.8); render(); },
    unplacedNodes: unplacedNodes,
    getViewport: function () { return viewport; },
    getScreenPositions: function () { return screenPos; },
    exportDraw: exportDraw
  };
})();
