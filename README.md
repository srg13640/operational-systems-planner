# Operational Systems Planner (OSP)

[![CI](https://github.com/srg13640/operational-systems-planner/actions/workflows/ci.yml/badge.svg)](https://github.com/srg13640/operational-systems-planner/actions/workflows/ci.yml)
[![Live demo](https://img.shields.io/badge/demo-GitHub%20Pages-2ea44f)](https://srg13640.github.io/operational-systems-planner/)

**Model a mission system as a dependency graph, place it in global geographic and temporal
context, and see what breaks, where, and when — then export a briefable artifact.**

OSP is a planning aid for staff officers, analysts, and wargamers. One dataset drives three
linked surfaces — an operational **map**, a system **graph**, and a **risk board** — under a
shared timeline. Scrub the clock and the risk picture changes: a ground station that is merely
busy at H+12 becomes a single point of failure at H+48 when the fiber trunk is cut. Every
score is decomposable, every finding carries evidence / "so what" / mitigation in plain
English, and every visual exports with its classification banner burned in.

**[Try it live](https://srg13640.github.io/operational-systems-planner/)** — or clone and
double-click `app/index.html`. No build, no server, no runtime network calls: the entire app,
including a global NASA Blue Marble basemap and MIL-STD-2525 symbology, ships in the folder
and runs air-gapped.

## The 60-second demo

1. Open the app — the built-in **Operation PACIFIC SENTINEL** scenario loads on the map.
2. Press `Space` (or drag the timeline) to **H+48**: Phase II begins — missile salvos strike
   the APODs, the undersea fiber trunk is cut, the backup relay degrades.
3. Open **RISK**: a new SEV-5 finding is tagged `EMERGED AT H+48` — *Ground Station KILO is a
   single point of failure*. The LRPF kill chain and sustainment C2 now both route through it.
4. Click the finding — the dependency chain highlights across the graph and the map; the
   inspector shows the evidence, the plain-English "so what," the mitigation, and the
   criticality score's component breakdown.
5. Drag a criticality weight to test the finding's robustness, then **Export** a
   banner-stamped PNG for the decision brief.

## Surfaces

- **MAP** — a fully global, fully offline NASA Blue Marble topo.bathy basemap (local
  three-level tile pyramid; pan and zoom anywhere on Earth), MIL-STD-2525C symbology via
  vendored milsymbol, phase-scoped zones and reference points, activities that appear and
  expire with the scrub, deterministic marker declutter, per-phase caption line, and an
  unplaced-entities tray — nothing is silently dropped.
- **GRAPH** — network and hierarchy layouts with deterministic, reproducible positioning
  (0.000px drift across loads — screenshots taken minutes apart match), criticality color
  lens, vulnerability chain overlays, 2-hop isolate.
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
npm install        # jsdom, dev-only — the app itself has zero runtime dependencies
npm run verify     # static gates (syntax, offline discipline) + 33-check headless smoke suite
```

CI runs the same pipeline on every push. Gates include: zero console errors on boot, pinned
demo-data counts with zero validation issues, layout determinism ≤1px across cold loads, the
phase-emergent finding firing at H+48 and not at H+12, JSON round-trip losslessness, and
editor add/edit/undo integrity. See [docs/VERIFICATION.md](docs/VERIFICATION.md) for the full
gate history, including how the basemap tile pyramid was pixel-verified.

## Design principles

- **Offline-capable is a feature, not a limitation.** The app never makes a runtime network
  call (CI enforces it). Host it on Pages, hand-carry it to a closed network — same folder.
- **Structured data behind every visual.** One scenario contract (`docs/ARCHITECTURE.md`)
  drives all three surfaces; lat/lon is the only persisted geography.
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
(MIT) and NASA Blue Marble Next Generation imagery (public domain). All scenario data is
fictional and unclassified, generated for demonstration; this is a planning aid, not a system
of record, and predicts no outcomes.
