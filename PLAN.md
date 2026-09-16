# Three.js city builder — the plan

Date: 2026-09-16

## 1. The idea, as I understood it

A city-building game that runs in a desktop browser tab with no install and no
account. It uses three.js for a 3D isometric-ish view of a grid city. On day
one you lay roads, paint residential / commercial / industrial zones, watch
buildings grow as demand rises, watch cars drive on your roads, and manage a
single number (money) via one tax rate. It borrows the feel of Cities:
Skylines 2 (the "zone it and watch it grow, then watch the traffic" loop), not
its depth. It ships as a static site on GitHub Pages and itch.io, free.

**Assumptions**

- Desktop browser only. No mobile, no touch controls in v1.
- New project, not part of any existing repo on your machine.
- Free to play, open source (MIT), no monetization. This is a portfolio piece
  and a hobby game, not a business, until proven otherwise.
- Solo developer working evenings, ~2 hours a night.
- Tech: Vite + TypeScript + three.js, vanilla DOM for the HUD (no React).
  Simulation runs in a Web Worker so the render loop never stalls.
- Grid-based tiles (like SimCity 2000 / Micropolis), **not** freeform spline
  roads like CS2. Freeform roads are the single most expensive feature in CS2
  and are out for v1.
- Low-poly, flat-shaded, procedural box buildings with palette colors. No
  purchased assets. Kenney's free CC0 city kit can be dropped in later.
- Flat terrain in v1. No hills, no water.
- Working title: **Gridburg**. Change it whenever.
- Save to localStorage; share a city as a compressed string in the URL.

## 2. Who else is doing this

The space is not empty. It's crowded with abandoned three.js city builders and
a handful of polished 2D browser ones. That's a finding in itself.

