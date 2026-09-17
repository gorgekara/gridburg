import type { Stats } from '../sim/messages';
import type { RoadMode, Tool } from '../input';
import { COST_AVENUE, COST_LIGHT, COST_ROAD, COST_ROUNDABOUT, COST_ZONE, SERVICES, T_COAL, T_OUTLET, T_PUMP, T_TOWER, T_WIND } from '../constants';
import { icon } from './icons';

export interface HudActions {
  setTool(t: Tool): void;
  setMode(m: RoadMode): void;
  setSpeed(v: number): void;
  setTax(v: number): void;
  newCity(): void;
  demoCity(): void;
  puzzles(): void;
  share(): void;
  togglePollution(): boolean;
}

interface ToolDef { id: Tool; label: string; key?: string; price: string; note?: string; hint: string }
interface Category { id: string; label: string; tools: ToolDef[] }

const money = (n: number): string => `$${n.toLocaleString()}`;
const svc = (k: number): string => money(SERVICES[k].cost);

// Laid out like the Cities: Skylines build menu: pick a category, then a tool from its panel.
const CATEGORIES: Category[] = [
  {
    id: 'roads', label: 'Roads',
    tools: [
      { id: 'road', label: 'Road', key: 'R', price: `${money(COST_ROAD)} / cell`, note: 'Two lanes', hint: 'Click to start, click again to finish. It keeps going from the last point until you join a road, right-click, or press Esc' },
      { id: 'avenue', label: 'Avenue', key: 'V', price: `${money(COST_AVENUE)} / cell`, note: 'Four lanes, faster', hint: 'A wide, fast road that holds far more traffic. Placed the same way as a road' },
      { id: 'upgrade', label: 'Upgrade', key: 'U', price: `${money(COST_AVENUE - COST_ROAD)} / cell`, note: 'Road ⇄ avenue', hint: 'Click an existing road to turn it into an avenue, or an avenue back into a road' },
    ],
  },
  {
    id: 'traffic', label: 'Traffic',
    tools: [
      { id: 'roundabout', label: 'Roundabout', key: 'O', price: money(COST_ROUNDABOUT), note: 'Never stops', hint: 'Click a junction. Traffic circulates one way and nobody has to wait' },
      { id: 'light', label: 'Signal', key: 'T', price: money(COST_LIGHT), note: 'Busy crossings', hint: 'Click a junction to add or remove traffic lights. Best where two busy roads cross' },
      { id: 'oneway', label: 'One-way', key: 'Y', price: 'Free', note: 'Click to cycle', hint: 'Click a road to cycle: one-way, reversed, two-way' },
    ],
  },
  {
    id: 'zones', label: 'Zones',
    tools: [
      { id: 'res', label: 'Residential', key: '1', price: `${money(COST_ZONE)} / cell`, note: 'Homes', hint: 'Drag a rectangle beside a road. Buildings grow up to three cells back from it' },
      { id: 'com', label: 'Commercial', key: '2', price: `${money(COST_ZONE)} / cell`, note: 'Shops and offices', hint: 'Drag a rectangle beside a road. Shops want customers nearby' },
      { id: 'ind', label: 'Industrial', key: '3', price: `${money(COST_ZONE)} / cell`, note: 'Jobs, pollutes', hint: 'Drag a rectangle beside a road. Pollutes the ground around it, so keep it away from homes' },
    ],
  },
  {
    id: 'power', label: 'Electricity',
    tools: [
      { id: 'wind', label: 'Wind turbine', price: svc(T_WIND), note: `${SERVICES[T_WIND].power} MW · clean`, hint: 'Place beside a road. Power travels along connected roads' },
      { id: 'coal', label: 'Coal plant', price: svc(T_COAL), note: `${SERVICES[T_COAL].power.toLocaleString()} MW · polluting`, hint: 'Lots of power and lots of ground pollution. Keep it away from homes and water towers' },
    ],
  },
  {
    id: 'water', label: 'Water',
    tools: [
      { id: 'tower', label: 'Water tower', price: svc(T_TOWER), note: `${SERVICES[T_TOWER].water} water`, hint: 'Works anywhere beside a road, but keep it off polluted ground' },
      { id: 'pump', label: 'River pump', price: svc(T_PUMP), note: `${SERVICES[T_PUMP].water.toLocaleString()} water`, hint: 'Must touch the river. Put it upstream of any sewage outlet (arrows on the water show the flow)' },
      { id: 'outlet', label: 'Sewage outlet', price: svc(T_OUTLET), note: `${SERVICES[T_OUTLET].sewage.toLocaleString()} sewage`, hint: 'Must touch the river. Fouls the water downstream of it' },
    ],
  },
  {
    id: 'bulldoze', label: 'Bulldoze',
    tools: [{ id: 'bulldoze', label: 'Bulldoze', key: 'B', price: 'Free', hint: 'Drag a rectangle to remove roads, zones and buildings' }],
  },
];

