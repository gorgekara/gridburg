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
const C = await import('../src/constants.ts');
const N = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { defaultExtras } = await import('../src/extras.ts');
const { Network } = N;

// The real worker, run in-process with its clock captured, as the taxi suite does.
let probe = null;
globalThis.self = { postMessage: m => { if (m.type === 'probe') probe = m; } };
let clock;
const oldInterval = globalThis.setInterval;
globalThis.setInterval = fn => { clock = fn; return 0; };
await import('../src/sim/worker.ts');
globalThis.setInterval = oldInterval;
const send = data => self.onmessage({ data });
Math.random = C.mulberry32(99);

let serial = 1;
/** Load a city with nothing but this road network, so the only traffic is what a test sends. */
function load(net) {
  const plain = net.toPlain(), r = rasterize(net);
  send({ type: 'load', seed: 7, kind: new Uint8Array(C.N_TILES), level: new Uint8Array(C.N_TILES), rot: new Uint8Array(C.N_TILES),
    money: 1e6, tick: 0, tax: 10, cityLevel: 0, extras: defaultExtras(10), net: plain, serial: serial++,
    cover: r.cover, accSeg: r.accSeg, accS: r.accS });
}
const ask = (trips) => { send({ type: 'probe', trips }); return probe; };

/** The arms of a junction at (x, z): for each, its segment and the distance just in from its far end. */
function arms(net, x, z) {
  const centre = net.nearestNode(x, z, 0.1);
  return net.segsAt(centre.id).map(s => {
    const farA = s.b === centre.id;
    return { seg: s.id, far: farA ? 0.6 : s.len - 0.6, near: farA ? s.len - 1.5 : 1.5 };
  });
}

/**
 * Run `seconds` of traffic through a crossing, starting a trip from every arm every `every` seconds:
 * mostly straight on, some turning. Returns how many completed and how many gave up.
 */
function crossing(net, seconds, every = 0.4, turnShare = 0.4) {
  load(net);
  const a = arms(net, 40, 40);
  // Order the arms round the junction so "straight on" is the opposite one.
  const centre = net.nearestNode(40, 40, 0.1);
  const angle = (arm) => { const s = net.segs.get(arm.seg); const o = net.nodes.get(s.a === centre.id ? s.b : s.a); return Math.atan2(o.z - centre.z, o.x - centre.x); };
  a.sort((p, q) => angle(p) - angle(q));
  const before = ask([]), start = before.arrived, startGaveUp = before.gaveUp;
  let t = 0, next = 0, near = 0, right = 0;
  for (let i = 0; i < seconds * C.SIM_HZ; i++) {
    clock();
    t += 1 / C.SIM_HZ;
    if (t >= next) {
      next += every;
      const trips = a.map((from, k) => {
        const r = Math.random();
        const to = a[(k + (r < turnShare / 2 ? 1 : r < turnShare ? 3 : 2)) % a.length];
        return { a: from.seg, as: from.far, b: to.seg, bs: to.far };
      });
      const r = ask(trips);
      near += r.nearLine; right += r.rightLane;
    }
  }
  const end = ask([]);
  return { arrived: end.arrived - start, gaveUp: end.gaveUp - startGaveUp, cars: end.cars, lanes: end.lanes, rightShare: near ? right / near : 1 };
}

function cross(kind) {
  const net = new Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], kind);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], kind);
  return net;
}

let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
// Before real lanes (one car in a junction at a time, lanes fixed by slot) these crossings managed
// 235 trips on streets and 286 on avenues in 150 s.
const street = crossing(cross(N.KIND_ROAD), 150);
const avenue = crossing(cross(N.KIND_AVENUE), 150);
console.log(`  street crossing: ${street.arrived} trips in 150 s, ${street.gaveUp} gave up`);
console.log(`  avenue crossing: ${avenue.arrived} trips in 150 s, ${avenue.gaveUp} gave up, ${Math.round(avenue.rightShare * 100)}% in the right lane at the line`);
test('an avenue crossing carries at least half as much again as with one car in the box at a time', () => {
  assert.ok(avenue.arrived >= 1.5 * 286, `${avenue.arrived} trips`);
  assert.ok(avenue.gaveUp <= avenue.arrived * 0.1, `${avenue.gaveUp} gave up`);
});
test('a street crossing is no worse than before', () => {
  assert.ok(street.arrived >= 0.9 * 235, `${street.arrived} trips`);
  assert.ok(street.gaveUp <= street.arrived * 0.1, `${street.gaveUp} gave up`);
});
test('both lanes of an avenue carry traffic', () => {
  for (const [id, counts] of Object.entries(avenue.lanes)) assert.ok((counts[0] ?? 0) > 0 && (counts[1] ?? 0) > 0, `segment ${id}: ${counts}`);
});
test('cars reach a lane that goes their way before the stop line', () => {
  assert.ok(avenue.rightShare >= 0.9, `${Math.round(avenue.rightShare * 100)}%`);
});

console.log(`${checks} lane traffic checks passed; ${failures} failed`);
if (failures) process.exit(1);
