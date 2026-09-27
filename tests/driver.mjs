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

const Ctl = await import('../src/roads/control.ts');
const { crossingApproaches } = await import('../src/roads/crossings.ts');
const { vehicleLength } = await import('../src/sim/trafficSpace.ts');
test('at a red light the first car stops behind the painted stop line, off the zebra', () => {
  Math.random = C.mulberry32(26);
  const net = new N.Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], N.KIND_AVENUE);
  net.insertPath([{ x: 40, z: 30 }, { x: 40, z: 50 }], N.KIND_ROAD);
  const node = net.nearestNode(40, 40, 0.1);
  node.light = true;
  load(net);
  const west = arm(net, 40, 40, 20, 40), east = arm(net, 40, 40, 60, 40);
  const seg = net.segs.get(west.seg), toward = seg.b === node.id;
  const zebra = crossingApproaches(net).get(west.seg)?.[toward ? 1 : 0] ?? 0;
  const line = Ctl.stopLine(net, node.id, zebra);
  let front = -Infinity;
  for (let i = 0; i < 40 * C.SIM_HZ; i++) {
    clock();
    const r = ask(i % 60 === 0 ? [{ a: west.seg, as: west.far, b: east.seg, bs: east.far }] : [], true);
    for (const c of r.detail) {
      if (c.seg !== west.seg || c.v > 0.01) continue;
      const toNode = toward ? seg.len - c.p : c.p;
      if (toNode < 3) front = Math.max(front, -(toNode - vehicleLength(c.vehicle) / 2));
    }
  }
  assert.ok(front > -Infinity, 'a car waited at the light');
  const nose = -front; // how far the stopped car's nose was from the node
  assert.ok(nose >= line - 1e-3 && nose <= line + 0.3, `nose ${nose.toFixed(2)} from the node, line at ${line.toFixed(2)}, zebra ${zebra.toFixed(2)}`);
  assert.ok(nose > zebra + Ctl.ZEBRA_HALF, 'clear of the zebra');
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
  // Braking harder than any driver would: a body the driver model failed to see.
  const lastV = new Map();
  let hard = 0, steps = 0;
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
      const before = lastV.get(c.uid);
      if (before !== undefined) { steps++; if ((before - c.v) * C.SIM_HZ > D.MAX_BRAKE + 0.5) hard++; }
      lastV.set(c.uid, c.v);
      const k = flowOf.get(c.uid);
      if (k === undefined) continue;
      stats[k].cars.add(c.uid);
      if (c.v < 0.3 && (c.li > 0 || c.p > 1.5)) stats[k].stood += 1 / C.SIM_HZ;
    }
  }
  const end = ask([]);
  const got = (f) => (end.trips[`${f.from.seg}>${f.to.seg}`] ?? 0) - (start.trips[`${f.from.seg}>${f.to.seg}`] ?? 0);
  return { flows: flows.map((f, k) => ({ arrived: got(f), wait: stats[k].stood / Math.max(1, stats[k].cars.size) })), gaveUp: end.gaveUp - start.gaveUp, hard, steps };
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
  // Together, since with random arrivals one flow can lose out to another; and every flow moves.
  // (People crossing at its zebras take a little of its capacity.)
  const main = r.flows.slice(0, 4).reduce((t, f) => t + f.arrived, 0);
  assert.ok(main >= 120, `${main} trips on the four main flows`);
  for (const f of r.flows) assert.ok(f.arrived >= 8, `${f.arrived} trips`);
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

test('drivers see what is ahead: no one brakes harder than a car can on a busy signalled avenue crossing', () => {
  Math.random = C.mulberry32(24);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_AVENUE);
  net.insertPath([{ x: 40, z: 16 }, { x: 40, z: 64 }], N.KIND_AVENUE);
  net.nearestNode(40, 40, 0.1).light = true;
  const w = arm(net, 40, 40, 16, 40), e = arm(net, 40, 40, 64, 40), n = arm(net, 40, 40, 40, 16), sth = arm(net, 40, 40, 40, 64);
  const r = run(net, [
    { from: w, to: e, every: 1.2 }, { from: w, to: sth, every: 3 }, { from: w, to: n, every: 3 },
    { from: e, to: w, every: 1.2 }, { from: e, to: n, every: 3 }, { from: n, to: sth, every: 1.5 }, { from: sth, to: e, every: 3 },
  ], 150);
  console.log(`  hard stops: ${r.hard} in ${r.steps} car-steps, ${r.gaveUp} gave up`);
  // A few remain where path-based following and the bodies' real shapes part company (lane tapers,
  // corners): about one car-step in two thousand. This guards against the model going blind again.
  assert.ok(r.hard <= r.steps * 6e-4, `${r.hard} hard stops in ${r.steps} car-steps`);
});

