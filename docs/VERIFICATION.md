# Verification

Updated: 2026-07-04 (Loop 9).

## Loop 9 gate run — 2026-07-04 (layer-geometry fix + cinematic animation)

Two pieces of direct owner feedback: (1) land/maritime were stacked at different altitudes
like the abstract domains, which doesn't make physical sense — a coastline is one surface, not
two; (2) the view felt static ("peering into an actual movie" was the bar) — the sine-pulsed
rings and traveling glow heads researched from the source prototype in Loop 8 were never
actually implemented, only the static geometry was.

**Geometry fix**: land and maritime now share one surface-altitude tier (25/27 world units
apart — enough to avoid z-fighting between the two plane meshes, imperceptible as a "layer
gap"), distinguished by their real lat/lon separation rather than a synthetic offset or a
meaningful vertical stack. New regression gate in `measure.js`: land/maritime altitudes must
be within 5 units of each other, and the surface tier must sit well below the nearest abstract
domain — both pass. Verified visually in the browser from a near-horizontal camera angle on
both scenarios: Pacific (maritime only) shows it sitting with the ground-level cluster, not
elevated; Baltic (land + maritime both present) shows both labels immediately adjacent with no
visible gap, unlike the clearly-separated abstract-domain bands above them.

**Animation layer added**: continuous `requestAnimationFrame` loop, independent of the
auto-orbit toggle, driving sine-modulated pulse opacity on criticality/selection rings, a
glow-head sprite traveling along every emphasized/finding-highlighted link's arc, pulsing
(not moving) scale on activity glow-heads, and additive blending on every glow/pulse/head
material. Verified live (not assumed): two screenshots ~1 second apart show the finding-chain
glow head at visibly different positions along its arc, confirming the loop genuinely runs
frame-to-frame rather than only re-rendering on state changes.

**The determinism/animation tension, resolved and verified**: continuous motion and "exports
are byte-identical" are in conflict unless something explicit resolves it. `exportDraw` freezes
the animation clock to a fixed instant before capturing. Verified directly: two `exportDraw`
calls 900ms apart (long enough for uncontrolled pulse phase to have visibly drifted) produced
identical PNG data URLs, byte for byte. Per-object animation phase is derived from a
deterministic string hash of the node/link id — never `Math.random`, never raw wall-clock —
so the reproducibility guarantee holds without needing to disable animation for export.

Also added: sharper icon textures (256px backing canvas for a 128-unit design space, so a
criticality-scaled sprite doesn't pixelate), a subtle sheen pass for less-flat silhouettes, a
deterministically-seeded (not `Math.random`) starfield for background depth, and eased camera
transitions on fit/zoom button clicks (live drag/wheel stays instant).

Gates: smoke suite now **38/38**. Static gates unaffected (no new dependencies, no offline
surface changed). Full browser pass re-run: zero console errors, land/maritime confirmed
coplanar on both scenarios, traveling-glow motion confirmed frame-to-frame, export determinism
confirmed under load, additive-blended visuals confirmed richer against the dark theme.

Previous update: 2026-07-04 (Loop 8).

## Loop 8 gate run — 2026-07-04 (STACK view rebuilt as real WebGL)

The user showed a screenshot of the actual prior prototype (Three.js/WebGL, glowing
volumetric domain layers, hand-drawn doctrine icons, orbit camera, spotlight tool) and asked
for that fidelity specifically. Loop 7's canvas-2D stack was a good-faith simplification, not
a match — this loop replaces its internals with real WebGL, porting the source's actual
rendering techniques (confirmed by reading its code directly, not guessing).

**A real bug caught before it shipped**: the first working version used a bare incrementing
counter (`trayXZ`) to place unplaced (no lat/lon) entities, called independently from three
different builder functions each frame — the same node landed in a different tray slot in
each pass, so its links would render disconnected from its own sprite. Fixed by computing one
shared, memoized `id → world position` map once per frame (`computeWorldPositions`), consumed
by every builder. Caught by code review before any browser testing, not by a user report.

**A real loader bug caught during first browser test**: the initial three-loader.js dynamic-
imported a single blob: URL for `three.module.min.js`, which failed immediately —
`TypeError: Failed to resolve module specifier "./three.core.min.js"` — because the module
build internally imports a second file via a relative specifier, which cannot resolve against
a blob: base URL. Fixed by porting the source's actual two-blob chain (vendor both files,
mint a blob: URL for the core file first, text-rewrite the module's internal import string to
point at it, blob the rewritten text, import that). Verified in the live browser afterward:
`window.THREE.REVISION === "184"`, zero console errors.

**Gates**:
- Headless smoke suite: **36/36 PASS**, including a new check that jsdom's inevitable WebGL
  absence is handled gracefully — `OSP.renderStack.isFailed() === true`, zero thrown errors,
  fallback message present, and (critically) every other check that touches map/graph/risk/
  editor/scenarios is unaffected.
- Static gates (`gates.sh`) extended, not relaxed, to cover the new dependency: the CDN-host
  grep now scans `lib/` too (vendored files could theoretically embed a CDN fallback URL —
  confirmed clean); a new targeted check asserts `three-loader.js` only ever dynamic-imports
  `blob:` URLs it constructed itself, never a literal `http(s)://` string. The fetch/XHR/
  WebSocket gate stays scoped to app-authored code, since Three.js's unused `FileLoader`/
  `TextureLoader` utility classes legitimately contain those tokens without OSP ever calling
  them with a URL — scanning `lib/` for those specific tokens would be a permanent false
  positive, not a real signal.
- Browser pass (all via live interaction, not assumption): orbit drag, wheel zoom, click-to-
  select with raycasting, finding-selection glow chain crossing multiple domain planes,
  per-domain layer visibility toggle, enemy/OPFOR visibility toggle, spotlight tool (CSS
  radial-gradient dim + click-lock, `S` hotkey, Esc release), reset-view button, dark/light
  theme correctly flipping the WebGL clear color and fog color live, brief mode collapsing to
  full width, window resize, PNG export (`exportDraw` renders a fresh frame at target
  resolution and blits it — verified non-blank via pixel sampling with real tonal variation,
  not a uniform fill), and both built-in scenarios (Pacific's 9 domains, Baltic's 10 including
  `land`) rendering correctly. Zero console errors and zero failed network requests throughout.
- Offline re-confirmed with the vendored dependency in place: DevTools-equivalent network log
  during the full pass above shows no non-local requests; Three.js and milsymbol are fully
  local; the blob: URL construction happens from locally-embedded base64, never fetched.

Previous update: 2026-07-04 (Loop 7).

## Loop 7 gate run — 2026-07-04 (multi-domain STACK view)

- New first-class **STACK** view (`scripts/render-stack.js`): a multi-domain 3D stack drawn
  with a hand-rolled perspective projection on canvas 2D (painter's algorithm) — zero new
  dependencies, works over `file://`, deterministic per frame, and exports through the same
  model-redraw PNG pipeline (banner-stamped). Domain layers are derived from the data; nodes
  sit on their plane at their geographic position (unplaced nodes tray-row on their plane,
  never dropped); cross-domain dependencies render as vertical arcs; selection/finding chains
  highlight across layers; timeline dimming and degraded rings behave exactly as on the map.
- Gates: smoke suite now **36 checks — all passing** (stack module + export hook present with
  ≥5 data-derived domains; view-switch cycle extended to include STACK, twice, error-free).
- Browser pass: orbit drag, wheel zoom, separation sweep (60→150→110), per-domain layer
  toggle off/on, auto-orbit on/off, search-select on the stack, finding selection lighting the
  KILO chain across layers, PNG export from the stack — zero console errors throughout.
- Product note: the stack was deliberately deferred in Loop 1 ("highest wow, lowest decision
  value" from the 3D prototype family); promoted to first-class by owner decision 2026-07-04
  and rebuilt data-driven rather than ported — no Three.js, no doctrine rhetoric, same shared
  selection/timeline contract as every other view.

Previous update: 2026-07-04 (Loop 6).

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
