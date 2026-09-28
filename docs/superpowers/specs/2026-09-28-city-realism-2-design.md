# City realism, round 2: weather, smoke, crowds, fronts, roads, cars

## Goal

This round follows `2026-09-28-city-character-design.md`. The city should feel real from the map
and from the pavement. What still reads as fake:
- the weather never changes
- nothing smokes or steams
- people are spread evenly over every street at every hour
- shops are generic
- walls are spotless
- roads look freshly laid
- work never happens on them
- traffic is one car shape

Decisions agreed: the user asked for all of it. Built in six stages, with a commit and in-browser
screenshots after each.

## Stage 1: weather

- **`render/weather.ts` (new), pure:** `weatherAt(seconds, dayLength) → { kind, rain, cloud, fog, wet }`.
  - Each city day is one of: clear 50%, overcast 22%, rain 18%, fog 10%, by a hash of the day number.
    So the same day always has the same weather, on any machine.
  - The day's kind fades in and out over the two hours either side of midnight, so it never snaps.
  - Rain falls in showers within a rainy day: a slow sine over the hours, with dry spells between.
  - Fog is thickest at dawn and burns off by noon.
  - `wet` rises while it rains and dries over about three hours after.
  - Settings get "Weather: on/off". Off is always clear.
- **The sky** (`scene.light`):
  - cloud dims the sun (to 35% at full overcast)
  - cloud greys the sky and fog colour and lowers the exposure a little
  - fog pulls the fog's near and far planes in (on the map to about 40/110, in the street to 6/40)
- **Rain streaks:** a `LineSegments` of 1,500 streaks in a box round the camera, falling and wrapping,
  sized to the view:
  - in the street, a 6-unit box
  - on the map, a 40-unit box with longer streaks
  - fading with the amount of rain
- **Wet streets:**
  - The road material gets a `wet` uniform: darker asphalt (×0.72), lower roughness (0.95 to 0.35),
    and a faint sky-coloured sheen.
  - The street detail draws puddles on fine chunks when `wet > 0.3`: dark glossy discs in the
    gutters and in the dips of poor streets, twice as many where roads are worn.
  - The chunk signature gets a wet bit.
- **Umbrellas:** when it rains, 70% of the walking pavement crowd carries one (an instanced canopy on
  a stick, in several colours).

## Stage 2: smoke and steam

- **Emitters from the models:** `Builder.emit(x, y, z, kind)` records points in a design, in model
  space, with the facade shift applied, where smoke or steam leaves:
  - factory and power-station stacks (smoke)
  - vents on factory roofs and the tank farm (steam)
  - cooling towers (steam)
  - the chimney of the house with a chimney breast (chimney)
- **`BuildingLayer.rebuild`** turns them into world points per instance: `buildings.emitters`.
- **`render/smoke.ts` (new):** one instanced mesh of soft low-poly puffs, with 1,800 puffs in a pool.
  - Each emitter releases puffs at a rate for its kind. A puff rises, grows, drifts with the wind,
    and fades out.
  - Smoke is grey-brown, steam white.
  - House chimneys smoke only in the evening and at night (18–08 h), and more in bad weather.
  - Factories run by day and at half rate by night.
  - Coal and gas stacks always run.
- **The wind:** a direction and strength from the weather, slowly turning. Rain and cloud bring more
  wind.
