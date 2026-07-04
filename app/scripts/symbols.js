/* OSP symbols — FM 1-02.2 unit symbology (canvas renderer) plus compact
   glyphs for non-unit node types. Ported from the FSP 26-2 planning surface
   (UNIT_TYPES table + unitSvgInner), converted from SVG markup to canvas 2D
   primitives. Pure module: no DOM access. Attaches to window.OSP.symbols. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  /* Design space ported from the source's unitSvgInner: a 42 x 30 frame box
     (ratio 1.4:1, close to the doctrinal 1.5:1) centered at (0,0). Branch
     symbols assume a clear interior of roughly 28 x 16 and stay upright even
     inside a diamond (enemy) frame. drawUnitSymbol scales this design space
     uniformly by opts.size / 42. */
  var FRAME_W = 42;
  var FRAME_H = 30;

  /* ---- Branch symbols (FM 1-02.2 / NATO APP-6) ----
     Source: FM 1-02.2 (Feb 2024), Table 2-7 "Main function symbols for
     units." Each entry: { label, primitives } where primitives carry the
     source SVG data as canvas-friendly records:
       { kind: 'path', d: <absolute M/L/Q/Z SVG path data> }
       { kind: 'circle', cx, cy, r } / { kind: 'ellipse', cx, cy, rx, ry }
     fill: true renders the primitive filled in the symbol color (FA dot,
     AVN bowtie, AR / MECH oval); otherwise stroked only. width overrides the
     default 1.6 design-unit stroke. */
  var UNIT_TYPES = {
    none: { label: '-', primitives: [] },
    /* Infantry — two crossed diagonals. */
    infantry: {
      label: 'INF',
      primitives: [{ kind: 'path', d: 'M -10,-7 L 10,7 M -10,7 L 10,-7' }]
    },
    /* Armor (tracked) — filled horizontal oval. */
    armor: {
      label: 'AR',
      primitives: [{ kind: 'ellipse', cx: 0, cy: 0, rx: 11, ry: 5.5, fill: true }]
    },
    /* Mechanized infantry — armor oval crossed by infantry X. */
    mech_infantry: {
      label: 'MECH',
      primitives: [
        { kind: 'ellipse', cx: 0, cy: 0, rx: 11, ry: 5.5, fill: true },
        { kind: 'path', d: 'M -10,-7 L 10,7 M -10,7 L 10,-7' }
      ]
    },
    /* Cavalry / reconnaissance — single diagonal slash (lower-left to
       upper-right). */
    cavalry: {
      label: 'CAV',
      primitives: [{ kind: 'path', d: 'M -12,7 L 12,-7' }]
    },
    /* Field artillery — solid filled center dot. */
    artillery: {
      label: 'FA',
      primitives: [{ kind: 'circle', cx: 0, cy: 0, r: 3.6, fill: true }]
    },
    /* Air defense artillery — arc opening downward (umbrella protecting
       from air). */
    ada: {
      label: 'ADA',
      primitives: [{ kind: 'path', d: 'M -9,5 Q 0,-8 9,5', width: 1.8 }]
    },
    /* Army aviation (rotary wing) — bowtie of two filled triangles meeting
       at center. */
    aviation: {
      label: 'AVN',
      primitives: [{ kind: 'path', d: 'M -11,-6 L 0,0 L -11,6 Z M 11,-6 L 0,0 L 11,6 Z', fill: true }]
    },
    /* Engineer — two open-bottom brackets side by side. */
    engineer: {
      label: 'EN',
      primitives: [{ kind: 'path', d: 'M -8,6 L -8,-5 L -2,-5 L -2,6 M 2,6 L 2,-5 L 8,-5 L 8,6' }]
    },
    /* Signal — single asymmetric lightning bolt. */
    signal: {
      label: 'SIG',
      primitives: [{ kind: 'path', d: 'M -10,-4 L -1,3 L -3,5 L 10,-3', width: 1.8 }]
    },
    /* Transportation — wheel with spokes. FM 1-02.2 uses plain "SUST" text
       for the Sustainment branch as a whole, so Transportation's actual
       pictogram is used instead of an invented sustainment symbol. */
    transportation: {
      label: 'TRANS',
      primitives: [
        { kind: 'circle', cx: 0, cy: 0, r: 6.5 },
        { kind: 'path', d: 'M -6.5,0 L 6.5,0 M 0,-6.5 L 0,6.5 M -4.6,-4.6 L 4.6,4.6 M -4.6,4.6 L 4.6,-4.6', width: 1.1 }
      ]
    },
    /* Mortar — vertical arrow over small open circle (organic indirect
       fire). */
    mortar: {
      label: 'MOR',
      primitives: [
        { kind: 'circle', cx: 0, cy: 3.5, r: 2.4 },
        { kind: 'path', d: 'M 0,1.1 L 0,-7 M -3,-4 L 0,-7 L 3,-4' }
      ]
    }
  };

  /* Trace absolute SVG path data onto a canvas 2D context. The ported symbol
     table uses only M / L / Q / Z with absolute "x,y" coordinate tokens. */
  function tracePath(ctx, d) {
    var tokens = d.split(/\s+/).filter(function (t) { return t.length > 0; });
    var i = 0;
    var p, c, e;
    while (i < tokens.length) {
      var cmd = tokens[i];
      i += 1;
      if (cmd === 'M') {
        p = readPoint(tokens[i]); i += 1;
        ctx.moveTo(p.x, p.y);
      } else if (cmd === 'L') {
        p = readPoint(tokens[i]); i += 1;
        ctx.lineTo(p.x, p.y);
      } else if (cmd === 'Q') {
        c = readPoint(tokens[i]);
        e = readPoint(tokens[i + 1]);
        i += 2;
        ctx.quadraticCurveTo(c.x, c.y, e.x, e.y);
      } else if (cmd === 'Z') {
        ctx.closePath();
      }
    }
  }

  function readPoint(token) {
    var parts = token.split(',');
    return { x: parseFloat(parts[0]), y: parseFloat(parts[1]) };
  }

  /* Render one unit symbol on a canvas 2D context.
     opts = { x, y (center), size (frame width px), side, branch,
              echelon_mark, hq, cp, designation, color }.
     Friendly / Neutral / Unknown = rectangle frame; Enemy = diamond frame.
     Echelon mark centers above the frame, designation below, CP amplifier
     text (FM 1-02.2 Field G) at the right side, HQ staff line hangs from the
     lower-left corner. Legible at 28-44 px frame widths. */
  function drawUnitSymbol(ctx, opts) {
    var x = opts.x;
    var y = opts.y;
    var size = opts.size || FRAME_W;
    var scale = size / FRAME_W;
    var color = opts.color || '#4d7fb8';
    var enemy = opts.side === 'Enemy';

    /* Rect frame inset ported from the source: 38 x 24 inside the 42 x 30
       design box. Hostile diamond is a true square rotated 45 degrees
       (FM 1-02.2 / MIL-STD-2525); the largest that fits with a 2 px stroke
       inset is height-limited: half-diagonal = H/2 - 2. */
    var halfW = (FRAME_W / 2 - 2) * scale;
    var halfH = (FRAME_H / 2 - 3) * scale;
    var diag = (FRAME_H / 2 - 2) * scale;
    var frameTop = enemy ? diag : halfH;
    var frameBottom = enemy ? diag : halfH;
    var frameRight = enemy ? diag : halfW;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Frame
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (enemy) {
      ctx.moveTo(x, y - diag);
      ctx.lineTo(x + diag, y);
      ctx.lineTo(x, y + diag);
      ctx.lineTo(x - diag, y);
      ctx.closePath();
    } else {
      ctx.rect(x - halfW, y - halfH, halfW * 2, halfH * 2);
    }
    ctx.stroke();

    // HQ staff line (FM 1-02.2: vertical line from the frame's lower-left).
    if (opts.hq) {
      var staffX = enemy ? x - diag : x - halfW;
      var staffTop = enemy ? y : y + halfH;
      ctx.beginPath();
      ctx.moveTo(staffX, staffTop);
      ctx.lineTo(staffX, staffTop + size * 0.5);
      ctx.stroke();
    }

    // Branch symbol (Table 2-7 pictogram) inside the frame, in unit color.
    var branch = UNIT_TYPES[opts.branch] || UNIT_TYPES.none;
    if (branch.primitives.length) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      branch.primitives.forEach(function (prim) {
        ctx.beginPath();
        if (prim.kind === 'path') tracePath(ctx, prim.d);
        else if (prim.kind === 'circle') ctx.arc(prim.cx, prim.cy, prim.r, 0, Math.PI * 2);
        else if (prim.kind === 'ellipse') ctx.ellipse(prim.cx, prim.cy, prim.rx, prim.ry, 0, 0, Math.PI * 2);
        if (prim.fill) {
          ctx.fill();
        } else {
          ctx.lineWidth = prim.width || 1.6;
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    // Amplifier text fields, scaled off the frame size.
    var echFont = Math.max(9, Math.round(size * 0.28));
    var ampFont = Math.max(8, Math.round(size * 0.24));
    if (opts.echelon_mark) {
      ctx.font = echFont + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(opts.echelon_mark, x, y - frameTop - 2);
    }
    if (opts.designation) {
      ctx.font = ampFont + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(opts.designation, x, y + frameBottom + 3);
    }
    if (opts.cp) {
      ctx.font = ampFont + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.cp, x + frameRight + 4, y);
    }
    ctx.restore();
  }

  /* Compact ASCII glyphs for non-unit node types in the graph view. */
  var NODE_GLYPHS = {
    unit: 'UNIT',
    headquarters: 'HQ',
    command_post: 'CP',
    directorate: 'DIR',
    office: 'OFC',
    system: 'SYS',
    platform: 'PLT',
    sensor: 'SNR',
    shooter: 'SHTR',
    network: 'NET',
    application: 'APP',
    database: 'DB',
    data_feed: 'FEED',
    satellite: 'SAT',
    ground_station: 'GS',
    relay: 'RLY',
    person_role: 'ROLE',
    process: 'PROC',
    location: 'LOC',
    facility: 'FAC',
    logistics_node: 'LOG',
    other: 'NODE'
  };

  function nodeGlyph(nodeType) {
    if (NODE_GLYPHS[nodeType]) return NODE_GLYPHS[nodeType];
    var s = String(nodeType || '').replace(/[^A-Za-z0-9]+/g, ' ').trim();
    if (!s) return '?';
    return s.slice(0, 3).toUpperCase();
  }

  /* ---- MIL-STD-2525C symbology via vendored milsymbol (app/lib/milsymbol,
     MIT). SIDC letter codes below were validated against milsymbol 2.2.0
     (validIcon true for every entry). When window.ms is unavailable (headless
     tests) or a node has no 2525 mapping, callers fall back to drawUnitSymbol
     / circle markers, so the app never depends on the library to boot. ---- */

  var AFFILIATION_CHAR = { Friendly: 'F', Enemy: 'H', Neutral: 'N', Unknown: 'U' };

  /* FM 1-02.2 branch -> 2525C function id (SIDC chars 5-10), land-unit dim. */
  var BRANCH_FUNCTION = {
    infantry: 'UCI---', armor: 'UCA---', mech_infantry: 'UCIZ--', cavalry: 'UCR---',
    artillery: 'UCF---', ada: 'UCD---', aviation: 'UCV---', engineer: 'UCE---',
    signal: 'UUS---', transportation: 'UST---', mortar: 'UCFM--', none: 'U-----'
  };

  /* Echelon amplifier mark -> SIDC char 12. */
  var ECHELON_CHAR = {
    'I': 'E', 'II': 'F', 'III': 'G', 'X': 'H', 'XX': 'I', 'XXX': 'J', 'XXXX': 'K'
  };

  /* Build a 15-char 2525C SIDC for a node, or return null for node types that
     read better as analytic circle markers (pure software/data/process nodes,
     where criticality color is the load-bearing signal). */
  function sidcForNode(node) {
    if (node.symbol && node.symbol.sidc) return node.symbol.sidc;
    var aff = AFFILIATION_CHAR[node.side] || 'U';
    var type = node.node_type;
    var dim = 'G';
    var fn = null;
    var mod1 = '-';   // char 11: A = headquarters, H = installation
    var mod2 = '-';   // char 12: echelon

    if (type === 'satellite') { dim = 'P'; fn = 'S-----'; }
    else if (type === 'platform' && node.domain === 'maritime') { dim = 'S'; fn = '------'; }
    else if (type === 'unit' || type === 'shooter' || type === 'platform') {
      fn = BRANCH_FUNCTION[(node.symbol && node.symbol.branch_type) || 'none'] || 'U-----';
      if (type === 'shooter' && fn === 'U-----') fn = 'UCFR--';           // rocket artillery
      if (type === 'platform' && node.domain === 'air') fn = 'UCVF--';    // fixed-wing aviation
      if (fn === 'U-----' && node.domain === 'ems') fn = 'UUMSE-';        // electronic warfare
    }
    else if (type === 'headquarters' || type === 'command_post') { fn = 'U-----'; mod1 = 'A'; }
    else if (type === 'ground_station' || type === 'relay' || type === 'network') { fn = 'UUS---'; }
    else if (type === 'sensor') { fn = 'ESR---'; }
    else if (type === 'logistics_node' || type === 'facility') { fn = 'IB----'; mod1 = 'H'; }
    else if (type === 'location') { fn = 'I-----'; mod1 = 'H'; }
    else return null;   // system/application/database/data_feed/process/person_role/office...

    if (node.symbol) {
      if (node.symbol.hq && mod1 === '-') mod1 = 'A';
      var ech = ECHELON_CHAR[node.symbol.echelon_mark];
      if (ech && mod1 !== 'H' && dim === 'G' &&
        (type === 'unit' || type === 'headquarters' || type === 'command_post' || type === 'shooter' || type === 'platform')) {
        mod2 = ech;
      }
    }
    fn = (fn + '------').slice(0, 6);
    return 'S' + aff + dim + 'P' + fn + mod1 + mod2;
  }

  /* Cached milsymbol canvas renderer. Returns true when a 2525 symbol was
     drawn at (x, y) — anchored on the symbol's octagon anchor — else false
     so the caller can fall back to the legacy renderer. */
  var symbolCache = {};
  function drawNodeSymbol2525(ctx, node, x, y, size) {
    if (typeof window === 'undefined' || !window.ms || !window.ms.Symbol) return false;
    var sidc = sidcForNode(node);
    if (!sidc) return false;
    var key = sidc + '|' + size;
    var entry = symbolCache[key];
    if (entry === undefined) {
      try {
        var sym = new window.ms.Symbol(sidc, {
          size: size,
          outlineColor: 'rgba(6,10,16,0.85)',
          outlineWidth: 2
        });
        entry = { canvas: sym.asCanvas(), anchor: sym.getAnchor() };
      } catch (e) {
        entry = null;
      }
      symbolCache[key] = entry;
    }
    if (!entry || !entry.canvas || !entry.canvas.width) return false;
    ctx.drawImage(entry.canvas, x - entry.anchor.x, y - entry.anchor.y);
    return true;
  }

  function clearSymbolCache() { symbolCache = {}; }

  OSP.symbols = {
    UNIT_TYPES: UNIT_TYPES,
    drawUnitSymbol: drawUnitSymbol,
    nodeGlyph: nodeGlyph,
    sidcForNode: sidcForNode,
    drawNodeSymbol2525: drawNodeSymbol2525,
    clearSymbolCache: clearSymbolCache
  };
})();
