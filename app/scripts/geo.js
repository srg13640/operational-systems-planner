/* OSP geo — lat/lon <-> basemap-pixel projection and the map viewport
   (pan/zoom) transform. Ported from the FSP 26-2 planning surface v0.7
   coordinate model: world space = basemap pixel space, fixed at the raster
   dimensions regardless of canvas size, so stored coordinates survive window
   resizes, fullscreen toggles, and different displays. Transform stack:
   world -> canvas via contain-fit layout, canvas -> screen via pan+zoom:
   screen = (layout.map.{x,y} + world * s) * k + viewport.{x,y}.
   Pure module: no DOM access. Attaches to window.OSP.geo. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  /* Global equirectangular world space: the full Earth at 60 px/degree
     (NASA Blue Marble topo.bathy, public domain). The raster ships as a local
     tile pyramid under app/lib/basemap/world/ — a 4096x2048 base plus 2700-px
     L1 and 1350-px L2 tiles at this native resolution — because a single
     21600x10800 image would decode to ~900MB of memory. Scenarios may sit
     anywhere on Earth; only lat/lon is ever persisted. */
  var BOUNDS = { lonW: -180, lonE: 180, latN: 90, latS: -90 };
  var WORLD_W = 21600;
  var WORLD_H = 10800;

  var ZOOM_MIN = 1.0;
  /* Zoom ceiling is dynamic: allow up to ~1.4 screen px per world px (≈84 px
     per degree) regardless of canvas size, floor of 8 for tiny canvases. */
  var MAX_EFFECTIVE_SCALE = 1.4;

  function latLonToWorld(lat, lon) {
    var fx = (lon - BOUNDS.lonW) / (BOUNDS.lonE - BOUNDS.lonW);
    var fy = (BOUNDS.latN - lat) / (BOUNDS.latN - BOUNDS.latS);
    return { x: fx * WORLD_W, y: fy * WORLD_H };
  }

  function worldToLatLon(x, y) {
    return {
      lat: BOUNDS.latN - (y / WORLD_H) * (BOUNDS.latN - BOUNDS.latS),
      lon: BOUNDS.lonW + (x / WORLD_W) * (BOUNDS.lonE - BOUNDS.lonW)
    };
  }

  function inBounds(lat, lon) {
    return lat <= BOUNDS.latN && lat >= BOUNDS.latS &&
      lon >= BOUNDS.lonW && lon <= BOUNDS.lonE;
  }

  /* True when a node geo object carries plottable coordinates: numeric
     lat/lon (model normalization leaves null when absent) and not flagged
     non_geographic. */
  function hasLatLon(geo) {
    if (!geo || geo.non_geographic === true) return false;
    return typeof geo.lat === 'number' && isFinite(geo.lat) &&
      typeof geo.lon === 'number' && isFinite(geo.lon);
  }

  function formatLatLon(lat, lon) {
    var latHemi = lat < 0 ? 'S' : 'N';
    var lonHemi = lon < 0 ? 'W' : 'E';
    return Math.abs(lat).toFixed(2) + latHemi + ' ' + Math.abs(lon).toFixed(2) + lonHemi;
  }

  /* Viewport factory. getCanvasSize is a function returning { w, h } in CSS
     pixels. The returned object holds pan/zoom state ({x, y, k}, identity at
     start) on top of the contain-fit basemap. */
  function makeViewport(getCanvasSize) {
    var vp = { x: 0, y: 0, k: 1 };

    /* COVER-FIT — the basemap always fills the canvas; the overflowing axis is
       cropped symmetrically at zoom 1 and reachable by panning. No letterbox
       bars: the map surface owns every pixel of the canvas (the contain-fit
       square crop was the "map feels narrow" complaint). Uniform scale
       s = mapW / WORLD_W. */
    function containLayout() {
      var size = getCanvasSize();
      var w = Math.max(1, size.w);
      var h = Math.max(1, size.h);
      var imgAspect = WORLD_W / WORLD_H;
      var mapW, mapH, mx, my;
      if (w / h > imgAspect) {
        mapW = w; mapH = w / imgAspect;
        mx = 0; my = (h - mapH) / 2;
      } else {
        mapH = h; mapW = h * imgAspect;
        mx = (w - mapW) / 2; my = 0;
      }
      return { x: mx, y: my, w: mapW, h: mapH, s: mapW / WORLD_W };
    }

    function worldToScreen(wx, wy) {
      var m = containLayout();
      return {
        x: (m.x + wx * m.s) * vp.k + vp.x,
        y: (m.y + wy * m.s) * vp.k + vp.y
      };
    }

    function screenToWorld(sx, sy) {
      var m = containLayout();
      return {
        x: ((sx - vp.x) / vp.k - m.x) / m.s,
        y: ((sy - vp.y) / vp.k - m.y) / m.s
      };
    }

    /* Hard pan clamp: the basemap must cover the entire canvas at all times —
       no void is ever exposed at any edge. Cover-fit guarantees the image is
       at least canvas-sized on both axes at k >= 1, so the constraint is
       always satisfiable (opposite-edge corrections cannot conflict). */
    function clampPan() {
      var size = getCanvasSize();
      var tl = worldToScreen(0, 0);
      var br = worldToScreen(WORLD_W, WORLD_H);
      if (tl.x > 0) vp.x -= tl.x;
      else if (br.x < size.w) vp.x += size.w - br.x;
      if (tl.y > 0) vp.y -= tl.y;
      else if (br.y < size.h) vp.y += size.h - br.y;
    }

    function maxZoom() {
      return Math.max(8, MAX_EFFECTIVE_SCALE / containLayout().s);
    }

    /* Zoom about a screen point: take the world point under it, change zoom,
       re-translate so the same world point lands back at (sx, sy). */
    function zoomAbout(sx, sy, factor) {
      var before = screenToWorld(sx, sy);
      vp.k = Math.max(ZOOM_MIN, Math.min(maxZoom(), vp.k * factor));
      var m = containLayout();
      vp.x = sx - (m.x + before.x * m.s) * vp.k;
      vp.y = sy - (m.y + before.y * m.s) * vp.k;
      clampPan();
    }

    function panBy(dx, dy) {
      vp.x += dx;
      vp.y += dy;
      clampPan();
    }

    function fit() {
      vp.x = 0;
      vp.y = 0;
      vp.k = 1;
    }

    /* Compose the full world->screen transform onto the canvas 2d context so
       subsequent draws can use world (basemap-pixel) coordinates. Composes on
       the existing transform (e.g. a devicePixelRatio scale). */
    function applyTo(ctx) {
      var m = containLayout();
      ctx.translate(vp.x + m.x * vp.k, vp.y + m.y * vp.k);
      ctx.scale(m.s * vp.k, m.s * vp.k);
    }

    vp.fit = fit;
    vp.clamp = clampPan;
    vp.containLayout = containLayout;
    vp.worldToScreen = worldToScreen;
    vp.screenToWorld = screenToWorld;
    vp.zoomAbout = zoomAbout;
    vp.panBy = panBy;
    vp.applyTo = applyTo;
    return vp;
  }

  OSP.geo = {
    BOUNDS: BOUNDS,
    WORLD_W: WORLD_W,
    WORLD_H: WORLD_H,
    latLonToWorld: latLonToWorld,
    worldToLatLon: worldToLatLon,
    inBounds: inBounds,
    hasLatLon: hasLatLon,
    formatLatLon: formatLatLon,
    makeViewport: makeViewport
  };
})();
