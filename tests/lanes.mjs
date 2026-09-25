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
const { Network, HALF_WIDTH, KIND_ROAD, KIND_AVENUE, KIND_HIGHWAY, KIND_MOTORWAY, KIND_HIGHWAY2, KIND_LANE } = N;
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const centres = (net, s, fwd) => Array.from({ length: L.lanesFor(net, s, fwd) }, (_, i) => +L.laneCentre(net, s, fwd, i).toFixed(3));
function road(kind, oneway = false, pts = [{ x: 20, z: 30 }, { x: 30, z: 30 }]) {
  const net = new Network();
  net.insertPath(pts, kind, oneway);
  return { net, s: [...net.segs.values()][0] };
}

test('default roads keep their lanes exactly where traffic drives today', () => {
  const cases = [[KIND_ROAD, false, [0.18]], [KIND_AVENUE, false, [0.645, 0.215]], [KIND_HIGHWAY, false, [1.1, 0.66, 0.22]],
    [KIND_MOTORWAY, true, [0.44, 0, -0.44]], [KIND_HIGHWAY2, true, [0.25, -0.25]], [KIND_ROAD, true, [0.18, -0.18]], [KIND_LANE, false, [0.1]]];
  for (const [kind, oneway, want] of cases) {
    const { net, s } = road(kind, oneway);
    assert.deepEqual(centres(net, s, true), want, `kind ${kind}`);
    if (!L.oneWay(s)) assert.deepEqual(centres(net, s, false), want, `kind ${kind} back`);
    else assert.equal(L.lanesFor(net, s, false), 0);
    for (const side of [1, -1]) assert.ok(close(L.sideHalf(s, side), HALF_WIDTH[kind]));
  }
});

test('an added lane widens only its own side and adds a lane in that direction', () => {
  const { net, s } = road(KIND_AVENUE);
  s.addR = 1;
  assert.equal(L.lanesFor(net, s, true), 3);
  assert.equal(L.lanesFor(net, s, false), 2);
  assert.ok(close(L.sideHalf(s, 1), 1.29) && close(L.sideHalf(s, -1), 0.86));
  assert.deepEqual(centres(net, s, true), [1.075, 0.645, 0.215]);
  assert.ok(close(L.roadHalf(s), 1.29));
  const one = road(KIND_MOTORWAY, true).s;
  one.addR = 1;
  assert.equal(L.lanesFor(net, one, true), 4);
  assert.deepEqual(centres(net, one, true), [0.88, 0.44, 0, -0.44]);
});

test('lane limits: four each way, six one way, never below one', () => {
  const { s } = road(KIND_AVENUE);
  assert.deepEqual(L.laneLimits(s), { minR: -1, maxR: 2, minL: -1, maxL: 2 });
  const m = road(KIND_MOTORWAY, true).s;
  assert.deepEqual(L.laneLimits(m), { minR: -1, maxR: 3, minL: -1, maxL: 3 });
  m.addR = 3;
  assert.equal(L.laneLimits(m).maxL, 0);
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_LANE);
  assert.equal(L.canAddLanes([...net.segs.values()][0], net), false);
});

test('a wider stretch tapers into its narrower neighbour at a plain node', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_AVENUE);
  net.insertPath([{ x: 30, z: 30 }, { x: 40, z: 30 }], KIND_AVENUE);
  const [a, b] = [...net.segs.values()].sort((p, q) => net.nodes.get(p.a).x - net.nodes.get(q.a).x);
  // b runs 30 -> 40 or 40 -> 30; widen the side that faces +z (south) on both, seen from its own direction.
  const southOf = (s) => (net.nodes.get(s.b).x > net.nodes.get(s.a).x ? 1 : -1);
  if (southOf(b) > 0) b.addR = 1; else b.addL = 1;
  const t = L.laneTapers(net);
  const at30 = net.nodes.get(b.a).x === 30 ? 0 : b.len;
  const side = southOf(b);
  assert.ok(close(L.edgeAt(b, side, at30, t), 0.86, 1e-3), 'meets the neighbour at its width');
  const mid = b.len / 2;
  assert.ok(close(L.edgeAt(b, side, mid, t), 1.29, 1e-3), 'full width away from the node');
  assert.ok(close(L.edgeAt(b, -side, at30, t), 0.86, 1e-3), 'the other side is untouched');
  assert.ok(close(L.edgeAt(a, side, a.len / 2, t), 0.86, 1e-3));
});

test('lanes carry on across a plain node by where they sit, and extra lanes end', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  net.insertPath([{ x: 30, z: 30 }, { x: 40, z: 30 }], KIND_AVENUE);
  const st = [...net.segs.values()].find(s => s.kind === KIND_ROAD), av = [...net.segs.values()].find(s => s.kind === KIND_AVENUE);
  const stFwd = net.nodes.get(st.b).x === 30, avFwd = net.nodes.get(av.a).x === 30;
  assert.deepEqual(L.matchLanes(net, st, stFwd, av, avFwd), [1], "the street lane carries on as the inner lane");
  assert.deepEqual(L.matchLanes(net, av, !avFwd, st, !stFwd), [-1, 0], "the avenue kerb lane ends");
});

