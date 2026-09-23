import type { RaceHud, RaceResult } from '../racing/race';
import type { RaceRoute } from '../racing/routes';
import { RACE_KINDS } from '../racing/routes';
import { ordinal } from './garage';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const clock = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export interface RaceHudActions {
  again(race: RaceRoute): void;
  garage(): void;
  drive(): void;
}

/**
 * What a racer needs on screen: the race, place, lap and time along the top, a countdown and messages
 * in the middle, a flashing wrong-way warning, the drift score or the police meter, a prompt to start
 * when the car sits on a race ring, and the results at the end.
 */
export class RaceHudView {
  private root = el('div', 'race-hud');
  private bar = el('div', 'race-bar');
  private name = el('span', 'race-name');
  private stats = el('div', 'race-stats');
  private progress = el('div', 'race-progress');
  private progressFill = el('span');
  private big = el('div', 'race-big');
  private warn = el('div', 'race-warn', 'WRONG WAY');
  private meter = el('div', 'race-meter');
  private meterFill = el('span');
  private prompt = el('div', 'race-prompt');
  private results = el('div', 'race-results');
  private shown = '';
  private actions: RaceHudActions;

  constructor(parent: HTMLElement, actions: RaceHudActions) {
    this.actions = actions;
    this.progress.append(this.progressFill);
    this.meter.append(el('span', 'label', 'Police'), this.meterFill);
    this.bar.append(this.name, this.stats, this.progress, this.meter);
    this.root.append(this.bar, this.big, this.warn, this.prompt, this.results);
    parent.append(this.root);
    this.results.hidden = true;
    this.prompt.hidden = true;
    this.warn.hidden = true;
    this.render(null, null);
  }

  /** Draw the HUD for a race in progress (or none), and the prompt for a race ring underfoot. */
  render(hud: RaceHud | null, nearby: RaceRoute | null): void {
    this.bar.hidden = !hud;
    this.warn.hidden = !hud || hud.phase !== 'racing' || !(hud.wrongWay || hud.offRoute);
    if (hud) {
      this.warn.textContent = hud.wrongWay ? '⟲ WRONG WAY' : 'Back to the route · R resets';
      this.name.textContent = hud.name;
      this.name.style.borderColor = hex(RACE_KINDS[hud.kind].color);
      const parts: string[] = [];
      if (hud.kind === 'drift') parts.push(`${hud.score.toLocaleString('en-US')} / ${hud.target.toLocaleString('en-US')} pts`, `×${hud.combo}`);
      else if (hud.kind !== 'police') parts.push(`${ordinal(hud.place)} of ${hud.racers}`);
      if (hud.laps > 1) parts.push(`Lap ${hud.lap}/${hud.laps}`);
      parts.push(clock(hud.time));
      const text = parts.join('   ');
      if (this.stats.textContent !== text) this.stats.textContent = text;
      this.progressFill.style.width = `${Math.round(hud.progress * 100)}%`;
      this.meter.hidden = hud.kind !== 'police';
      this.meterFill.style.width = `${Math.round(hud.busted * 100)}%`;
      let big = '';
      if (hud.phase === 'countdown') big = hud.countdown > 0 ? String(Math.ceil(hud.countdown)) : 'GO!';
      else if (hud.messageTime > 0) big = hud.message;
      if (this.big.textContent !== big) this.big.textContent = big;
      this.big.classList.toggle('count', hud.phase === 'countdown');
    } else if (this.big.textContent) this.big.textContent = '';
    const promptText = !hud && nearby ? `${RACE_KINDS[nearby.kind].label}: ${nearby.name} — press Enter to race` : '';
    if (promptText !== this.shown) {
      this.shown = promptText;
      this.prompt.textContent = promptText;
      this.prompt.hidden = !promptText;
    }
  }

  /** The end of a race: how it went, what it paid, and where to go next. */
  showResult(r: RaceResult, cash: number): void {
    this.results.textContent = '';
    const kind = RACE_KINDS[r.race.kind];
    const head = r.race.kind === 'police' ? (r.busted ? 'Busted!' : 'Got away!')
      : r.race.kind === 'drift' ? (r.medal ? `${r.medal} medal` : 'Not enough points')
      : r.won ? 'You win!' : `${ordinal(r.place)} place`;
    const title = el('h2', undefined, head);
    title.style.color = r.share > 0 ? '#ffd166' : '#ff8a8a';
    const lines = [
      `${kind.label} · ${r.race.name}`,
      r.race.kind === 'drift' ? `${r.score.toLocaleString('en-US')} points (target ${r.race.target.toLocaleString('en-US')})` : `Time ${clock(r.time)}`,
      r.reward > 0 ? `+$${r.reward.toLocaleString('en-US')} winnings · $${Math.round(cash).toLocaleString('en-US')} to spend in the garage` : 'No prize this time',
    ];
    this.results.append(title, ...lines.map(t => el('p', undefined, t)));
    const row = el('div', 'race-buttons');
    const again = el('button', 'garage-go', 'Race again');
    again.addEventListener('click', () => { this.hideResult(); this.actions.again(r.race); });
    const garage = el('button', 'garage-buy', 'Garage');
    garage.addEventListener('click', () => { this.hideResult(); this.actions.garage(); });
    const drive = el('button', 'garage-buy', 'Keep driving');
    drive.addEventListener('click', () => { this.hideResult(); this.actions.drive(); });
    row.append(again, garage, drive);
    this.results.append(row);
    this.results.hidden = false;
  }

  hideResult(): void { this.results.hidden = true; }
  get resultOpen(): boolean { return !this.results.hidden; }
}
