import { ParkPathLayer } from './render/parkPaths';
import { TrolleyWireLayer } from './render/trolleyWires';
import { BikeLaneLayer } from './render/bikeLanes';
import * as THREE from 'three';
import { StructureLayer } from './render/structures';
import { LandscapeLayer } from './render/landscape';
import { StreetlightLayer } from './render/streetlights';
import { daylight, DAY_SECONDS } from './render/daylight';
import { IncidentLayer } from './render/incidents';
import { TransportLayer } from './render/transport';
import { SubwayLayer } from './render/subway';
import { TransitLineLayer } from './render/transitLines';
import { AlleyLayer } from './render/alleys';
import { HelicopterLayer } from './render/helicopters';
import { BalloonLayer } from './render/balloons';
import { BoatLayer } from './render/boats';
import { Walker } from './render/walker';
import { Driver } from './render/driver';
import type { TrafficCar } from './render/driver';
import { vehicleLength } from './sim/trafficSpace';
import { StreetDetailLayer } from './render/streetDetail';
import { VergeLayer } from './render/verges';
import { RaceWorld } from './racing/race';
import type { RaceRoute } from './racing/routes';
import { loadGarage, saveGarage, driveStats } from './racing/garage';
import { playerCarGeometry } from './racing/carModels';
import { GaragePanel } from './ui/garage';
import { RaceHudView } from './ui/raceHud';
import type { DetailSource } from './render/streetDetail';
import { PedestrianLayer } from './render/pedestrians';
import { StreetFurnitureLayer } from './render/streetFurniture';
import { ParkedCarLayer } from './render/parkedCars';
import './style.css';
import { Game, newCity, randomSeed, highwayLayout, HIGHWAY_END } from './game';
import { createScene } from './render/scene';
import { RoadLayer } from './render/roads';
import { RiverLayer } from './render/river';
import { BuildingLayer } from './render/buildings';
import { OverlayLayer } from './render/overlay';
import { CarLayer } from './render/cars';
import { Input } from './input';
import { Hud } from './ui/hud';
import { demoCity } from './demo';
import { clearLocal, loadFromHash, loadLocal, saveLocal, shareUrl } from './save';
import { MainMenu, loadSettings, saveSettings } from './ui/menu';
import type { Settings } from './ui/menu';
import { setDayLength } from './render/daylight';
import { GRID, MAX_CARS, N_TILES, RES_POP, SERVICES, isZone } from './constants';
import { HALF_WIDTH, Network } from './roads/network';
import { roadHeight } from './roads/structures';
import { serviceCoverage } from './coverage';
import { mapGates } from './roads/entries';
import { footprintSize } from './sites';
import { SERVICE_TOOL } from './input';
import { TerraformLayer } from './render/terraform';
import { HillLayer } from './render/hills';
import { hillLevel, digLevel } from './extras';
import { DisasterLayer } from './render/disasters';
import { WaterLayer } from './render/flood';
import { WaterSim } from './sim/water';
import { WaveField, waterUniforms } from './render/waves';
import { DistrictLabels } from './render/districts';
import { CyclistLayer } from './render/cyclists';
import { CityPanels } from './ui/cityPanels';
import type { MapView } from './ui/cityPanels';
import { CityAudio } from './audio';
import { AchievementLog } from './achievements';
import { TouchControls } from './ui/touch';
import { loadSlot } from './slots';
import { DISTRICT_COLORS } from './extras';
import { Disasters } from './sim/disasters';
import { waterDistance } from './sim/economy';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const { renderer, scene, camera, controls, grid, update: updateScene, setWalking } = createScene(canvas);
const trolleyWires = new TrolleyWireLayer();
scene.add(trolleyWires.group);
const parkPaths = new ParkPathLayer();
scene.add(parkPaths.group);
const bikeLanes = new BikeLaneLayer();
scene.add(bikeLanes.group);
const landscape = new LandscapeLayer();
const streetlights = new StreetlightLayer();
const river = new RiverLayer();
const structures = new StructureLayer();
const roads = new RoadLayer();
const buildings = new BuildingLayer();
const overlay = new OverlayLayer();
const cars = new CarLayer();
const transport = new TransportLayer();
const subway = new SubwayLayer();
const transitLines = new TransitLineLayer();
const alleys = new AlleyLayer();
const helicopters = new HelicopterLayer();
const balloons = new BalloonLayer();
const boats = new BoatLayer();
const incidents = new IncidentLayer();
const pedestrians = new PedestrianLayer();
const furniture = new StreetFurnitureLayer();
const streetDetail = new StreetDetailLayer();
const verges = new VergeLayer();
const parked = new ParkedCarLayer();
const terraformLayer = new TerraformLayer();
const hills = new HillLayer();
landscape.hillHeight = (x, z) => hills.heightAt(x, z);
landscape.setPits(hills.pitTexture);
const disasterLayer = new DisasterLayer();
const flood = new WaterLayer();
const waves = new WaveField();
const districtLabels = new DistrictLabels();
const cyclists = new CyclistLayer();
const audio = new CityAudio();
const achievements = new AchievementLog();
let showTraffic = false;
scene.add(hills.group, terraformLayer.group, disasterLayer.group, flood.group, districtLabels.group, cyclists.group, parked.group, pedestrians.group, furniture.group, streetDetail.group, verges.group, helicopters.group, balloons.group, boats.group, structures.group, landscape.group, streetlights.group, river.group, alleys.group, overlay.group, roads.group, buildings.group, cars.mesh, transport.group, subway.group, transitLines.group, incidents.group);

