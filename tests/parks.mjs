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
const { parkAccess, decorationPlacementAllowed } = await import('../src/parks.ts');
const at = (x, z) => z * C.GRID + x;
const kind = new Uint8Array(C.N_TILES);
const seed = at(20, 20), end = at(26, 20);
kind[seed] = C.T_PATH;
kind[seed + 1] = C.T_PLAZA;
kind[seed + 2] = C.T_LAWN;
kind[seed + 3] = C.T_PATH;
kind[seed + 4] = C.T_PATH;
kind[seed + 5] = C.T_PATH;
kind[end] = C.T_PARK_SHOP;
for (let x = 21; x <= 24; x++) kind[at(x, 21)] = C.T_PATH;
kind[at(23, 19)] = C.T_POND;
kind[at(23, 18)] = C.T_PATH;
kind[at(23, 17)] = C.T_FOUNTAIN;
let calls = 0;
const connected = i => { calls++; return i === seed; };
let access = parkAccess(kind, connected);
assert.equal(access[end], 1, 'Mixed pedestrian surfaces and loops connect a kiosk');
assert.equal(access[at(23, 19)], 1, 'Pond is accessible from a neighboring path');
assert.equal(access[at(23, 18)], 0, 'Water must not connect the path beyond it');
assert.equal(access[at(23, 17)], 0, 'An isolated component remains disconnected');
assert.ok(calls <= C.N_TILES, 'Road connectivity is checked at most once per tile');
kind[seed + 5] = 0;
access = parkAccess(kind, connected);
assert.equal(access[end], 0, 'Breaking the only path removes kiosk access');
assert.equal(access[at(22, 21)], 1, 'The accessible loop remains connected');
assert.equal(parkAccess(kind, () => false).some(Boolean), false, 'Disconnected loops cannot create their own access');

// Every destination is non-walkable, even if it is directly beside a road.
for (const amenity of [C.T_POND, C.T_TREE, C.T_BENCH, C.T_PARK_SHOP, C.T_FLOWERS, C.T_FOUNTAIN]) {
  kind.fill(0);
  kind[seed] = amenity; kind[seed + 1] = C.T_PATH;
  access = parkAccess(kind, i => i === seed);
  assert.equal(access[seed], 1);
  assert.equal(access[seed + 1], 0, 'A roadside amenity cannot bridge pedestrian access');
  kind[seed] = C.T_PATH; kind[seed + 1] = amenity; kind[seed + 2] = C.T_PATH;
  access = parkAccess(kind, i => i === seed);
  assert.equal(access[seed + 1], 1);
  assert.equal(access[seed + 2], 0);
}
kind.fill(0);
kind[C.GRID - 1] = C.T_PATH; kind[C.GRID] = C.T_PATH;
assert.equal(parkAccess(kind, i => i === C.GRID - 1)[C.GRID], 0, 'Rows never wrap');
kind.fill(0);
kind[0] = C.T_PATH; kind[C.GRID + 1] = C.T_BENCH;
assert.equal(parkAccess(kind, i => i === 0)[C.GRID + 1], 0, 'Diagonal contact gives no access');
console.log('✓ Park loops, mixed paths, disconnected components, destination-only amenities, and map edges');

const state = {
  kind: new Uint8Array(C.N_TILES), water: new Uint8Array(C.N_TILES),
  shore: new Uint8Array(C.N_TILES), cover: new Uint8Array(C.N_TILES),
  owners: new Int32Array(C.N_TILES).fill(-1), airportClearance: new Uint8Array(C.N_TILES),
};
assert.equal(decorationPlacementAllowed(seed, state), true);
for (let k = C.T_PATH; k <= C.T_LAWN; k++) {
  state.kind[seed] = k;
  assert.equal(decorationPlacementAllowed(seed, state), true, 'Existing park pieces can be replaced');
}
for (const k of [C.T_RES, C.T_PARK, C.T_AIRPORT]) {
  state.kind[seed] = k;
  assert.equal(decorationPlacementAllowed(seed, state), false, 'Other zoning/buildings cannot be overwritten');
}
state.kind[seed] = 0;
for (const field of ['water', 'shore', 'cover', 'airportClearance']) {
  state[field][seed] = 1;
  assert.equal(decorationPlacementAllowed(seed, state), false, `${field} blocks placement`);
  state[field][seed] = 0;
}
state.owners[seed] = seed - 1;
assert.equal(decorationPlacementAllowed(seed, state), false, 'Service footprint blocks placement away from its anchor');
for (const i of [-1, C.N_TILES, 0.5, NaN]) assert.equal(decorationPlacementAllowed(i, state), false);
console.log('✓ Decoration replacement, terrain, occupied footprints, and airport clearance validation');
