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
const { BuildingLayer } = await import('../src/render/buildings.ts');
const { loadSettings, saveSettings } = await import('../src/ui/menu.ts');
const { advanceCity, levelForPopulation, MILESTONES } = await import('../src/progression.ts');
const { civicCoverage } = await import('../src/sim/civic.ts');
const { encode, decode } = await import('../src/save.ts');
const { buildingGeometry, Builder, BANNER_COLORS, VARIANTS } = await import('../src/render/buildingGeo.ts');
const { demoCity } = await import('../src/demo.ts');
const X = await import('../src/extras.ts');
/** Bytes the v13 extras block takes for a city that has changed none of them. */
/** Bytes the v13 extras block takes for a city, mirroring what encode() writes (including motorway kind bits). */
const extrasLength = (city) => {
  const segHi = city.net.segs.flatMap((seg, k) => (seg[5] & 256 ? [k] : []));
  const json = { ...X.extrasToJson(city.extras ?? X.defaultExtras(city.tax)), ...(segHi.length ? { segHi } : {}) };
  return 4 + new TextEncoder().encode(JSON.stringify(json)).length;
};
const { newCity, DOOR, HIGHWAY_END, highwayLayout } = await import('../src/game.ts');
const N = await import('../src/roads/network.ts');
const { Network, HALF_WIDTH, SPEED, KIND_ROAD, KIND_AVENUE, KIND_LANE, KIND_HIGHWAY, ROAD_LABEL, ROUNDABOUT_RADIUS, UPGRADE_ORDER, nextRoadKind } = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { defaultFunding, LOAN_TOTAL, LOAN_AMOUNT, NEGLECT_LIMIT } = await import('../src/management.ts');
const { gridPoint, roadPoint, buildingRotation } = await import('../src/placement.ts');
const { generateTerrain, WATER_EDGE, adjacentFlow, touchesWater } = await import('../src/terrain.ts');
const { POLICIES, noPolicies, policyEffects, policyExpense, policyMask, policiesFromMask } = await import('../src/policies.ts');
const { ensureApproaches, APPROACH, mapGates } = await import('../src/roads/entries.ts');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }

test('detailed windows stay below the old box budget and face outwards on every facade', () => {
  const b = new Builder(1);
  b.windows(1, 1, 1, 0.2, 1, 1, 1);
  const g = b.build(), p = g.attributes.position, n = g.attributes.normal;
  assert.ok(p.count / 3 < 4 * 12, 'framed windows must use fewer triangles than four boxes');
  const sides = new Set();
  for (let i = 0; i < p.count; i += 3) {
    const nx = n.getX(i), nz = n.getZ(i);
    assert.ok(p.getX(i) * nx + p.getZ(i) * nz > 0.49, 'window faces away from building');
    sides.add(`${Math.round(nx)},${Math.round(nz)}`);
    const ax = p.getX(i+1)-p.getX(i), ay = p.getY(i+1)-p.getY(i), az = p.getZ(i+1)-p.getZ(i);
    const bx = p.getX(i+2)-p.getX(i), by = p.getY(i+2)-p.getY(i), bz = p.getZ(i+2)-p.getZ(i);
    assert.ok((ay*bz-az*by)*nx + (az*bx-ax*bz)*n.getY(i) + (ax*by-ay*bx)*nz > 0, 'front-face winding agrees with normal');
  }
  assert.equal(sides.size, 4);
  g.dispose();
});

test('graphics settings migrate, persist, and reject unknown detail levels', () => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let saved = JSON.stringify({ shadows: false });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => saved, setItem: (_key, value) => { saved = value; },
  }});
  try {
    assert.equal(loadSettings().visualDetail, 1);
    assert.equal(loadSettings().shadows, false);
    saveSettings({ ...loadSettings(), visualDetail: 2 });
    assert.equal(loadSettings().visualDetail, 2);
    saved = JSON.stringify({ visualDetail: 99 });
    assert.equal(loadSettings().visualDetail, 1);
  } finally {
    if (old) Object.defineProperty(globalThis, 'localStorage', old);
    else delete globalThis.localStorage;
  }
});

test('detail presets increase geometry while keeping building footprints stable', () => {
  const counts = [];
  for (const detail of [0, 1, 2]) {
    const g = buildingGeometry(C.T_RES, 1, 1, detail);
    g.computeBoundingBox();
    assert.ok(g.boundingBox.max.x < 0.5 && g.boundingBox.min.x > -0.5);
    counts.push(g.attributes.position.count);
    g.dispose();
  }
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2]);
});

test('switching detail preserves building instances and disposes replaced geometry', () => {
  const layer = new BuildingLayer();
  const mesh = layer.group.children[0], count = layer.group.children.length;
  mesh.count = 2;
  mesh.userData.tileIds = [17, 23];
  const instances = mesh.instanceMatrix;
  let disposals = 0;
  for (const detail of [2, 0, 1]) {
    mesh.geometry.addEventListener('dispose', () => { disposals++; });
    layer.setDetail(detail);
    assert.equal(mesh.count, 2);
    assert.equal(mesh.instanceMatrix, instances);
    assert.deepEqual(mesh.userData.tileIds, [17, 23]);
    assert.equal(layer.group.children.length, count);
    const geometry = mesh.geometry;
    layer.setDetail(detail);
    assert.equal(mesh.geometry, geometry, 'same preset must not rebuild');
  }
  assert.equal(disposals, 3);
  for (const mesh of layer.group.children) { mesh.geometry.dispose(); mesh.dispose(); }
  for (const material of new Set(layer.group.children.map(mesh => mesh.material))) material.dispose();
});

test('milestone thresholds, multi-level grants and permanent earned levels', () => {
  assert.equal(levelForPopulation(119), 0);
  assert.equal(levelForPopulation(120), 1);
  assert.deepEqual(advanceCity(0, 900), { level: 3, reward: 12700 });
  assert.deepEqual(advanceCity(3, 0), { level: 3, reward: 0 });
  assert.deepEqual(advanceCity(3, 900), { level: 3, reward: 0 });
  assert.equal(advanceCity(0, 99999).reward, MILESTONES.reduce((n, m) => n + m.reward, 0));
});
test('civic capacity, radius, disconnected homes and providers, overlapping coverage', () => {
  const kind = new Uint8Array(C.N_TILES), level = new Uint8Array(C.N_TILES);
  kind[C.idx(20, 20)] = C.T_SCHOOL;
  for (let x = 10; x < 30; x++) { kind[C.idx(x, 22)] = C.T_RES; level[C.idx(x, 22)] = 3; }
  assert.equal(civicCoverage(kind, level, () => true).average.education, 75);
  kind[C.idx(21, 20)] = C.T_SCHOOL;
  assert.equal(civicCoverage(kind, level, () => true).average.education, 100);
  assert.equal(civicCoverage(kind, level, i => kind[i] !== C.T_SCHOOL).average.education, 0);
  assert.equal(civicCoverage(kind, level, i => kind[i] !== C.T_RES).average.education, 0);
  kind[C.idx(70, 70)] = C.T_RES; level[C.idx(70, 70)] = 3;
  assert.equal(civicCoverage(kind, level, () => true).coverage.education[C.idx(70, 70)], 0);
});
test('all new services round-trip with earned level, roads and economy', () => {
  const city = demoCity(); city.cityLevel = 6;
  for (let k = 11; k <= 18; k++) { city.kind[k] = k; city.level[k] = 1; }
  const restored = decode(encode(city));
  assert.ok(restored);
  assert.deepEqual(restored.kind, city.kind);
  assert.deepEqual(restored.level, city.level);
  assert.equal(restored.cityLevel, 6);
  assert.equal(restored.money, city.money);
  assert.equal(restored.net.segs.length, city.net.segs.length);
  assert.equal(restored.net.nodes.length, city.net.nodes.length);
  assert.equal(decode(encode(restored)).cityLevel, 6);
});
test('v3 save migration infers earned level without dropping buildings', () => {
  const bytes = new Array(14).fill(0); bytes[0] = 3; bytes[1] = 10;
  bytes.push(C.T_RES << 4 | 3, 30); // 1200 residents
  let remaining = C.N_TILES - 30;
  while (remaining) { const run = Math.min(255, remaining); bytes.push(0, run); remaining -= run; }
  bytes.push(0, 0, 0, 0);
  const restored = decode(Buffer.from(bytes).toString('base64url'));
  assert.ok(restored); assert.equal(restored.cityLevel, 3); assert.equal(restored.level[29], 3);
  assert.deepEqual(decode(encode(restored)).kind, restored.kind);
});
test('malformed save streams are rejected', () => {
  assert.equal(decode('garbage'), null);
  const bytes = Buffer.from(encode(demoCity()), 'base64url');
  assert.equal(decode(bytes.subarray(0, bytes.length - 2).toString('base64url')), null);
  bytes[31] = 0; // a zero run length in the first RLE triple, just past the 30-byte header
  assert.equal(decode(bytes.toString('base64url')), null);
});
test('each new service has finite nonempty visible geometry inside its footprint', () => {
  for (const k of [...Array.from({ length: 8 }, (_, n) => 11 + n), C.T_PLAYGROUND, C.T_SPORTS, C.T_GARDEN, C.T_HOSPITAL, C.T_CITY_HOSPITAL, C.T_POLICE_HQ, C.T_GAS, C.T_NUCLEAR, C.T_CEMETERY, C.T_CREMATORIUM, C.T_POST_OFFICE, C.T_LANDMARK]) {
    const geo = buildingGeometry(k, 1, 0);
    assert.ok(geo.attributes.position.count > 30, `kind ${k}`);
    assert.ok([...geo.attributes.position.array].every(Number.isFinite), `kind ${k}`);
    geo.computeBoundingBox(); assert.ok(geo.boundingBox.max.y > 0.15, `kind ${k}`);
    const [w, d] = C.SERVICES[k].footprint ?? [1, 1];
    assert.ok(geo.boundingBox.min.x >= -0.55 && geo.boundingBox.max.x <= w - 0.45, `kind ${k} fits its width`);
    assert.ok(geo.boundingBox.min.z >= -0.55 && geo.boundingBox.max.z <= d - 0.45, `kind ${k} fits its depth`);
    geo.dispose();
  }
});
// Run the real worker with a controlled clock and deterministic randomness.
const messages = [];
let lastState;
globalThis.self = { postMessage: m => { if (m.type === 'state') lastState = m; messages.push(m); } };
const originalInterval = globalThis.setInterval;
let simulateFrame;
globalThis.setInterval = callback => { simulateFrame = callback; return 0; };
await import('../src/sim/worker.ts');
globalThis.setInterval = originalInterval;
const originalRandom = Math.random;
Math.random = C.mulberry32(2026);
const send = data => self.onmessage({ data });
// Loops trim old messages to save memory, so remember the newest state separately.
const latest = () => messages.filter(m => m.type === 'state').at(-1) ?? lastState;
function load(city) {
  const net = Network.fromPlain(city.net);
  ensureApproaches(net); // the app extends every entrance past the map edge before simulating
  const raster = rasterize(net);
  send({ type: 'load', ...city, cityLevel: city.cityLevel ?? 0, serial: 1, cover: raster.cover, accSeg: raster.accSeg, accS: raster.accS });
}
test('real simulation grows a town, awards milestones, and stays finite', () => {
  const city = demoCity();
  for (let i = 0; i < C.N_TILES; i++) if (city.kind[i] >= C.T_PARK) { city.kind[i] = 0; city.level[i] = 0; }
  load(city);
  send({ type: 'warm', ticks: 300 });
  const state = latest();
  assert.ok(state.stats.pop >= 120, JSON.stringify(state.stats));
  assert.ok(state.stats.cityLevel >= 1);
  assert.ok(Number.isFinite(state.stats.money));
  assert.ok(state.stats.happiness >= 0 && state.stats.happiness <= 100);
  assert.ok(state.stats.cityLevel >= 3 || !state.level.some(l => l > 2), 'No high-rises before Thriving town');
  const layout = demoCity();
  assert.ok(!state.level.some((l, i) => layout.kind[i] === C.T_RES && l > 2), 'Residential high-rises require civic coverage');
  console.log(`  Demo after 300 ticks: ${state.stats.pop} residents, level ${state.stats.cityLevel + 1}, $${state.stats.money}`);
});
test('loading an earned city level never pays its grant again', () => {
  const city = demoCity(); city.cityLevel = 6;
  load(city);
  assert.equal(latest().stats.money, city.money);
  send({ type: 'warm', ticks: 1 });
  assert.equal(latest().stats.cityLevel, 6);
  assert.ok(latest().stats.money <= city.money);
});
test('demo civic services work in the real simulation and improve coverage', () => {
  load(demoCity());
  send({ type: 'warm', ticks: 300 });
  const state = latest();
  assert.ok(state.stats.civic.health > 0);
  assert.ok(state.stats.civic.education > 0);
  assert.ok(state.stats.civic.waste > 0);
  console.log(`  Service demo: ${state.stats.pop} residents, ${state.stats.happiness}% happiness, ${state.stats.civic.health}% health coverage`);
});

test('road previews and committed endpoints land on tile centers', () => {
  const onCell = (v) => Number.isInteger(v - 0.5);
  const net = new Network();
  const a = roadPoint(net, { x: 20.2, z: 20.4 });
  const b = roadPoint(net, { x: 30.1, z: 20.2 });
  assert.deepEqual(a, { x: 20.5, z: 20.5 });
  assert.deepEqual(b, { x: 30.5, z: 20.5 });
  net.insertPath([a, b], 0);
  assert.ok([...net.nodes.values()].every(n => onCell(n.x) && onCell(n.z)));
  assert.deepEqual(roadPoint(net, { x: 25.3, z: 20.4 }), { x: 25.5, z: 20.5 });
  assert.deepEqual(gridPoint({ x: 0.01, z: 79.99 }), { x: 0.5, z: 79.5 });
  for (let seed = 1; seed <= 30; seed++) {
    const { entry } = generateTerrain(seed);
    // The entry sits on the map edge, running down the middle of a tile column.
    assert.ok(onCell(entry.dx ? entry.z : entry.x), JSON.stringify(entry));
    assert.ok(Number.isInteger(entry.dx ? entry.x : entry.z), JSON.stringify(entry));
  }
  for (let a = -Math.PI; a < Math.PI; a += 0.1) {
    const rotation = buildingRotation(Math.sin(a), Math.cos(a));
    assert.ok(Math.abs(rotation / (Math.PI / 2) - Math.round(rotation / (Math.PI / 2))) < 1e-8);
  }
  const legacy = new Network(); legacy.addNode(10.5, 10.5);
  assert.deepEqual(roadPoint(legacy, { x: 10.4, z: 10.4 }), { x: 10.5, z: 10.5 }, 'Existing connections retain priority');
});

/** One number standing for a whole map, so a river valley that shifts by a tile shows up. */
function terrainDigest(t) {
  let h = 0x811c9dc5;
  const push = (v) => { h = Math.imul(h ^ (v | 0), 0x01000193) >>> 0; };
  for (const v of t.water) push(v);
  for (const v of t.flow) push(v);
  push(t.river.length);
  for (const p of t.river) { push(Math.round(p.x * 1e6)); push(Math.round(p.z * 1e6)); push(Math.round(p.w * 1e6)); }
  for (const v of [t.entry.x, t.entry.z, t.entry.dx, t.entry.dz]) push(Math.round(v * 2));
  return h.toString(16).padStart(8, '0');
}
/** Every connected patch of dry land, largest first. */
function landPatches(water) {
  const label = new Int32Array(C.N_TILES).fill(-1), sizes = [];
  for (let start = 0; start < C.N_TILES; start++) {
    if (water[start] || label[start] >= 0) continue;
    const id = sizes.length, queue = [start]; label[start] = id;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head], x = i % C.GRID, z = (i / C.GRID) | 0;
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= C.GRID || nz >= C.GRID) continue;
        const j = C.idx(nx, nz);
        if (water[j] || label[j] >= 0) continue;
        label[j] = id; queue.push(j);
      }
    }
    sizes.push(queue.length);
  }
  return { label, sizes };
}

