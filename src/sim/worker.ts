import {
  GRID, N_TILES, MAX_CARS, SIM_HZ, T_RES, T_COM, T_IND, T_PUMP, T_TOWER, T_OUTLET,
  RES_POP, COM_JOBS, IND_JOBS, POWER_DEMAND, WATER_DEMAND, IND_POLLUTION, SERVICES, START_MONEY, ROAD_UPKEEP,
  F_NO_POWER, F_NO_WATER, F_NO_SEWAGE, F_NO_ROAD, isZone, isService, neighbor, tileHash,
} from '../constants';
import { Network, SPEED, KIND_AVENUE, isGreen } from '../roads/network';
import type { RSeg, Pose } from '../roads/network';
import { generateTerrain, touchesWater, adjacentFlow } from '../terrain';
import type { Terrain } from '../terrain';
import type { EditPayload, MainToWorker, Stats } from './messages';

const post = (self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage.bind(self);

// ---- city state --------------------------------------------------------------------------
const kind = new Uint8Array(N_TILES);
const level = new Uint8Array(N_TILES);
const age = new Uint16Array(N_TILES);
const flags = new Uint8Array(N_TILES);
let cover: Uint8Array = new Uint8Array(N_TILES);
let accSeg = new Int32Array(N_TILES).fill(-1); // segment *index* after remapping, -1 if none
let accS: Float32Array = new Float32Array(N_TILES);
let pollution = new Float32Array(N_TILES);
let pollutionTmp = new Float32Array(N_TILES);
let terrain: Terrain = generateTerrain(1);
let riverPollution = new Float32Array(terrain.river.length);

let money = START_MONEY;
let tick = 0;
let tax = 10;
let speed = 1;
let simTime = 0;
let pop = 0, comJobs = 0, indJobs = 0, buildings = 0;
let commuteAvg = 0;
let noPath = 0, gaveUp = 0;
let subCount = 0;
let netIncome = 0;
const demand: [number, number, number] = [0, 0, 0];
let power: [number, number] = [0, 0];
let water: [number, number] = [0, 0];
let sewage: [number, number] = [0, 0];
let dirtyShare = 0;
let resPollution = 0;
let unservedRes = 0;
let pendingMoveIns: number[] = [];

// ---- road graph snapshot --------------------------------------------------------------------
const J_PLAIN = 0, J_YIELD = 1, J_LIGHT = 2, J_RING = 3;
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
let lockCount = new Int8Array(0);
let lockCap = new Int8Array(0);
let reach = new Uint8Array(0);
let entryNode = -1;
let entrySeg = -1;
let entryS = 0;
let segCong = new Float32Array(0);
let roadUpkeep = 0;
let roadLength = 0;

// ---- cars ---------------------------------------------------------------------------------------
interface Leg { seg: number; fwd: boolean; p0: number; p1: number }
interface Car { legs: Leg[]; li: number; p: number; time: number; stuck: number; lock: number; lockLi: number }
const slots: (Car | null)[] = new Array(MAX_CARS).fill(null);
const freeList: number[] = [];
for (let i = MAX_CARS - 1; i >= 0; i--) freeList.push(i);
let activeCars = 0;
let laneCars: number[][] = [];
let laneTail = new Float32Array(0);
let spawnBudget = 0;
let extBudget = 0;
let tripRate = 0;
let extRate = 0;

let resTiles: number[] = [], resW: number[] = [];
let jobTiles: number[] = [], jobW: number[] = [];

const GAP = [0.62, 0.36];
const pose: Pose = { x: 0, z: 0, tx: 0, tz: 0 };

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
  entryNode = -1;
  for (const n of net.nodes.values()) {
    nodeIndex.set(n.id, nodeIds.length);
    nodeIds.push(n.id);
    nodeX.push(n.x);
    nodeZ.push(n.z);
    nodeEdges.push([]);
    nodeGroups.push(new Map());
    const deg = net.degree(n.id);
    nodeType.push(n.ring ? J_RING : deg >= 3 ? (n.light ? J_LIGHT : J_YIELD) : J_PLAIN);
    if (n.entry) entryNode = nodeIds.length - 1;
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
    if (!s.fixed) roadUpkeep += s.len * ROAD_UPKEEP * (s.kind === KIND_AVENUE ? 2 : 1);
    roadLength += s.len;
  });
  lockCount = new Int8Array(nodeIds.length);
  lockCap = new Int8Array(nodeIds.length).fill(1);
  nodeIds.forEach((id, ni) => {
    if (nodeType[ni] === J_LIGHT) {
      for (const [sid, g] of net.lightGroups(id)) nodeGroups[ni].set(segIndex.get(sid)!, g);
    }
    if (net.segsAt(id).some((s) => s.kind === KIND_AVENUE)) lockCap[ni] = 2;
  });

  // Reachability from the highway entry (ignoring one-way direction).
  reach = new Uint8Array(nodeIds.length);
  entrySeg = -1;
  if (entryNode >= 0) {
    const und: number[][] = nodeIds.map(() => []);
    newSegs.forEach((_, i) => { und[segA[i]].push(segB[i]); und[segB[i]].push(segA[i]); });
    const stack = [entryNode];
    reach[entryNode] = 1;
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of und[n]) if (!reach[m]) { reach[m] = 1; stack.push(m); }
    }
    newSegs.forEach((s, i) => {
      if (segA[i] === entryNode) { entrySeg = i; entryS = 0; }
      else if (segB[i] === entryNode && entrySeg < 0) { entrySeg = i; entryS = s.len; }
    });
  }

  // Carry congestion over for surviving segments; drop cars whose route touched a changed segment.
  const newCong = new Float32Array(newSegs.length);
  const remap = new Int32Array(segs.length).fill(-1);
  segs.forEach((s, i) => {
    const ni = segIndex.get(s.id);
    if (ni === undefined) return;
    const ns = newSegs[ni];
    if (Math.abs(ns.len - oldLens[i]) > 1e-3 || ns.a !== oldA[i]) return;
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
  return (segs[i].len / SPEED[segs[i].kind]) * (1 + 2.5 * segCong[i]);
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
  const vS = SPEED[S.kind];
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
  const vG = SPEED[G.kind];

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
      const penalty = t === J_LIGHT ? 2.5 : t === J_YIELD ? 0.8 : 0;
      relax(e.to, g + segTime(e.seg) + penalty, cur, e.seg, e.fwd);
    }
  }
  return null;
}

