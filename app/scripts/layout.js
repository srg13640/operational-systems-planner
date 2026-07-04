/* OSP layout — deterministic hierarchy and network (force) layouts.
   Ported from the Systems Viz Tool (layoutHierarchy, ensureNetworkLayout,
   kineticEnergy, runToConvergence, runForceTicks). CO-001: layout is a pure
   function of the dataset — seeded placement, synchronous ticks to a
   kinetic-energy plateau, deterministic collision separation. No randomness,
   no clock reads, no timing dependence, so repeated runs and screenshots match.
   Pure module: no DOM access. Attaches to window.OSP.layout. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var MARGIN = 60;          // hierarchy layout margin on all sides (px)
  var NODE_RADIUS = 26;     // assumed node disc radius (px)
  var COLLIDE_PAD = 6;      // extra spacing so symbols never visually fuse
  var EPS = 0.02;           // mean-energy threshold below which motion is negligible
  var STABLE = 8;           // consecutive low-energy ticks required to declare "settled"
  var MAX_TICKS = 600;      // hard cap on force ticks
  var MAX_SEPARATION_PASSES = 50;

  /* ---- Hierarchy layout ----
     Tiered tree layout: roots at the top, children below by hierarchy depth.
     Leaves claim sequential horizontal slots in sorted-id DFS order and each
     parent centers over its children (the source's leaf-index approach,
     transposed from left-to-right tiers to top-to-bottom tiers). Nodes outside
     any hierarchy (roots with no children) form a bottom tier. */
  function layoutHierarchy(graph, width, height) {
    var positions = {};
    if (!graph || !graph.nodes.length) return { positions: positions };

    var innerW = Math.max(1, width - 2 * MARGIN);
    var innerH = Math.max(1, height - 2 * MARGIN);

    var rootIds = graph.roots.slice().sort();
    var treeRoots = [];
    var looseIds = [];
    rootIds.forEach(function (id) {
      if ((graph.children[id] || []).length) treeRoots.push(id);
      else looseIds.push(id);
    });

    var slots = {};    // nodeId -> horizontal slot (leaf-count units)
    var depths = {};   // nodeId -> tier index
    var placed = {};   // cycle guard (normalize cuts cycles, but stay safe)
    var leafIndex = 0;
    var maxDepth = 0;

    function place(id, depth) {
      if (placed[id]) return;
      placed[id] = 1;
      depths[id] = depth;
      if (depth > maxDepth) maxDepth = depth;
      var kids = (graph.children[id] || []).slice().sort().filter(function (kid) {
        return !placed[kid];
      });
      if (!kids.length) {
        slots[id] = leafIndex;
        leafIndex += 1;
        return;
      }
      var sum = 0;
      kids.forEach(function (kid) {
        place(kid, depth + 1);
        sum += slots[kid];
      });
      slots[id] = sum / kids.length;
    }

    treeRoots.forEach(function (id, idx) {
      place(id, 0);
      if (idx < treeRoots.length - 1) leafIndex += 1; // gap slot between trees
    });

    var tierCount = treeRoots.length ? (maxDepth + 1) : 0;
    var bottomTier = -1;
    if (looseIds.length) {
      bottomTier = tierCount;
      tierCount += 1;
    }

    function tierY(tier) {
      if (tierCount <= 1) return MARGIN + innerH / 2;
      return MARGIN + tier * (innerH / (tierCount - 1));
    }

    var slotCount = Math.max(1, leafIndex);
    Object.keys(slots).sort().forEach(function (id) {
      positions[id] = {
        x: MARGIN + (slots[id] + 0.5) * (innerW / slotCount),
        y: tierY(depths[id])
      };
    });
    looseIds.forEach(function (id, i) {
      positions[id] = {
        x: MARGIN + (i + 0.5) * (innerW / looseIds.length),
        y: tierY(bottomTier)
      };
    });

    // Safety net: anything unreached (malformed hierarchy) lands on the bottom edge.
    var missing = [];
    graph.nodes.forEach(function (n) { if (!positions[n.id]) missing.push(n.id); });
    missing.sort().forEach(function (id, i) {
      positions[id] = {
        x: MARGIN + (i + 0.5) * (innerW / missing.length),
        y: height - MARGIN
      };
    });

    return { positions: positions };
  }

  /* ---- Network (force) layout ----
     Seeded circular initial placement by sorted node id, synchronous force
     ticks (spring along links, pairwise repulsion, mild centering) run to a
     kinetic-energy plateau, then a deterministic collision-separation pass so
     no two node discs overlap. pinnedPositions ({ nodeId: {x, y} }) keeps
     those nodes fixed; they exert forces but never move. */
  function layoutNetwork(graph, width, height, pinnedPositions) {
    var positions = {};
    if (!graph || !graph.nodes.length) return { positions: positions, iterations: 0 };
    pinnedPositions = pinnedPositions || {};

    var cx = width / 2;
    var cy = height / 2;

    // Working bodies in sorted-id order: iteration order (and therefore every
    // force accumulation) is a pure function of the dataset.
    var ids = graph.nodes.map(function (n) { return n.id; }).sort();
    var bodies = [];
    var bodiesById = {};
    ids.forEach(function (id, i) {
      var pin = pinnedPositions[id];
      var body;
      if (pin && isFinite(pin.x) && isFinite(pin.y)) {
        body = { id: id, x: pin.x, y: pin.y, vx: 0, vy: 0, pinned: true };
      } else {
        // Seeded placement (ported from ensureNetworkLayout): angle from the
        // sorted index, radius stepped through nine rings. No randomness.
        var angle = (i / Math.max(1, ids.length)) * Math.PI * 2;
        var ring = 120 + (i % 9) * 17;
        body = {
          id: id,
          x: cx + Math.cos(angle) * ring,
          y: cy + Math.sin(angle) * ring,
          vx: 0, vy: 0, pinned: false
        };
      }
      bodies.push(body);
      bodiesById[id] = body;
    });

    // Springs in sorted link-id order for deterministic accumulation.
    var springs = graph.links.slice().sort(function (a, b) {
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });

    var n = bodies.length;
    var minDist = NODE_RADIUS * 2 + COLLIDE_PAD;

    function tick() {
      var i, j, a, b, dx, dy, d2, d, force, limit;
      for (i = 0; i < n; i++) {
        a = bodies[i];
        if (!a.pinned) {
          a.vx += (cx - a.x) * 0.0008;
          a.vy += (cy - a.y) * 0.0008;
        }
        limit = n > 380 ? Math.min(n, i + 80) : n;
        for (j = i + 1; j < limit; j++) {
          b = bodies[j];
          dx = a.x - b.x;
          dy = a.y - b.y;
          d2 = dx * dx + dy * dy + 0.01;
          force = Math.min(1800 / d2, 2.4);
          d = Math.sqrt(d2);
          dx /= d;
          dy /= d;
          if (!a.pinned) { a.vx += dx * force; a.vy += dy * force; }
          if (!b.pinned) { b.vx -= dx * force; b.vy -= dy * force; }
        }
      }
      springs.forEach(function (link) {
        var s = bodiesById[link.source];
        var t = bodiesById[link.target];
        if (!s || !t) return;
        var ldx = t.x - s.x;
        var ldy = t.y - s.y;
        var dist = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
        var desired = 100 + (5 - (link.dependency_strength || 3)) * 12;
        var f = (dist - desired) * 0.010;
        var fx = ldx / dist * f;
        var fy = ldy / dist * f;
        if (!s.pinned) { s.vx += fx; s.vy += fy; }
        if (!t.pinned) { t.vx -= fx; t.vy -= fy; }
      });
      bodies.forEach(function (body) {
        if (body.pinned) return;
        body.vx *= 0.82;
        body.vy *= 0.82;
        body.x += body.vx;
        body.y += body.vy;
      });
      // In-tick collision separation (ported): keeps dense clusters legible
      // while the model settles; the final pass below guarantees zero overlap.
      separationSweep();
    }

    function separationSweep() {
      var i, j, a, b, dx, dy, d, push;
      var moved = false;
      for (i = 0; i < n; i++) {
        a = bodies[i];
        for (j = i + 1; j < n; j++) {
          b = bodies[j];
          if (a.pinned && b.pinned) continue;
          dx = b.x - a.x;
          dy = b.y - a.y;
          d = Math.sqrt(dx * dx + dy * dy);
          if (d >= minDist) continue;
          if (d < 0.000001) {
            // Coincident: separate along a fixed axis (index order), still deterministic.
            dx = 1; dy = 0; d = 1;
          } else {
            dx /= d; dy /= d;
          }
          push = (minDist - d);
          if (a.pinned) {
            b.x += dx * push; b.y += dy * push;
          } else if (b.pinned) {
            a.x -= dx * push; a.y -= dy * push;
          } else {
            a.x -= dx * (push / 2); a.y -= dy * (push / 2);
            b.x += dx * (push / 2); b.y += dy * (push / 2);
          }
          moved = true;
        }
      }
      return moved;
    }

    function kineticEnergy() {
      var e = 0;
      var count = 0;
      bodies.forEach(function (body) {
        if (body.pinned) return;
        e += body.vx * body.vx + body.vy * body.vy;
        count += 1;
      });
      return count ? e / count : 0;
    }

    // Run the force model to a stable resting state (ported runToConvergence).
    var stable = 0;
    var ticks = 0;
    for (; ticks < MAX_TICKS; ticks++) {
      tick();
      if (kineticEnergy() < EPS) {
        stable += 1;
        if (stable >= STABLE) { ticks += 1; break; }
      } else {
        stable = 0;
      }
    }

    // Final deterministic separation: iterate until no discs overlap (or cap).
    for (var pass = 0; pass < MAX_SEPARATION_PASSES; pass++) {
      if (!separationSweep()) break;
    }

    bodies.forEach(function (body) {
      positions[body.id] = { x: body.x, y: body.y };
    });
    return { positions: positions, iterations: ticks };
  }

  OSP.layout = {
    layoutHierarchy: layoutHierarchy,
    layoutNetwork: layoutNetwork
  };
})();
