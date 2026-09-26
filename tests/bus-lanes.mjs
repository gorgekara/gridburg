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
const { canAddBusLane, busLaneOn, busLaneCost } = await import('../src/roads/lanes.ts');
const { busLaneSpan, busBays, BUS_BAY } = await import('../src/roads/busLanes.ts');
const { stopLine, SOLID_STRETCH } = await import('../src/roads/control.ts');
const { crossingApproaches } = await import('../src/roads/crossings.ts');
const { BusLaneLayer } = await import('../src/render/busLanes.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { encode, decode } = await import('../src/save.ts');
const { N_TILES, GRID, T_BUS } = await import('../src/constants.ts');
const { Network } = N;

let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const straight = (kind, x0 = 10, x1 = 40, z = 20) => { const net = new Network(); net.insertPath([{ x: x0, z }, { x: x1, z }], kind); return net; };

test('which roads can have bus lanes: two lanes or more in a direction', () => {
  let net = straight(N.KIND_AVENUE), s = [...net.segs.values()][0];
  assert.ok(canAddBusLane(s, net), 'an avenue');
  assert.equal(busLaneCost(s), Math.ceil(s.len * 10));
  net = straight(N.KIND_ROAD); s = [...net.segs.values()][0];
  assert.equal(canAddBusLane(s, net), false, 'a plain street');
  s.addR = 1;
  assert.ok(canAddBusLane(s, net), 'a street with a lane added one way');
  s.bus = true;
  assert.ok(busLaneOn(net, s, true) && !busLaneOn(net, s, false), 'only the direction with two lanes gets one');
  net = straight(N.KIND_LANE); assert.equal(canAddBusLane([...net.segs.values()][0], net), false, 'a narrow lane');
  net = straight(N.KIND_RAMP); assert.equal(canAddBusLane([...net.segs.values()][0], net), false, 'a ramp');
  net = new Network(); net.addRoundabout(40, 40, 3, N.KIND_AVENUE);
  const arc = [...net.segs.values()].find(q => q.oneway && net.nodes.get(q.a).ring && net.nodes.get(q.b).ring);
  assert.equal(canAddBusLane(arc, net), false, 'a roundabout');
});

test('the flag is kept through saves and splits, and dropped when the lanes go', () => {
  const net = straight(N.KIND_AVENUE), s = [...net.segs.values()][0];
  s.bus = true;
  const back = Network.fromPlain(net.toPlain());
  assert.equal([...back.segs.values()][0].bus, true);
  const data = { seed: 1, kind: new Uint8Array(N_TILES), level: new Uint8Array(N_TILES), net: net.toPlain(), money: 1000, tick: 0, tax: 9 };
  const decoded = decode(encode(data));
  assert.ok(decoded);
  assert.equal([...Network.fromPlain(decoded.net).segs.values()][0].bus, true, 'through the save file');
  const plain = straight(N.KIND_AVENUE);
  const again = decode(encode({ ...data, net: plain.toPlain() }));
  assert.equal([...Network.fromPlain(again.net).segs.values()][0].bus, undefined, 'absent when never set');
  const split = net.splitSeg(s.id, 0.5);
  assert.ok(split.left.bus && split.right.bus, 'both pieces of a split road');
  const street = straight(N.KIND_ROAD), st = [...street.segs.values()][0];
  st.addR = 1; st.addL = 1; st.bus = true;
  const [id] = street.addLaneRange(st.id, 0, st.len, 1, -1);
  const [id2] = street.addLaneRange(id, 0, street.segs.get(id).len, -1, -1);
  assert.equal(street.segs.get(id2).bus, undefined, 'gone with the second lane');
});

test('the span starts past the junction behind and stops short of the stop line ahead', () => {
  const net = new Network();
  net.insertPath([{ x: 10, z: 20 }, { x: 50, z: 20 }], N.KIND_AVENUE);
  net.insertPath([{ x: 30, z: 20 }, { x: 30, z: 40 }], N.KIND_ROAD);
  for (const s of net.segs.values()) if (s.kind === N.KIND_AVENUE) s.bus = true;
  const centre = net.nearestNode(30, 20, 0.1);
  const west = net.segsAt(centre.id).find(s => Math.min(net.nodes.get(s.a).x, net.nodes.get(s.b).x) < 20);
  const toward = west.b === centre.id;
  const zeb = crossingApproaches(net).get(west.id) ?? [0, 0];
  const inbound = busLaneSpan(net, west, toward), outbound = busLaneSpan(net, west, !toward);
  const line = stopLine(net, centre.id, zeb[toward ? 1 : 0]);
  assert.ok(Math.abs(inbound.to - (west.len - line - SOLID_STRETCH - BUS_BAY)) < 1e-6, `ends ${inbound.to} of ${west.len}`);
  assert.ok(inbound.from < 0.5, 'from a dead end, nearly at once');
  assert.ok(outbound.from > line, `starts ${outbound.from} past the junction`);
  // Through a node joining only two roads, spans join up.
  const through = straight(N.KIND_AVENUE, 10, 50);
  const whole = [...through.segs.values()][0];
  whole.bus = true;
  const parts = through.splitSeg(whole.id, 0.5);
  const first = busLaneSpan(through, parts.left, true), second = busLaneSpan(through, parts.right, true);
  assert.ok(Math.abs(first.to - parts.left.len) < 1e-6 && second.from === 0, 'running on through the node');
});

test('the renderer paints each span, a lay-by at a stop by a street, and a stand at one on a bus lane', () => {
  const net = new Network();
  net.insertPath([{ x: 10, z: 20 }, { x: 50, z: 20 }], N.KIND_AVENUE);
  net.insertPath([{ x: 30, z: 20 }, { x: 30, z: 40 }], N.KIND_ROAD);
  net.insertPath([{ x: 10, z: 50 }, { x: 50, z: 50 }], N.KIND_ROAD);
  for (const s of net.segs.values()) if (s.kind === N.KIND_AVENUE) s.bus = true;
  const kind = new Uint8Array(N_TILES);
  const raster = rasterize(net);
  // A stop south of the street at z = 50, and one south of the avenue.
  const streetStop = 51 * GRID + 20, avenueStop = 21 * GRID + 20;
  kind[streetStop] = T_BUS; kind[avenueStop] = T_BUS;
  assert.ok(raster.accSeg[streetStop] >= 0 && raster.accSeg[avenueStop] >= 0, 'both stops reach a road');
  const layer = new BusLaneLayer();
  layer.rebuild(net, kind, raster);
  assert.equal(layer.marks.busLanes, 4, 'two avenue segments, both ways');
  assert.equal(layer.marks.busBays, 1, 'the street stop gets a lay-by');
  assert.equal(layer.marks.busStands, 1, 'the avenue stop stands in its bus lane');
  const bays = busBays(net, kind, raster.accSeg, raster.accS, T_BUS);
  const bay = bays.find(b => !b.inLane);
  assert.ok(bay.outer > bay.edge + 0.2, `the lay-by is ${(bay.outer - bay.edge).toFixed(2)} deep`);
  assert.ok(bay.fwd === (bay.side > 0), 'it serves the traffic whose kerb it is on');
  const geo = layer.group.children[0].geometry;
  layer.rebuild(net, kind, raster);
  assert.equal(layer.group.children[0].geometry, geo, 'unchanged, the geometry is kept');
});

console.log(`${checks} bus lane checks passed; ${failures} failed`);
if (failures) process.exit(1);