const game = new Game();
const input = new Input(canvas, camera, game, scene);
input.inspectionTarget = buildings.group;
input.roadTarget = roads.mesh;

const hud = new Hud(uiRoot, {
  setTool: (t) => input.setTool(t),
  setMode: (m) => input.setMode(m),
  setSpeed: (v) => { game.setSpeed(v); hud.setSpeed(v); },
  setTax: (v) => game.setTax(v),
  setTaxes: (t) => game.setTaxes(t),
  setFunding: (key, value) => game.setFunding(key, value),
  setPolicy: (id, on) => game.setPolicy(id, on),
  loan: (action) => game.loan(action),
  rotatePlacement: () => input.rotatePlacement(),
  toggleWalk: () => { if (walker.active) walker.exit(); else startWalking(); },
  toggleDrive: () => driveButton(),
  setElevation: (level) => input.setElevation(level),
  setBrush: (size) => { input.brushSize = size; },
  setRingSize: (id) => { input.ringSize = id; },
  focusOn: (id) => {
    // Take the camera to whatever the message is about.
    const tileAt = (): { x: number; z: number } | null => {
      if (id === 'fires' && game.incidents.fires.length) return tileCentre(game.incidents.fires[0].tile);
      if (id === 'crashes' && game.incidents.crashes.length) return { x: game.incidents.crashes[0].x, z: game.incidents.crashes[0].z };
      if (id === 'crime' && game.incidents.crime.length) return tileCentre(game.incidents.crime[0]);
      if (id === 'heists' && game.incidents.heists.length) return tileCentre(game.incidents.heists[0].tile);
      if (id === 'racers') {
        for (let n = 0; n < MAX_CARS; n++) if (Math.round(game.carsNext[n * 4 + 3]) === 7) return { x: game.carsNext[n * 4] + 40, z: game.carsNext[n * 4 + 1] + 40 };
        return null;
      }
      if (id === 'declining') { const t = game.neglect.findIndex(v => v > 0); return t >= 0 ? tileCentre(t) : null; }
      if (id === 'start') { const h = highwayLayout(game.terrain); return h.pos(h.cross ?? h.front, HIGHWAY_END + 1); }
      if (id === 'pollution') {
        let worst = -1, peak = 0;
        for (let i = 0; i < game.pollution.length; i++) if (game.pollution[i] > peak) { peak = game.pollution[i]; worst = i; }
        return worst >= 0 ? tileCentre(worst) : null;
      }
      return null;
    };
    const spot = tileAt();
    if (!spot) return false;
    flyTo(spot.x, spot.z);
    return true;
  },
  closeInspection: () => game.inspect(-1),
  openMenu: () => openMenu(),
  newCity: () => {
    clearLocal();
    history.replaceState(null, '', location.pathname);
    game.load(newCity(randomSeed()));
    focusCity(false);
    hud.setTax(10);
    hud.toast('New map. Build out from the end of the two-lane highway.');
  },
  demoCity: () => {
    history.replaceState(null, '', location.pathname);
    game.load(demoCity(true));
    game.warm(110);
    focusCity(true);
    input.setTool('none');
    hud.setTax(10);
    hud.toast('Demo city loaded');
  },
  share: async () => {
    const url = shareUrl(game.snapshot());
    try {
      await navigator.clipboard.writeText(url);
      hud.toast('Link copied to clipboard');
    } catch {
      prompt('Copy this link:', url);
    }
    history.replaceState(null, '', url);
  },
  toggleTraffic: () => {
    showTraffic = !showTraffic;
    roads.tint(game.segOrder, showTraffic ? game.segCong : new Uint8Array(game.segCong.length));
    return showTraffic;
  },
  toggleInfiniteMoney: () => {
    game.setInfiniteMoney(!game.infiniteMoney);
    settings.infiniteMoney = game.infiniteMoney;
    saveSettings(settings);
    hud.toast(game.infiniteMoney ? 'Infinite money on' : 'Infinite money off');
    return game.infiniteMoney;
  },
  togglePollution: () => {
    overlay.strong = !overlay.strong;
    overlay.setPollution(game.pollution);
    return overlay.strong;
  },
});

input.onInspect = (tile) => game.inspect(tile);

