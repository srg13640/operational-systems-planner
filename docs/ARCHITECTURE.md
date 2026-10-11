# Architecture

Updated: 2026-09-15

## One repository, many views (DoDAF alignment)

OSP holds **one architecture repository** — the scenario: performers, systems, the relationships
between them, geography, and time — and derives every screen from it. Since schema 1.1 the
derived screens are organised as DoDAF-style architecture views plus the original analysis
surfaces:

| Tab | Model | What it selects from the repository | Layout |
|---|---|---|---|
| OV-1 | High-Level Operational Concept Graphic | Everything with a location, on the basemap; *concept mode* suppresses the analytic overlay | map |
| OV-2 | Operational Resource Flow Description | `arch_class = performer` nodes and the flow links between them; **derived needlines** (dashed) where two performers exchange only through systems | network |
| OV-4 | Organizational Relationships Chart | Performers; hierarchy from `parent_id`; `commands / controls / supports` links dotted over it | hierarchy |
| SV-1 | Systems Interface Description | `arch_class = system` nodes and the links between them; optional owning-performer context | network |
| SV-2 | Systems Resource Flow Description | SV-1 with every interface labelled by `communication_method` and `bandwidth` | network |
| GRAPH / STACK / RISK | fit-for-purpose analysis views | the whole repository, with the criticality lens always on | as before |

Rules that keep the views honest:

- **A view never owns data.** `dodaf.js` is a pure module: `buildView(viewId, scenario, fullGraph,
  opts)` filters entity classes and relationship classes, adds derived edges with an explicit
  `via` path, and reports what it left out (`hidden`, `hiddenLinks`). The rail shows that
  summary; nothing is dropped silently. OV-2 and SV-1 therefore cannot disagree.
- **Classification is data, not inference at render time.** Every node carries `arch_class`
  (`performer | system | location | other`). It defaults from `node_type`
  (`ARCH_CLASS_OF_NODE_TYPE` in `model.js`) and is overridden per node where the type
  misleads — a battery typed `shooter` for the STACK view is still an organisation in OV-2/OV-4;
  a fibre landing typed `facility` is a system in SV-1. The editor exposes the field.
- **Derived needlines are computed, never persisted.** OV-2 traces performer → system* →
  performer paths through at most `MAX_DERIVED_HOPS` (2) system intermediates over flow links
  (anything but `commands / controls / targets`). A derived needline is active at time *t* only
  when every node on its path is; the inspector and hover label it `via …`. Switchable off.
- **Per-view pinned layouts.** `layout.views[viewId].positions` holds pins for each view so the
  same system can sit in one place on SV-1 and another on OV-2; `layout.graph_positions` remains
  the dependency graph's pins. Architecture views get more layout room than the analysis graph
  (`spacing` / `minSlotWidth` options on the pure layout functions) and wrap long labels.
- **The analytic lens is optional on architecture views.** Criticality colour/size and
  vulnerability chains are off by default on OV/SV models and on OV-1 in concept mode, so an
  exported OV-2 reads as an operational concept, not a risk picture. One checkbox turns the lens
  on; the dependency graph, stack and risk board always have it.
- **Every frame identifies its model.** The model bar shows `CODE Title · caption`; PNG exports
  stamp the same into the footer.

Not yet modelled (candidates, in rough priority): OV-5a/b activity decomposition (would need an
activity taxonomy the scenario does not carry), OV-3 / SV-6 exchange matrices (tabular export of
OV-2 / SV-2 edges is a small step), SV-5a capability-to-system mapping, AV-1 overview from
`meta`.

## Runtime constraints (non-negotiable)

- Opens by double-clicking `app/index.html` over `file://`. No server required.
  `python3 -m http.server` is a dev convenience only.
- Zero runtime network calls. No CDN, no fetch of remote resources, no telemetry, no webfonts.
  Every byte ships in the folder (IL5-portable / closed-network assumption from both sources).
- No build step, no npm at runtime, no `<script type="module">` (a static `import` declaration
  breaks over `file://` in Chrome — proven failure in FSP v1.3). Plain `<script src>` tags in
  dependency order. The one narrow exception is `lib/three/three-loader.js`: a classic script
  that calls the dynamic `import()` *function* (not a static declaration) on a `blob:` URL it
  constructs itself from a locally-embedded base64 payload — `blob:` URLs are exempt from the
  file:// restriction that breaks static imports, and no bundler or build step is involved.
