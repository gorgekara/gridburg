import { roadHeight, STRUCTURE_COST } from '../roads/structures';
import { Incidents } from './incidents';
import { T_FIRE, T_POLICE, T_POLICE_HQ } from '../constants';
import { TrafficSpace, vehicleLength } from './trafficSpace';
import type { VehiclePose } from './trafficSpace';
import { T_OFFICE, OFFICE_JOBS, OFFICE_UNLOCK, T_STATION, T_TREATMENT } from '../constants';
import { transitNetwork, transitLineForTrip, distance } from './transit';
import type { TransitNetwork } from './transit';
import {
  GRID, N_TILES, MAX_CARS, SIM_HZ, T_RES, T_COM, T_IND, T_PUMP, T_TOWER, T_OUTLET,
  RES_POP, COM_JOBS, IND_JOBS, POWER_DEMAND, WATER_DEMAND, IND_POLLUTION, SERVICES, START_MONEY, ROAD_UPKEEP, ROAD_UPKEEP_FACTOR,
  F_NO_POWER, F_NO_WATER, F_NO_SEWAGE, F_NO_ROAD, isZone, isService, neighbor, tileHash,
} from '../constants';
import { defaultFunding, FUNDING_KEYS, validFunding, serviceFunding, fundingOutput, LOAN_AMOUNT, LOAN_TOTAL, LOAN_PAYMENT, NEGLECT_LIMIT } from '../management';
import { entrySite } from '../roads/entries';
import { civicShortfalls } from './growth';
import { isPolicyId, noPolicies, policyEffects, policyExpense, POLICIES } from '../policies';
import type { Policies, PolicyEffects } from '../policies';
import { F_DECLINING, CIVIC_LABELS } from '../constants';
import type { CivicNeed } from '../constants';
import { advanceCity } from '../progression';
import { civicCoverage } from './civic';
import { Network, SPEED, KIND_AVENUE, KIND_HIGHWAY, KIND_LANE, HALF_WIDTH, isGreen } from '../roads/network';
import type { RSeg } from '../roads/network';
import { generateTerrain, touchesWater, adjacentFlow } from '../terrain';
import type { Terrain } from '../terrain';
import type { EditPayload, MainToWorker, Stats, TileReport } from './messages';

const post = (self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage.bind(self);

// ---- city state --------------------------------------------------------------------------
const kind = new Uint8Array(N_TILES);
const level = new Uint8Array(N_TILES);
const age = new Uint16Array(N_TILES);
const neglect = new Uint8Array(N_TILES);
const flags = new Uint8Array(N_TILES);
let cover: Uint8Array = new Uint8Array(N_TILES);
let accSeg = new Int32Array(N_TILES).fill(-1); // segment *index* after remapping, -1 if none
let accS: Float32Array = new Float32Array(N_TILES);
let pollution = new Float32Array(N_TILES);
let pollutionTmp = new Float32Array(N_TILES);
let terrain: Terrain = generateTerrain(1);
let riverPollution = new Float32Array(terrain.river.length);

let funding = defaultFunding();
let debt = 0;
let taxIncome = 0, serviceExpense = 0, loanExpense = 0;
let inspected = -1;
let cityLevel = 0;
let happiness = 65;
let civicState = civicCoverage(kind, level, () => false);
let money = START_MONEY;
let tick = 0;
let tax = 10;
let speed = 1;
let simTime = 0;
let pop = 0, comJobs = 0, indJobs = 0, officeJobs = 0, buildings = 0;
let commuteAvg = 0;
let noPath = 0, gaveUp = 0;
let subCount = 0;
let netIncome = 0;
const demand: [number, number, number, number] = [0, 0, 0, 0];
let transit: TransitNetwork = { lines: [], airports: [], intercity: [] };
let transitSignature = '';
let transitTokens: number[] = [], transitDepartures: number[] = [];
let riders = 0, airPassengers = 0, railPassengers = 0, fareIncome = 0, treatedSewage = 0;
/** Street racing: a few cars tearing across town after dark, and the clock until they disperse. */
let raceUntil = -1;
let robbedSeen = 0;
let policies: Policies = noPolicies();
let effects: PolicyEffects = policyEffects(policies);
let policyCost = 0;
let tollIncome = 0, tollWindow = 0;
let riderWindow = 0, airWindow = 0, airTokens = 0;
let railWindow = 0, railTokens = 0;
let power: [number, number] = [0, 0];
let water: [number, number] = [0, 0];
let sewage: [number, number] = [0, 0];
let dirtyShare = 0;
let resPollution = 0;
let unservedRes = 0;
let pendingMoveIns: number[] = [];

// ---- road graph snapshot --------------------------------------------------------------------
const J_PLAIN = 0, J_YIELD = 1, J_LIGHT = 2, J_RING = 3, J_STOP = 4;
/** How long a driver must actually stand at a stop line before pulling away. */
const STOP_WAIT = 0.55;
interface Edge { seg: number; to: number; fwd: boolean }
let serial = 0;
let segs: RSeg[] = [];
let segA: number[] = []; // node indices
let segB: number[] = [];
let nodeX: number[] = [];
let nodeZ: number[] = [];
let nodeIds: number[] = [];
let nodeType: number[] = [];
let nodeEdges: Edge[][] = [];
let nodeGroups: Map<number, number>[] = []; // seg index -> signal group, for light nodes
let lockOwner = new Int32Array(0); // per node: the slot holding the junction box, or -1
let ringClaim = new Int32Array(0); // per roundabout node: the slot of an entering car whose turn is next
let ringArc = new Uint8Array(0); // one-way segment between two roundabout nodes
let ringIn: number[][] = []; // per node: lane keys of the ring arcs that feed it
let nodeHalf = new Float32Array(0); // half width of the widest road meeting the node
let reach = new Uint8Array(0);
let component = new Int32Array(0);
let entryNodes: number[] = [];
let entries: { seg: number; s: number }[] = [];
let segCong = new Float32Array(0);
let roadUpkeep = 0;
let roadLength = 0;

// ---- cars ---------------------------------------------------------------------------------------
interface Leg { seg: number; fwd: boolean; p0: number; p1: number }
interface Mission { kind: 'fire' | 'patrol' | 'crash' | 'heist'; origin: number; tile: number; crash?: number; work: number }
interface Car { uid: number; legs: Leg[]; li: number; p: number; time: number; stuck: number; stopAt?: number; lock: number; lockLi: number; lockStop: number; vehicle: number; line?: number; mission?: Mission; crash?: number; working?: boolean }
const trafficSpace = new TrafficSpace();
const spawnSpace = new TrafficSpace();
let carSequence = 0;
const incidents = new Incidents();
const dispatchCooldown = new Map<number, number>();
const slots: (Car | null)[] = new Array(MAX_CARS).fill(null);
const freeList: number[] = [];
for (let i = MAX_CARS - 1; i >= 0; i--) freeList.push(i);
let activeCars = 0;
let laneCars: number[][] = [];
let laneTail = new Float32Array(0);
let laneFresh = new Float32Array(0); // lowest p of a car that crossed into the lane during this step
let spawnBudget = 0;
let extBudget = 0;
let tripRate = 0;
let extRate = 0;

let resTiles: number[] = [], resW: number[] = [];
let jobTiles: number[] = [], jobW: number[] = [];

const GAP = [0.42, 0.42, 0.4, 0.46];
const STOP_SETBACK = 0.85; // how far before a junction a car holds, for a plain one-tile road
const RING_PATIENCE = 6; // seconds an entering car gives way before it books its turn on the ring
const RING_GAP = 1.3; // distance before a roundabout node inside which circulating cars have right of way


function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function pickWeighted(tiles: number[], cum: number[]): number {
  const r = Math.random() * cum[cum.length - 1];
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] > r) hi = mid; else lo = mid + 1;
  }
  return tiles[lo];
}