test('a turn pocket on the side street, or a slip road ending at a junction, does not take priority', () => {
  Math.random = C.mulberry32(25);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_ROAD);
  net.insertPath([{ x: 40, z: 40 }, { x: 40, z: 62 }], N.KIND_ROAD);
  const side = net.segsAt(net.nearestNode(40, 40, 0.1).id).find(s => { const o = net.nodes.get(s.a === net.nearestNode(40, 40, 0.1).id ? s.b : s.a); return o.z > 41; });
  if (side.b === net.nearestNode(40, 40, 0.1).id) side.addR = 1; else side.addL = 1;
  net.insertPath([{ x: 40, z: 16 }, { x: 40, z: 40 }], N.KIND_RAMP, true);
  load(net);
  send({ type: 'inspect', tile: 40 * C.GRID + 30, seg: arm(net, 40, 40, 16, 40).seg });
  assert.ok(/major road/.test(inspection.details.find(d => d.startsWith('Eastbound'))), inspection.details.join(' | '));
  send({ type: 'inspect', tile: 50 * C.GRID + 40, seg: side.id });
  assert.ok(/minor road/.test(inspection.details.find(d => d.startsWith('Northbound'))), inspection.details.join(' | '));
  send({ type: 'inspect', tile: 30 * C.GRID + 40, seg: arm(net, 40, 40, 40, 16).seg });
  assert.ok(inspection.details.some(d => /minor road/.test(d)), inspection.details.join(' | '));
  send({ type: 'inspect', tile: -1 });
});

// ---- vehicles that communicate --------------------------------------------------------------------
const { CAR_BRAKE, CAR_LEFT, CAR_RIGHT, CAR_BLUE } = await import('../src/sim/messages.ts');
test('brake lights come on braking for a red and stay on standing; the right indicator before a right turn', () => {
  Math.random = C.mulberry32(31);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_ROAD);
  net.insertPath([{ x: 40, z: 40 }, { x: 40, z: 62 }], N.KIND_ROAD);
  net.nearestNode(40, 40, 0.1).light = true;
  load(net);
  const w = arm(net, 40, 40, 16, 40), e = arm(net, 40, 40, 64, 40), sth = arm(net, 40, 40, 40, 62);
  const seg = net.segs.get(w.seg), toward = seg.b === net.nearestNode(40, 40, 0.1).id;
  let brakingMoving = false, braking0 = false, idleUnlit = false, rightEarly = false, rightFar = false;
  for (let i = 0; i < 60 * C.SIM_HZ; i++) {
    clock();
    const trips = i % 90 === 0 ? [{ a: w.seg, as: w.far, b: e.seg, bs: e.far }] : i % 90 === 45 ? [{ a: w.seg, as: w.far, b: sth.seg, bs: sth.far }] : [];
    for (const c of ask(trips, true).detail) {
      if (c.seg !== w.seg) continue;
      const toNode = toward ? seg.len - c.p : c.p;
      if (c.flags & CAR_BRAKE && c.v > 0.5) brakingMoving = true;
      if (c.flags & CAR_BRAKE && c.v === 0) braking0 = true;
      if (!(c.flags & CAR_BRAKE) && c.v > 2) idleUnlit = true;
      if (c.flags & CAR_RIGHT && toNode < 3.5) rightEarly = true;
      if (c.flags & CAR_RIGHT && toNode > 4.5) rightFar = true;
    }
  }
  assert.ok(brakingMoving, 'lit while slowing');
  assert.ok(braking0, 'lit while standing');
  assert.ok(idleUnlit, 'dark while cruising');
  assert.ok(rightEarly && !rightFar, 'indicating from 3.5 cells out, not before');
});

/** Time for a car from the back of a queue at a red light to reach the far side, and how many queued cars it passed. */
function throughQueue(callout, oncoming = false) {
  Math.random = C.mulberry32(32);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_ROAD);
  net.insertPath([{ x: 40, z: 30 }, { x: 40, z: 50 }], N.KIND_ROAD);
  const node = net.nearestNode(40, 40, 0.1);
  node.light = true;
  load(net);
  const w = arm(net, 40, 40, 16, 40), e = arm(net, 40, 40, 64, 40);
  // A queue builds at the light, then the test vehicle joins its back.
  const arrive = new Map();
  let test = -1, t = 0, start = 0;
  for (let i = 0; i < 90 * C.SIM_HZ; i++) {
    clock(); t += 1 / C.SIM_HZ;
    const trying = test < 0 && i >= 13 * C.SIM_HZ;
    const trips = i < 12 * C.SIM_HZ && i % 45 === 0 ? [{ a: w.seg, as: w.far, b: e.seg, bs: e.far }] : trying ? [{ a: w.seg, as: w.far, b: e.seg, bs: e.far, vehicle: callout ? 5 : 1, callout }] : [];
    // Traffic the other way, which a callout passing on the wrong side must not meet head on.
    if (oncoming && i % 40 === 0) trips.push({ a: e.seg, as: e.far, b: w.seg, bs: w.far });
    const before = new Set(ask([], true).detail.map(c => c.uid));
    const r = ask(trips, true);
    const fresh = r.detail.find(c => !before.has(c.uid));
    if (trying && fresh) { test = fresh.uid; start = t; }
    for (const c of r.detail) if (c.seg === e.seg && !arrive.has(c.uid)) arrive.set(c.uid, t);
  }
  const mine = arrive.get(test);
  return { time: mine - start, passed: [...arrive.entries()].filter(([uid, at]) => uid !== test && uid < test && at > mine).length, gaveUp: ask([]).gaveUp };
}
test('traffic makes way for blue lights: a callout gets through a queue on a single-lane street', () => {
  const plain = throughQueue(false), blue = throughQueue(true);
  console.log(`  through a queue at a red light: an ordinary car ${plain.time.toFixed(1)} s, a callout ${blue.time.toFixed(1)} s, passing ${blue.passed} cars`);
  assert.ok(blue.time < plain.time, 'sooner than a car that waits its turn');
  assert.ok(blue.passed >= 4, 'it passed the cars that pulled over for it');
  assert.equal(plain.passed, 0);
  // With oncoming traffic it waits for a clear stretch before pulling out, and nobody locks head on.
  const busy = throughQueue(true, true);
  console.log(`  with oncoming traffic: a callout ${busy.time.toFixed(1)} s, passing ${busy.passed} cars, ${busy.gaveUp} gave up in all`);
  assert.ok(Number.isFinite(busy.time) && busy.time < 30, 'it gets through');
});

