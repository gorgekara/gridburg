/** Eight simulation minutes per day by default; a new city starts at 09:00. */
export const DAY_SECONDS = 480;
let dayLength = DAY_SECONDS;
/** Players can stretch or shorten the day in the settings; visuals only. */
export function setDayLength(seconds: number): void { dayLength = Math.max(60, seconds); }
export function currentDayLength(): number { return dayLength; }
export function daylight(seconds: number): { hour: number; sun: number; day: number; night: number } {
  const hour = ((9 + seconds * 24 / dayLength) % 24 + 24) % 24;
  const sun = Math.sin((hour - 6) / 24 * Math.PI * 2);
  const x = Math.max(0, Math.min(1, (sun + 0.14) / 0.4));
  const day = x * x * (3 - 2 * x);
  return { hour, sun, day, night: 1 - day };
}
