# Phase E: when people travel, where they go, and how buses work

## Goal

The city's traffic should have the rhythm and the geography of a real one:
- a morning and an evening peak
- people coming home again
- errands close by rather than across town
- drivers who do not all take the same road
- buses that actually stop

This is phase E of `2026-09-26-rce-polish-roadmap.md`. Decisions agreed: the items below.

## The day's rhythm (`src/sim/demand.ts`, the worker's `spawn`)

- **Profile:** `dayProfile(h)` scales the trip rate by hour, normalised so the day's total is
  unchanged.
  - A morning peak near 8:00 and an evening peak near 17:30, both about twice the average.
  - A midday shoulder, and the small hours at about a third.
  - The city's clock is 20 game seconds to the hour, so a day lasts 8 minutes.
- **Purpose:** `purposeAt(h, r)` gives what each trip is for.
  - Mornings are mostly to work.
  - Late afternoons are mostly home again, a return trip from a job to a home.
  - Middays and evenings are mostly errands to the shops.
- **Distance:** `pickByDistance` does it, a simple gravity model: four candidate destinations are drawn by
  weight, then one is picked with likelihood falling off with distance (e-folding 18 cells). Trips are
  mostly local.

## Route choice (worker)

- **Jitter:** every trip but a callout judges each road's cost a little differently, ±15%, so drivers
  spread over routes that cost about the same.
- **Rerouting:** a driver held up for more than 6 s on the road it has just left looks for a better way
  on from the next junction. It takes the new route if it is at least a tenth quicker and carries on
  the way it faces.
  - Buses, trolleybuses and callouts keep their routes.

## Buses (worker)

- **Stops:** a bus line's run is out to its far stop and back. At the far stop the bus pulls in towards
  the kerb and stands for 3 s before the run back.

## Out of scope, carried on

- **Bus lanes:** these need a lane-use rule (bus only) and a tool to set it. They are a later piece
  of work.
- **Painted bus bays at stops:** not in this phase.
- **Buses stopping at intermediate stops:** lines are two-stop direct in this game.

## Testing

- **Demand:** the profile's mean is 1, with peaks and a quiet night, and the purposes by hour and the
  distance preference hold.
- **Two equal routes:** drivers use both, each carrying more than a fifth. After rerouting every car's
  route still joins up, leg to leg.
- **A bus:** it stops at its far stop, stands at least 2.5 s, then drives back.
- **The demo city (measured):** 13,700 residents after 240 s against 10,400 before, commutes of 63 s
  against 80 s, and fewer give-ups.

## As built, after review

- **The demand clock:** it follows the city's own clock, which starts at 9:00, and the day length set
  in the game. At first the worker counted from midnight on a fixed 480 s day, 9 hours out.
- **Rerouting:**
  - A reroute keeps the arc it is on: the leg's end is reset to the new route's.
  - It waits 15 s after the last one.
  - It is skipped just after passing a light, and for looping trips.
- **Bus dwell:** the flag sits on the last driven leg, and the bus is released only once its stand has
  started and run out.
- **Callouts in a busy street:** with the city starting near the morning peak, an engine behind pulled-over
  cars could meet an unbroken oncoming queue and never pass. Oncoming drivers now pull over too while a
  callout is waiting to get past, and it goes once they have.
- **The demo city after these fixes:** 13,300 residents after 240 s, commutes of about 65 s.
