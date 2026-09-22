import { GRID, N_TILES } from './constants';
import type { Terrain } from './terrain';
import { RIVER_VERSION } from './terrain';

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

/** Ground the player has changed: dug out to water, or filled in to land. */
export const DUG = 1;
export const FILLED = 2;
export const COST_DIG = 120;
export const COST_FILL = 260;

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
  /** Which river generator shaped the map: absent in old cities, which keep their original valley. */
  river: number;
}

export function defaultExtras(tax = 10): CityExtras {
  return {
    taxes: [tax, tax, tax, tax], district: new Uint8Array(N_TILES), districtNames: [...DEFAULT_DISTRICT_NAMES],
    districtPolicies: new Array(DISTRICT_COUNT).fill(0), terraform: new Uint8Array(N_TILES), disasters: true, river: RIVER_VERSION,
  };
}

export function cloneExtras(e: CityExtras): CityExtras {
  return {
    taxes: [...e.taxes] as Taxes, district: e.district.slice(), districtNames: [...e.districtNames],
    districtPolicies: [...e.districtPolicies], terraform: e.terraform.slice(), scenario: e.scenario ? { ...e.scenario } : undefined, disasters: e.disasters, river: e.river,
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
    terraform: rle(e.terraform), scenario: e.scenario, disasters: e.disasters, river: e.river,
  };
}

export function extrasFromJson(data: unknown, tax: number): CityExtras | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const e = defaultExtras(tax);
  const taxes = d.taxes;
  if (!Array.isArray(taxes) || taxes.length !== 4 || !taxes.every(t => Number.isInteger(t) && t >= 0 && t <= 30)) return null;
  e.taxes = taxes as Taxes;
  const district = unrle(d.district, DISTRICT_COUNT), terraform = unrle(d.terraform, FILLED);
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
  // A v13 city saved before rivers meandered has no river field: it keeps the valley it was built in.
  e.river = Number.isInteger(d.river) ? d.river as number : 0;
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
    else if (edits[i] === FILLED) { water[i] = 0; shore[i] = 0; flow[i] = -1; }
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

/** Whether this tile may be dug out or filled in. The river's own channel can be narrowed, never cut. */
export function terraformAllowed(base: Terrain, edits: Uint8Array, tile: number, action: 'dig' | 'fill'): boolean {
  const x = tile % GRID, z = Math.floor(tile / GRID);
  if (x < 1 || z < 1 || x >= GRID - 1 || z >= GRID - 1) return false;
  if (action === 'dig') return !base.water[tile] && edits[tile] !== DUG;
  if (edits[tile] === DUG) return true;
  if (!base.water[tile] || edits[tile] === FILLED) return false;
  // Filling may eat into the bank, but keep at least two cells of river on either side of it.
  let wet = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let k = 1; k <= 2; k++) {
      const nx = x + dx * k, nz = z + dz * k;
      if (nx < 0 || nz < 0 || nx >= GRID || nz >= GRID) break;
      const n = nz * GRID + nx;
      if (base.water[n] && edits[n] !== FILLED) wet++;
    }
  }
  const bank = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
    const nx = x + dx, nz = z + dz;
    return nx >= 0 && nz >= 0 && nx < GRID && nz < GRID && (!base.water[nz * GRID + nx] || edits[nz * GRID + nx] === FILLED);
  });
  return bank && wet >= 4;
}
