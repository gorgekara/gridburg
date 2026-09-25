import { MIN_GREEN, MAX_GREEN, DEFAULT_GREEN, clonePlan } from '../roads/signals';
import type { SignalPlan, MoveState } from '../roads/signals';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** What the signal editor asks the game to do. Every change comes back as a whole new plan. */
export interface SignalActions {
  commit(plan: SignalPlan, phase: number): void;
  select(phase: number): void;
  reset(): void;
  remove(): void;
  close(): void;
}

/** Cycle one movement's state in a phase: red, then green, then green giving way, then red again. */
export function cycleMove(plan: SignalPlan, phase: number, key: string): SignalPlan {
  const next = clonePlan(plan), moves = next.phases[phase].moves;
  const now = moves[key];
  const to: MoveState | undefined = now === undefined ? 1 : now === 1 ? 2 : undefined;
  if (to) moves[key] = to; else delete moves[key];
  return next;
}

/**
 * The signal editor's panel: a junction's phases with their green times, the adaptive switch, and
 * buttons to add a phase, reset to the default plan or take the signal away. The movements themselves
 * are edited on the arrows drawn over the junction.
 */
export class SignalPanel {
  readonly root = el('div', 'popover signals');
  private plan: SignalPlan | null = null;
  private phase = 0;

  private actions: SignalActions;

  constructor(actions: SignalActions) {
    this.actions = actions;
  }

  open(plan: SignalPlan, phase: number): void {
    this.plan = plan;
    this.phase = phase;
    this.render();
    this.root.classList.add('open');
  }

  close(): void {
    this.plan = null;
    this.root.classList.remove('open');
  }

  get isOpen(): boolean { return this.plan !== null; }

  private render(): void {
    const plan = this.plan!;
    const a = this.actions;
    this.root.replaceChildren();
    const head = el('div', 'signal-head');
    head.append(el('div', 'ptitle', 'Traffic signal'));
    const x = el('button', 'signal-x', '×'); x.title = 'Close'; x.addEventListener('click', () => a.close());
    head.append(x);
    this.root.append(head);
    this.root.append(el('p', 'pnote', 'Pick a phase, then click the arrows over the junction: green, green giving way (amber), or stop (red).'));
    const list = el('div', 'signal-phases');
    plan.phases.forEach((p, i) => {
      const row = el('div', `signal-phase${i === this.phase ? ' active' : ''}`);
      const name = el('button', 'signal-name', `Phase ${i + 1}`);
      name.addEventListener('click', () => a.select(i));
      const count = Object.keys(p.moves).length;
      const moves = el('span', 'signal-count', `${count} go`);
      const minus = el('button', 'signal-step', '−'), plus = el('button', 'signal-step', '+');
      const secs = el('span', 'signal-secs', `${p.green} s`);
      const edit = (d: number): void => {
        const next = clonePlan(plan);
        next.phases[i].green = Math.max(MIN_GREEN, Math.min(MAX_GREEN, p.green + d));
        a.commit(next, this.phase);
      };
      minus.addEventListener('click', () => edit(-1));
      plus.addEventListener('click', () => edit(1));
      const del = el('button', 'signal-step', '✕'); del.title = 'Remove this phase';
      del.disabled = plan.phases.length <= 1;
      del.addEventListener('click', () => {
        const next = clonePlan(plan);
        next.phases.splice(i, 1);
        a.commit(next, Math.min(this.phase, next.phases.length - 1));
      });
      row.append(name, moves, minus, secs, plus, del);
      list.append(row);
    });
    this.root.append(list);
    const add = el('button', 'mitem', '+ Add a phase');
    add.addEventListener('click', () => {
      const next = clonePlan(plan);
      next.phases.push({ green: DEFAULT_GREEN, moves: {} });
      a.commit(next, next.phases.length - 1);
    });
    const adaptive = el('label', 'signal-adaptive');
    const box = el('input'); box.type = 'checkbox'; box.checked = !!plan.adaptive;
    box.addEventListener('change', () => { const next = clonePlan(plan); if (box.checked) next.adaptive = true; else delete next.adaptive; a.commit(next, this.phase); });
    adaptive.append(box, el('span', undefined, 'Adaptive: cut empty phases short, stretch busy ones'));
    const buttons = el('div', 'signal-buttons');
    const reset = el('button', 'mitem', 'Reset to default'); reset.addEventListener('click', () => a.reset());
    const remove = el('button', 'mitem signal-remove', 'Remove signal'); remove.addEventListener('click', () => a.remove());
    buttons.append(reset, remove);
    this.root.append(add, adaptive, buttons);
  }
}
