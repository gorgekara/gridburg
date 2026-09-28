import { T_RES, T_COM, T_OFFICE } from '../constants';
import type { Kit, Body } from './streetDetail';

/**
 * How a lot looks for the neighbourhood it stands in. The street detail draws what every lot of a kind
 * has; this adds what the street's character brings. On rich streets that means trees in iron grilles
 * along the frontage, clipped hedges and gate piers, and a doorman's canopy on the flats. On poor streets
 * it means bare front gardens, a wheelie bin out front and more litter about. Where there is trouble
 * there are graffiti tags, shops with their roller shutters down, boarded windows and chain-link
 * fences. Where rubbish goes uncollected there are bin bags at the front and skips full of it, and
 * lots beside something loud get a tall timber fence at the back.
 *
 * Everything is drawn in the lot's own frame, which the caller has set on the kit: +z towards the
 * street, the lot running from -0.5 to 0.5.
 */
export interface LotLook {
  i: number;
  kind: number;
  level: number;
  body: Body | null;
  fine: boolean;
  /** How wide the pavement is between the lot's front edge (z 0.5) and the kerb. */
  pave: number;
  wealth: number;
  rough: number;
  litter: number;
  loud: number;
  rnd: () => number;
  /** A stable hash in [0, 1) for decisions that must not change between rebuilds. */
  hash: (salt: number) => number;
}

const TAG = [0xe8423a, 0x2fb0e8, 0xf2c230, 0x9a4fd8, 0x3fc86a, 0xf2f2ee, 0x1f1f22, 0xf07ab8];
const HEDGE = 0x3a6a33, STONE = 0xc9c2b2, IRON = 0x2a2c30, PLY = 0xb89a6a, LINK = 0xa3aab0, SHUTTER = 0x9ea4a8, TIMBER = 0x7a5a3c;
const pick = <T>(rnd: () => number, list: readonly T[]): T => list[Math.floor(rnd() * list.length) % list.length];

export function dressLot(kit: Kit, look: LotLook): void {
  const { kind: k, level: l, body: b, rnd } = look;
  const front = b ? b.z1 : 0.4, left = b ? b.x0 : -0.4, right = b ? b.x1 : 0.4, back = b ? b.z0 : -0.35;
  const house = k === T_RES && l === 1, flats = k === T_RES && l > 1;
  const yard = front < 0.4;
  // Where things set out at the front go: the forecourt if there is one, else the back of a wide pavement.
  const frontZ = front < 0.42 ? 0.44 : front + 0.028;
  kit.jitter = 0;

  // ---- wealth ----
  if (look.wealth >= 2) {
    const trees = look.wealth === 3 ? 2 : look.hash(3) < 0.5 ? 1 : 0;
    // Trees in grilles: in the forecourt, or on the pavement along the building line where it is wide.
    const treeZ = !house && yard ? 0.44 : !house && look.pave >= 0.2 ? 0.56 : null;
    if (treeZ !== null) for (let n = 0; n < trees; n++) streetTree(kit, (n ? 0.3 : -0.3) + (trees === 1 ? 0.3 : 0), treeZ, rnd);
    if (house && (look.wealth === 3 || look.hash(5) < 0.5)) hedge(kit, front);
    if (flats && look.wealth === 3) canopy(kit, front, front + Math.max(0.1, Math.min(0.2, 0.5 + look.pave - 0.04 - front)), look.hash(7));
  } else if (look.wealth === 0 && house && yard) {
    // A front garden gone to bare earth, and a bin that lives out front.
    kit.quad(-0.2, 0.0018, (front + 0.47) / 2, 0.5, 0.47 - front, 0x6b5a45);
    kit.quad(0.33, 0.0018, (front + 0.47) / 2, 0.24, 0.47 - front, 0x6b5a45);
    wheelieBin(kit, -0.28, 0.42, pick(rnd, [0x3a4a3a, 0x4a4a52]));
  }

  // ---- trouble ----
  if (look.rough > 0 && b) {
    if (look.hash(11) < (look.rough === 2 ? 0.6 : 0.3)) graffiti(kit, b, k === T_COM, rnd);
    if (k === T_COM && look.hash(13) < (look.rough === 2 ? 0.25 : 0.12)) shutter(kit, left, right, front, look.rough === 2 ? 1 : 0.5, rnd, true);
    if (look.rough === 2 && (house || flats) && look.hash(17) < 0.2) boarded(kit, b, rnd);
  }
  if (look.rough === 2 && house) chainLink(kit, 0.47, -0.47, 0.47, 0.1);

  // ---- rubbish ----
  if (look.litter > 0 && frontZ !== null && (look.litter === 2 ? look.hash(19) < 0.85 : look.hash(19) < 0.4)) {
    const n = look.litter === 2 ? 4 + Math.floor(rnd() * 4) : 2 + Math.floor(rnd() * 2);
    binBags(kit, house ? -0.2 : -0.3, frontZ - 0.005, n, rnd);
  }
  if (look.litter === 2 && look.hash(23) < 0.2 && right + 0.14 < 0.47) skip(kit, right + 0.08, Math.min(front, 0.3) - 0.1, rnd);
  if (look.fine) {
    const scraps = (look.wealth === 0 ? 4 : look.wealth === 3 ? 0 : 1) + look.litter * 3;
    for (let n = 0; n < scraps; n++) {
      const z = front + 0.02 + rnd() * Math.max(0.01, 0.46 - front);
      if (z > 0.47) continue;
      kit.jitter = (rnd() - 0.5) * 0.2;
      kit.quad(-0.44 + rnd() * 0.88, 0.0022, z, 0.006 + rnd() * 0.008, 0.005 + rnd() * 0.006, pick(rnd, [0xe8e2d0, 0xc8382f, 0x8a6a3a, 0x2f5f9f, 0x9ac27f]), rnd() * 3);
    }
    kit.jitter = 0;
  }

  // ---- noise ----
  if (look.loud && back > -0.4 && (k === T_RES || k === T_OFFICE || k === T_COM)) acousticFence(kit);
}

