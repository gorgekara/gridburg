/** Eight simulation minutes per day; a new city starts at 09:00. */
export const DAY_SECONDS = 480;
export function daylight(seconds: number): { hour: number; sun: number; day: number; night: number } {
  const hour = ((9 + seconds * 24 / DAY_SECONDS) % 24 + 24) % 24;
  const sun = Math.sin((hour - 6) / 24 * Math.PI * 2);
  const x = Math.max(0, Math.min(1, (sun + 0.14) / 0.4));
  const day = x * x * (3 - 2 * x);
  return { hour, sun, day, night: 1 - day };
}
