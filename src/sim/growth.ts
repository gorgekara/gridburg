import type { CivicNeed } from '../constants';
import { CIVIC_LABELS } from '../constants';

export function civicRequirements(targetLevel: number, cityLevel: number, maintenance = false): Partial<Record<CivicNeed, number>> {
  if (targetLevel < 2 || (targetLevel === 2 && cityLevel === 0)) return {};
  const thresholds: Partial<Record<CivicNeed, number>> = targetLevel === 2
    ? { health: 0.35, education: 0.35 }
    : { health: 0.5, education: 0.5, fire: 0.35, safety: 0.35, waste: 0.5, leisure: 0.25 };
  // Once the town is a City, towers also want deathcare and a post office nearby. Only for building
  // up: towers that stood before either service existed are not pulled down for want of one.
  if (targetLevel === 3 && cityLevel >= 4 && !maintenance) Object.assign(thresholds, { deathcare: 0.3, mail: 0.3 });
  return Object.fromEntries(Object.entries(thresholds).map(([k, v]) => [k, maintenance ? Math.max(0.1, v! - 0.15) : v]));
}

export function civicShortfalls(tile: number, targetLevel: number, cityLevel: number, coverage: Record<CivicNeed, Float32Array>, maintenance = false): string[] {
  return Object.entries(civicRequirements(targetLevel, cityLevel, maintenance)).flatMap(([key, required]) => {
    const value = coverage[key as CivicNeed][tile];
    return value + 0.00001 < required! ? [`${CIVIC_LABELS[key as CivicNeed]}: ${Math.round(value * 100)}% / ${Math.round(required! * 100)}% needed`] : [];
  });
}
