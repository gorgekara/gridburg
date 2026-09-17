import type { Stats } from '../sim/messages';
import type { RoadMode, Tool } from '../input';

export interface HudActions {
  setTool(t: Tool): void;
  toggleMode(): void;
  setSpeed(v: number): void;
  setTax(v: number): void;
  newCity(): void;
  demoCity(): void;
  share(): void;
  togglePollution(): boolean;
}

interface ToolDef { id: Tool; label: string; key?: string; hint: string }
const GROUPS: { name: string; tools: ToolDef[] }[] = [
  {
    name: 'Roads',
    tools: [
      { id: 'road', label: 'Road', key: 'R', hint: 'Drag to build a road. Click an existing road to convert it. C switches straight / curved' },
      { id: 'avenue', label: 'Avenue', key: 'V', hint: 'Wide and fast, holds far more traffic. Click an existing road to upgrade it' },
      { id: 'roundabout', label: 'Roundabout', key: 'O', hint: 'Click a junction. Traffic flows through without stopping' },
      { id: 'light', label: 'Signal', key: 'T', hint: 'Click a junction to add or remove traffic lights. Best where two busy roads cross' },
      { id: 'oneway', label: 'One-way', key: 'Y', hint: 'Click a road to cycle: one-way, reversed, two-way' },
    ],
  },
  {
    name: 'Zones',
    tools: [
      { id: 'res', label: 'Homes', key: '1', hint: 'Residential. Drag a rectangle next to a road' },
      { id: 'com', label: 'Shops', key: '2', hint: 'Commercial. Drag a rectangle next to a road' },
      { id: 'ind', label: 'Industry', key: '3', hint: 'Industrial. Pollutes the ground around it, so keep it away from homes' },
    ],
  },
  {
    name: 'Utilities',
    tools: [
      { id: 'wind', label: 'Wind', hint: 'Wind turbine: 250 power, clean' },
      { id: 'coal', label: 'Coal', hint: 'Coal plant: 1,500 power, heavy pollution' },
      { id: 'tower', label: 'Water tower', hint: 'Water tower: 350 water. Keep it off polluted ground' },
      { id: 'pump', label: 'Pump', hint: 'River pump: 1,500 water. Must touch the river, upstream of any sewage outlet' },
      { id: 'outlet', label: 'Sewage', hint: 'Sewage outlet: 1,500 sewage. Must touch the river; pollutes it downstream (arrows show the flow)' },
    ],
  },
  { name: '', tools: [{ id: 'bulldoze', label: 'Bulldoze', key: 'B', hint: 'Drag a rectangle to remove roads, zones and buildings' }] },
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
  private income = el('span', 'sub');
  private pop = el('span', 'val');
  private jobs = el('span', 'val');
  private cars = el('span', 'val');
  private commute = el('span', 'val');
  private util: Record<'power' | 'water' | 'sewage', HTMLElement> = {
    power: el('span', 'val'), water: el('span', 'val'), sewage: el('span', 'val'),
  };
  private demandBars: HTMLElement[] = [];
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private speedBtns = new Map<number, HTMLButtonElement>();
  private modeBtn = el('button', 'btn tool mode');
  private taxLabel = el('span', 'val');
  private taxInput = el('input');
  private toastEl = el('div', 'toast');
  private hint = el('div', 'hint');
  private alerts = el('div', 'alerts');
  private costEl = el('div', 'cost');
  private help: HTMLElement;

  constructor(root: HTMLElement, actions: HudActions) {
    const top = el('div', 'bar top');
    const moneyStat = this.stat('Money', this.money, '$');
    moneyStat.append(this.income);
    top.append(
      moneyStat,
      this.stat('Pop', this.pop),
      this.stat('Jobs', this.jobs),
      this.stat('Cars', this.cars),
      this.stat('Commute', this.commute),
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
    top.append(this.stat('Power', this.util.power), this.stat('Water', this.util.water), this.stat('Sewage', this.util.sewage));

    const taxWrap = el('div', 'stat');
    taxWrap.append(el('span', 'label', 'Tax'));
    this.taxInput.type = 'range';
    this.taxInput.min = '0';
    this.taxInput.max = '30';
    this.taxInput.value = '10';
    this.taxInput.addEventListener('input', () => {
      this.taxLabel.textContent = this.taxInput.value + '%';
      actions.setTax(Number(this.taxInput.value));
    });
    this.taxLabel.textContent = '10%';
    taxWrap.append(this.taxInput, this.taxLabel);
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
    const polBtn = mk('Pollution', () => polBtn.classList.toggle('active', actions.togglePollution()), 'Highlight ground pollution (P)');
    act.append(
      polBtn,
      mk('New', () => { if (confirm('Start a new city on a new map? Your current city will be lost.')) actions.newCity(); }),
      mk('Demo', actions.demoCity, 'Load the demo city'),
      mk('Share', actions.share, 'Copy a link to this city'),
      mk('?', () => this.help.classList.toggle('open'), 'Help (H)'),
    );
    top.append(act);
    root.append(top, this.alerts);

    const bottom = el('div', 'bar bottom');
    const rowA = el('div', 'trow');
    const rowB = el('div', 'trow');
    bottom.append(this.hint, rowA, rowB);
    for (const g of GROUPS) {
      const grp = el('div', 'group');
      if (g.name) grp.append(el('span', 'gname', g.name));
      const row = el('div', 'grow');
      for (const t of g.tools) {
        const b = el('button', `btn tool ${t.id}`);
        if (t.key) b.append(el('span', 'key', t.key));
        b.append(el('span', undefined, t.label));
        b.title = t.hint;
        b.addEventListener('click', () => actions.setTool(t.id));
        this.toolBtns.set(t.id, b);
        row.append(b);
        if (t.id === 'avenue') {
          this.modeBtn.addEventListener('click', actions.toggleMode);
          this.modeBtn.title = 'Switch between straight and freehand curved roads (C)';
          row.append(this.modeBtn);
        }
      }
      grp.append(row);
      (g.name === 'Roads' || g.name === '' ? rowA : rowB).append(grp);
    }
    root.append(bottom, this.toastEl, this.costEl, this.help);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'h' || e.key === 'H') this.help.classList.toggle('open');
      if (e.key === 'p' || e.key === 'P') polBtn.classList.toggle('active', actions.togglePollution());
      if (e.key === 'Escape') this.help.classList.remove('open');
    });
    this.setTool('road');
    this.setMode('straight');
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
        <p>A small city builder about traffic. Everyone arrives by the <b>highway</b> at the edge of the map,
        so start by drawing a road from the end of it, then zone next to your roads.</p>
        <ul>
          <li><b>Roads</b> — drag to build. <b>C</b> switches between straight roads at any angle and freehand
          <b>curved</b> roads that follow your drag. Crossings become junctions. Click a road with the Avenue tool to upgrade it</li>
          <li><b>Traffic</b> — cars queue for real. Busy junctions jam; fix them with <b>avenues</b>, <b>signals</b>,
          <b>one-way</b> streets or <b>roundabouts</b>. Roads turn red where traffic is slow</li>
          <li><b>Utilities</b> run along roads. Buildings need <b>power</b>, <b>water</b> and <b>sewage</b> to grow past
          small. Pumps and outlets sit on the river; keep the pump <b>upstream</b> (arrows show the flow)</li>
          <li><b>Pollution</b> from industry and coal spreads through the ground and drives residents away. Press <b>P</b> to see it</li>
        </ul>
        <p><b>Left drag</b> build · <b>Right drag</b> rotate · <b>Q / E</b> rotate · <b>WASD</b> pan · <b>Wheel</b> zoom ·
        <b>Space</b> pause · <b>Esc</b> cancel</p>
        <p class="dim">Your city saves in this browser. Share copies a link containing the whole city. Press H or click to close.</p>
      </div>`;
    h.addEventListener('click', () => h.classList.remove('open'));
    return h;
  }

  setTool(t: Tool): void {
    for (const [id, b] of this.toolBtns) b.classList.toggle('active', id === t);
    for (const g of GROUPS) {
      const info = g.tools.find((x) => x.id === t);
      if (info) this.hint.textContent = info.hint;
    }
  }

  setMode(m: RoadMode): void {
    this.modeBtn.replaceChildren(el('span', 'key', 'C'), el('span', undefined, m === 'curve' ? 'Curved' : 'Straight'));
    this.modeBtn.classList.toggle('curve', m === 'curve');
  }

  setSpeed(v: number): void {
    for (const [id, b] of this.speedBtns) b.classList.toggle('active', id === v);
  }

  setTax(v: number): void {
    this.taxInput.value = String(v);
    this.taxLabel.textContent = v + '%';
  }

  setCost(text: string | null, x: number, y: number, ok: boolean): void {
    if (!text) { this.costEl.classList.remove('show'); return; }
    this.costEl.textContent = text;
    this.costEl.classList.add('show');
    this.costEl.classList.toggle('bad', !ok);
    this.costEl.style.left = `${x + 16}px`;
    this.costEl.style.top = `${y + 12}px`;
  }

  update(s: Stats): void {
    this.money.textContent = fmt(s.money);
    this.money.classList.toggle('neg', s.money < 0);
    this.income.textContent = `${s.income >= 0 ? '+' : ''}${s.income.toFixed(1)}/s`;
    this.income.classList.toggle('neg', s.income < 0);
    this.pop.textContent = fmt(s.pop);
    this.jobs.textContent = fmt(s.jobs);
    this.cars.textContent = String(s.cars);
    this.commute.textContent = s.commute > 0 ? s.commute.toFixed(0) + 's' : '–';
    this.commute.classList.toggle('neg', s.commute > 40);
    for (const k of ['power', 'water', 'sewage'] as const) {
      const [used, cap] = s[k];
      this.util[k].textContent = `${fmt(used)}/${fmt(cap)}`;
      this.util[k].classList.toggle('neg', used > cap);
    }
    for (let i = 0; i < 3; i++) {
      const d = s.demand[i];
      const b = this.demandBars[i];
      b.style.height = `${Math.round(Math.abs(d) * 100)}%`;
      b.classList.toggle('negd', d < 0);
    }

    const a: string[] = [];
    if (s.buildings === 0 && s.roadLength < 12) a.push('Draw a road from the end of the highway, then zone beside it');
    if (s.money < 0) a.push('Out of money: nothing new will be built');
    if (s.buildings > 0) {
      if (s.power[1] === 0) a.push('No power: build a wind turbine or a coal plant next to a road');
      else if (s.power[0] > s.power[1]) a.push('Power shortage');
      if (s.water[1] === 0) a.push('No water: build a water tower, or a pump on the river');
      else if (s.water[0] > s.water[1]) a.push('Water shortage');
      if (s.sewage[1] === 0) a.push('No sewage: build an outlet on the river, downstream of any pump');
      else if (s.sewage[0] > s.sewage[1]) a.push('Sewage is backing up');
    }
    if (s.dirtyWater) a.push('Dirty drinking water: move pumps upstream of outlets and towers off polluted ground');
    if (s.resPollution > 2) a.push('Pollution is reaching homes');
    if (s.gaveUp > 0 || s.commute > 45) a.push('Gridlock: try avenues, signals, one-ways or a roundabout');
    this.alerts.replaceChildren(...a.slice(0, 4).map((t) => el('div', 'alert', t)));
  }

  private toastTimer = 0;
  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  showHelp(): void {
    this.help.classList.add('open');
  }
}
