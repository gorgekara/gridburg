# Gridburg

A small 3D city builder that runs in a browser tab. The thing that matters most is traffic.

A motorway runs across the edge of every map, one carriageway each way, with two interchanges already built. Draw
roads out from an interchange, zone beside them, and the city grows on its own. Cars commute over your roads and queue for real, so busy junctions jam until you
fix them. Keep the lights on, the water clean, and the factories away from the houses.

**Play:** https://gorgekara.github.io/gridburg/

## Streets and custom parks

- Ordinary surface junctions have pedestrian crossings. Roundabout islands have flower beds, trees and fountains; the river has translucent shallows over a gravel bed.
- **Roads → Bike lanes** upgrades a surface street or avenue for $12 per cell. Click again to remove. Bike lanes sit outside motor lanes; narrow lanes, expressways, structures and roundabouts are excluded. Cyclists ride the tracks in both directions; they are scenery rather than simulated trips.
- **Parks** lets you compose parks from paths, lawns, plazas, ponds and kiosks. Drag paths, lawns or plazas to paint; paths join neighbouring pieces automatically. **Decorations** adds trees, flowers, benches and fountains. Pieces can be rotated, replaced or bulldozed and are saved with your city. Connect walkable park pieces to a road to activate nearby amenities' recreation coverage. Kiosks are recreation amenities rather than commercial zones.
- **Transport → Trolleybus stop** creates electric road transit between operating stops on connected surface streets and avenues. Stops need utilities and two-way routes. Overhead wires follow the routes, trolleybuses obey traffic, and ridership appears in the overview. Narrow lanes, expressways, roundabouts, bridges and tunnels cannot carry trolley routes.
- Airports reserve a one-cell perimeter and three-cell-wide flight corridors extending twelve cells beyond either runway end. Rotate an airport to aim its approach. New buildings and zoning cannot obstruct these areas; saved buildings remain intact. Amber placement shading shows the clearance.

## Economy, districts and the wider world

- **Land value.** Every cell has a value from 0 to 100: parks, a river view, transit stops, landmarks and good services raise it; pollution, noise, crime and uncollected rubbish lower it. Better addresses pay more tax, grow faster, and towers need a land value of at least 30.
- **Goods.** Factories and farms make goods, shops and offices use them. The surplus is exported through the city's entrances, intercity rail, docks and the airport (up to their capacity) and earns money; a shortfall is imported, which eats into shop takings and raises industrial demand. Vans deliver round town and lorries carry exports away.
- **Tourism.** Leisure zones, parks, landmarks and the waterfront draw visitors, brought in by entrances, trains and the airport. Tourism appears in the budget and pushes commercial demand up. The **Observation tower** (Parks, from City) is a landmark that draws sixty visitors a minute.
- **Tax per zone.** The budget has a rate each for homes, shops, industry and offices (farms pay the industrial rate, leisure the commercial one), plus a slider that sets them all.
- **Rubbish.** Buildings put out rubbish every second. Recycling centres send garbage trucks to the fullest bins nearby; rubbish nobody collects lowers land value, and at its worst knocks buildings down a level.
- **Deathcare and post.** Cemeteries, crematoria and post offices (Services, from Thriving town). Once the city is a City, new towers need 30% deathcare and post coverage.
- **Power and water follow the roads.** Each connected road network shares only its own power plants, pumps and outlets, so a neighbourhood cut off from the grid goes dark.
- **Districts.** Paint up to eight named districts (Districts menu) and give each its own policies: high-rise ban, quiet streets, green district, tourist quarter, tax break or neighbourhood watch. Local policies are billed per building.
- **Land.** Dig out ponds and inlets, or fill in the river bank to make building land (Land menu). The river always keeps a channel at least two cells wide.
- **Disasters.** From Small town, the river occasionally floods the low ground beside it and tornadoes cross the valley, knocking buildings down a level or two. Flood barriers on the bank protect everything within seven cells. Switch disasters off in Settings.
- **Map views.** Land value, well-being, noise, crime, rubbish, districts and flood risk, from the layers button.
- **Statistics.** Charts of population, treasury, income, happiness, land value, visitors and demand since the city was loaded.
- **Undo.** Ctrl+Z (or the undo button) takes back the last edit and refunds it, up to thirty steps.
- **Saved cities.** Save and load named cities from the menu, beside the autosave.
- **Achievements.** Twenty-two, from the first family moving in to a World city, remembered in this browser.
- **Two more milestones.** Megalopolis at 10,000 residents and World city at 15,000, each with a grant.
- **Scenarios.** Rust belt revival, Gridlock, Flood plain and Tourist trap: a prepared city, goals to meet together and a deadline in days.
- **Sound.** A city hum that follows the traffic, birdsong by day and crickets at night, sirens while emergency services are out, building and bulldozing cues, an engine when driving and footsteps when walking. All synthesised; toggle it from the speaker button.
- **Touch.** On phones and tablets one finger pans and two pinch and turn (one finger draws while a tool is in hand), and walking and driving get an on-screen joystick.

## What is in it

