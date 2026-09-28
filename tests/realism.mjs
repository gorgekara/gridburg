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

console.log(`\n${checks} passed, ${failures} failed`);
if (failures) process.exit(1);
