import { T_TROLLEY, T_TAXI, T_FLOOD_BARRIER, T_LANDMARK, FLOOD_BARRIER_RADIUS } from '../constants';
import { COST_DIG, COST_FILL, TAX_LABELS } from '../extras';
import type { Taxes } from '../extras';
import { T_BUS, T_STATION, T_SUBWAY, T_AIRPORT, T_TREATMENT, OFFICE_UNLOCK, ENTRY_UNLOCK, COST_ENTRY, LEISURE_UNLOCK } from '../constants';
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
import { T_DOCKS, DOCK_JOBS, T_GAS, T_HYDRO, T_NUCLEAR } from '../constants';
import { COST_MOTORWAY, COST_RAMP } from '../constants';
import { COST_AVENUE, COST_LANE, COST_HIGHWAY, COST_LIGHT, COST_STOP, COST_CALM, COST_ROAD, COST_ROUNDABOUT, COST_ZONE, SERVICES, T_COAL, T_OUTLET, T_PUMP, T_TOWER, T_WIND, T_SOLAR } from '../constants';
import { icon } from './icons';

/** One line of city trouble, with an id the game can turn into a place to look. */
export interface CityMessage { id: string; text: string }

export interface HudActions {
  setTool(t: Tool): void;
  setMode(m: RoadMode): void;
  setSpeed(v: number): void;
  setTax(v: number): void;
  setTaxes(t: Taxes): void;
  setFunding(key: FundingKey, value: number): void;
  loan(action: 'take' | 'repay'): void;
  rotatePlacement(): void;
  /** Step down into the streets, or back up to the map. */
  toggleWalk(): void;
  toggleDrive(): void;
  setElevation(level: number): void;
  /** Move the camera to whatever a message is about; false when there is nothing to show. */
  focusOn(id: string): boolean;
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
      { id: 'lane', label: 'Lane', key: 'L', price: `${money(COST_LANE)} / cell`, note: 'One shared lane', hint: 'A narrow, cheap, slow street for the inside of a block. Traffic shares a single carriageway, so keep it away from through routes' },
      { id: 'road', label: 'Road', key: 'R', price: `${money(COST_ROAD)} / cell`, note: 'Two lanes', hint: 'Click to start, click again to finish. It keeps going from the last point until you join a road, right-click, or press Esc' },
      { id: 'avenue', label: 'Avenue', key: 'V', price: `${money(COST_AVENUE)} / cell`, note: 'Four lanes, faster', hint: 'A wide, fast road that holds far more traffic. Placed the same way as a road' },
      { id: 'highway', label: 'Expressway', key: 'X', price: `${money(COST_HIGHWAY)} / cell`, note: 'Fastest · no frontage', hint: 'Six lanes at expressway speed for crossing the city. Nothing can be zoned or built along it, so feed it with ordinary streets' },
      { id: 'motorway', label: 'One-way highway', price: `${money(COST_MOTORWAY)} / cell`, note: '3 lanes · one way', hint: 'One carriageway of a motorway, three lanes in the direction you draw it. Draw the other direction as a second road beside it, as in Cities: Skylines 2. No frontage' },
      { id: 'ramp', label: 'Highway ramp', price: `${money(COST_RAMP)} / cell`, note: '1 lane · one way', hint: 'A slip road on or off a highway, one way in the direction you draw it. Start it from a highway to make an exit, end it on one to make an on-ramp; press + for a flyover or − to dive under' },
      { id: 'entry', label: 'City entrance', price: money(COST_ENTRY), note: 'New highway access', hint: 'Choose a clear map edge. Adds a seven-cell avenue connecting to the outside world. Unlocks at Small town' },
      { id: 'bikelane', label: 'Bike lanes', price: '$12 / cell', note: 'Upgrade a street', hint: 'Click a surface street or avenue to add compact bike lanes beside its curbs. Click again to remove. Not available on highways, narrow lanes, bridges or roundabouts' },
      { id: 'upgrade', label: 'Upgrade', key: 'U', price: 'Difference', note: 'Widen one step', hint: 'Click a road to widen it one step: lane, street, avenue, expressway, then back to a lane. Widening costs the difference; narrowing is free' },
    ],
  },
  {
    id: 'traffic', label: 'Traffic',
    tools: [
      { id: 'roundabout', label: 'Roundabout', key: 'O', price: money(COST_ROUNDABOUT), note: 'Never stops', hint: 'Click a junction. Traffic circulates one way and nobody has to wait' },
      { id: 'light', label: 'Signal', key: 'T', price: money(COST_LIGHT), note: 'Busy crossings', hint: 'Click a junction to add or remove traffic lights. Best where two busy roads cross' },
      { id: 'stopsign', label: 'Stop signs', key: 'K', price: money(COST_STOP), note: 'All-way halt', hint: 'Click a junction to make every approach stop before entering. Slower than lights, but it keeps a quiet crossing orderly and needs no signal' },
      { id: 'oneway', label: 'One-way', key: 'Y', price: 'Free', note: 'Click to cycle', hint: 'Click a road to cycle: one-way, reversed, two-way' },
      { id: 'calm', label: 'Calm street', key: 'J', price: `${money(COST_CALM)} / cell`, note: 'Slower, safer', hint: 'Click a street to add traffic calming: drivers run at about half speed and collisions become rare. Click again to remove it. Expressways cannot be calmed' },
    ],
  },
  {
    id: 'zones', label: 'Zones',
    tools: [
      { id: 'res', label: 'Residential', key: '1', price: `${money(COST_ZONE)} / cell`, note: 'Homes', hint: 'Drag a rectangle beside a road. Buildings grow up to three cells back from it' },
      { id: 'com', label: 'Commercial', key: '2', price: `${money(COST_ZONE)} / cell`, note: 'Shops and commerce', hint: 'Drag a rectangle beside a road. Shops want customers nearby' },
      { id: 'office', label: 'Offices', price: `${money(COST_ZONE)} / cell`, note: 'Clean jobs · needs education', hint: 'Clean employment with no industrial pollution. Unlocks at 900 residents; upgrades need 25% then 50% education coverage' },
      { id: 'ind', label: 'Industrial', key: '3', price: `${money(COST_ZONE)} / cell`, note: 'Jobs, pollutes', hint: 'Drag a rectangle beside a road. Pollutes the ground around it, so keep it away from homes' },
      { id: 'farm', label: 'Farmland', price: `${money(COST_ZONE)} / cell`, note: 'Clean rural jobs', hint: 'Fields, barns and greenhouses. Meets industrial demand with few jobs but no pollution and little power; fields drink extra water' },
      { id: 'leisure', label: 'Leisure & tourism', price: `${money(COST_ZONE)} / cell`, note: 'Hotels, cafés, nightlife', hint: 'Meets commercial demand with cafés, hotels and nightlife. Pays more tax near parks and the river. Unlocks at 400 residents' },
    ],
  },
  {
    id: 'power', label: 'Electricity',
    tools: [
      { id: 'wind', label: 'Wind turbine', price: svc(T_WIND), note: `${SERVICES[T_WIND].power} MW · clean`, hint: 'Place beside a road. Power travels along connected roads' },
      { id: 'solar', label: 'Solar farm', price: svc(T_SOLAR), note: '1,800 MW · clean', hint: 'Clean, high-capacity electricity with low running costs. Unlocks at Thriving town' },
      { id: 'gas', label: 'Gas plant', price: svc(T_GAS), note: `${SERVICES[T_GAS].power.toLocaleString()} MW · some smoke`, hint: 'Less output than coal and about a third of the pollution. Unlocks at Growing village' },
      { id: 'coal', label: 'Coal plant', price: svc(T_COAL), note: `${SERVICES[T_COAL].power.toLocaleString()} MW · polluting`, hint: 'Lots of power and lots of ground pollution. Keep it away from homes and water towers' },
      { id: 'hydro', label: 'Hydro dam', price: svc(T_HYDRO), note: `${SERVICES[T_HYDRO].power.toLocaleString()} MW · clean`, hint: 'Build on the river bank. Clean, steady power from the current. Unlocks at Thriving town' },
      { id: 'nuclear', label: 'Nuclear plant', price: svc(T_NUCLEAR), note: `${SERVICES[T_NUCLEAR].power.toLocaleString()} MW · 3 × 3`, hint: 'Enormous clean output for a large city, at a high price and upkeep. Unlocks at Regional capital' },
    ],
  },
  {
    id: 'water', label: 'Water',
    tools: [
      { id: 'tower', label: 'Water tower', price: svc(T_TOWER), note: `${SERVICES[T_TOWER].water} water`, hint: 'Works anywhere beside a road, but keep it off polluted ground' },
      { id: 'pump', label: 'River pump', price: svc(T_PUMP), note: `${SERVICES[T_PUMP].water.toLocaleString()} water`, hint: 'Must touch the river. Put it upstream of any sewage outlet (arrows on the water show the flow)' },
      { id: 'treatment', label: 'Sewage treatment', price: svc(T_TREATMENT), note: '2,200 sewage · 95% filtered', hint: 'Build on the river bank. Electricity powers filtration, reducing pollution from treated sewage by 95%' },
      { id: 'docks', label: 'Fishing docks', price: svc(T_DOCKS), note: `${DOCK_JOBS} jobs · boats`, hint: 'Build on the river bank. The docks put fishing boats on the river and sell the catch; sewage upstream thins it, so keep outlets downstream or treated. Unlocks at Small town' },
      { id: 'outlet', label: 'Sewage outlet', price: svc(T_OUTLET), note: `${SERVICES[T_OUTLET].sewage.toLocaleString()} sewage`, hint: 'Must touch the river. Fouls the water downstream of it' },
      { id: 'barrier', label: 'Flood barrier', price: svc(T_FLOOD_BARRIER), note: `Protects ${FLOOD_BARRIER_RADIUS} cells`, hint: 'Build on the river bank. When the river floods, nothing within seven cells of a barrier is flooded. Unlocks at Small town' },
    ],
  },
  {
    id: 'land', label: 'Land',
    tools: [
      { id: 'dig', label: 'Dig out', price: `${money(COST_DIG)} / cell`, note: 'Ponds and inlets', hint: 'Drag over open ground to dig it out to water. A pond counts as waterfront: pumps, docks and river views work beside it. Digging out old fill restores the river' },
      { id: 'fill', label: 'Fill in', price: `${money(COST_FILL)} / cell`, note: 'Reclaim the bank', hint: 'Drag along the river bank to fill it in as buildable land. The river always keeps a channel at least two cells wide. Filling a dug pond restores the ground' },
    ],
  },
  {
    id: 'districts', label: 'Districts',
    tools: [
      { id: 'district', label: 'Paint district', price: 'Free', note: 'Local policies', hint: 'Drag to paint cells into the district chosen in the district panel. Each district can have its own policies, such as a high-rise ban or a tax break' },
      { id: 'undistrict', label: 'Erase district', price: 'Free', note: 'Back to citywide', hint: 'Drag to take cells out of any district' },
    ],
  },
  {
    id: 'services', label: 'Services',
    tools: (['clinic', 'hospital', 'cityhospital', 'school', 'fire', 'police', 'policehq', 'recycling', 'university', 'cemetery', 'crematorium', 'postoffice'] as Tool[]).map(id => {
      const spec = SERVICES[SERVICE_TOOL[id]!];
      return { id, label: spec.name, price: money(spec.cost), note: `Base $${spec.upkeep}/s · ${spec.radius} cell radius`,
        hint: `${spec.name}: serves ${spec.capacity?.toLocaleString()} residents within ${spec.radius} cells. Both building and homes need highway-connected roads. Unlocks at ${MILESTONES[spec.unlock ?? 0].name}` };
    }),
  },
  {
    id: 'transport', label: 'Transport', tools: [
      { id: 'bus', label: 'Bus stop', price: svc(T_BUS), note: '9-cell catchment · $0.45/s', hint: 'Place two stops near homes and jobs. Automatic return routes follow roads; congestion reduces capacity. Needs utilities' },
      { id: 'station', label: 'Railway station', price: svc(T_STATION), note: '3 × 2 cells · $3/s', hint: 'Two stations connect automatically by elevated tracks along road corridors. A station near a city entrance also runs a service out of town. 18-cell catchment, 120 passenger capacity per connection' },
      { id: 'subway', label: 'Metro station', price: svc(T_SUBWAY), note: '1 cell · $2.5/s', hint: 'Metro stations link to each other automatically through underground tunnels, so trains skip road traffic. 14-cell catchment, 100 passenger capacity per connection. Needs utilities' },
      { id: 'taxi', label: 'Taxi stop', price: svc(T_TAXI), note: '4 cabs · On-demand rides', hint: 'One stop dispatches up to four taxis for nearby passengers. Cabs drive directly to destinations through traffic. Needs road access and utilities' },
      { id: 'trolley', label: 'Trolleybus stop', price: svc(T_TROLLEY), note: 'Electric road transit', hint: 'Place two stops beside connected surface streets or avenues. Operating stops create trolleybus routes automatically and need utilities' },
      { id: 'airport', label: 'Regional airport', price: svc(T_AIRPORT), note: '8 × 3 cells · $7/s', hint: 'Clear an 8 × 3 site, its perimeter and 12 cells beyond each runway end. Rotate to aim the flight path. Flights replace some incoming car trips within 24 cells; needs utilities' },
    ],
  },
  {
    id: 'parks', label: 'Parks',
    tools: [...(['parkpath', 'lawn', 'plaza', 'pond', 'parkshop', 'park', 'playground', 'sports', 'garden'] as Tool[]).map(id => {
      const spec = SERVICES[SERVICE_TOOL[id]!];
      return { id, label: spec.name, price: money(spec.cost), note: id === 'parkpath' ? 'Straight or curved · $15 / cell' : ['lawn', 'plaza'].includes(id) ? 'Drag to paint' : 'Place and rotate',
        hint: spec.decoration ? 'Create your own park on clear land. Join paths, plazas or lawns to a road; ponds and kiosks belong beside them. Paths connect automatically. Right-click or G rotates a piece' : `Place ${spec.name.toLowerCase()} near residents for recreation` };
    }), { id: 'landmark' as Tool, label: SERVICES[T_LANDMARK].name, price: svc(T_LANDMARK), note: '2 × 2 · draws tourists', hint: `A landmark that draws ${SERVICES[T_LANDMARK].attraction} visitors a minute to the city and lifts land values around it. Unlocks at ${MILESTONES[SERVICES[T_LANDMARK].unlock ?? 0].name}` }],
  },
  {
    id: 'decorations', label: 'Decorations',
    tools: (['tree', 'flowers', 'bench', 'fountain'] as Tool[]).map(id => {
      const spec = SERVICES[SERVICE_TOOL[id]!];
      return { id, label: spec.name, price: money(spec.cost), note: 'Landscape your city', hint: 'Place on clear land, or replace another decoration. Connect to park paths or a road to benefit nearby residents. G rotates; Bulldoze removes' };
    }),
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
  private cityLevel = el('span', 'val');
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
  private modeBtns = new Map<string, HTMLButtonElement>();
  private heightBtns = new Map<number, HTMLButtonElement>();
  private elevation = 0;
  private panels = new Map<string, HTMLElement>();
  private panel = el('div', 'panel');
  private panelTitle = el('span', 'ptitle');
  private rotateBtn = el('button', 'rotate-btn');
  private openCat: string | null = null;
  private tool: Tool = 'road';
  private mode: RoadMode = 'straight';
  private speedBtns = new Map<number, HTMLButtonElement>();
  private taxLabel = el('span', 'val');
  private taxInput = el('input');
  private zoneTaxInputs: HTMLInputElement[] = [];
  private zoneTaxLabels: HTMLElement[] = [];
  private goodsLine = el('p', 'pnote');
  private toastEl = el('div', 'toast');
  private hint = el('div', 'hint');
  private messagePanel = el('div', 'popover messages');
  private messageList = el('div', 'message-list');
  private messagePop = el('div', 'msgpop');
  private messageDot = el('span', 'dot');
  private messageBtn: HTMLButtonElement = el('button');
  /** What the city is already complaining about, so only genuinely new trouble pops out. */
  private showing = new Set<string>();
  private popTimer = 0;
  private costEl = el('div', 'cost');
  private help: HTMLElement;
  private about = el('div', 'help about');
  private clock = el('div', 'city-clock');
  private walkHint = el('div', 'walk-hint');
  /** The top-right button bar and the menu popover, for panels that live outside the HUD. */
  rightBar!: HTMLElement;
  menuPopover!: HTMLElement;
  private walkBtn: HTMLButtonElement = el('button');
  private driveBtn: HTMLButtonElement = el('button');
  private walkTitle = el('strong', undefined, 'Walking');
  private walkKeys = el('span');
  private speedo = el('b', 'speedo');
  /** Which height the road tool is drawing at: a tunnel, the surface, or a bridge. */
  setElevation(level: number): void {
    this.elevation = level;
    for (const [value, button] of this.heightBtns) button.classList.toggle('active', value === level);
    this.setTool(this.tool);
  }

  /** Which way the building in hand is facing, and whether that control applies at all. */
  setRotation(quarter: number, placing: boolean): void {
    this.rotateBtn.classList.toggle('shown', placing);
    this.rotateBtn.style.setProperty('--turn', `${quarter * 90}deg`);
    const facing = ['north', 'east', 'south', 'west'][quarter & 3];
    this.rotateBtn.setAttribute('aria-label', `Rotate: facing ${facing}`);
  }

  /** Walking hides the building tools and shows how to move; the map comes back on the way out. */
  setWalking(on: boolean, mode: 'walk' | 'drive' = 'walk'): void {
    this.walkHint.classList.toggle('open', on);
    this.walkBtn.classList.toggle('active', on && mode === 'walk');
    this.driveBtn.classList.toggle('active', on && mode === 'drive');
    document.body.classList.toggle('walking', on);
    const driving = on && mode === 'drive';
    this.walkTitle.textContent = driving ? 'Driving' : 'Walking';
    this.walkKeys.textContent = driving
      ? 'W / S to drive and brake · A D to steer · Shift for speed · Space handbrake · V driver’s seat · Esc or M to park'
      : 'W A S D to walk · Shift to run · click, then move the mouse to look · Esc or F to leave';
    this.speedo.hidden = !driving;
  }

  /** The speedometer while driving. */
  setDriveSpeed(kmh: number): void {
    const text = `${kmh} km/h`;
    if (this.speedo.textContent !== text) this.speedo.textContent = text;
  }

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
    this.messageActions = actions;
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
    const progress = el('div', 'city-track');
    progress.append(this.cityFill);
    const overview = el('section', 'city-overview');
    overview.setAttribute('aria-label', 'City progress and services');
    const close = el('button', 'overview-close', 'Close ×');
    close.addEventListener('click', () => overview.classList.remove('open'));
    overview.append(close, el('h2', undefined, 'Your city, growing up'), this.cityTitle, progress, this.cityNext, el('p', 'pnote', 'Reach population milestones to earn grants and unlock buildings. Earned levels are permanent.'));
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
    const openOverview = (): void => { overview.classList.toggle('open'); };
    root.append(overview);
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
    const levelChip = el('button', 'chip level');
    levelChip.title = 'City level: milestones, unlocks and service coverage';
    levelChip.append(icon('city', 17), this.cityLevel, this.happiness);
    levelChip.addEventListener('click', openOverview);
    chips.append(
      moneyChip,
      chip('people', 'Population', this.pop),
      chip('jobs', 'Jobs', this.jobs),
      chip('car', 'Average commute, and cars on the road', this.commute, this.cars),
      levelChip,
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
    taxRow.append(el('span', 'label', 'All taxes'), this.taxInput, this.taxLabel);
    // One rate per zone; the single slider above sets them all at once.
    const zoneTaxRows: HTMLElement[] = [];
    TAX_LABELS.forEach((label) => {
      const row = el('label', 'funding-row');
      const slider = el('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '30'; slider.value = '10';
      slider.setAttribute('aria-label', `${label} tax`);
      const value = el('span', 'funding-value', '10%');
      slider.addEventListener('input', () => {
        value.textContent = `${slider.value}%`;
        actions.setTaxes(this.zoneTaxInputs.map(i => Number(i.value)) as Taxes);
      });
      row.append(el('span', undefined, `${label} tax`), slider, value);
      this.zoneTaxInputs.push(slider); this.zoneTaxLabels.push(value);
      zoneTaxRows.push(row);
    });
    const incRow = el('div', 'prow');
    incRow.append(el('span', 'label', 'Net income'), this.budgetIncome);
    budget.append(el('div', 'ptitle', 'City budget'), taxRow, ...zoneTaxRows, el('p', 'pnote', 'Farms pay the industrial rate and leisure the commercial one. A district tax break takes four points off.'));
    this.taxInput.setAttribute('aria-label', 'Tax rate');
    for (const [key, label] of [['fareIncome', 'Transport fares'], ['tollIncome', 'Congestion charge'], ['fishingIncome', 'Fishing'], ['exportIncome', 'Goods exports'], ['tourismIncome', 'Tourism'], ['taxIncome', 'Tax revenue'], ['roadExpense', 'Road upkeep'], ['serviceExpense', 'Service upkeep'], ['policyExpense', 'Policies'], ['districtExpense', 'District policies'], ['loanExpense', 'Loan payment']]) {
      const row = el('div', 'finance-row');
      const value = el('strong');
      row.append(el('span', undefined, label), value);
      this.financeValues.set(key, value);
      budget.append(row);
    }
    budget.append(incRow, this.goodsLine, el('div', 'ptitle', 'Service funding'));
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
    this.rightBar = right;
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
    this.menuPopover = menu;
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
    this.messagePanel.append(el('div', 'ptitle', 'City messages'), this.messageList);
    const menuBtn = iconBtn('menu', 'Menu', () => { budget.classList.remove('open'); policyPanel.classList.remove('open'); this.messagePanel.classList.remove('open'); menu.classList.toggle('open'); });
    const messageBtn = iconBtn('message', 'City messages', () => {
      budget.classList.remove('open'); policyPanel.classList.remove('open'); menu.classList.remove('open');
      this.messagePop.classList.remove('show');
      this.messagePanel.classList.toggle('open');
    });
    messageBtn.append(this.messageDot);
    this.messageBtn = messageBtn;
    const policyBtn = iconBtn('policy', 'City policies', () => { budget.classList.remove('open'); menu.classList.remove('open'); policyPanel.classList.toggle('open'); });
    const walkBtn = iconBtn('walk', 'Walk the streets (F)', () => actions.toggleWalk());
    this.walkBtn = walkBtn;
    const driveBtn = iconBtn('drive', 'Drive around town (M)', () => actions.toggleDrive());
    this.driveBtn = driveBtn;
    this.speedo.hidden = true;
    this.walkHint.append(this.walkTitle, this.speedo, this.walkKeys);
    right.append(
      walkBtn, driveBtn, messageBtn, trafficBtn, polBtn, policyBtn,
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
      if (!this.messagePanel.contains(t) && !messageBtn.contains(t)) this.messagePanel.classList.remove('open');
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
    root.append(chips, budget, policyPanel, this.messagePanel, right, menu, this.messagePop, this.about, this.walkHint);

    // Build menu: a panel of tool cards above a row of category buttons.
    const dock = el('div', 'dock');
    const head = el('div', 'phead');
    this.rotateBtn.append(icon('rotate', 16), el('span', undefined, 'Rotate'));
    this.rotateBtn.title = 'Turn the building before placing it (G, or right-click)';
    this.rotateBtn.addEventListener('click', () => actions.rotatePlacement());
    head.append(this.panelTitle, this.hint, this.rotateBtn);
    this.panel.append(head);
    for (const c of CATEGORIES) {
      if (c.id === 'bulldoze' || c.id === 'inspect') continue;
      const body = el('div', 'pbody');
      // Height and draw modes: icon buttons in a column that stays put while the cards scroll past.
      const side = el('div', 'modes-wrap');
      if (c.id === 'roads') {
        const height = el('div', 'modes');
        height.append(el('span', 'mlabel', 'Height'));
        for (const [level, label, key] of [[-1, 'Tunnel', '−'], [0, 'Surface', ''], [1, 'Bridge', '+']] as [number, string, string][]) {
          const b = el('button', 'mode');
          b.append(icon(level > 0 ? 'bridge' : level < 0 ? 'tunnel' : 'road', 20));
          b.title = key ? `${label} (${key})` : `${label} road`;
          b.setAttribute('aria-label', label);
          b.addEventListener('click', () => actions.setElevation(level));
          this.heightBtns.set(level, b);
          height.append(b);
        }
        side.append(height);
      }
      if (c.id === 'roads' || c.id === 'parks') {
        const seg = el('div', 'modes');
        seg.append(el('span', 'mlabel', 'Draw'));
        for (const m of MODES) {
          const b = el('button', 'mode');
          b.append(icon(m.id, 20));
          b.title = `${m.label}: ${m.hint} (C cycles)`;
          b.setAttribute('aria-label', m.label);
          b.addEventListener('click', () => actions.setMode(m.id));
          this.modeBtns.set(`${c.id}:${m.id}`, b);
          seg.append(b);
        }
        side.append(seg);
      }
      if (side.childElementCount) body.append(side);
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
        this.messagePanel.classList.remove('open');
        this.messagePop.classList.remove('show');
        this.about.classList.remove('open');
        actions.closeInspection();
      }
    });
    this.setTool('road');
    this.setMode('straight');
    this.setElevation(0);
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
          <li><b>Height</b> — with a road in hand, <b>+</b> raises it to a bridge and <b>−</b> lowers it to a tunnel. Allow 14 cells and clear, dry ends. A road drawn across water becomes a bridge on its own</li>
          <li><b>Four road types</b> — Lane, Road, Avenue and Expressway, in rising order of width, speed and price.
          Nothing can be zoned along an expressway, so feed it with ordinary streets. <b>Upgrade (U)</b> widens a road one step</li>
          <li><b>Traffic</b> — cars queue for real. Busy junctions jam; fix them with <b>avenues</b>, <b>signals</b>,
          <b>one-way</b> streets or <b>roundabouts</b>. Roads turn red where traffic is slow</li>
          <li><b>Utilities</b> run along roads. Buildings need <b>power</b>, <b>water</b> and <b>sewage</b> to grow past
          small. Pumps and outlets sit on the river; keep the pump <b>upstream</b> (arrows show the flow)</li>
          <li><b>Inspect (I)</b> — click any building to see its local coverage and growth blockers. Amber markers warn of a service downgrade after 180 simulation seconds</li>
          <li><b>Budget</b> — click your treasury to adjust service funding, review expenses or take a repayable recovery loan. Private development continues while the city is in debt</li>
          <li><b>Grid</b> — road points snap to tile centers, so roads sit on squares like zones: a road fills one square, an avenue three. Buildings occupy cells and face a cardinal direction; connections to existing curved roads take priority</li>
          <li><b>City levels</b> — grow population to earn grants and unlock civic buildings. The chip in the top-left corner shows your level and how happy the city is; click it for your next milestone and service coverage</li>
          <li><b>Messages</b> — anything going wrong collects behind the bell in the top-right corner. New trouble pops out for a few seconds, and clicking a message takes you to it</li>
          <li><b>Placing</b> — right-click, press <b>G</b> or use Rotate in the panel to turn a building before you put it down</li>
          <li><b>Walking</b> — press <b>F</b> or the walker button to step down into the streets. <b>WASD</b> walks, <b>Shift</b> runs, click then move the mouse to look, and <b>Esc</b> takes you back up</li>
          <li><b>Driving</b> — press <b>M</b> or the car button to take a car out. <b>W/S</b> drive and brake, <b>A/D</b> steer, <b>Shift</b> for speed, <b>Space</b> handbrake, <b>V</b> driver’s seat, <b>Esc</b> to park</li>
          <li><b>Neighborhood services</b> — parks improve happiness. From Growing village, homes need a clinic and school nearby to become apartments. High-rises unlock at Thriving town and need all six civic services. Each provider has limited capacity and range; all need highway-connected roads</li>
          <li><b>Coverage</b> — picking a service paints where that service already reaches, so the next one lands in a gap. A transport tool shows that mode's routes instead</li>
          <li><b>Railways</b> — two stations connect themselves by elevated track along the streets, and a station near a city entrance also runs a service out of town, bringing people in and out by train</li>
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
    for (const [id, b] of this.modeBtns) b.classList.toggle('active', id.endsWith(`:${m}`));
    this.refreshHint();
  }

  private refreshHint(): void {
    const def = CATEGORIES.flatMap((c) => c.tools).find((x) => x.id === this.tool);
    if (!def) { this.hint.textContent = ''; return; }
    if (['lane', 'road', 'avenue', 'highway', 'motorway', 'ramp', 'parkpath'].includes(this.tool)) {
      const m = MODES.find((x) => x.id === this.mode)!;
      const height = this.elevation > 0 ? 'Bridge: minimum 14 cells, dry ends. ' : this.elevation < 0 ? 'Tunnel: minimum 14 cells, clear portals. ' : '';
      this.hint.textContent = `${height}${m.label}: ${m.hint.toLowerCase()}. Keeps going until you join a road, right-click or press Esc`;
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
    this.zoneTaxInputs.forEach((input, z) => { input.value = String(v); this.zoneTaxLabels[z].textContent = `${v}%`; });
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
    for (const [key, value] of this.financeValues) {
      const amount = key === 'fareIncome' ? s.transport.fareIncome : key === 'exportIncome' ? s.goods.income : key === 'tourismIncome' ? s.tourism.income
        : s[key as 'taxIncome' | 'tollIncome' | 'fishingIncome' | 'roadExpense' | 'serviceExpense' | 'policyExpense' | 'loanExpense' | 'districtExpense'];
      value.textContent = `$${amount.toFixed(2)}/s`;
    }
    this.zoneTaxInputs.forEach((input, z) => {
      if (document.activeElement === input || !s.taxes) return;
      input.value = String(s.taxes[z]); this.zoneTaxLabels[z].textContent = `${s.taxes[z]}%`;
    });
    const g = s.goods;
    this.goodsLine.textContent = `Goods: ${fmt(g.produced)} made, ${fmt(g.needed)} needed a minute · ${fmt(g.exported)} exported of ${fmt(g.capacity)} capacity · ${fmt(g.imported)} imported${g.importShare > 0.3 ? ' — shops lose takings buying in stock, so zone more industry or farms' : ''}. ${fmt(s.tourism.visitors)} visitors a minute.`;
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
    this.cityLevel.textContent = `Lv ${s.cityLevel + 1}`;
    this.cityLevel.title = milestone.name;
    this.happiness.textContent = `${s.happiness}%`;
    this.happiness.title = `${s.happiness}% of residents are happy`;
    this.happiness.classList.toggle('neg', s.happiness < 50);
    const fraction = next ? Math.max(0, Math.min(1, (s.pop - milestone.population) / (next.population - milestone.population))) : 1;
    this.cityFill.style.width = `${fraction * 100}%`;
    this.cityNext.textContent = next ? `${fmt(s.pop)} / ${fmt(next.population)} residents → ${next.name} · +$${fmt(next.reward)}` : `${fmt(s.pop)} residents · All milestones achieved`;
    for (const [key, value] of this.civicMeters) {
      value.textContent = `${s.civic[key]}%`;
      value.classList.toggle('neg', s.civic[key] < 35);
    }
    this.milestoneRows.forEach((row, i) => { row.classList.toggle('earned', i <= s.cityLevel); row.classList.toggle('next', i === s.cityLevel + 1); });
    this.transportStats.textContent = `${s.entries} city entrances · ${s.transport.busLines} bus routes · ${s.transport.trolleyLines ?? 0} trolley routes · ${s.transport.railLines} rail lines · ${s.transport.intercityLines} intercity lines · ${s.transport.subwayLines ?? 0} metro links · ${s.transport.airports} airports · ${s.transport.taxiStops ?? 0} taxi stops · ${s.transport.taxiRiders ?? 0} taxi riders/min · ${s.transport.riders} transit riders/min · ${s.transport.airPassengers} air passengers/min · ${s.transport.railPassengers} intercity rail passengers/min · fares $${s.transport.fareIncome.toFixed(2)}/s`;
    this.incidentStats.textContent = `${s.incidents.patrols} police cars · ${s.incidents.fireEngines} fire engines · ${s.incidents.extinguished} fires extinguished · ${s.incidents.prevented} crimes prevented · ${s.incidents.foiled} robberies foiled · ${s.incidents.robbed} got away`;
    this.treatmentStats.textContent = `${s.treatedSewage} sewage units filtered`;
    for (const id of ['office', 'leisure', 'entry'] as Tool[]) {
      const button = this.toolBtns.get(id)!;
      const unlock = id === 'office' ? OFFICE_UNLOCK : id === 'leisure' ? LEISURE_UNLOCK : ENTRY_UNLOCK;
      button.disabled = s.cityLevel < unlock;
      const note = button.querySelector('.cnote');
      if (note) note.textContent = button.disabled ? `Level ${unlock + 1} · ${MILESTONES[unlock].population} residents` : id === 'office' ? 'Clean jobs · needs education' : id === 'leisure' ? 'Hotels, cafés, nightlife' : 'New highway access';
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

    const a: CityMessage[] = [];
    const say = (id: string, text: string): number => a.push({ id, text });
    if (s.incidents.fires) say('fires', `${s.incidents.fires} building fires: fire engines need working stations and clear road access`);
    if (s.incidents.heists) say('heists', `${s.incidents.heists} robbery in progress: the nearest police station is on its way`);
    if (s.incidents.racers) say('racers', `${s.incidents.racers} street racers are out: calmed streets and signals slow them down`);
    if (s.incidents.crashes) say('crashes', `${s.incidents.crashes} traffic collisions: blocked vehicles await police or recovery`);
    if (s.incidents.crime) say('crime', `${s.incidents.crime} crime hotspots: police visits deter crime and restore tax revenue`);
    if (s.disasters?.active === 'flood') say('disaster', 'Flood! Low ground by the river is under water. Flood barriers on the bank protect the streets behind them');
    if (s.disasters?.active === 'tornado') say('disaster', 'Tornado crossing the valley: buildings in its path are being damaged');
    if (s.garbage > 40) say('garbage', 'Rubbish is piling up: build recycling centres so garbage trucks can collect it');
    if (s.goods?.importShare > 0.5 && s.buildings > 20) say('goods', 'Shops are importing most of their stock: zone industry or farmland to supply them');
    if (!s.placeholder && s.buildings === 0 && s.roadLength < 12) say('start', 'Draw a road from the highway interchange, then zone beside it');
    if (s.money < 0) say('budget', 'Treasury in debt: open Budget to reduce funding or take a recovery loan. Existing zones can still grow.');
    if (s.declining > 0) say('declining', `${s.declining} homes losing services: inspect the amber markers before they downgrade`);
    if (s.buildings > 0) {
      if (s.power[1] === 0) say('power', 'No power: build a wind turbine or a coal plant next to a road');
      else if (s.power[0] > s.power[1]) say('power', 'Power shortage');
      if (s.water[1] === 0) say('water', 'No water: build a water tower, or a pump on the river');
      else if (s.water[0] > s.water[1]) say('water', 'Water shortage');
      if (s.sewage[1] === 0) say('sewage', 'No sewage: build an outlet on the river, downstream of any pump');
      else if (s.sewage[0] > s.sewage[1]) say('sewage', 'Sewage is backing up');
    }
    if (s.dirtyWater) say('water', 'Dirty drinking water: move pumps upstream of outlets and towers off polluted ground');
    if (s.resPollution > 2) say('pollution', 'Pollution is reaching homes');
    if (s.gaveUp > 0 || s.commute > 45) say('gridlock', 'Gridlock: try buses, rail, avenues or another city entrance');
    if (s.cityLevel >= 1 && s.civic.health < 35) say('health', 'Homes need healthcare: place a clinic near residents');
    if (s.cityLevel >= 1 && s.civic.education < 35) say('education', 'Education limits growth: place schools near homes');
    if (s.cityLevel >= 2 && s.civic.waste < 50) say('waste', 'Waste coverage is low: build a recycling center');
    this.setMessages(a);
  }

  /**
   * The city's standing complaints live in the message panel behind the bell. Anything that has just
   * started going wrong also pops out for a few seconds, so trouble is noticed without the screen
   * filling up with red boxes that never leave.
   */
  private setMessages(messages: CityMessage[]): void {
    const fresh = messages.filter(m => !this.showing.has(m.text));
    this.showing = new Set(messages.map(m => m.text));
    this.messageList.replaceChildren(...(messages.length
      ? messages.map(m => this.messageRow(m))
      : [el('p', 'pnote', 'Nothing needs your attention.')]));
    this.messageDot.textContent = messages.length ? String(messages.length) : '';
    this.messageDot.classList.toggle('on', messages.length > 0);
    this.messageBtn.classList.toggle('attention', messages.length > 0);
    if (!fresh.length) return;
    this.messagePop.replaceChildren(...fresh.slice(0, 3).map(m => this.messageRow(m)));
    this.messagePop.classList.add('show');
    clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.messagePop.classList.remove('show'), 5200);
  }

  /** A message that can be looked at takes you there; the rest just read. */
  private messageRow(m: CityMessage): HTMLElement {
    const row = el('button', 'message', m.text);
    row.addEventListener('click', () => {
      if (this.messageActions.focusOn(m.id)) this.messagePop.classList.remove('show');
      else this.toast('Nothing to show for that one yet');
    });
    return row;
  }

  private messageActions!: HudActions;
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
