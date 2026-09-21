import type { ParkPath } from './parkPaths';
import type { IncidentSnapshot } from './sim/incidents';
import { N_TILES, START_MONEY, T_RES, RES_POP, isZone, isService } from './constants';
import { defaultFunding, FUNDING_KEYS, validFunding, LOAN_TOTAL, NEGLECT_LIMIT } from './management';
import type { Funding } from './management';
import { noPolicies, policiesFromMask, policyMask } from './policies';
import type { Policies } from './policies';
import { levelForPopulation, MILESTONES } from './progression';
import type { PlainNet } from './roads/network';

export interface SaveData {
  parkPaths?: ParkPath[];
  /** Quarter turns for placed buildings, sparse: most tiles face their road. */
  rot?: Uint8Array;
  incidents?: IncidentSnapshot;
  policies?: Policies;
  funding?: Funding;
  debt?: number;
  neglect?: Uint8Array;
  cityLevel?: number;
  seed: number;
  kind: Uint8Array;
  level: Uint8Array;
  net: PlainNet;
  money: number;
  tick: number;
  tax: number;
}

// Keep the storage key to migrate existing cities in place. Versions 3–6 remain readable.
const KEY = 'gridburg.save.v3';
const VERSION = 12;
// v9 appends a two-byte policy mask to the v8 header. v10 cities, which stored drawn railway lines
// after the incidents, still load; their lines are ignored now that railways pair up again. v11 puts
// the quarter turn of every rotated building in that spot instead.
const HEAD_V8 = 28;
const HEAD = 30;
const C_OFF = 40; // coordinates are stored as (value + 40) * 256 in a uint16
const C_SCALE = 256;

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const packC = (v: number): number => Math.max(0, Math.min(65535, Math.round((v + C_OFF) * C_SCALE)));
const unpackC = (v: number): number => v / C_SCALE - C_OFF;

/**
 * v7 header (v6 layout; segment flags add bridge/tunnel structure bits): version, tax, money, tick, seed, city level, debt and nine funding percentages.
 * RLE tiles: (kind<<2|level, run, service-neglect seconds),
 * then the road network with compacted ids: uint16 counts, 5 bytes per node, 9 per segment,
 * followed by a uint32-length-prefixed JSON incident snapshot.
 */
export function encode(d: SaveData): string {
  const bytes: number[] = new Array(HEAD).fill(0);
  const u16 = (v: number): void => { bytes.push((v >> 8) & 255, v & 255); };
  let i = 0;
  while (i < N_TILES) {
    const v = (d.kind[i] << 2) | d.level[i];
    const neglect = d.neglect?.[i] ?? 0;
    let run = 1;
    while (i + run < N_TILES && run < 255 && ((d.kind[i + run] << 2) | d.level[i + run]) === v && (d.neglect?.[i + run] ?? 0) === neglect) run++;
    bytes.push(v, run, neglect);
    i += run;
  }
  const index = new Map<number, number>();
  d.net.nodes.forEach((n, k) => index.set(n[0], k));
  const segs = d.net.segs.filter((s) => index.has(s[1]) && index.has(s[2]));
  u16(d.net.nodes.length);
  u16(segs.length);
  for (const n of d.net.nodes) { u16(packC(n[1])); u16(packC(n[2])); bytes.push(n[3] & 255); }
  for (const s of segs) { u16(index.get(s[1])!); u16(index.get(s[2])!); u16(packC(s[3])); u16(packC(s[4])); bytes.push(s[5] & 255); }

  const incidentBytes = new TextEncoder().encode(JSON.stringify(d.incidents ?? { fires: [], crime: [], patrol: [] }));
  bytes.push((incidentBytes.length >>> 24) & 255, (incidentBytes.length >>> 16) & 255, (incidentBytes.length >>> 8) & 255, incidentBytes.length & 255);
  for (const byte of incidentBytes) bytes.push(byte);
  // Rotated buildings: a count, then each one's tile and quarter turn. Most cities have none.
  const turned: number[] = [];
  for (let t = 0; t < N_TILES && turned.length < 3 * 2000; t++) if (d.rot?.[t]) turned.push(t, d.rot[t] & 3);
  bytes.push((turned.length / 2 >> 8) & 255, (turned.length / 2) & 255);
  for (let k = 0; k < turned.length; k += 2) bytes.push((turned[k] >> 8) & 255, turned[k] & 255, turned[k + 1]);
  const paths = d.parkPaths ?? [];
  if (paths.length > 2000) throw new Error('Too many park paths');
  u16(paths.length);
  for (const path of paths) for (const key of ['ax', 'az', 'cx', 'cz', 'bx', 'bz'] as const) u16(packC(path[key]));
  const all = Uint8Array.from(bytes);
  const dv = new DataView(all.buffer);
  all[0] = VERSION;
  all[1] = d.tax;
  all[14] = d.cityLevel ?? levelForPopulation(d.kind.reduce((n, k, i) => n + (k === T_RES ? RES_POP[d.level[i]] : 0), 0));
  dv.setUint32(15, d.debt ?? 0);
  const funding = d.funding ?? defaultFunding();
  FUNDING_KEYS.forEach((key, i) => { all[19 + i] = funding[key]; });
  dv.setUint16(28, policyMask(d.policies ?? noPolicies()));
  dv.setInt32(2, Math.round(d.money));
  dv.setUint32(6, d.tick);
  dv.setUint32(10, d.seed >>> 0);
  return toBase64Url(all);
}

