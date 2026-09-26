import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier)) {
    const candidate = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(candidate)) return nextResolve(candidate.href, context);
  }
  return nextResolve(specifier, context);
}});
const D = await import('../src/sim/driver.ts');
let failures = 0, checks = 0;
function test(name, run) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const dt = 1 / 30, car = D.driverFor(1);

test('from rest a car pulls away smoothly and settles at its desired speed', () => {
  let p = 0, v = 0, t = 0, prevA = null, t90 = -1;
  while (t < 20) {
    const a = D.idmAccel(v, 3, Infinity, 0, car);
    assert.ok(a <= car.a + 1e-9, 'never harder than its comfortable acceleration');
    if (prevA !== null) assert.ok(a <= prevA + 1e-9, 'acceleration eases off as it gets going');
    prevA = a;
    ({ p, v } = D.stepMotion(p, v, a, dt, Infinity, 3));
    t += dt;
    if (t90 < 0 && v >= 2.7) t90 = t;
  }
  assert.ok(t90 > 1.5 && t90 < 4, `90% of speed after ${t90.toFixed(2)} s`);
  assert.ok(Math.abs(v - 3) < 0.05);
});

test('a car braking for a hold point stops right at it, never past it', () => {
  let p = 0, v = 3;
  const hold = 6;
  for (let i = 0; i < 30 * 15; i++) {
    const a = D.idmAccel(v, 3, hold - p, v, car);
    ({ p, v } = D.stepMotion(p, v, a, dt, hold, 3));
    assert.ok(p <= hold + 1e-9);
  }
  assert.ok(Math.abs(p - hold) < 1e-6, `stopped at ${p}`);
  assert.equal(v, 0);
});

test('behind a slower leader a car settles at its time headway', () => {
  let p = 0, v = 3, lp = 4, lv = 2;
  const jam = 0.42;
  for (let i = 0; i < 30 * 60; i++) {
    lp += lv * dt;
    const a = D.idmAccel(v, 3, lp - jam - p, v - lv, car);
    ({ p, v } = D.stepMotion(p, v, a, dt, lp - jam, 3));
  }
  assert.ok(Math.abs(v - 2) < 0.02, `speed ${v}`);
  const gap = lp - jam - p;
  assert.ok(gap > 2 * car.T * 0.9 && gap < 2 * car.T * 1.6, `gap ${gap.toFixed(3)}`);
});

test('curves and turns: tighter is slower, straight on is no limit', () => {
  assert.ok(D.curveSpeed(1) < D.curveSpeed(4));
  assert.equal(D.turnRadius(0, 0.55), Infinity);
  assert.ok(D.curveSpeed(D.turnRadius(Math.PI / 2, 0.55)) < 1.2);
  assert.ok(Math.abs(D.approachSpeed(1, 0, 2.4) - 1) < 1e-9);
  assert.ok(D.approachSpeed(1, 2, 2.4) > 3);
});

const { Network, KIND_ROAD } = await import('../src/roads/network.ts');
test('a segment\'s tightest radius comes from its curve', () => {
  const net = new Network();
  const [straight] = net.insertPath([{ x: 10, z: 10 }, { x: 30, z: 10 }], KIND_ROAD);
  assert.ok(D.segMinRadius(net.segs.get(straight)) > 1e6);
  const [bent] = net.insertPath([{ x: 10, z: 40 }, { x: 30, z: 40 }], KIND_ROAD);
  const [curved] = net.bendSeg(bent, 20, 46);
  const r = D.segMinRadius(net.segs.get(curved));
  assert.ok(r > 2 && r < 40, `radius ${r}`);
});