// ---- people crossing ------------------------------------------------------------------------------
/**
 * Run traffic and people through a junction; count the people who crossed, the trips, and any moment a
 * car's body was over someone on a crossing.
 */
function crossingRun(net, flows, seconds, walkRate = 0.15) {
  load(net);
  ask([], false);
  send({ type: 'probe', trips: [], walkRate });
  const start = ask([]);
  const crossed = new Set(), next = flows.map(() => 0);
  let hits = 0, t = 0;
  for (let i = 0; i < seconds * C.SIM_HZ; i++) {
    clock(); t += 1 / C.SIM_HZ;
    const trips = [];
    flows.forEach((f, k) => { if (t >= next[k]) { next[k] += -Math.log(1 - Math.random()) * f.every; trips.push({ a: f.from.seg, as: f.from.far, b: f.to.seg, bs: f.to.far }); } });
    const r = ask(trips, true);
    const w = r.walkers;
    for (let k = 0; k < w.length; k += 5) {
      if (w[k + 3] !== 2) continue;
      crossed.add(w[k + 4]);
      const px = w[k] + C.GRID / 2, pz = w[k + 1] + C.GRID / 2;
      for (const c of r.detail) {
        // In the car's own frame: along its heading, and across it.
        const dx = px - c.x, dz = pz - c.z, sa = Math.sin(c.angle), ca = Math.cos(c.angle);
        const along = dx * sa + dz * ca, across = dx * ca - dz * sa;
        if (Math.abs(along) < 0.2 && Math.abs(across) < 0.13) { hits++; if (process.env.DBG && hits < 8) console.log('HIT t', t.toFixed(2), 'car', JSON.stringify({ seg: c.seg, fwd: c.fwd, p: +c.p.toFixed(2), li: c.li, legs: c.legs, v: +c.v.toFixed(2), box: c.box }), 'walker', w[k + 4], 'along', along.toFixed(2), 'across', across.toFixed(2)); }
      }
    }
  }
  const end = ask([]);
  send({ type: 'probe', trips: [], walkRate: -1 });
  return { crossed: crossed.size, hits, arrived: end.arrived - start.arrived, gaveUp: end.gaveUp - start.gaveUp };
}

test('people cross at the zebras, and cars wait for them: nobody is ever under a car', () => {
  Math.random = C.mulberry32(41);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_ROAD);
  net.insertPath([{ x: 40, z: 40 }, { x: 40, z: 62 }], N.KIND_ROAD);
  const w = arm(net, 40, 40, 16, 40), e = arm(net, 40, 40, 64, 40), sth = arm(net, 40, 40, 40, 62);
  const r = crossingRun(net, [{ from: w, to: e, every: 3 }, { from: e, to: w, every: 3 }, { from: sth, to: w, every: 7 }, { from: w, to: sth, every: 7 }], 150);
  console.log(`  zebras: ${r.crossed} people crossed, ${r.arrived} trips, ${r.gaveUp} gave up, ${r.hits} times a car was over someone`);
  assert.ok(r.crossed >= 30, `${r.crossed} crossed`);
  assert.equal(r.hits, 0);
  assert.ok(r.arrived >= 60 && r.gaveUp <= 2, 'traffic still flows');
});

