# Driver Model and Junction Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every vehicle a speed with IDM acceleration, give busy roads priority at uncontrolled
junctions, and let the player inspect a road's flow, speed and queue.

**Architecture:** The pure maths lives in `src/sim/driver.ts` (IDM, curve and turn speeds) and in
`src/sim/priority.ts` (ranking arms and critical gaps). `src/sim/worker.ts` keeps its structure:
`stepCars` still builds `maxP` from hard limits, and IDM then chooses how far to move within it.
The measurements are kept per segment and direction in the worker. The inspector plumbing follows the
building inspector's.

**Tech Stack:** TypeScript, Web Worker, Node test scripts.

**Spec:** `docs/superpowers/specs/2026-09-26-driver-model-design.md`

## Global Constraints
- Game second is about 3 real seconds. `T = 0.45`, `s0 = 0.08`, `aLat = 1.7`, critical gaps 2.0 / 2.2 / 2.4 / 1.4 s.
- The hard safety limits (`maxP`, `trafficSpace.canMove`) stay; IDM never moves a car past them.
- Every existing suite stays green; any threshold change is justified in the test's comment.

### Task 1: Driver maths
**Files:** Create `src/sim/driver.ts`, `tests/driver.mjs`; add the suite to `tests/all.mjs`.
**Produces:** `idmAccel(v, v0, gapToHold, dv, params)`, `stepMotion(p, v, a, dt, maxP)`, `DRIVER[vehicle]`,
`curveSpeed(radius)`, `turnRadius(theta)`, `approachSpeed(vNext, d, b)`, `segMinRadius(seg)`.
- [ ] Tests: acceleration from rest, stopping at a hold point, following gap. Implement. Commit.

### Task 2: Driver model in the worker
**Files:** `src/sim/worker.ts`, `tests/driver.mjs`, existing suites as needed.
- [ ] `Car.v`; spawn speed; IDM within `maxP`; leader speed; curve, turn and anticipation caps;
  virtual leader past the junction; amber rule; box request distance; speed-aware lane changes;
  `segCong` reference speed.
- [ ] Worker tests: queue discharge rate, curve slower, turn slower. Run every suite; fix. Commit.

### Task 3: Junction priority
**Files:** Create `src/sim/priority.ts`; `src/sim/worker.ts`; `tests/driver.mjs`.
- [ ] Rank arms, major pair, critical gaps by movement; minor gap acceptance; major left yields;
  booking by rank with a 12 s minor patience; roundabout approach by time.
- [ ] Tests: T priority, equal crossroads without deadlock, roundabouts. Run every suite. Commit.

### Task 4: Measurements and road inspector
**Files:** `src/sim/worker.ts`, `src/sim/messages.ts`, `src/game.ts`, `src/main.ts`, `src/ui/hud.ts`, README.
- [ ] Per segment and direction: flow, mean speed, queue, delay. `inspectRoad` / `roadInspection`.
  Clicking a road without a tool opens the road inspector.
- [ ] Test the report. Browser check. README. Commit.
