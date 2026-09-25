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
const N = await import('../src/roads/network.ts');
const ST = await import('../src/roads/structures.ts');
const { generateTerrain } = await import('../src/terrain.ts');
const { Network, KIND_ROAD, KIND_AVENUE } = N;
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;
const dry = generateTerrain(3); dry.water.fill(0); dry.shore.fill(0);
const junctions = (net) => [...net.nodes.values()].filter(n => net.degree(n.id) >= 3);

test('levels and heights: a ramp eases from one level to the next, a level road stays level', () => {
  assert.equal(ST.levelY(0), 0); assert.ok(close(ST.levelY(2), 2.2)); assert.ok(close(ST.levelY(-1), -1.8));
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD, false, 0, true, [0, 1]);
  const ramp = [...net.segs.values()][0];
  assert.equal(ramp.structure, 1);
  assert.ok(close(ST.roadHeight(ramp, 0), 0) && close(ST.roadHeight(ramp, ramp.len), 1.1));
  assert.ok(close(ST.roadHeight(ramp, ramp.len / 2), 0.55));
  net.insertPath([{ x: 30, z: 30 }, { x: 40, z: 30 }], KIND_ROAD, false, 0, true, [1, 1]);
  const deck = [...net.segs.values()].find(s => s.id !== ramp.id);
  assert.ok(ST.isFlat(deck) && close(ST.roadHeight(deck, 3), 1.1));
  assert.equal(net.nodes.get(deck.a).level ?? 0, 1, 'the ramp top is shared at level 1');
});

test('an old-style bridge keeps its hump', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD, false, 1);
  const span = [...net.segs.values()][0];
  assert.ok(ST.isLegacySpan(span) && !ST.isFlat(span));
  assert.ok(close(ST.roadHeight(span, 0), 0) && close(ST.roadHeight(span, 5), ST.BRIDGE_RISE));
});

test('two roads at level 2 crossing make a junction up there', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], KIND_AVENUE, false, 0, true, [2, 2]);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], KIND_AVENUE, false, 0, true, [2, 2]);
  const js = junctions(net);
  assert.equal(js.length, 1);
  assert.equal(js[0].level, 2);
  assert.ok([...net.segs.values()].every(s => s.structure === 1 && ST.isFlat(s)));
});

test('a level-1 road over a ground road passes over it', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], KIND_ROAD);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], KIND_ROAD, false, 0, true, [1, 1]);
  assert.equal(junctions(net).length, 0);
  assert.equal(net.segs.size, 2);
});

test('joining only picks up roads at the height being drawn', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], KIND_ROAD, false, 0, true, [1, 1]);
  const below = net.resolveEndpoint(40, 40, 0);
  assert.equal(net.nodes.get(below).level ?? 0, 0, 'a ground point under the deck is a new node');
  assert.equal(net.segs.size, 1, 'the deck was not split');
  const onDeck = net.resolveEndpoint(40, 40, 1);
  assert.equal(net.nodes.get(onDeck).level, 1);
  assert.equal(net.segs.size, 2, 'joining at deck level splits it');
  for (const s of net.segs.values()) assert.equal(s.structure, 1, 'both halves stay elevated');
});

test('validation: ramps need length, no tunnel straight into a bridge, and a whole level of clearance', () => {
  const net = new Network();
  assert.match(ST.levelProblem(net, dry, [{ x: 20, z: 30 }, { x: 25, z: 30 }], KIND_ROAD, 0, 2) ?? '', /4 cells per level/);
  assert.equal(ST.levelProblem(net, dry, [{ x: 20, z: 30 }, { x: 30, z: 30 }], KIND_ROAD, 0, 2), null);
  assert.match(ST.levelProblem(net, dry, [{ x: 20, z: 30 }, { x: 40, z: 30 }], KIND_ROAD, -1, 1) ?? '', /tunnel/i);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], KIND_ROAD);
  // A ramp climbing across the ground road while still low.
  assert.match(ST.levelProblem(net, dry, [{ x: 37, z: 40 }, { x: 45, z: 40 }], KIND_ROAD, 0, 1) ?? '', /level|close/i);
  // Level 1 straight over it is fine.
  assert.equal(ST.levelProblem(net, dry, [{ x: 30, z: 40 }, { x: 50, z: 40 }], KIND_ROAD, 1, 1), null);
});