const MODES: { id: RoadMode; label: string; hint: string }[] = [
  { id: 'straight', label: 'Straight', hint: 'Two clicks: start and end' },
  { id: 'curve', label: 'Curved', hint: 'Three clicks: start, bend, end' },
  { id: 'smooth', label: 'Smooth', hint: 'Every click continues the road as a flowing curve' },
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
  private cars = el('span', 'sub2');
  private commute = el('span', 'val');
  private util: Record<'power' | 'water' | 'sewage', HTMLElement> = {
    power: el('span', 'mtext'), water: el('span', 'mtext'), sewage: el('span', 'mtext'),
  };
  private utilFill: Record<'power' | 'water' | 'sewage', HTMLElement> = {
    power: el('div', 'mfill'), water: el('div', 'mfill'), sewage: el('div', 'mfill'),
  };
  private budgetIncome = el('span', 'val');
  private polBtn: HTMLButtonElement = el('button');
  private demandBars: HTMLElement[] = [];
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private catBtns = new Map<string, HTMLButtonElement>();
  private modeBtns = new Map<RoadMode, HTMLButtonElement>();
  private panels = new Map<string, HTMLElement>();
  private panel = el('div', 'panel');
  private panelTitle = el('span', 'ptitle');
  private openCat: string | null = null;
  private tool: Tool = 'road';
  private mode: RoadMode = 'straight';
  private speedBtns = new Map<number, HTMLButtonElement>();
  private taxLabel = el('span', 'val');
  private taxInput = el('input');
  private toastEl = el('div', 'toast');
  private hint = el('div', 'hint');
  private alerts = el('div', 'alerts');
  private costEl = el('div', 'cost');
  private status = el('div', 'status');
  private moneyChip = el('button');
  private help: HTMLElement;
  /** In a scenario only the level's own tools are offered. */
  private allowed: Set<Tool> | null = null;

  constructor(root: HTMLElement, actions: HudActions) {
    // ---- top-left: headline numbers as icon chips ------------------------------------------
    const chips = el('div', 'chips');
    const chip = (ic: string, title: string, ...kids: (HTMLElement | SVGElement)[]): HTMLElement => {
      const c = el('div', 'chip');
      c.title = title;
      c.append(icon(ic, 17), ...kids);
      return c;
    };
    const moneyChip = el('button', 'chip money');
    moneyChip.title = 'Budget and taxes';
    moneyChip.append(icon('money', 17), this.money, this.income, icon('caret', 12));
    chips.append(
      moneyChip,
      chip('people', 'Population', this.pop),
      chip('jobs', 'Jobs', this.jobs),
      chip('car', 'Average commute, and cars on the road', this.commute, this.cars),
    );

    // Budget popover: the tax slider lives here instead of on the bar.
    const budget = el('div', 'popover budget');
    const taxRow = el('div', 'prow');
    this.taxInput.type = 'range';
    this.taxInput.min = '0';
    this.taxInput.max = '30';
    this.taxInput.value = '10';
    this.taxInput.addEventListener('input', () => {
      this.taxLabel.textContent = this.taxInput.value + '%';
      actions.setTax(Number(this.taxInput.value));
    });
    this.taxLabel.textContent = '10%';
    taxRow.append(el('span', 'label', 'Tax rate'), this.taxInput, this.taxLabel);
    const incRow = el('div', 'prow');
    incRow.append(el('span', 'label', 'Net income'), this.budgetIncome);
    budget.append(el('div', 'ptitle', 'Budget'), taxRow, incRow, el('div', 'pnote', 'Higher taxes earn more but slow growth. Roads and service buildings cost upkeep.'));

    // ---- top-right: view toggle, share, help, and a small menu ---------------------------------
    const right = el('div', 'topright');
    const iconBtn = (ic: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', 'iconbtn');
      b.title = title;
      b.append(icon(ic, 19));
      b.addEventListener('click', fn);
      return b;
    };
    this.help = this.buildHelp();
    const menu = el('div', 'popover menu');
    const menuItem = (ic: string, label: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', 'mitem');
      b.append(icon(ic, 17), el('span', undefined, label));
      b.addEventListener('click', () => { menu.classList.remove('open'); fn(); });
      return b;
    };
    menu.append(
      menuItem('puzzle', 'Traffic puzzles', actions.puzzles),
      menuItem('plus', 'New city', () => { if (confirm('Start a new city on a new map? Your current city will be lost.')) actions.newCity(); }),
      menuItem('city', 'Load demo city', actions.demoCity),
      menuItem('link', 'Copy share link', actions.share),
    );
    const polBtn = iconBtn('smog', 'Pollution view (P)', () => polBtn.classList.toggle('active', actions.togglePollution()));
    const menuBtn = iconBtn('menu', 'Menu', () => { budget.classList.remove('open'); menu.classList.toggle('open'); });
    right.append(
      polBtn,
      iconBtn('link', 'Copy a link to this city', actions.share),
      iconBtn('help', 'Help (H)', () => this.help.classList.toggle('open')),
      menuBtn,
    );
    moneyChip.addEventListener('click', () => { menu.classList.remove('open'); budget.classList.toggle('open'); });
    window.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!budget.contains(t) && !moneyChip.contains(t)) budget.classList.remove('open');
      if (!menu.contains(t) && !menuBtn.contains(t)) menu.classList.remove('open');
    });

    // ---- bottom-left: demand and utilities ------------------------------------------------------
    const status = el('div', 'status');
    const dem = el('div', 'demand');
    dem.title = 'Demand for residential, commercial and industrial zones';
    for (const [i, name] of ['R', 'C', 'I'].entries()) {
      const wrap = el('div', 'dbar');
      const fill = el('div', `dfill d${i}`);
      wrap.append(fill);
      const col = el('div', 'dcol');
      col.append(wrap, el('span', 'dname', name));
      dem.append(col);
      this.demandBars.push(fill);
    }
    const meters = el('div', 'meters');
    for (const [k, ic, title] of [['power', 'power', 'Electricity: used / available'], ['water', 'water', 'Water: used / available'], ['sewage', 'sewage', 'Sewage: produced / capacity']] as const) {
      const row = el('div', `meter ${k}`);
      row.title = title;
      const bar = el('div', 'mbar');
      bar.append(this.utilFill[k]);
      row.append(icon(ic, 15), bar, this.util[k]);
      meters.append(row);
    }
    status.append(dem, meters);

    // ---- bottom-right: game speed -------------------------------------------------------------------
    const speed = el('div', 'speed');
    for (const [v, label] of [[0, '❚❚'], [1, '▶'], [2, '▶▶'], [3, '▶▶▶']] as [number, string][]) {
      const b = el('button', 'sbtn', label);
      b.title = v === 0 ? 'Pause (Space)' : `Speed ${v}x`;
      b.addEventListener('click', () => actions.setSpeed(v));
      this.speedBtns.set(v, b);
      speed.append(b);
    }

    this.polBtn = polBtn;
    this.status = status;
    this.moneyChip = moneyChip;
    root.append(chips, budget, right, menu, this.alerts, status, speed);

    // Build menu: a panel of tool cards above a row of category buttons.
    const dock = el('div', 'dock');
    const head = el('div', 'phead');
    head.append(this.panelTitle, this.hint);
    this.panel.append(head);
    for (const c of CATEGORIES) {
      if (c.id === 'bulldoze') continue;
      const body = el('div', 'pbody');
      if (c.id === 'roads') {
        const seg = el('div', 'modes');
        seg.append(el('span', 'mlabel', 'Draw'));
        for (const m of MODES) {
          const b = el('button', 'mode');
          b.append(icon(m.id, 20), el('span', undefined, m.label));
          b.title = `${m.hint} (C cycles)`;
          b.addEventListener('click', () => actions.setMode(m.id));
          this.modeBtns.set(m.id, b);
          seg.append(b);
        }
        body.append(seg);
      }
      for (const t of c.tools) {
        const b = el('button', `card ${t.id}`);
        const art = el('div', 'art');
        art.append(icon(t.id, 30));
        b.append(art, el('span', 'cname', t.label), el('span', 'cprice', t.price));
        if (t.note) b.append(el('span', 'cnote', t.note));
        if (t.key) b.append(el('span', 'ckey', t.key));
        b.title = t.hint;
        b.addEventListener('click', () => actions.setTool(t.id));
        this.toolBtns.set(t.id, b);
        body.append(b);
      }
      this.panels.set(c.id, body);
      this.panel.append(body);
    }
    const cats = el('div', 'cats');
    for (const c of CATEGORIES) {
      const b = el('button', `cat ${c.id}`);
      b.append(icon(c.id, 24), el('span', undefined, c.label));
      b.addEventListener('click', () => {
        if (c.id === 'bulldoze') { actions.setTool(this.tool === 'bulldoze' ? 'none' : 'bulldoze'); return; }
        // Clicking the open category closes it and puts the tool away, like CS.
        if (this.openCat === c.id) { actions.setTool('none'); return; }
        const current = c.tools.find((t) => t.id === this.tool);
        actions.setTool(current ? current.id : c.tools[0].id);
      });
      this.catBtns.set(c.id, b);
      cats.append(b);
    }
    dock.append(this.panel, cats);
    root.append(dock, this.toastEl, this.costEl, this.help);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'h' || e.key === 'H') this.help.classList.toggle('open');
      if (e.key === 'p' || e.key === 'P') this.polBtn.classList.toggle('active', actions.togglePollution());
      if (e.key === 'Escape') this.help.classList.remove('open');
    });
    this.setTool('road');
    this.setMode('straight');
    this.setSpeed(1);
  }

  private buildHelp(): HTMLElement {
    const h = el('div', 'help');
    h.innerHTML = `
      <div class="card">
        <h2>Gridburg</h2>
        <p>A small city builder about traffic. Everyone arrives by the <b>highway</b> at the edge of the map,
        so start by drawing a road from the end of it, then zone next to your roads.</p>
        <ul>
          <li><b>Roads</b> — pick Road or Avenue, then <b>click</b> to place points. <b>Straight</b> is two clicks,
          <b>Curved</b> is start, bend, end, and <b>Smooth</b> keeps flowing from click to click. <b>C</b> cycles the modes;
          right-click or <b>Esc</b> stops. Crossings become junctions</li>
          <li><b>Traffic</b> — cars queue for real. Busy junctions jam; fix them with <b>avenues</b>, <b>signals</b>,
          <b>one-way</b> streets or <b>roundabouts</b>. Roads turn red where traffic is slow</li>
          <li><b>Utilities</b> run along roads. Buildings need <b>power</b>, <b>water</b> and <b>sewage</b> to grow past
          small. Pumps and outlets sit on the river; keep the pump <b>upstream</b> (arrows show the flow)</li>
          <li><b>Pollution</b> from industry and coal spreads through the ground and drives residents away. Press <b>P</b> to see it</li>
        </ul>
        <p><b>Traffic puzzles</b> — five ready-made cities with one thing wrong with each. The buildings are
        fixed and the budget never earns, so the only thing to change is the traffic. Open them from the menu.</p>
        <p><b>Left drag</b> build · <b>Right drag</b> rotate · <b>Q / E</b> rotate · <b>WASD</b> pan · <b>Wheel</b> zoom ·
        <b>Space</b> pause · <b>Esc</b> cancel</p>
        <p class="dim">Your city saves in this browser. Share copies a link containing the whole city. Press H or click to close.</p>
      </div>`;
    h.addEventListener('click', () => h.classList.remove('open'));
    return h;
  }

  /**
   * Offer only these tools, or everything when given null. Categories left with nothing in them
   * disappear, so a level that is only about roads shows only roads.
   */
  restrict(tools: Tool[] | null): void {
    this.allowed = tools ? new Set(tools) : null;
    for (const [id, b] of this.toolBtns) b.classList.toggle('gone', !!this.allowed && !this.allowed.has(id));
    for (const c of CATEGORIES) {
      const any = c.tools.some((t) => !this.allowed || this.allowed.has(t.id));
      this.catBtns.get(c.id)?.classList.toggle('gone', !any);
    }
    if (this.allowed && !this.allowed.has(this.tool)) this.setTool('none');
  }

  /** Scenario cities have fixed buildings and no income, so hide what does not apply. */
  setPuzzleMode(on: boolean): void {
    this.status.classList.toggle('gone', on);
    this.income.classList.toggle('gone', on);
    // The goal panel says what this city needs, so the sandbox advice would only argue with it.
    this.alerts.classList.toggle('gone', on);
    this.moneyChip.classList.toggle('flat', on);
    this.moneyChip.disabled = on; // there are no taxes to set in a scenario
  }

  setTool(t: Tool): void {
    this.tool = t;
    for (const [id, b] of this.toolBtns) b.classList.toggle('active', id === t);
    const cat = CATEGORIES.find((c) => c.tools.some((x) => x.id === t)) ?? null;
    this.openCat = cat && cat.id !== 'bulldoze' ? cat.id : null;
    for (const [id, b] of this.catBtns) b.classList.toggle('active', cat !== null && id === cat.id);
    for (const [id, body] of this.panels) body.classList.toggle('open', id === this.openCat);
    this.panel.classList.toggle('open', this.openCat !== null);
    this.panelTitle.textContent = cat ? cat.label : '';
    this.refreshHint();
  }

  setMode(m: RoadMode): void {
    this.mode = m;
    for (const [id, b] of this.modeBtns) b.classList.toggle('active', id === m);
    this.refreshHint();
  }

  private refreshHint(): void {
    const def = CATEGORIES.flatMap((c) => c.tools).find((x) => x.id === this.tool);
    if (!def) { this.hint.textContent = ''; return; }
    if (this.tool === 'road' || this.tool === 'avenue') {
      const m = MODES.find((x) => x.id === this.mode)!;
      this.hint.textContent = `${m.label}: ${m.hint.toLowerCase()}. Keeps going until you join a road, right-click or press Esc`;
    } else {
      this.hint.textContent = def.hint;
    }
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
    this.money.textContent = '$' + fmt(s.money);
    this.money.classList.toggle('neg', s.money < 0);
    const inc = `${s.income >= 0 ? '+' : ''}${s.income.toFixed(1)}/s`;
    this.income.textContent = inc;
    this.income.classList.toggle('neg', s.income < 0);
    this.budgetIncome.textContent = inc;
    this.budgetIncome.classList.toggle('neg', s.income < 0);
    this.pop.textContent = fmt(s.pop);
    this.jobs.textContent = fmt(s.jobs);
    this.commute.textContent = s.commute > 0 ? s.commute.toFixed(0) + 's' : '–';
    this.commute.classList.toggle('neg', s.commute > 40);
    this.cars.textContent = `${s.cars} cars`;
    for (const k of ['power', 'water', 'sewage'] as const) {
      const [used, cap] = s[k];
      this.util[k].textContent = `${fmt(used)} / ${fmt(cap)}`;
      const short = used > cap;
      this.util[k].classList.toggle('neg', short);
      this.utilFill[k].style.width = `${cap > 0 ? Math.min(100, (used / cap) * 100) : used > 0 ? 100 : 0}%`;
      this.utilFill[k].classList.toggle('short', short);
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
