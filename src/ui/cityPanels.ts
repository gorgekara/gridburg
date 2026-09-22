import { icon } from './icons';
import { ACHIEVEMENTS } from '../achievements';
import type { AchievementLog } from '../achievements';
import { DISTRICT_COLORS, DISTRICT_COUNT, DISTRICT_POLICIES, DISTRICT_POLICY_IDS, districtHas } from '../extras';
import type { Game } from '../game';
import type { Stats } from '../sim/messages';
import { daysLeft, scenarioById } from '../scenarios';
import { deleteSlot, listSlots, loadSlot, saveSlot } from '../slots';
import type { SaveData } from '../save';
import { N_TILES, isZone } from '../constants';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export type MapView = 'none' | 'land' | 'noise' | 'crime' | 'wellbeing' | 'garbage' | 'districts' | 'flood';
export const MAP_VIEWS: { id: MapView; label: string; note: string }[] = [
  { id: 'none', label: 'Normal', note: 'Just the city' },
  { id: 'land', label: 'Land value', note: 'Green is sought after, red is not' },
  { id: 'wellbeing', label: 'Well-being', note: 'How content each household is' },
  { id: 'noise', label: 'Noise', note: 'Traffic, industry, nightlife, the airport' },
  { id: 'crime', label: 'Crime', note: 'Where police patrols are needed' },
  { id: 'garbage', label: 'Rubbish', note: 'Bins nobody has emptied yet' },
  { id: 'districts', label: 'Districts', note: 'Painted districts and their names' },
  { id: 'flood', label: 'Flood risk', note: 'Low ground a flood would reach' },
];

/** One sampled moment of the city, for the statistics charts. */
interface Sample { day: number; pop: number; money: number; income: number; happiness: number; jobs: number; land: number; visitors: number; demand: [number, number, number, number] }
const HISTORY_LIMIT = 600;

export interface PanelActions {
  setView(view: MapView): void;
  undo(): void;
  toggleSound(): boolean;
  soundOn(): boolean;
  loadCity(d: SaveData): void;
  /** The district tool's brush and whether the district panel should show. */
  districtChanged(): void;
  day(): number;
}

/**
 * Panels that sit beside the HUD: map views, statistics, achievements, districts, the scenario tracker
 * and named saves. They reuse the HUD's popover styling and add their buttons to its top-right bar.
 */
export class CityPanels {
  view: MapView = 'none';
  private history: Sample[] = [];
  private viewPop = el('div', 'popover views');
  private statsPop = el('div', 'popover stats');
  private trophyPop = el('div', 'popover trophies');
  private districtPop = el('div', 'popover districts');
  private savePop = el('div', 'popover saves');
  private scenarioCard = el('div', 'scenario-card');
  private scenarioResult = el('div', 'scenario-result');
  private viewBtns = new Map<MapView, HTMLButtonElement>();
  private charts: { canvas: HTMLCanvasElement; label: HTMLElement; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }[] = [];
  private undoBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private viewBtn: HTMLButtonElement;
  private trophyList = el('div', 'trophy-list');
  private districtName = el('input', 'district-name');
  private districtSwatches: HTMLButtonElement[] = [];
  private districtPolicyBoxes = new Map<string, HTMLInputElement>();
  private districtInfo = el('p', 'pnote');
  private brush = 1;
  private lastDay = -1;

  private game: Game;
  private achievements: AchievementLog;
  private actions: PanelActions;
  private onBrush: (d: number) => void;

