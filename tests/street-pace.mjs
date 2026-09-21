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
const { SIM_HZ } = await import('../src/constants.ts');
const { demoCity } = await import('../src/demo.ts');
const { Network } = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');
let frame, step;
globalThis.self = { postMessage: m => { if (m.type === 'frame') frame = m; } };
const interval = globalThis.setInterval;
globalThis.setInterval = fn => { step = fn; return 0; };
await import('../src/sim/worker.ts');
globalThis.setInterval = interval;
const send = data => self.onmessage({ data });
const city = demoCity(), r = rasterize(Network.fromPlain(city.net));
send({ type: 'load', ...city, serial: 1, cover: r.cover, accSeg: r.accSeg, accS: r.accS });
function advance(n) { const before = frame.simTime; for (let i = 0; i < n; i++) step(); return frame.simTime - before; }
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} should equal ${b}`);
near(advance(SIM_HZ), 1);
send({ type: 'streetView', active: true });
near(advance(SIM_HZ), 0.25);
send({ type: 'speed', value: 3 });
near(advance(SIM_HZ), 0.25);
send({ type: 'speed', value: 0 });
near(advance(SIM_HZ), 0);
send({ type: 'speed', value: 3 });
send({ type: 'streetView', active: false });
near(advance(SIM_HZ), 3);
console.log('Street view: quarter-speed simulation, fast-forward cap, pause and restored overview pace passed.');
