# Freeform Roads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gridless road drawing with guide snapping, direct road editing (drag nodes, bend, cut, partial
re-kind), and buildings that face angled roads.

**Architecture:** A pure snapping module feeds the existing road tools. New `Network` edit operations
share one extracted "lay a curve with crossings" helper. The Edit, Cut and Upgrade drags preview on a
scratch `Network.fromPlain(net.toPlain())` and commit it by swapping `game.net` (the same pattern as
`entrancePlan`), so `Game.flush()` records undo for free. The raster and the building transforms drop
their axis-only assumptions.

**Tech Stack:** TypeScript, Three.js, Vite. Tests are Node `.mjs` scripts that import the `.ts` sources
through a resolve hook (`tests/run.mjs` pattern), run by `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-25-freeform-roads-design.md`

## Global Constraints

- The save format is unchanged (still one control point per segment).
- Roads on north–south/east–west lines lay out exactly as before: same lots, same facing.
- Fixed, entry and roundabout-ring pieces cannot be edited.
- Undo already exists (`Game.flush` → `undoStack`, Ctrl/Cmd+Z in `main.ts`). Each commit must be a
  single `flush()`.
- Keys: G toggles grid snap while a road tool is in hand (G still rotates buildings for service tools),
  holding Alt gives free placement, N selects the Edit tool, H the Cut tool.

---

### Task 1: `src/roads/snap.ts` — guide and angle snapping

**Files:** Create `src/roads/snap.ts`, create `tests/road-snap.mjs`, and add the suite to `tests/all.mjs`.

**Interfaces (produces):**
```ts
export interface SnapCtx { from?: {x:number;z:number} | null; heading?: {x:number;z:number} | null;
  grid?: boolean; free?: boolean; joins?: boolean /* default true */; excludeNodes?: Set<number>; excludeSegs?: Set<number> }
export interface Guide { ax:number; az:number; bx:number; bz:number }
export interface Snapped { x:number; z:number; label: string | null; guides: Guide[]; node?: number; seg?: number }
export function snapPoint(net: Network, p: {x:number;z:number}, ctx?: SnapCtx): Snapped
```
Priority: node (0.9, `Join`) → road (0.8, `Connect`) → [grid: `roadPoint`-style tile centre] →
guide crossing (0.6, `Guide ×`) → guide line (0.5: `Straight` / `Perpendicular` / `Parallel`) →
15° step from `from` (`15°·n` relative to the heading, or `Angle n°` against the world axes) with the
length rounded to a whole unit → raw. `free` skips the guide and angle steps. `joins:false` skips the
node and road steps.

- [ ] Write the tests: node wins over road; road wins over guide; a point 0.3 off a dead end's
  extension snaps onto it with `Straight`; perpendicular through a node; an angle step of 37° from
  `from` with heading +x gives 30° and a whole-unit length; `grid:true` gives a tile centre;
  `free:true` returns raw unless near a node; `excludeNodes` ignores that node.
- [ ] Run `node tests/road-snap.mjs` and see it fail. Implement. Run again and see it pass. Commit.

### Task 2: Network edit operations

**Files:** Modify `src/roads/network.ts`, create `tests/road-edit.mjs`, and add the suite to `tests/all.mjs`.

**Interfaces (produces):**
```ts
layCurve(fromId, toId, c: Curve, kind, oneway, structure): number[]   // insertPath's inner loop, extracted
tAt(seg: RSeg, s: number): number                                      // arc length -> t
editable(seg: RSeg): boolean                                           // !fixed and not a ring arc
moveNode(id: number, x: number, z: number): number[] | null            // new ids of the re-laid segments
bendSeg(id: number, cx: number, cz: number): number[] | null
cutRange(id: number, s0: number, s1: number): boolean
setKindRange(id: number, s0: number, s1: number, kind: number): number[] | null
```
- `moveNode` keeps each attached segment's bend by storing the control point in chord coordinates.
  It merges into another node within 0.9 (reattaching the segments), then re-lays the attached surface
  segments through `layCurve` so new crossings become junctions. Bike and calm flags carry over. A
  node left with no segments is removed. It refuses nodes that are fixed, entry or ring, and nodes
  with any non-editable attached segment.