- Seed data lives in a `<script type="application/json">` island in `index.html` because
  `fetch()` of local JSON fails over `file://`. `app/data/*.json` holds the human-readable
  authoring copies.
- Vanilla JS/CSS/HTML, plus one vendored runtime dependency (Three.js, for the STACK view —
  see its section below for why and how it stays offline-safe). jsdom is the only dev
  dependency (tests only, never shipped to users).

## Folder structure

```
app/
├── index.html              shell: chrome markup + seed-scenario JSON island + script tags
├── styles/
│   └── main.css            all CSS incl. light/dark theme tokens
├── scripts/
│   ├── model.js            schema constants, normalize/validate, graph build, phase logic, arch_class
│   ├── dodaf.js            architecture-view registry and filters (OV-1/OV-2/OV-4/SV-1/SV-2), derived needlines (pure)
│   ├── metrics.js          criticality engine (pure functions)
│   ├── findings.js         vulnerability rule engine (pure functions)
│   ├── layout.js           deterministic hierarchy + force layout (pure functions)
│   ├── io.js               JSON/CSV import-export, column aliases, download helpers
│   ├── geo.js              lat/lon ↔ basemap-pixel projection, viewport transform
│   ├── symbols.js          FM 1-02.2 unit symbol SVG table
│   ├── render-graph.js     SVG renderer for every graph-surface view (OV-2, OV-4, SV-1, SV-2, dependency graph)
│   ├── render-map.js       canvas map view (OV-1 with concept mode)
│   ├── render-risk.js      risk board view
│   ├── render-stack.js     multi-domain 3D stack (real WebGL via vendored Three.js)
│   ├── editor.js           in-app editing: forms, add/delete, place-on-map, snapshot undo
│   ├── inspector.js        selection inspector panel
│   ├── export.js           PNG model-redraw export, banner/title-block stamping
│   └── app.js              state store, wiring, timeline, keyboard, persistence, boot
├── lib/
│   ├── three/
│   │   ├── three.module.min.js   vendored Three.js r184 (MIT) — WebGL 3D engine
│   │   ├── three.core.min.js     Three.js core (the module build imports this internally)
│   │   ├── three.module.b64.js   both files above, base64-encoded as plain `window.__OSP_THREE_*_B64`
│   │   │                         string constants — a classic script, safe to load over file://
│   │   ├── three-loader.js       classic script; decodes the payloads, text-rewrites the
│   │   │                         module's internal relative import to point at a blob: URL for
│   │   │                         core, blobs the rewritten module text, and dynamic-imports
│   │   │                         THAT blob: URL. Sets window.THREE; fires 'three-ready' or
│   │   │                         'three-unavailable' on document. This is OSP's first runtime
│   │   │                         dependency — see the STACK view note below for why.
│   │   └── LICENSE               Three.js MIT license
│   ├── basemap/
│   │   └── world/            GLOBAL basemap tile pyramid — NASA Blue Marble topo.bathy
│   │       ├── world_4096.jpg          L0: whole Earth, always loaded (4096×2048)
│   │       ├── t1_{x}_{y}.jpg          L1: 8×4 tiles, 2700 world px each (30 px/degree)
│   │       └── t2_{x}_{y}.jpg          L2: 16×8 tiles, 1350 world px each (60 px/degree)
│   │       (public domain; ~58MB; deleting t2_* yields a ~12MB "lite" build that
│   │        degrades gracefully to L1 sharpness)
│   └── milsymbol/
│       ├── milsymbol.js      vendored milsymbol 2.2.0 (MIT) — MIL-STD-2525C symbol renderer
│       └── LICENSE
├── data/
│   └── pacific_sentinel.json    authoring copy of the embedded demo scenario
├── data/
│   └── baltic_sentinel.json     authoring copy of the second built-in demo scenario
└── tests/
    ├── gates.sh            static gates: syntax, offline discipline, console hygiene, assets
    ├── harness.js          jsdom loader: console-clean, node positions, view switching
    └── measure.js          pass/fail smoke gate (exit code) — `npm run verify` runs both
```

`model.js`, `dodaf.js`, `metrics.js`, `findings.js`, `layout.js`, `geo.js`, `io.js` are pure modules
(attach to `window.OSP.*`, no DOM access) so the jsdom harness can unit-test them directly.

### STACK view — real WebGL, and why