- **A main menu.** Continue your saved city, start a new one, load the demo, or change settings.
  The HUD menu button reopens it in game and pauses. Settings cover visual detail (Low, Balanced or High), shadows, day length, autosaving and the
  infinite money cheat, and they persist in the browser. Visual detail changes apply immediately: Low simplifies buildings, trees and vehicles; Balanced keeps moderate detail; High adds shutters, flower boxes, roof seams, balconies, roof terraces, shop displays, denser foliage and vehicle trim.
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
  charges the difference; keep clicking and it wraps back to a lane. Extra city entrances arrive on
  expressway; the map's own motorway comes with interchanges to build from.
- **A motorway across the map.** Every new map has a motorway running its full length just inside the
  roomier edge: two one-way carriageways side by side, traffic arriving from both ends. Two diamond
  interchanges come with it — slip roads to the inner carriageway and flyover ramps to the outer one,
  meeting at a street node the city grows from. The motorway and its interchanges cannot be bulldozed
  and cost nothing to keep. Helicopters take to the air once the town is a City.
- **Highways the Cities: Skylines 2 way.** Besides the two-way expressway there is a **one-way highway**
  ($240/cell, three lanes) and a **highway ramp** ($110/cell, one lane). Both run in the direction you
  draw them: lay one carriageway, then the other beside it, and join them to the streets with ramps.
  Start a ramp on a highway for an exit, end it on one for an on-ramp, and press + or − while drawing to
  take it over or under the other roads. Where a ramp splits from or joins a carriageway, traffic merges
  on the move instead of stopping at a junction; a level crossing of two highways still takes turns.
  Neither has frontage, pavements or parking. Upgrade turns a ramp into a one-way highway and back.
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
  size from the widest road that meets it, from a 1.5-cell lane circle to a 2.6-cell avenue one; an
  expressway arriving at a roundabout meets an avenue-sized ring rather than a six-lane circle.
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
- **Walk the streets.** Press F, or the walker button in the top-right corner, to step down to street
  level wherever you are looking. W A S D walks, Shift runs, and the mouse looks around (click once to
  capture it). Buildings, gardens and the river stop you, but streets, alleys and parks are open.
  Esc or F takes you back up to the map where you left it. People walk the pavements (more as the
  city grows, fewer late at night), and at street level the kerbs fill with benches, bins, hydrants,
  street trees, bike racks, planters, post boxes, bollards and a shelter at every bus stop. Cars park
  along the kerbs of streets and avenues in front of built lots, half up on the pavement so the lanes
  stay free, and clear of junctions, crossings, roundabouts and bike tracks. You can
  walk up the ramps and over bridges.
- **Drive around town.** Press M, or the car button, to take a car out on the nearest street. W / S
  drive and brake (and reverse), A D steer, Shift for a burst of speed, Space is the handbrake and V
  swaps the chase camera for the driver's seat. Buildings and the river stop you; bridges carry you.
  Esc or M parks it and returns to the map.
- **Fishing docks.** Build them on the river bank (Water menu, from Small town). Each one employs 24
  people, turns its jetty to the water and sends two fishing boats out to work the river and come
  home. The catch sells for up to $2.40 a second per dock, shown as Fishing in the budget, but sewage
  upstream thins it, so an untreated outlet above the docks costs money.
- **Utilities along roads.** Six kinds of power station — wind, solar, gas (from Growing village,
  cleaner than coal), coal, a hydroelectric dam on the river bank (from Thriving town) and a 3×3
  nuclear plant (from Regional capital: 7,000 power and no smoke) — plus water towers and river pumps, sewage outlets. Buildings
  need all three to grow past small. Outlets foul the river downstream, so pumps belong upstream.
- **Pollution.** Industry and coal pollute the ground around them. It spreads, drives residents away, and
  spoils water towers. Press P to see it.
- **A different river every map**, generated from a seed that is stored in the save. Rivers bend on
  every scale, so the channel never runs straight for long; cities saved before this keep the valley
  they were built in.

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

- **Farmland** is open from the start: fields, barns, silos and then greenhouses. It meets industrial demand with a few jobs, no pollution and little power, but the fields drink half as much water again.
- **Leisure & tourism** unlocks at Small town (400 residents): cafés with terraces, boutique hotels and resort towers with a pool. It meets commercial demand and pays more tax the closer it is to parks and the river.
- **Offices** unlock at Thriving town (900 residents) and grow more slowly than other zones: a low block, then a mid-rise, and a tower only once the city is a City (1,800 residents) and the address has a land value of 45. Purple zoning supplies clean jobs and a separate demand meter. Building upgrades require 25%, then 50%, city education coverage.
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
| F | Walk the streets at eye level; Esc or F again to return |
| M | Drive a car around town; V switches to the driver's seat; Esc or M to park |
| U | Upgrade a road one step wider |
| C | Cycle road drawing: Straight, Curved, Smooth |
| O, T, Y | Roundabout, Signal, One-way |
| 1, 2, 3 | Homes, Shops, Industry |
| B | Bulldoze |
| P | Pollution view |
| Ctrl+Z | Undo the last edit |
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

Individual citizens (people and trips are counted, not simulated one by one), a map bigger than 80 × 80
cells, and terraforming of the hills: they stay scenic, and the building grid stays level.

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