/** A four-way crossing at (40, 40) with approach from the west and arms named by compass direction. */
function crossing(kind, westAdd = 0, pocket = false) {
  const net = new Network();
  if (pocket) {
    net.insertPath([{ x: 20, z: 40 }, { x: 34, z: 40 }], kind);
    net.insertPath([{ x: 34, z: 40 }, { x: 40, z: 40 }], kind);
  } else net.insertPath([{ x: 20, z: 40 }, { x: 40, z: 40 }], kind);
  net.insertPath([{ x: 40, z: 40 }, { x: 60, z: 40 }], kind);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 40 }], kind);
  net.insertPath([{ x: 40, z: 40 }, { x: 40, z: 60 }], kind);
  const centre = net.nearestNode(40, 40, 0.1);
  const west = net.segsAt(centre.id).find(s => { const o = net.nodes.get(s.a === centre.id ? s.b : s.a); return o.x < 40; });
  const fwd = west.b === centre.id;
  if (westAdd) { if (fwd) west.addR = westAdd; else west.addL = westAdd; }
  const exitName = (e) => { const s = net.segs.get(e.seg); const o = net.nodes.get(s.a === centre.id ? s.b : s.a); return o.x > 40 ? 'E' : o.z < 40 ? 'N' : 'S'; };
  return { net, centre, west, fwd, exitName };
}
const served = (c, a) => a.serve.map(list => list.map(e => c.exitName(a.exits[e])).join(''));

test('exits run right to left: travelling east, right is south', () => {
  const c = crossing(KIND_ROAD);
  const a = L.approachLanes(c.net, c.centre.id, c.west, c.fwd);
  assert.deepEqual(a.exits.map(c.exitName), ['S', 'E', 'N']);
  assert.ok(a.exits[0].angle > 0 && a.exits[2].angle < 0);
});

test('turn lanes: one lane does everything, two share the middle, three split it up', () => {
  const one = crossing(KIND_ROAD);
  assert.deepEqual(served(one, L.approachLanes(one.net, one.centre.id, one.west, one.fwd)), ['SEN']);
  const two = crossing(KIND_AVENUE);
  assert.deepEqual(served(two, L.approachLanes(two.net, two.centre.id, two.west, two.fwd)), ['SE', 'EN']);
  const three = crossing(KIND_AVENUE, 1);
  assert.deepEqual(served(three, L.approachLanes(three.net, three.centre.id, three.west, three.fwd)), ['S', 'E', 'N']);
});

test('a lane that starts just before the junction is a turn pocket', () => {
  const c = crossing(KIND_ROAD, 0, true);
  // Widen only the short stretch next to the junction, on the kerb side.
  const short = c.net.segsAt(c.centre.id).find(s => s.len < 7);
  const fwd = short.b === c.centre.id;
  if (fwd) short.addR = 1; else short.addL = 1;
  const a = L.approachLanes(c.net, c.centre.id, short, fwd);
  assert.deepEqual(served(c, a), ['S', 'EN']);
});

test('target lanes: right turns keep to the kerb, left turns to the middle', () => {
  const c = crossing(KIND_AVENUE);
  const a = L.approachLanes(c.net, c.centre.id, c.west, c.fwd);
  const [S, E, Nn] = [0, 1, 2];
  assert.deepEqual(a.targets(0, S), [0]);
  assert.deepEqual(a.targets(1, Nn), [1]);
  assert.deepEqual(a.targets(0, E), [0]);
  assert.deepEqual(a.targets(1, E), [1]);
  const narrow = crossing(KIND_ROAD);
  const b = L.approachLanes(narrow.net, narrow.centre.id, narrow.west, narrow.fwd);
  assert.deepEqual(b.targets(0, 1), [0]);
});

test('addLaneRange widens just the dragged stretch and refuses past the limits', () => {
  const { net, s } = road(KIND_AVENUE, false, [{ x: 20, z: 30 }, { x: 40, z: 30 }]);
  const ids = net.addLaneRange(s.id, 5, 12, 1, 1);
  assert.equal(ids.length, 1);
  assert.equal(net.segs.size, 3);
  const mid = net.segs.get(ids[0]);
  assert.equal(mid.addR, 1);
  assert.equal([...net.segs.values()].filter(q => q.addR).length, 1);
  assert.ok(net.addLaneRange(mid.id, 0, mid.len, 1, 1));
  assert.equal(net.addLaneRange(mid.id, 0, mid.len, 1, 1), null, 'no fifth lane');
  assert.ok(net.addLaneRange(mid.id, 0, mid.len, -1, -1));
  assert.equal(net.addLaneRange(mid.id, 0, mid.len, -1, -1), null, 'never below one lane');
});

