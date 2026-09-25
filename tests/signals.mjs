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
const S = await import('../src/roads/signals.ts');
const { Network, KIND_ROAD, KIND_AVENUE } = N;
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}

/** Roads meeting at (40, 40) from the given compass directions. */
function junction(arms, kind = KIND_ROAD) {
  const net = new Network();
  const far = { W: [20, 40], E: [60, 40], N: [40, 20], S: [40, 60], NE: [55, 25] };
  for (const a of arms) net.insertPath([{ x: far[a][0], z: far[a][1] }, { x: 40, z: 40 }], kind);
  const node = net.nearestNode(40, 40, 0.1);
  node.light = true;
  const armOf = (segId) => { const s = net.segs.get(segId); const o = net.nodes.get(s.a === node.id ? s.b : s.a); return Object.keys(far).find(k => far[k][0] === o.x && far[k][1] === o.z); };
  const name = (key) => { const [, a, , b] = key.match(/^(\d+)([fb])>(\d+)([fb])$/); return `${armOf(+a)}>${armOf(+b)}`; };
  return { net, node, name };
}
const phaseNames = (j, plan) => plan.phases.map(p => Object.entries(p.moves).map(([k, v]) => `${j.name(k)}${v === 2 ? '?' : ''}`).sort().join(' '));

test('a crossroads gets two phases, opposite arms together, left turns yielding', () => {
  const j = junction(['W', 'E', 'N', 'S']);
  const plan = S.defaultPlan(j.net, j.node.id);
  assert.equal(plan.phases.length, 2);
  const names = phaseNames(j, plan);
  const ew = names.find(n => n.includes('W>E'));
  assert.ok(ew.includes('E>W') && ew.includes('W>S') && ew.includes('W>N?') && ew.includes('E>S?'), ew);
  assert.ok(!ew.includes('N>'), 'north-south traffic waits');
  assert.ok(plan.phases.every(p => p.green === 8));
});

test('a T gets the through road first, then the side road', () => {
  const j = junction(['W', 'E', 'S']);
  const plan = S.defaultPlan(j.net, j.node.id);
  const names = phaseNames(j, plan);
  assert.equal(plan.phases.length, 2);
  assert.ok(names[0].includes('W>E') && names[0].includes('E>S?') && names[0].includes('W>S'), names[0]);
  assert.ok(names[1].includes('S>W') && names[1].includes('S>E') && !names[1].includes('?'), names[1]);
});

test('an irregular junction gets one phase per arm', () => {
  const j = junction(['W', 'E', 'N', 'S', 'NE']);
  const plan = S.defaultPlan(j.net, j.node.id);
  assert.equal(plan.phases.length, 5);
});

test('the timeline: green, amber into red, no amber where it stays green', () => {
  const plan = { phases: [{ green: 8, moves: { a: 1, b: 1, c: 2 } }, { green: 5, moves: { b: 1 } }] };
  assert.equal(S.stateIn(plan, 0, 2, 8, 'a'), 'green');
  assert.equal(S.stateIn(plan, 0, 2, 8, 'c'), 'yield');
  assert.equal(S.stateIn(plan, 0, 8.5, 8, 'a'), 'amber');
  assert.equal(S.stateIn(plan, 0, 8.5, 8, 'b'), 'green', 'green in the next phase too');
  assert.equal(S.stateIn(plan, 1, 1, 5, 'a'), 'red');
  assert.equal(S.cycleOf(plan), 8 + 1 + 5 + 1);
  assert.deepEqual(S.fixedClock(plan, 10), { phase: 1, t: 1, len: 5 });
  assert.deepEqual(S.fixedClock(plan, 15.5), { phase: 0, t: 0.5, len: 8 });
});

test('a plan survives a split and a reversal of an arm, and falls back when the junction changes', () => {
  const j = junction(['W', 'E', 'N', 'S']);
  const plan = S.defaultPlan(j.net, j.node.id);
  plan.phases[0].green = 21;
  j.node.signal = plan;
  const west = j.net.segsAt(j.node.id).find(s => j.name(`${s.id}f>${s.id}f`).startsWith('W'));
  j.net.splitSeg(west.id, 0.5);
  assert.ok(S.planFits(j.net, j.node.id, j.node.signal), 'split renames the arm');
  const east = j.net.segsAt(j.node.id).find(s => j.name(`${s.id}f>${s.id}f`).startsWith('E'));
  j.net.reverseSeg(east.id);
  assert.ok(S.planFits(j.net, j.node.id, j.node.signal), 'reversal flips the arm');
  assert.equal(S.planFor(j.net, j.node.id).phases[0].green, 21);
  // A fifth arm: the old plan no longer covers the junction.
  j.net.insertPath([{ x: 55, z: 25 }, { x: 40, z: 40 }], KIND_ROAD);
  assert.equal(S.planFits(j.net, j.node.id, j.node.signal), false);
  assert.equal(S.planFor(j.net, j.node.id).phases.length, 5);
});

test('plans survive plain copies', () => {
  const j = junction(['W', 'E', 'S']);
  const plan = S.defaultPlan(j.net, j.node.id);
  plan.adaptive = true; plan.phases[1].green = 13;
  j.node.signal = plan;
  const copy = Network.fromPlain(j.net.toPlain());
  assert.deepEqual(copy.nodes.get(j.node.id).signal, plan);
  plan.phases[0].green = 30;
  assert.notEqual(copy.nodes.get(j.node.id).signal.phases[0].green, 30, 'copies are independent');
});

globalThis.Worker = class { postMessage() {} };
const { encode, decode } = await import('../src/save.ts');
const { Game } = await import('../src/game.ts');
test('binary saves keep a junction\'s plan', () => {
  const g = new Game();
  g.net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], KIND_AVENUE);
  g.net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], KIND_AVENUE);
  const node = g.net.nearestNode(40, 40, 0.1);
  node.light = true;
  const plan = S.defaultPlan(g.net, node.id);
  plan.phases.push({ green: 5, moves: {} }); plan.adaptive = true;
  node.signal = plan;
  g.flush();
  const back = Network.fromPlain(decode(encode(g.snapshot())).net);
  const n2 = back.nearestNode(40, 40, 0.1);
  assert.ok(n2.light && n2.signal, 'plan saved');
  assert.equal(n2.signal.phases.length, 3);
  assert.equal(n2.signal.adaptive, true);
  assert.ok(S.planFits(back, n2.id, n2.signal));
});

console.log(`${checks} signal checks passed; ${failures} failed`);
if (failures) process.exit(1);
