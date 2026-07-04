# Archive Manifest

Updated: 2026-07-03

This manifest records what source material exists, what each source contributed to the new
application under `app/`, what is preserved as reference, and what was deliberately not carried
forward. Sources live under `_source/originals/2026-07-03/` and are treated as read-only.

## Source Family 1 — Systems Viz Tool

Offline military systems graph analyzer. Single-file HTML app
(`military_systems_graph_tool.html`, 3,606 lines, June 26 build) plus docs, datasets, reviews,
change orders, loop specs, and a jsdom test harness.

### What it contributed (harvested into `app/`)

| Asset | Source location | Disposition |
|---|---|---|
| Criticality engine (weighted composite, Brandes betweenness, cascade blast radius, shared-dependency load, rationale text) | `military_systems_graph_tool.html:1421–1600` | Ported, parameterized, made phase-aware |
| Vulnerability rule engine (9 auto-detect rule families, each with evidence/implication/mitigation) | `:1602–1829` | Ported, thresholds lifted into a config table |
| Dataset normalize + validate (warn-and-continue, id dedupe, clamping, cycle detection, dangling refs) | `:1169–1420` | Pattern ported, field lists regenerated from new schema |
| Deterministic force layout (`runToConvergence`, kinetic-energy plateau, 0.000px determinism — CO-001) | `:1947–2116` | Algorithm ported, decoupled from globals |
| RFC-4180 CSV parser + header alias mapping + table auto-detect | `:2736–2857` | Ported |
| Zero-dependency ZIP/CRC32/XLSX codec | `:3252–3463` | Reference only for now (XLSX in backlog); custom binary writers are a corruption risk to re-verify per build |
| PNG export as model-redraw (not pixel-copy) | `:2895–3149` | Pattern ported — this is the fix for the PNG mis-registration that made FSP delete its own export |
| Configurable classification banner (`formatBanner`, CO-003) | `:2431–2439` | Ported |
| jsdom headless harness (console-clean, overlap, determinism gates) | `tests/harness.js`, `tests/measure.js` | Ported and extended |
| Demo-data builder helper pattern | `:3464–3606` | Pattern reused for the new seed scenario |
| Review/change-order corpus (credibility gaps, P0 lessons) | `reviews/`, `change-orders/`, `program-briefs/`, `loop-specs/` | Mined for requirements; preserved as reference |

### Not carried forward

- `Systems_Viz_MVP/` — May 11 snapshot of the same codebase, one generation older; superseded
  by the June 26 main file (which adds the deterministic layout, working vuln chains,
  configurable banner). Nothing unique except templates duplicated in `datasets/templates/`.
- `index.html` launcher page, `xsfer/`, `archive/`, `exports/`, `System Viz Tool.zip`,
  `~$ORD…docx` Office lock file — transfer copies and stale artifacts.
- The six-equal-tabs view structure (Data and Help as peer views to analysis) — a plumbing
  decision leaked into navigation; the new app uses three canvas views + modals.
- The permanent sidebar import plumbing, eleven stacked filter selects, 92px always-on metric
  strip, per-view silent color re-encoding, zero keyboard model — all replaced (see
  `PRODUCT_DIRECTION.md`).
- CO-004/005/006 change orders (milsymbol, MapLibre, MGRS) — never built. CO-004 is obsoleted
  by FSP's FM 1-02.2 `UNIT_TYPES` table; CO-005/006 remain backlog requirements input.

## Source Family 2 — FSP 26-2 Final

Family of operational-framework planning/briefing prototypes built for the 8 May 2026
facilitated discussion. Three variants; **OP Framework Integrated** (v1.14) is authoritative —
its README states it absorbed the other two, and the family PROJECT_STATUS says to default to it.

### What it contributed (harvested into `app/`)

| Asset | Source location | Disposition |
|---|---|---|
| Timeline/phase temporal model (`phaseAt`, `activityRoleAt`, `role_by_phase` — role is a function of time, not geography) | `OP Framework Integrated/scripts/app.js:77–213` | Ported — this is the new app's differentiator when fused with the criticality engine |
| Planning-surface coordinate model (lat/lon → fixed basemap-pixel world space, contain-fit + pan/zoom stack) | `scripts/app.js:5514–5600` | Ported; lat/lon is the only persisted geography |
| FM 1-02.2 unit symbology (`UNIT_TYPES`, 12 branch symbols as SVG paths, HQ/CP amplifiers, friendly-rect/enemy-diamond) | `scripts/app.js:7502–7573` | Ported for map markers |
| Persistence trio: 500ms-debounced localStorage autosave + JSON export/import + restore-baseline | `scripts/app.js:6614–6870` | Pattern ported |
| Global timeline scrubber UI (transport, phase chips, snapshot jump points, keyboard) | `index.html:815–876` | Interaction pattern ported, re-skinned |
| Icon-only header actions with hover titles (8 May finding: text labels fail at projection distance) | `index.html:57–80` | Pattern adopted |
| First-launch orientation card + full keyboard map | `index.html:861–876` | Pattern adopted |
| Modular-but-serverless folder layout (48KB shell + scripts/styles/data/lib, JSON islands because `fetch()` fails over `file://`) | whole folder, post-v1.14 refactor | Adopted as the new app's architecture |
| NASA Blue Marble Indo-Pacific basemap crop (public domain, 1.4MB, equirect bounds 90–160°E / 60°N–10°S) | `lib/basemap/earth-blue-marble-indopac-3072.jpg` | Copied into `app/lib/basemap/` |
| Scene/workspace JSON shapes (phases, activities, zones, units, annotations) | `scenes/`, `configs/`, `data/` | Absorbed into the unified scenario contract |
| Anti-goals that survived a real senior audience ("What I will NOT do": no narrator, no tour, no in-app slide deck, no fake metrics) | `NOTES.md`, `CLAUDE.md` | Adopted as product anti-goals |

### Not carried forward

- **OP FW - Time Slider/** — earlier cut of the same surface, folded into Integrated. Only its
  PNG-export handler was unique, and that approach (pixel compositing) is exactly what
  mis-registered; the new app exports by model-redraw instead.
- **OP FM - 3D & Alternatives/** — chrome organization ideas were absorbed by Integrated;
  the 3D/Three.js stack, disclaimer modal, discussion prompts, survey view, and framework A/B
  rhetoric are event materials, not product. Its 15MB tile pyramid and Natural Earth overlays
  remain in `_source` if higher-fidelity mapping is ever wanted.
- The **Comparator** view and the deep/close/rear doctrinal thesis baked into chrome — FSP was
  an advocacy artifact for one discussion; the new app argues no thesis. The D/C/R zone tooling
  survives as generic overlay tooling; the rhetoric does not.
- Hover-only inspector (inspection vanished on mouse move), Casebook dropdown hiding views,
  triplicated state displays, film-grain/scanline HUD cosmetics, sub-10px typography,
  lat/lon-by-keyboard effect placement, Shift+P dual coordinate systems — all replaced.
- `index.html.bak`, `compare-spike.html`, `storyToWorkspace` legacy migration shims,
  `pythagora-core/`, `opfw_12May.zip`, `_basemap-sources/` (1.5GB raw basemap sources), PPTX/DOCX
  briefing collateral — generated state, dead pipelines, or event collateral.

## Preservation rule

Nothing was deleted. `_source/originals/2026-07-03/` is intact and read-only. The `_archive/`
folder remains available for any future in-workspace supersessions. The new application and its
docs never depend on `_source` at runtime.