// ---- the model in the real worker ---------------------------------------------------------------
const C = await import('../src/constants.ts');
const N = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { defaultExtras } = await import('../src/extras.ts');
let probe = null;
let inspection = null;
globalThis.self = { postMessage: m => { if (m.type === 'probe') probe = m; if (m.type === 'inspection') inspection = m.report; } };
let clock;
const oldInterval = globalThis.setInterval;
globalThis.setInterval = fn => { clock = fn; return 0; };
await import('../src/sim/worker.ts');
globalThis.setInterval = oldInterval;
const send = data => self.onmessage({ data });
Math.random = C.mulberry32(5);
let serial = 1;
function load(net) {
  const r = rasterize(net);
  send({ type: 'load', seed: 7, kind: new Uint8Array(C.N_TILES), level: new Uint8Array(C.N_TILES), rot: new Uint8Array(C.N_TILES),
    money: 1e6, tick: 0, tax: 10, cityLevel: 0, extras: defaultExtras(10), net: net.toPlain(), serial: serial++, cover: r.cover, accSeg: r.accSeg, accS: r.accS });
}
const ask = (trips = [], detail = false) => { send({ type: 'probe', trips, detail }); return probe; };
/** A segment at a node, by the far end's coordinates, with a point near the far end and the direction towards the node. */
function arm(net, cx, cz, fx, fz) {
  const centre = net.nearestNode(cx, cz, 0.1), far = net.nearestNode(fx, fz, 0.1);
  const s = net.segsAt(centre.id).find(q => q.a === far.id || q.b === far.id) ?? net.segsAt(far.id)[0];
  const inbound = s.b === centre.id; // travelling a→b reaches the centre
  return { seg: s.id, far: inbound ? 0.6 : s.len - 0.6, inbound };
}

test('a queue at a red light pulls away one car at a time, at a real discharge rate', () => {
  const net = new N.Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], N.KIND_ROAD);
  net.insertPath([{ x: 40, z: 30 }, { x: 40, z: 50 }], N.KIND_ROAD);
  net.nearestNode(40, 40, 0.1).light = true;
  load(net);
  const west = arm(net, 40, 40, 20, 40), east = arm(net, 40, 40, 60, 40);
  const crossed = new Map();
  let spawned = 0, t = 0;
  for (let i = 0; i < 90 * C.SIM_HZ; i++) {
    clock(); t += 1 / C.SIM_HZ;
    const trips = spawned < 14 ? [{ a: west.seg, as: west.far, b: east.seg, bs: east.far }] : [];
    const before = probe?.cars ?? 0;
    const r = ask(trips, true);
    if (trips.length && r.cars > before) spawned++;
    for (const c of r.detail) if (c.seg === east.seg && !crossed.has(c.uid)) crossed.set(c.uid, t);
  }
  const times = [...crossed.values()].sort((a, b) => a - b);
  assert.ok(times.length >= 12, `${times.length} crossed`);
  // The longest platoon: crossings less than 1.5 s apart, a queue discharging on one green.
  let best = [];
  for (let i = 0, j = 0; i < times.length; i = j) {
    for (j = i + 1; j < times.length && times[j] - times[j - 1] < 1.5; j++);
    if (j - i > best.length) best = times.slice(i, j);
  }
  assert.ok(best.length >= 5, `platoon of ${best.length}; spawned ${spawned}; times ${times.map(x => x.toFixed(1))}`);
  const rate = (best.length - 1) / (best.at(-1) - best[0]);
  console.log(`  queue discharge: ${rate.toFixed(2)} cars/s over a platoon of ${best.length}`);
  assert.ok(rate >= 1.2 && rate <= 2.5, `${rate.toFixed(2)} cars/s`);
});

