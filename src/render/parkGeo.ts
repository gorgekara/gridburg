import { T_PATH, T_POND, T_PARK_SHOP, T_TREE, T_FLOWERS, T_BENCH, T_FOUNTAIN, T_PLAZA, T_LAWN } from '../constants';
import { Builder } from './buildingGeo';

/** Where a grove's trees stand, pulled in from any side with a building or road on it. */
function groveSpots(blocked: number): [number, number, number][] {
  const spots: [number, number, number][] = [[-0.19, -0.12, 0.7], [0.2, 0.16, 0.85], [0.2, -0.24, 0.5]];
  return spots.map(([x, z, h]) => {
    // Keep a canopy's width back from a built-up edge; squeezed from both sides, it grows smaller.
    const room = 0.5 - 0.2 * h;
    const lo = (side: number): number => (blocked & (1 << side) ? -room + 0.12 : -0.5);
    const hi = (side: number): number => (blocked & (1 << side) ? room - 0.12 : 0.5);
    const squeeze = ((blocked & 5) === 5 ? 0.8 : 1) * ((blocked & 10) === 10 ? 0.8 : 1);
    return [Math.min(hi(1), Math.max(lo(3), x)), Math.min(hi(2), Math.max(lo(0), z)), h * squeeze];
  });
}

/**
 * Shared, static tile pieces; paths join their neighbours using a four-bit connection mask, and a tree
 * grove uses the same mask for the sides it must keep clear of. Only the park surfaces lay their own
 * ground; everything else stands on the town's grass, so it matches the land around it.
 */
