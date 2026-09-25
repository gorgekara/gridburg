# Road-aligned Zoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zone cells along roads, painted with a brush, with full-size buildings snapped into them.

**Architecture:** `roads/raster.ts` generates road-aligned cells, matches each to one tile, and writes
`lotX/lotZ/face/cell/accSeg`. The renderers use full size where a tile has a cell. The zone tools in
`input.ts` become cell brushes. The worker and saves are unchanged.

**Spec:** `docs/superpowers/specs/2026-09-25-road-zoning-design.md`

## Global Constraints
- Grid streets reproduce today's lot positions exactly.
- A tile holds at most one cell; cells never overlap, and never lie on a road or on water.
- Every existing suite stays green.

### Task 1: Cells in the raster
**Files:** `src/roads/raster.ts` (`cell: Int8Array` and `cellYaw` in `Raster`, `lotScaleAt(raster, i)`),
`src/placement.ts`, `tests/lots-angled.mjs`.
- [ ] Rewrite the lot tests for cells (grid regression, angled and curved streets, 1:1 matching, no
  overlap, rows equally far from the road). Make them fail, implement, make them pass. Commit.

### Task 2: Full-size buildings and a cell overlay
**Files:** `src/render/buildings.ts`, `src/render/streetDetail.ts`, `src/render/parkedCars.ts`.
- [ ] Buildings use scale 1 where a tile has a cell. The overlay shows every cell as a faint outline,
  and zoned cells in their zone colour, turned. Commit.

### Task 3: Zone brush
**Files:** `src/input.ts` (zone tools become brushes, Shift unzones, a preview), `src/ui/hud.ts` hints.
`zoneCellsUnder(raster, x, z, r)` is exported for tests.
- [ ] Test the brush selection. Run `npm run build`. Browser check. Commit.
