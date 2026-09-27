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
const C = await import('../src/constants.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { emptyStats } = await import('../src/sim/messages.ts');
const { encode, decode } = await import('../src/save.ts');
const { TUTORIALS } = await import('../src/tutorials.ts');

let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const lesson = id => TUTORIALS.find(t => t.id === id);
/** The city a lesson starts with, as a step sees it. */
function start(id) {
  const d = lesson(id).setup();
  return { d, v: { net: N.Network.fromPlain(d.net), kind: d.kind, flags: new Uint8Array(C.N_TILES), stats: emptyStats(d.money) } };
}
/** Put a building of this kind on the free kerbside tile nearest (x, z). */
function place(v, k, x0, z0) {
  const r = rasterize(v.net);
  let best = -1, bd = Infinity;
  for (let i = 0; i < C.N_TILES; i++) {
    if (r.accSeg[i] < 0 || r.cover[i] || v.kind[i] >= C.T_COAL) continue;
    const dd = Math.hypot(i % C.GRID - x0, Math.floor(i / C.GRID) - z0);
    if (dd < bd) { bd = dd; best = i; }
  }
  assert.ok(best >= 0, 'somewhere to build');
  v.kind[best] = k;
}
const stepsDone = (t, v) => t.steps.map(s => s.done(v));

test('every lesson has an id, steps with hints, and a goal, and none is done before the player starts', () => {
  assert.ok(TUTORIALS.length >= 5);
  assert.equal(new Set(TUTORIALS.map(t => t.id)).size, TUTORIALS.length, 'ids are unique');
  for (const t of TUTORIALS) {
    assert.ok(t.title && t.blurb && t.intro && t.goal.text, t.id);
    assert.ok(t.steps.length >= 2 && t.steps.every(s => s.text && s.hint), t.id);
    const { v } = start(t.id);
    assert.deepEqual(stepsDone(t, v), t.steps.map(() => false), `${t.id}: no step done at the start`);
    assert.equal(t.goal.done(v), false, `${t.id}: goal not met at the start`);
  }
});

test('every lesson town saves and loads, all its roads joined to the way in', () => {
  for (const t of TUTORIALS) {
    const d = t.setup(), back = decode(encode(d));
    assert.equal(back.net.segs.length, d.net.segs.length, t.id);
    const net = N.Network.fromPlain(d.net);
    const entry = [...net.nodes.values()].find(n => n.entry) ?? [...net.nodes.values()][0];
    const seen = new Set([entry.id]), queue = [entry.id];
    for (let h = 0; h < queue.length; h++) for (const s of net.segsAt(queue[h])) { const o = s.a === queue[h] ? s.b : s.a; if (!seen.has(o)) { seen.add(o); queue.push(o); } }
    assert.equal([...net.segs.values()].filter(s => !seen.has(s.a)).length, 0, `${t.id}: nothing stranded`);
  }
});

test('the lesson towns that come built have homes, jobs, power and water', () => {
  for (const t of TUTORIALS.filter(t => t.id !== 'streets')) {
    const { d } = start(t.id);
    const n = k => Array.from(d.kind).filter(v => v === k).length;
    assert.ok(n(C.T_RES) > 50 && n(C.T_COM) > 20, `${t.id}: homes and jobs`);
    assert.ok(n(C.T_COAL) > 0 && n(C.T_PUMP) > 0 && n(C.T_OUTLET) > 0, `${t.id}: power, water, sewage`);
  }
});

test('First streets: steps tick as roads, zones and utilities go in', () => {
  const t = lesson('streets'), { v } = start('streets');
  const end = { x: 18.5, z: 12.5 };
  v.net.insertPath([{ x: end.x, z: end.z }, { x: end.x, z: end.z + 14 }], N.KIND_ROAD);
  assert.deepEqual(stepsDone(t, v).slice(0, 2), [true, false]);
  for (let k = 0; k < 12; k++) place(v, C.T_RES, end.x - 1, end.z + k);
  for (let k = 0; k < 6; k++) place(v, C.T_COM, end.x + 1, end.z + k);
  place(v, C.T_COAL, end.x + 1, end.z + 12);
  place(v, C.T_PUMP, end.x - 1, end.z + 13);
  place(v, C.T_OUTLET, end.x + 1, end.z + 13);
  assert.deepEqual(stepsDone(t, v), t.steps.map(() => true));
  assert.equal(t.goal.done(v), false);
  v.stats.pop = 150;
  assert.ok(t.goal.done(v));
});

test('Services: one of each service, then coverage', () => {
  const t = lesson('services'), { v } = start('services');
  for (const [k, dx] of [[C.T_CLINIC, -3], [C.T_SCHOOL, -1], [C.T_FIRE, 1], [C.T_POLICE, 3]]) place(v, k, 35 + dx, 24);
  assert.deepEqual(stepsDone(t, v), t.steps.map(() => true));
  v.stats.civic = { ...v.stats.civic, health: 50, education: 20, fire: 50, safety: 50 };
  assert.equal(t.goal.done(v), false, 'every service must reach the mark');
  v.stats.civic.education = 40;
  assert.ok(t.goal.done(v));
});

test('Junctions: control the crossing, a pocket or ban, then an avenue both sides', () => {
  const t = lesson('junctions'), { v } = start('junctions');
  const x = v.net.nearestNode(40.5, 27.5, 0.5);
  assert.ok(x && v.net.segsAt(x.id).length === 4, 'the crossing is a crossroads');
  x.light = true;
  assert.deepEqual(stepsDone(t, v), [true, false]);
  const approach = v.net.segsAt(x.id).find(s => s.kind === N.KIND_ROAD);
  approach.addR = 2;
  assert.deepEqual(stepsDone(t, v), [true, true]);
  assert.equal(t.goal.done(v), false);
  const west = v.net.segsAt(x.id).filter(s => s.kind === N.KIND_ROAD);
  west[0].kind = N.KIND_AVENUE;
  assert.equal(t.goal.done(v), false, 'one side is not enough');
  for (const s of west) s.kind = N.KIND_AVENUE;
  assert.ok(t.goal.done(v));
});

test('Junctions: a roundabout counts as controlling the crossing', () => {
  const t = lesson('junctions'), { v } = start('junctions');
  assert.ok(v.net.addRoundabout(40.5, 27.5, N.ROUNDABOUT_RADIUS[N.KIND_AVENUE], N.KIND_AVENUE));
  assert.equal(t.steps[0].done(v), true);
  for (const s of v.net.segs.values()) if (s.kind === N.KIND_ROAD && Math.abs(v.net.nodes.get(s.a).z - 27.5) < 0.8 && Math.abs(v.net.nodes.get(s.b).z - 27.5) < 0.8) s.kind = N.KIND_AVENUE;
  assert.ok(t.goal.done(v), 'the arms, widened, meet the goal');
});

test('Highways: an exit and an entrance ramp joined to the streets', () => {
  const t = lesson('highways'), { v } = start('highways');
  // Off the northbound carriageway at x 50.5 down to the street at x 34.5, and back on to the southbound one.
  v.net.insertPath([{ x: 50.5, z: 32.5 }, { x: 42.5, z: 32.5 }], N.KIND_RAMP);
  v.net.insertPath([{ x: 42.5, z: 32.5 }, { x: 34.5, z: 32.5 }], N.KIND_ROAD);
  assert.deepEqual(stepsDone(t, v), [true, false]);
  v.net.insertPath([{ x: 34.5, z: 22.5 }, { x: 42.5, z: 22.5 }], N.KIND_ROAD);
  v.net.insertPath([{ x: 42.5, z: 22.5 }, { x: 53.5, z: 22.5 }], N.KIND_RAMP);
  assert.deepEqual(stepsDone(t, v), [true, true]);
  assert.ok(t.goal.done(v));
});

test('Buses: a stop, a route, a bus lane, then riders', () => {
  const t = lesson('buses'), { v } = start('buses');
  place(v, C.T_BUS, 14, 30);
  assert.deepEqual(stepsDone(t, v), [true, false, false]);
  v.stats.transport.busLines = 1;
  const avenue = [...v.net.segs.values()].find(s => s.kind === N.KIND_AVENUE && !s.fixed);
  avenue.bus = true;
  assert.deepEqual(stepsDone(t, v), [true, true, true]);
  assert.equal(t.goal.done(v), false);
  v.stats.transport.riders = 15;
  assert.ok(t.goal.done(v));
});

console.log(`${checks} tutorial checks passed${failures ? `, ${failures} failed` : ''}.`);
if (failures) process.exit(1);
