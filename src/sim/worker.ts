import {
  GRID, N_TILES, MAX_CARS, SIM_HZ, T_AVENUE, T_RES, T_COM, T_IND,
  RES_POP, COM_JOBS, IND_JOBS, START_MONEY, ROAD_UPKEEP, SQRT2, DIRS8,
  neighbor, connected, isRoad, isZone,
} from '../constants';
import { astar } from './astar';
import type { MainToWorker, Stats } from './messages';

const post = (self as unknown as { postMessage: (m: unknown, t?: Transferable[]) => void }).postMessage.bind(self);

// ---- authoritative state -------------------------------------------------
const kind = new Uint8Array(N_TILES);
const link = new Uint8Array(N_TILES);
const level = new Uint8Array(N_TILES);
const age = new Uint16Array(N_TILES);
const frontRoad = new Int32Array(N_TILES).fill(-1);
const carCount = new Uint16Array(N_TILES);
const congestion = new Float32Array(N_TILES);

let money = START_MONEY;
let tick = 0;
let tax = 10;
let speed = 1;
let pop = 0;
let comJobs = 0;
let indJobs = 0;
let roads = 0;
let buildings = 0;
let commuteAvg = 0;
let spawnBudget = 0;
let tripRate = 0;
let noPath = 0;
let upkeep = 0;
let subCount = 0;
const demand: [number, number, number] = [0, 0, 0];

interface Car { path: number[]; seg: number; t: number; time: number }
const slots: (Car | null)[] = new Array(MAX_CARS).fill(null);
const freeList: number[] = [];
for (let i = MAX_CARS - 1; i >= 0; i--) freeList.push(i);
let activeCars = 0;

// Weighted origin/destination lists, rebuilt each census.
let resTiles: number[] = [];
let resW: number[] = [];
let jobTiles: number[] = [];
let jobW: number[] = [];

const BASE_SPEED = 3; // tiles per second on a free road
const AVENUE_SPEED = 4.5;
const ROAD_CAP = 2; // cars per tile before slowing
const AVENUE_CAP = 5;
const LANE = 0.22;

// ---- helpers ----------------------------------------------------------------
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function pickWeighted(tiles: number[], cum: number[]): number {
  const total = cum[cum.length - 1];
  const r = Math.random() * total;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] > r) hi = mid; else lo = mid + 1;
  }
  return tiles[lo];
}

function recomputeAccess(): void {
  for (let i = 0; i < N_TILES; i++) {
    frontRoad[i] = -1;
    if (!isZone(kind[i])) continue;
    for (let d = 0; d < 4; d++) {
      const n = neighbor(i, d);
      if (n >= 0 && isRoad(kind[n])) { frontRoad[i] = n; break; }
    }
  }
}

function freeCar(slot: number): void {
  slots[slot] = null;
  freeList.push(slot);
  activeCars--;
}

function clearCars(): void {
  for (let s = 0; s < MAX_CARS; s++) if (slots[s]) freeCar(s);
  congestion.fill(0);
}

// ---- census & growth ----------------------------------------------------------
function census(): void {
  pop = 0; comJobs = 0; indJobs = 0; roads = 0; buildings = 0;
  let upkeepTiles = 0;
  resTiles = []; resW = []; jobTiles = []; jobW = [];
  let rw = 0;
  let jw = 0;
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    const l = level[i];
    if (isRoad(k)) { roads++; upkeepTiles += k === T_AVENUE ? 2 : 1; continue; }
    if (l > 0) buildings++;
    const hasAccess = frontRoad[i] >= 0;
    if (k === T_RES) {
      pop += RES_POP[l];
      if (l > 0 && hasAccess) { rw += l; resTiles.push(i); resW.push(rw); }
    } else if (k === T_COM) {
      comJobs += COM_JOBS[l];
      if (l > 0 && hasAccess) { jw += l * 1.4; jobTiles.push(i); jobW.push(jw); }
    } else if (k === T_IND) {
      indJobs += IND_JOBS[l];
      if (l > 0 && hasAccess) { jw += l; jobTiles.push(i); jobW.push(jw); }
    }
  }
  const jobs = comJobs + indJobs;
  const taxPenalty = (tax - 10) / 40;
  const commutePenalty = clamp((commuteAvg - 20) / 40, 0, 1);
  const balance = (jobs - pop) / Math.max(60, pop + jobs);
  demand[0] = clamp(0.3 + 0.7 * balance - taxPenalty - 0.6 * commutePenalty, -1, 1);
  demand[1] = clamp(0.25 + 0.7 * (pop * 0.4 - comJobs) / Math.max(50, pop * 0.4 + comJobs) - taxPenalty, -1, 1);
  demand[2] = clamp(0.25 + 0.7 * (pop * 0.5 - indJobs) / Math.max(50, pop * 0.5 + indJobs) - taxPenalty, -1, 1);
  tripRate = rw * 0.12;
  upkeep = upkeepTiles * ROAD_UPKEEP;
}

