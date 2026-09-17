/**
 * Find map seeds with the terrain a scenario needs. Every map's river is generated from its seed,
 * so a level is authored against a seed that puts the water where the level wants it.
 *
 *   npm run seeds
 */
import { generateTerrain } from '../src/terrain';
import { isDry, riverAlong, riverWidth } from '../src/scenarios/build';

/** Seeds whose land is clear over a rectangle of the highway's frame. */
function dry(along: [number, number], side: number, want = 8): number[] {
  const hits: number[] = [];
  for (let seed = 1; seed < 6000 && hits.length < want; seed++) {
    if (isDry(generateTerrain(seed), along, [-side, side])) hits.push(seed);
  }
  return hits;
}

/** Seeds whose river crosses the corridor square on, near enough to the highway to build around. */
function crossing(at: [number, number], want = 8): string[] {
  const sides = [-15, -8, 0, 8, 15];
  const hits: string[] = [];
  for (let seed = 1; seed < 6000 && hits.length < want; seed++) {
    const t = generateTerrain(seed);
    const alongs = sides.map((s) => riverAlong(t, s));
    if (alongs.some((v) => v < at[0] || v > at[1])) continue;
    if (Math.max(...alongs) - Math.min(...alongs) > 7) continue; // across the corridor, not down it
    if (sides.some((s) => riverWidth(t, s) > 5.5)) continue; // bridgeable in one span
    const mid = alongs[2];
    if (!isDry(t, [4, mid - 5], [-16, 16]) || !isDry(t, [mid + 6, mid + 18], [-16, 16])) continue;
    hits.push(`${String(seed).padStart(5)}  crosses at ${alongs.map((v) => v.toFixed(0).padStart(3)).join(' ')}`);
  }
  return hits;
}

console.log('dry to 42 tiles in, 18 either side :', dry([4, 42], 18).join(', '));
console.log('dry to 46 tiles in, 21 either side :', dry([4, 46], 21).join(', '));
console.log('dry to 58 tiles in, 14 either side :', dry([4, 58], 14).join(', '));
console.log('river across the corridor 26-42 in :');
console.log(crossing([26, 42]).map((h) => '  ' + h).join('\n'));
