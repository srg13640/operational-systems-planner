# Verification

Updated: 2026-07-04 (Loop 6).

## Loop 6 gate run — 2026-07-04 (GitHub, editor, second scenario)

- **Repository discipline**: repo root carries `app/`, `docs/`, `tools/`, CI config, LICENSE
  (MIT + third-party notices); `_source/` (1.5GB prototype originals), `_archive/`,
  `node_modules/`, and session state are excluded by `.gitignore`. `npm run verify` =
  `app/tests/gates.sh` (syntax, offline greps, console hygiene, asset presence) + the
  headless smoke suite; CI (`.github/workflows/ci.yml`) runs the same pipeline on every push;
  `.github/workflows/pages.yml` deploys `app/` to GitHub Pages.
- **In-app editor** (new `scripts/editor.js`): inspector edit forms for nodes/links,
  add/delete with reference cleanup (links, parent refs, vulnerability/activity refs, layout
  positions), click-to-place on map, snapshot undo (20 deep, add+first-save is one atomic
  step). Every mutation re-enters `normalizeScenario`, so edited data obeys the import
  contract. Gates: add-node form opens, node persists with typed name, add-link persists,
  zero error-level issues after edits, two undos restore exact baseline counts — plus a live
  browser pass (form → save → selection follows → undo → console clean).
- **Second built-in scenario**: Operation BALTIC SENTINEL (35 nodes / 65 links / 14
  activities / 4 analyst vulnerabilities), authored to the same contract, verified
  independently of its author: zero normalize issues, all geometry in the Europe box, and its
  own phase-emergent reveal — the Gdynia port logistics node goes from 2 dependents at H+12
  to 6 at H+48 when the rail corridor is cut (gated in `measure.js`). Scenario switcher in the
  Data manager; browser-verified on the global map (Norway ground station to Ramstein to the
  Suwałki corridor).
- **Smoke suite now 35 checks — all passing.** Offline discipline unchanged and still
  CI-enforced: the app makes zero runtime network calls even though the product now lives
  online (owner decision 2026-07-04: offline-capable is a feature; online is distribution).

Historical record of earlier loops follows.

Previous update: 2026-07-03 (Loop 4). All gates below were re-run after the Loop 4 changes (wide
NASA topo.bathy basemap with cover-fit, vendored milsymbol MIL-STD-2525C markers with
deterministic declutter, collapsing inspector, phase captions, wargame-enriched scenario);
results are recorded inline.

## Loop 4 gate run — 2026-07-03

- Headless smoke gate: **27/27 PASS** (two new gates: activities 15–17, phase captions
  present). Enriched demo pins: 40 nodes / 68 links / 16 activities / 4 analyst
  vulnerabilities; validation still zero errors, zero warnings; layout determinism still
  0.000px; KILO SPOF still absent at H+12 and emergent at H+48 (now the lead SEV-5 card).
- Offline greps: clean, including the vendored `lib/milsymbol/milsymbol.js` (grep-verified: no
  fetch/XHR/WebSocket in the library) and the new basemap loaded by relative `<img>` path.
