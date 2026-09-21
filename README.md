# Gridburg

A small 3D city builder that runs in a browser tab. The thing that matters most is traffic.

Your city starts at a highway connection at the edge of the map. Draw roads out from it, zone beside them, and the
city grows on its own. Cars commute over your roads and queue for real, so busy junctions jam until you
fix them. Keep the lights on, the water clean, and the factories away from the houses.

**Play:** https://gorgekara.github.io/gridburg/

## What is in it

- **A main menu.** Continue your saved city, start a new one, load the demo, or change settings.
  The HUD menu button reopens it in game and pauses. Settings cover shadows, day length, autosaving and the
  infinite money cheat, and they persist in the browser.
- **Six silhouettes per building type.** Shops, blocks, offices and towers come in six shapes and
  palettes each, from two-storey brick parades to glass towers, so a commercial street is a mix of
  heights and colours rather than a wall of the same block. Offices and towers carry a company logo,
  and after dark their floors light up in cool white alongside the warm windows of homes.
- **Seeded river valleys.** Every seed lays out a different river, hills and highway entry, and you
  can type a seed in when starting a city.
- **Freeform roads, placed with clicks like Cities: Skylines.** Straight (two clicks), Curved (start, bend,
  end) or Smooth (every click continues the road as a flowing curve). Crossings become junctions
  automatically, endpoints snap to existing roads, and roads over water become bridges.
- **Four road types.** Lanes ($14/cell, one shared carriageway), streets ($25, two lanes), avenues
  ($180, four lanes) and expressways ($430, six lanes, fastest, but nothing can be zoned along them).
  Every kind sits inside its corridor with a verge either side. Upgrade widens a road one step and
  charges the difference; keep clicking and it wraps back to a lane. City entrances arrive on
  expressway, so the first street has to be drawn from the end of it.
- **More traffic control.** Signals and roundabouts, plus all-way stop signs ($60 a junction) and
  traffic calming ($45/cell) that halves a street's speed and all but ends collisions on it.
- **Turn a building before you place it.** Right-click, press G, or use the Rotate button in the tool
  panel. Rectangular sites like the railway station turn with it, and the facing is saved.
- **Robberies, street racing and helicopters.** From City level a robbery occasionally hits a shop or
  office; the nearest police station answers the alarm, and a crew that is left alone for ninety
  seconds gets away with $1,200. After dark, street racers run long routes across town at speed.
  Helicopters circle overhead and drift across to whatever is going on.
- **Alleys.** A building standing behind the row that fronts the street gets a service alley out to the
  curb, threaded between its neighbours. Fire engines and patrol cars answer calls there as usual.
- **Dry land only.** The river is drawn a little wider than the tile mask that decides what is water, so
  the strip either side counts as shore: nothing may be zoned or built there and no empty lot fills in.
  Waterside works are the exception — a pump, an outlet or a treatment plant belongs on the bank.
- **City messages.** Problems gather behind the bell in the top-right corner with a count; each new one
  pops out for a few seconds, clicking the bell lists everything outstanding, and clicking a message
  takes the camera to what it is about.
- **Traffic management.** Signals, one-way streets, and roundabouts. Uncontrolled junctions let one car
  through at a time; signals move a whole approach at once; roundabouts never stop. A ring takes its
  size from the widest road that meets it, from a 1.7-cell lane circle to a 4-cell expressway one.
- **Multiple highway entries.** The starting entry is free; Small town unlocks new $3,500 entrances on clear map edges. Each adds a seven-cell avenue. Any entry can serve its connected neighborhoods, and regional drivers choose a reachable entrance.
- **Traffic from outside arrives by road.** Every entrance carries on sixteen cells past the map edge.
  Regional traffic is created and retired out there and drives in, so cars never appear on the doorstep and
  the queue to leave forms off the map instead of across the entrance.
- **City policies.** Six standing decisions — recycling, smoke alarms, neighborhood watch, study grants,
  free public transport and a congestion charge — each paid for every second, with a bill that grows with
  the city. They change pollution, incidents, school reach, transit ridership and how many people drive.
- **Bigger services as the city grows.** A 2 x 2 hospital at Thriving town and a 3 x 2 city hospital at
  Regional capital extend healthcare well past a clinic's reach; police headquarters at City covers a
  wider district and keeps two patrol cars out at once.
- **Parks for every size of city.** Neighborhood parks from the start, playgrounds at Growing village,
  a two-cell sports field at Thriving town and a three-cell city park with a pond at City.
- **Railways that connect themselves.** Two stations link up by elevated track along the road
  corridors, and a station within thirty cells of a city entrance also runs a service out of town, so
  some people arrive and depart by train rather than by road.
- **Route maps.** Picking a transport tool lights up that mode's lines through the streets, its stops
  and a marker running each route, the way the metro tool shows its tunnels.
- **Service coverage at a glance.** Selecting a service paints the area existing buildings of that sort
  already reach, so the next clinic, station or bus stop goes where the gap is.
- **Utilities along roads.** Wind and coal power, water towers and river pumps, sewage outlets. Buildings
  need all three to grow past small. Outlets foul the river downstream, so pumps belong upstream.
