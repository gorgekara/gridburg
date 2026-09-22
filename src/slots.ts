import { decode, encode } from './save';
import type { SaveData } from './save';
import { RES_POP, T_RES } from './constants';

/** Named saves kept in this browser, beside the single autosave. */
export interface SlotInfo { name: string; savedAt: number; population: number; day: number }

const PREFIX = 'gridburg.slot.';
const INDEX = 'gridburg.slots';

function readIndex(): SlotInfo[] {
  try {
    const list = JSON.parse(localStorage.getItem(INDEX) ?? '[]') as SlotInfo[];
    return Array.isArray(list) ? list.filter(s => s && typeof s.name === 'string') : [];
  } catch { return []; }
}

export function listSlots(): SlotInfo[] {
  return readIndex().sort((a, b) => b.savedAt - a.savedAt);
}

export function saveSlot(name: string, data: SaveData, day: number): boolean {
  const clean = name.trim().slice(0, 40);
  if (!clean) return false;
  try {
    localStorage.setItem(PREFIX + clean, encode(data));
    const population = data.kind.reduce((n, k, i) => n + (k === T_RES ? RES_POP[data.level[i]] : 0), 0);
    const list = readIndex().filter(s => s.name !== clean);
    list.push({ name: clean, savedAt: Date.now(), population, day });
    localStorage.setItem(INDEX, JSON.stringify(list));
    return true;
  } catch { return false; }
}

export function loadSlot(name: string): SaveData | null {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    return raw ? decode(raw) : null;
  } catch { return null; }
}

export function deleteSlot(name: string): void {
  try {
    localStorage.removeItem(PREFIX + name);
    localStorage.setItem(INDEX, JSON.stringify(readIndex().filter(s => s.name !== name)));
  } catch { /* storage may be blocked */ }
}