// ---- network snapshot -----------------------------------------------------------------------
function applyNetwork(p: EditPayload): void {
  const net = Network.fromPlain(p.net);
  const oldLens = segs.map((s) => s.len);
  const oldA = segs.map((s) => s.a);

  serial = p.serial;
  const nodeIndex = new Map<number, number>();
  nodeX = []; nodeZ = []; nodeIds = []; nodeType = []; nodeEdges = []; nodeGroups = [];
  entryNodes = [];
  for (const n of net.nodes.values()) {
    nodeIndex.set(n.id, nodeIds.length);
    nodeIds.push(n.id);
    nodeX.push(n.x);
    nodeZ.push(n.z);
    nodeEdges.push([]);
    nodeGroups.push(new Map());
    const deg = net.degree(n.id);
    nodeType.push(n.ring ? J_RING : deg >= 3 ? (n.light ? J_LIGHT : n.stop ? J_STOP : J_YIELD) : J_PLAIN);
    if (n.entry) entryNodes.push(nodeIds.length - 1);
  }
  // Keep surviving segments at stable indices where possible is not needed: cars are remapped by id below.
  const newSegs: RSeg[] = [];
  const segIndex = new Map<number, number>();
  for (const pl of p.net.segs) {
    const s = net.segs.get(pl[0]);
    if (!s) continue;
    segIndex.set(s.id, newSegs.length);
    newSegs.push(s);
  }
  segA = newSegs.map((s) => nodeIndex.get(s.a)!);
  segB = newSegs.map((s) => nodeIndex.get(s.b)!);
  roadUpkeep = 0;
  roadLength = 0;
  newSegs.forEach((s, i) => {
    nodeEdges[segA[i]].push({ seg: i, to: segB[i], fwd: true });
    if (!s.oneway) nodeEdges[segB[i]].push({ seg: i, to: segA[i], fwd: false });
    if (!s.fixed) roadUpkeep += s.len * ROAD_UPKEEP * STRUCTURE_COST[s.structure ?? 0] * (ROAD_UPKEEP_FACTOR[s.kind] ?? 1);
    roadLength += s.len;
  });
  lockOwner = new Int32Array(nodeIds.length).fill(-1);
  ringClaim = new Int32Array(nodeIds.length).fill(-1);
  ringArc = new Uint8Array(newSegs.length);
  ringIn = nodeIds.map(() => []);
  newSegs.forEach((s, i) => {
    if (!s.oneway || nodeType[segA[i]] !== J_RING || nodeType[segB[i]] !== J_RING) return;
    ringArc[i] = 1; ringIn[segB[i]].push(i * 2);
  });
  nodeHalf = new Float32Array(nodeIds.length);
  nodeIds.forEach((id, ni) => {
    if (nodeType[ni] === J_LIGHT) {
      for (const [sid, g] of net.lightGroups(id)) nodeGroups[ni].set(segIndex.get(sid)!, g);
    }
    for (const s of net.segsAt(id)) nodeHalf[ni] = Math.max(nodeHalf[ni], HALF_WIDTH[s.kind]);
  });

  // Any purchased highway entry can serve its own connected neighborhoods.
  reach = new Uint8Array(nodeIds.length);
  entries = [];
  const und: number[][] = nodeIds.map(() => []);
  newSegs.forEach((_, i) => { und[segA[i]].push(segB[i]); und[segB[i]].push(segA[i]); });
  component = new Int32Array(nodeIds.length).fill(-1);
  for (let root = 0; root < nodeIds.length; root++) {
    if (component[root] >= 0) continue;
    const pending = [root]; component[root] = root;
    while (pending.length) {
      const node = pending.pop()!;
      for (const next of und[node]) if (component[next] < 0) { component[next] = root; pending.push(next); }
    }
  }
  const stack = [...entryNodes];
  for (const n of entryNodes) reach[n] = 1;
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of und[n]) if (!reach[m]) { reach[m] = 1; stack.push(m); }
  }
  for (const n of entryNodes) newSegs.forEach((s, i) => {
    if (segA[i] === n) entries.push({ seg: i, s: 0 });
    else if (segB[i] === n) entries.push({ seg: i, s: s.len });
  });
  transitSignature = '';

  // Carry congestion over for surviving segments; drop cars whose route touched a changed segment.
  const newCong = new Float32Array(newSegs.length);
  const remap = new Int32Array(segs.length).fill(-1);
  segs.forEach((s, i) => {
    const ni = segIndex.get(s.id);
    if (ni === undefined) return;
    const ns = newSegs[ni];
    if (Math.abs(ns.len - oldLens[i]) > 1e-3 || ns.a !== oldA[i] || ns.kind !== s.kind || ns.oneway !== s.oneway || ns.structure !== s.structure || ns.cx !== s.cx || ns.cz !== s.cz) return;
    remap[i] = ni;
    newCong[ni] = segCong[i];
  });
  for (let c = 0; c < MAX_CARS; c++) {
    const car = slots[c];
    if (!car) continue;
    let ok = true;
    for (const leg of car.legs) {
      const ni = remap[leg.seg];
      if (ni < 0) { ok = false; break; }
    }
    if (!ok) { freeCar(c); continue; }
    for (const leg of car.legs) leg.seg = remap[leg.seg];
    car.lock = -1; // locks were reset with the node arrays
  }
  segs = newSegs;
  segCong = newCong;
  laneCars = new Array(segs.length * 2);
  for (let i = 0; i < laneCars.length; i++) laneCars[i] = [];
  laneTail = new Float32Array(segs.length * 2);
  laneFresh = new Float32Array(segs.length * 2);

  // Tile access arrives keyed by segment id; store indices.
  cover = p.cover;
  accS = p.accS;
  accSeg = new Int32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) {
    const id = p.accSeg[i];
    accSeg[i] = id < 0 ? -1 : segIndex.get(id) ?? -1;
  }
}

function tileConnected(i: number): boolean {
  const s = accSeg[i];
  return s >= 0 && !cover[i] && reach[segA[s]] === 1;
}

// ---- routing -----------------------------------------------------------------------------------
let gScore = new Float32Array(0);
let prevEdgeSeg = new Int32Array(0);
let prevEdgeFwd = new Uint8Array(0);
let prevNode = new Int32Array(0);
let stamp = new Uint32Array(0);
let closedStamp = new Uint32Array(0);
let gen = 0;
const heapF: number[] = [];
const heapN: number[] = [];

function heapPush(f: number, n: number): void {
  heapF.push(f); heapN.push(n);
  let i = heapF.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= heapF[i]) break;
    [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
    [heapN[p], heapN[i]] = [heapN[i], heapN[p]];
    i = p;
  }
}
function heapPop(): number {
  const top = heapN[0];
  const lf = heapF.pop()!, ln = heapN.pop()!;
  if (heapF.length) {
    heapF[0] = lf; heapN[0] = ln;
    let i = 0;
    const len = heapF.length;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < len && heapF[l] < heapF[m]) m = l;
      if (r < len && heapF[r] < heapF[m]) m = r;
      if (m === i) break;
      [heapF[m], heapF[i]] = [heapF[i], heapF[m]];
      [heapN[m], heapN[i]] = [heapN[i], heapN[m]];
      i = m;
    }
  }
  return top;
}

function segTime(i: number): number {
  return (segs[i].len / segSpeed(segs[i])) * (1 + 2.5 * segCong[i]);
}

/** Fastest route between two road positions as a list of legs, or null. */
function route(sSeg: number, sS: number, gSeg: number, gS: number): Leg[] | null {
  const S = segs[sSeg];
  const G = segs[gSeg];
  if (!S || !G) return null;
  if (sSeg === gSeg) {
    if (gS >= sS) return [{ seg: sSeg, fwd: true, p0: sS, p1: gS }];
    if (!S.oneway) return [{ seg: sSeg, fwd: false, p0: S.len - sS, p1: S.len - gS }];
  }
  const n = nodeIds.length;
  if (gScore.length < n + 1) {
    gScore = new Float32Array(n + 1);
    prevEdgeSeg = new Int32Array(n + 1);
    prevEdgeFwd = new Uint8Array(n + 1);
    prevNode = new Int32Array(n + 1);
    stamp = new Uint32Array(n + 1);
    closedStamp = new Uint32Array(n + 1);
  }
  gen++;
  heapF.length = 0;
  heapN.length = 0;
  const GOAL = n; // virtual node
  const gx = G.pts[0], gz = G.pts[1];
  const h = (node: number): number => Math.hypot(nodeX[node] - gx, nodeZ[node] - gz) / 4.5 * 0.8;
  const vS = segSpeed(S);
  const relax = (node: number, g: number, from: number, seg: number, fwd: boolean): void => {
    if (closedStamp[node] === gen) return;
    if (stamp[node] === gen && gScore[node] <= g) return;
    stamp[node] = gen;
    gScore[node] = g;
    prevNode[node] = from;
    prevEdgeSeg[node] = seg;
    prevEdgeFwd[node] = fwd ? 1 : 0;
    heapPush(g + (node === GOAL ? 0 : h(node)), node);
  };
  relax(segB[sSeg], (S.len - sS) / vS, -1, sSeg, true);
  if (!S.oneway) relax(segA[sSeg], sS / vS, -1, sSeg, false);
  const vG = segSpeed(G);

  while (heapN.length) {
    const cur = heapPop();
    if (closedStamp[cur] === gen) continue;
    closedStamp[cur] = gen;
    if (cur === GOAL) {
      const legs: Leg[] = [];
      let node = GOAL;
      while (node !== -1) {
        const seg = prevEdgeSeg[node];
        const fwd = prevEdgeFwd[node] === 1;
        const from = prevNode[node];
        const len = segs[seg].len;
        if (node === GOAL) legs.push({ seg, fwd, p0: 0, p1: fwd ? gS : len - gS });
        else if (from === -1) legs.push({ seg, fwd, p0: fwd ? sS : len - sS, p1: len });
        else legs.push({ seg, fwd, p0: 0, p1: len });
        node = from;
      }
      legs.reverse();
      return legs;
    }
    const g = gScore[cur];
    if (cur === segA[gSeg]) relax(GOAL, g + gS / vG, cur, gSeg, true);
    if (cur === segB[gSeg] && !G.oneway) relax(GOAL, g + (G.len - gS) / vG, cur, gSeg, false);
    for (const e of nodeEdges[cur]) {
      const t = nodeType[e.to];
      const penalty = t === J_LIGHT ? 2.5 : t === J_STOP ? 1.4 : t === J_YIELD ? 0.8 : 0;
      relax(e.to, g + segTime(e.seg) + penalty, cur, e.seg, e.fwd);
    }
  }
  return null;
}

