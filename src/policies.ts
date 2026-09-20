/**
 * City-wide policies: standing decisions the mayor pays for every second, in exchange for a change in
 * how the city behaves. Each one is a single switch; the simulation reads the combined effects, and the
 * UI reads the same table to explain what a switch does before it is flipped.
 */
export const POLICY_IDS = ['recycling', 'alarms', 'watch', 'freeTransit', 'congestionCharge', 'studyGrants'] as const;
export type PolicyId = typeof POLICY_IDS[number];
export type Policies = Record<PolicyId, boolean>;

export interface PolicySpec {
  label: string;
  note: string;
  effect: string;
  icon: string;
  unlock: number; // city level it becomes available at
  base: number; // dollars per second
  perResident: number; // dollars per second for every resident
}

export const POLICIES: Record<PolicyId, PolicySpec> = {
  alarms: {
    label: 'Smoke alarms', icon: 'fire', unlock: 2, base: 1, perResident: 0.0008,
    note: 'Every home and workplace is fitted with a detector.',
    effect: 'Fires break out 55% less often',
  },
  watch: {
    label: 'Neighborhood watch', icon: 'police', unlock: 2, base: 1, perResident: 0.0008,
    note: 'Residents keep an eye on their own streets.',
    effect: 'Crime builds 40% more slowly',
  },
  recycling: {
    label: 'Recycling program', icon: 'recycling', unlock: 2, base: 1.5, perResident: 0.0012,
    note: 'Factories sort and reuse what they would otherwise dump.',
    effect: 'Industry pollutes 40% less',
  },
  studyGrants: {
    label: 'Study grants', icon: 'school', unlock: 3, base: 2, perResident: 0.0015,
    note: 'The city pays part of the cost of every place.',
    effect: 'Schools and universities reach 30% more residents',
  },
  freeTransit: {
    label: 'Free public transport', icon: 'bus', unlock: 3, base: 2, perResident: 0.002,
    note: 'Buses, trains and the metro stop charging fares.',
    effect: 'Far more commuters ride, and fares stop coming in',
  },
  congestionCharge: {
    label: 'Congestion charge', icon: 'car', unlock: 4, base: 1.5, perResident: 0.0004,
    note: 'Driving into the city centre costs money.',
    effect: '25% fewer car commutes and a toll on every trip, but residents mind',
  },
};

export const noPolicies = (): Policies => Object.fromEntries(POLICY_IDS.map(id => [id, false])) as Policies;

export const isPolicyId = (id: string): id is PolicyId => (POLICY_IDS as readonly string[]).includes(id);

/** Dollars per second for everything currently switched on. */
export function policyExpense(policies: Policies, population: number): number {
  return POLICY_IDS.reduce((sum, id) => policies[id] ? sum + POLICIES[id].base + POLICIES[id].perResident * population : sum, 0);
}

export interface PolicyEffects {
  industryPollution: number; // multiplier on ground pollution from factories
  fireRate: number; // multiplier on how often fires start
  crimeRate: number; // multiplier on how often crime appears
  educationCapacity: number; // multiplier on school and university output
  transitShare: number; // multiplier on the chance a commuter takes transit
  fare: number; // multiplier on ticket income
  carTrips: number; // multiplier on commutes made by car
  toll: number; // dollars collected per car trip that still happens
  happiness: number; // points added to city happiness
}

export function policyEffects(p: Policies): PolicyEffects {
  return {
    industryPollution: p.recycling ? 0.6 : 1,
    fireRate: p.alarms ? 0.45 : 1,
    crimeRate: p.watch ? 0.6 : 1,
    educationCapacity: p.studyGrants ? 1.3 : 1,
    transitShare: p.freeTransit ? 1.45 : 1,
    fare: p.freeTransit ? 0 : 1,
    carTrips: p.congestionCharge ? 0.75 : 1,
    toll: p.congestionCharge ? 0.35 : 0,
    happiness: p.congestionCharge ? -4 : 0,
  };
}

/** Policies travel in saves and share links as one bit each. */
export function policyMask(p: Policies): number {
  return POLICY_IDS.reduce((mask, id, bit) => p[id] ? mask | (1 << bit) : mask, 0);
}

export function policiesFromMask(mask: number): Policies {
  return Object.fromEntries(POLICY_IDS.map((id, bit) => [id, !!(mask & (1 << bit))])) as Policies;
}
