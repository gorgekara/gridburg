# Phase A: paint and signs

## Goal

What the simulation does at a junction should be readable from the road itself:
- who stops and where
- who gives way
- which lane may do what
- what each signal shows each lane

Decisions agreed: every item below. This is phase A of `2026-09-26-rce-polish-roadmap.md`.

## Shared junction facts (`src/roads/control.ts`, new)

The renderer and the worker must agree, so these facts are computed once from the network. The worker
keeps its own copies for speed.

- `junctionKind(net, node)`: `plain` | `yield` | `light` | `stop` | `ring`, by today's rules:
  - A ring node is `ring`.
  - Degree 3 or more, without a light or a stop, is `yield`.
  - The exception is a degree-3 node where only motorway kinds meet (a merge or diverge), which is
    `plain`.
- `majorArms(net, node)`: the segment ids of the major road at a `yield` junction, or null. The rules
  are `majorPair` and `roadRank` from `src/sim/priority.ts`, moved here so both sides can use them.
- `stopLine(net, seg, node)`: how far from the node an approach's stop line is painted.
  - With a zebra crossing, it is the crossing's near edge plus 0.1.
  - Otherwise it is the widest half-width at the node plus 0.3.
  - Crossing distances come from `crossingApproaches`, moved from `render/crossings.ts` to
    `src/roads/crossings.ts`.

## Where cars stop

- The worker's hold point on an approach becomes the stop line plus 0.3 (half the longest vehicle).
  That replaces `max(0.85, nodeHalf + 0.45)`, which left cars' fronts on the zebra.
- Movement paths through a box start from the same place.
- Roundabout arms have no zebras. There the hold point is the stop line plus 0.3, which is today's
  setback within a hair.

## Paint (`src/render/roads.ts`)

- **Stop lines:** a solid white bar across the arriving lanes, at `stopLine`, on every approach to a
  signal or an all-way stop.
- **Give-way lines:** a row of white triangles ("shark teeth") pointing at the driver, across the
  arriving lanes at `stopLine`. They go on every minor arm of a junction with a major road, and on
  every arm entering a roundabout.
- **Solid lines on approach:** within 1.5 of the stop line, the lines between arriving lanes are solid.
  - In the worker, a car makes no overtaking lane change inside that stretch.
  - A lane change it needs to reach its turn is still allowed. Drivers do that, and the 8 s
    wrong-lane fallback stays.
- **Hatched gores:** where a slip road leaves or joins a carriageway, white diagonal hatching in the
  paved gore between them.

## Signs (`src/render/roads.ts`)

- **Yield signs:** an inverted red-and-white triangle on a post, on the right-hand verge of every
  arm that has a give-way line. They sit like today's stop signs.
- **Chevrons:** on a curve whose curve speed is under 0.7 of its road's speed, yellow chevron boards
  on posts along the outside of its tightest stretch, about a cell apart. The curve speed comes from
  `segMinRadius` and `curveSpeed` in `src/sim/driver.ts`.
- **Speed signs (street view):** the speed-limit signs street view already scatters show the real
  limit of the road they stand by, in km/h. A game second is about three real seconds and a cell
  about 13 m, so 3 cells/s shows as 50. They are no longer random.

## Signals

- **All-red:** after the amber, 0.5 s in which every movement going red is red before the next phase
  starts. It is in `stateIn`, `cycleOf`, `fixedClock` and the worker's phase clock.
- **Per-lane heads:** an approach with two or more arriving lanes gets a mast arm over the road. It
  carries one three-lens head per lane, over that lane.
  - A lane's head shows the most permissive state of the movements that lane serves, from the turn
    tables.
  - Single-lane approaches keep the pole head at the kerb.
- **Flashing yellow for permissive turns:** a head whose best state is `yield` flashes its amber lens,
  about once a second. It does not show plain green. A head for turns only gets arrow-shaped lenses.

## Testing

- **`control.ts`:**
  - Junction kinds.
  - Major arms: a T of street and avenue, an equal crossroads, a pocket, a slip road.
  - The stop line sits behind the zebra.
- **The worker (`tests/driver.mjs`):**
  - At a red light, the front car's nose is behind the painted stop line and off the zebra.
  - No overtaking lane change inside the solid stretch.
- **Signals (`tests/signals.mjs`):**
  - The timeline has an all-red interval: `cycleOf` counts it, and every movement going red is red
    during it.
  - Per-lane heads show their own lane's state.
  - A permissive turn flashes amber.
- **Renderer counts (`tests/signals.mjs`):** a `marks` record from `RoadLayer.rebuild` counts stop
  lines, give-way lines, yield signs, chevrons and gore hatching.
  - A signal crossroads has 4 stop lines.
  - A street-avenue T has one give-way line and one yield sign.
  - A roundabout has one give-way line per entry.
  - A tight bend has chevrons.
- **Existing suites** stay green.
- **Browser:** the demo city shows the paint and signs. Screenshots if the browser pane is visible,
  otherwise checks run in the page.
