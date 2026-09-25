# Real lanes and the Add-lane tool (Trafficity-style, phase 2)

## Goal

Lanes that carry traffic. Each road has a lane count per direction, the player can add or remove a
lane on one side of any stretch (the widening tapers in and out), and cars choose a lane for their
next turn, change lanes, overtake, and pass through junctions several at a time when their paths do
not cross. Adding a lane has to add real capacity.

This builds on phase 1 (`2026-09-25-freeform-roads-design.md`). Decisions agreed:
- The full simulation depth described below.
- Road kinds set a default lane count, and Add-lane changes it.
- Turn lanes are assigned automatically and shown with painted arrows. Editable arrows and signals
  are phase 3.

## What exists today (why this is needed)

- Lanes are only painted. Each segment direction is one car queue, and a car's lane is fixed by its
  slot number (`laneOffset`, `src/sim/worker.ts`). Nobody overtakes.
- Every non-plain junction admits one car at a time (`lockOwner`). That lock is the real capacity
  limit.

## Lane model (`src/roads/lanes.ts`, pure, shared by the sim, the renderer and the raster)

- `RSeg.addR`, `RSeg.addL`: integers (optional, default 0). They are the lanes added to the right or
  left of the centreline, seen travelling a→b. Negative values remove lanes, down to a minimum of 1 lane.
- `DEFAULT_LANES = [1, 2, 1, 3, 3, 1, 2]`: per direction for two-way kinds, and the total for the
  one-way kinds (motorway, ramp, highway2).
- `LANE_WIDTH = [0.36, 0.43, 0.24, 0.44, 0.44, 0.6, 0.5]`.
- Shoulder: `HALF_WIDTH − DEFAULT·LANE_WIDTH` for two-way kinds, and `(2·HALF_WIDTH − DEFAULT·LANE_WIDTH) / 2`
  for one-way kinds.
- Edges: `right = HALF_WIDTH + addR·lw` and `left = HALF_WIDTH + addL·lw`. Default roads therefore
  look exactly as they do now.
- Lanes per direction:
  - two-way: a→b gets `DEFAULT + addR` and b→a gets `DEFAULT + addL`
  - one-way: `(one-way kind ? DEFAULT : 2·DEFAULT) + addR + addL`
- Lane `i` (0 = kerb, the rightmost lane in the direction of travel) has its centre at
  `edge − shoulder − (i + ½)·lw`. The edge is the right edge for a→b and the left edge for b→a.
  One-way roads use the right edge. This reproduces today's lane positions for default roads.
- Limits:
  - Add-lane does not apply to KIND_LANE (a shared single track) or to roundabout arcs, which stay
    one lane.
  - At most 4 lanes per direction on two-way roads and 6 on one-way roads.
  - Bridges and tunnels change as a whole span.
- Tapers: at a node where exactly two segments meet, if one side of a segment is wider than the
  matching side of its neighbour, that side narrows linearly to the neighbour's edge over
  `TAPER = 1.6` (at most 40% of the segment). At junctions of 3 or more roads there is no taper; the
  lane runs to the stop line. `laneTapers(net)` returns these per segment end, and
  `edgeAt(seg, side, s, tapers)` gives the edge at arc length s.
- Lane continuity at a two-road node: lanes are matched by lateral offset in the travel frame
  (within 0.6·lw). A lane with no match *ends* there, and its cars must change lanes before the taper.
- Turn assignment (`approachLanes(net, node, seg, fwd)`), cached per network version:
  - Exits are the other directed edges out of the node, excluding a U-turn onto the same segment.
    Each gets a signed turn angle (positive = right) and they are ordered right→left.
  - **Pocket lanes** are lanes with no upstream counterpart at a two-road node at the approach
    segment's start. On the kerb side they serve only the rightmost exit; on the median side only the
    leftmost (when there are 2 or more exits).
  - The other lanes share the remaining exits by overlapping intervals: lane k of m serves exit j of E
    when [j/E, (j+1)/E] and [k/m, (k+1)/m] overlap by a positive length.
  - Target lanes: for the lanes serving an exit, ranked right→left (rank r of k), into an exit with n lanes:
    - right turns go to lane `min(r, n−1)`
    - left turns go to lane `max(0, n−k+r)`
    - straight goes to any of lanes `r … r+(n−k)` (the emptiest) when n > k, else `min(r, n−1)`
  - Two-road nodes map lanes by offset.
  - Merges and diverges at motorway interchanges (J_PLAIN with 3 highway arms):
    - Every lane that has an offset match goes straight on.
    - The ramp is served by the lane on the ramp's side.
    - A ramp joining a carriageway enters the lane on its own side.
  - Roundabouts: every lane of an arm enters the one-lane ring, and the ring leaves into lane 0.

