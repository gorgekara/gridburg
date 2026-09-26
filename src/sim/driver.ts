// The driver model: how a vehicle accelerates, follows and brakes (the Intelligent Driver Model), and
// how fast curves and turns let it go. Pure functions, in cells and game seconds. A game second is
// about three real seconds, so real driving parameters are scaled to match (see the driver-model spec).

import type { RSeg } from '../roads/network';

export interface DriverParams {
  /** Comfortable acceleration, cells/s². */
  a: number;
  /** Comfortable braking, cells/s². */
  b: number;
  /** Time headway it keeps to the vehicle ahead, s. */
  T: number;
}

/** Bumper-to-bumper distance kept standing still, beyond the jam spacing the hold point already allows. */
export const S0 = 0.08;
/** Sideways acceleration drivers accept on curves and in turns, cells/s². */
export const A_LAT = 1.7;
/** The hardest a vehicle ever brakes, cells/s². */
export const MAX_BRAKE = 8;
/** How close to its hold point, and how slow, a car must be to simply stop there. */
export const CREEP_DIST = 0.02, CREEP_SPEED = 0.3;

const CAR: DriverParams = { a: 1.6, b: 2.4, T: 0.45 };
const HEAVY: DriverParams = { a: 0.9, b: 1.8, T: 0.45 };
const BLUE: DriverParams = { a: 1.6, b: 2.4, T: 0.3 };
const HEAVY_BLUE: DriverParams = { a: 0.9, b: 1.8, T: 0.3 };
const RACER: DriverParams = { a: 3, b: 3, T: 0.45 };

/** Driving parameters by vehicle type (1 car, 2 van, 3 lorry, 4 bus, 5 police, 6 fire, 7 racer, 8 trolleybus, 9 taxi, 10 bin lorry). */
export function driverFor(vehicle: number): DriverParams {
  switch (vehicle) {
    case 3: case 4: case 8: case 10: return HEAVY;
    case 5: return BLUE;
    case 6: return HEAVY_BLUE;
    case 7: return RACER;
    default: return CAR;
  }
}

/**
 * IDM acceleration. `room` is how far the car may still go before its hold point (the leader less the
 * jam spacing, or a stop line), `dv` its speed minus that obstacle's.
 */
export function idmAccel(v: number, v0: number, room: number, dv: number, d: DriverParams): number {
  const free = v0 > 1e-3 ? 1 - Math.pow(v / v0, 4) : -1;
  if (!Number.isFinite(room)) return d.a * free;
  const s = Math.max(1e-3, room + S0);
  const want = S0 + Math.max(0, v * d.T + (v * dv) / (2 * Math.sqrt(d.a * d.b)));
  return Math.max(-MAX_BRAKE, d.a * (free - (want / s) ** 2));
}

/**
 * Advance a car by one step: ballistic motion with acceleration `a`, never backwards, never faster
 * than `vMax` and never past its hold point `maxP`. Returns the new position and speed.
 */
export function stepMotion(p: number, v: number, a: number, dt: number, maxP: number, vMax: number): { p: number; v: number } {
  let nv = Math.min(vMax, v + a * dt);
  let np: number;
  if (nv <= 0) {
    // It stops within the step: only as far as it takes to stop.
    np = a < 0 ? p + (v * v) / (-2 * a) : p;
    nv = 0;
  } else np = p + (v + nv) * 0.5 * dt;
  // Brought up at the hold point: standing there, not still moving at the step's average speed.
  if (np >= maxP) { np = Math.max(p, maxP); nv = 0; }
  else if (maxP - np < CREEP_DIST && nv < CREEP_SPEED) { np = maxP; nv = 0; }
  return { p: Math.max(p, np), v: Math.max(0, nv) };
}

/** The speed a curve of radius `r` allows. */
export const curveSpeed = (r: number): number => Math.sqrt(A_LAT * Math.max(0, r));

/** The radius of the path a car drives turning through `theta` radians over a corner of length `corner` each side. */
export function turnRadius(theta: number, corner: number): number {
  const t = Math.abs(theta);
  return t < 1e-3 ? Infinity : corner / Math.tan(Math.min(t, Math.PI * 0.95) / 2);
}

/** The fastest a car `d` away can go and still slow to `vNext` by then, braking comfortably at `b`. */
export const approachSpeed = (vNext: number, d: number, b: number): number => Math.sqrt(vNext * vNext + 2 * b * Math.max(0, d));

/** A segment's tightest radius, from its quadratic Bézier's curvature. */
export function segMinRadius(seg: RSeg): number {
  const n = seg.n, ax = seg.pts[0], az = seg.pts[1], bx = seg.pts[n * 2], bz = seg.pts[n * 2 + 1];
  const cx = seg.cx, cz = seg.cz;
  // B'(t) = 2(1−t)(C−A) + 2t(B−C); B'' = 2(A − 2C + B), constant.
  const ddx = 2 * (ax - 2 * cx + bx), ddz = 2 * (az - 2 * cz + bz);
  let r = Infinity;
  for (let i = 0; i <= 32; i++) {
    const t = i / 32;
    const dx = 2 * (1 - t) * (cx - ax) + 2 * t * (bx - cx), dz = 2 * (1 - t) * (cz - az) + 2 * t * (bz - cz);
    const cross = Math.abs(dx * ddz - dz * ddx), sp = Math.hypot(dx, dz);
    if (cross > 1e-9 && sp > 1e-9) r = Math.min(r, sp ** 3 / cross);
  }
  return r;
}
