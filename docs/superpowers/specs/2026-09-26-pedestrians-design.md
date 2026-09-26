# Phase C: pedestrians as traffic

## Goal

People cross at the zebras, and the traffic has to deal with them:
- turning cars wait for people on the crossing they are turning across
- signals give pedestrians their phase, with walk and don't-walk heads
- nobody cuts across a junction outside the zebras

This is phase C of `2026-09-26-rce-polish-roadmap.md`. Decisions agreed: every item below.

## Crossing pedestrians in the simulation (worker)

- **Crossings:** every zebra the renderer paints (`crossingApproaches`) is a crossing.
  - Each is identified by its node, its segment and which end of the segment it is at.
  - It has a centre, a direction across the road, and a length: the road's full width.
- **People arrive at each end of a crossing:**
  - The rate follows the buildings around it: 0.004 a second for each level of built zone within 2 cells
    of its centre, with a floor of 0.01 and a ceiling of 0.2.
  - At most 6 wait at a crossing, and at most 320 are out across the city.
  - Arrivals scale with `trafficScale` and thin at night like the rest of the traffic.
- **Walking pace:** 0.3 cells per game second, about 1.3 m/s, with ±15% between people.
- **When a waiting person steps out:**
  - **At a signal:**
    - Only when the crossing shows walk. That means no traffic from the road being crossed has a green,
      a yield green or amber in the current phase: people cross beside the traffic that runs parallel to
      them.
    - Also only while enough of the green is left to get across. That is the flashing don't-walk:
      nobody starts, but those on the crossing finish.
  - **Elsewhere (a zebra):**
    - People have priority, but nobody steps in front of a car that cannot stop. A car arriving along
      that road inside its braking distance of the zebra (plus 0.4) holds them back.
    - So does a car in the box that will cross the zebra on its way out.
- **Cars give way:** a car is not let into a junction while anyone is on, or stepping onto, a crossing it
  will pass over on its half of the road. That covers:
  - the zebra on its own approach, as it comes in
  - the zebra on the road it turns into, as it leaves

  At a signal this is the turning traffic giving way, as real drivers must. Cars already in the box
  finish. People hold back for them, as above.
- **Frames:** each frame carries `peds`: position, heading and state (waiting or crossing) for every
  person at or on a crossing.

## Pedestrian signals

- `crossingState(plan, phase, t, len, fromKeys, crossTime)` in `roads/signals.ts`, shared by the worker
  and the renderer, gives one of three states:
  - `walk`
  - `flash`: walk allowed, but too little green left to start
  - `stop`
- Every signalled crossing gets a pedestrian head on a short post at each end, facing across:
  - a white walking figure for walk
  - an orange hand for stop
  - the hand flashing for flash

## The people on the pavements (`render/pedestrians.ts`)

- **Crossings:** people waiting at and walking across zebras are drawn from the worker's `peds`, with
  the same figures.
- **Corners:** the scenery walkers no longer cross a road at a junction. At a junction they carry on
  round the corner onto the next road on their own side (they turn the way their kerb bends), or turn
  back. Crossing is what the simulated pedestrians do.

## Curb ramps

At both ends of every zebra, the kerb dips to a ramp with a strip of yellow tactile paving.

## Testing

- **Worker (`tests/driver.mjs`):**
  - At a busy zebra, people cross.
  - Across 150 s of traffic, no car's body is on a zebra's half of the road while a person is on that
    half of that crossing.
  - Traffic still flows.
- **Signals:**
  - People only start to cross while their crossing shows walk. Nobody starts in the flashing interval.
  - `crossingState` goes walk → flash → stop across a phase.
- **Renderer:**
  - A signal crossroads gets two pedestrian heads per crossing, in the right colours for the phase.
  - Every zebra gets tactile strips at both ends.
- **Existing suites:** stay green. Traffic thresholds move only where waiting for people costs capacity,
  and each change says so.
- **Browser:** people crossing at a signal on the walk, and a turning car waiting for them.
