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
const { junctionLab, highwayLab } = await import('../src/debugMaps.ts');
const { encode, decode } = await import('../src/save.ts');

let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const count = (d, k) => Array.from(d.kind).filter(v => v === k).length;
/** Every road reaches the highway entrance: one network, nothing left stranded. */
function connected(net) {
  const entry = [...net.nodes.values()].find(n => n.entry) ?? [...net.nodes.values()][0];
  const seen = new Set([entry.id]), queue = [entry.id];
  for (let h = 0; h < queue.length; h++) for (const s of net.segsAt(queue[h])) { const o = s.a === queue[h] ? s.b : s.a; if (!seen.has(o)) { seen.add(o); queue.push(o); } }
  return [...net.segs.values()].filter(s => !seen.has(s.a)).length;
}

test('the junction lab has every kind of junction it promises, all joined up, with a town to drive them', () => {
  const d = junctionLab(), net = N.Network.fromPlain(d.net);
  const nodes = [...net.nodes.values()], segs = [...net.segs.values()];
  assert.ok(nodes.filter(n => n.light).length >= 2, 'signals');
  assert.ok((d.net.signals ?? []).some(([, p]) => p.adaptive), 'an adaptive signal');
  assert.ok(nodes.some(n => n.stop), 'an all-way stop');
  assert.ok(nodes.some(n => n.bans?.length), 'a banned turn');
  assert.ok(segs.some(s => s.parking) && segs.some(s => s.trees), 'streets with parking lanes and trees');
  assert.equal(net.roundabouts().length, 2, 'a street and an avenue roundabout');
  assert.ok(segs.some(s => s.bus) && segs.some(s => s.bike) && segs.some(s => s.calm), 'bus and bike lanes, calming');
  assert.ok(segs.some(s => s.addR || s.addL), 'turn pockets');
  assert.ok(segs.some(s => s.oneway && s.kind === N.KIND_ROAD), 'one-way streets');
  assert.ok(segs.some(s => s.kind === N.KIND_LANE), 'narrow lanes');
  assert.ok(nodes.some(n => net.degree(n.id) >= 5), 'a five-way junction');
  assert.equal(connected(net), 0, 'every road reaches the entrance');
  assert.ok(count(d, C.T_RES) > 300 && count(d, C.T_COM) > 200 && count(d, C.T_COAL) > 0 && count(d, C.T_PUMP) > 0 && count(d, C.T_OUTLET) > 0);
  assert.ok(count(d, C.T_BUS) >= 2, 'bus stops');
  assert.ok(decode(encode(d)), 'it saves');
});

test('the highway lab has exits and entrances with their own lanes, three levels, ramps between them and a tunnel', () => {
  const d = highwayLab(), net = N.Network.fromPlain(d.net);
  const segs = [...net.segs.values()], nodes = [...net.nodes.values()];
  assert.ok(segs.filter(s => s.kind === N.KIND_HIGHWAY2 && (s.addR || s.addL)).length >= 2, 'lanes for an exit and an entrance');
  for (const lv of [1, 2, 3]) assert.ok(nodes.some(n => n.level === lv), `a road on level ${lv}`);
  assert.ok(nodes.some(n => n.level === -1), 'a tunnel');
  assert.ok(segs.some(s => s.structure === 1 && ((s.ya ?? 0) > 0) !== ((s.yb ?? 0) > 0)), 'a ramp between the ground and a level');
  assert.equal(connected(net), 0, 'every road reaches the entrance');
  assert.ok(count(d, C.T_RES) > 300 && count(d, C.T_COAL) > 0);
  assert.ok(decode(encode(d)), 'it saves');
});

console.log(`${checks} test map checks passed; ${failures} failed`);
if (failures) process.exit(1);
