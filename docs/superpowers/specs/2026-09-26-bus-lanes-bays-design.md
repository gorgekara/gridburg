# Phase E, part two: bus lanes, bus bays and stops along the way

## Goal

Finish phase E of `2026-09-26-rce-polish-roadmap.md`. It promised bus bays, dwell times and bus lanes;
the first part built the demand and route choice, and deferred these:
- **Bus lanes:** a road's kerb lanes kept for buses, painted red, with the rule obeyed in the
  simulation.
- **Bus bays:** a lay-by at each stop, so a standing bus is out of the traffic lane and cars pass it.
  Cars let a signalling bus back out.
- **Stops along the way:** a bus calls at every stop on its route that is on its kerb side, not only at
  its far stop.

Decisions (the recommended options, as agreed for all of phase E): the items below.

## Bus lanes

- **Where:** any road with at least two lanes in a direction. Its kerb lane (lane 0) in that direction
  becomes a bus lane. Not on narrow lanes, ramps or roundabout arcs.
- **The flag:** `RSeg.bus`, like `bike`: set per segment, and applying to every direction that has two
  or more lanes.
  - It is kept when a segment is split or edited, and dropped once the road can no longer have one.
  - It is saved as bit 9 (512) of the plain flags, and in the save file's JSON block as `segBus`, the
    segment indices, as with `segHi`.
- **The span:** `busLaneSpan(net, seg, fwd)` in `src/roads/busLanes.ts`, shared by the worker and the
  renderer. It gives distances along the direction of travel.
  - It starts clear of the junction behind.
  - It ends `BUS_BAY` (1.5) short of the stop line ahead, so traffic turning kerbside can move into
    the kerb lane there.
  - Where the road only carries on through a two-road node, the span runs to the node, so bus lanes
    on consecutive segments join up.
- **Who may use it:** buses, trolleybuses, taxis carrying a fare, and callouts.
- **Other traffic:**
  - Never picks the bus lane inside its span. A car in it there (from a lot, or a turn in) moves out
    as a mandatory change.
  - A car turning kerbside at the junction ahead waits in the next lane and moves over in the bay.
  - Joining a road, it takes a general lane if its turn allows one.
  - A car pulling over for a callout may use it: drivers do.
  - A car arriving at a lot along the span may enter the bus lane in the last `BUS_BAY` before it.
- **Buses:** they keep to the bus lane where it goes their way, moving into it when they can.
- **Paint:**
  - A red surface along the span.
  - A wide solid line between the bus lane and the next, dashed across the bay and where the lane
    starts.
  - "BUS" in seven-segment letters, stretched along the lane, at the start of each span and every 6
    cells.
- **The tool:** "Bus lanes" in the road menu, next to bike lanes. Click a road to add or remove; it
  costs $10 a cell. The hover label says why a road cannot have one.

## Bus stops and bays

- **Stops a bus calls at:** every operational bus stop whose access point lies on the bus's route, on
  the kerb side of its direction of travel, more than 0.3 from where the leg starts.
  - Also the far stop, as before, whichever side it is on.
  - It stands 2 s at an intermediate stop and 3 s at the far stop.
- **Replacing `Leg.dwell`:** each bus carries `calls: { li, p, bay }[]`, in order, and the index of the
  next one. It stops with its centre at `p` on leg `li`.
- **Bays:** a stop on the kerb side of a road whose kerb lane is not a bus lane gets a lay-by. It is a
  paved indent `BAY_DEPTH` into the verge beside the kerb lane: 1.8 long, with 0.4 tapers at each end.
  - **Pulling in:** the bus eases out of its lane by `BAY_SIDE` (0.29, enough for a car to pass it
    alongside) as it draws up, signalling kerbside.
  - **In the bay:** once it is all the way out (95% of `BAY_SIDE`), following traffic passes it. It is no
    longer anyone's leader, and it does not hold up its lane's queue.
  - **Leaving:** after its dwell the bus signals out, and pulls back out once every car behind it in
    the lane can stop in comfort short of it (courtesy to buses, as the UK Highway Code asks). Until
    then it waits.
- **In a bus lane:** the bus stops in the lane, as before (a nudge to the kerb). The stop gets a painted
  "BUS STOP" box instead of a bay.
- **Paint and kerb:** the bay has an asphalt surface, a kerb round its back, and a yellow dashed
  outline.

## Testing

