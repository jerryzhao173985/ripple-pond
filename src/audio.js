/**
 * Minimal procedural sound — no asset files. Created lazily on first user gesture
 * (browser autoplay policy). Safe to call before resume(); it just no-ops.
 */
export class Audio {
  constructor() { this.ctx = null; this.muted = false; }

  resume() {
    if (this.muted) return;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.muted = true; return; }
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  _blip(freq, dur, type = 'sine', gain = 0.08, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  plip() { this._blip(420 + Math.random() * 80, 0.12, 'sine', 0.05, 230); }
  collect() { this._blip(660, 0.12, 'triangle', 0.09, 990); }
  win() {
    [523, 659, 784, 1047].forEach((f, i) =>
      setTimeout(() => this._blip(f, 0.18, 'triangle', 0.08), i * 110));
  }
}
