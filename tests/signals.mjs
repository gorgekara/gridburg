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

test('the timeline: green, amber, all-red, then the next phase; no amber where it stays green', () => {
  const plan = { phases: [{ green: 8, moves: { a: 1, b: 1, c: 2 } }, { green: 5, moves: { b: 1 } }] };
  assert.equal(S.stateIn(plan, 0, 2, 8, 'a'), 'green');
  assert.equal(S.stateIn(plan, 0, 2, 8, 'c'), 'yield');
  assert.equal(S.stateIn(plan, 0, 8.5, 8, 'a'), 'amber');
  assert.equal(S.stateIn(plan, 0, 8.5, 8, 'b'), 'green', 'green in the next phase too');
  assert.equal(S.stateIn(plan, 1, 1, 5, 'a'), 'red');
  // After the amber, a moment of all-red before the next phase moves off.
  assert.equal(S.stateIn(plan, 0, 9.2, 8, 'a'), 'red');
  assert.equal(S.stateIn(plan, 0, 9.2, 8, 'b'), 'green', 'still green if it is green next phase too');
  assert.equal(S.cycleOf(plan), 8 + 1 + 0.5 + 5 + 1 + 0.5);
  assert.deepEqual(S.fixedClock(plan, 10.5), { phase: 1, t: 1, len: 5 });
  assert.deepEqual(S.fixedClock(plan, 16.5), { phase: 0, t: 0.5, len: 8 });
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

const { RoadLayer } = await import('../src/render/roads.ts');
const THREE = await import('three');
const { generateTerrain } = await import('../src/terrain.ts');
test('signal heads show their own approach\'s state from the junction\'s clock', () => {
  const j = junction(['W', 'E', 'N', 'S']);
  const layer = new RoadLayer();
  const terrain = generateTerrain(3); terrain.water.fill(0);
  layer.rebuild(j.net, terrain);
  const plan = S.planFor(j.net, j.node.id);
  // Which phase lets the west arm go straight on.
  const ewPhase = plan.phases.findIndex(p => Object.keys(p.moves).some(k => j.name(k) === 'W>E'));
  layer.updateLights(0, new Float32Array([j.node.id, ewPhase, 2, 8]));
  const colours = layer.lampInfo.map((l, i) => {
    const c = new THREE.Color();
    layer.lamps.getColorAt(i * 3 + 2, c);
    return { arm: j.name(l.keys[0]).split('>')[0], green: c.g > 0.5 };
  });
  for (const { arm, green } of colours) assert.equal(green, arm === 'W' || arm === 'E', `${arm} head`);
  // In the amber at the end of that phase, nobody shows green.
  layer.updateLights(0, new Float32Array([j.node.id, ewPhase, 8.5, 8]));
  const any = layer.lampInfo.some((_, i) => { const c = new THREE.Color(); layer.lamps.getColorAt(i * 3 + 2, c); return c.g > 0.5; });
  assert.equal(any, false);
});

const { cycleMove } = await import('../src/ui/signalPanel.ts');
const { SignalOverlay } = await import('../src/render/signalOverlay.ts');
test('clicking an arrow cycles its movement: red, green, give way, red', () => {
  let plan = { phases: [{ green: 8, moves: {} }] };
  plan = cycleMove(plan, 0, 'k'); assert.equal(plan.phases[0].moves.k, 1);
  plan = cycleMove(plan, 0, 'k'); assert.equal(plan.phases[0].moves.k, 2);
  plan = cycleMove(plan, 0, 'k'); assert.equal(plan.phases[0].moves.k, undefined);
});

test('the overlay finds the movement arrow under a click', () => {
  const j = junction(['W', 'E', 'N', 'S'], KIND_AVENUE);
  const overlay = new SignalOverlay();
  overlay.show(j.net, j.node.id, S.planFor(j.net, j.node.id), 0);
  // Every right turn has its corner to itself: a click on the middle of its arrow finds it.
  for (const path of overlay.paths) {
    const turn = j.name(path.key);
    if (!['W>S', 'S>E', 'E>N', 'N>W'].includes(turn)) continue;
    const mid = path.pts[7];
    assert.equal(j.name(overlay.pick(mid.x, mid.z)), turn);
  }
  assert.equal(overlay.pick(10, 10), null);
});

test('a junction nobody can drive through gets no phases, and nothing breaks', () => {
  const net = new Network();
  for (const [x, z] of [[20, 40], [60, 40], [40, 20]]) net.insertPath([{ x, z }, { x: 40, z: 40 }], KIND_ROAD, true);
  const node = net.nearestNode(40, 40, 0.1); node.light = true;
  assert.equal(S.defaultPlan(net, node.id).phases.length, 0);
  assert.deepEqual(S.fixedClock({ phases: [] }, 5), { phase: 0, t: 0, len: 0 });
  const layer = new RoadLayer(); const terrain = generateTerrain(3); terrain.water.fill(0);
  layer.rebuild(net, terrain);
  layer.updateLights(3);
});

test('bending an arm or moving its far end keeps the junction\'s plan', () => {
  const j = junction(['W', 'E', 'N', 'S']);
  const plan = S.defaultPlan(j.net, j.node.id); plan.phases[0].green = 21; j.node.signal = plan;
  const west = j.net.segsAt(j.node.id).find(s => j.name(`${s.id}f>${s.id}f`).startsWith('W'));
  assert.ok(j.net.bendSeg(west.id, 30, 42));
  assert.ok(S.planFits(j.net, j.node.id, j.node.signal), 'after a bend');
  j.net.moveNode(j.net.nearestNode(40, 60, 0.1).id, 41, 61);
  assert.ok(S.planFits(j.net, j.node.id, j.node.signal), 'after moving an arm end');
  assert.equal(S.planFor(j.net, j.node.id).phases[0].green, 21);
});

test('a plan that leaves a movement red in every phase does not fit', () => {
  const j = junction(['W', 'E', 'N', 'S']);
  const plan = S.defaultPlan(j.net, j.node.id);
  const key = Object.keys(plan.phases[0].moves)[0];
  delete plan.phases[0].moves[key];
  assert.equal(S.planFits(j.net, j.node.id, plan), false);
});

// ---- paint and signs ------------------------------------------------------------------------------
const flat = () => { const t = generateTerrain(3); t.water.fill(0); return t; };
test('a signal crossroads has a stop line on each approach; an avenue with a side street, a give-way line and a yield sign', () => {
  const j = junction(['W', 'E', 'N', 'S']);
  const layer = new RoadLayer();
  layer.rebuild(j.net, flat());
  assert.equal(layer.marks.stopLines, 4);
  assert.equal(layer.marks.giveWays, 0);
  const t = new Network();
  t.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], KIND_AVENUE);
  t.insertPath([{ x: 40, z: 40 }, { x: 40, z: 62 }], KIND_ROAD);
  const tee = new RoadLayer();
  tee.rebuild(t, flat());
  assert.equal(tee.marks.giveWays, 1, 'only the side street gives way');
  assert.equal(tee.marks.yieldSigns, 1);
  assert.equal(tee.yieldSigns.count, 1);
  assert.equal(tee.marks.stopLines, 0);
});

