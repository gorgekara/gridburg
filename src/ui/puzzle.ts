import { SCENARIOS, totalBudget } from '../scenarios/defs';
import type { Scenario, Wave } from '../scenarios/defs';
import { clock, loadProgress } from '../scenarios/runtime';
import type { Run } from '../scenarios/runtime';
import { icon } from './icons';
import { thumbOf } from './thumb';

export interface PuzzleActions {
  /** Load a level and hand the city over to the player, paused on its briefing. */
  start(def: Scenario): void;
  /** Leave the puzzles and go back to the sandbox city. */
  exit(): void;
  /** The briefing has been read: start the clock. */
  go(): void;
}

const THUMB_W = 228, THUMB_H = 118;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function stars(n: number, size = 13): HTMLElement {
  const wrap = el('span', 'stars');
  for (let i = 0; i < 3; i++) {
    const s = icon('star', size);
    s.classList.add(i < n ? 'on' : 'off');
    wrap.append(s);
  }
  return wrap;
}

const money = (n: number): string => `$${Math.round(n).toLocaleString()}`;

/** A row of icon, label and value, the way the sandbox reads its meters out. */
function stat(ic: string, label: string, value: string): HTMLElement {
  const row = el('div', 'sline');
  row.append(icon(ic, 15), el('span', 'slabel', label), el('span', 'sval', value));
  return row;
}

/**
 * The scenario chrome: the level picker, the briefing, the shift panel that runs alongside the
 * sandbox HUD, and the card at the end of a shift. Everything here borrows the sandbox's own
 * furniture — chips, cards, meters — so a puzzle looks like the rest of the game.
 */
export class PuzzleUi {
  private picker = el('div', 'overlay picker');
  private pickerBody = el('div', 'pickgrid');
  private brief = el('div', 'overlay brief');
  private briefCard = el('div', 'sheet');
  private result = el('div', 'overlay result');
  private resultCard = el('div', 'sheet');
  private panel = el('div', 'shift');
  private panelName = el('span', 'shname');
  private timeLeft = el('span', 'shclock');
  private track = el('div', 'track');
  private trackFill = el('div', 'tfill');
  private waveName = el('span', 'wname');
  private waveNext = el('span', 'wnext');
  private jamFill = el('div', 'jfill');
  private jamNote = el('span', 'jnote');
  private delivered = el('span', 'val');
  private stalled = el('span', 'sub2');
  private run: Run | null = null;
  private actions: PuzzleActions;

  constructor(root: HTMLElement, actions: PuzzleActions) {
    this.actions = actions;

    // ---- level picker ---------------------------------------------------------------------
    const pick = el('div', 'sheet wide');
    const head = el('div', 'shead');
    head.append(icon('puzzle', 18), el('span', 'ptitle', 'Traffic puzzles'),
      el('span', 'hint', 'Five cities somebody else built badly, one rush hour each'));
    pick.append(head);
    pick.append(el('p', 'lede', 'The buildings are fixed and nothing earns: your money arrives wave by '
      + 'wave as the traffic does. Keep the city moving until the shift is over. Let it seize up and '
      + 'the shift is lost.'));
    pick.append(this.pickerBody);
    const back = el('button', 'wide-btn ghost', 'Back to my own city');
    back.addEventListener('click', () => { this.closeAll(); actions.exit(); });
    const foot = el('div', 'brow');
    foot.append(back);
    pick.append(foot);
    this.picker.append(pick);

    this.brief.append(this.briefCard);
    this.result.append(this.resultCard);

    // ---- the shift panel ------------------------------------------------------------------
    const bar = el('div', 'shhead');
    const quit = el('button', 'iconbtn small');
    quit.title = 'Back to the puzzle list';
    quit.append(icon('menu', 15));
    quit.addEventListener('click', () => this.openPicker());
    bar.append(this.panelName, this.timeLeft, quit);

    this.track.append(this.trackFill);
    const waveRow = el('div', 'wrow');
    waveRow.append(this.waveName, this.waveNext);

    const jam = el('div', 'meter jam');
    jam.title = 'Stalled traffic. Fill this and the shift is lost.';
    const jbar = el('div', 'mbar');
    jbar.append(this.jamFill);
    jam.append(icon('car', 15), jbar, this.jamNote);

    const tally = el('div', 'shtally');
    const done = el('div', 'chip');
    done.title = 'Trips delivered since the whistle';
    done.append(icon('check', 15), this.delivered, el('span', 'label', 'delivered'), this.stalled);
    tally.append(done);

    this.panel.append(bar, this.track, waveRow, jam, tally);
    this.panel.classList.add('hidden');

    root.append(this.panel, this.picker, this.brief, this.result);
  }

