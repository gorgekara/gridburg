import type { MapType } from './terrain';

/**
 * Map kinds as the save format sees them. Labels live with the generator in terrain.ts;
 * this order is written into saves and must never change — append new kinds at the end.
 */
export type MapKind = MapType;

export const SAVE_ORDER: MapKind[] = ['river', 'islands', 'seaport', 'lakes'];

export const mapFromSave = (index: number): MapKind => SAVE_ORDER[index] ?? 'river';
export const mapToSave = (kind: MapKind): number => Math.max(0, SAVE_ORDER.indexOf(kind));