The stack view renders every domain in the scenario as a translucent plane at a hand-tuned
altitude, with nodes as canvas-drawn, halo-glowing billboard sprites and cross-domain
dependencies as glowing, animated Bezier arcs. It was rebuilt three times in one day: first as
a canvas-2D approximation, then — at the owner's request to match a specific prior prototype's
fidelity — as genuine WebGL porting that prototype's actual techniques, then a third pass
fixing a geometry error and adding the continuous animation layer that was researched but
never implemented in pass two:

**Land and maritime are a surface TIER, not two stacked layers.** Every abstract domain
(space/air/ems/cyber/c2/data/strike/sustain) genuinely IS "more abstract, further from the
ground" than the one below it, so stacking them by altitude is the right model. Land and
maritime are different in kind: a coastline is one physical surface at one reference height,
not the ocean floating above (or buried under) the beach. The first WebGL pass got this wrong
— it gave maritime a materially higher altitude than land, the same treatment as every other
domain — until the owner pointed out the geometry itself didn't make sense. Fixed: both now
share one `SURFACE_ALT` tier (a few world units apart, just enough to avoid z-fighting between
their two plane meshes), distinguished the way real geography already distinguishes them — a
naval unit's lat/lon puts it out to sea, an inland unit's puts it on the coast — never a
synthetic horizontal offset square the way the source faked it with hand-authored PLAN-view
coordinates. Gated in `measure.js`: land/maritime altitudes must be within 5 units of each
other, and the surface tier must sit well below the nearest abstract domain.

**Continuous idle animation** — the piece that made the view feel like a still frame instead
of "peering into a movie," per direct owner feedback. Sine-modulated pulsing opacity on
high-criticality and selection rings; a glow-head sprite that travels continuously along every
emphasized/finding-highlighted link's arc (deterministic per-object phase from a string hash
of the node/link id — never `Math.random`, never wall-clock alone); a pulsing (not moving)
scale on activity glow-heads, whose *position* stays driven purely by the real timeline
scrubber; a deterministic-seeded seeded starfield for background depth; `THREE.AdditiveBlending`
on every glow/pulse/head material for real luminosity instead of a flat alpha blend; eased
(not instant) camera transitions on fit/zoom button clicks, while live drag/wheel interaction
stays immediate. One persistent `requestAnimationFrame` loop drives all of this whenever the
stack view is on screen, independent of the separate auto-orbit toggle.

**Reproducible exports, protected.** Continuous animation and "two exports of the same
selection are byte-identical" are in tension — solved by freezing the animation clock to a
fixed instant during `exportDraw` (verified: two exports 900ms apart produce byte-identical
PNG data). Camera framing is deliberately NOT frozen the same way — it was never part of the
reproducibility contract, so an export mid-tween simply captures wherever the camera is.

What was ported from the original prototype, technique-for-technique:

- **No bloom post-process anywhere** (confirmed absent in the source too). Every "glow" is
  either a layered translucent `MeshBasicMaterial` disc/ring (`depthWrite:false`), a
  radial-gradient `CanvasTexture` on a sprite, or a `destination-over` composited halo painted
  *behind* a hand-drawn canvas silhouette before that canvas becomes a sprite texture.
- **Hand-rolled spherical orbit camera** (`radius/phi/theta` around a target point) — not
  `THREE.OrbitControls`. Drag orbits, Shift+drag pans, wheel zooms.
- **18-ish icon painters → 12 in OSP's port**, each ending in the same `paintHalo()` helper;
  dispatch keyed off `node_type`/`domain`/`symbol.branch_type` rather than the source's
  unit-specific vocabulary.
- **Vendored, not CDN.** Three.js r184 ships as an ES module that internally imports a second
  file (`three.core.min.js`) via a relative specifier — which cannot resolve against a `blob:`
  base URL. `three-loader.js` ports the source's fix exactly: decode both files from base64
  (carried in a plain classic script so they load safely over `file://`), mint a `blob:` URL
  for the core file, text-rewrite the module's internal import to point at that URL, blob the
  rewritten module source, and dynamic-`import()` *that*. Works identically over `file://` and
  `http://` — no dual-path fallback needed. This is OSP's first runtime dependency; the offline
  gates were extended (not relaxed) to cover it — see `docs/VERIFICATION.md`.
- **Graceful, tested fallback.** If WebGL/Three.js fails to initialize (disabled GPU, or
  jsdom, which has no WebGL context), the view shows a plain message and every other surface
  keeps working. The headless smoke suite exercises exactly this path.