/** Street trees along the frontage of built-up streets, in a round iron grille. */
function streetTree(kit: Kit, x: number, z: number, rnd: () => number): void {
  kit.jitter = 0;
  kit.disc(x, 0.0024, z, 0.035, IRON, 10);
  kit.disc(x, 0.0028, z, 0.028, 0x5b4a3a, 10);
  kit.prism(x, 0, z, 0.007, 0.16, 0x5a4330, 6, 0.005);
  kit.jitter = (rnd() - 0.5) * 0.15;
  const leaf = pick(rnd, [0x4f7f3d, 0x5a8a45, 0x6a9a4a]);
  kit.lump(x, 0.13, z, 0.06, leaf, 0.85, rnd);
  kit.lump(x + 0.03, 0.17, z - 0.01, 0.045, leaf, 0.85, rnd);
  kit.jitter = 0;
}

/** A clipped hedge along the front of a house, open at the path, with stone piers either side of the gap. */
function hedge(kit: Kit, front: number): void {
  if (front > 0.44) return;
  kit.jitter = 0;
  const z = 0.462, h = 0.045, gap0 = 0.05, gap1 = 0.15;
  kit.box((-0.47 + gap0) / 2, 0, z, gap0 + 0.47, h, 0.03, HEDGE);
  kit.box((gap1 + 0.47) / 2, 0, z, 0.47 - gap1, h, 0.03, HEDGE);
  for (const x of [gap0 - 0.008, gap1 + 0.008]) {
    kit.box(x, 0, z, 0.02, 0.06, 0.03, STONE);
    kit.box(x, 0.06, z, 0.026, 0.006, 0.036, 0xb5ad9c);
  }
}

/** A doorman's canopy out from the entrance of the smart flats, on two brass posts, with a mat. */
function canopy(kit: Kit, front: number, reach: number, h: number): void {
  const color = h < 0.5 ? 0x1f3a2a : 0x1f2a45, depth = reach - front, z = front + depth / 2;
  if (depth < 0.06) return;
  kit.jitter = 0;
  const y = 0.19;
  kit.box(0, y, z, 0.11, 0.008, depth, color);
  kit.box(0, y - 0.018, front + depth - 0.002, 0.11, 0.022, 0.004, color);
  kit.box(0, y - 0.004, front + depth, 0.07, 0.006, 0.0008, 0xd8c890);
  for (const x of [-0.05, 0.05]) kit.box(x, 0, front + depth - 0.006, 0.004, y, 0.004, 0xc9a24a);
  kit.quad(0, 0.0022, z, 0.08, depth, 0x8a2a2a);
}