// ---- map views, statistics, districts, achievements, saves ---------------------------------------
const cityDay = (): number => Math.floor((game.cityTime + DAY_SECONDS * 9 / 24) / DAY_SECONDS) + 1;
const hex = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
/** Colour for a 0..255 map value on a red → yellow → green scale (or reversed for bad things). */
const ramp = (v: number, good: boolean, alpha = 150): [number, number, number, number] => {
  const t = Math.max(0, Math.min(1, v / 255)), u = good ? t : 1 - t;
  return [Math.round(230 - 170 * Math.max(0, u - 0.5) * 2), Math.round(70 + 170 * Math.min(1, u * 2)), 70, alpha];
};
let panelsReady = false;
function renderView(): void {
  if (!panelsReady) return;
  const view = panels.view, maps = game.maps;
  districtLabels.setVisible(view === 'districts' || input.tool === 'district' || input.tool === 'undistrict');
  if (view === 'none') { overlay.setView(null); return; }
  if (view === 'districts' || input.tool === 'district' || input.tool === 'undistrict') {
    overlay.setView(game.extras.district, v => v ? [...hex(DISTRICT_COLORS[v - 1]), 120] : null);
    return;
  }
  if (view === 'flood') {
    const zone = new Set(Disasters.floodZone(game.terrain.water, waterDistance(game.terrain.water), game.kind));
    overlay.setView(game.extras.district, (_, i) => zone.has(i) ? [60, 130, 230, 140] : null);
    return;
  }
  if (!maps) { overlay.setView(null); return; }
  const isBuilt = (i: number): boolean => isZone(game.kind[i]) && game.level[i] > 0;
  if (view === 'land') overlay.setView(maps.land, (v, i) => isBuilt(i) || game.kind[i] ? ramp(v, true) : ramp(v, true, 70));
  else if (view === 'wellbeing') overlay.setView(maps.wellbeing, (v, i) => game.kind[i] === 2 && game.level[i] ? ramp(v, true) : null);
  else if (view === 'noise') overlay.setView(maps.noise, v => v < 20 ? null : [150, 80, 220, Math.min(190, v)]);
  else if (view === 'crime') overlay.setView(maps.crime, v => v < 10 ? null : [220, 50, 50, Math.min(200, 40 + v)]);
  else if (view === 'garbage') overlay.setView(maps.garbage, v => v < 25 ? null : [140, 95, 40, Math.min(210, 30 + v)]);
}
const panels = new CityPanels(uiRoot, hud.rightBar, hud.menuPopover, game, achievements, {
  setView: (view: MapView) => { renderView(); void view; },
  undo: () => undo(),
  toggleSound: () => audio.toggle(),
  soundOn: () => audio.enabled,
  loadCity: (d) => startCity(d, 'City loaded'),
  districtChanged: () => { districtLabels.rebuild(game.extras.district, game.extras.districtNames); renderView(); },
  day: cityDay,
}, d => { input.districtBrush = d; });
panelsReady = true;
input.onDistrict = () => { panels.refreshDistrict(); };
function undo(): void {
  if (game.undo()) { audio.play('bulldoze'); hud.toast('Undone: the last change was taken back and refunded'); }
  else hud.toast('Nothing to undo');
}
window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey && (e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); undo(); }
});
let lastDisaster: string | null = null;
function afterState(): void {
  const s = game.stats;
  disasterLayer.set(game.disaster);
  if (s.disasters.active && s.disasters.active !== lastDisaster) audio.play('alarm');
  lastDisaster = s.disasters.active;
  panels.record(s, cityDay());
  renderView();
  let districts = 0, shaped = 0;
  const seen = new Set<number>();
  for (let i = 0; i < game.extras.district.length; i++) { if (game.extras.district[i]) seen.add(game.extras.district[i]); if (game.extras.terraform[i]) shaped++; }
  districts = seen.size;
  const counts = new Map<number, number>();
  for (const k of game.kind) counts.set(k, (counts.get(k) ?? 0) + 1);
  const fresh = achievements.check({ stats: s, count: k => counts.get(k) ?? 0, districts, shaped });
  for (const a of fresh) { hud.toast(`Achievement: ${a.title} — ${a.text}`); audio.play('achievement'); }
  if (s.cityLevel > lastLevel && lastLevel >= 0) audio.play('chime');
  lastLevel = s.cityLevel;
}
let lastLevel = -1;
game.onInspection = (report) => hud.showInspection(report);
game.onNotice = (message) => hud.toast(message);

// ---- walking the streets -----------------------------------------------------------------
/** Parks, playgrounds and the like are open ground; everything else with walls stops a walker. */
const OPEN_GROUND = new Set(Object.entries(SERVICES).filter(([, spec]) => spec.civic === 'leisure').map(([k]) => Number(k)));
/**
 * The road deck under (x, z) in scene space, if any: the height of the nearest bridge, ramp or street
 * surface, choosing the deck closest to `y` where one road passes over another. Tunnels are left to
 * the traffic; on foot or at the wheel you cross the ground above them.
 */
