# Gridburg

A small 3D city builder that runs in a browser tab. The thing that matters most is traffic.

Your city starts at a highway connection at the edge of the map. Draw roads out from it, zone beside them, and the
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
- **Multiple highway entries.** The starting entry is free; Small town unlocks new $3,500 entrances on clear map edges. Each adds a seven-cell avenue. Any entry can serve its connected neighborhoods, and regional drivers choose a reachable entrance.
- **Utilities along roads.** Wind and coal power, water towers and river pumps, sewage outlets. Buildings
  need all three to grow past small. Outlets foul the river downstream, so pumps belong upstream.
- **Pollution.** Industry and coal pollute the ground around them. It spreads, drives residents away, and
  spoils water towers. Press P to see it.
- **A different river every map**, generated from a seed that is stored in the save.

## City progression and neighborhood services

Grow from Settlement to Metropolis through seven permanent city levels, at 0, 120, 400,
900, 1,800, 3,500 and 6,500 residents. Each new milestone grants money once and unlocks
services. Click the city progress card for the roadmap and live service coverage.

Eight new buildings have distinct models and ongoing costs: neighborhood parks, medical
clinics, elementary schools, fire stations, police stations, recycling centers, universities,
and solar farms. The Services menu shows capacity, range and unlock requirements; the green
ring previews the area served before placement. Solar farms are in Electricity.

Services share their capacity among nearby residents, and both ends must connect to the
highway. Coverage, pollution, utilities, taxes and commuting influence happiness and housing
demand. From Growing village, homes need healthcare and education to upgrade to apartments.
High-rises unlock at Thriving town; residential towers also need fire protection, public
safety, waste collection and recreation. Fire and police provide coverage and growth benefits, and dispatch vehicles to incidents and patrol destinations.

The demo city includes the new services. Existing v3 local saves and share links still load;
new v6 saves preserve earned milestones, service funding, loan balances, decline timers, active fires, crime and recent patrol protection.
Versions 4 and 5 also migrate automatically. Old cities inherit
the milestone matching their current population without collecting past grants again.

## City view and emergency activity

Zone colors appear only while the Zones menu is selected. Roads use normal asphalt by default; the traffic button in the top-right corner toggles congestion shading independently. Signals are 28% smaller and road vehicles are 32% smaller.

Vehicles reserve their oriented footprint when spawning, moving, and entering a new road segment. Movement is checked along its path, and junction traffic is serialized when paths conflict. Occupied space blocks vehicles; a reused vehicle slot starts a new visual trip instead of interpolating from the previous car.

From Small town onward, random incidents add management pressure:

- **Collisions:** two nearby vehicles stop with a warning and smoke. Police can clear the incident; otherwise recovery releases it after 35 simulation seconds. Vehicle bodies stay separate during the incident.
- **Police patrols:** operating stations dispatch cars to nearby properties. After a visit, the surrounding seven-cell area gets 180 seconds of protection, preventing 85% of attempted crimes. Crime hotspots reduce tax revenue and happiness, and fade over time.
- **Fires:** flames and smoke appear on buildings. Working fire stations dispatch an engine along a real road route. It needs eight seconds at the destination to extinguish the fire. After 120 seconds without help, the building loses a level. Burning buildings stop growing and paying taxes.

Emergency vehicles obey traffic and can be delayed by jams. Each station handles one dispatch at a time. Inspect shows local fire/crime status; city overview reports active patrols, engines, extinguished fires and prevented crimes. Fires, crime pressure and patrol protection survive reloading. Traffic trips and collision scenes restart with the traffic simulation.

## City life and transport

The first visit opens a five-step welcome tutorial explaining the goal (6,500 residents), the first neighborhood, utilities, services and transport. It pauses the simulation, can be skipped, and is available again from Menu → Welcome tutorial. Keyboard help remains available under H.

- **Offices** unlock at Thriving town (900 residents). Purple zoning supplies clean jobs and a separate demand meter. Building upgrades require 25%, then 50%, city education coverage.
- **Buses** unlock at Small town (400 residents). Place stops near homes and jobs. Stops automatically connect to the nearest earlier reachable stop; buses run return trips. Both ends need utilities and a road route in each direction. Walking range is 9 cells, capacity 30 passengers per connection, and congestion reduces throughput.
- **Passenger rail** unlocks at City (1,800 residents). Stations reserve 3×2 cells and connect automatically with elevated tracks along existing road corridors. Trains avoid road congestion, with an 18-cell walking range and 120-passenger connection capacity.
- **Regional airports** unlock at Regional capital (3,500 residents). An 8×3 site contains a runway, terminal and control tower. Operating airports replace some incoming road trips within 24 cells with flights, capped at 240 passengers per minute per airport. Flights and trains are animated; passengers are simulated as aggregate trips.
- **Sewage treatment** unlocks at Small town. The $3,200 river-bank plant handles 2,200 sewage units and filters 95% of its effluent with full electricity. Power shortages reduce filtering. Ordinary outlets remain cheaper but discharge untreated sewage.
- **City overview** reports active transport connections, ridership, air passengers, fares and filtered sewage. Bus and rail fares are $0.08 per trip; air passengers contribute $0.20. Transport operating costs are fixed, shown on the tool cards. Transit currently supports direct connections, without transfers, custom lines or timetables.