- **Network (`tests/lanes.mjs` or a new suite):**
  - `canAddBusLane` holds on an avenue and on a street with an added lane each way. It fails on a
    plain street, a lane, a ramp and a ring arc.
  - The flag survives `toPlain`/`fromPlain`, a split and a save round trip.
  - It is dropped when lanes are taken away.
  - The span starts after the junction and stops short of the next stop line.
- **Worker (`tests/driver.mjs`):**
  - On an avenue with bus lanes, over 150 s, no car without the right is in the kerb lane inside the
    span. Cars turning kerbside at the end still get there. A bus uses the bus lane.
  - A bus stops at an intermediate stop on its kerb side and stands about 2 s. In a bay it moves out
    of the lane, a car behind passes it while it stands, and no car behind brakes hard as it leaves.
  - Traffic flow on the avenue is not worse than without bus lanes when there are no buses. With the
    kerb lane taken, the general lanes carry the traffic.
- **Renderer:**
  - The `marks` counters `busLanes` (spans painted) and `busBays`.
  - An avenue with the flag has two spans; a stop by a street has one bay.
- **Existing suites** stay green, and the demo city (which has bus lines) keeps its numbers.
- **Browser:** a red bus lane on an avenue, and a bus standing in a bay with cars going past.

## As built

- **Bus lanes:**
  - Built as specified.
  - The span ends `BUS_BAY` short of the *solid stretch* before the stop line, not short of the stop
    line itself. Cars moving over to turn kerbside cross a broken line, never the solid one that
    phase A paints up to the stop line.
  - A bus whose turn at the next junction needs another lane keeps to the bus lane until 2.5 short
    of the span's end, then moves out.
  - The renderer's counters live on the new layer (`BusLaneLayer.marks`: `busLanes`, `busBays`,
    `busStands`), not on the road layer's junction marks.
- **Lay-bys:**
  - A bus standing in one is nobody's leader.
  - A bus waiting to pull out is: for the first follower that can stop in comfort short of it. The
    others pass. `canLeaveBay` asks for the same room, so the two agree.
  - Standing at the stop does not use up a bus's patience; waiting to pull out does.
  - The bus-stop building stands back `BAY_SETBACK` from its lot, and parked cars and kerbside
    furniture keep clear of the bay.
- **The end of the run:** turning round in the road at the far stop was the old behaviour. It left
  a bus half across the road, and the cars behind ran into it. Now:
  - The route back sets off the way the bus arrived (`route(..., dir)`) and comes back round. A
    first leg that just carries on is merged into the one before.
  - Turning in the road is kept only where no such route exists. It starts after the stop, and only
    with the lane it turns into clear. The car behind treats the bus as still standing at the stop
    until it has swung clear.
- **Stops as hold points:** a bus now brakes for a stop as for a stop line (the driver model sees
  it), instead of being clamped at it. The far stop used to cost a hard stop every time.
- **Worker tests, as measured:**
  - Across 150 s: 0 car-steps without the right in the bus lane (2,718 in the kerb lane on the same
    road without bus lanes).
  - Buses were in their lane 100% of the time.
  - 66 through against 58 without bus lanes; 12 turned kerbside against 14.
  - The lay-by test: the bus stands 0.29 out of its lane, 4 cars pass it, and nobody brakes hard.
- **After review:**
  - The car that lets a bus out stands where the bus's own check treats it as clear. Before, each
    waited for the other until the bus ran out of patience.
  - A bus pulls into a lay-by only from the kerb lane, and asks for it 8 cells ahead. If it could not
    get over, it stands in its lane.
  - `stopKind` in `src/roads/busLanes.ts` decides, for the worker and the renderer alike, whether a
    stop gets a lay-by or a stand in the lane, or is not served:
    - a lay-by only where it fits clear of the stop line and zebra at either end
    - never on narrow lanes, bridges or roundabouts
  - The way back from a far stop is searched from each way out of the node ahead (`routeOnward`), so
    the bus goes round rather than turning in that junction.
  - Trolleybuses run stop to stop, without calling at bus stops.
  - Stops are worked out again whenever the roads change.
  - Congested test: a stop 2.5 short of a light with a car every 0.4 s. The bus stands 19–30 s in
    the lay-by (the red light's queue beside it), and is never given up on.
  - **Left as known limits:**
    - The stop building's setback applies to stops without a lay-by too.
    - Parked cars leave both sides of a road with bus lanes, even a direction without one.
