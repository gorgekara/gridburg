import { visualDetail, type VisualDetail } from '../render/detail';
import { icon } from './icons';
import { deleteSlot, listSlots } from '../slots';

export interface Settings {
  shadows: boolean;
  visualDetail: VisualDetail;
  dayLength: number;
  autosave: boolean;
  infiniteMoney: boolean;
  disasters: boolean;
}

export const DEFAULT_SETTINGS: Settings = { shadows: true, visualDetail: 1, dayLength: 480, autosave: true, infiniteMoney: false, disasters: true };

const KEY = 'gridburg.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    const settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) as Partial<Settings> } : { ...DEFAULT_SETTINGS };
    settings.visualDetail = visualDetail(settings.visualDetail);
    return settings;
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage may be blocked */ }
}

export interface MenuActions {
  continueCity(): void;
  newCity(seed: number): void;
  demoCity(): void;
  resume(): void;
  help(): void;
  apply(settings: Settings): void;
  loadSlot(name: string): void;
}

interface SaveInfo { population: number; day: number }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

const randomSeed = (): number => Math.floor(Math.random() * 0xffffffff) >>> 0;

/** Front screen: continue a city, start one on a chosen map, or change settings. The HUD menu reopens it. */
export class MainMenu {
  readonly root = el('div', 'menu-screen');
  private panels = el('div', 'menu-body');
  private pages = new Map<string, HTMLElement>();
  private resumeBtn = el('button', 'menu-item primary');
  private continueBtn = el('button', 'menu-item');
  private continueNote = el('span', 'menu-note');
  private seed = randomSeed();
  private seedField = el('input', 'menu-seed') as HTMLInputElement;
  private actions: MenuActions;
  private slotsPage = el('div', 'menu-page');
  settings: Settings;
  open = false;

  constructor(host: HTMLElement, actions: MenuActions, settings: Settings) {
    this.actions = actions;
    this.settings = settings;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Main menu');
    const card = el('div', 'menu-card');
    const title = el('div', 'menu-title');
    title.append(el('h1', undefined, 'Gridburg'), el('p', 'menu-sub', 'Lay out the roads, zone the land, and grow a city.'));
    card.append(title, this.panels);
    this.root.append(card);
    host.append(this.root);
    this.buildHome();
    this.buildNew();
    this.buildSettings();
    this.slotsPage.className = 'menu-page';
    this.pages.set('slots', this.slotsPage);
    this.panels.append(this.slotsPage);
    this.show('home');
    this.root.hidden = true;
  }

  private show(page: string): void {
    for (const [id, node] of this.pages) node.hidden = id !== page;
  }

  private button(label: string, hint: string, onClick: () => void, ic?: string): HTMLButtonElement {
    const b = el('button', 'menu-item');
    if (ic) b.append(icon(ic, 20));
    const text = el('span', 'menu-label');
    text.append(el('strong', undefined, label), el('span', 'menu-note', hint));
    b.append(text);
    b.addEventListener('click', onClick);
    return b;
  }

  private buildHome(): void {
    const page = el('div', 'menu-page');
    this.resumeBtn.append(icon('play', 20));
    const resumeText = el('span', 'menu-label');
    resumeText.append(el('strong', undefined, 'Resume'), el('span', 'menu-note', 'Back to your city'));
    this.resumeBtn.append(resumeText);
    this.resumeBtn.addEventListener('click', () => this.actions.resume());

    this.continueBtn.append(icon('city', 20));
    const continueText = el('span', 'menu-label');
    continueText.append(el('strong', undefined, 'Continue'), this.continueNote);
    this.continueBtn.append(continueText);
    this.continueBtn.addEventListener('click', () => this.actions.continueCity());

    page.append(
      this.resumeBtn,
      this.continueBtn,
      this.button('New city', 'A fresh river valley to build on', () => { this.seed = randomSeed(); this.seedField.value = String(this.seed); this.show('new'); }, 'plus'),
      this.button('Demo city', 'A finished city to look around', () => this.actions.demoCity(), 'city'),
      this.button('Saved cities', 'Cities you saved by name', () => { this.buildSlots(); this.show('slots'); }, 'save'),
      this.button('Settings', 'Graphics, day length and cheats', () => this.show('settings'), 'menu'),
      this.button('How to play', 'The basics, in five steps', () => this.actions.help(), 'help'),
    );
    this.pages.set('home', page);
    this.panels.append(page);
  }

  private buildNew(): void {
    const page = el('div', 'menu-page');
    page.append(el('h2', 'menu-heading', 'New city'));
    page.append(el('p', 'menu-note', 'Every seed lays out a different river valley. Keep one you like by noting its number.'));

    const seedRow = el('div', 'menu-row');
    this.seedField.type = 'text';
    this.seedField.inputMode = 'numeric';
    this.seedField.value = String(this.seed);
    this.seedField.setAttribute('aria-label', 'Map seed');
    const dice = el('button', 'menu-mini', 'Random');
    dice.addEventListener('click', () => { this.seed = randomSeed(); this.seedField.value = String(this.seed); });
    seedRow.append(el('span', 'menu-note', 'Seed'), this.seedField, dice);
    page.append(seedRow);

    const actions = el('div', 'menu-row end');
    const back = el('button', 'menu-mini', 'Back');
    back.addEventListener('click', () => this.show('home'));
    const start = el('button', 'menu-mini primary', 'Start city');
    start.addEventListener('click', () => {
      const typed = Number.parseInt(this.seedField.value, 10);
      this.actions.newCity(Number.isFinite(typed) ? typed >>> 0 : this.seed);
    });
    actions.append(back, start);
    page.append(actions);
    this.pages.set('new', page);
    this.panels.append(page);
  }