test('at a signal, people cross on their walk and turning cars give way to them', () => {
  Math.random = C.mulberry32(42);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_AVENUE);
  net.insertPath([{ x: 40, z: 16 }, { x: 40, z: 64 }], N.KIND_ROAD);
  net.nearestNode(40, 40, 0.1).light = true;
  const w = arm(net, 40, 40, 16, 40), e = arm(net, 40, 40, 64, 40), n = arm(net, 40, 40, 40, 16), sth = arm(net, 40, 40, 40, 64);
  const r = crossingRun(net, [{ from: w, to: e, every: 2 }, { from: e, to: w, every: 2 }, { from: w, to: sth, every: 5 }, { from: n, to: e, every: 5 }, { from: sth, to: n, every: 5 }], 150);
  console.log(`  signal: ${r.crossed} people crossed, ${r.arrived} trips, ${r.gaveUp} gave up, ${r.hits} times a car was over someone`);
  assert.ok(r.crossed >= 30, `${r.crossed} crossed`);
  assert.equal(r.hits, 0);
  assert.ok(r.arrived >= 80 && r.gaveUp <= 3, 'traffic still flows');
});

test('a wide avenue with busy zebras: cars wait for people but are not starved, and nobody is hit', () => {
  const build = () => {
    const net = new N.Network();
    net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_AVENUE);
    net.insertPath([{ x: 40, z: 16 }, { x: 40, z: 64 }], N.KIND_ROAD);
    for (const sg of net.segs.values()) if (sg.kind === N.KIND_AVENUE) { sg.addR = 2; sg.addL = 2; }
    net.version++;
    return net;
  };
  const flows = (net) => {
    const w = arm(net, 40, 40, 16, 40), e = arm(net, 40, 40, 64, 40), n = arm(net, 40, 40, 40, 16), sth = arm(net, 40, 40, 40, 64);
    return [{ from: w, to: e, every: 2 }, { from: e, to: w, every: 2 }, { from: w, to: sth, every: 5 }, { from: e, to: n, every: 5 }, { from: n, to: e, every: 5 }, { from: sth, to: w, every: 5 }];
  };
  Math.random = C.mulberry32(43);
  const a = build(), none = crossingRun(a, flows(a), 200, 0);
  Math.random = C.mulberry32(43);
  const b = build(), busy = crossingRun(b, flows(b), 200, 0.15);
  console.log(`  wide avenue: ${none.arrived} trips without people, ${busy.arrived} with ${busy.crossed} crossing; ${busy.gaveUp} gave up, ${busy.hits} hits`);
  assert.equal(busy.hits, 0);
  assert.ok(busy.arrived >= none.arrived * 0.6, 'people cost some capacity, not most of it');
  assert.ok(busy.gaveUp <= 5, `${busy.gaveUp} gave up`);
});

// ---- when and where people go ---------------------------------------------------------------------
const Dm = await import('../src/sim/demand.ts');
test('the day has a morning and an evening peak and a quiet night, and the same trips overall', () => {
  let mean = 0;
  for (let k = 0; k < 240; k++) mean += Dm.dayProfile(k / 10) / 240;
  assert.ok(Math.abs(mean - 1) < 0.01, `mean ${mean}`);
  assert.ok(Dm.dayProfile(8) > 1.7 && Dm.dayProfile(17.5) > 1.6, 'peaks');
  assert.ok(Dm.dayProfile(3) < 0.45, 'the small hours');
  const share = (h, p) => { let n = 0; for (let k = 0; k < 1000; k++) if (Dm.purposeAt(h, k / 1000) === p) n++; return n / 1000; };
  assert.ok(share(8, 'work') > 0.7, 'mornings go to work');
  assert.ok(share(17, 'home') > 0.6, 'evenings go home');
  assert.ok(share(13, 'shop') > 0.4, 'middays run errands');
  // Nearer destinations are likelier.
  let near = 0;
  for (let k = 0; k < 1000; k++) if (Dm.pickByDistance([2, 30], k / 1000) === 0) near++;
  assert.ok(near > 750, `${near} of 1000 picked the near one`);
});

test('drivers spread over two routes that cost about the same, and routes still join up after rerouting', () => {
  Math.random = C.mulberry32(51);
  const net = new N.Network();
  net.insertPath([{ x: 8, z: 40 }, { x: 16, z: 40 }], N.KIND_ROAD);
  net.insertPath([{ x: 44, z: 40 }, { x: 52, z: 40 }], N.KIND_ROAD);
  const [north] = net.insertPath([{ x: 16, z: 40 }, { x: 44, z: 40 }], N.KIND_ROAD);
  net.bendSeg(north, 30, 34);
  const [south] = net.insertPath([{ x: 16, z: 40 }, { x: 44, z: 40 }], N.KIND_ROAD);
  net.bendSeg(south, 30, 46);
  load(net);
  const from = arm(net, 16, 40, 8, 40), to = arm(net, 44, 40, 52, 40);
  const segAt = (z) => [...net.segs.values()].find(sg => Math.abs(sg.pts[Math.floor(sg.n / 2) * 2 + 1] - z) < 2 && sg.pts[Math.floor(sg.n / 2) * 2] > 20);
  const n = segAt(37), sth = segAt(43);
  const seen = { n: new Set(), s: new Set() };
  let broken = 0;
  for (let i = 0; i < 100 * C.SIM_HZ; i++) {
    clock();
    const r = ask(i % 45 === 0 ? [{ a: from.seg, as: from.far, b: to.seg, bs: to.far }] : [], true);
    broken = Math.max(broken, r.broken);
    for (const c of r.detail) { if (c.seg === n.id) seen.n.add(c.uid); if (c.seg === sth.id) seen.s.add(c.uid); }
  }
  const total = seen.n.size + seen.s.size;
  console.log(`  two equal routes: ${seen.n.size} north, ${seen.s.size} south`);
  assert.ok(total > 40 && Math.min(seen.n.size, seen.s.size) > total * 0.2, 'both routes used');
  assert.equal(broken, 0);
});

