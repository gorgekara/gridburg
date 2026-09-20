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
const { Network } = await import('../src/roads/network.ts');
const { rasterize } = await import('../src/roads/raster.ts');

let last; let clock;
globalThis.self = { postMessage: m => { if (m.type === 'state') last = m; } };
const old = globalThis.setInterval;
globalThis.setInterval = cb => { clock = cb; return 0; };
await import('../src/sim/worker.ts');
globalThis.setInterval = old;
const send = data => self.onmessage({data});
function load(city) {
 const net = Network.fromPlain(city.net), r = rasterize(net);
 send({type:'load', ...city, cityLevel:city.cityLevel??0, serial:1, cover:r.cover, accSeg:r.accSeg, accS:r.accS});
}
function report(label) { const s = last.stats; console.log(JSON.stringify({ label, population: s.pop, cityLevel: s.cityLevel + 1, money: s.money, income: Number(s.income.toFixed(2)), happiness: s.happiness, cars: s.cars, commute: Number(s.commute.toFixed(1)), declining: s.declining })); }
Math.random = C.mulberry32(42);
load(demoCity()); send({type:'warm',ticks:1800}); report('30 minutes of growth, no traffic');
const grownPopulation = last.stats.pop;
assert.ok(grownPopulation > 900);
const city = demoCity(); city.level.set(last.level); city.cityLevel=last.stats.cityLevel; city.money=last.stats.money;
for(let i=0;i<C.N_TILES;i++) if(C.SERVICES[city.kind[i]]?.civic) {city.kind[i]=0;city.level[i]=0;}
load(city); send({type:'warm',ticks:600});report('remove all civic services, 10 minutes later');
assert.ok(last.stats.pop < grownPopulation * 0.5, 'Service withdrawal should affect existing residents');
load(demoCity());send({type:'warm',ticks:110});
for(let i=0;i<180*C.SIM_HZ;i++) clock(); report('3 minutes with actual traffic');
assert.ok(last.stats.cars > 0 && last.stats.commute > 0 && Number.isFinite(last.stats.income));
const broke = demoCity();broke.money=-100;broke.level.fill(0);for(let i=0;i<C.N_TILES;i++)if(C.isService(broke.kind[i]))broke.level[i]=1;
load(broke);send({type:'warm',ticks:600});report('empty indebted town after 10 minutes');
assert.ok(last.stats.pop > 120 && last.stats.income > 0, 'Private growth must allow debt recovery');
console.log('4 extended gameplay scenarios passed');