function deckAt(x: number, z: number, y: number): number | null {
  const tx = x + GRID / 2, tz = z + GRID / 2;
  let best: number | null = null;
  for (const seg of game.net.segs.values()) {
    if (seg.structure === 2) continue;
    const reach = HALF_WIDTH[seg.kind] + 0.12;
    if (tx < seg.minX - reach || tx > seg.maxX + reach || tz < seg.minZ - reach || tz > seg.maxZ + reach) continue;
    const hit = Network.nearestOn(seg, tx, tz);
    if (hit.dist > reach) continue;
    const h = roadHeight(seg, hit.s);
    // A deck far above you is a bridge to walk under, not one you are standing on.
    if (h > y + 0.25) continue;
    if (best === null || Math.abs(h - y) < Math.abs(best - y)) best = h;
  }
  return best;
}
/** Height underfoot: the road deck you are on, or the ground. */
function groundAt(x: number, z: number, y: number): number {
  return deckAt(x, z, y) ?? 0;
}
function blockedAt(x: number, z: number, y = 0): boolean {
  const tx = x + GRID / 2, tz = z + GRID / 2;
  if (tx < 0.2 || tz < 0.2 || tx > GRID - 0.2 || tz > GRID - 0.2) return true;
  const cx = Math.floor(tx), cz = Math.floor(tz);
  if (hillLevel(game.extras.terraform[cz * GRID + cx])) return true;
  // Up on a bridge nothing below is in the way; over the river only a deck will carry you.
  const deck = y > 0.12 || game.terrain.water[cz * GRID + cx] ? deckAt(x, z, y) : null;
  if (deck !== null && deck > 0.12) return false;
  if (game.terrain.water[cz * GRID + cx]) return deck === null;
  // A grown building stands on its lot, which may have shifted up to most of a cell towards its road,
  // so look at the neighbouring tiles as well as the one underfoot.
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const nx = cx + dx, nz = cz + dz;
    if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) continue;
    const i = nz * GRID + nx, k = game.kind[i];
    if (!k) continue;
    if (isZone(k)) {
      if (!game.level[i]) continue;
      // The whole lot is private: the house is pushed out to its street front and fenced gardens fill
      // the rest. Lots stop 0.08 short of each other, which leaves the alleys between them walkable.
      if (Math.abs(tx - game.raster.lotX[i]) < 0.42 && Math.abs(tz - game.raster.lotZ[i]) < 0.42) return true;
      continue;
    }
    if (OPEN_GROUND.has(k)) continue;
    // A service building fills its site, less a narrow margin to walk right up to the wall.
    const [w, d] = footprintSize(k, game.rot[i]);
    if (tx > nx + 0.12 && tx < nx + w - 0.12 && tz > nz + 0.12 && tz < nz + d - 0.12) return true;
  }
  return false;
}
/** What the street detail is built from: the game as it stands when each chunk is built. */
function detailSource(): DetailSource {
  return {
    get kind() { return game.kind; },
    get level() { return game.level; },
    get raster() { return game.raster; },
    get net() { return game.net; },
    get terrain() { return game.terrain; },
    get terraform() { return game.extras.terraform; },
    get rot() { return game.rot; },
    relief: (x, z) => hills.heightAt(x, z),
    surface: (tile) => game.waterSurface ? game.waterSurface[tile] : NaN,
    body: (k, l, v) => buildings.body(k, l, v),
  };
}
const walker = new Walker(camera, canvas, {
  blocked: blockedAt,
  ground: groundAt,
  onExit: () => { game.setStreetView(false); setWalking(false); input.suspended = false; hud.setWalking(false); furniture.setVisible(false); streetDetail.setActive(false); touch.setMode('map'); },
});
const driver = new Driver(camera, scene, {
  // Parked cars are in the way of a car, though a pedestrian squeezes past them.
  // Parked cars are cleared off the streets for a race.
  blocked: (x, z, y) => blockedAt(x, z, y) || (y < 0.12 && !raceWorld.racing && parked.hits(x, z)) || raceWorld.blocks(x, z, y),
  ground: groundAt,
  traffic: (x, z, radius) => {
    const out: TrafficCar[] = [], cars = game.carsNext, heights = game.carHeights;
    for (let i = 0; i < MAX_CARS; i++) {
      const o = i * 4, type = Math.round(cars[o + 3]);
      if (type < 1 || type > 10 || Math.abs(cars[o] - x) > radius || Math.abs(cars[o + 1] - z) > radius) continue;
      out.push({ x: cars[o], z: cars[o + 1], angle: cars[o + 2], length: vehicleLength(type), y: heights[i] ?? 0 });
    }
    return raceWorld.racing ? raceWorld.cars() : out.concat(raceWorld.cars());
  },
  impact: (strength) => { audio.crash(strength); raceWorld.impact(strength); },
  onExit: () => { game.setStreetView(false); setWalking(false); input.suspended = false; hud.setWalking(false); furniture.setVisible(false); streetDetail.setActive(false); touch.setMode('map'); raceWorld.abort(); raceWorld.setVisible(false); raceHud.hideResult(); },
});
const touch = new TouchControls(uiRoot, canvas, controls, walker, driver, () => { walker.exit(); driver.exit(); });
// ---- the garage and street racing ------------------------------------------------------------------
const garageState = loadGarage();
const raceWorld = new RaceWorld();
scene.add(raceWorld.group);
/** Put the garage's selected car, as painted and tuned, under the driver. */
function applyCar(): void {
  const car = garageState.cars[garageState.selected];
  driver.setCar(playerCarGeometry(car.model, car.color), driveStats(car));
}
/** Rivals and the police get a little quicker as the player wins. */
const difficulty = (): number => 0.93 + Math.min(0.14, garageState.wins * 0.012);
function startRace(race: RaceRoute): void {
  raceHud.hideResult();
  if (!driver.active) startDriving();
  if (!driver.active) return;
  applyCar();
  raceWorld.start(race, driver, difficulty());
}
const garagePanel = new GaragePanel(uiRoot, garageState, {
  drive: () => { if (!driver.active) startDriving(); else applyCar(); },
  race: (race) => startRace(race),
  races: () => { raceWorld.plan(game.net, game.seed); return raceWorld.races; },
  changed: () => { if (driver.active && !raceWorld.racing) applyCar(); },
});
const raceHud = new RaceHudView(uiRoot, {
  again: (race) => startRace(race),
  garage: () => { raceWorld.abort(); driver.exit(); garagePanel.show(); },
  drive: () => { raceWorld.abort(); },
});
// A race clears the streets: the parked cars go and the traffic all but stops; they come back after.
raceWorld.onRacing = (racing) => {
  // The few emergency vehicles still out on calls keep running in the city, unseen.
  parked.group.visible = !racing;
  cars.mesh.visible = !racing;
  if (driver.active) game.setStreetView(true, true, racing);
};
raceWorld.onFinish = (result) => {
  garageState.cash += result.reward;
  if (result.won) garageState.wins++;
  const best = garageState.best[result.race.id];
  garageState.best[result.race.id] = result.race.kind === 'drift' ? Math.max(best ?? 0, result.score) : Math.min(best ?? 99, result.busted ? 99 : result.place);
  if (garageState.best[result.race.id] === 99) delete garageState.best[result.race.id];
  saveGarage(garageState);
  audio.play(result.share > 0 ? 'achievement' : 'error');
  raceHud.showResult(result, garageState.cash);
};
/** The car button and M: out of the car if driving, otherwise the garage. */
function driveButton(): void {
  if (driver.active) driver.exit();
  else garagePanel.toggle();
}