// ---- car lifecycle --------------------------------------------------------------------------------
function freeCar(slot: number): void {
  const c = slots[slot];
  if (!c) return;
  if (c.lock >= 0 && c.lock < lockOwner.length && lockOwner[c.lock] === slot) lockOwner[c.lock] = -1;
  trafficSpace.remove(slot);
  slots[slot] = null;
  freeList.push(slot);
  activeCars--;
}

function clearCars(): void {
  for (let s = 0; s < MAX_CARS; s++) if (slots[s]) freeCar(s);
  lockOwner.fill(-1); ringClaim.fill(-1); spawnSpace.clear();
}

const legStart = (l: Leg): number => (l.fwd ? segA[l.seg] : segB[l.seg]);
const legEndNode = (l: Leg): number => (l.fwd ? segB[l.seg] : segA[l.seg]);

/**
 * An arm meets a roundabout at a single point, but the arm's lanes lie to the side of that point —
 * sideways on the arm is *along* the ring. An avenue's outer lane is a full 1.05 off, so a car joining
 * or leaving the ring at the node itself would have to jump that far sideways across the circulating
 * lane, and on the way out backwards into the queue behind it, which gridlocks the whole circle.
 * Slide each transition along the arc to the point where the arm's own lane reaches it: the merge stays
 * continuous whatever the road width, and on a one-tile road the shift is the old ~0.2 and barely moves.
 */
function alignRingLegs(legs: Leg[], slot: number, vehicle: number): void {
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (!ringArc[leg.seg]) continue;
    const arc = segs[leg.seg];
    const next = legs[i + 1];
    if (next && !ringArc[next.seg] && legEndNode(leg) === legStart(next)) {
      const to = carPose(next, next.p0, slot, vehicle);
      leg.p1 = clamp(Network.nearestOn(arc, to.x, to.z).s, leg.p0 + 0.05, leg.p1);
    }
    const prev = legs[i - 1];
    if (prev && !ringArc[prev.seg] && legEndNode(prev) === legStart(leg)) {
      const from = carPose(prev, prev.p1, slot, vehicle);
      leg.p0 = clamp(Network.nearestOn(arc, from.x, from.z).s, leg.p0, leg.p1 - 0.05);
    }
  }
}

function spawnTrip(sSeg: number, sS: number, gSeg: number, gS: number, vehicle = 1, line?: number, mission?: Mission): boolean {
  if (!freeList.length || sSeg < 0 || gSeg < 0) return false;
  const legs = route(sSeg, sS, gSeg, gS);
  if (!legs || legs.length === 0) { noPath++; return false; }
  if (line !== undefined) {
    const back = route(gSeg, gS, sSeg, sS);
    if (!back) return false;
    legs.push(...back);
  }
  const slot = freeList.at(-1)!;
  alignRingLegs(legs, slot, vehicle);
  const placement = carPose(legs[0], legs[0].p0, slot, vehicle);
  if (!trafficSpace.free(placement) || !spawnSpace.free(placement)) return false;
  freeList.pop(); trafficSpace.set(slot, placement);
  slots[slot] = { uid: ++carSequence, legs, li: 0, p: legs[0].p0, time: 0, stuck: 0, lock: -1, lockLi: -1, lockStop: 0, vehicle, line, mission };
  activeCars++;
  return true;
}

function externalTrip(tile: number, inbound: boolean, vehicle = 1): boolean {
  // Try the closest entrance first, then fall back when one-way roads prevent the route.
  const candidates = [...entries].sort((a, b) => {
    const pa = segs[a.seg], pb = segs[b.seg];
    return Math.hypot(pa.pts[0] - tile % GRID, pa.pts[1] - Math.floor(tile / GRID)) - Math.hypot(pb.pts[0] - tile % GRID, pb.pts[1] - Math.floor(tile / GRID));
  });
  for (const e of candidates) {
    const legs = inbound ? route(e.seg, e.s, accSeg[tile], accS[tile]) : route(accSeg[tile], accS[tile], e.seg, e.s);
    if (!legs) continue;
    return inbound ? spawnTrip(e.seg, e.s, accSeg[tile], accS[tile], vehicle) : spawnTrip(accSeg[tile], accS[tile], e.seg, e.s, vehicle);
  }
  noPath++; return false;
}

/**
 * A trip in or out of the city that a railway out of town can carry instead of the road. Stations
 * only take what they have room for, so a single line does not swallow a city's worth of traffic.
 */
function byIntercityRail(tile: number): boolean {
  if (railTokens < 1) return false;
  const radius = SERVICES[T_STATION].radius!;
  if (!transit.intercity.some(station => distance(station, tile) < radius)) return false;
  if (Math.random() > 0.6) return false;
  railTokens--; railWindow++; riderWindow++; money += 0.12 * effects.fare;
  return true;
}

/** Whether the city clock says it is late enough for the racers to come out. */
const nightTime = (): boolean => { const h = (tick / 20) % 24; return h > 22 || h < 4; };

/**
 * Street racers: a handful of cars that run a long route across the city at speed once the streets
 * are quiet. They are ordinary traffic in every other way, so they queue and crash like anyone else.
 */
function startRace(): void {
  if (!resTiles.length || !jobTiles.length) return;
  for (let n = 0; n < 3; n++) {
    const o = pickWeighted(resTiles, resW), d = pickWeighted(jobTiles, jobW);
    if (distance(o, d) < 20) continue;
    spawnTrip(accSeg[o], accS[o], accSeg[d], accS[d], 7);
  }
}

function spawn(dt: number): void {
  airTokens = Math.min(transit.airports.length * 240, airTokens + transit.airports.length * 4 * dt);
  const intercityCapacity = transit.intercity.length * SERVICES[T_STATION].capacity!;
  railTokens = Math.min(intercityCapacity, railTokens + transit.intercity.length * 6 * dt);
  riderWindow *= Math.exp(-dt / 60); airWindow *= Math.exp(-dt / 60); railWindow *= Math.exp(-dt / 60); tollWindow *= Math.exp(-dt / 60);
  transit.lines.forEach((line, i) => {
    const congestion = line.mode === 'bus' ? Math.max(segCong[accSeg[line.a]] ?? 0, segCong[accSeg[line.b]] ?? 0) : 0;
    transitTokens[i] = Math.min(line.capacity, (transitTokens[i] ?? 0) + line.capacity / 20 * dt * (1 - congestion * 0.8));
    transitDepartures[i] = (transitDepartures[i] ?? 0) + dt;
    if (line.mode === 'bus' && transitDepartures[i] >= 12 && !slots.some(c => c?.line === i)) {
      if (spawnTrip(accSeg[line.a], accS[line.a], accSeg[line.b], accS[line.b], 4, i)) transitDepartures[i] = 0;
    }
  });
  // After dark, and only in a city big enough to have a scene, the racers come out for a while.
  if (cityLevel >= 3 && raceUntil < simTime && nightTime() && Math.random() < 0.0016 * dt * SIM_HZ) {
    raceUntil = simTime + 45;
    startRace();
  }
  spawnBudget = Math.min(8, spawnBudget + tripRate * dt);
  extBudget = Math.min(4, extBudget + extRate * dt);
  let n = 0;
  while (spawnBudget >= 1 && n < 4 && resTiles.length && jobTiles.length) {
    spawnBudget -= 1;
    n++;
    const o = pickWeighted(resTiles, resW);
    const d = pickWeighted(jobTiles, jobW);
    const line = transitLineForTrip(transit, o, d);
    if (line >= 0 && transitTokens[line] >= 1 && Math.random() < Math.min(0.98, (transit.lines[line].mode !== 'bus' ? 0.9 : 0.65) * effects.transitShare)) {
      transitTokens[line]--; riderWindow++; money += 0.08 * effects.fare;
    } else if (Math.random() < effects.carTrips) {
      money += effects.toll; tollWindow += effects.toll ? 1 : 0;
      spawnTrip(accSeg[o], accS[o], accSeg[d], accS[d], tileHash(o) < 0.2 ? 2 : 1);
    }
  }
  if (!entries.length) return;
  while (extBudget >= 1 && n < 6 && freeList.length) {
    extBudget -= 1;
    n++;
    // Outside workers drive in when there are spare jobs; residents drive out when there are not enough.
    const inbound = comJobs + indJobs + officeJobs > pop * 0.5 ? Math.random() < 0.7 : Math.random() < 0.3;
    if (inbound && jobTiles.length) {
      const d = pickWeighted(jobTiles, jobW);
      if (airTokens >= 1 && transit.airports.some(a => distance(a, d) < 24) && Math.random() < 0.45) { airTokens--; airWindow++; money += 0.2 * effects.fare; }
      else if (byIntercityRail(d)) { /* arrived by train */ }
      else externalTrip(d, true, kind[d] === T_IND ? 3 : 2);
    } else if (resTiles.length) {
      const o = pickWeighted(resTiles, resW);
      if (!byIntercityRail(o)) externalTrip(o, false);
    }
  }
  // New residents arrive by road.
  while (pendingMoveIns.length && n < 8 && freeList.length) {
    const t = pendingMoveIns.pop()!;
    n++;
    if (accSeg[t] >= 0) externalTrip(t, true, 2);
  }
}

