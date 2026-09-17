/** How long does each level's jam take to form? The warm-up has to outlast it. */
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

for (const def of SCENARIOS) {
  Math.random = mulberry32(12345);
  const site = def.build();
  const save = site.toSave(def.budget);
  const ras = rasterize(site.net);
  states.length = 0;
  send({ type: 'speed', value: 0 });
  send({ type: 'load', seed: save.seed, level: save.level.slice(), money: save.money, tick: 0, tax: 10, frozen: true,
    kind: save.kind.slice(), net: save.net, serial: 1, cover: ras.cover, accSeg: ras.accSeg, accS: ras.accS });
  const t0 = Date.now();
  for (let t = 0; t < 240; t++) send({ type: 'warm', ticks: 1, traffic: true });
  const ms = Date.now() - t0;
  const at = (t: number): string => {
    const s = states[t - 1];
    return s ? `${s.commute.toFixed(0)}/${s.gaveUp}` : '-';
  };
  console.log(`${def.id.padEnd(12)} commute/gaveUp at 20s..240s: `
    + [20, 40, 60, 80, 100, 120, 150, 180, 210, 240].map((t) => at(t).padStart(7)).join(' ')
    + `   (240s of traffic took ${ms}ms)`);
}
process.exit(0);