test('a bus stands at its far stop, then drives on and comes back round rather than turning in the road', () => {
  Math.random = C.mulberry32(52);
  const net = new N.Network();
  net.insertPath([{ x: 10, z: 40 }, { x: 60, z: 40 }], N.KIND_ROAD);
  load(net);
  const sg = [...net.segs.values()][0];
  ask([{ a: sg.id, as: 2, b: sg.id, bs: 40, vehicle: 4, loop: true }]);
  let stood = 0, maxP = 0, back = false;
  for (let i = 0; i < 60 * C.SIM_HZ; i++) {
    clock();
    const r = ask([], true), bus = r.detail[0];
    if (!bus) break;
    if (bus.fwd) { maxP = Math.max(maxP, bus.p); if (bus.v < 0.01 && Math.abs(bus.p - 40) < 0.1) stood += 1 / C.SIM_HZ; }
    else back = true;
  }
  // On to the dead end, where it turns round, and not round in the middle of the road at the stop.
  assert.ok(maxP > 45, `went on to ${maxP.toFixed(1)}`);
  assert.ok(stood >= 2.5, `stood ${stood.toFixed(1)} s`);
  assert.ok(back, 'and then drove back');
});

test('a bus calls at stops on its kerb side, standing in the lay-by while traffic passes it', () => {
  Math.random = C.mulberry32(53);
  const net = new N.Network();
  net.insertPath([{ x: 10, z: 40 }, { x: 60, z: 40 }], N.KIND_ROAD);
  load(net);
  const sg = [...net.segs.values()][0];
  // One stop on the right going out (a→b), one on the right coming back.
  send({ type: 'probe', stops: [{ a: sg.id, as: 20, side: 1 }, { a: sg.id, as: 30, side: -1 }] });
  ask([{ a: sg.id, as: 2, b: sg.id, bs: 45, vehicle: 4, loop: true }]);
  let busUid = -1, stoodOut = 0, stoodBack = 0, maxSide = 0, passed = new Set(), hard = 0, t = 0, next = 0.3, done = false;
  const lastV = new Map(), behind = new Set();
  for (let i = 0; i < 90 * C.SIM_HZ && !done; i++) {
    clock(); t += 1 / C.SIM_HZ;
    const trips = t >= next && t < 40 ? [{ a: sg.id, as: 1, b: sg.id, bs: 47 }] : [];
    if (trips.length) next += 1.4;
    const r = ask(trips, true);
    if (busUid < 0) busUid = r.detail.find(c => c.vehicle === 4)?.uid ?? -1;
    const bus = r.detail.find(c => c.uid === busUid);
    if (!bus && busUid >= 0 && t > 5) done = true;
    for (const c of r.detail) {
      const before = lastV.get(c.uid);
      if (before !== undefined && (before - c.v) * C.SIM_HZ > D.MAX_BRAKE + 0.5) hard++;
      lastV.set(c.uid, c.v);
      if (!bus || c.uid === busUid || !c.fwd || !bus.fwd) continue;
      // Cars that were behind the standing bus and are now past it.
      if (bus.v < 0.01 && Math.abs(bus.p - 20) < 0.1) {
        if (c.p < bus.p - 0.5) behind.add(c.uid);
        else if (c.p > bus.p + 0.5 && behind.has(c.uid)) passed.add(c.uid);
      }
    }
    if (!bus) continue;
    if (bus.fwd && bus.v < 0.01 && Math.abs(bus.p - 20) < 0.1) { stoodOut += 1 / C.SIM_HZ; maxSide = Math.max(maxSide, bus.side); }
    if (!bus.fwd && bus.v < 0.01 && Math.abs(bus.p - (sg.len - 30)) < 0.1) stoodBack += 1 / C.SIM_HZ;
  }
  console.log(`  bus stops: stood ${stoodOut.toFixed(1)} s out (${maxSide.toFixed(2)} off its lane), ${stoodBack.toFixed(1)} s back; ${passed.size} cars passed it; ${hard} hard stops`);
  assert.ok(stoodOut >= 1.8, `stood ${stoodOut.toFixed(1)} s at the stop on the way out`);
  assert.ok(stoodBack >= 1.8, `stood ${stoodBack.toFixed(1)} s at the stop on the way back`);
  assert.ok(maxSide > 0.27, `pulled ${maxSide.toFixed(2)} into the bay`);
  assert.ok(passed.size >= 1, 'traffic passed the bus in its bay');
  assert.equal(hard, 0, 'nobody braked hard for it pulling out');
  assert.ok(done, 'and it finished its run');
});

