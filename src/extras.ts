import { GRID, N_TILES } from './constants';
import type { Terrain } from './terrain';

/**
 * City settings that arrived after the fixed save header: tax per zone, districts and their local
 * policies, dug and filled ground, the scenario being played and whether disasters strike. They are
 * shared by the main thread, the worker and the save file, which stores them as one JSON block.
 */

/** Residential, commercial, industrial and office tax rates, in percent. Farms pay the industrial rate, leisure the commercial one. */
export type Taxes = [number, number, number, number];
export const TAX_LABELS = ['Residential', 'Commercial', 'Industrial', 'Offices'] as const;

export const DISTRICT_COUNT = 8;
export const DISTRICT_COLORS = [0xe0564a, 0x3f8fd9, 0xe0a021, 0x3fae6a, 0xa66fd6, 0x39b4b0, 0xd9679f, 0x8c8f3a];
export const DEFAULT_DISTRICT_NAMES = ['Old Town', 'Riverside', 'Northgate', 'Greenhill', 'Harbour', 'Uptown', 'Millbrook', 'Southbank'];

export const DISTRICT_POLICY_IDS = ['highriseBan', 'quiet', 'green', 'tourist', 'taxBreak', 'watch'] as const;
export type DistrictPolicyId = typeof DISTRICT_POLICY_IDS[number];

export interface DistrictPolicySpec { label: string; effect: string; /** Dollars a second per building in the district. */ perBuilding: number }
export const DISTRICT_POLICIES: Record<DistrictPolicyId, DistrictPolicySpec> = {
  highriseBan: { label: 'High-rise ban', effect: 'Nothing grows past mid-rise: keeps the skyline low and land values steady', perBuilding: 0 },
  quiet: { label: 'Quiet streets', effect: 'Noise down 60% and land values up, but shops and industry grow slowly', perBuilding: 0.004 },
  green: { label: 'Green district', effect: 'Pollution from the district halved and land values up; industry grows slowly', perBuilding: 0.006 },
  tourist: { label: 'Tourist quarter', effect: 'Leisure businesses draw 40% more visitors and pay more tax', perBuilding: 0.004 },
  taxBreak: { label: 'Tax break', effect: 'Four points off every tax here, so the district grows faster', perBuilding: 0 },
  watch: { label: 'Neighborhood watch', effect: 'Crime builds 40% more slowly in the district', perBuilding: 0.003 },
};

export const districtHas = (mask: number, id: DistrictPolicyId): boolean => (mask & (1 << DISTRICT_POLICY_IDS.indexOf(id))) !== 0;

/** Ground the player has changed: dug out to water, or filled in to land. Raised ground counts as land wherever it stands. */
export const DUG = 1;
export const FILLED = 2;
/** Raised ground: values HILL_BASE + 1 .. HILL_BASE + HILL_MAX are hills of that height. */
export const HILL_BASE = 2;
export const HILL_MAX = 4;
export const COST_DIG = 120;
export const COST_FILL = 260;
export const COST_RAISE = 70;
export const COST_LOWER = 35;
export type TerraformAction = 'dig' | 'fill' | 'raise' | 'lower';
/** How many storeys of earth stand on a tile, 0 on level ground. */
export const hillLevel = (v: number): number => Math.max(0, v - HILL_BASE);
/** Height in world units of a hill of that level, before smoothing. */
export const HILL_STEP = 0.9;

export interface ScenarioState { id: string; startTick: number; done?: 'won' | 'lost' }

export interface CityExtras {
  taxes: Taxes;
  /** 0 for no district, 1..DISTRICT_COUNT otherwise. */
  district: Uint8Array;
  districtNames: string[];
  districtPolicies: number[];
  terraform: Uint8Array;
  scenario?: ScenarioState;
  disasters: boolean;
}

export function defaultExtras(tax = 10): CityExtras {
  return {
    taxes: [tax, tax, tax, tax], district: new Uint8Array(N_TILES), districtNames: [...DEFAULT_DISTRICT_NAMES],
    districtPolicies: new Array(DISTRICT_COUNT).fill(0), terraform: new Uint8Array(N_TILES), disasters: true,
  };
}

export function cloneExtras(e: CityExtras): CityExtras {
  return {
    taxes: [...e.taxes] as Taxes, district: e.district.slice(), districtNames: [...e.districtNames],
    districtPolicies: [...e.districtPolicies], terraform: e.terraform.slice(), scenario: e.scenario ? { ...e.scenario } : undefined, disasters: e.disasters,
  };
}

/** Run-length pairs [value, run, value, run, ...] for a per-tile byte map. */
function rle(map: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < map.length;) {
    let run = 1;
    while (i + run < map.length && map[i + run] === map[i]) run++;
    out.push(map[i], run);
    i += run;
  }
  return out;
}

