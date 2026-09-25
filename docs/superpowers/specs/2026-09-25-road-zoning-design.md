# Road-aligned zoning

## Goal

Zone along roads rather than on the tile grid. While a zone tool is in hand, every road shows rows
of zone cells running parallel to its kerb, up to 3 deep, at any angle or curve. You paint them with
a brush. Buildings stand full size in their cells, in neat rows snapped to the road.

Decisions agreed: paint cells with a brush (Shift-drag unzones); up to 3 rows deep.

## Approach

The tile stays the unit of the simulation and of saves. Growth, trips, utilities, pollution,
coverage and districts all keep working per tile through `accSeg`/`accS`, so the worker and the save
format do not change. What changes is the **lot layout** in `roads/raster.ts`: road-aligned cells are
generated from the roads, and each cell is matched to exactly one tile. That tile's zone and building
are then drawn in the cell.

## Cells (`roads/raster.ts`)

- **Where cells go:** for every segment with frontage (not expressways, highways, bridges or tunnels)
  and each side of it, cells are 1×1 squares facing the road.
  - Row r (0, 1, 2) has its centre at `edge + 0.09 + 0.5 + r` from the centre line, where `edge` is
    that side's half-width.
  - Along the road, cells are 1 apart. Beside a road within 10° of an axis they are phased so their
    centres fall on tile centres, so grid streets lay out exactly as before. Otherwise the phase is 0.5
    from the start.
- **Dropped cells:** a cell is dropped if any corner or its centre lies on a road (closer than that
  road's half-width plus 0.05), on water, on raised ground or on a roundabout island. It is also
  dropped if it overlaps a cell already kept (an oriented box test).
  - The order of kept cells: row 0 first, then by segment and position. So a row nearer a road wins,
    and the inside of a curve thins out instead of overlapping.
- **Matching cells to tiles:** each kept cell is matched to the tile containing its centre, if that
  tile is free, not covered and not water. Otherwise it goes to the nearest free neighbour tile whose
  centre is within 0.8. A cell that finds no tile is dropped. A tile holds at most one cell.
- **What a matched tile gets:**
  - `lotX/lotZ` = the cell centre
  - `face` = the cell's orientation (towards the road)
  - `cell[i]` = the row (0–2), or −1 if the tile has no cell
  - `accSeg`/`accS`/`accX`/`accZ` = the cell's road and its point on it
- **Tiles without a cell** keep today's behaviour: the old per-tile lot, and a building turned and
  shrunk to fit. So old cities with zones there still render. They cannot be newly zoned.

## Zone tool (`input.ts`)

- Zone tools stop being rectangle tools.
- **Brush:** press and drag, and every cell within the brush's radius of the pointer is painted with
  the zone in hand, at $5 a cell, with the unlock gates as now. The radius uses the existing brush
  sizes: 0.7, 1.6 or 2.8.
- **Shift-drag** unzones cells that hold a zone.
- **Preview:** the cells under the brush are highlighted.
- Painting over a service building or another zone behaves as the rectangle did: services are left
  alone, and another zone is replaced.

## Rendering

- **Zone overlay** (`render/buildings.ts`): shown only while a zone tool is in hand.
  - Every cell as a faint outline quad, so the paintable cells along roads are visible.
  - Zoned cells filled with their zone colour, turned to their `face`.
- **Buildings in a cell** are drawn at full size (scale 1) in the cell's orientation. The shrink
  (`lotScale`) now applies only to tiles without a cell. The same goes for street detail (`lotFrame`)
  and parked cars.

## Testing (`tests/lots-angled.mjs`, rewritten, plus new cases)

- A grid street: rows 0–2 across from the road are at exactly the old lot positions, facing a cardinal
  direction.
- Streets at 30° and 45° and a curved street: cells face the road, their buildings are full size
  (scale 1), no two cells overlap (a separating-axis test on unit squares), and cells in one row are
  equally far from the road.
- No tile holds two cells, and no cell is on a road or on water.
- The brush: painting along a 30° street zones exactly the cells under the stroke; Shift unzones.
- Existing suites stay green: the demo city, the zone-growth tests and `run.mjs`.
- Browser: zone along a diagonal and a curved street, let it grow, and take a screenshot.

## Out of scope

Lots bigger than one cell (multi-cell buildings from zoning), lots for roads without frontage, and
changing the simulation to use cells instead of tiles.
