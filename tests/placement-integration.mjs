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
const { Game } = await import('../src/game.ts');
const { Input } = await import('../src/input.ts');
const { encode, decode } = await import('../src/save.ts');
const { airportRunway } = await import('../src/airports.ts');
const { decorationPlacementAllowed } = await import('../src/parks.ts');
const { Network, KIND_ROAD } = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { BuildingLayer } = await import('../src/render/buildings.ts');
const { TransportLayer } = await import('../src/render/transport.ts');
const THREE = await import('three');
const at = (x, z) => z * C.GRID + x;
let failures = 0, checks = 0;
function test(name, run) {
  try { run(); checks++; console.log(`✓ ${name}`); }
  catch (error) { failures++; console.error(`✗ ${name}\n${error.stack}`); }
}
const workers = [];
globalThis.Worker = class { constructor() { this.messages = []; workers.push(this); } postMessage(m) { this.messages.push(m); } };
function emptyGame() {
  const game = new Game();
  game.terrain.water.fill(0); game.terrain.shore.fill(0);
  game.stats.money = 100000; game.stats.cityLevel = 5;
  game.flush();
  return game;
}
function inputFor(game, tool = 'airport', rot = 0) {
  return Object.assign(Object.create(Input.prototype), { game, tool, placeRotation: rot });
}
function placementState(game) {
  return { kind: game.kind, water: game.terrain.water, shore: game.terrain.shore, cover: game.raster.cover, owners: game.owners, airportClearance: game.airportClearance };
}
for (let rot = 0; rot < 4; rot++) test(`Airport turn ${rot}: preview/commit exclusion, rotation payload, removal and spending`, () => {
  const g = emptyGame(), airport = at(40, 40), frame = airportRunway(airport, rot);
  const approach = at(Math.floor(frame.x + 15 * frame.dx), Math.floor(frame.z + 15 * frame.dz));
  assert.equal(g.setKind(airport, C.T_AIRPORT, 12000, rot), true);
  g.flush();
  const payload = workers.at(-1).messages.at(-1);
  assert.equal(payload.rot[airport], rot);
  assert.notEqual(payload.rot, g.rot, 'Worker receives a snapshot rather than a live rotation array');
  assert.equal(g.buildable(approach), false);
  assert.match(inputFor(g).serviceProblem(approach, C.T_TREE), /runway|flight path/i);
  const money = g.stats.money;
  assert.equal(g.setKind(approach, C.T_RES, 25), false);
  assert.equal(g.setKind(approach, C.T_TREE, 45), false);
  g.flush();
  assert.equal(g.stats.money, money, 'Rejected placements do not charge money');
  assert.equal(g.kind[approach], 0);
  assert.equal(g.setKind(airport, 0, 0), true);
  assert.equal(g.buildable(approach), true);
  assert.equal(g.setKind(approach, C.T_TREE, 45), true);
  g.flush();
  assert.equal(g.stats.money, money - 45);
});
test('Occupied airport approach is rejected by preview and commit without demolition', () => {
  const g = emptyGame(), airport = at(40, 40), obstacle = at(52, 40);
  g.setKind(obstacle, C.T_RES, 0); g.level[obstacle] = 2;
  g.raster.accSeg[airport] = 0;
  assert.match(inputFor(g).serviceProblem(airport, C.T_AIRPORT), /clear buildings/i);
  assert.equal(g.setKind(airport, C.T_AIRPORT, 12000), false);
  g.flush();
  assert.equal(g.stats.money, 100000);
  assert.equal(g.kind[obstacle], C.T_RES); assert.equal(g.level[obstacle], 2);
});
test('Loading a legacy airport preserves nearby structures and reinstates rotated clearance', () => {
  const g = emptyGame(), airport = at(40, 40), obstacle = at(40, 33);
  const saved = g.snapshot();
  saved.kind[airport] = C.T_AIRPORT; saved.rot[airport] = 1; saved.level[airport] = 1;
  saved.kind[obstacle] = C.T_RES; saved.level[obstacle] = 3;
  g.load(decode(encode(saved)));
  assert.equal(g.kind[obstacle], C.T_RES); assert.equal(g.level[obstacle], 3);
  assert.equal(g.airportClearance[obstacle], 1);
  assert.equal(workers.at(-1).messages.at(-1).rot[airport], 1);
});
test('Park pieces round-trip through Game, compact save encoding, and load', () => {
  const g = emptyGame();
  for (let k = C.T_PATH; k <= C.T_LAWN; k++) assert.equal(g.setKind(at(30 + k - C.T_PATH, 30), k, C.SERVICES[k].cost, k % 4), true);
  g.flush();
  const money = g.stats.money;
  const h = emptyGame(); h.load(decode(encode(g.snapshot())));
  for (let k = C.T_PATH; k <= C.T_LAWN; k++) {
    const tile = at(30 + k - C.T_PATH, 30);
    assert.equal(h.kind[tile], k); assert.equal(h.level[tile], 1);
  }
  assert.equal(h.stats.money, money);
});
test('Decoration replacement works without road access and charges only accepted changes', () => {
  const g = emptyGame(), tile = at(20, 20), input = inputFor(g, 'tree');
  assert.equal(g.raster.accSeg[tile], -1);
  assert.equal(input.serviceProblem(tile, C.T_TREE), null);
  assert.equal(decorationPlacementAllowed(tile, placementState(g)), true);
  assert.equal(g.setKind(tile, C.T_TREE, C.SERVICES[C.T_TREE].cost), true);
  assert.equal(g.setKind(tile, C.T_BENCH, C.SERVICES[C.T_BENCH].cost), true);
  assert.equal(g.setKind(tile, C.T_BENCH, C.SERVICES[C.T_BENCH].cost), false);
  g.flush();
  assert.equal(g.stats.money, 100000 - C.SERVICES[C.T_TREE].cost - C.SERVICES[C.T_BENCH].cost);
});
test('Game rejects decoration overwrites and invalid airport footprints without spending', () => {
  const g = emptyGame(), tile = at(20, 20);
  g.setKind(tile, C.T_RES, 0); g.level[tile] = 2;
  assert.equal(g.setKind(tile, C.T_TREE, 45), false);
  assert.equal(g.setKind(C.N_TILES - 1, C.T_AIRPORT, 12000), false);
  assert.equal(g.setKind(-1, C.T_TREE, 45), false);
  g.flush();
  assert.equal(g.kind[tile], C.T_RES); assert.equal(g.level[tile], 2);
  assert.equal(g.stats.money, 100000);
});