export function decode(str: string): SaveData | null {
  try {
    const bytes = fromBase64Url(str);
    const legacy = bytes[0] === 3;
    const version = bytes[0];
    if (![3, 4, 5, 6, 7, 8, 9, 10, 11, VERSION].includes(version)) return null;
    const header = legacy ? 14 : version === 4 ? 15 : version >= 9 ? HEAD : HEAD_V8;
    if (bytes.length < header) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const tax = bytes[1];
    if (tax > 30) return null;
    const debt = version >= 5 ? dv.getUint32(15) : 0;
    if (debt > LOAN_TOTAL) return null;
    const funding = defaultFunding();
    if (version >= 5) for (const [i, key] of FUNDING_KEYS.entries()) {
      if (!validFunding(bytes[19 + i])) return null;
      funding[key] = bytes[19 + i];
    }
    const policies = version >= 9 ? policiesFromMask(dv.getUint16(28)) : noPolicies();
    const money = dv.getInt32(2);
    const tick = dv.getUint32(6);
    const seed = dv.getUint32(10);
    const kind = new Uint8Array(N_TILES);
    const level = new Uint8Array(N_TILES);
    const neglect = new Uint8Array(N_TILES);
    let p = header;
    let i = 0;
    while (i < N_TILES && p + 1 < bytes.length) {
      const v = bytes[p];
      const run = bytes[p + 1];
      const k = v >> (legacy ? 4 : 2), l = v & (legacy ? 15 : 3);
      if (!run || i + run > N_TILES || (k !== 0 && !isZone(k) && !isService(k)) || l > 3) return null;
      const n = version >= 5 ? bytes[p + 2] : 0;
      if (n === undefined || n >= NEGLECT_LIMIT) return null;
      for (let r = 0; r < run; r++, i++) { kind[i] = k; level[i] = l; neglect[i] = n; }
      p += version >= 5 ? 3 : 2;
    }
    if (i !== N_TILES) return null;
    const nNodes = dv.getUint16(p); p += 2;
    const nSegs = dv.getUint16(p); p += 2;
    const net: PlainNet = { nextId: nNodes + nSegs + 1, nodes: [], segs: [] };
    for (let k = 0; k < nNodes; k++) {
      net.nodes.push([k + 1, unpackC(dv.getUint16(p)), unpackC(dv.getUint16(p + 2)), bytes[p + 4]]);
      p += 5;
    }
    for (let k = 0; k < nSegs; k++) {
      net.segs.push([
        nNodes + k + 1, dv.getUint16(p) + 1, dv.getUint16(p + 2) + 1,
        unpackC(dv.getUint16(p + 4)), unpackC(dv.getUint16(p + 6)), bytes[p + 8],
      ]);
      p += 9;
    }
    let incidents: IncidentSnapshot | undefined;
    if (version >= 6) {
      const length = dv.getUint32(p); p += 4;
      // The incident block is no longer the end of the stream: v10 stores railway lines after it,
      // and whatever follows still has to be consumed exactly by the checks below.
      if (length > 1000000 || p + length > bytes.length) return null;
      const data = JSON.parse(new TextDecoder().decode(bytes.subarray(p, p + length)));
      const tile = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < N_TILES;
      const pairs = (list: unknown, max: number): boolean => Array.isArray(list) && list.length <= N_TILES && list.every(v => Array.isArray(v) && v.length === 2 && tile(v[0]) && Number.isInteger(v[1]) && v[1] >= 0 && v[1] <= max);
      if (!data || !Array.isArray(data.fires) || data.fires.length > N_TILES || !data.fires.every((f: { tile: unknown; age: number }) => f && tile(f.tile) && Number.isInteger(f.age) && f.age >= 0 && f.age < 120) || !pairs(data.crime, 100) || !pairs(data.patrol, 180)) return null;
      incidents = { fires: data.fires, crime: data.crime, patrol: data.patrol }; p += length;
    }
    // A v10 city carries a block of drawn railway lines here. Railways connect themselves again,
    // so the block is validated for length and then skipped.
    if (version === 10) {
      if (p >= bytes.length) return null;
      const count = bytes[p]; p += 1;
      if (p + count * 4 !== bytes.length) return null;
      p += count * 4;
    }
    const rot = new Uint8Array(N_TILES);
    if (version >= 11) {
      if (p + 1 >= bytes.length) return null;
      const count = dv.getUint16(p); p += 2;
      if (p + count * 3 > bytes.length || (version === 11 && p + count * 3 !== bytes.length)) return null;
      for (let k = 0; k < count; k++, p += 3) {
        const tile = dv.getUint16(p);
        if (tile >= N_TILES) return null;
        rot[tile] = bytes[p + 2] & 3;
      }
    }
    const parkPaths: ParkPath[] = [];
    if (version >= 12) {
      const count = dv.getUint16(p); p += 2;
      if (count > 2000 || p + count * 12 !== bytes.length) return null;
      for (let n = 0; n < count; n++) {
        const values: number[] = [];
        for (let j = 0; j < 6; j++, p += 2) values.push(unpackC(dv.getUint16(p)));
        if (values.some(v => v < 0 || v >= 80)) return null;
        const [ax, az, cx, cz, bx, bz] = values;
        parkPaths.push({ ax, az, cx, cz, bx, bz });
      }
    }
    // Cities saved while the map kinds existed carry one extra byte; skip it.
    if (bytes.length - p === 1) p += 1;
    if (p !== bytes.length) return null;
    const population = kind.reduce((n, k, j) => n + (k === T_RES ? RES_POP[level[j]] : 0), 0);
    const cityLevel = legacy ? levelForPopulation(population) : bytes[14];
    if (cityLevel >= MILESTONES.length) return null;
    return { seed, kind, level, rot, parkPaths, net, money, tick, tax, cityLevel, funding, policies, debt, neglect, incidents };
  } catch {
    return null;
  }
}

export function saveLocal(d: SaveData): void {
  try {
    localStorage.setItem(KEY, encode(d));
  } catch {
    /* storage unavailable */
  }
}

export function loadLocal(): SaveData | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? decode(s) : null;
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function loadFromHash(): SaveData | null {
  const m = location.hash.match(/#c=([A-Za-z0-9_-]+)/);
  return m ? decode(m[1]) : null;
}

export function shareUrl(d: SaveData): string {
  return `${location.origin}${location.pathname}#c=${encode(d)}`;
}

export { START_MONEY };
