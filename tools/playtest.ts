/**
 * Headless playtest for the scenarios.
 *
 * Runs the real simulation worker in Node with a stubbed `self`, plays each level twice — once
 * untouched and once with a scripted fix — and prints what the goals would read. A level is only
 * worth shipping if the untouched city fails its goals and at least one affordable fix passes them.
 *
 *   npx vite build --ssr tools/playtest.ts --outDir /tmp/gbout && node /tmp/gbout/playtest.js [id]
 */
import { COST_AVENUE, COST_LIGHT, COST_ROAD, COST_ROUNDABOUT, N_TILES, T_COM, T_IND, T_RES, mulberry32 } from '../src/constants';
import { KIND_AVENUE, KIND_ROAD, Network, measurePath } from '../src/roads/network';
import { rasterize } from '../src/roads/raster';
import { SCENARIOS } from '../src/scenarios/defs';
import type { Scenario } from '../src/scenarios/defs';
import { read } from '../src/scenarios/runtime';
import { Site } from '../src/scenarios/build';
import type { MainToWorker, Stats, WorkerToMain } from '../src/sim/messages';
import type { SaveData } from '../src/save';

// Every play starts from the same random stream, so two plays differ only by the fix.
const RNG_SEED = 12345;

const states: Stats[] = [];
const shim = {
  postMessage(m: WorkerToMain): void {
    if (m.type === 'state') states.push(m.stats);
  },
  onmessage: null as null | ((ev: { data: MainToWorker }) => void),
};
(globalThis as unknown as { self: typeof shim }).self = shim;
await import('../src/sim/worker');

let serial = 0;
function send(m: MainToWorker): void {
  shim.onmessage!({ data: m });
}
function payload(net: Network, kind: Uint8Array) {
  const ras = rasterize(net);
  return { kind: kind.slice(), net: net.toPlain(), serial: ++serial, cover: ras.cover, accSeg: ras.accSeg, accS: ras.accS };
}

interface Play { handover: number; stuck: number; commute: number; worstCommute: number; gaveUp: number; orphans: number; flow: number; cars: number; longestHold: number; pop: number; jobs: number }

/** Play a site for `seconds`, then report what the level's goals saw over the last `window`. */
function play(def: Scenario, site: Site, seconds: number, window: number): Play {
  Math.random = mulberry32(RNG_SEED);
  const save = site.toSave(site.budgetLeft);
  states.length = 0;
  send({ type: 'speed', value: 0 });
  send({ type: 'load', seed: save.seed, level: save.level.slice(), money: save.money, tick: 0, tax: 10, frozen: true, ...payload(site.net, save.kind) });
  for (let t = 0; t < seconds; t++) send({ type: 'warm', ticks: 1, traffic: true });
  const handover = states[Math.min(states.length, def.warm) - 1];
  const tail = states.slice(-window);
  let hold = 0, longest = 0;
  for (const s of tail) {
    hold = read(def.goals, s).every((r) => r.ok) ? hold + 1 : 0;
    longest = Math.max(longest, hold);
  }
  const last = tail[tail.length - 1];
  return {
    handover: handover ? handover.commute : 0,
    stuck: Math.max(...tail.map((x) => x.stuck)),
    commute: last.commute,
    worstCommute: Math.max(...tail.map((s) => s.commute)),
    gaveUp: tail.reduce((a, s) => a + s.gaveUp, 0),
    orphans: last.orphans,
    flow: last.flow,
    cars: last.cars,
    longestHold: longest,
    pop: last.pop,
    jobs: last.jobs,
  };
}

// ---- scripted fixes ---------------------------------------------------------------------------
interface Fix { name: string; apply: (site: Site) => number }

const roadCost = (site: Site, pts: [number, number][], kind: number): number => {
  const m = measurePath(pts.map(([a, s]) => site.at(a, s)), site.terrain.water);
  return Math.round((m.len + m.wet * 2) * (kind === KIND_AVENUE ? COST_AVENUE : COST_ROAD));
};
const lay = (site: Site, pts: [number, number][], kind: number): number => {
  const cost = roadCost(site, pts, kind);
  site.road(pts, kind);
  return cost;
};
/**
 * Upgrade to an avenue every street that runs *along* this frame polyline — every sample point of
 * the segment within `r` of it — so widening a corridor does not quietly widen what crosses it.
 */
