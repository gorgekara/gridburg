import * as THREE from 'three';
import { GRID, N_TILES, T_DOCKS } from '../constants';
import type { Terrain } from '../terrain';
import { Builder } from './buildingGeo';

/** How many boats each dock puts on the water. */
const PER_DOCK = 2;

interface Boat {
  mesh: THREE.Mesh;
  /** Waypoints in world space: the jetty, the channel off it, and the fishing ground. */
  jetty: THREE.Vector2; channel: THREE.Vector2; ground: THREE.Vector2;
  phase: number;
  /** Seconds for one full trip out, fishing, and home again. */
  period: number;
  moving?: boolean;
}

const LIVERY = [0xc8382f, 0x2f6fb7, 0xe0a021, 0x2e8b6a, 0xe8e4d8];

function boatGeometry(n: number): THREE.BufferGeometry {
  const b = new Builder(71 + n);
  const hull = LIVERY[n % LIVERY.length];
  b.box(0.2, 0.08, 0.5, 0, 0, 0, hull);
  b.box(0.14, 0.06, 0.12, 0, 0, 0.29, hull); // bow
  b.box(0.2, 0.02, 0.5, 0, 0.08, 0, 0xe8e2d2); // gunwale
  b.box(0.12, 0.12, 0.14, 0, 0.1, -0.08, 0xf2efe6); // wheelhouse
  b.box(0.13, 0.02, 0.15, 0, 0.22, -0.08, 0x3d4a55);
  b.box(0.012, 0.3, 0.012, 0, 0.1, 0.12, 0x5e4630); // mast
  b.box(0.16, 0.012, 0.012, 0, 0.34, 0.12, 0x5e4630); // boom for the nets
  const g = b.build();
  g.scale(0.9, 0.9, 0.9);
  return g;
}

/**
 * Fishing boats working from the docks. Each dock sends a couple of boats out: they leave the jetty,
 * head into the channel, run up or down the river to a fishing ground, idle there working their
 * nets, and come home. Pure scenery; the catch itself is counted by the simulation.
 */
export class BoatLayer {
  readonly group = new THREE.Group();
  private boats: Boat[] = [];
  private signature = '';

  /** Every boat's position and whether it is under way, for the ripples it leaves. */
  forEach(visit: (x: number, z: number, moving: boolean) => void): void {
    for (const boat of this.boats) visit(boat.mesh.position.x, boat.mesh.position.z, !!boat.moving);
  }

  rebuild(kind: Uint8Array, terrain: Terrain): void {
    const docks: number[] = [];
    for (let i = 0; i < N_TILES; i++) if (kind[i] === T_DOCKS) docks.push(i);
    const signature = `${terrain.seed}:${docks.join(',')}`;
    if (signature === this.signature) return;
    this.signature = signature;
    for (const boat of this.boats) { boat.mesh.geometry.dispose(); (boat.mesh.material as THREE.Material).dispose(); }
    this.group.clear();
    this.boats = [];
    const half = GRID / 2, river = terrain.river;
    if (!river.length) return;

    docks.forEach((tile, d) => {
      const x = tile % GRID, z = Math.floor(tile / GRID);
      // The water side of the quay, which is where the jetty runs.
      let wx = 0, wz = 0;
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, nz = z + dz;
        if (nx >= 0 && nz >= 0 && nx < GRID && nz < GRID && terrain.water[nz * GRID + nx]) { wx = dx; wz = dz; break; }
      }
      const jetty = new THREE.Vector2(x + 0.5 + wx * 1.4 - half, z + 0.5 + wz * 1.4 - half);
      // Nearest point of the channel, then a fishing ground some way up or down the river.
      let near = 0, best = Infinity;
      river.forEach((p, n) => {
        const dist = Math.hypot(p.x - (x + 0.5), p.z - (z + 0.5));
        if (dist < best) { best = dist; near = n; }
      });
      for (let k = 0; k < PER_DOCK; k++) {
        const along = (k % 2 ? 1 : -1) * (14 + ((tile * 7 + k * 13) % 18));
        const target = Math.max(0, Math.min(river.length - 1, near + along));
        const at = (n: number): THREE.Vector2 => new THREE.Vector2(river[n].x - half, river[n].z - half);
        const mesh = new THREE.Mesh(boatGeometry(d * PER_DOCK + k), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
        mesh.castShadow = true;
        this.group.add(mesh);
        this.boats.push({
          mesh, jetty, channel: at(near), ground: at(target),
          phase: (d * 11.3 + k * 17.9) % 60, period: 48 + ((tile + k * 5) % 20),
        });
      }
    });
  }

  /** `levelAt` is the water surface at a world position, so boats ride at the river's actual level. */
  update(time: number, levelAt?: (x: number, z: number) => number): void {
    const pos = new THREE.Vector2(), next = new THREE.Vector2();
    for (const boat of this.boats) {
      // A trip in six legs, as fractions of the period: leave the jetty, cross to the channel, run to
      // the ground, work the nets, run home, and sit at the jetty until the next trip.
      const t = ((time + boat.phase) % boat.period) / boat.period;
      const legs: [number, THREE.Vector2, THREE.Vector2][] = [
        [0.08, boat.jetty, boat.channel],
        [0.3, boat.channel, boat.ground],
        [0.52, boat.ground, boat.ground],
        [0.76, boat.ground, boat.channel],
        [0.84, boat.channel, boat.jetty],
        [1, boat.jetty, boat.jetty],
      ];
      let start = 0;
      for (const [end, from, to] of legs) {
        if (t <= end) {
          const u = (t - start) / (end - start);
          const e = u * u * (3 - 2 * u);
          pos.copy(from).lerp(to, e);
          next.copy(from).lerp(to, Math.min(1, e + 0.02));
          if (from === to) {
            // Working the nets: a slow drift in a small circle rather than sitting dead still.
            const a = time * 0.35 + boat.phase;
            pos.x += Math.cos(a) * 0.35; pos.y += Math.sin(a) * 0.35;
            next.set(pos.x - Math.sin(a), pos.y + Math.cos(a));
          }
          break;
        }
        start = end;
      }
      boat.moving = Math.hypot(next.x - pos.x, next.y - pos.y) > 0.005;
      const heading = Math.atan2(next.x - pos.x, next.y - pos.y);
      boat.mesh.position.set(pos.x, (levelAt?.(pos.x, pos.y) ?? 0) + 0.03 + Math.sin(time * 1.7 + boat.phase) * 0.012, pos.y);
      if (Number.isFinite(heading) && (next.x !== pos.x || next.y !== pos.y)) boat.mesh.rotation.y = heading;
      boat.mesh.rotation.z = Math.sin(time * 1.3 + boat.phase) * 0.04;
    }
  }
}
