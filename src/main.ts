import { StructureLayer } from './render/structures';
import { LandscapeLayer } from './render/landscape';
import { StreetlightLayer } from './render/streetlights';
import { daylight, DAY_SECONDS } from './render/daylight';
import { IncidentLayer } from './render/incidents';
import { TransportLayer } from './render/transport';
import { SubwayLayer } from './render/subway';
import './style.css';
import { Game, newCity, randomSeed } from './game';
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
import { RES_POP } from './constants';
import { serviceCoverage } from './coverage';
import { SERVICE_TOOL } from './input';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const { renderer, scene, camera, controls, grid, update: updateScene } = createScene(canvas);
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
const incidents = new IncidentLayer();
let showTraffic = false;
scene.add(structures.group, landscape.group, streetlights.group, river.group, overlay.group, roads.group, buildings.group, cars.mesh, transport.group, subway.group, incidents.group);

const game = new Game();
const input = new Input(canvas, camera, game, scene);
input.inspectionTarget = buildings.group;
input.roadTarget = roads.mesh;

const hud = new Hud(uiRoot, {
  setTool: (t) => input.setTool(t),
  setMode: (m) => input.setMode(m),
  setSpeed: (v) => { game.setSpeed(v); hud.setSpeed(v); },
  setTax: (v) => game.setTax(v),
  setFunding: (key, value) => game.setFunding(key, value),
  setPolicy: (id, on) => game.setPolicy(id, on),
  loan: (action) => game.loan(action),
  closeInspection: () => game.inspect(-1),
  openMenu: () => openMenu(),
  newCity: () => {
    clearLocal();
    history.replaceState(null, '', location.pathname);
    game.load(newCity(randomSeed()));
    focusCity(false);
    hud.setTax(10);
    hud.toast('New map. Build out from the highway.');
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
game.onInspection = (report) => hud.showInspection(report);
game.onNotice = (message) => hud.toast(message);

const showGrid = (t: string): void => { grid.visible = !['none', 'inspect'].includes(t); };
// Reaching for a service shows what the city already covers, so the gap is visible before placing.
const showCoverage = (): void => {
  const k = SERVICE_TOOL[input.tool];
  overlay.setCoverage(k === undefined ? null : serviceCoverage(game.kind, k));
};
input.onToolChange = (t) => { showCoverage(); showGrid(t); structures.showUnderground(['road', 'avenue', 'bridge', 'tunnel', 'upgrade', 'oneway', 'bulldoze'].includes(t)); subway.showUnderground(['tunnel', 'subway', 'bulldoze'].includes(t)); hud.setTool(t); buildings.showZones(['res', 'com', 'ind', 'office'].includes(t)); };
showGrid(input.tool);
input.onModeChange = (m) => hud.setMode(m);
input.onToast = (m) => hud.toast(m);
input.onCost = (text, x, y, ok) => hud.setCost(text, x, y, ok);

game.onTerrain = () => { transport.reset(); landscape.rebuild(game.terrain); river.rebuild(game.terrain); hud.resetProgress(); hud.update(game.stats); };
game.onEdit = () => {
  showCoverage();
  roads.rebuild(game.net, game.terrain);
  structures.rebuild(game.net);
  landscape.develop(game.kind, game.raster, game.net);
  streetlights.rebuild(game.net);
  buildings.rebuild(game.kind, game.level, game.raster);
  transport.rebuild(game.kind, game.flags, game.raster, game.net);
  subway.rebuild(game.kind, game.flags, game.raster);
  incidents.rebuild(game.incidents, game.kind, game.level, game.raster);
  overlay.setFlags(game.kind, game.level, game.flags, game.raster);
};
game.onState = () => {
  buildings.rebuild(game.kind, game.level, game.raster);
  transport.rebuild(game.kind, game.flags, game.raster, game.net);
  subway.rebuild(game.kind, game.flags, game.raster);
  incidents.rebuild(game.incidents, game.kind, game.level, game.raster);
  overlay.setFlags(game.kind, game.level, game.flags, game.raster);
  overlay.setPollution(game.pollution);
  river.tint(game.riverPollution);
  hud.update(game.stats);
};
game.onFrame = () => {
  if (showTraffic) roads.tint(game.segOrder, game.segCong);
  roads.updateLights(game.simTime);
};

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === ' ' || e.code === 'Space') {
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
  renderer.shadowMap.enabled = s.shadows;
  scene.traverse(o => { const m = (o as { material?: { needsUpdate: boolean } | { needsUpdate: boolean }[] }).material; if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true; });
  setDayLength(s.dayLength);
  if (s.infiniteMoney !== game.infiniteMoney) game.setInfiniteMoney(s.infiniteMoney);
  hud.setCheatLabel(s.infiniteMoney);
}

function startCity(data: Parameters<typeof game.load>[0], message?: string): void {
  game.load(data);
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
}, settings);

function openMenu(): void {
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

const dbg = { game, camera, controls, input, renderer, scene, frames: 0, layers: { landscape, streetlights, river, structures, roads, buildings, overlay, cars, transport, subway, incidents } };
(window as unknown as { __gridburg: unknown }).__gridburg = dbg;

let last = performance.now();
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  dbg.frames++;
  updateScene(dt, game.cityTime);
  landscape.update(camera.position);
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
  transport.update(game.simTime);
  subway.update(game.simTime);
  cars.update(game.carsPrev, game.carsNext, alpha, game.carIdsPrev, game.carIdsNext, game.carHeights, game.prevCarHeights, game.carPitch);
  buildings.update(now / 1000);
  overlay.update(now / 1000);
  renderer.render(scene, camera);
});
