# Phase D: junction and road geometry

## Goal

Roads and junctions built the way an engineer would build them, not just painted:
- roundabouts with splitter islands that deflect traffic into the ring
- avenues with raised, planted medians that open into turn bays at junctions
- expressways and motorways with a barrier down the middle, guardrails and shoulders

This is phase D of `2026-09-26-rce-polish-roadmap.md`. Decisions agreed: the items below.

A roundabout keeps one circulating lane in the simulation. Its lock-and-booking scheme, just made
stable, is not replaced in this phase. A two-lane ring behaving as two lanes, with lane choice on
entry, is a known limit carried to later work. The ring's paint says what the simulation does: one
lane, with a wide apron.

## Roundabouts (`src/render/roads.ts`)

- **Splitter islands:** where each arm meets the ring, a raised kerbed triangle between the entry lane
  and the exit lane.
  - It is widest at the ring (about 0.6 of the arm's width) and tapers to a point up the arm, over
    about 2.5 cells.
  - It is planted with grass, with the yield sign for that entry standing on it.
  - On a one-way arm, which only enters or only leaves, there is none.
- **The ring's paint:**
  - A solid edge line round the outside.
  - Round the central island, a "truck apron" band of textured paving: the part of the carriageway a
    long vehicle's rear wheels may cross.
  - Instead of the ring's flow arrows (no one needs arrows round a roundabout).
- **Entry deflection:** in the simulation too, a car entering follows the entry lane round the splitter
  island. The turn speed already slows entering cars. The island makes the approach curve visible.

## Avenue medians (`src/render/roads.ts`, `src/render/streetDetail.ts`)

- **The median:**
  - A two-way avenue (not one-way, not with added lanes that took the middle) gets a raised median
    kerb 0.12 wide in place of its double yellow line.
  - Grass on top, and in street view small trees every 2 cells.
- **At junctions:** the median stops short of the junction by its turn bay.
  - The bay is where the lanes' turn pockets run, or 1.5 cells.
  - It ends in a rounded nose, with the double yellow line carrying on through the bay.
- **Simulation:** cars already cannot turn across an avenue mid-block. Lots are reached from the nearest
  road end, so nothing changes. The median makes that visible.

## Expressways and motorways (`src/render/roads.ts`)

- **Median barrier:** a two-way expressway gets a concrete barrier (a low grey wall) down the middle,
  in place of its double yellow.
- **Guardrails:** the outer edge of every expressway, motorway carriageway and slip road, on posts,
  along the verge.
  - Not across junction mouths or ramp gores.
  - Bridges keep their parapets.
- **Shoulders:** a solid edge line inset from the carriageway's outer edge. The strip outside it gets a
  rumble texture: darker transverse bars.

## Testing

- **Renderer counts (`marks`):** splitter islands, median runs, barrier runs, guardrail runs.
  - A four-arm roundabout has 4 splitter islands, and a one-way arm gets none.
  - A two-way avenue has median runs stopping short of each junction.
  - An expressway has a barrier; a street has none.
- **Geometry:** no median, island or guardrail lies on another road's carriageway (checked against
  `onRoad`).
- **Existing suites** stay green.
- **Browser:** a roundabout, an avenue junction and an expressway, seen close up.