const { busLaneSpan } = await import('../src/roads/busLanes.ts');
test('in a queue, a bus in a lay-by is let out rather than left waiting', () => {
  for (const seed of [3, 4, 5]) {
    Math.random = C.mulberry32(seed);
    const net = new N.Network();
    net.insertPath([{ x: 10, z: 40 }, { x: 60, z: 40 }], N.KIND_ROAD);
    net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], N.KIND_ROAD);
    net.nearestNode(40, 40, 0.1).light = true;
    load(net);
    const w = arm(net, 40, 40, 10, 40), e = arm(net, 40, 40, 60, 40), n = arm(net, 40, 40, 40, 20);
    const ws = net.segs.get(w.seg);
    send({ type: 'probe', stops: [{ a: w.seg, as: w.inbound ? ws.len - 2.5 : 2.5, side: w.inbound ? 1 : -1 }] });
    let t = 0, next = 0, busUid = -1, inBay = 0, gone = false;
    for (let i = 0; i < 80 * C.SIM_HZ && !gone; i++) {
      clock(); t += 1 / C.SIM_HZ;
      const trips = [];
      if (t >= next && !(t > 9 && busUid === -1)) { next += 0.4; trips.push({ a: w.seg, as: w.far, b: Math.random() < 0.5 ? n.seg : e.seg, bs: 2 }); }
      if (t > 10 && busUid === -1) trips.push({ a: w.seg, as: w.inbound ? 1 : ws.len - 1, b: e.seg, bs: e.far, vehicle: 4, loop: true });
      const r = ask(trips, true);
      if (busUid < 0) busUid = r.detail.find(c => c.vehicle === 4)?.uid ?? -1;
      const bus = r.detail.find(c => c.uid === busUid);
      if (busUid >= 0 && !bus) gone = true;
      if (bus?.inBay) inBay += 1 / C.SIM_HZ;
      if (bus && bus.seg !== w.seg) break; // out of the street: done with the stop
    }
    console.log(`  queue, seed ${seed}: ${inBay.toFixed(1)} s in the lay-by`);
    // The stop is just short of a light: its queue may stand beside the bus until the green, but the bus
    // gets out within a cycle or two, and is never given up on.
    assert.ok(!gone, `seed ${seed}: the bus was given up on`);
    assert.ok(inBay > 1.5 && inBay < 45, `seed ${seed}: ${inBay.toFixed(1)} s in the lay-by`);
  }
});

test('the way back from a far stop goes round, not round in the junction ahead', () => {
  Math.random = C.mulberry32(55);
  const net = new N.Network();
  net.insertPath([{ x: 10, z: 40 }, { x: 40, z: 40 }], N.KIND_ROAD);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], N.KIND_ROAD);
  load(net);
  const sg = [...net.segs.values()].find(s => s.pts[1] === 40 && s.pts[s.pts.length - 1] === 40);
  ask([{ a: sg.id, as: 2, b: sg.id, bs: 20, vehicle: 4, loop: true }]);
  const seen = [];
  for (let i = 0; i < 90 * C.SIM_HZ; i++) {
    clock();
    const bus = ask([], true).detail[0];
    if (!bus) break;
    const k = `${bus.seg}:${bus.fwd}`;
    if (seen.at(-1) !== k) seen.push(k);
  }
  assert.ok(seen.length > 2 && seen[1].split(':')[0] !== String(sg.id), `route ${seen.join(' ')}`);
});

