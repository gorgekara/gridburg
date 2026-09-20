import { roadHeight } from './structures';
import { GRID, N_TILES } from '../constants';
import { HALF_WIDTH } from './network';
import type { Network } from './network';

/** How far from the edge of a road a tile can be and still use it: three rows deep, like CS zoning. */
export const ACCESS_DEPTH = 2.7;

export interface Raster {
  /** 1 where a road surface covers the tile, so nothing can be built there. */
  cover: Uint8Array;
  /** Nearest segment id for tiles close enough to a road to use it, else -1. */
  accSeg: Int32Array;
  /** Arc length along that segment of the nearest point. */
  accS: Float32Array;
  /** World position of that nearest point, for orienting buildings. */
  accX: Float32Array;
  accZ: Float32Array;
  /** Visual lot centers close to narrow curbs; logical zoning cells remain stable. */
  lotX: Float32Array;
  lotZ: Float32Array;
}

/** Project the road network onto the tile grid: which tiles are paved and which can reach a road. */
export function rasterize(net: Network): Raster {
  const cover = new Uint8Array(N_TILES);
  const accSeg = new Int32Array(N_TILES).fill(-1);
  const accS = new Float32Array(N_TILES);
  const accX = new Float32Array(N_TILES);
  const accZ = new Float32Array(N_TILES);
  const roadWidth = new Float32Array(N_TILES);
  const best = new Float32Array(N_TILES).fill(1e9);

  for (const seg of net.segs.values()) {
    const hw = HALF_WIDTH[seg.kind];
    const reach = hw + ACCESS_DEPTH;
    for (let i = 0; i < seg.n; i++) {
      const x0 = seg.pts[i * 2], z0 = seg.pts[i * 2 + 1];
      const x1 = seg.pts[i * 2 + 2], z1 = seg.pts[i * 2 + 3];
      const dx = x1 - x0, dz = z1 - z0;
      const l2 = dx * dx + dz * dz || 1;
      const tx0 = Math.max(0, Math.floor(Math.min(x0, x1) - reach));
      const tx1 = Math.min(GRID - 1, Math.floor(Math.max(x0, x1) + reach));
      const tz0 = Math.max(0, Math.floor(Math.min(z0, z1) - reach));
      const tz1 = Math.min(GRID - 1, Math.floor(Math.max(z0, z1) + reach));
      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const px = tx + 0.5, pz = tz + 0.5;
          let u = ((px - x0) * dx + (pz - z0) * dz) / l2;
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          const qx = x0 + dx * u, qz = z0 + dz * u;
          const d = Math.hypot(px - qx, pz - qz);
          const t = tz * GRID + tx;
          const distance = seg.cum[i] + (seg.cum[i + 1] - seg.cum[i]) * u;
          if (seg.structure === 2 && Math.abs(roadHeight(seg, distance)) > 0.8) continue;
          if (d < hw + 0.42) cover[t] = 1;
          if (seg.structure) continue;
          if (d < reach && d < best[t]) {
            best[t] = d;
            accSeg[t] = seg.id;
            accS[t] = seg.cum[i] + (seg.cum[i + 1] - seg.cum[i]) * u;
            accX[t] = qx;
            accZ[t] = qz;
            roadWidth[t] = hw;
          }
        }
      }
    }
  }
  // Nothing can be built on a roundabout's island.
  for (const rb of net.roundabouts()) {
    for (let tz = Math.max(0, Math.floor(rb.z - rb.r)); tz <= Math.min(GRID - 1, Math.floor(rb.z + rb.r)); tz++) {
      for (let tx = Math.max(0, Math.floor(rb.x - rb.r)); tx <= Math.min(GRID - 1, Math.floor(rb.x + rb.r)); tx++) {
        if (Math.hypot(tx + 0.5 - rb.x, tz + 0.5 - rb.z) < rb.r) cover[tz * GRID + tx] = 1;
      }
    }
  }
  const lotX = new Float32Array(N_TILES), lotZ = new Float32Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) {
    const x = i % GRID + 0.5, z = Math.floor(i / GRID) + 0.5;
    lotX[i] = x; lotZ[i] = z;
    if (cover[i] || accSeg[i] < 0) continue;
    const dx = accX[i] - x, dz = accZ[i] - z;
    // Straight roadside strips can move together without changing their spacing.
    // Curved frontage keeps its grid position to avoid rotating lots into each other.
    if (Math.abs(dx) > 0.001 && Math.abs(dz) > 0.001) continue;
    const distance = Math.hypot(dx, dz);
    const front = roadWidth[i] + 0.09 + 0.5;
    if (distance < front) continue;
    const offset = Math.min(0.75, Math.max(0, distance - front - Math.floor(distance - front + 0.00001)));
    lotX[i] += dx / distance * offset;
    lotZ[i] += dz / distance * offset;
  }
  // Revert conflicting shifts at junctions, propagating only when a lot moves back.
  // Straight rows retain their shared offset; each lot can be reset at most once.
  const pending = Array.from({ length: N_TILES }, (_, i) => i);
  for (let cursor = 0; cursor < pending.length; cursor++) {
    const i = pending[cursor];
    if (cover[i] || accSeg[i] < 0) continue;
    const x = i % GRID, z = Math.floor(i / GRID);
    for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
      if ((!ox && !oz) || x + ox < 0 || x + ox >= GRID || z + oz < 0 || z + oz >= GRID) continue;
      const j = (z + oz) * GRID + x + ox;
      if (cover[j] || accSeg[j] < 0) continue;
      if (Math.abs(lotX[i] - lotX[j]) >= 0.999 || Math.abs(lotZ[i] - lotZ[j]) >= 0.999) continue;
      for (const t of [i, j]) {
        const tx = t % GRID + 0.5, tz = Math.floor(t / GRID) + 0.5;
        if (lotX[t] === tx && lotZ[t] === tz) continue;
        lotX[t] = tx; lotZ[t] = tz;
        pending.push(t);
      }
    }
  }
  return { cover, accSeg, accS, accX, accZ, lotX, lotZ };
}
