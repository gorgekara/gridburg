import * as THREE from 'three';

/** Accumulates flat, vertex-colored triangles (ribbons, discs, arrows) into one geometry. */
export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private c = new THREE.Color();

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private vert(x: number, y: number, z: number): number {
    this.pos.push(x, y, z);
    this.col.push(this.c.r, this.c.g, this.c.b);
    return this.pos.length / 3 - 1;
  }

  /**
   * Ribbon along a polyline of x,z pairs. `half` may vary per point. `offset` shifts it sideways
   * (positive = to the right of the direction of travel). Returns the [start, end) vertex range.
   */
  ribbon(pts: ArrayLike<number>, count: number, half: number | ArrayLike<number>, y: number, color: number, offset = 0): [number, number] {
    this.c.setHex(color);
    const start = this.vertexCount;
    for (let i = 0; i < count; i++) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      const i0 = Math.max(0, i - 1), i1 = Math.min(count - 1, i + 1);
      let tx = pts[i1 * 2] - pts[i0 * 2], tz = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      const rx = -tz, rz = tx; // right of travel
      const h = typeof half === 'number' ? half : half[i];
      this.vert(x + rx * (offset - h), y, z + rz * (offset - h));
      this.vert(x + rx * (offset + h), y, z + rz * (offset + h));
      if (i > 0) {
        const a = start + (i - 1) * 2;
        this.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    return [start, this.vertexCount];
  }

  disc(x: number, z: number, r: number, y: number, color: number, segments = 18): void {
    this.c.setHex(color);
    const center = this.vert(x, y, z);
    for (let k = 0; k <= segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      const v = this.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      if (k > 0) this.idx.push(center, v, v - 1);
    }
  }

  /** Flat ring between two radii. */
  ring(x: number, z: number, r0: number, r1: number, y: number, color: number, segments = 40): void {
    this.c.setHex(color);
    const start = this.vertexCount;
    for (let k = 0; k <= segments; k++) {
      const a = (k / segments) * Math.PI * 2;
      this.vert(x + Math.cos(a) * r0, y, z + Math.sin(a) * r0);
      this.vert(x + Math.cos(a) * r1, y, z + Math.sin(a) * r1);
      if (k > 0) {
        const v = start + (k - 1) * 2;
        this.idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      }
    }
  }

  /** Small arrowhead pointing along (tx, tz). */
  arrow(x: number, z: number, tx: number, tz: number, size: number, y: number, color: number): void {
    this.c.setHex(color);
    const rx = -tz, rz = tx;
    const a = this.vert(x + tx * size, y, z + tz * size);
    const b = this.vert(x - tx * size * 0.6 + rx * size * 0.7, y, z - tz * size * 0.6 + rz * size * 0.7);
    const c = this.vert(x - tx * size * 0.6 - rx * size * 0.7, y, z - tz * size * 0.6 - rz * size * 0.7);
    this.idx.push(a, c, b);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const n = this.vertexCount;
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) normals[i * 3 + 1] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
