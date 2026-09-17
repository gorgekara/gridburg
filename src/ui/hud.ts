import type { Stats } from '../sim/messages';
import type { Tool } from '../input';

export interface HudActions {
  setTool(t: Tool): void;
  setSpeed(v: number): void;
  setTax(v: number): void;
  newCity(): void;
  demoCity(): void;
  share(): void;
}

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'road', label: 'Road', key: '1', hint: 'Drag to draw a road: straight, L-shaped, or diagonal' },
  { id: 'avenue', label: 'Avenue', key: '2', hint: 'Wide, fast road that holds more traffic. Costs more' },
  { id: 'res', label: 'Residential', key: '3', hint: 'Drag a rectangle; homes grow next to roads' },
  { id: 'com', label: 'Commercial', key: '4', hint: 'Drag a rectangle; shops and offices' },
  { id: 'ind', label: 'Industrial', key: '5', hint: 'Drag a rectangle; factories' },
  { id: 'bulldoze', label: 'Bulldoze', key: '6', hint: 'Drag a rectangle to clear' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toLocaleString();
}

export class Hud {
  private money = el('span', 'val');
  private pop = el('span', 'val');
  private jobs = el('span', 'val');
  private cars = el('span', 'val');
  private commute = el('span', 'val');
  private demandBars: HTMLElement[] = [];
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private speedBtns = new Map<number, HTMLButtonElement>();
  private taxLabel = el('span', 'val');
  private toastEl = el('div', 'toast');
  private hint = el('div', 'hint');
  private help: HTMLElement;

  constructor(root: HTMLElement, actions: HudActions) {
    // Top bar
    const top = el('div', 'bar top');
    top.append(
      this.stat('Money', this.money, '$'),
      this.stat('Population', this.pop),
      this.stat('Jobs', this.jobs),
      this.stat('Cars', this.cars),
      this.stat('Avg commute', this.commute),
    );
    const dem = el('div', 'demand');
    dem.append(el('span', 'label', 'Demand'));
    for (const [i, name] of ['R', 'C', 'I'].entries()) {
      const wrap = el('div', 'dbar');
      const fill = el('div', `dfill d${i}`);
      wrap.append(fill);
      const col = el('div', 'dcol');
      col.append(wrap, el('span', 'dname', name));
      dem.append(col);
      this.demandBars.push(fill);
    }
    top.append(dem);

    const taxWrap = el('div', 'stat');
    taxWrap.append(el('span', 'label', 'Tax'));
    const tax = el('input');
    tax.type = 'range';
    tax.min = '0';
    tax.max = '30';
    tax.value = '10';
    tax.addEventListener('input', () => {
      this.taxLabel.textContent = tax.value + '%';
      actions.setTax(Number(tax.value));
    });
    this.taxLabel.textContent = '10%';
    taxWrap.append(tax, this.taxLabel);
    top.append(taxWrap);

    const speed = el('div', 'speed');
    for (const [v, label] of [[0, '❚❚'], [1, '▶'], [2, '▶▶'], [3, '▶▶▶']] as [number, string][]) {
      const b = el('button', 'btn', label);
      b.title = v === 0 ? 'Pause (Space)' : `Speed ${v}x`;
      b.addEventListener('click', () => actions.setSpeed(v));
      this.speedBtns.set(v, b);
      speed.append(b);
    }
    top.append(speed);

    const act = el('div', 'actions');
    const mk = (label: string, fn: () => void, title = ''): HTMLButtonElement => {
      const b = el('button', 'btn', label);
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    this.help = this.buildHelp();
    act.append(
      mk('New', () => { if (confirm('Start a new empty city? Your current city will be lost.')) actions.newCity(); }),
      mk('Demo', actions.demoCity, 'Load the demo city'),
      mk('Share', actions.share, 'Copy a link to this city'),
      mk('?', () => this.help.classList.toggle('open'), 'Help (H)'),
    );
    top.append(act);
    root.append(top);

    // Bottom tool bar
    const bottom = el('div', 'bar bottom');
    for (const t of TOOLS) {
      const b = el('button', `btn tool ${t.id}`);
      b.append(el('span', 'key', t.key), el('span', undefined, t.label));
      b.title = t.hint;
      b.addEventListener('click', () => actions.setTool(t.id));
      this.toolBtns.set(t.id, b);
      bottom.append(b);
    }
    root.append(bottom, this.hint, this.toastEl, this.help);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'h' || e.key === 'H') this.help.classList.toggle('open');
      if (e.key === 'Escape') this.help.classList.remove('open');
    });
    this.setTool('road');
    this.setSpeed(1);
  }

  private stat(label: string, val: HTMLElement, prefix = ''): HTMLElement {
    const s = el('div', 'stat');
    s.append(el('span', 'label', label));
    if (prefix) s.append(el('span', 'val', prefix));
    s.append(val);
    return s;
  }

  private buildHelp(): HTMLElement {
    const h = el('div', 'help');
    h.innerHTML = `
      <div class="card">
        <h2>Gridburg</h2>
        <p>A tiny city builder about traffic. Draw roads, paint zones, and watch the city grow.
        Cars commute from homes to jobs on the roads you laid. Roads turn red where they jam.
        The score that matters is <b>average commute</b>.</p>
        <ul>
          <li><b>Left drag</b> — use the selected tool. Roads follow the drag: straight, L-shaped, or diagonal. Zones fill a rectangle</li>
          <li><b>Avenues</b> are wider and faster and carry more cars; use them for the busy routes</li>
          <li><b>Right drag</b> — rotate · <b>Middle drag</b> — pan · <b>Wheel</b> — zoom</li>
          <li><b>WASD / arrows</b> — pan · <b>1–6</b> — tools · <b>Space</b> — pause · <b>Esc</b> — cancel</li>
        </ul>
        <p>Start by drawing a road, then zone next to it. Buildings only grow on zoned tiles that touch a road. Demand depends on the balance of homes
        and jobs, the tax rate, and how long commutes take. Your city is saved in this browser
        automatically; <b>Share</b> copies a link that contains the whole city.</p>
        <p class="dim">Made with three.js. Simulation runs in a Web Worker. Press H or click anywhere to close.</p>
      </div>`;
    h.addEventListener('click', () => h.classList.remove('open'));
    return h;
  }

  setTool(t: Tool): void {
    for (const [id, b] of this.toolBtns) b.classList.toggle('active', id === t);
    const info = TOOLS.find((x) => x.id === t);
    this.hint.textContent = info ? info.hint : '';
  }

  setSpeed(v: number): void {
    for (const [id, b] of this.speedBtns) b.classList.toggle('active', id === v);
  }

  update(s: Stats): void {
    this.money.textContent = fmt(s.money);
    this.money.classList.toggle('neg', s.money < 0);
    this.pop.textContent = fmt(s.pop);
    this.jobs.textContent = fmt(s.jobs);
    this.cars.textContent = String(s.cars);
    this.commute.textContent = s.commute > 0 ? s.commute.toFixed(1) + 's' : '–';
    this.commute.classList.toggle('neg', s.commute > 30);
    for (let i = 0; i < 3; i++) {
      const d = s.demand[i];
      const b = this.demandBars[i];
      b.style.height = `${Math.round(Math.abs(d) * 100)}%`;
      b.classList.toggle('negd', d < 0);
    }
  }

  private toastTimer = 0;
  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2200);
  }

  showHelp(): void {
    this.help.classList.add('open');
  }
}
