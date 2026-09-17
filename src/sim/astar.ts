import { GRID, N_TILES, SQRT2, T_AVENUE, connected, isRoad, neighbor8 } from '../constants';

// Scratch buffers reused across calls; a generation stamp avoids clearing them.
const gScore = new Float32Array(N_TILES);
const cameFrom = new Int32Array(N_TILES);
const seen = new Uint32Array(N_TILES);
const closed = new Uint32Array(N_TILES);
let gen = 0;

// Binary min-heap on f-score, parallel arrays.
const heapF: number[] = [];
const heapN: number[] = [];

function heapPush(f: number, n: number): void {
  heapF.push(f);
  heapN.push(n);
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
  const lastF = heapF.pop()!;
  const lastN = heapN.pop()!;
  if (heapF.length > 0) {
    heapF[0] = lastF;
    heapN[0] = lastN;
    let i = 0;
    const len = heapF.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
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

/** Avenues are cheaper to traverse so cars prefer them. Keep the heuristic admissible with the same factor. */
const AVENUE_FACTOR = 0.7;

function octile(a: number, gx: number, gz: number): number {
  const dx = Math.abs(gx - (a % GRID));
  const dz = Math.abs(gz - ((a / GRID) | 0));
  return AVENUE_FACTOR * (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz));
}

/** A* over the 8-connected road graph. Returns tile indices from start to goal, or null. */
export function astar(kind: Uint8Array, link: Uint8Array, start: number, goal: number): number[] | null {
  if (!isRoad(kind[start]) || !isRoad(kind[goal])) return null;
  if (start === goal) return [start];
  gen++;
  heapF.length = 0;
  heapN.length = 0;
  const gx = goal % GRID;
  const gz = (goal / GRID) | 0;

  gScore[start] = 0;
  seen[start] = gen;
  cameFrom[start] = -1;
  heapPush(octile(start, gx, gz), start);

  while (heapN.length > 0) {
    const cur = heapPop();
    if (cur === goal) {
      const path: number[] = [];
      for (let n = goal; n !== -1; n = cameFrom[n]) path.push(n);
      path.reverse();
      return path;
    }
    if (closed[cur] === gen) continue;
    closed[cur] = gen;
    for (let d = 0; d < 8; d++) {
      if (!connected(kind, link, cur, d)) continue;
      const n = neighbor8(cur, d);
      if (closed[n] === gen) continue;
      const step = (d & 1 ? SQRT2 : 1) * (kind[n] === T_AVENUE ? AVENUE_FACTOR : 1);
      const g = gScore[cur] + step;
      if (seen[n] !== gen || g < gScore[n]) {
        gScore[n] = g;
        seen[n] = gen;
        cameFrom[n] = cur;
        heapPush(g + octile(n, gx, gz), n);
      }
    }
  }
  return null;
}