/**
 * Sideways offset of a car from its segment's centreline, positive to the driver's right.
 * A roundabout ring circulates in a single lane on the arc centreline: side by side lanes on a tight
 * circle put the inner one on a measurably shorter path than the arc length the car-following gap is
 * measured in, so inner-lane cars close up until their bodies overlap, and an outer lane wide enough
 * for an avenue reaches out across the mouth of every entry arm.
 */
/** Travel speed on a road, slowed where the street has been calmed. */
function segSpeed(seg: RSeg): number {
  return SPEED[seg.kind] * (seg.calm ? 0.55 : 1);
}

function laneOffset(segIndex: number, seg: RSeg, slot: number): number {
  if (ringArc[segIndex]) return 0;
  // Three lanes each way on an expressway, two on an avenue, one on anything narrower.
  if (seg.kind === KIND_HIGHWAY) {
    return seg.oneway ? ((slot % 3) - 1) * 0.86 : 0.22 + (slot % 3) * 0.44;
  }
  if (seg.kind === KIND_AVENUE) return seg.oneway ? (slot & 1 ? 0.43 : -0.43) : (slot & 1 ? 0.22 : 0.64);
  if (seg.oneway) return seg.kind === KIND_LANE ? 0 : (slot & 1 ? 0.18 : -0.18);
  return seg.kind === KIND_LANE ? 0.1 : 0.18;
}

function carPose(leg: Leg, progress: number, slot: number, type: number): VehiclePose {
  const seg = segs[leg.seg];
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  Network.poseAt(seg, leg.fwd ? progress : seg.len - progress, p);
  const dir = leg.fwd ? 1 : -1, tx = p.tx * dir, tz = p.tz * dir;
  const lane = laneOffset(leg.seg, seg, slot);
  return { y: roadHeight(seg, leg.fwd ? progress : seg.len - progress), x: p.x - tz * lane, z: p.z + tx * lane, angle: Math.atan2(tx, tz), type };
}

/**
 * A circulating vehicle is about to reach this roundabout node, so an entering car must give way.
 * A car that has stopped on the arc is not about to arrive: it is queued for the box itself, and the
 * box is handed to circulating traffic first anyway. Treating it as oncoming made every arm wait out
 * RING_PATIENCE before it could ever enter, because a queued arc always has someone parked near a node.
 */
function ringApproaching(node: number): boolean {
  for (const key of ringIn[node]) {
    const len = segs[key >> 1].len;
    for (const slot of laneCars[key]) {
      const c = slots[slot];
      if (c && c.stuck < 0.5 && c.legs[c.li].seg === key >> 1 && c.p > len - RING_GAP) return true;
    }
    // Cars that crossed into the arc during this step are not in its lane list yet.
    if (laneFresh[key] < 1e8 && laneFresh[key] > len - RING_GAP) return true;
  }
  return false;
}

function stepCars(dt: number): void {
  for (const lane of laneCars) lane.length = 0;
  laneTail.fill(1e9);
  laneFresh.fill(1e9);
  for (let s = 0; s < MAX_CARS; s++) {
    const c = slots[s];
    if (!c) continue;
    const leg = c.legs[c.li];
    const key = leg.seg * 2 + (leg.fwd ? 0 : 1);
    laneCars[key].push(s);
    if (c.p < laneTail[key]) laneTail[key] = c.p;
  }
  const speedSum = new Float32Array(segs.length);
  const speedN = new Uint16Array(segs.length);

  for (let key = 0; key < laneCars.length; key++) {
    const lane = laneCars[key];
    if (!lane.length) continue;
    lane.sort((a, b) => slots[b]!.p - slots[a]!.p);
    let leaderP = Infinity, leaderLength = 0.34;
    for (const slot of lane) {
      const c = slots[slot]!;
      const leg = c.legs[c.li];
      const seg = segs[leg.seg];
      const v = segSpeed(seg) * (c.vehicle === 7 ? 1.55 : 1);
      const gap = Math.max(GAP[seg.kind], (vehicleLength(c.vehicle) + leaderLength) / 2 + 0.06);
      c.time += dt;
      if (c.crash !== undefined && incidents.crashes.has(c.crash)) {
        leaderP = c.p; leaderLength = vehicleLength(c.vehicle); speedN[leg.seg]++; continue;
      }
      c.crash = undefined;
      if (c.working && c.mission) {
        c.mission.work -= dt;
        if (c.mission.work <= 0) {
          if (c.mission.kind === 'fire') incidents.extinguish(c.mission.tile);
          else if (c.mission.kind === 'heist') incidents.foil(c.mission.tile);
          else if (c.mission.kind === 'patrol') incidents.visit(c.mission.tile);
          else if (c.mission.crash !== undefined) incidents.crashes.delete(c.mission.crash);
          freeCar(slot);
        } else { leaderP = c.p; leaderLength = vehicleLength(c.vehicle); }
        continue;
      }

      // Release a junction lock once clear of the box.
      if (c.lock >= 0 && c.li > c.lockLi && c.p > Math.min(0.8, seg.len * 0.5)) {
        if (lockOwner[c.lock] === slot) lockOwner[c.lock] = -1;
        c.lock = -1;
      }

      let maxP = leaderP - gap;
      const final = c.li === c.legs.length - 1;
      // A leg normally runs the whole link, but a roundabout arc is entered and left where the arm's
      // lane meets it rather than at the node, so the leg's own bounds are what count.
      const legEnd = leg.p1;
      if (final) {
        maxP = Math.min(maxP, leg.p1); // arriving cars pull off the road, so ignore the gap
      } else {
        const node = leg.fwd ? segB[leg.seg] : segA[leg.seg];
        // A car waiting at a junction must stand clear of the corridor it is about to cross, so the
        // setback scales with the widest road at the node. On a roundabout arc the car is already inside
        // the ring corridor and only has to keep its own distance, so it keeps the plain setback.
        const setback = ringArc[leg.seg] ? STOP_SETBACK : Math.max(STOP_SETBACK, nodeHalf[node] + 0.45);
        const span = legEnd - leg.p0;
        const stopP = span > Math.max(1.8, setback * 2) ? legEnd - setback : leg.p0 + span * 0.5;
        const pastStop = c.p > stopP + 1e-3;
        const next = c.legs[c.li + 1];
        const nextKey = next.seg * 2 + (next.fwd ? 0 : 1);
        // Room on the far side, measured from where this car will actually land: enough to stand behind
        // the longest vehicle that could already be there. A fixed clearance measured from the link start
        // is wrong once a leg starts partway along a roundabout arc, and too coarse on short links.
        const clear = Math.max(GAP[segs[next.seg].kind], (vehicleLength(c.vehicle) + vehicleLength(3)) / 2 + 0.06);
        let canGo = laneTail[nextKey] - next.p0 > Math.min(clear, (next.p1 - next.p0) * 0.6);
        const type = nodeType[node];
        if (type === J_LIGHT && !pastStop) {
          const g = nodeGroups[node].get(leg.seg) ?? 0;
          if (!isGreen(simTime, nodeIds[node], g)) canGo = false;
        }
        // An all-way stop: come to a halt at the line, then take your turn like any other junction.
        if (type === J_STOP && !pastStop && c.stopAt !== node) {
          if (c.p >= stopP - 0.25 && c.stuck >= STOP_WAIT) c.stopAt = node;
          else canGo = false;
        }
        // Roundabout priority: circulating traffic goes first, so a car joining the ring waits while
        // any vehicle is on the arc feeding this node. Filling the ring from the arms is what gridlocked it.
        const entering = type === J_RING && !ringArc[leg.seg];
        if (type === J_RING) {
          // A busy circle never leaves the box free, so give-way alone starved the arms completely. Once a
          // driver has waited out its patience it books the box: circulating traffic queues behind that
          // booking until the car is in, which keeps the merge serialised instead of forcing it.
          const booked = ringClaim[node] >= 0 ? slots[ringClaim[node]] : null;
          const bl = booked?.legs[booked.li];
          if (ringClaim[node] >= 0 && (!bl || ringArc[bl.seg] || legEndNode(bl) !== node)) ringClaim[node] = -1;
          if (entering && leaderP === Infinity && c.stuck >= RING_PATIENCE && ringClaim[node] < 0) ringClaim[node] = slot;
        }
        if (entering && c.lock !== node && c.stuck < RING_PATIENCE && ringApproaching(node)) canGo = false;
        if (type !== J_PLAIN && c.lock !== node) {
          const front = leaderP === Infinity;
          const owner = lockOwner[node];
          const holder = owner >= 0 && owner !== slot ? slots[owner] : null;
          if (owner >= 0 && (!holder || holder.lock !== node)) lockOwner[node] = -1;
          else if (holder) {
            const hLeg = holder.legs[holder.li];
            // Only the front car of a lane may claim the box. A follower holding it (a car spawned or merged
            // in ahead of it after it claimed) would wait on its own leader forever, so the front car takes it over.
            const stale = front && hLeg.seg === leg.seg && hLeg.fwd === leg.fwd && holder.p < c.p;
            // Circulating traffic owns the circle. A car queued on an arm may claim the box before it can
            // actually merge, and then it holds up the very ring traffic it is waiting for a gap in, so a
            // car already on the ring takes the box back off anyone still waiting outside it.
            const yielding = ringArc[leg.seg] && !ringArc[hLeg.seg] && owner !== ringClaim[node] && holder.p <= holder.lockStop + 1e-3;
            if (stale || yielding) { holder.lock = -1; lockOwner[node] = -1; }
          }
          const booked = type === J_RING && ringClaim[node] >= 0 && ringClaim[node] !== slot;
          if (canGo && front && !booked && c.p >= stopP - 0.3 && lockOwner[node] < 0) {
            // Hand over rather than overwrite: on short links (roundabout arcs) the next box is claimed
            // before the previous one is released, and overwriting leaked that lock forever.
            if (c.lock >= 0 && lockOwner[c.lock] === slot) lockOwner[c.lock] = -1;
            c.lock = node;
            c.lockLi = c.li;
            c.lockStop = stopP;
            lockOwner[node] = slot;
            if (type === J_RING && ringClaim[node] === slot) ringClaim[node] = -1;
          } else {
            canGo = false;
          }
        }
        if (!canGo) maxP = Math.min(maxP, pastStop ? legEnd - 0.02 : stopP);
      }

      const travel = c.p + v * dt;
      let newP = Math.min(travel, maxP, legEnd);
      if (newP < c.p) newP = c.p;
      const target = carPose(leg, newP, slot, c.vehicle);
      if (!trafficSpace.canMove(slot, target)) newP = c.p;
      else trafficSpace.set(slot, target);
      const moved = newP - c.p;
      speedSum[leg.seg] += moved / (v * dt);
      speedN[leg.seg]++;
      if (moved < 1e-4) c.stuck += dt; else c.stuck = 0;
      c.p = newP;
      leaderP = newP; leaderLength = vehicleLength(c.vehicle);

      if (final) {
        if (c.p >= leg.p1 - 1e-3) {
          if (c.mission) { c.working = true; c.mission.work = c.mission.kind === 'fire' ? 8 : 4; }
          else { commuteAvg = commuteAvg === 0 ? c.time : commuteAvg * 0.97 + c.time * 0.03; freeCar(slot); leaderP = Infinity; }
        }
      } else if (c.p >= legEnd - 1e-4) {
        // Carry the unused travel into the next link. Polyline links meet with a small kink, so the exact
        // start of the next link can sit a hair behind and to the side of where this one ended; on a
        // roundabout the follower is close enough that this one pose was blocked, and the leader then
        // waited on the car waiting behind it forever.
        const next = c.legs[c.li + 1];
        const nextKey = next.seg * 2 + (next.fwd ? 0 : 1);
        const nextSeg = segs[next.seg];
        const carry = Math.max(0, Math.min(travel - legEnd, laneTail[nextKey] - next.p0 - GAP[nextSeg.kind], next.p1 - next.p0));
        for (const nextP of carry > 1e-3 ? [next.p0 + carry, next.p0] : [next.p0]) {
          const target = carPose(next, nextP, slot, c.vehicle);
          if (!trafficSpace.canMove(slot, target)) continue;
          c.li++;
          c.p = nextP;
          c.stuck = 0;
          trafficSpace.set(slot, target);
          if (c.p < laneTail[nextKey]) laneTail[nextKey] = c.p;
          if (c.p < laneFresh[nextKey]) laneFresh[nextKey] = c.p;
          leaderP = Infinity;
          break;
        }
      }
      if (slots[slot] && c.stuck > 30) {
        gaveUp++;
        commuteAvg = commuteAvg * 0.97 + 90 * 0.03;
        freeCar(slot);
      }
    }
  }
  for (let i = 0; i < segs.length; i++) {
    const target = speedN[i] ? 1 - speedSum[i] / speedN[i] : 0;
    segCong[i] += (target - segCong[i]) * (speedN[i] ? 0.04 : 0.02);
  }
}

