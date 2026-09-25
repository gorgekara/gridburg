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
const { rasterize, lotScaleAt } = await import('../src/roads/raster.ts');
const { buildingRotation, lotScale } = await import('../src/placement.ts');
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const QUARTER = Math.PI / 2;
const cardinal = (a) => Math.abs(a - Math.round(a / QUARTER) * QUARTER) < 1e-6;

/** The ground footprint of a tile's building: its cell (full size) or its shrunk square. */
function footprintOf(r, i) {
  const x = r.lotX[i], z = r.lotZ[i];
  const yaw = r.face[i], h = 0.5 * lotScaleAt(r, i);
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
    if (Math.max(...pa) <= Math.min(...pb) + 0.03 * len || Math.max(...pb) <= Math.min(...pa) + 0.03 * len) return false;
  }
  return true;
}
const cells = (r) => [...Array(C.N_TILES).keys()].filter(i => r.cell[i] >= 0);
function noOverlaps(r, ids) {
  const feet = new Map(ids.map(i => [i, footprintOf(r, i)]));
  for (const i of ids) for (const j of ids) {
    if (j <= i || Math.abs(r.lotX[i] - r.lotX[j]) > 1.5 || Math.abs(r.lotZ[i] - r.lotZ[j]) > 1.5) continue;
    assert.ok(!overlap(feet.get(i), feet.get(j)), `cells ${i} and ${j} overlap`);
  }
}
function offRoads(net, r, ids) {
  for (const i of ids) for (const [x, z] of footprintOf(r, i)) {
    for (const s of net.segs.values()) assert.ok(Network.nearestOn(s, x, z).dist >= HALF_WIDTH[s.kind] - 1e-3, `cell ${i} corner on a road`);
  }
}

test('buildings face an angled road at its own angle, and square up when it is nearly straight', () => {
  const a = buildingRotation(Math.sin(0.5), Math.cos(0.5));
  assert.ok(Math.abs(a - 0.5) < 1e-9);
  assert.equal(buildingRotation(Math.sin(0.1), Math.cos(0.1)), 0);
  assert.equal(lotScale(0), 1);
  assert.ok(Math.abs(lotScale(Math.PI / 4) - Math.SQRT1_2) < 1e-9);
});

test('a grid street lays its three rows of cells exactly where its lots always were', () => {
  const net = new Network();
  net.insertPath([{ x: 10.5, z: 30.5 }, { x: 40.5, z: 30.5 }], KIND_ROAD);
  const r = rasterize(net);
  const front = HALF_WIDTH[KIND_ROAD] + 0.09 + 0.5;
  for (const [row, tz] of [[0, 31], [1, 32], [2, 33], [0, 29], [1, 28]]) {
    const i = tz * C.GRID + 20;
    assert.equal(r.cell[i], row, `row of tile z=${tz}`);
    assert.equal(r.lotX[i], 20.5);
    const want = tz > 30 ? 30.5 + front + row : 30.5 - front - row;
    assert.ok(Math.abs(r.lotZ[i] - want) < 1e-5, `lotZ ${r.lotZ[i]} vs ${want}`);
    assert.ok(cardinal(r.face[i]));
    assert.equal(lotScaleAt(r, i), 1);
  }
  assert.equal(r.cell[34 * C.GRID + 20], -1, 'nothing past the third row');
});

for (const [name, deg, kind] of [['30° street', 30, KIND_ROAD], ['45° avenue', 45, KIND_AVENUE], ['20° street', 20, KIND_ROAD]]) {
  test(`cells along a ${name} stand at full size in rows parallel to it, without overlapping`, () => {
    const net = new Network();
    const t = Math.tan(deg * Math.PI / 180);
    net.insertPath([{ x: 10, z: 10 }, { x: 50, z: 10 + 40 * t }], kind);
    const r = rasterize(net);
    const ids = cells(r);
    const seg = [...net.segs.values()][0];
    for (const i of ids) {
      assert.equal(lotScaleAt(r, i), 1);
      assert.ok(!cardinal(r.face[i]), 'turned to the road');
      const d = Network.nearestOn(seg, r.lotX[i], r.lotZ[i]).dist;
      assert.ok(Math.abs(d - (HALF_WIDTH[kind] + 0.59 + r.cell[i])) < 0.02, `cell ${i} row ${r.cell[i]} at ${d.toFixed(3)}`);
    }
    // Rows are well filled: most of the cells the road's length has room for.
    const perRow = [0, 1, 2].map(row => ids.filter(i => r.cell[i] === row).length);
    const room = 2 * seg.len;
    assert.ok(perRow.every(n => n >= room * 0.8), `rows ${perRow} of ${room.toFixed(0)}`);
    noOverlaps(r, ids);
    offRoads(net, r, ids);
  });
}

test('a curved street and a crossroads keep their cells apart and off the roads', () => {
  const net = new Network();
  net.insertPath([{ x: 10, z: 40 }, { x: 30, z: 10 }, { x: 50, z: 40 }], KIND_ROAD);
  net.insertPath([{ x: 20, z: 60 }, { x: 60, z: 60 }], KIND_AVENUE);
  net.insertPath([{ x: 40, z: 45 }, { x: 40, z: 75 }], KIND_ROAD);
  const r = rasterize(net);
  const ids = cells(r);
  assert.ok(ids.length > 200);
  noOverlaps(r, ids);
  offRoads(net, r, ids);
});

test('every tile holds at most one cell, and each cell sits on or next to its tile', () => {
  const net = new Network();
  net.insertPath([{ x: 10, z: 10 }, { x: 60, z: 37 }], KIND_ROAD);
  const r = rasterize(net);
  for (const i of cells(r)) {
    const cx = i % C.GRID + 0.5, cz = Math.floor(i / C.GRID) + 0.5;
    assert.ok(Math.hypot(r.lotX[i] - cx, r.lotZ[i] - cz) < 1.1, `cell ${i} far from its tile`);
    assert.equal(r.cover[i], 0);
  }
});

const { zoneCellsUnder, ZONE_BRUSH } = await import('../src/roads/raster.ts');
test('a zone brush dragged along a street picks up just the cells it passes over', () => {
  const net = new Network();
  const t = Math.tan(Math.PI / 6);
  net.insertPath([{ x: 10, z: 10 }, { x: 50, z: 10 + 40 * t }], KIND_ROAD);
  const r = rasterize(net);
  const seg = [...net.segs.values()][0];
  // Along the kerb-side row on the right of the road, from 10 to 20 cells along it.
  const picked = new Set();
  const pose = { x: 0, z: 0, tx: 0, tz: 0 };
  for (let d = 10; d <= 20; d += 0.25) {
    Network.poseAt(seg, d, pose);
    const off = HALF_WIDTH[KIND_ROAD] + 0.59;
    for (const i of zoneCellsUnder(r, pose.x - pose.tz * off, pose.z + pose.tx * off, ZONE_BRUSH[0])) picked.add(i);
  }
  assert.ok(picked.size >= 10 && picked.size <= 22, `${picked.size} cells`);
  for (const i of picked) assert.ok(r.cell[i] <= 1, 'a small brush on the front row stays near the kerb');
  assert.equal(zoneCellsUnder(r, 5, 70, 2.8).length, 0, 'no cells away from roads');
});

console.log(`${checks} lot checks passed; ${failures} failed`);
if (failures) process.exit(1);
