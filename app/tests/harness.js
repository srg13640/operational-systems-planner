/* OSP headless harness — loads the app under jsdom and exposes measurement hooks.
   Dev-only: requires `npm i jsdom` (never shipped with the app).
   Ported from the Systems Viz Tool tests/harness.js pattern. */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP_DIR = path.resolve(__dirname, '..');

function loadApp() {
  return new Promise((resolve, reject) => {
    const html = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('error', (...args) => errors.push('console.error: ' + args.join(' ')));
    virtualConsole.on('jsdomError', (err) => {
      const msg = String(err && err.message || err);
      // jsdom cannot decode images or run canvas 2d without node-canvas; those are not app errors
      if (/Could not load img|not implemented.*canvas|HTMLCanvasElement.prototype.getContext/i.test(msg)) return;
      errors.push('jsdomError: ' + msg);
    });

    const dom = new JSDOM(html, {
      url: 'file://' + path.join(APP_DIR, 'index.html'),
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
      virtualConsole,
    });

    dom.window.addEventListener('error', (e) => {
      errors.push('window.error: ' + (e.message || 'unknown'));
    });

    dom.window.addEventListener('load', () => {
      // one extra tick so DOMContentLoaded boot handlers finish
      setTimeout(() => resolve({ dom, window: dom.window, document: dom.window.document, errors }), 120);
    });

    setTimeout(() => reject(new Error('app did not fire load within 15s')), 15000);
  });
}

function clickView(app, view) {
  const btn = app.document.querySelector('#viewTabs button[data-view="' + view + '"]');
  if (!btn) throw new Error('view tab not found: ' + view);
  btn.dispatchEvent(new app.window.Event('click', { bubbles: true }));
}

function setScrub(app, t) {
  const scrub = app.document.getElementById('scrub');
  scrub.value = String(t);
  scrub.dispatchEvent(new app.window.Event('input', { bubbles: true }));
}

function graphNodePositions(app) {
  const out = {};
  const nodes = app.document.querySelectorAll('#gNodes g.node');
  nodes.forEach((g) => {
    const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform') || '');
    if (m) out[g.getAttribute('data-id')] = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
  });
  return out;
}

function minPairDistance(positions) {
  const ids = Object.keys(positions);
  let min = Infinity;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]], b = positions[ids[j]];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < min) min = d;
    }
  }
  return min;
}

function maxDelta(p1, p2) {
  let max = 0;
  for (const id of Object.keys(p1)) {
    if (!p2[id]) return Infinity;
    const d = Math.hypot(p1[id].x - p2[id].x, p1[id].y - p2[id].y);
    if (d > max) max = d;
  }
  return max;
}

module.exports = { loadApp, clickView, setScrub, graphNodePositions, minPairDistance, maxDelta, APP_DIR };