test('every road into a roundabout gives way; a crossroads of equal streets paints no priority', () => {
  const net = new Network();
  net.insertPath([{ x: 20, z: 40 }, { x: 60, z: 40 }], KIND_ROAD);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], KIND_ROAD);
  const equal = new RoadLayer();
  equal.rebuild(net, flat());
  assert.equal(equal.marks.giveWays + equal.marks.stopLines, 0);
  assert.ok(net.addRoundabout(40, 40, 2.3, KIND_ROAD));
  const ring = new RoadLayer();
  ring.rebuild(net, flat());
  assert.equal(ring.marks.giveWays, 4);
});

test('a curve too tight for its road gets chevrons; a gentle one does not', () => {
  const net = new Network();
  const [a] = net.insertPath([{ x: 10, z: 20 }, { x: 40, z: 20 }], KIND_AVENUE);
  net.bendSeg(a, 25, 70);
  const tight = new RoadLayer();
  tight.rebuild(net, flat());
  assert.ok(tight.marks.chevrons > 0, JSON.stringify(tight.marks));
  assert.equal(tight.chevrons.count, tight.marks.chevrons);
  const gentle = new Network();
  const [g] = gentle.insertPath([{ x: 10, z: 20 }, { x: 40, z: 20 }], KIND_AVENUE);
  gentle.bendSeg(g, 25, 23);
  const easy = new RoadLayer();
  easy.rebuild(gentle, flat());
  assert.equal(easy.marks.chevrons, 0);
});

