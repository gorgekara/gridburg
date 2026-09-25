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
const { Network, KIND_ROAD, KIND_AVENUE, KIND_MOTORWAY } = await import('../src/roads/network.ts');
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const nodeAt = (net, x, z) => net.nearestNode(x, z, 0.05);
const segBetween = (net, p, q) => [...net.segs.values()].find(s => {
  const a = net.nodes.get(s.a), b = net.nodes.get(s.b);
  return (near(a.x, p.x) && near(a.z, p.z) && near(b.x, q.x) && near(b.z, q.z)) || (near(a.x, q.x) && near(a.z, q.z) && near(b.x, p.x) && near(b.z, p.z));
});
const bulge = (net, s) => {
  const a = net.nodes.get(s.a), b = net.nodes.get(s.b);
  const mx = s.pts[(s.n >> 1) * 2], mz = s.pts[(s.n >> 1) * 2 + 1];
  const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
  return Math.hypot(mx - cx, mz - cz);
};

test('moving a dead end across another road makes a junction where they now cross', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 40, z: 30 }], KIND_ROAD);
  net.insertPath([{ x: 30, z: 20 }, { x: 30, z: 25 }], KIND_ROAD);
  const end = nodeAt(net, 30, 25);
  assert.ok(net.moveNode(end.id, 30, 35));
  const junction = nodeAt(net, 30, 30);
  assert.ok(junction, 'crossing became a node');
  assert.equal(net.degree(junction.id), 4);
  assert.ok(nodeAt(net, 30, 35), 'the moved end is where it was dropped');
});

test('dropping a node onto another one merges them', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  net.insertPath([{ x: 30, z: 40 }, { x: 40, z: 40 }], KIND_ROAD);
  const end = nodeAt(net, 30, 30);
  assert.ok(net.moveNode(end.id, 30.3, 39.8));
  const target = nodeAt(net, 30, 40);
  assert.equal(net.degree(target.id), 2);
  assert.equal(net.nodes.size, 3);
});

test('a bent road keeps its bend when one end moves', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 25, z: 25 }, { x: 30, z: 30 }], KIND_ROAD);
  const s0 = [...net.segs.values()][0];
  const before = bulge(net, s0);
  const end = nodeAt(net, 30, 30);
  const ids = net.moveNode(end.id, 32, 30);
  const s1 = net.segs.get(ids[0]);
  const after = bulge(net, s1);
  assert.ok(before > 1 && Math.abs(after - before * 1.2) < 0.3, `bulge ${before} -> ${after}`);
});

test('fixed pieces and roundabouts cannot be dragged', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  const end = nodeAt(net, 30, 30);
  end.fixed = true;
  assert.equal(net.moveNode(end.id, 31, 31), null);
  const ring = new Network();
  ring.insertPath([{ x: 20, z: 30 }, { x: 40, z: 30 }], KIND_ROAD);
  ring.addRoundabout(30, 30, 2.6, KIND_ROAD);
  const onRing = [...ring.nodes.values()].find(n => n.ring);
  assert.equal(ring.moveNode(onRing.id, onRing.x + 1, onRing.z), null);
});

test('bending a road through a crossing makes a junction there', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 40, z: 30 }], KIND_ROAD);
  net.insertPath([{ x: 25, z: 20 }, { x: 35, z: 20 }], KIND_ROAD);
  const s = segBetween(net, { x: 25, z: 20 }, { x: 35, z: 20 });
  // Pull the middle of the upper road down past the lower one.
  assert.ok(net.bendSeg(s.id, 30, 44));
  const junctions = [...net.nodes.values()].filter(n => net.degree(n.id) === 4);
  assert.equal(junctions.length, 2);
});

test('cutting the middle out of a road leaves two ends', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  const s = [...net.segs.values()][0];
  assert.ok(net.cutRange(s.id, 3, 7));
  const lens = [...net.segs.values()].map(s => s.len).sort();
  assert.equal(lens.length, 2);
  assert.ok(near(lens[0], 3, 0.05) && near(lens[1], 3, 0.05), lens.join(','));
});

test('a cut that reaches an end takes the whole end off, and a full cut removes the road', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  const s = [...net.segs.values()][0];
  assert.ok(net.cutRange(s.id, 0.2, 6));
  assert.equal(net.segs.size, 1);
  const rest = [...net.segs.values()][0];
  assert.ok(near(rest.len, 4, 0.05));
  assert.ok(net.cutRange(rest.id, 0, rest.len));
  assert.equal(net.segs.size, 0);
  assert.equal(net.nodes.size, 0);
});

test('bridges come out whole or not at all', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD, false, 1);
  const s = [...net.segs.values()][0];
  assert.equal(net.cutRange(s.id, 3, 6), false);
  assert.ok(net.cutRange(s.id, 0, s.len));
});