function grow(): void {
  for (let i = 0; i < N_TILES; i++) {
    const k = kind[i];
    if (!isZone(k)) continue;
    const l = level[i];
    if (frontRoad[i] < 0) {
      if (l > 0 && Math.random() < 0.08) { level[i] = l - 1; age[i] = 0; }
      continue;
    }
    const d = demand[k - T_RES];
    if (l === 0) {
      if (money > 0 && Math.random() < Math.max(0, d) * 0.12) { level[i] = 1; age[i] = 0; }
    } else {
      age[i]++;
      const minAge = l === 1 ? 10 : 22;
      const rate = l === 1 ? 0.06 : 0.03;
      if (l < 3 && age[i] > minAge && money > 0 && Math.random() < Math.max(0, d) * rate) {
        level[i] = l + 1; age[i] = 0;
      } else if (d < -0.15 && Math.random() < -d * 0.05) {
        level[i] = l - 1; age[i] = 0;
      }
    }
  }
  const income = (pop * 0.005 + (comJobs + indJobs) * 0.007) * tax / 10;
  money += income - upkeep;
  tick++;
}

function stats(): Stats {
  return {
    money: Math.round(money), pop, jobs: comJobs + indJobs, cars: activeCars,
    commute: commuteAvg, demand: [demand[0], demand[1], demand[2]],
    tick, roads, buildings, noPath,
  };
}

function postState(): void {
  post({ type: 'state', level: level.slice(), stats: stats() });
}

// ---- traffic -----------------------------------------------------------------------
function currentTile(c: Car): number {
  return c.t < 0.5 ? c.path[c.seg] : c.path[c.seg + 1];
}

function stepCars(dt: number): void {
  carCount.fill(0);
  for (let s = 0; s < MAX_CARS; s++) {
    const c = slots[s];
    if (c) carCount[currentTile(c)]++;
  }
  for (let s = 0; s < MAX_CARS; s++) {
    const c = slots[s];
    if (!c) continue;
    const tile = currentTile(c);
    const avenue = kind[tile] === T_AVENUE;
    const cap = avenue ? AVENUE_CAP : ROAD_CAP;
    const n = carCount[tile];
    const f = n <= cap ? 1 : Math.max(0.12, 1 / (1 + (n - cap) * 0.5));
    const a = c.path[c.seg];
    const b = c.path[c.seg + 1];
    const diag = (a % GRID) !== (b % GRID) && ((a / GRID) | 0) !== ((b / GRID) | 0);
    const segLen = diag ? SQRT2 : 1;
    c.t += dt * (avenue ? AVENUE_SPEED : BASE_SPEED) * f / segLen;
    c.time += dt;
    while (c.t >= 1) {
      c.t -= 1;
      c.seg++;
      if (c.seg >= c.path.length - 1) {
        commuteAvg = commuteAvg === 0 ? c.time : commuteAvg * 0.96 + c.time * 0.04;
        freeCar(s);
        break;
      }
    }
  }
  for (let i = 0; i < N_TILES; i++) {
    congestion[i] += (carCount[i] - congestion[i]) * 0.06;
  }
}

function spawn(dt: number): void {
  spawnBudget = Math.min(8, spawnBudget + tripRate * dt);
  let n = 0;
  while (spawnBudget >= 1 && n < 4 && freeList.length > 0 && resTiles.length > 0 && jobTiles.length > 0) {
    spawnBudget -= 1;
    n++;
    const o = pickWeighted(resTiles, resW);
    const d = pickWeighted(jobTiles, jobW);
    const a = frontRoad[o];
    const b = frontRoad[d];
    if (a < 0 || b < 0 || a === b) continue;
    const path = astar(kind, link, a, b);
    if (!path || path.length < 2) { noPath++; continue; }
    const slot = freeList.pop()!;
    slots[slot] = { path, seg: 0, t: 0, time: 0 };
    activeCars++;
  }
}

