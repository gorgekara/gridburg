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
const { Network, HALF_WIDTH, canAddBikeLane, bikeLaneCost } = await import('../src/roads/network.ts');
const { BikeLaneLayer } = await import('../src/render/bikeLanes.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { vehicleGeometry } = await import('../src/render/cars.ts');
const { encode, decode } = await import('../src/save.ts');
const { N_TILES, GRID } = await import('../src/constants.ts');
const net = new Network();
const a = net.addNode(10, 10), z = net.addNode(30, 10);
const seg = net.addSeg(a.id, z.id, 20, 10, 0);
assert.ok(canAddBikeLane(seg, net));
assert.equal(bikeLaneCost(seg), 240);
seg.bike = true; seg.calm = true;
const data = { seed: 1, kind: new Uint8Array(N_TILES), level: new Uint8Array(N_TILES), net: net.toPlain(), money: 1000, tick: 0, tax: 9 };
const decoded = decode(encode(data));
assert.ok(decoded);
const loaded = Network.fromPlain(decoded.net);
assert.equal([...loaded.segs.values()][0].bike, true);
const old = net.toPlain(); old.segs[0][5] &= ~64;
assert.equal([...Network.fromPlain(old).segs.values()][0].bike, false);
for (const kind of [2, 3]) { seg.kind = kind; assert.equal(canAddBikeLane(seg, net), false); }
seg.kind = 1;
assert.ok(canAddBikeLane(seg, net));
for (const structure of [1, 2]) { seg.structure = structure; assert.equal(canAddBikeLane(seg, net), false); }
seg.structure = 0; a.ring = true;
assert.equal(canAddBikeLane(seg, net), false);
a.ring = false;
const layer = new BikeLaneLayer(); layer.rebuild(net);
const geo = layer.group.children[0].geometry;
assert.ok(geo.attributes.position.count > 0);
const pos = geo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const offset = Math.abs(pos.getZ(i) + GRID / 2 - 10);
  assert.ok(offset >= HALF_WIDTH[seg.kind] - 0.061, 'track occupies the asphalt edge');
  assert.ok(offset <= HALF_WIDTH[seg.kind] - 0.009, 'track stays inside the curb');
}
// Test actual visual lot footprints after raster shifts, on both road widths and axes.
for (const roadKind of [0, 1]) for (const vertical of [false, true]) {
  const frontageNet = new Network();
  const n0 = frontageNet.addNode(10, 10);
  const n1 = frontageNet.addNode(vertical ? 10 : 30, vertical ? 30 : 10);
  const road = frontageNet.addSeg(n0.id, n1.id, vertical ? 10 : 20, vertical ? 20 : 10, roadKind);
  road.bike = true;
  const raster = rasterize(frontageNet), frontageLayer = new BikeLaneLayer();
  frontageLayer.rebuild(frontageNet);
  const positions = frontageLayer.group.children[0].geometry.attributes.position;
  let shifted = 0;
  const lots = [];
  for (let i = 0; i < N_TILES; i++) if (!raster.cover[i] && raster.accSeg[i] === road.id) {
    const x = raster.lotX[i], z = raster.lotZ[i];
    if (x !== i % GRID + 0.5 || z !== Math.floor(i / GRID) + 0.5) shifted++;
    lots.push([x, z]);
  }
  assert.ok(shifted > 0, 'fixture exercises shifted visual lots');
  let vehicleHalfWidth = 0;
  for (let type = 1; type <= 8; type++) {
    const vehicle = vehicleGeometry(type, 2); vehicle.computeBoundingBox();
    vehicleHalfWidth = Math.max(vehicleHalfWidth, Math.abs(vehicle.boundingBox.min.x), Math.abs(vehicle.boundingBox.max.x));
    vehicle.dispose();
  }
  const outerMotorLane = roadKind === 1 ? 0.64 : 0.18;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + GRID / 2, z = positions.getZ(i) + GRID / 2;
    for (const [lx, lz] of lots) assert.ok(Math.abs(x - lx) >= 0.5 || Math.abs(z - lz) >= 0.5, 'bike paint clears shifted one-tile building sites');
    const offset = Math.abs((vertical ? x : z) - 10);
    assert.ok(offset > outerMotorLane + vehicleHalfWidth, 'bike paint clears rendered motor vehicles on straight roads');
  }
}
layer.rebuild(net);
assert.equal(layer.group.children[0].geometry, geo, 'unchanged network retains geometry');
const split = net.splitSeg(seg.id, 0.5);
assert.equal(split.left.bike, true); assert.equal(split.right.bike, true);
assert.equal(split.left.calm, true); assert.equal(split.right.calm, true);
layer.rebuild(net);
assert.notEqual(layer.group.children[0].geometry, geo);
for (const child of [split.left, split.right]) child.kind = 3;
net.version++; layer.rebuild(net);
assert.equal(layer.group.children[0].geometry.attributes.position.count, 0, 'unsupported upgrades render no bike geometry');
const curved = new Network();
const c0 = curved.addNode(10, 10), c1 = curved.addNode(30, 10);
const curve = curved.addSeg(c0.id, c1.id, 20, 17, 0); curve.bike = true;
layer.rebuild(curved);
assert.ok(layer.group.children[0].geometry.attributes.position.count > 0, 'curves generate lanes');
const midpoint = { x: 0, z: 0, tx: 0, tz: 0 };
Network.poseAt(curve, curve.len / 2, midpoint);
assert.ok(midpoint.z > 13);
const curvePositions = layer.group.children[0].geometry.attributes.position;
let high = -Infinity;
for (let i = 0; i < curvePositions.count; i++) high = Math.max(high, curvePositions.getZ(i) + GRID / 2);
assert.ok(high > 13, 'lane geometry follows curve instead of joining its endpoints');
console.log('Bike lanes: persistence, legacy defaults, unsupported roads, split flags, corridor clearance and geometry caching passed.');
