import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Walker } from '../render/walker';
import type { Driver } from '../render/driver';

/** True on phones and tablets, where the primary pointer is a finger. */
export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Touch controls. On the map one finger pans and two fingers pinch and turn, except while a build
 * tool is in hand, when one finger draws and only two move the camera. At street level a joystick
 * on the left walks or drives, and dragging anywhere else looks around.
 */
export class TouchControls {
  readonly enabled = isTouchDevice();
  private pad = el('div', 'touch-pad');
  private knob = el('div', 'touch-knob');
  private buttons = el('div', 'touch-buttons');
  private mode: 'map' | 'walk' | 'drive' = 'map';
  private stick: { id: number; x: number; y: number } | null = null;
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private controls: OrbitControls;
  private walker: Walker;
  private driver: Driver;

  constructor(root: HTMLElement, canvas: HTMLCanvasElement, controls: OrbitControls, walker: Walker, driver: Driver, exit: () => void) {
    this.controls = controls; this.walker = walker; this.driver = driver;
    if (!this.enabled) return;
    document.body.classList.add('touch');
    this.pad.append(this.knob);
    const leave = el('button', 'touch-btn', 'Exit');
    leave.addEventListener('click', exit);
    const view = el('button', 'touch-btn', 'View');
    view.addEventListener('click', () => driver.toggleView());
    view.dataset.drive = '1';
    this.buttons.append(view, leave);
    this.pad.hidden = true; this.buttons.hidden = true;
    root.append(this.pad, this.buttons);

    this.pad.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const r = this.pad.getBoundingClientRect();
      this.stick = { id: e.pointerId, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.pad.setPointerCapture(e.pointerId);
      this.moveStick(e.clientX, e.clientY);
    });
    this.pad.addEventListener('pointermove', e => { if (this.stick?.id === e.pointerId) this.moveStick(e.clientX, e.clientY); });
    const release = (e: PointerEvent): void => {
      if (this.stick?.id !== e.pointerId) return;
      this.stick = null;
      this.knob.style.transform = '';
      this.walker.analog = { forward: 0, strafe: 0 };
      this.driver.analog = { throttle: 0, steer: 0 };
    };
    this.pad.addEventListener('pointerup', release);
    this.pad.addEventListener('pointercancel', release);

    // Looking around on foot: drag anywhere on the canvas that is not the joystick.
    canvas.addEventListener('pointerdown', e => {
      if (this.mode !== 'walk' || e.pointerType !== 'touch') return;
      this.lookId = e.pointerId; this.lookLast = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointermove', e => {
      if (this.lookId !== e.pointerId) return;
      this.walker.look(e.clientX - this.lookLast.x, e.clientY - this.lookLast.y);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent): void => { if (this.lookId === e.pointerId) this.lookId = null; };
    canvas.addEventListener('pointerup', endLook);
    canvas.addEventListener('pointercancel', endLook);
    this.setTool(false);
  }

  private moveStick(x: number, y: number): void {
    if (!this.stick) return;
    const max = 44;
    let dx = x - this.stick.x, dy = y - this.stick.y;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const fx = dx / max, fy = -dy / max;
    this.walker.analog = { forward: fy, strafe: fx };
    this.driver.analog = { throttle: fy, steer: -fx };
  }

  /** With a build tool in hand one finger draws, so only two fingers move the camera. */
  setTool(building: boolean): void {
    if (!this.enabled) return;
    this.controls.touches = {
      ONE: (building ? null : THREE.TOUCH.PAN) as unknown as THREE.TOUCH,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };
  }

  setMode(mode: 'map' | 'walk' | 'drive'): void {
    this.mode = mode;
    if (!this.enabled) return;
    this.pad.hidden = this.buttons.hidden = mode === 'map';
    for (const b of this.buttons.querySelectorAll<HTMLElement>('[data-drive]')) b.hidden = mode !== 'drive';
  }
}
