import './style.css';
import { Game, newCity, randomSeed } from './game';
import { GRID } from './constants';
import { createScene } from './render/scene';
import { RoadLayer } from './render/roads';
import { RiverLayer } from './render/river';
import { BuildingLayer } from './render/buildings';
import { OverlayLayer } from './render/overlay';
import { CarLayer } from './render/cars';
import { Input } from './input';
import { Hud } from './ui/hud';
import { PuzzleUi } from './ui/puzzle';
import { buildScenario, scenarioById } from './scenarios/defs';
import type { Scenario } from './scenarios/defs';
import { Attempt, loadProgress, recordStars } from './scenarios/runtime';
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

/** Point the camera at a spot given in the highway's frame, the way scenarios are laid out. */
function lookAt(along: number, side: number, height = 30, back = 30): void {
  const e = game.terrain.entry;
  const half = GRID / 2;
  const tx = e.x + e.dx * along - e.dz * side - half;
  const tz = e.z + e.dz * along + e.dx * side - half;
  controls.target.set(tx, 0, tz);
  camera.position.set(tx + back * 0.45, height, tz + back);
}

/** The level being played, or null in the sandbox. */
let attempt: Attempt | null = null;

const hud = new Hud(uiRoot, {
  setTool: (t) => input.setTool(t),
  setMode: (m) => input.setMode(m),
  setSpeed: (v) => { game.setSpeed(v); hud.setSpeed(v); },
  setTax: (v) => game.setTax(v),
  newCity: () => {
    leavePuzzles();
    clearLocal();
    history.replaceState(null, '', location.pathname);
    game.load(newCity(randomSeed()));
    hud.setTax(10);
    lookAt(12, -0.5, 30, 30);
    hud.toast('New map. Build out from the highway.');
  },
  demoCity: () => {
    leavePuzzles();
    history.replaceState(null, '', location.pathname);
    game.load(demoCity());
    game.warm(110);
    hud.setTax(10);
    hud.toast('Demo city loaded');
  },
  puzzles: () => puzzles.openPicker(),
  share: async () => {
    const url = attempt ? `${location.origin}${location.pathname}#p=${attempt.def.id}` : shareUrl(game.snapshot());
    try {
      await navigator.clipboard.writeText(url);
      hud.toast(attempt ? 'Link to this puzzle copied' : 'Link copied to clipboard');
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

const puzzles = new PuzzleUi(uiRoot, {
  start: (def) => startPuzzle(def),
  exit: () => {
    leavePuzzles();
    const saved = loadLocal();
    game.load(saved ?? newCity(randomSeed()));
    hud.setTax(game.tax);
    game.setTax(game.tax);
    lookAt(12, -0.5, 30, 30);
  },
});

function startPuzzle(def: Scenario): void {
  attempt = new Attempt(def);
  game.load(buildScenario(def), true);
  // Run the traffic before handing over, so the player arrives to a jam rather than an empty city.
  game.warm(def.warm, true);
  hud.restrict(def.tools);
  hud.setPuzzleMode(true);
  input.allowed = new Set(def.tools);
  input.setTool('none');
  game.setSpeed(1);
  hud.setSpeed(1);
  history.replaceState(null, '', `${location.pathname}#p=${def.id}`);
  lookAt(def.look.along, def.look.side, 32, 34);
  puzzles.begin(attempt);
}

function leavePuzzles(): void {
  if (!attempt) return;
  attempt = null;
  puzzles.end();
  hud.restrict(null);
  hud.setPuzzleMode(false);
  input.allowed = null;
  input.setTool('road');
  history.replaceState(null, '', location.pathname);
}

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
  if (!attempt) return;
  const before = loadProgress()[attempt.def.id] ?? 0;
  const justSolved = attempt.update(game.stats);
  puzzles.render();
  if (justSolved) {
    recordStars(attempt.def.id, attempt.stars);
    puzzles.showResult(attempt, before);
  }
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

/** A puzzle link pasted into the address bar of an open tab changes the hash without reloading. */
window.addEventListener('hashchange', () => {
  const id = location.hash.match(/#p=([a-z0-9-]+)/)?.[1];
  const def = id ? scenarioById(id) : null;
  if (def && def !== attempt?.def) startPuzzle(def);
});

// Boot: a puzzle link > a city link > local save > a fresh random map with the help open.
const puzzleId = location.hash.match(/#p=([a-z0-9-]+)/)?.[1];
const fromPuzzle = puzzleId ? scenarioById(puzzleId) : null;
const fromHash = fromPuzzle ? null : loadFromHash();
const fromLocal = fromPuzzle || fromHash ? null : loadLocal();
if (fromPuzzle) {
  startPuzzle(fromPuzzle);
} else if (fromHash) {
  game.load(fromHash);
  hud.toast('Loaded shared city');
} else if (fromLocal) {
  game.load(fromLocal);
} else {
  if (location.hash.startsWith('#c=')) hud.toast('That link is from an older version and cannot be loaded');
  game.load(newCity(randomSeed()));
  hud.showHelp();
}
if (!fromPuzzle) {
  hud.setTax(game.tax);
  game.setTax(game.tax);
  // Start looking at the highway entry, since that is where every city begins.
  // Aim a little nearer the camera than the road end so it sits above the build menu.
  lookAt(12, -0.5, 30, 30);
}
game.setSpeed(1);

// A scenario is a fresh start every time, so it never touches the sandbox save.
setInterval(() => { if (!attempt) saveLocal(game.snapshot()); }, 5000);
window.addEventListener('beforeunload', () => { if (!attempt) saveLocal(game.snapshot()); });

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