// ---- car lifecycle --------------------------------------------------------------------------------
function freeCar(slot: number): void {
  const c = slots[slot];
  if (!c) return;
  if (c.lock >= 0 && c.lock < lockCount.length && lockCount[c.lock] > 0) lockCount[c.lock]--;
  slots[slot] = null;
  freeList.push(slot);
  activeCars--;
}

function clearCars(): void {
  for (let s = 0; s < MAX_CARS; s++) if (slots[s]) freeCar(s);
  lockCount.fill(0);
}

function spawnTrip(sSeg: number, sS: number, gSeg: number, gS: number): boolean {
  if (!freeList.length || sSeg < 0 || gSeg < 0) return false;
  const legs = route(sSeg, sS, gSeg, gS);
  if (!legs || legs.length === 0) { noPath++; return false; }
  const slot = freeList.pop()!;
  slots[slot] = { legs, li: 0, p: legs[0].p0, time: 0, stuck: 0, lock: -1, lockLi: -1 };
  activeCars++;
  return true;
}

function spawn(dt: number): void {
  spawnBudget = Math.min(8, spawnBudget + tripRate * dt);
  extBudget = Math.min(4, extBudget + extRate * dt);
  let n = 0;
  while (spawnBudget >= 1 && n < 4 && freeList.length && resTiles.length && jobTiles.length) {
    spawnBudget -= 1;
    n++;
    const o = pickWeighted(resTiles, resW);
    const d = pickWeighted(jobTiles, jobW);
    spawnTrip(accSeg[o], accS[o], accSeg[d], accS[d]);
  }
  if (entrySeg < 0) return;
  while (extBudget >= 1 && n < 6 && freeList.length) {
    extBudget -= 1;
    n++;
    // Outside workers drive in when there are spare jobs; residents drive out when there are not enough.
    const inbound = comJobs + indJobs > pop * 0.5 ? Math.random() < 0.7 : Math.random() < 0.3;
    if (inbound && jobTiles.length) {
      const d = pickWeighted(jobTiles, jobW);
      spawnTrip(entrySeg, entryS, accSeg[d], accS[d]);
    } else if (resTiles.length) {
      const o = pickWeighted(resTiles, resW);
      spawnTrip(accSeg[o], accS[o], entrySeg, entryS);
    }
  }
  // New residents arrive by road.
  while (pendingMoveIns.length && n < 8 && freeList.length) {
    const t = pendingMoveIns.pop()!;
    n++;
    if (accSeg[t] >= 0) spawnTrip(entrySeg, entryS, accSeg[t], accS[t]);
  }
}