1. **[3d.city](https://github.com/lo-th/3d.city)** (lo-th) — 1.7k stars, MIT.
   Three.js on top of the MicropolisJS simulation. Playable at
   lo-th.github.io/3d.city. Free. Established in the three.js community as
   "the" 3D city builder demo. Weak: no save/load, a tech demo more than a
   game, no traffic you can see, largely dormant.
2. **[micropolisJS](https://www.graememcc.co.uk/micropolisJS/)** — 717 stars.
   A hand-ported 1989 SimCity. Free, GPL. Solid simulation, dated 2D look,
   runs anywhere. Weak: it's a museum piece; nobody plays it for long.
3. **[Fable Cities](https://github.com/rawprogress/fable-cities)** — 72 stars.
   Explicitly "a Cities: Skylines-class city builder in three.js", written
   entirely by AI agents. Playable, ~160 MB initial load. Their own blind
   comparisons against CS2 lost 0–4. Weak: enormous download, hasn't cleared
   its own quality bar, no community. This is what "just clone CS2" looks like
   when someone actually tries.
4. **[WebCity](https://github.com/wwwang176/WebCity)** — 0 stars, 1,800
   commits, private license. Six road types, rail, 21 buildings, citizen sim,
   6,500 tests. Weak: nobody can play it. A one-person feature race with no
   distribution, which is the default failure mode for this idea.
5. **[SlimCity](https://slimcity.netlify.app/)** — 2 stars. TypeScript,
   three.js, deterministic worker sim, instanced rendering, day/night. Weak:
   zero audience. Same lesson as WebCity.
6. **[Dan Greenheck's SimCity clone](https://github.com/dgreenheck/simcity-threejs-clone)**
   — the YouTube tutorial series ("Creating a SimCity Game with JavaScript &
   Three.js", 13+ episodes including traffic). This is the reference most
   people copy. Weak: it's a tutorial, deliberately unfinished as a game.
7. **[The Final Earth 2](https://store.steampowered.com/app/1180130/The_Final_Earth_2/)**
   — 2D vertical sci-fi city builder. Millions of browser plays on Kongregate
   and CrazyGames, 97% positive on 407 Steam reviews, mobile versions. The
   proof that a browser city builder can find a real audience. Weak: 2D, not
   a road/traffic game at all.
8. **[Urbanitas](https://not-articulated.itch.io/urbanitas)** — Picotron
   city builder, 500+ buildings, covered by Time Extension in September 2026.
   Weak: 2D, tiny resolution, no traffic.
9. **[Six-Sided Streets](https://csklimowski.itch.io/six-sided-streets)** —
   hex tile town builder in Phaser, top-rated on itch. Weak: a puzzle, not a
   sim.
10. **Cities: Skylines II** itself — ~8,800 concurrent Steam players in July
    2026, down 92% from its 104k launch peak, 55% "Mixed" on 91k reviews.
    Biggest complaints: performance, load times, economy bugs, and for a long
    time no official mod support. It's still the benchmark everyone means.

**The gap.** Every three.js attempt either stays a tech demo (3d.city,
tutorial repos) or disappears into a private feature race (WebCity,
SlimCity, Fable Cities). None of them is *small, instant, and shareable*.
The 2D browser builders that actually got played (Final Earth 2, Urbanitas)
won by being tight and quick to load, not by being deep. Nobody has shipped
a 3D city builder that opens in two seconds, is fun for twenty minutes, and
gives you a link to your city.

## 3. Verdict

**"Cities: Skylines 2 in three.js" is not worth building. A twenty-minute
grid city builder with visible traffic and a shareable URL is.**

**The single strongest reason this fails.** Scope, not skill. CS2 is a
hundred-plus person-years of work; Fable Cities threw unlimited AI agents at
it and still lost every blind comparison. The failure mode is specific and
you can already see it in WebCity and SlimCity: you spend six months adding
water pipes, sewage, and five transit modes, never post it anywhere, and
then it sits at 2 stars. Feature depth is what you'll want to build and it's
exactly what nobody will reward. The second reason is that "three.js city
builder" has a canonical answer already (3d.city, 1.7k stars) and anything
that looks like it will be dismissed as "another one".

**The sharper version.** Make it a *traffic toy first, city builder second*.
The thing people actually watch in CS videos is cars, not budgets. So: roads
and zoning grow the city, but the whole score and feedback loop is about
traffic. Roads turn red where they jam. The one stat on screen is "average
commute". You win by designing a street grid that flows. Keep everything
else (budget, services, terrain) to the absolute minimum. Ship it as a
single link on r/WebGames with a title like "I made a tiny 3D city builder
where the only thing that matters is traffic". That's a post people click.
That's also a v1 you can actually finish, and it leaves you a clean path to
add depth later if anyone shows up.

The plan below builds the sharper version.

## 4. Scope

Two weeks of evenings is roughly 28 working hours. That is not enough for
services, terrain, or economy. It is enough for one good loop.

**In**

- Fixed 64×64 flat grid, orbit camera (pan, rotate, zoom), tile picking.
- Road tool: click-drag to draw, auto-tiling (straight / corner / T / cross),
  bulldoze.
- Three zone brushes: residential, commercial, industrial.
- Buildings grow on zoned tiles adjacent to a road, three levels each
  (small → medium → tall boxes), driven by simple RCI demand.
- Simulation in a Web Worker: population, jobs, demand, money. One tax
  slider. Speed 1× / 2× / pause.
- Traffic: cars spawn from residential, path to commercial/industrial over
  the road graph (A*), drive along it, slow down when a tile is crowded.
  Road tiles tint by congestion. "Average commute" is the headline stat.
- Instanced rendering for buildings and cars (one draw call per type).
- Save/load to localStorage, plus "Share" that puts the city in the URL.
- Deployed to GitHub Pages and uploaded to itch.io.

**Cut** (named so they stay cut)

- Freeform / curved roads, elevated roads, highways, one-way streets.
- Terrain height, water, trees, weather, day/night.
- Power, water, sewage, garbage, police, fire, schools, health, parks.
- Public transit of any kind.
- Individual citizens with names, ages, or happiness.
- Districts, policies, loans, disasters.
- Accounts, cloud saves, multiplayer, leaderboards.
- Mobile / touch.
- Sound.
- Purchased or modeled art. Boxes with good colors and a nice light.
- Any framework for UI. Plain HTML over the canvas.

## 5. Build plan

Riskiest piece: the road graph plus cars driving on it at 60 fps with a
few hundred vehicles. It goes in phase 2, before zoning, so a dead end
shows up on evening four.

**Phase 1 — Scaffold and grid (evenings 1–2).**
Vite + TS + three.js. Ground plane, grid helper, orbit camera with pan
constrained to the map, raycast tile picking with a hover highlight. Placing
a colored box on click. *Done when:* you can click any tile and a box appears
there, and the camera feels good.

**Phase 2 — Roads and cars (evenings 3–6). Risky.**
Road tool with drag-to-draw and auto-tiling from neighbor bitmask (16
variants, two or three meshes rotated). Build an adjacency graph of road
tiles. A* between two random road tiles. Cars as an InstancedMesh, each with
a path and a progress value, moving in the worker, positions posted to the
main thread each frame as a Float32Array. Congestion = cars per tile; slow
them down above a threshold and tint the tile. *Done when:* 300 cars drive
around a hand-drawn grid at 60 fps and a bottleneck visibly goes red. If this
isn't working by evening 6, stop and rethink (fewer cars, coarser graph)
before building anything on top of it.

**Phase 3 — Zoning and growth (evenings 7–9).**
Three zone brushes. Every tick, the worker computes RCI demand from
population vs jobs; zoned tiles touching a road spawn a level-1 building
with probability proportional to demand; buildings upgrade after N ticks if
demand stays high, downgrade if it collapses. Buildings as InstancedMesh per
level and type (9 instance groups). *Done when:* you draw roads and zones,
walk away, and a city with three heights of building has grown on its own.

**Phase 4 — Simulation and HUD (evenings 10–11).**
Money, tax slider, per-tick income = population × tax minus road upkeep.
Trip generation: cars now spawn from residential buildings and go to a
commercial or industrial building, weighted by level. Average commute stat.
Top bar: money, population, jobs, commute, speed buttons. Bottom bar: tools.
*Done when:* raising taxes lowers demand, and a badly gridded city has a
worse commute number than a well gridded one.

**Phase 5 — Save, share, ship (evenings 12–14).**
Serialize grid + money + tick to a compact byte array, base64 into
localStorage and into the URL hash. "Load demo city" button with a prebuilt
city so first-time visitors see something alive in two seconds. Deploy to
GitHub Pages. Upload the same build to itch.io as an HTML5 game. Record a
15-second GIF. *Done when:* a stranger can open the link, see a moving city,
and paste a link to their own.

**The first three tasks**

1. `npm create vite@latest gridburg -- --template vanilla-ts`, add three.js,
   render a 64×64 plane with a grid helper and an orbit camera that pans with
   WASD and rotates with right-drag, clamped to the map bounds.
2. Raycast from the mouse to the plane, snap to the tile, draw a translucent
   hover quad, and on click push a `{x, z, kind: 'road'}` entry into a
   `Uint8Array(64*64)` map and rebuild the road mesh from it.
3. Implement the 4-bit neighbor bitmask auto-tiler for roads and draw a
   hand-made loop of road, then write `astar(map, from, to)` and log a path.

## 6. Launch

Where the audience actually is:

- **r/WebGames** (142k members). The best fit. Browser-only, they upvote
  playable links with a GIF. Post on a weekday evening US time.
- **r/CityBuilders** (18k). Smaller but every one of them is the target
  player. They are tired of CS2 discourse and like small games.
- **r/threejs** and the **three.js Discourse "Showcase" category**. This is
  where 3d.city and the tutorial series live; a working game with source
  gets forum front page and often a retweet from the three.js account.
- **itch.io**, tagged city-builder + three.js + html5. The "new and popular"
  feed for city-builder is small enough that a decent GIF gets you on it.
- **Hacker News "Show HN"** once it's stable. City builders with source do
  well there (micropolisJS did). Lead with the technical angle: worker sim,
  instancing, 300 cars, URL-encoded save.
- **Twitter/X and Bluesky** with the #threejs and #gamedev tags; the three.js
  community there is small but reposts real games.

Draft launch post (r/WebGames / r/CityBuilders):

> **Title:** I made a tiny 3D city builder where the only thing that matters
> is traffic (browser, free, no login)
>
> I love watching traffic in Cities: Skylines and hate waiting two minutes
> for it to load. So I built a small one that opens instantly in a browser
> tab.
>
> You draw roads, paint zones, and the city grows on its own. Cars commute
> from homes to jobs over the roads you laid. Roads turn red where they jam.
> The only score is average commute time, so it's really a game about
> designing a street grid that flows.
>
> There's no power, water, or services. It's flat, it's boxes, and a full
> game is about twenty minutes. Your city is saved in the link, so paste it
> in the comments and I'll try to beat your commute.
>
> Play: [link]  ·  Source: [github link]
>
> Made with three.js. The simulation runs in a Web Worker and everything is
> instanced, so it holds 60 fps with a few hundred cars on a laptop. Happy
> to answer questions about how it works.

Sources used in research: [3d.city](https://github.com/lo-th/3d.city),
[micropolisJS](https://www.graememcc.co.uk/micropolisJS/),
[Fable Cities](https://github.com/rawprogress/fable-cities),
[WebCity](https://github.com/wwwang176/WebCity),
[SlimCity](https://github.com/rbenzing/SlimCityGame),
[simcity-threejs-clone](https://github.com/dgreenheck/simcity-threejs-clone),
[The Final Earth 2 on Steam](https://store.steampowered.com/app/1180130/The_Final_Earth_2/),
[Urbanitas](https://not-articulated.itch.io/urbanitas),
[Six-Sided Streets](https://csklimowski.itch.io/six-sided-streets),
[CS2 Steam charts](https://steamdb.info/app/949230/charts/),
[CS1 vs CS2 players](https://www.pcgamesn.com/cities-skylines-2/cs1-steam-players),
[r/CityBuilders stats](https://gummysearch.com/r/CityBuilders/),
[r/WebGames stats](https://gummysearch.com/r/WebGames/),
[itch.io city builder tag](https://itch.io/games/platform-web/tag-city-builder).

## Ship it or kill it?

A grid-based 3D city builder in three.js where roads and zoning grow a city
and the whole game is about traffic flow, shipped as an instant-load free
link with URL-shareable cities. My call: ship the sharper version, kill the
"CS2 clone" framing. The clone dies of scope; the traffic toy is finishable
and has a real post title.

- Time to v1: 14 evenings / 2 weeks
- Cost to build: €0 (GitHub Pages + itch.io; Kenney assets are CC0 if you want them later)
- Realistic best case: front page of r/WebGames, 5–20k plays in the first month, a few hundred GitHub stars, and a portfolio piece that leads to three.js work. Revenue: none.

Built on these assumptions: desktop browser only · new standalone project · free and open source · solo, ~2 h/evening · Vite + TS + three.js, vanilla DOM UI, worker sim · grid tiles not freeform roads · procedural low-poly boxes · flat terrain · working title Gridburg · localStorage + URL saves.

Say "ship it" and I'll start on task one. Say "kill it" and it's gone.
Or correct any assumption above and I'll re-run from there.
