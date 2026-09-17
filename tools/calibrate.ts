/**
 * What load does the sandbox actually run at? The demo city is the reference a new scenario is
 * sized against: it is the game's own idea of a city worth looking at, jams and all.
 *
 *   npm run calibrate
 */
import { N_TILES, T_COM, T_IND, T_RES, mulberry32 } from '../src/constants';
import { rasterize } from '../src/roads/raster';
import { Network } from '../src/roads/network';
import { demoCity } from '../src/demo';
import type { MainToWorker, Stats, WorkerToMain } from '../src/sim/messages';

Math.random = mulberry32(12345);
const states: Stats[] = [];
const shim = {
  postMessage(m: WorkerToMain): void { if (m.type === 'state') states.push(m.stats); },
  onmessage: null as null | ((ev: { data: MainToWorker }) => void),
};
(globalThis as unknown as { self: typeof shim }).self = shim;
await import('../src/sim/worker');
const send = (m: MainToWorker): void => shim.onmessage!({ data: m });

const d = demoCity();
const ras = rasterize(Network.fromPlain(d.net));
send({ type: 'speed', value: 0 });
send({ type: 'load', seed: d.seed, level: d.level.slice(), money: d.money, tick: 0, tax: 10, frozen: false,
  kind: d.kind.slice(), net: d.net, serial: 1, cover: ras.cover, accSeg: ras.accSeg, accS: ras.accS });
send({ type: 'warm', ticks: 110 }); // let it grow into a city first
for (let t = 0; t < 150; t++) send({ type: 'warm', ticks: 1, traffic: true });

let res = 0, job = 0;
for (let i = 0; i < N_TILES; i++) {
  if (d.kind[i] === T_RES) res++;
  else if (d.kind[i] === T_COM || d.kind[i] === T_IND) job++;
}
const tail = states.slice(-30);
const avg = (f: (s: Stats) => number): number => tail.reduce((a, s) => a + f(s), 0) / tail.length;
const last = tail[tail.length - 1];
console.log(`demo city: ${res} zoned homes, ${job} zoned workplaces, ${last.roadLength} of road`);
console.log(`           pop ${last.pop}, jobs ${last.jobs}, ${last.buildings} buildings standing`);
console.log(`over the last 30s: commute ${avg((s) => s.commute).toFixed(0)}s  cars ${avg((s) => s.cars).toFixed(0)}`
  + `  flow ${avg((s) => s.flow).toFixed(0)}/min  gave up ${avg((s) => s.gaveUp).toFixed(1)}/s  standstill ${avg((s) => s.stuck).toFixed(0)}`);
console.log('A scenario wants to sit well under this: the demo city is deliberately congested.');
process.exit(0);