test('levels survive a split, plain copies and binary saves', () => {
  globalThis.Worker = class { postMessage() {} };
  const net = new Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 40, z: 40 }], KIND_ROAD, false, 0, true, [3, 3]);
  net.insertPath([{ x: 40, z: 40 }, { x: 50, z: 40 }], KIND_ROAD, false, 0, true, [3, 0]);
  const deck = [...net.segs.values()].find(s => ST.isFlat(s));
  const { node } = net.splitSeg(deck.id, 0.5);
  assert.equal(node.level, 3);
  const copy = Network.fromPlain(net.toPlain());
  assert.equal(copy.nodes.get(node.id).level, 3);
  assert.equal([...copy.nodes.values()].filter(n => n.level === 3).length, 3);
});

globalThis.Worker = class { postMessage() {} };
const { encode, decode } = await import('../src/save.ts');
const { Game } = await import('../src/game.ts');
test('binary saves keep node levels, including tunnels', () => {
  const g = new Game();
  g.net.insertPath([{ x: 20, z: 40 }, { x: 30, z: 40 }], KIND_ROAD, false, 0, true, [0, -1]);
  g.net.insertPath([{ x: 30, z: 40 }, { x: 40, z: 40 }], KIND_ROAD, false, 0, true, [-1, -1]);
  g.net.insertPath([{ x: 20, z: 50 }, { x: 30, z: 50 }], KIND_ROAD, false, 0, true, [0, 2]);
  g.flush();
  const back = Network.fromPlain(decode(encode(g.snapshot())).net);
  const levels = [...back.nodes.values()].map(n => n.level ?? 0).filter(l => l).sort();
  assert.deepEqual(levels, [-1, -1, 2]);
  const tunnel = [...back.segs.values()].find(s => ST.isFlat(s) && s.structure === 2);
  assert.ok(tunnel && close(ST.roadHeight(tunnel, 2), -1.8));
});

const { StructureLayer } = await import('../src/render/structures.ts');
/** Every vertex of the structure layer's solids, in map coordinates. */
function solidPoints(layer) {
  const out = [];
  layer.group.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    o.updateMatrixWorld(true);
    const p = o.geometry.attributes.position, v = new (o.position.constructor)();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); out.push([v.x + 40, v.y, v.z + 40]); }
  });
  return out;
}

test('a flyover stands on piers beside the road below, never on it', () => {
  const net = new Network();
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], KIND_AVENUE);
  net.insertPath([{ x: 20, z: 40 }, { x: 28, z: 40 }], KIND_ROAD, false, 0, true, [0, 1]);
  net.insertPath([{ x: 28, z: 40 }, { x: 52, z: 40 }], KIND_ROAD, false, 0, true, [1, 1]);
  net.insertPath([{ x: 52, z: 40 }, { x: 60, z: 40 }], KIND_ROAD, false, 0, true, [1, 0]);
  const layer = new StructureLayer();
  layer.rebuild(net);
  const pts = solidPoints(layer);
  assert.ok(pts.length > 100, 'deck built');
  // Columns are what reach down to the ground: none of them within the avenue's carriageway.
  const onAvenue = pts.filter(([x, y, z]) => Math.abs(x - 40) < 0.86 && y < 0.2 && y > -0.35 && Math.abs(z - 40) < 1.2);
  assert.equal(onAvenue.length, 0, `${onAvenue.length} column vertices on the avenue`);
  assert.ok(pts.some(([x, y]) => y < -0.25 && x > 29 && x < 51), 'piers elsewhere along the deck');
});

test('an elevated junction gets a deck slab under the node', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], KIND_ROAD, false, 0, true, [2, 2]);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], KIND_ROAD, false, 0, true, [2, 2]);
  const layer = new StructureLayer();
  layer.rebuild(net);
  const slab = solidPoints(layer).filter(([x, y, z]) => Math.hypot(x - 40, z - 40) < 0.7 && Math.abs(y - 2.2) < 0.3);
  assert.ok(slab.length > 10, 'slab at the junction');
});

console.log(`${checks} level checks passed; ${failures} failed`);
if (failures) process.exit(1);