## Traffic (`src/sim/worker.ts`)

- **Per-lane queues.** Key = `(seg·2 + dir)·MAXL + lane` with `MAXL = 6`. `laneCars`, `laneTail`
  and `laneFresh` are sized for this. Following, gaps and spawn-behind-tail checks use the car's own
  lane. The player blocks every lane of its direction.
- **Car fields:**
  - `lane`, `nextLane` (−1 until chosen) and `prevLane`
  - lane-change state: `chFrom` (the offset at the start of the change), `chP`, `chT`, `lcCool`
  - `box` (the junction the car is inside, or −1), plus `boxLi`
  - Drawn offset = smoothstep from `chFrom` to the lane centre, over max((p−chP)/1.6, (t−chT)/1.4).
    A lane change therefore also completes while the car is standing still.
- **Lane choice:**
  - A car spawns in lane 0.
  - On each leg that is not its last, the lanes it needs are the ones serving its next exit (or the
    lanes that continue at a two-road node).
  - If its lane is not one of them, it tries to move one lane towards them (cooldown 0.4 s).
  - If it is already in a correct lane with a slow or stopped leader within 1.2, and an adjacent
    correct lane has more room ahead (more than 1.5 extra), it changes lanes to overtake (cooldown 3 s).
- **Change feasibility:**
  - The target lane must exist at full width at p: a starting lane needs p ≥ taper, and an ending
    lane needs p ≤ len − taper − 1.6.
  - The gap ahead in the target lane must be at least the following gap plus 0.1.
  - The gap behind must be at least 0.8 (or 0.5 if the car behind is stopped).
  - The swept `trafficSpace.canMove` still guards every pose. A change stuck for more than 3 s
    reverts to the previous lane.
  - If a car still in the wrong lane has waited at the stop line for more than 8 s, it may take its exit
    from the lane it is in, so a car can never be stranded.
- **Next lane.** `nextLane` is picked when first needed (the stop-line room check or corner drawing)
  from the target lanes for (lane, exit), choosing the one with the most room, and then kept. On
  crossing into the next leg: `prevLane = lane`, `lane = nextLane`, and there is no lateral animation.
  `cornerPose` draws from the old lane to the new one.
- **Junction box (J_YIELD, J_LIGHT, J_STOP)** replaces the single `lockOwner`. Roundabouts keep
  their existing lock and booking.
  - A movement is (in seg, dir, lane, out seg, dir, lane).
  - Its path is a quadratic curve from the stop-line lane pose to the exit lane pose, 0.85 into the
    next segment, with the same control-point rule as `cornerPose`, sampled at 9 points.
  - Two movements **conflict** when any points of the two paths are within 0.32 of each other, unless
    they come from the same lane. The result is cached per node.
  - A front car at its stop line is admitted when all of these hold:
    - its target lane has room
    - its light is green
    - it has completed its stop
    - it conflicts with no car in the box
    - it does not conflict with the node's reservation (unless the reservation is its own)
  - **Reservation:** the first front car to wait more than 4 s at the line reserves the node until it
    is admitted, which prevents starvation.
  - A car leaves the box once it is on a later leg and past min(0.8, len/2). Freeing a car also
    releases its box and reservation.
- **Ramps:** the old toRamp/fromRamp outer-lane drift is replaced by lane choice (the ramp is served
  by the lane on its side). `rampLane` becomes the actual centre offset of the carriageway's lane on
  that side, so the ramp mouth still meets its lane.
- **Trolleybuses** stay in lane 0 and never change lanes.
- The remap check on edits also compares `addR` and `addL`.

