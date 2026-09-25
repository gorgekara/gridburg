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
const { Network, KIND_ROAD } = await import('../src/roads/network.ts');
const { snapPoint } = await import('../src/roads/snap.ts');
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
/** A single east-west street from (20, 30) to (30, 30), with a dead end at each side. */
function street() {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  return net;
}

test('an existing node wins over everything else', () => {
  const net = street();
  const s = snapPoint(net, { x: 30.4, z: 30.3 });
  assert.ok(near(s.x, 30) && near(s.z, 30));
  assert.equal(s.label, 'Join');
  assert.ok(s.node !== undefined);
});

test('a point beside a road connects to the road', () => {
  const s = snapPoint(street(), { x: 25.2, z: 30.5 });
  assert.ok(near(s.z, 30, 0.02) && near(s.x, 25.2, 0.05));
  assert.equal(s.label, 'Connect');
});

test('the line straight on from a dead end catches a point just off it', () => {
  const s = snapPoint(street(), { x: 35.3, z: 30.35 });
  assert.equal(s.label, 'Straight');
  assert.ok(near(s.z, 30), `z ${s.z}`);
  assert.ok(near(s.x, 35.3, 0.01));
  assert.ok(s.guides.length >= 1);
});

test('a line square to the road through its end is a guide as well', () => {
  const s = snapPoint(street(), { x: 30.3, z: 36 });
  assert.equal(s.label, 'Perpendicular');
  assert.ok(near(s.x, 30), `x ${s.x}`);
});

test('from a start point the heading steps in 15 degrees and whole units', () => {
  const net = new Network();
  const a = 37 * Math.PI / 180;
  const s = snapPoint(net, { x: 10 + Math.cos(a) * 6.3, z: 10 + Math.sin(a) * 6.3 }, { from: { x: 10, z: 10 }, heading: { x: 1, z: 0 } });
  const got = Math.atan2(s.z - 10, s.x - 10) * 180 / Math.PI;
  assert.ok(near(got, 30, 1e-6), `angle ${got}`);
  assert.ok(near(Math.hypot(s.x - 10, s.z - 10), 6), 'length rounds to a whole unit');
  assert.match(s.label, /30°/);
});

test('without a heading the steps are measured from the map axes', () => {
  const s = snapPoint(new Network(), { x: 15, z: 14.6 }, { from: { x: 10, z: 10 } });
  const got = Math.atan2(s.z - 10, s.x - 10) * 180 / Math.PI;
  assert.ok(near(got, 45, 1e-6), `angle ${got}`);
});

test('grid snap puts points back on tile centres', () => {
  const s = snapPoint(new Network(), { x: 12.2, z: 17.9 }, { grid: true });
  assert.deepEqual([s.x, s.z], [12.5, 17.5]);
});

test('holding free leaves the point where it is, but still joins roads', () => {
  const net = street();
  const raw = snapPoint(net, { x: 35.3, z: 30.35 }, { free: true, from: { x: 30, z: 30 }, heading: { x: 1, z: 0 } });
  assert.deepEqual([raw.x, raw.z], [35.3, 30.35]);
  assert.equal(raw.label, null);
  assert.equal(snapPoint(net, { x: 30.3, z: 30.2 }, { free: true }).label, 'Join');
});

test('excluded nodes and roads are ignored, so a dragged node does not snap to itself', () => {
  const net = street();
  const end = net.nearestNode(30, 30, 0.1);
  const seg = [...net.segs.values()][0];
  const s = snapPoint(net, { x: 30.3, z: 30.2 }, { excludeNodes: new Set([end.id]), excludeSegs: new Set([seg.id]), free: true });
  assert.deepEqual([s.x, s.z], [30.3, 30.2]);
});

test('turning joins off skips nodes and roads, for choosing a bend', () => {
  const s = snapPoint(street(), { x: 25.2, z: 30.4 }, { joins: false, free: true });
  assert.deepEqual([s.x, s.z], [25.2, 30.4]);
});

test('two guide lines crossing make a stronger snap than either alone', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 25 }], KIND_ROAD);
  // Straight on from (30, 30) east, and straight on from (40, 25) south, meet at (40, 30).
  const s = snapPoint(net, { x: 40.4, z: 30.3 });
  assert.equal(s.label, 'Guide ×');
  assert.ok(near(s.x, 40) && near(s.z, 30), `${s.x}, ${s.z}`);
});

console.log(`${checks} road snap checks passed; ${failures} failed`);
if (failures) process.exit(1);