  private back(): HTMLElement {
    const row = el('div', 'menu-row end');
    const back = el('button', 'menu-mini', 'Back');
    back.addEventListener('click', () => this.show('home'));
    row.append(back);
    return row;
  }

  private buildSlots(): void {
    const page = this.slotsPage;
    page.replaceChildren(el('h2', 'menu-heading', 'Saved cities'));
    const slots = listSlots();
    if (!slots.length) page.append(el('p', 'menu-note', 'Nothing saved yet. In a city, open the menu and choose “Save or load cities”.'));
    for (const slot of slots) {
      const row = el('div', 'menu-row');
      const load = this.button(slot.name, `${slot.population.toLocaleString()} residents · day ${slot.day} · ${new Date(slot.savedAt).toLocaleDateString()}`, () => this.actions.loadSlot(slot.name), 'city');
      const del = el('button', 'menu-mini', 'Delete');
      del.addEventListener('click', () => { if (confirm(`Delete “${slot.name}”?`)) { deleteSlot(slot.name); this.buildSlots(); } });
      row.append(load, del);
      page.append(row);
    }
    page.append(this.back());
  }

  private toggle(label: string, hint: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
    const row = el('label', 'menu-setting');
    const text = el('span', 'menu-label');
    text.append(el('strong', undefined, label), el('span', 'menu-note', hint));
    const box = el('input') as HTMLInputElement;
    box.type = 'checkbox';
    box.checked = get();
    box.addEventListener('change', () => { set(box.checked); this.commit(); });
    row.append(text, box);
    return row;
  }

  private buildSettings(): void {
    const page = el('div', 'menu-page');
    page.append(el('h2', 'menu-heading', 'Settings'));
    const detailRow = el('label', 'menu-setting');
    const detailText = el('span', 'menu-label');
    detailText.append(el('strong', undefined, 'Visual detail'), el('span', 'menu-note', 'Buildings, trees and vehicles. Low favors speed; High adds finer details. Applies immediately.'));
    const detailSelect = el('select', 'menu-select');
    detailSelect.setAttribute('aria-label', 'Visual detail');
    for (const [value, label] of [[0, 'Low'], [1, 'Balanced'], [2, 'High']] as const) {
      const option = el('option', undefined, label);
      option.value = String(value);
      detailSelect.append(option);
    }
    detailSelect.value = String(this.settings.visualDetail);
    detailSelect.addEventListener('change', () => { this.settings.visualDetail = visualDetail(Number(detailSelect.value)); this.commit(); });
    detailRow.append(detailText, detailSelect);
    page.append(detailRow);
    page.append(this.toggle('Shadows', 'Turn off for more speed on weak hardware', () => this.settings.shadows, v => { this.settings.shadows = v; }));
    page.append(this.toggle('Save automatically', 'Keeps your city in this browser', () => this.settings.autosave, v => { this.settings.autosave = v; }));
    page.append(this.toggle('Disasters', 'Floods and tornadoes, from Small town on', () => this.settings.disasters, v => { this.settings.disasters = v; }));
    page.append(this.toggle('Infinite money', 'Building is free and the treasury stays full', () => this.settings.infiniteMoney, v => { this.settings.infiniteMoney = v; }));

    const row = el('label', 'menu-setting');
    const text = el('span', 'menu-label');
    text.append(el('strong', undefined, 'Day length'), el('span', 'menu-note', 'How long a day and night takes'));
    const select = el('select', 'menu-select') as HTMLSelectElement;
    for (const [label, seconds] of [['Quick · 4 min', 240], ['Normal · 8 min', 480], ['Long · 16 min', 960], ['Always day', 1e9]] as [string, number][]) {
      const option = el('option', undefined, label) as HTMLOptionElement;
      option.value = String(seconds);
      select.append(option);
    }
    select.value = String(this.settings.dayLength);
    select.addEventListener('change', () => { this.settings.dayLength = Number(select.value); this.commit(); });
    row.append(text, select);
    page.append(row);

    const actions = el('div', 'menu-row end');
    const back = el('button', 'menu-mini', 'Back');
    back.addEventListener('click', () => this.show('home'));
    actions.append(back);
    page.append(actions);
    this.pages.set('settings', page);
    this.panels.append(page);
  }

  private commit(): void {
    saveSettings(this.settings);
    this.actions.apply(this.settings);
  }

  /** Reflects the local save on the Continue button, and whether a city is already running. */
  setSave(info: SaveInfo | null, running: boolean): void {
    this.continueBtn.hidden = !info;
    this.resumeBtn.hidden = !running;
    if (info) this.continueNote.textContent = `${info.population.toLocaleString()} residents · day ${info.day}`;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.hidden = !open;
    if (open) this.show('home');
  }
}
