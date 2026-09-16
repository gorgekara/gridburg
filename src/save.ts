import { N_TILES, START_MONEY } from './constants';

export interface SaveData {
  kind: Uint8Array;
  level: Uint8Array;
  money: number;
  tick: number;
  tax: number;
}

const KEY = 'gridburg.save.v1';

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

/** Version byte, tax, int32 money, uint32 tick, then RLE pairs of (kind<<4|level, run). */
export function encode(d: SaveData): string {
  const head = new Uint8Array(10);
  const dv = new DataView(head.buffer);
  head[0] = 1;
  head[1] = d.tax;
  dv.setInt32(2, Math.round(d.money));
  dv.setUint32(6, d.tick);
  const body: number[] = [];
  let i = 0;
  while (i < N_TILES) {
    const v = (d.kind[i] << 4) | d.level[i];
    let run = 1;
    while (i + run < N_TILES && run < 255 && ((d.kind[i + run] << 4) | d.level[i + run]) === v) run++;
    body.push(v, run);
    i += run;
  }
  const all = new Uint8Array(head.length + body.length);
  all.set(head);
  all.set(body, head.length);
  return toBase64Url(all);
}

export function decode(str: string): SaveData | null {
  try {
    const bytes = fromBase64Url(str);
    if (bytes[0] !== 1) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    const tax = bytes[1];
    const money = dv.getInt32(2);
    const tick = dv.getUint32(6);
    const kind = new Uint8Array(N_TILES);
    const level = new Uint8Array(N_TILES);
    let i = 0;
    for (let p = 10; p + 1 < bytes.length && i < N_TILES; p += 2) {
      const v = bytes[p];
      const run = bytes[p + 1];
      for (let r = 0; r < run && i < N_TILES; r++, i++) {
        kind[i] = v >> 4;
        level[i] = v & 15;
      }
    }
    return { kind, level, money, tick, tax };
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
  return { kind: new Uint8Array(N_TILES), level: new Uint8Array(N_TILES), money: START_MONEY, tick: 0, tax: 10 };
}
