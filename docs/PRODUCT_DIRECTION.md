# Product Direction

Updated: 2026-07-03

## Name

**Operational Systems Planner** (callsign **OSP**). Literally accurate — systems, in operational
context, for planning — and reads as staff software, not product branding. Both source families
learned that this audience punishes creator-tool styling and rewards disciplined plainness.

## Thesis

OSP is an offline-first, air-gapped planning aid that lets a staff planner model an operational
system as a dependency graph (nodes, links, hierarchy, vulnerabilities), place that same system
in operational context (geography on an offline basemap, time on a phase/H-hour scrubber), and
interrogate it — inspectable criticality scoring and rule-based vulnerability detection with
analyst override — to answer one question no current tool answers:

> **What breaks this operational system, where, and when — and what decision does that drive?**

It fuses the hardened analytic engine of the Systems Viz Tool (defensible math, no map, no time)
with the geo-temporal planning surface of FSP 26-2 (map, time, briefing fluency, no analysis).
The output is a briefable, banner-stamped, reproducible artifact a planner drops into a decision
brief.

## Target user

Corps/division staff planner (G3/G5 plans, G6 signal, protection or fires cell) on a closed
network: doctrine-literate, non-programmer, must produce a defensible operational-system
assessment (defended asset list input, C2 resilience estimate, kill-chain fragility) and brief
it to a senior leader from a projected screen — no server, no install rights, no internet.

## Core workflow

1. **Open** — double-click `app/index.html`. Zero network calls. The built-in notional scenario
   (or the last auto-saved workspace) loads immediately.
2. **Model or import** — add/edit nodes, hierarchy, dependency links, or import JSON/CSV;
   validation flags broken references before data replaces the session.
3. **Place in context** — entities sit at lat/lon on the offline basemap (unplaced entities go
   to a visible tray, never silently dropped); nodes, links, and activities carry phase/time
   membership so the system exists in time, not just topology.
4. **Interrogate** — switch Map / Graph / Risk while scrubbing the timeline; criticality scores
   and vulnerability findings recompute for the active phase; the inspector shows the score's
   component breakdown and plain-English "so what" for anything selected.
5. **Assert** — pin auto-detected findings or add analyst-asserted ones (evidence / implication /
   mitigation); analyst assertions render visually distinct from computed findings.
6. **Export** — a banner-stamped PNG of the current view (deterministic layout ⇒ reproducible
   pixels) and the versioned scenario JSON for handoff.

## Primary surfaces

Three canvas views, one shared selection, one shared timeline. Everything else is a modal or a
chrome state — never a peer tab (the six-equal-tabs pattern was a source weakness).

1. **MAP (default)** — operational context. Entities at real coordinates on the vendored NASA
   Blue Marble Indo-Pacific crop, dependency links over terrain, activity markers that appear/
   move/expire with the scrub, unplaced-entities tray, FM 1-02.2 unit symbols. Opening cold to a
   map, not an abstract graph, was the single biggest credibility lesson in the source reviews.
2. **GRAPH** — system structure. Hierarchy and network layouts of the same dataset,
   deterministic converged non-overlapping layout, criticality color lens, vulnerability chain
   halos, 2-hop neighborhood isolate.
3. **RISK** — the "so what" board. Ranked criticality table with per-component breakdown bars,
   finding cards (evidence / implication / mitigation) split auto-detected vs analyst-asserted,
   live weight sliders, an auto-generated BLUF paragraph. Time-aware: the board answers "what
   matters NOW," and findings can emerge or resolve as the scrubber moves.

Persistent chrome: top bar (scenario name, classification banner, view tabs, icon actions),
timeline rail (transport, phase chips, scrub), right inspector (click-persistent selection —
never hover-only), status bar (the one authoritative state readout).

**Brief mode** is a chrome state, not a view: rails collapse, type gains a step, the banner
enlarges, and the scrub becomes the briefing narrative. PowerPoint remains the delivery
mechanism; OSP produces drop-in artifacts.

**Data manager** (import with validation preview, export JSON/CSV) and **Help** (keyboard map /
orientation) are modals.

## Data model direction

One scenario file (`kind: "osp-scenario"`, `schema_version`), one canonical node table.
Lat/lon is the only persisted geography (FSP burned three coordinate-system migrations proving
this). Phases are first-class objects; nodes/links/activities carry phase membership;
`status_by_phase` lets a relay be Active in Phase I and Degraded in Phase II. Criticality
weights/caps/thresholds are persisted inputs; computed scores are runtime-only (stamped into
exports as snapshots, never read back as authority). Full contract in `ARCHITECTURE.md`.

