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
const { Network, HALF_WIDTH } = await import('../src/roads/network.ts');
const { crossingApproaches } = await import('../src/render/crossings.ts');
const { RoadLayer } = await import('../src/render/roads.ts');
const { RiverLayer } = await import('../src/render/river.ts');
const { generateTerrain } = await import('../src/terrain.ts');
function junction(kind = 0, length = 10) {
  const net = new Network(), n = net.addNode(40, 40);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const arm = net.addNode(40 + dx * length, 40 + dz * length);
    net.addSeg(n.id, arm.id, 40 + dx * length / 2, 40 + dz * length / 2, kind);
  }
  return { net, n };
}
for (const kind of [0, 1, 2]) {
  const { net, n } = junction(kind);
  n.light = false;
  const crossings = crossingApproaches(net);
  assert.equal(crossings.size, 4, 'uncontrolled ordinary crossroads get four crossings');
  for (const [id, ends] of crossings) {
    assert.ok(ends[0] - 0.17 > HALF_WIDTH[kind], 'paint clears the perpendicular carriageway');
    assert.ok(ends[0] + 0.22 <= net.segs.get(id).len * 0.45, 'paint stays clear of opposite crossing');
  }
  n.light = true;
  assert.deepEqual(crossingApproaches(net), crossings, 'signals do not govern crossing visibility');
  n.ring = true;
  assert.equal(crossingApproaches(net).size, 0, 'no crossings on circulating ring');
}
assert.equal(crossingApproaches(junction(3).net).size, 0, 'no highway crossings');
assert.equal(crossingApproaches(junction(1, 2).net).size, 0, 'short wide blocks skip unsafe paint');
for (const structure of [1, 2]) {
  const { net } = junction();
  [...net.segs.values()][0].structure = structure;
  assert.equal(crossingApproaches(net).size, 0, 'bridge/tunnel junctions are excluded');
}
const terrain = generateTerrain(123);
for (const kind of [0, 1, 2, 3]) {
  const ring = new Network();
  assert.ok(ring.addRoundabout(40, 40, 3.5, kind));
  const layer = new RoadLayer();
  layer.rebuild(ring, terrain);
  const island = layer.group.children[1];
  const vertices = island.geometry.attributes.position;
  const roundabout = ring.roundabouts()[0];
  const radius = roundabout.r - HALF_WIDTH[kind] - 0.12;
  assert.ok(vertices.count > 0, 'roundabout includes fountain and trees');
  for (let i = 0; i < vertices.count; i++) {
    assert.ok(Math.hypot(vertices.getX(i) - roundabout.x + 40, vertices.getZ(i) - roundabout.z + 40) < radius,
      'all decorative vertices stay inside the island');
  }
  assert.equal(crossingApproaches(ring).size, 0, 'ring arcs never receive zebra crossings');
  let oldDisposed = false;
  island.geometry.addEventListener('dispose', () => { oldDisposed = true; });
  ring.version++;
  layer.rebuild(ring, terrain);
  assert.ok(oldDisposed, 'island rebuild disposes previous decoration geometry');
}
const { net } = junction();
const roads = new RoadLayer();
roads.rebuild(net, terrain);
let disposed = false;
roads.mesh.geometry.addEventListener('dispose', () => { disposed = true; });
net.version++;
roads.rebuild(net, terrain);
assert.ok(disposed, 'road rebuild disposes previous geometry');
assert.equal(roads.group.children.length, 6, 'fixed mesh count independent of network size');
const river = new RiverLayer();
river.rebuild(terrain);
const water = river.group.children.find(m => m.material?.opacity === 0.84);
assert.ok(water?.material.transparent && !water.material.depthWrite, 'water blends over opaque bed without blocking later effects');
assert.equal(water.renderOrder, -1);
const bank = river.group.children.find(m => m !== water && !m.isInstancedMesh);
const wp = water.geometry.attributes.position, bp = bank.geometry.attributes.position;
assert.equal(bp.count, wp.count * 2, 'bed is merged into the existing bank geometry');
for (let i = 0; i < wp.count; i++) assert.ok(wp.getY(i) > bp.getY(i + wp.count), 'riverbed is below water at every sample');
let bankDisposed = false;
bank.geometry.addEventListener('dispose', () => { bankDisposed = true; });
river.rebuild(terrain);
assert.ok(bankDisposed, 'river rebuild disposes old merged bank/bed');
console.log('Street and river render geometry checks passed.');