function wheelieBin(kit: Kit, x: number, z: number, color: number): void {
  kit.box(x, 0, z, 0.034, 0.05, 0.036, color);
  kit.box(x, 0.05, z, 0.037, 0.005, 0.04, color);
}

/** Spray-painted tags on the walls: zigzag strokes, now and then a filled piece with an outline. */
function graffiti(kit: Kit, b: Body, shop: boolean, rnd: () => number): void {
  const top = Math.min(0.17, b.h - 0.02);
  if (top < 0.06) return;
  // Walls to spray: the sides always, the front unless it is a shop window.
  const walls: { u0: number; u1: number; yaw: number; at: (u: number, y: number) => [number, number, number] }[] = [];
  const r = b.r, zs0 = b.z0 + r + 0.02, zs1 = b.z1 - r - 0.02, xs0 = b.x0 + r + 0.02, xs1 = b.x1 - r - 0.02;
  if (zs1 - zs0 > 0.08) {
    walls.push({ u0: zs0, u1: zs1, yaw: Math.PI / 2, at: (u, y) => [b.x0 - 0.003, y, u] });
    walls.push({ u0: zs0, u1: zs1, yaw: Math.PI / 2, at: (u, y) => [b.x1 + 0.003, y, u] });
  }
  if (!shop && xs1 - xs0 > 0.08) walls.push({ u0: xs0, u1: xs1, yaw: 0, at: (u, y) => [u, y, b.z1 + 0.003] });
  if (!walls.length) return;
  const pieces = 2 + Math.floor(rnd() * 3);
  kit.jitter = 0;
  for (let n = 0; n < pieces; n++) {
    const w = pick(rnd, walls), span = 0.06 + rnd() * 0.09;
    if (w.u1 - w.u0 < span) continue;
    const u = w.u0 + rnd() * (w.u1 - w.u0 - span), y = 0.03 + rnd() * (top - 0.08), color = pick(rnd, TAG);
    if (rnd() < 0.45) {
      // A piece: a block of colour behind the letters.
      const [cx, , cz] = w.at(u + span / 2, y);
      kit.box(cx, y - 0.004, cz, span + 0.014, 0.05, 0.0012, pick(rnd, TAG), w.yaw);
    }
    // The letters: a zigzag of strokes along the wall.
    let pu = u, py = y + 0.01 + rnd() * 0.02;
    while (pu < u + span) {
      const nu = pu + 0.008 + rnd() * 0.012, ny = y + 0.003 + rnd() * 0.04;
      const [x0, y0, z0] = w.at(pu, py), [x1, y1, z1] = w.at(Math.min(nu, u + span), ny);
      kit.beam(x0, y0, z0, x1, y1, z1, 0.0055, color);
      pu = nu; py = ny;
    }
  }
}

/**
 * A roller shutter over a shop front: `down` 1 is shut to the ground, 0.5 half down. Ribbed grey
 * slats with the housing box above, tagged over now and then.
 */
export function shutter(kit: Kit, left: number, right: number, front: number, down: number, rnd: () => number, tagged = false): void {
  const w = right - left - 0.04, x = (left + right) / 2, top = 0.15, h = top * down, z = front + 0.004;
  if (w < 0.06) return;
  kit.jitter = 0;
  kit.box(x, top, z + 0.004, w + 0.01, 0.022, 0.012, 0x7d8387);
  kit.box(x, top - h, z, w, h, 0.003, SHUTTER);
  for (let y = top - h + 0.008; y < top; y += 0.012) kit.box(x, y, z + 0.0018, w, 0.0016, 0.0006, 0x80868a);
  if (tagged && rnd() < 0.7) {
    let px = x - w / 2 + 0.02, py = top - h + 0.02;
    const color = pick(rnd, TAG);
    while (px < x + w / 2 - 0.02) {
      const nx = px + 0.01 + rnd() * 0.015, ny = top - h + 0.012 + rnd() * Math.max(0.01, h - 0.03);
      kit.beam(px, py, z + 0.0025, nx, ny, z + 0.0025, 0.004, color);
      px = nx; py = ny;
    }
  }
}

