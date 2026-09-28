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
const W = await import('../src/render/weather.ts');
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const DAY = 480;
/** Seconds on the city clock at `hour` of city day `day` (the clock starts at 9:00 on day 0). */
const at = (day, hour) => ((day * 24 + hour) - 9) * DAY / 24;

test('weather: the same moment always has the same weather', () => {
  assert.deepEqual(W.weatherAt(at(12, 14), DAY), W.weatherAt(at(12, 14), DAY));
});

test('weather: over many days each kind comes up about as often as meant', () => {
  const n = { clear: 0, overcast: 0, rain: 0, fog: 0 };
  for (let d = 0; d < 2000; d++) n[W.kindOfDay(d)]++;
  for (const [k, share] of Object.entries({ clear: 0.5, overcast: 0.22, rain: 0.18, fog: 0.1 })) assert.ok(Math.abs(n[k] / 2000 - share) < 0.05, `${k}: ${n[k] / 2000}`);
});

test('weather: fog is thickest at dawn on a foggy day, and burns off', () => {
  const d = [...Array(200).keys()].find(d => d > 0 && W.kindOfDay(d) === 'fog');
  assert.ok(d !== undefined);
  assert.ok(W.weatherAt(at(d, 7), DAY).fog > 0.8);
  assert.ok(W.weatherAt(at(d, 15), DAY).fog < 0.4);
});

test('weather: the streets stay wet after the rain stops, and dry out', () => {
  const d = [...Array(400).keys()].find(d => W.kindOfDay(d) === 'rain' && W.kindOfDay(d + 1) === 'clear' && W.kindOfDay(d + 2) === 'clear');
  // Find a moment when it has just stopped raining.
  let t = null;
  for (let h = 4; h < 21; h += 0.1) if (W.weatherAt(at(d, h), DAY).rain > 0.3 && W.weatherAt(at(d, h + 0.5), DAY).rain === 0) { t = h + 0.5; break; }
  assert.ok(t !== null, 'a shower that ends');
  assert.ok(W.weatherAt(at(d, t), DAY).wet > 0.2, 'still wet just after');
  assert.equal(W.weatherAt(at(d + 1, 14), DAY).wet, 0, 'dry the next afternoon');
});

test('weather: nothing snaps at midnight', () => {
  for (let d = 1; d < 60; d++) {
    const a = W.weatherAt(at(d, 23.99), DAY), b = W.weatherAt(at(d + 1, 0.01), DAY);
    assert.ok(Math.abs(a.cloud - b.cloud) < 0.02 && Math.abs(a.fog - b.fog) < 0.05, `day ${d}`);
  }
});

const G = await import('../src/render/buildingGeo.ts');
const K = await import('../src/constants.ts');

test('smoke: stacks and chimneys breathe from their tops, and plain houses do not', () => {
  const tops = (k, l, v) => { G.buildingGeometry(k, l, v, 1); return { e: G.emittersOf(k, l, v), h: G.buildingHeight(k, l, v) }; };
  const coal = tops(K.T_COAL, 1, 0);
  assert.ok(coal.e.length >= 3, 'a coal plant has its stacks and its cooling tower');
  assert.ok(coal.e.some(([, y, , k]) => k === G.Emit.Smoke && y > coal.h - 0.05), 'smoke from the top of the tallest stack');
  const factory = tops(K.T_IND, 1, 1);
  assert.ok(factory.e.filter(([, , , k]) => k === G.Emit.Smoke).length === 2, 'the brick plant smokes from both stacks');
  const chimneyHouse = tops(K.T_RES, 1, 5), plain = tops(K.T_RES, 1, 2);
  assert.equal(chimneyHouse.e.length, 1); assert.equal(chimneyHouse.e[0][3], G.Emit.Chimney);
  assert.equal(plain.e.length, 0);
  for (const [x, , z] of [...coal.e, ...factory.e, ...chimneyHouse.e]) assert.ok(Math.abs(x) < 1.6 && Math.abs(z) < 1.6, 'on its own site');
});

const C = await import('../src/render/character.ts');

test('crowds: shopping streets fill at lunch, homes in the evening, offices at rush hour', () => {
  const kind = new Uint8Array(40), level = new Uint8Array(40).fill(2), acc = new Int32Array(40).fill(-1);
  for (let i = 0; i < 10; i++) { kind[i] = K.T_COM; acc[i] = 1; }
  for (let i = 10; i < 20; i++) { kind[i] = K.T_RES; acc[i] = 2; }
  for (let i = 20; i < 30; i++) { kind[i] = K.T_OFFICE; acc[i] = 3; }
  for (let i = 30; i < 34; i++) { kind[i] = K.T_PARK; level[i] = 0; acc[i] = 4; }
  const lengths = new Map([[1, 10], [2, 10], [3, 10], [4, 10]]);
  const at = h => C.streetLife(kind, level, acc, lengths, h, k => k === K.T_PARK);
  const noon = at(12.5), evening = at(21), rush = at(8), night = at(3);
  assert.ok(noon.get(1).people > noon.get(2).people, 'shops beat homes at lunch');
  assert.ok(evening.get(2).people > evening.get(1).people, 'homes beat shops in the evening');
  assert.ok(rush.get(3).people > at(10).get(3).people * 2, 'office streets fill at rush hour');
  assert.ok(rush.get(3).office > 0.9, 'and it is commuters');
  assert.ok(noon.get(4).green > 0, 'parks draw the joggers');
  assert.ok(night.get(1).people < noon.get(1).people * 0.2, 'shopping streets empty at night');
});

console.log(`\n${checks} passed, ${failures} failed`);
if (failures) process.exit(1);