function stepCars(dt: number): void {
  for (const lane of laneCars) lane.length = 0;
  laneTail.fill(1e9);
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
    let leaderP = Infinity;
    for (const slot of lane) {
      const c = slots[slot]!;
      const leg = c.legs[c.li];
      const seg = segs[leg.seg];
      const v = SPEED[seg.kind];
      const gap = GAP[seg.kind];
      c.time += dt;

      // Release a junction lock once clear of the box.
      if (c.lock >= 0 && c.li > c.lockLi && c.p > Math.min(0.8, seg.len * 0.5)) {
        if (lockCount[c.lock] > 0) lockCount[c.lock]--;
        c.lock = -1;
      }

      let maxP = leaderP - gap;
      const final = c.li === c.legs.length - 1;
      if (final) {
        maxP = Math.min(maxP + gap, leg.p1); // arriving cars pull off the road, so ignore the gap
      } else {
        const node = leg.fwd ? segB[leg.seg] : segA[leg.seg];
        const stopP = seg.len > 1.8 ? seg.len - 0.85 : seg.len * 0.5;
        const pastStop = c.p > stopP + 1e-3;
        const next = c.legs[c.li + 1];
        const nextKey = next.seg * 2 + (next.fwd ? 0 : 1);
        let canGo = laneTail[nextKey] > GAP[segs[next.seg].kind] + 0.15;
        const type = nodeType[node];
        if (type === J_LIGHT && !pastStop) {
          const g = nodeGroups[node].get(leg.seg) ?? 0;
          if (!isGreen(simTime, nodeIds[node], g)) canGo = false;
        } else if (type === J_YIELD && c.lock !== node) {
          if (canGo && c.p >= stopP - 0.3 && lockCount[node] < lockCap[node]) {
            c.lock = node;
            c.lockLi = c.li;
            lockCount[node]++;
          } else {
            canGo = false;
          }
        }
        if (!canGo) maxP = Math.min(maxP, pastStop ? seg.len - 0.02 : stopP);
      }

      let newP = Math.min(c.p + v * dt, maxP);
      if (newP < c.p) newP = c.p;
      const moved = newP - c.p;
      speedSum[leg.seg] += moved / (v * dt);
      speedN[leg.seg]++;
      if (moved < 1e-4) c.stuck += dt; else c.stuck = 0;
      c.p = newP;
      leaderP = newP;

      if (final) {
        if (c.p >= leg.p1 - 1e-3) {
          commuteAvg = commuteAvg === 0 ? c.time : commuteAvg * 0.97 + c.time * 0.03;
          freeCar(slot);
          leaderP = Infinity;
        }
      } else if (c.p >= seg.len - 1e-4) {
        const carry = c.p - seg.len;
        c.li++;
        const next = c.legs[c.li];
        c.p = next.p0 + Math.max(0, carry);
        const nextKey = next.seg * 2 + (next.fwd ? 0 : 1);
        if (c.p < laneTail[nextKey]) laneTail[nextKey] = c.p;
        leaderP = Infinity;
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
  const half = GRID / 2;
  for (let s = 0; s < MAX_CARS; s++) {
    const c = slots[s];
    const o = s * 4;
    if (!c) continue;
    const leg = c.legs[c.li];
    const seg = segs[leg.seg];
    Network.poseAt(seg, leg.fwd ? c.p : seg.len - c.p, pose);
    const dir = leg.fwd ? 1 : -1;
    const tx = pose.tx * dir;
    const tz = pose.tz * dir;
    let lane: number;
    if (seg.oneway) lane = seg.kind === KIND_AVENUE ? (s & 1 ? 0.3 : -0.3) : (s & 1 ? 0.17 : -0.17);
    else lane = seg.kind === KIND_AVENUE ? (s & 1 ? 0.2 : 0.47) : 0.2;
    out[o] = pose.x - tz * lane - half;
    out[o + 1] = pose.z + tx * lane - half;
    out[o + 2] = Math.atan2(tx, tz);
    out[o + 3] = 1;
  }
  const cong = new Uint8Array(segs.length);
  for (let i = 0; i < segs.length; i++) cong[i] = Math.min(255, (segCong[i] * 255) | 0);
  post({ type: 'frame', cars: out, segCong: cong, serial, simTime }, [out.buffer, cong.buffer]);
}

// ---- census, utilities, pollution, growth --------------------------------------------------------
function census(): void {
  pop = 0; comJobs = 0; indJobs = 0; buildings = 0;
  resTiles = []; resW = []; jobTiles = []; jobW = [];
  let rw = 0, jw = 0;
  let capP = 0, capW = 0, capS = 0, needP = 0, needW = 0, upkeep = 0;
  let dirtyCap = 0;
  const outlets: { flow: number; cap: number }[] = [];

  // Services first: capacity only counts when the building is on the road network and sited correctly.
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isService(k)) continue;
    const spec = SERVICES[k];
    upkeep += spec.upkeep;
    flags[i] = 0;
    const x = i % GRID, z = (i / GRID) | 0;
    const sited = !spec.needsWater || touchesWater(terrain, x, z);
    if (!tileConnected(i) || !sited) { flags[i] = F_NO_ROAD; continue; }
    capP += spec.power;
    capW += spec.water;
    capS += spec.sewage;
    if (k === T_PUMP) {
      const f = adjacentFlow(terrain, x, z);
      if (f >= 0 && riverPollution[f] > 0.25) dirtyCap += spec.water;
    } else if (k === T_TOWER) {
      if (pollution[i] > 5) dirtyCap += spec.water;
    } else if (k === T_OUTLET) {
      outlets.push({ flow: adjacentFlow(terrain, x, z), cap: spec.sewage });
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
    if (!isZone(k)) continue;
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
  const load = Math.min(1, needW / 600);
  for (const o of outlets) {
    if (o.flow < 0) continue;
    for (let j = o.flow; j < riverPollution.length; j++) {
      riverPollution[j] = Math.min(1, riverPollution[j] + (0.35 + 0.65 * load) * Math.exp(-(j - o.flow) / 70));
    }
  }

  const jobs = comJobs + indJobs;
  const taxPenalty = (tax - 10) / 40;
  const commutePenalty = clamp((commuteAvg - 25) / 50, 0, 1);
  const balance = (jobs - pop) / Math.max(60, pop + jobs);
  demand[0] = clamp(0.3 + 0.7 * balance - taxPenalty - 0.6 * commutePenalty - 0.4 * unservedRes - 0.5 * dirtyShare - resPollution / 12, -1, 1);
  demand[1] = clamp(0.25 + 0.7 * (pop * 0.4 - comJobs) / Math.max(50, pop * 0.4 + comJobs) - taxPenalty, -1, 1);
  demand[2] = clamp(0.25 + 0.7 * (pop * 0.5 - indJobs) / Math.max(50, pop * 0.5 + indJobs) - taxPenalty, -1, 1);
  tripRate = rw * 0.022;
  extRate = entrySeg >= 0 ? (rw + jw) * 0.005 : 0;

  const income = (pop * 0.012 + jobs * 0.015) * tax / 10;
  netIncome = income - roadUpkeep - upkeep;
}

function spreadPollution(): void {
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (k === T_IND) pollution[i] += IND_POLLUTION[level[i]];
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

function grow(): void {
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isZone(k)) continue;
    const l = level[i];
    const f = flags[i];
    if (f & F_NO_ROAD) {
      if (l > 0 && Math.random() < 0.08) { level[i] = l - 1; age[i] = 0; }
      continue;
    }
    const d = demand[k - T_RES];
    const p = pollution[i];
    const isRes = k === T_RES;
    if (l === 0) {
      const appeal = isRes ? Math.max(0, 1 - p / 6) : 1;
      if (money > 0 && Math.random() < Math.max(0, d) * 0.12 * appeal) {
        level[i] = 1;
        age[i] = 0;
        if (isRes && pendingMoveIns.length < 40) pendingMoveIns.push(i);
      }
      continue;
    }
    age[i]++;
    const served = f === 0;
    const minAge = l === 1 ? 10 : 22;
    const rate = l === 1 ? 0.06 : 0.03;
    const canUp = served && (!isRes || p < 3);
    if (l < 3 && age[i] > minAge && money > 0 && canUp && Math.random() < Math.max(0, d) * rate) {
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
  money += netIncome;
  tick++;
}

function stats(): Stats {
  return {
    money: Math.round(money), pop, jobs: comJobs + indJobs, cars: activeCars, commute: commuteAvg,
    demand: [demand[0], demand[1], demand[2]], tick, roadLength: Math.round(roadLength), buildings,
    noPath, gaveUp, power, water, sewage, dirtyWater: dirtyShare > 0.2, resPollution, income: netIncome,
  };
}

function postState(): void {
  const pol = new Uint8Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) pol[i] = Math.min(255, (pollution[i] * 14) | 0);
  const riv = new Uint8Array(riverPollution.length);
  for (let i = 0; i < riv.length; i++) riv[i] = Math.min(255, (riverPollution[i] * 255) | 0);
  post({ type: 'state', level: level.slice(), flags: flags.slice(), pollution: pol, riverPollution: riv, stats: stats() });
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
    spreadPollution();
    census();
    grow();
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
      pollution.fill(0);
      pendingMoveIns = [];
      money = m.money;
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
      tax = m.value;
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
