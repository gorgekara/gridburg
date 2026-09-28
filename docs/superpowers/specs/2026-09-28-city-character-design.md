# City character: streets that show what the city is

## Goal

Make any city the player builds feel realistic and interesting. The sim already knows, per tile:
- land value
- crime
- garbage
- noise
- neglect

Today those numbers only show as map overlays. After this, they show on the streets themselves:
- a rich district looks rich
- a rough one looks rough
- a neglected block looks neglected

Rows of buildings read as streets, not clones. Streets have life that changes with the hour. Each
city grows a few places worth finding.

Decisions agreed with the user: every item below, built in four stages, with a commit and in-browser
screenshots after each.

Not in scope:
- vehicles, driving and wanted play
- the demo city layout
- corner buildings with two fronts

## Where it lives

- **`src/render/character.ts` (new):** turns the sim's maps into bands per tile. It is pure and has
  no three.js, so it can be tested headless.
- **`src/render/dressing.ts` (new):** the neighbourhood dressing drawn into a street-detail chunk:
  graffiti, shutters, bin bags, planters and the rest. It takes the `Kit` and a small context.
  `streetDetail.ts` is already about 1,900 lines, so new props go here, not there.
- **`src/render/landmarks.ts` (new):** plazas, clock towers and the waterfront promenade. It is
  always visible, rebuilt like the verge gardens.
- **`streetDetail.ts`:**
  - calls into `dressing.ts` from `road()` and `lot()`
  - `DetailSource` gains `bands`
  - the chunk signature hashes the bands
- **`buildings.ts`:**
  - per-instance tint and seed attributes
  - shader changes for tint, window variation and night shutters

## Stage 1: neighbourhood character

### Bands (`character.ts`)

`bandsOf(maps, neglect, kind, level) → Bands`. `Bands` holds four `Uint8Array`s of `N_TILES`.

- **`wealth`** 0 (poor), 1 (ordinary), 2 (well-off), 3 (rich), from land value.
  - Cut points: < 60 poor, < 115 ordinary, < 150 well-off, else rich. They are tuned so the demo city
    shows all four.
- **`rough`** 0, 1 or 2.
  - 2 when crime ≥ 60 or neglect > 0.
  - 1 when crime ≥ 25.
  - Otherwise 0.
- **`litter`** 0, 1 or 2, from garbage: ≥ 40 is 1, ≥ 110 is 2.
- **`loud`** 0 or 1, from noise ≥ 90.

The maps are smoothed before banding: each tile takes the mean of its 3 × 3 neighbourhood. That way
one hot tile does not make a lone graffiti island.

**Hysteresis.** A tile only changes band when the value crosses the cut point by a margin: 8 for land
value and crime, 10 for garbage and noise. `bandsOf` therefore takes the previous `Bands` and keeps a
tile's band while it is inside that margin. As a result:
- chunk signatures stay stable while numbers drift inside a band
- chunks rebuild only when a neighbourhood actually changes character

When there are no maps yet (a fresh city before its first state message), every tile is ordinary
(`wealth` 1, all else 0), which gives exactly today's look.

`main.ts` recomputes bands on each state message that carries maps and hands them to the street
detail through `DetailSource`.

### Signature

`StreetDetailLayer.signature` also mixes in the bands of every cell it already hashes:
`wealth + 4·rough + 16·litter + 64·loud`.

### What each band draws (`dressing.ts`)

All of it goes into the street-detail chunk, so it is seen at street level and in the close overview.
Placement uses the chunk's seeded random stream, so the same street always looks the same.

**Wealth 3 (rich):**
- Street trees in iron grilles, two per lot. They go in the forecourt where there is one, otherwise on
  the pavement along the building line where it is at least 0.2 wide.
- Stone planters with clipped box balls beside doors of shops, offices and flats.
- Flats get a doorman canopy: a dark awning out to the kerb on two brass posts, and a mat.
- Houses get a clipped hedge along the front and gate piers at the path.
- Pavement litter drops to a quarter of today's.

**Wealth 2 (well-off):**
- One tree in a grille on half the lots.
- Planters at half the rate.
- House hedges at half the rate.

**Wealth 1:** today's look.

**Wealth 0 (poor):**
- Twice the pavement litter.
- A cracked pavement slab now and then.
- Weeds in the kerb joints.
- House front gardens swap flower boxes for bare earth and a wheelie bin.

