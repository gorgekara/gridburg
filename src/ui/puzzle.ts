import { SCENARIOS } from '../scenarios/defs';
import type { Scenario } from '../scenarios/defs';
import { loadProgress } from '../scenarios/runtime';
import type { Attempt } from '../scenarios/runtime';
import { icon } from './icons';

export interface PuzzleActions {
  /** Load a level and hand the city over to the player. */
  start(def: Scenario): void;
  /** Leave the puzzles and go back to the sandbox city. */
  exit(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function stars(n: number, size = 14): HTMLElement {
  const wrap = el('span', 'stars');
  for (let i = 0; i < 3; i++) {
    const s = icon('star', size);
    s.classList.add(i < n ? 'on' : 'off');
    wrap.append(s);
  }
  return wrap;
}

const money = (n: number): string => `$${Math.round(n).toLocaleString()}`;

/**
 * The scenario chrome: the level picker, the briefing, the live goal panel, and the card that
 * comes up when a level is solved. The sandbox HUD underneath keeps doing its own job.
 */
export class PuzzleUi {
  private picker = el('div', 'overlay picker');
  private pickerBody = el('div', 'pickgrid');
  private brief = el('div', 'overlay brief');
  private briefCard = el('div', 'sheet');
  private result = el('div', 'overlay result');
  private resultCard = el('div', 'sheet');
  private panel = el('div', 'objectives');
  private panelName = el('div', 'oname');
  private goalList = el('div', 'goals');
  private holdFill = el('div', 'hfill');
  private holdNote = el('span', 'hnote');
  private budgetLine = el('div', 'obudget');
  private stalled = el('div', 'ostuck');
  private attempt: Attempt | null = null;
  private actions: PuzzleActions;

  constructor(root: HTMLElement, actions: PuzzleActions) {
    this.actions = actions;
    // ---- level picker ---------------------------------------------------------------------
    const pick = el('div', 'sheet wide');
    pick.append(el('h2', undefined, 'Traffic puzzles'));
    pick.append(el('p', undefined, 'Five cities that somebody else built badly. The buildings stay as '
      + 'they are and the budget never earns a penny, so the only thing you can change is the traffic.'));
    pick.append(this.pickerBody);
    const back = el('button', 'wide-btn', 'Back to my own city');
    back.addEventListener('click', () => { this.closeAll(); actions.exit(); });
    pick.append(back);
    this.picker.append(pick);

    this.brief.append(this.briefCard);
    this.result.append(this.resultCard);

    // ---- live goal panel -----------------------------------------------------------------
    const head = el('div', 'ohead');
    const quit = el('button', 'oquit');
    quit.title = 'Back to the puzzle list';
    quit.append(icon('menu', 15));
    quit.addEventListener('click', () => this.openPicker());
    head.append(this.panelName, quit);
    const hold = el('div', 'hbar');
    hold.append(this.holdFill);
    const holdRow = el('div', 'hrow');
    holdRow.append(hold, this.holdNote);
    this.panel.append(head, this.goalList, this.stalled, holdRow, this.budgetLine);
    this.panel.classList.add('hidden');

    root.append(this.panel, this.picker, this.brief, this.result);
  }

  private closeAll(): void {
    for (const o of [this.picker, this.brief, this.result]) o.classList.remove('open');
  }

  /** Show the list of levels with whatever the player has earned so far. */
  openPicker(): void {
    const progress = loadProgress();
    this.pickerBody.replaceChildren(...SCENARIOS.map((def, i) => {
      const card = el('button', 'pickcard');
      const top = el('div', 'pkrow');
      top.append(el('span', 'pnum', String(i + 1)), el('span', 'pname', def.name), stars(progress[def.id] ?? 0));
      card.append(top, el('span', 'pblurb', def.blurb), el('span', 'pbudget', `${money(def.budget)} to spend`));
      card.addEventListener('click', () => {
        this.closeAll();
        this.actions.start(def);
      });
      return card;
    }));
    this.closeAll();
    this.picker.classList.add('open');
  }

  /** Called once a level's city is loaded: show its briefing and start tracking it. */
  begin(attempt: Attempt): void {
    this.attempt = attempt;
    const def = attempt.def;
    this.panelName.textContent = def.name;
    this.panel.classList.remove('hidden');
    this.render();

    this.briefCard.replaceChildren();
    this.briefCard.append(el('h2', undefined, def.name), el('p', undefined, def.brief));
    const list = el('ul');
    for (const r of attempt.readings()) list.append(el('li', undefined, r.label));
    this.briefCard.append(el('p', 'dim', 'To finish the level, hold all of this at once for '
      + `${def.hold} seconds:`), list);
    this.briefCard.append(el('p', 'dim', `Budget ${money(def.budget)}. Spend ${money(def.par)} or less for three stars. `
      + 'Bulldozing roads is free, so a wrong turn only costs what you paid to build it.'));
    const go = el('button', 'wide-btn', 'Take a look');
    go.addEventListener('click', () => this.closeAll());
    this.briefCard.append(go);
    this.closeAll();
    this.brief.classList.add('open');
  }

  /** Stop showing scenario chrome. */
  end(): void {
    this.attempt = null;
    this.panel.classList.add('hidden');
    this.closeAll();
  }

  /** Refresh the goal panel from the attempt. */
  render(): void {
    const a = this.attempt;
    if (!a) return;
    this.goalList.replaceChildren(...a.readings().map((r) => {
      const row = el('div', `goal ${r.ok ? 'met' : ''}`);
      row.append(icon(r.ok ? 'check' : 'dot', 15), el('span', 'gtext', r.label), el('span', 'gval', r.value));
      return row;
    }));
    // Not a goal of its own, but the clearest sign of where a city is failing.
    const stuck = a.stats.stuck;
    this.stalled.textContent = stuck > 0 ? `${stuck} car${stuck === 1 ? '' : 's'} at a standstill` : '';
    this.stalled.classList.toggle('gone', stuck === 0);
    const p = a.progress();
    this.holdFill.style.width = `${Math.round(p * 100)}%`;
    this.holdNote.textContent = a.solved ? 'Solved'
      : a.held > 0 ? `Holding ${a.held}s of ${a.def.hold}s`
        : 'Not there yet';
    const left = a.def.budget - a.spent;
    this.budgetLine.textContent = `${money(left)} left of ${money(a.def.budget)} · par ${money(a.def.par)}`;
    this.budgetLine.classList.toggle('tight', a.spent > a.def.par);
  }

  /** The card shown when a level is solved. */
  showResult(attempt: Attempt, best: number): void {
    const def = attempt.def;
    const next = SCENARIOS[SCENARIOS.indexOf(def) + 1];
    this.resultCard.replaceChildren();
    this.resultCard.append(el('h2', undefined, `${def.name} solved`));
    this.resultCard.append(stars(attempt.stars, 30));
    this.resultCard.append(el('p', undefined, `You spent ${money(attempt.spent)} of ${money(def.budget)}. `
      + (attempt.stars === 3
        ? 'That is par or better, which is as good as this one gets.'
        : `Par is ${money(def.par)} — there is a cheaper answer in there somewhere.`)));
    if (best > attempt.stars) this.resultCard.append(el('p', 'dim', `Your best on this level is still ${best} stars.`));
    const row = el('div', 'brow');
    if (next) {
      const b = el('button', 'wide-btn', `Next: ${next.name}`);
      b.addEventListener('click', () => { this.closeAll(); this.actions.start(next); });
      row.append(b);
    }
    const again = el('button', 'wide-btn ghost', attempt.stars === 3 ? 'Play it again' : 'Try it cheaper');
    again.addEventListener('click', () => { this.closeAll(); this.actions.start(def); });
    row.append(again);
    const list = el('button', 'wide-btn ghost', 'All puzzles');
    list.addEventListener('click', () => this.openPicker());
    row.append(list);
    this.resultCard.append(row);
    this.closeAll();
    this.result.classList.add('open');
  }
}
