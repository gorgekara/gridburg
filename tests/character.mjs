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

const N = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const V = await import('../src/render/variants.ts');
const { T_RES } = await import('../src/constants.ts');

test('terrace runs: houses along one side of a street come in matching rows', () => {
  const net = new N.Network(); net.insertPath([{ x: 10, z: 20 }, { x: 60, z: 20 }], N.KIND_ROAD);
  const r = rasterize(net), kind = new Uint8Array(N_TILES), level = new Uint8Array(N_TILES);
  const side = [], other = [];
  for (let x = 12; x < 58; x++) {
    for (const [z, list] of [[21, side], [18, other]]) { const i = idx(x, z); if (r.accSeg[i] >= 0) { kind[i] = T_RES; level[i] = 1; list.push(i); } }
  }
  assert.ok(side.length > 20 && other.length > 20, 'lots on both sides');
  V.assignVariants(kind, level, r, net);
  // Along one side, lots share a run with a neighbour far more often than chance would give.
  let same = 0;
  for (let k = 1; k < side.length; k++) if (V.terraceRun(side[k]) === V.terraceRun(side[k - 1])) { same++; assert.equal(V.lotVariant(side[k]), V.lotVariant(side[k - 1])); }
  assert.ok(same >= side.length * 0.5, `${same} of ${side.length} share their neighbour's run`);
  // Across the street is another run.
  assert.notEqual(V.terraceRun(side[3]), V.terraceRun(other[3]));
  // A lot that is not a house keeps its own hash.
  kind[side[0]] = 3; V.assignVariants(kind, level, r, net);
  assert.equal(V.terraceRun(side[0]), -1);
});

test('building tints stay close to the paint, and a run is painted alike', () => {
  const a = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } }, b = { ...a, set: a.set };
  for (let k = 0; k < 200; k++) {
    C.buildingTint(k, 1, a);
    for (const v of [a.x, a.y, a.z]) assert.ok(v > 0.8 && v < 1.2, `tint ${v}`);
  }
  C.buildingTint(42, 2, a); C.buildingTint(42, 2, b);
  assert.deepEqual([a.x, a.y, a.z], [b.x, b.y, b.z]);
  C.buildingTint(42, 0, b);
  assert.ok(b.x + b.y + b.z < a.x + a.y + a.z, 'poor streets are grimier');
});

const { Kit } = await import('../src/render/streetDetail.ts');
const { dressLot } = await import('../src/render/dressing.ts');
const K = await import('../src/constants.ts');

test('street life: each piece is drawn when, and only when, its moment comes', () => {
  const body = { x0: -0.3, x1: 0.3, z0: -0.3, z1: 0.3, h: 0.9, r: 0, roof: null };
  const draw = (over) => {
    const kit = new Kit(), glow = new Kit();
    let n = 0; const stream = () => { n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648; };
    dressLot(kit, { glow, time: C.TIME.MIDDAY, grown: false, avenue: false, market: false, i: 7, kind: K.T_COM, level: 1, body, fine: true, pave: 0, nearShops: false,
      wealth: 1, rough: 0, litter: 0, loud: 0, rnd: stream, hash: () => 0.1, ...over });
    return { tris: kit.triangles, glow: glow.triangles };
  };
  const plain = draw({});
  assert.ok(draw({ market: true }).tris > plain.tris, 'a market stall on a market street');
  assert.ok(draw({ grown: true }).tris > plain.tris, 'scaffolding on a lot that grew');
  assert.ok(draw({ time: C.TIME.MORNING }).tris > draw({ time: C.TIME.AFTERNOON }).tris, 'a delivery van in the morning, not the afternoon');
  assert.ok(draw({ time: C.TIME.NIGHT, hash: () => 0.5 }).tris > draw({ time: C.TIME.MIDDAY, hash: () => 0.5 }).tris, 'shutters down at night');
  assert.ok(draw({ level: 2 }).glow > 0, 'neon over a bigger shop');
  const office = { kind: K.T_OFFICE, level: 2, body: { ...body, z1: 0.42 } };
  assert.ok(draw({ ...office }).tris > draw({ ...office, time: C.TIME.EVENING }).tris, 'a lunch cart at midday');
  assert.ok(draw({ wealth: 3, kind: K.T_RES, level: 2, body: { ...body, z1: 0.3 } }).tris > draw({ wealth: 1, kind: K.T_RES, level: 2, body: { ...body, z1: 0.3 } }).tris, 'rich flats are dressed up');
  assert.ok(draw({ rough: 2, litter: 2 }).tris > plain.tris * 1.2, 'a rough, littered street shows it');
});

