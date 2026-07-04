# Source Synthesis Manifest

Generated: 2026-07-03

Workspace:

`/Users/sethgilleland/Library/Mobile Documents/com~apple~CloudDocs/01_Active_Projects/Operational Systems Planner`

Source copies:

- `_source/originals/2026-07-03/Systems Viz Tool`
- `_source/originals/2026-07-03/FSP 26-2 Final`

## Size and Scan Caution

The copied FSP source is large, mostly because `_basemap-sources/` is about 1.5 GB. Claude should not broad-scan that folder unless it specifically needs raw basemap/reference assets. Start with the README, status, notes, changelog, and primary `index.html` files listed below.

## Purpose

This manifest exists to help Claude Code understand why both project families were placed together and what should be harvested from each.

Claude should not treat this as a request to glue two old interfaces together. The desired output is a new single application that uses the best product ideas, data models, and technical assets from both.

## Source Family 1 - Systems Viz Tool

### Core Identity

Systems Viz Tool is an offline military systems graph analyzer.

It is designed around:

- hierarchy mapping
- network architecture review
- system dependency analysis
- criticality scoring
- vulnerability discovery
- validation of imported graph data
- briefing-ready screenshots and exports

### Key Files

```text
_source/originals/2026-07-03/Systems Viz Tool/
+-- README.md
+-- PROJECT_STATUS.md
+-- DECISIONS.md
+-- military_systems_graph_tool.html
+-- index.html
+-- TRANSFER_MANIFEST.md
+-- docs/
+-- prompts/
+-- datasets/
+-- reviews/
+-- change-orders/
+-- loop-specs/
+-- tests/
```

### Best Ideas To Harvest

- One dataset driving multiple analytic views.
- Hierarchy, network architecture, criticality, vulnerability, data, and help views.
- Criticality scoring using mission importance, echelon, degree, betweenness, dependency count, link impact, and shared dependency load.
- Vulnerability detection and validation warnings.
- Flexible JSON/CSV/XLSX import patterns.
- Local-first operation with no server, build step, database, CDN, or internet dependency.
- Transfer manifest and closed-network assumptions.
- Review artifacts and change orders that already identify credibility gaps.
- Headless verification harness from `tests/`.

### Weaknesses To Challenge

- It may read as a graph viewer instead of a decision support product.
- The interface may expose too many equal-weight views rather than one clear workflow.
- Criticality and vulnerability findings need stronger "so what" explanation.
- Visual design needs to feel like a serious planning product, not a prototype.
- Map/geospatial, military symbology, MGRS, and briefing polish remain incomplete.

### Product Value

Systems Viz contributes the analytic core: graph, dependency, criticality, vulnerability, validation, and import/export logic.

## Source Family 2 - FSP 26-2 Final

### Core Identity

FSP 26-2 Final is a family of operational framework planning and briefing prototypes.

It is designed around:

- deep, close, rear as activities and relationships rather than static areas
- map and planning surfaces
- timeline and phase scrubbers
- 2D/3D operational views
- annotation and export workflows
- senior-leader briefing usability
- visual explanation of doctrine and operational concepts

### Key Files

```text
_source/originals/2026-07-03/FSP 26-2 Final/
+-- PROJECT_STATUS.md
+-- OP FW - Time Slider/
|   +-- README.md
|   +-- CHANGELOG.md
|   +-- NOTES.md
|   +-- index.html
+-- OP FM - 3D & Alternatives/
|   +-- README.md
|   +-- index.html
|   +-- standalone_map.html
|   +-- BEYOND_THE_PROTOTYPE.html
+-- OP Framework Integrated/
    +-- README.md
    +-- CHANGELOG.md
    +-- NOTES.md
    +-- index.html
    +-- compare-spike.html
```

### Best Ideas To Harvest

- Planning surface, not just visualization.
- Operational context across map, time, echelon, and mission phase.
- Briefing-first visual composition.
- Interactive annotation: zones, units, labels, layer visibility, undo, save/load.
- Timeline/phase model that changes the meaning of activities over time.
- Export of high-resolution visuals for PowerPoint.
- Orientation/help cards and keyboard interaction.
- Strong conceptual thesis: operational categories should be relational, temporal, and purpose-driven.

### Weaknesses To Challenge

- Multiple competing prototypes and subfolders create ambiguity.
- Some logic may be too scenario-specific.
- Some views are excellent as brief demos but not reusable product surfaces.
- Source concepts need separation from one-off event materials.
- The final product should not simply inherit FSP's visual style.

### Product Value

FSP contributes the planning and briefing layer: map, time, phases, annotation, operational framing, visual polish, and export feel.

## Combined Product Opportunity

The best new product is not:

- a graph viewer
- a doctrine demo
- a map toy
- a dashboard
- a slide generator

The best new product is:

> An operational systems planning surface that lets staff model a mission system, place it in operational context, identify dependency and vulnerability risk, and brief the resulting decision story.

## Suggested New Application Concept

Working name:

`Operational Systems Planner`

Alternate names Claude may improve:

- `Mission Systems Planner`
- `Systems Operations Workbench`
- `Dependency Terrain`
- `Command Systems Planner`
- `Operational Graph Planner`

### Target User

- staff officer
- analyst
- planner
- force-design team
- experimentation cell
- defense contractor working with notional/unclassified planning data

### Core Loop

```text
Build or import system model
-> place it in operational context
-> inspect graph, map, timeline, and mission phase
-> find critical nodes and fragility chains
-> explain operational impact
-> export a decision brief
```

### Primary Surfaces

The new app should probably have fewer, stronger surfaces:

1. **Plan**
   - The main workspace.
   - Combines map/planning canvas with selected system overlays and phase context.

2. **System**
   - Graph and hierarchy view for nodes, links, dependencies, and structure.

3. **Risk**
   - Criticality, vulnerabilities, dependency chains, validation warnings, and "so what."

4. **Brief**
   - Export-ready summary, screenshot, decision slide, and findings package.

Claude should challenge this structure if it finds a better one.

## Data Model Direction

The unified data model should support:

- nodes/entities
- links/dependencies
- hierarchy/parentage
- geography or abstract placement
- timeline/phase membership
- echelon or owner
- system/domain/function category
- vulnerability records
- criticality attributes
- classification/marking label as metadata, not as an enforcement mechanism
- narrative decision notes
- export metadata

## First Build Slice Recommendation

Build one end-to-end demo before building every feature:

1. Load one notional demo dataset.
2. Show a unified workspace with graph, planning canvas, and inspector.
3. Select a critical node.
4. Show dependency chain and operational impact.
5. Show phase/time context if available.
6. Export a briefable finding.

That is the "wow" slice.

## Verification Expectations

Claude should verify:

- local app opens
- no runtime network calls
- demo data loads
- primary workflow works
- graph and planning surface do not fight each other
- inspector explains "so what"
- export works if implemented
- source archive and docs are intact

## Explicit Permission Boundary

Claude has full read/write permission inside this consolidated workspace.

Claude may:

- create new app architecture
- split files
- add local vendored dependencies if justified and license-safe
- rewrite the UI
- create new demo data
- copy useful source code out of `_source`
- write docs, manifests, and verification notes
- archive weak experiments inside `_archive`

Claude should not:

- modify the original top-level `Systems Viz Tool` or `FSP 26-2 Final` folders outside this workspace unless explicitly asked
- introduce runtime cloud services or network dependencies
- treat source classification labels as real enforcement controls
- overclaim operational validity
- preserve old UI/UX out of politeness
