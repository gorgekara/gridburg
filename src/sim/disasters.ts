import { GRID, N_TILES, SERVICES, FLOOD_BARRIER_RADIUS, isZone } from '../constants';

/**
 * Natural disasters: storms upstream that swell the river until it bursts its banks, and tornadoes
 * crossing the valley. They are rare, start only once the settlement is a small town, and can be
 * switched off per city. A tornado knocks buildings down a level or two as it passes; a flood sends
 * a surge down the river, and the water itself does the damage wherever it climbs onto the land.
 */

export type DisasterKind = 'flood' | 'tornado';

export interface DisasterView {
  kind: DisasterKind;
  /** Seconds since it began, and how long it lasts. */
  age: number;
  duration: number;
  /** Flooded cells, for a flood. */
  flooded: number[];
  /** Where the funnel is now and the track it follows, in cell coordinates. */
  x: number;
  z: number;
  path: { x: number; z: number }[];
}

export interface DisasterContext {
  kind: Uint8Array;
  level: Uint8Array;
  water: Uint8Array;
  riverDistance: Float32Array;
  cityLevel: number;
  enabled: boolean;
  /** Scales how often disasters strike: scenarios turn it up. */
  rate: number;
  random: () => number;
  /** Knock a building down by some levels. */
  damage: (tile: number, levels: number) => void;
  notice: (message: string) => void;
  /** Set how much water is coming down the river, as a multiple of the usual flow. */
  surge: (factor: number) => void;
}

/** How long a flood lasts, and how much extra water comes down the river while it does. */
export const FLOOD_TIME = 75;
export const FLOOD_SURGE = 3;
const TORNADO_TIME = 36;
const TORNADO_RADIUS = 1.3;

export class Disasters {
  active: DisasterView | null = null;
  /** Seconds before another disaster may start. */
  cooldown = 240;
  floods = 0;
  tornadoes = 0;
  damaged = 0;
  private hit = new Set<number>();

  reset(): void {
    this.active = null; this.cooldown = 240; this.hit.clear();
  }

  /** Cells a flood is likely to reach: low ground within two cells of water, less what a barrier protects. The map's flood-risk view. */
  static floodZone(water: Uint8Array, riverDistance: Float32Array, kind: Uint8Array): number[] {
    const barriers: number[] = [];
    for (let i = 0; i < N_TILES; i++) if (SERVICES[kind[i]]?.barrier) barriers.push(i);
    const cells: number[] = [];
    for (let i = 0; i < N_TILES; i++) {
      if (water[i] || riverDistance[i] > 2.5) continue;
      const x = i % GRID, z = Math.floor(i / GRID);
      if (barriers.some(b => (b % GRID - x) ** 2 + (Math.floor(b / GRID) - z) ** 2 <= FLOOD_BARRIER_RADIUS ** 2)) continue;
      cells.push(i);
    }
    return cells;
  }

  start(kind: DisasterKind, ctx: DisasterContext): void {
    this.hit.clear();
    if (kind === 'flood') {
      this.active = { kind, age: 0, duration: FLOOD_TIME, flooded: [], x: 0, z: 0, path: [] };
      this.floods++;
      ctx.surge(FLOOD_SURGE);
      ctx.notice('Flood warning: storms upstream are swelling the river. Low ground by the water will go under; flood barriers and raised banks keep it out.');
    } else {
      // Across the valley from one side to the other, wandering a little on the way.
      const side = Math.floor(ctx.random() * 4);
      const along = 8 + ctx.random() * (GRID - 16);
      const from = [{ x: along, z: -2 }, { x: GRID + 2, z: along }, { x: along, z: GRID + 2 }, { x: -2, z: along }][side];
      const to = [{ x: GRID - along, z: GRID + 2 }, { x: -2, z: GRID - along }, { x: GRID - along, z: -2 }, { x: GRID + 2, z: GRID - along }][side];
      const path: { x: number; z: number }[] = [];
      const wobble = ctx.random() * 6.28;
      for (let k = 0; k <= 24; k++) {
        const t = k / 24, nx = -(to.z - from.z), nz = to.x - from.x, len = Math.hypot(nx, nz) || 1;
        const off = Math.sin(t * 5 + wobble) * 4;
        path.push({ x: from.x + (to.x - from.x) * t + nx / len * off, z: from.z + (to.z - from.z) * t + nz / len * off });
      }
      this.active = { kind, age: 0, duration: TORNADO_TIME, flooded: [], x: from.x, z: from.z, path };
      this.tornadoes++;
      ctx.notice('Tornado! A funnel is crossing the valley. Buildings in its path will be damaged.');
    }
  }

  /** Advance one simulation second. */
  step(ctx: DisasterContext): void {
    const a = this.active;
    if (!a) {
      if (this.cooldown > 0) { this.cooldown--; return; }
      if (!ctx.enabled || ctx.cityLevel < 2) return;
      // About one disaster every twenty minutes of play, floods twice as often as tornadoes.
      if (ctx.random() < 0.0008 * ctx.rate) this.start(ctx.random() < 0.65 ? 'flood' : 'tornado', ctx);
      return;
    }
    a.age++;
    if (a.kind === 'flood') {
      // The surge runs for two thirds of the flood, then the river is left to settle.
      ctx.surge(a.age < a.duration * 2 / 3 ? FLOOD_SURGE : 1);
    } else {
      const t = Math.min(1, a.age / a.duration) * (a.path.length - 1);
      const k = Math.min(a.path.length - 2, Math.floor(t)), u = t - k;
      a.x = a.path[k].x + (a.path[k + 1].x - a.path[k].x) * u;
      a.z = a.path[k].z + (a.path[k + 1].z - a.path[k].z) * u;
      const r = Math.ceil(TORNADO_RADIUS);
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const x = Math.floor(a.x) + dx, z = Math.floor(a.z) + dz;
        if (x < 0 || z < 0 || x >= GRID || z >= GRID) continue;
        const tile = z * GRID + x;
        if (this.hit.has(tile) || Math.hypot(x + 0.5 - a.x, z + 0.5 - a.z) > TORNADO_RADIUS) continue;
        this.hit.add(tile);
        if (isZone(ctx.kind[tile]) && ctx.level[tile] && ctx.random() < 0.7) { ctx.damage(tile, ctx.random() < 0.4 ? 2 : 1); this.damaged++; }
      }
    }
    if (a.age >= a.duration) {
      this.active = null;
      this.cooldown = 600;
      if (a.kind === 'flood') ctx.surge(1);
      ctx.notice(a.kind === 'flood' ? 'The river is back to its usual flow; the floodwater will drain away. Damaged buildings will rebuild as the city grows.' : 'The tornado has passed. Damaged buildings will rebuild as the city grows.');
    }
  }
}