**Rough 1:**
- Graffiti tags on the walls of about 30% of lots. Tags are flat coloured scribbles made of a few
  quads each, on the side and front walls up to 0.15 high. They are drawn with `Body`, so they stay
  on the wall.
- Now and then, a shop with its roller shutter half down.

**Rough 2:**
- Graffiti on 60% of lots.
- Shops shuttered by day at 25%. A shuttered shop shows a ribbed grey roller shutter over its front,
  with tags on it.
- Boarded windows (plywood rectangles) on 20% of flats and houses.
- Chain-link fences instead of hedges and low walls round house lots and empty lots.
- A broken streetlight: the streetlight layer skips its bulb and glow on 30% of lamps in rough-2
  tiles. This is visible at night from anywhere, because the streetlight layer takes the bands too.

**Litter 1:**
- Two or three black bin bags at the kerb in front of about 40% of lots.

**Litter 2:**
- Piles of 4–7 bags in front of most lots.
- A skip on one lot in five, with rubbish in it.
- Scraps of litter on the pavement at three times today's rate.

**Loud 1:**
- Lots whose back faces a motorway get a tall timber acoustic fence along it.

## Stage 2: buildings that read as a street

### Terrace runs

A zoned building's variant is today `tileHash(i)`. For houses and low flats (level 1–2 residential)
with road access, the variant instead comes from a hash of:
- the segment the lot fronts
- which side of it the lot is on
- `floor(s / 3)` along it, where `s` is the lot's position along the segment

The bucket length 3 is chosen so runs of about three plots match, like a developer's row.
- `raster` already knows each lot's access segment and point (`accSeg`, `accX`, `accZ`).
- `s` comes from projecting the access point onto the segment.

