// Procedurally synthesised audio — no sound files.
// Owner: audio agent. Public API: gunshot(id), impact(), ambience(), update(dt).
export class Audio {
  constructor(ctx) {
    this.ctx = ctx;
    this.ac = null;
    const start = () => { if (!this.ac) { this.ac = new (window.AudioContext || window.webkitAudioContext)(); this.master = this.ac.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ac.destination); } };
    addEventListener('mousedown', start, { once: true });
    addEventListener('keydown', start, { once: true });
  }
  noiseBuffer(dur) {
    const n = Math.floor(this.ac.sampleRate * dur);
    const b = this.ac.createBuffer(1, n, this.ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    return b;
  }
  gunshot(id) {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuffer(0.22);
    const bp = this.ac.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = id === 'sniper' ? 900 : 1600; bp.Q.value = 0.8;
    const g = this.ac.createGain();
    g.gain.setValueAtTime(id === 'sniper' ? 1.0 : 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    const osc = this.ac.createOscillator(), og = this.ac.createGain();
    osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(og).connect(this.master); osc.start(t); osc.stop(t + 0.15);
  }
  update(dt) {}
}