function writeFrame(): void {
  const out = new Float32Array(MAX_CARS * 4);
  const carHeights = new Float32Array(MAX_CARS);
  const carPitch = new Float32Array(MAX_CARS);
  const carIds = new Uint32Array(MAX_CARS);
  spawnSpace.clear();
  const half = GRID / 2;
  for (let s = 0; s < MAX_CARS; s++) {
    const c = slots[s];
    const o = s * 4;
    if (!c) continue;
    const world = trafficSpace.poses.get(s) ?? carPose(c.legs[c.li], c.p, s, c.vehicle);
    out[o] = world.x - half;
    out[o + 1] = world.z - half;
    out[o + 2] = world.angle;
    out[o + 3] = c.vehicle;
    carHeights[s] = world.y ?? 0;
    const leg = c.legs[c.li], seg = segs[leg.seg], d = leg.fwd ? c.p : seg.len - c.p;
    carPitch[s] = Math.atan((roadHeight(seg, Math.min(seg.len, d + 0.1)) - roadHeight(seg, Math.max(0, d - 0.1))) / 0.2) * (leg.fwd ? -1 : 1);
    carIds[s] = c.uid; spawnSpace.set(s, world);
  }
  const cong = new Uint8Array(segs.length);
  for (let i = 0; i < segs.length; i++) cong[i] = Math.min(255, (segCong[i] * 255) | 0);
  post({ type: 'frame', carHeights, carPitch, carIds, cars: out, segCong: cong, serial, simTime, cityTime: tick + subCount / SIM_HZ }, [out.buffer, carIds.buffer, cong.buffer, carHeights.buffer, carPitch.buffer]);
}

