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

console.log(`${checks} driver checks passed; ${failures} failed`);
if (failures) process.exit(1);