const layer = new BuildingLayer();
for (let rot = 0; rot < 4; rot++) test(`Path meshes connect east in world space with saved rotation ${rot}`, () => {
  const kind = new Uint8Array(C.N_TILES), level = new Uint8Array(C.N_TILES), rotations = new Uint8Array(C.N_TILES);
  const tile = at(20, 20); kind[tile] = C.T_PATH; kind[tile + 1] = C.T_BENCH; rotations[tile] = rot;
  const r = rasterize(new Network());
  // Facade offsets and an apparent nearby road must not move/turn a park tile.
  r.lotX[tile] = 20.85; r.lotZ[tile] = 20.7; r.accSeg[tile] = 0; r.accX[tile] = 21; r.accZ[tile] = 20;
  layer.rebuild(kind, level, r, rotations);
  const mesh = layer.group.children.find(m => m.count > 0 && m.userData.tileIds?.slice(0, m.count).includes(tile));
  assert.ok(mesh);
  const index = mesh.userData.tileIds.indexOf(tile), matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  const points = [], positions = mesh.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) if (positions.getY(i) > 0.013) points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix));
  const centerX = 20.5 - C.GRID / 2, centerZ = 20.5 - C.GRID / 2;
  assert.ok(Math.max(...points.map(p => p.x)) > centerX + 0.49, 'The path must reach its eastern neighbor');
  assert.ok(Math.min(...points.map(p => p.x)) > centerX - 0.18, 'The unconnected western arm must be absent');
  assert.ok(points.every(p => Math.abs(p.z - centerZ) < 0.18), 'No north/south arm or facade offset');
});
layer.group.traverse(o => { o.geometry?.dispose(); if (o.material) for (const mat of Array.isArray(o.material) ? o.material : [o.material]) mat.dispose(); });

