#!/bin/bash
# OSP static gates — syntax, offline discipline, id hygiene. Exit nonzero on any failure.
set -e
cd "$(dirname "$0")/.."

echo "== syntax =="
for f in scripts/*.js; do node --check "$f"; done
echo "all scripts parse"

echo "== offline gates (runtime network calls are forbidden) =="
if grep -rnE "fetch\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource|importScripts" scripts/ index.html; then
  echo "FAIL: runtime network call found"; exit 1; fi
if grep -rnE "(src|href)=[\"']https?://" index.html styles/*.css; then
  echo "FAIL: external resource reference found"; exit 1; fi
if grep -rniE "cdn\.|unpkg|jsdelivr|cdnjs|googleapis|fonts\.gstatic" scripts/ index.html styles/; then
  echo "FAIL: CDN reference found"; exit 1; fi
if grep -rnE '<script[^>]*type="module"' index.html; then
  echo "FAIL: ES module script (breaks file://)"; exit 1; fi
echo "offline clean"

echo "== console hygiene =="
if grep -rnE 'console\.(log|debug)' scripts/; then
  echo "FAIL: console.log/debug in shipped code"; exit 1; fi
echo "console clean"

echo "== asset presence =="
test -f lib/basemap/world/world_4096.jpg
test -f lib/milsymbol/milsymbol.js
test -f lib/milsymbol/LICENSE
test -f data/pacific_sentinel.json
echo "assets present"

echo "ALL GATES PASS"
