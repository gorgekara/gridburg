# Driver model and junction priority

## Goal

Make traffic behave like traffic, so that road design matters.

- Every vehicle has a speed, and it accelerates and brakes smoothly. The following model is the
  Intelligent Driver Model (IDM).
- Curves and turns slow traffic down.
- Where a busy road meets a quiet one, the busy road has priority. Traffic on the quiet road waits for
  a gap.
- Roundabout entry works on gaps measured in time, not distance.
- The player can click a road and see what it carries: flow, speed and queue.

Decisions agreed: all of the recommended options below.

## Scale

A game second is about three real seconds: a street's 3 cells/s is city speed (about 50 km/h) when a
cell is about 13 m. Real driving parameters are converted with that factor. The aim is a lane that
discharges about 1.7–2 vehicles per game second from a queue. Today it is about 7.

## Driver model (`src/sim/driver.ts`, new, pure functions)

- **State:** each car gets `v` (speed along its leg, cells/s). Spawned cars start at 0, except those
  entering from beyond the map edge, which start at the road's speed.
- **Acceleration (IDM):** `a = aMax · (1 − (v/v0)⁴ − (s*/s)²)` with `s* = s0 + max(0, v·T + v·Δv / (2√(aMax·b)))`.
  - `s` is the distance to the obstacle ahead plus `s0`, so a car stops exactly at its hold point.
  - The obstacle is the nearest hard limit ahead, the car's `maxP`: the leader less the jam spacing
    (today's `gap`), a stop line when the car is held, or the end of its trip.
  - `Δv` is the car's speed minus the obstacle's speed: the leader's speed for a leader, 0 for a stop
    line.
- **Per vehicle:**

  | Vehicle | aMax (cells/s²) | b (cells/s²) |
  |---|---|---|
  | Car, taxi, van, police | 1.6 | 2.4 |
  | Lorry, bus, trolleybus, bin lorry, fire engine | 0.9 | 1.8 |
  | Racer | 3.0 | 3.0 |

  - Time headway `T = 0.45` s for all. `s0 = 0.08`.
  - Blue-light vehicles use `T = 0.3`.
- **Integration:** ballistic, `p += v·dt + ½a·dt²`. Speed is clamped to `[0, v0]`, and braking to at most
  8 cells/s².
  - The existing hard limits (`maxP`, the swept overlap check) stay as a safety net. When one cuts a
    move short, the car's speed becomes the distance it actually covered divided by `dt`.
- **Creep:** a car within 0.02 of its hold point and below 0.3 cells/s snaps to it. So a stop is
  reached, and trips arrive at their ends.
- **Desired speed `v0`:** the road's speed × the driver's pace (× 1.55 for racers), capped by:
  - **Curves:** each segment's lowest curve speed, `√(aLat · Rmin)`, with `aLat = 1.7` cells/s² and
    `Rmin` sampled from its Bézier. So roundabout rings, tight bends and ramps are slower than
    straights.
  - **Turns:** the speed allowed through the node at the end of the leg, `√(aLat · r)`. Here
    `r = CORNER / tan(θ/2)` and `θ` is the angle between the two legs; straight on is no limit.
  - **Anticipation:** the car slows ahead of a lower limit, whether a turn or the next road's speed,
    as `√(vNext² + 2·b·d)`, where `d` is the distance to the node.
- **Looking past the junction:** a front car allowed through a junction also follows the tail of the
  lane it will enter on the far side, as a virtual leader with that car's speed. So it slows for a
  queue beyond the junction instead of meeting it at the node.
- **Signals:** at amber a car stops if it can stop at `b` before the line (`v² / 2b` is no more than
  the distance to go). Otherwise it goes on through.
- **Junction boxes:**
  - A car asks for the box once it is within its braking distance of the line, `max(0.3, v²/2b + 0.2)`,
    instead of within 0.3. So traffic with priority rolls through at speed instead of stopping at
    every line.
  - A car not yet admitted treats the line as a hold point, as today, so it brakes in time.
- **Lane changes:**
  - Gap acceptance adds speed. The car behind in the target lane must be at least
    `half + 0.25 + v_lag · T · 0.6` back. The car ahead must be at least `gap + 0.1 + v · T · 0.3`
    ahead.
  - A car overtakes a slow leader as well as a stopped one: one moving at under 0.6 × the follower's
    `v0` within 1.5.
- **Congestion measure:** `segCong` compares movement with the speed the car could have driven there,
  its capped `v0`, not the road's raw speed. So slowing for a corner does not read as congestion.

## Junction priority (`src/sim/priority.ts`, new)

- **Major and minor arms:** at an uncontrolled junction (`J_YIELD`), every arm gets a rank.
  - Class first: motorway kinds, then expressway, then avenue, then street, then lane. Then the number
    of lanes.
  - The major road is the pair of top-ranked arms that runs most nearly straight through (at least
    150° apart).
  - There is no major road when the top rank is shared by more arms than that pair and another pair is
    just as straight: a crossroads of two equal streets. Such a junction keeps today's first-come box
    for everyone.
- **Gap acceptance, minor road:** a car on a minor arm goes only when no car on the major road that
  would cross its path could reach the junction within its critical gap. That is judged by the major
  car's distance to its line divided by its speed (at least 0.5 cells/s).
  - Critical gaps are the Highway Capacity Manual's values scaled by three: right turn 2.0 s, straight
    across 2.2 s, left turn 2.4 s.
  - Conflict uses the existing movement-conflict test on the two movements.
- **Gap acceptance, major left:** a major-road car turning left across the oncoming major lanes gives
  way to oncoming major traffic within 1.4 s.
- **Priority in the box:**
  - A minor car books the box (`boxWait`) only after 12 s instead of 4. Its booking then holds back
    conflicting traffic from every arm: after that long it forces its way in, so priority is real but
    a minor arm is never starved for ever.
  - Callouts still book at once.
  - A car admitted early, still short of the junction at speed, is judged by when it will arrive. A
    waiting car may go ahead of it if it is further off than the waiting car's gap: its critical gap,
    or 1.6 s at a junction without priority.
- **Roundabouts:** a circulating car counts as approaching a node when it would reach it within
  1.3 s, judged by its distance and speed. That replaces the fixed 1.3-cell distance. The locks and the
  booking after `RING_PATIENCE` stay as they are.

## Measurements and the road inspector

- **The worker measures, per segment and direction:**
  - Flow: vehicles leaving the segment per game minute, an exponential moving average.
  - Mean speed of the cars on it.
  - Queue: the length of the stopped stretch behind its stop line.
  - Mean delay per vehicle at its end node: time spent below 0.3 cells/s on the approach.
- **Inspection:** clicking a road with no tool in hand opens an inspector for that road.
  - It shows the road's kind and lanes, then a row per direction: flow per minute, mean speed against
    the limit, queue in cars, and delay.
  - For an uncontrolled junction end, whether the approach is major or minor.
  - The inspector refreshes with the city's state, like the building inspector, and uses its message
    and panel: `inspect` carries the road's segment id, and the report comes back as an ordinary
    inspection with a line per direction.

## Found while building

- **Platoons:** a car right behind one already let into a junction on the same path follows it in.
  Otherwise every queued car starts from rest at the line.
- **Room beyond:** behind a moving car, the distance still to go to the junction counts as room on
  the far side.
- **Arriving:** an arriving car slows to 0.8 cells/s to turn in; it does not stop in the lane.
- **Stopped after all:** a car let into a box early that is then stopped short of its line (the light
  changed) gives its place back. Otherwise it blocks the crossing phase.
- **Roundabouts:**
  - Ring nodes use their locks only, not boxes.
  - A circulating car takes the lock over from the car just ahead once that car is past the node.
- **Creeping:** edging forward a hair at a time counts as standing still, so it does not reset a
  driver's patience.

## Known limits

- A single-lane roundabout carries about one vehicle a second when flooded. That is somewhat under a
  real one. Its lock-and-booking scheme is the next thing to replace.

## Out of scope

- Time of day and return trips, route choice changes, turn bans and lane connectors, and signal timing
  aids. These are later phases.
- Merges and weaving get IDM following and speed-aware lane changes, but no zipper or ramp-metering
  logic.

## Testing (`tests/driver.mjs`, new, plus existing suites)

- **Driver model, as pure functions:**
  - From rest a car reaches 90% of `v0` smoothly, with no step in acceleration beyond `aMax`.
  - It stops at a hold point without passing it.
  - Behind a slower leader it settles at a gap of about `s0 + v·T`.
- **In the worker:**
  - **Queue discharge:** 12 cars queued at a red light. On green, the first car's start is not
    instant, and the lane discharges 1.2–2.5 cars per second (today about 7).
  - **Curves:** a car on a tight bend is slower than on the straight either side.
  - **Turns:** a car turning right at a junction is slower through the node than one going straight.
  - **Priority:** at a T where a street meets an avenue, avenue cars going straight through never wait
    for side-street cars. Side-street cars wait longer on average, but all get through.
  - **Equal crossroads:** keeps working with no priority, and no deadlock.
  - **Roundabouts:** the flooded-roundabout test and every existing traffic test still pass. Thresholds
    move only where the lower capacity is the point, and each change says so.
- **Inspector:** a report for a busy road shows positive flow, speed and a queue at a red light.
- **Browser:** the demo city runs, the inspector opens on a road, and traffic visibly accelerates away
  from lights.