test('an avenue approach gets a mast arm with a head over each lane; a left-turn pocket flashes amber on its yield green', () => {
  const j = junction(['W', 'E', 'N', 'S'], KIND_AVENUE);
  // An extra lane for traffic arriving from the west: added on its own side of the centre line (addR
  // for a→b traffic), it becomes the turn lane for the leftmost exit.
  const west = j.net.segsAt(j.node.id).find(s => j.name(`${s.id}f>${s.id}f`).startsWith('W'));
  if (west.b === j.node.id) west.addR = 1; else west.addL = 1;
  j.net.version++;
  const layer = new RoadLayer();
  layer.rebuild(j.net, flat());
  assert.equal(layer.arms.count, 4, 'an arm per approach');
  assert.equal(layer.heads.count, 3 + 2 + 2 + 2, `a head over each arriving lane: ${layer.heads.count}, lanes ${JSON.stringify(j.net.segsAt(j.node.id).map(s => [s.addL ?? 0, s.addR ?? 0, s.a === j.node.id]))}`);
  const plan = S.planFor(j.net, j.node.id);
  const ew = plan.phases.findIndex(p => Object.keys(p.moves).some(k => j.name(k) === 'W>E'));
  const pocket = layer.lampInfo.findIndex(l => l.keys.length && l.keys.every(k => j.name(k) === 'W>N'));
  assert.ok(pocket >= 0, 'the pocket has its own head, for the left turn only');
  assert.equal(plan.phases[ew].moves[layer.lampInfo[pocket].keys[0]], 2, 'the left turn yields in that phase');
  const lens = (t, i, k) => { layer.updateLights(t, new Float32Array([j.node.id, ew, 2, 8])); const c = new THREE.Color(); layer.lamps.getColorAt(i * 3 + k, c); return c; };
  assert.ok(lens(0, pocket, 2).g < 0.5, 'no green for a turn that must give way');
  assert.ok(lens(0, pocket, 1).r > 0.5, 'amber lit');
  assert.ok(lens(0.7, pocket, 1).r < 0.5, 'and then dark: it flashes');
  const through = layer.lampInfo.findIndex(l => l.keys.length && l.keys.every(k => j.name(k) === 'W>E'));
  if (through >= 0) assert.ok(lens(0, through, 2).g > 0.5, 'the through lane shows green');
});

const Ctl = await import('../src/roads/control.ts');
const { crossingApproaches } = await import('../src/roads/crossings.ts');
const { speedLimitKmh } = await import('../src/render/streetDetail.ts');
test('junction facts the paint and the traffic share: kinds, the major road, stop lines behind the zebra', () => {
  const t = new Network();
  t.insertPath([{ x: 16, z: 40 }, { x: 64, z: 40 }], KIND_AVENUE);
  t.insertPath([{ x: 40, z: 40 }, { x: 40, z: 62 }], KIND_ROAD);
  const node = t.nearestNode(40, 40, 0.1);
  assert.equal(Ctl.junctionKind(t, node.id), 'yield');
  const major = Ctl.majorArms(t, node.id);
  assert.ok(major && major.size === 2 && [...major].every(id => t.segs.get(id).kind === KIND_AVENUE));
  node.light = true;
  assert.equal(Ctl.junctionKind(t, node.id), 'light');
  assert.equal(Ctl.majorArms(t, node.id), null, 'signals decide there, not priority');
  const zebras = crossingApproaches(t);
  for (const s of t.segsAt(node.id)) {
    const zebra = zebras.get(s.id)?.[s.b === node.id ? 1 : 0] ?? 0;
    assert.ok(zebra > 0, 'this junction has zebras');
    assert.ok(Ctl.stopLine(t, node.id, zebra) >= zebra + Ctl.ZEBRA_HALF + 0.05, 'the line is before the crossing');
  }
  assert.equal(Ctl.junctionKind(t, t.nearestNode(16, 40, 0.1).id), 'plain');
});

test('speed limit signs show what the traffic drives, in km/h', () => {
  assert.equal(speedLimitKmh({ kind: 0, calm: false }), 50);
  assert.equal(speedLimitKmh({ kind: 1, calm: false }), 80);
  assert.equal(speedLimitKmh({ kind: 2, calm: false }), 40);
  assert.equal(speedLimitKmh({ kind: 0, calm: true }), 30);
  assert.equal(speedLimitKmh({ kind: 3, calm: false }), 110);
});

const { demoCity } = await import('../src/demo.ts');
test('the demo city is painted: stop lines, give-way lines, yield signs and hatched gores', () => {
  const layer = new RoadLayer();
  const net = Network.fromPlain(demoCity().net);
  layer.rebuild(net, flat());
  const m = layer.marks;
  console.log(`  demo city marks: ${JSON.stringify(m)}`);
  assert.ok(m.stopLines > 10 && m.giveWays > 10 && m.yieldSigns > 5, JSON.stringify(m));
});

console.log(`${checks} signal checks passed; ${failures} failed`);
if (failures) process.exit(1);