function writeFrame(): void {
  const out = new Float32Array(MAX_CARS * 4);
  const half = GRID / 2;
  for (let s = 0; s < MAX_CARS; s++) {
    const c = slots[s];
    const o = s * 4;
    if (!c) { out[o + 3] = 0; continue; }
    const p = c.path;
    const i = c.seg;
    const t = c.t;
    const a = p[i];
    const b = p[i + 1];
    const ax = a % GRID;
    const az = (a / GRID) | 0;
    const dx = (b % GRID) - ax;
    const dz = ((b / GRID) | 0) - az;
    let tx = dx;
    let tz = dz;
    if (t < 0.25 && i > 0) {
      const q = p[i - 1];
      const pdx = ax - (q % GRID);
      const pdz = az - ((q / GRID) | 0);
      const w = 0.5 + 0.5 * (t / 0.25);
      tx = pdx + (dx - pdx) * w;
      tz = pdz + (dz - pdz) * w;
    } else if (t > 0.75 && i + 2 < p.length) {
      const q = p[i + 2];
      const ndx = (q % GRID) - (b % GRID);
      const ndz = ((q / GRID) | 0) - ((b / GRID) | 0);
      const w = 0.5 * ((t - 0.75) / 0.25);
      tx = dx + (ndx - dx) * w;
      tz = dz + (ndz - dz) * w;
    }
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const cx = ax + 0.5 + dx * t - half;
    const cz = az + 0.5 + dz * t - half;
    out[o] = cx - tz * LANE;
    out[o + 1] = cz + tx * LANE;
    out[o + 2] = Math.atan2(tx, tz);
    out[o + 3] = 1;
  }
  const cong = new Uint8Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) cong[i] = Math.min(255, (congestion[i] * 45) | 0);
  post({ type: 'frame', cars: out, congestion: cong }, [out.buffer, cong.buffer]);
}

// ---- main loop -------------------------------------------------------------------
function substep(): void {
  const dt = 1 / SIM_HZ;
  stepCars(dt);
  spawn(dt);
  subCount++;
  if (subCount >= SIM_HZ) {
    subCount = 0;
    census();
    grow();
    postState();
    noPath = 0;
  }
}

setInterval(() => {
  if (speed === 0) return;
  for (let s = 0; s < speed; s++) substep();
  writeFrame();
}, 1000 / SIM_HZ);

// ---- messages ----------------------------------------------------------------------
self.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'load': {
      kind.set(m.kind);
      link.set(m.link);
      level.set(m.level);
      age.fill(0);
      money = m.money;
      tick = m.tick;
      tax = m.tax;
      commuteAvg = 0;
      spawnBudget = 0;
      clearCars();
      recomputeAccess();
      census();
      postState();
      writeFrame();
      break;
    }
    case 'kind': {
      const nk = m.kind;
      let roadChanged = false;
      for (let i = 0; i < N_TILES; i++) {
        if (nk[i] !== kind[i]) {
          if (isRoad(kind[i]) || isRoad(nk[i])) roadChanged = true;
          kind[i] = nk[i];
          level[i] = 0;
          age[i] = 0;
        }
        if (m.link[i] !== link[i]) roadChanged = true;
      }
      link.set(m.link);
      if (roadChanged) {
        // Drop cars whose remaining path is no longer drivable.
        for (let s = 0; s < MAX_CARS; s++) {
          const c = slots[s];
          if (!c) continue;
          for (let j = c.seg; j + 1 < c.path.length; j++) {
            const a = c.path[j];
            const b = c.path[j + 1];
            const dx = (b % GRID) - (a % GRID);
            const dz = ((b / GRID) | 0) - ((a / GRID) | 0);
            let d = -1;
            for (let k = 0; k < 8; k++) if (DIRS8[k][0] === dx && DIRS8[k][1] === dz) { d = k; break; }
            if (d < 0 || !connected(kind, link, a, d)) { freeCar(s); break; }
          }
        }
      }
      money -= m.spent;
      recomputeAccess();
      census();
      postState();
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
      for (let n = 0; n < m.ticks; n++) { census(); grow(); }
      census();
      postState();
      break;
    }
  }
};
