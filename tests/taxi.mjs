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
const { Network } = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
const { taxiStopForTrip } = await import('../src/sim/transit.ts');
const { vehicleGeometry, CarLayer } = await import('../src/render/cars.ts');
const { vehicleLength } = await import('../src/sim/trafficSpace.ts');
const stand = 20 * C.GRID + 20, origin = stand + 2, destination = stand + 30;
assert.equal(C.T_TAXI, 46);
assert.equal(C.SERVICES[C.T_TAXI].capacity, 4);
assert.equal(taxiStopForTrip([stand], origin, destination, () => true), stand, 'one stand works without a second stop');
assert.equal(taxiStopForTrip([stand], stand + 11, destination, () => true), -1, 'walking catchment is bounded');
assert.equal(taxiStopForTrip([stand], origin, destination, () => false), -1, 'busy or unreachable stands cannot accept passengers');
assert.equal(taxiStopForTrip([stand], origin, origin + 2, () => true), -1, 'short trips do not dispatch taxis');
assert.equal(vehicleLength(9), vehicleLength(1));
const cab = vehicleGeometry(9), car = vehicleGeometry(1);
assert.ok(cab.attributes.position.count > car.attributes.position.count, 'taxi roof sign and checker markings');
cab.dispose(); car.dispose();
const layer = new CarLayer(), frame = new Float32Array(C.MAX_CARS * 4);
frame.set([20, 20, 0, 9]); layer.update(frame, frame, 1);
assert.equal(layer.mesh.children.filter(m => m.count > 0).length, 2, 'taxi body and lamps render with instancing');

const { demoCity } = await import('../src/demo.ts');
const city = demoCity(true);
let taxiSites = [];
for (let i = 0; i < C.N_TILES; i++) if (city.kind[i] === C.T_BUS) { city.kind[i] = C.T_TAXI; taxiSites.push(i); }
assert.ok(taxiSites.length >= 2);
let state, clock, frames = 0, moved = false, peak = 0, passengers = 0, seen = new Map(), report;
globalThis.self = { postMessage: m => {
  if (m.type === 'state') { state = m; passengers = Math.max(passengers, m.stats.transport.taxiRiders); }
  if (m.type === 'inspection') report = m.report;
  if (m.type === 'frame') {
    frames++; let active = 0;
    for (let i = 0; i < m.carIds.length; i++) if (m.cars[i * 4 + 3] === 9) {
      active++;
      const id = m.carIds[i], p = [m.cars[i * 4], m.cars[i * 4 + 1]], old = seen.get(id);
      if (old && Math.hypot(p[0] - old[0], p[1] - old[1]) > 0.05) moved = true;
      seen.set(id, p);
    }
    peak = Math.max(peak, active);
  }
}};
const oldInterval = globalThis.setInterval;
globalThis.setInterval = fn => { clock = fn; return 0; };
await import('../src/sim/worker.ts'); globalThis.setInterval = oldInterval;
const road = Network.fromPlain(city.net), raster = rasterize(road);
const send = data => self.onmessage({ data });
Math.random = C.mulberry32(1234);
send({ type: 'load', ...city, cityLevel: city.cityLevel ?? 0, serial: 1, cover: raster.cover, accSeg: raster.accSeg, accS: raster.accS });
send({ type: 'warm', ticks: 5 });
assert.equal(state.stats.transport.taxiStops, taxiSites.length);
for (let i = 0; i < 140 * C.SIM_HZ; i++) clock();
assert.ok(frames > 0 && seen.size > 0 && moved, 'worker dispatches moving passenger taxis in real road traffic');
assert.ok(peak <= taxiSites.length * 4, 'stand fleet capacity is enforced');
assert.ok(passengers > 0, 'completed taxi rides count as served passengers');
send({ type: 'inspect', tile: taxiSites[0] });
assert.ok(report.details.some(s => s.includes('single stop')));
assert.ok(!report.blockers.some(s => s.includes('second operating stop')));
for (let i = 0; i < C.N_TILES; i++) if (C.SERVICES[city.kind[i]]?.power) city.kind[i] = 0;
send({ type: 'edit', ...city, spent: 0, serial: 2, cover: raster.cover, accSeg: raster.accSeg, accS: raster.accS });
send({ type: 'warm', ticks: 2 });
assert.equal(state.stats.transport.taxiStops, 0, 'utility loss suspends taxi stands');
console.log(`Taxi checks passed: catchment, unavailable stands, instanced cab geometry, fleet bounds, utilities and ${seen.size} moving cabs with completed passenger trips.`);
