import { T_BUS, T_STATION, T_SUBWAY, T_AIRPORT, T_TREATMENT, OFFICE_UNLOCK, ENTRY_UNLOCK, COST_ENTRY } from '../constants';
import { FUNDING_KEYS, FUNDING_LABELS, fundingOutput, LOAN_AMOUNT, LOAN_TOTAL, LOAN_PAYMENT } from '../management';
import { POLICIES, POLICY_IDS } from '../policies';
import type { PolicyId } from '../policies';
import type { FundingKey } from '../management';
import { MILESTONES } from '../progression';
import { SERVICE_TOOL } from '../input';
import { CIVIC_LABELS } from '../constants';
import type { CivicNeed } from '../constants';
import type { Stats, TileReport } from '../sim/messages';
import type { RoadMode, Tool } from '../input';
import { COST_AVENUE, COST_LIGHT, COST_ROAD, COST_ROUNDABOUT, COST_ZONE, SERVICES, T_COAL, T_OUTLET, T_PUMP, T_TOWER, T_WIND, T_SOLAR } from '../constants';
import { icon } from './icons';

export interface HudActions {
  setTool(t: Tool): void;
  setMode(m: RoadMode): void;
  setSpeed(v: number): void;
  setTax(v: number): void;
  setFunding(key: FundingKey, value: number): void;
  loan(action: 'take' | 'repay'): void;
  closeInspection(): void;
  openMenu(): void;
  setPolicy(id: PolicyId, on: boolean): void;
  newCity(): void;
  demoCity(): void;
  share(): void;
  togglePollution(): boolean;
  toggleInfiniteMoney(): boolean;
  toggleTraffic(): boolean;
}

interface ToolDef { id: Tool; label: string; key?: string; price: string; note?: string; hint: string }
interface Category { id: string; label: string; tools: ToolDef[] }

const money = (n: number): string => `$${n.toLocaleString()}`;
const svc = (k: number): string => money(SERVICES[k].cost);