/** Take the wheel on the nearest street to the middle of the view, driving on the right. */
function startDriving(): void {
  if (driver.active || !playing) return;
  walker.exit();
  input.setTool('none');
  const t = controls.target;
  const hit = game.net.nearestSeg(t.x + GRID / 2, t.z + GRID / 2, 40);
  if (!hit) { hud.toast('Build a road first, then take a car out on it.'); return; }
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const seg = hit.seg, i = Math.min(seg.n - 1, Math.floor(hit.t * seg.n));
  let tx = seg.pts[i * 2 + 2] - seg.pts[i * 2], tz = seg.pts[i * 2 + 3] - seg.pts[i * 2 + 1];
  const len = Math.hypot(tx, tz) || 1; tx /= len; tz /= len;
  // Point the way the camera looks along the street, and keep to the right-hand lane.
  // A one-way street only goes a → b.
  if (!seg.oneway && tx * dir.x + tz * dir.z < 0) { tx = -tx; tz = -tz; }
  const lane = seg.oneway ? 0 : HALF_WIDTH[seg.kind] * 0.45;
  const x = hit.x - tz * lane - GRID / 2, z = hit.z + tx * lane - GRID / 2;
  input.suspended = true;
  setWalking(true);
  game.setStreetView(true, true);
  furniture.setVisible(true);
  streetDetail.setActive(true, detailSource());
  applyCar();
  driver.enter(x, z, Math.atan2(tx, tz));
  raceWorld.plan(game.net, game.seed);
  raceWorld.setVisible(true);
  streetDetail.update(camera.position, true);
  hud.setWalking(true, 'drive');
  touch.setMode('drive');
}
/** Step down onto the nearest street to the middle of the view, facing the way the camera faced. */
function startWalking(): void {
  if (walker.active || !playing) return;
  driver.exit();
  input.setTool('none');
  const t = controls.target;
  let spot = { x: t.x, z: t.z };
  const road = game.net.nearestSeg(t.x + GRID / 2, t.z + GRID / 2, 30);
  if (road) spot = { x: road.x - GRID / 2, z: road.z - GRID / 2 };
  // Nudge off anything solid, in case the nearest road point runs under a bridge pier or similar.
  for (let r = 0; r < 3 && blockedAt(spot.x, spot.z); r += 0.2) spot = { x: spot.x + 0.2, z: spot.z };
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  input.suspended = true;
  setWalking(true);
  game.setStreetView(true);
  furniture.setVisible(true);
  streetDetail.setActive(true, detailSource());
  walker.enter(spot.x, spot.z, Math.atan2(-dir.x, -dir.z));
  streetDetail.update(camera.position, true);
  hud.setWalking(true, 'walk');
  touch.setMode('walk');
}
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  if (e.code === 'KeyF' || e.key === 'f' || e.key === 'F') { if (walker.active) walker.exit(); else startWalking(); }
  if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') driveButton();
  // At a race ring, Enter starts the race; in a race, R puts the car back on the route.
  if (driver.active && e.key === 'Enter' && raceWorld.nearby && !raceWorld.racing) startRace(raceWorld.nearby);
  if (driver.active && (e.code === 'KeyR' || e.key === 'r') && raceWorld.racing) raceWorld.reset(driver);
});

const tileCentre = (tile: number): { x: number; z: number } => ({ x: tile % 80 + 0.5, z: Math.floor(tile / 80) + 0.5 });
/** Glide the camera to a place on the map, keeping its current height and angle. */
let flight: { x: number; z: number; time: number } | null = null;
function flyTo(x: number, z: number): void {
  flight = { x: x - 40, z: z - 40, time: 0 };
}

const showGrid = (t: string): void => { grid.visible = !['none', 'inspect'].includes(t); };
// Reaching for a service shows what the city already covers, so the gap is visible before placing.
// A transport tool in hand opens that mode's route map, the way the metro tool opens the tunnels.
const showTransitLines = (t: string): void => {
  transitLines.setMode(t === 'trolley' ? 'trolley' : t === 'bus' ? 'bus' : t === 'station' ? 'rail' : null);
  transitLines.rebuild(game.kind, game.flags, game.raster, game.net, entryGates());
};
// Which entrances a railway can leave town through; recomputed with the network, not stored.
const entryGates = (): { x: number; z: number }[] => mapGates(game.net);
const showCoverage = (): void => {
  const k = SERVICE_TOOL[input.tool];
  overlay.setCoverage(k === undefined ? null : serviceCoverage(game.kind, k));
};
input.onElevation = (level) => hud.setElevation(level);
input.onRotate = (quarter) => hud.setRotation(quarter, SERVICE_TOOL[input.tool] !== undefined);
input.onToolChange = (t) => { showCoverage(); showTransitLines(t); hud.setRotation(0, SERVICE_TOOL[t] !== undefined); showGrid(t); structures.showUnderground(['lane', 'road', 'avenue', 'highway', 'motorway', 'highway2', 'ramp', 'upgrade', 'oneway', 'bulldoze'].includes(t)); subway.showUnderground(['subway', 'bulldoze'].includes(t) || input.elevation < 0); hud.setTool(t); buildings.showZones(['res', 'com', 'ind', 'office', 'farm', 'leisure'].includes(t)); panels.showDistricts(t === 'district' || t === 'undistrict'); touch.setTool(!['none', 'inspect'].includes(t)); if (t !== 'none') audio.play('click'); renderView(); };
showGrid(input.tool);
input.onModeChange = (m) => hud.setMode(m);
input.onToast = (m) => hud.toast(m);
input.onCost = (text, x, y, ok) => hud.setCost(text, x, y, ok);