export function parkGeometry(b: Builder, kind: number, connections: number): void {
  if (kind === T_PATH || kind === T_PLAZA || kind === T_LAWN) b.box(1, 0.012, 1, 0, 0, 0, kind === T_PLAZA ? 0xb7b3a6 : 0x749858);
  if (kind === T_PATH) {
    const mask = connections || 5;
    b.box(0.13, 0.012, 0.13, 0, 0.014, 0, 0xd0be98);
    for (let side = 0; side < 4; side++) if (mask & (1 << side)) {
      const dx = [0, 1, 0, -1][side], dz = [-1, 0, 1, 0][side];
      b.box(dx ? 0.5 : 0.13, 0.012, dz ? 0.5 : 0.13, dx * 0.25, 0.014, dz * 0.25, 0xd0be98);
    }
  } else if (kind === T_POND && b.detail > 0) {
    // An irregular pond with a stone rim, lily pads and reeds.
    b.flat(Builder.blobOutline(0, 0, 0.44, 0.4, 0.09, 2), 0.032, 0.02, 0xb5b08d);
    b.flat(Builder.blobOutline(0, 0, 0.39, 0.35, 0.09, 2), 0.036, 0.006, 0x5199a5);
    for (const [x, z] of [[-0.18, 0.1], [0.12, 0.22], [0.2, -0.12]]) {
      b.cyl(0.045, 0.005, x, 0.04, z, 0x6a975d, 8);
      b.cyl(0.012, 0.014, x, 0.045, z, 0xdbb1b3, 6);
    }
    for (const x of [-0.24, -0.16, -0.08]) b.taper(0.002, 0.008, 0.15, x, 0.035, -0.3, 0x687d42, 5);
  } else if (kind === T_POND) {
    b.cyl(0.44, 0.018, 0, 0.014, 0, 0xb5b08d, 16);
    b.cyl(0.39, 0.006, 0, 0.033, 0, 0x5199a5, 16);
    for (const [x, z] of [[-0.18, 0.1], [0.12, 0.22], [0.2, -0.12]]) {
      b.cyl(0.045, 0.005, x, 0.04, z, 0x6a975d, 6);
      b.cyl(0.012, 0.014, x, 0.045, z, 0xdbb1b3, 5);
    }
    for (const x of [-0.24, -0.16, -0.08]) b.box(0.012, 0.15, 0.012, x, 0.035, -0.32, 0x687d42);
  } else if (kind === T_PARK_SHOP) {
    b.box(0.6, 0.025, 0.6, 0, 0.015, 0, 0xc3b493);
    b.box(0.4, 0.35, 0.34, 0, 0.04, -0.06, 0xd8c49b);
    b.box(0.46, 0.045, 0.43, 0, 0.39, -0.03, 0x4d806d);
    b.box(0.3, 0.15, 0.012, 0, 0.17, 0.116, 0x31494e);
    b.box(0.36, 0.025, 0.1, 0, 0.16, 0.15, 0x977551);
    b.box(0.33, 0.028, 0.22, 0, 0.32, 0.19, 0xd1ae63);
    for (const x of [-0.12, 0, 0.12]) b.box(0.05, 0.004, 0.22, x, 0.348, 0.19, 0xe9dfc3);
    b.pane(0.21, 0.035, 0, 0.365, 0.187, 0, 0xeee1bc);
  } else if (kind === T_TREE && b.detail > 0) {
    // Broadleaves and a conifer, shaped and lumpy rather than a pair of cones.
    const [a, c, d] = groveSpots(connections);
    b.tree(a[0], 0.012, a[1], a[2], 'broad', 0x4c7b49, 11);
    b.tree(c[0], 0.012, c[1], c[2], 'conifer', 0x3f7a4c, 12);
    b.tree(d[0], 0.012, d[1], d[2], 'broad', 0x5a8a4a, 13);
    b.flat(Builder.blobOutline(a[0], a[1], 0.09, 0.08, 0.1, 1), 0.016, 0.004, 0x5b4a3a);
  } else if (kind === T_TREE) {
    for (const [x, z, h] of groveSpots(connections)) {
      b.cyl(0.035, h * 0.48, x, 0.015, z, 0x786047, 6);
      b.taper(0.015, 0.23, h * 0.7, x, h * 0.3, z, 0x4c7b49, 7);
      b.taper(0.01, 0.17, h * 0.55, x, h * 0.58, z, 0x638b4e, 7);
    }
  } else if (kind === T_FLOWERS && b.detail > 0) {
    // An oval bed in a stone kerb, planted in rings of colour.
    b.flat(Builder.blobOutline(0, 0, 0.36, 0.28, 0.04, 4, 24), 0.05, 0.04, 0xa8a398);
    b.flat(Builder.blobOutline(0, 0, 0.33, 0.25, 0.04, 4, 24), 0.055, 0.03, 0x6a5238);
    const ringColors = [0x507d45, 0xc7667d, 0xe3be6f, 0xb28dbf];
    ringColors.forEach((color, ring) => {
      const rx = 0.28 - ring * 0.07, rz = 0.2 - ring * 0.05, n = Math.max(4, Math.round((rx + rz) * 22));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        b.cyl(ring === 0 ? 0.028 : 0.02, 0.03 + (k % 3) * 0.006, Math.cos(a) * rx, 0.055, Math.sin(a) * rz, color, 6);
      }
    });
    b.cyl(0.03, 0.05, 0, 0.055, 0, 0xe06a6a, 7);
  } else if (kind === T_FLOWERS) {
    b.box(0.66, 0.03, 0.5, 0, 0.02, 0, 0x8e7452);
    b.box(0.61, 0.03, 0.45, 0, 0.05, 0, 0x507d45);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) b.box(0.045, 0.025, 0.045, -0.24 + col * 0.12, 0.08, -0.16 + row * 0.16, [0xc7667d, 0xe3be6f, 0xb28dbf][row]);
  } else if (kind === T_BENCH) {
    // Match the street-level pedestrian scale (eye height 0.13 above ground).
    for (const x of [-0.055, 0.055]) b.box(0.01, 0.025, 0.055, x, 0.012, 0, 0x4e5e5a);
    for (const z of [-0.019, 0, 0.019]) b.box(0.15, 0.007, 0.014, 0, 0.037, z, 0xa27e53);
    for (const x of [-0.055, 0.055]) b.box(0.008, 0.05, 0.008, x, 0.037, -0.026, 0x4e5e5a);
    for (const y of [0.056, 0.076]) b.box(0.15, 0.011, 0.007, 0, y, -0.026, 0xa27e53);
  } else if (kind === T_FOUNTAIN) {
    b.cyl(0.39, 0.12, 0, 0.02, 0, 0xb7b6a6, 16);
    b.cyl(0.34, 0.012, 0, 0.14, 0, 0x73b3be, 16);
    b.cyl(0.055, 0.27, 0, 0.15, 0, 0xd5d5c5, 8);
    b.taper(0.19, 0.05, 0.05, 0, 0.4, 0, 0xc5c5b5, 12);
    b.cyl(0.165, 0.008, 0, 0.453, 0, 0x91ccd0, 12);
    b.taper(0.01, 0.035, 0.19, 0, 0.46, 0, 0xc5e6e4, 6);
  } else if (kind === T_PLAZA) {
    for (const t of [-0.25, 0.25]) {
      b.box(0.006, 0.002, 1, t, 0.013, 0, 0x929587);
      b.box(1, 0.002, 0.006, 0, 0.013, t, 0x929587);
    }
  } else if (kind === T_LAWN) {
    for (const z of [-0.375, 0.125]) b.box(1, 0.002, 0.25, 0, 0.013, z, 0x7e9f61);
  }
}