let last;
globalThis.self = { postMessage: m => { if (m.type === 'state') last = m; } };
const oldInterval = globalThis.setInterval; globalThis.setInterval = () => 0;
await import('../src/sim/worker.ts'); globalThis.setInterval = oldInterval;
const send = data => self.onmessage({ data });
test('Real worker enables distant park amenities through paths and disables them when disconnected', () => {
  const net = new Network(), a = net.addNode(0, 60.5), b = net.addNode(30.5, 60.5); a.entry = true;
  net.addSeg(a.id, b.id, 15.25, 60.5, KIND_ROAD);
  const g = emptyGame(), city = g.snapshot(); city.net = net.toPlain();
  for (let z = 62; z <= 70; z++) { city.kind[at(20, z)] = C.T_PATH; city.level[at(20, z)] = 1; }
  const kiosk = at(20, 71); city.kind[kiosk] = C.T_PARK_SHOP; city.level[kiosk] = 1;
  const r = rasterize(net), base = { ...city, serial: 1, cover: r.cover, accSeg: r.accSeg, accS: r.accS };
  assert.equal(r.accSeg[kiosk], -1, 'Kiosk itself is too far from the road');
  send({ type: 'load', ...base });
  assert.equal(last.flags[kiosk] & (C.F_NO_ROAD | C.F_NO_POWER | C.F_NO_WATER | C.F_NO_SEWAGE), 0, 'Path-connected park amenities need no building utility service');
  city.kind[at(20, 66)] = 0;
  send({ type: 'edit', ...base, spent: 0 });
  assert.ok(last.flags[kiosk] & C.F_NO_ROAD);
  city.kind[at(20, 66)] = C.T_PATH;
  send({ type: 'edit', ...base, spent: 0 });
  assert.equal(last.flags[kiosk] & C.F_NO_ROAD, 0);
});
test('Aircraft follow every rotated runway and redraw when only rotation changes', () => {
  const transport = new TransportLayer(), net = new Network(), raster = rasterize(net);
  const kind = new Uint8Array(C.N_TILES), flags = new Uint8Array(C.N_TILES), rotations = new Uint8Array(C.N_TILES);
  const tile = at(40, 40); kind[tile] = C.T_AIRPORT; raster.accSeg[tile] = 0;
  let previous;
  for (let rot = 0; rot < 4; rot++) {
    rotations[tile] = rot;
    transport.rebuild(kind, flags, raster, net, [], rotations);
    assert.equal(transport.planes.length, 1);
    const plane = transport.planes[0];
    assert.notEqual(plane.mesh, previous, 'A rotation-only edit must invalidate cached aircraft layout');
    const time = (36 + 10 - tile % 30) % 36;
    transport.update(time);
    const runway = airportRunway(tile, rot), u = 2.5 + 4 * 1.1;
    assert.ok(Math.abs(plane.mesh.position.x - (runway.x - C.GRID / 2 + runway.dx * u)) < 1e-6);
    assert.ok(Math.abs(plane.mesh.position.z - (runway.z - C.GRID / 2 + runway.dz * u)) < 1e-6);
    const nose = new THREE.Vector3(1, 0, 0).applyEuler(plane.mesh.rotation);
    assert.ok(Math.abs(nose.x - runway.dx) < 1e-6 && Math.abs(nose.z - runway.dz) < 1e-6, 'Aircraft nose points along its runway');
    assert.equal(plane.mesh.visible, true);
    previous = plane.mesh;
  }
  transport.group.traverse(o => { o.geometry?.dispose(); if (o.material) for (const mat of Array.isArray(o.material) ? o.material : [o.material]) mat.dispose(); });
});
console.log(`${checks} placement integration checks passed; ${failures} failed`);
if (failures) process.exitCode = 1;