/** Tiles with a lot, a building or a road on them, which the river's bank must not sag under. */
function solidGround(): Uint8Array {
  const solid = new Uint8Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) if (game.kind[i] || game.raster.cover[i]) solid[i] = 1;
  return solid;
}

/** The ground and the river's normal level as the main thread knows them, for drawing the water at its simulated height. */
let levels = new WaterSim(game.baseTerrain, game.extras.terraform, game.kind);
flood.setTerrain(game.terrain);
hills.setTerrain(game.terrain, levels.edgeGround());
hills.rebuild(levels.ground, solidGround());
/** The ground as the water sees it, and the relief drawn from it: the river's channel, pits, hills and levees. */
const refreshRelief = (): void => { levels = new WaterSim(game.baseTerrain, game.extras.terraform, game.kind); hills.rebuild(levels.ground, solidGround()); };
const reshape = (): void => { terraformLayer.rebuild(game.extras.terraform, game.baseTerrain.water); refreshRelief(); landscape.develop(game.kind, game.raster, game.net); };
game.onTerraform = () => { reshape(); boats.rebuild(game.kind, game.terrain); audio.play('build'); };
game.onUndo = () => { reshape(); };
game.onTerrain = () => { reshape(); alleys.reset(); transport.reset(); landscape.rebuild(game.terrain); hills.setTerrain(game.terrain, levels.edgeGround()); hills.rebuild(levels.ground, solidGround()); river.rebuild(game.terrain, levels.edgeGround()); flood.setTerrain(game.terrain); flood.rebuild(null, levels); hud.resetProgress(); hud.update(game.stats); };
game.onEdit = () => {
  parkPaths.rebuild(game.parkPaths);
  showCoverage();
  boats.rebuild(game.kind, game.terrain);
  alleys.rebuild(game.kind, game.level, game.raster, game.terrain);
  transitLines.rebuild(game.kind, game.flags, game.raster, game.net, entryGates());
  roads.rebuild(game.net, game.terrain);
  bikeLanes.rebuild(game.net);
  structures.rebuild(game.net);
  landscape.develop(game.kind, game.raster, game.net);
  streetlights.rebuild(game.net);
  refreshRelief();
  pedestrians.rebuild(game.net);
  furniture.rebuild(game.net, game.kind, game.raster);
  parked.rebuild(game.net, game.kind, game.level, game.raster, game.rot);
  cyclists.rebuild(game.net);
  districtLabels.rebuild(game.extras.district, game.extras.districtNames);
  if (!quietEdits) audio.play(input.tool === 'bulldoze' ? 'bulldoze' : 'build');
  buildings.rebuild(game.kind, game.level, game.raster, game.rot, game.terrain.water, game.parkPathMask);
  verges.rebuild(game.kind, game.level, game.raster, game.net, game.terrain, game.extras.terraform, game.rot);
  transport.rebuild(game.kind, game.flags, game.raster, game.net, entryGates(), game.rot);
  trolleyWires.rebuild(game.kind, game.flags, game.raster, game.net);
  subway.rebuild(game.kind, game.flags, game.raster);
  incidents.rebuild(game.incidents, game.kind, game.level, game.raster);
  overlay.setFlags(game.kind, game.level, game.flags, game.raster);
};
game.onState = () => {
  alleys.rebuild(game.kind, game.level, game.raster, game.terrain);
  transitLines.rebuild(game.kind, game.flags, game.raster, game.net, entryGates());
  buildings.rebuild(game.kind, game.level, game.raster, game.rot, game.terrain.water, game.parkPathMask);
  verges.rebuild(game.kind, game.level, game.raster, game.net, game.terrain, game.extras.terraform, game.rot);
  transport.rebuild(game.kind, game.flags, game.raster, game.net, entryGates(), game.rot);
  trolleyWires.rebuild(game.kind, game.flags, game.raster, game.net);
  subway.rebuild(game.kind, game.flags, game.raster);
  incidents.rebuild(game.incidents, game.kind, game.level, game.raster);
  // The police and traffic helicopters only take to the air once the town is a City.
  helicopters.group.visible = game.stats.cityLevel >= 4;
  helicopters.watch(game.incidents);
  parked.rebuild(game.net, game.kind, game.level, game.raster, game.rot);
  pedestrians.setCrowd(game.stats.pop, daylight(game.cityTime).night);
  overlay.setFlags(game.kind, game.level, game.flags, game.raster);
  overlay.setPollution(game.pollution);
  river.tint(game.riverPollution);
  hud.update(game.stats);
  afterState();
};
game.onFrame = () => {
  if (showTraffic) roads.tint(game.segOrder, game.segCong);
  roads.updateLights(game.simTime);
};
/** Water tiles worth a random ripple: the river, and whatever it has spilled onto. */
let wetTiles: number[] = [];
let wetTilesFor = '';
/** Drop ripples into the field: boats under way, the cascade, rain in a flood, and a light patter everywhere. */
function stirWater(): void {
  const half = GRID / 2;
  const key = `${game.baseTerrain.seed}:${game.extras.terraform.reduce((n, v) => n + (digLevel(v) ? 1 : 0), 0)}`;
  if (wetTilesFor !== key) {
    wetTiles = []; wetTilesFor = key;
    for (let i = 0; i < N_TILES; i++) if (game.baseTerrain.water[i] || digLevel(game.extras.terraform[i])) wetTiles.push(i);
  }
  waterUniforms.skyColor.value.copy(scene.background as THREE.Color);
  boats.forEach((x, z, moving) => { if (moving) waves.drop(x + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3, 0.7, 0.01); });
  const foot = river.cascadeFoot;
  if (foot.fall > 0.1) waves.drop(foot.x + (Math.random() - 0.5) * foot.w * 1.4 - half, foot.z + (Math.random() - 0.5) * 0.8 - half, 0.9, 0.02);
  // The spring at the river's head bubbles.
  const spring = game.baseTerrain.river[0];
  if (spring && Math.random() < 0.5) waves.drop(spring.x + (Math.random() - 0.5) * 0.6 - half, spring.z + (Math.random() - 0.5) * 0.6 - half, 0.5, 0.012);
  // A light patter on the river keeps it alive; in a flood it rains hard over everything.
  const storm = game.disaster?.kind === 'flood';
  for (let k = 0; k < (storm ? 10 : 2) && wetTiles.length; k++) {
    const i = wetTiles[Math.floor(Math.random() * wetTiles.length)];
    waves.drop(i % GRID + Math.random() - half, Math.floor(i / GRID) + Math.random() - half, storm ? 0.5 : 0.6, storm ? 0.02 : 0.006);
  }
  if (storm) for (let k = 0; k < 6; k++) waves.drop(Math.random() * GRID - half, Math.random() * GRID - half, 0.5, 0.02);
}
game.onWater = () => { flood.rebuild(game.waterSurface, levels, game.riverPollution); river.setLevels(game.waterSurface, game.baseTerrain.water); };

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if ((e.key === ' ' || e.code === 'Space') && !driver.active) {
    e.preventDefault();
    const v = game.speed === 0 ? 1 : 0;
    game.setSpeed(v);
    hud.setSpeed(v);
  }
});