  constructor(root: HTMLElement, rightBar: HTMLElement, menu: HTMLElement, game: Game, achievements: AchievementLog, actions: PanelActions, onBrush: (d: number) => void) {
    this.game = game; this.achievements = achievements; this.actions = actions; this.onBrush = onBrush;
    const btn = (ic: string, title: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', 'iconbtn'); b.title = title; b.append(icon(ic, 19)); b.addEventListener('click', fn); return b;
    };
    const pops = [this.viewPop, this.statsPop, this.trophyPop, this.savePop];
    const toggle = (pop: HTMLElement): void => { for (const p of pops) if (p !== pop) p.classList.remove('open'); pop.classList.toggle('open'); if (pop === this.statsPop) this.drawCharts(); };
    this.viewBtn = btn('layers', 'Map views', () => toggle(this.viewPop));
    const statsBtn = btn('chart', 'Statistics', () => toggle(this.statsPop));
    const trophyBtn = btn('trophy', 'Achievements', () => { this.renderTrophies(); toggle(this.trophyPop); });
    this.undoBtn = btn('undo', 'Undo (Ctrl+Z)', () => actions.undo());
    this.soundBtn = btn(actions.soundOn() ? 'sound' : 'mute', 'Sound', () => this.setSoundIcon(actions.toggleSound()));
    rightBar.prepend(this.undoBtn, this.viewBtn, statsBtn, trophyBtn, this.soundBtn);
    window.addEventListener('pointerdown', e => {
      const t = e.target as Node;
      for (const [pop, b] of [[this.viewPop, this.viewBtn], [this.statsPop, statsBtn], [this.trophyPop, trophyBtn], [this.savePop, null]] as [HTMLElement, HTMLElement | null][]) {
        if (!pop.contains(t) && !(b && b.contains(t)) && !menu.contains(t)) pop.classList.remove('open');
      }
    });

    // Map views.
    this.viewPop.append(el('div', 'ptitle', 'Map views'));
    for (const v of MAP_VIEWS) {
      const b = el('button', 'mitem view-item');
      const text = el('span', 'policy-text');
      text.append(el('strong', undefined, v.label), el('span', 'pnote', v.note));
      b.append(text);
      b.addEventListener('click', () => this.setView(v.id));
      this.viewBtns.set(v.id, b);
      this.viewPop.append(b);
    }
    this.setView('none');

    // Statistics.
    this.statsPop.append(el('div', 'ptitle', 'City statistics'), el('p', 'pnote', 'Sampled every simulation second since the city was loaded.'));
    const grid = el('div', 'chart-grid');
    const chart = (title: string, series: { color: string; get: (s: Sample) => number }[], fmt: (v: number) => string, fixed?: [number, number]): void => {
      const card = el('div', 'chart-card');
      const label = el('span', 'chart-label', title);
      const canvas = el('canvas'); canvas.width = 300; canvas.height = 110;
      card.append(label, canvas);
      grid.append(card);
      this.charts.push({ canvas, label, draw: (ctx, w, h) => {
        const data = this.history;
        if (data.length < 2) { ctx.fillStyle = '#9aa6b5'; ctx.font = '12px system-ui'; ctx.fillText('Collecting…', 10, h / 2); return; }
        let lo = Infinity, hi = -Infinity;
        for (const s of data) for (const se of series) { const v = se.get(s); lo = Math.min(lo, v); hi = Math.max(hi, v); }
        if (fixed) { lo = fixed[0]; hi = fixed[1]; }
        if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
        for (let k = 0; k <= 2; k++) { const y = 6 + (h - 12) * k / 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
        for (const se of series) {
          ctx.strokeStyle = se.color; ctx.lineWidth = 2; ctx.beginPath();
          data.forEach((s, i) => { const x = i / (data.length - 1) * w, y = 6 + (h - 12) * (1 - (se.get(s) - lo) / (hi - lo)); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
          ctx.stroke();
        }
        const last = data[data.length - 1];
        label.textContent = `${title} · ${series.map(se => fmt(se.get(last))).join(' / ')}`;
      } });
    };
    const money = (v: number): string => `$${Math.round(v).toLocaleString()}`;
    chart('Population', [{ color: '#62c46a', get: s => s.pop }, { color: '#4f8fe8', get: s => s.jobs }], v => Math.round(v).toLocaleString());
    chart('Treasury', [{ color: '#ffd166', get: s => s.money }], money);
    chart('Net income /s', [{ color: '#ffd166', get: s => s.income }], v => `$${v.toFixed(1)}`);
    chart('Happiness', [{ color: '#e07fb0', get: s => s.happiness }], v => `${Math.round(v)}`, [0, 100]);
    chart('Land value', [{ color: '#7fc4a8', get: s => s.land }], v => `${Math.round(v)}`, [0, 100]);
    chart('Visitors /min', [{ color: '#e0a021', get: s => s.visitors }], v => `${Math.round(v)}`);
    chart('Demand R C I O', [0, 1, 2, 3].map(k => ({ color: ['#62c46a', '#4f8fe8', '#e6b93a', '#b791e0'][k], get: (s: Sample) => s.demand[k] * 100 })), v => `${Math.round(v)}`, [-100, 100]);
    this.statsPop.append(grid);

    // Achievements.
    this.trophyPop.append(el('div', 'ptitle', 'Achievements'), el('p', 'pnote', 'Earned in any city, remembered in this browser.'), this.trophyList);

    // Districts.
    this.districtPop.append(el('div', 'ptitle', 'Districts'));
    const swatches = el('div', 'district-swatches');
    for (let d = 1; d <= DISTRICT_COUNT; d++) {
      const b = el('button', 'district-swatch');
      b.style.setProperty('--swatch', `#${DISTRICT_COLORS[d - 1].toString(16).padStart(6, '0')}`);
      b.title = `District ${d}`;
      b.addEventListener('click', () => this.selectDistrict(d));
      this.districtSwatches.push(b); swatches.append(b);
    }
    this.districtName.type = 'text'; this.districtName.maxLength = 32;
    this.districtName.setAttribute('aria-label', 'District name');
    this.districtName.addEventListener('input', () => { game.renameDistrict(this.brush, this.districtName.value); actions.districtChanged(); });
    this.districtPop.append(swatches, this.districtName, this.districtInfo);
    for (const id of DISTRICT_POLICY_IDS) {
      const spec = DISTRICT_POLICIES[id];
      const row = el('label', 'policy-row');
      const box = el('input'); box.type = 'checkbox';
      box.addEventListener('change', () => {
        let mask = game.extras.districtPolicies[this.brush - 1];
        const bit = 1 << DISTRICT_POLICY_IDS.indexOf(id);
        mask = box.checked ? mask | bit : mask & ~bit;
        game.setDistrictPolicy(this.brush, mask);
        this.refreshDistrict();
      });
      const text = el('span', 'policy-text');
      text.append(el('strong', undefined, spec.label), el('span', 'policy-effect', spec.effect), el('span', 'policy-cost', spec.perBuilding ? `$0.20/s + $${spec.perBuilding.toFixed(3)}/s per building` : '$0.20/s'));
      row.append(icon('district', 18), text, box);
      this.districtPolicyBoxes.set(id, box);
      this.districtPop.append(row);
    }
    this.selectDistrict(1);

    // Named saves, opened from the menu.
    const menuItem = (ic: string, label: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', 'mitem'); b.append(icon(ic, 17), el('span', undefined, label));
      b.addEventListener('click', () => { menu.classList.remove('open'); fn(); }); return b;
    };
    menu.prepend(menuItem('save', 'Save or load cities', () => { this.renderSaves(); this.savePop.classList.add('open'); }));

    this.scenarioCard.hidden = true;
    this.scenarioResult.hidden = true;
    root.append(this.viewPop, this.statsPop, this.trophyPop, this.districtPop, this.savePop, this.scenarioCard, this.scenarioResult);
  }

  private setSoundIcon(on: boolean): void {
    this.soundBtn.replaceChildren(icon(on ? 'sound' : 'mute', 19));
    this.soundBtn.classList.toggle('active', false);
  }

  setView(view: MapView): void {
    this.view = view;
    for (const [id, b] of this.viewBtns) b.classList.toggle('active', id === view);
    this.viewBtn.classList.toggle('active', view !== 'none');
    this.actions.setView(view);
  }

  /** Show the district panel while a district tool is in hand. */
  showDistricts(on: boolean): void {
    this.districtPop.classList.toggle('open', on);
    if (on) this.refreshDistrict();
  }

  private selectDistrict(d: number): void {
    this.brush = d;
    this.onBrush(d);
    this.districtSwatches.forEach((b, i) => b.classList.toggle('active', i + 1 === d));
    this.refreshDistrict();
  }

  refreshDistrict(): void {
    const d = this.brush, mask = this.game.extras.districtPolicies[d - 1];
    if (document.activeElement !== this.districtName) this.districtName.value = this.game.extras.districtNames[d - 1];
    for (const [id, box] of this.districtPolicyBoxes) box.checked = districtHas(mask, id as typeof DISTRICT_POLICY_IDS[number]);
    let cells = 0, built = 0;
    for (let i = 0; i < N_TILES; i++) if (this.game.extras.district[i] === d) { cells++; if (isZone(this.game.kind[i]) && this.game.level[i]) built++; }
    this.districtInfo.textContent = cells ? `${cells} cells · ${built} buildings. Drag on the map to paint more.` : 'Pick a colour, then drag on the map to paint this district.';
    this.actions.districtChanged();
  }

  private renderTrophies(): void {
    this.trophyList.replaceChildren();
    const earned = ACHIEVEMENTS.filter(a => this.achievements.earned[a.id]).length;
    this.trophyList.append(el('p', 'pnote', `${earned} of ${ACHIEVEMENTS.length} earned`));
    for (const a of ACHIEVEMENTS) {
      const row = el('div', `trophy${this.achievements.earned[a.id] ? ' earned' : ''}`);
      row.append(icon('trophy', 18));
      const text = el('span', 'policy-text');
      text.append(el('strong', undefined, a.title), el('span', 'pnote', a.text));
      row.append(text);
      this.trophyList.append(row);
    }
  }

  private renderSaves(): void {
    this.savePop.replaceChildren(el('div', 'ptitle', 'Saved cities'));
    const row = el('div', 'save-row');
    const name = el('input'); name.type = 'text'; name.placeholder = 'Name this city'; name.maxLength = 40;
    name.value = this.game.extras.scenario ? `${scenarioById(this.game.extras.scenario.id)?.title ?? 'Scenario'} day ${this.actions.day()}` : `City day ${this.actions.day()}`;
    const save = el('button', 'finance-action', 'Save');
    save.addEventListener('click', () => {
      if (saveSlot(name.value, this.game.snapshot(), this.actions.day())) this.renderSaves();
    });
    row.append(name, save);
    this.savePop.append(row);
    const slots = listSlots();
    if (!slots.length) this.savePop.append(el('p', 'pnote', 'No saved cities yet. Your current city also saves itself automatically.'));
    for (const slot of slots) {
      const line = el('div', 'save-slot');
      const text = el('span', 'policy-text');
      text.append(el('strong', undefined, slot.name), el('span', 'pnote', `${slot.population.toLocaleString()} residents · day ${slot.day} · ${new Date(slot.savedAt).toLocaleString()}`));
      const load = el('button', 'finance-action', 'Load');
      load.addEventListener('click', () => {
        const d = loadSlot(slot.name);
        if (d && confirm(`Load “${slot.name}”? Unsaved progress in this city will be lost.`)) { this.savePop.classList.remove('open'); this.actions.loadCity(d); }
      });
      const del = el('button', 'finance-action', 'Delete');
      del.addEventListener('click', () => { if (confirm(`Delete “${slot.name}”?`)) { deleteSlot(slot.name); this.renderSaves(); } });
      line.append(text, load, del);
      this.savePop.append(line);
    }
  }

  /** Forget the charts, for a newly loaded city. */
  resetHistory(): void { this.history = []; this.lastDay = -1; }

  record(s: Stats, day: number): void {
    if (s.tick === this.lastDay) return;
    this.lastDay = s.tick;
    this.history.push({ day, pop: s.pop, money: s.money, income: s.income, happiness: s.happiness, jobs: s.jobs, land: s.landValue, visitors: s.tourism.visitors, demand: [...s.demand] as Sample['demand'] });
    if (this.history.length > HISTORY_LIMIT) this.history.splice(0, this.history.length - HISTORY_LIMIT);
    if (this.statsPop.classList.contains('open') && this.history.length % 2 === 0) this.drawCharts();
    this.undoBtn.disabled = !this.game.canUndo;
    this.updateScenario(s);
  }

  private drawCharts(): void {
    for (const c of this.charts) {
      const ctx = c.canvas.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
      c.draw(ctx, c.canvas.width, c.canvas.height);
    }
  }

  onScenarioDone: ((result: 'won' | 'lost') => void) | null = null;

  private updateScenario(s: Stats): void {
    const state = this.game.extras.scenario;
    const scenario = state ? scenarioById(state.id) : undefined;
    this.scenarioCard.hidden = !scenario;
    if (!scenario || !state) return;
    const left = daysLeft(scenario, state.startTick, s.tick);
    this.scenarioCard.replaceChildren(el('strong', undefined, scenario.title), el('span', 'pnote', state.done ? (state.done === 'won' ? 'Won — keep building' : 'Out of time — keep building') : `${Math.max(0, left).toFixed(1)} days left`));
    for (const g of scenario.goals) {
      const row = el('div', `goal${g.met(s) ? ' met' : ''}`);
      row.append(el('span', 'goal-mark', g.met(s) ? '✓' : '○'), el('span', undefined, g.label), el('span', 'goal-value', g.value(s)));
      this.scenarioCard.append(row);
    }
    if (state.done) return;
    const result = scenario.goals.every(g => g.met(s)) ? 'won' : left < 0 ? 'lost' : null;
    if (!result) return;
    state.done = result;
    this.scenarioResult.replaceChildren();
    const card = el('div', 'scenario-result-card');
    const close = el('button', 'menu-mini primary', 'Keep building');
    close.addEventListener('click', () => { this.scenarioResult.hidden = true; });
    card.append(el('h2', undefined, result === 'won' ? 'Scenario complete!' : 'Out of time'), el('p', undefined, result === 'won' ? `You met every goal of “${scenario.title}”.` : `The deadline for “${scenario.title}” has passed. You can keep playing this city, or try the scenario again from the main menu.`), close);
    this.scenarioResult.append(card);
    this.scenarioResult.hidden = false;
    this.onScenarioDone?.(result);
  }
}