test('river valleys never move: the same maps every seed has always made', () => {
  // Recorded when the river was given its source on the map. The demo city and saved cities depend on it.
  const golden = 'f272459c 3ea82131 ba8277cb f0fd2f71 477952c3 31602100 0395ad58 5928309e af3927f2 d8576852 5af6c196 b9d936e1 91b8c17d 1e1dace5 09059278 98f8760c 756d6448 127a3edb 1308917d bc08d156 f3e65eac 71166345 be710460 05fb1ecf 5952e065 4cf5a13c f220eaeb 3d33125e a0616741 4c1f6c69';
  const digests = [];
  for (let seed = 1; seed <= 30; seed++) {
    digests.push(terrainDigest(generateTerrain(seed)));
  }
  assert.equal(digests.join(' '), golden, 'River valley maps must stay byte for byte what they were');
});
const THREE = await import('three');
test('building picking follows tile instances after rebuilding in a new location', () => {
  const buildings = new BuildingLayer();
  const kind = new Uint8Array(C.N_TILES), level = new Uint8Array(C.N_TILES);
  const raster = rasterize(new Network());
  const ray = new THREE.Raycaster();
  function pickAt(x, z) {
    ray.set(new THREE.Vector3(x + 0.5 - C.GRID / 2, 10, z + 0.5 - C.GRID / 2), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(buildings.group, true).find(h => h.instanceId !== undefined && h.object.userData.tileIds);
    return hit?.object.userData.tileIds[hit.instanceId];
  }
  kind[C.idx(10, 10)] = C.T_PARK; level[C.idx(10, 10)] = 1;
  buildings.rebuild(kind, level, raster); buildings.group.updateMatrixWorld(true);
  assert.equal(pickAt(10, 10), C.idx(10, 10));
  kind.fill(0); level.fill(0); kind[C.idx(60, 60)] = C.T_PARK; level[C.idx(60, 60)] = 1;
  buildings.rebuild(kind, level, raster); buildings.group.updateMatrixWorld(true);
  assert.equal(pickAt(60, 60), C.idx(60, 60));
  assert.equal(pickAt(10, 10), undefined);
  buildings.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
});
const { RoadLayer } = await import('../src/render/roads.ts');
test('narrow sidewalks meet roadside building fronts without broad paving', () => {
  for (const roadKind of [0, 1]) for (const center of [20, 20.5]) {
    const net = new Network(); net.insertPath([{ x: 10, z: center }, { x: 30, z: center }], roadKind);
    const raster = rasterize(net);
    const terrain = generateTerrain(3); terrain.water.fill(0);
    const roads = new RoadLayer(); roads.rebuild(net, terrain);
    let first = 0; while (!raster.cover[C.idx(20, first)]) first++;
    const home = C.idx(20, first - 1);
    const geometry = buildingGeometry(C.T_RES, 1, 0);
    geometry.computeBoundingBox();
    const front = raster.lotZ[home] + geometry.boundingBox.max.z;
    const curb = center - HALF_WIDTH[roadKind] - 0.09;
    assert.ok(Math.abs(front - curb) < 1e-5, `Building frontage ${front} must meet narrow curb ${curb}`);
    assert.equal(raster.lotZ[home] - raster.lotZ[home - C.GRID], 1, 'Rows retain their spacing');
    const positions = roads.group.children[0].geometry.attributes.position;
    assert.ok([...positions.array].every(Number.isFinite));
    for (let i = 0; i < positions.count; i++) assert.ok(Math.abs(positions.getY(i) - 0.025) > 1e-6, 'No broad tile paving');
    geometry.dispose();
    roads.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
});
test('same-level variants have distinct silhouettes, stable geometry and bounded lots', () => {
  for (const kind of [C.T_RES, C.T_COM, C.T_IND]) for (const level of [1, 2, 3]) {
    const heights = new Set();
    for (let variant = 0; variant < 4; variant++) {
      const a = buildingGeometry(kind, level, variant), b = buildingGeometry(kind, level, variant);
      assert.deepEqual(a.attributes.position.array, b.attributes.position.array);
      const bounds = a.boundingBox;
      heights.add(bounds.max.y.toFixed(3));
      assert.ok(bounds.min.x >= -0.501 && bounds.max.x <= 0.501);
      assert.ok(bounds.min.z >= -0.501 && Math.abs(bounds.max.z - 0.5) < 1e-5);
      assert.ok([...a.attributes.position.array].every(Number.isFinite));
      a.dispose(); b.dispose();
    }
    assert.ok(heights.size >= 3, `Kind ${kind}, level ${level} needs different silhouettes`);
  }
});
test('shifted roadside lots do not overlap at intersections', () => {
  const net = new Network();
  net.insertPath([{ x: 10, z: 20 }, { x: 30, z: 20 }], 0);
  net.insertPath([{ x: 20, z: 10 }, { x: 20, z: 30 }], 1);
  const r = rasterize(net);
  const lots = Array.from({ length: C.N_TILES }, (_, i) => i).filter(i => !r.cover[i] && r.accSeg[i] >= 0);
  for (let a = 0; a < lots.length; a++) for (let b = a + 1; b < lots.length; b++) {
    const i = lots[a], j = lots[b];
    assert.ok(Math.abs(r.lotX[i] - r.lotX[j]) >= 0.999 || Math.abs(r.lotZ[i] - r.lotZ[j]) >= 0.999);
  }
});
test('v4 cities migrate with default funding and no debt or decline', () => {
  const bytes = new Array(15).fill(0); bytes[0] = 4; bytes[1] = 10; bytes[14] = 4;
  bytes.push(C.T_UNIVERSITY << 2 | 1, 1);
  let remaining = C.N_TILES - 1;
  while (remaining) { const run = Math.min(255, remaining); bytes.push(0, run); remaining -= run; }
  bytes.push(0, 0, 0, 0);
  const city = decode(Buffer.from(bytes).toString('base64url'));
  assert.ok(city); assert.equal(city.kind[0], C.T_UNIVERSITY);
  assert.deepEqual(city.funding, defaultFunding()); assert.equal(city.debt, 0);
  assert.equal(city.cityLevel, 4); assert.ok(city.neglect.every(n => n === 0));
});
test('v5 preserves debt, nondefault funding and decline across shared saves', () => {
  const city = demoCity(); city.debt = 600; city.funding = { ...defaultFunding(), health: 150, power: 50 };
  city.neglect = new Uint8Array(C.N_TILES); city.neglect[42] = 179; city.neglect[43] = 80;
  const restored = decode(encode(city));
  assert.equal(restored.debt, 600); assert.deepEqual(restored.funding, city.funding);
  assert.deepEqual(restored.neglect, city.neglect);
  const bytes = Buffer.from(encode(city), 'base64url'); bytes[19] = 200;
  assert.ok(decode(bytes.toString('base64url')) === null);
});
test('funding changes capacity, upkeep and paused stats without free overtime', () => {
  load(demoCity());
  const original = latest().stats;
  send({ type: 'speed', value: 0 });
  send({ type: 'funding', key: 'power', value: 150 });
  assert.ok(latest().stats.power[1] > original.power[1]);
  assert.ok(latest().stats.power[1] < original.power[1] * 1.5);
  assert.ok(latest().stats.serviceExpense > original.serviceExpense);
  send({ type: 'funding', key: 'power', value: 999 });
  assert.equal(latest().stats.funding.power, 150);
  send({ type: 'tax', value: 15 }); assert.equal(latest().stats.tick, original.tick);
});
test('loan cannot stack, pauses with the city and persists after partial repayment', () => {
  const city = demoCity(); load(city);
  send({ type: 'loan', action: 'take' });
  assert.equal(latest().stats.money, city.money + LOAN_AMOUNT);
  assert.equal(latest().stats.debt, LOAN_TOTAL);
  send({ type: 'loan', action: 'take' });
  assert.equal(latest().stats.money, city.money + LOAN_AMOUNT);
  send({ type: 'speed', value: 0 });
  for (let i = 0; i < 60; i++) simulateFrame();
  assert.equal(latest().stats.debt, LOAN_TOTAL);
  send({ type: 'warm', ticks: 10 });
  assert.equal(latest().stats.debt, LOAN_TOTAL - 60);
  const saved = { ...city, level: latest().level, neglect: latest().neglect, money: latest().stats.money, debt: latest().stats.debt, funding: latest().stats.funding, cityLevel: latest().stats.cityLevel };
  load(decode(encode(saved)));
  assert.equal(latest().stats.debt, LOAN_TOTAL - 60);
  const before = latest().stats.money;
  send({ type: 'loan', action: 'repay' });
  assert.equal(latest().stats.debt, 0); assert.equal(latest().stats.money, before - (LOAN_TOTAL - 60));
  assert.equal(latest().stats.loanExpense, 0);
});
test('private development can recover while the treasury is negative', () => {
  const city = demoCity(); city.money = -100;
  load(city); send({ type: 'warm', ticks: 120 });
  assert.ok(latest().stats.pop >= 120, 'Debt must not block existing residential zones');
});
test('civic buildings lose output when electricity fails', () => {
  const city = demoCity();
  for (let i = 0; i < C.N_TILES; i++) {
    if (city.kind[i] === C.T_RES) city.level[i] = 1;
    if (C.SERVICES[city.kind[i]]?.power) { city.kind[i] = 0; city.level[i] = 0; }
  }
  load(city);
  assert.equal(latest().stats.civic.health, 0);
  const clinic = city.kind.indexOf(C.T_CLINIC);
  send({ type: 'inspect', tile: clinic });
  const report = messages.filter(m => m.type === 'inspection').at(-1).report;
  assert.equal(report.status, 'Not operating');
  assert.ok(report.blockers.includes('Restore electricity'));
});
test('service removal eventually downgrades homes and cannot be reset by saving', () => {
  const city = demoCity(); city.cityLevel = 3;
  for (let i = 0; i < C.N_TILES; i++) {
    if (city.kind[i] === C.T_RES) city.level[i] = 2;
    if (C.SERVICES[city.kind[i]]?.civic) { city.kind[i] = 0; city.level[i] = 0; }
  }
  load(city); send({ type: 'warm', ticks: 100 });
  const state = latest();
  const home = state.neglect.findIndex((n, i) => n === 100 && city.kind[i] === C.T_RES);
  assert.ok(home >= 0, 'A home should be in its service grace period');
  send({ type: 'inspect', tile: home });
  let report = messages.filter(m => m.type === 'inspection').at(-1).report;
  assert.ok(report.status.includes('80s to downgrade'));
  assert.ok(report.blockers.some(b => b.includes('Healthcare')));
  const saved = decode(encode({ ...city, level: state.level, neglect: state.neglect, money: state.stats.money }));
  load(saved); send({ type: 'warm', ticks: NEGLECT_LIMIT - 100 });
  assert.equal(latest().level[home], 1);
  assert.equal(latest().neglect[home], 0);
  assert.ok(latest().stats.pop < state.stats.pop);
});
test('restoring civic service clears the downgrade countdown', () => {
  const city = demoCity(); city.cityLevel = 3;
  const home = city.kind.indexOf(C.T_RES);
  city.level[home] = 2; city.neglect = new Uint8Array(C.N_TILES); city.neglect[home] = 170;
  // With only one occupied home, every nearby provider has spare capacity.
  const nearby = [...city.kind.keys()].filter(i => city.kind[i] === C.T_RES && Math.hypot(i % 80 - home % 80, Math.floor(i / 80) - Math.floor(home / 80)) < 4);
  assert.ok(nearby.length >= 2);
  city.kind[nearby[0] === home ? nearby[1] : nearby[0]] = C.T_CLINIC;
  const school = nearby.find(i => i !== home && city.kind[i] !== C.T_CLINIC);
  assert.ok(school !== undefined); city.kind[school] = C.T_SCHOOL;
  for (let i = 0; i < C.N_TILES; i++) if (C.isService(city.kind[i])) city.level[i] = 1;
  load(city); send({ type: 'warm', ticks: 1 });
  assert.equal(latest().neglect[home], 0);
});
test('regular clock publishes population matching rendered building levels', () => {
  load(demoCity()); send({ type: 'speed', value: 1 });
  for (let i = 0; i < 3 * C.SIM_HZ; i++) simulateFrame();
  const state = latest(), city = demoCity();
  const actual = city.kind.reduce((total, k, i) => total + (k === C.T_RES ? C.RES_POP[state.level[i]] : 0), 0);
  assert.equal(state.stats.pop, actual);
});

const { transitNetwork, transitLineForTrip, intercityStations } = await import('../src/sim/transit.ts');
const W = await import('../src/sim/water.ts');
const { footprint, footprintSize, siteOwners } = await import('../src/sites.ts');
const { entrancePlan, entrySite } = await import('../src/roads/entries.ts');
const { railPath } = await import('../src/roads/rail.ts');
const { signalPhase, isGreen } = await import('../src/roads/network.ts');
const { vehicleGeometry } = await import('../src/render/cars.ts');

test('new zones and transport services survive save/load with reserved footprints', () => {
  const city = demoCity(true), restored = decode(encode(city));
  assert.deepEqual(restored.kind, city.kind);
  assert.equal(restored.cityLevel, 5);
  for (const k of [C.T_OFFICE, C.T_BUS, C.T_STATION, C.T_AIRPORT, C.T_TREATMENT]) assert.ok(city.kind.includes(k), `Demo should include ${k}`);
  const owners = siteOwners(city.kind);
  for (let i = 0; i < C.N_TILES; i++) if (C.SERVICES[city.kind[i]]?.footprint) {
    for (const t of footprint(i, city.kind[i])) {
      assert.equal(owners[t], i);
      assert.ok(t === i || city.kind[t] === 0, 'No hidden buildings under a transport site');
    }
  }
  assert.deepEqual(footprint(C.idx(77, 77), C.T_AIRPORT), []);
});
test('office and transport geometry is finite and fits its declared footprint', () => {
  for (const k of [C.T_OFFICE, C.T_BUS, C.T_STATION, C.T_AIRPORT, C.T_TREATMENT]) {
    const geo = buildingGeometry(k, 1, 0), box = geo.boundingBox;
    const [w, d] = C.SERVICES[k]?.footprint ?? [1, 1];
    assert.ok([...geo.attributes.position.array].every(Number.isFinite));
    assert.ok(box.min.x >= -0.501 && box.max.x <= w - 0.499);
    assert.ok(box.min.z >= -0.501 && box.max.z <= d - 0.499);
    geo.dispose();
  }
  const counts = new Set();
  for (let type = 1; type <= 4; type++) {
    const geo = vehicleGeometry(type); geo.computeBoundingBox(); counts.add(geo.attributes.position.count);
    assert.ok(geo.boundingBox.max.z - geo.boundingBox.min.z < 0.9); geo.dispose();
  }
  assert.ok(counts.size >= 3);
});
test('signals expose an amber interval while the simulation stops approaching cars', () => {
  for (let t = 0; t < 18; t += 0.1) assert.ok(!(isGreen(t, 0, 0) && isGreen(t, 0, 1)));
  assert.equal(signalPhase(8.5, 0, 0), 'amber'); assert.equal(isGreen(8.5, 0, 0), false);
  assert.equal(signalPhase(17.5, 0, 1), 'amber'); assert.equal(signalPhase(9, 0, 1), 'green');
});
test('automatic transit needs two operating stops with a return route and both trip catchments', () => {
  const kind = new Uint8Array(C.N_TILES), a = C.idx(10, 10), b = C.idx(35, 10);
  kind[a] = kind[b] = C.T_BUS;
  assert.equal(transitNetwork(kind, () => true, () => false).lines.length, 0);
  assert.equal(transitNetwork(kind, i => i !== b, () => true).lines.length, 0);
  const net = transitNetwork(kind, () => true, () => true);
  assert.equal(net.lines.length, 1);
  assert.equal(transitLineForTrip(net, C.idx(12, 12), C.idx(36, 12)), 0);
  assert.equal(transitLineForTrip(net, C.idx(12, 12), C.idx(70, 70)), -1);
  assert.equal(transitNetwork(kind, () => true, (from) => from === a).lines.length, 0);
});
test('metro stations form their own underground lines with metro capacity and catchment', () => {
  const kind = new Uint8Array(C.N_TILES), a = C.idx(10, 10), b = C.idx(30, 10), bus = C.idx(20, 30);
  kind[a] = kind[b] = C.T_SUBWAY; kind[bus] = C.T_BUS;
  const net = transitNetwork(kind, () => true, () => true);
  assert.equal(net.lines.length, 1);
  assert.deepEqual({ mode: net.lines[0].mode, capacity: net.lines[0].capacity }, { mode: 'subway', capacity: C.SERVICES[C.T_SUBWAY].capacity });
  assert.equal(transitLineForTrip(net, C.idx(12, 12), C.idx(31, 12)), 0);
  assert.equal(transitLineForTrip(net, C.idx(12, 12), C.idx(31, 40)), -1);
});
test('a new map has a motorway, a crossing highway with a cloverleaf, and entries past the edge', () => {
  const city = newCity(7), net = Network.fromPlain(city.net), terrain = generateTerrain(7);
  const entries = [...net.nodes.values()].filter(n => n.entry);
  assert.equal(entries.length, 6, 'The motorway comes in from both ends of the map, the crossing highway from the outside');
  for (const entry of entries) {
    const outside = Math.min(entry.x, entry.z, C.GRID - entry.x, C.GRID - entry.z);
    assert.ok(outside <= -APPROACH + 1, `Entry should sit at least ${APPROACH} cells beyond the edge, got ${outside}`);
    const approach = net.segsAt(entry.id);
    assert.equal(approach.length, 1, 'An entry is the far end of one carriageway');
    assert.ok(approach[0].oneway && N.isCarriageway(approach[0].kind), 'The approach is one carriageway of a highway');
  }
  const kinds = [...net.segs.values()];
  // The motorway and its cloverleaf stand entirely outside the map; only the crossing highway comes on, a little way.
  const hl = highwayLayout(terrain), ent = terrain.entry;
  const inwardOf = (x, z) => ent.dx ? (x - ent.x) * ent.dx : (z - ent.z) * ent.dz;
  for (const s of kinds) {
    if (s.kind === N.KIND_HIGHWAY2) continue;
    for (let k = 0; k <= s.n; k++) assert.ok(inwardOf(s.pts[k * 2], s.pts[k * 2 + 1]) < -0.5, `${s.kind === N.KIND_RAMP ? 'Ramps' : 'The motorway'} keep off the map`);
  }
  const gates = mapGates(net);
  assert.equal(gates.length, 2, 'Only the crossing highway has gates on the map edge');
  assert.ok(gates.every(g => Math.abs(inwardOf(g.x, g.z) - 0.5) < 0.01), 'Both gates sit where the highway crosses the edge');
  assert.ok(gates.every(g => Math.abs((ent.dx ? g.z : g.x) - hl.cross) <= 1.01), 'at the crossing highway');
  assert.equal(kinds.filter(s => s.kind === N.KIND_MOTORWAY && s.structure === 1).length, 2, 'The motorway bridges the crossing highway at the cloverleaf');
  // Cloverleaf: four four-piece arcs and four loops of five or six pieces.
  const rampPieces = kinds.filter(s => s.kind === N.KIND_RAMP).length;
  assert.ok(rampPieces >= 36 && rampPieces <= 44, `a cloverleaf (${rampPieces} ramp pieces)`);
  assert.ok(kinds.filter(s => s.kind === N.KIND_RAMP).every(s => !s.structure && s.oneway), 'Slip roads stay on the ground and run one way');
  assert.ok(kinds.every(s => s.fixed), 'The motorway and its interchanges cannot be bulldozed');
  const r = rasterize(net);
  assert.ok(!Array.from(r.cover).some((v, i) => v && terrain.water[i]), 'None of it stands in the river');
  // The crossing highway ends on the city side with its carriageways still apart: two dead ends, nothing beyond.
  const h = highwayLayout(terrain);
  for (const at of [h.x1, h.x2]) {
    const tip = net.nearestNode(h.pos(at, HIGHWAY_END).x, h.pos(at, HIGHWAY_END).z, 0.3);
    assert.ok(tip && net.degree(tip.id) === 1 && net.segsAt(tip.id)[0].kind === N.KIND_HIGHWAY2 && net.segsAt(tip.id)[0].oneway, 'Each two-lane carriageway ends on its own where the city begins');
  }
  assert.equal(net.nearestNode(h.pos(h.cross, HIGHWAY_END).x, h.pos(h.cross, HIGHWAY_END).z, 0.3), null, 'The carriageways do not merge');
  // Nothing of the map's own stands where the city's first streets go.
  const e = terrain.entry;
  assert.equal(net.nearestSeg(e.x + e.dx * DOOR, e.z + e.dz * DOOR, 2), null, 'The ground in from the motorway is clear for the city');
  // On every map the two interchanges keep their slip roads apart: eight ramps, each between a carriageway and a street node.
  for (const seed of [1, 2, 3, 4, 5, 6, 8, 12, 99, 424242]) {
    const other = Network.fromPlain(newCity(seed).net);
    const ramps = [...other.segs.values()].filter(q => q.kind === N.KIND_RAMP);
    assert.ok(ramps.length >= 36 && ramps.length <= 44, `Seed ${seed}: a cloverleaf (got ${ramps.length} ramp pieces)`);
    for (const q of ramps) assert.ok(other.degree(q.a) <= 3 && other.degree(q.b) <= 3, `Seed ${seed}: a slip road meets nothing but its carriageway, its road and its own next piece`);
    // No ramp crosses another: pieces that share no node keep clear of each other.
    for (const a of ramps) for (const b of ramps) {
      if (a.id >= b.id || [a.a, a.b].some(n => n === b.a || n === b.b)) continue;
      for (let k = 0; k <= a.n; k++) assert.ok(Network.nearestOn(b, a.pts[k * 2], a.pts[k * 2 + 1]).dist > 0.9, `Seed ${seed}: two slip roads run into each other`);
    }
  }
  const before = net.toPlain();
  ensureApproaches(net);
  assert.deepEqual(net.toPlain().nodes.length, before.nodes.length, 'Already extended entrances are left alone');
  assert.deepEqual(net.toPlain().segs.length, before.segs.length);
  const restored = Network.fromPlain(decode(encode(city)).net);
  assert.equal([...restored.nodes.values()].filter(n => n.entry).length, 6, 'Off-map entries survive a save');
  assert.equal([...restored.segs.values()].filter(s => s.kind === N.KIND_MOTORWAY).length, kinds.filter(s => s.kind === N.KIND_MOTORWAY).length, 'So do the carriageways');
});
test('external traffic drives in from off the map without stalling the entrance', () => {
  const city = demoCity(true);
  load(city);
  send({ type: 'warm', ticks: 120 });
  send({ type: 'speed', value: 1 });
  const half = C.GRID / 2;
  let offMap = 0, inCity = 0;
  for (let f = 0; f < 20 * C.SIM_HZ; f++) {
    simulateFrame();
    if (f % 30) continue;
    const frame = messages.at(-1);
    for (let s = 0; s < C.MAX_CARS; s++) {
      const x = frame.cars[s * 4], z = frame.cars[s * 4 + 1];
      if (!x && !z) continue;
      if (Math.max(Math.abs(x), Math.abs(z)) > half) offMap++; else inCity++;
    }
  }
  const stats = latest().stats;
  assert.ok(offMap > 0, 'Traffic from outside should be rolling in on the off-map approach');
  assert.ok(inCity > offMap, 'Most traffic still belongs to the city itself');
  assert.ok(stats.gaveUp < 5, `Cars should not be stranded at the entrance: ${stats.gaveUp} gave up`);
  console.log(`  External approach: ${offMap} off-map car samples, ${inCity} inside the map, ${stats.gaveUp} gave up`);
});
test('a roundabout takes its size from the widest road that meets it', () => {
  // Every ring must clear the carriageway that circulates on it, or the lanes fight on the circle.
  for (const kind of [KIND_LANE, KIND_ROAD, KIND_AVENUE, KIND_HIGHWAY]) {
    assert.ok(ROUNDABOUT_RADIUS[kind] >= HALF_WIDTH[kind] * 2 + 0.6, `${ROAD_LABEL[kind]} ring is too tight`);
  }
  assert.ok(ROUNDABOUT_RADIUS[KIND_LANE] < ROUNDABOUT_RADIUS[KIND_ROAD]);
  assert.ok(ROUNDABOUT_RADIUS[KIND_ROAD] < ROUNDABOUT_RADIUS[KIND_AVENUE]);
  assert.ok(ROUNDABOUT_RADIUS[KIND_AVENUE] < ROUNDABOUT_RADIUS[KIND_HIGHWAY]);
  assert.equal(N.RING_KIND_LIMIT, KIND_AVENUE, 'An expressway meets an avenue-sized ring, not a six-lane circle');
  assert.ok(ROUNDABOUT_RADIUS[KIND_AVENUE] <= 2.6, 'Avenue rings stay compact');

  for (const kind of [KIND_LANE, KIND_ROAD, KIND_AVENUE, KIND_HIGHWAY]) {
    const net = new Network();
    net.insertPath([{ x: 20.5, z: 40.5 }, { x: 60.5, z: 40.5 }], kind);
    net.insertPath([{ x: 40.5, z: 20.5 }, { x: 40.5, z: 60.5 }], kind);
    assert.ok(net.addRoundabout(40.5, 40.5, ROUNDABOUT_RADIUS[kind], kind), `${ROAD_LABEL[kind]} roundabout should fit`);
    const ring = net.roundabouts()[0];
    assert.ok(ring, `${ROAD_LABEL[kind]} ring should be recoverable`);
    assert.ok(Math.abs(ring.r - ROUNDABOUT_RADIUS[kind]) < 0.35, `${ROAD_LABEL[kind]} ring came out at ${ring.r.toFixed(2)}`);
    // Every arm still reaches the circle, so traffic can get on and off it.
    const arms = [...net.nodes.values()].filter(n => n.ring);
    assert.ok(arms.length >= 4, `${ROAD_LABEL[kind]} ring should keep its four arms`);
    const island = rasterize(net);
    assert.ok(Array.from(island.cover).some(Boolean));
  }
});
test('stop signs make every approach halt, and calming slows a street', () => {
  const net = new Network();
  net.insertPath([{ x: 10.5, z: 30.5 }, { x: 60.5, z: 30.5 }], KIND_ROAD);
  net.insertPath([{ x: 35.5, z: 10.5 }, { x: 35.5, z: 50.5 }], KIND_ROAD);
  const junction = net.nearestNode(35.5, 30.5, 0.2);
  assert.ok(junction && net.degree(junction.id) === 4);
  junction.stop = true;
  const calmed = [...net.segs.values()][0];
  calmed.calm = true;
  const restored = Network.fromPlain(JSON.parse(JSON.stringify(net.toPlain())));
  assert.equal(restored.nodes.get(junction.id).stop, true, 'Stop signs survive a round trip');
  assert.equal([...restored.segs.values()].filter(s => s.calm).length, 1, 'So does calming');

  // Traffic crosses a stopped junction, just more slowly than a free one.
  const city = demoCity(); city.kind.fill(0); city.level.fill(0); city.cityLevel = 1;
  [...net.nodes.values()].find(n => n.x === 10.5).entry = true;
  const r = rasterize(net);
  for (let i = 0; i < C.N_TILES; i++) {
    if (r.cover[i] || r.accSeg[i] < 0) continue;
    const x = i % C.GRID;
    city.kind[i] = x < 35 ? C.T_RES : C.T_COM; city.level[i] = 2;
  }
  const run = (stop) => {
    Math.random = C.mulberry32(4);
    junction.stop = stop;
    city.net = net.toPlain();
    const raster = rasterize(Network.fromPlain(city.net));
    send({ type: 'load', ...city, serial: 1, cover: raster.cover, accSeg: raster.accSeg, accS: raster.accS });
    send({ type: 'speed', value: 1 });
    for (let f = 0; f < 60 * C.SIM_HZ; f++) { simulateFrame(); if (messages.length > 40) messages.splice(0, messages.length - 10); }
    return latest().stats;
  };
  const free = run(false), stopped = run(true);
  assert.ok(stopped.cars > 0, 'Traffic still flows through an all-way stop');
  assert.ok(stopped.gaveUp <= free.gaveUp + 2, 'And nobody is trapped by it');
  console.log(`  All-way stop: ${stopped.commute.toFixed(1)}s average commute against ${free.commute.toFixed(1)}s uncontrolled`);
});
test('buildings can be turned before placing, and their facing is saved', () => {
  const tile = C.idx(20, 20);
  assert.deepEqual(footprintSize(C.T_STATION, 0), [3, 2]);
  assert.deepEqual(footprintSize(C.T_STATION, 1), [2, 3], 'A quarter turn swaps the site');
  assert.deepEqual(footprintSize(C.T_STATION, 2), [3, 2]);
  const upright = footprint(tile, C.T_STATION, 0), turned = footprint(tile, C.T_STATION, 1);
  assert.equal(upright.length, 6); assert.equal(turned.length, 6);
  assert.ok(turned.includes(tile + 2 * C.GRID), 'A turned station reaches further south');
  assert.ok(!upright.includes(tile + 2 * C.GRID));

  const rot = new Uint8Array(C.N_TILES); rot[tile] = 1;
  const kind = new Uint8Array(C.N_TILES); kind[tile] = C.T_STATION;
  const owners = siteOwners(kind, rot);
  assert.ok(turned.every(t => owners[t] === tile), 'The turned site is reserved');
  assert.equal(owners[tile + 2], -1, 'And the cells it no longer uses are free');

  const city = demoCity(true);
  const station = city.kind.findIndex(k => k === C.T_STATION);
  assert.ok(station >= 0);
  city.rot = new Uint8Array(C.N_TILES); city.rot[station] = 3;
  const restored = decode(encode(city));
  assert.equal(restored.rot[station], 3, 'Facing survives a save');
  assert.equal(restored.rot.reduce((n, v) => n + (v ? 1 : 0), 0), 1, 'Only turned buildings are stored');
});
test('nothing but waterside works stands where the river is drawn', () => {
  const city = demoCity(true), terrain = generateTerrain(city.seed);
  // How far a tile centre is inside the water as it is drawn: the mask radius plus the ribbon margin.
  const wetness = (i) => {
    const x = i % C.GRID + 0.5, z = Math.floor(i / C.GRID) + 0.5;
    let deepest = -Infinity;
    for (const p of terrain.river) deepest = Math.max(deepest, p.w + WATER_EDGE - Math.hypot(x - p.x, z - p.z));
    return deepest;
  };
  let wet = 0;
  for (let i = 0; i < C.N_TILES; i++) {
    const k = city.kind[i];
    if (!k || C.SERVICES[k]?.needsWater) continue; // a pump or an outlet belongs on the bank
    if (wetness(i) > -0.5) wet++;
  }
  assert.equal(wet, 0, `${wet} demo buildings stand in the drawn river`);
  assert.ok(terrain.shore.some(v => v), 'The seed has a shore strip to protect');
  assert.ok(!terrain.shore.some((v, i) => v && terrain.water[i]), 'Shore marks dry tiles only');

  // The rule holds for the player too: no zoning on the shore, but the bank still takes a pump.
  const shore = terrain.shore.findIndex((v, i) => v && !rasterize(Network.fromPlain(city.net)).cover[i]);
  assert.ok(shore >= 0);
  const game = { terrain, raster: rasterize(Network.fromPlain(city.net)), owners: new Int32Array(C.N_TILES).fill(-1) };
  const buildable = (i, bank) => !game.terrain.water[i] && !game.raster.cover[i] && game.owners[i] < 0 && (bank || !game.terrain.shore[i]);
  assert.equal(buildable(shore, false), false);
  assert.equal(buildable(shore, true), true);
});
test('railways connect themselves, and a station by an entrance runs out of town', () => {
  const city = demoCity(true);
  const stations = Array.from(city.kind, (k, i) => k === C.T_STATION ? i : -1).filter(i => i >= 0);
  assert.ok(stations.length > 1, 'The demo has several stations');
  load(city);
  send({ type: 'warm', ticks: 150 });
  const transport = latest().stats.transport;
  assert.equal(transport.railLines, stations.length - 1, `Stations pair up on their own, each with its nearest neighbour (${stations.length} stations, ${transport.railLines} lines, ${JSON.stringify(stations.map(i => [i % C.GRID, Math.floor(i / C.GRID)]))})`);
  assert.equal(transport.intercityLines, 1, 'The station nearest the city entrance also runs out of town');

  // Those trains carry people who would otherwise arrive and leave by road.
  send({ type: 'speed', value: 1 });
  for (let f = 0; f < 40 * C.SIM_HZ; f++) {
    simulateFrame();
    if (messages.length > 60) messages.splice(0, messages.length - 20);
    if (latest().stats.transport.railPassengers > 0) break;
  }
  const stats = latest().stats;
  assert.ok(stats.transport.railPassengers > 0, `Intercity trains should carry travellers: ${JSON.stringify(stats.transport)}`);
  assert.ok(stats.transport.fareIncome > 0, 'Their fares reach the treasury');
  console.log(`  Intercity line: ${stats.transport.railPassengers} passengers/min, fares $${stats.transport.fareIncome.toFixed(2)}/s`);

  // A gate too far from any station leaves the intercity service unstaffed.
  const far = intercityStations([{ x: 79, z: 79 }], stations);
  assert.deepEqual(far, [], 'Stations beyond the range of an entrance stay local');
  assert.deepEqual(intercityStations([{ x: stations[0] % C.GRID, z: Math.floor(stations[0] / C.GRID) }], stations), [stations[0]]);

  // Demolishing stations takes their services with them: one left on its own makes no line.
  const razed = { ...city, kind: Uint8Array.from(city.kind) };
  for (const s of stations.slice(1)) for (const t of footprint(s, C.T_STATION)) razed.kind[t] = 0;
  load(razed);
  send({ type: 'warm', ticks: 30 });
  assert.equal(latest().stats.transport.railLines, 0, 'One station cannot make a line by itself');
});
test('a fire in a back lot behind the street row is reached and put out', () => {
  const city = demoCity(true);
  const net = Network.fromPlain(city.net);
  ensureApproaches(net);
  const r = rasterize(net);
  // Let the demo build itself up first: the shipped city is zoned but empty.
  load(city);
  send({ type: 'warm', ticks: 200 });
  city.level = Uint8Array.from(latest().level);
  // A back lot: a home whose access road point is further than the row that fronts the street.
  let tile = -1, best = 0;
  for (let i = 0; i < C.N_TILES; i++) {
    if (city.kind[i] !== C.T_RES || !city.level[i] || r.accSeg[i] < 0) continue;
    const d = Math.hypot(r.accX[i] - r.lotX[i], r.accZ[i] - r.lotZ[i]);
    if (d > best) { best = d; tile = i; }
  }
  assert.ok(tile >= 0 && best > 1.5, `Demo should have a set-back home, deepest was ${best.toFixed(2)}`);
  city.incidents = { fires: [{ tile, age: 0 }], crime: [], patrol: [] };
  load(city);
  send({ type: 'speed', value: 1 });
  let engines = 0;
  for (let f = 0; f < 90 * C.SIM_HZ; f++) {
    simulateFrame();
    engines = Math.max(engines, latest().stats.incidents.fireEngines);
    if (latest().stats.incidents.extinguished > 0) break;
  }
  const stats = latest().stats;
  assert.ok(engines > 0, 'A fire engine should be dispatched to the back lot');
  assert.equal(stats.incidents.damaged, 0, 'The building should not burn down waiting for access');
  assert.ok(stats.incidents.extinguished > 0, 'The fire should be put out');
  console.log(`  Back lot ${best.toFixed(1)} cells off the street: ${stats.incidents.extinguished} fire out, ${engines} engines sent`);
});
test('four kinds of road: widths, costs, upgrade order, frontage and saves', () => {
  assert.deepEqual(UPGRADE_ORDER.map(k => ROAD_LABEL[k]), ['Lane', 'Street', 'Avenue', 'Expressway']);
  assert.equal(nextRoadKind(KIND_HIGHWAY), KIND_LANE, 'The cycle wraps back to the cheapest');
  assert.ok(HALF_WIDTH[KIND_LANE] < HALF_WIDTH[KIND_ROAD]);
  assert.ok(HALF_WIDTH[KIND_HIGHWAY] > HALF_WIDTH[KIND_AVENUE]);
  assert.ok(SPEED[KIND_LANE] < SPEED[KIND_ROAD] && SPEED[KIND_HIGHWAY] > SPEED[KIND_AVENUE]);
  assert.ok(C.ROAD_COST[KIND_LANE] < C.ROAD_COST[KIND_ROAD] && C.ROAD_COST[KIND_HIGHWAY] > C.ROAD_COST[KIND_AVENUE]);

  const net = new Network();
  net.insertPath([{ x: 10.5, z: 10.5 }, { x: 40.5, z: 10.5 }], KIND_LANE);
  net.insertPath([{ x: 10.5, z: 30.5 }, { x: 40.5, z: 30.5 }], KIND_HIGHWAY);
  const r = rasterize(net);
  const beside = (z) => Array.from(r.accSeg).filter((id, i) => id >= 0 && Math.floor(i / C.GRID) === z).length;
  assert.ok(beside(12) > 20, 'A lane gives its neighbours frontage');
  assert.equal(beside(32), 0, 'An expressway gives no frontage');
  assert.ok(Array.from(r.cover).some((v, i) => v && Math.floor(i / C.GRID) === 30), 'An expressway still paves its tiles');

  const restored = Network.fromPlain(JSON.parse(JSON.stringify(net.toPlain())));
  assert.deepEqual([...restored.segs.values()].map(s => s.kind).sort(), [KIND_LANE, KIND_HIGHWAY].sort());
  const city = demoCity(); city.net = net.toPlain();
  const saved = Network.fromPlain(decode(encode(city)).net);
  assert.deepEqual([...saved.segs.values()].map(s => s.kind).sort(), [KIND_LANE, KIND_HIGHWAY].sort(), 'Road kinds survive a save');
});
test('one-way highways and ramps: drawn direction, no frontage, saves, and traffic that uses them', () => {
  const { KIND_MOTORWAY, KIND_RAMP, isOneWayKind } = N;
  assert.ok(isOneWayKind(KIND_MOTORWAY) && isOneWayKind(KIND_RAMP) && !isOneWayKind(KIND_HIGHWAY));
  assert.ok(HALF_WIDTH[KIND_RAMP] < HALF_WIDTH[KIND_MOTORWAY] && HALF_WIDTH[KIND_MOTORWAY] < HALF_WIDTH[KIND_HIGHWAY]);
  assert.equal(nextRoadKind(KIND_RAMP), N.KIND_HIGHWAY2, 'A ramp widens to the two-lane highway');
  assert.equal(nextRoadKind(N.KIND_HIGHWAY2), KIND_MOTORWAY, 'and that to the motorway');
  assert.ok(HALF_WIDTH[N.KIND_HIGHWAY2] > HALF_WIDTH[KIND_RAMP] && HALF_WIDTH[N.KIND_HIGHWAY2] < HALF_WIDTH[KIND_MOTORWAY] && N.isOneWayKind(N.KIND_HIGHWAY2));
  const net = new Network();
  // A motorway carriageway running east from the map edge, an exit and an on-ramp.
  net.insertPath([{ x: 2.5, z: 40.5 }, { x: 74.5, z: 40.5 }], KIND_MOTORWAY, true);
  [...net.nodes.values()].find(n => n.x === 2.5).entry = true;
  // The other carriageway runs back west to the entrance on the far side, clear of the ramps.
  net.insertPath([{ x: 74.5, z: 40.5 }, { x: 74.5, z: 36.5 }], KIND_MOTORWAY, true);
  net.insertPath([{ x: 74.5, z: 36.5 }, { x: 8.5, z: 36.5 }], KIND_MOTORWAY, true);
  net.insertPath([{ x: 8.5, z: 36.5 }, { x: 2.5, z: 40.5 }], KIND_MOTORWAY, true);
  net.insertPath([{ x: 20.5, z: 40.5 }, { x: 28.5, z: 48.5 }], KIND_RAMP, true); // exit to the homes
  net.insertPath([{ x: 28.5, z: 48.5 }, { x: 28.5, z: 72.5 }], KIND_ROAD);
  net.insertPath([{ x: 28.5, z: 56.5 }, { x: 40.5, z: 40.5 }], KIND_RAMP, true); // back on again
  net.insertPath([{ x: 52.5, z: 40.5 }, { x: 60.5, z: 48.5 }], KIND_RAMP, true); // exit to the jobs
  net.insertPath([{ x: 60.5, z: 48.5 }, { x: 60.5, z: 72.5 }], KIND_ROAD);
  const r = rasterize(net);
  for (let x = 3; x < 74; x++) assert.equal(r.accSeg[39 * C.GRID + x] >= 0 && net.segs.get(r.accSeg[39 * C.GRID + x]).kind === KIND_MOTORWAY, false, 'Nothing fronts onto a highway');
  const city = demoCity(); city.kind.fill(0); city.level.fill(0); city.cityLevel = 2; city.net = net.toPlain();
  const kinds = s => [...s.segs.values()].map(q => q.kind).sort().join();
  assert.equal(kinds(Network.fromPlain(decode(encode(city)).net)), kinds(net), 'Highway and ramp kinds survive a save');
  for (let i = 0; i < C.N_TILES; i++) {
    if (r.cover[i] || r.accSeg[i] < 0) continue;
    const x = i % C.GRID, z = Math.floor(i / C.GRID);
    if (z < 50) continue;
    if (Math.abs(x - 28) <= 2) { city.kind[i] = C.T_RES; city.level[i] = 2; }
    if (Math.abs(x - 60) <= 2) { city.kind[i] = C.T_COM; city.level[i] = 2; }
  }
  load(city); send({ type: 'speed', value: 1 });
  const motorway = [...net.segs.values()].filter(q => q.kind === KIND_MOTORWAY), ramps = [...net.segs.values()].filter(q => q.kind === KIND_RAMP);
  let onRamp = 0, east = 0, west = 0;
  const rampUsers = new Set();
  const rampUsersById = new Set(), mouthById = new Map();
  for (let f = 0; f < 120 * C.SIM_HZ; f++) {
    simulateFrame();
    const frame = messages.findLast(m => m.type === 'frame');
    messages.length = 0;
    if (!frame || f % 5) continue;
    for (let n = 0; n < C.MAX_CARS; n++) {
      if (!frame.cars[n * 4 + 3]) continue;
      const x = frame.cars[n * 4] + 40, z = frame.cars[n * 4 + 1] + 40, a = frame.cars[n * 4 + 2];
      if (ramps.some(q => Network.nearestOn(q, x, z).dist < HALF_WIDTH[KIND_RAMP] && Math.abs(z - 40.5) > 1.5)) { onRamp++; rampUsers.add(frame.carIds[n]); }
      // At the mouth of an exit a car that goes on to use the ramp is still in the carriageway's outer
      // lane, easing over; cars merely passing by on the carriageway are told apart afterwards.
      for (const q of ramps) { const h = Network.nearestOn(q, x, z); const id = frame.carIds[n];
        if (h.s > 2 && h.s < q.len - 2 && h.dist < 0.3) rampUsersById.add(id);
        if (h.s < 0.5 && h.dist < 0.7 && q.a === net.segsAt(q.a).find(o => o.kind === N.KIND_MOTORWAY)?.b) (mouthById.get(id) ?? mouthById.set(id, []).get(id)).push(h.dist); }
      if (Math.abs(z - 40.5) < 0.7 && x > 8 && x < 70 && motorway.some(q => Network.nearestOn(q, x, z).dist < HALF_WIDTH[KIND_MOTORWAY])) {
        if (Math.sin(a) > 0.9) east++; else if (Math.sin(a) < -0.9) west++;
      }
    }
  }
  send({ type: 'speed', value: 0 });
  console.log(`  Highway: ${east} samples heading east, ${west} west, ${rampUsers.size} cars used the ramps`);
  assert.ok(east > 20, 'Traffic runs along the one-way highway');
  assert.equal(west, 0, 'Nobody drives the wrong way up a one-way highway');
  assert.ok(onRamp > 5, 'Cars use the ramps to get on and off');
  let mouthSamples = 0, mouthOuter = 0;
  for (const [id, dists] of mouthById) if (rampUsersById.has(id)) for (const d of dists) { mouthSamples++; if (d > 0.2) mouthOuter++; }
  if (mouthSamples > 5) assert.ok(mouthOuter / mouthSamples > 0.8, `Cars leave from the outer lane, not the centre of the carriageway (${mouthOuter}/${mouthSamples})`);
  assert.ok(latest().stats.gaveUp <= 2 && rampUsers.size > 40, `Merges keep moving: ${rampUsers.size} cars used the ramps, ${latest().stats.gaveUp} gave up`);
});
test('through traffic rolls along the motorway even when the city is empty', () => {
  const city = newCity(11); city.cityLevel = 0;
  load(city); send({ type: 'speed', value: 1 });
  let onMotorway = 0, elsewhere = 0;
  const net = Network.fromPlain(city.net), lanes = [...net.segs.values()].filter(q => N.isMotorway(q.kind));
  const streets = [...net.segs.values()].filter(q => !N.isMotorway(q.kind));
  for (let f = 0; f < 40 * C.SIM_HZ; f++) {
    simulateFrame();
    const frame = messages.findLast(m => m.type === 'frame'); messages.length = 0;
    if (!frame || f % 10) continue;
    for (let n = 0; n < C.MAX_CARS; n++) {
      if (!frame.cars[n * 4 + 3]) continue;
      const x = frame.cars[n * 4] + 40, z = frame.cars[n * 4 + 1] + 40;
      if (streets.some(q => Network.nearestOn(q, x, z).dist < HALF_WIDTH[q.kind] + 0.05)) elsewhere++;
      else if (lanes.some(q => Network.nearestOn(q, x, z).dist < HALF_WIDTH[q.kind] + 0.05)) onMotorway++;
    }
  }
  send({ type: 'speed', value: 0 });
  const stats = latest().stats;
  assert.ok(onMotorway > 30, `Cars pass through on the highways (${onMotorway} samples)`);
  assert.equal(elsewhere, 0, 'None of them turns off onto a street of an empty city');
  assert.equal(stats.commute, 0, 'Passing traffic never counts as a commute');
  console.log(`  Through traffic: ${onMotorway} samples on the motorway, ${stats.gaveUp} gave up`);
});
test('policies cost money, change the simulation and survive a save', () => {
  assert.equal(policyExpense(noPolicies(), 5000), 0);
  const recycling = { ...noPolicies(), recycling: true };
  assert.ok(Math.abs(policyExpense(recycling, 1000) - (POLICIES.recycling.base + POLICIES.recycling.perResident * 1000)) < 1e-9);
  assert.equal(policyEffects(noPolicies()).industryPollution, 1);
  assert.ok(policyEffects(recycling).industryPollution < 1);
  assert.deepEqual(policiesFromMask(policyMask(recycling)), recycling);

  const city = demoCity(true);
  load(city);
  send({ type: 'warm', ticks: 60 });
  const before = latest().stats;
  send({ type: 'policy', id: 'recycling', on: true });
  const after = latest().stats;
  assert.equal(after.policies.recycling, true);
  assert.ok(after.policyExpense > 0, 'A live policy costs money every second');
  assert.ok(after.income < before.income, 'Policy upkeep comes out of the budget');

  const locked = demoCity();
  locked.cityLevel = 0;
  load(locked);
  send({ type: 'policy', id: 'congestionCharge', on: true });
  assert.equal(latest().stats.policies.congestionCharge, false, 'Policies respect their unlock level');
  assert.match(messages.filter(m => m.type === 'notice').at(-1).message, /unlocks at city level/);

  city.policies = { ...noPolicies(), recycling: true, alarms: true };
  const restored = decode(encode(city));
  assert.deepEqual(restored.policies, city.policies);
});
test('recycling keeps industrial pollution down', () => {
  const dirty = demoCity(true);
  load(dirty);
  send({ type: 'warm', ticks: 150 });
  // Across the whole city: the demo keeps homes well away from its industry.
  const total = () => latest().pollution.reduce((sum, v) => sum + v, 0);
  const unregulated = total();
  load(dirty);
  send({ type: 'policy', id: 'recycling', on: true });
  send({ type: 'warm', ticks: 150 });
  const regulated = total();
  assert.ok(regulated < unregulated, `Recycling should cut pollution: ${regulated} vs ${unregulated}`);
  console.log(`  Ground pollution across the city: ${unregulated} unregulated, ${regulated} with recycling`);
});
test('additional entries persist and reach disconnected neighborhoods', () => {
  const city = demoCity(), net = Network.fromPlain(city.net), terrain = generateTerrain(city.seed);
  // The demo is built right up to the map edge: clear a patch of farmland on the south edge first.
  for (let z = 68; z < C.GRID; z++) for (let x = 5; x < 16; x++) { city.kind[z * C.GRID + x] = 0; city.level[z * C.GRID + x] = 0; }
  let planned;
  for (const [x, z] of [[10, 79], [79, 10], [79, 65], [65, 1]]) {
    const result = entrancePlan(net, terrain, city.kind, x, z);
    if (typeof result !== 'string') { planned = result; break; }
  }
  assert.ok(planned);
  const had = [...net.nodes.values()].filter(n => n.entry).length;
  assert.equal(had, 6, 'Original network is unchanged');
  assert.equal([...planned.nodes.values()].filter(n => n.entry).length, had + 1);
  assert.equal(typeof entrancePlan(net, terrain, city.kind, 40, 40), 'string');
  // The entrance itself is expressway, which carries no frontage, so a street picks the traffic up.
  const newNode = [...planned.nodes.values()].filter(n => n.entry).at(-1);
  const approach = planned.segsAt(newNode.id)[0];
  const gate = approach.a === newNode.id ? approach.b : approach.a;
  const stub = planned.segsAt(gate).find(s => s.id !== approach.id);
  assert.equal(stub.kind, KIND_HIGHWAY, 'City entrances arrive on an expressway');
  const inner = planned.nodes.get(stub.a === gate ? stub.b : stub.a);
  const e = entrySite(inner.x, inner.z);
  const street = planned.insertPath([{ x: inner.x, z: inner.z }, { x: inner.x + e.dz * 9, z: inner.z + e.dx * 9 }], KIND_ROAD);
  assert.ok(street.length, 'A street can join the entrance');
  const r = rasterize(planned);
  const served = new Set(street);
  const tile = Array.from(r.accSeg).findIndex((id, i) => served.has(id) && !r.cover[i] && !terrain.water[i] && !terrain.shore[i]);
  assert.ok(tile >= 0); city.kind[tile] = C.T_RES; city.level[tile] = 1; city.net = planned.toPlain();
  const restored = decode(encode(city)); load(restored);
  assert.equal(latest().stats.entries, 2, 'The crossing highway counts one gate on the edge (the motorway never comes onto the map), plus the new entrance');
  assert.equal(latest().flags[tile] & C.F_NO_ROAD, 0);
});
test('offices provide clean jobs, obey unlocks and explain education requirements', () => {
  const city = demoCity();
  const office = city.kind.findIndex(k => k === C.T_COM);
  city.kind[office] = C.T_OFFICE; city.level[office] = 2; city.cityLevel = C.OFFICE_UNLOCK;
  load(city); send({ type: 'inspect', tile: office });
  const report = messages.filter(m => m.type === 'inspection').at(-1).report;
  assert.equal(report.occupants, C.OFFICE_JOBS[2]);
  assert.ok(report.blockers.some(s => s.includes('education')));
  assert.ok(latest().stats.demand[3] > 0);
  city.level[office] = 0; city.cityLevel = 0; load(city);
  assert.equal(latest().stats.demand[3], -1);
});
test('farmland and leisure zones grow, employ, share demand and stay on their lots', () => {
  for (const kind of [C.T_FARM, C.T_LEISURE]) for (const level of [1, 2, 3]) for (let v = 0; v < VARIANTS; v++) {
    const g = buildingGeometry(kind, level, v); g.computeBoundingBox();
    const box = g.boundingBox;
    assert.ok(box.min.x >= -0.501 && box.max.x <= 0.501 && box.min.z >= -0.501 && box.max.z <= 0.501, `kind ${kind} level ${level} variant ${v} spills off its lot`);
    assert.ok([...g.attributes.position.array].every(Number.isFinite));
    g.dispose();
  }
  const city = demoCity();
  const shops = [...city.kind.keys()].filter(i => city.kind[i] === C.T_COM);
  const works = [...city.kind.keys()].filter(i => city.kind[i] === C.T_IND);
  const cafe = shops[0], field = works[0];
  city.kind[cafe] = C.T_LEISURE; city.kind[field] = C.T_FARM; city.level[field] = 2; city.cityLevel = 0;
  load(city);
  assert.equal(latest().stats.demand.length, 4, 'The new zones share the four demand meters');
  send({ type: 'inspect', tile: field });
  let report = messages.filter(m => m.type === 'inspection').at(-1).report;
  assert.equal(report.name, 'Farmland');
  assert.equal(report.occupants, C.FARM_JOBS[2]);
  send({ type: 'inspect', tile: cafe });
  report = messages.filter(m => m.type === 'inspection').at(-1).report;
  assert.ok(report.blockers.some(s => s.includes('Small town')), 'Leisure waits for its unlock');
  city.cityLevel = C.LEISURE_UNLOCK; city.level[cafe] = 2; load(city);
  send({ type: 'inspect', tile: cafe });
  report = messages.filter(m => m.type === 'inspection').at(-1).report;
  assert.equal(report.occupants, C.LEISURE_JOBS[2]);
  assert.ok(report.details.some(s => s.includes('Visitor appeal')), 'Leisure explains what draws visitors');
});
test('offices grow a floor at a time and only become towers in a City', () => {
  const city = demoCity(true);
  const offices = [...city.kind.keys()].filter(i => city.kind[i] === C.T_OFFICE);
  for (const i of offices) city.level[i] = 2;
  // Keep the town under 1,800 residents so it cannot earn City status during the test.
  let homes = 0;
  for (let i = 0; i < C.N_TILES; i++) if (city.kind[i] === C.T_RES) { if (++homes > 40) { city.kind[i] = 0; city.level[i] = 0; } else city.level[i] = 2; }
  city.cityLevel = C.OFFICE_UNLOCK; // Thriving town: high-rises allowed for homes and shops, not office towers
  load(city); send({ type: 'warm', ticks: 150 });
  const level = latest().level;
  assert.ok(latest().stats.cityLevel < 4, 'Still a town');
  assert.equal(offices.filter(i => level[i] === 3).length, 0, 'No office tower before the city is a City');
  send({ type: 'inspect', tile: offices[0] });
  const report = messages.filter(m => m.type === 'inspection').at(-1).report;
  if (report.level === 2) assert.ok(report.blockers.some(b => b.includes('Office towers')), 'The inspector says why');
});
test('powered sewage treatment reduces discharge and loses filtration without electricity', () => {
  const city = demoCity();
  // Supply a stable prebuilt population so outlet load cannot drop to zero.
  for (let i = 0; i < C.N_TILES; i++) if (city.kind[i] === C.T_RES) city.level[i] = 1;
  load(city); const dirty = latest().riverPollution.reduce((a, b) => a + b, 0);
  for (let i = 0; i < C.N_TILES; i++) if (city.kind[i] === C.T_OUTLET) city.kind[i] = C.T_TREATMENT;
  load(city); const clean = latest().riverPollution.reduce((a, b) => a + b, 0);
  assert.ok(dirty > 0 && clean < dirty * 0.12, `${dirty} -> ${clean}`);
  assert.ok(latest().stats.treatedSewage > 0);
  for (let i = 0; i < C.N_TILES; i++) if (C.SERVICES[city.kind[i]]?.power) city.kind[i] = 0;
  load(city); assert.equal(latest().stats.treatedSewage, 0);
  assert.ok(latest().riverPollution.reduce((a, b) => a + b, 0) > clean);
});
test('expanded demo runs actual buses, transit ridership and flights; rail stays in road corridors', () => {
  const city = demoCity(true); load(city); send({ type: 'warm', ticks: 150 });
  const s = latest();
  assert.ok(s.stats.transport.busLines > 0, JSON.stringify(s.stats.transport));
  assert.ok(s.stats.transport.railLines > 0, JSON.stringify(s.stats.transport));
  assert.ok(s.stats.transport.subwayLines > 0, JSON.stringify(s.stats.transport));
  assert.ok(s.stats.transport.airports > 0, JSON.stringify(s.stats.transport));
  const net = Network.fromPlain(city.net), r = rasterize(net);
  const stations = Array.from(city.kind, (k, i) => k === C.T_STATION ? i : -1).filter(i => i >= 0);
  const path = railPath(net, r, stations[0], stations[1]);
  assert.ok(path.length > 1);
  assert.ok(path.every(p => net.nearestSeg(p.x, p.z, 0.05)), 'Track stays over road centers');
  send({ type: 'speed', value: 1 }); let busSeen = false;
  for (let i = 0; i < 45 * C.SIM_HZ; i++) {
    simulateFrame();
    const frame = messages.at(-1);
    if (frame.type === 'frame') for (let o = 3; o < frame.cars.length; o += 4) if (frame.cars[o] === 4) busSeen = true;
    if (messages.length > 50) messages.splice(0, messages.length - 20);
  }
  assert.ok(busSeen, 'A bus should be dispatched onto its road route');
  assert.ok(latest().stats.transport.riders > 0, JSON.stringify(latest().stats.transport));
  assert.ok(latest().stats.transport.airPassengers > 0, JSON.stringify(latest().stats.transport));
});

test('transport stops operating after utilities fail or a station is removed', () => {
  const city = demoCity(true); load(city); send({ type: 'warm', ticks: 150 });
  city.level.set(latest().level);
  // Take away every station but one: a lone station makes no line.
  const stations = Array.from(city.kind, (k, i) => k === C.T_STATION ? i : -1).filter(i => i >= 0);
  const before = latest().stats.transport.railLines;
  for (const station of stations.slice(1)) { city.kind[station] = 0; city.level[station] = 0; }
  load(city); assert.ok(before > 0); assert.equal(latest().stats.transport.railLines, 0);
  for (let i = 0; i < C.N_TILES; i++) if (C.SERVICES[city.kind[i]]?.power) city.kind[i] = 0;
  load(city);
  assert.equal(latest().stats.transport.busLines, 0);
  assert.equal(latest().stats.transport.airports, 0);
});
const { Input } = await import('../src/input.ts');
const { Game } = await import('../src/game.ts');
const hillsModule = await import('../src/render/hills.ts');
test('raised ground: hills pile up a storey at a time, block building and roads, and save', () => {
  // A Game without a worker: the test only shapes the ground and reads it back.
  const savedWorker = globalThis.Worker; globalThis.Worker = class { postMessage() {} };
  const g = new Game(); globalThis.Worker = savedWorker;
  g.load(newCity(5));
  const t = g.terrain;
  const free = [...Array(C.N_TILES).keys()].filter(i => { const x = i % C.GRID, z = Math.floor(i / C.GRID); return x > 20 && z > 20 && x < 60 && z < 60 && !t.water[i] && !t.shore[i] && !g.raster.cover[i] && g.owners[i] < 0; });
  const patch = free.slice(0, 9);
  const money = g.stats.money;
  assert.equal(g.terraform(patch, 'raise').changed, 9);
  assert.equal(g.terraform(patch, 'raise').changed, 9, 'Painting again builds it higher');
  assert.ok(patch.every(i => X.hillLevel(g.extras.terraform[i]) === 2));
  for (let k = 0; k < 5; k++) g.terraform(patch, 'raise');
  assert.ok(patch.every(i => X.hillLevel(g.extras.terraform[i]) === X.HILL_MAX), 'Hills top out');
  assert.ok(patch.every(i => !g.buildable(i)), 'Nothing builds on raised ground');
  assert.ok(g.hillMask[patch[0]] === 1 && g.hillMask[free[20]] === 0);
  assert.ok(X.elevation(t, g.extras.terraform, patch[0]) === X.HILL_MAX, 'A hill stands four storeys up');
  // Digging goes a storey deeper each pass, up to three, and filling brings it back up.
  const pit = free.slice(9, 13);
  assert.equal(g.terraform(pit, 'lower').changed, 4);
  assert.equal(g.terraform(pit, 'lower').changed, 4, 'A second pass digs deeper');
  assert.ok(pit.every(i => X.digLevel(g.extras.terraform[i]) === 2));
  g.terraform(pit, 'lower'); g.terraform(pit, 'lower');
  assert.ok(pit.every(i => X.digLevel(g.extras.terraform[i]) === X.DIG_MAX), 'Pits bottom out');
  assert.ok(X.digLevel(decode(encode(g.snapshot())).extras.terraform[pit[0]]) === X.DIG_MAX, 'Deep pits survive a save');
  assert.ok(pit.every(i => g.terrain.water[i] === 1), 'Dug ground is water');
  assert.equal(g.terraform(pit, 'raise').changed, 4);
  assert.ok(pit.every(i => X.digLevel(g.extras.terraform[i]) === X.DIG_MAX - 1), 'Filling brings a pit up a storey');
  const deep = new W.WaterSim(t, g.extras.terraform);
  assert.ok(deep.ground[pit[0]] < -2 && deep.ground[free[20]] === 0, 'The water sees the pit as deep ground');
  const back = decode(encode(g.snapshot()));
  assert.equal(X.hillLevel(back.extras.terraform[patch[0]]), X.HILL_MAX, 'Hills survive a save');
  assert.equal(g.terraform(patch, 'lower').changed, 9);
  assert.equal(X.hillLevel(g.extras.terraform[patch[0]]), X.HILL_MAX - 1);
  for (let k = 0; k < 3; k++) g.terraform(patch, 'lower');
  assert.ok(patch.every(i => g.extras.terraform[i] === 0 && g.buildable(i)), 'Lowered all the way, the ground is level and buildable again');
  g.terraform(patch, 'lower');
  assert.ok(patch.every(i => X.digLevel(g.extras.terraform[i]) === 1), 'and one more pass digs in');
  g.terraform(patch, 'raise'); g.terraform(patch, 'raise'); g.terraform(patch, 'raise');
  assert.ok(patch.every(i => X.hillLevel(g.extras.terraform[i]) === 2), 'Raising fills the hole and then builds up');
  assert.equal(g.terraform(patch, 'flat').changed, 9);
  assert.ok(patch.every(i => g.extras.terraform[i] === 0), 'Flatten puts it all back to level');
  assert.equal(g.terraform(patch, 'flat').changed, 0, 'and has nothing to do on level ground');
  assert.ok(g.stats.money < money, 'Moving earth costs money');
  const { HillLayer } = hillsModule;
  const layer = new HillLayer();
  g.terraform(patch, 'raise'); g.terraform(patch, 'raise');
  layer.rebuild(new W.WaterSim(t, g.extras.terraform).ground);
  const cx = patch[4] % C.GRID + 0.5 - 40, cz = Math.floor(patch[4] / C.GRID) + 0.5 - 40;
  assert.ok(layer.heightAt(cx, cz) > 0.5, `The mound rises over the raised cells (${layer.heightAt(cx, cz).toFixed(2)})`);
  // Flat where there is neither hill nor river: a dry tile with dry neighbours, well away from the mound.
  const dry = free.find(i => Math.hypot(i % C.GRID - patch[4] % C.GRID, Math.floor(i / C.GRID) - Math.floor(patch[4] / C.GRID)) > 10 && [-2, -1, 0, 1, 2].every(dx => [-2, -1, 0, 1, 2].every(dz => !t.water[(Math.floor(i / C.GRID) + dz) * C.GRID + i % C.GRID + dx] && !t.shore[(Math.floor(i / C.GRID) + dz) * C.GRID + i % C.GRID + dx])));
  assert.ok(Math.abs(layer.heightAt(dry % C.GRID + 0.5 - 40, Math.floor(dry / C.GRID) + 0.5 - 40)) < 0.05, 'and is flat away from them');
  const flows = [...Array(C.N_TILES).keys()].filter(i => t.water[i]).map(i => t.flow[i]), midFlow = (Math.min(...flows) + Math.max(...flows)) / 2;
  const riverTile = [...Array(C.N_TILES).keys()].find(i => t.water[i] && t.flow[i] > midFlow && i % C.GRID > 5 && i % C.GRID < 75 && i > 5 * C.GRID && i < 75 * C.GRID);
  assert.ok(layer.heightAt(riverTile % C.GRID + 0.5 - 40, Math.floor(riverTile / C.GRID) + 0.5 - 40) < -0.5, 'The river runs in a channel cut into the relief');
});

test('transport placement enforces unlocks and clearing a site removes its whole reservation', () => {
  const input = Object.create(Input.prototype);
  input.game = { stats: { cityLevel: 0 } };
  for (const k of [C.T_BUS, C.T_STATION, C.T_AIRPORT, C.T_TREATMENT]) assert.match(input.serviceProblem(100, k), /Unlocks at/);
  const game = Object.create(Game.prototype);
  game.kind = new Uint8Array(C.N_TILES); game.level = new Uint8Array(C.N_TILES); game.rot = new Uint8Array(C.N_TILES);
  const tile = C.idx(10, 10); game.kind[tile] = C.T_AIRPORT; game.level[tile] = 1;
  game.owners = siteOwners(game.kind); game.pendingSpent = 0;
  assert.equal(game.setKind(tile + C.GRID + 3, C.T_EMPTY, 0), true);
  assert.equal(game.kind[tile], C.T_EMPTY);
  assert.ok(footprint(tile, C.T_AIRPORT).every(t => game.owners[t] === -1));
});

const { TrafficSpace, vehiclesOverlap } = await import('../src/sim/trafficSpace.ts');
const { Incidents, HEIST_LIMIT } = await import('../src/sim/incidents.ts');
test('vehicle reservations prevent occupied spawns and swept crossing movements', () => {
  const space = new TrafficSpace();
  space.set(1, { x: 10, z: 10, angle: 0, type: 3 });
  assert.equal(space.free({ x: 10, z: 10.1, angle: 0, type: 1 }), false);
  space.set(2, { x: 9, z: 10, angle: Math.PI / 2, type: 1 });
  assert.equal(space.canMove(2, { x: 11, z: 10, angle: Math.PI / 2, type: 1 }), false, 'Cannot tunnel through a truck');
  assert.equal(space.free({ x: 10.4, z: 10, angle: Math.PI, type: 1 }), true, 'Opposite lanes have room to pass');
  space.remove(1);
  assert.equal(space.canMove(2, { x: 11, z: 10, angle: Math.PI / 2, type: 1 }), true);
});
test('fires and patrol protection persist while old v5 saves still migrate', () => {
  const city = demoCity(); city.incidents = { fires: [{ tile: 100, age: 48 }], crime: [[101, 50]], patrol: [[102, 150]] };
  const restored = decode(encode(city)); assert.deepEqual(restored.incidents, city.incidents);
  const empty = demoCity(); const bytes = Buffer.from(encode(empty), 'base64url');
  // Strip the incident block and the empty rotation, park-path and extras blocks that follow it.
  const tail = new TextEncoder().encode(JSON.stringify({ fires: [], crime: [], patrol: [] })).length + 4 + 2 + 2 + extrasLength(empty);
  // A v5 stream has no policy mask: keep the first 28 header bytes and the body that follows the v9 header.
  const v5 = Buffer.concat([bytes.subarray(0, 28), bytes.subarray(30, bytes.length - tail)]); v5[0] = 5;
  const migrated = decode(v5.toString('base64url')); assert.ok(migrated); assert.equal(migrated.incidents, undefined);
  city.incidents.fires[0].age = 120; assert.equal(decode(encode(city)), null);
});
test('some shops hang banners, and not all of them', () => {
  const wearing = (level, v) => {
    const geo = buildingGeometry(C.T_COM, level, v);
    const colors = geo.attributes.color.array;
    const found = BANNER_COLORS.some(hex => {
      // three converts hex colours into its working space, so compare the same way.
      const { r, g, b } = new THREE.Color(hex);
      for (let i = 0; i < colors.length; i += 3) {
        if (Math.abs(colors[i] - r) < 0.02 && Math.abs(colors[i + 1] - g) < 0.02 && Math.abs(colors[i + 2] - b) < 0.02) return true;
      }
      return false;
    });
    geo.dispose();
    return found;
  };
  const shops = [0, 1, 2, 3].map(v => wearing(1, v));
  const blocks = [0, 1, 2, 3].map(v => wearing(2, v));
  assert.ok(shops.filter(Boolean).length >= 2, 'Most shops carry a sign');
  assert.ok(blocks.includes(false), 'Some frontages stay plain');
  assert.ok(!wearing(3, 0), 'Glass towers do not hang banners');
});
test('hospitals heal and police headquarters patrol like the smaller buildings they replace', () => {
  const city = demoCity(true);
  const net = Network.fromPlain(city.net); ensureApproaches(net);
  const r = rasterize(net), terrain = generateTerrain(city.seed), owners = siteOwners(city.kind);
  // Swap every clinic and police station for the big versions, on free land by a road.
  for (let i = 0; i < C.N_TILES; i++) if (city.kind[i] === C.T_CLINIC || city.kind[i] === C.T_POLICE) { city.kind[i] = 0; city.level[i] = 0; }
  // Closest free site to the middle of the homes, so both buildings serve the neighbourhoods.
  const homes = Array.from(city.kind, (k, i) => k === C.T_RES ? i : -1).filter(i => i >= 0);
  const mx = homes.reduce((n, i) => n + i % C.GRID, 0) / homes.length, mz = homes.reduce((n, i) => n + Math.floor(i / C.GRID), 0) / homes.length;
  const order = Array.from({ length: C.N_TILES }, (_, i) => i).sort((a, b) => Math.hypot(a % C.GRID - mx, Math.floor(a / C.GRID) - mz) - Math.hypot(b % C.GRID - mx, Math.floor(b / C.GRID) - mz));
  const place = (k) => {
    for (const i of order) {
      const cells = footprint(i, k);
      if (!cells.length || r.accSeg[i] < 0) continue;
      // Zoned lots may be cleared for them; other buildings stay.
      if (cells.some(t => (city.kind[t] && !C.isZone(city.kind[t])) || r.cover[t] || terrain.water[t] || terrain.shore[t] || owners[t] >= 0)) continue;
      for (const t of cells) { city.kind[t] = 0; city.level[t] = 0; }
      city.kind[i] = k; city.level[i] = 1; return i;
    }
    return -1;
  };
  const hospital = place(C.T_HOSPITAL), hq = place(C.T_POLICE_HQ);
  assert.ok(hospital >= 0 && hq >= 0, 'Both fit somewhere in the demo');
  load(city);
  send({ type: 'warm', ticks: 120 });
  send({ type: 'speed', value: 1 });
  let patrols = 0, stats = latest().stats;
  for (let f = 0; f < 30 * C.SIM_HZ; f++) {
    simulateFrame();
    const state = latest();
    if (state) { stats = state.stats; patrols = Math.max(patrols, stats.incidents.patrols); }
    // Keep the newest state when trimming, or there is nothing left to read.
    if (messages.length > 60) { const keep = latest(); messages.length = 0; if (keep) messages.push(keep); }
  }
  assert.ok(stats.civic.health > 0, 'The hospital covers the city');
  assert.ok(stats.civic.safety > 0, `The headquarters covers the city (at ${hq % C.GRID},${Math.floor(hq / C.GRID)}, flags ${latest()?.flags?.[hq]})`);
  assert.ok(patrols > 0, 'And sends patrol cars out');
  console.log(`  Hospital + HQ: ${stats.civic.health}% health, ${stats.civic.safety}% safety, up to ${patrols} patrols out`);
});
test('every building variant is painted: no colour table runs out before the variants do', () => {
  // A missing entry becomes three's default colour, pure white, which also lights up at night.
  for (const kind of [C.T_RES, C.T_COM, C.T_IND, C.T_OFFICE, C.T_FARM, C.T_LEISURE]) for (const level of [1, 2, 3]) {
    for (let v = 0; v < VARIANTS; v++) {
      const geo = buildingGeometry(kind, level, v), c = geo.attributes.color.array;
      for (let i = 0; i < c.length; i += 3) {
        assert.ok(!(c[i] === 1 && c[i + 1] === 1 && c[i + 2] === 1), `kind ${kind} level ${level} variant ${v} has an unpainted part`);
      }
      geo.dispose();
    }
  }
});
test('new power stations generate what they promise', () => {
  const city = demoCity();
  const net = Network.fromPlain(city.net); ensureApproaches(net);
  const r = rasterize(net), terrain = generateTerrain(city.seed), owners = siteOwners(city.kind);
  const base = (() => { load(city); send({ type: 'warm', ticks: 5 }); return latest().stats.power[1]; })();
  // A gas plant anywhere by a road, and a dam on the bank.
  const withPower = { ...city, kind: Uint8Array.from(city.kind), level: Uint8Array.from(city.level) };
  const free = (i, bank) => !withPower.kind[i] && !terrain.water[i] && !r.cover[i] && r.accSeg[i] >= 0 && owners[i] < 0 && (bank || !terrain.shore[i]);
  const gas = [...Array(C.N_TILES).keys()].find(i => free(i, false));
  withPower.kind[gas] = C.T_GAS; withPower.level[gas] = 1;
  const dam = [...Array(C.N_TILES).keys()].find(i => free(i, true) && touchesWater(terrain, i % C.GRID, Math.floor(i / C.GRID)));
  withPower.kind[dam] = C.T_HYDRO; withPower.level[dam] = 1;
  load(withPower); send({ type: 'warm', ticks: 5 });
  const added = latest().stats.power[1] - base;
  assert.ok(Math.abs(added - (C.SERVICES[C.T_GAS].power + C.SERVICES[C.T_HYDRO].power)) < 1, `Expected the gas plant and dam to add their output, got ${added}`);
  assert.ok(C.SERVICES[C.T_NUCLEAR].power > C.SERVICES[C.T_SOLAR].power * 3, 'The reactor dwarfs every other station');
  assert.ok(C.SERVICES[C.T_GAS].pollution < C.SERVICES[C.T_COAL].pollution, 'Gas burns cleaner than coal');
});
test('fishing docks employ people and sell a catch that sewage upstream spoils', () => {
  const geo = buildingGeometry(C.T_DOCKS, 1, 0);
  geo.computeBoundingBox();
  assert.ok([...geo.attributes.position.array].every(Number.isFinite));
  assert.ok(geo.boundingBox.min.z < -1.2, 'The jetty runs out past the bank, over the water');
  geo.dispose();

  const city = demoCity();
  const net = Network.fromPlain(city.net); ensureApproaches(net);
  const r = rasterize(net), terrain = generateTerrain(city.seed);
  // Bank tiles a dock or an outlet could stand on, from upstream to downstream.
  const banks = [];
  for (let i = 0; i < C.N_TILES; i++) {
    const x = i % C.GRID, z = Math.floor(i / C.GRID);
    if (city.kind[i] || terrain.water[i] || r.cover[i] || r.accSeg[i] < 0 || !touchesWater(terrain, x, z)) continue;
    banks.push({ i, flow: adjacentFlow(terrain, x, z) });
  }
  banks.sort((a, b) => a.flow - b.flow);
  const dock = banks.at(-1), source = banks.find(b => b.flow < dock.flow - 12);
  assert.ok(dock && source, 'The demo river has room for a dock with an outlet above it');

  // The same dock, first with the city's outlet gone, then with an outlet just upstream of it.
  const run = (fouled) => {
    const withDock = { ...city, kind: Uint8Array.from(city.kind), level: Uint8Array.from(city.level) };
    // The city's own outlets go, so only the one this test adds can foul the river.
    for (let i = 0; i < C.N_TILES; i++) if (withDock.kind[i] === C.T_OUTLET || withDock.kind[i] === C.T_TREATMENT) { withDock.kind[i] = 0; withDock.level[i] = 0; }
    if (fouled) { withDock.kind[source.i] = C.T_OUTLET; withDock.level[source.i] = 1; }
    withDock.kind[dock.i] = C.T_DOCKS; withDock.level[dock.i] = 1;
    load(withDock);
    send({ type: 'warm', ticks: 120 });
    return latest().stats;
  };
  const clean = run(false), fouled = run(true);
  assert.equal(clean.docks, 1, 'The dock counts as working');
  assert.ok(clean.fishingIncome > 0, 'Its boats land a catch');
  assert.ok(fouled.fishingIncome < clean.fishingIncome * 0.8, `Sewage upstream thins the catch: ${fouled.fishingIncome.toFixed(2)} vs ${clean.fishingIncome.toFixed(2)}`);
  console.log(`  Fishing docks: $${clean.fishingIncome.toFixed(2)}/s on a clean river, $${fouled.fishingIncome.toFixed(2)}/s below an outlet`);
});
test('a robbery calls the police, and getting away costs the city', () => {
  const events = new Incidents(), kind = new Uint8Array(C.N_TILES), level = new Uint8Array(C.N_TILES);
  const shop = C.idx(20, 20);
  kind[shop] = C.T_COM; level[shop] = 2;
  const normal = { fire: 1, crime: 1 };
  events.rob(shop);
  assert.equal(events.heists.size, 1);
  events.foil(shop);
  assert.equal(events.foiled, 1, 'The police reaching the scene ends it');
  assert.equal(events.heists.size, 0);
  events.rob(shop);
  for (let i = 0; i < HEIST_LIMIT; i++) events.step(kind, level, 400, 3, () => 1, normal, () => {});
  assert.equal(events.robbed, 1, 'Left alone, the crew gets away');
  assert.equal(events.heists.size, 0);

  // A robbery in the running city pulls a patrol car out and shows up in the stats.
  const city = demoCity(true);
  load(city);
  send({ type: 'warm', ticks: 150 });
  assert.equal(latest().stats.incidents.heists, 0);
  assert.ok('robbed' in latest().stats.incidents && 'foiled' in latest().stats.incidents);
});
test('patrol visits prevent crime and unattended fires damage buildings', () => {
  const events = new Incidents(), kind = new Uint8Array(C.N_TILES), level = new Uint8Array(C.N_TILES), tile = C.idx(20, 20);
  kind[tile] = C.T_RES; level[tile] = 2; events.visit(tile);
  // Fire roll fails, crime roll succeeds, then choose the only home and prevent the crime.
  const rolls = [1, 0, 0, 0]; let n = 0;
  const normal = { fire: 1, crime: 1 };
  events.step(kind, level, 400, 2, () => rolls[n++], normal, () => {});
  assert.equal(events.prevented, 1); assert.equal(events.crime[tile], 0);
  events.ignite(tile); let damaged = false;
  for (let i = 0; i < 120; i++) events.step(kind, level, 0, 0, () => 1, normal, () => { damaged = true; });
  assert.ok(damaged); assert.equal(events.fires.size, 0);
});
test('real fire engines arrive before extinguishing and police patrols visit neighborhoods', () => {
  const city = demoCity(), net = Network.fromPlain(city.net), r = rasterize(net);
  const station = city.kind.findIndex(k => k === C.T_FIRE);
  const home = Array.from(city.kind, (k, i) => k === C.T_RES && r.accSeg[i] === r.accSeg[station] ? i : -1).filter(i => i >= 0).sort((a, b) => Math.abs(r.accS[a] - r.accS[station]) - Math.abs(r.accS[b] - r.accS[station]))[0];
  assert.ok(home >= 0);
  for (let i = 0; i < C.N_TILES; i++) if (C.isZone(city.kind[i])) city.level[i] = 0;
  city.level[home] = 2; city.cityLevel = 3;
  city.incidents = { fires: [{ tile: home, age: 0 }], crime: [], patrol: [] };
  Math.random = () => 0.5; load(city); send({ type: 'speed', value: 1 });
  let engineSeen = false, policeSeen = false;
  for (let i = 0; i < 60 * C.SIM_HZ; i++) {
    simulateFrame(); const f = messages.at(-1);
    if (f.type === 'frame') for (let j = 3; j < f.cars.length; j += 4) { engineSeen ||= f.cars[j] === 6; policeSeen ||= f.cars[j] === 5; }
    if (messages.length > 100) messages.splice(0, messages.length - 20);
  }
  assert.ok(engineSeen); assert.ok(policeSeen);
  assert.equal(latest().incidents.fires.length, 0); assert.equal(latest().stats.incidents.extinguished, 1);
  assert.ok(latest().incidentSave.patrol.some(([tile, seconds]) => tile === home && seconds > 0));
  Math.random = C.mulberry32(123);
});
test('dense traffic never overlaps vehicle bodies and produces recoverable collision incidents', () => {
  Math.random = C.mulberry32(732);
  load(demoCity(true)); send({ type: 'warm', ticks: 150 }); send({ type: 'speed', value: 1 });
  let crashSeen = false, previousFrame;
  for (let tick = 0; tick < 100 * C.SIM_HZ; tick++) {
    if (tick === 50 * C.SIM_HZ) Math.random = () => 0;
    if (tick === 52 * C.SIM_HZ) Math.random = C.mulberry32(890);
    simulateFrame(); const frame = messages.at(-1);
    if (frame.type === 'frame' && tick % 3 === 0) {
      const space = new TrafficSpace();
      for (let i = 0; i < C.MAX_CARS; i++) {
        const o = i * 4, type = frame.cars[o + 3]; if (!type) continue;
        // Heights matter: a car on the interchange overpass sits above the carriageway, not in it.
        const p = { x: frame.cars[o], z: frame.cars[o + 1], angle: frame.cars[o + 2], type, y: frame.carHeights[i] };
        // Float32 frames lose a few ulps; test actual bodies rather than the safety buffer.
        for (const other of space.poses.values()) if (Math.abs(p.x - other.x) < 1 && Math.abs(p.z - other.z) < 1) assert.equal(vehiclesOverlap(p, other, 0), false, 'Vehicle bodies intersect');
        space.set(i, p);
      }
    }
    if (frame.type === 'frame' && previousFrame && tick % 30 === 0) for (const alpha of [0.25, 0.5, 0.75]) {
      const poses = [];
      for (let i = 0; i < C.MAX_CARS; i++) {
        const o = i * 4, type = frame.cars[o + 3]; if (!type) continue;
        const p = { x: frame.cars[o], z: frame.cars[o + 1], angle: frame.cars[o + 2], type, y: frame.carHeights[i] };
        if (previousFrame.carIds[i] === frame.carIds[i] && previousFrame.cars[o + 3] === type && Math.abs(previousFrame.cars[o] - p.x) + Math.abs(previousFrame.cars[o + 1] - p.z) < 1.5) {
          p.x = previousFrame.cars[o] + (p.x - previousFrame.cars[o]) * alpha;
          p.z = previousFrame.cars[o + 1] + (p.z - previousFrame.cars[o + 1]) * alpha;
          const angle = previousFrame.cars[o + 2]; p.angle = angle + Math.atan2(Math.sin(p.angle - angle), Math.cos(p.angle - angle)) * alpha;
        }
        for (const other of poses) if (Math.abs(p.x - other.x) < 1 && Math.abs(p.z - other.z) < 1) assert.equal(vehiclesOverlap(p, other, 0), false, 'Rendered interpolation intersects another car');
        poses.push(p);
      }
    }
    if (frame.type === 'frame') previousFrame = frame;
    crashSeen ||= latest()?.incidents.crashes.length > 0;
    if (messages.length > 100) messages.splice(0, messages.length - 20);
  }
  assert.ok(crashSeen, 'Random collisions should create visible blocked-lane incidents');
});

const { StreetDetailLayer, bodyOfGeometry } = await import('../src/render/streetDetail.ts');
test('street detail streams in around the camera, nearest first and finest near, and goes when you leave', () => {
  const city = demoCity(true), net = Network.fromPlain(city.net), terrain = generateTerrain(city.seed), raster = rasterize(net);
  const bodies = new Map();
  const source = {
    kind: city.kind, level: city.level, raster, net, terrain, terraform: city.extras.terraform,
    relief: () => 0, surface: () => NaN,
    body: (k, l, v) => { const key = `${k}:${l}:${v}`; if (!bodies.has(key)) bodies.set(key, bodyOfGeometry(buildingGeometry(k, l, v))); return bodies.get(key); },
  };
  // A house's walls: well inside its lot, and taller than a person.
  const house = source.body(C.T_RES, 1, 0);
  assert.ok(house && house.x1 - house.x0 > 0.3 && house.x1 - house.x0 < 0.9 && house.h > 0.35, JSON.stringify(house));
  const layer = new StreetDetailLayer();
  layer.setDetail(1);
  layer.setActive(true, source);
  const eye = { x: 42.5 - 40, y: 0.13, z: 24.5 - 40 };
  layer.update(eye, true);
  const { chunks, triangles } = layer.stats;
  assert.ok(chunks > 10 && triangles > 20000, `Detail should fill the streets around the camera: ${JSON.stringify(layer.stats)}`);
  let fine = 0;
  for (const mesh of layer.group.children) {
    const p = mesh.geometry.attributes.position.array;
    for (let k = 0; k < p.length; k++) assert.ok(Number.isFinite(p[k]), 'Detail geometry is finite');
    const c = mesh.geometry.boundingSphere.center;
    assert.ok(Math.hypot(c.x - eye.x, c.z - eye.z) < 12 + 6, 'Only chunks within reach exist');
    if (mesh.castShadow) fine++;
  }
  assert.ok(fine > 0 && fine < chunks, 'The nearest chunks are built finer (and cast shadows), the rest coarser');
  // Nothing is rebuilt while standing still; walking away drops what falls behind.
  const built = layer.stats.built;
  layer.update(eye); layer.update(eye);
  assert.equal(layer.stats.built, built, 'Standing still rebuilds nothing');
  for (let k = 0; k < 40; k++) layer.update({ x: -30, y: 0.13, z: 30 }, false);
  for (const mesh of layer.group.children) assert.ok(Math.hypot(mesh.geometry.boundingSphere.center.x + 30, mesh.geometry.boundingSphere.center.z - 30) < 18, 'Chunks left behind are dropped');
  // A change to the streets rebuilds the chunks it touches.
  net.version++;
  const before = layer.stats.built;
  for (let k = 0; k < 25; k++) layer.update({ x: -30, y: 0.13, z: 30 }, false);
  assert.ok(layer.stats.built > before, 'A changed map is rebuilt');
  layer.setActive(false);
  assert.equal(layer.group.children.length, 0, 'Leaving the street throws the detail away');

  // From above, close in: coarser chunks round the point looked at, with the rooftops dressed.
  layer.setOverview(true, source);
  layer.update({ x: 42.5 - 40, z: 24.5 - 40 }, true, 10);
  assert.ok(layer.stats.chunks > 5, 'Detail streams in round the point the camera looks at');
  assert.ok(layer.group.children.every(m => !m.castShadow), 'From above nothing is built at the finest level');
  let high = 0;
  for (const mesh of layer.group.children) { const p = mesh.geometry.attributes.position.array; for (let k = 1; k < p.length; k += 3) if (p[k] > 1) high++; }
  assert.ok(high > 500, `The downtown roofs carry plant, tanks, dishes and the like: ${high} points above 1`);
  layer.setOverview(false);
  assert.equal(layer.group.children.length, 0);
  // Flat roofs are found; a gabled house has none you could stand things on.
  const tower = source.body(C.T_RES, 3, 0), gabled = source.body(C.T_RES, 1, 0);
  assert.ok(tower.roof && tower.roof.y > 2, 'A tower has a flat roof up top');
  assert.ok(!gabled.roof || gabled.roof.y < gabled.h + 0.02, 'A gabled house has no roof deck above its walls');
});
const { Driver } = await import('../src/render/driver.ts');
test('the driven car slides under the handbrake, leaves skid marks, and bumps off traffic instead of passing through it', () => {
  // The driver listens for keys on the window; a stand-in is enough to build one here.
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) globalThis.window = { addEventListener: () => {} };
  let traffic = [];
  const knocks = [];
  const driver = new Driver(new THREE.PerspectiveCamera(), new THREE.Scene(), {
    blocked: () => false, ground: () => 0, traffic: () => traffic, impact: (s) => knocks.push(s), onExit: () => {},
  });
  if (!hadWindow) delete globalThis.window;
  driver.enter(0, 0, 0);
  const keys = driver.keys;
  keys.add('KeyW'); keys.add('ShiftLeft');
  for (let f = 0; f < 90; f++) driver.update(1 / 60);
  assert.ok(driver.kmh > 40, `Full throttle gets going: ${driver.kmh}`);
  assert.ok(driver.slip < 0.05, 'Driving straight, the tyres grip');
  keys.add('KeyA'); keys.add('Space');
  let most = 0;
  for (let f = 0; f < 40; f++) { driver.update(1 / 60); most = Math.max(most, driver.slip); }
  assert.ok(most > 0.5, `The handbrake in a turn breaks the back loose: ${most}`);
  assert.ok(driver.marks.count > 5, 'A slide leaves skid marks on the road');
  const pointing = driver.heading, going = Math.atan2(driver.vx, driver.vz);
  assert.ok(Math.abs(Math.atan2(Math.sin(pointing - going), Math.cos(pointing - going))) > 0.3, 'The car points one way and travels another');
  keys.clear();
  // A parked lorry straight ahead: the car stops against it and bounces back, rather than driving through.
  driver.exit(); driver.enter(0, 0, 0);
  traffic = [{ x: 0, z: 0.8, angle: Math.PI / 2, length: 0.56, y: 0 }];
  keys.add('KeyW');
  let closest = Infinity;
  for (let f = 0; f < 240; f++) { driver.update(1 / 60); closest = Math.min(closest, Math.abs(driver.position.z - 0.8)); }
  assert.ok(closest > 0.1, `The car never overlaps the lorry: ${closest.toFixed(3)} from its middle`);
  assert.ok(knocks.length > 0, 'Running into it is a knock the player hears');
});
const { planRaces, routeAt } = await import('../src/racing/routes.ts');
const { RaceWorld } = await import('../src/racing/race.ts');
const { defaultGarage, driveStats, partCost, MODELS } = await import('../src/racing/garage.ts');
test('street races are planned on the city streets, with barriers on the side streets, and run to a result', () => {
  const city = demoCity(true), net = Network.fromPlain(city.net);
  const races = planRaces(net, city.seed);
  const kinds = new Set(races.map(r => r.kind));
  for (const k of ['circuit', 'sprint', 'drift', 'drag', 'police']) assert.ok(kinds.has(k), `The demo has a ${k} race: ${[...kinds]}`);
  assert.deepEqual(planRaces(net, city.seed).map(r => r.id), races.map(r => r.id), 'The same city gets the same races');
  for (const r of races) {
    for (let i = 1; i < r.xs.length; i++) assert.ok(Math.hypot(r.xs[i] - r.xs[i - 1], r.zs[i] - r.zs[i - 1]) < 0.8, `${r.name} runs along the roads without gaps`);
    if (r.loop) assert.ok(Math.hypot(r.xs[0] - r.xs.at(-1), r.zs[0] - r.zs.at(-1)) < 1e-6, `${r.name} closes its loop`);
    assert.ok(r.reward > 0 && r.length > 8, `${r.name} is worth racing`);
    // The start and the finish lie along a street, clear of any junction.
    for (const d of r.kind === 'drag' ? [] : r.loop ? [0] : [0, r.length]) {
      const p = routeAt(r, d);
      for (const n of net.nodes.values()) if (net.degree(n.id) >= 3) assert.ok(Math.hypot(n.x - 40 - p.x, n.z - 40 - p.z) > 0.6, `${r.name} starts and finishes clear of junctions`);
    }
    // The rivals' line rounds the corners off: no right-angle pivots from one step to the next.
    let sharpest = 0;
    for (let i = 2; i < r.lx.length; i++) {
      const a = Math.atan2(r.lx[i - 1] - r.lx[i - 2], r.lz[i - 1] - r.lz[i - 2]), b = Math.atan2(r.lx[i] - r.lx[i - 1], r.lz[i] - r.lz[i - 1]);
      sharpest = Math.max(sharpest, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
    }
    assert.ok(sharpest < 0.35, `${r.name}'s racing line turns smoothly: ${sharpest.toFixed(2)} rad in one step`);
  }
  const circuit = races.find(r => r.kind === 'circuit');
  assert.ok(circuit.barriers.length > 0, 'Side streets off a circuit are barred');
  const drag = races.find(r => r.kind === 'drag'), a = routeAt(drag, 0.5), b = routeAt(drag, drag.length - 0.5);
  assert.ok(Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz)) < 0.6, 'A drag strip runs straight');

  // Race it: a driver that sticks to the racing line, flat out.
  const hadWindow = 'window' in globalThis;
  if (!hadWindow) globalThis.window = { addEventListener: () => {} };
  const driver = new Driver(new THREE.PerspectiveCamera(), new THREE.Scene(), { blocked: () => false, ground: () => 0, traffic: () => [], onExit: () => {} });
  if (!hadWindow) delete globalThis.window;
  driver.enter(0, 0, 0);
  const world = new RaceWorld();
  const sprint = races.find(r => r.kind === 'sprint');
  let result = null;
  world.onFinish = r => { result = r; };
  world.start(sprint, driver, 0.8);
  assert.equal(world.hud.phase, 'countdown');
  assert.equal(world.hud.place, sprint.rivals + 1, 'The player starts at the back of the grid');
  for (const rival of world.cars()) assert.ok(Math.hypot(rival.x - driver.position.x, rival.z - driver.position.z) > 0.25, 'Every car on the grid has a place of its own');
  const start = { ...driver.position };
  for (let f = 0; f < 60; f++) { driver.update(1 / 60); world.update(1 / 60, driver, f / 60); }
  assert.ok(Math.hypot(driver.position.x - start.x, driver.position.z - start.z) < 0.05, 'The car is held on the grid through the countdown');
  // A barrier across a side street stops the car.
  const bar = sprint.barriers[0] ?? circuit.barriers[0];
  if (sprint.barriers.length) assert.ok(world.blocks(bar.x, bar.z, bar.y), 'Barriers are solid');
  // Wrong way: facing back down the route while moving.
  for (let f = 0; f < 200 && world.hud.phase === 'countdown'; f++) world.update(1 / 60, driver, 1);
  let s = world.progress;
  const back = routeAt(sprint, s);
  driver.teleport(back.x, back.z, Math.atan2(-back.tx, -back.tz)); driver.vx = -back.tx * 1.5; driver.vz = -back.tz * 1.5;
  world.update(1 / 60, driver, 1);
  assert.ok(world.hud.wrongWay, 'Driving back down the route shows the wrong-way warning');
  // Then along the route to the finish, faster than the rivals.
  for (let f = 0; f < 20000 && !result; f++) {
    s = Math.min(sprint.length, s + 5 / 60);
    const p = routeAt(sprint, s);
    driver.teleport(p.x, p.z, Math.atan2(p.tx, p.tz)); driver.vx = p.tx * 5; driver.vz = p.tz * 5;
    world.update(1 / 60, driver, f / 60);
  }
  assert.ok(result, 'The race finishes');
  assert.equal(result.place, 1, 'Quicker than the rivals, the player wins');
  assert.ok(result.won && result.reward === sprint.reward, 'A win pays the whole purse');
  world.abort();
  assert.equal(world.racing, false);
  // Sitting still in a pursuit gets you caught.
  const pursuit = races.find(r => r.kind === 'police');
  result = null;
  world.start(pursuit, driver, 1);
  for (let f = 0; f < 60 * 40 && !result; f++) { driver.update(1 / 60); world.update(1 / 60, driver, f / 60); }
  assert.ok(result && result.busted && !result.won && result.reward === 0, 'The police catch a car that does not run');
  world.abort();

  // The garage: a starting car, upgrades that make it faster, and dearer cars that are better.
  const garage = defaultGarage();
  assert.equal(garage.cars.length, 1);
  const stock = driveStats(garage.cars[0]);
  garage.cars[0].parts.engine = 3; garage.cars[0].parts.tyres = 2;
  const tuned = driveStats(garage.cars[0]);
  assert.ok(tuned.top > stock.top && tuned.grip > stock.grip, 'Upgrades improve the car');
  assert.ok(partCost('super', 0) > partCost('hatch', 0), 'Parts cost more on dearer cars');
  assert.ok(MODELS.super.top > MODELS.coupe.top && MODELS.coupe.top > MODELS.hatch.top, 'Dearer cars are faster');
});
const { VergeLayer, gardenTiles } = await import('../src/render/verges.ts');
test('empty cells between the houses and the roads are planted, and nothing is planted on a road', () => {
  const city = demoCity(true), net = Network.fromPlain(city.net), terrain = generateTerrain(city.seed), raster = rasterize(net);
  const tiles = gardenTiles(city.kind, city.level, raster, terrain, city.extras.terraform);
  assert.ok(tiles.length > 10, `The demo has leftover cells in town to plant: ${tiles.length}`);
  const layer = new VergeLayer();
  const t0 = performance.now();
  layer.rebuild(city.kind, city.level, raster, net, terrain, city.extras.terraform);
  const ms = performance.now() - t0;
  assert.ok(layer.group.children.length > 0, 'Gardens are built');
  assert.ok(ms < 1500, `Planting the town is quick enough to redo as it grows: ${ms.toFixed(0)} ms`);
  let onRoad = 0, points = 0;
  for (const mesh of layer.group.children) {
    const p = mesh.geometry.attributes.position.array;
    for (let k = 0; k < p.length; k += 27) { points++; if (net.onRoad(p[k] + 40, p[k + 2] + 40, -1, -0.02)) onRoad++; }
  }
  assert.ok(onRoad / points < 0.01, `Gardens stay off the roads: ${onRoad} of ${points} sampled points`);
  const again = layer.group.children.length;
  layer.rebuild(city.kind, city.level, raster, net, terrain, city.extras.terraform);
  assert.equal(layer.group.children.length, again, 'An unchanged town is not replanted');
});
const { ParkedCarLayer, PARK_INSET } = await import('../src/render/parkedCars.ts');
test('cars park along built streets, clear of traffic lanes, junctions and roundabouts', () => {
  const city = demoCity(), net = Network.fromPlain(city.net);
  const level = Uint8Array.from(city.level).map((l, i) => C.isZone(city.kind[i]) ? Math.max(l, 1) : l);
  const layer = new ParkedCarLayer();
  layer.rebuild(net, city.kind, level);
  const parked = [...layer.byTile.values()].flat();
  assert.ok(parked.length > 50, `Expected a street full of parked cars, got ${parked.length}`);
  // The outer traffic lane of a street runs 0.18 out and an avenue's 0.64: a parked car (0.15 wide)
  // must clear a moving one (0.17 wide) in it, and every junction.
  for (const p of parked) {
    const hit = net.nearestSeg(p.x + 40, p.z + 40, 2);
    assert.ok(hit, 'A parked car sits beside a street');
    const lane = hit.seg.kind === KIND_AVENUE ? 0.64 : 0.18;
    // A few thousandths of slack: on a curve the nearest point of the centre line sits a hair closer than the kerb offset.
    assert.ok(hit.dist - 0.075 >= lane + 0.085 - 5e-3, `Parked car ${hit.dist.toFixed(3)} from the centre of a ${ROAD_LABEL[hit.seg.kind]} blocks its lane (at ${(p.x + 40).toFixed(1)}, ${(p.z + 40).toFixed(1)})`);
    assert.ok(Math.abs(hit.dist - (HALF_WIDTH[hit.seg.kind] + PARK_INSET)) < 0.03, 'Parked at the kerb of its own street');
    assert.ok(!net.nodes.get(hit.seg.a).ring && !net.nodes.get(hit.seg.b).ring, 'Nobody parks on a roundabout');
    for (const node of [hit.seg.a, hit.seg.b]) {
      const n = net.nodes.get(node);
      const crossing = Math.max(...net.segsAt(node).map(o => HALF_WIDTH[o.kind]));
      if (net.degree(node) > 1) assert.ok(Math.hypot(p.x + 40 - n.x, p.z + 40 - n.z) > crossing + 0.2, 'Parked clear of the junction');
    }
  }
  const before = parked.length;
  layer.rebuild(net, city.kind, new Uint8Array(C.N_TILES));
  assert.equal([...layer.byTile.values()].flat().length, 0, 'Empty lots leave the kerb empty');
  layer.rebuild(net, city.kind, level);
  assert.equal([...layer.byTile.values()].flat().length, before, 'Each space keeps its car');
});
const E = await import('../src/sim/economy.ts');
const { Disasters } = await import('../src/sim/disasters.ts');
test('land value rewards parks, water and transit and punishes noise and rubbish', () => {
  const blank = () => new Float32Array(C.N_TILES);
  const coverage = Object.fromEntries(Object.keys(C.CIVIC_LABELS).map(k => [k, blank()]));
  const kind = new Uint8Array(C.N_TILES), level = new Uint8Array(C.N_TILES), water = new Uint8Array(C.N_TILES);
  for (let z = 0; z < C.GRID; z++) water[z * C.GRID + 5] = 1; // a river down column 5
  const extras = X.defaultExtras(10);
  const input = { kind, level, water, pollution: blank(), noise: blank(), crime: blank(), garbage: blank(), coverage, transit: blank(), extras };
  const dist = E.waterDistance(water);
  const base = E.landValueMap(input, dist);
  const at = (x, z) => z * C.GRID + x;
  assert.ok(base[at(7, 40)] > base[at(40, 40)] + 5, 'A river view is worth something');
  coverage.leisure.fill(1); input.transit.fill(1);
  const parks = E.landValueMap(input, dist);
  assert.ok(parks[at(40, 40)] > base[at(40, 40)] + 20, 'Parks and transit raise land value');
  input.noise.fill(80); input.garbage.fill(90);
  const loud = E.landValueMap(input, dist);
  assert.ok(loud[at(40, 40)] < parks[at(40, 40)] - 25, 'Noise and rubbish pull it down');
  extras.district.fill(1); extras.districtPolicies[0] = 1 << X.DISTRICT_POLICY_IDS.indexOf('green');
  assert.ok(E.landValueMap(input, dist)[at(40, 40)] > loud[at(40, 40)], 'A green district adds a premium');
});
test('goods flow from industry to shops, and the surplus is exported up to capacity', () => {
  const kind = new Uint8Array(C.N_TILES), level = new Uint8Array(C.N_TILES);
  for (let i = 0; i < 40; i++) { kind[i] = C.T_IND; level[i] = 2; }
  for (let i = 100; i < 110; i++) { kind[i] = C.T_COM; level[i] = 1; }
  const flow = E.goodsFlow(kind, level, 100, { entries: 1, railLines: 0, docks: 0, airports: 0 });
  assert.ok(flow.produced > flow.needed && flow.exported > 0 && flow.exportIncome > 0);
  assert.ok(flow.exported <= flow.exportCapacity);
  const closed = E.goodsFlow(kind, level, 100, { entries: 0, railLines: 0, docks: 0, airports: 0 });
  assert.equal(closed.exported, 0, 'With no way out of town nothing is exported');
  assert.ok(closed.unsold > 0);
  const shopsOnly = E.goodsFlow(new Uint8Array(C.N_TILES).map((_, i) => i < 30 ? C.T_COM : 0), new Uint8Array(C.N_TILES).map((_, i) => i < 30 ? 2 : 0), 500, { entries: 1, railLines: 0, docks: 0, airports: 0 });
  assert.ok(shopsOnly.importShare > 0.9, 'Shops with no industry import their stock');
});
test('floods spare what a barrier protects, and tornadoes damage what they cross', () => {
  const kind = new Uint8Array(C.N_TILES), level = new Uint8Array(C.N_TILES), water = new Uint8Array(C.N_TILES);
  for (let z = 0; z < C.GRID; z++) water[z * C.GRID + 40] = 1;
  for (let z = 0; z < C.GRID; z++) for (const x of [38, 39, 41, 42]) { kind[z * C.GRID + x] = C.T_RES; level[z * C.GRID + x] = 2; }
  const dist = E.waterDistance(water);
  const open = Disasters.floodZone(water, dist, kind);
  kind[10 * C.GRID + 41] = C.T_FLOOD_BARRIER;
  const guarded = Disasters.floodZone(water, dist, kind);
  assert.ok(open.length > guarded.length && !guarded.includes(12 * C.GRID + 41), 'A barrier keeps the water out nearby');
  const d = new Disasters();
  let damaged = 0, notices = 0, surge = 1;
  const ctx = { kind, level, water, riverDistance: dist, cityLevel: 3, enabled: true, rate: 1, random: C.mulberry32(5), damage: (t, n) => { level[t] = Math.max(0, level[t] - n); damaged++; }, notice: () => notices++, surge: f => { surge = f; } };
  d.start('flood', ctx);
  assert.equal(surge, 3, 'A flood is a surge down the river');
  for (let t = 0; t < 30; t++) d.step(ctx);
  assert.equal(surge, 3, 'which keeps coming');
  for (let t = 0; t < 50; t++) d.step(ctx);
  assert.ok(surge === 1 && d.active === null && notices >= 2, 'then the river returns to normal and the flood is over');
  // A tornado straight across the houses along the river.
  for (let z = 0; z < C.GRID; z++) for (const x of [38, 39, 41, 42]) level[z * C.GRID + x] = 2;
  const before = damaged;
  d.start('tornado', ctx);
  d.active.path = Array.from({ length: 25 }, (_, k) => ({ x: 40.5, z: k * 80 / 24 }));
  for (let t = 0; t < 40; t++) d.step(ctx);
  assert.ok(damaged > before + 10, 'The funnel wrecks what it passes over');
  ctx.enabled = false; d.cooldown = 0;
  for (let t = 0; t < 5000; t++) d.step(ctx);
  assert.equal(d.active, null, 'Switched off, nothing new starts');
});
test('districts, per-zone taxes and terraforming survive a save', () => {
  const city = demoCity(true);
  city.extras = X.defaultExtras(10);
  city.extras.taxes = [8, 14, 11, 16];
  city.extras.district.fill(3, 1000, 1400);
  city.extras.districtNames[2] = 'Harbour Heights';
  city.extras.districtPolicies[2] = 0b101;
  const t = generateTerrain(city.seed);
  const dry = [...Array(C.N_TILES).keys()].find(i => { const x = i % C.GRID, z = Math.floor(i / C.GRID); return x > 2 && z > 2 && !t.water[i] && !city.kind[i]; });
  city.extras.terraform[dry] = X.DUG;
  const back = decode(encode(city));
  assert.deepEqual(back.extras.taxes, [8, 14, 11, 16]);
  assert.equal(back.extras.district[1200], 3);
  assert.equal(back.extras.districtNames[2], 'Harbour Heights');
  assert.equal(back.extras.districtPolicies[2], 0b101);
  assert.equal(back.extras.terraform[dry], X.DUG);
  assert.equal(X.shapeTerrain(t, back.extras.terraform).water[dry], 1, 'Dug ground is water');
  // Any river tile can be filled or built up, dams included: the water then has to deal with it.
  const wet = [...Array(C.N_TILES).keys()].filter(i => t.water[i] && i % C.GRID > 0 && i % C.GRID < C.GRID - 1 && i >= C.GRID && i < C.N_TILES - C.GRID);
  const none = new Uint8Array(C.N_TILES);
  assert.ok(wet.every(i => X.terraformAllowed(t, none, i, 'raise') && X.terraformAllowed(t, none, i, 'flat') && X.terraformAllowed(t, none, i, 'lower')), 'Any river tile may be filled, flattened or deepened');
  assert.equal(X.elevationValue(t, wet[0], 0), X.FILLED, 'Raising the river once makes land of it');
  assert.equal(X.elevation(t, none, wet[0]), -1, 'The river bed is one storey down');
  const dam = none.slice();
  dam[wet[10]] = X.FILLED; dam[wet[11]] = X.HILL_BASE + 1;
  assert.equal(X.shapeTerrain(t, dam).water[wet[10]], 0, 'Filled river tiles are land');
  assert.equal(X.shapeTerrain(t, dam).water[wet[11]], 0, 'Raised river bed is land');
});
const landscapeForRiver = await import('../src/render/landscape.ts');
test('beyond the map the river falls into a gorge and runs on in a channel as deep as where it leaves', () => {
  const { landscapeHeight, riverSamples } = landscapeForRiver;
  const t = generateTerrain(214), samples = riverSamples(t), water = new W.WaterSim(t);
  const beyond = samples.filter(p => Math.max(Math.abs(p.x), Math.abs(p.z)) > C.GRID / 2 + 2);
  assert.ok(beyond.length > 50, 'The river carries on past the map edge');
  const floor = water.edgeGround().after;
  for (const p of beyond) {
    // Below the falls the whole channel sits the waterfall's height lower.
    const bed = landscapeHeight(p.x, p.z, t.seed, samples);
    assert.ok(Math.abs(bed - (floor + p.y)) < 0.3, `The channel beyond the map is as deep as the bed where the river leaves (${bed.toFixed(2)} vs ${(floor + p.y).toFixed(2)})`);
  }
  const pastEdge = samples.filter(p => Math.max(Math.abs(p.x), Math.abs(p.z)) > C.GRID / 2);
  assert.ok(pastEdge.at(-1).y < -2.5 && pastEdge.some(p => p.y > -0.5), 'The river drops over a waterfall a little way past the edge');
  // The water sits in it, above the channel floor, at the level it leaves the map.
  for (let s = 0; s < W.WATER_HZ * 30; s++) water.step();
  const exit = [...Array(C.N_TILES).keys()].filter(i => t.water[i]).sort((a, b) => t.flow[b] - t.flow[a])[0];
  assert.ok(water.surface(exit) > floor + 0.5, 'and the river leaves the map well above that floor');
});
test('water flows down the river, gathers behind a dam until it spills, and drains when the dam goes', () => {
  const t = generateTerrain(214);
  const water = new W.WaterSim(t);
  const wet = [...Array(C.N_TILES).keys()].filter(i => t.water[i]);
  const rise = i => water.surface(i) - water.normal[i];
  for (let s = 0; s < W.WATER_HZ * 60; s++) water.step();
  assert.ok(wet.every(i => Math.abs(rise(i)) < 0.15), 'Left alone the river holds its level along its whole length');
  assert.equal(water.floodedCount, 0, 'and stays inside its banks');
  // A dam right across the river a third of the way down.
  const mid = t.river.filter(p => p.x > 10 && p.z > 10 && p.x < C.GRID - 10 && p.z < C.GRID - 10)[Math.floor(t.river.length / 3)];
  const across = t.river[0].x === t.river[1].x ? 'x' : 'z';
  const col = Math.floor(across === 'x' ? mid.z : mid.x);
  const section = wet.filter(i => (across === 'x' ? Math.floor(i / C.GRID) : i % C.GRID) === col);
  const edits = new Uint8Array(C.N_TILES);
  for (const i of section) edits[i] = X.HILL_BASE + 2;
  water.reshape(edits);
  const up = wet.filter(i => t.flow[i] < t.flow[section[0]] - 4), down = wet.filter(i => t.flow[i] > t.flow[section[0]] + 4);
  const mean = a => a.reduce((sum, i) => sum + rise(i), 0) / a.length;
  for (let s = 0; s < W.WATER_HZ * 60; s++) water.step();
  const after1 = mean(up);
  assert.ok(after1 > 0.2, `A minute on, the water has gathered behind the dam (rose ${after1.toFixed(2)})`);
  assert.ok(mean(down) < 0, 'while the river below the dam has dropped');
  for (let s = 0; s < W.WATER_HZ * 240; s++) water.step();
  assert.ok(mean(up) > after1, 'and it keeps rising');
  assert.ok(water.floodedCount > 10, `until it spills over the banks onto the land (${water.floodedCount} cells under water)`);
  assert.ok(mean(down) < -0.15, `while the river below the dam drops, kept up only by what it gathers further down (${mean(down).toFixed(2)})`);
  const frame = water.frame();
  assert.ok(section.every(i => frame[i] !== frame[i]), 'The dam itself is dry');
  assert.ok(up.some(i => frame[i] - water.normal[i] > 0), 'The lake stands above the river as drawn');
  assert.ok(down.every(i => frame[i] - water.normal[i] < -0.05), 'and the drawn river below the dam sinks');
  water.reshape(new Uint8Array(C.N_TILES));
  for (let s = 0; s < W.WATER_HZ * 180; s++) water.step();
  assert.equal(water.floodedCount, 0, 'With the dam gone the floodwater drains away');
  assert.ok(Math.abs(mean(up)) < 0.15, 'and the river settles back to its level');
  // A storm upstream: three times the flow tops the low banks near the inlet, then recedes.
  water.surge = 3;
  for (let s = 0; s < W.WATER_HZ * 50; s++) water.step();
  assert.ok(water.floodedCount > 0, 'A surge floods the low ground');
  water.surge = 1;
  for (let s = 0; s < W.WATER_HZ * 120; s++) water.step();
  assert.equal(water.floodedCount, 0, 'and the flood goes down when it passes');
  // A basin dug away from the river fills from below into a lake.
  const basin = [];
  for (let z = 5; z < 9; z++) for (let x = 5; x < 9; x++) if (!t.water[z * C.GRID + x] && !t.shore[z * C.GRID + x]) basin.push(z * C.GRID + x);
  const dugEdits = new Uint8Array(C.N_TILES);
  for (const i of basin) dugEdits[i] = X.DUG;
  water.reshape(dugEdits);
  for (let s = 0; s < W.WATER_HZ * 90; s++) water.step();
  assert.ok(basin.every(i => Math.abs(water.surface(i) - W.WATER_TABLE) < 0.05), 'Dug ground fills to the water table');
  assert.ok(basin.every(i => water.frame()[i] === water.frame()[i]), 'and the lake is drawn');
  // A channel dug round the dam carries the river past it: the old bed below the dam runs dry no longer.
  const bypassEdits = new Uint8Array(C.N_TILES);
  for (const i of section) bypassEdits[i] = X.HILL_BASE + 2;
  const sideStep = across === 'x' ? 1 : C.GRID, alongStep = across === 'x' ? C.GRID : 1;
  const outermost = Math.max(...section.map(i => across === 'x' ? i % C.GRID : Math.floor(i / C.GRID)));
  const channel = [];
  for (let k = -4; k <= 4; k++) for (let w = 1; w <= 3; w++) {
    const i = section[0] + k * alongStep + (outermost - (across === 'x' ? section[0] % C.GRID : Math.floor(section[0] / C.GRID)) + w) * sideStep;
    if (i >= 0 && i < C.N_TILES && !t.water[i]) { bypassEdits[i] = X.DUG; channel.push(i); }
  }
  water.reshape(bypassEdits);
  for (let s = 0; s < W.WATER_HZ * 240; s++) water.step();
  assert.ok(channel.some(i => water.depth[i] > 0.5), 'The river runs into the channel dug beside the dam');
  assert.ok(mean(down) > -0.5, `and carries on below the dam through it (${mean(down).toFixed(2)})`);
  // A flood barrier lifts the ground it guards above the water.
  const kind = new Uint8Array(C.N_TILES);
  let guard = wet[Math.floor(wet.length / 2)];
  while (t.water[guard]) guard++;
  kind[guard] = C.T_FLOOD_BARRIER;
  water.reshape(new Uint8Array(C.N_TILES), kind);
  assert.ok(Math.abs(water.ground[guard + 1] - W.BARRIER_HEIGHT) < 1e-5, 'The bank behind a barrier stands higher');
  assert.ok(water.ground[guard - 1] < 0, 'but the river beside it keeps its bed');
});
test('per-zone taxes, district policies and freight run in the simulation', () => {
  const city = demoCity(true);
  city.extras = X.defaultExtras(10);
  load(city); send({ type: 'warm', ticks: 20 });
  const base = latest().stats;
  assert.ok(base.goods.produced > 0 && base.landValue > 0 && base.tourism.visitors > 0, 'Goods, land value and tourism are measured');
  send({ type: 'taxes', taxes: [10, 10, 25, 10] });
  const taxed = latest().stats;
  assert.ok(taxed.demand[2] < base.demand[2], 'A high industrial tax cuts industrial demand only');
  assert.ok(Math.abs(taxed.demand[0] - base.demand[0]) < 0.05);
  city.extras.district.fill(1);
  city.extras.districtPolicies[0] = 1 << X.DISTRICT_POLICY_IDS.indexOf('highriseBan');
  load(city); send({ type: 'warm', ticks: 5 });
  assert.ok(latest().stats.districtExpense > 0, 'District policies are paid for');
  send({ type: 'speed', value: 1 });
  let trucks = 0, garbage = 0;
  for (let f = 0; f < 90 * C.SIM_HZ; f++) {
    simulateFrame();
    if (messages.length > 60) messages.splice(0, messages.length - 20);
    const frame = messages.findLast(m => m.type === 'frame');
    if (frame) for (let i = 0; i < C.MAX_CARS; i++) if ([2, 3].includes(Math.round(frame.cars[i * 4 + 3]))) trucks++;
    garbage = Math.max(garbage, latest().stats.garbageTrucks);
  }
  send({ type: 'speed', value: 0 });
  assert.ok(trucks > 0, 'Freight vans and trucks are on the road');
  assert.ok(garbage > 0, 'Recycling centres send garbage trucks out');
  const s = latest().stats;
  assert.ok(Number.isFinite(s.income) && s.garbage < 60, `Rubbish stays under control with collection (${s.garbage}%)`);
  console.log(`  Economy: ${s.goods.produced} goods made, ${s.goods.exported} exported for $${s.goods.income.toFixed(2)}/s, ${s.tourism.visitors} visitors for $${s.tourism.income.toFixed(2)}/s, land value ${s.landValue}, net $${s.income.toFixed(2)}/s`);
});
const { StreetlightLayer } = await import('../src/render/streetlights.ts');
const { StreetFurnitureLayer } = await import('../src/render/streetFurniture.ts');
test('nothing stands on the carriageway: lamps, signals, stop signs, furniture, parked cars and highway signs keep to the verge', () => {
  // Every roadside object, on a busy demo city with signals and stops added, and on a fresh map with its motorway.
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  const offenders = [];
  const check = (what, net, x, z, tolerance = 0) => {
    for (const seg of net.segs.values()) {
      if (seg.structure === 2) continue;
      const d = Network.nearestOn(seg, x + 40, z + 40).dist;
      if (d < HALF_WIDTH[seg.kind] - tolerance) { offenders.push(`${what} at ${x.toFixed(1)},${z.toFixed(1)} is ${d.toFixed(2)} from a ${ROAD_LABEL[seg.kind]} centre line`); return; }
    }
  };
  const instances = (what, net, mesh, tolerance) => { for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m); check(what, net, p.x, p.z, tolerance); } };
  for (const city of [demoCity(true), newCity(9)]) {
    const net = Network.fromPlain(city.net); ensureApproaches(net);
    // Signals and all-way stops at every junction of three or more arms, to place their poles.
    let k = 0;
    for (const n of net.nodes.values()) if (net.degree(n.id) >= 3 && !n.ring) { if (k++ % 2) n.light = true; else n.stop = true; }
    net.version++;
    const terrain = generateTerrain(city.seed), raster = rasterize(net);
    const roads = new RoadLayer(); roads.rebuild(net, terrain);
    instances('signal pole', net, roads.poles);
    instances('stop sign', net, roads.stopSigns);
    for (const sign of roads.signs) if (sign.visible) check('highway sign', net, sign.position.x, sign.position.z, -0.6);
    const lamps = new StreetlightLayer(); lamps.rebuild(net);
    instances('street lamp', net, lamps.poles);
    const furniture = new StreetFurnitureLayer(); furniture.rebuild(net, city.kind, raster);
    for (const mesh of furniture.meshes) instances('street furniture', net, mesh);
    const level = Uint8Array.from(city.level).map((l, i) => C.isZone(city.kind[i]) ? Math.max(l, 1) : l);
    const parked = new ParkedCarLayer(); parked.rebuild(net, city.kind, level);
    // A parked car sits half on the kerb, so its centre is allowed inside the paved width by that much.
    for (const mesh of parked.meshes) instances('parked car', net, mesh, PARK_INSET + 0.08);
  }
  assert.deepEqual(offenders.slice(0, 8), [], `${offenders.length} objects stand on a road`);
});

