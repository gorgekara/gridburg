export const MILESTONES = [
  { name: 'Settlement', population: 0, reward: 0, unlocks: 'Roads, zones, utilities and parks' },
  { name: 'Growing village', population: 120, reward: 2200, unlocks: 'Clinic, elementary school and playgrounds' },
  { name: 'Small town', population: 400, reward: 4000, unlocks: 'Fire, police, recycling, buses, sewage treatment and city entrances' },
  { name: 'Thriving town', population: 900, reward: 6500, unlocks: 'Solar farm, sports fields, offices and high-rise growth' },
  { name: 'City', population: 1800, reward: 9000, unlocks: 'University, city parks and passenger rail' },
  { name: 'Regional capital', population: 3500, reward: 14000, unlocks: 'Regional airport and capital grant' },
  { name: 'Metropolis', population: 6500, reward: 22000, unlocks: 'Metropolitan development grant' },
] as const;

export function levelForPopulation(population: number): number {
  let level = 0;
  while (level + 1 < MILESTONES.length && population >= MILESTONES[level + 1].population) level++;
  return level;
}

export function advanceCity(current: number, population: number): { level: number; reward: number } {
  const level = Math.max(current, levelForPopulation(population));
  let reward = 0;
  for (let i = current + 1; i <= level; i++) reward += MILESTONES[i].reward;
  return { level, reward };
}