  private closeAll(): void {
    for (const o of [this.picker, this.brief, this.result]) o.classList.remove('open');
  }

  get open(): boolean {
    return [this.picker, this.brief, this.result].some((o) => o.classList.contains('open'));
  }

  /** Show the list of levels with whatever the player has earned so far. */
  openPicker(): void {
    const progress = loadProgress();
    this.pickerBody.replaceChildren(...SCENARIOS.map((def, i) => {
      const best = progress[def.id];
      const card = el('button', 'pickcard');
      const art = el('span', 'art');
      art.append(thumbOf(def, THUMB_W, THUMB_H));
      art.append(el('span', 'pnum', String(i + 1)));
      if (best?.stars) art.append(stars(best.stars, 13));
      card.append(art, el('span', 'pname', def.name), el('span', 'pblurb', def.blurb));
      const facts = el('span', 'pfacts');
      facts.append(
        el('span', 'pfact', `${clock(def.duration)} shift`),
        el('span', 'pfact money', money(totalBudget(def))),
        el('span', 'pfact', `${def.waves.length} waves`),
      );
      card.append(facts);
      if (best) card.append(el('span', 'pbest', `Best ${best.delivered} trips delivered`));
      card.addEventListener('click', () => {
        this.closeAll();
        this.actions.start(def);
      });
      return card;
    }));
    this.closeAll();
    this.picker.classList.add('open');
  }

  /** Called once a level's city is loaded: show its briefing and start tracking the shift. */
  begin(run: Run): void {
    this.run = run;
    const def = run.def;
    this.panelName.textContent = def.name;
    this.panel.classList.remove('hidden');
    // A fresh shift gets fresh wave marks: the last level's are the wrong length.
    this.track.replaceChildren(this.trackFill);
    this.render();

    const head = el('div', 'shead');
    head.append(icon('puzzle', 18), el('span', 'ptitle', def.name),
      el('span', 'hint', `${clock(def.duration)} shift · ${money(totalBudget(def))} in ${def.waves.length} waves`));
    this.briefCard.replaceChildren(head, el('p', 'lede', def.brief));

    const waves = el('div', 'wavelist');
    waves.append(el('div', 'mlabel', 'The shift'));
    for (const w of def.waves) {
      const row = el('div', 'waverow');
      row.append(el('span', 'wtime', clock(w.at)), el('span', 'wlabel', w.name),
        el('span', 'wmul', `×${w.demand} traffic`), el('span', 'wgrant', w.grant ? `+${money(w.grant)}` : ''));
      waves.append(row);
    }
    this.briefCard.append(waves);

    const rules = el('div', 'rules');
    rules.append(
      stat('check', 'Survive the shift', `${clock(def.duration)} without gridlock`),
      stat('car', 'Gridlock ends it', `about ${def.gridlock} cars at a standstill`),
      stat('star', 'Three stars', `${def.targets[2]} trips delivered`),
      stat('money', 'In hand now', money(def.opening)),
    );
    this.briefCard.append(rules);
    this.briefCard.append(el('p', 'dim', 'Bulldozing roads is free, so a wrong turn only costs what you '
      + 'paid to build it. The clock is the simulation, so pausing stops it too.'));

    const go = el('button', 'wide-btn', 'Start the shift');
    go.addEventListener('click', () => { this.closeAll(); this.actions.go(); });
    const row = el('div', 'brow');
    row.append(go);
    const list = el('button', 'wide-btn ghost', 'All puzzles');
    list.addEventListener('click', () => this.openPicker());
    row.append(list);
    this.briefCard.append(row);
    this.closeAll();
    this.brief.classList.add('open');
  }

  /** Stop showing scenario chrome. */
  end(): void {
    this.run = null;
    this.panel.classList.add('hidden');
    this.closeAll();
  }

  /** A wave has landed: say so on the panel. */
  announce(w: Wave): void {
    this.waveName.textContent = w.name;
    this.panel.classList.remove('flash');
    void this.panel.offsetWidth; // restart the animation rather than letting it run on
    this.panel.classList.add('flash');
  }