- `cutRange`: s0 < 0.5 snaps to the start and len − s1 < 0.5 to the end. A whole-segment cut on a span
  is allowed; a partial one is refused.
- `setKindRange` gives a span a whole-segment change, and refuses one-way kinds for a partial range.

- [ ] Write the tests: moving a T-junction end across another road forms a junction there; moving
  onto a node merges; a bent segment keeps its bulge after its end moves; fixed nodes are refused;
  cutting the middle of a 10-long straight leaves two segments of about 3 and 3 when cutting 3..7;
  a partial cut on a bridge is refused; `setKindRange` makes a 3-piece road with an avenue middle;
  an encode/decode round-trip preserves the edits; a scratch-copy edit leaves the original untouched.
- [ ] Fail, implement, pass. Run `npm test` so `insertPath` (now calling `layCurve`) is still
  covered. Commit.

### Task 3: Input — freeform drawing, guides, G/Alt

**Files:** Modify `src/input.ts`.
- `snap()`, `endPoint()` and the curve bend point call `snapPoint` with `{ from, heading, grid:
  this.gridSnapOn, free: this.free }`. The bridge mid-span guard is kept. The park-path branch is
  untouched.
- `previewRoad` draws the dashed guides from the last snap and puts the snap label in front of the
  cost label.
- `onKey`: G toggles `gridSnapOn` while a road tool is in hand (with a toast). Every pointer event
  records `this.free = e.altKey`.
- [ ] Run `npm test` and fix any test that assumed tile snap by setting `gridSnapOn: true` on the
  headless `Input`. Commit.

### Task 4: Input — Edit, Cut and Upgrade-drag tools, plus HUD

**Files:** Modify `src/input.ts`, `src/ui/hud.ts` (the tools and help text), `src/ui/icons.ts`
(`edit` and `cut` icons) and `src/main.ts` (the underground list).
- Edit: pressing near a node grabs it; pressing on a road grabs the segment, and the drag makes the
  curve pass through the cursor at t = 0.5 (`c = 2P − (A+B)/2`).
- Cut: a click removes the segment; a drag along it removes [s0, s1].
- Upgrade: a click is unchanged; a drag applies `setKindRange` to `nextRoadKind`.
- All three: scratch = `Network.fromPlain(plainAtPress)`, apply the op, preview the changed segments
  (red when invalid) with the label `cost · −n buildings · reason`. On release, if valid and
  affordable: `scratch.version = g.net.version + 1; g.net = scratch; g.spend(cost); g.flush()`.
- Validation: hills and water for surface segments (`measurePath` over `[a, c, b]`), `structurePlan`
  for spans (checked against a copy with the edited segment removed), and map bounds.
- [ ] Add headless tests to `tests/road-edit.mjs` using the `inputFor` pattern: a drag that moves a
  node through the Input commits and charges; a drag onto water is refused. Commit.

### Task 5: Buildings on angled roads

**Files:** Modify `src/placement.ts`, `src/roads/raster.ts`, `src/render/buildings.ts`,
`src/render/parkedCars.ts`, `src/render/streetDetail.ts` and `src/render/alleys.ts`. Create
`tests/lots-angled.mjs`.
```ts
buildingRotation(dx, dz): number   // true angle; snaps to a cardinal within 10°
lotScale(yaw): number              // 1 / (|cos|+|sin|) about the nearest cardinal, 1 when cardinal
```
- In `raster.ts`, lots shift along the normal at any angle.
- `buildings.ts` composes with `lotScale`.
- `streetDetail.lotFrame` and the driveways scale their offsets the same way.
- Alleys skip frontage that is more than 10° off an axis.
- [ ] Tests: on a 30° street, zoned lots face 30°, no two scaled footprints overlap (separating-axis
  test on the squares), and an axis-aligned street's `lotX`/`lotZ` match a snapshot of the old
  algorithm. Commit.

### Task 6: Docs and browser verification
- README road section and the in-game help. Browser: draw a diagonal street, a curve, drag a node,
  bend, cut, and part-upgrade; zone along the diagonal; take screenshots. Run `npm run build`. Commit.