test('streetlights never stand on another road where two roads meet at a shallow angle', () => {
  const net = new Network();
  net.insertPath([{ x: 10.5, z: 40.5 }, { x: 60.5, z: 40.5 }], KIND_ROAD);
  // A second road peeling off at a shallow angle, like a slip road.
  net.insertPath([{ x: 20.5, z: 40.5 }, { x: 60.5, z: 44.5 }], KIND_ROAD);
  const layer = new StreetlightLayer();
  layer.rebuild(net);
  const poles = layer.poles, m = new THREE.Matrix4(), p = new THREE.Vector3();
  assert.ok(poles.count > 4, 'Both roads are lit');
  for (let i = 0; i < poles.count; i++) {
    poles.getMatrixAt(i, m); p.setFromMatrixPosition(m);
    for (const seg of net.segs.values()) {
      const d = Network.nearestOn(seg, p.x + 40, p.z + 40).dist;
      assert.ok(d >= HALF_WIDTH[seg.kind] - 1e-6, `A lamp stands on the asphalt, ${d.toFixed(2)} from a road centre`);
    }
  }
});
const { daylight, DAY_SECONDS } = await import('../src/render/daylight.ts');
const { LandscapeLayer, riverSamples, landscapeHeight } = await import('../src/render/landscape.ts');
const { RiverLayer } = await import('../src/render/river.ts');
test('daylight repeats across saved days and transitions continuously through dawn and dusk', () => {
  assert.equal(daylight(0).hour, 9);
  assert.equal(daylight(300).hour, 0);
  assert.equal(daylight(300).night, 1);
  assert.equal(daylight(60).day, 1);
  for (let time = 0; time < DAY_SECONDS; time++) {
    assert.ok(Math.abs(daylight(time).hour - daylight(time + DAY_SECONDS * 10).hour) < 1e-9);
    assert.ok(Math.abs(daylight(time).day - daylight(time + 1).day) < 0.06);
  }
  const city = demoCity(); city.tick = 321;
  assert.deepEqual(daylight(decode(encode(city)).tick), daylight(city.tick));
});
test('forests clear roads, occupied lots and full service footprints, then restore deterministically', () => {
  const city = demoCity(true), t = generateTerrain(city.seed), net = Network.fromPlain(city.net), raster = rasterize(net);
  const landscape = new LandscapeLayer(); landscape.rebuild(t); landscape.develop(city.kind, raster, net);
  const owners = siteOwners(city.kind), trunks = landscape.group.children[1], matrix = new THREE.Matrix4();
  assert.ok(trunks.count > 100);
  const before = trunks.instanceMatrix.array.slice(); const count = trunks.count;
  for (let n = 0; n < trunks.count; n++) {
    trunks.getMatrixAt(n, matrix);
    const x = Math.floor(matrix.elements[12] + 40), z = Math.floor(matrix.elements[14] + 40);
    if (x < 0 || x >= 80 || z < 0 || z >= 80) continue;
    const i = z * 80 + x;
    assert.equal(city.kind[i], 0); assert.equal(raster.cover[i], 0); assert.equal(owners[i], -1); assert.equal(t.water[i], 0);
  }
  landscape.develop(new Uint8Array(6400).fill(C.T_RES), raster, net);
  assert.ok(trunks.count < count);
  landscape.develop(city.kind, raster, net);
  assert.equal(trunks.count, count); assert.deepEqual(trunks.instanceMatrix.array.slice(0, count * 16), before.slice(0, count * 16));
});