- **Deliberately not ported**: the source prototype's fixed 5-phase doctrine narrative
  (COMPETE/SHAPE/PENETRATE/DIS-INTEGRATE/EXPLOIT with scripted discussion questions per phase)
  — that is advocacy content authored for one specific briefing. OSP's phases stay
  scenario-defined, consistent with the product's anti-goal against doctrine-argument surfaces.
- **One shared position map per frame** (`computeWorldPositions`) — nodes, their links, and
  their activity vectors all read from the same memoized id→world-position lookup, so an
  unplaced (no lat/lon) entity's sprite and its links never drift apart across builders.

## Data contract — `osp-scenario` v1.1

One file = one scenario. Canonical rules: **lat/lon is the only persisted geography** (screen/
layout coordinates are derived or quarantined in `layout`); **computed analytics are never
persisted** in the scenario body (only their input weights are); **one canonical node table**
(activities and links reference it by id).

1.0 → 1.1 is additive: `nodes[].arch_class` (defaults from `node_type` on import, so 1.0 files
load unchanged and re-export as 1.1) and `layout.views` (per-view pins). The normalizer always
stamps the current version.

```jsonc
{
  "kind": "osp-scenario",
  "schema_version": "1.1",
  "meta": {
    "id": "…", "name": "…", "description": "…",
    "scenario_name": "…", "turn": "…", "side": "Friendly",
    "created_by": "…", "created_at": "ISO", "modified_at": "ISO",
    "assumptions": ["…"], "tags": [],
    "classification": { "marking": "UNCLASSIFIED", "banner_caveat": "NOTIONAL", "prototype": true }
  },
  "timeline": {
    "duration_hours": 96,
    "phases": [ { "id": "p1", "label": "Set Conditions", "from_hours": 0, "to_hours": 24, "main_effort": "…" } ]
  },
  "nodes": [ {
    "id": "…", "name": "…",
    "node_type": "unit|headquarters|command_post|system|platform|sensor|shooter|network|application|database|data_feed|satellite|ground_station|relay|person_role|process|location|facility|logistics_node|other",
    "arch_class": "performer|system|location|other",  // DoDAF class; defaults from node_type, override per node
    "side": "Friendly|Enemy|Neutral|Unknown", "service": "…",
    "echelon": "…", "unit": "…", "parent_id": "…",
    "warfighting_function": "…", "domain": "space|air|ems|cyber|c2|strike|sustain|land|maritime|data|other",
    "mission": "…", "mission_importance": 1-5, "echelon_importance": 1-5,
    "phase_ids": "all" | ["p1","p2"],            // when the node exists in the fight
    "status": "Active|Degraded|Offline|Planned|Unknown",
    "status_by_phase": { "p2": "Degraded" },       // optional per-phase override
    "geo": { "location_name": "…", "lat": 14.6, "lon": 121.0, "non_geographic": false },
    "symbol": { "branch_type": "none|infantry|armor|…", "echelon_mark": "XX", "hq": true, "cp": "MAIN" },
    "classification": "UNCLASSIFIED", "owner": "…",
    "vulnerability_notes": "…", "tags": [], "notes": "…"
  } ],
  "links": [ {
    "id": "…", "source": "nodeId", "target": "nodeId",
    "relationship_type": "commands|controls|supports|depends_on|communicates_with|provides_data_to|receives_data_from|uplinks_to|downlinks_from|relays_through|hosts|uses|protects|targets|supplies|other",
    "direction": "directed|bidirectional",
    "communication_method": "SATCOM|Fiber|UHF/VHF/HF Radio|Microwave|Tactical Data Link|LAN|WAN|Mesh|Courier|Voice|API|Database Replication|LTE/5G|Other",
    "bandwidth": "…", "latency": "…", "resilience": 1-5, "encryption": "…",
    "dependency_strength": 1-5, "failure_impact": 1-5,
    "provenance": "doctrinal|synthetic|assessed",
    "phase_ids": "all" | ["p1"], "status": "Active", "status_by_phase": {},
    "classification": "…", "tags": [], "notes": "…"
  } ],
  "vulnerabilities": [ {                             // analyst-asserted (imported/authored)
    "id": "…", "title": "…", "vulnerability_type": "shared_dependency|single_point_of_failure|…",
    "affected_node_ids": [], "affected_link_ids": [],
    "severity": 1-5, "likelihood": 1-5, "detectability": 1-5,
    "operational_impact": "…", "mitigation": "…", "status": "open|mitigated|accepted", "notes": "…"
  } ],
  "activities": [ {                                  // operational events over time
    "id": "…", "name": "…", "echelon": "…",
    "contact": "direct|indirect|air|maritime|electronic|cyber|information|sensing",
    "from_hours": 0, "to_hours": 18,
    "geographic": true, "position": { "lat": 0, "lon": 0 },
    "source_node_id": "…", "target_node_id": "…", "note": "…"
  } ],
  "overlays": {
    "annotations": [ { "id": "…", "text": "…", "lat": 0, "lon": 0, "phase_ids": "all" } ],
    "zones": [ { "id": "…", "kind": "deep|close|rear|custom", "label": "…", "phase_ids": [], "points": [ { "lat": 0, "lon": 0 } ] } ]
  },
  "criticality_model": {                             // persisted INPUTS; scores are derived
    "weights": { "mission": 20, "echelon": 15, "degree": 20, "betweenness": 20, "failure": 15, "shared": 10 },
    "caps": { "degree": 12, "dependency": 8, "cascade": 20, "shared": 6 },
    "thresholds": { "mission_critical": 75, "high": 50, "moderate": 25 },
    "betweenness_node_limit": 250
  },
  "notes": [ { "id": "…", "ts": "ISO", "kind": "decision|assumption|narrative|risk", "text": "…",
               "refs": [ { "type": "node|link|vulnerability|activity|phase", "id": "…" } ] } ],
  "layout": {                                        // disposable view state, excluded from brief exports
    "graph_positions": { "nodeId": { "x": 0, "y": 0, "pinned": true } },   // dependency-graph pins
    "views": { "ov2": { "positions": { "nodeId": { "x": 0, "y": 0, "pinned": true } } } }, // per-view pins
    "view": "ov1", "t": 0, "map_viewport": { "x": 0, "y": 0, "k": 1 }
  }
}
```

