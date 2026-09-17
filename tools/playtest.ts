/**
 * Headless playtest for the rush-hour scenarios.
 *
 * Runs the real simulation worker in Node with a stubbed `self` and plays each level's whole shift:
 * once with nobody at the controls, and once for each scripted schedule of interventions, spending
 * only money the level had actually paid out by that second. A level is worth shipping when the
 * abandoned city loses, at least one schedule survives, and surviving takes more than one move.
 *
 *   npm run playtest [id]
 */
import { COST_AVENUE, COST_LIGHT, COST_ROAD, COST_ROUNDABOUT, N_TILES, T_COM, T_IND, T_RES, mulberry32 } from '../src/constants';
import { KIND_AVENUE, KIND_ROAD, Network, measurePath } from '../src/roads/network';
import { rasterize } from '../src/roads/raster';
import { SCENARIOS, totalBudget } from '../src/scenarios/defs';
import type { Scenario } from '../src/scenarios/defs';
import { Run, clock } from '../src/scenarios/runtime';
import { Site } from '../src/scenarios/build';
import type { MainToWorker, Stats, WorkerToMain } from '../src/sim/messages';

// Every play starts from the same random stream, so two plays differ only by what was built.
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

// ---- moves a player could make ----------------------------------------------------------------
interface Move { at: number; what: string; apply: (site: Site) => number }
interface Plan { name: string; moves: Move[] }

