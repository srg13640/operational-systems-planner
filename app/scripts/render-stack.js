/* OSP stack view — real WebGL multi-domain 3D stack (Three.js, vendored
   locally via lib/three/three-loader.js). Ported technique-for-technique from
   the FSP "OP FM 2040" 3D prototype: translucent domain planes (PlaneGeometry
   + MeshBasicMaterial, depthWrite:false + EdgesGeometry border), hand-drawn
   canvas silhouette icons uploaded as CanvasTexture billboard Sprites with a
   destination-over radial-gradient halo baked into the texture, a hand-rolled
   spherical orbit camera (no THREE.OrbitControls import), and glowing
   Bezier-arc links with a moving glow-head sprite. No post-processing bloom
   pass exists in the source either — every "glow" is a layered translucent
   mesh or a radial-gradient sprite texture, which is what this file does too.

   Adaptation from the source: every ABSTRACT domain (space/air/ems/cyber/c2/
   data/strike/sustain) still gets its own plane at the same scenario
   geographic footprint (lat/lon bbox), stacked by altitude — that vertical
   ordering is a real "how abstract / how far from the ground" hierarchy. Land
   and maritime are different in kind, not degree: they are two adjacent
   PHYSICAL surfaces at the same reference height (sea level / ground level),
   not one stacked above the other — a coastline doesn't have the ocean
   floating over (or buried under) the beach. So land and maritime share one
   SURFACE_ALT tier (a hairline y-epsilon apart only to avoid z-fighting
   between their two plane meshes) and are distinguished the way real geography
   already distinguishes them — a naval unit's lat/lon puts it out to sea,
   an inland unit's lat/lon puts it on the coast — not by a synthetic
   horizontal offset square the way the source faked it with hand-authored
   PLAN-view coordinates. Every other domain layer, color, and node/link datum
   comes from the live scenario, not a hand-authored scene — this view has no
   fixed doctrine narrative.

   Public API mirrors the other renderers (init/render/fit/zoomIn/zoomOut/
   exportDraw/select-by-hit) plus stack-specific hooks used by the rail UI.
   Attaches to window.OSP.renderStack. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  /* ---- domain layer model ---- */
  /* Altitude table (world units) — hand-tuned ordering, low = physical/
     surface, high = abstract/orbital, matching the source's design intent
     but covering OSP's domain vocabulary (adds strike, data; c2 sits above
     both since it coordinates everything beneath it). Land and maritime are
     the SAME tier (SURFACE_ALT) — see the file header. */
  var SURFACE_ALT = 25;
  var DOMAIN_ALT = {
    land: SURFACE_ALT, maritime: SURFACE_ALT + 2, other: 55, sustain: 95, strike: 135,
    data: 180, c2: 230, cyber: 295, ems: 375, air: 470, space: 620
  };
  var SURFACE_DOMAINS = { land: 1, maritime: 1 };
  var DOMAIN_ORDER = ['space', 'air', 'ems', 'cyber', 'c2', 'data', 'strike', 'sustain', 'other', 'maritime', 'land'];
  var DOMAIN_COLORS = {
    land: '#5ee3c1', air: '#7ec9ff', maritime: '#4fa3e0', space: '#b189ff',
    cyber: '#c97bff', ems: '#ffb347', sustain: '#e3c78a', c2: '#ffffff',
    strike: '#ff8c6a', data: '#f2c94c', other: '#8aa0b3'
  };
  var CONTACT_COLORS = {
    direct: '#ff5d6c', indirect: '#ff8c42', air: '#7ec9ff', maritime: '#4fa3e0',
    electronic: '#c97bff', cyber: '#c97bff', information: '#f2c94c', sensing: '#5ee3c1'
  };
  var ENEMY_COLOR = '#ff5d6c';
  var FRIENDLY_COLOR = '#7ec9ff';
  var HILITE = '#5ee3c1';

  var PLANE_W = 1500, PLANE_D = 980;   // world units spanning the scenario bbox

  var ctx = null;                       // app context (state, select, hoverTip...)
  var wrap, canvas, labelsEl;
  var THREE = null;
  var ready = false;                    // Three.js loaded and renderer built
  var failed = false;
  var renderer, scene, camera;
  var raf = null;
  var dpr = 1;

  var group = { planes: null, nodes: null, links: null, activities: null, boundary: null, sky: null };

  /* Continuous idle animation (pulsing rings, traveling glow) is what makes
     this feel alive rather than a still frame — but exports must stay
     pixel-reproducible (a core product guarantee: two exports of the same
     selection are byte-identical). The fix used everywhere else in this
     rule is a deterministic PER-OBJECT phase, never Math.random or wall-clock
     alone, and exportDraw freezes the clock to a fixed canonical instant so
     the animation state it captures is a pure function of what's selected,
     not of when you happened to click export. */
  function hashPhase(id) {
    var h = 0;
    var s = String(id);
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return (Math.abs(h) % 1000) / 1000 * Math.PI * 2;
  }
  /* Tiny seeded PRNG (mulberry32) for the starfield — deterministic, not
     Math.random, so this file has zero non-reproducible randomness anywhere. */
  function seededRandom(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var animated = { pulseRings: [], findingHeads: [], activityHeads: [] };
  var clockFrozenAt = null;   // set during exportDraw so captured frames are reproducible
  function animClock() {
    return clockFrozenAt !== null ? clockFrozenAt : performance.now();
  }
  var nodeSprites = {};                 // nodeId -> { sprite, glow, pulse }
  var textureCache = {};                // painterKey|side|color -> THREE.CanvasTexture
  var labelSpriteCache = {};

  var opts = { separation: 1, labels: true, crossEmphasis: true, orbit: false, enemyVisible: true };
  var hiddenDomains = {};
  var lastSceneRev = -1;
  var lastPhaseKey = '';

  /* ---- hand-rolled spherical orbit camera (ported math) ---- */
  var orbitState = { target: null, radius: 2050, phi: 0.78, theta: 0.55 };
  var DEFAULT_ORBIT = { radius: 2050, phi: 0.78, theta: 0.55 };

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
  }

  /* ================= boot ================= */

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    if (window.THREE) { onThreeReady(); return; }
    if (window.THREE === null) { onThreeUnavailable(); return; }   // loader already failed
    document.addEventListener('three-ready', onThreeReady, { once: true });
    document.addEventListener('three-unavailable', onThreeUnavailable, { once: true });
  }

  function onThreeUnavailable() {
    failed = true;
    renderFallback();
  }

  function onThreeReady() {
    if (failed || ready) return;
    THREE = window.THREE;
    try {
      buildRenderer();
      ready = true;
      if (document.body.getAttribute('data-view') === 'stack') render();
    } catch (e) {
      failed = true;
      window.__OSP_THREE_ERROR = e;
      renderFallback();
    }
  }

  function renderFallback() {
    if (!wrap) return;
    wrap.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px;">' +
      '<div style="max-width:420px;color:var(--fg-mute);font-size:12.5px;">' +
      '<div style="font-size:14px;font-weight:600;color:var(--fg);margin-bottom:8px;">Stack view unavailable</div>' +
      'WebGL/Three.js did not initialize in this browser (or GPU acceleration is disabled). ' +
      'Every other surface — Map, Graph, Risk, and export — is unaffected.' +
      '</div></div>';
  }

  function buildRenderer() {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor(themeIsLight() ? 0xeef1f5 : 0x0a1016, 1);
    canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    wrap.appendChild(canvas);

    labelsEl = document.createElement('div');
    labelsEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    wrap.appendChild(labelsEl);

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(themeIsLight() ? 0xeef1f5 : 0x0a1016, 0.00028);
    camera = new THREE.PerspectiveCamera(42, 1, 1, 12000);
    scene.add(new THREE.AmbientLight(0x223344, 3));
    var dir = new THREE.DirectionalLight(0x5ee3c1, 0.8);
    dir.position.set(300, 800, 200);
    scene.add(dir);

    group.planes = new THREE.Group(); scene.add(group.planes);
    group.links = new THREE.Group(); scene.add(group.links);
    group.activities = new THREE.Group(); scene.add(group.activities);
    group.nodes = new THREE.Group(); scene.add(group.nodes);
    group.boundary = new THREE.Group(); scene.add(group.boundary);
    group.sky = buildStarfield();
    scene.add(group.sky);

    orbitState.target = new THREE.Vector3(0, 220, 0);
    updateCameraFromOrbit();

    wireInteraction();
    resize();
  }

  /* Built once at boot, not per render — deterministic (seeded, not
     Math.random) so nothing about this file depends on real randomness; a
     slow constant rotation (driven by the same clock as everything else, so
     it freezes for export too) is the only thing that moves. Purely
     atmospheric: it carries no data and is never a hit target. */
  function buildStarfield() {
    var rand = seededRandom(1337);
    var count = 420;
    var positions = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var r = 3200 + rand() * 1400;
      var theta = rand() * Math.PI * 2;
      var phi = Math.acos(2 * rand() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6 + 150;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    var g = c.getContext('2d').createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    var c2d = c.getContext('2d');
    c2d.fillStyle = g; c2d.fillRect(0, 0, 32, 32);
    var mat = new THREE.PointsMaterial({
      map: new THREE.CanvasTexture(c), size: 9, transparent: true, opacity: 0.55,
      depthWrite: false, fog: false, blending: THREE.AdditiveBlending
    });
    return new THREE.Points(geo, mat);
  }

  function themeIsLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }

  /* ================= orbit camera ================= */

  function updateCameraFromOrbit() {
    var o = orbitState;
    var x = o.target.x + o.radius * Math.sin(o.phi) * Math.sin(o.theta);
    var y = o.target.y + o.radius * Math.cos(o.phi);
    var z = o.target.z + o.radius * Math.sin(o.phi) * Math.cos(o.theta);
    camera.position.set(x, y, z);
    camera.lookAt(o.target);
  }

  /* Programmatic view changes (fit/zoom buttons) ease over ~500ms instead of
     snapping — a live drag or wheel stays instant (it's the user's own
     hand), but a button-triggered jump reads as directed camera work, not a
     glitch. Implemented as lerp targets consumed inside frameLoop so it rides
     the same render loop as idle animation rather than starting a second one.
     Uses wall-clock time directly (not animClock()), since camera framing —
     unlike idle pulse phase — is never part of the export-reproducibility
     contract; an export mid-tween simply captures wherever the camera is. */
  var tween = null;
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function tweenOrbitTo(radius, phi, theta, targetPos, duration) {
    tween = {
      r0: orbitState.radius, phi0: orbitState.phi, th0: orbitState.theta, tg0: orbitState.target.clone(),
      r1: radius, phi1: phi, th1: theta, tg1: targetPos.clone(),
      start: performance.now(), duration: duration || 480
    };
    ensureFrameLoop();
  }
  function stepTween() {
    if (!tween) return;
    var f = Math.min(1, (performance.now() - tween.start) / tween.duration);
    var e = easeOutCubic(f);
    orbitState.radius = tween.r0 + (tween.r1 - tween.r0) * e;
    orbitState.phi = tween.phi0 + (tween.phi1 - tween.phi0) * e;
    orbitState.theta = tween.th0 + (tween.th1 - tween.th0) * e;
    orbitState.target.lerpVectors(tween.tg0, tween.tg1, e);
    updateCameraFromOrbit();
    if (f >= 1) tween = null;
  }

  function fit() {
    if (!ready) return;
    var target = orbitState.target ? orbitState.target.clone() : new THREE.Vector3(0, 220, 0);
    target.set(0, 220, 0);
    tweenOrbitTo(DEFAULT_ORBIT.radius, DEFAULT_ORBIT.phi, DEFAULT_ORBIT.theta, target);
    render();
  }

  var drag = null;
  function wireInteraction() {
    canvas.addEventListener('mousedown', function (e) {
      drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey, moved: false };
      wrap.classList.add('dragging');
    });
    window.addEventListener('mousemove', function (e) {
      if (document.body.getAttribute('data-view') !== 'stack') return;
      if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        drag.moved = true;
        if (drag.pan) {
          var right = new THREE.Vector3();
          var up = new THREE.Vector3(0, 1, 0);
          camera.getWorldDirection(right);
          right.cross(up).normalize();
          orbitState.target.addScaledVector(right, -dx * 0.7);
          orbitState.target.y -= dy * 0.5;
        } else {
          orbitState.theta -= dx * 0.007;
          orbitState.phi = Math.max(0.12, Math.min(1.5, orbitState.phi + dy * 0.007));
        }
        drag.x = e.clientX; drag.y = e.clientY;
        updateCameraFromOrbit();
        render();
        return;
      }
      hoverAt(e);
    });
    window.addEventListener('mouseup', function (e) {
      if (!drag) return;
      var d = drag; drag = null;
      wrap.classList.remove('dragging');
      if (!d.moved) selectAt(e);
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      orbitState.radius = Math.max(400, Math.min(4600, orbitState.radius + e.deltaY * 0.85));
      updateCameraFromOrbit();
      render();
    }, { passive: false });
    window.addEventListener('resize', function () {
      if (document.body.getAttribute('data-view') === 'stack') resize();
    });
  }

  function resize() {
    if (!ready) return;
    var w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }

  /* ================= raycasting ================= */

  function pickAt(e) {
    var rect = canvas.getBoundingClientRect();
    var mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    var ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);
    var sprites = [];
    Object.keys(nodeSprites).forEach(function (id) { sprites.push(nodeSprites[id].sprite); });
    var hits = ray.intersectObjects(sprites);
    if (!hits.length) return null;
    return hits[0].object.userData.nodeId;
  }

  function selectAt(e) {
    var id = pickAt(e);
    ctx.select(id ? { type: 'node', id: id } : null);
  }

  function hoverAt(e) {
    var id = pickAt(e);
    if (!id) { ctx.hideTip(); canvas.style.cursor = ''; return; }
    var n = ctx.state.fullGraph.nodesById[id];
    if (!n) return;
    var score = (n.metrics && ctx.state.graph.nodesById[id]) ? n.metrics.criticality_score : 0;
    ctx.hoverTip('<b>' + escapeHtml(n.name) + '</b><div class="tSub">' + escapeHtml((n.domain || 'other') + ' · ' + n.node_type) +
      (score ? ' · crit ' + Math.round(score) : '') + '</div>', e.clientX, e.clientY);
    canvas.style.cursor = 'pointer';
  }

  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ================= scene data helpers ================= */

  function activeDomains() {
    if (!ctx || !ctx.state.fullGraph) return [];
    var present = {};
    ctx.state.fullGraph.nodes.forEach(function (n) { present[n.domain || 'other'] = 1; });
    return DOMAIN_ORDER.filter(function (d) { return present[d] && !hiddenDomains[d]; });
  }

  function geoBBoxKm() {
    var pts = [];
    ctx.state.fullGraph.nodes.forEach(function (n) { if (OSP.geo.hasLatLon(n.geo)) pts.push(n.geo); });
    if (!pts.length) return { latN: 1, latS: 0, lonW: 0, lonE: 1, kmNS: 0, kmEW: 0 };
    var latN = -1e9, latS = 1e9, lonW = 1e9, lonE = -1e9;
    pts.forEach(function (g) {
      if (g.lat > latN) latN = g.lat;
      if (g.lat < latS) latS = g.lat;
      if (g.lon < lonW) lonW = g.lon;
      if (g.lon > lonE) lonE = g.lon;
    });
    var padLat = Math.max(0.5, (latN - latS) * 0.12), padLon = Math.max(0.5, (lonE - lonW) * 0.12);
    latN += padLat; latS -= padLat; lonW -= padLon; lonE += padLon;
    var midLat = (latN + latS) / 2;
    var kmNS = (latN - latS) * 111.32;
    var kmEW = (lonE - lonW) * 111.32 * Math.cos(midLat * Math.PI / 180);
    return { latN: latN, latS: latS, lonW: lonW, lonE: lonE, kmNS: Math.round(Math.abs(kmNS)), kmEW: Math.round(Math.abs(kmEW)) };
  }

  function nodeVisible(n) {
    return opts.enemyVisible || n.side !== 'Enemy';
  }

  function worldXZ(geo, bbox) {
    var fx = (geo.lon - bbox.lonW) / ((bbox.lonE - bbox.lonW) || 1);
    var fz = (bbox.latN - geo.lat) / ((bbox.latN - bbox.latS) || 1);
    return { x: (fx - 0.5) * PLANE_W, z: (fz - 0.5) * PLANE_D };
  }

  /* ================= icon painters (canvas 2D -> CanvasTexture -> Sprite) ================= */
  /* Every painter ends with paintHalo(): a destination-over radial gradient
     drawn UNDER whatever silhouette was already painted — the exact "fake
     bloom" technique the source prototype uses for every unit icon. */

  function hexToRgba(hex, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
    if (!m) return hex;
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  function paintHalo(c2d, cx, cy, sz, color, innerR, outerR) {
    var grad = c2d.createRadialGradient(cx, cy, innerR || 4, cx, cy, outerR || 52);
    grad.addColorStop(0, hexToRgba(color, 0.34));
    grad.addColorStop(1, hexToRgba(color, 0));
    c2d.globalCompositeOperation = 'destination-over';
    c2d.fillStyle = grad;
    c2d.fillRect(0, 0, sz, sz);
    c2d.globalCompositeOperation = 'source-over';
  }

  /* Painters draw in a 128-unit design space centered at (64,64); the actual
     backing canvas renders at 2x that (TEX_SZ) so icons stay crisp when a
     high-criticality sprite scales up on screen — c2d.scale(2,2) below makes
     every painter's existing CX/CY-relative coordinates map onto the sharper
     canvas with no changes to the 12 painter functions themselves. */
  var SZ = 128, CX = 64, CY = 64, TEX_SZ = 256;

  var PAINTERS = {
    hqcp: function (c2d, color) {
      c2d.strokeStyle = color; c2d.lineWidth = 3;
      c2d.strokeRect(CX - 22, CY - 15, 44, 30);
      c2d.beginPath(); c2d.moveTo(CX - 22, CY); c2d.lineTo(CX + 22, CY); c2d.stroke();
      c2d.fillStyle = color; c2d.fillRect(CX - 2, CY - 15, 4, 15);
      paintHalo(c2d, CX, CY, SZ, color, 6, 58);
    },
    armor: function (c2d, color) {
      c2d.fillStyle = color;
      c2d.fillRect(CX - 22, CY - 13, 44, 26);
      c2d.strokeStyle = '#e8f3ff'; c2d.lineWidth = 1.5;
      c2d.beginPath();
      c2d.moveTo(CX - 22, CY - 10); c2d.lineTo(CX + 22, CY - 10);
      c2d.moveTo(CX - 22, CY + 10); c2d.lineTo(CX + 22, CY + 10);
      c2d.stroke();
      c2d.fillStyle = color;
      c2d.beginPath();
      c2d.moveTo(CX - 9, CY - 7); c2d.lineTo(CX - 3, CY - 10); c2d.lineTo(CX + 3, CY - 10);
      c2d.lineTo(CX + 9, CY - 7); c2d.lineTo(CX + 9, CY + 7); c2d.lineTo(CX + 3, CY + 10);
      c2d.lineTo(CX - 3, CY + 10); c2d.lineTo(CX - 9, CY + 7);
      c2d.closePath(); c2d.fill();
      c2d.fillRect(CX + 7, CY - 1.5, 22, 3);
      paintHalo(c2d, CX, CY, SZ, color, 4, 56);
    },
    infantry: function (c2d, color) {
      c2d.strokeStyle = color; c2d.lineWidth = 3.5;
      c2d.strokeRect(CX - 20, CY - 14, 40, 28);
      c2d.beginPath();
      c2d.moveTo(CX - 20, CY - 14); c2d.lineTo(CX + 20, CY + 14);
      c2d.moveTo(CX + 20, CY - 14); c2d.lineTo(CX - 20, CY + 14);
      c2d.stroke();
      paintHalo(c2d, CX, CY, SZ, color, 4, 54);
    },
    artillery: function (c2d, color) {
      c2d.fillStyle = color;
      c2d.beginPath(); c2d.arc(CX, CY, 11, 0, Math.PI * 2); c2d.fill();
      c2d.strokeStyle = color; c2d.lineWidth = 2.5;
      c2d.beginPath(); c2d.moveTo(CX, CY); c2d.lineTo(CX + 26, CY - 12); c2d.stroke();
      paintHalo(c2d, CX, CY, SZ, color, 4, 56);
    },
    aviation: function (c2d, color) {
      c2d.fillStyle = hexToRgba(color, 0.24);
      drawWing(c2d, 5);
      c2d.fillStyle = color;
      drawWing(c2d, 0);
      c2d.fillStyle = '#e8f3ff';
      c2d.beginPath(); c2d.ellipse(CX + 6, CY, 4, 2.5, 0, 0, Math.PI * 2); c2d.fill();
      paintHalo(c2d, CX, CY, SZ, color, 5, 58);
      function drawWing(c, pad) {
        c.beginPath();
        c.moveTo(CX + 24 + pad, CY);
        c.lineTo(CX - 6, CY - 16 - pad);
        c.lineTo(CX - 14, CY - 5);
        c.lineTo(CX - 24 - pad, CY - 9 - pad);
        c.lineTo(CX - 20, CY);
        c.lineTo(CX - 24 - pad, CY + 9 + pad);
        c.lineTo(CX - 14, CY + 5);
        c.lineTo(CX - 6, CY + 16 + pad);
        c.closePath(); c.fill();
      }
    },
    radar: function (c2d, color) {
      c2d.fillStyle = color;
      c2d.fillRect(CX - 3, CY - 4, 6, 22);
      c2d.save();
      c2d.translate(CX, CY - 10);
      c2d.rotate(-Math.PI / 9);
      c2d.fillRect(-18, -3, 36, 6);
      c2d.strokeStyle = '#e8f3ff'; c2d.lineWidth = 1;
      c2d.beginPath(); c2d.moveTo(-14, 0); c2d.lineTo(14, 0); c2d.stroke();
      c2d.restore();
      c2d.strokeStyle = hexToRgba(color, 0.55); c2d.lineWidth = 1.4;
      [16, 22, 28].forEach(function (r) {
        c2d.beginPath(); c2d.arc(CX + 3, CY - 20, r, Math.PI * 1.12, Math.PI * 1.6); c2d.stroke();
      });
      paintHalo(c2d, CX, CY, SZ, color, 5, 58);
    },
    satellite: function (c2d, color) {
      c2d.fillStyle = color;
      c2d.fillRect(CX - 7, CY - 8, 14, 16);
      [[-30, -6], [16, -6]].forEach(function (p) {
        c2d.fillRect(CX + p[0], CY + p[1], 14, 12);
        c2d.strokeStyle = '#e8f3ff'; c2d.lineWidth = 0.8;
        for (var gx = 2; gx < 14; gx += 4) {
          c2d.beginPath(); c2d.moveTo(CX + p[0] + gx, CY + p[1]); c2d.lineTo(CX + p[0] + gx, CY + p[1] + 12); c2d.stroke();
        }
      });
      c2d.fillStyle = color;
      c2d.fillRect(CX - 2, CY + 8, 4, 10);
      paintHalo(c2d, CX, CY, SZ, color, 5, 58);
    },
    relay: function (c2d, color) {
      c2d.strokeStyle = color; c2d.lineWidth = 3;
      c2d.beginPath(); c2d.moveTo(CX, CY + 16); c2d.lineTo(CX, CY - 14); c2d.stroke();
      c2d.beginPath(); c2d.moveTo(CX - 10, CY + 16); c2d.lineTo(CX + 10, CY + 16); c2d.stroke();
      c2d.strokeStyle = hexToRgba(color, 0.7); c2d.lineWidth = 1.6;
      [10, 16, 22].forEach(function (r) {
        c2d.beginPath(); c2d.arc(CX, CY - 14, r, -Math.PI * 0.72, -Math.PI * 0.28); c2d.stroke();
        c2d.beginPath(); c2d.arc(CX, CY - 14, r, Math.PI * 0.28, Math.PI * 0.72); c2d.stroke();
      });
      paintHalo(c2d, CX, CY, SZ, color, 5, 58);
    },
    ship: function (c2d, color) {
      c2d.fillStyle = color;
      c2d.beginPath();
      c2d.moveTo(CX + 26, CY);
      c2d.lineTo(CX + 14, CY - 8);
      c2d.lineTo(CX - 22, CY - 8);
      c2d.lineTo(CX - 26, CY);
      c2d.lineTo(CX - 22, CY + 8);
      c2d.lineTo(CX + 14, CY + 8);
      c2d.closePath(); c2d.fill();
      c2d.fillStyle = '#e8f3ff';
      c2d.fillRect(CX - 5, CY - 6, 12, 8);
      paintHalo(c2d, CX, CY, SZ, color, 5, 58);
    },
    data: function (c2d, color) {
      c2d.fillStyle = color;
      [-9, 0, 9].forEach(function (dy) { c2d.fillRect(CX - 16, CY + dy - 3, 32, 6); });
      c2d.fillStyle = '#0a1016';
      [-9, 0, 9].forEach(function (dy) { c2d.beginPath(); c2d.arc(CX + 11, CY + dy, 1.6, 0, Math.PI * 2); c2d.fill(); });
      paintHalo(c2d, CX, CY, SZ, color, 5, 56);
    },
    facility: function (c2d, color) {
      c2d.fillStyle = color;
      c2d.beginPath();
      c2d.moveTo(CX, CY - 18); c2d.lineTo(CX + 20, CY - 4); c2d.lineTo(CX + 20, CY + 16);
      c2d.lineTo(CX - 20, CY + 16); c2d.lineTo(CX - 20, CY - 4);
      c2d.closePath(); c2d.fill();
      paintHalo(c2d, CX, CY, SZ, color, 5, 56);
    },
    generic: function (c2d, color) {
      c2d.fillStyle = color;
      c2d.beginPath(); c2d.arc(CX, CY, 13, 0, Math.PI * 2); c2d.fill();
      paintHalo(c2d, CX, CY, SZ, color, 4, 52);
    }
  };

  var BRANCH_PAINTER = {
    infantry: 'infantry', armor: 'armor', mech_infantry: 'armor', cavalry: 'armor',
    artillery: 'artillery', mortar: 'artillery', ada: 'artillery', aviation: 'aviation',
    engineer: 'facility', signal: 'relay', transportation: 'data'
  };

  function pickPainterKey(n) {
    var t = n.node_type, d = n.domain;
    if (t === 'headquarters' || t === 'command_post' || t === 'directorate' || t === 'office') return 'hqcp';
    if (t === 'satellite') return 'satellite';
    if (t === 'ground_station' || t === 'relay' || t === 'network') return 'relay';
    if (t === 'sensor') return 'radar';
    if (t === 'system' || t === 'application' || t === 'database' || t === 'data_feed' || t === 'process') return 'data';
    if (t === 'logistics_node' || t === 'facility') return 'facility';
    if (t === 'unit' || t === 'shooter' || t === 'platform') {
      if (d === 'air') return 'aviation';
      if (d === 'maritime') return 'ship';
      if (d === 'space') return 'satellite';
      var branch = n.symbol && n.symbol.branch_type;
      return BRANCH_PAINTER[branch] || 'armor';
    }
    return 'generic';
  }

  /* Subtle upper-left sheen, screen-blended over the finished icon — cheap
     fake dimensionality (a highlight, not a full relight) so silhouettes read
     less like flat stickers. */
  function paintSheen(c2d, color) {
    var g = c2d.createRadialGradient(CX - 16, CY - 18, 2, CX - 16, CY - 18, 46);
    g.addColorStop(0, 'rgba(255,255,255,0.30)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c2d.globalCompositeOperation = 'lighter';
    c2d.fillStyle = g;
    c2d.fillRect(0, 0, SZ, SZ);
    c2d.globalCompositeOperation = 'source-over';
  }

  function nodeTexture(n) {
    var side = n.side === 'Enemy' ? 'enemy' : 'friendly';
    var color = n.side === 'Enemy' ? ENEMY_COLOR : (DOMAIN_COLORS[n.domain] || DOMAIN_COLORS.other);
    var key = pickPainterKey(n) + '|' + side + '|' + color;
    if (textureCache[key]) return textureCache[key];
    var c = document.createElement('canvas');
    c.width = TEX_SZ; c.height = TEX_SZ;
    var c2d = c.getContext('2d');
    c2d.scale(TEX_SZ / SZ, TEX_SZ / SZ);
    var painter = PAINTERS[pickPainterKey(n)] || PAINTERS.generic;
    if (n.side === 'Enemy') {
      c2d.save();
      c2d.translate(CX, CY); c2d.rotate(Math.PI / 4); c2d.translate(-CX, -CY);
      painter(c2d, color);
      c2d.restore();
    } else {
      painter(c2d, color);
    }
    paintSheen(c2d, color);
    var tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    textureCache[key] = tex;
    return tex;
  }

  var glowHeadCache = {};
  function makeGlowHeadTexture(color) {
    if (glowHeadCache[color]) return glowHeadCache[color];
    var c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    var g = c.getContext('2d').createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.3, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    var c2d = c.getContext('2d');
    c2d.fillStyle = g; c2d.fillRect(0, 0, 64, 64);
    var tex = new THREE.CanvasTexture(c);
    glowHeadCache[color] = tex;
    return tex;
  }

  function labelSprite(text, color) {
    var key = text + '|' + color;
    if (labelSpriteCache[key]) return labelSpriteCache[key].clone();
    var c = document.createElement('canvas');
    c.width = 512; c.height = 96;
    var c2d = c.getContext('2d');
    c2d.font = '600 46px ' + cssVar('--mono');
    c2d.fillStyle = color;
    c2d.textBaseline = 'middle';
    c2d.fillText(text, 4, 48);
    var tex = new THREE.CanvasTexture(c);
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: true });
    var sprite = new THREE.Sprite(mat);
    labelSpriteCache[key] = sprite;
    return sprite.clone();
  }

  /* ================= scene building ================= */

  function clearGroup(g) {
    while (g.children.length) {
      var c = g.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) { if (c.material.map) c.material.map.dispose && void 0; c.material.dispose(); }
    }
  }

  function buildPlanes() {
    clearGroup(group.planes);
    var domains = activeDomains();
    var surfaceLabelIndex = 0;   // land/maritime stagger their label tag so it doesn't double up
    domains.forEach(function (d) {
      var alt = DOMAIN_ALT[d] * opts.separation;
      var color = new THREE.Color(DOMAIN_COLORS[d] || DOMAIN_COLORS.other);
      var geo = new THREE.PlaneGeometry(PLANE_W, PLANE_D);
      var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: d === 'maritime' ? 0.10 : 0.045, side: THREE.DoubleSide, depthWrite: false });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(0, alt, 0);
      group.planes.add(mesh);

      var edges = new THREE.EdgesGeometry(geo);
      var edgeMat = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.32 });
      var frame = new THREE.LineSegments(edges, edgeMat);
      frame.rotation.x = -Math.PI / 2;
      frame.position.set(0, alt, 0);
      group.planes.add(frame);

      var lbl = labelSprite('// ' + d.toUpperCase(), DOMAIN_COLORS[d] || DOMAIN_COLORS.other);
      lbl.scale.set(210, 40, 1);
      /* Surface tier (land/maritime) sits at ~the same altitude by design (see
         file header) — stagger their tags along Z instead of stacking them at
         the same corner, where they'd overlap. */
      var zOff = SURFACE_DOMAINS[d] ? surfaceLabelIndex++ * 46 : 0;
      lbl.position.set(-PLANE_W / 2 - 60, alt + 12, -PLANE_D / 2 + 30 + zOff);
      group.planes.add(lbl);
    });

    // boundary wireframe box spanning the full stack
    clearGroup(group.boundary);
    if (domains.length) {
      var minY = Math.min.apply(null, domains.map(function (d) { return DOMAIN_ALT[d]; })) * opts.separation - 15;
      var maxY = Math.max.apply(null, domains.map(function (d) { return DOMAIN_ALT[d]; })) * opts.separation + 15;
      var boxGeo = new THREE.BoxGeometry(PLANE_W + 20, Math.max(30, maxY - minY), PLANE_D + 20);
      var boxEdges = new THREE.EdgesGeometry(boxGeo);
      var boxMat = new THREE.LineBasicMaterial({ color: 0x2a4a63, transparent: true, opacity: 0.4 });
      var box = new THREE.LineSegments(boxEdges, boxMat);
      box.position.set(0, (minY + maxY) / 2, 0);
      group.boundary.add(box);
    }
  }

  function buildNodes() {
    clearGroup(group.nodes);
    nodeSprites = {};
    var st = ctx.state;
    var finding = currentFinding();
    var fNodes = {};
    if (finding) finding.affected_node_ids.forEach(function (id) { fNodes[id] = 1; });
    var selId = (st.selection && st.selection.type === 'node') ? st.selection.id : null;

    st.fullGraph.nodes.forEach(function (n) {
      var p = worldPosOf(n.id);
      if (!p) return;
      var active = !!st.graph.nodesById[n.id];
      var score = (n.metrics && active) ? n.metrics.criticality_score : 0;
      var fade = active ? 1 : 0.28;

      var tex = nodeTexture(n);
      var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: fade, sizeAttenuation: true, depthTest: false });
      var sprite = new THREE.Sprite(mat);
      var baseScale = 46 + (score / 100) * 30;
      sprite.scale.set(baseScale, baseScale, 1);
      sprite.position.set(p.x, p.y, p.z);
      sprite.userData = { nodeId: n.id };
      group.nodes.add(sprite);
      nodeSprites[n.id] = { sprite: sprite };

      if (score >= 50 && active) {
        var ringGeo = new THREE.RingGeometry(18, 23, 32);
        var ringMat = new THREE.MeshBasicMaterial({
          color: score >= 75 ? 0xff5d6c : 0xffb347, transparent: true, opacity: 0.6,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
        });
        var ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(p.x, p.y - 5.4, p.z);
        group.nodes.add(ring);
        animated.pulseRings.push({ mat: ringMat, base: 0.6, speed: 2.1, phase: hashPhase(n.id) });
      }
      if (selId === n.id || fNodes[n.id]) {
        var selGeo = new THREE.RingGeometry(25, 31, 32);
        var selMat = new THREE.MeshBasicMaterial({
          color: 0x5ee3c1, transparent: true, opacity: 0.85,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
        });
        var selRing = new THREE.Mesh(selGeo, selMat);
        selRing.rotation.x = -Math.PI / 2;
        selRing.position.set(p.x, p.y - 5.2, p.z);
        group.nodes.add(selRing);
        animated.pulseRings.push({ mat: selMat, base: 0.85, speed: 3.1, phase: hashPhase(n.id + '-sel') });
      }
      if (st.layers.graphLabels !== false && opts.labels) {
        var lbl = labelSprite(n.name, active ? '#e8f3ff' : '#6b8091');
        lbl.scale.set(220, 30, 1);
        lbl.position.set(p.x, p.y - baseScale / 2 - 16, p.z);
        group.nodes.add(lbl);
      }
    });
  }

  /* One stable world position per node per render, memoized by id so links,
     activities, and the node sprite itself always agree on where an
     unplaced (no lat/lon) entity sits — computing it independently in each
     builder let the same node land in a different tray slot in each pass,
     visually disconnecting its links from its own sprite. */
  var worldPosCache = {};
  function computeWorldPositions(bbox) {
    worldPosCache = {};
    var domains = activeDomains();
    var trayIndex = {};
    ctx.state.fullGraph.nodes.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (n) {
      var d = n.domain || 'other';
      if (domains.indexOf(d) < 0 || !nodeVisible(n)) return;
      var alt = DOMAIN_ALT[d] * opts.separation;
      var xz;
      if (OSP.geo.hasLatLon(n.geo)) {
        xz = worldXZ(n.geo, bbox);
      } else {
        var i = trayIndex[d] = (trayIndex[d] || 0) + 1;
        xz = { x: -PLANE_W / 2 + 70 + (i - 1) * 90, z: PLANE_D / 2 - 60 };
      }
      worldPosCache[n.id] = { x: xz.x, y: alt + 6, z: xz.z };
    });
  }
  function worldPosOf(id) { return worldPosCache[id] || null; }

  function providerLinkCurve(a, b) {
    var mid = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + Math.abs(a.y - b.y) * 0.25 + 40, (a.z + b.z) / 2);
    return new THREE.QuadraticBezierCurve3(new THREE.Vector3(a.x, a.y, a.z), mid, new THREE.Vector3(b.x, b.y, b.z));
  }

  function buildLinks() {
    clearGroup(group.links);
    var st = ctx.state;
    if (st.layers.links === false) return;
    var phaseId = st.graph.phaseId;
    var finding = currentFinding();
    var fLinks = {};
    if (finding) (finding.affected_link_ids || []).forEach(function (id) { fLinks[id] = 1; });
    var selId = (st.selection && st.selection.type === 'node') ? st.selection.id : null;
    var selLink = (st.selection && st.selection.type === 'link') ? st.selection.id : null;

    st.fullGraph.links.forEach(function (l) {
      var a = st.fullGraph.nodesById[l.source], b = st.fullGraph.nodesById[l.target];
      if (!a || !b) return;
      var pa = worldPosOf(a.id), pb = worldPosOf(b.id);
      if (!pa || !pb) return;
      var active = OSP.model.isActiveInPhase(l, phaseId) && st.graph.nodesById[l.source] && st.graph.nodesById[l.target];
      var cross = (a.domain || 'other') !== (b.domain || 'other');
      var emphasized = selLink === l.id || fLinks[l.id] || (selId && (l.source === selId || l.target === selId));
      var color = emphasized ? HILITE : (cross && opts.crossEmphasis ? (DOMAIN_COLORS[b.domain] || DOMAIN_COLORS.other) : '#3d5266');
      var curve = providerLinkCurve(pa, pb);
      var pts = curve.getPoints(24);
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      var opacity = !active ? 0.05 : (emphasized ? 0.95 : (finding || selId || selLink ? 0.08 : (cross && opts.crossEmphasis ? 0.5 : 0.22)));
      var mat = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: opacity });
      var line = new THREE.Line(geo, mat);
      group.links.add(line);

      if (emphasized && active) {
        var headTex = makeGlowHeadTexture(HILITE);
        var headMat = new THREE.SpriteMaterial({ map: headTex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending });
        var head = new THREE.Sprite(headMat);
        head.scale.set(30, 30, 1);
        var mid = curve.getPoint(0.5);
        head.position.copy(mid);
        group.links.add(head);
        animated.findingHeads.push({ sprite: head, curve: curve, speed: 0.00055, phase: hashPhase(l.id) });
      }
    });
  }

  function buildActivities() {
    clearGroup(group.activities);
    var st = ctx.state;
    if (st.layers.activities === false) return;
    function pos(id) {
      var p = worldPosOf(id);
      return p ? new THREE.Vector3(p.x, p.y, p.z) : null;
    }
    st.scenario.activities.forEach(function (act) {
      if (!OSP.model.activityActiveAt(act, st.t)) return;
      var a = act.source_node_id && pos(act.source_node_id);
      var b = act.target_node_id && pos(act.target_node_id);
      if (!a || !b) return;
      var fade = Math.max(0.25, Math.min(1, Math.min(st.t - act.from_hours, act.to_hours - st.t) / 1.5 + 0.34));
      var color = new THREE.Color(CONTACT_COLORS[act.contact] || '#7ec9ff');
      var mid = new THREE.Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) + 60, (a.z + b.z) / 2);
      var curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      var pts = curve.getPoints(20);
      var geo = new THREE.BufferGeometry().setFromPoints(pts);
      var mat = new THREE.LineDashedMaterial({ color: color, transparent: true, opacity: 0.7 * fade, dashSize: 14, gapSize: 8 });
      var line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      group.activities.add(line);

      var headTex = makeGlowHeadTexture('#' + color.getHexString());
      var headMat = new THREE.SpriteMaterial({ map: headTex, transparent: true, depthTest: false, opacity: fade, blending: THREE.AdditiveBlending });
      var head = new THREE.Sprite(headMat);
      head.scale.set(22, 22, 1);
      head.position.copy(b);
      group.activities.add(head);
      /* Position is driven by the real timeline (act.from/to_hours vs st.t) —
         never by this animation clock. Only scale pulses, so scrubbing time
         stays the single source of truth for "where," while the idle loop
         only adds "this is live" motion on top. */
      animated.activityHeads.push({ sprite: head, baseScale: 22, speed: 2.6, phase: hashPhase(act.id) });
    });
  }

  function currentFinding() {
    var s = ctx.state.selection;
    if (!s || s.type !== 'finding') return null;
    for (var i = 0; i < ctx.state.findings.length; i++) if (ctx.state.findings[i].id === s.id) return ctx.state.findings[i];
    return null;
  }

  /* ================= render loop ================= */

  function render() {
    if (!ctx || !ctx.state.scenario) return;
    if (failed) return;
    if (!ready) { boot(); return; }
    resizeIfNeeded();
    scene.fog.color.set(themeIsLight() ? 0xeef1f5 : 0x0a1016);
    renderer.setClearColor(themeIsLight() ? 0xeef1f5 : 0x0a1016, 1);
    var bbox = geoBBoxKm();
    animated.pulseRings = [];
    animated.findingHeads = [];
    animated.activityHeads = [];
    buildPlanes();
    computeWorldPositions(bbox);
    buildLinks();
    buildActivities();
    buildNodes();
    tickAnimations();   // paint the first frame at a consistent phase, not frozen mid-pulse
    renderer.render(scene, camera);
    ensureFrameLoop();
  }

  function resizeIfNeeded() {
    var w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
    var size = new THREE.Vector2();
    renderer.getSize(size);
    if (Math.round(size.x) !== w || Math.round(size.y) !== h) resize();
  }

  /* Per-frame idle animation: sine-pulsed ring opacity, a glow head traveling
     along each emphasized/finding link's arc, and a pulsing (not moving)
     scale on activity heads. Rebuilds nothing — only touches material
     opacity / sprite position-scale on the objects `render()` already tagged,
     so this stays cheap enough to run every frame. */
  function tickAnimations() {
    var now = animClock() / 1000;
    animated.pulseRings.forEach(function (r) {
      var s = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(now * r.speed + r.phase));
      r.mat.opacity = r.base * s;
    });
    animated.findingHeads.forEach(function (h) {
      var t = (now * h.speed + h.phase / (Math.PI * 2)) % 1;
      h.sprite.position.copy(h.curve.getPoint(t));
    });
    animated.activityHeads.forEach(function (a) {
      var s = 1 + 0.22 * (0.5 + 0.5 * Math.sin(now * a.speed + a.phase));
      a.sprite.scale.set(a.baseScale * s, a.baseScale * s, 1);
    });
    if (group.sky) group.sky.rotation.y = now * 0.003;
  }

  /* One persistent rAF loop drives BOTH idle animation and (when enabled)
     camera auto-orbit, running whenever the stack view is on screen —
     independent of the auto-orbit toggle, which only gates whether the
     camera itself moves. */
  function frameLoop() {
    if (document.body.getAttribute('data-view') !== 'stack') { raf = null; return; }
    if (tween) {
      stepTween();   // a button-triggered camera ease owns theta this frame
    } else if (opts.orbit) {
      orbitState.theta += 0.0022; updateCameraFromOrbit();
    }
    tickAnimations();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frameLoop);
  }
  function ensureFrameLoop() {
    if (!raf) raf = requestAnimationFrame(frameLoop);
  }

  /* ================= export ================= */

  function exportDraw(target, w, h) {
    if (failed || !ready) {
      target.fillStyle = cssVar('--bg0');
      target.fillRect(0, 0, w, h);
      target.fillStyle = cssVar('--fg-dim');
      target.font = '12px ' + cssVar('--sans');
      target.fillText('Stack view unavailable in this browser.', 16, 24);
      return;
    }
    var prevSize = new THREE.Vector2();
    renderer.getSize(prevSize);
    var prevAspect = camera.aspect;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    /* Freeze the idle-animation clock to a fixed instant so two exports of
       the same selection are byte-identical regardless of when in the pulse
       cycle the user happened to click export — reproducible screenshots are
       a product guarantee (see the file header note on hashPhase). */
    clockFrozenAt = 0;
    tickAnimations();
    renderer.render(scene, camera);
    clockFrozenAt = null;
    target.drawImage(renderer.domElement, 0, 0, w, h);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    render();
  }

  OSP.renderStack = {
    init: function (context) {
      ctx = context;
      wrap = document.getElementById('stackCanvas');
      boot();
    },
    render: render,
    fit: fit,
    zoomIn: function () { tweenOrbitTo(Math.max(400, orbitState.radius * 0.72), orbitState.phi, orbitState.theta, orbitState.target, 280); render(); },
    zoomOut: function () { tweenOrbitTo(Math.min(4600, orbitState.radius * 1.35), orbitState.phi, orbitState.theta, orbitState.target, 280); render(); },
    exportDraw: exportDraw,
    activeDomains: activeDomains,
    setDomainHidden: function (d, hidden) { hiddenDomains[d] = !!hidden; render(); },
    setSeparation: function (v) { opts.separation = Math.max(0.35, Math.min(2, v / 110)); render(); },
    setLabels: function (v) { opts.labels = !!v; render(); },
    setCrossEmphasis: function (v) { opts.crossEmphasis = !!v; render(); },
    setOrbit: function (v) { opts.orbit = !!v; ensureFrameLoop(); },
    setEnemyVisible: function (v) { opts.enemyVisible = !!v; render(); },
    isReady: function () { return ready; },
    isFailed: function () { return failed; },
    getBBoxKm: geoBBoxKm,
    getOrbitState: function () { return orbitState; },
    updateCamera: updateCameraFromOrbit,
    getDomainAlt: function (d) { return DOMAIN_ALT[d]; }
  };
})();
