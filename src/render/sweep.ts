import * as THREE from 'three';

/** One station along a swept path: position plus the horizontal direction of travel. */
export interface SweepPoint { x: number; y: number; z: number; tx: number; tz: number }

/**
 * A profile vertex: [across, up] offsets from the path, `across` positive to the right of travel.
 * With a third element `1`, `up` is an absolute world y instead (e.g. a wall down to the ground).
 */
export type ProfileVertex = readonly [number, number] | readonly [number, number, 0 | 1];

export interface SweepOptions {
  /** Treat the profile as a closed polygon (default true). Open profiles sweep only their edges. */
  closed?: boolean;
  /** Close the start and end with flat caps (closed profiles only, default true). */
  caps?: boolean;
  /** Colour of the caps; defaults to the first edge colour. */
  capColor?: number;
}

/**
 * Accumulates flat-shaded, vertex-coloured triangles (non-indexed position/normal/color) from
 * profile sweeps, so bridges, viaducts and walls can be merged into one mesh.
 */
export class SweepBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private c = new THREE.Color();

  get triangleCount(): number { return this.pos.length / 9; }

  /** Flat triangle; the normal comes from the winding (counter-clockwise seen from the front). */
  tri(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, color: number): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9)) return; // degenerate
    nx /= l; ny /= l; nz /= l;
    this.c.setHex(color);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  /** Planar quad a-b-c-d, counter-clockwise seen from the front. */
  quad(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, d: ArrayLike<number>, color: number): void {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /**
   * Extrudes `profile` along `path`. `colors` is one colour for everything or one per profile edge
   * (edge k runs from vertex k to k+1). Faces point outward whichever way the profile is wound.
   */
  sweep(path: readonly SweepPoint[], profile: readonly ProfileVertex[], colors: number | readonly number[], opts: SweepOptions = {}): void {
    const closed = opts.closed ?? true, caps = (opts.caps ?? true) && closed;
    const m = profile.length;
    if (path.length < 2 || m < 2) return;
    const edgeColor = (k: number): number => typeof colors === 'number' ? colors : colors[k % colors.length];
    // Outward normals need a counter-clockwise profile in (across, up); flip the quads otherwise.
    // Measured at the middle station, since absolute-y vertices change the shape along the path.
    const mid = path[path.length >> 1];
    const up = (v: ProfileVertex, s: SweepPoint): number => v[2] ? v[1] - s.y : v[1];
    let area = 0;
    for (let k = 0; k < m; k++) {
      const p = profile[k], q = profile[(k + 1) % m];
      area += p[0] * up(q, mid) - q[0] * up(p, mid);
    }
    const ccw = !closed || area >= 0;
    const ring = (s: SweepPoint): number[][] => {
      const l = Math.hypot(s.tx, s.tz) || 1, rx = -s.tz / l, rz = s.tx / l;
      return profile.map(v => [s.x + rx * v[0], v[2] ? v[1] : s.y + v[1], s.z + rz * v[0]]);
    };
    let prev = ring(path[0]);
    const first = prev;
    for (let i = 1; i < path.length; i++) {
      const cur = ring(path[i]);
      const edges = closed ? m : m - 1;
      for (let k = 0; k < edges; k++) {
        const k1 = (k + 1) % m;
        const A = prev[k], B = prev[k1], C = cur[k1], D = cur[k];
        // With a CCW profile (right = (-tz, tx)), A-D-C and A-C-B face outward.
        if (ccw) { this.tri(A, D, C, edgeColor(k)); this.tri(A, C, B, edgeColor(k)); }
        else { this.tri(A, C, D, edgeColor(k)); this.tri(A, B, C, edgeColor(k)); }
      }
      prev = cur;
    }
    if (caps) {
      const capColor = opts.capColor ?? edgeColor(0);
      const ends: [number[][], SweepPoint, number][] = [[first, path[0], -1], [prev, path[path.length - 1], 1]];
      for (const [pts, s, dir] of ends) {
        const faces = THREE.ShapeUtils.triangulateShape(profile.map(v => new THREE.Vector2(v[0], up(v, s))), []);
        for (const [a, b, c] of faces) {
          // Wind each cap triangle so it faces away from the solid (backward at the start, forward at the end).
          const ux = pts[b][0] - pts[a][0], uy = pts[b][1] - pts[a][1], uz = pts[b][2] - pts[a][2];
          const vx = pts[c][0] - pts[a][0], vy = pts[c][1] - pts[a][1], vz = pts[c][2] - pts[a][2];
          const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
          if ((nx * s.tx + nz * s.tz) * dir >= 0) this.tri(pts[a], pts[b], pts[c], capColor);
          else this.tri(pts[a], pts[c], pts[b], capColor);
        }
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Stations along a straight run from (x0, y0, z0) to (x1, y1, z1); handy for beams and arms. */
export function straightPath(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): SweepPoint[] {
  const l = Math.hypot(x1 - x0, z1 - z0) || 1, tx = (x1 - x0) / l, tz = (z1 - z0) / l;
  return [{ x: x0, y: y0, z: z0, tx, tz }, { x: x1, y: y1, z: z1, tx, tz }];
}