// ---- main menu, settings and boot -----------------------------------------------------
const settings = loadSettings();
let playing = false;
let resumeSpeed = 1;

function applySettings(s: Settings): void {
  buildings.setDetail(s.visualDetail);
  landscape.setDetail(s.visualDetail);
  cars.setDetail(s.visualDetail);
  streetDetail.setDetail(s.visualDetail);
  renderer.shadowMap.enabled = s.shadows;
  scene.traverse(o => { const m = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material; if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true; });
  setDayLength(s.dayLength);
  if (s.infiniteMoney !== game.infiniteMoney) game.setInfiniteMoney(s.infiniteMoney);
  game.setDisasters(s.disasters);
  hud.setCheatLabel(s.infiniteMoney);
}

let quietEdits = false;
function startCity(data: Parameters<typeof game.load>[0], message?: string): void {
  walker.exit(); driver.exit(); // a new map starts back on the overview
  game.disasterRate = 1;
  quietEdits = true;
  game.load(data);
  quietEdits = false;
  panels.resetHistory();
  lastLevel = -1;
  hud.setTax(game.tax);
  game.setTax(game.tax);
  applySettings(settings);
  focusCity(false);
  playing = true;
  menu.setOpen(false);
  resumeSpeed = 1;
  game.setSpeed(1);
  if (message) hud.toast(message);
}

const savedCity = (): { population: number; day: number } | null => {
  const save = loadLocal();
  if (!save) return null;
  let population = 0;
  for (let i = 0; i < save.kind.length; i++) if (save.kind[i] === 2) population += RES_POP[save.level[i]];
  return { population, day: Math.floor(save.tick / 480) + 1 };
};

const menu: MainMenu = new MainMenu(uiRoot, {
  continueCity: () => { const save = loadLocal(); if (save) startCity(save); },
  newCity: (seed) => { clearLocal(); history.replaceState(null, '', location.pathname); startCity(newCity(seed)); hud.setTax(10); },
  demoCity: () => { history.replaceState(null, '', location.pathname); startCity(demoCity(true), 'Demo city loaded'); game.warm(110); focusCity(true); input.setTool('none'); hud.setTax(10); },
  resume: () => { menu.setOpen(false); game.setSpeed(resumeSpeed); },
  help: () => { menu.setOpen(false); hud.showWelcome(); },
  apply: (s) => applySettings(s),
  loadSlot: (name) => { const d = loadSlot(name); if (d) startCity(d, `Loaded “${name}”`); else hud.toast('That save could not be read'); },
}, settings);

function openMenu(): void {
  walker.exit();
  driver.exit();
  resumeSpeed = game.speed;
  game.setSpeed(0);
  hud.setSpeed(0);
  menu.setSave(savedCity(), playing);
  menu.setOpen(true);
}

// A shared link opens its city straight away; otherwise the menu leads the way in.
const fromHash = loadFromHash();
if (fromHash) {
  startCity(fromHash, 'Loaded shared city');
} else {
  if (location.hash.startsWith('#c=')) hud.toast('That link is from an older version and cannot be loaded');
  game.load(newCity(randomSeed()));
  applySettings(settings);
  game.setSpeed(0);
  menu.setSave(savedCity(), false);
  menu.setOpen(true);
}

// Frame newly loaded maps and the demo around their own highway, even after changing seeds.
function focusCity(center: boolean): void {
  const e = game.terrain.entry;
  const along = center ? 27 : 12;
  const tx = e.x + e.dx * along - 40 + (center ? 0 : 4);
  const tz = e.z + e.dz * along - 40 + (center ? 0 : 9);
  controls.target.set(tx, 0, tz);
  camera.position.set(tx + 14, center ? 42 : 30, tz + (center ? 38 : 30));
}
focusCity(false);

