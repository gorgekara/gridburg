# Gridburg

A small 3D city builder that runs in a browser tab. The thing that matters most is traffic.

Everyone arrives by the highway at the edge of the map. Draw roads out from it, zone beside them, and the
city grows on its own. Cars commute over your roads and queue for real, so busy junctions jam until you
fix them. Keep the lights on, the water clean, and the factories away from the houses.

**Play:** https://gorgekara.github.io/gridburg/

## What is in it

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

`npm run build` writes a static site to `dist/`. Pushing to `main` deploys it to GitHub Pages via
the workflow in `.github/workflows/deploy.yml`.

## Not in it

Terrain height, public transit, individual citizens, districts and policies, disasters, sound, and
mobile controls.

MIT license.
