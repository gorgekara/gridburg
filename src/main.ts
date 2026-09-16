import './style.css';
import { Game } from './game';
import { createScene } from './render/scene';
import { RoadLayer } from './render/roads';
import { BuildingLayer } from './render/buildings';
import { CarLayer } from './render/cars';
import { Input } from './input';
import { Hud } from './ui/hud';
import { demoCity } from './demo';
import { blankSave, clearLocal, loadFromHash, loadLocal, saveLocal, shareUrl } from './save';
import type { SaveData } from './save';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const { renderer, scene, camera, update: updateScene } = createScene(canvas);
const roads = new RoadLayer();
const buildings = new BuildingLayer();
const cars = new CarLayer();
scene.add(roads.group, buildings.group, cars.mesh);

const game = new Game();
const input = new Input(canvas, camera, game, scene);

function current(): SaveData {
  return { kind: game.kind, level: game.level, money: game.stats.money, tick: game.stats.tick, tax: game.tax };
}

const hud = new Hud(uiRoot, {
  setTool: (t) => input.setTool(t),
  setSpeed: (v) => { game.setSpeed(v); hud.setSpeed(v); },
  setTax: (v) => game.setTax(v),
  newCity: () => {
    clearLocal();
    history.replaceState(null, '', location.pathname);
    const b = blankSave();
    game.load(b.kind, b.level, b.money, b.tick, b.tax);
    hud.toast('New city. Draw a road to start.');
  },
  demoCity: () => {
    history.replaceState(null, '', location.pathname);
    const d = demoCity();
    game.load(d.kind, d.level, d.money, d.tick, d.tax);
    game.warm(70);
    hud.toast('Demo city loaded');
  },
  share: async () => {
    const url = shareUrl(current());
    try {
      await navigator.clipboard.writeText(url);
      hud.toast('Link copied to clipboard');
    } catch {
      prompt('Copy this link:', url);
    }
    history.replaceState(null, '', url);
  },
});

input.onToolChange = (t) => hud.setTool(t);
input.onToast = (m) => hud.toast(m);

game.onEdit = () => {
  roads.rebuild(game.kind);
  buildings.rebuild(game.kind, game.level);
};
game.onState = () => {
  buildings.rebuild(game.kind, game.level);
  hud.update(game.stats);
};
game.onFrame = () => roads.tint(game.congestion);

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    const v = game.speed === 0 ? 1 : 0;
    game.setSpeed(v);
    hud.setSpeed(v);
  }
});

// Boot: URL link > local save > demo city.
const fromHash = loadFromHash();
const fromLocal = fromHash ? null : loadLocal();
if (fromHash) {
  game.load(fromHash.kind, fromHash.level, fromHash.money, fromHash.tick, fromHash.tax);
  hud.toast('Loaded shared city');
} else if (fromLocal) {
  game.load(fromLocal.kind, fromLocal.level, fromLocal.money, fromLocal.tick, fromLocal.tax);
} else {
  const d = demoCity();
  game.load(d.kind, d.level, d.money, d.tick, d.tax);
  game.warm(70);
  hud.showHelp();
}
game.setTax(game.tax);
game.setSpeed(1);

setInterval(() => saveLocal(current()), 5000);
window.addEventListener('beforeunload', () => saveLocal(current()));

const dbg = { game, camera, input, renderer, frames: 0 };
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
  renderer.render(scene, camera);
});
