import * as THREE from 'three';
import { GRID, N_TILES, idx, inBounds, isZone, tileHash } from '../constants';
import type { Network } from '../roads/network';
import { inLot, type Raster } from '../roads/raster';
import type { Terrain } from '../terrain';
import { Kit, stream, pick, FLOWERS, BUSH } from './streetDetail';
import { siteOwners } from '../sites';

const HALF = GRID / 2;
const CHUNK = 16;
const STONE = 0xb4b0a6, PAVING = 0xc2bdb2, BRONZE = 0x5f7a66, WATER = 0x5fa8d8, TRUNK = 0x6b4f36;

/**
 * The leftover ground in town, planted. A cell nobody has built on, beside a road or a building, is
 * too small for the woods to grow on and too big to leave bare, so each one gets a little garden of
 * its own: a grove of trees, flower beds, a statue on a paved circle, a fountain, or a lawn with a
 * big tree and a picnic table, with benches and lamps. Nothing is put on a road or pavement or in a
 * neighbouring lot. Unlike the street detail these are always there, seen from any height.
 */
export class VergeLayer {
  readonly group = new THREE.Group();
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  private signature = '';

  rebuild(kind: Uint8Array, level: Uint8Array, raster: Raster, net: Network, terrain: Terrain, terraform: Uint8Array, rot?: Uint8Array): void {
    const spots = gardenTiles(kind, level, raster, terrain, terraform, rot);
    const signature = `${net.version}:${spots.join(',')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    for (const m of this.group.children) (m as THREE.Mesh).geometry.dispose();
    this.group.clear();
    const kits = new Map<number, Kit>();
    for (const i of spots) {
      const x = i % GRID, z = Math.floor(i / GRID), key = Math.floor(z / CHUNK) * 100 + Math.floor(x / CHUNK);
      let kit = kits.get(key);
      if (!kit) { kit = new Kit(); kits.set(key, kit); }
      garden(kit, i, kind, level, raster, net);
    }
    for (const kit of kits.values()) {
      const g = kit.build();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, this.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
  }
}

/** Empty cells in town: unbuilt, dry, level ground, touching both a road and a building. */
export function gardenTiles(kind: Uint8Array, level: Uint8Array, raster: Raster, terrain: Terrain, terraform: Uint8Array, rot?: Uint8Array): number[] {
  const out: number[] = [], owners = siteOwners(kind, rot);
  for (let i = 0; i < N_TILES; i++) if (isGardenTile(i, kind, level, raster, terrain, terraform, owners)) out.push(i);
  return out;
}

/** `owners` marks the cells of the big multi-cell buildings, which are theirs even where no building stands. */
export function isGardenTile(i: number, kind: Uint8Array, level: Uint8Array, raster: Raster, terrain: Terrain, terraform: Uint8Array, owners: Int32Array): boolean {
  if (kind[i] || owners[i] >= 0 || raster.cover[i] || terrain.water[i] || terrain.shore[i] || terraform[i]) return false;
  const x = i % GRID, z = Math.floor(i / GRID);
  let road = false, built = false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dz) continue;
    const nx = x + dx, nz = z + dz;
    if (!inBounds(nx, nz)) continue;
    const n = idx(nx, nz);
    if (raster.cover[n]) road = true;
    if ((kind[n] && (!isZone(kind[n]) || level[n] > 0)) || owners[n] >= 0) built = true;
  }
  // Beside a road and a building both: the leftover between them, not open country along a new street.
  return road && built;
}

function garden(kit: Kit, i: number, kind: Uint8Array, level: Uint8Array, raster: Raster, net: Network): void {
  const x = i % GRID, z = Math.floor(i / GRID), rnd = stream(i * 40503 + 17);
  // Whether a spot (map coordinates) is free: off the roads and pavements, and out of the lots next door.
  const free = (px: number, pz: number, r = 0.06): boolean => {
    if (net.onRoad(px, pz, -1, 0.12 + r)) return false;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, nz = z + dz;
      if ((!dx && !dz) || !inBounds(nx, nz)) continue;
      const n = idx(nx, nz);
      if (!kind[n] || (isZone(kind[n]) && !level[n])) continue;
      // A zone's building stands in its lot, turned with it; anything else fills its own square.
      if (isZone(kind[n]) ? inLot(raster, n, px, pz, 0.5 + r) : Math.abs(px - nx - 0.5) < 0.5 + r && Math.abs(pz - nz - 0.5) < 0.5 + r) return false;
    }
    return true;
  };
  // Candidate spots on a 3 × 3 grid across the cell; the design uses the free ones.
  const spots: [number, number][] = [];
  for (const u of [0.22, 0.5, 0.78]) for (const v of [0.22, 0.5, 0.78]) if (free(x + u, z + v)) spots.push([x + u, z + v]);
  if (!spots.length) return;
  // Which way the nearest road is, for benches and statues to face.
  const cx = x + 0.5, cz = z + 0.5;
  const face = raster.accSeg[i] >= 0 ? Math.atan2(raster.accX[i] - cx, raster.accZ[i] - cz) : rnd() * Math.PI * 2;
  const at = (px: number, pz: number, yaw = 0): Kit => kit.at(px - HALF, 0, pz - HALF, yaw);
  const centre = spots.find(([u, v]) => Math.abs(u - cx) < 0.01 && Math.abs(v - cz) < 0.01);
  const h = tileHash(i * 97 + 5);
  const design = spots.length < 4 || !centre ? 'scatter' : h < 0.3 ? 'grove' : h < 0.58 ? 'flowers' : h < 0.74 ? 'statue' : h < 0.86 ? 'fountain' : 'lawn';

  const tree = (px: number, pz: number, scale: number): void => {
    // In scale with the park trees nearby.
    const size = scale * 1.5;
    at(px, pz);
    kit.jitter = 0;
    if (rnd() < 0.4) {
      // A conifer: a trunk and three tiers.
      kit.prism(0, 0, 0, 0.012 * size, 0.08 * size, TRUNK, 6, 0.009 * size);
      for (let t = 0; t < 3; t++) { kit.jitter = (rnd() - 0.5) * 0.15; kit.prism(0, (0.06 + t * 0.07) * size, 0, (0.09 - t * 0.022) * size, 0.12 * size, 0x3f6b3a, 7, 0); }
    } else {
      // A broadleaf: a trunk, a fork and a rounded crown.
      kit.prism(0, 0, 0, 0.013 * size, 0.14 * size, TRUNK, 6, 0.01 * size);
      const leaf = pick(rnd, [0x4f7f3d, 0x5f8f45, 0x6a9a4a, 0x7a9a3a, 0x8a6a3a]);
      kit.jitter = (rnd() - 0.5) * 0.2;
      kit.lump(0, 0.1 * size, 0, 0.1 * size, leaf, 0.9, rnd);
      kit.lump(0.05 * size, 0.15 * size, 0.02 * size, 0.07 * size, leaf, 0.9, rnd);
      kit.lump(-0.04 * size, 0.14 * size, -0.03 * size, 0.07 * size, leaf, 0.9, rnd);
    }
    kit.jitter = 0;
    kit.disc(0, 0.003, 0, 0.05 * size, 0x5b4a3a, 8);
  };
  const bench = (px: number, pz: number, yaw: number): void => {
    at(px, pz, yaw);
    kit.jitter = 0;
    kit.box(0, 0.028, 0, 0.1, 0.008, 0.03, 0x8a6240);
    kit.box(0, 0.036, -0.016, 0.1, 0.03, 0.006, 0x8a6240);
    for (const o of [-0.042, 0.042]) kit.box(o, 0, 0, 0.006, 0.03, 0.03, 0x3a4046);
  };
  const lamp = (px: number, pz: number): void => {
    at(px, pz);
    kit.jitter = 0;
    kit.prism(0, 0, 0, 0.005, 0.2, 0x3a4046, 6);
    kit.prism(0, 0.2, 0, 0.016, 0.022, 0xf2e6c0, 6, 0.01);
    kit.prism(0, 0.222, 0, 0.012, 0.006, 0x3a4046, 6, 0);
  };
  const flowerBed = (px: number, pz: number, r: number): void => {
    at(px, pz);
    kit.jitter = 0;
    kit.prism(0, 0, 0, r + 0.012, 0.012, STONE, 12);
    kit.disc(0, 0.0125, 0, r, 0x5b4a3a, 12);
    const rings = Math.max(1, Math.round(r / 0.03));
    for (let ring = 0; ring < rings; ring++) {
      const rr = r * (ring + 0.5) / rings, n = Math.max(3, Math.round(rr * 2 * Math.PI / 0.022)), color = pick(rnd, FLOWERS);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + ring;
        kit.jitter = (rnd() - 0.5) * 0.15;
        kit.box(Math.cos(a) * rr, 0.013, Math.sin(a) * rr, 0.012, 0.012 + rnd() * 0.006, 0.012, ring === rings - 1 ? 0x4f7f3d : color, a);
      }
    }
    kit.jitter = 0;
  };
  const shrub = (px: number, pz: number): void => {
    at(px, pz);
    kit.jitter = (rnd() - 0.5) * 0.2;
    kit.lump(0, 0, 0, 0.03 + rnd() * 0.02, pick(rnd, BUSH), 0.8, rnd);
    kit.jitter = 0;
  };

  switch (design) {
    case 'grove':
      for (const [px, pz] of spots) {
        if (rnd() < 0.6) tree(px + (rnd() - 0.5) * 0.08, pz + (rnd() - 0.5) * 0.08, 1 + rnd() * 0.9);
        else shrub(px, pz);
      }
      bench(centre![0], centre![1], face);
      break;
    case 'flowers':
      flowerBed(cx, cz, 0.13);
      for (const [px, pz] of spots) if (px !== cx || pz !== cz) {
        if (rnd() < 0.55) flowerBed(px, pz, 0.05 + rnd() * 0.03);
        else if (rnd() < 0.5) tree(px, pz, 0.8 + rnd() * 0.4);
        else shrub(px, pz);
      }
      break;
    case 'statue': {
      // A paved circle with a statue on a plinth, benches round it and lamps.
      at(cx, cz, face);
      kit.jitter = 0;
      kit.disc(0, 0.004, 0, 0.2, PAVING, 20);
      kit.disc(0, 0.0045, 0, 0.16, 0xb0aba0, 20);
      kit.box(0, 0.004, 0, 0.07, 0.05, 0.07, STONE);
      kit.box(0, 0.054, 0, 0.08, 0.008, 0.08, 0xa39e94);
      if (rnd() < 0.6) {
        // A figure: legs, a coat, arms, a head, one arm raised.
        kit.box(-0.008, 0.062, 0, 0.012, 0.045, 0.014, BRONZE); kit.box(0.008, 0.062, 0, 0.012, 0.045, 0.014, BRONZE);
        kit.box(0, 0.107, 0, 0.036, 0.05, 0.02, BRONZE);
        kit.box(-0.024, 0.11, 0, 0.01, 0.042, 0.012, BRONZE);
        kit.beam(0.022, 0.15, 0, 0.034, 0.2, 0.01, 0.01, BRONZE);
        kit.box(0, 0.157, 0, 0.018, 0.022, 0.018, BRONZE);
      } else {
        kit.jitter = 0;
        kit.lump(0, 0.062, 0, 0.04, 0xb8b4aa, 1.4, rnd);
        kit.box(0, 0.12, 0, 0.012, 0.08, 0.012, 0xc8b86a, 0.5);
      }
      for (const a of [0.9, -0.9, Math.PI]) {
        const bx = cx + Math.sin(face + a) * 0.18, bz = cz + Math.cos(face + a) * 0.18;
        if (free(bx, bz, 0.02)) bench(bx, bz, face + a + Math.PI);
      }
      for (const [px, pz] of spots) if (Math.hypot(px - cx, pz - cz) > 0.3) { if (rnd() < 0.5) lamp(px, pz); else tree(px, pz, 0.8 + rnd() * 0.4); }
      break;
    }
    case 'fountain': {
      at(cx, cz);
      kit.jitter = 0;
      kit.disc(0, 0.004, 0, 0.22, PAVING, 20);
      kit.prism(0, 0, 0, 0.16, 0.03, STONE, 20);
      kit.disc(0, 0.026, 0, 0.14, WATER, 20);
      kit.prism(0, 0.026, 0, 0.02, 0.06, STONE, 8);
      kit.prism(0, 0.086, 0, 0.05, 0.012, STONE, 12);
      kit.disc(0, 0.098, 0, 0.042, WATER, 12);
      kit.prism(0, 0.098, 0, 0.006, 0.05, 0xd0ecf8, 6, 0.002);
      kit.prism(0, 0.1, 0, 0.03, 0.03, 0xd0ecf8, 8, 0);
      for (const [px, pz] of spots) if (Math.hypot(px - cx, pz - cz) > 0.3) { if (rnd() < 0.4) bench(px, pz, Math.atan2(cx - px, cz - pz)); else if (rnd() < 0.5) flowerBed(px, pz, 0.05); else shrub(px, pz); }
      break;
    }
    case 'lawn':
      tree(cx + (rnd() - 0.5) * 0.1, cz + (rnd() - 0.5) * 0.1, 1.4);
      for (const [px, pz] of spots) if (Math.hypot(px - cx, pz - cz) > 0.3) {
        if (rnd() < 0.25) {
          // A picnic table.
          at(px, pz, rnd() * 3);
          kit.jitter = 0;
          kit.box(0, 0.035, 0, 0.08, 0.006, 0.04, 0x8a6240);
          for (const o of [-0.035, 0.035]) kit.box(0, 0.02, o, 0.08, 0.005, 0.014, 0x8a6240);
          for (const o of [-0.03, 0.03]) kit.box(o, 0, 0, 0.006, 0.035, 0.05, 0x6b4f36);
        } else if (rnd() < 0.5) shrub(px, pz);
      }
      break;
    default:
      // Too little room for a design: a shrub, a small tree or a flower tub wherever there is space.
      for (const [px, pz] of spots) {
        const r = rnd();
        if (r < 0.35) tree(px, pz, 0.7 + rnd() * 0.5);
        else if (r < 0.7) shrub(px, pz);
        else flowerBed(px, pz, 0.04);
      }
  }
}
