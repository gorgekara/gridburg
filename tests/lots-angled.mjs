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
const { Network, KIND_ROAD, KIND_AVENUE, HALF_WIDTH } = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { buildingRotation, lotScale } = await import('../src/placement.ts');
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const QUARTER = Math.PI / 2;
const cardinal = (a) => Math.abs(a - Math.round(a / QUARTER) * QUARTER) < 1e-6;

/** The ground footprint of a grown building: a square filling its cell, turned and shrunk to fit. */
function footprintOf(r, i) {
  const x = r.lotX[i], z = r.lotZ[i];
  const yaw = r.face[i], k = lotScale(yaw), h = 0.5 * k;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([u, t]) => [x + u * c + t * s, z - u * s + t * c]);
}
/** Separating-axis test for two convex quads, with a hair of tolerance for squares that just touch. */
function overlap(a, b) {
  for (const poly of [a, b]) for (let i = 0; i < 4; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % 4];
    const nx = z0 - z1, nz = x1 - x0;
    const pa = a.map(([x, z]) => x * nx + z * nz), pb = b.map(([x, z]) => x * nx + z * nz);
    const len = Math.hypot(nx, nz);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-3 * len || Math.max(...pb) <= Math.min(...pa) + 1e-3 * len) return false;
  }
  return true;
}
const lots = (r) => [...Array(C.N_TILES).keys()].filter(i => !r.cover[i] && r.accSeg[i] >= 0);

test('buildings face an angled road at its own angle, and square up when it is nearly straight', () => {
  const a = buildingRotation(Math.sin(0.5), Math.cos(0.5));
  assert.ok(Math.abs(a - 0.5) < 1e-9);
  assert.equal(buildingRotation(Math.sin(0.1), Math.cos(0.1)), 0);
  assert.equal(buildingRotation(1, 0), QUARTER);
  assert.equal(lotScale(0), 1);
  assert.equal(lotScale(QUARTER * 3), 1);
  assert.ok(Math.abs(lotScale(Math.PI / 4) - Math.SQRT1_2) < 1e-9);
});

for (const [name, deg, kind] of [['30° street', 30, KIND_ROAD], ['45° avenue', 45, KIND_AVENUE], ['20° street', 20, KIND_ROAD]]) {
  test(`lots along a ${name} face it without overlapping each other`, () => {
    const net = new Network();
    const t = Math.tan(deg * Math.PI / 180);
    net.insertPath([{ x: 10, z: 10 }, { x: 50, z: 10 + 40 * t }], kind);
    const r = rasterize(net);
    const ids = lots(r);
    assert.ok(ids.length > 60, `${ids.length} lots`);
    const turned = ids.filter(i => !cardinal(r.face[i]));
    assert.ok(turned.length > ids.length * 0.9, `${turned.length} of ${ids.length} lots turned to the road`);
    const feet = new Map(ids.map(i => [i, footprintOf(r, i)]));
    for (const i of ids) for (const j of ids) {
      if (j <= i || Math.abs((i % C.GRID) - (j % C.GRID)) > 2 || Math.abs(Math.floor(i / C.GRID) - Math.floor(j / C.GRID)) > 2) continue;
      assert.ok(!overlap(feet.get(i), feet.get(j)), `lots ${i} and ${j} overlap`);
    }
  });
}

test('curved frontage keeps its lots apart too', () => {
  const net = new Network();
  net.insertPath([{ x: 10, z: 40 }, { x: 30, z: 10 }, { x: 50, z: 40 }], KIND_ROAD);
  const r = rasterize(net);
  const ids = lots(r);
  const feet = new Map(ids.map(i => [i, footprintOf(r, i)]));
  for (const i of ids) for (const j of ids) {
    if (j <= i || Math.abs((i % C.GRID) - (j % C.GRID)) > 2 || Math.abs(Math.floor(i / C.GRID) - Math.floor(j / C.GRID)) > 2) continue;
    assert.ok(!overlap(feet.get(i), feet.get(j)), `lots ${i} and ${j} overlap`);
  }
});

test('streets squared to the grid lay out exactly as they always did', () => {
  const net = new Network();
  net.insertPath([{ x: 10.5, z: 30.5 }, { x: 40.5, z: 30.5 }], KIND_ROAD);
  net.insertPath([{ x: 25.5, z: 15.5 }, { x: 25.5, z: 45.5 }], KIND_ROAD);
  const r = rasterize(net);
  for (const i of lots(r)) {
    const cx = i % C.GRID + 0.5, cz = Math.floor(i / C.GRID) + 0.5;
    assert.ok(r.lotX[i] === cx || r.lotZ[i] === cz, `lot ${i} moved along one axis only`);
    assert.ok(cardinal(r.face[i]));
  }
  // Two rows back from the east-west street, a lot slides forward to its kerb line: the fractional part
  // of its distance beyond the front setback, exactly as before.
  const i = 32 * C.GRID + 15, front = HALF_WIDTH[KIND_ROAD] + 0.09 + 0.5, d = 2;
  assert.ok(Math.abs(r.lotZ[i] - (32.5 - (d - front - Math.floor(d - front)))) < 1e-5, `lotZ ${r.lotZ[i]}`);
});

console.log(`${checks} angled lot checks passed; ${failures} failed`);
if (failures) process.exit(1);
