/**
 * What does each level's city do at each of its wave demands, left exactly as the player finds it?
 *
 * Every wave is played on its own from a fresh load, so the numbers say how much traffic that
 * layout can carry before it stops coping. A wave whose stalled count is already past the level's
 * gridlock figure is one the player cannot possibly ride out untouched, and the wave before it is
 * where the level actually asks its question.
 *
 *   npm run settle
 */
import { mulberry32 } from '../src/constants';
import { rasterize } from '../src/roads/raster';
import { SCENARIOS } from '../src/scenarios/defs';
import type { MainToWorker, Stats, WorkerToMain } from '../src/sim/messages';

const states: Stats[] = [];
const shim = {
  postMessage(m: WorkerToMain): void { if (m.type === 'state') states.push(m.stats); },
  onmessage: null as null | ((ev: { data: MainToWorker }) => void),
};
(globalThis as unknown as { self: typeof shim }).self = shim;
await import('../src/sim/worker');
const send = (m: MainToWorker): void => shim.onmessage!({ data: m });

/** Seconds of traffic at one steady demand: long enough for a queue to build if it is going to. */
const PROBE = 100;

for (const def of SCENARIOS) {
  console.log(`\n=== ${def.name} (${def.id})  gridlock at ${def.gridlock} stalled, shrugs off ${def.tolerated}`);
  for (const w of def.waves) {
    Math.random = mulberry32(12345);
    const site = def.build();
    const save = site.toSave(def.opening);
    const ras = rasterize(site.net);
    states.length = 0;
    send({ type: 'speed', value: 0 });
    send({ type: 'load', seed: save.seed, level: save.level.slice(), money: save.money, tick: 0, tax: 10, frozen: true,
      kind: save.kind.slice(), net: save.net, serial: 1, cover: ras.cover, accSeg: ras.accSeg, accS: ras.accS });
    send({ type: 'demand', value: w.demand }); // after the load, which resets it
    for (let t = 0; t < PROBE; t++) send({ type: 'warm', ticks: 1, traffic: true });
    const tail = states.slice(-30);
    const last = tail[tail.length - 1];
    const stalled = Math.max(...tail.map((s) => s.stuck));
    console.log(`    ${w.name.padEnd(17)} ×${String(w.demand).padEnd(5)} `
      + `commute ${last.commute.toFixed(0).padStart(3)}s  cars ${String(last.cars).padStart(3)}  `
      + `stalled ${String(stalled).padStart(3)}${stalled > def.gridlock ? ' << past gridlock' : stalled > def.tolerated ? ' << queueing' : ''}`);
  }
}
process.exit(0);
