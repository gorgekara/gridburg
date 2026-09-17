# Gridburg

A small 3D city builder that runs in a browser tab. The thing that matters most is traffic.

Everyone arrives by the highway at the edge of the map. Draw roads out from it, zone beside them, and the
city grows on its own. Cars commute over your roads and queue for real, so busy junctions jam until you
fix them. Keep the lights on, the water clean, and the factories away from the houses.

**Play:** https://gorgekara.github.io/gridburg/

## What is in it

- **Traffic puzzles.** Five hand-tuned cities that somebody else built badly, each with one thing wrong:
  a district nobody connected, a single bridge, a crossroads taking the whole town, a lane that wanders,
  and a grid in gridlock. The buildings are frozen and the budget never earns, so the only thing you can
  change is the traffic. Solve one under par for three stars.
- **Freeform roads, placed with clicks like Cities: Skylines.** Straight (two clicks), Curved (start, bend,
  end) or Smooth (every click continues the road as a flowing curve). Crossings become junctions
  automatically, endpoints snap to existing roads, and roads over water become bridges.
- **Two road types.** Roads and wider, faster avenues, plus an Upgrade tool to convert one into the other.
- **Traffic management.** Signals, one-way streets, and roundabouts. Uncontrolled junctions let one car
  through at a time; signals move a whole approach at once; roundabouts never stop.
- **A highway entry.** One fixed connection to the outside world. Buildings only grow when their road
  connects to it, new residents drive in through it, and commuters use it in both directions.
- **Utilities along roads.** Wind and coal power, water towers and river pumps, sewage outlets. Buildings
  need all three to grow past small. Outlets foul the river downstream, so pumps belong upstream.
- **Pollution.** Industry and coal pollute the ground around them. It spreads, drives residents away, and
  spoils water towers. Press P to see it.
- **A different river every map**, generated from a seed that is stored in the save.

## Traffic puzzles

Pick **Traffic puzzles** from the menu, or open one directly at `#p=four-ways`.

A scenario is the same simulation with three rules changed: buildings never grow, decay or get
demolished, there is no income, and utilities are taken as read. What is left is a fixed amount of
traffic and a fixed amount of money, and the level is solved when every goal holds *at once* for the
level's hold window — typically that every building still reaches the highway, that the average
commute is under half a minute, and that nobody abandons their trip. Spending less than par earns
three stars; your best result per level is kept in the browser.

Each level opens with two minutes of traffic already fast-forwarded, so you arrive to a jam that has
finished forming rather than an empty city. Bulldozing roads is free, so a wrong turn only costs
what you paid to build it.

| Level | The problem | Budget |
| --- | --- | --- |
| First Mile | Two districts with their own streets and no link to the highway | $2,000 |
| One Bridge | Homes one side of the river, every job on the other, one two-lane bridge | $2,600 |
| Four Ways | Every trip in town through a single uncontrolled crossroads | $1,600 |
| The Long Haul | The jobs are at the far end of a lane that was a cart track first | $3,500 |
| Rush Hour | A grid of towers all crossing to the other half at once | $3,000 |

## Controls

| Input | Action |
| --- | --- |
| Left click | Place road points, signals, roundabouts and service buildings |
| Left drag | Zone or bulldoze a rectangle (a drag also lays a single road) |
| Right click / Esc | Stop laying a road; Esc again puts the tool away |
| Right drag, Q / E | Rotate |
| WASD / arrows, middle drag | Pan |
| Wheel | Zoom |
| R, V, U | Road, Avenue, Upgrade |
| C | Cycle road drawing: Straight, Curved, Smooth |
| O, T, Y | Roundabout, Signal, One-way |
| 1, 2, 3 | Homes, Shops, Industry |
| B | Bulldoze |
| P | Pollution view |
| Space | Pause |
| H | Help |

The city autosaves in your browser, and **Share** copies a link that contains the whole city.

## How it works

- Vite + TypeScript + [three.js](https://threejs.org/), no UI framework.
- **Roads** are a graph of nodes joined by quadratic Bezier segments (`src/roads/network.ts`). Inserting a
  road snaps its ends, splits every segment it crosses, and creates junction nodes. Roundabouts cut the
  roads that cross a circle and join them with one-way arcs.
- **Zoning stays on a tile grid.** The network is rasterized onto it (`src/roads/raster.ts`): tiles under a
  road are paved, tiles within three rows of a road can use it, and buildings turn to face their road.
- **Scenarios are authored in the highway's frame** (`src/scenarios/`): `along` counts tiles inward
  from the entry and `side` across it, so a level lands the same way up whichever edge the seed put
  the highway on. Districts are filled from the streets the level lays down, so they follow their own
  roads. Goals are evaluated on the main thread against the worker's per-second report.
- **The simulation runs in a Web Worker** at 30 Hz (`src/sim/worker.ts`): A* routing over the road graph
  with congestion-aware costs, car-following with minimum gaps, junction locks, signal phases, utilities,
  pollution diffusion, growth, and the economy. Cars that are stuck for 30 seconds give up and despawn.
- **Rendering** is a handful of draw calls: the whole road network is one vertex-colored mesh that is
  re-tinted by congestion, buildings and cars are `InstancedMesh`, and pollution is a 80×80 texture.
- **Terrain** comes from a seed (`src/terrain.ts`), so the main thread and the worker generate the same river.
- **Save format:** header with the seed, RLE tiles, then the road network at 5 bytes per node and 9 per
  segment, base64url-encoded into `#c=...`.

## Develop

```bash
npm install
npm run dev
```

Three tools play the scenarios headlessly, by running the real simulation worker in Node:

```bash
npm run playtest   # play every level as found and with scripted fixes, and check it is solvable
npm run settle     # how long each level's jam takes to form, which sets its warm-up
npm run seeds      # find map seeds with the terrain a new level needs
npm run calibrate  # what load the sandbox's own demo city runs at, to size a new level against
```

`npm run playtest` is the one that matters when touching a level or the simulation: it flags any
level that already meets its goals untouched, that no affordable fix can solve, or whose par is
under the cheapest fix known to work.

`npm run build` writes a static site to `dist/`. Pushing to `main` deploys it to GitHub Pages via
the workflow in `.github/workflows/deploy.yml`.

## Not in it

Terrain height, public transit, individual citizens, districts and policies, disasters, sound, and
mobile controls.

MIT license.
