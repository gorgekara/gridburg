import { N_TILES, START_MONEY } from './constants';
import type { PlainNet } from './roads/network';

export interface SaveData {
  seed: number;
  kind: Uint8Array;
  level: Uint8Array;
  net: PlainNet;
  money: number;
  tick: number;
  tax: number;
}

// Bumped with the road-network rewrite; older saves use tile roads and cannot be loaded.
const KEY = 'gridburg.save.v3';
const VERSION = 3;
const HEAD = 14;
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
 * Header (version, tax, int32 money, uint32 tick, uint32 seed), RLE tiles as (kind<<4|level, run),
 * then the road network with compacted ids: uint16 counts, 5 bytes per node, 9 per segment.
 */
export function encode(d: SaveData): string {
  const bytes: number[] = new Array(HEAD).fill(0);
  const u16 = (v: number): void => { bytes.push((v >> 8) & 255, v & 255); };
  let i = 0;
  while (i < N_TILES) {
    const v = (d.kind[i] << 4) | d.level[i];
    let run = 1;
    while (i + run < N_TILES && run < 255 && ((d.kind[i + run] << 4) | d.level[i + run]) === v) run++;
    bytes.push(v, run);
    i += run;
  }
  const index = new Map<number, number>();
  d.net.nodes.forEach((n, k) => index.set(n[0], k));
  const segs = d.net.segs.filter((s) => index.has(s[1]) && index.has(s[2]));
  u16(d.net.nodes.length);
  u16(segs.length);
  for (const n of d.net.nodes) { u16(packC(n[1])); u16(packC(n[2])); bytes.push(n[3] & 255); }
  for (const s of segs) { u16(index.get(s[1])!); u16(index.get(s[2])!); u16(packC(s[3])); u16(packC(s[4])); bytes.push(s[5] & 255); }

  const all = Uint8Array.from(bytes);
  const dv = new DataView(all.buffer);
  all[0] = VERSION;
  all[1] = d.tax;
  dv.setInt32(2, Math.round(d.money));
  dv.setUint32(6, d.tick);
  dv.setUint32(10, d.seed >>> 0);
  return toBase64Url(all);
}

export function decode(str: string): SaveData | null {
  try {
    const bytes = fromBase64Url(str);
    if (bytes[0] !== VERSION) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const tax = bytes[1];
    const money = dv.getInt32(2);
    const tick = dv.getUint32(6);
    const seed = dv.getUint32(10);
    const kind = new Uint8Array(N_TILES);
    const level = new Uint8Array(N_TILES);
    let p = HEAD;
    let i = 0;
    while (i < N_TILES && p + 1 < bytes.length) {
      const v = bytes[p];
      const run = bytes[p + 1];
      for (let r = 0; r < run && i < N_TILES; r++, i++) { kind[i] = v >> 4; level[i] = v & 15; }
      p += 2;
    }
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
    return { seed, kind, level, net, money, tick, tax };
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