The street detail uses the same function (it has to match the building's `Body`), so the variant
choice moves into one exported helper, `lotVariant(i, kind, level, raster, net)`, in
`buildings.ts`. Both callers use it.

### Per-building tint

Each zoned building gets its own wall tint, a factor near 1:
- one channel pair shifted ±8%
- brightness ±10%

It comes from a hash of the tile, except that houses in the same terrace run share a tint, because a
row is painted alike.

**Wealth** also pulls the tint:
- rich lots shift toward cream and brick
- poor lots toward grey, darkened 6%

Buildings are drawn with baked vertex colours, and the lit-window shader recognises window glass by
its exact colour. Three's `instanceColor` would multiply those colours and break the recognition, so
it is not used. Instead:
- a custom `aTint` (vec3) instance attribute
- the fragment shader multiplies the diffuse colour by `aTint`, except where `windowMask` or
  `officeMask` is set

### Window variation

A second instance attribute, `aSeed` (float).
- The vertex shader passes the world position of each vertex.
- For a pane, the fragment shader hashes `floor(worldPos × 12)` with the seed, which gives a per-pane
  random `r`.
- A pane glows when `r < occupancy(hour)`.

`occupancy(hour)` is a uniform (`cityLit`) that `main.ts` sets from the city clock:

| Glass | Evening peak | Dusk | Night | Small hours |
|---|---|---|---|---|
| Homes (warm) | 0.85 at 19–22 h | 0.5 | 0.35 at 23–1 h | 0.12 at 2–5 h |
| Offices (cool) | 0.9 at 17–19 h | | 0.25 after 21 h | 0.08 at 1–5 h |

Two things follow:
- windows switch on through dusk instead of all at once
- every building's pattern differs

### Shop under flats

Mid-rise flats (residential level 2–3) whose street segment also fronts a commercial lot within 2
cells get a shop on the ground floor. The street detail draws it on the front wall:
- a shopfront band 0.12 high
- a coloured fascia and awning
- a lit display strip that glows at night, drawn in the shop's own `WINDOW_LIT` colour so it picks up
  the existing shader glow

## Stage 3: street life

- **Café seating by the hour.** Shops that already set out café tables (`shop()`) now:
  - add sun umbrellas on rich and well-off streets
  - add a few seated figures by day
  - stack the chairs at night

  Stacked chairs are a separate, cheap draw. The chunk signature includes a day/night bit so chunks
  rebuild at the change.
- **Market stalls.** On commercial avenues and roads where 3+ consecutive lots are commercial level
  2–3, a row of 3–5 striped market stalls stands along the kerb by day (08–18 h), with crates of
  produce. At night there are bare stall frames.
- **Food trucks.** Beside office lots on avenues, one food truck per ~4 office lots, 11–15 h, with
  a small queue of two or three figures.
- **Delivery vans at shops.** A parked delivery van, with its rear doors open and a trolley of
  boxes, stands on the kerb outside one commercial lot in six, 06–11 h. It is a static prop from the
  existing van geometry; the traffic sim is not involved.
- **Scaffolding on buildings growing.** A lot whose level rose in the last ~2 game days gets
  scaffolding up its front, with a green debris net, for a while.
  - Needs `levelChanged: Uint32Array` (the tick of the last level change), kept in `game.ts` from
    the state messages.
- **Night shutters.** Shops pull roller shutters down 22–07 h, drawn as the same ribbed shutter as
  rough 2. Late places stay open: leisure, and 1 in 5 shops (a hash).
- **Neon.** Signs on commercial level 2–3 and leisure lots at night: a coloured neon outline above
  the door.
  - It uses a third emissive key (a new `NEON` colour the street-detail material recognises). The
    street-detail material gets the same `onBeforeCompile` night patch as buildings, for `WINDOW_LIT`
    and `NEON`.
  - The house door lamp (`houseFront`) and the verge lamps change to `WINDOW_LIT`, so they glow too.

**Time bands.** The chunk signature gets a 3-bit time band from the city hour: night, early, morning,
midday, afternoon, evening. Only chunks in reach rebuild when it changes, over a few frames within
the existing 5 ms budget. The city clock is fast (a day is 480 s by default), so a band lasts about
80 s: rebuilds are occasional.

## Stage 4: landmarks

`LandmarkLayer` in `landmarks.ts`:
- merged meshes in 16 × 16 chunks
- rebuilt when the network, kinds, levels or wealth bands change
- always visible

It draws:

- **Civic plaza.** Garden (verge) tiles with wealth ≥ 2, and with at least 5 built level-3 zone lots
  within 3 cells, become a paved plaza:
  - stone paving with a border
  - a central fountain (two tiers with water discs) or a statue on a plinth, by hash
  - four trees in grilles, benches and lamps

  The verge layer skips these tiles. `gardenTiles` gets a `skip` set from the landmark layer.
- **Clock tower.** One per district, or one for the whole city when there are no districts. It goes
  on the garden tile with the highest smoothed land value × density score in that district that is
  at least 6 cells from any other clock tower, and it needs at least 20 built lots in the district.
  - The tower: a stone shaft about 1.4 high, a clock face on all four sides, a belfry and a copper
    spire.
  - The hands show the city time. They are two small separate meshes, turned each frame.
  - The clock faces glow at night (`WINDOW_LIT`).
- **Waterfront promenade.** Shore tiles that touch a built zone lot or a road get:
  - a paved walk along the water's edge
  - a railing on posts
  - benches every ~1.2 facing the water
  - lamps every ~1.5 that glow at night

  These are stretches of real quayside rather than reeds. The street detail's `shore()` reeds are
  skipped on those tiles.

Every landmark counts as a garden for the rest of the game. It takes no tile kind and costs
nothing. It is pure dressing.

## Performance

Budgets:
- The street detail keeps its per-frame build budget (5 ms) and reach.
- Triangles per fine chunk may grow by at most 35%. This is measured with the existing
  `streetDetail.stats` on the demo city.
- The building shader adds one hash per pane pixel and one multiply.
- Landmarks are a few thousand triangles per city.

Target: the demo city in street view and on the map keeps within 10% of today's frame time,
measured in the preview with the debug stats.

## Testing

`tests/character.mjs` (new), added to `tests/all.mjs`. It covers:
- `bandsOf` cut points
- smoothing: a single hot tile does not flip its neighbours
- hysteresis: a value inside the margin keeps its band; crossing the margin changes it
- no maps: every tile is ordinary
- `lotVariant`: three consecutive plots on one side of a segment share a variant, and the other
  side differs by hash
- the time band from the hour
- the clock-tower picker: the best score wins, and the spacing is respected

## Verification in the browser

Each stage, in the preview, on the demo city:
- street-view screenshots of a rich street, a rough street and a littered street
- a night street
- a view from above showing tints and window variation at dusk
- the debug stats for chunk triangle counts and frame time, before and after
