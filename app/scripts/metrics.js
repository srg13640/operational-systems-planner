/* OSP metrics — criticality engine ported from the Systems Viz tool, adapted to the
   OSP graph interface (OSP.model.buildGraph output). Pure module: no DOM access, no
   reads of global state; every result is a function of (graph, criticalityModel).
   Attaches to window.OSP.metrics.
   Fixed caps (not dataset-relative maxima), per the ported formula:
   score = sum(component_value_k * weight_k) / sum(weights) * 100. */
(function () {
  'use strict';
  window.OSP = window.OSP || {};

  var COMPONENT_ORDER = ['mission', 'echelon', 'degree', 'betweenness', 'failure', 'shared'];

  var DEFAULTS = {
    weights: { mission: 20, echelon: 15, degree: 20, betweenness: 20, failure: 15, shared: 10 },
    caps: { degree: 12, dependency: 8, cascade: 20, shared: 6 },
    thresholds: { mission_critical: 75, high: 50, moderate: 25 },
    betweenness_node_limit: 250
  };

  function num(v, dflt) {
    var n = parseFloat(v);
    return isFinite(n) ? n : dflt;
  }

  function mergeSection(defaults, over) {
    var out = {};
    Object.keys(defaults).forEach(function (k) {
      out[k] = num(over && over[k], defaults[k]);
    });
    return out;
  }

  function resolveModel(criticalityModel) {
    criticalityModel = criticalityModel || {};
    return {
      weights: mergeSection(DEFAULTS.weights, criticalityModel.weights),
      caps: mergeSection(DEFAULTS.caps, criticalityModel.caps),
      thresholds: mergeSection(DEFAULTS.thresholds, criticalityModel.thresholds),
      betweenness_node_limit: num(criticalityModel.betweenness_node_limit, DEFAULTS.betweenness_node_limit)
    };
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  /* min(value/cap, 1) with a guard against zero/negative caps. */
  function capNorm(value, cap) {
    var c = (cap > 0) ? cap : 1;
    return Math.min(value / c, 1);
  }

  function distinctSorted(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (id) {
      if (!seen[id]) { seen[id] = 1; out.push(id); }
    });
    out.sort();
    return out;
  }

  function round1(v) { return Math.round(v * 10) / 10; }

  /* Undirected distinct-neighbor lists (sorted for determinism). The centrality
     measures treat the graph as undirected over links, matching the source tool. */
  function buildUndirectedNeighbors(graph, ids) {
    var sets = {};
    ids.forEach(function (id) { sets[id] = {}; });
    graph.links.forEach(function (l) {
      sets[l.source][l.target] = 1;
      sets[l.target][l.source] = 1;
    });
    var out = {};
    ids.forEach(function (id) { out[id] = Object.keys(sets[id]).sort(); });
    return out;
  }

  /* BFS downstream over dependentsOf: how many nodes transitively depend on each node. */
  function cascadeBlastRadius(ids, dependentsDistinct) {
    var result = {};
    ids.forEach(function (id) {
      var seen = {};
      var queue = dependentsDistinct[id].slice();
      var count = 0;
      for (var qi = 0; qi < queue.length; qi++) {
        var cur = queue[qi];
        if (seen[cur] || cur === id) continue;
        seen[cur] = 1;
        count++;
        dependentsDistinct[cur].forEach(function (next) {
          if (!seen[next]) queue.push(next);
        });
      }
      result[id] = count;
    });
    return result;
  }

  /* Brandes betweenness centrality over the undirected graph, exact (no sampling),
     normalized to 0-1 by the pair count (n-1)(n-2)/2. Deterministic: sorted-id
     iteration everywhere. */
  function brandesBetweenness(ids, neighbors) {
    var cb = {};
    ids.forEach(function (id) { cb[id] = 0; });
    ids.forEach(function (s) {
      var stack = [];
      var pred = {};
      var sigma = {};
      var dist = {};
      ids.forEach(function (id) { pred[id] = []; sigma[id] = 0; dist[id] = -1; });
      sigma[s] = 1;
      dist[s] = 0;
      var queue = [s];
      for (var qi = 0; qi < queue.length; qi++) {
        var v = queue[qi];
        stack.push(v);
        neighbors[v].forEach(function (w) {
          if (dist[w] < 0) {
            queue.push(w);
            dist[w] = dist[v] + 1;
          }
          if (dist[w] === dist[v] + 1) {
            sigma[w] += sigma[v];
            pred[w].push(v);
          }
        });
      }
      var delta = {};
      ids.forEach(function (id) { delta[id] = 0; });
      while (stack.length) {
        var w2 = stack.pop();
        pred[w2].forEach(function (v2) {
          var portion = sigma[w2] ? (sigma[v2] / sigma[w2]) * (1 + delta[w2]) : 0;
          delta[v2] += portion;
        });
        if (w2 !== s) cb[w2] += delta[w2];
      }
    });
    var n = ids.length;
    var denom = Math.max(1, (n - 1) * (n - 2) / 2);
    var out = {};
    ids.forEach(function (id) { out[id] = clamp01((cb[id] / 2) / denom); });
    return out;
  }

  /* Closeness centrality (BFS hop distance), normalized against the max observed
     value floored at 1 — ported behavior from the source tool. */
  function closenessCentrality(ids, neighbors) {
    var raw = {};
    var maxVal = 0;
    ids.forEach(function (s) {
      var dist = {};
      dist[s] = 0;
      var queue = [s];
      var total = 0;
      var reached = 1;
      for (var qi = 0; qi < queue.length; qi++) {
        var v = queue[qi];
        neighbors[v].forEach(function (w) {
          if (dist[w] === undefined) {
            dist[w] = dist[v] + 1;
            total += dist[w];
            reached++;
            queue.push(w);
          }
        });
      }
      raw[s] = total ? (reached - 1) / total : 0;
      if (raw[s] > maxVal) maxVal = raw[s];
    });
    var denom = Math.max(1, maxVal);
    var out = {};
    ids.forEach(function (id) { out[id] = raw[id] / denom; });
    return out;
  }

  function levelFor(score, thresholds) {
    if (score >= thresholds.mission_critical) return 'Mission Critical';
    if (score >= thresholds.high) return 'High';
    if (score >= thresholds.moderate) return 'Moderate';
    return 'Low';
  }

  function componentPhrase(key, node, m, dependentCount) {
    if (key === 'mission') return 'mission importance (rated ' + node.mission_importance + ' of 5)';
    if (key === 'echelon') return 'echelon importance (rated ' + node.echelon_importance + ' of 5)';
    if (key === 'degree') return 'its position in the dependency network (' + m.degree + ' direct connections, ' + m.dependency_concentration + ' upstream providers)';
    if (key === 'betweenness') return 'a bridge position between graph clusters';
    if (key === 'failure') return 'worst-case link failure impact (rated ' + round1(m.failure_impact_top2) + ' of 5)';
    if (key === 'shared') return 'shared dependency load (' + dependentCount + (dependentCount === 1 ? ' system depends' : ' systems depend') + ' on it)';
    return key;
  }

  /* 2-3 staff-officer-readable sentences: the score, the top two contributing
     components, and the downstream cascade count. */
  function buildRationale(node, m, dependentCount) {
    var sentences = [];
    sentences.push('Scores ' + m.criticality_score + ' (' + m.criticality_level + ').');
    var order = COMPONENT_ORDER.slice().sort(function (a, b) {
      var diff = m.components[b].contribution - m.components[a].contribution;
      if (diff !== 0) return diff;
      return COMPONENT_ORDER.indexOf(a) - COMPONENT_ORDER.indexOf(b);
    });
    var top = order.filter(function (k) { return m.components[k].contribution > 0; }).slice(0, 2);
    if (top.length === 2) {
      sentences.push('Driven mainly by ' + componentPhrase(top[0], node, m, dependentCount) + ' and ' + componentPhrase(top[1], node, m, dependentCount) + '.');
    } else if (top.length === 1) {
      sentences.push('Driven mainly by ' + componentPhrase(top[0], node, m, dependentCount) + '.');
    } else {
      sentences.push('No single factor dominates; the score reflects moderate mission value and local connectivity.');
    }
    if (m.cascade_blast_radius > 0) {
      sentences.push(m.cascade_blast_radius + ' downstream node' + (m.cascade_blast_radius === 1 ? '' : 's') + ' would be affected by its loss.');
    } else {
      sentences.push('No downstream systems depend on it.');
    }
    return sentences.join(' ');
  }

  /* Annotates every node in graph.nodes with node.metrics and returns
     { ranked, betweennessSkipped, maxScore }. Pure function of its arguments;
     deterministic (sorted-id iteration, no randomness). */
  function computeMetrics(graph, criticalityModel) {
    var model = resolveModel(criticalityModel);
    var caps = model.caps;
    var weights = model.weights;

    var ids = graph.nodes.map(function (n) { return n.id; }).sort();
    var neighbors = buildUndirectedNeighbors(graph, ids);

    var inCount = {};
    var outCount = {};
    var failureValues = {};
    ids.forEach(function (id) { inCount[id] = 0; outCount[id] = 0; failureValues[id] = []; });
    graph.links.forEach(function (l) {
      outCount[l.source] += 1;
      inCount[l.target] += 1;
      failureValues[l.source].push(l.failure_impact);
      failureValues[l.target].push(l.failure_impact);
      if (l.direction === 'bidirectional') {
        outCount[l.target] += 1;
        inCount[l.source] += 1;
      }
    });

    var providersDistinct = {};
    var dependentsDistinct = {};
    ids.forEach(function (id) {
      providersDistinct[id] = distinctSorted(graph.providersOf[id]);
      dependentsDistinct[id] = distinctSorted(graph.dependentsOf[id]);
    });

    var cascade = cascadeBlastRadius(ids, dependentsDistinct);
    var betweennessSkipped = graph.nodes.length > model.betweenness_node_limit;
    var between = betweennessSkipped ? null : brandesBetweenness(ids, neighbors);
    var closeness = closenessCentrality(ids, neighbors);

    var weightSum = 0;
    COMPONENT_ORDER.forEach(function (k) { weightSum += weights[k]; });
    if (!(weightSum > 0)) weightSum = 1;

    var maxScore = 0;
    graph.nodes.forEach(function (node) {
      var id = node.id;
      var degree = neighbors[id].length;
      var failures = failureValues[id].slice().sort(function (a, b) { return b - a; });
      var failureTop2 = 0;
      if (failures.length) {
        var take = Math.min(2, failures.length);
        var sum = 0;
        for (var i = 0; i < take; i++) sum += failures[i];
        failureTop2 = sum / take;
      }
      var depConcentration = providersDistinct[id].length;
      var sharedLoad = capNorm(Math.max(0, graph.dependentsOf[id].length - 1), caps.shared);
      var degreeComposite = (0.35 * capNorm(degree, caps.degree))
        + (0.45 * capNorm(depConcentration, caps.dependency))
        + (0.20 * capNorm(cascade[id], caps.cascade));
      var betweenValue = between ? between[id] : null;

      var values = {
        mission: node.mission_importance / 5,
        echelon: node.echelon_importance / 5,
        degree: degreeComposite,
        betweenness: (betweenValue === null) ? 0 : betweenValue,
        failure: failureTop2 / 5,
        shared: sharedLoad
      };
      var components = {};
      var score = 0;
      COMPONENT_ORDER.forEach(function (k) {
        var contribution = (values[k] * weights[k]) / weightSum * 100;
        components[k] = { value: values[k], weight: weights[k], contribution: contribution };
        score += contribution;
      });
      score = round1(score);
      if (score > maxScore) maxScore = score;

      node.metrics = {
        degree: degree,
        in_degree: inCount[id],
        out_degree: outCount[id],
        dependency_concentration: depConcentration,
        cascade_blast_radius: cascade[id],
        betweenness: betweenValue,
        closeness: closeness[id],
        failure_impact_top2: failureTop2,
        shared_dependency_load: sharedLoad,
        components: components,
        criticality_score: score,
        criticality_level: levelFor(score, model.thresholds),
        rationale: ''
      };
      node.metrics.rationale = buildRationale(node, node.metrics, dependentsDistinct[id].length);
    });

    var ranked = graph.nodes.map(function (n) { return n.id; });
    ranked.sort(function (a, b) {
      var diff = graph.nodesById[b].metrics.criticality_score - graph.nodesById[a].metrics.criticality_score;
      if (diff !== 0) return diff;
      return (a < b) ? -1 : ((a > b) ? 1 : 0);
    });

    return { ranked: ranked, betweennessSkipped: betweennessSkipped, maxScore: maxScore };
  }

  OSP.metrics = {
    computeMetrics: computeMetrics
  };
})();