- A powered-down building (the sim's `F_NO_POWER` flag) doesn't smoke.

## Stage 3: crowds where people are

- **Pavement walkers** (`pedestrians.ts`) no longer pick a street by length alone. Each street's
  weight is its length × its activity at this hour. Activity is:
  - the lots fronting it (`raster.accSeg`), each weighted by kind, level and an hour profile:
    - shops: 10–20 h, peaking at lunch and 17 h
    - offices: rush hours 8–9 h and 17–18 h, and lunch
    - homes: mornings and evenings
    - leisure: evenings and late nights
  - plus a small floor, so every street sees someone
- **Speed and dress:** walkers on office streets at rush hour walk faster, in darker suits and coats.
- **Bus stops:** 1–5 people wait at each stop, more at rush hour, standing in and beside the shelter.
  - These are static figures, drawn into the street detail, rebuilt with the time band.
- **Park life:** joggers (fast, sporty colours) and dog walkers (a person with a small dog trotting
  ahead) run loops along park paths and the promenade.
  - Separate small pools in `pedestrians.ts` that follow the park-path and promenade polylines,
    lined up as walking routes.

## Stage 4: shopfronts, wear, roofs, houses

- **Shops by trade:** each shop lot gets a trade by hash:
  - café, bakery, pharmacy, bank, barber, florist, grocer, bookshop, hardware, bar
  - The trade chooses:
    - the fascia colour
    - a projecting sign: a pharmacy's green cross, a barber's striped pole, a bank's panel, a
      bakery's loaf and so on
    - the window display
    - what stands out front: flower buckets, crates, an ATM, café tables
  - Pharmacy crosses, bars and banks' signs glow at night (the glow mesh). Shop windows of open
    shops glow at night too.
- **Building wear:** a third building instance attribute, `aWear` (0–1), from:
  - wealth (poor 0.8, ordinary 0.4, well-off 0.2, rich 0.05)
  - roughness and neglect
  - a hash

  The shader, on walls only (not glass, not roofs):
  - darkens a grime band up from the ground (the bottom 0.2 of the height)
  - adds soot streaks down from the roofline: narrow vertical bands by a hash of the world position,
    fading downward
- **Roof colours:** the shader tints upward-facing and steep roof surfaces (normal.y > 0.35) of zone
  buildings by an `aRoof` colour per instance:
  - slate grey, terracotta, brown tile, weathered green or charcoal, by hash
  - a terrace run shares one
  - flat roofs (normal.y > 0.95 on towers) keep their grey
- **Houses:**
  - garages with an up-and-over door, open now and then with a car nose or bikes inside
  - satellite dishes and solar panels on rich roofs
  - hanging baskets by doors
  - a car on the driveway, which the parked-car layer already does (left as is)
  - bins out at the kerb on bin day (one weekday by hash per street)
  - Christmas lights are out of scope

## Stage 5: roads, road works, bridges

- **Road wear** (street detail, fine chunks):
  - darker wheel tracks along every lane
  - more patches, cracks and potholes on poor and rough streets, and on busy avenues
  - fresh black asphalt with crisp markings on one segment in eight (a hash): recently resurfaced
  - faded markings on poor streets: pale grey overlays on the centre lines
- **Road works:** one segment in fourteen (a hash, changing every few game days) has works on it.
  - A works zone along one kerb:
    - a dug trench with spoil
    - red-and-white barriers and cones in a taper
    - a "Road works" sign ahead at each end
    - a portable traffic light
    - a mini digger
    - a site van
  - Workers in hi-vis, by day only.
  - Where the street has a parking lane the works stand in it; otherwise on the pavement, with a
    pedestrian walkway round.
  - Purely visual: the traffic is not affected, so the works never stand in a traffic lane.
- **Bridges** (`roads/structures.ts` geometry):
  - expansion joints across the deck at each pier: a steel strip
  - drainage spouts under the parapet
  - streaked concrete below the deck edge (vertex-colour bands)
  - piers with a darker splash zone at the waterline over water
  - the parapet lamps get a glow head lit at night
- **Kerbside utility boxes and bollards** at junctions: grey cabinets and a few bollards at corners.

## Stage 6: cars

- **Traffic cars** (type 1) take one of five body shapes by their uid: sedan, hatch, wagon, muscle or
  super, weighted towards hatch and sedan.
  - Instanced meshes per shape, all as type 1. The worker is not touched.
- **Parked cars follow wealth:**
  - more wagons and supers on rich streets
  - older hatches on poor ones, with duller paint (desaturated)
- **Headlight pools at night:** a soft additive oval on the road ahead of each moving car, like the
  streetlight pools, in one instanced mesh.
- **Wet roads:** headlight pools are longer and brighter, and rain darkens car paint a touch.

## Performance

Budgets:
- Street-detail triangles per fine chunk up by at most another 30% on the real demo.
- Rain and smoke each a single draw call.
- Weather adds no per-chunk rebuilds beyond the wet bit.

## Testing

`tests/realism.mjs` (new), added to `tests/all.mjs`. It covers:
- **Weather:**
  - determinism (the same day gives the same weather)
  - the share of each kind over 1,000 days is within ±5% of the target
  - fog peaks at dawn
  - wet lags the rain
- **Emitters:** a design with stacks has emitters above its roof; a house without a chimney has none.
- **Crowd weights:** a street lined with shops outweighs a quiet one at noon, and loses to homes at
  21 h.
- **Trades:** every shop gets a trade, and each trade appears.
- **Road works:** works never touch a traffic lane.
- **Car shapes:** every shape appears among the uids.

Each stage is also checked in the preview, with screenshots.

## As built

The plan above was followed, except where noted here.

- **Weather:** fog pulls the far plane in to 110 on the map and 38 in the street (near planes 30 and
  4). Rain streaks are sized to each view: 0.045 long in a 1.4 box in the street, 0.35 in a 9 box on
  the map.
- **Smoke:**
  - Also comes from gas-plant stacks and the crematorium, as a faint haze.
  - Three of the six house designs have a chimney breast and pots, not one.
  - The 260 emitters nearest the camera run at once.
- **Crowds:** joggers and dog walkers pick streets beside parks rather than following the park-path
  polylines. On the demo at noon, shopping streets are 8% of street length and carry 19% of the
  walkers.
- **Houses:** solar panels and dishes on rich pitched roofs were not built; the existing roof and
  wall clutter stays as it was.
- **Roads:**
  - Faded centre markings on poor streets were not built: overlaying the road mesh's paint is fragile.
  - Bridges got joints, spouts and lit lamps, but no splash zone or streaked soffit.
  - Street cabinets and corner bollards stand at about half the junctions.
- **Road works** are placed by `roadWorksOn` (street detail), tested to stay out of the traffic lanes.
- **Cars:** rain doesn't darken car paint. Parked cars take their body and paint from the street's
  wealth band.