test('a car slows for a tight bend and for a turn, and goes straight on at speed', () => {
  const net = new N.Network();
  const [bent] = net.insertPath([{ x: 10, z: 20 }, { x: 40, z: 20 }], N.KIND_AVENUE);
  net.bendSeg(bent, 25, 56);
  net.insertPath([{ x: 20, z: 50 }, { x: 60, z: 50 }], N.KIND_AVENUE);
  net.insertPath([{ x: 40, z: 50 }, { x: 40, z: 70 }], N.KIND_AVENUE);
  load(net);
  const speedsOn = (from, to, where) => {
    ask([{ a: from.seg, as: from.far, b: to.seg, bs: to.far }]);
    const seen = [];
    for (let i = 0; i < 40 * C.SIM_HZ; i++) {
      clock();
      const r = ask([], true);
      if (!r.detail.length) break;
      for (const c of r.detail) seen.push(where(c));
    }
    return seen.filter(v => v !== null);
  };
  // The bend: slowest near its middle, against the speed on its gentle ends.
  const bendSeg = [...net.segs.values()].find(s => Math.abs(s.pts[1] - 20) < 0.01 && s.pts[0] < 15);
  const bendRun = speedsOn({ seg: bendSeg.id, far: 0.3 }, { seg: bendSeg.id, far: bendSeg.len - 0.3 }, c => c.seg === bendSeg.id ? c.v : null);
  const peak = Math.max(...bendRun), cap = D.curveSpeed(D.segMinRadius(net.segs.get(bendSeg.id)));
  assert.ok(cap < N.SPEED[N.KIND_AVENUE] * 0.8, `curve allows ${cap.toFixed(2)}`);
  assert.ok(peak <= cap + 1e-3, `bend peak ${peak.toFixed(2)} over its curve speed ${cap.toFixed(2)}`);
  // A right turn at the T against straight on, through the junction.
  const west = arm(net, 40, 50, 20, 50), east = arm(net, 40, 50, 60, 50), south = arm(net, 40, 50, 40, 70);
  const nodeSpeed = (to) => {
    const vs = speedsOn(west, to, c => {
      const s = net.segs.get(c.seg), end = c.fwd ? s.len - c.p : c.p;
      return c.seg === west.seg && end < 0.9 ? c.v : null;
    });
    return Math.min(...vs.slice(-4));
  };
  const straight = nodeSpeed(east), turn = nodeSpeed(south);
  console.log(`  bend peak ${peak.toFixed(2)}; at the node straight ${straight.toFixed(2)}, turning ${turn.toFixed(2)}`);
  assert.ok(turn < straight * 0.7, `turning ${turn.toFixed(2)} vs straight ${straight.toFixed(2)}`);
});

/**
 * Run traffic through a junction at (40, 40): each flow starts a trip every `every` seconds on average. Returns,
 * per flow, the trips that arrived and the mean time its cars stood still (below 0.3 cells/s) once
 * under way, and how many gave up.
 */
function run(net, flows, seconds) {
  load(net);
  const start = ask([]);
  const flowOf = new Map(), still = new Map(), stats = flows.map(() => ({ cars: new Set(), stood: 0 }));
  let t = 0;
  const next = flows.map(() => 0);
  for (let i = 0; i < seconds * C.SIM_HZ; i++) {
    clock(); t += 1 / C.SIM_HZ;
    const trips = [], who = [];
    // Random arrivals, as real traffic has: bunches and gaps, `every` seconds apart on average.
    flows.forEach((f, k) => { if (t >= next[k]) { next[k] += -Math.log(1 - Math.random()) * f.every; trips.push({ a: f.from.seg, as: f.from.far, b: f.to.seg, bs: f.to.far }); who.push(k); } });
    const known = new Set(ask([], true).detail.map(c => c.uid));
    const r = ask(trips, true);
    // New cars belong to the flows that just asked, in order.
    const fresh = r.detail.filter(c => !known.has(c.uid));
    fresh.forEach((c, n) => flowOf.set(c.uid, who[n] ?? who[0]));
    for (const c of r.detail) {
      const k = flowOf.get(c.uid);
      if (k === undefined) continue;
      stats[k].cars.add(c.uid);
      if (c.v < 0.3 && (c.li > 0 || c.p > 1.5)) stats[k].stood += 1 / C.SIM_HZ;
    }
  }
  const end = ask([]);
  const got = (f) => (end.trips[`${f.from.seg}>${f.to.seg}`] ?? 0) - (start.trips[`${f.from.seg}>${f.to.seg}`] ?? 0);
  return { flows: flows.map((f, k) => ({ arrived: got(f), wait: stats[k].stood / Math.max(1, stats[k].cars.size) })), gaveUp: end.gaveUp - start.gaveUp };
}

