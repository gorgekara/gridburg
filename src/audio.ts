/**
 * Sound, all synthesised with the Web Audio API so there are no files to load: a city hum that
 * follows the traffic and the camera, birdsong by day and crickets by night, sirens while the
 * emergency services are out, short cues for building and bulldozing, and an engine and footsteps
 * at street level. Nothing plays until the first click or key press, as browsers require.
 */
export type Cue = 'click' | 'build' | 'bulldoze' | 'chime' | 'achievement' | 'error' | 'alarm' | 'cash';

export interface AmbientState {
  traffic: number; // cars on the road
  height: number; // camera height above the ground
  night: number; // 0 day .. 1 night
  emergencies: number; // fire engines and police cars out
  driving: number | null; // speed in km/h while driving
  walking: boolean; // a walker who is moving
  storm: boolean;
}

const KEY = 'gridburg.sound.v1';

export class CityAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: GainNode | null = null;
  private humFilter: BiquadFilterNode | null = null;
  private wind: GainNode | null = null;
  private siren: { osc: OscillatorNode; gain: GainNode } | null = null;
  private engine: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noise: AudioBuffer | null = null;
  private nextBird = 0;
  private nextCricket = 0;
  private nextStep = 0;
  enabled = true;
  volume = 0.7;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { enabled: boolean; volume: number } | null;
      if (saved) { this.enabled = saved.enabled !== false; this.volume = Number.isFinite(saved.volume) ? saved.volume : 0.7; }
    } catch { /* storage may be blocked */ }
    const start = (): void => { this.start(); window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  private persist(): void {
    try { localStorage.setItem(KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume })); } catch { /* storage may be blocked */ }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.persist();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.1);
  }

  toggle(): boolean { this.setEnabled(!this.enabled); return this.enabled; }

  private start(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(ctx.destination);
    // Two seconds of brown noise, looped, underlies the hum, the wind and every noisy cue.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
    this.noise = buffer;
    const loop = (filterType: BiquadFilterType, freq: number): [GainNode, BiquadFilterNode] => {
      const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = filterType; filter.frequency.value = freq;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master!);
      src.start();
      return [gain, filter];
    };
    [this.hum, this.humFilter] = loop('lowpass', 420);
    [this.wind] = loop('bandpass', 700);
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 700;
    const gain = ctx.createGain(); gain.gain.value = 0;
    osc.connect(gain).connect(this.master); osc.start();
    this.siren = { osc, gain };
    const eOsc = ctx.createOscillator(); eOsc.type = 'sawtooth'; eOsc.frequency.value = 40;
    const eFilter = ctx.createBiquadFilter(); eFilter.type = 'lowpass'; eFilter.frequency.value = 300;
    const eGain = ctx.createGain(); eGain.gain.value = 0;
    eOsc.connect(eFilter).connect(eGain).connect(this.master); eOsc.start();
    this.engine = { osc: eOsc, gain: eGain, filter: eFilter };
  }

  /** A short blip of filtered noise, for thuds, crunches and footsteps. */
  private burst(duration: number, freq: number, level: number, sweepTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.master) return;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = freq;
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, ctx.currentTime + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(ctx.currentTime, Math.random() * 1.5, duration + 0.05);
  }

  private tone(freq: number, at: number, duration: number, level: number, type: OscillatorType = 'sine', slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + at + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(level, ctx.currentTime + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + duration);
    osc.connect(gain).connect(this.master);
    osc.start(ctx.currentTime + at); osc.stop(ctx.currentTime + at + duration + 0.05);
  }

  play(cue: Cue): void {
    if (!this.ctx || !this.enabled) return;
    switch (cue) {
      case 'click': this.tone(1400, 0, 0.04, 0.08, 'square'); break;
      case 'build': this.tone(110, 0, 0.18, 0.35, 'sine', 60); this.burst(0.15, 900, 0.25); break;
      case 'bulldoze': this.burst(0.45, 1800, 0.45, 200); this.tone(70, 0, 0.3, 0.2, 'sawtooth', 40); break;
      case 'cash': this.tone(1320, 0, 0.12, 0.12); this.tone(1760, 0.08, 0.2, 0.12); break;
      case 'chime': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.11, 0.5, 0.14, 'triangle')); break;
      case 'achievement': [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, i * 0.08, 0.35, 0.12, 'triangle')); break;
      case 'error': this.tone(180, 0, 0.12, 0.15, 'square'); this.tone(140, 0.12, 0.16, 0.15, 'square'); break;
      case 'alarm': for (let k = 0; k < 4; k++) { this.tone(620, k * 0.5, 0.25, 0.14, 'sawtooth'); this.tone(470, k * 0.5 + 0.25, 0.25, 0.14, 'sawtooth'); } break;
    }
  }

  /** Called every frame with the state of the city and the camera. */
  update(s: AmbientState, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.hum || !this.wind || !this.siren || !this.engine || !this.humFilter) return;
    const now = ctx.currentTime;
    const near = Math.max(0, Math.min(1, 1 - (s.height - 2) / 60)); // 1 at street level, 0 high above
    const street = s.driving !== null || s.walking || s.height < 1;
    this.hum.gain.setTargetAtTime(Math.min(0.35, 0.04 + s.traffic / 900) * (0.35 + near * 0.65), now, 0.4);
    this.humFilter.frequency.setTargetAtTime(street ? 900 : 320 + near * 300, now, 0.4);
    this.wind.gain.setTargetAtTime((1 - near) * 0.12 + (s.storm ? 0.25 : 0), now, 0.8);
    // A two-tone wail while emergency vehicles are out, louder close to the ground.
    const wail = s.emergencies > 0 ? Math.min(0.05, 0.015 * s.emergencies) * (0.3 + near * 0.7) : 0;
    this.siren.gain.gain.setTargetAtTime(wail, now, 0.3);
    this.siren.osc.frequency.setTargetAtTime(Math.floor(now * 1.4) % 2 ? 960 : 720, now, 0.05);
    // The engine rises with speed.
    const kmh = s.driving ?? 0;
    this.engine.gain.gain.setTargetAtTime(s.driving !== null ? 0.08 + Math.min(0.07, kmh / 1500) : 0, now, 0.1);
    this.engine.osc.frequency.setTargetAtTime(38 + kmh * 1.1, now, 0.1);
    this.engine.filter.frequency.setTargetAtTime(250 + kmh * 8, now, 0.1);
    // Birds by day and crickets by night, only when close enough to hear them.
    if (near > 0.4 && this.enabled) {
      if (s.night < 0.4 && now > this.nextBird) {
        const base = 2200 + Math.random() * 1800;
        for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) this.tone(base * (1 + Math.random() * 0.2), k * 0.09, 0.07, 0.03 * near, 'sine', base * 1.35);
        this.nextBird = now + 1.5 + Math.random() * 4;
      }
      if (s.night > 0.6 && now > this.nextCricket) {
        for (let k = 0; k < 3; k++) this.tone(4300, k * 0.06, 0.035, 0.012 * near, 'sine');
        this.nextCricket = now + 0.7 + Math.random() * 1.5;
      }
    }
    if (s.walking && now > this.nextStep) { this.burst(0.06, 500, 0.12); this.nextStep = now + 0.42; }
    void dt;
  }
}