// ---- census, utilities, pollution, growth --------------------------------------------------------
function census(): void {
  pop = 0; comJobs = 0; indJobs = 0; officeJobs = 0; buildings = 0;
  resTiles = []; resW = []; jobTiles = []; jobW = [];
  let rw = 0, jw = 0;
  let capP = 0, capW = 0, capS = 0, needP = 0, needW = 0, upkeep = 0;
  let dirtyCap = 0;
  const outlets: { flow: number; cap: number; treatment: number }[] = [];
  treatedSewage = 0;

  // Services first: capacity only counts when the building is on the road network and sited correctly.
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isService(k)) continue;
    const spec = SERVICES[k];
    const budget = serviceFunding(spec, funding);
    const output = fundingOutput(budget);
    upkeep += spec.upkeep * budget;
    flags[i] = 0;
    const x = i % GRID, z = (i / GRID) | 0;
    const sited = !spec.needsWater || touchesWater(terrain, x, z);
    if (!tileConnected(i) || !sited) { flags[i] = F_NO_ROAD; continue; }
    capP += spec.power * output;
    capW += spec.water * output;
    capS += spec.sewage * output;
    if (spec.civic || spec.transport || spec.treatment) { needP += spec.transport === 'air' ? 30 : 3; needW += 2; }
    if (k === T_PUMP) {
      const f = adjacentFlow(terrain, x, z);
      if (f >= 0 && riverPollution[f] > 0.25) dirtyCap += spec.water * output;
    } else if (k === T_TOWER) {
      if (pollution[i] > 5) dirtyCap += spec.water * output;
    } else if (k === T_OUTLET || k === T_TREATMENT) {
      outlets.push({ flow: adjacentFlow(terrain, x, z), cap: spec.sewage * output, treatment: spec.treatment ?? 0 });
    }
  }

  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isZone(k)) { if (!isService(k)) flags[i] = 0; continue; }
    const l = level[i];
    if (l > 0) buildings++;
    const ok = tileConnected(i);
    const zi = k - T_RES;
    if (l > 0 && ok) {
      needP += POWER_DEMAND[zi][l];
      needW += WATER_DEMAND[zi][l];
    }
    if (k === T_RES) {
      pop += RES_POP[l];
      if (l > 0 && ok) { rw += l; resTiles.push(i); resW.push(rw); }
    } else if (k === T_COM) {
      comJobs += COM_JOBS[l];
      if (l > 0 && ok) { jw += l * 1.4; jobTiles.push(i); jobW.push(jw); }
    } else if (k === T_OFFICE) {
      officeJobs += OFFICE_JOBS[l];
      if (l > 0 && ok) { jw += l * 1.2; jobTiles.push(i); jobW.push(jw); }
    } else {
      indJobs += IND_JOBS[l];
      if (l > 0 && ok) { jw += l; jobTiles.push(i); jobW.push(jw); }
    }
  }

  const fP = needP > 0 ? Math.min(1, capP / needP) : 1;
  const fW = needW > 0 ? Math.min(1, capW / needW) : 1;
  const fS = needW > 0 ? Math.min(1, capS / needW) : 1;
  power = [Math.round(needP), capP];
  water = [Math.round(needW), capW];
  sewage = [Math.round(needW), capS];
  dirtyShare = capW > 0 ? dirtyCap / capW : 0;

  let resN = 0, resUnserved = 0, polSum = 0;
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isZone(k) && !SERVICES[k]?.civic && !SERVICES[k]?.transport && !SERVICES[k]?.treatment) continue;
    let f = 0;
    if (!tileConnected(i)) f |= F_NO_ROAD;
    else if (level[i] > 0) {
      const h = tileHash(i);
      if (h >= fP) f |= F_NO_POWER;
      if (tileHash(i + 7919) >= fW) f |= F_NO_WATER;
      if (tileHash(i + 104729) >= fS) f |= F_NO_SEWAGE;
    }
    flags[i] = f;
    if (k === T_RES && level[i] > 0) {
      resN++;
      if (f) resUnserved++;
      polSum += pollution[i];
    }
  }
  unservedRes = resN ? resUnserved / resN : 0;
  resPollution = resN ? polSum / resN : 0;

  // Sewage dumped in the river drifts downstream and fades.
  riverPollution.fill(0);
  const load = capS > 0 ? Math.min(1, needW / capS) : 0;
  for (const o of outlets) {
    if (o.flow < 0) continue;
    const filtered = o.treatment * fP;
    treatedSewage += o.cap * load * filtered;
    for (let j = o.flow; j < riverPollution.length; j++) {
      riverPollution[j] = Math.min(1, riverPollution[j] + (o.cap * load / 1500) * (1 - filtered) * Math.exp(-(j - o.flow) / 70));
    }
  }

  civicState = civicCoverage(kind, level, tileConnected, civicEfficiency);
  const civic = civicState.average;
  const needs = cityLevel >= 2 ? ['health', 'education', 'fire', 'safety', 'waste'] as const : cityLevel >= 1 ? ['health', 'education'] as const : [];
  const serviceScore = needs.length ? needs.reduce((sum, k) => sum + civic[k], 0) / needs.length : 70;
  const crimePenalty = buildings ? incidents.crime.reduce((sum, v) => sum + v, 0) / buildings * 0.4 : 0;
  happiness = Math.round(clamp(55 + effects.happiness - crimePenalty + serviceScore * 0.3 + civic.leisure * 0.15 - unservedRes * 25 - dirtyShare * 25 - resPollution * 3 - Math.max(0, tax - 10) * 1.5 - Math.max(0, commuteAvg - 25) * 0.3, 0, 100));
  const jobs = comJobs + indJobs + officeJobs;
  const taxPenalty = (tax - 10) / 40;
  const commutePenalty = clamp((commuteAvg - 25) / 50, 0, 1);
  const balance = (jobs - pop) / Math.max(60, pop + jobs);
  demand[0] = clamp((happiness - 65) / 160 + 0.3 + 0.7 * balance - taxPenalty - 0.6 * commutePenalty - 0.4 * unservedRes - 0.5 * dirtyShare - resPollution / 12, -1, 1);
  demand[1] = clamp(0.25 + 0.7 * (pop * 0.4 - comJobs) / Math.max(50, pop * 0.4 + comJobs) - taxPenalty, -1, 1);
  demand[2] = clamp(0.25 + 0.7 * (pop * 0.5 - indJobs) / Math.max(50, pop * 0.5 + indJobs) - taxPenalty, -1, 1);
  demand[3] = cityLevel >= OFFICE_UNLOCK ? clamp(0.2 + (pop * 0.35 - officeJobs) / Math.max(60, pop * 0.35 + officeJobs) * 0.6 + civic.education / 250 - taxPenalty, -1, 1) : -1;
  const signature = `${serial}:` + Array.from(kind, (k, i) => SERVICES[k]?.transport && !flags[i] ? i : '').filter(String).join(',');
  if (signature !== transitSignature) {
    const gates = entryNodes.map(n => entrySite(nodeX[n], nodeZ[n]));
    transit = transitNetwork(kind, i => tileConnected(i) && flags[i] === 0, (a, b) => kind[a] === T_STATION ? component[segA[accSeg[a]]] === component[segA[accSeg[b]]] : !!route(accSeg[a], accS[a], accSeg[b], accS[b]), gates);
    transitSignature = signature; transitTokens = transit.lines.map(() => 0); transitDepartures = transit.lines.map(() => 12);
    for (let i = 0; i < slots.length; i++) if (slots[i]?.line !== undefined) freeCar(i);
  }
  riders = Math.round(riderWindow); airPassengers = Math.round(airWindow); railPassengers = Math.round(railWindow);
  fareIncome = (riderWindow / 60 * 0.08 + airWindow / 60 * 0.2 + railWindow / 60 * 0.12) * effects.fare;
  tollIncome = tollWindow / 60 * effects.toll;
  tripRate = rw * 0.022;
  extRate = entries.length ? (rw + jw) * 0.005 : 0;

  // Disconnected buildings do not pay taxes; utility failures reduce economic output.
  taxIncome = 0;
  for (let i = 0; i < N_TILES; i++) {
    if (!isZone(kind[i]) || !level[i] || (flags[i] & F_NO_ROAD)) continue;
    const amount = kind[i] === T_RES ? RES_POP[level[i]] * 0.012 : (kind[i] === T_COM ? COM_JOBS[level[i]] : kind[i] === T_OFFICE ? OFFICE_JOBS[level[i]] : IND_JOBS[level[i]]) * 0.015;
    const operating = (flags[i] & (F_NO_POWER | F_NO_WATER | F_NO_SEWAGE)) ? 0.5 : 1;
    taxIncome += amount * operating * tax / 10 * (1 - incidents.crime[i] / 200) * (incidents.fires.has(i) ? 0 : 1);
  }
  policyCost = policyExpense(policies, pop);
  serviceExpense = upkeep;
  loanExpense = Math.min(LOAN_PAYMENT, debt);
  netIncome = taxIncome - roadUpkeep - serviceExpense - policyCost - loanExpense;
}

function civicEfficiency(i: number): number {
  const spec = SERVICES[kind[i]];
  if (!spec?.civic || flags[i] & (F_NO_ROAD | F_NO_POWER | F_NO_WATER | F_NO_SEWAGE)) return 0;
  const congestion = accSeg[i] >= 0 ? segCong[accSeg[i]] ?? 0 : 1;
  const grants = spec.civic === 'education' ? effects.educationCapacity : 1;
  return fundingOutput(serviceFunding(spec, funding)) * (1 - 0.5 * Math.min(1, congestion)) * grants;
}

function spreadPollution(): void {
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (k === T_IND) pollution[i] += IND_POLLUTION[level[i]] * effects.industryPollution;
    else if (isService(k)) pollution[i] += SERVICES[k].pollution;
  }
  for (let i = 0; i < N_TILES; i++) {
    let sum = 0;
    for (let d = 0; d < 4; d++) {
      const n = neighbor(i, d);
      sum += n >= 0 ? pollution[n] : pollution[i];
    }
    let v = (pollution[i] * 0.6 + sum * 0.1) * 0.965;
    if (terrain.water[i]) v *= 0.3;
    pollutionTmp[i] = v < 0.01 ? 0 : v;
  }
  const t = pollution;
  pollution = pollutionTmp;
  pollutionTmp = t;
}

/** City-block distance from each tile to the nearest shop or office, capped at 15. */
const shopDistance = new Uint8Array(N_TILES);
function measureShopDistance(): void {
  for (let i = 0; i < N_TILES; i++) shopDistance[i] = kind[i] === T_COM || kind[i] === T_OFFICE ? 0 : 15;
  for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
    const i = z * GRID + x;
    if (x > 0) shopDistance[i] = Math.min(shopDistance[i], shopDistance[i - 1] + 1);
    if (z > 0) shopDistance[i] = Math.min(shopDistance[i], shopDistance[i - GRID] + 1);
  }
  for (let z = GRID - 1; z >= 0; z--) for (let x = GRID - 1; x >= 0; x--) {
    const i = z * GRID + x;
    if (x < GRID - 1) shopDistance[i] = Math.min(shopDistance[i], shopDistance[i + 1] + 1);
    if (z < GRID - 1) shopDistance[i] = Math.min(shopDistance[i], shopDistance[i + GRID] + 1);
  }
}
/** Homes densify near commerce: towers within 3 cells, apartments within 6, houses beyond. */
const residentialCap = (i: number): number => shopDistance[i] <= 3 ? 3 : shopDistance[i] <= 6 ? 2 : 1;

