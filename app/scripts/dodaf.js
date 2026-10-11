/* OSP DoDAF views — architecture-view definitions and the filters that derive each view from
   the one scenario repository. A view never owns data: it selects entity classes and
   relationship classes, picks a layout, and reports what it left out. OV-2 and SV-1 therefore
   cannot disagree with each other, which is the point of "one repository, many views".
   Pure module: no DOM access. Attaches to window.OSP.dodaf. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  /* System-class intermediates a derived needline may pass through. Two covers the real cases
     (performer -> system -> performer; performer -> gateway -> mission system -> performer);
     three starts routing every performer through the theater network to every other. */
  var MAX_DERIVED_HOPS = 2;

  /* Ordered view definitions. `surface` names the rendering surface (map | graph | stack | risk);
     `layout` applies to graph-surface views. Analysis views are OSP's fit-for-purpose views —
     DoDAF 2.0 explicitly permits them alongside the described models. */
  var VIEWS = [
    { id: 'ov1', code: 'OV-1', title: 'High-Level Operational Concept Graphic', viewpoint: 'Operational',
      surface: 'map', short: 'OV-1',
      hint: 'Performers and systems at their real locations. Concept mode suppresses the analytic overlay so the graphic reads as an operational concept, not a risk picture.' },
    { id: 'ov2', code: 'OV-2', title: 'Operational Resource Flow Description', viewpoint: 'Operational',
      surface: 'graph', layout: 'network', short: 'OV-2',
      hint: 'Performers and the needlines between them. Dashed needlines are derived: two performers that exchange only through systems still need each other.' },
    { id: 'ov4', code: 'OV-4', title: 'Organizational Relationships Chart', viewpoint: 'Operational',
      surface: 'graph', layout: 'hierarchy', short: 'OV-4',
      hint: 'Command hierarchy from parent relationships; command, control, and support links drawn over it.' },
    { id: 'sv1', code: 'SV-1', title: 'Systems Interface Description', viewpoint: 'Systems',
      surface: 'graph', layout: 'network', short: 'SV-1',
      hint: 'Systems and the interfaces between them. Turn on owning performers to see which operational node each system serves.' },
    { id: 'sv2', code: 'SV-2', title: 'Systems Resource Flow Description', viewpoint: 'Systems',
      surface: 'graph', layout: 'network', short: 'SV-2',
      hint: 'SV-1 with each interface labeled by its communication means and capacity.' },
    { id: 'graph', code: 'GRAPH', title: 'Dependency Graph (fit-for-purpose)', viewpoint: 'Analysis',
      surface: 'graph', layout: 'network', short: 'GRAPH',
      hint: 'Every entity and dependency. Structure is stable across time; dimmed entities are out of the current phase.' },
    { id: 'stack', code: 'STACK', title: 'Multi-Domain Stack (fit-for-purpose)', viewpoint: 'Analysis',
      surface: 'stack', short: 'STACK',
      hint: 'One system across every domain — vertical arcs are cross-domain dependencies.' },
    { id: 'risk', code: 'RISK', title: 'Risk Board (fit-for-purpose)', viewpoint: 'Analysis',
      surface: 'risk', short: 'RISK',
      hint: 'What matters now, what breaks, and why.' }
  ];

  var VIEW_BY_ID = {};
  VIEWS.forEach(function (v) { VIEW_BY_ID[v.id] = v; });

  var GROUPS = [
    { id: 'operational', label: 'Operational', views: ['ov1', 'ov2', 'ov4'] },
    { id: 'systems', label: 'Systems', views: ['sv1', 'sv2'] },
    { id: 'analysis', label: 'Analysis', views: ['graph', 'stack', 'risk'] }
  ];

  function viewDef(viewId) { return VIEW_BY_ID[viewId] || VIEW_BY_ID.ov1; }
  function surfaceOf(viewId) { return viewDef(viewId).surface; }
  function isArchitectureView(viewId) { return viewDef(viewId).viewpoint !== 'Analysis'; }
  function titleFor(viewId) {
    var v = viewDef(viewId);
    return v.code + ' ' + v.title;
  }

  /* The graph-surface view a node naturally lives on. Used by "show in graph" routing. */
  function graphViewForNode(node) {
    var cls = OSP.model.archClassOf(node);
    if (cls === 'system') return 'sv1';
    if (cls === 'performer') return 'ov2';
    return 'graph';
  }

  /* Flow links are the exchanges: OV-2 needlines when they join performers, SV-1/SV-2
     interfaces when they join systems. Org links are OV-4's. Dependency and effect links are
     drawn on no architecture view (the analysis graph shows everything). */
  function isFlowLink(link) { return OSP.model.linkClassOf(link) === 'flow'; }
  function isOrgLink(link) { return OSP.model.linkClassOf(link) === 'org'; }
  function isDependencyLink(link) { return OSP.model.linkClassOf(link) === 'dependency'; }

  /* Can a resource move from `fromId` across `link` to the other end? Flow and dependency links
     only (an effect or authority relation carries nothing), honouring the link's flow direction.
     Transport links (relays_through, depends_on, up/downlinks) are walked client -> provider;
     the provider may deliver back out to one of its clients only when the walk did not arrive
     at it as another client (`asClient`), so two systems that merely share a trunk never
     acquire a needline through it. Returns null or { asClient } for the next step. */
  function traversable(link, fromId, asClient) {
    var c = OSP.model.linkClassOf(link);
    if (c !== 'flow' && c !== 'dependency') return null;
    var d = OSP.model.flowDirections(link);
    var forward = link.source === fromId;
    var transport = OSP.model.isTransportLink(link);
    if (forward ? d.forward : d.backward) return { asClient: transport && link.direction !== 'bidirectional' };
    if (transport && !asClient && link.direction !== 'bidirectional') return { asClient: false };
    return null;
  }

  /* One derivation pass over one graph. From each performer, walk forward along traversable
     links through system-class nodes only (never through another performer, at most
     MAX_DERIVED_HOPS systems deep). Every performer reached is a partner the source performer
     sends to. The first system is free — "Fires Cell uses the fires system; the fires system
     sends fire missions to the battery" is the archetypal derived needline. Past the first
     system the walk continues only while the resource keeps its name, so a multi-hop transport
     chain carries but a database that turns sensor reports into a targeting picture does not
     put the sensor and the shooter on a needline. Only the shortest path per ordered pair is
     kept; ids are iterated in sorted order, so the result is a pure function of the graph.
     Returns { 'P|Q': via[] } for P -> Q. */
  function derivePass(graph, classOf) {
    var reach = {};
    var performerIds = graph.nodes.filter(function (n) { return classOf[n.id] === 'performer'; })
      .map(function (n) { return n.id; }).sort();
    performerIds.forEach(function (pid) {
      var visited = {};
      visited[pid] = 1;
      var frontier = [{ id: pid, via: [], asClient: false, resource: null }];
      while (frontier.length) {
        var next = [];
        frontier.forEach(function (cur) {
          var edges = (graph.adjacency[cur.id] || []).slice().sort(function (a, b) {
            return a.link.id < b.link.id ? -1 : 1;
          });
          edges.forEach(function (e) {
            var step = traversable(e.link, cur.id, cur.asClient);
            if (!step) return;
            var other = e.otherId;
            if (visited[other]) return;
            var key = OSP.model.resourceKeyOf(e.link);
            if (cur.via.length >= 2 && cur.resource !== key) return;   // resource changed shape: stop
            var cls = classOf[other];
            if (cls === 'performer') {
              visited[other] = 1;
              if (cur.via.length === 0) return;   // a direct link is a recorded needline, not a derived one
              reach[pid + '|' + other] = { via: cur.via.slice(), resource: String(e.link.resource || '') };
            } else if (cls === 'system' && cur.via.length < MAX_DERIVED_HOPS) {
              visited[other] = 1;
              next.push({ id: other, via: cur.via.concat([other]), asClient: step.asClient, resource: cur.via.length === 1 ? key : cur.resource });
            }
          });
        });
        frontier = next;
      }
    });
    return reach;
  }

  /* Derived needlines (OV-2). Derivation runs once per phase on the phase-filtered graph, so a
     needline that only exists while the Palawan trunk is up carries phase_ids ['p1'] and is
     drawn inactive afterwards. Ordered reaches P->Q and Q->P merge into one bidirectional
     needline; a one-way reach stays directed from the producer. Pairs that already have a
     recorded needline are skipped. */
  function deriveNeedlines(scenario, fullGraph, classOf, directPairs) {
    var phases = (scenario && scenario.timeline && scenario.timeline.phases) || [];
    var passes = [];
    if (phases.length) {
      phases.forEach(function (p) {
        passes.push({ phaseId: p.id, reach: derivePass(OSP.model.buildGraph(scenario, (p.from_hours + p.to_hours) / 2), classOf) });
      });
    } else {
      passes.push({ phaseId: null, reach: derivePass(fullGraph, classOf) });
    }

    var byPair = {};   // 'A|B' (A<B) -> { fwd: via|null, back: via|null, phases: {} }
    passes.forEach(function (pass) {
      Object.keys(pass.reach).forEach(function (k) {
        var ends = k.split('|');
        var a = ends[0], b = ends[1];
        var key = a < b ? a + '|' + b : b + '|' + a;
        if (directPairs[key]) return;
        var rec = byPair[key] || (byPair[key] = { fwd: null, back: null, phases: {} });
        if (a < b) { if (!rec.fwd) rec.fwd = pass.reach[k]; } else { if (!rec.back) rec.back = pass.reach[k]; }
        if (pass.phaseId) rec.phases[pass.phaseId] = 1;
      });
    });

    var out = [];
    Object.keys(byPair).sort().forEach(function (key) {
      var rec = byPair[key];
      var ends = key.split('|');
      var phaseIds = Object.keys(rec.phases);
      var allPhases = !phases.length || phaseIds.length === phases.length;
      var bidir = !!(rec.fwd && rec.back);
      var source = rec.fwd ? ends[0] : ends[1];
      var target = rec.fwd ? ends[1] : ends[0];
      var primary = rec.fwd || rec.back;
      // the resource is what the receiving performer gets off the last system in the chain
      var resource = bidir && rec.fwd.resource !== rec.back.resource
        ? [rec.fwd.resource, rec.back.resource].filter(Boolean).join(' / ')
        : primary.resource;
      out.push({
        id: 'derived:' + key,
        source: source, target: target,
        relationship_type: 'derived_flow',
        link_class: 'flow',
        resource: resource,
        direction: bidir ? 'bidirectional' : 'directed',
        communication_method: 'Other',
        dependency_strength: 1, failure_impact: 1, resilience: 3,
        phase_ids: allPhases ? 'all' : phaseIds.sort(),
        status: 'Active', status_by_phase: {},
        derived: true, basis: bidir ? 'derived-bidirectional' : 'derived-directed',
        via: primary.via.slice()
      });
    });
    return out;
  }

  /* Build the view: which nodes, which links, tree edges for hierarchy views, and an honest
     account of what was excluded. opts: { deriveNeedlines, svContext, svDependencies, graph }.
     `graph` is the time-filtered graph; when given, `active` counts describe the view at that
     hour while nodes/links still span the whole timeline (so layouts stay put while scrubbing).
     The returned object is shaped like a model graph (nodes, nodesById, links, adjacency,
     children, roots) so the layout module can consume it directly. */
  function buildView(viewId, scenario, fullGraph, opts) {
    opts = opts || {};
    var def = viewDef(viewId);
    var classOf = {};
    fullGraph.nodes.forEach(function (n) { classOf[n.id] = OSP.model.archClassOf(n); });

    var include, linkFilter, contextOf = {};
    if (viewId === 'ov2' || viewId === 'ov4') {
      include = function (n) { return classOf[n.id] === 'performer'; };
    } else if (viewId === 'sv1' || viewId === 'sv2') {
      include = function (n) {
        if (classOf[n.id] === 'system') return true;
        if (opts.svContext && classOf[n.id] === 'performer') { contextOf[n.id] = 1; return true; }
        return false;
      };
    } else {
      include = function () { return true; };
    }

    var nodes = fullGraph.nodes.filter(include);
    var nodesById = {};
    nodes.forEach(function (n) { nodesById[n.id] = n; });

    if (viewId === 'ov2') {
      linkFilter = function (l) { return isFlowLink(l); };
    } else if (viewId === 'ov4') {
      linkFilter = function (l) { return isOrgLink(l); };
    } else if (viewId === 'sv1' || viewId === 'sv2') {
      linkFilter = function (l) {
        if (!isFlowLink(l) && !(opts.svDependencies && isDependencyLink(l))) return false;
        // with context on, performer<->system links show; performer<->performer never do here
        return !(contextOf[l.source] && contextOf[l.target]);
      };
    } else {
      linkFilter = function () { return true; };
    }

    var links = fullGraph.links.filter(function (l) {
      return nodesById[l.source] && nodesById[l.target] && linkFilter(l);
    });

    var directPairs = {};
    links.forEach(function (l) {
      directPairs[l.source < l.target ? l.source + '|' + l.target : l.target + '|' + l.source] = 1;
    });

    var derived = [];
    if (viewId === 'ov2' && opts.deriveNeedlines !== false) {
      derived = deriveNeedlines(scenario, fullGraph, classOf, directPairs);
      links = links.concat(derived);
    }

    // hierarchy within the view: a parent outside the view makes its child a root here
    var children = {}, roots = [], parentEdges = [];
    nodes.forEach(function (n) { children[n.id] = []; });
    nodes.forEach(function (n) {
      if (n.parent_id && nodesById[n.parent_id]) {
        children[n.parent_id].push(n.id);
        parentEdges.push({ parent: n.parent_id, child: n.id });
      } else {
        roots.push(n.id);
      }
    });

    var adjacency = {};
    nodes.forEach(function (n) { adjacency[n.id] = []; });
    links.forEach(function (l) {
      adjacency[l.source].push({ link: l, otherId: l.target });
      adjacency[l.target].push({ link: l, otherId: l.source });
    });

    // what this view does not show — surfaced in the rail, never silently dropped
    var hidden = { performer: 0, system: 0, location: 0, other: 0 };
    fullGraph.nodes.forEach(function (n) { if (!nodesById[n.id]) hidden[classOf[n.id]]++; });
    var hiddenLinks = 0;
    fullGraph.links.forEach(function (l) {
      var shown = nodesById[l.source] && nodesById[l.target] && linkFilter(l);
      if (!shown) hiddenLinks++;
    });

    var counts = { performer: 0, system: 0, location: 0, other: 0 };
    nodes.forEach(function (n) { if (!contextOf[n.id]) counts[classOf[n.id]]++; });

    /* Counts at the requested hour — what the title block may truthfully claim. */
    var g = opts.graph;
    var active = null;
    if (g) {
      var linkAt = {};
      g.links.forEach(function (l) { linkAt[l.id] = 1; });
      var isActiveLink = function (l) {
        if (l.derived) return nodesActive(l, g) && OSP.model.isActiveInPhase(l, g.phaseId);
        return !!linkAt[l.id];
      };
      active = { performer: 0, system: 0, location: 0, other: 0, nodes: 0, links: 0, derived: 0, parentEdges: 0, context: 0 };
      nodes.forEach(function (n) {
        if (!g.nodesById[n.id]) return;
        active.nodes++;
        if (contextOf[n.id]) active.context++; else active[classOf[n.id]]++;
      });
      links.forEach(function (l) {
        if (!isActiveLink(l)) return;
        active.links++;
        if (l.derived) active.derived++;
      });
      parentEdges.forEach(function (e) { if (g.nodesById[e.parent] && g.nodesById[e.child]) active.parentEdges++; });
      active.isActiveLink = isActiveLink;
    }

    return {
      id: viewId,
      def: def,
      nodes: nodes,
      nodesById: nodesById,
      links: links,
      derived: derived,
      derivedCount: derived.length,
      parentEdges: parentEdges,
      contextOf: contextOf,
      classOf: classOf,
      adjacency: adjacency,
      children: children,
      roots: roots,
      hidden: hidden,
      hiddenLinks: hiddenLinks,
      counts: counts,
      active: active
    };
  }

  function nodesActive(link, g) { return !!(g.nodesById[link.source] && g.nodesById[link.target]); }

  function n(count, singular, pluralWord) { return count + ' ' + (count === 1 ? singular : (pluralWord || singular + 's')); }

  /* One-line statement of what the view contains at the current hour, for the on-canvas title
     and the export title block. Lifetime totals are appended only when they differ. */
  function caption(view) {
    var a = view.active;
    var c = a || view.counts;
    var parts = [];
    if (view.id === 'ov2') {
      parts.push(n(c.performer, 'performer'));
      var directAll = view.links.length - view.derivedCount;
      var direct = a ? a.links - a.derived : directAll;
      var derived = a ? a.derived : view.derivedCount;
      parts.push(n(direct, 'needline') + (derived ? ' + ' + derived + ' derived' : ''));
      if (a && (direct !== directAll || derived !== view.derivedCount)) parts.push('(' + directAll + (view.derivedCount ? ' + ' + view.derivedCount : '') + ' over all phases)');
    } else if (view.id === 'ov4') {
      parts.push(n(c.performer, 'organization'));
      var pe = a ? a.parentEdges : view.parentEdges.length;
      parts.push(n(pe, 'command relationship'));
    } else if (view.id === 'sv1' || view.id === 'sv2') {
      parts.push(n(c.system, 'system'));
      var li = a ? a.links : view.links.length;
      parts.push(n(li, 'interface'));
      if (a && li !== view.links.length) parts.push('(' + view.links.length + ' over all phases)');
      var ctxN = a ? a.context : Object.keys(view.contextOf).length;
      if (ctxN) parts.push(n(ctxN, 'owning performer') + ' as context');
    } else if (view.id === 'ov1') {
      parts.push(c.performer + ' performers · ' + c.system + ' systems');
    } else {
      var nn = a ? a.nodes : view.nodes.length, nl = a ? a.links : view.links.length;
      parts.push(nn + ' entities · ' + nl + ' links');
    }
    return parts.join(' · ');
  }

  function hiddenSummary(view) {
    var h = view.hidden;
    var bits = [];
    ['performer', 'system', 'location', 'other'].forEach(function (k) {
      if (h[k]) bits.push(h[k] + ' ' + k + (h[k] === 1 ? '' : 's'));
    });
    if (view.hiddenLinks) bits.push(view.hiddenLinks + ' link' + (view.hiddenLinks === 1 ? '' : 's'));
    return bits.length ? 'Not shown in this view: ' + bits.join(', ') + '.' : 'Every entity and link is shown in this view.';
  }

  OSP.dodaf = {
    VIEWS: VIEWS,
    VIEW_BY_ID: VIEW_BY_ID,
    GROUPS: GROUPS,
    MAX_DERIVED_HOPS: MAX_DERIVED_HOPS,
    viewDef: viewDef,
    surfaceOf: surfaceOf,
    isArchitectureView: isArchitectureView,
    titleFor: titleFor,
    graphViewForNode: graphViewForNode,
    isFlowLink: isFlowLink,
    isOrgLink: isOrgLink,
    isDependencyLink: isDependencyLink,
    traversable: traversable,
    deriveNeedlines: deriveNeedlines,
    buildView: buildView,
    caption: caption,
    hiddenSummary: hiddenSummary
  };
})();
