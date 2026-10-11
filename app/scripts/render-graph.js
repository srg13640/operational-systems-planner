/* OSP graph view — SVG renderer for every graph-surface view: the DoDAF OV-2 / OV-4 / SV-1 /
   SV-2 models and the fit-for-purpose dependency graph. The view definition (OSP.dodaf) decides
   which entities and relationships appear; this module only draws. Layout runs on the view's
   structural subset (stable across time scrub); entities outside the active phase render dimmed.
   Pinned positions are kept per view, so a system can sit in one place on SV-1 and another on
   OV-2. Attaches to window.OSP.renderGraph. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var LOGICAL_W = 1600;
  var LOGICAL_H = 1000;

  var svg, gRoot, gTree, gChains, gLinks, gNodes;
  var ctx = null;
  var view = { x: 0, y: 0, k: 1 };
  var positions = {};
  var layoutKey = '';
  var drag = null; // { kind: 'pan'|'node', ... }

  var DOMAIN_COLORS = {
    c2: '#567c9f', strike: '#a85d51', sustain: '#667f6d', space: '#786985',
    air: '#658993', ems: '#9a7a4f', cyber: '#756b8f', land: '#74808a',
    maritime: '#4f7895', data: '#8d7b50', other: '#6e7a84'
  };

  function cssVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || '#888';
  }

  function rampColor(score) {
    if (score >= 90) return cssVar('--ramp4');
    if (score >= 75) return cssVar('--ramp3');
    if (score >= 50) return cssVar('--ramp2');
    if (score >= 25) return cssVar('--ramp1');
    return cssVar('--ramp0');
  }

  function statusColor(status) {
    if (status === 'Offline') return cssVar('--crit');
    if (status === 'Degraded') return cssVar('--warn');
    if (status === 'Planned') return cssVar('--fg-dim');
    return cssVar('--ok');
  }

  function sideStroke(side) {
    if (side === 'Enemy') return cssVar('--enemy');
    if (side === 'Neutral') return cssVar('--neutral');
    if (side === 'Unknown') return cssVar('--unknown');
    return cssVar('--friendly');
  }

  /* ---- view / lens ---- */

  function archView() { return ctx.state.archView; }

  /* The criticality lens is always on for the dependency graph (that is what it is for) and
     opt-in on the architecture views, which default to a plain, neutral rendering. */
  function lensOn() {
    var v = archView();
    return !v || v.id === 'graph' || !!ctx.state.archLens;
  }

  function isContext(node) {
    var v = archView();
    return !!(v && v.contextOf && v.contextOf[node.id]);
  }

  /* Shape per DoDAF convention: performers as rounded boxes, systems as rectangles; the
     dependency graph keeps its circles. */
  function nodeShape(node) {
    var v = archView();
    if (!v || v.id === 'graph') return 'circle';
    var cls = v.classOf[node.id];
    if (cls === 'performer') return 'rounded';
    if (cls === 'system') return 'rect';
    return 'circle';
  }

  function nodeFill(node) {
    if (!lensOn()) {
      if (isContext(node)) return cssVar('--bg2');
      var cls = archView().classOf[node.id];
      if (cls === 'performer') return cssVar('--bg3');
      if (cls === 'system') return cssVar('--bg2');
      return cssVar('--bg3');
    }
    var mode = ctx.state.colorBy;
    if (mode === 'criticality') {
      return (node.metrics && node.metrics.criticality_score !== undefined && isNodeActive(node))
        ? rampColor(node.metrics.criticality_score) : cssVar('--ramp0');
    }
    if (mode === 'status') {
      var g = ctx.state.graph;
      var st = isNodeActive(node) ? g.statusOf(node) : node.status;
      return statusColor(st);
    }
    return DOMAIN_COLORS[node.domain] || DOMAIN_COLORS.other;
  }

  function nodeRadius(node) {
    if (!lensOn()) return isContext(node) ? 15 : 21;
    var s = (node.metrics && isNodeActive(node)) ? node.metrics.criticality_score : 0;
    return 15 + (s / 100) * 11;
  }

  function glyphFill() {
    return lensOn() ? '#0a1017' : cssVar('--fg');
  }

  function isNodeActive(node) {
    return !!ctx.state.graph.nodesById[node.id];
  }

  /* Derived needlines are not scenario links; they are active when every node on their path is. */
  function isLinkActive(link) {
    var g = ctx.state.graph;
    if (link.derived) {
      if (!g.nodesById[link.source] || !g.nodesById[link.target]) return false;
      for (var v = 0; v < link.via.length; v++) if (!g.nodesById[link.via[v]]) return false;
      return true;
    }
    for (var i = 0; i < g.links.length; i++) if (g.links[i].id === link.id) return true;
    return false;
  }

  /* ---- layout ---- */

  function layoutMode() {
    var v = archView();
    if (!v || v.id === 'graph') return ctx.state.graphMode;
    return v.def.layout || 'network';
  }

  /* Layout box: the logical area, in the aspect of the canvas at the moment the layout is
     built (a view change rebuilds; opening the inspector or resizing the window must not —
     the diagram the user is looking at never rearranges under them). */
  function layoutBox() {
    var w = (svg && svg.clientWidth) || LOGICAL_W, h = (svg && svg.clientHeight) || LOGICAL_H;
    var aspect = Math.max(0.6, Math.min(2.6, Math.round((w / Math.max(1, h)) * 10) / 10));
    var area = LOGICAL_W * LOGICAL_H;
    return { w: Math.sqrt(area * aspect), h: Math.sqrt(area / aspect), aspect: aspect };
  }

  function ensureLayout() {
    var st = ctx.state;
    var v = archView();
    var key = st.scenarioRev + ':' + (v ? v.id : 'graph') + ':' + layoutMode() + ':' +
      (v ? v.nodes.length + '/' + v.links.length : '');
    if (key === layoutKey) return;
    layoutKey = key;
    var box = layoutBox();
    var graph = v || st.fullGraph;
    var pinned = {};
    var gp = OSP.model.viewPositions(st.scenario, v ? v.id : 'graph');
    Object.keys(gp).forEach(function (id) {
      if (gp[id] && gp[id].pinned && graph.nodesById[id]) pinned[id] = { x: gp[id].x, y: gp[id].y };
    });
    // Architecture views carry labels as first-class content, so they get more room than the
    // analysis graph; the dependency graph keeps its original, denser layout.
    var arch = v && v.id !== 'graph';
    var res = (layoutMode() === 'hierarchy')
      ? OSP.layout.layoutHierarchy(graph, box.w, box.h, arch ? { minSlotWidth: 128, tierHeight: 150 } : undefined)
      : OSP.layout.layoutNetwork(graph, box.w, box.h, pinned, { spacing: arch ? 1.45 : 1, parkIsolates: true });
    positions = res.positions;
  }

  /* Labels wrap to two lines on the architecture views so long unit and system names stop
     colliding with their neighbours; the dependency graph keeps single-line labels. */
  function labelLines(name) {
    var v = archView();
    var s = String(name || '');
    if (!v || v.id === 'graph' || s.length <= 18) return [s];
    var words = s.split(/\s+/), a = '', b = '';
    for (var i = 0; i < words.length; i++) {
      if ((a + ' ' + words[i]).trim().length <= Math.max(14, Math.ceil(s.length / 2) + 2) && !b) a = (a + ' ' + words[i]).trim();
      else b = (b + ' ' + words[i]).trim();
    }
    if (!b) return [a];
    if (b.length > 24) b = b.slice(0, 23) + '…';
    return [a, b];
  }

  /* ---- link geometry: parallel-edge offsets ---- */

  function linkGroups(links) {
    var groups = {};
    links.forEach(function (l) {
      var key = l.source < l.target ? l.source + '|' + l.target : l.target + '|' + l.source;
      (groups[key] = groups[key] || []).push(l);
    });
    return groups;
  }

  /* Distance from a node's centre to its outline along a unit direction, plus a hair of air,
     so link ends (and their arrowheads) sit on the boundary instead of under the symbol. */
  function nodeExtent(id, ux, uy) {
    var graph = archView() || ctx.state.fullGraph;
    var n = graph.nodesById[id];
    if (!n) return 0;
    var r = nodeRadius(n);
    if (nodeShape(n) === 'circle') return r + 2;
    var hw = r * 1.3, hh = r * 0.85;
    var ax = Math.abs(ux), ay = Math.abs(uy);
    var t = Math.min(ax > 1e-6 ? hw / ax : Infinity, ay > 1e-6 ? hh / ay : Infinity);
    return (isFinite(t) ? t : r) + 2;
  }

  function linkGeom(l, index, count) {
    var a0 = positions[l.source], b0 = positions[l.target];
    if (!a0 || !b0) return null;
    var dx = b0.x - a0.x, dy = b0.y - a0.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var offset = (index - (count - 1) / 2) * 22;
    var mx = (a0.x + b0.x) / 2 - (dy / len) * offset;
    var my = (a0.y + b0.y) / 2 + (dx / len) * offset;
    // trim both ends to the node outlines, along the curve's end tangents
    var ax = mx - a0.x, ay = my - a0.y, al = Math.sqrt(ax * ax + ay * ay) || 1;
    var bx = mx - b0.x, by = my - b0.y, bl = Math.sqrt(bx * bx + by * by) || 1;
    var ea = Math.min(nodeExtent(l.source, ax / al, ay / al), len * 0.45);
    var eb = Math.min(nodeExtent(l.target, bx / bl, by / bl), len * 0.45);
    var a = { x: a0.x + ax / al * ea, y: a0.y + ay / al * ea };
    var b = { x: b0.x + bx / bl * eb, y: b0.y + by / bl * eb };
    return { a: a, b: b, mx: mx, my: my,
      // point on the quadratic at t=0.5 — where a label sits
      lx: 0.25 * a.x + 0.5 * mx + 0.25 * b.x, ly: 0.25 * a.y + 0.5 * my + 0.25 * b.y };
  }

  function linkPath(l, index, count) {
    var g = linkGeom(l, index, count);
    if (!g) return '';
    return 'M' + g.a.x + ',' + g.a.y + ' Q' + g.mx + ',' + g.my + ' ' + g.b.x + ',' + g.b.y;
  }

  function commDash(method) {
    if (method === 'Courier' || method === 'Voice') return '2,5';
    if (method === 'SATCOM' || method === 'UHF/VHF/HF Radio' || method === 'Microwave' ||
        method === 'Mesh' || method === 'Tactical Data Link' || method === 'LTE/5G') return '7,4';
    return '';
  }

  /* Dash is an epistemic token on the architecture views: dashed = derived (inferred, not
     recorded), dotted = OV-4 relationship drawn over the hierarchy. Transport method is text,
     not line style, there. The analysis graph keeps its method dashes. */
  function linkDash(l) {
    if (l.derived) return '5,4';
    var v = archView();
    if (v && v.id === 'ov4') return '2,4';
    if (v && v.id !== 'graph') return '';
    return commDash(l.communication_method);
  }

  /* Text shown on a link when link labels are on (SV-2 always labels its resource flows).
     OV-2 needlines and SV-1 interfaces are labelled with the resource they carry — that is
     what the exchange IS; the relationship verb is the fallback when no resource is named.
     SV-2 is the communications view: transport method, protocol, bandwidth. */
  function linkLabelText(l) {
    var v = archView();
    if (l.derived) {
      var names = l.via.map(function (id) { var n = v.nodesById[id] || ctx.state.fullGraph.nodesById[id]; return n ? n.name : id; });
      return (l.resource ? l.resource + ' ' : '') + 'via ' + names.join(', ');
    }
    var verb = l.relationship_type.replace(/_/g, ' ');
    if (v && v.id === 'sv2') {
      var t = l.communication_method && l.communication_method !== 'Other' ? l.communication_method : verb;
      if (l.protocol) t += ' · ' + l.protocol;
      if (l.bandwidth) t += ' · ' + l.bandwidth;
      return t;
    }
    if (v && (v.id === 'ov2' || v.id === 'sv1')) return l.resource || verb;
    return verb;
  }

  function showLinkLabels() {
    var v = archView();
    if (v && v.id === 'sv2') return true;
    return !!ctx.state.layers.linkLabels;
  }

  /* Orthogonal elbow connector for the OV-4 command tree. */
  function treePath(pid, cid) {
    var a = positions[pid], b = positions[cid];
    if (!a || !b) return '';
    var midY = (a.y + b.y) / 2;
    return 'M' + a.x + ',' + a.y + ' L' + a.x + ',' + midY + ' L' + b.x + ',' + midY + ' L' + b.x + ',' + b.y;
  }

  /* ---- selection helpers ---- */

  function selectedNodeId() {
    var s = ctx.state.selection;
    return (s && s.type === 'node') ? s.id : null;
  }

  function neighborSet(nodeId, hops) {
    var graph = archView() || ctx.state.fullGraph;
    var seen = {};
    seen[nodeId] = 0;
    var frontier = [nodeId];
    for (var h = 1; h <= hops; h++) {
      var next = [];
      frontier.forEach(function (id) {
        (graph.adjacency[id] || []).forEach(function (e) {
          if (seen[e.otherId] === undefined) { seen[e.otherId] = h; next.push(e.otherId); }
        });
      });
      frontier = next;
    }
    return seen;
  }

  function findingHighlight() {
    var s = ctx.state.selection;
    if (!s || s.type !== 'finding') return null;
    for (var i = 0; i < ctx.state.findings.length; i++) {
      if (ctx.state.findings[i].id === s.id) return ctx.state.findings[i];
    }
    return null;
  }

  /* ---- render ---- */

  function shapeSvg(shape, r, fill, stroke, strokeW, extra) {
    extra = extra || '';
    if (shape === 'rounded') {
      var w = r * 2.6, h = r * 1.7;
      return '<rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" rx="' + (h / 2) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"' + extra + '/>';
    }
    if (shape === 'rect') {
      var w2 = r * 2.6, h2 = r * 1.7;
      return '<rect x="' + (-w2 / 2) + '" y="' + (-h2 / 2) + '" width="' + w2 + '" height="' + h2 + '" rx="2" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"' + extra + '/>';
    }
    return '<circle r="' + r + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"' + extra + '/>';
  }

  function labelOffsetY(shape, r) {
    return shape === 'circle' ? r + 13 : r * 0.85 + 13;
  }

  /* Keep whatever is at the canvas centre there when the canvas changes size (inspector
     opening, rail collapsing, window resize). */
  var lastSvgSize = null;
  function reanchor() {
    var w = svg.clientWidth, h = svg.clientHeight;
    if (!(w > 0 && h > 0)) return;
    if (lastSvgSize && (lastSvgSize.w !== w || lastSvgSize.h !== h)) {
      view.x += (w - lastSvgSize.w) / 2;
      view.y += (h - lastSvgSize.h) / 2;
    }
    lastSvgSize = { w: w, h: h };
  }

  function render() {
    if (!svg || !ctx.state.scenario) return;
    ensureLayout();
    reanchor();
    var st = ctx.state;
    var v = archView() || st.fullGraph;
    var lens = lensOn();
    var selId = selectedNodeId();
    var selLink = (st.selection && st.selection.type === 'link') ? st.selection.id : null;
    var finding = lens ? findingHighlight() : null;
    var fNodes = {}, fLinks = {};
    if (finding) {
      finding.affected_node_ids.forEach(function (id) { fNodes[id] = 1; });
      (finding.affected_link_ids || []).forEach(function (id) { fLinks[id] = 1; });
    }
    var isolateSet = null;
    if (st.isolate && selId) isolateSet = neighborSet(selId, 2);

    gRoot.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');

    // Command tree (hierarchy views)
    var treeHtml = '';
    if (layoutMode() === 'hierarchy' && v.parentEdges) {
      v.parentEdges.forEach(function (e) {
        if (isolateSet && (isolateSet[e.parent] === undefined || isolateSet[e.child] === undefined)) return;
        var active = !!(st.graph.nodesById[e.parent] && st.graph.nodesById[e.child]);
        treeHtml += '<path d="' + treePath(e.parent, e.child) + '" fill="none" stroke="' + cssVar('--fg-mute') +
          '" stroke-width="1.4" opacity="' + (active ? 0.7 : 0.18) + '"/>';
      });
    }
    gTree.innerHTML = treeHtml;

    // Chains overlay (auto findings dashed crit, analyst solid warn) — lens only
    var chainsHtml = '';
    if (lens && st.layers.chains) {
      st.findings.forEach(function (f) {
        var pts = f.affected_node_ids
          .filter(function (id) { return positions[id] && (!isolateSet || isolateSet[id] !== undefined); })
          .map(function (id) { return positions[id]; });
        if (pts.length < 2) return;
        var d = 'M' + pts.map(function (p) { return p.x + ',' + p.y; }).join(' L');
        var color = f.source === 'analyst' ? cssVar('--warn') : cssVar('--crit');
        var dash = f.source === 'analyst' ? '' : ' stroke-dasharray="10,6"';
        var wsel = (finding && finding.id === f.id) ? 1 : 0;
        chainsHtml += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' +
          (2.5 + f.severity + wsel * 5) + '" stroke-linejoin="round" stroke-linecap="round" opacity="' +
          (wsel ? 0.6 : 0.12) + '"' + dash + '/>';
      });
    }
    gChains.innerHTML = chainsHtml;

    // Links. Arrowheads take the stroke colour: one marker per colour, rebuilt each render so
    // theme switches and selection colours stay in step.
    var groups = linkGroups(v.links);
    var linksHtml = '';
    var labels = showLinkLabels();
    var markers = {};
    function markerFor(color) {
      var id = 'arrow-' + color.replace(/[^a-zA-Z0-9]/g, '');
      if (!markers[id]) markers[id] = '<marker id="' + id + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="' + color + '"/></marker>';
      return id;
    }
    var arch = v.id && v.id !== 'graph';
    Object.keys(groups).sort().forEach(function (key) {
      var list = groups[key];
      list.forEach(function (l, i) {
        if (isolateSet && (isolateSet[l.source] === undefined || isolateSet[l.target] === undefined)) return;
        var active = isLinkActive(l);
        var isSel = selLink === l.id;
        var touchesSel = selId && (l.source === selId || l.target === selId);
        var inFinding = fLinks[l.id];
        var base = arch && !lens ? (l.derived ? cssVar('--fg-dim') : cssVar('--fg-mute')) : (l.derived ? cssVar('--fg-dim') : cssVar('--line-strong'));
        var stroke = isSel || inFinding ? cssVar('--accent') : (touchesSel ? cssVar('--fg') : base);
        var w = lens ? 0.8 + (l.failure_impact / 5) * 1.8 + (isSel ? 1.2 : 0) : (l.derived ? 1.2 : 1.6) + (isSel ? 1.2 : 0);
        var op = !active ? 0.12 : ((selId || selLink || finding) && !isSel && !touchesSel && !inFinding ? 0.22 : (l.derived ? 0.7 : 0.9));
        var dash = linkDash(l);
        var geom = linkGeom(l, i, list.length);
        var markerAttr = '';
        if (active && l.direction === 'directed') markerAttr = ' marker-end="url(#' + markerFor(stroke) + ')"';
        else if (active && l.direction === 'bidirectional' && arch) markerAttr = ' marker-end="url(#' + markerFor(stroke) + ')" marker-start="url(#' + markerFor(stroke) + ')"';
        linksHtml += '<path class="linkPath" data-link="' + l.id + '" d="' + linkPath(l, i, list.length) +
          '" stroke="' + stroke + '" stroke-width="' + w + '" opacity="' + op + '"' +
          (dash ? ' stroke-dasharray="' + dash + '"' : '') + markerAttr + '/>';
        // invisible fat hit path
        linksHtml += '<path class="linkHit" data-link="' + l.id + '" d="' + linkPath(l, i, list.length) +
          '" stroke="rgba(0,0,0,0)" stroke-width="12" fill="none" style="cursor:pointer"/>';
        if (labels && geom && active) {
          linksHtml += '<text class="linkLabel" data-link="' + l.id + '" x="' + geom.lx + '" y="' + (geom.ly - 4) +
            '" text-anchor="middle" opacity="' + Math.min(1, op + 0.2) + '">' + escapeXml(linkLabelText(l)) + '</text>';
        }
      });
    });
    var defs = svg.querySelector('defs');
    if (defs) defs.innerHTML = Object.keys(markers).map(function (k) { return markers[k]; }).join('');
    gLinks.innerHTML = linksHtml;

    // Nodes
    var showLabels = st.layers.graphLabels;
    var pins = OSP.model.viewPositions(st.scenario, v.id || 'graph');
    var nodesHtml = '';
    v.nodes.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (n) {
      if (isolateSet && isolateSet[n.id] === undefined) return;
      var p = positions[n.id];
      if (!p) return;
      var active = isNodeActive(n);
      var r = nodeRadius(n);
      var shape = nodeShape(n);
      var fill = nodeFill(n);
      var isSel = selId === n.id;
      var inFinding = fNodes[n.id];
      var context = isContext(n);
      var op = !active ? 0.25 : ((selId || finding) && !isSel && !inFinding && !(selId && neighborTouch(n.id, selId)) ? 0.45 : (context ? 0.6 : 1));
      var pinned = pins[n.id] && pins[n.id].pinned;
      nodesHtml += '<g class="node" data-id="' + n.id + '" transform="translate(' + p.x + ',' + p.y + ')" opacity="' + op + '">';
      if (isSel || inFinding) {
        nodesHtml += shapeSvg(shape, r + 6, 'none', cssVar('--accent'), 2.5);
      }
      nodesHtml += shapeSvg(shape, r, fill, sideStroke(n.side), context ? 1.2 : 2, context ? ' stroke-dasharray="4,3"' : '');
      var g = ctx.state.graph;
      var effStatus = active ? g.statusOf(n) : null;
      if (effStatus === 'Degraded' || effStatus === 'Offline') {
        nodesHtml += shapeSvg(shape, r + 3, 'none', statusColor(effStatus), 2, ' stroke-dasharray="4,3"');
      }
      nodesHtml += '<text class="nodeGlyph" text-anchor="middle" dy="3.5" fill="' + glyphFill() + '">' + OSP.symbols.nodeGlyph(n.node_type) + '</text>';
      if (pinned) nodesHtml += '<circle r="2.5" cx="' + (r - 3) + '" cy="' + (-r + 3) + '" fill="' + cssVar('--accent') + '"/>';
      if (showLabels) {
        var ly0 = labelOffsetY(shape, r);
        labelLines(n.name).forEach(function (line, li) {
          nodesHtml += '<text class="nodeLabel" text-anchor="middle" y="' + (ly0 + li * 12) + '">' + escapeXml(line) + '</text>';
        });
      }
      nodesHtml += '</g>';
    });
    gNodes.innerHTML = nodesHtml;
  }

  function neighborTouch(id, selId) {
    var graph = archView() || ctx.state.fullGraph;
    var adj = graph.adjacency[selId] || [];
    for (var i = 0; i < adj.length; i++) if (adj[i].otherId === id) return true;
    return false;
  }

  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---- view fit / zoom ---- */

  function fit() {
    ensureLayout();
    var ids = Object.keys(positions);
    if (!ids.length) return;
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    ids.forEach(function (id) {
      var p = positions[id];
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    // labels hang below and spread beside their nodes: pad for them, not just the discs
    var showLabels = ctx.state.layers.graphLabels;
    minX -= showLabels ? 80 : 40; maxX += showLabels ? 80 : 40;
    minY -= 40; maxY += showLabels ? 62 : 40;
    var w = svg.clientWidth || 800, h = svg.clientHeight || 600;
    // keep clear of the floating caption (top) and the counts pill / zoom controls (bottom)
    var top = 44, bottom = 40;
    var k = Math.min(w / (maxX - minX), (h - top - bottom) / (maxY - minY));
    k = Math.max(0.1, Math.min(2.2, k));
    view.k = k;
    view.x = (w - (minX + maxX) * k) / 2;
    view.y = top + ((h - top - bottom) - (minY + maxY) * k) / 2;
    render();
  }

  function zoomAbout(sx, sy, factor) {
    var nk = Math.max(0.1, Math.min(8, view.k * factor));
    view.x = sx - (sx - view.x) * (nk / view.k);
    view.y = sy - (sy - view.y) * (nk / view.k);
    view.k = nk;
    render();
  }

  /* ---- events ---- */

  function nodeAt(target) {
    var el = target;
    while (el && el !== svg) {
      if (el.classList && el.classList.contains('node')) return el.getAttribute('data-id');
      el = el.parentNode;
    }
    return null;
  }

  function linkAt(target) {
    var el = target;
    while (el && el !== svg) {
      if (el.getAttribute && el.getAttribute('data-link')) return el.getAttribute('data-link');
      el = el.parentNode;
    }
    return null;
  }

  function findViewLink(id) {
    var v = archView() || ctx.state.fullGraph;
    for (var i = 0; i < v.links.length; i++) if (v.links[i].id === id) return v.links[i];
    return null;
  }

  function currentViewId() {
    var v = archView();
    return v ? v.id : 'graph';
  }

  function wire() {
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = svg.getBoundingClientRect();
      zoomAbout(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 0.87);
    }, { passive: false });

    svg.addEventListener('mousedown', function (e) {
      var rect = svg.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      var nid = nodeAt(e.target);
      drag = { sx: sx, sy: sy, moved: false, nid: nid, vx: view.x, vy: view.y };
      if (nid) {
        var p = positions[nid];
        drag.nx = p.x; drag.ny = p.y;
      }
      svg.classList.add('dragging');
    });

    window.addEventListener('mousemove', function (e) {
      if (!drag) {
        hover(e);
        return;
      }
      var rect = svg.getBoundingClientRect();
      var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      var dx = sx - drag.sx, dy = sy - drag.sy;
      if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      drag.moved = true;
      if (drag.nid) {
        positions[drag.nid] = { x: drag.nx + dx / view.k, y: drag.ny + dy / view.k };
        render();
      } else {
        view.x = drag.vx + dx;
        view.y = drag.vy + dy;
        render();
      }
    });

    window.addEventListener('mouseup', function (e) {
      if (!drag) return;
      svg.classList.remove('dragging');
      var d = drag;
      drag = null;
      if (d.nid && d.moved) {
        // pin the dragged node and persist its position for THIS view
        OSP.model.viewPositions(ctx.state.scenario, currentViewId())[d.nid] = {
          x: Math.round(positions[d.nid].x), y: Math.round(positions[d.nid].y), pinned: true
        };
        ctx.onUserChange();
        render();
        return;
      }
      if (!d.moved) {
        if (d.nid) { ctx.select({ type: 'node', id: d.nid }); return; }
        var linkId = linkAt(e.target);
        if (linkId) {
          var l = findViewLink(linkId);
          // derived needlines have no scenario record — select the systems they pass through
          if (l && l.derived) { ctx.select({ type: 'node', id: l.via[0] }); return; }
          ctx.select({ type: 'link', id: linkId });
          return;
        }
        ctx.select(null);
      }
    });

    svg.addEventListener('dblclick', function (e) {
      var nid = nodeAt(e.target);
      var pins = OSP.model.viewPositions(ctx.state.scenario, currentViewId());
      if (nid && pins[nid]) {
        delete pins[nid];
        layoutKey = '';
        ctx.onUserChange();
        render();
      }
    });
  }

  function hover(e) {
    if (document.body.getAttribute('data-view') !== 'graph') return;
    var nid = nodeAt(e.target);
    if (nid) {
      var n = ctx.state.fullGraph.nodesById[nid];
      if (n) {
        var sub = n.node_type.replace(/_/g, ' ') + (n.echelon ? ' · ' + n.echelon : '');
        var v = archView();
        if (v && v.id !== 'graph') sub = OSP.model.archClassOf(n) + ' · ' + sub;
        var score = (lensOn() && n.metrics && isNodeActive(n)) ? ' · crit ' + Math.round(n.metrics.criticality_score) : (isNodeActive(n) ? '' : ' · inactive this phase');
        ctx.hoverTip('<b>' + escapeXml(n.name) + '</b><div class="tSub">' + escapeXml(sub) + score + '</div>', e.clientX, e.clientY);
        return;
      }
    }
    var lid = linkAt(e.target);
    if (lid) {
      var l = findViewLink(lid);
      if (l) {
        var a = ctx.state.fullGraph.nodesById[l.source], b = ctx.state.fullGraph.nodesById[l.target];
        var title = (a ? a.name : l.source) + (l.direction === 'bidirectional' ? ' ↔ ' : ' → ') + (b ? b.name : l.target);
        var sub2 = l.derived ? 'derived needline · ' + linkLabelText(l) : l.relationship_type.replace(/_/g, ' ') + ' · ' + l.communication_method;
        ctx.hoverTip('<b>' + escapeXml(title) + '</b><div class="tSub">' + escapeXml(sub2) + '</div>', e.clientX, e.clientY);
        return;
      }
    }
    ctx.hideTip();
  }

  /* ---- export drawing ---- */

  /* Fit transform for the current layout into a w x h box, padded for labels. */
  function fitTransform(w, h) {
    var ids = Object.keys(positions);
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    ids.forEach(function (id) {
      var p = positions[id];
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    // pad in layout units so labels (which scale with k) always clear the frame
    minX -= 90; maxX += 90; minY -= 44; maxY += 66;
    var k = Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1));
    return { k: k, ox: (w - (minX + maxX) * k) / 2, oy: (h - (minY + maxY) * k) / 2 };
  }

  /* Inline the stylesheet rules the SVG relies on, from computed style, so a serialized copy
     renders identically outside the document. */
  function inlineSvgStyle() {
    var rules = [];
    ['nodeLabel', 'nodeGlyph', 'linkLabel'].forEach(function (cls) {
      var el = svg.querySelector('.' + cls);
      if (!el) return;
      var cs = getComputedStyle(el);
      rules.push('.' + cls + '{font-size:' + cs.fontSize + ';font-family:' + cs.fontFamily.replace(/"/g, "'") + ';font-weight:' + cs.fontWeight +
        ';fill:' + cs.fill + ';paint-order:' + cs.paintOrder + ';stroke:' + cs.stroke + ';stroke-width:' + cs.strokeWidth + ';stroke-linejoin:round}');
    });
    rules.push('.linkPath{fill:none}');
    return rules.join('');
  }

  /* Export = what is on screen: serialize the live SVG (with the current selection, lens,
     labels and arrowheads), refit into the export box, rasterize. Resolves when drawn; falls
     back to the model redraw if the browser refuses the SVG image. */
  function exportDraw(c2d, w, h) {
    ensureLayout();
    return new Promise(function (resolve) {
      var fallback = function () { exportDrawCanvas(c2d, w, h); resolve(); };
      try {
        if (typeof XMLSerializer === 'undefined' || typeof Image === 'undefined') return fallback();
        var t = fitTransform(w, h);
        var clone = svg.cloneNode(true);
        clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clone.setAttribute('width', w);
        clone.setAttribute('height', h);
        clone.removeAttribute('style');
        var root = clone.querySelector('#gRoot');
        if (root) root.setAttribute('transform', 'translate(' + t.ox + ',' + t.oy + ') scale(' + t.k + ')');
        var style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = inlineSvgStyle();
        clone.insertBefore(style, clone.firstChild);
        var xml = new XMLSerializer().serializeToString(clone);
        var img = new Image();
        img.onload = function () {
          try {
            c2d.fillStyle = cssVar('--bg0');
            c2d.fillRect(0, 0, w, h);
            c2d.drawImage(img, 0, 0, w, h);
            resolve();
          } catch (e) { fallback(); }
        };
        img.onerror = fallback;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      } catch (e) { fallback(); }
    });
  }

  function exportDrawCanvas(c2d, w, h) {
    var st = ctx.state;
    var v = archView() || st.fullGraph;
    var lens = lensOn();
    // background
    c2d.fillStyle = cssVar('--bg0');
    c2d.fillRect(0, 0, w, h);
    var t = fitTransform(w, h);
    var k = t.k, ox = t.ox, oy = t.oy;
    function tx(x) { return x * k + ox; }
    function ty(y) { return y * k + oy; }

    if (layoutMode() === 'hierarchy' && v.parentEdges) {
      c2d.strokeStyle = cssVar('--fg-mute');
      c2d.lineWidth = 1.4 * k;
      c2d.globalAlpha = 0.7;
      v.parentEdges.forEach(function (e) {
        var a = positions[e.parent], b = positions[e.child];
        if (!a || !b) return;
        var midY = (a.y + b.y) / 2;
        c2d.beginPath();
        c2d.moveTo(tx(a.x), ty(a.y));
        c2d.lineTo(tx(a.x), ty(midY));
        c2d.lineTo(tx(b.x), ty(midY));
        c2d.lineTo(tx(b.x), ty(b.y));
        c2d.stroke();
      });
      c2d.globalAlpha = 1;
    }

    var labels = showLinkLabels();
    var groups = linkGroups(v.links);
    Object.keys(groups).sort().forEach(function (key) {
      groups[key].forEach(function (l, i) {
        if (!isLinkActive(l)) return;
        var g = linkGeom(l, i, groups[key].length);
        if (!g) return;
        c2d.strokeStyle = l.derived ? cssVar('--fg-dim') : cssVar('--line-strong');
        c2d.lineWidth = (lens ? 0.8 + (l.failure_impact / 5) * 1.8 : (l.derived ? 1 : 1.3)) * k;
        var dash = linkDash(l);
        c2d.setLineDash(dash ? dash.split(',').map(Number) : []);
        c2d.globalAlpha = l.derived ? 0.6 : 0.8;
        c2d.beginPath();
        c2d.moveTo(tx(g.a.x), ty(g.a.y));
        c2d.quadraticCurveTo(tx(g.mx), ty(g.my), tx(g.b.x), ty(g.b.y));
        c2d.stroke();
        if (labels) {
          c2d.setLineDash([]);
          c2d.fillStyle = cssVar('--fg-mute');
          c2d.font = '500 ' + Math.max(9, 9.5 * k) + 'px ' + cssVar('--sans');
          c2d.textAlign = 'center';
          c2d.fillText(linkLabelText(l), tx(g.lx), ty(g.ly) - 4 * k);
        }
      });
    });
    c2d.setLineDash([]);
    c2d.globalAlpha = 1;

    v.nodes.forEach(function (n) {
      var p = positions[n.id];
      if (!p || !isNodeActive(n)) return;
      var r = nodeRadius(n) * k;
      var shape = nodeShape(n);
      c2d.beginPath();
      if (shape === 'circle') {
        c2d.arc(tx(p.x), ty(p.y), r, 0, Math.PI * 2);
      } else {
        var bw = r * 2.6, bh = r * 1.7;
        roundRect(c2d, tx(p.x) - bw / 2, ty(p.y) - bh / 2, bw, bh, shape === 'rounded' ? bh / 2 : 2 * k);
      }
      c2d.fillStyle = nodeFill(n);
      c2d.fill();
      c2d.lineWidth = (isContext(n) ? 1.2 : 2) * k;
      c2d.strokeStyle = sideStroke(n.side);
      if (isContext(n)) c2d.setLineDash([4 * k, 3 * k]);
      c2d.stroke();
      c2d.setLineDash([]);
      c2d.fillStyle = cssVar('--fg');
      c2d.font = '600 ' + Math.max(10, 11 * k) + 'px ' + cssVar('--sans');
      c2d.textAlign = 'center';
      var ly0 = ty(p.y) + labelOffsetY(shape, r / k) * k;
      labelLines(n.name).forEach(function (line, li) {
        c2d.fillText(line, tx(p.x), ly0 + li * 12 * k);
      });
    });
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  OSP.renderGraph = {
    init: function (context) {
      ctx = context;
      svg = document.getElementById('graphSvg');
      svg.innerHTML = '<defs></defs>' +
        '<g id="gRoot"><g id="gTree"></g><g id="gChains"></g><g id="gLinks"></g><g id="gNodes"></g></g>';
      gRoot = document.getElementById('gRoot');
      gTree = document.getElementById('gTree');
      gChains = document.getElementById('gChains');
      gLinks = document.getElementById('gLinks');
      gNodes = document.getElementById('gNodes');
      wire();
    },
    render: render,
    fit: fit,
    zoomIn: function () { zoomAbout((svg.clientWidth || 800) / 2, (svg.clientHeight || 600) / 2, 1.25); },
    zoomOut: function () { zoomAbout((svg.clientWidth || 800) / 2, (svg.clientHeight || 600) / 2, 0.8); },
    invalidateLayout: function () { layoutKey = ''; },
    exportDraw: exportDraw,
    getPositions: function () { ensureLayout(); return positions; }
  };
})();