- **Pollution.** Industry and coal pollute the ground around them. It spreads, drives residents away, and
  spoils water towers. Press P to see it.
- **A different river every map**, generated from a seed that is stored in the save.

## City progression and neighborhood services

Grow from Settlement to Metropolis through seven permanent city levels, at 0, 120, 400,
900, 1,800, 3,500 and 6,500 residents. Each new milestone grants money once and unlocks
services. The level chip in the top-left corner carries your level and happiness; click it for the
roadmap and live service coverage.

Eight new buildings have distinct models and ongoing costs: neighborhood parks, medical
clinics, elementary schools, fire stations, police stations, recycling centers, universities,
and solar farms. The Services menu shows capacity, range and unlock requirements; the green
ring previews the area served before placement. Solar farms are in Electricity.

Services share their capacity among nearby residents, and both ends must connect to the
highway. Coverage, pollution, utilities, taxes and commuting influence happiness and housing
demand. From Growing village, homes need healthcare and education to upgrade to apartments.
High-rises unlock at Thriving town; residential towers also need fire protection, public
safety, waste collection and recreation. Fire and police provide coverage and growth benefits, and dispatch vehicles to incidents and patrol destinations.

Railway stations connect to each other automatically. A station near a city entrance also runs a line
out of town, which runs off the map beside the highway and carries a share of the people who would
otherwise drive in and out, earning fares. The demo city includes the new services. Existing v3 local saves and share links still load;
new v6 saves preserve earned milestones, service funding, loan balances, decline timers, active fires, crime and recent patrol protection.
Versions 4 and 5 also migrate automatically. Old cities inherit
the milestone matching their current population without collecting past grants again.

## City view and emergency activity

One bar along the bottom of the screen carries everything: zone demand and utility meters on the left,
the build categories in the middle, and the city clock and speed controls on the right. Tool panels open
above it. At night vehicles show their own lamps; they no longer wash the road with headlight beams, so streetlights carry the lighting. Zone colors appear only while the Zones menu is selected. Roads use normal asphalt by default; the traffic button in the top-right corner toggles congestion shading independently. Signals are 28% smaller and road vehicles are 32% smaller.

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

The policies button in the top-right corner opens the city's standing policies. Each costs a fixed
amount per second plus a share for every resident, unlocks at a city level, and is saved with the city.
Recycling cuts industrial pollution by 40%, smoke alarms cut fires by 55%, neighborhood watch slows
crime by 40%, study grants stretch schools 30% further, free public transport moves far more commuters
but ends fare income, and the congestion charge removes a quarter of car commutes and tolls the rest at
the cost of a few points of happiness.

The treasury opens a detailed budget with tax revenue, congestion charge income, road upkeep, service
upkeep, policy costs and loan payments. Nine funding sliders range from 50% to 150%. Upkeep scales directly; capacity has
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
square and an avenue a three-square corridor, matching the squares zoning uses. An avenue
costs $180/cell and three times a road's upkeep, for the three tiles it takes. Tile buildings
stay aligned inside their cells, facing the nearest cardinal direction. Connections to existing
roads take priority, so curved roads and older saves retain their original geometry.

## Controls

| Input | Action |
| --- | --- |
| Left click | Place road points, signals, roundabouts and service buildings |
| Left drag | Zone or bulldoze a rectangle (a drag also lays a single road) |
| Right click / Esc | Stop laying a road; Esc again puts the tool away, closes panels and clears the inspection |
| Right drag, Q / E | Rotate |
| WASD / arrows, middle drag | Pan |
| Wheel | Zoom |
| I | Inspect a building and its growth requirements |
| L, R, V, X | Lane, Road, Avenue, Expressway |
| + / − | Raise the road to a bridge, lower it to a tunnel |
| K, J | Stop signs, traffic calming |
| G, right click | Turn the building in hand before placing it |
| U | Upgrade a road one step wider |
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

Player terraforming, individual citizens, per-district rules, large-scale disasters, sound, and
complete mobile controls. Policies apply to the whole city. Hills are scenic; the construction grid remains level.

MIT license.

## Road construction

Bridges and tunnels are not separate tools: pick any road and change its height. **+** raises it to a
bridge, **−** lowers it to a tunnel, and the Height control in the Roads panel shows where you are.
Any kind of road can be raised or buried, so an avenue viaduct or an expressway tunnel is a matter of
drawing it at that height. Allow at least 14 cells and two clear, dry ends for the automatic ramps.
A tunnel shows its portals above ground at each end, and a dark band with pale ticks marks the ground
over the bore, so the route is legible without opening the underground view.
A surface road crossing water still becomes a bridge by itself. Spans connect at their ends and pass
crossing roads without a junction; Upgrade widens one a step. Structural cost and upkeep are 3× for
bridges and 4× for tunnels. Surface zoning cannot use a bridge or tunnel as frontage; underground
interiors leave the surface available for building.

Bridge/tunnel spans must be removed with Bulldoze and redrawn to change their shape; their ends remain at ground level. Cyan dashes show underground routes while road tools are selected. Saves from versions 3–6 still load.