Cars, vans, delivery trucks and buses have distinct bodies, windows, wheels and lights. Signals have three lenses, hoods and marked crossings. Factory variants include sawtooth workshops, brick plants with stacks, tank farms and solar-topped warehouses. The expanded demo showcases offices, bus routes, rail and an airport; it begins at an earned Regional capital level.

## Managing a growing city

Click **Inspect** (I), then a building, to see its residents or jobs, local service coverage,
operating costs and exact upgrade blockers. Clicking without a build tool also inspects.
Clicking a roof selects that building, even when it hides another tile behind it.

The treasury opens a detailed budget with tax revenue, road upkeep, service upkeep and loan
payments. Nine funding sliders range from 50% to 150%. Upkeep scales directly; capacity has
diminishing returns (71% at half funding, 122% at 150%). A single $6,000 recovery loan costs
$6,600 total, repaid at $6 per simulation second. Repayment pauses with the simulation and
can be settled early. Private growth on existing zones continues even when city cash is negative.

Civic providers consume 3 power and 2 water/sewage capacity each. Disconnected or unserved
providers stop operating; congestion on their access road reduces civic output by up to 50%.
Disconnected properties no longer pay taxes, and utility shortages halve a property's tax output.

Apartments and towers need ongoing civic coverage. Maintenance thresholds are lower than
upgrade thresholds to avoid constant upgrade/downgrade cycles. An amber marker warns of a
service shortfall; after 180 consecutive simulation seconds the home drops one level.
Restoring coverage clears the countdown. Saving and reloading preserves it.

Narrow curbs meet compatible straight roadside lots. Lot strips move together toward the curb; conflicting shifts are rejected at junctions. Building fronts reach their road-facing lot boundary.

Road endpoints and curve guide points snap to tile centers, so a two-lane road fills one
square and an avenue a three-square corridor, matching the squares zoning uses. Tile buildings
stay aligned inside their cells, facing the nearest cardinal direction. Connections to existing
roads take priority, so curved roads and older saves retain their original geometry.

## Controls

| Input | Action |
| --- | --- |
| Left click | Place road points, signals, roundabouts and service buildings |
| Left drag | Zone or bulldoze a rectangle (a drag also lays a single road) |
| Right click / Esc | Stop laying a road; Esc again puts the tool away |
| Right drag, Q / E | Rotate |
| WASD / arrows, middle drag | Pan |
| Wheel | Zoom |
| I | Inspect a building and its growth requirements |
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
  road are reserved, tiles within three rows of a road can use it, and buildings turn to face their road.
  Straight roadside lots meet narrow curbs; intersecting lot shifts are rejected at junctions.
- **Building variety:** four deterministic designs per zone and level vary height, proportions and roof details.
  Level 2 homes have three to five floors. Designs remain stable across saves and do not change simulation capacity.
- **The simulation runs in a Web Worker** at 30 Hz (`src/sim/worker.ts`): A* routing over the road graph
  with congestion-aware costs, car-following with minimum gaps, junction locks, signal phases, utilities,
  pollution diffusion, growth, and the economy. Cars that are stuck for 30 seconds give up and despawn.
- **Rendering** is a handful of draw calls: the whole road network is one vertex-colored mesh that is
  re-tinted by congestion, buildings and cars are `InstancedMesh`, and pollution is a 80×80 texture.
- **Day and night:** an eight-minute simulation day starts at 09:00. The city clock, sunlight, dusk, moonlight, glowing windows and streetlights follow pause/speed controls and saved city time.
- **Landscape:** seeded hills surround a flat, buildable valley; mixed forests clear around roads and occupied lots. Rivers have irregular banks, moving ripples, rocks and an upstream waterfall with spray. Highway entrances cut clear corridors through the hills. Existing saves retain their river and buildable grid.
- **Save format:** v7 header with the seed and earned city level, RLE tiles, then the road network at 5 bytes per node and 9 per
  segment (including bridge/tunnel flags), followed by a length-prefixed incident snapshot; base64url-encoded into `#c=...`.

## Develop

```bash
npm install
npm run dev
```

`npm test` runs progression, save migration, coverage, geometry and simulation checks (Node 22.18+).

`npm run test:soak` checks 30-minute growth, service withdrawal, live traffic and debt recovery scenarios with seeded randomness.

`npm run build` writes a static site to `dist/`. Pushing to `main` deploys it to GitHub Pages via
the workflow in `.github/workflows/deploy.yml`.

## Not in it

Player terraforming, individual citizens, districts and policies, large-scale disasters, sound, and
complete mobile controls. Hills are scenic; the construction grid remains level.

MIT license.

## Road construction

Roads now includes **Bridge** ($75/cell) and **Tunnel** ($100/cell). Use Straight, Curved or Smooth drawing; allow at least 14 cells and two clear, dry ends for automatic ramps. Normal roads crossing water become bridges. Bridges and tunnels connect at their ends and pass crossing roads without a junction. Upgrade widens a span into an avenue. Structural upkeep is 3× for bridges and 4× for tunnels. Surface zoning cannot use a bridge or tunnel as frontage; underground interiors leave the surface available for building.

Bridge/tunnel spans must be removed with Bulldoze and redrawn to change their shape; their ends remain at ground level. Cyan dashes show underground routes while road tools are selected. Saves from versions 3–6 still load.
