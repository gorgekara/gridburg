import { CIVIC_LABELS } from './constants';
import type { ServiceSpec } from './constants';

export const FUNDING_KEYS = ['power', 'water', 'sewage', 'health', 'education', 'fire', 'safety', 'leisure', 'waste'] as const;
export type FundingKey = typeof FUNDING_KEYS[number];
export type Funding = Record<FundingKey, number>;
export const FUNDING_LABELS: Record<FundingKey, string> = { power: 'Electricity', water: 'Water', sewage: 'Sewage', ...CIVIC_LABELS };
export const defaultFunding = (): Funding => Object.fromEntries(FUNDING_KEYS.map(k => [k, 100])) as Funding;
export const validFunding = (v: number): boolean => Number.isInteger(v) && v >= 50 && v <= 150 && v % 10 === 0;
export function serviceFunding(spec: ServiceSpec, funding: Funding): number {
  if (spec.transport) return 1;
  const key = spec.civic ?? (spec.power ? 'power' : spec.water ? 'water' : 'sewage');
  return funding[key] / 100;
}
// Overtime has diminishing returns: 150% funding provides about 122% output.
export const fundingOutput = (funding: number): number => Math.sqrt(funding);
export const LOAN_AMOUNT = 6000;
export const LOAN_TOTAL = 6600;
export const LOAN_PAYMENT = 6; // dollars per simulation second, including a fixed 10% fee
export const NEGLECT_LIMIT = 180; // consecutive simulation seconds before a residential downgrade
