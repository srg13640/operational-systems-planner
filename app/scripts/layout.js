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
     any hierarchy (roots with no children) form a bottom tier.
     opts.minSlotWidth / opts.tierHeight (px) let a labelled chart grow past the given box
     instead of crushing leaves together; the caller fits the result to the screen. */
  function layoutHierarchy(graph, width, height, opts) {
    var positions = {};
    if (!graph || !graph.nodes.length) return { positions: positions };
    opts = opts || {};

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

    var slotCount = Math.max(1, leafIndex);
    var slotW = Math.max(innerW / slotCount, opts.minSlotWidth || 0);
    var looseW = Math.max(innerW / Math.max(1, looseIds.length), opts.minSlotWidth || 0);
    var chartW = Math.max(slotW * slotCount, looseW * looseIds.length, innerW);
    var tierGap = tierCount <= 1 ? 0 : Math.max(innerH / (tierCount - 1), opts.tierHeight || 0);

    function tierY(tier) {
      if (tierCount <= 1) return MARGIN + innerH / 2;
      return MARGIN + tier * tierGap;
    }

    // centre both the tree row block and the loose row within the wider of the two
    var treeX0 = MARGIN + (chartW - slotW * slotCount) / 2;
    var looseX0 = MARGIN + (chartW - looseW * looseIds.length) / 2;
    Object.keys(slots).sort().forEach(function (id) {
      positions[id] = {
        x: treeX0 + (slots[id] + 0.5) * slotW,
        y: tierY(depths[id])
      };
    });
    looseIds.forEach(function (id, i) {
      positions[id] = {
        x: looseX0 + (i + 0.5) * looseW,
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
     those nodes fixed; they exert forces but never move. opts.spacing (default 1) scales
     rest lengths, repulsion, and the collision radius together, so a labelled diagram can
     breathe without changing the shape the forces settle into. */
  function layoutNetwork(graph, width, height, pinnedPositions, opts) {
    var positions = {};
    if (!graph || !graph.nodes.length) return { positions: positions, iterations: 0 };
    pinnedPositions = pinnedPositions || {};
    var spacing = (opts && opts.spacing > 0) ? opts.spacing : 1;
    var parkIsolates = !!(opts && opts.parkIsolates);

    var cx = width / 2;
    var cy = height / 2;

    // Nodes with no relationship in this view have nothing to say about where they sit; the
    // force model would fling them to the rim in id order. Park them in a lane below the
    // connected diagram instead (opts.parkIsolates), so the eye reads "these are here but
    // unconnected" rather than "these were placed there".
    var degree = {};
    graph.links.forEach(function (l) { degree[l.source] = (degree[l.source] || 0) + 1; degree[l.target] = (degree[l.target] || 0) + 1; });
    var allIds = graph.nodes.map(function (n) { return n.id; }).sort();
    var isolates = [];
    var ids = allIds.filter(function (id) {
      if (parkIsolates && !degree[id] && !pinnedPositions[id]) { isolates.push(id); return false; }
      return true;
    });
    if (!ids.length) { ids = isolates; isolates = []; }

    // Working bodies in sorted-id order: iteration order (and therefore every
    // force accumulation) is a pure function of the dataset.
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
    var minDist = (NODE_RADIUS * 2 + COLLIDE_PAD) * spacing;
    var repulsion = 1800 * spacing * spacing;

    /* Room the parked isolates will need under the diagram, so the connected part is shaped
       for the space that remains. */
    var laneRows = isolates.length ? Math.ceil(isolates.length / Math.max(1, Math.floor(width / (minDist * 1.9)))) : 0;
    var laneH = laneRows ? minDist * 2.6 + (laneRows - 1) * minDist * 1.9 : 0;
    var targetAspect = width / Math.max(1, height - laneH);
    // centering pull is anisotropic: weaker along the long axis of the box, so the resting
    // shape is an ellipse in the box's aspect rather than a disc
    var gx = 0.0008 / Math.sqrt(targetAspect), gy = 0.0008 * Math.sqrt(targetAspect);

    function tick() {
      var i, j, a, b, dx, dy, d2, d, force, limit;
      for (i = 0; i < n; i++) {
        a = bodies[i];
        if (!a.pinned) {
          a.vx += (cx - a.x) * gx;
          a.vy += (cy - a.y) * gy;
        }
        limit = n > 380 ? Math.min(n, i + 80) : n;
        for (j = i + 1; j < limit; j++) {
          b = bodies[j];
          dx = a.x - b.x;
          dy = a.y - b.y;
          d2 = dx * dx + dy * dy + 0.01;
          force = Math.min(repulsion / d2, 2.4);
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
        var desired = (100 + (5 - (link.dependency_strength || 3)) * 12) * spacing;
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

    /* The forces settle into a round blob whatever the box. Stretch the free bodies about
       the centre so the diagram's aspect approaches the box's (a wide canvas gets a wide
       diagram and labels get horizontal room). Capped so nothing looks squeezed; pinned
       bodies stay exactly where the author put them. */
    var free = bodies.filter(function (b) { return !b.pinned; });
    if (free.length > 2 && width > 0 && height > 0) {
      var bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      free.forEach(function (b) { bx0 = Math.min(bx0, b.x); bx1 = Math.max(bx1, b.x); by0 = Math.min(by0, b.y); by1 = Math.max(by1, b.y); });
      var bw = Math.max(1, bx1 - bx0), bh = Math.max(1, by1 - by0);
      var want = targetAspect, have = bw / bh;
      var mx = (bx0 + bx1) / 2, my = (by0 + by1) / 2;
      if (have < want) {
        var sx = Math.min(2.0, want / have);
        free.forEach(function (b) { b.x = mx + (b.x - mx) * sx; });
      } else if (have > want) {
        var sy = Math.min(2.0, have / want);
        free.forEach(function (b) { b.y = my + (b.y - my) * sy; });
      }
      for (var pass2 = 0; pass2 < MAX_SEPARATION_PASSES; pass2++) {
        if (!separationSweep()) break;
      }
    }

    bodies.forEach(function (body) {
      positions[body.id] = { x: body.x, y: body.y };
    });

    // Parked isolates: a row (wrapping) under the connected diagram, in sorted-id order.
    if (isolates.length) {
      var lx0 = Infinity, lx1 = -Infinity, ly1 = -Infinity;
      bodies.forEach(function (b) { lx0 = Math.min(lx0, b.x); lx1 = Math.max(lx1, b.x); ly1 = Math.max(ly1, b.y); });
      var gap = minDist * 1.9;
      var span = Math.max(lx1 - lx0, gap * Math.min(isolates.length, 6));
      var perRow = Math.max(1, Math.floor(span / gap) + 1);
      var rowW = (Math.min(perRow, isolates.length) - 1) * gap;
      var startX = (lx0 + lx1) / 2 - rowW / 2;
      isolates.forEach(function (id, i) {
        var row = Math.floor(i / perRow), col = i % perRow;
        positions[id] = { x: startX + col * gap, y: ly1 + minDist * 2.6 + row * minDist * 1.9 };
      });
    }
    return { positions: positions, iterations: ticks };
  }

  OSP.layout = {
    layoutHierarchy: layoutHierarchy,
    layoutNetwork: layoutNetwork
  };
})();
