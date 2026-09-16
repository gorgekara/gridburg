import { GRID, N_TILES, T_ROAD, neighbor } from '../constants';

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

/** A* over 4-connected road tiles. Returns tile indices from start to goal, or null. */
export function astar(kind: Uint8Array, start: number, goal: number): number[] | null {
  if (kind[start] !== T_ROAD || kind[goal] !== T_ROAD) return null;
  if (start === goal) return [start];
  gen++;
  heapF.length = 0;
  heapN.length = 0;
  const gx = goal % GRID;
  const gz = (goal / GRID) | 0;

  gScore[start] = 0;
  seen[start] = gen;
  cameFrom[start] = -1;
  heapPush(Math.abs(gx - (start % GRID)) + Math.abs(gz - ((start / GRID) | 0)), start);

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
    const g = gScore[cur] + 1;
    for (let d = 0; d < 4; d++) {
      const n = neighbor(cur, d);
      if (n < 0 || kind[n] !== T_ROAD || closed[n] === gen) continue;
      if (seen[n] !== gen || g < gScore[n]) {
        gScore[n] = g;
        seen[n] = gen;
        cameFrom[n] = cur;
        const h = Math.abs(gx - (n % GRID)) + Math.abs(gz - ((n / GRID) | 0));
        heapPush(g + h, n);
      }
    }
  }
  return null;
}