## Rendering (`src/render/roads.ts` and friends)

- `MeshBuilder.band(pts, count, left, right, y, color)` fills between per-vertex lateral offsets
  `−left … +right`.
- Asphalt and kerbs are bands using `edgeAt`, so tapers show. Node discs use the largest edge of the
  segments meeting there.
- Markings are generated from the lane layout:
  - the centre divider stays as it is today
  - dashed white lines between lanes going the same way, skipped where one of the two lanes is tapering
  - edge and shoulder lines at the edges
  - for default roads the offsets come out equal to today's constants
- Turn arrows are painted about 1.4 before the stop line in every lane of approaches with 2 or more
  lanes, one arrow per direction served, bent 40° towards the turn.
- Consumers of `HALF_WIDTH[seg.kind]` for a particular segment use `sideHalf(seg, side)` (the edge on
  that side), or `roadHalf(seg)` = max(left, right) where a single width is needed:
  - raster cover, frontage and lot setback, per side of the road
  - `nodeHalf`
  - crossings, fillets
  - pavement walkers, lamps, furniture, parked cars, bike tracks, cyclists
  - stops, bridges, `onRoad`, `vergeSpot`
  - previews

## Add-lane tool (`src/input.ts`, `src/roadEdit.ts`, `Network.addLaneRange`)

- The tool is `addlane`, in the Roads panel, with no shortcut (every letter is taken).
- **Drag along a road.** The side is the side of the centreline the press lands on (the cross product
  with the tangent).
  - Plain drag adds one lane on that side for the dragged stretch.
  - Shift-drag removes one.
  - A click with no drag does the whole segment.
- `Network.addLaneRange(id, s0, s1, side, delta)` reuses `range`/`isolate` (it snaps ends within a
  cell), then changes `addR` or `addL`, and refuses anything beyond the lane limits. It returns the
  changed ids.
- `planEdit` gains `{ type: 'lane', seg, s0, s1, side, delta }`.
  - Cost: `ROAD_COST[kind] / DEFAULT_LANES_TOTAL · len · STRUCTURE_COST` per lane added. Removing a
    lane is free.
  - The existing validation, paving count and preview all apply.
  - The preview draws the widened band with its tapers.
- Edits carry lanes:
  - `splitSeg` copies them
  - `carryOver` copies them
  - `reverseSeg` swaps `addR` and `addL`
  - a kind change keeps them clamped to the limits
- Upkeep scales with the lane count: `(default + added) / default`.

## Saving

- `PlainNet` segments gain an optional 7th element, `lanes = (addR + 8) | (addL + 8) << 4`, written
  only when either value is non-zero.
- Binary saves: a sparse `segLanes: [[k, addR, addL], …]` in the v13 JSON block, keyed by compacted
  segment index and validated on load. No version bump is needed.

## Testing

- `tests/lanes.mjs`, pure:
  - default lane centres and edges equal today's constants
  - lane counts with adds on two-way and one-way roads
  - taper detection and `edgeAt`
  - offset matching across a street→avenue node
  - turn assignment for 1-, 2- and 3-lane approaches
  - a right pocket
  - motorway diverge
  - target lanes
  - `addLaneRange` limits, split, reverse and carry-over
  - `toPlain` / `fromPlain` and encode/decode round trips
- `tests/lane-traffic.mjs`, a headless worker sim, following the pattern of the existing `run.mjs`
  and taxi harness:
  - on a 2-lane avenue, cars occupy both lanes, and more cars cross a signal-free junction per minute
    than with 1 lane
  - a right-turn pocket lets right turners pass queued straight traffic
  - cars reach their exit lane before the stop line
  - no car is stuck 30 s (gave-up count stays within a bound)
  - junction throughput with multi-car admission is at least 1.5× the single-lock baseline, on a
    4-way crossing of avenues
- Every existing suite stays green.
- In the browser: add a pocket at a junction, watch traffic use it, and remove it again.

## Out of scope

Editable lane arrows and lane connectors, per-movement signal phases (phase 3), stacked elevation
levels (phase 4), bus-only lanes, and parking lanes.
