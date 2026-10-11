# Operational Systems Planner (OSP)

[![CI](https://github.com/srg13640/operational-systems-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/srg13640/operational-systems-planner/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/demo-GitHub%20Pages-2ea44f)](https://srg13640.github.io/operational-systems-planner/)

**One architecture repository — performers, systems, relationships, geography, time — and the
operational and systems views a staff needs derived from it, with an optional risk lens.**

OSP is a planning aid for staff officers, analysts, and wargamers. One scenario file is the
repository; the screens are DoDAF-style views over it — **OV-1** concept graphic, **OV-2**
operational resource flows, **OV-4** organizational relationships, **SV-1 / SV-2** systems
interfaces and resource flows — plus three fit-for-purpose analysis surfaces: the full
dependency **graph**, a multi-domain 3D **stack**, and a **risk board**. Because every view is a
filter over the same data, OV-2 and SV-1 cannot disagree. A shared timeline runs under all of
them: scrub the clock and the risk picture changes — a ground station that is merely busy at
H+12 becomes a single point of failure at H+48 when the fiber trunk is cut. Every score is
decomposable, every finding carries evidence / "so what" / mitigation in plain English, and
every visual exports with its model code and classification banner burned in.

**[Try it live](https://srg13640.github.io/operational-systems-planner/)** — or clone and
double-click `app/index.html`. No build, no server: the entire app — a global NASA Blue Marble
basemap, MIL-STD-2525 symbology, and a WebGL multi-domain stack (Three.js, vendored locally,
no CDN) — ships in the folder and makes zero runtime network calls, whether you open it from
this repo's Pages deployment or hand-carry it to a closed network.

## The 60-second demo

1. Open the app — the built-in **Operation PACIFIC SENTINEL** scenario loads as an **OV-1**
   concept graphic on the map.
2. Press `2` for **OV-2**: the 24 performers and the needlines between them. Dashed needlines
   are derived — two performers that only exchange through systems still need each other.
   Press `4` for **SV-1**: the 16 systems and their interfaces. Same data, different view.
3. Press `Space` (or drag the timeline) to **H+48**: Phase II begins — missile salvos strike
   the APODs, the undersea fiber trunk is cut, the backup relay degrades.
4. Open **RISK**: a new SEV-5 finding is tagged `EMERGED AT H+48` — *Ground Station KILO is a
   single point of failure*. The LRPF kill chain and sustainment C2 now both route through it.
5. Back on SV-1, tick **Criticality lens** — the same interface diagram now colours by
   structural criticality and overlays the vulnerability chain. Untick it and the diagram is a
   plain architecture description again. Then **Export** a banner-stamped PNG titled with the
   model code for the decision brief.

## Views

**Operational viewpoint**

- **OV-1 High-Level Operational Concept Graphic** — a fully global, fully offline NASA Blue
  Marble topo.bathy basemap (local three-level tile pyramid; pan and zoom anywhere on Earth),
  MIL-STD-2525C symbology via vendored milsymbol, phase-scoped zones and reference points,
  activities that appear and expire with the scrub, deterministic marker declutter, per-phase
  caption line, and an unplaced-entities tray — nothing is silently dropped. *Concept mode*
  (default) suppresses the analytic overlay so the frame reads as a concept, not a risk map.
- **OV-2 Operational Resource Flow Description** — performers only, with recorded needlines
  solid and derived needlines (traced through up to two intermediate systems) dashed and
  labelled `via …`.
- **OV-4 Organizational Relationships Chart** — command hierarchy from `parent_id` with
  orthogonal connectors; command, control, and support relationships dotted over it.

**Systems viewpoint**

- **SV-1 Systems Interface Description** — systems only and the interfaces between them;
  optionally show each system's owning performer as dashed context.
- **SV-2 Systems Resource Flow Description** — SV-1 with every interface labelled by its
  communication means and capacity.

Every entity carries an architecture class (`performer | system | location | other`) that
defaults from its type and can be overridden in the editor; the rail on each view states what
it shows and what it leaves out. Drag to pin an entity for that view only — pins are per view,
so a system can sit in one place on SV-1 and another on OV-2.

**Analysis (fit-for-purpose)**

- **GRAPH** — the whole repository: network and hierarchy layouts with deterministic,
  reproducible positioning (0.000px drift across loads — screenshots taken minutes apart
  match), criticality color lens, vulnerability chain overlays, 2-hop isolate.
- **STACK** — a multi-domain 3D stack, real WebGL via a locally vendored Three.js (no CDN):
  every domain in the scenario becomes a glowing translucent layer, nodes sit on their domain
  plane at their real geographic position as hand-drawn icon sprites, and cross-domain
  dependencies draw as glowing, continuously animated arcs — select a finding and a glow
  travels its chain from seabed to space. Land and maritime share one surface tier rather than
  stacking like the abstract domains (a coastline is one surface, not two layers). Orbit
  camera with eased fit/zoom, per-domain layer toggles, an enemy/OPFOR visibility toggle, a
  spotlight briefing tool, auto-orbit, a deterministic starfield, and a computed
  area-of-operations readout — all reproducible pixel-for-pixel on export despite the
  continuous animation.
- **RISK** — BLUF paragraph, ranked criticality with per-component score bars and live weight
  sliders, finding cards split auto-detected vs analyst-asserted, and emergent findings tagged
  with the hour they appeared.

**Editing** — add, edit, and delete nodes and links from the inspector; click-to-place
entities on the map; snapshot undo (`Cmd/Ctrl+Z`). Every edit re-runs validation and
recomputes analytics, so hand-edited data obeys the same contract as imported data.

**Data** — versioned scenario JSON (round-trip verified), CSV import with staff-vocabulary
column aliases (merge-by-id, never destructive), staged import validation shown before
anything replaces your session, localStorage autosave, PNG / JSON / CSV / Markdown export.

## Built-in scenarios

Two fictional, unclassified scenarios ship embedded (Data manager → Built-in scenarios), both
grounded in recurring unclassified open-source wargaming themes:

- **Operation PACIFIC SENTINEL** — Indo-Pacific corps operation: missile salvos on theater
  airbases, tanker scarcity, SATCOM/undersea-cable attack, interceptor magazine depth.
- **Operation BALTIC SENTINEL** — NATO eastern-flank operation: the Suwałki corridor, the
  rail gauge break, port throughput concentration, GPS jamming, Baltic cable incidents.

Same engine, opposite sides of the planet — scenarios are not tied to any theater.

## Run it

| Mode | How |
|---|---|
| Live demo | <https://srg13640.github.io/operational-systems-planner/> |
| Fully offline | Clone/download, double-click `app/index.html`. Works from `file://` on a closed network; every byte ships in the repo. |
| Dev server | `npm run serve` → <http://localhost:8471> |

## Verify

```sh
npm install        # jsdom, dev-only test runner — see "third-party assets" below for what ships to users
npm run verify     # static gates (syntax, offline discipline) + 58-check headless smoke suite
```

CI runs the same pipeline on every push. Gates include: zero console errors on boot, pinned
demo-data counts with zero validation issues, layout determinism ≤1px across cold loads, the
phase-emergent finding firing at H+48 and not at H+12 (in both built-in scenarios), the DoDAF
view invariants (OV-2 holds only performers and SV-1 only systems, the two partition the
repository, derived needlines record their path, OV-4 edges come from `parent_id`), per-view
pinned layouts, schema 1.0 → 1.1 defaulting and JSON/CSV round-trip losslessness, editor
add/edit/undo integrity, and a graceful, error-free fallback for the WebGL stack view when no
GPU context is available. See
[docs/VERIFICATION.md](docs/VERIFICATION.md) for the full gate history, including how the
basemap tile pyramid and the Three.js file://-loading bootstrap were verified.

## Design principles

- **Offline-capable is a feature, not a limitation.** The app never makes a runtime network
  call (CI enforces it). Host it on Pages, hand-carry it to a closed network — same folder.
- **One repository, many views.** One scenario contract (`docs/ARCHITECTURE.md`) drives every
  view; a view is a filter, never a second copy of the data, so views cannot contradict each
  other. Lat/lon is the only persisted geography.
- **Deterministic by design.** Layout, findings, and declutter are pure functions of the
  data — briefing screenshots are reproducible pixel-for-pixel.
- **Honest analytics.** Criticality is a structural estimate, not a simulation, and the UI
  says so. Rule-based findings render distinct from analyst judgments. Classification
  markings are rendering metadata, not access control.

## Documentation

[Product direction](docs/PRODUCT_DIRECTION.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Verification](docs/VERIFICATION.md) · [Backlog](docs/NEXT_BACKLOG.md) ·
[Archive manifest](docs/ARCHIVE_MANIFEST.md) (the two prototype families this product was
consolidated from; their 1.5GB source trees are preserved locally, not in this repo)

## License & provenance

MIT (see [LICENSE](LICENSE)). Bundled: [milsymbol](https://github.com/spatialillusions/milsymbol)
(MIT), [Three.js](https://github.com/mrdoob/three.js) (MIT), and NASA Blue Marble Next
Generation imagery (public domain). All scenario data is fictional and unclassified, generated
for demonstration; this is a planning aid, not a system of record, and predicts no outcomes.
