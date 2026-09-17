import { N_TILES, START_MONEY } from './constants';

export interface SaveData {
  kind: Uint8Array;
  link: Uint8Array;
  level: Uint8Array;
  money: number;
  tick: number;
  tax: number;
}

// Bumped when the game stopped booting into the demo city, so old auto-saved demos don't linger.
const KEY = 'gridburg.save.v2';
const HEAD = 10;

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

/** Run-length encode a per-tile byte stream as (value, run) pairs. */
function rle(values: (i: number) => number, out: number[]): void {
  let i = 0;
  while (i < N_TILES) {
    const v = values(i);
    let run = 1;
    while (i + run < N_TILES && run < 255 && values(i + run) === v) run++;
    out.push(v, run);
    i += run;
  }
}

/** Decode one RLE stream starting at p into dst; returns the position after it. */
function unrle(bytes: Uint8Array, p: number, dst: (i: number, v: number) => void): number {
  let i = 0;
  while (p + 1 < bytes.length && i < N_TILES) {
    const v = bytes[p];
    const run = bytes[p + 1];
    for (let r = 0; r < run && i < N_TILES; r++, i++) dst(i, v);
    p += 2;
  }
  return p;
}

/** Pack the four diagonal link bits (1,3,5,7) into a nibble. */
function packLink(l: number): number {
  return ((l >> 1) & 1) | (((l >> 3) & 1) << 1) | (((l >> 5) & 1) << 2) | (((l >> 7) & 1) << 3);
}

function unpackLink(n: number): number {
  return ((n & 1) << 1) | (((n >> 1) & 1) << 3) | (((n >> 2) & 1) << 5) | (((n >> 3) & 1) << 7);
}

/**
 * Version byte, tax, int32 money, uint32 tick, then an RLE stream of (kind<<4|level)
 * and, from version 2, a second RLE stream of packed diagonal links.
 */
export function encode(d: SaveData): string {
  const head = new Uint8Array(HEAD);
  const dv = new DataView(head.buffer);
  head[0] = 2;
  head[1] = d.tax;
  dv.setInt32(2, Math.round(d.money));
  dv.setUint32(6, d.tick);
  const body: number[] = [];
  rle((i) => (d.kind[i] << 4) | d.level[i], body);
  rle((i) => packLink(d.link[i]), body);
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  return toBase64Url(all);
}

export function decode(str: string): SaveData | null {
  try {
    const bytes = fromBase64Url(str);
    const version = bytes[0];
    if (version !== 1 && version !== 2) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const tax = bytes[1];
    const money = dv.getInt32(2);
    const tick = dv.getUint32(6);
    const kind = new Uint8Array(N_TILES);
    const level = new Uint8Array(N_TILES);
    const link = new Uint8Array(N_TILES);
    let p = unrle(bytes, HEAD, (i, v) => { kind[i] = v >> 4; level[i] = v & 15; });
    if (version >= 2) p = unrle(bytes, p, (i, v) => { link[i] = unpackLink(v); });
    return { kind, link, level, money, tick, tax };
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

export function blankSave(): SaveData {
  return {
    kind: new Uint8Array(N_TILES), link: new Uint8Array(N_TILES), level: new Uint8Array(N_TILES),
    money: START_MONEY, tick: 0, tax: 10,
  };
}
