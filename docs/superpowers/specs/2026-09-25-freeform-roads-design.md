# Freeform road placement and editing (Trafficity-style, phase 1)

## Goal

Give road building the freedom of Trafficity (gridless drawing, suggestive snapping, direct
editing) in Gridburg's 3D view. This is phase 1 of five; lanes/add-lane, per-movement signals and
stacked elevation levels are separate later projects.

The road network is already a graph of quadratic Bézier segments (`src/roads/network.ts`) that
rendering, traffic and pedestrians follow at any angle. The grid only enters through click
snapping, the tile raster (lots, cover, access) and building facing. Phase 1 removes those limits
and adds editing.

## Approach

Edits run on a **scratch copy** of the network (built from `Network.toPlain()`), which is
previewed as a ghost with live cost/validity. Release commits the copy as the real network. Segments
keep a single control point, so the save format is unchanged.

## Components

### `src/roads/snap.ts` (new, pure)

`snapPoint(net, pointer, ctx) → { x, z, label, guides }`, where `ctx` holds the previous point and
heading, and the flags `grid` (G toggle) and `free` (Alt held). Candidates, first hit wins:

1. existing node within 0.9 → label `Join`
2. point on an existing road within 0.8 → `Connect`
3. intersection of two guide lines within 0.6 → `Guide ×`
4. a guide line within 0.5: continue-straight / perpendicular / parallel, taken from nodes and road
   ends within 12 units → `Straight`, `Perpendicular`, `Parallel`
5. heading step of 15° relative to the previous heading (or world axes when there is none), with
   the length rounded to whole units → `15°·n`
6. raw pointer

`grid` replaces 3–6 with the tile centre (today's behaviour). `free` skips 3–5 but still joins
nodes and roads (1–2). The curve-mode bend point uses the same function (skipping 1–2). Guides are
returned as line segments for a dashed overlay.

### `Network` edit operations

All operations reuse `resample`, bump `version`, and refuse (return `false`) on fixed pieces.

- `moveNode(id, x, z)`: moves the node, and bent segments keep their bend relative to the chord.
  Afterwards: merge into a node within 0.9, form junctions where the moved segments now cross
  other surface roads, and drop segments shorter than 0.4.
- `bendSeg(id, cx, cz)`: sets the control point.
- `cutRange(id, s0, s1)`: splits at both arc lengths and removes the middle piece. With s0≈0 and
  s1≈len it removes the whole segment. Refused on spans.
- `setKindRange(id, s0, s1, kind)`: splits the stretch out and sets its kind (whole segment on
  spans). Refused for motorway kinds.
- `Network.fromPlain(plain)`: builds an independent copy for the scratch.

### Input tools (`src/input.ts`)

- **Road drawing** uses `snapPoint`. G toggles the grid snap, holding Alt gives free placement, and
  the tooltip shows the snap label, the cost and the reason a road is invalid.
- **Edit** (new tool): drag a node, or the midpoint handle of a segment, to re-bend it. The ghost
  preview comes from the scratch copy, and release commits it.
- **Cut** (new tool): a click removes the segment under the cursor, and a drag along a road
  removes just that stretch.
- **Upgrade**: a click still upgrades a whole segment. A drag along a road changes the kind of just
  that stretch.
- **Undo** (Ctrl/Cmd+Z): one step, restores the network from before the last road commit and
  refunds its cost.

### Buildings on angled roads

- `buildingRotation(dx, dz, cardinal = false)` returns the true angle unless `cardinal` is set.
  Multi-tile and manually turned buildings keep cardinal facing.
- Angled 1×1 buildings (and their driveways, parked cars and street furniture) are scaled by
  `1/(|cos θ|+|sin θ|)` so they stay inside their cell.
- `raster.ts`: lots move toward the kerb along the road normal for any angle (the shift is capped
  as before). The existing junction conflict pass still undoes clashes.
- Alleys are skipped when the frontage is more than 10° off an axis.

## Rules and edge cases

- **Spans:** moving or bending is allowed only if `structurePlan` still passes. Cut is refused
  inside a span, and a kind change applies to the whole span.
- **Protected pieces:** fixed segments/nodes, entries and the cloverleaf cannot be edited. Ring
  nodes cannot be dragged.
- **Paving:** a moved road paves the buildings it now covers, like any new road. The preview
  shows how many buildings would be lost.
- **Cost:** a move or bend charges the added length × kind cost × structure factor (a shorter
  road refunds nothing). A kind change charges the price difference over the stretch. Cut is free.

## Testing

- `tests/road-snap.mjs`: priority order, 15° steps, guides, grid toggle, free mode.
- `tests/road-edit.mjs`: move/bend/cut/setKindRange, junction forming and merging, fixed/span
  rules, save round-trip after edits, scratch copy then commit.
- `tests/lots-angled.mjs`: lots on a 30° street face the road without overlapping.
  North–south/east–west rows are unchanged.
- Existing tests are updated wherever they assumed tile-centre snapping.
- In the browser: draw diagonal and curved streets, drag a junction, cut a stretch, upgrade part
  of a road.

## Out of scope

Lanes and the add-lane tool, lane changing, per-movement signals, multi-level elevation,
two-handle curves, and free (non-grid) lots.
