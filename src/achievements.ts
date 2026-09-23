import type { Stats } from './sim/messages';

/** Milestones of play, remembered in this browser across every city. */
export interface AchievementContext {
  stats: Stats;
  /** How many cells of each tile kind the city has. */
  count(kind: number): number;
  districts: number;
  shaped: number;
}

export interface Achievement { id: string; title: string; text: string; check(c: AchievementContext): boolean }

import { T_COAL, T_GAS, T_NUCLEAR, T_LANDMARK } from './constants';

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-home', title: 'Moving day', text: 'The first family moves in', check: c => c.stats.pop >= 4 },
  { id: 'village', title: 'On the map', text: 'Grow into a village', check: c => c.stats.cityLevel >= 1 },
  { id: 'town', title: 'Small town', text: 'Reach 400 residents', check: c => c.stats.cityLevel >= 2 },
  { id: 'city', title: 'City status', text: 'Reach 1,800 residents', check: c => c.stats.cityLevel >= 4 },
  { id: 'metropolis', title: 'Metropolis', text: 'Reach 6,500 residents', check: c => c.stats.cityLevel >= 6 },
  { id: 'megalopolis', title: 'Megalopolis', text: 'Reach 10,000 residents', check: c => c.stats.cityLevel >= 7 },
  { id: 'world', title: 'World city', text: 'Reach 15,000 residents', check: c => c.stats.cityLevel >= 8 },
  { id: 'happy', title: 'Happy place', text: 'Happiness of 90 with 1,000 residents', check: c => c.stats.happiness >= 90 && c.stats.pop >= 1000 },
  { id: 'rich', title: 'Deep pockets', text: '$100,000 in the treasury', check: c => c.stats.money >= 100000 },
  { id: 'clean-power', title: 'Clean energy', text: '3,000 power with no coal or gas plants', check: c => c.stats.power[1] >= 3000 && !c.count(T_COAL) && !c.count(T_GAS) },
  { id: 'nuclear', title: 'Splitting atoms', text: 'Build a nuclear power plant', check: c => c.count(T_NUCLEAR) > 0 },
  { id: 'landmark', title: 'On the postcards', text: 'Build an observation tower', check: c => c.count(T_LANDMARK) > 0 },
  { id: 'transit', title: 'All aboard', text: '200 transit riders a minute', check: c => c.stats.transport.riders >= 200 },
  { id: 'tourists', title: 'Wish you were here', text: '300 visitors a minute', check: c => c.stats.tourism.visitors >= 300 },
  { id: 'exporter', title: 'Made here', text: 'Export 500 units of goods a minute', check: c => c.stats.goods.exported >= 500 },
  { id: 'value', title: 'Good address', text: 'Average land value of 60 with 2,000 residents', check: c => c.stats.landValue >= 60 && c.stats.pop >= 2000 },
  { id: 'clean', title: 'Spotless', text: 'Rubbish under 5% with 1,500 residents', check: c => c.stats.garbage < 5 && c.stats.pop >= 1500 },
  { id: 'commute', title: 'Short hop', text: 'Commutes under 20 s with 3,000 residents', check: c => c.stats.commute > 0 && c.stats.commute < 20 && c.stats.pop >= 3000 },
  { id: 'survivor', title: 'Weathered the storm', text: 'Come through a flood or a tornado', check: c => c.stats.disasters.floods + c.stats.disasters.tornadoes > 0 && !c.stats.disasters.active },
  { id: 'districts', title: 'Planner', text: 'Paint three districts', check: c => c.districts >= 3 },
  { id: 'terraform', title: 'Moving earth', text: 'Dig or fill twenty cells', check: c => c.shaped >= 20 },
];

const KEY = 'gridburg.achievements.v1';

export class AchievementLog {
  earned: Record<string, number> = {};

  constructor() {
    try { this.earned = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { this.earned = {}; }
  }

  /** Check every achievement; returns the ones earned just now. */
  check(c: AchievementContext): Achievement[] {
    const fresh = ACHIEVEMENTS.filter(a => !this.earned[a.id] && a.check(c));
    if (!fresh.length) return fresh;
    for (const a of fresh) this.earned[a.id] = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(this.earned)); } catch { /* storage may be blocked */ }
    return fresh;
  }
}
