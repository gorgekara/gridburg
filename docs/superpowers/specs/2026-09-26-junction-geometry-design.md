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

## As built

- **Roundabouts:**
  - Built: the splitter islands, the truck apron and the ring without arrows.
  - Not built: the ring's outer edge line. It would cross every entry, where it reads as a stop line.
  - The islands are narrow enough to stay clear of both lanes' traffic: 0.03–0.16 wide at the ring. So
    the simulation needs no entry deflection. The turn speed already slows entering cars.
- **Avenue medians:**
  - Built: the kerbed grass median, stopping 1.5 short of junctions, with the double yellow through the
    bay.
  - Not yet: trees on medians in street view, and medians on avenues with added lanes.
- **Expressways:**
  - Built: the barrier on two-way expressways, and guardrails on expressways, motorway carriageways and
    slip roads. They open at junctions and ramp mouths, and are left off bridges and roundabouts.
  - Not built: the rumble strip. The shoulder outside the edge line is too narrow to show it.

## Testing

- **Renderer counts (`marks`):** splitter islands, median runs, barrier runs, guardrail runs.
  - A four-arm roundabout has 4 splitter islands, and a one-way arm gets none.
  - A two-way avenue has median runs stopping short of each junction.
  - An expressway has a barrier; a street has none.
- **Geometry:** no median, island or guardrail lies on another road's carriageway (checked against
  `onRoad`).
- **Existing suites** stay green.
- **Browser:** a roundabout, an avenue junction and an expressway, seen close up.

## Built later (after phase E)

- **Two-lane roundabouts.** A ring built of an avenue or bigger circulates in two lanes (`ringLaneCount`
  in `src/roads/lanes.ts`). It works turbo-style:
  - The lane is chosen on entry: the outer lane for a first exit (up to 30% of the way round), the
    inner lane otherwise.
  - No changing lanes on the ring, and the arm's lanes line up for it.
  - Each node's lock is split into an outer half and an inner half (`ringMask` in the worker):
    - circulating in the outer lane takes the outer half
    - circulating in the inner lane takes the inner half
    - joining or leaving by the inner lane crosses the outer, so it takes both
  - Joining the outer lane gives way only to the outer lane.
  - Street rings are unchanged.
  - The flooded avenue roundabout carried 299 vehicles against 233 with one lane (+28%).
  - The ring is painted with a single broken line between its lanes.
- **Median trees:** every two cells along each avenue median, in the road layer's decorations.
- **Rumble strips:** transverse bars outside the edge lines of expressways and motorway carriageways.