// Laid out like the Cities: Skylines build menu: pick a category, then a tool from its panel.
const CATEGORIES: Category[] = [
  { id: 'inspect', label: 'Inspect', tools: [{ id: 'inspect', label: 'Inspect building', key: 'I', price: 'Free', hint: 'Click a building to see local services, upkeep and the exact reasons it cannot grow' }] },
  {
    id: 'roads', label: 'Roads',
    tools: [
      { id: 'road', label: 'Road', key: 'R', price: `${money(COST_ROAD)} / cell`, note: 'Two lanes', hint: 'Click to start, click again to finish. It keeps going from the last point until you join a road, right-click, or press Esc' },
      { id: 'avenue', label: 'Avenue', key: 'V', price: `${money(COST_AVENUE)} / cell`, note: 'Four lanes, faster', hint: 'A wide, fast road that holds far more traffic. Placed the same way as a road' },
      { id: 'bridge', label: 'Bridge', price: '$75 / cell', note: 'Over rivers & roads', hint: 'Draw a span at least 14 cells long with dry approaches. Ramps rise automatically; crossing roads stay separate. Upgrade can widen the deck' },
      { id: 'tunnel', label: 'Tunnel', price: '$100 / cell', note: 'Underground route', hint: 'Draw at least 14 cells between two clear, dry portals. Traffic travels underground; cyan arrows reveal the route while road tools are selected' },
      { id: 'entry', label: 'City entrance', price: money(COST_ENTRY), note: 'New highway access', hint: 'Choose a clear map edge. Adds a seven-cell avenue connecting to the outside world. Unlocks at Small town' },
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
      { id: 'com', label: 'Commercial', key: '2', price: `${money(COST_ZONE)} / cell`, note: 'Shops and commerce', hint: 'Drag a rectangle beside a road. Shops want customers nearby' },
      { id: 'office', label: 'Offices', price: `${money(COST_ZONE)} / cell`, note: 'Clean jobs · needs education', hint: 'Clean employment with no industrial pollution. Unlocks at 900 residents; upgrades need 25% then 50% education coverage' },
      { id: 'ind', label: 'Industrial', key: '3', price: `${money(COST_ZONE)} / cell`, note: 'Jobs, pollutes', hint: 'Drag a rectangle beside a road. Pollutes the ground around it, so keep it away from homes' },
    ],
  },
  {
    id: 'power', label: 'Electricity',
    tools: [
      { id: 'wind', label: 'Wind turbine', price: svc(T_WIND), note: `${SERVICES[T_WIND].power} MW · clean`, hint: 'Place beside a road. Power travels along connected roads' },
      { id: 'solar', label: 'Solar farm', price: svc(T_SOLAR), note: '1,800 MW · clean', hint: 'Clean, high-capacity electricity with low running costs. Unlocks at Thriving town' },
      { id: 'coal', label: 'Coal plant', price: svc(T_COAL), note: `${SERVICES[T_COAL].power.toLocaleString()} MW · polluting`, hint: 'Lots of power and lots of ground pollution. Keep it away from homes and water towers' },
    ],
  },
  {
    id: 'water', label: 'Water',
    tools: [
      { id: 'tower', label: 'Water tower', price: svc(T_TOWER), note: `${SERVICES[T_TOWER].water} water`, hint: 'Works anywhere beside a road, but keep it off polluted ground' },
      { id: 'pump', label: 'River pump', price: svc(T_PUMP), note: `${SERVICES[T_PUMP].water.toLocaleString()} water`, hint: 'Must touch the river. Put it upstream of any sewage outlet (arrows on the water show the flow)' },
      { id: 'treatment', label: 'Sewage treatment', price: svc(T_TREATMENT), note: '2,200 sewage · 95% filtered', hint: 'Build on the river bank. Electricity powers filtration, reducing pollution from treated sewage by 95%' },
      { id: 'outlet', label: 'Sewage outlet', price: svc(T_OUTLET), note: `${SERVICES[T_OUTLET].sewage.toLocaleString()} sewage`, hint: 'Must touch the river. Fouls the water downstream of it' },
    ],
  },
  {
    id: 'services', label: 'Services',
    tools: (['park', 'clinic', 'school', 'fire', 'police', 'recycling', 'university'] as Tool[]).map(id => {
      const spec = SERVICES[SERVICE_TOOL[id]!];
      return { id, label: spec.name, price: money(spec.cost), note: `Base $${spec.upkeep}/s · ${spec.radius} cell radius`,
        hint: `${spec.name}: serves ${spec.capacity?.toLocaleString()} residents within ${spec.radius} cells. Both building and homes need highway-connected roads. Unlocks at ${MILESTONES[spec.unlock ?? 0].name}` };
    }),
  },
  {
    id: 'transport', label: 'Transport', tools: [
      { id: 'bus', label: 'Bus stop', price: svc(T_BUS), note: '9-cell catchment · $0.45/s', hint: 'Place two stops near homes and jobs. Automatic return routes follow roads; congestion reduces capacity. Needs utilities' },
      { id: 'station', label: 'Railway station', price: svc(T_STATION), note: '3 × 2 cells · $3/s', hint: 'Two stations connect automatically by elevated tracks along road corridors. 18-cell catchment, 120 passenger capacity per connection' },
      { id: 'subway', label: 'Metro station', price: svc(T_SUBWAY), note: '1 cell · $2.5/s', hint: 'Metro stations link to each other automatically through underground tunnels, so trains skip road traffic. 14-cell catchment, 100 passenger capacity per connection. Needs utilities' },
      { id: 'airport', label: 'Regional airport', price: svc(T_AIRPORT), note: '8 × 3 cells · $7/s', hint: 'Clear a runway-sized site beside a road. Flights replace some incoming car trips within 24 cells; needs utilities' },
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
  private financeValues = new Map<string, HTMLElement>();
  private fundingInputs = new Map<FundingKey, HTMLInputElement>();
  private fundingValues = new Map<FundingKey, HTMLElement>();
  private debtLabel = el('div', 'pnote');
  private borrow = el('button', 'finance-action', 'Borrow $6,000');
  private repay = el('button', 'finance-action', 'Repay balance');
  private inspector = el('section', 'inspector');
  private inspectorBody = el('div');
  private cityTitle = el('span', 'city-title');
  private cityNext = el('span', 'city-next');
  private cityFill = el('div', 'city-fill');
  private happiness = el('span', 'happiness');
  private civicMeters = new Map<CivicNeed, HTMLElement>();
  private milestoneRows: HTMLElement[] = [];
  private previousLevel: number | null = null;
  private previousTick = 0;
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
  private policyToggles = new Map<PolicyId, HTMLInputElement>();
  private policyRows = new Map<PolicyId, HTMLElement>();
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
  private help: HTMLElement;
  private about = el('div', 'help about');
  private clock = el('div', 'city-clock');
  /** The city clock, written by the render loop. */
  setClock(label: string): void {
    if (this.clock.textContent !== label) this.clock.textContent = label;
  }

  /** Reflects the infinite money cheat in the menu. */
  setCheatLabel: (on: boolean) => void = () => {};
  private welcome = el('section', 'welcome');
  private transportStats = el('p', 'pnote transport-stats');
  private incidentStats = el('p', 'pnote');
  private treatmentStats = el('p', 'pnote');
  private tutorialPage = 0;
  private tutorialActions!: HudActions;
  private tutorialReturnSpeed = 1;
  private currentSpeed = 1;

  constructor(root: HTMLElement, actions: HudActions) {
    this.tutorialActions = actions;
    this.welcome.setAttribute('role', 'dialog');
    this.welcome.setAttribute('aria-modal', 'true');
    this.welcome.setAttribute('aria-label', 'Welcome to Gridburg');
    root.append(this.welcome);
    window.addEventListener('keydown', e => {
      if (!this.welcome.classList.contains('open')) return;
      if (e.key === 'Tab') {
        const buttons = [...this.welcome.querySelectorAll('button')];
        const first = buttons[0], last = buttons.at(-1)!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      e.stopImmediatePropagation();
    }, true);
    this.inspector.setAttribute('aria-label', 'Building inspector');
    const dismiss = el('button', 'overview-close', 'Close ×');
    dismiss.addEventListener('click', () => actions.closeInspection());
    this.inspector.append(dismiss, this.inspectorBody);
    root.append(this.inspector);
    const city = el('button', 'city-progress');
    city.title = 'View milestones, unlocks and neighborhood services';
    const cityHeading = el('div', 'city-heading');
    cityHeading.append(icon('city', 20), this.cityTitle, this.happiness);
    const progress = el('div', 'city-track');
    progress.append(this.cityFill);
    city.append(cityHeading, progress, this.cityNext);
    const overview = el('section', 'city-overview');
    overview.setAttribute('aria-label', 'City progress and services');
    const close = el('button', 'overview-close', 'Close ×');
    close.addEventListener('click', () => overview.classList.remove('open'));
    overview.append(close, el('h2', undefined, 'Your city, growing up'), el('p', 'pnote', 'Reach population milestones to earn grants and unlock buildings. Earned levels are permanent.'));
    const serviceGrid = el('div', 'civic-grid');
    for (const [key, label] of Object.entries(CIVIC_LABELS)) {
      const meter = el('div', 'civic-stat');
      const value = el('strong', undefined, '0%');
      meter.append(el('span', undefined, label), value);
      serviceGrid.append(meter);
      this.civicMeters.set(key as CivicNeed, value);
    }
    overview.append(this.transportStats, this.treatmentStats, this.incidentStats);
    overview.append(serviceGrid, el('p', 'pnote', 'Coverage is the share of residents served. Capacity and distance matter; providers and homes must connect to the highway. Homes need healthcare and education for apartments; high-rises also need safety, fire protection, recycling and parks.'));
    for (const [i, milestone] of MILESTONES.entries()) {
      const row = el('div', 'milestone');
      row.append(el('span', 'milestone-level', String(i + 1)), el('strong', undefined, milestone.name), el('span', 'milestone-pop', `${fmt(milestone.population)} residents`), el('span', 'milestone-unlocks', milestone.unlocks), el('span', 'milestone-reward', milestone.reward ? `+$${fmt(milestone.reward)}` : 'Starting tools'));
      this.milestoneRows.push(row);
      overview.append(row);
    }
    city.addEventListener('click', () => overview.classList.toggle('open'));
    root.append(city, overview);
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
    budget.append(el('div', 'ptitle', 'City budget'), taxRow);
    this.taxInput.setAttribute('aria-label', 'Tax rate');
    for (const [key, label] of [['fareIncome', 'Transport fares'], ['tollIncome', 'Congestion charge'], ['taxIncome', 'Tax revenue'], ['roadExpense', 'Road upkeep'], ['serviceExpense', 'Service upkeep'], ['policyExpense', 'Policies'], ['loanExpense', 'Loan payment']]) {
      const row = el('div', 'finance-row');
      const value = el('strong');
      row.append(el('span', undefined, label), value);
      this.financeValues.set(key, value);
      budget.append(row);
    }
    budget.append(incRow, el('div', 'ptitle', 'Service funding'));
    for (const key of FUNDING_KEYS) {
      const row = el('label', 'funding-row');
      const slider = el('input');
      slider.type = 'range'; slider.min = '50'; slider.max = '150'; slider.step = '10'; slider.value = '100';
      slider.setAttribute('aria-label', `${FUNDING_LABELS[key]} funding`);
      const value = el('span', 'funding-value', '100%');
      slider.addEventListener('input', () => { value.textContent = `${slider.value}%`; });
      slider.addEventListener('change', () => actions.setFunding(key, Number(slider.value)));
      row.append(el('span', undefined, FUNDING_LABELS[key]), slider, value);
      this.fundingInputs.set(key, slider); this.fundingValues.set(key, value);
      budget.append(row);
    }
    budget.append(el('p', 'pnote', '50% funding gives 71% capacity; 150% gives 122%. Upkeep scales with funding. Civic buildings also need power, water and sewage. Congestion reduces their capacity.'));
    this.borrow.addEventListener('click', () => actions.loan('take'));
    this.repay.addEventListener('click', () => actions.loan('repay'));
    const loanActions = el('div', 'loan-actions'); loanActions.append(this.borrow, this.repay);
    budget.append(el('div', 'ptitle', 'Recovery loan'), el('p', 'pnote', `$${LOAN_AMOUNT.toLocaleString()} cash · $${LOAN_TOTAL.toLocaleString()} total repayment · $${LOAN_PAYMENT}/simulation second. One loan at a time; pauses with the city.`), this.debtLabel, loanActions);

    // Policies popover: standing decisions that cost money every second and change how the city behaves.
    const policyPanel = el('div', 'popover policies');
    policyPanel.append(el('div', 'ptitle', 'City policies'), el('p', 'pnote', 'Each policy is paid for every second, and the bill grows with the city.'));
    for (const id of POLICY_IDS) {
      const spec = POLICIES[id];
      const row = el('label', 'policy-row');
      const box = el('input') as HTMLInputElement;
      box.type = 'checkbox';
      box.setAttribute('aria-label', spec.label);
      box.addEventListener('change', () => actions.setPolicy(id, box.checked));
      const text = el('span', 'policy-text');
      text.append(
        el('strong', undefined, spec.label),
        el('span', 'policy-effect', spec.effect),
        el('span', 'pnote', spec.note),
        el('span', 'policy-cost', ''),
      );
      row.append(icon(spec.icon, 20), text, box);
      this.policyToggles.set(id, box);
      this.policyRows.set(id, row);
      policyPanel.append(row);
    }

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
    this.buildAbout();
    const menu = el('div', 'popover menu');
    const menuItem = (ic: string, label: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', 'mitem');
      b.append(icon(ic, 17), el('span', undefined, label));
      b.addEventListener('click', () => { menu.classList.remove('open'); fn(); });
      return b;
    };
    menu.append(
      menuItem('help', 'Welcome tutorial', () => this.showWelcome()),
      menuItem('plus', 'New city', () => { if (confirm('Start a new city on a new map? Your current city will be lost.')) actions.newCity(); }),
      menuItem('city', 'Load demo city', actions.demoCity),
      menuItem('link', 'Copy share link', actions.share),
      menuItem('menu', 'Main menu', actions.openMenu),
      menuItem('about', 'About Gridburg', () => this.about.classList.add('open')),
    );
    const cheat = menuItem('money', '', () => { cheatLabel(actions.toggleInfiniteMoney()); });
    const cheatLabel = (on: boolean): void => { cheat.querySelector('span')!.textContent = `Infinite money: ${on ? 'on' : 'off'}`; cheat.classList.toggle('active', on); };
    cheatLabel(false);
    this.setCheatLabel = cheatLabel;
    menu.append(cheat);
    const trafficBtn = iconBtn('car', 'Traffic congestion overlay', () => { const on = actions.toggleTraffic(); trafficBtn.classList.toggle('active', on); trafficBtn.setAttribute('aria-pressed', String(on)); });
    trafficBtn.setAttribute('aria-pressed', 'false');
    const polBtn = iconBtn('smog', 'Pollution view (P)', () => polBtn.classList.toggle('active', actions.togglePollution()));
    const menuBtn = iconBtn('menu', 'Menu', () => { budget.classList.remove('open'); policyPanel.classList.remove('open'); menu.classList.toggle('open'); });
    const policyBtn = iconBtn('policy', 'City policies', () => { budget.classList.remove('open'); menu.classList.remove('open'); policyPanel.classList.toggle('open'); });
    right.append(
      trafficBtn, polBtn, policyBtn,
      iconBtn('link', 'Copy a link to this city', actions.share),
      iconBtn('help', 'Help (H)', () => this.help.classList.toggle('open')),
      menuBtn,
    );
    moneyChip.addEventListener('click', () => { menu.classList.remove('open'); policyPanel.classList.remove('open'); budget.classList.toggle('open'); });
    window.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!budget.contains(t) && !moneyChip.contains(t)) budget.classList.remove('open');
      if (!menu.contains(t) && !menuBtn.contains(t)) menu.classList.remove('open');
      if (!policyPanel.contains(t) && !policyBtn.contains(t)) policyPanel.classList.remove('open');
    });

    // ---- the bottom bar: city readouts, the build categories and the clock, all in one strip ------
    const status = el('div', 'status');
    const dem = el('div', 'demand');
    dem.title = 'Demand for residential, commercial, industrial and office zones';
    for (const [i, name] of ['R', 'C', 'I', 'O'].entries()) {
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

    this.clock.title = 'One day lasts 8 simulation minutes. Pausing and speed controls also affect daylight.';
    this.clock.setAttribute('aria-label', 'City time');
    const speed = el('div', 'speed');
    for (const [v, label] of [[0, '❚❚'], [1, '▶'], [2, '▶▶'], [3, '▶▶▶']] as [number, string][]) {
      const b = el('button', 'sbtn', label);
      b.title = v === 0 ? 'Pause (Space)' : `Speed ${v}x`;
      b.addEventListener('click', () => actions.setSpeed(v));
      this.speedBtns.set(v, b);
      speed.append(b);
    }

    this.polBtn = polBtn;
    root.append(chips, budget, policyPanel, right, menu, this.alerts, this.about);

    // Build menu: a panel of tool cards above a row of category buttons.
    const dock = el('div', 'dock');
    const head = el('div', 'phead');
    head.append(this.panelTitle, this.hint);
    this.panel.append(head);
    for (const c of CATEGORIES) {
      if (c.id === 'bulldoze' || c.id === 'inspect') continue;
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
        if (c.id === 'inspect') { actions.setTool(this.tool === 'inspect' ? 'none' : 'inspect'); return; }
        if (c.id === 'bulldoze') { actions.setTool(this.tool === 'bulldoze' ? 'none' : 'bulldoze'); return; }
        // Clicking the open category closes it and puts the tool away, like CS.
        if (this.openCat === c.id) { actions.setTool('none'); return; }
        const current = c.tools.find((t) => t.id === this.tool);
        actions.setTool(current ? current.id : c.tools[0].id);
      });
      this.catBtns.set(c.id, b);
      cats.append(b);
    }
    dock.append(this.panel);
    const bar = el('div', 'bottombar');
    bar.append(status, cats, this.clock, speed);
    root.append(dock, bar, this.toastEl, this.costEl, this.help);

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'h' || e.key === 'H') this.help.classList.toggle('open');
      if (e.key === 'p' || e.key === 'P') this.polBtn.classList.toggle('active', actions.togglePollution());
      // Escape clears what is open or selected; the main menu has its own button.
      if (e.key === 'Escape') {
        this.help.classList.remove('open');
        overview.classList.remove('open');
        menu.classList.remove('open');
        budget.classList.remove('open');
        policyPanel.classList.remove('open');
        this.about.classList.remove('open');
        actions.closeInspection();
      }
    });
    this.setTool('road');
    this.setMode('straight');
    this.setSpeed(1);
  }

  /** A short note on who made the game, with a way out to the author's site. */
  private buildAbout(): void {
    this.about.setAttribute('role', 'dialog');
    this.about.setAttribute('aria-modal', 'true');
    this.about.setAttribute('aria-label', 'About Gridburg');
    const card = el('div', 'card');
    card.innerHTML = `
      <h2>About Gridburg</h2>
      <p>A small city builder about traffic: lay out the roads, zone the land, and watch every car find
      its own way across town.</p>
      <p>Built by <a href="https://karakabakov.com" target="_blank" rel="noopener noreferrer">karakabakov.com</a>.</p>
      <p class="dim">Runs entirely in your browser. Your city is saved locally and shared through a link.</p>`;
    const close = el('button', 'menu-mini primary', 'Close');
    close.addEventListener('click', () => this.about.classList.remove('open'));
    card.append(close);
    this.about.append(card);
    this.about.addEventListener('click', e => { if (e.target === this.about) this.about.classList.remove('open'); });
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
          <li><b>Inspect (I)</b> — click any building to see its local coverage and growth blockers. Amber markers warn of a service downgrade after 180 simulation seconds</li>
          <li><b>Budget</b> — click your treasury to adjust service funding, review expenses or take a repayable recovery loan. Private development continues while the city is in debt</li>
          <li><b>Grid</b> — road points snap to tile centers, so roads sit on squares like zones: a road fills one square, an avenue three. Buildings occupy cells and face a cardinal direction; connections to existing curved roads take priority</li>
          <li><b>City levels</b> — grow population to earn grants and unlock civic buildings. Click the city progress card to see your next milestone and service coverage</li>
          <li><b>Neighborhood services</b> — parks improve happiness. From Growing village, homes need a clinic and school nearby to become apartments. High-rises unlock at Thriving town and need all six civic services. Each provider has limited capacity and range; all need highway-connected roads</li>
          <li><b>Coverage</b> — picking a service paints where that service already reaches, so the next one lands in a gap</li>
          <li><b>Policies</b> — standing decisions like recycling, smoke alarms or free public transport. They cost money every second and the bill grows with the city</li>
          <li><b>Pollution</b> from industry and coal spreads through the ground and drives residents away. Press <b>P</b> to see it</li>
        </ul>
        <p><b>Left drag</b> build · <b>Right drag</b> rotate · <b>Q / E</b> rotate · <b>WASD</b> pan · <b>Wheel</b> zoom ·
        <b>Space</b> pause · <b>Esc</b> cancel</p>
        <p class="dim">Your city saves in this browser. Share copies a link containing the whole city. Press H or click to close.</p>
      </div>`;
    h.addEventListener('click', () => h.classList.remove('open'));
    return h;
  }

  showWelcome(): void {
    this.tutorialReturnSpeed = this.currentSpeed;
    this.tutorialActions.setSpeed(0);
    this.tutorialPage = 0;
    this.welcome.classList.add('open');
    for (const sibling of this.welcome.parentElement!.children) if (sibling !== this.welcome) (sibling as HTMLElement).inert = true;
    this.renderWelcome();
  }

  private renderWelcome(): void {
    const pages = [
      { icon: 'city', title: 'A patch of land. Your future metropolis.', text: 'Your goal is to grow a connected, happy city from a small settlement to 6,500 residents. Balance homes, jobs, services and your budget. Every population milestone earns a grant and new tools. There is no timer—you can keep building after reaching Metropolis.', task: 'Your first milestone: welcome 120 residents.', button: 'Show me how' },
      { icon: 'road', title: 'Start with a connection', text: 'The highway is your link to the outside world. Extend a road from its end, then zone homes beside it. Add shops for customers and industry for jobs. Keep factories away from homes because pollution spreads.', task: 'First steps: extend the highway → zone homes → add jobs.', button: 'Next: keep the lights on' },
      { icon: 'water', title: 'Give your neighborhoods the essentials', text: 'Build a wind turbine, a water tower, and a sewage outlet on the river bank. Utilities travel through connected roads. Keep sewage downstream of drinking-water pumps. Later, a treatment plant filters 95% of its effluent when powered.', task: 'Watch electricity, water and sewage meters at the bottom left.', button: 'Next: help your city grow' },
      { icon: 'services', title: 'Make it a place people want to live', text: 'Parks improve happiness. As your city grows, add clinics, schools, fire protection, police and waste collection. Apartments need local healthcare and education; towers need wider services. Click a building with Inspect to see exactly what is missing.', task: 'Reach milestones, reinvest grants, and check your budget before expanding.', button: 'Next: connect a bigger city' },
      { icon: 'transport', title: 'A bigger city needs more ways to move', text: 'At 400 residents, bus stops can connect homes and jobs and you can buy new highway entrances. At 900, offices bring clean jobs. At 1,800, railway stations add elevated links along roads and metro stations add underground ones. At 3,500, build a regional airport.', task: 'Place two stops or stations with utility service. Routes form automatically.', button: 'Let’s build' },
    ];
    const page = pages[this.tutorialPage];
    const card = el('div', 'welcome-card');
    const art = el('div', 'welcome-art'); art.append(icon(page.icon, 72));
    const count = el('p', 'welcome-step', `YOUR CITY STARTS HERE · ${this.tutorialPage + 1} / ${pages.length}`);
    const row = el('div', 'welcome-actions');
    const close = (): void => {
      this.welcome.classList.remove('open');
      for (const sibling of this.welcome.parentElement!.children) (sibling as HTMLElement).inert = false;
      try { localStorage.setItem('gridburg.welcome.v1', 'done'); } catch { /* optional storage */ }
      this.tutorialActions.setSpeed(this.tutorialReturnSpeed);
    };
    const skip = el('button', 'welcome-skip', 'Skip tutorial'); skip.addEventListener('click', close);
    if (this.tutorialPage > 0) {
      const back = el('button', 'welcome-skip', 'Back');
      back.addEventListener('click', () => { this.tutorialPage--; this.renderWelcome(); }); row.append(back);
    }
    const next = el('button', 'welcome-next', page.button);
    next.addEventListener('click', () => { if (this.tutorialPage === pages.length - 1) close(); else { this.tutorialPage++; this.renderWelcome(); } });
    row.append(skip, next);
    card.append(count, art, el('h1', undefined, page.title), el('p', 'welcome-copy', page.text), el('p', 'welcome-task', page.task), row);
    this.welcome.replaceChildren(card); next.focus();
  }

  setTool(t: Tool): void {
    this.tool = t;
    for (const [id, b] of this.toolBtns) b.classList.toggle('active', id === t);
    const cat = CATEGORIES.find((c) => c.tools.some((x) => x.id === t)) ?? null;
    this.openCat = cat && cat.id !== 'bulldoze' && cat.id !== 'inspect' ? cat.id : null;
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
    if (['road', 'avenue', 'bridge', 'tunnel'].includes(this.tool)) {
      const m = MODES.find((x) => x.id === this.mode)!;
      this.hint.textContent = `${this.tool === "bridge" || this.tool === "tunnel" ? "Minimum 14 cells · dry ends. " : ""}${m.label}: ${m.hint.toLowerCase()}. Keeps going until you join a road, right-click or press Esc`;
    } else {
      this.hint.textContent = def.hint;
    }
  }

  setSpeed(v: number): void {
    this.currentSpeed = v;
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

  showInspection(report: TileReport | null): void {
    this.inspector.classList.toggle('open', report !== null);
    if (!report) return;
    const title = el('h2', undefined, report.name);
    const where = el('p', 'pnote', `Cell ${report.tile % 80}, ${Math.floor(report.tile / 80)}${report.occupants ? ` · ${report.occupants} ${report.name === 'Residential' ? 'residents' : 'jobs'}` : ''}`);
    const status = el('p', report.neglect ? 'neg' : 'inspection-status', report.status);
    const details = report.details.map(detail => el('p', 'pnote', detail));
    const needs = el('div', 'inspection-needs');
    for (const [key, value] of Object.entries(report.coverage)) {
      const row = el('div', 'finance-row'); row.append(el('span', undefined, CIVIC_LABELS[key as CivicNeed]), el('strong', undefined, `${value}%`)); needs.append(row);
    }
    const blockers = el('ul', 'inspection-blockers');
    for (const reason of report.blockers) blockers.append(el('li', undefined, reason));
    this.inspectorBody.replaceChildren(title, where, status, ...details, needs, blockers);
  }

  resetProgress(): void {
    this.previousLevel = null;
    this.previousTick = 0;
  }

  update(s: Stats): void {
    for (const [key, value] of this.financeValues) value.textContent = `$${(key === 'fareIncome' ? s.transport.fareIncome : s[key as 'taxIncome' | 'tollIncome' | 'roadExpense' | 'serviceExpense' | 'policyExpense' | 'loanExpense']).toFixed(2)}/s`;
    for (const key of FUNDING_KEYS) {
      const slider = this.fundingInputs.get(key)!;
      if (document.activeElement !== slider) {
        slider.value = String(s.funding[key]);
        this.fundingValues.get(key)!.textContent = `${s.funding[key]}%`;
      }
      slider.title = `${Math.round(fundingOutput(s.funding[key] / 100) * 100)}% capacity`;
    }
    for (const id of POLICY_IDS) {
      const spec = POLICIES[id], locked = s.cityLevel < spec.unlock;
      const box = this.policyToggles.get(id)!, row = this.policyRows.get(id)!;
      box.checked = s.policies[id];
      box.disabled = locked;
      row.classList.toggle('locked', locked);
      row.classList.toggle('on', s.policies[id]);
      const cost = spec.base + spec.perResident * s.pop;
      row.querySelector('.policy-cost')!.textContent = locked
        ? `Unlocks at ${MILESTONES[spec.unlock].name}`
        : `$${cost.toFixed(2)}/s${s.policies[id] ? '' : ' while active'}`;
    }
    this.borrow.disabled = s.debt > 0;
    this.repay.disabled = s.debt === 0 || s.money < s.debt;
    this.debtLabel.textContent = s.debt > 0 ? `Balance $${fmt(s.debt)} · ${Math.ceil(s.debt / LOAN_PAYMENT)}s remaining` : 'No outstanding debt';
    const milestone = MILESTONES[s.cityLevel];
    const next = MILESTONES[s.cityLevel + 1];
    if (this.previousLevel !== null && s.tick >= this.previousTick && s.cityLevel > this.previousLevel) {
      const grant = MILESTONES.slice(this.previousLevel + 1, s.cityLevel + 1).reduce((sum, m) => sum + m.reward, 0);
      this.toast(`${milestone.name} reached! +$${fmt(grant)} · ${milestone.unlocks}`);
    }
    this.previousLevel = s.cityLevel;
    this.previousTick = s.tick;
    this.cityTitle.textContent = `Level ${s.cityLevel + 1} · ${milestone.name}`;
    this.happiness.textContent = `${s.happiness}% happy`;
    this.happiness.classList.toggle('neg', s.happiness < 50);
    const fraction = next ? Math.max(0, Math.min(1, (s.pop - milestone.population) / (next.population - milestone.population))) : 1;
    this.cityFill.style.width = `${fraction * 100}%`;
    this.cityNext.textContent = next ? `${fmt(s.pop)} / ${fmt(next.population)} residents → ${next.name} · +$${fmt(next.reward)}` : `${fmt(s.pop)} residents · All milestones achieved`;
    for (const [key, value] of this.civicMeters) {
      value.textContent = `${s.civic[key]}%`;
      value.classList.toggle('neg', s.civic[key] < 35);
    }
    this.milestoneRows.forEach((row, i) => { row.classList.toggle('earned', i <= s.cityLevel); row.classList.toggle('next', i === s.cityLevel + 1); });
    this.transportStats.textContent = `${s.entries} city entrances · ${s.transport.busLines} bus routes · ${s.transport.railLines} rail links · ${s.transport.subwayLines ?? 0} metro links · ${s.transport.airports} airports · ${s.transport.riders} transit riders/min · ${s.transport.airPassengers} air passengers/min · fares $${s.transport.fareIncome.toFixed(2)}/s`;
    this.incidentStats.textContent = `${s.incidents.patrols} police cars · ${s.incidents.fireEngines} fire engines · ${s.incidents.extinguished} fires extinguished · ${s.incidents.prevented} crimes prevented`;
    this.treatmentStats.textContent = `${s.treatedSewage} sewage units filtered`;
    for (const id of ['office', 'entry'] as Tool[]) {
      const button = this.toolBtns.get(id)!;
      const unlock = id === 'office' ? OFFICE_UNLOCK : ENTRY_UNLOCK;
      button.disabled = s.cityLevel < unlock;
      const note = button.querySelector('.cnote');
      if (note) note.textContent = button.disabled ? `Level ${unlock + 1} · ${MILESTONES[unlock].population} residents` : id === 'office' ? 'Clean jobs · needs education' : 'New highway access';
    }
    for (const [id, button] of this.toolBtns) {
      const kind = SERVICE_TOOL[id];
      if (kind === undefined) continue;
      const spec = SERVICES[kind];
      const locked = s.cityLevel < (spec.unlock ?? 0);
      button.disabled = locked;
      const note = button.querySelector('.cnote');
      if (locked) {
        button.dataset.unlockedNote ??= note?.textContent ?? '';
        if (note) note.textContent = `Level ${(spec.unlock ?? 0) + 1} · ${fmt(MILESTONES[spec.unlock!].population)} residents`;
      } else if (note && button.dataset.unlockedNote !== undefined) note.textContent = button.dataset.unlockedNote;
    }
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
    for (let i = 0; i < 4; i++) {
      const d = s.demand[i];
      const b = this.demandBars[i];
      b.style.height = `${Math.round(Math.abs(d) * 100)}%`;
      b.classList.toggle('negd', d < 0);
    }

    const a: string[] = [];
    if (s.incidents.fires) a.push(`${s.incidents.fires} building fires: fire engines need working stations and clear road access`);
    if (s.incidents.crashes) a.push(`${s.incidents.crashes} traffic collisions: blocked vehicles await police or recovery`);
    if (s.incidents.crime) a.push(`${s.incidents.crime} crime hotspots: police visits deter crime and restore tax revenue`);
    if (s.buildings === 0 && s.roadLength < 12) a.push('Draw a road from the end of the highway, then zone beside it');
    if (s.money < 0) a.push('Treasury in debt: open Budget to reduce funding or take a recovery loan. Existing zones can still grow.');
    if (s.declining > 0) a.push(`${s.declining} homes losing services: inspect the amber markers before they downgrade`);
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
    if (s.gaveUp > 0 || s.commute > 45) a.push('Gridlock: try buses, rail, avenues or another city entrance');
    if (s.cityLevel >= 1 && s.civic.health < 35) a.push('Homes need healthcare: place a clinic near residents');
    if (s.cityLevel >= 1 && s.civic.education < 35) a.push('Education limits growth: place schools near homes');
    if (s.cityLevel >= 2 && s.civic.waste < 50) a.push('Waste coverage is low: build a recycling center');
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