const { structurePlan, roadHeight, BRIDGE_RISE, TUNNEL_DROP } = await import('../src/roads/structures.ts');
const { StructureLayer } = await import('../src/render/structures.ts');
test('bridge and tunnel spans cross surface roads without junctions and survive saves', () => {
  const current = Buffer.from(encode(demoCity()), 'base64url');
  // Versions before 9 carry no policy mask, rotation block, park paths or extras: drop them all.
  const legacy = Buffer.concat([current.subarray(0, 28), current.subarray(30, current.length - 4 - extrasLength(demoCity()))]); legacy[0] = 6;
  assert.ok(decode(legacy.toString('base64url')), 'Version 6 cities remain readable');
  const net = new Network();
  net.insertPath([{ x: 30, z: 10 }, { x: 30, z: 65 }], 0);
  net.insertPath([{ x: 10, z: 30 }, { x: 60, z: 30 }], 0, false, 1);
  net.insertPath([{ x: 10, z: 50 }, { x: 60, z: 50 }], 1, true, 2);
  assert.equal(net.segs.size, 3); assert.equal(net.nodes.size, 6);
  assert.equal(net.nearestNode(30, 30, 0.1), null);
  net.insertPath([{ x: 40, z: 20 }, { x: 40, z: 60 }], 0);
  assert.equal(net.segs.size, 4);
  const city = demoCity(); city.net = net.toPlain();
  const saved = Network.fromPlain(decode(encode(city)).net);
  assert.deepEqual([...saved.segs.values()].map(s => [s.kind, s.oneway, s.structure]), [...net.segs.values()].map(s => [s.kind, s.oneway, s.structure]));
  const bridge = [...net.segs.values()].find(s => s.structure === 1);
  assert.throws(() => net.splitSeg(bridge.id, 0.5), /ends/);
  assert.equal(roadHeight(bridge, 0), 0); assert.equal(roadHeight(bridge, bridge.len), 0); assert.equal(roadHeight(bridge, 20), BRIDGE_RISE);
  assert.equal(roadHeight({ structure: 2, len: 30 }, 15), -TUNNEL_DROP);
  // A short span still climbs to full height in the middle, and an eight-cell one is allowed.
  assert.equal(roadHeight({ structure: 1, len: 8 }, 4), BRIDGE_RISE);
  assert.ok(structurePlan(new Network(), { ...generateTerrain(1), water: new Uint8Array(C.N_TILES) }, new Uint8Array(C.N_TILES), [{ x: 10, z: 20 }, { x: 18, z: 20 }], 0, 1) instanceof Network, 'An eight-cell bridge is enough');
});
test('structure planning rejects short spans, occupied approaches and ramp-level road collisions', () => {
  const net = new Network(), kind = new Uint8Array(C.N_TILES), terrain = generateTerrain(1);
  terrain.water.fill(0);
  assert.match(structurePlan(net, terrain, kind, [{ x: 10, z: 20 }, { x: 15, z: 20 }], 0, 1), /8 cells/);
  const points = [{ x: 10, z: 20 }, { x: 50, z: 20 }];
  net.insertPath([{ x: 30, z: 5 }, { x: 30, z: 40 }], 0);
  assert.ok(structurePlan(net, terrain, kind, points, 0, 1) instanceof Network);
  const before = net.toPlain();
  net.insertPath([{ x: 12, z: 5 }, { x: 12, z: 40 }], 0);
  assert.match(structurePlan(net, terrain, kind, points, 0, 1), /clearance/);
  kind[C.idx(10, 20)] = C.T_RES;
  assert.match(structurePlan(Network.fromPlain(before), terrain, kind, points, 0, 2), /Clear/);
  assert.deepEqual(Network.fromPlain(before).toPlain(), before);
});
test('bridges reserve their corridor while tunnel interiors leave buildable surface land', () => {
  const net = new Network();
  net.insertPath([{ x: 10, z: 20 }, { x: 50, z: 20 }], 0, false, 1);
  net.insertPath([{ x: 10, z: 40 }, { x: 50, z: 40 }], 0, false, 2);
  const raster = rasterize(net);
  assert.equal(raster.cover[C.idx(30, 20)], 1);
  assert.equal(raster.cover[C.idx(30, 40)], 0);
  assert.equal(raster.cover[C.idx(10, 40)], 1);
  assert.equal(raster.accSeg[C.idx(30, 21)], -1);
  assert.equal(raster.accSeg[C.idx(30, 41)], -1);
  const structures = new StructureLayer(), roads = new RoadLayer();
  structures.rebuild(net); roads.rebuild(net, generateTerrain(1));
  assert.ok(roads.mesh.geometry.getAttribute('position').array.some((v, i) => i % 3 === 1 && v > BRIDGE_RISE - 0.1));
  structures.group.traverse(mesh => { if (mesh.geometry?.getAttribute('position')) for (const v of mesh.geometry.getAttribute('position').array) assert.ok(Number.isFinite(v)); });
});
test('vehicle reservations separate overpasses and tunnels but still block traffic on the same deck', () => {
  const space = new TrafficSpace();
  space.set(1, { x: 10, z: 10, y: 0, angle: 0, type: 1 });
  assert.equal(space.free({ x: 10, z: 10, y: BRIDGE_RISE, angle: 0, type: 1 }), true);
  assert.equal(space.free({ x: 10, z: 10, y: -2.4, angle: 0, type: 1 }), true);
  assert.equal(space.free({ x: 10, z: 10, y: 0.1, angle: 0, type: 1 }), false);
  space.set(2, { x: 10, z: 10, y: BRIDGE_RISE, angle: 0, type: 1 });
  assert.equal(space.free({ x: 10, z: 10, y: BRIDGE_RISE, angle: 0, type: 1 }), false);
});
test('worker routes traffic across bridges and through tunnels and publishes its actual height', () => {
  const city = demoCity(); city.kind.fill(0); city.level.fill(0); city.cityLevel = 0;
  const net = new Network();
  const a = net.addNode(4, 20), b = net.addNode(25, 20), c = net.addNode(50, 20), d = net.addNode(75, 20);
  a.entry = true;
  for (let x = 58; x < 67; x++) { city.kind[C.idx(x, 21)] = C.T_IND; city.level[C.idx(x, 21)] = 3; }
  net.addSeg(a.id, b.id, 14.5, 20, 0, false, false, 0.4, 1);
  net.addSeg(b.id, c.id, 37.5, 20, 0, false, false, 0.4, 2);
  net.addSeg(c.id, d.id, 62.5, 20, 0);
  city.net = net.toPlain(); load(city); send({ type: 'speed', value: 1 }); Math.random = C.mulberry32(888);
  let bridgeSeen = false, tunnelSeen = false;
  for (let i = 0; i < 70 * C.SIM_HZ; i++) {
    simulateFrame(); const frame = messages.at(-1);
    if (frame.type === 'frame') for (let n = 0; n < C.MAX_CARS; n++) if (frame.cars[n * 4 + 3]) {
      assert.ok(Number.isFinite(frame.carHeights[n]));
      bridgeSeen ||= frame.carHeights[n] > BRIDGE_RISE - 0.2; tunnelSeen ||= frame.carHeights[n] < -1.5;
    }
    if (messages.length > 100) messages.splice(0, messages.length - 20);
  }
  assert.ok(bridgeSeen); assert.ok(tunnelSeen);
});