/** Plywood nailed over a few windows. */
function boarded(kit: Kit, b: Body, rnd: () => number): void {
  const floors = Math.max(1, Math.min(4, Math.floor((b.h - 0.1) / 0.31)));
  kit.jitter = 0;
  for (let f = 0; f < floors; f++) for (let n = 0; n < 2; n++) {
    if (rnd() < 0.45) continue;
    const x = b.x0 + 0.06 + rnd() * Math.max(0.01, b.x1 - b.x0 - 0.12), y = 0.1 + f * 0.31;
    kit.jitter = (rnd() - 0.5) * 0.15;
    kit.box(x, y, b.z1 + 0.002, 0.05, 0.07, 0.003, PLY);
  }
  kit.jitter = 0;
}

/** A chain-link fence along a lot's front, from `x0` to `x1` at `z`, with a gap at `gapAt` for the path. */
export function chainLink(kit: Kit, z: number, x0: number, x1: number, gapAt: number | null = null): void {
  kit.jitter = 0;
  const h = 0.075;
  for (let x = x0; x <= x1 + 1e-6; x += 0.13) {
    if (gapAt !== null && Math.abs(x - gapAt) < 0.06) continue;
    kit.box(x, 0, z, 0.004, h + 0.005, 0.004, 0x7a8288);
  }
  const runs: [number, number][] = gapAt === null ? [[x0, x1]] : [[x0, gapAt - 0.06], [gapAt + 0.06, x1]];
  for (const [a, c] of runs) {
    if (c - a < 0.02) continue;
    kit.box((a + c) / 2, 0.004, z, c - a, h - 0.004, 0.0008, LINK);
    kit.beam(a, h, z, c, h, z, 0.003, 0x7a8288);
  }
}

/** Black bin bags heaped at the front of the lot. */
function binBags(kit: Kit, x: number, z: number, n: number, rnd: () => number): void {
  for (let k = 0; k < n; k++) {
    kit.jitter = (rnd() - 0.5) * 0.25;
    kit.lump(x + (rnd() - 0.5) * 0.1, k > 3 ? 0.014 : 0, z + (rnd() - 0.5) * 0.03, 0.014 + rnd() * 0.006, rnd() < 0.8 ? 0x1f2124 : 0x3a4a5a, 0.85, rnd);
  }
  kit.jitter = 0;
}

/** A builder's skip, full of rubbish. */
function skip(kit: Kit, x: number, z: number, rnd: () => number): void {
  kit.jitter = 0;
  const color = pick(rnd, [0xe0a021, 0x2f6f4f, 0x3a5a8a]);
  kit.box(x, 0, z, 0.1, 0.012, 0.16, 0x3a3c40, Math.PI / 2);
  kit.box(x, 0.012, z, 0.12, 0.05, 0.18, color, Math.PI / 2);
  for (let n = 0; n < 6; n++) {
    kit.jitter = (rnd() - 0.5) * 0.3;
    kit.lump(x + (rnd() - 0.5) * 0.12, 0.05, z + (rnd() - 0.5) * 0.07, 0.018, pick(rnd, [0x6b5a45, 0x8a6240, 0x9a968c, 0x1f2124, 0xc9c2b2]), 0.6, rnd);
  }
  kit.jitter = 0;
}

/** A tall timber fence along the back of the lot, against the noise of what lies beyond. */
function acousticFence(kit: Kit): void {
  kit.jitter = 0;
  kit.box(0, 0, -0.475, 0.94, 0.14, 0.012, TIMBER);
  for (let x = -0.45; x <= 0.45; x += 0.15) kit.box(x, 0, -0.468, 0.012, 0.145, 0.006, 0x5a4330);
  kit.box(0, 0.14, -0.475, 0.95, 0.008, 0.02, 0x5a4330);
}
