// Procedural WebAudio sound effects + ambient "aero" music loop.
class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  engineOsc: OscillatorNode | null = null;
  engineOsc2: OscillatorNode | null = null;
  engineGain: GainNode | null = null;
  engineFilter: BiquadFilterNode | null = null;
  noiseBuf: AudioBuffer | null = null;
  muted = false;
  volume = 0.8;
  musicOn = false;
  private step = 0;
  private nextNoteTime = 0;
  private timer: number | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem('aero-muted') === '1';
      const v = Number(localStorage.getItem('aero-volume'));
      if (Number.isFinite(v) && v >= 0 && v <= 1) this.volume = v;
    } catch {
      /* ignore */
    }
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    // WebKitGTK (el motor de Linux en Tauri) nace en "suspended" aunque
    // se cree dentro de un clic: hay que reanudarlo explícitamente.
    if (ctx.state === 'suspended') void ctx.resume();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);

    // noise buffer
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // engine hum
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 60;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 120;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus);
    this.engineOsc.start();
    this.engineOsc2.start();
  }

  /** Reanuda el contexto si el motor lo dejó suspendido (típico en WebKitGTK). */
  unlock() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    try {
      localStorage.setItem('aero-muted', m ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem('aero-volume', String(this.volume));
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  engine(speedNorm: number, on: boolean, boosting: boolean) {
    if (!this.ctx || !this.engineOsc || !this.engineOsc2 || !this.engineGain || !this.engineFilter) return;
    const t = this.ctx.currentTime;
    const f = 55 + speedNorm * 70 + (boosting ? 30 : 0);
    this.engineOsc.frequency.setTargetAtTime(f, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(f * 2.01, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(350 + speedNorm * 600 + (boosting ? 900 : 0), t, 0.1);
    this.engineGain.gain.setTargetAtTime(on ? 0.05 + (boosting ? 0.03 : 0) : 0, t, 0.15);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number, bus?: GainNode | null) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus ?? this.sfxBus!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, fFrom: number, fTo: number, type: BiquadFilterType = 'bandpass', when = 0) {
    if (!this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(fFrom, t);
    f.frequency.exponentialRampToValueAtTime(fTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus!);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  pickup(combo: number) {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const n = scale[Math.min(scale.length - 1, combo % 11)];
    const f = 660 * Math.pow(2, n / 12);
    this.tone(f, 0.18, 'sine', 0.22);
    this.tone(f * 2, 0.12, 'sine', 0.08, 0.02);
  }
  boost() {
    this.noise(0.7, 0.35, 300, 3000, 'bandpass');
    this.tone(220, 0.5, 'sawtooth', 0.06, 0, 660);
  }
  pad() {
    this.tone(523, 0.12, 'square', 0.07);
    this.tone(784, 0.12, 'square', 0.07, 0.06);
    this.tone(1046, 0.2, 'square', 0.07, 0.12);
    this.noise(0.5, 0.25, 500, 4000);
  }
  nearMiss() {
    this.noise(0.35, 0.3, 2500, 500, 'bandpass');
    this.tone(1200, 0.15, 'triangle', 0.08, 0.05, 1800);
  }
  smash() {
    this.noise(0.5, 0.6, 2000, 150, 'lowpass');
    this.tone(180, 0.35, 'square', 0.15, 0, 60);
    this.tone(1318, 0.2, 'sine', 0.12, 0.05);
  }
  crash() {
    this.noise(0.9, 0.8, 1500, 80, 'lowpass');
    this.tone(140, 0.6, 'sawtooth', 0.2, 0, 40);
  }
  bump() {
    this.noise(0.15, 0.3, 3000, 800, 'highpass');
  }
  click() {
    this.ensure();
    this.tone(880, 0.08, 'sine', 0.15);
    this.tone(1320, 0.1, 'sine', 0.1, 0.04);
  }
  gameOver() {
    [523, 440, 349, 262].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.15, i * 0.14));
  }
  record() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.15, i * 0.08));
  }

  // ---------- Music ----------
  startMusic() {
    this.ensure();
    if (!this.ctx) return;
    // Si el motor lo dejó suspendido (WebKitGTK), reanímalo y reintenta en un
    // instante: si no, el planificador avanza el tiempo sobre un contexto parado
    // y se pierde toda la música.
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => this.startMusic());
      return;
    }
    if (this.musicOn) return;
    this.musicOn = true;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }
  stopMusic() {
    this.musicOn = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  private schedule() {
    if (!this.ctx) return;
    // Un contexto suspendido tiene currentTime congelado: si no lo saltamos,
    // el bucle se llenaría de notas para un tiempo que nunca llega.
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      return;
    }
    const spb = 60 / 112 / 2; // eighth notes at 112bpm
    // Cmaj7, Am9, Fmaj7, G6 in midi
    const chords = [
      [48, 55, 59, 64, 67],
      [45, 52, 55, 60, 64],
      [41, 48, 52, 57, 60],
      [43, 50, 55, 59, 64],
    ];
    const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
    while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
      const when = this.nextNoteTime - this.ctx.currentTime;
      const bar = Math.floor(this.step / 16) % 4;
      const s = this.step % 16;
      const ch = chords[bar];
      if (s === 0) {
        // pad
        ch.slice(1).forEach((m) => this.tone(mtof(m), spb * 15, 'sine', 0.05, when, undefined, this.musicBus));
        this.tone(mtof(ch[0] - 12), spb * 6, 'triangle', 0.16, when, undefined, this.musicBus);
      }
      if (s === 8) this.tone(mtof(ch[0] - 12), spb * 6, 'triangle', 0.12, when, undefined, this.musicBus);
      // bell arpeggio
      const arp = [0, 2, 3, 4, 3, 2, 4, 1];
      if (s % 2 === 0 || Math.random() < 0.3) {
        const m = ch[arp[s % 8]] + 12 + (s >= 12 ? 12 : 0);
        this.tone(mtof(m), spb * 2.5, 'sine', 0.07, when, undefined, this.musicBus);
      }
      // soft hat
      if (s % 2 === 1) this.noiseHat(when);
      this.step++;
      this.nextNoteTime += spb;
    }
  }
  private noiseHat(when: number) {
    if (!this.ctx || !this.noiseBuf || !this.musicBus) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicBus);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }
}

export const audio = new AudioEngine();