function grow(): void {
  measureShopDistance();
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isZone(k)) continue;
    const l = level[i];
    if (incidents.fires.has(i)) continue;
    const f = flags[i];
    if (f & F_NO_ROAD) {
      if (l > 0 && Math.random() < 0.08) { level[i] = l - 1; age[i] = 0; }
      continue;
    }
    // An empty lot the water reaches never builds on: nothing should stand in the river.
    const d = terrain.shore[i] && l === 0 ? 0 : demand[k - T_RES];
    const p = pollution[i];
    const isRes = k === T_RES;
    if (l === 0) {
      const appeal = isRes ? Math.max(0, 1 - p / 6) : 1;
      if (Math.random() < Math.max(0, d) * 0.12 * appeal) {
        level[i] = 1;
        age[i] = 0;
        if (isRes && pendingMoveIns.length < 40) pendingMoveIns.push(i);
      }
      continue;
    }
    age[i] = Math.min(65535, age[i] + 1);
    const underserved = isRes && l > 1 && civicShortfalls(i, l, cityLevel, civicState.coverage, true).length > 0;
    neglect[i] = underserved ? neglect[i] + 1 : 0;
    if (neglect[i] >= NEGLECT_LIMIT) {
      level[i] = l - 1; age[i] = 0; neglect[i] = 0;
      continue;
    }
    const served = (f & (F_NO_ROAD | F_NO_POWER | F_NO_WATER | F_NO_SEWAGE)) === 0;
    const minAge = l === 1 ? 10 : 22;
    const rate = l === 1 ? 0.06 : 0.03;
    const officeReady = k !== T_OFFICE || civicState.average.education >= (l === 1 ? 25 : 50);
    const civicReady = !isRes || civicShortfalls(i, l + 1, cityLevel, civicState.coverage).length === 0;
    const canUp = served && officeReady && civicReady && (l < 2 || cityLevel >= 3) && (!isRes || (p < 3 && l < residentialCap(i)));
    if (l < 3 && age[i] > minAge && canUp && Math.random() < Math.max(0, d) * rate) {
      level[i] = l + 1; age[i] = 0;
      if (isRes && pendingMoveIns.length < 40) pendingMoveIns.push(i);
    } else if (d < -0.15 && Math.random() < -d * 0.05) {
      level[i] = l - 1; age[i] = 0;
    } else if (!served && l > 1 && Math.random() < 0.04) {
      level[i] = l - 1; age[i] = 0;
    } else if (isRes && p > 6 && Math.random() < 0.05) {
      level[i] = l - 1; age[i] = 0;
    }
  }
  if (incidents.robbed > robbedSeen) {
    money -= 1200 * (incidents.robbed - robbedSeen);
    robbedSeen = incidents.robbed;
    post({ type: 'notice', message: 'A robbery got away with $1,200. Police stations respond to alarms nearby.' });
  }
  const progress = advanceCity(cityLevel, pop);
  cityLevel = progress.level;
  money += netIncome + progress.reward;
  debt = Math.max(0, debt - loanExpense);
  tick++;
}

function stats(): Stats {
  return {
    incidents: {
      fires: incidents.fires.size, heists: incidents.heists.size, racers: slots.filter(c => c?.vehicle === 7).length,
      crashes: incidents.crashes.size, crime: incidents.view().crime.length,
      patrols: slots.filter(c => c?.vehicle === 5).length, fireEngines: slots.filter(c => c?.vehicle === 6).length,
      prevented: incidents.prevented, extinguished: incidents.extinguished, damaged: incidents.damaged,
      robbed: incidents.robbed, foiled: incidents.foiled,
    },
    transport: { busLines: transit.lines.filter(l => l.mode === 'bus').length, railLines: transit.lines.filter(l => l.mode === 'rail').length, intercityLines: transit.intercity.length, subwayLines: transit.lines.filter(l => l.mode === 'subway').length, airports: transit.airports.length, riders, airPassengers, railPassengers, fareIncome }, treatedSewage: Math.round(treatedSewage), entries: entryNodes.length,
    funding: { ...funding }, policies: { ...policies }, policyExpense: policyCost, tollIncome, debt, taxIncome, roadExpense: roadUpkeep, serviceExpense, loanExpense, declining: neglect.reduce((n, v) => n + (v > 0 ? 1 : 0), 0),
    cityLevel, happiness, civic: civicState.average,
    money: Math.round(money), pop, jobs: comJobs + indJobs + officeJobs, cars: activeCars, commute: commuteAvg,
    demand: [...demand], tick, roadLength: Math.round(roadLength), buildings,
    noPath, gaveUp, power, water, sewage, dirtyWater: dirtyShare > 0.2, resPollution, income: netIncome + fareIncome + tollIncome,
  };
}

function postState(): void {
  const pol = new Uint8Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) pol[i] = Math.min(255, (pollution[i] * 14) | 0);
  const riv = new Uint8Array(riverPollution.length);
  for (let i = 0; i < riv.length; i++) riv[i] = Math.min(255, (riverPollution[i] * 255) | 0);
  for (let i = 0; i < N_TILES; i++) {
    flags[i] &= ~F_DECLINING;
    if (neglect[i]) flags[i] |= F_DECLINING;
  }
  post({ type: 'state', incidents: incidents.view(), incidentSave: incidents.snapshot(), neglect: neglect.slice(), level: level.slice(), flags: flags.slice(), pollution: pol, riverPollution: riv, stats: stats() });
  postInspection();
}

/** Dispatch from working stations; cars must reach the destination before helping. */
function stepIncidents(): void {
  incidents.step(kind, level, pop, cityLevel, Math.random, { fire: effects.fireRate, crime: effects.crimeRate }, tile => { level[tile] = Math.max(0, level[tile] - 1); age[tile] = 0; });
  for (const [tile, delay] of dispatchCooldown) if (delay <= 1) dispatchCooldown.delete(tile); else dispatchCooldown.set(tile, delay - 1);
  // An occasional two-vehicle collision blocks the occupied lane until police or recovery clear it.
  if (cityLevel >= 2 && activeCars > 12 && incidents.crashes.size < 2 && Math.random() < 0.018) {
    const candidates = [...trafficSpace.poses.keys()].filter(id => slots[id] && !slots[id]!.mission && slots[id]!.crash === undefined);
    const pairs: [number, number][] = [];
    for (let n = 0; n < candidates.length; n++) {
      const a = candidates[n], first = trafficSpace.poses.get(a)!;
      const b = candidates.slice(n + 1).find(id => Math.abs((trafficSpace.poses.get(id)!.y ?? 0) - (first.y ?? 0)) < 0.6 && Math.hypot(trafficSpace.poses.get(id)!.x - first.x, trafficSpace.poses.get(id)!.z - first.z) < 0.95);
      if (b !== undefined) pairs.push([a, b]);
    }
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    // A calmed street rarely produces a collision: that is what the drivers slowed down for.
    if (pair && !(slots[pair[0]] && segs[slots[pair[0]]!.legs[slots[pair[0]]!.li].seg]?.calm && Math.random() < 0.8)) {
      const [a, second] = pair, first = trafficSpace.poses.get(a)!;
      const tile = Math.max(0, Math.min(N_TILES - 1, Math.floor(first.z) * GRID + Math.floor(first.x)));
      const crash = incidents.crash(first.x, first.z, [a, second], tile, first.y ?? 0);
      slots[a]!.crash = crash; slots[second]!.crash = crash;
    }
  }

  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    const police = k === T_POLICE || k === T_POLICE_HQ;
    if ((k !== T_FIRE && !police) || flags[i] || !tileConnected(i) || dispatchCooldown.has(i) || slots.filter(c => c?.mission?.origin === i).length >= (k === T_POLICE_HQ ? 2 : 1)) continue;
    let mission: Mission | undefined;
    if (k === T_FIRE) {
      const targets = [...incidents.fires.keys()].filter(tile => !slots.some(c => c?.mission?.kind === 'fire' && c.mission.tile === tile)).sort((a, b) => distance(a, i) - distance(b, i));
      for (const tile of targets) if (tileConnected(tile) && route(accSeg[i], accS[i], accSeg[tile], accS[tile])) { mission = { kind: 'fire', origin: i, tile, work: 8 }; break; }
    } else {
      const robbery = [...incidents.heists.keys()].find(tile => tileConnected(tile) && !slots.some(car => car?.mission?.kind === 'heist' && car.mission.tile === tile));
      if (robbery !== undefined && route(accSeg[i], accS[i], accSeg[robbery], accS[robbery])) mission = { kind: 'heist', origin: i, tile: robbery, work: 5 };
      const crash = mission ? undefined : [...incidents.crashes.values()].find(c => !slots.some(car => car?.mission?.crash === c.id));
      if (!mission && crash) {
        const near = [...resTiles, ...jobTiles].filter(t => tileConnected(t)).sort((a, b) => distance(a, crash.tile) - distance(b, crash.tile))[0];
        if (near !== undefined && distance(near, crash.tile) < 6) mission = { kind: 'crash', origin: i, tile: near, crash: crash.id, work: 4 };
      }
      if (!mission) {
        const targets = [...resTiles, ...jobTiles].filter(t => distance(t, i) < SERVICES[k].radius!);
        const tile = targets[Math.floor(Math.random() * targets.length)];
        if (tile !== undefined) mission = { kind: 'patrol', origin: i, tile, work: 4 };
      }
    }
    if (mission && spawnTrip(accSeg[i], accS[i], accSeg[mission.tile], accS[mission.tile], k === T_FIRE ? 6 : 5, undefined, mission)) dispatchCooldown.set(i, k === T_FIRE ? 8 : 18);
  }
}

// ---- main loop -----------------------------------------------------------------------------------
function substep(): void {
  const dt = 1 / SIM_HZ;
  simTime += dt;
  stepCars(dt);
  spawn(dt);
  subCount++;
  if (subCount >= SIM_HZ) {
    subCount = 0;
    stepIncidents();
    spreadPollution();
    census();
    grow();
    census();
    postState();
    noPath = 0;
    gaveUp = 0;
  }
}

setInterval(() => {
  if (speed === 0) return;
  for (let s = 0; s < speed; s++) substep();
  writeFrame();
}, 1000 / SIM_HZ);

