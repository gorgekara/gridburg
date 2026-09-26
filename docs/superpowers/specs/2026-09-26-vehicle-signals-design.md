# Phase B: vehicles that communicate

## Goal

A viewer should read what every vehicle is doing:
- braking and standing
- turning or changing lanes
- rushing to an emergency

Other traffic should react to blue lights as drivers do, and stuck vehicles should stop blinking out
of existence. This is phase B of `2026-09-26-rce-polish-roadmap.md`. Decisions agreed: every item
below.

## Signals per vehicle (worker → renderer)

- Each frame carries `carFlags` (a `Uint8Array`, one entry per slot) beside `cars`:
  - 1: braking
  - 2: left indicator
  - 4: right indicator
  - 8: blue lights
  - 16: leaving (the last half second before a stuck vehicle is removed)
- **Braking:**
  - Lit while the vehicle slows at more than 0.4 cells/s², or stands (speed under 0.05).
  - The worker keeps each car's actual acceleration.
  - Once lit, it stays on for at least 0.3 s, so it doesn't flicker.
- **Indicators:**
  - From 3.5 cells before a node where the car turns (`turnKind` right or left) until it is through.
  - Through a lane change, towards the new lane. Lane 0 is the kerb lane, so a higher lane is to the
    left.
  - A crashed car shows both (hazards).
- **Blue lights:** a vehicle on a callout (fire, patrol, crash, heist), driving or at the scene.

## Rendering (`src/render/cars.ts`)

- Per vehicle type, instanced lamp meshes placed over that type's own lamps:
  - brake lamps: bright red, at the tail lamps, a little larger
  - left and right indicators: amber, at the front and rear corners
  - for police and fire engines, a blue and a red beacon on the light bar
- They show by day and by night.
  - Indicators and hazards blink at 1.5 Hz.
  - Beacons alternate blue and red at 3 Hz.
  - An off lamp is scaled to nothing.
- A vehicle flagged `leaving` shrinks away over its last half second instead of vanishing in one
  frame.

## Making way for blue lights (worker)

- **Who counts:** only a callout under blue lights, meaning a fire engine to a fire or a patrol to a
  crash or a robbery, on its way.
  - A routine patrol, or a bin lorry, drives like everyone else and waits at red lights, which before
    this phase they ran.
  - Letting every mission vehicle clear the way cost the demo city a sixth of its population.

- **At junctions:** while a vehicle on a callout would reach a junction within 3 s, or is in its box,
  no other vehicle is let into that box or its roundabout lock. Traffic waits for it.
- **On a road with more lanes:** a car ahead of a callout in its lane, within 4 cells, changes lane
  away if there is a gap. It does so even on a solid stretch.
- **On a single lane:**
  - A car ahead of a callout, within 4 cells, pulls over. It eases 0.15 towards the kerb and slows to
    a stop.
  - The callout eases 0.14 the other way and passes it: a pulled-over car does not count as its
    leader.
  - The overlap check on the vehicles' real shapes still stops the callout if the gap is not there,
    for instance with oncoming traffic.
  - A pulled-over car moves on when the callout is 1 cell past it.

## Stuck vehicles

- **Insistence:** two-thirds of the way to its patience (30 s stuck plus the signal cycle), a car
  becomes insistent. It ignores the rules that are only about turns, which by then are deadlocked:
  - bookings of the box by others
  - gaps it would otherwise wait for
  - roundabout give-way
  - a lock held by a car that is not moving

  It still never moves into another body.
- **Removal:** at its patience a still-stuck car is removed, as a failed trip, as before. It is flagged
  `leaving` for its last half second and shrinks away.
  - While building this, removal was moved out to 120 s. That left the overloaded demo city
    gridlocked: 451 of 578 cars were stuck after 200 s. So removal stays at patience.
  - Rush hours and route choice (phase E) are what should make removals rare.

## Testing

- **Worker (`tests/driver.mjs`):**
  - A car approaching a red light shows braking, then standing.
  - A car about to turn right shows the right indicator from 3.5 cells out.
  - A car changing lanes shows the side it moves to.
  - A callout gets through a queue on a single-lane street faster than it would if nobody pulled
    over. The test measures the time.
  - No car enters a junction box while a callout is 2 s from it.
  - A car stuck in a deadlock does not vanish before 120 s.
- **Renderer (`tests/signals.mjs` or a new suite):** a braking car's brake lamps are drawn and an idle
  one's are not; indicators blink.
- **Existing suites** stay green.
- **Browser:**
  - brake lights in a queue at a light
  - an indicator before a turn
  - a fire engine through traffic
