import { emptyStats } from '../sim/messages';
import type { Stats } from '../sim/messages';
import type { Goal, Scenario } from './defs';

export interface GoalReading {
  goal: Goal;
  /** "Average commute under 30s" */
  label: string;
  /** "41s" — where the city is now. */
  value: string;
  ok: boolean;
}

/** Has the city met this goal at this instant? */
function meets(goal: Goal, s: Stats): boolean {
  switch (goal.kind) {
    case 'connected': return s.orphans === 0;
    case 'commute': return s.commute > 0 && s.commute <= goal.target;
    case 'nojam': return s.gaveUp === 0;
    case 'flow': return s.flow >= goal.target;
  }
}

function label(goal: Goal): string {
  switch (goal.kind) {
    case 'connected': return 'Every building connected';
    case 'commute': return `Average commute under ${goal.target}s`;
    case 'nojam': return 'Nobody gives up';
    case 'flow': return `At least ${goal.target} arrivals a minute`;
  }
}

function value(goal: Goal, s: Stats): string {
  switch (goal.kind) {
    case 'connected': return s.orphans === 0 ? 'all connected' : `${s.orphans} cut off`;
    case 'commute': return s.commute > 0 ? `${s.commute.toFixed(0)}s` : 'no traffic yet';
    case 'nojam': return s.gaveUp > 0 ? `${s.gaveUp} gave up` : 'flowing';
    case 'flow': return `${Math.round(s.flow)}/min`;
  }
}

export function read(goals: Goal[], s: Stats): GoalReading[] {
  return goals.map((goal) => ({ goal, label: label(goal), value: value(goal, s), ok: meets(goal, s) }));
}

/** Three stars at or under par, two within half again, one for solving it at all. */
export function starsFor(def: Scenario, spent: number): number {
  if (spent <= def.par) return 3;
  if (spent <= def.par * 1.5) return 2;
  return 1;
}

/**
 * One attempt at one level. The worker posts a state message every simulated second, so counting
 * the messages where every goal holds measures the hold window directly, at any game speed.
 */
export class Attempt {
  readonly def: Scenario;
  held = 0;
  solved = false;
  stars = 0;
  spent = 0;
  /** Best average commute seen, so a near miss can be reported. */
  best = Infinity;
  private last: Stats;

  constructor(def: Scenario) {
    this.def = def;
    this.last = emptyStats(def.budget);
  }

  /** Feed one state message. Returns true on the tick the level is solved. */
  update(s: Stats): boolean {
    this.last = s;
    this.spent = Math.max(0, this.def.budget - s.money);
    if (s.commute > 0) this.best = Math.min(this.best, s.commute);
    if (this.solved) return false;
    this.held = read(this.def.goals, s).every((r) => r.ok) ? this.held + 1 : 0;
    if (this.held < this.def.hold) return false;
    this.solved = true;
    this.stars = starsFor(this.def, this.spent);
    return true;
  }

  readings(): GoalReading[] {
    return read(this.def.goals, this.last);
  }

  /** The latest report, for readouts that are not goals in their own right. */
  get stats(): Stats {
    return this.last;
  }

  /** 0..1 through the hold window. */
  progress(): number {
    return Math.min(1, this.held / this.def.hold);
  }
}

// ---- saved progress ---------------------------------------------------------------------------
const KEY = 'gridburg.puzzles.v1';

export type Progress = Record<string, number>; // scenario id -> best stars

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return p && typeof p === 'object' ? (p as Progress) : {};
  } catch {
    return {};
  }
}

export function recordStars(id: string, stars: number): Progress {
  const p = loadProgress();
  if ((p[id] ?? 0) >= stars) return p;
  p[id] = stars;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
  return p;
}
