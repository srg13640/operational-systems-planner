# Architecture

Updated: 2026-07-03

## Runtime constraints (non-negotiable)

- Opens by double-clicking `app/index.html` over `file://`. No server required.
  `python3 -m http.server` is a dev convenience only.
- Zero runtime network calls. No CDN, no fetch of remote resources, no telemetry, no webfonts.
  Every byte ships in the folder (IL5-portable / closed-network assumption from both sources).
- No build step, no npm at runtime, no ES modules (`import` breaks over `file://` in Chrome —
  proven failure in FSP v1.3). Plain `<script src>` tags in dependency order.
- Seed data lives in a `<script type="application/json">` island in `index.html` because
  `fetch()` of local JSON fails over `file://`. `app/data/*.json` holds the human-readable
  authoring copies.
- Vanilla JS/CSS/HTML. jsdom is the only dev dependency (tests only, never shipped to users).

## Folder structure

```
app/
├── index.html              shell: chrome markup + seed-scenario JSON island + script tags
├── styles/
│   └── main.css            all CSS incl. light/dark theme tokens
├── scripts/
│   ├── model.js            schema constants, normalize/validate, graph build, phase logic
│   ├── metrics.js          criticality engine (pure functions)
│   ├── findings.js         vulnerability rule engine (pure functions)
│   ├── layout.js           deterministic hierarchy + force layout (pure functions)
│   ├── io.js               JSON/CSV import-export, column aliases, download helpers
│   ├── geo.js              lat/lon ↔ basemap-pixel projection, viewport transform
│   ├── symbols.js          FM 1-02.2 unit symbol SVG table
│   ├── render-graph.js     SVG graph view
│   ├── render-map.js       canvas map view
│   ├── render-risk.js      risk board view
│   ├── render-stack.js     multi-domain 3D stack (hand-rolled perspective, canvas 2D)
│   ├── editor.js           in-app editing: forms, add/delete, place-on-map, snapshot undo
│   ├── inspector.js        selection inspector panel
│   ├── export.js           PNG model-redraw export, banner/title-block stamping
│   └── app.js              state store, wiring, timeline, keyboard, persistence, boot
├── lib/
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
└── tests/
    ├── harness.js          jsdom loader: console-clean, node positions, view switching
    └── measure.js          pass/fail smoke gate (exit code) — run `npm i jsdom && node tests/measure.js`
```

`model.js`, `metrics.js`, `findings.js`, `layout.js`, `geo.js`, `io.js` are pure modules
(attach to `window.OSP.*`, no DOM access) so the jsdom harness can unit-test them directly.

## Data contract — `osp-scenario` v1.0

One file = one scenario. Canonical rules: **lat/lon is the only persisted geography** (screen/
layout coordinates are derived or quarantined in `layout`); **computed analytics are never
persisted** in the scenario body (only their input weights are); **one canonical node table**
(activities and links reference it by id).

```jsonc
{
  "kind": "osp-scenario",
  "schema_version": "1.0",
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
    "graph_positions": { "nodeId": { "x": 0, "y": 0, "pinned": true } },
    "view": "map", "t": 0, "map_viewport": { "x": 0, "y": 0, "k": 1 }
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

- **Graph** (`render-graph.js`): SVG. Hierarchy mode = deterministic tree placement; network
  mode = ported `runToConvergence` force layout (synchronous kinetic-energy plateau — layout is
  a pure function of the dataset; determinism gate ≤1px). Parallel-edge quadratic offsets,
  criticality color lens with fixed 5-step ramp, vulnerability chain halos, 2-hop isolate,
  4px click-vs-drag threshold.
- **Map** (`render-map.js`): canvas 2D over a **global equirectangular world space**
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
  signal stays visible; 2525-rendered nodes carry a criticality tick at score ≥ 50. A
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
  Classification banner, scenario name, H+time, and timestamp burned into a header/footer strip.
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
  all views switch clean, phase-aware finding fires at H+48 and not at H+0.
- **Manual browser pass**: primary workflow click path (documented in VERIFICATION.md),
  1280×720 projector legibility, export artifact opens and carries the banner.