test('a two-lane roundabout: first exits keep to the outer lane, others use the inner, side by side', () => {
  Math.random = C.mulberry32(56);
  const net = new N.Network();
  net.insertPath([{ x: 14, z: 40 }, { x: 66, z: 40 }], N.KIND_AVENUE);
  net.insertPath([{ x: 40, z: 14 }, { x: 40, z: 66 }], N.KIND_AVENUE);
  assert.ok(net.addRoundabout(40, 40, N.ROUNDABOUT_RADIUS[N.KIND_AVENUE], N.KIND_AVENUE));
  load(net);
  const ring = new Set([...net.segs.values()].filter(q => q.oneway && net.nodes.get(q.a).ring && net.nodes.get(q.b).ring).map(q => q.id));
  const end = (x, z) => { const nd = net.nearestNode(x, z, 0.1), sg = net.segsAt(nd.id)[0]; return { seg: sg.id, far: sg.a === nd.id ? 0.6 : sg.len - 0.6 }; };
  const arms = [end(14, 40), end(40, 14), end(66, 40), end(40, 66)];
  const start = ask([]);
  let t = 0, laneSteps = [0, 0], sideBySide = 0, broken = 0, hard = 0;
  const lastV = new Map(), first = new Set(), innerFirst = new Set();
  const next = arms.map(() => 0);
  for (let i = 0; i < 150 * C.SIM_HZ; i++) {
    clock(); t += 1 / C.SIM_HZ;
    const trips = [];
    arms.forEach((a, k) => { if (t >= next[k]) { next[k] += -Math.log(1 - Math.random()) * 1.4; trips.push({ a: a.seg, as: a.far, b: arms[(k + 1 + Math.floor(Math.random() * 3)) % 4].seg, bs: 1 }); } });
    const r = ask(trips, true);
    broken = Math.max(broken, r.broken ?? 0);
    const onRing = r.detail.filter(c => ring.has(c.seg));
    for (const c of onRing) laneSteps[c.lane]++;
    for (const c of onRing) if (c.lane === 0 && onRing.some(o => o.seg === c.seg && o.lane === 1 && Math.abs(o.p - c.p) < 0.3)) sideBySide++;
    for (const c of r.detail) { const b = lastV.get(c.uid); if (b !== undefined && (b - c.v) * C.SIM_HZ > D.MAX_BRAKE + 0.5) hard++; lastV.set(c.uid, c.v); }
  }
  const done = ask([]).arrived - start.arrived, gave = ask([]).gaveUp - start.gaveUp;
  console.log(`  two-lane roundabout: ${done} through, ${gave} gave up; ring lanes ${laneSteps[0]} outer / ${laneSteps[1]} inner car-steps, ${sideBySide} side by side; ${hard} hard stops`);
  // A first exit is a short way round, so the outer lane holds its cars for less time than the inner.
  assert.ok(laneSteps[0] > 0.1 * (laneSteps[0] + laneSteps[1]) && laneSteps[1] > 0.3 * (laneSteps[0] + laneSteps[1]), 'both ring lanes carry traffic');
  assert.ok(sideBySide > 50, 'cars circulate side by side');
  assert.ok(done >= 140, `${done} through`);
  assert.ok(gave <= 5, `${gave} gave up`);
  assert.equal(broken, 0);
});

test('a ramp gets a lane of its own: exiting traffic takes it, traffic going on stays out of it', () => {
  Math.random = C.mulberry32(57);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 76 }, { x: 16, z: 20 }], N.KIND_HIGHWAY2);
  const exit = net.insertPath([{ x: 16, z: 60 }, { x: 17.5, z: 55 }, { x: 21, z: 51.5 }, { x: 30, z: 50 }], N.KIND_RAMP);
  const entry = net.insertPath([{ x: 30, z: 44 }, { x: 21, z: 43.5 }, { x: 17.5, z: 41 }, { x: 16, z: 37 }], N.KIND_RAMP);
  net.addRampLanes([...exit, ...entry]);
  const widened = [...net.segs.values()].filter(q => q.addR || q.addL);
  assert.equal(widened.length, 2, 'the carriageway widened before the exit and after the entrance');
  load(net);
  const byEnd = (x, z) => { const nd = net.nearestNode(x, z, 0.1), sg = net.segsAt(nd.id)[0]; return { seg: sg.id, s: sg.a === nd.id ? 0.6 : sg.len - 0.6 }; };
  const south = byEnd(16, 76), north = byEnd(16, 20), off = byEnd(30, 50), on = byEnd(30, 44);
  const before = widened.find(q => Math.max(net.nodes.get(q.a).z, net.nodes.get(q.b).z) > 59);
  let t = 0, exitIn0 = 0, exitSteps = 0, onIn0 = 0, onSteps = 0, hard = 0;
  const kind = new Map(), lastV = new Map();
  const start = ask([]);
  const next = [0, 0, 0];
  for (let i = 0; i < 150 * C.SIM_HZ; i++) {
    clock(); t += 1 / C.SIM_HZ;
    const trips = [], who = [];
    if (t >= next[0]) { next[0] += -Math.log(1 - Math.random()) * 1.5; trips.push({ a: south.seg, as: south.s, b: north.seg, bs: north.s }); who.push('on'); }
    if (t >= next[1]) { next[1] += -Math.log(1 - Math.random()) * 3; trips.push({ a: south.seg, as: south.s, b: off.seg, bs: off.s }); who.push('exit'); }
    if (t >= next[2]) { next[2] += -Math.log(1 - Math.random()) * 3; trips.push({ a: on.seg, as: on.s, b: north.seg, bs: north.s }); who.push('in'); }
    const known = new Set(ask([], true).detail.map(c => c.uid));
    const r = ask(trips, true);
    r.detail.filter(c => !known.has(c.uid)).forEach((c, k) => kind.set(c.uid, who[k]));
    for (const c of r.detail) {
      const b = lastV.get(c.uid); if (b !== undefined && (b - c.v) * C.SIM_HZ > D.MAX_BRAKE + 0.5) hard++; lastV.set(c.uid, c.v);
      // Over the last two cells before the exit, on the widened piece.
      if (c.seg !== before.id) continue;
      const along = c.fwd ? c.p : before.len - c.p;
      if (along < before.len - 2) continue;
      if (kind.get(c.uid) === 'exit') { exitSteps++; if (c.lane === 0) exitIn0++; }
      if (kind.get(c.uid) === 'on') { onSteps++; if (c.lane === 0) onIn0++; }
    }
  }
  const end = ask([]);
  const got = (a, b) => (end.trips[`${a.seg}>${b.seg}`] ?? 0) - (start.trips[`${a.seg}>${b.seg}`] ?? 0);
  console.log(`  ramp lanes: exiting in its lane ${exitIn0}/${exitSteps}, going on in it ${onIn0}/${onSteps}; ${got(south, off)} off, ${got(south, north)} through, ${got(on, north)} on; ${hard} hard stops, ${end.gaveUp - start.gaveUp} gave up`);
  assert.ok(exitIn0 >= exitSteps * 0.9, 'exiting traffic is in the exit lane before the exit');
  assert.ok(onIn0 <= onSteps * 0.1, 'traffic going on keeps out of it');
  // Every trip starts at one of two points, so how many of each get away there is noisy: this checks
  // that all three movements flow, not how evenly.
  assert.ok(got(south, off) >= 15 && got(on, north) >= 25 && got(south, north) >= 45, 'all three movements flow');
  assert.ok(hard <= 5, `${hard} hard stops`);
  assert.ok(end.gaveUp - start.gaveUp <= 2);
});

