import { T_RES, T_COM, T_OFFICE, T_LEISURE } from '../constants';
import { TIME } from './character';
import type { Kit, Body } from './streetDetail';
import { WINDOW_LIT } from './buildingGeo';

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
  /** Where what lights up at night is drawn: in the same frame as `kit`. */
  glow: Kit;
  /** The part of the day (see `TIME`). */
  time: number;
  /** The lot grew a level lately: scaffolding is still up. */
  grown: boolean;
  /** The lot is on an avenue. */
  avenue: boolean;
  /** A run of busy shops round it: a street a market sets up on. */
  market: boolean;
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
  /** Whether a built shop stands within a couple of cells: flats there may keep a shop downstairs. */
  nearShops: boolean;
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
  // The clear ground between the building's front and the kerb line: the forecourt and any pavement.
  const room = 0.5 + Math.max(0, look.pave) - front, mid = front + room / 2;
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

  // Shops close at night, except the late ones; a rough street has some shut by day as well.
  const night = look.time === TIME.NIGHT, late = look.hash(37) < 0.2;
  const closed = k === T_COM && ((night && !late) || (look.rough > 0 && look.hash(13) < (look.rough === 2 ? 0.25 : 0.12)));

  // A shop on the ground floor of flats beside a shopping street.
  if (flats && b && look.nearShops && look.hash(29) < 0.6) groundShop(kit, look.glow, b, look.hash(31), night && !late, rnd);

  // ---- street life ----
  if (b && ((k === T_COM && look.level >= 2) || k === T_LEISURE)) neon(look.glow, front, look.hash(53), rnd);
  const day = look.time === TIME.MORNING || look.time === TIME.MIDDAY || look.time === TIME.AFTERNOON;
  if (k === T_COM && look.market && room >= 0.1 && look.hash(41) < 0.5) stall(kit, (look.hash(43) - 0.5) * 0.5, mid, day, rnd);
  if (k === T_OFFICE && room >= 0.07 && look.time === TIME.MIDDAY && look.hash(47) < (look.avenue ? 0.45 : 0.25)) lunchCart(kit, look.hash(49) < 0.5 ? -0.28 : 0.28, mid, rnd);
  if (k === T_COM && room >= 0.16 && (look.time === TIME.EARLY || look.time === TIME.MORNING) && look.hash(59) < 1 / 6) deliveryVan(kit, mid, rnd);
  if (look.grown && b) scaffolding(kit, b, rnd);

  // ---- trouble ----
  if (closed) shutter(kit, left, right, front, look.rough === 2 || night ? 1 : 0.5, rnd, look.rough > 0);
  if (look.rough > 0 && b) {
    if (look.hash(11) < (look.rough === 2 ? 0.6 : 0.3)) graffiti(kit, b, k === T_COM, rnd);
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

const FASCIA = [0x2f5f4f, 0x7a2f2f, 0x2f3f6f, 0x3a3a3a, 0x6a4f2f, 0x2f6f7f];

/**
 * A shop let into the ground floor of a block of flats, beside the door: a shop window with its lit
 * display, a painted fascia board over it, and a short awning.
 */
function groundShop(kit: Kit, glow: Kit, b: Body, h: number, shut: boolean, rnd: () => number): void {
  const x0 = b.x0 + b.r + 0.03, x1 = -0.09, z = b.z1;
  if (x1 - x0 < 0.12) return;
  const w = x1 - x0, x = (x0 + x1) / 2, fascia = FASCIA[Math.floor(h * FASCIA.length)];
  kit.jitter = 0;
  kit.box(x, 0.01, z + 0.002, w, 0.17, 0.004, 0x2a2f36);
  kit.box(x, 0.022, z + 0.005, w - 0.016, 0.148, 0.002, 0x9fc4d8);
  // The display's strip light, which glows after dark.
  glow.box(x, 0.022, z + 0.0065, w - 0.03, 0.014, 0.0015, WINDOW_LIT);
  for (let n = 0; n < 5; n++) kit.box(x0 + 0.03 + rnd() * (w - 0.06), 0.036, z + 0.008, 0.014, 0.02 + rnd() * 0.03, 0.006, pick(rnd, [0xd8453b, 0xf2c94c, 0x6fa8dc, 0xe8e2d0]));
  kit.box(x, 0.18, z + 0.006, w + 0.01, 0.036, 0.008, fascia);
  kit.box(x, 0.19, z + 0.0105, w * 0.6, 0.016, 0.001, 0xf2f2ee);
  kit.beam(x0, 0.176, z + 0.004, x0, 0.15, z + 0.06, 0.004, fascia);
  kit.box(x, 0.146, z + 0.034, w, 0.004, 0.06, fascia);
  if (shut) shutter(kit, x0 - 0.01, x1 + 0.01, z + 0.004, 1, rnd);
}

const NEON = [0xff3d8b, 0x3de8ff, 0xffd23d, 0x9b5cff, 0x5cff8a, 0xff6a3d];

/** A neon sign over the entrance: an outlined panel and a scrawl of lettering, lit after dark. */
function neon(glow: Kit, front: number, h: number, rnd: () => number): void {
  const color = NEON[Math.floor(h * NEON.length)], y = 0.22, z = front + 0.014, w = 0.14 + h * 0.06, t = 0.007, hh = 0.06;
  glow.jitter = 0;
  glow.beam(-w / 2, y, z, w / 2, y, z, t, color);
  glow.beam(-w / 2, y + hh, z, w / 2, y + hh, z, t, color);
  glow.beam(-w / 2, y, z, -w / 2, y + hh, z, t, color);
  glow.beam(w / 2, y, z, w / 2, y + hh, z, t, color);
  // The lettering, in a second colour: a looping scrawl across the panel.
  const letters = pick(rnd, NEON.filter(c => c !== color));
  let px = -w / 2 + 0.018, py = y + 0.02;
  while (px < w / 2 - 0.022) {
    const nx = px + 0.01 + rnd() * 0.012, ny = y + 0.014 + rnd() * 0.032;
    glow.beam(px, py, z + 0.002, nx, ny, z + 0.002, 0.005, letters);
    px = nx; py = ny;
  }
}

const STRIPE = [0xc8382f, 0x2f6f4f, 0x2f5f9f, 0xd98a2b];
const PRODUCE = [0xd8453b, 0xe0a021, 0x7fae4f, 0xf5a14a, 0x9a4fd8, 0xf2e6a0];

/** A market stall on the pavement: a striped roof on poles over a trestle of produce, or by night the bare frame. */
function stall(kit: Kit, x: number, z: number, open: boolean, rnd: () => number): void {
  const w = 0.16, d = 0.06, h = 0.14;
  kit.jitter = 0;
  for (const [px, pz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) kit.box(x + px, 0, z + pz, 0.004, h, 0.004, 0x5a5e62);
  if (!open) { kit.beam(x - w / 2, h, z - d / 2, x + w / 2, h, z - d / 2, 0.004, 0x5a5e62); kit.beam(x - w / 2, h, z + d / 2, x + w / 2, h, z + d / 2, 0.004, 0x5a5e62); return; }
  const color = pick(rnd, STRIPE);
  for (let k = 0; k < 4; k++) kit.box(x - w / 2 + (k + 0.5) * w / 4, h, z, w / 4, 0.006, d + 0.02, k % 2 ? 0xf2f2ee : color);
  kit.box(x, 0.055, z, w - 0.01, 0.006, d - 0.01, 0x8a6240);
  for (let k = 0; k < 6; k++) { kit.jitter = (rnd() - 0.5) * 0.2; kit.lump(x - w / 2 + 0.015 + rnd() * (w - 0.03), 0.061, z - d / 2 + 0.01 + rnd() * (d - 0.02), 0.008, pick(rnd, PRODUCE), 0.8, rnd); }
  kit.jitter = 0;
  for (let k = 0; k < 3; k++) kit.box(x - w / 2 + 0.03 + k * 0.05, 0, z + d / 2 + 0.015, 0.035, 0.02, 0.025, 0x9a7a4a);
}

/** A person, standing or sat, as simply as the pavement crowds are drawn. */
export function figure(kit: Kit, x: number, z: number, yaw: number, sat: boolean, rnd: () => number): void {
  const coat = pick(rnd, [0x2f5f9f, 0xc8382f, 0x3a3c40, 0x6a8f4f, 0xe0a021, 0x8a6a9a]), skin = pick(rnd, [0xe8c4a0, 0xc68a5a, 0x8a5a3a, 0xf0d0b0]);
  const base = sat ? 0.02 : 0;
  kit.jitter = 0;
  if (!sat) kit.box(x, 0, z, 0.014, 0.036, 0.01, 0x2a2c30, yaw);
  kit.box(x, base + (sat ? 0 : 0.036), z, 0.018, 0.032, 0.012, coat, yaw);
  kit.box(x, base + (sat ? 0.032 : 0.068), z, 0.011, 0.012, 0.011, skin, yaw);
}

/** A lunch cart outside the offices at midday: a steel cart, its umbrella, and people queuing along the front. */
function lunchCart(kit: Kit, x: number, z: number, rnd: () => number): void {
  const color = pick(rnd, [0xe0a021, 0xd8453b, 0x3fae9f, 0xf07ab8]);
  kit.jitter = 0;
  kit.box(x, 0.012, z, 0.09, 0.05, 0.045, 0xc8ccce);
  kit.box(x, 0.035, z + 0.023, 0.07, 0.02, 0.002, color);
  for (const o of [-0.03, 0.03]) kit.log(x + o, 0, z, 0.012, 0.006, 0x2a2f36, Math.PI / 2, 8);
  kit.box(x, 0.062, z, 0.003, 0.09, 0.003, 0x9aa3a8);
  kit.prism(x, 0.15, z, 0.07, 0.02, color, 8, 0.006);
  const side = x < 0 ? 1 : -1;
  for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) figure(kit, x + side * (0.07 + k * 0.035), z, side > 0 ? -Math.PI / 2 : Math.PI / 2, false, rnd);
}

/** A delivery van stopped at the kerb, back doors open, a trolley of boxes on the pavement. */
function deliveryVan(kit: Kit, z: number, rnd: () => number): void {
  const color = pick(rnd, [0xf2f2ee, 0xe0a021, 0x2f5f9f, 0xc8382f]);
  kit.jitter = 0;
  kit.box(-0.02, 0.015, z, 0.24, 0.11, 0.1, color);
  kit.box(0.13, 0.015, z, 0.06, 0.08, 0.1, color);
  kit.box(0.16, 0.055, z, 0.004, 0.035, 0.085, 0x2a3440);
  for (const x of [-0.09, 0.12]) for (const o of [-0.048, 0.048]) kit.log(x, 0, z + o, 0.015, 0.012, 0x1f2124, Math.PI / 2, 8);
  // The back doors swung open.
  for (const o of [-1, 1]) kit.box(-0.14 - 0.02, 0.02, z + o * 0.06, 0.045, 0.1, 0.004, color, o * 0.9);
  kit.box(-0.2, 0, z - 0.02, 0.04, 0.004, 0.03, 0x5a5e62);
  kit.box(-0.22, 0, z - 0.02, 0.004, 0.07, 0.03, 0x5a5e62);
  for (let k = 0; k < 3; k++) kit.box(-0.2, 0.004 + k * 0.022, z - 0.02, 0.034, 0.022, 0.026, 0xb08a5a);
}

/** Scaffolding up the front of a building that has just grown: tubes, boards, and a green debris net. */
function scaffolding(kit: Kit, b: Body, rnd: () => number): void {
  const top = Math.min(b.h - 0.05, 0.95), z = b.z1 + 0.035, x0 = b.x0 + 0.01, x1 = b.x1 - 0.01;
  if (top < 0.2) return;
  kit.jitter = 0;
  for (let x = x0; x <= x1 + 1e-6; x += Math.max(0.1, (x1 - x0) / Math.max(1, Math.round((x1 - x0) / 0.14)))) {
    kit.box(x, 0, z, 0.004, top, 0.004, 0x9aa3a8);
    kit.box(x, 0, z - 0.03, 0.004, top, 0.004, 0x9aa3a8);
  }
  let lift = 0;
  for (let y = 0.155; y < top; y += 0.155, lift++) {
    kit.box((x0 + x1) / 2, y, z - 0.015, x1 - x0, 0.004, 0.034, 0x8a6240);
    kit.beam(x0, y + 0.05, z + 0.002, x1, y + 0.05, z + 0.002, 0.003, 0x9aa3a8);
    // Debris netting hung on the lifts being worked on: a band of green, not a wall of it.
    if (lift % 2 === 1) {
      kit.jitter = (rnd() - 0.5) * 0.08;
      kit.box((x0 + x1) / 2, y + 0.006, z + 0.004, x1 - x0 + 0.01, 0.1, 0.001, 0x5f9a72);
      kit.jitter = 0;
    }
  }
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
