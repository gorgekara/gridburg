# Per-movement traffic signals (Trafficity-style, phase 3)

## Goal

Fully customisable traffic lights. A signalised junction runs a plan of phases, and each phase gives
every movement (from one arm into another) a state: green, yield-on-green, or red. The player edits
plans in a junction editor with movement arrows drawn over the junction. Optionally a signal adapts
its timing to traffic.

Decisions agreed: an editor of phases × movements; a smart default plan; fixed timing with an
optional adaptive mode.

## Today

`node.light` is on or off. `lightGroups` splits the arms into two groups by angle, and `signalPhase`
runs a fixed 18 s cycle (8 s green, 1 s amber per group). Turning traffic uses the gaps that the
junction box admission finds. Each approach has one lamp.

## Model (`src/roads/signals.ts`, pure)

- **Movement key:** `${inSeg}${f|b}>${outSeg}${f|b}`, from an arriving segment direction to a
  leaving one, built from the same exits as `approachLanes`. The lanes a movement uses come from the
  automatic turn lanes, so plans survive lane edits.
- **Plan:** `SignalPlan = { phases: { green: number; moves: Record<key, 1 | 2> }[]; adaptive?: boolean }`.
  1 is protected green, 2 is yield-on-green, and a movement not listed is red.
  - Each phase is followed by `AMBER = 1` s. During it, a movement that is not green in the next
    phase shows amber; one that is green in both stays green.
- **Where it lives:** `RNode.signal?: SignalPlan`. A signalised node without a plan, or with a plan
  that no longer fits the junction (`planFits` fails), uses `defaultPlan`. `planFor(net, node)` gives
  the effective plan.
- **Default plan:**
  - Four arms that split into two opposite pairs: one phase per pair. Straight on and right turns
    (angle ≥ −0.35) are protected; left turns yield.
  - Three arms with an opposite pair: phase A is the through road, with straight and right protected
    and the left turn into the side road yielding. Phase B is every movement from the side road,
    protected.
  - Anything else: one phase per arm, with all its movements protected.
  - Every green is 8 s.
- **Timeline:** `stateIn(plan, phase, t, len, key)` returns `'green' | 'yield' | 'amber' | 'red'` for
  a phase whose current green length is `len` (the plan's green when not adaptive).
- **Edits keep plans:**
  - `splitSeg` renames the split segment's keys at each end node to the child segment there.
  - `reverseSeg` swaps f and b for that segment in the plans at both of its end nodes.
  - Any other edit that changes a junction's arms makes `planFits` fail, and the default takes over.
  - A node that stops being a junction (fewer than 3 arms) loses its light and its plan, as it does today.

## Simulation (`src/sim/worker.ts`)

- **Phase clock:** each light node keeps `phase`, `t` and `len`. It starts offset by `nodeId·3.7 s`
  into the cycle, as now, and advances each substep. When `t ≥ len + AMBER` the clock moves to the
  next phase.
- **Adaptive:** checked 4 times a second.
  - **Demand for a phase:** a car whose next movement is green or yield in that phase and which is
    within 6 of the stop line of its leg.
  - **End early:** after 3 s of green, if the current phase has no demand and another phase does, the
    green ends now (`len = t`).
  - **Extend:** while there is demand and `len < 2·green`, `len` keeps pace with `t`.
- **Cars at a J_LIGHT stop line:** the state of their own movement decides.
  - **Red:** stop. Callouts ignore this, as now.
  - **Amber:** go only if within 0.6 of the line.
  - **Green:** go; box admission still applies.
  - **Yield:** as green, but also wait while a front car of another approach is within 2.5 of its
    stop line on a *protected* green whose movement conflicts (`conflicts`, as the box uses).
- **Frames:** each frame carries `signals: Float32Array` holding `[nodeId, phase, t, len]` for every
  light node. `lightGroups`, `signalPhase` and `isGreen` are no longer used by the simulation.

## Rendering

- **Lamps** (`RoadLayer.update`): one per approach, as now. The colour is the best state among that
  approach's movements (green or yield shows green, then amber, then red). It comes from the frame's
  signal clocks, falling back to the fixed timeline before the first frame.
- **Editor overlay** (`src/render/signalOverlay.ts`): for the node being edited, each movement is
  drawn as a curved ribbon with an arrow head. It runs from the approach's first serving lane, through
  the node, into the exit's target lane. The colour shows its state in the selected phase: green,
  amber for yield, or dim red. It keeps the sampled paths for picking.

## Editor (`src/ui/signalPanel.ts`, `src/input.ts`, `src/main.ts`)

- The Signal tool (T): a click on a junction without a light adds one (as now, $). A click on a
  signalised junction opens the editor for it.
- **The panel:**
  - the junction's phases, each row showing its number and green seconds, with −/+ (1 s steps,
    between 3 and 60) and delete (at least one phase must remain)
  - add a phase (starts with every movement red and 8 s)
  - an adaptive checkbox
  - reset to default, remove signal, close
  - clicking a row selects that phase
- **Overlay:** clicking a movement arrow with the editor open cycles it red → green → yield → red in
  the selected phase. Clicking another signalised junction switches the editor to it; Escape closes it.
- Every change sets `node.signal` to the edited copy, bumps `net.version` and flushes, so it is saved,
  sent to the worker and undoable.

## Saving

- `PlainNet.signals?: [nodeId, SignalPlan][]`.
- Binary saves: a sparse `signals: [[nodeIndex, plan]]` in the v13 JSON block, with the plan's keys
  rewritten to compacted segment indices and read back into segment ids. It is validated on load, and
  an invalid plan is dropped (the default takes over).

## Testing (`tests/signals.mjs`)

- Default plans: a 4-way crossing has 2 phases with lefts yielding; a T has 2 phases; a 5-way has one
  per arm.
- `stateIn` timeline: green, amber into a phase where the movement is red, no amber where it stays
  green, red.
- Keys survive `splitSeg` and `reverseSeg`; an unfit plan falls back to the default; plain and binary
  save round trips.
- Simulation, in the `lane-traffic` harness style with the worker in-process:
  - on a signalised crossing, no car enters on red
  - opposite straight movements move in the same phase
  - yield left-turners wait while oncoming protected traffic is at the line
  - adaptive beats fixed timing on lopsided demand (one busy arm)
- Every existing suite stays green. Browser check: open the editor, change a movement, and watch the lamps.

## Out of scope

Lane-level signal control, pedestrian phases, coordinated green waves between junctions, and editing
turn connections (which lane goes where).