function applyKind(nk: Uint8Array): void {
  for (let i = 0; i < N_TILES; i++) {
    if (nk[i] !== kind[i]) {
      kind[i] = nk[i];
      level[i] = isService(nk[i]) ? 1 : 0;
      age[i] = 0;
      neglect[i] = 0;
    }
  }
}

self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'load': {
      terrain = generateTerrain(m.seed);
      riverPollution = new Float32Array(terrain.river.length);
      clearCars();
      segs = [];
      segCong = new Float32Array(0);
      kind.set(m.kind);
      level.set(m.level);
      age.fill(0);
      neglect.set(m.neglect ?? new Uint8Array(N_TILES));
      funding = { ...defaultFunding(), ...m.funding };
      policies = { ...noPolicies(), ...m.policies };
      effects = policyEffects(policies);
      debt = m.debt ?? 0;
      incidents.load(m.incidents); dispatchCooldown.clear(); robbedSeen = 0; raceUntil = -1;
      // A loaded city starts its own clock: signal phases should not depend on what ran before it.
      simTime = 0;
      inspected = -1;
      post({ type: 'inspection', report: null });
      pollution.fill(0);
      pendingMoveIns = [];
      riderWindow = 0; airWindow = 0; railWindow = 0; tollWindow = 0; airTokens = 0; railTokens = 0; transitSignature = '';
      cityLevel = m.cityLevel;
      money = m.money;
      subCount = 0;
      tick = m.tick;
      tax = m.tax;
      commuteAvg = 0;
      spawnBudget = 0;
      extBudget = 0;
      applyNetwork(m);
      census();
      postState();
      writeFrame();
      break;
    }
    case 'edit': {
      applyKind(m.kind);
      applyNetwork(m);
      money -= m.spent;
      census();
      postState();
      writeFrame();
      break;
    }
    case 'speed':
      speed = m.value;
      break;
    case 'tax':
      tax = clamp(Math.round(m.value), 0, 30);
      census(); postState();
      break;
    case 'funding':
      if (!FUNDING_KEYS.includes(m.key) || !validFunding(m.value)) break;
      funding[m.key] = m.value;
      census(); postState();
      break;
    case 'policy':
      if (!isPolicyId(m.id)) break;
      if (m.on && cityLevel < POLICIES[m.id].unlock) {
        post({ type: 'notice', message: `${POLICIES[m.id].label} unlocks at city level ${POLICIES[m.id].unlock + 1}.` });
        break;
      }
      policies[m.id] = m.on;
      effects = policyEffects(policies);
      census(); postState();
      break;
    case 'loan':
      if (m.action === 'take' && debt === 0) {
        money += LOAN_AMOUNT; debt = LOAN_TOTAL;
        post({ type: 'notice', message: '$6,000 received. Repayment: $6/s for 1,100 simulation seconds.' });
      } else if (m.action === 'repay' && debt > 0 && money >= debt) {
        money -= debt; debt = 0;
        post({ type: 'notice', message: 'City loan repaid.' });
      } else post({ type: 'notice', message: debt > 0 ? 'Repay the existing loan before borrowing again. Early repayment needs enough cash.' : 'No outstanding loan.' });
      census(); postState();
      break;
    case 'inspect':
      inspected = Number.isInteger(m.tile) && m.tile >= 0 && m.tile < N_TILES ? m.tile : -1;
      postInspection();
      break;
    case 'warm': {
      commuteAvg = 0;
      for (let n = 0; n < m.ticks; n++) { spreadPollution(); census(); grow(); }
      pendingMoveIns = [];
      census();
      postState();
      break;
    }
  }
};


/** Explain the same local requirements used by growth, without duplicating the simulation in the UI. */
function postInspection(): void {
  if (inspected < 0) { post({ type: 'inspection', report: null }); return; }
  const i = inspected, k = kind[i], l = level[i], spec = SERVICES[k];
  const report: TileReport = {
    tile: i, name: spec?.name ?? (k === T_RES ? 'Residential' : k === T_COM ? 'Commercial' : k === T_IND ? 'Industrial' : k === T_OFFICE ? 'Offices' : terrain.water[i] ? 'River' : cover[i] ? 'Road' : 'Unzoned land'),
    level: l, occupants: k === T_RES ? RES_POP[l] : k === T_COM ? COM_JOBS[l] : k === T_IND ? IND_JOBS[l] : k === T_OFFICE ? OFFICE_JOBS[l] : 0,
    status: 'Ready to zone or build', details: [], blockers: [], coverage: {}, neglect: neglect[i],
  };
  const f = flags[i];
  if (isZone(k) || spec) {
    for (const [flag, message] of [[F_NO_ROAD, 'Connect this building to the highway'], [F_NO_POWER, 'Restore electricity'], [F_NO_WATER, 'Restore water supply'], [F_NO_SEWAGE, 'Restore sewage capacity']] as const) if (f & flag) report.blockers.push(message);
    if (incidents.fires.has(i)) report.blockers.push(`Building on fire: ${120 - incidents.fires.get(i)!.age}s before damage. Needs a responding fire engine.`);
    report.details.push(`Crime pressure: ${Math.round(incidents.crime[i])}% · patrol protection: ${Math.ceil(incidents.patrol[i])}s`);
    report.details.push(`Ground pollution: ${pollution[i].toFixed(1)}`);
  }
  if (isZone(k)) {
    report.status = l === 0 ? 'Waiting for construction' : l === 3 ? 'Maximum building level' : `Level ${l} → ${l + 1}`;
    if (demand[k - T_RES] <= 0 && l < 3) report.blockers.push('Demand is too low: balance homes, jobs and taxes');
    if (k === T_RES) {
      for (const key of Object.keys(CIVIC_LABELS) as CivicNeed[]) report.coverage[key] = Math.round(civicState.coverage[key][i] * 100);
      if (l > 0 && l < 3) report.blockers.push(...civicShortfalls(i, l + 1, cityLevel, civicState.coverage));
      if (pollution[i] >= (l ? 3 : 6)) report.blockers.push('Move polluting industry away from homes');
      if (neglect[i]) {
        report.status = `Service decline: ${NEGLECT_LIMIT - neglect[i]}s to downgrade`;
        report.blockers.push(...civicShortfalls(i, l, cityLevel, civicState.coverage, true));
      }
    }
    if (k === T_OFFICE && l > 0 && l < 3 && civicState.average.education < (l === 1 ? 25 : 50)) report.blockers.push(`Offices need ${l === 1 ? 25 : 50}% city education coverage to upgrade`);
    if (l === 2 && cityLevel < 3) report.blockers.push('High-rises unlock at Thriving town (900 residents)');
    if (l > 0 && l < 3 && age[i] <= (l === 1 ? 10 : 22)) report.blockers.push(`Maturing: ${(l === 1 ? 11 : 23) - age[i]}s remaining`);
    if (l < 3 && report.blockers.length === 0) report.details.push('Eligible for growth; construction occurs gradually.');
    report.details.push(`Zone demand: ${Math.round(demand[k - T_RES] * 100)}%`);
  } else if (spec) {
    const budget = serviceFunding(spec, funding);
    const efficiency = spec.civic ? civicEfficiency(i) : f ? 0 : fundingOutput(budget);
    report.status = efficiency > 0 ? 'Operating' : 'Not operating';
    report.details.push(`Funding: ${Math.round(budget * 100)}% · upkeep $${(spec.upkeep * budget).toFixed(2)}/s`);
    if (spec.civic) report.details.push(`Effective capacity: ${Math.round(spec.capacity! * efficiency)} residents · range ${spec.radius} cells`, 'Needs 3 power and 2 water; congestion can reduce capacity by up to 50%.');
    else if (spec.transport) {
      const lines = transit.lines.filter(line => line.a === i || line.b === i);
      report.details.push(spec.transport === 'air' ? 'Regional flights replace some incoming road trips within 24 cells. Needs power, water and sewage.' : `${lines.length} active automatic connections · ${spec.radius}-cell walking catchment`);
      if (spec.transport !== 'air' && !lines.length) report.blockers.push('Add a second operating stop or station; bus stops need a road route in both directions');
      if (spec.transport === 'bus') report.details.push('30 passenger capacity per connection; traffic slows service. Buses depart automatically.');
      if (spec.transport === 'subway') report.details.push('100 passenger capacity per connection; underground tunnels link metro stations automatically, unaffected by traffic.');
      if (spec.transport === 'rail') report.details.push('120 passenger capacity per connection; elevated tracks connect stations automatically.');
    } else report.details.push(`Capacity: ${Math.round((spec.power || spec.water || spec.sewage) * efficiency)} ${spec.power ? 'power' : spec.water ? 'water' : 'sewage'}`);
  }
  if (k === T_POLICE_HQ) report.details.push('Runs two patrol cars at once across a wider district, and answers robberies first.');
  if (k === T_POLICE) report.details.push('Dispatches patrol cars to nearby buildings. Completed visits deter crime for three minutes; cars also respond to collisions.');
  if (k === T_FIRE) report.details.push('Dispatches one fire engine at a time to reachable fires. After arrival, firefighting takes eight seconds.');
  if (spec?.treatment) report.details.push('Filters 95% of effluent with full electricity. Power shortages reduce filtration.');
  report.blockers = [...new Set(report.blockers)];
  post({ type: 'inspection', report });
}
