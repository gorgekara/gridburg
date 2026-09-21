/** Shared geometry quality; Balanced preserves the existing city appearance. */
export type VisualDetail = 0 | 1 | 2;
export function visualDetail(value: unknown): VisualDetail {
  return value === 0 || value === 2 ? value : 1;
}
