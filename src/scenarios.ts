import { demoCity } from './demo';
import { newCity } from './game';
import { T_COM, T_IND, T_OFFICE, N_TILES, T_BUS, T_SUBWAY, T_STATION } from './constants';
import { DAY_SECONDS } from './render/daylight';
import { defaultExtras } from './extras';
import type { SaveData } from './save';
import type { Stats } from './sim/messages';

/**
 * Scenarios: a prepared city, a handful of goals to reach at the same time, and a deadline in days.
 * Reaching every goal together wins; running out of days loses. Either way the city stays playable.
 */
export interface Goal { label: string; met(s: Stats): boolean; value(s: Stats): string }
export interface Scenario {
  id: string;
  title: string;
  brief: string;
  days: number;
  /** How much more often disasters strike than normal. */
  disasterRate?: number;
  setup(): SaveData;
  goals: Goal[];
}

const withExtras = (d: SaveData, patch: Partial<ReturnType<typeof defaultExtras>> = {}): SaveData => ({ ...d, extras: { ...defaultExtras(d.tax), ...patch } });

export const SCENARIOS: Scenario[] = [
  {
    id: 'rustbelt', title: 'Rust belt revival', days: 12,
    brief: 'The offices have closed and the factories are all that is left. The treasury is nearly empty. Make the city a place people want to live again.',
    setup: () => {
      const d = demoCity(true);
      for (let i = 0; i < N_TILES; i++) if ((d.kind[i] === T_OFFICE && i % 2) || (d.kind[i] === T_COM && i % 3 === 0)) { d.kind[i] = T_IND; d.level[i] = Math.min(d.level[i], 2); }
      return withExtras({ ...d, money: 12000, tax: 12 }, { taxes: [12, 12, 12, 12] });
    },
    goals: [
      { label: 'Happiness of 75 or more', met: s => s.happiness >= 75, value: s => `${s.happiness}` },
      { label: 'Average land value of 45', met: s => s.landValue >= 45, value: s => `${s.landValue}` },
      { label: '$25,000 in the treasury', met: s => s.money >= 25000, value: s => `$${Math.round(s.money).toLocaleString()}` },
    ],
  },
  {
    id: 'gridlock', title: 'Gridlock', days: 10,
    brief: 'The demo city has grown faster than its roads. Every bus stop and metro station has been torn out. Get people moving again without losing residents.',
    setup: () => {
      const d = demoCity(true);
      for (let i = 0; i < N_TILES; i++) if (d.kind[i] === T_BUS || d.kind[i] === T_SUBWAY || d.kind[i] === T_STATION) { d.kind[i] = 0; d.level[i] = 0; }
      return withExtras({ ...d, money: 30000 });
    },
    goals: [
      { label: 'Average commute of 22 s or less', met: s => s.commute > 0 && s.commute <= 22, value: s => `${Math.round(s.commute)} s` },
      { label: '3,000 residents', met: s => s.pop >= 3000, value: s => s.pop.toLocaleString() },
      { label: '150 transit riders a minute', met: s => s.transport.riders >= 150, value: s => `${s.transport.riders}` },
    ],
  },
  {
    id: 'floodplain', title: 'Flood plain', days: 20, disasterRate: 10,
    brief: 'A fertile valley on a river that floods every spring, and tornadoes in the summer. Build a town of 1,500 and keep storm damage down: flood barriers are your friend.',
    setup: () => withExtras({ ...newCity(8675309), money: 22000 }),
    goals: [
      { label: '1,500 residents', met: s => s.pop >= 1500, value: s => s.pop.toLocaleString() },
      { label: 'Fewer than 20 buildings damaged', met: s => s.disasters.damaged < 20, value: s => `${s.disasters.damaged} damaged` },
      { label: 'Survive two disasters', met: s => s.disasters.floods + s.disasters.tornadoes >= 2, value: s => `${s.disasters.floods + s.disasters.tornadoes}` },
    ],
  },
  {
    id: 'tourist', title: 'Tourist trap', days: 15,
    brief: 'The council wants the city on every postcard. Draw the visitors in with parks, leisure, a landmark and good connections.',
    setup: () => withExtras({ ...demoCity(true), money: 26000 }),
    goals: [
      { label: '250 visitors a minute', met: s => s.tourism.visitors >= 250, value: s => `${s.tourism.visitors}` },
      { label: 'Tourism earning $3/s', met: s => s.tourism.income >= 3, value: s => `$${s.tourism.income.toFixed(2)}/s` },
      { label: 'Happiness of 70 or more', met: s => s.happiness >= 70, value: s => `${s.happiness}` },
    ],
  },
];

export const scenarioById = (id: string): Scenario | undefined => SCENARIOS.find(s => s.id === id);

/** Days left before the deadline (may go negative), from the city clock. */
export function daysLeft(scenario: Scenario, startTick: number, tick: number): number {
  return scenario.days - (tick - startTick) / DAY_SECONDS;
}

/** 'won' when every goal is met at once, 'lost' once the deadline has passed, otherwise null. */
export function judge(scenario: Scenario, startTick: number, s: Stats): 'won' | 'lost' | null {
  if (scenario.goals.every(g => g.met(s))) return 'won';
  if (daysLeft(scenario, startTick, s.tick) < 0) return 'lost';
  return null;
}
