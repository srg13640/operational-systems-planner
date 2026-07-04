/* OSP graph view — SVG renderer for hierarchy/network structure.
   Layout runs on the full structural graph (stable across time scrub); entities outside the
   active phase render dimmed. Attaches to window.OSP.renderGraph. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var LOGICAL_W = 1600;
  var LOGICAL_H = 1000;

  var svg, gRoot, gChains, gLinks, gNodes;
  var ctx = null;
  var view = { x: 0, y: 0, k: 1 };
  var positions = {};
  var layoutKey = '';
  var drag = null; // { kind: 'pan'|'node', ... }

  var DOMAIN_COLORS = {
    c2: '#5b8dd6', strike: '#e4574f', sustain: '#61a56c', space: '#b03a9e',
    air: '#45d6b4', ems: '#e0a33c', cyber: '#9a6dd6', land: '#8a9aa8',
    maritime: '#2e9bd6', data: '#c9a13b', other: '#6b8091'
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

  function nodeFill(node) {
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
    var s = (node.metrics && isNodeActive(node)) ? node.metrics.criticality_score : 0;
    return 15 + (s / 100) * 11;
  }

  function isNodeActive(node) {
    return !!ctx.state.graph.nodesById[node.id];
  }

  function isLinkActive(link) {
    var g = ctx.state.graph;
    for (var i = 0; i < g.links.length; i++) if (g.links[i].id === link.id) return true;
    return false;
  }

  /* ---- layout ---- */

  function ensureLayout() {
    var st = ctx.state;
    var key = st.scenarioRev + ':' + st.graphMode;
    if (key === layoutKey) return;
    layoutKey = key;
    var full = st.fullGraph;
    var pinned = {};
    var gp = st.scenario.layout.graph_positions || {};
    Object.keys(gp).forEach(function (id) {
      if (gp[id] && gp[id].pinned && full.nodesById[id]) pinned[id] = { x: gp[id].x, y: gp[id].y };
    });
    var res = (st.graphMode === 'hierarchy')
      ? OSP.layout.layoutHierarchy(full, LOGICAL_W, LOGICAL_H)
      : OSP.layout.layoutNetwork(full, LOGICAL_W, LOGICAL_H, pinned);
    positions = res.positions;
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

  function linkPath(l, index, count) {
    var a = positions[l.source], b = positions[l.target];
    if (!a || !b) return '';
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var offset = (index - (count - 1) / 2) * 22;
    var mx = (a.x + b.x) / 2 - (dy / len) * offset;
    var my = (a.y + b.y) / 2 + (dx / len) * offset;
    return 'M' + a.x + ',' + a.y + ' Q' + mx + ',' + my + ' ' + b.x + ',' + b.y;
  }

  function commDash(method) {
    if (method === 'Courier' || method === 'Voice') return '2,5';
    if (method === 'SATCOM' || method === 'UHF/VHF/HF Radio' || method === 'Microwave' ||
        method === 'Mesh' || method === 'Tactical Data Link' || method === 'LTE/5G') return '7,4';
    return '';
  }

  /* ---- selection helpers ---- */

  function selectedNodeId() {
    var s = ctx.state.selection;
    return (s && s.type === 'node') ? s.id : null;
  }

  function neighborSet(nodeId, hops) {
    var full = ctx.state.fullGraph;
    var seen = {};
    seen[nodeId] = 0;
    var frontier = [nodeId];
    for (var h = 1; h <= hops; h++) {
      var next = [];
      frontier.forEach(function (id) {
        (full.adjacency[id] || []).forEach(function (e) {
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

  function render() {
    if (!svg || !ctx.state.scenario) return;
    ensureLayout();
    var st = ctx.state;
    var full = st.fullGraph;
    var selId = selectedNodeId();
    var selLink = (st.selection && st.selection.type === 'link') ? st.selection.id : null;
    var finding = findingHighlight();
    var fNodes = {}, fLinks = {};
    if (finding) {
      finding.affected_node_ids.forEach(function (id) { fNodes[id] = 1; });
      (finding.affected_link_ids || []).forEach(function (id) { fLinks[id] = 1; });
    }
    var isolateSet = null;
    if (st.isolate && selId) isolateSet = neighborSet(selId, 2);

    gRoot.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');

    // Chains overlay (auto findings dashed crit, analyst solid warn)
    var chainsHtml = '';
    if (st.layers.chains) {
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

    // Links
    var groups = linkGroups(full.links);
    var linksHtml = '';
    Object.keys(groups).sort().forEach(function (key) {
      var list = groups[key];
      list.forEach(function (l, i) {
        if (isolateSet && (isolateSet[l.source] === undefined || isolateSet[l.target] === undefined)) return;
        var active = isLinkActive(l);
        var isSel = selLink === l.id;
        var touchesSel = selId && (l.source === selId || l.target === selId);
        var inFinding = fLinks[l.id];
        var stroke = isSel || inFinding ? cssVar('--accent') : (touchesSel ? cssVar('--fg-mute') : cssVar('--line-strong'));
        var w = 0.8 + (l.failure_impact / 5) * 1.8 + (isSel ? 1.2 : 0);
        var op = !active ? 0.12 : ((selId || selLink || finding) && !isSel && !touchesSel && !inFinding ? 0.25 : 0.75);
        var dash = commDash(l.communication_method);
        linksHtml += '<path class="linkPath" data-link="' + l.id + '" d="' + linkPath(l, i, list.length) +
          '" stroke="' + stroke + '" stroke-width="' + w + '" opacity="' + op + '"' +
          (dash ? ' stroke-dasharray="' + dash + '"' : '') +
          (l.direction === 'directed' && active ? ' marker-end="url(#arrow)"' : '') + '/>';
        // invisible fat hit path
        linksHtml += '<path class="linkHit" data-link="' + l.id + '" d="' + linkPath(l, i, list.length) +
          '" stroke="rgba(0,0,0,0)" stroke-width="12" fill="none" style="cursor:pointer"/>';
      });
    });
    gLinks.innerHTML = linksHtml;

    // Nodes
    var showLabels = st.layers.graphLabels;
    var nodesHtml = '';
    full.nodes.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (n) {
      if (isolateSet && isolateSet[n.id] === undefined) return;
      var p = positions[n.id];
      if (!p) return;
      var active = isNodeActive(n);
      var r = nodeRadius(n);
      var fill = nodeFill(n);
      var isSel = selId === n.id;
      var inFinding = fNodes[n.id];
      var op = !active ? 0.25 : ((selId || finding) && !isSel && !inFinding && !(selId && neighborTouch(n.id, selId)) ? 0.45 : 1);
      var pinned = st.scenario.layout.graph_positions[n.id] && st.scenario.layout.graph_positions[n.id].pinned;
      nodesHtml += '<g class="node" data-id="' + n.id + '" transform="translate(' + p.x + ',' + p.y + ')" opacity="' + op + '">';
      if (isSel || inFinding) {
        nodesHtml += '<circle r="' + (r + 6) + '" fill="none" stroke="' + cssVar('--accent') + '" stroke-width="2.5"/>';
      }
      nodesHtml += '<circle r="' + r + '" fill="' + fill + '" stroke="' + sideStroke(n.side) + '" stroke-width="2"/>';
      var g = ctx.state.graph;
      var effStatus = active ? g.statusOf(n) : null;
      if (effStatus === 'Degraded' || effStatus === 'Offline') {
        nodesHtml += '<circle r="' + (r + 3) + '" fill="none" stroke="' + statusColor(effStatus) + '" stroke-width="2" stroke-dasharray="4,3"/>';
      }
      nodesHtml += '<text class="nodeGlyph" text-anchor="middle" dy="3.5" fill="#0a1017">' + OSP.symbols.nodeGlyph(n.node_type) + '</text>';
      if (pinned) nodesHtml += '<circle r="2.5" cx="' + (r - 3) + '" cy="' + (-r + 3) + '" fill="' + cssVar('--accent') + '"/>';
      if (showLabels) {
        nodesHtml += '<text class="nodeLabel" text-anchor="middle" y="' + (r + 13) + '">' + escapeXml(n.name) + '</text>';
      }
      nodesHtml += '</g>';
    });
    gNodes.innerHTML = nodesHtml;
  }

  function neighborTouch(id, selId) {
    var adj = ctx.state.fullGraph.adjacency[selId] || [];
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
    var pad = 70;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    var w = svg.clientWidth || 800, h = svg.clientHeight || 600;
    var k = Math.min(w / (maxX - minX), h / (maxY - minY));
    k = Math.max(0.1, Math.min(3, k));
    view.k = k;
    view.x = (w - (minX + maxX) * k) / 2;
    view.y = (h - (minY + maxY) * k) / 2;
    render();
  }

  function zoomAbout(sx, sy, factor) {
    var nk = Math.max(0.1, Math.min(8, view.k * factor));
    view.x = sx - (sx - view.x) * (nk / view.k);
    view.y = sy - (sy - view.y) * (nk / view.k);
    view.k = nk;
    render();
  }

  function screenToLocal(sx, sy) {
    return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
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
        // pin the dragged node and persist its position
        ctx.state.scenario.layout.graph_positions[d.nid] = {
          x: Math.round(positions[d.nid].x), y: Math.round(positions[d.nid].y), pinned: true
        };
        ctx.onUserChange();
        render();
        return;
      }
      if (!d.moved) {
        if (d.nid) { ctx.select({ type: 'node', id: d.nid }); return; }
        var linkEl = e.target && e.target.getAttribute && e.target.getAttribute('data-link');
        if (linkEl) { ctx.select({ type: 'link', id: linkEl }); return; }
        ctx.select(null);
      }
    });

    svg.addEventListener('dblclick', function (e) {
      var nid = nodeAt(e.target);
      if (nid && ctx.state.scenario.layout.graph_positions[nid]) {
        delete ctx.state.scenario.layout.graph_positions[nid];
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
        var sub = n.node_type + (n.echelon ? ' · ' + n.echelon : '');
        var score = (n.metrics && isNodeActive(n)) ? ' · crit ' + Math.round(n.metrics.criticality_score) : (isNodeActive(n) ? '' : ' · inactive this phase');
        ctx.hoverTip('<b>' + escapeXml(n.name) + '</b><div class="tSub">' + escapeXml(sub) + score + '</div>', e.clientX, e.clientY);
        return;
      }
    }
    ctx.hideTip();
  }

  /* ---- export drawing (model redraw onto a 2d canvas) ---- */

  function exportDraw(c2d, w, h) {
    ensureLayout();
    var st = ctx.state;
    var full = st.fullGraph;
    // background
    c2d.fillStyle = cssVar('--bg0');
    c2d.fillRect(0, 0, w, h);
    // compute fit transform into (w,h) with padding
    var ids = Object.keys(positions);
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    ids.forEach(function (id) {
      var p = positions[id];
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
    });
    var pad = 90;
    var k = Math.min((w - pad * 2) / (maxX - minX || 1), (h - pad * 2) / (maxY - minY || 1));
    var ox = (w - (minX + maxX) * k) / 2, oy = (h - (minY + maxY) * k) / 2;
    function tx(x) { return x * k + ox; }
    function ty(y) { return y * k + oy; }

    var groups = linkGroups(full.links);
    Object.keys(groups).sort().forEach(function (key) {
      groups[key].forEach(function (l, i) {
        if (!isLinkActive(l)) return;
        var a = positions[l.source], b = positions[l.target];
        if (!a || !b) return;
        var dx = b.x - a.x, dy = b.y - a.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var off = (i - (groups[key].length - 1) / 2) * 22;
        var mx = (a.x + b.x) / 2 - (dy / len) * off;
        var my = (a.y + b.y) / 2 + (dx / len) * off;
        c2d.strokeStyle = cssVar('--line-strong');
        c2d.lineWidth = (0.8 + (l.failure_impact / 5) * 1.8) * k;
        var dash = commDash(l.communication_method);
        c2d.setLineDash(dash ? dash.split(',').map(Number) : []);
        c2d.globalAlpha = 0.8;
        c2d.beginPath();
        c2d.moveTo(tx(a.x), ty(a.y));
        c2d.quadraticCurveTo(tx(mx), ty(my), tx(b.x), ty(b.y));
        c2d.stroke();
      });
    });
    c2d.setLineDash([]);
    c2d.globalAlpha = 1;

    full.nodes.forEach(function (n) {
      var p = positions[n.id];
      if (!p || !isNodeActive(n)) return;
      var r = nodeRadius(n) * k;
      c2d.beginPath();
      c2d.arc(tx(p.x), ty(p.y), r, 0, Math.PI * 2);
      c2d.fillStyle = nodeFill(n);
      c2d.fill();
      c2d.lineWidth = 2 * k;
      c2d.strokeStyle = sideStroke(n.side);
      c2d.stroke();
      c2d.fillStyle = cssVar('--fg');
      c2d.font = '600 ' + Math.max(10, 11 * k) + 'px ' + cssVar('--sans');
      c2d.textAlign = 'center';
      c2d.fillText(n.name, tx(p.x), ty(p.y) + r + Math.max(11, 13 * k));
    });
  }

  OSP.renderGraph = {
    init: function (context) {
      ctx = context;
      svg = document.getElementById('graphSvg');
      svg.innerHTML = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
        '<path d="M0,0 L10,5 L0,10 z" fill="#3d5266"/></marker></defs>' +
        '<g id="gRoot"><g id="gChains"></g><g id="gLinks"></g><g id="gNodes"></g></g>';
      gRoot = document.getElementById('gRoot');
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
