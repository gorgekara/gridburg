import type { Builder } from './buildingGeo';

/** A parking space: its centre in the lot's own frame (centred on the lot, front towards +z) and which way a car in it faces. */
export interface Stall { x: number; z: number; angle: number }

const STALL_W = 0.2, STALL_D = 0.28, AISLE = 0.3;

/**
 * Parking spaces on a lot `w` by `d` cells: one double row of bays per cell of depth, nose in to the
 * kerb on either side of a shared aisle, as many bays across as fit.
 */
export function parkingStalls(w: number, d: number): Stall[] {
  const out: Stall[] = [];
  const across = Math.floor((w - 0.16) / STALL_W);
  for (let k = 0; k < d; k++) {
    const mid = -d / 2 + (k + 0.5);
    for (const side of [-1, 1]) {
      const z = mid + side * (AISLE / 2 + STALL_D / 2);
      for (let j = 0; j < across; j++) out.push({ x: (j - (across - 1) / 2) * STALL_W, z, angle: side > 0 ? 0 : Math.PI });
    }
  }
  return out;
}

/** Asphalt, bay markings, a kerb round the edge, lamps down the aisles and a pay machine by the way in. */
export function parkingGeometry(b: Builder, w: number, d: number): void {
  b.shift = { x: (w - 1) / 2, z: (d - 1) / 2 };
  const W = w - 0.06, D = d - 0.06;
  b.box(w - 0.02, 0.02, d - 0.02, 0, 0, 0, 0xa9a699);
  b.box(W, 0.012, D, 0, 0.012, 0, 0x4a4d52);
  const across = Math.floor((w - 0.16) / STALL_W);
  const half = (across * STALL_W) / 2;
  for (let k = 0; k < d; k++) {
    const mid = -d / 2 + (k + 0.5);
    for (const side of [-1, 1]) {
      const z = mid + side * (AISLE / 2 + STALL_D / 2);
      // Bay lines between the spaces, and the line at the head of the row.
      for (let j = 0; j <= across; j++) b.box(0.012, 0.002, STALL_D, -half + j * STALL_W, 0.024, z, 0xe8e6dc);
      b.box(across * STALL_W, 0.002, 0.012, 0, 0.024, z + side * (STALL_D / 2 - 0.006), 0xe8e6dc);
      // Wheel stops at the head of each bay.
      if (b.detail > 0) for (let j = 0; j < across; j++) b.box(0.1, 0.012, 0.018, -half + (j + 0.5) * STALL_W, 0.024, z + side * (STALL_D / 2 - 0.04), 0xb9b6ab);
    }
    // Arrows down the aisle, and a lamp post in its middle on the bigger lots.
    for (let x = -w / 2 + 0.3; x < w / 2 - 0.2; x += 0.6) {
      b.box(0.14, 0.002, 0.018, x, 0.024, mid, 0xe8e6dc);
      b.box(0.018, 0.002, 0.05, x + 0.07, 0.024, mid, 0xe8e6dc);
    }
    if (w > 1) for (let x = -w / 2 + 1; x < w / 2 - 0.1; x += 1) {
      b.box(0.02, 0.4, 0.02, x, 0.024, mid, 0x5a5f63);
      b.box(0.14, 0.018, 0.035, x, 0.42, mid, 0x5a5f63);
      b.box(0.1, 0.006, 0.03, x, 0.414, mid, 0xfff1c8);
    }
  }
  // A kerb round the edge, low hedging along the sides and a little tree in each corner.
  for (const s of [-1, 1]) {
    b.box(W, 0.035, 0.03, 0, 0.012, s * (D / 2 - 0.015), 0xc9c5b8);
    b.box(0.03, 0.035, D, s * (W / 2 - 0.015), 0.012, 0, 0xc9c5b8);
  }
  if (b.detail > 0) for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.tree(sx * (W / 2 - 0.1), 0.03, sz * (D / 2 - 0.1), 0.3, 'broad', 0x55884a, 20 + sx + sz * 3);
  // The pay machine at the entrance.
  b.box(0.05, 0.12, 0.035, W / 2 - 0.09, 0.024, D / 2 - 0.06, 0x2f6f9e);
  b.box(0.035, 0.03, 0.004, W / 2 - 0.09, 0.09, D / 2 - 0.041, 0xd8e6ee);
  b.shift = { x: 0, z: 0 };
}
