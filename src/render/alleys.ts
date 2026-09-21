import * as THREE from 'three';
import { GRID, N_TILES, isZone, tileHash, T_FARM } from '../constants';
import type { Raster } from '../roads/raster';
import { MeshBuilder } from './meshBuilder';

/** A building further than this from its access road stands behind the row that fronts the street. */
const SET_BACK = 1.5;
const PAVING = 0x8c8a82;
const SEAM = 0x74726b;

/**
 * Back lots are not marooned: where a building sits behind the row that fronts the street, an alley
 * runs out to the curb along the boundary between its neighbours, the way a service lane threads a
 * city block. Each one picks its side and its length from the tile's own hash, so a block gets a
 * ragged, lived-in pattern instead of a comb. Fire engines and patrol cars already answer calls at
 * these buildings from the street they connect to; the alley is the route their crews walk up.
 */
export class AlleyLayer {
  readonly group = new THREE.Group();
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  private signature = '';

  constructor() {
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  reset(): void { this.signature = ''; }

  rebuild(kind: Uint8Array, level: Uint8Array, raster: Raster, terrain?: { water: Uint8Array; shore: Uint8Array }): void {
    // Cheap pass first: alleys only change when a building or its access road does.
    let hash = 17;
    for (let i = 0; i < N_TILES; i++) {
      if (!kind[i] || raster.accSeg[i] < 0) continue;
      hash = (Math.imul(hash, 16777619) ^ (i * 131 + kind[i] * 7 + level[i])) >>> 0;
      hash = (Math.imul(hash, 16777619) ^ (raster.accSeg[i] + Math.round(raster.lotX[i] * 8) + Math.round(raster.lotZ[i] * 8))) >>> 0;
    }
    const signature = `${hash}:${terrain ? 1 : 0}`;
    if (signature === this.signature) return;
    this.signature = signature;

    const half = GRID / 2, b = new MeshBuilder();
    const drawn = new Set<string>();
    for (let i = 0; i < N_TILES; i++) {
      const k = kind[i];
      if (!k || raster.accSeg[i] < 0) continue;
      // Only houses, shops, workshops and offices back onto a lane. A service building has its own
      // forecourt, and a pump or an outlet stands on the river bank with nowhere for an alley to go.
      if (!isZone(k) || !level[i] || k === T_FARM) continue;
      const lx = raster.lotX[i], lz = raster.lotZ[i];
      const dx = raster.accX[i] - lx, dz = raster.accZ[i] - lz;
      const distance = Math.hypot(dx, dz);
      if (distance < SET_BACK) continue;
      // Walk out along the tile boundary on one side, chosen by the tile's own hash.
      const r = tileHash(i);
      const alongX = Math.abs(dx) > Math.abs(dz);
      const toward = alongX ? Math.sign(dx) || 1 : Math.sign(dz) || 1;
      const x = i % GRID, z = Math.floor(i / GRID);
      const side = r < 0.5 ? 0 : 1;
      const lateral = alongX ? z + side : x + side;
      // Stop short of the back of the building's own cell, so the lane never runs out past the last
      // row into open ground. The raggedness comes from where it stops, not from overshooting.
      const back = (alongX ? x + 0.5 : z + 0.5) - toward * (0.45 - 0.3 * r);
      // Only between buildings: a lane needs a built lot on each side of it at its back end.
      const flank = (l: number): number => { const tx = alongX ? x : l, tz = alongX ? l : z; return tx >= 0 && tz >= 0 && tx < GRID && tz < GRID ? tz * GRID + tx : -1; };
      const left = flank(lateral - 1), right = flank(lateral);
      const built = (t: number): boolean => t >= 0 && isZone(kind[t]) && level[t] > 0;
      if (!built(left) || !built(right)) continue;
      const curb = alongX ? raster.accX[i] : raster.accZ[i];
      // Never pave the bank or the river: skip an alley that would cross either.
      if (terrain) {
        const lo = Math.floor(Math.min(back, curb)), hi = Math.floor(Math.max(back, curb));
        let wet = false;
        for (let a = lo; a <= hi && !wet; a++) for (const l of [lateral - 1, lateral]) {
          const tx = alongX ? a : l, tz = alongX ? l : a;
          if (tx < 0 || tz < 0 || tx >= GRID || tz >= GRID) continue;
          const t = tz * GRID + tx;
          if (terrain.water[t] || terrain.shore[t]) wet = true;
        }
        if (wet) continue;
      }
      const key = `${alongX ? 'x' : 'z'}:${lateral}:${Math.round(back * 4)}:${Math.round(curb * 4)}`;
      if (drawn.has(key)) continue;
      drawn.add(key);

      // A slight kink partway along keeps the alleys from reading as a ruled comb.
      const bend = (r - 0.5) * 0.22;
      const mid = back + (curb - back) * (0.45 + 0.2 * r);
      const pts: number[] = [];
      const push = (along: number, across: number): void => {
        pts.push(alongX ? along - half : across - half, alongX ? across - half : along - half);
      };
      push(back, lateral);
      push(mid, lateral + bend);
      push(curb, lateral);
      const width = 0.14 + 0.05 * r;
      b.ribbon(pts, 3, width, 0.043, PAVING);
      b.ribbon(pts, 3, width * 0.16, 0.044, SEAM);
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = b.build();
  }
}
