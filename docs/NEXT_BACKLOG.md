# Next Backlog

Updated: 2026-07-03. Ordered by product impact within each tier. Nothing here blocks the
current demo; the shipped slice is complete and verified (see `VERIFICATION.md`).

## Tier 1 — highest impact next

1. ~~In-app editing~~ — **done in Loop 6**: inspector edit forms for nodes and links,
   add/delete with reference cleanup, click-to-place on the map, snapshot undo
   (Cmd/Ctrl+Z, 20 deep). Remaining niceties: multi-select bulk edit, drag-to-reposition
   placed markers, editing vulnerabilities/activities/zones (currently JSON-only).
2. **Map annotation tools.** Port the FSP polygon zone tool (click vertices, snap-halo close,
   Esc cancel), draggable labels, and 50-step undo from
   `_source/.../OP Framework Integrated/scripts/app.js:5628–5790`. The overlays schema
   (`zones[]`, `annotations[]`, phase-scoped) is already in the contract — this is UI only.
3. **XLSX import/export.** Port the zero-dependency OOXML/ZIP codec from
   `military_systems_graph_tool.html:3252–3463` as `io-xlsx.js`. Gate every build with
   `unzip -t` on the artifact (custom binary writers corrupt silently). Staff sections live in
   Excel; CSV alone is a workaround.
4. **Saved briefing snapshots.** Capture `{view, t, viewport, selection, layers}` as named
   snapshots ("Slide 3 — SATCOM SPOF"); batch-export all snapshots as banner-stamped PNGs.
   The export pipeline already draws from the model, so this is bookkeeping + a dialog.
5. **Playwright browser gate.** Automate the 10-step manual pass: `page.on('request')`
   network-silence assertion, per-view screenshots at 1440×900/1920×1080/1280×720, download
   capture for PNG/JSON, pixel-sample the export for banner presence.

## Tier 2 — strong candidates

6. **COA / turn comparison.** Load two scenarios (or two turns) and diff the risk picture:
   which findings appear/disappear, whose criticality moved. Generalizes the FSP Comparator
   mechanic without its doctrine-thesis baggage.
7. **MGRS readout.** Vendor the MIT-licensed `mgrs` package (CO-006 spec exists in
   `_source/.../change-orders/`); show MGRS beside lat/lon in the inspector and cursor readout.
8. **Threshold controls for finding rules.** `OSP.findings.RULES` is already a config object;
   expose it in an advanced panel with per-scenario persistence, plus per-rule enable/disable.
9. **Unplaced-entity placement flow.** Click a tray item → crosshair mode → click map to
   assign lat/lon (writes `geo`, undoable). Companion to editing (item 1).
10. **Finding lifecycle.** Pin / dismiss / accept-risk states on auto findings, persisted in
    the scenario, with dismissed findings visible under a filter (analyst-override trail).
11. **Hierarchy view upgrade.** Echelon-banded hierarchy layout with command/support overlay
    styling (the Systems Viz hierarchy view's grouping ideas, redrawn to the new visual
    language).

## Tier 3 — worth keeping on the radar

12. **MapLibre + PMTiles vector basemap** (CO-005 spec): Loop 5 delivered a **global** raster
    tile pyramid (whole Earth at 60 px/degree, local, LRU-loaded), so worldwide coverage is
    done. Vector tiles now matter only for street-level zoom, place labels, and boundary
    layers. The `geo.js` world-space abstraction isolates the change. Related nicety:
    dateline-crossing scenarios (entities straddling ±180°) currently split across the map
    edges — add longitude wrapping if a Pacific-dateline scenario materializes.
13. ~~Full FM 1-02.2 / milsymbol symbology (CO-004)~~ — **done in Loop 4**: milsymbol 2.2.0
    vendored, map markers render MIL-STD-2525C frames/icons/echelons/HQ staffs with validated
    letter SIDCs. Remaining niceties: text amplifiers (unique designation fields) and per-node
    SIDC overrides in the data manager UI (`symbol.sidc` passthrough already exists).
14. **Dataset workflow pack.** Ship `datasets/templates/` + the AI-prompt pack + transfer
    manifest alongside the app (the Systems Viz closed-network workflow that reviewers valued).
15. **Scenario-file schema migrations.** `schema_version` is stamped and checked; write the
    first real migration when v1.1 changes the contract (pattern proven in FSP
    `migrateWorkspaceCoords`).
16. **Performance pass for 250+ node scenarios.** Incremental SVG updates instead of
    innerHTML re-render on selection; spatial index for map hit-testing.

## Explicitly rejected (do not resurrect without new evidence)

- 3D globe — still rejected. (The multi-domain *stack* half of this item was promoted by owner
  decision 2026-07-04 and shipped in Loop 7 as the STACK view — rebuilt data-driven on a
  dependency-free canvas perspective renderer, not ported from the Three.js prototype.)
- Live feeds, COP integration, multi-user, server anything.
- In-app slide builder / narrated tour / auto-play briefing.
- Simulation or outcome prediction.
- Doctrinal-argument surfaces (Comparator, framework A/B rhetoric).
