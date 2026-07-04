#!/bin/bash
# OSP static gates — syntax, offline discipline, id hygiene. Exit nonzero on any failure.
set -e
cd "$(dirname "$0")/.."

echo "== syntax =="
for f in scripts/*.js; do node --check "$f"; done
echo "all scripts parse"

echo "== offline gates (runtime network calls are forbidden) =="
# Scoped to app-authored code: vendored libraries (lib/) legitimately contain
# fetch/XHR/WebSocket tokens as part of general-purpose loader utilities
# (e.g. Three.js's FileLoader/TextureLoader) that OSP's own code never calls
# with a URL. A hit here, in code we wrote, is the real smoking gun.
if grep -rnE "fetch\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource|importScripts" scripts/ index.html; then
  echo "FAIL: runtime network call found in app-authored code"; exit 1; fi
if grep -rnE "(src|href)=[\"']https?://" index.html styles/*.css; then
  echo "FAIL: external resource reference found"; exit 1; fi
# CDN-host-string gate DOES scan lib/ — a hardcoded CDN fallback URL baked
# into a vendored file would be a genuine risk, unlike a generic fetch()
# capability the library ships but OSP never invokes.
if grep -rniE "cdn\.|unpkg|jsdelivr|cdnjs|googleapis|fonts\.gstatic|threejs\.org" scripts/ lib/ index.html styles/; then
  echo "FAIL: CDN reference found"; exit 1; fi
if grep -rnE '<script[^>]*type="module"' index.html; then
  echo "FAIL: ES module script (breaks file://)"; exit 1; fi
# three-loader.js is the one place a "dynamic import of a URL" pattern is
# expected and safe — verify every import() target is a blob: URL variable
# it constructed itself, never a bare http(s) literal.
if grep -nE "import\((\"|')https?://" lib/three/three-loader.js; then
  echo "FAIL: three-loader.js imports a literal http(s) URL instead of a local blob: URL"; exit 1; fi
echo "offline clean"

echo "== console hygiene =="
if grep -rnE 'console\.(log|debug)' scripts/; then
  echo "FAIL: console.log/debug in shipped code"; exit 1; fi
echo "console clean"

echo "== asset presence =="
test -f lib/basemap/world/world_4096.jpg
test -f lib/milsymbol/milsymbol.js
test -f lib/milsymbol/LICENSE
test -f lib/three/three.module.b64.js
test -f lib/three/three-loader.js
test -f lib/three/LICENSE
test -f data/pacific_sentinel.json
test -f data/baltic_sentinel.json
echo "assets present"

echo "ALL GATES PASS"
