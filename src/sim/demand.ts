// When people travel, and why: the day's rhythm of trips (a morning and an evening peak, a quiet night)
// and what each trip is for at each hour (to work, home again, out to the shops). Pure functions; the
// worker turns them into trips.

/** Relative trip rate over the day, before normalising: hour 0–24. */
function rawProfile(h: number): number {
  const bump = (centre: number, width: number): number => Math.exp(-(((h - centre) / width) ** 2));
  return 0.28 + 1.55 * bump(8, 1.3) + 0.6 * bump(13, 2.6) + 1.45 * bump(17.6, 1.6) + 0.35 * bump(20.5, 1.5);
}

const MEAN = (() => { let t = 0; for (let k = 0; k < 240; k++) t += rawProfile(k / 10); return t / 240; })();

/** How busy the roads are at hour `h` (0–24) against the day's average: peaks near 2, the small hours near 0.3. */
export const dayProfile = (h: number): number => rawProfile(((h % 24) + 24) % 24) / MEAN;

export type Purpose = 'work' | 'home' | 'shop';

/**
 * What a trip at hour `h` is for, from a uniform random number `r` in [0, 1): mornings take people to
 * work, late afternoons bring them home, the middle of the day and the evening are for errands.
 */
export function purposeAt(h: number, r: number): Purpose {
  const hour = ((h % 24) + 24) % 24;
  const [work, home] = hour >= 5 && hour < 11 ? [0.8, 0.05] : hour >= 15 && hour < 20 ? [0.12, 0.7] : hour >= 11 && hour < 15 ? [0.3, 0.2] : [0.1, 0.35];
  return r < work ? 'work' : r < work + home ? 'home' : 'shop';
}

/**
 * Of a few candidate destinations, the one a person picks: nearby ones are likelier, but not always
 * the nearest. `dist` gives each candidate's distance; `r` is a uniform random number.
 */
export function pickByDistance(dist: number[], r: number, decay = 18): number {
  const w = dist.map(d => Math.exp(-d / decay));
  const total = w.reduce((a, b) => a + b, 0);
  let x = r * total;
  for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return i; }
  return w.length - 1;
}