/** An avenue meeting a side street on its right, with or without bus lanes: through traffic, kerbside turners and buses. */
function busLaneRun(lanes) {
  Math.random = C.mulberry32(54);
  const net = new N.Network();
  net.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], N.KIND_AVENUE);
  net.insertPath([{ x: 40, z: 40 }, { x: 40, z: 64 }], N.KIND_ROAD);
  for (const s of net.segs.values()) if (s.kind === N.KIND_AVENUE && lanes) s.bus = true;
  const w = arm(net, 40, 40, 16, 40), e = arm(net, 40, 40, 64, 40), sth = arm(net, 40, 40, 40, 64);
  load(net);
  const wSeg = net.segs.get(w.seg), span = busLaneSpan(net, wSeg, w.inbound) ?? { from: 0.3, to: wSeg.len - 2.5 };
  let t = 0, carSteps = 0, inBus = 0, busSteps = 0, busInLane = 0;
  const next = [0, 0, 0];
  const start = ask([]);
  for (let i = 0; i < 150 * C.SIM_HZ; i++) {
    clock(); t += 1 / C.SIM_HZ;
    const trips = [];
    if (t >= next[0]) { next[0] += -Math.log(1 - Math.random()) * 1.6; trips.push({ a: w.seg, as: w.far, b: e.seg, bs: e.far }); }
    if (t >= next[1]) { next[1] += -Math.log(1 - Math.random()) * 5; trips.push({ a: w.seg, as: w.far, b: sth.seg, bs: sth.far }); }
    if (t >= next[2]) { next[2] += 12; trips.push({ a: w.seg, as: w.far, b: e.seg, bs: e.far, vehicle: 4 }); }
    const r = ask(trips, true);
    for (const c of r.detail) {
      if (c.seg !== w.seg || c.fwd !== w.inbound) continue;
      if (c.p < span.from + 1 || c.p > span.to) continue; // a car just turned in may still be moving out
      if (c.vehicle === 4) { busSteps++; if (c.lane === 0) busInLane++; }
      else { carSteps++; if (c.lane === 0 && !c.changing) inBus++; }
    }
  }
  const end = ask([]);
  const got = (a, b) => (end.trips[`${a.seg}>${b.seg}`] ?? 0) - (start.trips[`${a.seg}>${b.seg}`] ?? 0);
  return { span, carSteps, inBus, busSteps, busInLane, through: got(w, e), turned: got(w, sth), gaveUp: end.gaveUp - start.gaveUp };
}

test('bus lanes: only buses use the kerb lane along the span, kerbside turners still get there, traffic still flows', () => {
  const plain = busLaneRun(false), bus = busLaneRun(true);
  console.log(`  bus lane: ${bus.inBus} of ${bus.carSteps} car-steps in it (${plain.inBus} of ${plain.carSteps} in the kerb lane without), buses in it ${bus.busInLane} of ${bus.busSteps}; ${bus.through} through (${plain.through} without), ${bus.turned} turned kerbside (${plain.turned}), ${bus.gaveUp} gave up`);
  assert.ok(bus.span.from < 1 && bus.span.to > 5, JSON.stringify(bus.span));
  assert.ok(bus.inBus <= bus.carSteps * 0.01, `${bus.inBus} car-steps in the bus lane`);
  assert.ok(bus.busInLane >= bus.busSteps * 0.8, `buses in their lane ${bus.busInLane} of ${bus.busSteps}`);
  assert.ok(bus.turned >= plain.turned * 0.7, `${bus.turned} turned kerbside against ${plain.turned}`);
  assert.ok(bus.through >= plain.through * 0.85, `${bus.through} through against ${plain.through}`);
  assert.ok(bus.gaveUp <= 3);
});

console.log(`${checks} driver checks passed; ${failures} failed`);
if (failures) process.exit(1);