## What the first demo must prove

1. Double-click one file on an offline machine → app opens, zero network requests, zero console
   errors.
2. The same entity lives in three linked frames: graph position, geographic position, and time
   window — selection carries across all three.
3. **Scrubbing time changes the risk picture**: a SPOF finding that does not exist at H+0
   emerges at H+48 when the alternate fiber path drops, proving the analysis is phase-aware.
4. Every score is defensible on demand: click a node → component breakdown + live weights.
5. Export is briefing-grade: banner-stamped, title-blocked, reproducible PNG.
6. Zero prototype tells: no dead controls, no placeholder buttons, no fake metrics.

## Demo story

Notional, unclassified **Operation PACIFIC SENTINEL**: a corps operation across 96 hours in
three phases (Set Conditions → Close Operations → Consolidate) — corps HQ Main/TAC, a division
slice, LRPF battery, aviation task force, JAGIC, SATCOM gateway with two satellites and one
shared ground station, undersea fiber, theater tankers, APODs at Clark and Kadena, afloat
prepositioning, air/missile defense, sensors, EW and cyber elements, and an OPFOR rocket-force
threat (40 nodes, 68 links, 16 activities; every vulnerability rule exercised by design).
Events follow recurring unclassified open-source wargaming themes — missile salvos against
theater airbases, tanker scarcity, interceptor magazine depth, contested sustainment,
counter-ISR and cable/SATCOM attack — with per-phase caption lines carrying the narrative.

At H+0 the Risk board is calm: sustainment C2 rides both SATCOM and undersea fiber. The planner
scrubs to H+48 — Phase II: the fiber trunk is cut and the backup relay degrades. A new finding
fires: the LRPF kill chain and sustainment C2 now both route through the single shared ground
station — a SPOF whose cascade covers nine downstream nodes including the JAGIC. The planner
clicks the finding (chain highlights on graph and map simultaneously), checks the component
breakdown, drags the failure-impact weight to confirm robustness, pins the finding, adds a
mitigation note ("reposition backup terminal NLT H+36; nominate ground station to defended
asset list"), and exports a banner-stamped PNG. The decision it supports: the protection working
group prioritizes the ground station on the corps defended asset list before Phase II.

## What this is NOT

- **Not a COP** — no live entities, no feeds, no theater scale; a planning aid for one system
  at a time.
- **Not a system of record** — no authoritative-data claims, no access control, no audit trail;
  classification markings are metadata for rendering, never enforcement.
- **Not a simulation** — no attrition, physics, or outcome prediction; analysis is structural
  (topology + analyst judgment), and the UI must never imply otherwise.
- **Not a presentation tool** — no slide builder, narrator, tour, or auto-play; it produces
  artifacts for PowerPoint, it is not the deck.
- **Not a doctrine argument** — unlike FSP, it argues no thesis; it serves whatever framework
  the planner brings.
- **Not network-dependent** — no runtime network calls, CDN, telemetry, or npm runtime; every
  byte ships in the folder and `file://` must always work. (Revised 2026-07-04 by owner
  decision: the *product* may live online — GitHub repo, Pages-hosted demo, future
  collaboration features — but the *app* stays offline-capable; that is a differentiator,
  not a constraint, and CI enforces it.)

## Priorities

**Slice 1 (built now):** unified scenario model + validation; Map/Graph/Risk views; deterministic
layout; phase-aware criticality + vulnerability engines with component breakdown; click-persistent
inspector with plain-English "so what"; timeline scrubber; demo scenario; JSON import/export,
CSV import; PNG export with banner + title block; localStorage autosave + restore baseline;
headless verification harness; light/dark theme; keyboard model + orientation card.

**Should-have (backlog):** XLSX import/export (port the source codec), MGRS readout, zone/unit/
label annotation tools with undo, saved named briefing snapshots + batch export, COA/turn diff,
MapLibre+PMTiles basemap upgrade, milsymbol-grade symbology options, template pack + AI data
workflow docs.

**Explicitly not:** 3D globe, live feeds, multi-user/server anything, access control,
simulation, in-app slide decks. (Revised 2026-07-04: the multi-domain *stack* view — originally
deferred with the 3D family — was promoted to a first-class surface by owner decision, rebuilt
data-driven on a dependency-free canvas renderer rather than ported from the Three.js
prototype. The 3D globe remains out.)
