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
const C = await import('../src/render/character.ts');
const { N_TILES, GRID, idx } = await import('../src/constants.ts');
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const maps = (fill = {}) => {
  const m = { land: new Uint8Array(N_TILES), noise: new Uint8Array(N_TILES), wellbeing: new Uint8Array(N_TILES), garbage: new Uint8Array(N_TILES), crime: new Uint8Array(N_TILES) };
  for (const [k, v] of Object.entries(fill)) m[k].fill(v);
  return m;
};
const none = new Uint8Array(N_TILES);
const mid = idx(GRID / 2, GRID / 2);

test('no maps: every tile is ordinary', () => {
  const b = C.bandsOf(null, none);
  assert.equal(b.wealth[mid], 1); assert.equal(b.rough[mid], 0); assert.equal(b.litter[mid], 0); assert.equal(b.loud[mid], 0);
});

test('cut points', () => {
  for (const [land, w] of [[30, 0], [90, 1], [130, 2], [200, 3]]) assert.equal(C.bandsOf(maps({ land }), none).wealth[mid], w, `land ${land}`);
  for (const [crime, r] of [[0, 0], [40, 1], [90, 2]]) assert.equal(C.bandsOf(maps({ crime, land: 100 }), none).rough[mid], r, `crime ${crime}`);
  for (const [garbage, l] of [[0, 0], [70, 1], [150, 2]]) assert.equal(C.bandsOf(maps({ garbage, land: 100 }), none).litter[mid], l, `garbage ${garbage}`);
  assert.equal(C.bandsOf(maps({ noise: 120, land: 100 }), none).loud[mid], 1);
});

test('neglect makes a tile rough', () => {
  const n = new Uint8Array(N_TILES); n[mid] = 3;
  assert.equal(C.bandsOf(maps({ land: 100 }), n).rough[mid], 2);
});

test('smoothing: one hot tile does not flip its neighbours', () => {
  const m = maps({ land: 100 }); m.crime[mid] = 100;
  const b = C.bandsOf(m, none);
  assert.equal(b.rough[mid + 1], 0, 'the neighbour stays calm');
  const m2 = maps({ land: 100 });
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) m2.crime[mid + dx + dz * GRID] = 100;
  assert.equal(C.bandsOf(m2, none).rough[mid], 2, 'a hot block is rough');
});

test('hysteresis: inside the margin a tile keeps its band, past it the band changes', () => {
  const before = C.bandsOf(maps({ land: 130 }), none);
  assert.equal(before.wealth[mid], 2);
  assert.equal(C.bandsOf(maps({ land: 111 }), none, before).wealth[mid], 2, 'just under the cut, kept');
  assert.equal(C.bandsOf(maps({ land: 111 }), none).wealth[mid], 1, 'with no history it falls');
  assert.equal(C.bandsOf(maps({ land: 104 }), none, before).wealth[mid], 1, 'past the margin, it falls');
  assert.equal(C.bandsOf(maps({ land: 155 }), none, before).wealth[mid], 2, 'just over the next cut is not enough to rise');
  assert.equal(C.bandsOf(maps({ land: 160 }), none, before).wealth[mid], 3);
});

test('band code packs all four bands', () => {
  const b = C.bandsOf(maps({ land: 230, crime: 90, garbage: 150, noise: 120 }), none);
  assert.equal(C.bandCode(b, mid), 3 + 4 * 2 + 16 * 2 + 64 * 1);
});

test('time bands follow the hour', () => {
  assert.equal(C.timeBand(3), C.TIME.NIGHT);
  assert.equal(C.timeBand(6.5), C.TIME.EARLY);
  assert.equal(C.timeBand(9), C.TIME.MORNING);
  assert.equal(C.timeBand(12.5), C.TIME.MIDDAY);
  assert.equal(C.timeBand(16), C.TIME.AFTERNOON);
  assert.equal(C.timeBand(20), C.TIME.EVENING);
  assert.equal(C.timeBand(23), C.TIME.NIGHT);
});

test('window occupancy rises through dusk and thins in the small hours', () => {
  const home = h => C.occupancy(h)[0], office = h => C.occupancy(h)[1];
  assert.ok(home(20) > 0.8 && home(3) < 0.2 && home(18) > home(3));
  assert.ok(office(18) > 0.8 && office(3) < 0.1 && office(22) < 0.3);
});

console.log(`\n${checks} passed, ${failures} failed`);
if (failures) process.exit(1);