- Browser pass at 1440×860: full-bleed map (no letterbox), 2525 frames render with correct
  icons/echelons/HQ staffs (an installation-vs-EOD and an EW SIDC mistranslation were caught
  visually and fixed against milsymbol's own letter table), degraded rings on KADENA / Relay
  WHISKEY / Fiber PALAWAN at H+42, phase caption narrates each phase, selected KILO finding
  draws its cross-theater dependency convergence, inspector collapses when nothing is selected.
- Marker declutter verified numerically: minimum pairwise marker distance ≥ 20px at fit zoom
  and ≥ 21px at 5.2× over the co-located Luzon/Guam clusters (`getScreenPositions()` probe).
- Asset provenance: basemap cropped from NASA Blue Marble topo.bathy 21600×10800 (public
  domain, eoimages.gsfc.nasa.gov) to 5700×3900 (lon 85–180, lat 50 to −15); milsymbol 2.2.0
  vendored from the npm package with its MIT LICENSE alongside. Downloads were build-time
  only — the app makes zero runtime network calls, re-verified in the browser network log.
- **Pan-clamp fix** (user-reported: the map could be dragged off-canvas, exposing void). The
  source's 80px "loose pan" clamp was replaced with a hard cover clamp: the basemap must cover
  every canvas pixel at all times; the clamp also runs on canvas resize and after programmatic
  fits. Verified with a 9-case adversarial probe in the live browser (extreme pans in every
  direction at k=1 and k=3, corner-zoom + far pan, fit-to-data) — all cases report full edge
  coverage, and the smoke gate re-passed 27/27. Also added stale-session detection: restoring
  an autosave after the embedded baseline has changed now shows an explicit "built-in scenario
  has been UPDATED" toast (fingerprint of the seed island compared across sessions).

## How to run everything

```sh
# 1. Static gates (no dependencies)
cd app
for f in scripts/*.js; do node --check "$f"; done

# 2. Offline gates (greps must print nothing)
grep -rnE "fetch\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource|importScripts" scripts/ index.html
grep -rnE "(src|href)=[\"']https?://" index.html styles/*.css
grep -rniE "cdn\.|unpkg|jsdelivr|cdnjs|googleapis|fonts\.gstatic|tile\.openstreetmap|api\.mapbox" .
grep -rnE '<script[^>]*type="module"' index.html

# 3. Headless smoke gate (dev-only dependency, never shipped)
cd .. && npm i jsdom && cd app && node tests/measure.js

# 4. Manual browser pass — open app/index.html by double-click (file://)
```

## Loop 5 gate run — 2026-07-03 (global basemap)

- The fixed Indo-Pacific crop was replaced with a **global tile pyramid** (whole Earth,
  ±180°/±90°, 60 px/degree native): `world_4096.jpg` base always loaded, 32 L1 + 128 L2 tiles
  loaded on demand with an LRU cache. Total 33MB; deleting `t2_*` yields a ~12MB lite build
  that degrades to L1 sharpness. Scenario data was untouched — lat/lon is the only persisted
  geography, so everything re-projected automatically.
- **Generation bug caught and fixed:** macOS `sips --cropOffset` silently center-crops when an
  offset is 0, which corrupted edge tiles (Africa appearing in the Arctic). Rebuilt with a
  zero-offset-safe crop primitive (per-axis flip → mirrored-offset crop → flip back).
- **Every tile verified, twice:** (1) region-diff — all 32 L1 tiles pixel-sampled against the
  world base and all 128 L2 tiles against their L1 parent quadrant (true misplacement scored
  d=55–75 pre-fix; post-fix worst is 28.9, all in high-contrast Arctic speckle); (2) **edge
  continuity** — border columns of 60 adjacent tile pairs compared (median diff 3.1, worst
  13.7; misplacement would score 40+). Both probes ran in the live browser against the shipped
  files.
- Browser checks: boot still opens fitted to the scenario's operating area; Europe and CONUS
  render seamlessly at multiple zooms; zero console errors; all tile requests local. Headless
  smoke gate re-passed **27/27**; offline greps clean.

## Gate results — 2026-07-03

### Offline gates — PASS

- `node --check` clean on all 13 scripts.
- No `fetch`/`XMLHttpRequest`/`WebSocket`/CDN/external `src|href` anywhere in `app/`
  (grep gates above return nothing).
- No ES modules; plain script tags in dependency order — the FSP v1.3 `file://` module
  failure cannot recur.
- Real-browser network log (Chrome, full workflow exercised: all three views, scrub, selection,
  weight change, PNG export): **every request is localhost; zero external requests**.
- Console: **zero errors, zero warnings** through the full workflow.
- Seed data is a JSON island in `index.html` (no `fetch()` of local JSON, which fails over
  `file://`); basemap is a relative-path `<img>`-decodable JPEG, which loads fine over `file://`.

### Headless smoke gate (`node app/tests/measure.js`) — PASS 25/25

Highlights of what it asserts (see the file for the full list):

- Boot with zero console/window errors, twice (two cold loads).
- Demo scenario loads with pinned counts: 36 nodes, 59 links, 3 phases, **zero validation
  issues** (errors or warnings).
- Classification banner text is rendered from `meta.classification`, never hardcoded.
- **Phase-aware finding emergence** (the demo's core claim): at H+12 there is no ground-station
  SPOF/shared-dependency finding; at H+48 it exists. H+48 has strictly more findings than H+12.
- Ground Station KILO ranks top-3 in criticality at H+48.
- Findings are deterministic (two runs, identical output).
- All views switch A→B→A cleanly; graph renders all 36 nodes.
- **Layout determinism across two cold loads: 0.000px** (the CO-001 regression tripwire;
  pre-fix source drift was 211px). No node overlap (min pair distance 58.0px ≥ 50px gate).
- Risk board renders finding cards, the EMERGED tag, the 25-row criticality table, and the BLUF.
- Weight-slider recompute is error-free; inspector renders the criticality rationale.
- JSON export → import round-trip preserves all counts with zero errors.

Note: jsdom cannot execute canvas 2D, so the **map view renders only in the browser pass**;
`render-map.js` guards for a missing 2D context so headless boot stays clean. Dynamically
created ids (`gRoot`, `gChains`, `gLinks`, `gNodes`, `mapCursor`) are expected misses for the
`getElementById` cross-check — they are injected at init.

### Manual browser pass (Chrome via local server; equivalent to `file://`) — PASS

The primary workflow, exact click path:

1. Open the app → Map view loads, fitted to the operating area, banner reads
   `UNCLASSIFIED // NOTIONAL - FICTIONAL DATA // PROTOTYPE`. Two satellites listed in the
   unplaced-entities tray as orbital/virtual — never silently dropped.
2. Timeline: scrub to H+48 → status bar flips to CLOSE OPERATIONS, findings count rises,
   Relay Site WHISKEY draws a degraded (dashed amber) ring.
3. RISK view → BLUF states the H+48 picture and calls out "5 emerged since H+0"; the top card
   is `AUTO / SEV 5 / EMERGED AT H+48 — Ground Station KILO`, with evidence, "so what,"
   mitigation, and clickable affected-node chips.
4. Click the finding → selection carries to GRAPH view: KILO chain highlighted, affected nodes
   ringed, other chains receded; inspector shows the full finding card.
5. Click Ground Station KILO → inspector shows score badge, six-component breakdown bars,
   plain-English rationale, relations (clickable chips), and the findings touching the node.
6. Drag a criticality weight slider → scores and findings recompute live.
7. Export button on Graph/Map → PNG downloads with banner header and title-block footer
   (scenario · phase · H+time · view · timestamp); on Risk → Markdown findings summary.
8. Brief mode (B) at 1280×720 projector size → rails collapse, type gains a step, graph fills
   the screen, timeline persists. Esc exits.
9. Light theme verified for lit-room use; choice persists across reload.
10. Reload → autosaved session restores (toast confirms); Data manager → Restore baseline
    returns to the embedded scenario.

### Import validation — PASS (exercised in headless gate + code review)

- Imports are staged: a validation report (errors red, warnings amber) renders **before**
  Apply/Discard. Nothing replaces the session until Apply.
- CSV imports merge by id — the source tool's destructive "nodes.csv wipes links" trap is
  removed by design.
- Legacy Systems Viz JSON adapts on import (flat lat/lon → `geo{}`, string classification →
  marking object, `layout_positions` → layout block).

## Known limits (honest)

- jsdom smoke gate does not exercise the map canvas, PNG pixel content, or real download
  events — those are browser-pass items. A Playwright pass (network-silence assertion,
  screenshot diffs, download capture) is in the backlog.
- PNG export mirrors the live viewport proportionally; at extreme window sizes below the
  960×600 export floor the framing may differ slightly from the screen (all layers still share
  one transform, so overlays cannot mis-register — the FSP failure mode is structurally
  excluded).
- Betweenness is skipped above 250 nodes with a visible caveat chip; demo scale never trips it.
- Criticality is a structural estimate; the UI and every export say so.

## Recording convention

After any meaningful change: run gates 1–3, do the 10-step browser pass, and record the date,
command, and result here (source-family convention from both PROJECT_STATUS files).