const lay = (site: Site, pts: [number, number][], kind: number): number => {
  const m = measurePath(pts.map(([a, s]) => site.at(a, s)), site.terrain.water);
  const cost = Math.round((m.len + m.wet * 2) * (kind === KIND_AVENUE ? COST_AVENUE : COST_ROAD));
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

const road = (at: number, what: string, pts: [number, number][], kind = KIND_ROAD): Move =>
  ({ at, what, apply: (s) => lay(s, pts, kind) });
const wide = (at: number, what: string, pts: [number, number][], r?: number): Move =>
  ({ at, what, apply: (s) => widen(s, pts, r) });

const LANE: [number, number][] = [[7, 0], [17, -5], [27, 4], [37, -4], [46, 2], [52, 0]];

const PLANS: Record<string, Plan[]> = {
  'first-mile': [
    {
      name: 'link both, then widen the spur',
      moves: [
        road(2, 'a road to the estate', [[16, 0], [22, -9]]),
        road(4, 'a road to the business park', [[16, 0], [22, 9]]),
        wide(62, 'widen the spur', [[7, 0], [16, 0]]),
        wide(118, 'widen both links', [[16, 0], [22, -9]]),
      ],
    },
    {
      name: 'link both and nothing more',
      moves: [
        road(2, 'a road to the estate', [[16, 0], [22, -9]]),
        road(4, 'a road to the business park', [[16, 0], [22, 9]]),
      ],
    },
  ],
  crossing: [
    {
      name: 'widen the approach, then a second bridge',
      moves: [
        wide(5, 'widen the approach', [[7, 0], [29, 0]]),
        road(58, 'a second bridge', [[21, -9], [40, -9]]),
        wide(118, 'widen the span', [[29, 0], [40, 0]]),
        road(178, 'a third bridge', [[21, 9], [40, 9]]),
      ],
    },
    {
      name: 'three bridges, no widening',
      moves: [
        road(5, 'a second bridge', [[21, -9], [40, -9]]),
        road(58, 'a third bridge', [[21, 9], [40, 9]]),
        wide(118, 'widen the approach', [[7, 0], [29, 0]]),
        wide(178, 'widen the second bridge', [[21, -9], [40, -9]]),
      ],
    },
    {
      name: 'widen the span and stop',
      moves: [wide(5, 'widen the span', [[29, 0], [40, 0]])],
    },
  ],
  'four-ways': [
    {
      name: 'widen through, then bypass both ways',
      moves: [
        wide(5, 'widen either side of the crossroads', [[16, 0], [25, 0]]),
        road(52, 'a bypass to the north', [[16, 9], [20, 13], [25, 9]]),
        road(107, 'a bypass to the south', [[16, -9], [20, -13], [25, -9]]),
        wide(162, 'widen the whole arterial', [[7, 0], [34, 0]]),
      ],
    },
    {
      name: 'bypasses first, arterial later',
      moves: [
        road(5, 'a bypass to the north', [[16, 9], [20, 13], [25, 9]]),
        road(52, 'a bypass to the south', [[16, -9], [20, -13], [25, -9]]),
        wide(107, 'widen the arterial', [[7, 0], [34, 0]]),
        { at: 162, what: 'a roundabout on the crossroads', apply: (s) => roundabout(s, 20, 0) },
      ],
    },
    {
      name: 'one bypass and nothing more',
      moves: [road(5, 'a bypass to the north', [[16, 9], [20, 13], [25, 9]])],
    },
  ],
  'long-haul': [
    {
      name: 'a straight avenue, then the lane',
      moves: [
        road(5, 'a straight road to the estate', [[16, -9], [46, -9]]),
        wide(58, 'widen it into an avenue', [[16, -9], [46, -9]]),
        wide(118, 'widen the old lane', LANE, 2.5),
        road(178, 'a second straight road', [[16, 9], [46, 9]]),
      ],
    },
    {
      name: 'widen the lane in stages',
      moves: [
        wide(5, 'widen the first half of the lane', [[7, 0], [17, -5], [27, 4]], 2.5),
        wide(58, 'widen the rest of it', LANE, 2.5),
        road(118, 'a straight road to the estate', [[16, -9], [46, -9]]),
        wide(178, 'widen the straight road', [[16, -9], [46, -9]]),
      ],
    },
    {
      name: 'one straight road and nothing more',
      moves: [road(5, 'a straight road to the estate', [[16, -9], [46, -9]])],
    },
  ],
  'rush-hour': [
    {
      name: 'the middle street, then the crossings',
      moves: [
        wide(5, 'widen the middle street', [[12, 0], [33, 0]]),
        wide(58, 'widen a cross street', [[19, -10], [19, 10]]),
        wide(113, 'widen the other cross street', [[26, -10], [26, 10]]),
        wide(173, 'widen the north street', [[12, 10], [33, 10]]),
        wide(233, 'widen the south street', [[12, -10], [33, -10]]),
      ],
    },
    {
      name: 'all three long streets, in order',
      moves: [
        wide(5, 'widen the middle street', [[12, 0], [33, 0]]),
        wide(58, 'widen the north street', [[12, 10], [33, 10]]),
        wide(113, 'widen the south street', [[12, -10], [33, -10]]),
        wide(173, 'widen a cross street', [[19, -10], [19, 10]]),
        wide(233, 'widen the other cross street', [[26, -10], [26, 10]]),
      ],
    },
    {
      name: 'the middle street and nothing more',
      moves: [wide(5, 'widen the middle street', [[12, 0], [33, 0]])],
    },
  ],
};

// ---- playing a shift ----------------------------------------------------------------------------
interface Result {
  outcome: string;
  lostAt: number;
  delivered: number;
  peakJam: number;
  spent: number;
  skipped: string[];
  worstCommute: number;
  gaveUp: number;
  peakStuck: number;
}

/** Play a whole shift, applying `plan`'s moves on the second each is due and only if affordable. */
function play(def: Scenario, plan: Plan | null): Result {
  Math.random = mulberry32(RNG_SEED);
  const site = def.build();
  const save = site.toSave(def.opening);
  states.length = 0;
  send({ type: 'speed', value: 0 });
  send({ type: 'load', seed: save.seed, level: save.level.slice(), money: def.opening, tick: 0, tax: 10, frozen: true, ...payload(site.net, save.kind) });
  send({ type: 'demand', value: def.waves[0].demand }); // after the load, which resets it
  send({ type: 'warm', ticks: def.warm, traffic: true });

  const run = new Run(def);
  for (const s of states) run.update(s);
  let cash = def.opening;
  let spent = 0;
  const moves = [...(plan?.moves ?? [])].sort((a, b) => a.at - b.at);
  const skipped: string[] = [];
  let worstCommute = 0, gaveUp = 0, peakStuck = 0;

  for (let t = 0; t <= def.duration && run.outcome === 'running'; t++) {
    // Anything due this second, paid for out of what the level has handed over so far.
    while (moves.length && moves[0].at <= t) {
      const m = moves.shift()!;
      const before = site.net.version;
      let cost = 0;
      try {
        cost = m.apply(site);
      } catch (e) {
        skipped.push(`${m.what}: ${(e as Error).message}`);
        continue;
      }
      if (cost > cash) {
        skipped.push(`${m.what}: $${cost} with $${Math.round(cash)} in hand`);
        continue;
      }
      if (site.net.version === before) continue;
      cash -= cost;
      spent += cost;
      send({ type: 'edit', spent: cost, ...payload(site.net, save.kind) });
    }
    states.length = 0;
    send({ type: 'warm', ticks: 1, traffic: true });
    for (const s of states) {
      const ev = run.update(s);
      worstCommute = Math.max(worstCommute, s.commute);
      gaveUp += s.gaveUp;
      peakStuck = Math.max(peakStuck, s.stuck);
      if (ev.wave) {
        cash += ev.wave.grant;
        send({ type: 'demand', value: ev.wave.demand });
        if (ev.wave.grant) send({ type: 'grant', amount: ev.wave.grant });
      }
    }
  }
  return {
    outcome: run.outcome,
    lostAt: run.elapsed,
    delivered: run.delivered,
    peakJam: run.peakJam,
    spent,
    skipped,
    worstCommute,
    gaveUp,
    peakStuck,
  };
}

// ---- report -----------------------------------------------------------------------------------
const only = process.argv[2];
const stars = (def: Scenario, r: Result): number =>
  r.outcome !== 'won' ? 0 : r.delivered >= def.targets[2] ? 3 : r.delivered >= def.targets[1] ? 2 : 1;

const line = (label: string, def: Scenario, r: Result): string => {
  const verdict = r.outcome === 'won' ? `survived, ${stars(def, r)}★` : `LOST at ${clock(r.lostAt)}`;
  return `    ${label.padEnd(38)} ${verdict.padEnd(18)} delivered ${String(r.delivered).padStart(4)}  `
    + `peak jam ${String(Math.round(r.peakJam * 100)).padStart(3)}%  peak stalled ${String(r.peakStuck).padStart(3)}  `
    + `gaveUp ${String(r.gaveUp).padStart(4)}  worst commute ${r.worstCommute.toFixed(0).padStart(3)}s`;
};

for (const def of SCENARIOS) {
  if (only && def.id !== only) continue;
  const site = def.build();
  let rw = 0, jw = 0;
  for (let i = 0; i < N_TILES; i++) {
    if (site.kind[i] === T_RES) rw += site.level[i];
    if (site.kind[i] === T_COM) jw += site.level[i] * 1.4;
    if (site.kind[i] === T_IND) jw += site.level[i];
  }
  console.log(`\n=== ${def.name} (${def.id})  ${clock(def.duration)} shift  $${totalBudget(def)} over ${def.waves.length} waves`);
  console.log(`    waves: ${def.waves.map((w) => `${clock(w.at)} ×${w.demand}${w.grant ? ` +$${w.grant}` : ''}`).join('  ')}`);
  console.log(`    ${site.net.segs.size} streets;  ${site.count(T_RES)} homes / ${site.count(T_COM)} shops / ${site.count(T_IND)} works;`
    + `  trips ${(rw * 0.022).toFixed(2)}/s + ${((rw + jw) * 0.005).toFixed(2)}/s from outside at ×1`);
  console.log(`    stars at ${def.targets.join(' / ')} trips;  gridlock at ${def.gridlock} stalled for ${def.patience}s`);

  const idle = play(def, null);
  console.log(line('nobody at the controls', def, idle));

  let wins = 0, bestDelivered = 0;
  for (const plan of PLANS[def.id] ?? []) {
    const r = play(def, plan);
    console.log(line(plan.name, def, r));
    for (const s of r.skipped) console.log(`      could not afford ${s}`);
    if (r.outcome === 'won') { wins++; bestDelivered = Math.max(bestDelivered, r.delivered); }
  }

  const problems: string[] = [];
  if (idle.outcome === 'won') problems.push('an abandoned city survives the shift');
  if (!wins) problems.push('no schedule survives it');
  if (bestDelivered && bestDelivered < def.targets[2]) problems.push(`nothing reached three stars (best ${bestDelivered} of ${def.targets[2]})`);
  console.log(problems.length ? `    NEEDS WORK: ${problems.join('; ')}` : `    ok: abandoned it loses, ${wins} schedule(s) survive, best ${bestDelivered} delivered`);
}
process.exit(0);
