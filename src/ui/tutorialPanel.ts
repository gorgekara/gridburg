import type { Tutorial, TutorialView } from '../tutorials';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface TutorialActions {
  /** Start the next tutorial in the list, if there is one. */
  next(): void;
  /** Leave the tutorial (the city stays). */
  exit(): void;
}

/**
 * The tutorial card: the lesson's steps, ticked off as the city shows each done, the current one with
 * its hint, and the goal; when the goal is met, a well done and the way on to the next lesson.
 */
export class TutorialPanel {
  readonly root = el('div', 'popover tutorial');
  private tutorial: Tutorial | null = null;
  private index = 0;
  private total = 0;
  private done: boolean[] = [];
  private goalMet = false;
  private complete = false;
  private hasNext = false;
  private actions: TutorialActions;

  constructor(actions: TutorialActions) { this.actions = actions; }

  get active(): Tutorial | null { return this.tutorial; }

  open(t: Tutorial, index: number, total: number, hasNext: boolean): void {
    this.tutorial = t; this.index = index; this.total = total; this.hasNext = hasNext;
    this.done = t.steps.map(() => false); this.goalMet = false; this.complete = false;
    this.render();
    this.root.classList.add('open');
  }

  close(): void { this.tutorial = null; this.root.classList.remove('open'); }

  /**
   * Check the city against the steps and the goal. Steps tick off in order: a later one only counts
   * once those before it are done, so the lesson goes the way it is told. Returns true the moment
   * the lesson is finished.
   */
  check(v: TutorialView): boolean {
    const t = this.tutorial;
    if (!t || this.complete) return false;
    let changed = false;
    for (let k = 0; k < t.steps.length; k++) {
      if (this.done[k]) continue;
      if (k > 0 && !this.done[k - 1]) break;
      if (t.steps[k].done(v)) { this.done[k] = true; changed = true; } else break;
    }
    const all = this.done.every(Boolean);
    if (all && !this.goalMet && t.goal.done(v)) { this.goalMet = true; this.complete = true; changed = true; }
    if (changed) this.render();
    return this.complete;
  }

  private render(): void {
    const t = this.tutorial!, a = this.actions;
    this.root.replaceChildren();
    const head = el('div', 'signal-head');
    head.append(el('div', 'ptitle', `Tutorial ${this.index + 1} of ${this.total} · ${t.title}`));
    const x = el('button', 'signal-x', '×'); x.title = 'Leave the tutorial'; x.addEventListener('click', () => a.exit());
    head.append(x);
    this.root.append(head, el('p', 'pnote', t.intro));
    const list = el('ol', 'tutorial-steps');
    const current = this.done.findIndex(d => !d);
    t.steps.forEach((s, k) => {
      const li = el('li', this.done[k] ? 'done' : k === current ? 'current' : '');
      li.append(el('span', 'tutorial-check', this.done[k] ? '✓' : String(k + 1)), el('span', 'tutorial-text', s.text));
      if (k === current) li.append(el('span', 'tutorial-hint', s.hint));
      list.append(li);
    });
    const goal = el('li', `goal${this.goalMet ? ' done' : current < 0 ? ' current' : ''}`);
    goal.append(el('span', 'tutorial-check', this.goalMet ? '✓' : '★'), el('span', 'tutorial-text', `Goal: ${t.goal.text}`));
    list.append(goal);
    this.root.append(list);
    if (this.complete) {
      const foot = el('div', 'tutorial-done');
      foot.append(el('strong', undefined, 'Well done!'), el('span', 'pnote', this.hasNext ? 'On to the next lesson, or keep building here.' : 'That was the last lesson: the city is yours.'));
      const row = el('div', 'signal-foot');
      if (this.hasNext) { const next = el('button', 'signal-btn primary', 'Next tutorial'); next.addEventListener('click', () => a.next()); row.append(next); }
      const stay = el('button', 'signal-btn', 'Keep building'); stay.addEventListener('click', () => a.exit());
      row.append(stay);
      foot.append(row);
      this.root.append(foot);
    }
  }
}
