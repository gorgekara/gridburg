# Gridburg

A tiny 3D city builder that runs in a browser tab. The only thing that matters is traffic.

Draw roads, paint residential / commercial / industrial zones, and the city grows on its own.
Cars commute from homes to jobs over the roads you laid. Roads turn red where they jam.
The score is **average commute**, so it is really a game about designing a street grid that flows.

**Play:** https://gorgekara.github.io/gridburg/

## Controls

| Input | Action |
| --- | --- |
| Left drag | Use the selected tool. Roads follow the drag (straight, L-shaped, or 45° diagonal); zones and bulldoze fill a rectangle |
| Right drag | Rotate |
| Middle drag / WASD / arrows | Pan |
| Wheel | Zoom |
| 1–6 | Road, Avenue, Residential, Commercial, Industrial, Bulldoze |
| Space | Pause |
| H | Help |

Avenues are wider and faster, hold more cars before they jam, and cars prefer them.
Buildings only grow on zoned tiles that touch a road. Demand depends on the balance of homes and jobs,
the tax rate, and how long commutes take. The city autosaves in your browser, and **Share** copies a
link that contains the whole city (a few KB in the URL hash).

## How it works

- Vite + TypeScript + [three.js](https://threejs.org/), no UI framework.
- The simulation (growth, economy, pathfinding, car movement) runs in a Web Worker at 30 Hz and
  posts car positions as a `Float32Array` each step; the main thread interpolates between frames.
- Roads, buildings, zones and cars are all `InstancedMesh`, so the whole city is a handful of draw calls.
- Roads live on a tile grid with explicit 45° diagonal links. They render as instanced "spokes" from
  each tile center toward every connected neighbor plus a center disc, which gives rounded corners,
  end caps, and clean junctions from three meshes.
- Buildings are procedurally generated geometry (gable roofs, windows, awnings, chimneys, tanks),
  four variants per type and level, oriented to face their road.
- Cars pathfind with A* over the 8-connected road graph, slow down on crowded tiles, and the tile
  congestion tints the road from gray to red.
- Save format: RLE of `(kind << 4 | level)` per tile plus an RLE stream of diagonal links,
  base64url-encoded into `#c=...`.

## Develop

```bash
npm install
npm run dev
```

`npm run build` writes a static site to `dist/`. Pushing to `main` deploys it to GitHub Pages via
the workflow in `.github/workflows/deploy.yml`.

## What is deliberately not here

Freeform curved roads, terrain, water, services, transit, individual citizens, districts, disasters, sound,
mobile controls. Those are cut so the traffic loop stays the whole game.

MIT license.