test('where a street meets an avenue, the avenue has priority and the street waits for gaps', () => {
  Math.random = C.mulberry32(21);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_AVENUE);
  net.insertPath([{ x: 40, z: 40 }, { x: 40, z: 62 }], N.KIND_ROAD);
  const w = arm(net, 40, 40, 16, 40), e = arm(net, 40, 40, 64, 40), sth = arm(net, 40, 40, 40, 62);
  const r = run(net, [
    // A moderate avenue, about 1,000 vehicles an hour in real terms: gaps come often enough to use.
    { from: w, to: e, every: 2.4 }, { from: e, to: w, every: 2.7 },
    // A side street at about 250 vehicles an hour in real terms, within what those gaps can serve.
    { from: sth, to: w, every: 9 }, { from: sth, to: e, every: 9 },
  ], 150);
  const [we, ew, left, right] = r.flows;
  console.log(`  T junction: avenue through ${we.arrived}+${ew.arrived} (standing ${we.wait.toFixed(2)}/${ew.wait.toFixed(2)} s a car), side street ${left.arrived}+${right.arrived} (standing ${left.wait.toFixed(2)}/${right.wait.toFixed(2)} s), ${r.gaveUp} gave up`);
  assert.equal(r.gaveUp, 0);
  assert.ok(we.wait < 0.5 && ew.wait < 0.5, 'avenue traffic barely stops');
  assert.ok(left.wait > we.wait + 0.5 && right.wait > ew.wait, 'side-street traffic waits for gaps');
  assert.ok(left.arrived >= 10 && right.arrived >= 10, "but it all gets through");
});

test('a crossroads of two equal streets has no priority, and keeps flowing', () => {
  Math.random = C.mulberry32(22);
  const net = new N.Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], N.KIND_ROAD);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], N.KIND_ROAD);
  const w = arm(net, 40, 40, 20, 40), e = arm(net, 40, 40, 60, 40), n = arm(net, 40, 40, 40, 20), sth = arm(net, 40, 40, 40, 60);
  const r = run(net, [
    { from: w, to: e, every: 3 }, { from: e, to: w, every: 3 }, { from: n, to: sth, every: 3 }, { from: sth, to: n, every: 3 },
    { from: w, to: sth, every: 7 }, { from: n, to: w, every: 7 },
  ], 150);
  console.log(`  equal crossroads: ${r.flows.map(f => f.arrived).join('/')} trips, ${r.gaveUp} gave up`);
  assert.equal(r.gaveUp, 0);
  for (const f of r.flows.slice(0, 4)) assert.ok(f.arrived >= 35, `${f.arrived} trips`);
});

test('the road inspector reports each direction\'s flow, speed, queue, delay and control', () => {
  Math.random = C.mulberry32(23);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_AVENUE);
  net.insertPath([{ x: 40, z: 40 }, { x: 40, z: 62 }], N.KIND_ROAD);
  const w = arm(net, 40, 40, 16, 40), e = arm(net, 40, 40, 64, 40), sth = arm(net, 40, 40, 40, 62);
  run(net, [{ from: w, to: e, every: 1.5 }, { from: e, to: w, every: 1.5 }, { from: sth, to: w, every: 6 }], 90);
  send({ type: 'inspect', tile: 40 * C.GRID + 30, seg: w.seg });
  assert.ok(inspection, 'a report came back');
  assert.equal(inspection.name, 'Avenue');
  assert.equal(inspection.details.length, 2, 'a line for each direction');
  const toward = inspection.details.find(d => d.startsWith('Eastbound'));
  assert.ok(toward && /major road/.test(toward), toward);
  assert.ok(Number(toward.match(/: (\d+) vehicles\/min/)[1]) > 10, toward);
  send({ type: 'inspect', tile: 50 * C.GRID + 40, seg: sth.seg });
  const side = inspection.details.find(d => d.startsWith('Northbound'));
  assert.ok(side && /minor road/.test(side), side);
  console.log(`  inspector: ${toward} | ${side}`);
  send({ type: 'inspect', tile: -1 });
});

console.log(`${checks} driver checks passed; ${failures} failed`);
if (failures) process.exit(1);