  /** Refresh the shift panel from the run. */
  render(): void {
    const r = this.run;
    if (!r) return;
    const def = r.def;
    this.timeLeft.textContent = clock(r.remaining);
    this.timeLeft.classList.toggle('low', r.remaining <= 30 && r.outcome === 'running');
    this.trackFill.style.width = `${r.progress * 100}%`;
    if (this.track.childElementCount <= 1) {
      for (const w of def.waves.slice(1)) {
        const tick = el('div', 'ttick');
        tick.style.left = `${(w.at / def.duration) * 100}%`;
        tick.title = `${w.name} at ${clock(w.at)}`;
        this.track.append(tick);
      }
    }
    this.waveName.textContent = r.wave.name;
    const next = r.nextWave;
    this.waveNext.textContent = next
      ? `${next.name} in ${clock(next.at - r.elapsed)}`
      : r.outcome === 'running' ? 'Ride it out' : '';

    this.jamFill.style.width = `${Math.round(r.jam * 100)}%`;
    this.jamFill.classList.toggle('bad', r.jam > 0.55);
    const stuck = r.stats.stuck;
    this.jamNote.textContent = r.jam <= 0.02 && stuck === 0 ? 'Flowing'
      : r.jam > 0.55 ? 'Seizing up'
        : stuck > 0 ? `${stuck} at a standstill` : 'Clearing';
    this.jamNote.classList.toggle('neg', r.jam > 0.55);
    this.delivered.textContent = String(r.delivered);
    const orphans = r.stats.orphans;
    this.stalled.textContent = orphans > 0 ? `${orphans} cut off` : '';
    this.stalled.classList.toggle('neg', orphans > 0);
  }

  /** The card shown when a shift ends, won or lost. */
  showResult(run: Run, wasBest: number): void {
    const def = run.def;
    const won = run.outcome === 'won';
    const next = SCENARIOS[SCENARIOS.indexOf(def) + 1];
    const head = el('div', 'shead');
    head.append(icon(won ? 'check' : 'car', 18), el('span', 'ptitle', won ? `${def.name} survived` : 'Gridlock'),
      el('span', 'hint', won ? `The whole ${clock(def.duration)} shift` : `The city seized up at ${clock(run.elapsed)}`));
    this.resultCard.replaceChildren(head);
    this.resultCard.classList.toggle('lost', !won);

    if (won) {
      this.resultCard.append(stars(run.stars, 30));
      const nextStar = run.stars < 3 ? def.targets[run.stars] : 0;
      this.resultCard.append(el('p', 'lede', `${run.delivered} trips delivered on ${money(run.spent)} of road. `
        + (nextStar ? `Another ${nextStar - run.delivered} would have earned the next star.`
          : 'Nothing about this one goes better than that.')));
    } else {
      this.resultCard.append(el('p', 'lede', `${run.delivered} trips got through before the queues stopped `
        + `moving, with ${clock(def.duration - run.elapsed)} of the shift still to run. Standing traffic fills `
        + 'the gridlock meter; widening what is full, or giving it another way round, empties it.'));
    }
    const rules = el('div', 'rules');
    rules.append(
      stat('check', 'Delivered', String(run.delivered)),
      stat('star', 'Three stars at', String(def.targets[2])),
      stat('money', 'Spent', `${money(run.spent)} of ${money(totalBudget(def))}`),
    );
    if (wasBest) rules.append(stat('puzzle', 'Your best here', `${wasBest} trips`));
    this.resultCard.append(rules);

    const row = el('div', 'brow');
    const again = el('button', 'wide-btn', won ? 'Run it again' : 'Try again');
    again.addEventListener('click', () => { this.closeAll(); this.actions.start(def); });
    row.append(again);
    if (won && next) {
      const b = el('button', 'wide-btn ghost', `Next: ${next.name}`);
      b.addEventListener('click', () => { this.closeAll(); this.actions.start(next); });
      row.append(b);
    }
    const list = el('button', 'wide-btn ghost', 'All puzzles');
    list.addEventListener('click', () => this.openPicker());
    row.append(list);
    this.resultCard.append(row);
    this.closeAll();
    this.result.classList.add('open');
  }
}