test('lanes survive splits, reversal, moves and saves', () => {
  const { net, s } = road(KIND_AVENUE, false, [{ x: 20, z: 30 }, { x: 40, z: 30 }]);
  s.addR = 1; s.addL = -1;
  const { left, right } = net.splitSeg(s.id, 0.5);
  assert.ok(left.addR === 1 && right.addL === -1);
  net.reverseSeg(left.id);
  assert.ok(left.addR === -1 && left.addL === 1);
  const back = Network.fromPlain(net.toPlain());
  assert.equal(back.segs.get(right.id).addR, 1);
  assert.equal(back.segs.get(left.id).addL, 1);
  const end = net.nearestNode(40, 30, 0.05);
  const moved = net.segs.get(net.moveNode(end.id, 41, 32)[0]);
  assert.ok(moved.addR === 1 && moved.addL === -1);
});

globalThis.Worker = class { postMessage() {} };
const { encode, decode } = await import('../src/save.ts');
const { Game } = await import('../src/game.ts');
test('binary saves keep lanes, and old saves load with none', () => {
  const g = new Game();
  g.net.insertPath([{ x: 20, z: 30 }, { x: 40, z: 30 }], KIND_AVENUE);
  const s = [...g.net.segs.values()].find(q => q.kind === KIND_AVENUE && !q.fixed);
  s.addL = 2;
  g.flush();
  const snap = decode(encode(g.snapshot()));
  const loaded = Network.fromPlain(snap.net);
  assert.ok([...loaded.segs.values()].some(q => q.addL === 2));
  assert.ok([...loaded.segs.values()].filter(q => q.fixed).every(q => !q.addR && !q.addL));
});

const { RoadLayer } = await import('../src/render/roads.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { generateTerrain } = await import('../src/terrain.ts');
const terrain = generateTerrain(3); terrain.water.fill(0);
/** The asphalt of one segment as drawn: how far it reaches either side of z = 30 (world z −10). */
function asphaltSpan(net, seg) {
  const layer = new RoadLayer();
  layer.rebuild(net, terrain);
  const [a, b] = layer.ranges.get(seg.id), pos = layer.mesh.geometry.attributes.position;
  let lo = Infinity, hi = -Infinity;
  for (let v = a; v < b; v++) { lo = Math.min(lo, pos.getZ(v) + 10); hi = Math.max(hi, pos.getZ(v) + 10); }
  return [-lo, hi];
}

test('a default avenue is drawn as wide as ever; a widened one reaches out on its own side only', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 40, z: 30 }], KIND_AVENUE);
  const seg = [...net.segs.values()][0];
  const rightIsSouth = net.nodes.get(seg.b).x > net.nodes.get(seg.a).x;
  const [l0, r0] = asphaltSpan(net, seg);
  assert.ok(close(l0, 0.86, 1e-3) && close(r0, 0.86, 1e-3), `${l0} ${r0}`);
  if (rightIsSouth) seg.addR = 1; else seg.addL = 1;
  net.version++;
  const [l1, r1] = asphaltSpan(net, seg);
  assert.ok(close(l1, 0.86, 1e-3) && close(r1, 1.29, 1e-3), `${l1} ${r1}`);
});

test('the raster paves the widened side and leaves the other alone', () => {
  const net = new Network();
  net.insertPath([{ x: 20.5, z: 30.5 }, { x: 40.5, z: 30.5 }], KIND_AVENUE);
  const seg = [...net.segs.values()][0];
  const before = rasterize(net).cover;
  if (net.nodes.get(seg.b).x > net.nodes.get(seg.a).x) seg.addR = 2; else seg.addL = 2;
  const after = rasterize(net).cover;
  const at = (x, z) => z * 80 + x;
  assert.equal(before[at(30, 32)], 0);
  assert.equal(after[at(30, 32)], 1, 'south of the road is paved now');
  assert.equal(after[at(30, 28)], before[at(30, 28)], 'north is as it was');
});

test('switching a road between one-way and two-way keeps its lanes within limits', () => {
  const { s } = road(KIND_ROAD);
  s.addR = 3; s.addL = 3;
  s.oneway = true; L.clampLanes(s);
  assert.ok(L.lanesFor(new Network(), s, true) <= 6, 'no more than six one way');
  const av = road(KIND_AVENUE, true).s;
  av.addR = -2;
  av.oneway = false; L.clampLanes(av);
  assert.ok(L.lanesFor(new Network(), av, true) >= 1 && L.lanesFor(new Network(), av, false) >= 1);
});

const { trolleyLaneOffset } = await import('../src/sim/transit.ts');
test('trolleybuses keep to the kerb lane, wherever an added lane puts it', () => {
  const { net, s } = road(KIND_AVENUE);
  assert.ok(close(trolleyLaneOffset(net, s, true), 0.645));
  s.addR = 1;
  assert.ok(close(trolleyLaneOffset(net, s, true), 1.075));
  assert.ok(close(trolleyLaneOffset(net, s, false), 0.645));
});

console.log(`${checks} lane checks passed; ${failures} failed`);
if (failures) process.exit(1);
