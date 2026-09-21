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
const { airportRunway, airportClearanceTiles, airportClearanceMask, airportPlacementBlocked } = await import('../src/airports.ts');
const { footprint } = await import('../src/sites.ts');
const at = (x, z) => z * C.GRID + x;
const anchor = at(40, 40);
const expected = [
  { x: 40.5, z: 40.5, dx: 1, dz: 0 },
  { x: 40.5, z: 47.5, dx: 0, dz: -1 },
  { x: 47.5, z: 42.5, dx: -1, dz: 0 },
  { x: 42.5, z: 40.5, dx: 0, dz: 1 },
];
for (let rot = 0; rot < 4; rot++) {
  assert.deepEqual(airportRunway(anchor, rot), expected[rot]);
  const frame = expected[rot], protectedTiles = new Set(airportClearanceTiles(anchor, rot));
  const runwayTile = u => at(Math.floor(frame.x + u * frame.dx), Math.floor(frame.z + u * frame.dz));
  for (const t of footprint(anchor, C.T_AIRPORT, rot)) assert.ok(protectedTiles.has(t));
  for (const u of [-12, -1, 8, 19]) assert.ok(protectedTiles.has(runwayTile(u)), 'Both approaches must extend 12 tiles');
  for (const u of [-13, 20]) assert.ok(!protectedTiles.has(runwayTile(u)), 'The corridor must have a bounded length');
  const kind = new Uint8Array(C.N_TILES), levels = new Uint8Array(C.N_TILES), rotations = new Uint8Array(C.N_TILES);
  const obstacle = runwayTile(15);
  kind[obstacle] = C.T_RES;
  assert.equal(airportPlacementBlocked(anchor, rot, kind, levels, rotations), false, 'Empty zoning does not force demolition');
  levels[obstacle] = 1;
  assert.equal(airportPlacementBlocked(anchor, rot, kind, levels, rotations), true);
  kind[obstacle] = 0;
  kind[anchor] = C.T_AIRPORT; rotations[anchor] = rot;
  assert.equal(airportClearanceMask(kind, rotations)[obstacle], 1);
  kind[anchor] = 0;
  assert.equal(airportClearanceMask(kind, rotations)[obstacle], 0, 'Demolishing an airport releases clearance');
}
// A three-wide service can obstruct the corridor even if its anchor is outside it.
{
  const kind = new Uint8Array(C.N_TILES), levels = new Uint8Array(C.N_TILES);
  kind[at(50, 37)] = C.T_GARDEN;
  assert.ok(!airportClearanceTiles(anchor).includes(at(50, 37)));
  assert.equal(airportPlacementBlocked(anchor, 0, kind, levels), true);
}
for (let rot = 0; rot < 4; rot++) {
  for (const tile of airportClearanceTiles(0, rot)) {
    assert.ok(tile >= 0 && tile < C.N_TILES);
    assert.ok(tile % C.GRID < 21 && Math.floor(tile / C.GRID) < 21, 'Clipped approaches must not wrap across the map');
  }
}
assert.deepEqual(airportClearanceTiles(C.N_TILES - 1), []);
console.log('✓ Airport quarter turns, bounded corridors, overlapping footprints, and map edges');

const { demoCity } = await import('../src/demo.ts');
const { Network } = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
let last;
globalThis.self = { postMessage: m => { if (m.type === 'state') last = m; } };
const oldInterval = globalThis.setInterval;
globalThis.setInterval = () => 0;
await import('../src/sim/worker.ts');
globalThis.setInterval = oldInterval;
const send = data => self.onmessage({ data });
function payload(city) {
  const net = Network.fromPlain(city.net), r = rasterize(net);
  return { ...city, cityLevel: city.cityLevel ?? 0, serial: 1, cover: r.cover, accSeg: r.accSeg, accS: r.accS };
}
const city = demoCity();
Math.random = C.mulberry32(42);
send({ type: 'load', ...payload(city) });
send({ type: 'warm', ticks: 120 });
const target = city.kind.findIndex((k, i) => C.isZone(k) && city.level[i] === 0 && last.level[i] > 0 && i % C.GRID > 20 && i % C.GRID < C.GRID - 20 && Math.floor(i / C.GRID) > 20 && Math.floor(i / C.GRID) < C.GRID - 25);
assert.ok(target >= 0, 'Control city must produce a growing lot');
const airport = target + C.GRID * 12;
city.kind[airport] = C.T_AIRPORT;
city.rot ??= new Uint8Array(C.N_TILES);
city.rot[airport] = 1;
assert.equal(airportClearanceMask(city.kind, city.rot)[target], 1);
const legacy = target + C.GRID;
city.kind[legacy] = C.T_RES; city.level[legacy] = 1;
Math.random = C.mulberry32(42);
send({ type: 'load', ...payload(city) });
assert.equal(last.level[legacy], 1, 'Loading clearance must preserve existing buildings');
send({ type: 'warm', ticks: 300 });
assert.equal(last.level[target], 0, 'Worker must prevent construction in the rotated approach');
city.kind[airport] = 0;
send({ type: 'edit', ...payload(city), spent: 0 });
send({ type: 'warm', ticks: 300 });
assert.ok(last.level[target] > 0, 'Worker must release cleared land when an airport is removed');
console.log('✓ Real worker honors rotated clearance on load, preserves legacy buildings, and releases it on edit');