const widen = (site: Site, pts: [number, number][], r = 1.2): number => {
  const line = pts.map(([a, sd]) => site.at(a, sd));
  const dist = (x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) {
      const ax = line[i].x, az = line[i].z, bx = line[i + 1].x, bz = line[i + 1].z;
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      let u = ((x - ax) * dx + (z - az) * dz) / l2;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      best = Math.min(best, Math.hypot(x - ax - dx * u, z - az - dz * u));
    }
    return best;
  };
  let cost = 0;
  for (const s of site.net.segs.values()) {
    if (s.kind === KIND_AVENUE || s.fixed) continue;
    let along = true;
    for (let i = 0; i <= s.n && along; i++) if (dist(s.pts[i * 2], s.pts[i * 2 + 1]) > r) along = false;
    if (!along) continue;
    s.kind = KIND_AVENUE;
    cost += Math.round((COST_AVENUE - COST_ROAD) * s.len);
  }
  site.net.version++;
  return cost;
};

/** Points every two tiles down a straight frame run, for widening a whole corridor. */
const run = (a0: number, a1: number, side: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let a = a0; a <= a1; a += 2) out.push([a, side]);
  return out;
};
const signal = (site: Site, along: number, side: number): number => {
  const p = site.at(along, side);
  const n = site.net.nearestNode(p.x, p.z, 1.6);
  if (!n || site.net.degree(n.id) < 3 || n.light) throw new Error(`no junction to signal at ${along},${side}`);
  n.light = true;
  site.net.version++;
  return COST_LIGHT;
};
const roundabout = (site: Site, along: number, side: number): number => {
  const p = site.at(along, side);
  const n = site.net.nearestNode(p.x, p.z, 1.6);
  if (!site.net.addRoundabout(n ? n.x : p.x, n ? n.z : p.z, 2.3, KIND_ROAD)) throw new Error(`no room for a roundabout at ${along},${side}`);
  return COST_ROUNDABOUT;
};

const LANE: [number, number][] = [[7, 0], [17, -5], [27, 4], [37, -4], [46, 2], [52, 0]];

const FIXES: Record<string, Fix[]> = {
  'first-mile': [
    { name: 'a link to each district', apply: (s) => lay(s, [[16, 0], [22, -9]], KIND_ROAD) + lay(s, [[16, 0], [22, 9]], KIND_ROAD) },
    { name: 'one road through both', apply: (s) => lay(s, [[16, 0], [22, -9]], KIND_ROAD) + lay(s, [[22, -9], [22, 9]], KIND_ROAD) },
  ],
  crossing: [
    { name: 'widen the bridge only', apply: (s) => widen(s, [[29, 0], [40, 0]]) },
    { name: 'widen bridge and approach', apply: (s) => widen(s, [[7, 0], [40, 0]]) },
    { name: 'a second bridge', apply: (s) => lay(s, [[21, -9], [40, -9]], KIND_ROAD) },
    { name: 'two more bridges', apply: (s) => lay(s, [[21, -9], [40, -9]], KIND_ROAD) + lay(s, [[21, 9], [40, 9]], KIND_ROAD) },
    { name: 'a second bridge as an avenue', apply: (s) => lay(s, [[21, -9], [40, -9]], KIND_AVENUE) },
  ],
  'four-ways': [
    { name: 'a signal on the crossroads', apply: (s) => signal(s, 20, 0) },
    { name: 'a roundabout on the crossroads', apply: (s) => roundabout(s, 20, 0) },
    { name: 'widen the arterial', apply: (s) => widen(s, [[7, 0], [34, 0]]) },
    { name: 'widen the arterial either side', apply: (s) => widen(s, [[16, 0], [25, 0]]) },
    { name: 'a bypass round the crossroads', apply: (s) => lay(s, [[16, 9], [20, 13], [25, 9]], KIND_ROAD) },
    { name: 'bypasses on both sides', apply: (s) => lay(s, [[16, 9], [20, 13], [25, 9]], KIND_ROAD) + lay(s, [[16, -9], [20, -13], [25, -9]], KIND_ROAD) },
  ],
  'long-haul': [
    { name: 'widen the whole lane', apply: (s) => widen(s, LANE, 2.5) },
    { name: 'a straight road to one side', apply: (s) => lay(s, [[16, -9], [46, -9]], KIND_ROAD) },
    { name: 'a straight avenue to one side', apply: (s) => lay(s, [[16, -9], [46, -9]], KIND_AVENUE) },
    { name: 'straight avenues both sides', apply: (s) => lay(s, [[16, -9], [46, -9]], KIND_AVENUE) + lay(s, [[16, 9], [46, 9]], KIND_AVENUE) },
  ],
  'rush-hour': [
    { name: 'signals down the middle', apply: (s) => [[19, 0], [26, 0]].reduce((a, [x, y]) => a + signal(s, x, y), 0) },
    { name: 'the middle street widened', apply: (s) => widen(s, [[12, 0], [33, 0]]) },
    { name: 'middle street plus signals', apply: (s) => widen(s, [[12, 0], [33, 0]]) + [[19, 0], [26, 0]].reduce((a, [x, y]) => a + signal(s, x, y), 0) },
    { name: 'two long streets widened', apply: (s) => widen(s, [[12, 0], [33, 0]]) + widen(s, [[12, 10], [33, 10]]) },
    { name: 'all three long streets widened', apply: (s) => widen(s, [[12, -10], [33, -10]]) + widen(s, [[12, 0], [33, 0]]) + widen(s, [[12, 10], [33, 10]]) },
    { name: 'middle street plus two crossings', apply: (s) => widen(s, [[12, 0], [33, 0]]) + widen(s, [[19, -10], [19, 10]]) + widen(s, [[26, -10], [26, 10]]) },
    { name: 'the cross streets widened', apply: (s) => [12, 19, 26, 33].reduce((a, x) => a + widen(s, [[x, -10], [x, 10]]), 0) },
    { name: 'a roundabout down the middle', apply: (s) => roundabout(s, 19, 0) },
  ],
};