test('flooded roundabouts keep circulating: no gridlock on or at the ring', () => {
  for (const kind of [0, 1]) {
    Math.random = C.mulberry32(6 + kind);
    const city = demoCity(); city.kind.fill(0); city.level.fill(0); city.cityLevel = 1;
    const net = new Network(), cx = 40, cz = 40;
    net.insertPath([{ x: 8, z: cz }, { x: 72, z: cz }], kind);
    net.insertPath([{ x: cx, z: 8 }, { x: cx, z: 72 }], kind);
    assert.ok(net.addRoundabout(cx, cz, 2.3, kind));
    // An avenue ring is wider than a road one, so judge each by its own circle.
    const ring = net.roundabouts()[0].r;
    [...net.nodes.values()].find(n => n.x === 8).entry = true;
    const r = rasterize(net), ground = generateTerrain(city.seed);
    // Homes on two arms and jobs on the other two, so most commutes cross the ring; nothing in the river.
    for (let i = 0; i < C.N_TILES; i++) {
      if (r.cover[i] || r.accSeg[i] < 0 || ground.water[i] || ground.shore[i]) continue;
      const x = i % C.GRID, z = (i / C.GRID) | 0;
      if (Math.hypot(x - cx, z - cz) < ring + 2.7) continue;
      city.kind[i] = x < cx - 3 || z < cz - 3 ? C.T_RES : (x + z) % 2 ? C.T_COM : C.T_IND; city.level[i] = 2;
    }
    city.net = net.toPlain();
    send({ type: 'load', ...city, serial: 1, cover: r.cover, accSeg: r.accSeg, accS: r.accS }); send({ type: 'speed', value: 1 });
    const still = new Map(), passed = new Set(), late = new Set();
    let maxStill = 0, peak = 0, crashUntil = -1, stuckAt = '';
    for (let tick = 0; tick < 240 * C.SIM_HZ; tick++) {
      simulateFrame();
      for (const m of messages) if (m.type === 'state' && m.stats.incidents.crashes > 0) crashUntil = tick + 2 * C.SIM_HZ;
      const f = messages.at(-1);
      if (f.type === 'frame') {
        let onRing = 0;
        for (let n = 0; n < C.MAX_CARS; n++) {
          if (!f.cars[n * 4 + 3]) continue;
          const id = f.carIds[n], x = f.cars[n * 4] + C.GRID / 2, z = f.cars[n * 4 + 1] + C.GRID / 2, prev = still.get(id);
          const near = Math.hypot(x - cx, z - cz) < ring + 0.8;
          if (near) { onRing++; passed.add(id); if (tick > 180 * C.SIM_HZ) late.add(id); }
          // A random collision legitimately blocks a lane for a while; only judge the junction outside those windows.
          if (!prev || tick < crashUntil || Math.hypot(prev.x - x, prev.z - z) > 0.01) still.set(id, { x, z, tick });
          else if (Math.hypot(x - cx, z - cz) < ring + 3.7) { const wait = (tick - prev.tick) / C.SIM_HZ; if (wait > maxStill) { maxStill = wait; stuckAt = `${x.toFixed(1)},${z.toFixed(1)} type ${f.cars[n * 4 + 3]} from tick ${prev.tick}`; } }
        }
        peak = Math.max(peak, onRing);
      }
      messages.length = 0;
    }
    console.log(`  ${kind ? 'Avenue' : 'Road'} roundabout: ${passed.size} vehicles through, ${late.size} in the last minute, peak ${peak} on the ring, longest wait ${maxStill.toFixed(1)}s`);
    assert.ok(maxStill < 15, `A vehicle sat still at the roundabout for ${maxStill.toFixed(1)}s (at ${stuckAt})`);
    assert.ok(late.size >= 20, 'Traffic still flows through the ring at the end of the run');
    assert.ok(peak >= 8, 'The ring should actually be flooded');
  }
  Math.random = C.mulberry32(123);
});

Math.random = originalRandom;
console.log(`${checks} checks passed`);
