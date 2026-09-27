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
const N = await import('../src/roads/network.ts');
const L = await import('../src/roads/lanes.ts');
const { RoadLayer } = await import('../src/render/roads.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { encode, decode } = await import('../src/save.ts');
const { N_TILES } = await import('../src/constants.ts');
const { Network } = N;
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const flat = () => ({ water: new Uint8Array(N_TILES), shore: new Uint8Array(N_TILES), height: new Float32Array(N_TILES) });
const street = (kind = N.KIND_ROAD) => { const net = new Network(); net.insertPath([{ x: 10, z: 20 }, { x: 40, z: 20 }], kind); return net; };

test('streets and avenues take a style; highways, lanes and roundabouts do not', () => {
  let net = street(); assert.ok(L.canStyle([...net.segs.values()][0], net));
  net = street(N.KIND_AVENUE); assert.ok(L.canStyle([...net.segs.values()][0], net));
  for (const k of [N.KIND_LANE, N.KIND_HIGHWAY, N.KIND_MOTORWAY, N.KIND_RAMP]) { net = street(k); assert.equal(L.canStyle([...net.segs.values()][0], net), false, `kind ${k}`); }
});

test('a style widens the road each side and pushes the lots back, but the traffic lanes stay put', () => {
  const net = street(), s = [...net.segs.values()][0];
  const lane = L.laneCentre(net, s, true, 0), half = L.sideHalf(s, 1);
  const nearestLot = (r) => { let best = Infinity; for (let i = 0; i < N_TILES; i++) if (r.cell[i] >= 0) best = Math.min(best, Math.abs(r.lotZ[i] - 20)); return best; };
  const plainLot = nearestLot(rasterize(net));
  s.parking = true; s.trees = true;
  assert.ok(Math.abs(L.sideHalf(s, 1) - (half + L.PARK_W + L.TREE_W)) < 1e-9);
  assert.equal(L.laneCentre(net, s, true, 0), lane, 'the lane is where it was');
  assert.ok(nearestLot(rasterize(net)) > plainLot + 0.3, 'the lots beside it stand further back');
});

test('styles survive saves and splits, and drop where the road can no longer take them', () => {
  const net = street(), s = [...net.segs.values()][0];
  s.parking = true; s.trees = true;
  const back = [...Network.fromPlain(net.toPlain()).segs.values()][0];
  assert.ok(back.parking && back.trees);
  const d = decode(encode({ seed: 1, kind: new Uint8Array(N_TILES), level: new Uint8Array(N_TILES), net: net.toPlain(), money: 1000, tick: 0, tax: 9 }));
  const loaded = [...Network.fromPlain(d.net).segs.values()][0];
  assert.ok(loaded.parking && loaded.trees, 'through the save file');
  const split = net.splitSeg(s.id, 0.5);
  assert.ok(split.left.parking && split.right.trees, 'both pieces of a split');
  const up = street(), u = [...up.segs.values()][0];
  u.trees = true;
  u.kind = N.KIND_HIGHWAY;
  assert.equal([...Network.fromPlain(up.toPlain()).segs.values()][0].trees, undefined, 'gone on an expressway');
});

test('the renderer marks parking bays and plants street trees', () => {
  const net = street(), s = [...net.segs.values()][0];
  s.parking = true; s.trees = true;
  const layer = new RoadLayer();
  layer.rebuild(net, flat());
  assert.ok(layer.marks.parkingBays >= 1, 'bays marked');
  assert.ok(layer.marks.streetTrees >= 30, `${layer.marks.streetTrees} street trees`);
});

console.log(`${checks} street style checks passed; ${failures} failed`);
if (failures) process.exit(1);