// ---- report -----------------------------------------------------------------------------------
const only = process.argv[2];
const fmt = (p: Play): string =>
  `commute ${p.commute.toFixed(0).padStart(3)}s (at handover ${p.handover.toFixed(0).padStart(3)}s, worst ${p.worstCommute.toFixed(0).padStart(3)}s)  gaveUp ${String(p.gaveUp).padStart(4)}  `
  + `stuck ${String(p.stuck).padStart(3)}  cars ${String(p.cars).padStart(3)}  flow ${String(Math.round(p.flow)).padStart(3)}/min  cutOff ${String(p.orphans).padStart(3)}  held ${String(p.longestHold).padStart(3)}s`;

for (const def of SCENARIOS) {
  if (only && def.id !== only) continue;
  const seconds = def.warm + 110;
  console.log(`\n=== ${def.name} (${def.id})  budget $${def.budget}  par $${def.par}  hold ${def.hold}s`);
  console.log(`    goals: ${def.goals.map((g) => `${g.kind}${g.target ? ' ' + g.target : ''}`).join(', ')}`);

  // The city as the player finds it: it has to fail.
  const found = def.build();
  found.budgetLeft = def.budget;
  const res = found.count(T_RES), com = found.count(T_COM), ind = found.count(T_IND);
  let rw = 0, jw = 0;
  for (let i = 0; i < N_TILES; i++) {
    if (found.kind[i] === T_RES) rw += found.level[i];
    if (found.kind[i] === T_COM) jw += found.level[i] * 1.4;
    if (found.kind[i] === T_IND) jw += found.level[i];
  }
  const base = play(def, found, seconds, 45);
  console.log(`    ${found.net.segs.size} streets;  ${res} homes / ${com} shops / ${ind} works;  pop ${base.pop} jobs ${base.jobs};`
    + `  trips ${(rw * 0.022).toFixed(2)}/s + ${((rw + jw) * 0.005).toFixed(2)}/s from outside`);
  console.log(`    ${'as found'.padEnd(34)} ${' '.repeat(7)} ${fmt(base)}${base.longestHold >= def.hold ? '   << solves itself' : ''}`);

  let cheapest = Infinity;
  for (const fix of FIXES[def.id] ?? []) {
    const site = def.build();
    let spend = 0;
    try {
      spend = fix.apply(site);
    } catch (e) {
      console.log(`    ${fix.name.padEnd(34)} ${(e as Error).message}`);
      continue;
    }
    site.budgetLeft = def.budget - spend;
    const flag = spend <= def.budget ? '' : ' !';
    const p = play(def, site, seconds, 45);
    const solves = spend <= def.budget && p.longestHold >= def.hold;
    if (solves) cheapest = Math.min(cheapest, spend);
    const verdict = spend > def.budget ? '   too dear' : solves ? '   << solves it' : '';
    console.log(`    ${fix.name.padEnd(34)} $${String(spend).padStart(5)}${flag.padEnd(2)} ${fmt(p)}${verdict}`);
  }
  const problems: string[] = [];
  if (base.longestHold >= def.hold) problems.push('the city already meets its goals');
  if (cheapest === Infinity) problems.push('no affordable fix meets them');
  if (cheapest < Infinity && cheapest > def.par) problems.push(`par $${def.par} is under the cheapest fix found ($${cheapest})`);
  console.log(problems.length ? `    NEEDS WORK: ${problems.join('; ')}` : `    ok: fails as found, cheapest fix $${cheapest} against par $${def.par}`);
}
process.exit(0);