function unrle(pairs: unknown, max: number): Uint8Array | null {
  if (!Array.isArray(pairs) || pairs.length % 2) return null;
  const out = new Uint8Array(N_TILES);
  let i = 0;
  for (let k = 0; k < pairs.length; k += 2) {
    const v = pairs[k], run = pairs[k + 1];
    if (!Number.isInteger(v) || v < 0 || v > max || !Number.isInteger(run) || run < 1 || i + run > N_TILES) return null;
    out.fill(v, i, i + run);
    i += run;
  }
  return i === N_TILES ? out : null;
}

export function extrasToJson(e: CityExtras): unknown {
  return {
    taxes: e.taxes, district: rle(e.district), names: e.districtNames, policies: e.districtPolicies,
    terraform: rle(e.terraform), scenario: e.scenario, disasters: e.disasters,
  };
}

export function extrasFromJson(data: unknown, tax: number): CityExtras | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const e = defaultExtras(tax);
  const taxes = d.taxes;
  if (!Array.isArray(taxes) || taxes.length !== 4 || !taxes.every(t => Number.isInteger(t) && t >= 0 && t <= 30)) return null;
  e.taxes = taxes as Taxes;
  const district = unrle(d.district, DISTRICT_COUNT), terraform = unrle(d.terraform, HILL_BASE + HILL_MAX);
  if (!district || !terraform) return null;
  e.district = district; e.terraform = terraform;
  if (!Array.isArray(d.names) || d.names.length !== DISTRICT_COUNT || !d.names.every(n => typeof n === 'string' && n.length <= 32)) return null;
  e.districtNames = d.names as string[];
  if (!Array.isArray(d.policies) || d.policies.length !== DISTRICT_COUNT || !d.policies.every(p => Number.isInteger(p) && p >= 0 && p < 1 << DISTRICT_POLICY_IDS.length)) return null;
  e.districtPolicies = d.policies as number[];
  const s = d.scenario as ScenarioState | undefined;
  if (s !== undefined && (typeof s !== 'object' || typeof s.id !== 'string' || !Number.isInteger(s.startTick))) return null;
  e.scenario = s ? { id: s.id, startTick: s.startTick, done: s.done === 'won' || s.done === 'lost' ? s.done : undefined } : undefined;
  e.disasters = d.disasters !== false;
  return e;
}

/**
 * The terrain as the player has shaped it: dug tiles become water, filled tiles dry land. The shore
 * strip is only kept where the river itself still runs, and a filled tile is never shore.
 */
export function shapeTerrain(base: Terrain, edits: Uint8Array): Terrain {
  if (!edits.some(v => v)) return base;
  const water = base.water.slice(), shore = base.shore.slice(), flow = base.flow.slice();
  for (let i = 0; i < N_TILES; i++) {
    if (edits[i] === DUG) { water[i] = 1; shore[i] = 0; }
    else if (edits[i] === FILLED || hillLevel(edits[i]) > 0) { water[i] = 0; shore[i] = 0; flow[i] = -1; }
  }
  // A dug pond joins the river's flow where it touches it; otherwise it is still water.
  for (let i = 0; i < N_TILES; i++) {
    if (edits[i] !== DUG) continue;
    const x = i % GRID, z = Math.floor(i / GRID);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < GRID && nz < GRID && base.flow[nz * GRID + nx] >= 0) flow[i] = base.flow[nz * GRID + nx];
    }
  }
  return { ...base, water, shore, flow };
}

/** Whether a tile is water once the player's edits are applied: dug out, or river that is neither filled nor built up. */
export const isWet = (base: Terrain, edits: Uint8Array, tile: number): boolean =>
  edits[tile] === DUG || (!!base.water[tile] && edits[tile] !== FILLED && hillLevel(edits[tile]) === 0);

/**
 * Whether this tile may be dug out, filled in, raised or lowered. The river can be narrowed, moved or
 * dammed outright: the water then finds its own way, gathering behind the dam until it spills.
 */
export function terraformAllowed(base: Terrain, edits: Uint8Array, tile: number, action: TerraformAction): boolean {
  const x = tile % GRID, z = Math.floor(tile / GRID);
  if (x < 1 || z < 1 || x >= GRID - 1 || z >= GRID - 1) return false;
  const wet = isWet(base, edits, tile);
  // Earth piles up a storey at a time, on water too, which turns the river bed into a bank.
  if (action === 'raise') return hillLevel(edits[tile]) < HILL_MAX;
  if (action === 'lower') return hillLevel(edits[tile]) > 0;
  if (hillLevel(edits[tile]) > 0) return false;
  return action === 'dig' ? !wet : wet;
}