test('changing the kind of a stretch splits it out of the road', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  const s = [...net.segs.values()][0];
  const mid = net.setKindRange(s.id, 3, 7, KIND_AVENUE);
  assert.equal(mid.length, 1);
  assert.equal(net.segs.get(mid[0]).kind, KIND_AVENUE);
  assert.equal(net.segs.size, 3);
  assert.equal([...net.segs.values()].filter(s => s.kind === KIND_ROAD).length, 2);
  // One-way highway kinds only go on whole roads.
  const other = [...net.segs.values()].find(s => s.kind === KIND_ROAD);
  assert.equal(net.setKindRange(other.id, 0.5, 1.5, KIND_MOTORWAY), null);
});

test('edits survive a save and leave a scratch copy independent of the original', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  const scratch = Network.fromPlain(net.toPlain());
  const end = nodeAt(scratch, 30, 30);
  scratch.moveNode(end.id, 33, 34);
  assert.ok(nodeAt(net, 30, 30), 'original untouched');
  const back = Network.fromPlain(scratch.toPlain());
  assert.ok(nodeAt(back, 33, 34));
  assert.equal(back.segs.size, 1);
});

test('moving a road keeps its bike lanes and calming', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  const s = [...net.segs.values()][0];
  s.bike = true; s.calm = true;
  const ids = net.moveNode(nodeAt(net, 30, 30).id, 31, 33);
  const moved = net.segs.get(ids[0]);
  assert.ok(moved.bike && moved.calm);
});

// ---- planning and committing edits in a whole city ---------------------------------------------------
globalThis.Worker = class { postMessage() {} };
const C = await import('../src/constants.ts');
const { Game } = await import('../src/game.ts');
const { planEdit, commitEdit } = await import('../src/roadEdit.ts');
function city() {
  const game = new Game();
  game.terrain.water.fill(0); game.terrain.shore.fill(0);
  game.stats.money = 100000;
  game.net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD);
  game.flush();
  return game;
}

test('a moved road is charged only for the road it adds, and can be undone', () => {
  const g = city();
  const end = g.net.nearestNode(30, 30, 0.05);
  const plan = planEdit(g, { type: 'move', node: end.id, x: 34, z: 30 });
  assert.equal(plan.problem, null);
  assert.equal(plan.cost, Math.round(4 * C.ROAD_COST[KIND_ROAD]));
  const money = g.stats.money;
  assert.ok(commitEdit(g, plan));
  assert.equal(g.stats.money, money - plan.cost);
  assert.ok(g.net.nearestNode(34, 30, 0.05));
  assert.ok(g.undo());
  assert.ok(g.net.nearestNode(30, 30, 0.05), 'undo puts the node back');
  assert.equal(g.stats.money, money);
});

test('a road dragged into the river is refused', () => {
  const g = city();
  for (let x = 33; x < 36; x++) for (let z = 0; z < C.GRID; z++) g.terrain.water[z * C.GRID + x] = 1;
  const end = g.net.nearestNode(30, 30, 0.05);
  const plan = planEdit(g, { type: 'move', node: end.id, x: 38, z: 30 });
  assert.match(plan.problem, /river/);
  assert.equal(commitEdit(g, plan), false);
  assert.ok(g.net.nearestNode(30, 30, 0.05));
});

test('bending through a building counts it as paved over', () => {
  const g = city();
  const house = 36 * C.GRID + 25;
  g.setKind(house, C.T_RES, 0); g.level[house] = 1; g.flush();
  const seg = [...g.net.segs.values()][0];
  const plan = planEdit(g, { type: 'bend', seg: seg.id, x: 25.5, z: 36.5 });
  assert.equal(plan.problem, null);
  assert.equal(plan.lost, 1);
  const mid = plan.net.segs.get(plan.ids[0]);
  assert.ok(Math.abs(mid.pts[(mid.n >> 1) * 2 + 1] - 36.5) < 0.05, 'the road passes through the pointer');
});

test('a cut costs nothing and a stretch upgrade charges only its length', () => {
  const g = city();
  const seg = [...g.net.segs.values()][0];
  const cut = planEdit(g, { type: 'cut', seg: seg.id, s0: 2, s1: 5 });
  assert.equal(cut.problem, null); assert.equal(cut.cost, 0);
  assert.equal(cut.net.segs.size, 2);
  const up = planEdit(g, { type: 'kind', seg: seg.id, s0: 2, s1: 6, kind: KIND_AVENUE });
  assert.equal(up.problem, null);
  assert.equal(up.cost, Math.round((C.ROAD_COST[KIND_AVENUE] - C.ROAD_COST[KIND_ROAD]) * 4));
});

console.log(`${checks} road edit checks passed; ${failures} failed`);
if (failures) process.exit(1);
