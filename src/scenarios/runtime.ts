import { emptyStats } from '../sim/messages';
import type { Stats } from '../sim/messages';
import type { Scenario, Wave } from './defs';

/**
 * How much a building with no road to the highway weighs against the gridlock meter, in stalled
 * cars. A street nobody can leave is a jam that has not happened yet, so it counts — but gently
 * enough that reconnecting a district is a job for the first minute rather than the first ten
 * seconds.
 */
const CUT_OFF_WEIGHT = 0.25;

export type Outcome = 'running' | 'won' | 'lost';

/** What changed on the second just simulated, for the caller to act on. */
export interface RunEvent {
  /** A wave has just landed: turn the demand up and pay the grant. */
  wave?: Wave;
  /** The shift has just ended, one way or the other. */
  ended?: 'won' | 'lost';
}

/**
 * One attempt at one shift.
 *
 * The worker reports once per simulated second, so counting reports measures the shift directly and
 * at any game speed: the clock, the waves and the gridlock meter all move a second at a time. The
 * warm-up runs before the whistle, and is subtracted so that neither its traffic nor its arrivals
 * count against the player.
 */
export class Run {
  readonly def: Scenario;
  /** Seconds since the whistle. */
  elapsed = 0;
  /** Index into `def.waves` of the wave now running. */
  waveIndex = 0;
  /** 0..1. Full means gridlock, and the shift is over. */
  jam = 0;
  /** The worst the meter has been, so a near miss can be reported. */
  peakJam = 0;
  /** Trips delivered since the whistle. */
  delivered = 0;
  outcome: Outcome = 'running';
  stars = 0;
  private base = -1;
  private last: Stats;

  constructor(def: Scenario) {
    this.def = def;
    this.last = emptyStats(def.opening);
  }

  /** Feed one per-second report. */
  update(s: Stats): RunEvent {
    this.last = s;
    const elapsed = s.tick - this.def.warm;
    if (elapsed < 0) return {}; // still warming up: the shift has not started
    if (this.base < 0) this.base = s.arrivals;
    this.delivered = Math.max(0, s.arrivals - this.base);
    if (this.outcome !== 'running') return {};
    const was = this.elapsed;
    this.elapsed = elapsed;

    // The gridlock meter: stalled cars above what the city shrugs off fill it, a clear road drains
    // it. The curve is steeper than linear, so a queue that never quite clears is survivable while
    // a real seizure is fatal in about `patience` seconds.
    const d = this.def;
    const excess = s.stuck + s.orphans * CUT_OFF_WEIGHT - d.tolerated;
    const rate = excess > 0
      ? Math.pow(excess / Math.max(1, d.gridlock - d.tolerated), 1.5) / d.patience
      : -1 / (d.patience * 1.5);
    this.jam = Math.max(0, Math.min(1, this.jam + rate * Math.max(1, elapsed - was)));
    this.peakJam = Math.max(this.peakJam, this.jam);

    if (this.jam >= 1) {
      this.outcome = 'lost';
      return { ended: 'lost' };
    }
    if (elapsed >= d.duration) {
      this.outcome = 'won';
      this.stars = starsFor(d, this.delivered);
      return { ended: 'won' };
    }
    // Waves land on the second they are due, however many seconds the report covered.
    const next = d.waves[this.waveIndex + 1];
    if (next && elapsed >= next.at) {
      this.waveIndex++;
      return { wave: next };
    }
    return {};
  }

  get wave(): Wave {
    return this.def.waves[this.waveIndex];
  }

  /** The wave after this one, or null on the last. */
  get nextWave(): Wave | null {
    return this.def.waves[this.waveIndex + 1] ?? null;
  }

  /** The latest report, for the readouts that are not the run's own. */
  get stats(): Stats {
    return this.last;
  }

  /** Of the whole shift's money, what has been spent. */
  get spent(): number {
    const paid = this.def.opening + this.def.waves.slice(0, this.waveIndex + 1).reduce((a, w) => a + w.grant, 0);
    return Math.max(0, paid - this.last.money);
  }

  /** 0..1 through the shift. */
  get progress(): number {
    return Math.min(1, this.elapsed / this.def.duration);
  }

  /** Seconds left on the clock. */
  get remaining(): number {
    return Math.max(0, this.def.duration - this.elapsed);
  }
}

/** Three stars for the top target, then two, then one for surviving at all. */
export function starsFor(def: Scenario, delivered: number): number {
  const [one, two, three] = def.targets;
  if (delivered >= three) return 3;
  if (delivered >= two) return 2;
  if (delivered >= one) return 1;
  return 1; // surviving the shift is worth a star whatever the count
}

// ---- saved progress ---------------------------------------------------------------------------
const KEY = 'gridburg.puzzles.v2';

export interface Best { stars: number; delivered: number }
export type Progress = Record<string, Best>;

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return p && typeof p === 'object' ? (p as Progress) : {};
  } catch {
    return {};
  }
}

/** Keep the best of each, so a scrappy win never overwrites a good one. */
export function record(id: string, stars: number, delivered: number): Progress {
  const p = loadProgress();
  const was = p[id];
  p[id] = { stars: Math.max(was?.stars ?? 0, stars), delivered: Math.max(was?.delivered ?? 0, delivered) };
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
  return p;
}

/** "2:35" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
