import { Network } from '../roads/network';
import { allTurns, turnName } from '../roads/signals';
import type { Movement } from '../roads/signals';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** What the turn editor asks the game to do. */
export interface TurnActions {
  /** Ban or allow one movement at the node. */
  toggle(key: string): void;
  /** Allow every turn again. */
  reset(): void;
  close(): void;
}

const ARROW = { Left: '↰', Straight: '↑', Right: '↱' } as const;

/** The compass direction traffic arrives from along a road into a node. */
function fromWhere(net: Network, segId: number, fwd: boolean): string {
  const s = net.segs.get(segId)!;
  const p = { x: 0, z: 0, tx: 0, tz: 0 };
  Network.poseAt(s, fwd ? s.len : 0, p);
  // Travelling fwd arrives at b heading +t; it comes from the opposite way.
  const dx = fwd ? -p.tx : p.tx, dz = fwd ? -p.tz : p.tz;
  const a = Math.atan2(dx, -dz); // 0 = from the north (smaller z), clockwise
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/**
 * The junction's turn editor: every road arriving, with a button for each way on from it that bans
 * or allows that turn. The last way on from a road cannot be banned, or its traffic would be stuck.
 */
export class TurnPanel {
  readonly root = el('div', 'popover turns');
  private net: Network | null = null;
  private node = -1;
  private actions: TurnActions;

  constructor(actions: TurnActions) { this.actions = actions; }

  open(net: Network, node: number): void {
    this.net = net; this.node = node;
    this.render();
    this.root.classList.add('open');
  }

  close(): void { this.node = -1; this.root.classList.remove('open'); }

  get isOpen(): boolean { return this.node >= 0; }
  get openNode(): number { return this.node; }

  render(): void {
    const net = this.net!, a = this.actions, node = net.nodes.get(this.node);
    if (!node) { a.close(); return; }
    this.root.replaceChildren();
    const head = el('div', 'signal-head');
    head.append(el('div', 'ptitle', 'Junction turns'));
    const x = el('button', 'signal-x', '×'); x.title = 'Close'; x.addEventListener('click', () => a.close());
    head.append(x);
    this.root.append(head, el('p', 'pnote', 'Ban a turn to keep traffic from making it here; drivers find another way. Each road keeps at least one way on.'));
    const bans = new Set(node.bans ?? []);
    const arms = new Map<string, Movement[]>();
    for (const m of allTurns(net, this.node)) {
      const id = `${m.inSeg}${m.inFwd ? 'f' : 'b'}`;
      arms.set(id, [...(arms.get(id) ?? []), m]);
    }
    const list = el('div', 'turn-arms');
    for (const moves of arms.values()) {
      const row = el('div', 'turn-arm');
      row.append(el('span', 'turn-from', `From the ${fromWhere(net, moves[0].inSeg, moves[0].inFwd)}`));
      const open = moves.filter(m => !bans.has(m.key)).length;
      for (const m of [...moves].sort((p, q) => p.angle - q.angle)) {
        const banned = bans.has(m.key), name = turnName(m);
        const b = el('button', `turn-btn${banned ? ' banned' : ''}`, ARROW[name]);
        b.title = `${name}: ${banned ? 'banned, click to allow' : 'allowed, click to ban'}`;
        b.setAttribute('aria-label', `${name} ${banned ? 'banned' : 'allowed'}`);
        b.disabled = !banned && open <= 1;
        b.addEventListener('click', () => a.toggle(m.key));
        row.append(b);
      }
      list.append(row);
    }
    this.root.append(list);
    const foot = el('div', 'signal-foot');
    const reset = el('button', 'signal-btn', 'Allow every turn');
    reset.disabled = !bans.size;
    reset.addEventListener('click', () => a.reset());
    foot.append(reset);
    this.root.append(foot);
  }
}