Import adapters: legacy Systems Viz dataset JSON (`meta/nodes/links/vulnerabilities` map ~1:1;
`operational_phase` string → `phase_ids`; `layout_positions` → `layout.graph_positions`) and
CSV tables with the source's column-alias map. Imports **merge/replace with a validation
preview** — never the source's silent destructive replace.

## Analytics

**Criticality** (ported formula, CO-001-hardened):
`score = Σ(component_k × weight_k) / Σweights × 100` over six components — mission importance,
echelon importance, degree-composite `0.35·min(deg/12,1) + 0.45·min(depConc/8,1) + 0.20·min(cascade/20,1)`,
normalized Brandes betweenness (skipped with a visible caveat above `betweenness_node_limit`),
mean top-2 incident `failure_impact`, and shared-dependency load `min((providerDeps−1)/6,1)`.
Levels: ≥75 Mission Critical, ≥50 High, ≥25 Moderate. Fixed caps, not dataset-relative maxima.
Per-node component breakdown and plain-English rationale surface in the inspector.

**Phase awareness (the new fusion):** analytics run on the *effective subgraph at time t* —
nodes/links whose `phase_ids` include the phase at t, with `status_by_phase` applied. Scrubbing
the timeline recomputes scores and findings, so a SPOF can emerge at H+48 that did not exist at
H+0. Computation is synchronous and pure; at demo scale (≤250 nodes) this is instant.

**Findings:** ported rule families (SPOF by dependency fan-in/cascade, degraded/offline
dependencies, shared-dependency convergence, classification-boundary flow, encryption gaps,
no-alternate-path links, manual-process gates, comms concentration), each emitting
evidence / implication / mitigation. Auto-detected findings render dashed/distinct from
analyst-asserted vulnerabilities (CO-002 lesson). Thresholds live in one config table.

## Rendering

- **Graph surface** (`render-graph.js`): SVG, drawing whatever `OSP.dodaf.buildView` hands it.
  Hierarchy mode = deterministic tree placement (OV-4 and the graph's hierarchy option; OV-4 adds
  orthogonal tree connectors); network mode = ported `runToConvergence` force layout
  (synchronous kinetic-energy plateau — layout is a pure function of the dataset; determinism
  gate ≤1px). Performers draw as rounded boxes and systems as rectangles on architecture views;
  the dependency graph keeps circles. Parallel-edge quadratic offsets, optional relationship
  labels (always on for SV-2), criticality color lens with fixed 5-step ramp (opt-in on OV/SV),
  vulnerability chain halos, 2-hop isolate, 4px click-vs-drag threshold, per-view pins.
