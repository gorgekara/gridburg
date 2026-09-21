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
const { transitNetwork, trolleyRoute, trolleyPath } = await import('../src/sim/transit.ts');
const { TrolleyWireLayer } = await import('../src/render/trolleyWires.ts');
const { vehicleLength } = await import('../src/sim/trafficSpace.ts');
const { vehicleGeometry } = await import('../src/render/cars.ts');
const net = new Network(), a = net.addNode(10,10), b = net.addNode(30,10), c = net.addNode(50,10);
const first = net.addSeg(a.id,b.id,20,10,0), second = net.addSeg(b.id,c.id,40,10,1);
const route = trolleyRoute(net,first.id,3,second.id,15);
assert.deepEqual(route.map(l => [l.seg,l.fwd]),[[first.id,true],[second.id,true]]);
assert.ok(trolleyRoute(net,second.id,15,first.id,3));
assert.ok(trolleyPath(net,first.id,3,second.id,15).length > 100);
first.oneway = true;
assert.equal(trolleyRoute(net,second.id,15,first.id,3),null);
first.oneway = false; second.structure = 1;
assert.equal(trolleyRoute(net,first.id,3,second.id,15),null); second.structure = 0;
assert.equal(vehicleLength(8),vehicleLength(4));
const bus = vehicleGeometry(4), trolley = vehicleGeometry(8);
assert.ok(trolley.attributes.position.count > bus.attributes.position.count);
bus.dispose();trolley.dispose();
const tiles = new Uint8Array(C.N_TILES), x = 9*C.GRID+14, y = 9*C.GRID+44;
tiles[x] = tiles[y] = C.T_TROLLEY;
const r = rasterize(net);
const network = transitNetwork(tiles,()=>true,(x,y)=>!!trolleyRoute(net,r.accSeg[x],r.accS[x],r.accSeg[y],r.accS[y]));
assert.equal(network.lines.length,1);assert.equal(network.lines[0].mode,'trolley');assert.equal(network.lines[0].capacity,40);
assert.equal(transitNetwork(tiles,i=>i!==x,()=>true).lines.length,0);
const wires = new TrolleyWireLayer();wires.rebuild(tiles,new Uint8Array(C.N_TILES),r,net);
assert.ok(wires.group.children[0].geometry.attributes.position.count>0);
const broken = new Uint8Array(C.N_TILES);broken[x]=C.F_NO_POWER;
wires.rebuild(tiles,broken,r,net);assert.equal(wires.group.children[0].geometry.attributes.position.count,0);

// Exercise the actual worker and published frames, using a powered demo city's existing bus sites.
const { demoCity } = await import('../src/demo.ts');
const city = demoCity(true);
let stops = 0;
for(let i=0;i<C.N_TILES;i++) if(city.kind[i]===C.T_BUS) {city.kind[i]=C.T_TROLLEY;stops++;}
assert.ok(stops>=2);
let state, clock, frames=0, seen = new Map(), moved=false;
globalThis.self={postMessage:m=>{
  if(m.type==='state')state=m;
  if(m.type==='frame') {
    frames++;
    for(let i=0;i<m.carIds.length;i++) if(m.cars[i*4+3]===8) {
      const id=m.carIds[i], p=[m.cars[i*4],m.cars[i*4+1]], old=seen.get(id);
      if(old&&Math.hypot(p[0]-old[0],p[1]-old[1])>0.05)moved=true;
      seen.set(id,p);
    }
  }
}};
const oldInterval=globalThis.setInterval;globalThis.setInterval=fn=>{clock=fn;return 0;};
await import('../src/sim/worker.ts');globalThis.setInterval=oldInterval;
const road=Network.fromPlain(city.net), raster=rasterize(road);
const send=data=>self.onmessage({data});
Math.random=C.mulberry32(1234);
send({type:'load',...city,cityLevel:city.cityLevel??0,serial:1,cover:raster.cover,accSeg:raster.accSeg,accS:raster.accS});
send({type:'warm',ticks:5});
assert.ok(state.stats.transport.trolleyLines>0, 'powered trolley stops produce operating lines');
assert.equal(state.stats.transport.busLines,0);
for(let i=0;i<100*C.SIM_HZ;i++)clock();
assert.ok(frames>0&&seen.size>0&&moved,'worker dispatches moving type8 trolleybuses in traffic');
for(let i=0;i<C.N_TILES;i++)if(C.SERVICES[city.kind[i]]?.power)city.kind[i]=0;
send({type:'edit',...city,spent:0,serial:2,cover:raster.cover,accSeg:raster.accSeg,accS:raster.accS});
send({type:'warm',ticks:2});
assert.equal(state.stats.transport.trolleyLines,0,'power loss suspends trolley service');
console.log(`Trolley checks passed: directed routes, utilities, capacity, wire geometry, vehicle geometry and ${seen.size} actual moving trolleybuses.`);
