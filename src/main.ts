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

const canvas = document.getElementById('c') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const { renderer, scene, camera, controls, update: updateScene } = createScene(canvas);
const river = new RiverLayer();
const roads = new RoadLayer();
const buildings = new BuildingLayer();
const overlay = new OverlayLayer();
const cars = new CarLayer();
scene.add(river.group, overlay.group, roads.group, buildings.group, cars.mesh);

const game = new Game();
const input = new Input(canvas, camera, game, scene);

const hud = new Hud(uiRoot, {
  setTool: (t) => input.setTool(t),
  toggleMode: () => input.setMode(input.mode === 'straight' ? 'curve' : 'straight'),
  setSpeed: (v) => { game.setSpeed(v); hud.setSpeed(v); },
  setTax: (v) => game.setTax(v),
  newCity: () => {
    clearLocal();
    history.replaceState(null, '', location.pathname);
    game.load(newCity(randomSeed()));
    hud.setTax(10);
    hud.toast('New map. Build out from the highway.');
  },
  demoCity: () => {
    history.replaceState(null, '', location.pathname);
    game.load(demoCity());
    game.warm(110);
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
  togglePollution: () => {
    overlay.strong = !overlay.strong;
    overlay.setPollution(game.pollution);
    return overlay.strong;
  },
});

input.onToolChange = (t) => hud.setTool(t);
input.onModeChange = (m) => hud.setMode(m);
input.onToast = (m) => hud.toast(m);
input.onCost = (text, x, y, ok) => hud.setCost(text, x, y, ok);

game.onTerrain = () => river.rebuild(game.terrain);
game.onEdit = () => {
  roads.rebuild(game.net, game.terrain);
  buildings.rebuild(game.kind, game.level, game.raster);
  overlay.setFlags(game.kind, game.level, game.flags);
};
game.onState = () => {
  buildings.rebuild(game.kind, game.level, game.raster);
  overlay.setFlags(game.kind, game.level, game.flags);
  overlay.setPollution(game.pollution);
  river.tint(game.riverPollution);
  hud.update(game.stats);
};
game.onFrame = () => {
  roads.tint(game.segOrder, game.segCong);
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

// Boot: URL link > local save > a fresh random map with the help open.
const fromHash = loadFromHash();
const fromLocal = fromHash ? null : loadLocal();
if (fromHash) {
  game.load(fromHash);
  hud.toast('Loaded shared city');
} else if (fromLocal) {
  game.load(fromLocal);
} else {
  if (location.hash.startsWith('#c=')) hud.toast('That link is from an older version and cannot be loaded');
  game.load(newCity(randomSeed()));
  hud.showHelp();
}
hud.setTax(game.tax);
game.setTax(game.tax);
game.setSpeed(1);

// Start looking at the highway entry, since that is where every city begins.
{
  const e = game.terrain.entry;
  const tx = e.x + e.dx * 14 - 40, tz = e.z + e.dz * 14 - 40;
  controls.target.set(tx, 0, tz);
  camera.position.set(tx + 16, 26, tz + 26);
}

setInterval(() => saveLocal(game.snapshot()), 5000);
window.addEventListener('beforeunload', () => saveLocal(game.snapshot()));

const dbg = { game, camera, controls, input, renderer, frames: 0 };
(window as unknown as { __gridburg: unknown }).__gridburg = dbg;

let last = performance.now();
renderer.setAnimationLoop((now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  dbg.frames++;
  updateScene(dt);
  const span = Math.max(1, game.nextTime - game.prevTime);
  const alpha = Math.max(0, Math.min(1, (performance.now() - game.nextTime) / span));
  cars.update(game.carsPrev, game.carsNext, alpha);
  buildings.update(now / 1000);
  overlay.update(now / 1000);
  renderer.render(scene, camera);
});