const Lm = await import('../src/render/landmarks.ts');

test('landmarks: a clock tower per district with a town in it, plazas where land is dear, promenades by the water', () => {
  const net = new N.Network(); net.insertPath([{ x: 10, z: 30 }, { x: 70, z: 30 }], N.KIND_ROAD);
  const r = rasterize(net), kind = new Uint8Array(N_TILES), level = new Uint8Array(N_TILES), district = new Uint8Array(N_TILES);
  const terrain = { water: new Uint8Array(N_TILES), shore: new Uint8Array(N_TILES), height: new Float32Array(N_TILES) };
  // Towers along the street, with a gap every so often: the gaps are leftover garden ground.
  const gaps = [];
  for (let i = 0; i < N_TILES; i++) {
    if (r.accSeg[i] < 0 || r.cover[i]) continue;
    const x = i % GRID;
    if (x % 7 === 3) { gaps.push(i); continue; }
    kind[i] = T_RES; level[i] = 3;
  }
  assert.ok(gaps.length >= 4, 'some garden gaps');
  const input = { kind, level, raster: r, terrain, terraform: new Uint8Array(N_TILES), wealth: new Uint8Array(N_TILES).fill(3), land: new Uint8Array(N_TILES).fill(150), district };
  let plan = Lm.planLandmarks(input);
  assert.equal(plan.towers.length, 1, 'one tower for a city without districts');
  assert.ok(plan.plazas.length >= 1 && !plan.plazas.includes(plan.towers[0]), 'plazas on the dear ground, not on the tower');
  // Two districts, each a town: a tower in each, apart.
  for (let i = 0; i < N_TILES; i++) if (kind[i] || gaps.includes(i)) district[i] = i % GRID < 40 ? 1 : 2;
  plan = Lm.planLandmarks(input);
  assert.equal(plan.towers.length, 2);
  const [a, b] = plan.towers;
  // A tower stays put when the land values shift, as long as its spot is still free.
  const drift = Lm.planLandmarks({ ...input, land: input.land.map((v, i) => i === a ? 120 : v) }, plan);
  assert.ok(drift.towers.includes(a), 'the tower stays where it stands when values drift');
  // But not before the city's values are known.
  assert.equal(Lm.planLandmarks({ ...input, land: null }).towers.length, 0);
  assert.ok(Math.hypot(a % GRID - b % GRID, Math.floor(a / GRID) - Math.floor(b / GRID)) >= Lm.TOWER_SPACING);
  assert.notEqual(district[a], district[b]);
  // A poor city has no plazas.
  plan = Lm.planLandmarks({ ...input, wealth: new Uint8Array(N_TILES).fill(1) });
  assert.equal(plan.plazas.length, 0);
  // Water beside the road: its bank is a promenade.
  const bank = idx(40, 33), river = idx(40, 34);
  terrain.shore[bank] = 1; terrain.water[river] = 1; kind[bank] = 0; level[bank] = 0;
  plan = Lm.planLandmarks(input);
  assert.ok(plan.promenade.includes(bank), 'the bank by the town is a promenade');
});

console.log(`\n${checks} passed, ${failures} failed`);
if (failures) process.exit(1);