- **Map / OV-1** (`render-map.js`): canvas 2D over a **global equirectangular world space**
  (±180° lon, ±90° lat at 60 px/degree = 21600×10800 world px). The raster ships as a local
  three-level tile pyramid: the L0 world base is always loaded and drawn cover-fit (no
  letterbox, no reachable void — hard pan clamp); L1/L2 tiles load on demand for the visible
  window and draw progressively over the base, with an LRU cache (~40 tiles) bounding decoded
  memory (a single full-res world image would decode to ~900MB). Scenarios can sit anywhere on
  Earth. Zoom ceiling is dynamic (~84 px/degree on screen). Transform stack world→canvas→screen
  with pan/zoom about cursor (ported coordinate model). Entities at
  `latLonToWorld(lat, lon)`; unplaced entities listed in a tray. Markers render as
  **MIL-STD-2525C symbols** via vendored milsymbol (`symbols.js` maps node_type/branch/side/
  echelon to letter SIDCs, every code validated against the library; cached per SIDC+size,
  size follows zoom). Pure software/data nodes keep criticality-colored circles so the analytic
  signal stays visible; 2525-rendered nodes carry a criticality tick at score ≥ 50. In OV-1
  **concept mode** (default) both analytic cues are suppressed and labels grow, so the frame reads
  as an operational concept graphic; untick it to get the analytic map back. A
  deterministic screen-space declutter pass relaxes co-located markers apart (sorted-id order,
  no randomness — exports stay reproducible). Fallback chain when milsymbol is unavailable
  (headless tests): FM 1-02.2 canvas frames → circles. Activity markers and source→target
  vectors appear per the scrub time; zones/annotations drawn from overlays; per-phase caption
  chip from `phases[].notes`. Fit (F) fits to placed data, not the raster. The inspector column
  collapses whenever nothing is selected, giving the map the full remaining width.
- **Risk** (`render-risk.js`): DOM. Ranked criticality table with component breakdown bars,
  finding cards, weight sliders (live recompute), BLUF text block.
- **One selection store** shared by all views and the inspector; click-persistent, Esc/empty-
  click deselects; hover is tooltip-only.

## Export strategy

- **PNG**: full redraw from the data model onto an offscreen canvas at 2× (never a pixel copy
  of the live canvas — that approach mis-registered overlays and got FSP's export deleted).
  Classification banner, model code and title (e.g. `OV-2 Operational Resource Flow
  Description`), view caption, scenario name, H+time, and timestamp burned into a header/footer
  strip; filename carries the model code.
- **JSON**: canonical scenario (with optional `layout`), `schema_version` stamped, plus an
  `export` block carrying a criticality snapshot (`computed_at`, weights used) that is never
  read back as authority.
- **CSV**: nodes/links/vulnerabilities tables (import supports the alias map). XLSX: backlog.

## Persistence

localStorage autosave of the full scenario+layout on a 500ms debounce
(`osp-scenario-autosave`), restore-baseline action returns to the embedded seed. Explicit save =
JSON download. Derived state (scores, findings) is never persisted. Theme choice persists
separately (`osp-theme`).

## Verification approach

Gates and commands live in `docs/VERIFICATION.md`. Summary:

- **Offline gates**: greps for `fetch(`/`XMLHttpRequest`/CDN hosts/`type="module"`/external
  `src|href` must be clean; manual DevTools network check shows zero non-`file://` requests.
- **Static integrity**: `node --check` on every script; `getElementById` ↔ `id=` cross-check;
  no `console.log/debug` in shipped code.
- **Headless smoke** (`node app/tests/measure.js`, jsdom dev-only): zero init/console errors,
  demo node/link counts exact, layout determinism ≤1px across two cold loads, node overlap 0,
  all eight views switch clean, phase-aware finding fires at H+48 and not at H+0, DoDAF view
  invariants (OV-2 performers only with derived needlines carrying `via`; SV-1 systems only;
  OV-2 ∪ SV-1 partitions the repository; OV-4 edges come from `parent_id`), per-view pins,
  schema 1.0 → 1.1 defaulting and 1.1 round-trip through JSON and CSV.
- **Manual browser pass**: primary workflow click path (documented in VERIFICATION.md),
  1280×720 projector legibility, export artifact opens and carries the banner.
