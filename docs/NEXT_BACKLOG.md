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
17. **Generalize the spotlight briefing tool.** Shipped in Loop 8 scoped to the STACK view
    (CSS radial-gradient dim, cursor-follow or click-lock, `S` hotkey); the implementation in
    `app.js` is already view-agnostic (it just dims `#canvasArea`) — wiring it up for Map and
    Graph too is a small, low-risk follow-on.
18. **Telestrate / draw-annotation tool.** The source prototype's pencil tool (per-view stroke
    storage, undo/clear, pointer-capture drawing, `shadowBlur` glow) was deliberately not
    ported in Loop 8 — it's a genuinely separate feature (its own undo stack, persistence
    model) better scoped on its own rather than half-integrated alongside the WebGL rebuild.
    Folds naturally into backlog item #2 (map annotation tools).
19. **Stack-view icon set depth.** Loop 8 ported 12 painter functions (down from the source's
    ~18) covering OSP's `node_type`/`domain`/`branch_type` vocabulary; extend with dedicated
    silhouettes for cavalry/mortar/engineer-specific icons if a scenario's density warrants it
    (currently these fall back to a shared painter — `armor` or `facility`).

## Explicitly rejected (do not resurrect without new evidence)

- 3D globe (a rotating whole-Earth view, distinct from the multi-domain stack) — still
  rejected. (The stack half of this old item was promoted by owner decision 2026-07-04 and
  shipped in Loop 7 as a canvas-2D approximation, then rebuilt in Loop 8 as real WebGL — see
  `docs/ARCHITECTURE.md`'s STACK view section for what was and wasn't ported from the source.)
- The source's fixed 5-phase doctrine narrative (COMPETE/SHAPE/PENETRATE/DIS-INTEGRATE/
  EXPLOIT with scripted discussion questions per phase) — deliberately not ported in Loop 8
  even while porting its rendering fidelity. That is advocacy content for one specific
  briefing; OSP's phases stay scenario-defined. Revisit only on an explicit, separate request.
- Live feeds, COP integration, multi-user, server anything.
- In-app slide builder / narrated tour / auto-play briefing.
- Simulation or outcome prediction.
- Doctrinal-argument surfaces (Comparator, framework A/B rhetoric).