setInterval(() => { if (playing && settings.autosave) saveLocal(game.snapshot()); }, 5000);
window.addEventListener('beforeunload', () => { if (playing && settings.autosave) saveLocal(game.snapshot()); });

const dbg = { game, camera, controls, input, renderer, scene, walker, driver, raceWorld, garageState, frames: 0, layers: { balloons, streetDetail, verges, hills, flood, terraformLayer, disasterLayer, cyclists, parked, pedestrians, furniture, landscape, streetlights, river, structures, roads, buildings, overlay, cars, transport, subway, incidents } };
(window as unknown as { __gridburg: unknown }).__gridburg = dbg;

/** How far the nearest fire engine or police car is from the camera: what the siren fades with. */
function nearestSiren(): number {
  const cars = game.carsNext, cx = camera.position.x, cz = camera.position.z;
  let best = Infinity;
  for (let i = 0; i < MAX_CARS; i++) {
    const type = Math.round(cars[i * 4 + 3]);
    if (type !== 5 && type !== 6) continue;
    best = Math.min(best, Math.hypot(cars[i * 4] - cx, cars[i * 4 + 1] - cz, camera.position.y));
  }
  return best;
}

/** How close the orbit camera has to come before street detail appears from above. */
const OVERVIEW_CLOSE = 26;
let last = performance.now();
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  dbg.frames++;
  walker.update(dt);
  driver.update(dt);
  if (driver.active) {
    raceWorld.plan(game.net, game.seed);
    raceWorld.setVisible(true);
    raceWorld.update(dt, driver, now / 1000);
  }
  raceHud.render(driver.active ? raceWorld.hud : null, driver.active ? raceWorld.nearby : null);
  if ((walker.active || driver.active) && dbg.frames % 6 === 0) {
    const at = driver.active ? driver.position : { x: camera.position.x, z: camera.position.z };
    game.setPlayer({ x: at.x + GRID / 2, z: at.z + GRID / 2 });
  }
  if (driver.active) hud.setDriveSpeed(driver.kmh);
  if (flight) {
    // Ease the camera across rather than cutting, so it stays obvious where the map moved to.
    flight.time = Math.min(1, flight.time + dt * 1.6);
    const ease = 1 - (1 - flight.time) ** 3;
    const offset = camera.position.clone().sub(controls.target);
    controls.target.lerp(new THREE.Vector3(flight.x, 0, flight.z), ease * 0.35);
    camera.position.copy(controls.target).add(offset);
    if (flight.time >= 1 && controls.target.distanceTo(new THREE.Vector3(flight.x, 0, flight.z)) < 0.4) flight = null;
  }
  updateScene(dt, game.cityTime);
  landscape.update(camera.position);
  if (walker.active || driver.active) streetDetail.update(camera.position);
  else {
    // Zoomed in over the town, the same detail streams in round the point you are looking at: the
    // rooftops, the kerbs, the yards and gardens.
    const close = camera.position.distanceTo(controls.target);
    if (playing && close < OVERVIEW_CLOSE) {
      streetDetail.setOverview(true, detailSource());
      streetDetail.update(controls.target, false, Math.max(6, Math.min(16, close * 0.6)));
    } else if (streetDetail.overview) streetDetail.setOverview(false);
  }
  const light = daylight(game.cityTime);
  buildings.setNight(light.night);
  streetlights.update(light.night);
  cars.setNight(light.night);
  river.update(now / 1000);
  const hour = Math.floor(light.hour), minute = Math.floor(light.hour % 1 * 60);
  const label = `${light.night > 0.5 ? '☾' : '☀'} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} · Day ${Math.floor((game.cityTime + DAY_SECONDS * 9 / 24) / DAY_SECONDS) + 1}`;
  hud.setClock(label);
  const span = Math.max(1, game.nextTime - game.prevTime);
  const alpha = Math.max(0, Math.min(1, (performance.now() - game.nextTime) / span));
  incidents.update(game.simTime);
  helicopters.update(now / 1000);
  balloons.update(dt, light.night);
  boats.update(now / 1000, (x, z) => { const s = game.waterSurface, tx = Math.floor(x + GRID / 2), tz = Math.floor(z + GRID / 2); if (!s || tx < 0 || tz < 0 || tx >= GRID || tz >= GRID) return -0.25; const v = s[tz * GRID + tx]; return v === v ? v : -0.25; });
  pedestrians.update(dt, now / 1000);
  cyclists.update(dt);
  disasterLayer.update(now / 1000);
  flood.update(now / 1000);
  stirWater();
  audio.update({
    traffic: game.stats.cars, height: camera.position.y, night: light.night,
    emergencies: game.stats.incidents.fireEngines + (game.stats.incidents.fires + game.stats.incidents.heists ? game.stats.incidents.patrols : 0),
    sirenDistance: nearestSiren(), skid: driver.slip,
    driving: driver.active ? driver.kmh : null, walking: walker.active && walker.moving, storm: !!game.disaster,
  }, dt);
  transport.update(game.simTime);
  subway.update(game.simTime);
  transitLines.update(game.simTime);
  cars.update(game.carsPrev, game.carsNext, alpha, game.carIdsPrev, game.carIdsNext, game.carHeights, game.prevCarHeights, game.carPitch);
  buildings.update(now / 1000);
  overlay.update(now / 1000);
  waves.step(renderer);
  renderer.render(scene, camera);
});
