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
const { advanceCity, levelForPopulation, MILESTONES } = await import('../src/progression.ts');
const { civicCoverage } = await import('../src/sim/civic.ts');
const { encode, decode } = await import('../src/save.ts');
const { buildingGeometry } = await import('../src/render/buildingGeo.ts');
const { demoCity } = await import('../src/demo.ts');
const { Network, HALF_WIDTH } = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { defaultFunding, LOAN_TOTAL, LOAN_AMOUNT, NEGLECT_LIMIT } = await import('../src/management.ts');
const { gridPoint, roadPoint, buildingRotation } = await import('../src/placement.ts');
const { generateTerrain, reachableLand, entryTile, MAP_TYPES } = await import('../src/terrain.ts');
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }

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
  bytes[29] = 0; // a zero run length in the first RLE triple
  assert.equal(decode(bytes.toString('base64url')), null);
});
test('each new service has finite nonempty visible geometry', () => {
  for (let k = 11; k <= 18; k++) {
    const geo = buildingGeometry(k, 1, 0);
    assert.ok(geo.attributes.position.count > 30);
    assert.ok([...geo.attributes.position.array].every(Number.isFinite));
    geo.computeBoundingBox(); assert.ok(geo.boundingBox.max.y > 0.15);
    geo.dispose();
  }
});
// Run the real worker with a controlled clock and deterministic randomness.
const messages = [];
globalThis.self = { postMessage: m => messages.push(m) };
const originalInterval = globalThis.setInterval;
let simulateFrame;
globalThis.setInterval = callback => { simulateFrame = callback; return 0; };
await import('../src/sim/worker.ts');
globalThis.setInterval = originalInterval;
const originalRandom = Math.random;
Math.random = C.mulberry32(2026);
const send = data => self.onmessage({ data });
const latest = () => messages.filter(m => m.type === 'state').at(-1);
function load(city) {
  const net = Network.fromPlain(city.net), raster = rasterize(net);
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

test('river valleys never move: the same maps as before map types existed', () => {
  // Recorded before `generateTerrain` grew a type argument. The demo city and saved cities depend on it.
  const golden = '69b03eec a72d6265 69020fd6 bb0fdf3a 623474d1 2041838b b6f8bdee 506f4201 17e74ff3 52defdfe 51f43905 6547e6b3 841a48e0 f20a9953 af8ce1da f8f1ec87 85d4d797 7aa0bc57 c7dfaf0c 2d5956db aacd8a34 d8e45250 90bb1bc6 16506900 e3c5ff2b bd562806 7b44873a 414bdc04 7126d800 291d5de7';
  const digests = [];
  for (let seed = 1; seed <= 30; seed++) {
    const plain = generateTerrain(seed), named = generateTerrain(seed, 'river');
    assert.equal(plain.type, 'river', 'The default map type is the river valley');
    assert.deepEqual(named.water, plain.water);
    assert.deepEqual(named.flow, plain.flow);
    assert.deepEqual(named.river, plain.river);
    assert.deepEqual(named.entry, plain.entry);
    digests.push(terrainDigest(plain));
  }
  assert.equal(digests.join(' '), golden, 'River valley maps must stay byte for byte what they were');
});
test('every map type is playable: dry entry, room to build and one region behind it', () => {
  assert.deepEqual(MAP_TYPES.map(m => m.id), ['river', 'islands', 'seaport', 'lakes']);
  for (const { id, name, blurb } of MAP_TYPES) {
    assert.ok(name.length > 3 && name.length < 24, name);
    assert.ok(blurb.length > 10, blurb);
    let worstDry = 1, worstReach = 1;
    for (let seed = 1; seed <= 24; seed++) {
      const t = generateTerrain(seed, id), where = `${id} seed ${seed}`;
      assert.equal(t.type, id, where);
      // The entry sits on an edge, in a tile lane, facing inward.
      assert.ok(Math.abs(t.entry.dx) + Math.abs(t.entry.dz) === 1, where);
      assert.ok([0, C.GRID].includes(t.entry.dx ? t.entry.x : t.entry.z), where);
      assert.ok(Number.isInteger((t.entry.dx ? t.entry.z : t.entry.x) - 0.5), where);
      // ...with a clear run of dry tiles, three lanes wide, for the highway stub.
      for (let s = 0; s < 7; s++) for (let o = -1; o <= 1; o++) {
        const x = Math.floor(t.entry.x + t.entry.dx * (s + 0.5) + (t.entry.dx ? 0 : o));
        const z = Math.floor(t.entry.z + t.entry.dz * (s + 0.5) + (t.entry.dz ? 0 : o));
        assert.equal(t.water[C.idx(x, z)], 0, `${where}: the highway approach runs through water at ${x},${z}`);
      }
      const dry = (C.N_TILES - t.water.reduce((n, v) => n + v, 0)) / C.N_TILES;
      const home = entryTile(t.entry);
      const { mask, count } = reachableLand(t);
      assert.equal(t.water[home], 0, `${where}: the entry tile is under water`);
      assert.ok(mask[home], where);
      assert.ok(dry >= 0.45, `${where}: only ${(dry * 100) | 0}% of the map is dry`);
      assert.ok(count >= 0.4 * C.N_TILES, `${where}: only ${((count / C.N_TILES) * 100) | 0}% of the map is reachable`);
      // Land the player cannot reach is either scenery or the far bank of the channel, never a marooned town.
      const { label, sizes } = landPatches(t.water);
      let scenery = 0;
      for (let c = 0; c < sizes.length; c++) {
        if (c === label[home]) continue;
        assert.ok(sizes[c] < 200 || sizes[c] > 0.15 * C.N_TILES, `${where}: ${sizes[c]} tiles of land stranded`);
        if (sizes[c] < 200) scenery += sizes[c];
      }
      assert.ok(scenery <= 400, `${where}: ${scenery} tiles of islet clutter`);
      worstDry = Math.min(worstDry, dry); worstReach = Math.min(worstReach, count / C.N_TILES);
    }
    console.log(`  ${name}: at worst ${(worstDry * 100) | 0}% dry, ${(worstReach * 100) | 0}% reachable from the entry`);
  }
});
test('maps are deterministic from seed and type alone, and each type is its own map', () => {
  for (const { id } of MAP_TYPES) {
    for (const seed of [1, 7, 4242]) {
      const a = generateTerrain(seed, id), b = generateTerrain(seed, id);
      assert.deepEqual(a.water, b.water); assert.deepEqual(a.flow, b.flow);
      assert.deepEqual(a.river, b.river); assert.deepEqual(a.entry, b.entry);
      assert.equal(a.seed, seed);
      const other = generateTerrain(seed + 1, id);
      assert.notDeepEqual(other.water, a.water, 'Neighboring seeds give unrelated maps');
    }
  }
  const sameSeed = MAP_TYPES.map(m => terrainDigest(generateTerrain(9, m.id)));
  assert.equal(new Set(sameSeed).size, MAP_TYPES.length, 'One seed gives four different maps');
});
test('every map type keeps an ordered flow channel that all its water drains into', () => {
  for (const { id } of MAP_TYPES) {
    for (let seed = 1; seed <= 12; seed++) {
      const t = generateTerrain(seed, id), where = `${id} seed ${seed}`;
      assert.ok(t.river.length > 20, where);
      for (let i = 1; i < t.river.length; i++) {
        const a = t.river[i - 1], b = t.river[i], step = Math.hypot(a.x - b.x, a.z - b.z);
        assert.ok(step > 1e-6 && step < 4, `${where}: channel samples jump ${step}`);
        assert.ok(b.w > 0.5 && Number.isFinite(b.x) && Number.isFinite(b.z), where);
      }
      let channel = 0;
      for (let i = 0; i < C.N_TILES; i++) {
        if (!t.water[i]) { assert.equal(t.flow[i], -1, `${where}: dry tile ${i} has a flow index`); continue; }
        // Sewage has to reach the sea: open water carries the index of the channel sample it drains to.
        assert.ok(t.flow[i] >= 0 && t.flow[i] < t.river.length, `${where}: water tile ${i} has no flow`);
        channel++;
      }
      assert.ok(channel > 100, where);
    }
  }
});
const { BuildingLayer } = await import('../src/render/buildings.ts');
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

const { transitNetwork, transitLineForTrip } = await import('../src/sim/transit.ts');
const { footprint, siteOwners } = await import('../src/sites.ts');
const { entrancePlan } = await import('../src/roads/entries.ts');
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
test('additional entries persist and reach disconnected neighborhoods', () => {
  const city = demoCity(), net = Network.fromPlain(city.net), terrain = generateTerrain(city.seed);
  let planned;
  for (const [x, z] of [[79, 10], [79, 65], [10, 79], [65, 1]]) {
    const result = entrancePlan(net, terrain, city.kind, x, z);
    if (typeof result !== 'string') { planned = result; break; }
  }
  assert.ok(planned);
  assert.equal([...net.nodes.values()].filter(n => n.entry).length, 1, 'Original network is unchanged');
  assert.equal([...planned.nodes.values()].filter(n => n.entry).length, 2);
  assert.equal(typeof entrancePlan(net, terrain, city.kind, 40, 40), 'string');
  const r = rasterize(planned);
  const newNode = [...planned.nodes.values()].filter(n => n.entry).at(-1);
  const newSeg = planned.segsAt(newNode.id)[0];
  const tile = Array.from(r.accSeg).findIndex((id, i) => id === newSeg.id && !r.cover[i] && !terrain.water[i]);
  assert.ok(tile >= 0); city.kind[tile] = C.T_RES; city.level[tile] = 1; city.net = planned.toPlain();
  const restored = decode(encode(city)); load(restored);
  assert.equal(latest().stats.entries, 2);
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
  const station = city.kind.findIndex(k => k === C.T_STATION); city.kind[station] = 0; city.level[station] = 0;
  load(city); assert.equal(latest().stats.transport.railLines, 0);
  for (let i = 0; i < C.N_TILES; i++) if (C.SERVICES[city.kind[i]]?.power) city.kind[i] = 0;
  load(city);
  assert.equal(latest().stats.transport.busLines, 0);
  assert.equal(latest().stats.transport.airports, 0);
});
const { Input } = await import('../src/input.ts');
const { Game } = await import('../src/game.ts');
test('transport placement enforces unlocks and clearing a site removes its whole reservation', () => {
  const input = Object.create(Input.prototype);
  input.game = { stats: { cityLevel: 0 } };
  for (const k of [C.T_BUS, C.T_STATION, C.T_AIRPORT, C.T_TREATMENT]) assert.match(input.serviceProblem(100, k), /Unlocks at/);
  const game = Object.create(Game.prototype);
  game.kind = new Uint8Array(C.N_TILES); game.level = new Uint8Array(C.N_TILES);
  const tile = C.idx(10, 10); game.kind[tile] = C.T_AIRPORT; game.level[tile] = 1;
  game.owners = siteOwners(game.kind); game.pendingSpent = 0;
  assert.equal(game.setKind(tile + C.GRID + 3, C.T_EMPTY, 0), true);
  assert.equal(game.kind[tile], C.T_EMPTY);
  assert.ok(footprint(tile, C.T_AIRPORT).every(t => game.owners[t] === -1));
});

const { TrafficSpace, vehiclesOverlap } = await import('../src/sim/trafficSpace.ts');
const { Incidents } = await import('../src/sim/incidents.ts');
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
  const tail = new TextEncoder().encode(JSON.stringify({ fires: [], crime: [], patrol: [] })).length + 4;
  const v5 = bytes.subarray(0, bytes.length - tail); v5[0] = 5;
  const migrated = decode(v5.toString('base64url')); assert.ok(migrated); assert.equal(migrated.incidents, undefined);
  city.incidents.fires[0].age = 120; assert.equal(decode(encode(city)), null);
});
test('patrol visits prevent crime and unattended fires damage buildings', () => {
  const events = new Incidents(), kind = new Uint8Array(C.N_TILES), level = new Uint8Array(C.N_TILES), tile = C.idx(20, 20);
  kind[tile] = C.T_RES; level[tile] = 2; events.visit(tile);
  // Fire roll fails, crime roll succeeds, then choose the only home and prevent the crime.
  const rolls = [1, 0, 0, 0]; let n = 0;
  events.step(kind, level, 400, 2, () => rolls[n++], () => {});
  assert.equal(events.prevented, 1); assert.equal(events.crime[tile], 0);
  events.ignite(tile); let damaged = false;
  for (let i = 0; i < 120; i++) events.step(kind, level, 0, 0, () => 1, () => { damaged = true; });
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
        const p = { x: frame.cars[o], z: frame.cars[o + 1], angle: frame.cars[o + 2], type };
        // Float32 frames lose a few ulps; test actual bodies rather than the safety buffer.
        for (const other of space.poses.values()) if (Math.abs(p.x - other.x) < 1 && Math.abs(p.z - other.z) < 1) assert.equal(vehiclesOverlap(p, other, 0), false, 'Vehicle bodies intersect');
        space.set(i, p);
      }
    }
    if (frame.type === 'frame' && previousFrame && tick % 30 === 0) for (const alpha of [0.25, 0.5, 0.75]) {
      const poses = [];
      for (let i = 0; i < C.MAX_CARS; i++) {
        const o = i * 4, type = frame.cars[o + 3]; if (!type) continue;
        const p = { x: frame.cars[o], z: frame.cars[o + 1], angle: frame.cars[o + 2], type };
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
test('landscape preserves the construction plane and river path, with elevated upstream cascades', () => {
  for (const seed of [1, 42, 777]) {
    const t = generateTerrain(seed), samples = riverSamples(t);
    for (let i = 0; i < t.river.length; i++) {
      const p = t.river[i], sample = samples[110 + i];
      assert.deepEqual(sample, { ...p, x: p.x - 40, z: p.z - 40, y: 0 });
    }
    for (let z = -40; z <= 40; z += 4) for (let x = -40; x <= 40; x += 4) assert.equal(landscapeHeight(x, z, seed, samples), 0);
    assert.equal(samples[98].y, 4); assert.equal(samples[100].y, 0);
    assert.ok(landscapeHeight(90, 90, seed, samples) > 0);
    const river = new RiverLayer(); river.rebuild(t); river.tint(new Uint8Array(t.river.length).fill(255)); river.update(100);
    for (const mesh of river.group.children) {
      for (const value of mesh.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value));
    }
  }
});
const { WaterLayer, signedWaterField, BEACH_Y, WATER_Y } = await import('../src/render/water.ts');
test('open water merges into few quads, holds the shoreline on tile edges and reaches the horizon only at sea', () => {
  const fake = (fill, river = []) => {
    const water = new Uint8Array(C.N_TILES);
    for (let z = 0; z < C.GRID; z++) for (let x = 0; x < C.GRID; x++) if (fill(x, z)) water[C.idx(x, z)] = 1;
    return { seed: 7, water, flow: new Int16Array(C.N_TILES).fill(-1), river, entry: { x: 0, z: 40, dx: 1, dz: 0 } };
  };
  const maps = {
    // A coastal half, inland lakes, a shredded archipelago, and a map with no water at all.
    sea: fake((x, z) => z < C.GRID / 2),
    lakes: fake((x, z) => [[20, 20, 9], [55, 30, 12]].some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)),
    islands: fake((x, z) => Math.sin(x * 0.19) * Math.cos(z * 0.23) + Math.sin((x + z) * 0.11) < 0.15),
    dry: fake(() => false),
  };
  for (const [name, t] of Object.entries(maps)) {
    const layer = new WaterLayer(); layer.rebuild(t); layer.rebuild(t); layer.update(12.5);
    let tris = 0, far = false;
    for (const mesh of layer.group.children) {
      const p = mesh.geometry.getAttribute('position');
      for (const v of p.array) assert.ok(Number.isFinite(v), name);
      for (let i = 0; i < p.count; i++) {
        assert.ok(Math.abs(p.getX(i)) <= 180 && Math.abs(p.getZ(i)) <= 180, `${name} leaves the landscape`);
        assert.ok(p.getY(i) >= BEACH_Y - 1e-6 && p.getY(i) <= WATER_Y + 1e-6, `${name} floats off the construction plane`);
        far ||= Math.abs(p.getX(i)) > 41 || Math.abs(p.getZ(i)) > 41;
      }
      tris += mesh.geometry.getIndex().count / 3;
    }
    const tiles = t.water.reduce((a, b) => a + b, 0);
    // Greedy runs, not a quad per tile: the flat sea half is a couple of rectangles.
    assert.ok(tris < Math.max(4, tiles / 2), `${name} merged ${tiles} tiles into ${tris} triangles`);
    if (name === 'sea') assert.ok(tris <= 20, `half the map is water and it took ${tris} triangles`);
    assert.equal(tiles > 0, tris > 0);
    // Only water running off the map edge extends out to the horizon.
    const edge = [...Array(C.GRID).keys()].some(n => t.water[C.idx(n, 0)] || t.water[C.idx(n, C.GRID - 1)] || t.water[C.idx(0, n)] || t.water[C.idx(C.GRID - 1, n)]);
    assert.equal(far, edge, `${name} horizon skirt`);

    const field = signedWaterField(t);
    for (let z = 0; z < C.GRID; z++) for (let x = 0; x < C.GRID; x++) {
      const d = field.at(x + 0.5 - C.GRID / 2, z + 0.5 - C.GRID / 2);
      assert.equal(d > 0, t.water[C.idx(x, z)] === 1, `${name} field sign at ${x},${z}`);
      assert.ok(Math.abs(d) >= 1 - 1e-6 && Math.abs(d) <= 8 + 1e-6, `${name} field range at ${x},${z}`);
      // Between a wet and a dry tile the field crosses zero right on the shared edge, so the
      // rendered contour follows tile boundaries instead of stepping around whole tiles.
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        if (x + dx >= C.GRID || z + dz >= C.GRID || t.water[C.idx(x, z)] === t.water[C.idx(x + dx, z + dz)]) continue;
        const edgeD = field.at(x + 0.5 + dx * 0.5 - C.GRID / 2, z + 0.5 + dz * 0.5 - C.GRID / 2);
        assert.ok(Math.abs(edgeD) < 0.35, `${name} shoreline off the tile edge by ${edgeD.toFixed(2)}`);
      }
    }
    layer.dispose();
  }
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

const { structurePlan, roadHeight, BRIDGE_RISE } = await import('../src/roads/structures.ts');
const { StructureLayer } = await import('../src/render/structures.ts');
test('bridge and tunnel spans cross surface roads without junctions and survive saves', () => {
  const legacy = Buffer.from(encode(demoCity()), 'base64url'); legacy[0] = 6;
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
  assert.equal(roadHeight({ structure: 2, len: 30 }, 15), -2.4);
});
test('structure planning rejects short spans, occupied approaches and ramp-level road collisions', () => {
  const net = new Network(), kind = new Uint8Array(C.N_TILES), terrain = generateTerrain(1);
  terrain.water.fill(0);
  assert.match(structurePlan(net, terrain, kind, [{ x: 10, z: 20 }, { x: 15, z: 20 }], 0, 1), /14/);
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
      bridgeSeen ||= frame.carHeights[n] > BRIDGE_RISE - 0.2; tunnelSeen ||= frame.carHeights[n] < -2;
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
    const r = rasterize(net);
    // Homes on two arms and jobs on the other two, so most commutes cross the ring.
    for (let i = 0; i < C.N_TILES; i++) {
      if (r.cover[i] || r.accSeg[i] < 0) continue;
      const x = i % C.GRID, z = (i / C.GRID) | 0;
      if (Math.hypot(x - cx, z - cz) < ring + 2.7) continue;
      city.kind[i] = x < cx - 3 || z < cz - 3 ? C.T_RES : (x + z) % 2 ? C.T_COM : C.T_IND; city.level[i] = 2;
    }
    city.net = net.toPlain();
    send({ type: 'load', ...city, serial: 1, cover: r.cover, accSeg: r.accSeg, accS: r.accS }); send({ type: 'speed', value: 1 });
    const still = new Map(), passed = new Set(), late = new Set();
    let maxStill = 0, peak = 0, crashUntil = -1;
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
          else if (Math.hypot(x - cx, z - cz) < ring + 3.7) maxStill = Math.max(maxStill, (tick - prev.tick) / C.SIM_HZ);
        }
        peak = Math.max(peak, onRing);
      }
      messages.length = 0;
    }
    console.log(`  ${kind ? 'Avenue' : 'Road'} roundabout: ${passed.size} vehicles through, ${late.size} in the last minute, peak ${peak} on the ring, longest wait ${maxStill.toFixed(1)}s`);
    assert.ok(maxStill < 15, `A vehicle sat still at the roundabout for ${maxStill.toFixed(1)}s`);
    assert.ok(late.size >= 20, 'Traffic still flows through the ring at the end of the run');
    assert.ok(peak >= 8, 'The ring should actually be flooded');
  }
  Math.random = C.mulberry32(123);
});

Math.random = originalRandom;
console.log(`${checks} checks passed`);
