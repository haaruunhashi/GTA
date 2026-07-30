// CLAUDE OF DUTY — procedural audio. Every sound in this file is synthesised with
// the Web Audio API at runtime; there are no sample files and there must never be.
//
// Owner: audio agent.
//
// Public API (all of it safe to call before the AudioContext exists):
//   gunshot(id, position)      — layered weapon report, distance-modelled when a position is given
//   whizz(missDist, position)  — supersonic bullet passing the listener
//   impact(position, kind)     — bullet hitting the world
//   explosion(position, radius)
//   footstep(surface, speed) / land(impact, surface) / slide() / mantle() / jump()
//   reload(id, opts) / hitmarker(head) / kill(head) / playerHit(dmg)
//   ambience(on) / setMasterVolume(v) / start() / startWith(ac) / update(dt)
//
// Signal flow:
//   layers ─┬─► soft-clip ─► voice gain ─► panner ─┬─► dryBus ──────────────┐
//           └───────────────────────────────────────┤                       │
//                                voice gain ─► send ┼─► nearVerb (0.55 s) ──┤
//                                                   └─► farVerb  (2.3 s) ───┤
//                                              ambBus ─────────────────────┬┴
//                                        duckBus ─► glue comp ─► master ─► limiter ─► clipper ─► out
//
// Everything downstream of `duckBus` is ducked by explosions. Voices are drawn from a
// fixed pool with oldest/lowest-priority stealing, so rapid fire can never allocate
// unbounded nodes, and `update(dt)` allocates nothing.

const VOICE_CAP = 40;          // simultaneously tracked voices
const MAX_TRACKED_SRC = 12;    // sources tracked per voice (for stealing)
const SPEED_OF_SOUND = 343;    // m/s — used for the travel delay of distant shots

// ---------------------------------------------------------------- weapon voicing
// Per-weapon character. `gunshot()` looks the id up here and blends in whatever it
// can read off ctx.weapons.def (defensively — that module is owned by someone else).
const GUN_BASE = {
  ar: {
    lvl: 0.95, crack: 0.85, crackF: 2900, crackDur: 0.030,
    bodyF: 155, bodyEnd: 58, bodyDur: 0.15, body: 0.80,
    tail: 0.36, tailF: 1150, tailLvl: 0.34,
    mech: 0.16, mechF: 4300, mechAt: 0.048,
    sub: 0.34, verb: 0.55,
  },
  smg: {
    lvl: 0.78, crack: 0.80, crackF: 3700, crackDur: 0.022,
    bodyF: 190, bodyEnd: 80, bodyDur: 0.10, body: 0.62,
    tail: 0.24, tailF: 1600, tailLvl: 0.26,
    mech: 0.20, mechF: 5200, mechAt: 0.036,
    sub: 0.22, verb: 0.46,
  },
  shotgun: {
    lvl: 1.15, crack: 0.70, crackF: 1750, crackDur: 0.048,
    bodyF: 105, bodyEnd: 38, bodyDur: 0.30, body: 1.00,
    tail: 0.62, tailF: 720, tailLvl: 0.46,
    mech: 0.26, mechF: 2600, mechAt: 0.30,
    sub: 0.55, verb: 0.78,
  },
  sniper: {
    lvl: 1.30, crack: 1.00, crackF: 2350, crackDur: 0.040,
    bodyF: 92, bodyEnd: 34, bodyDur: 0.34, body: 0.95,
    tail: 0.95, tailF: 620, tailLvl: 0.52,
    mech: 0.30, mechF: 3100, mechAt: 0.34,
    sub: 0.62, verb: 0.95,
  },
  pistol: {
    lvl: 0.72, crack: 0.78, crackF: 3300, crackDur: 0.024,
    bodyF: 200, bodyEnd: 85, bodyDur: 0.11, body: 0.58,
    tail: 0.24, tailF: 1500, tailLvl: 0.24,
    mech: 0.22, mechF: 4800, mechAt: 0.055,
    sub: 0.22, verb: 0.45,
  },
};

// Footstep material voicing. `grain` > 0 means the step is built from scattered
// micro-impacts (gravel, dirt); `ring` > 0 adds resonant partials (metal, grates).
const SURFACES = {
  concrete: { lvl: 0.55, f: 1250, q: 0.9, dur: 0.075, thump: 130, thumpLvl: 0.42, grain: 0, ring: 0, scuff: 0.5 },
  asphalt: { lvl: 0.52, f: 1050, q: 0.9, dur: 0.085, thump: 118, thumpLvl: 0.44, grain: 2, ring: 0, scuff: 0.55 },
  tile: { lvl: 0.58, f: 2100, q: 1.4, dur: 0.055, thump: 180, thumpLvl: 0.30, grain: 0, ring: 0.18, scuff: 0.35 },
  stone: { lvl: 0.55, f: 1450, q: 1.0, dur: 0.070, thump: 140, thumpLvl: 0.40, grain: 1, ring: 0.10, scuff: 0.40 },
  brick: { lvl: 0.52, f: 1350, q: 1.0, dur: 0.070, thump: 135, thumpLvl: 0.38, grain: 1, ring: 0, scuff: 0.45 },
  gravel: { lvl: 0.60, f: 2600, q: 0.7, dur: 0.13, thump: 105, thumpLvl: 0.26, grain: 7, ring: 0, scuff: 0.9 },
  sand: { lvl: 0.42, f: 3400, q: 0.5, dur: 0.16, thump: 90, thumpLvl: 0.16, grain: 5, ring: 0, scuff: 1.0 },
  dirt: { lvl: 0.46, f: 800, q: 0.7, dur: 0.11, thump: 95, thumpLvl: 0.34, grain: 3, ring: 0, scuff: 0.7 },
  grass: { lvl: 0.40, f: 2400, q: 0.6, dur: 0.14, thump: 88, thumpLvl: 0.20, grain: 4, ring: 0, scuff: 0.95 },
  foliage: { lvl: 0.40, f: 3000, q: 0.5, dur: 0.17, thump: 80, thumpLvl: 0.14, grain: 6, ring: 0, scuff: 1.0 },
  wood: { lvl: 0.58, f: 620, q: 1.3, dur: 0.090, thump: 165, thumpLvl: 0.50, grain: 0, ring: 0.30, scuff: 0.35 },
  metal: { lvl: 0.62, f: 1900, q: 1.6, dur: 0.075, thump: 210, thumpLvl: 0.34, grain: 0, ring: 0.85, scuff: 0.30 },
  grate: { lvl: 0.60, f: 2400, q: 1.8, dur: 0.085, thump: 190, thumpLvl: 0.26, grain: 0, ring: 1.00, scuff: 0.35 },
  glass: { lvl: 0.50, f: 3200, q: 2.0, dur: 0.060, thump: 220, thumpLvl: 0.18, grain: 2, ring: 0.55, scuff: 0.30 },
  water: { lvl: 0.48, f: 900, q: 0.5, dur: 0.16, thump: 70, thumpLvl: 0.20, grain: 3, ring: 0, scuff: 1.0 },
  snow: { lvl: 0.38, f: 2000, q: 0.6, dur: 0.13, thump: 85, thumpLvl: 0.22, grain: 4, ring: 0, scuff: 0.85 },
};

// Impact voicing per surface class (bullets hitting the world).
const IMPACTS = {
  concrete: { f: 1600, dur: 0.10, thump: 150, ring: 0, dust: 0.5 },
  brick: { f: 1500, dur: 0.11, thump: 140, ring: 0, dust: 0.6 },
  stone: { f: 1800, dur: 0.10, thump: 160, ring: 0.1, dust: 0.5 },
  metal: { f: 2600, dur: 0.16, thump: 260, ring: 1.0, dust: 0.1 },
  wood: { f: 800, dur: 0.10, thump: 170, ring: 0.25, dust: 0.3 },
  glass: { f: 4200, dur: 0.22, thump: 300, ring: 0.8, dust: 0.2 },
  dirt: { f: 620, dur: 0.09, thump: 95, ring: 0, dust: 0.7 },
  sand: { f: 900, dur: 0.10, thump: 85, ring: 0, dust: 0.8 },
  flesh: { f: 420, dur: 0.09, thump: 110, ring: 0, dust: 0.2 },
  soft: { f: 500, dur: 0.09, thump: 100, ring: 0, dust: 0.3 },
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export class Audio {
  constructor(ctx) {
    this.ctx = ctx || {};
    this.ac = null;
    this.ready = false;
    this.enabled = true;
    this.masterVolume = 0.55;
    this.rng = mulberry32((this.ctx.config && this.ctx.config.seed) || 0x5EED);

    // --- voice pool (fixed size, no per-shot pool growth) ---
    this._pool = new Array(VOICE_CAP);
    for (let i = 0; i < VOICE_CAP; i++) {
      this._pool[i] = { on: false, t0: 0, t1: 0, prio: 0, out: null, pan: null, src: new Array(MAX_TRACKED_SRC), sn: 0 };
    }
    this._active = 0;
    this.stats = { voices: 0, peak: 0, steals: 0, started: 0, dropped: 0 };

    // --- distance-model scratch (written by _listen/_place, never allocated) ---
    this._dDist = 0; this._dPan = 0; this._dGain = 1; this._dLP = 20000; this._dDelay = 0; this._dFar = 0;

    // --- ambience scheduling timers ---
    this._ambOn = false;
    this._tFarGun = 4 + this.rng() * 8;
    this._tDog = 12 + this.rng() * 25;
    this._tRumble = 8 + this.rng() * 20;
    this._tGust = 3 + this.rng() * 6;
    this._t = 0;
    this._lastFootT = -1;
    this._gunCache = new Map();
    this._surfCache = new Map();

    this._bindBus();
    this._bindGesture();
  }

  // --------------------------------------------------------------- bootstrap
  _bindGesture() {
    if (typeof addEventListener !== 'function') return;
    const start = () => this.start();
    this._gestureStart = start;
    addEventListener('mousedown', start);
    addEventListener('keydown', start);
    addEventListener('touchstart', start);
    addEventListener('pointerdown', start);
  }

  /** Create a live AudioContext. Safe to call repeatedly and before/after any gesture. */
  start() {
    if (this.ac) {
      if (this.ac.state === 'suspended' && this.ac.resume) this.ac.resume().catch(() => { });
      return this.ac;
    }
    const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    let ac = null;
    try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ac = new AC(); } catch (e2) { return null; } }
    if (!ac) return null;
    this.startWith(ac);
    if (typeof removeEventListener === 'function' && this._gestureStart) {
      removeEventListener('mousedown', this._gestureStart);
      removeEventListener('keydown', this._gestureStart);
      removeEventListener('touchstart', this._gestureStart);
      removeEventListener('pointerdown', this._gestureStart);
      this._gestureStart = null;
    }
    return ac;
  }

  /**
   * Build the whole graph on an externally supplied context. Used by the game
   * (via start()) and by tools/audiotest.mjs with an OfflineAudioContext.
   */
  startWith(ac, opts) {
    if (this.ac || !ac) return this.ac;
    this.ac = ac;
    const t = ac.currentTime;

    // final safety clipper: a WaveShaper clamps its input to [-1,1] and this curve
    // tops out at ±1, so nothing can ever leave the graph out of range.
    this.clipper = ac.createWaveShaper ? ac.createWaveShaper() : null;
    if (this.clipper) {
      this.clipper.curve = this._satCurve(1.8);
      this.clipper.oversample = 'none';
      this.clipper.connect(ac.destination);
    }
    const out = this.clipper || ac.destination;

    // master: limiter last so nothing can leave the graph above unity
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = -7;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;
    this.limiter.connect(out);

    this.master = ac.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.limiter);

    // glue compressor: tames dense full-auto without pumping the whole mix
    this.glue = ac.createDynamicsCompressor();
    this.glue.threshold.value = -20;
    this.glue.knee.value = 12;
    this.glue.ratio.value = 3.2;
    this.glue.attack.value = 0.010;
    this.glue.release.value = 0.26;
    this.glue.connect(this.master);

    this.duckBus = ac.createGain();
    this.duckBus.gain.value = 1;
    this.duckBus.connect(this.glue);

    this.dryBus = ac.createGain();
    this.dryBus.gain.value = 1;
    this.dryBus.connect(this.duckBus);

    // soft-clip curve shared by every gun transient: gives the crack its bite
    // without a per-shot table build (see _shape()).
    this.satCurve = this._satCurve(2.6);

    // two convolution reverbs: a tight one for close sound, a long street canyon
    // for distant shots. Per-voice send gains cross-fade them by distance.
    // The impulse responses are generated off the gesture that starts the context
    // (see _buildIRs) so the first click can never stall on ~100 ms of DSP.
    this.nearVerb = ac.createConvolver();
    this.nearVerb.normalize = true;
    this.nearVerbGain = ac.createGain(); this.nearVerbGain.gain.value = 0.55;
    this.nearVerb.connect(this.nearVerbGain).connect(this.duckBus);
    this.nearSend = ac.createGain(); this.nearSend.gain.value = 1;
    this.nearSend.connect(this.nearVerb);

    this.farVerb = ac.createConvolver();
    this.farVerb.normalize = true;
    this.farVerbGain = ac.createGain(); this.farVerbGain.gain.value = 0.85;
    this.farVerb.connect(this.farVerbGain).connect(this.duckBus);
    this.farSend = ac.createGain(); this.farSend.gain.value = 1;
    this.farSend.connect(this.farVerb);

    this.ambBus = ac.createGain();
    this.ambBus.gain.value = 0;
    this.ambBus.connect(this.duckBus);

    // shared noise tables — every noise source in the game reads from these with
    // a random offset, so no sound ever has to build a buffer at fire time
    this.nWhite = this._noiseTable(ac, 1.6, 0);
    this.nPink = this._noiseTable(ac, 3.0, 1);
    this.nBrown = this._noiseTable(ac, 3.0, 2);

    // An OfflineAudioContext renders before any timer could fire, so it needs the
    // reverbs up front; a live context gets them on the next macrotask.
    const offline = typeof ac.startRendering === 'function';
    if (offline || (opts && opts.syncIR)) this._buildIRs();
    else if (typeof setTimeout === 'function') setTimeout(() => this._buildIRs(), 0);
    else this._buildIRs();

    this.master.gain.setValueAtTime(this.masterVolume, t);
    this.ready = true;
    if (!opts || opts.ambience !== false) this.ambience(true);
    else { this._ambOn = false; this.ambBus.gain.value = 0; }
    return ac;
  }

  /** Generate and install the two reverb impulse responses. Idempotent. */
  _buildIRs() {
    const ac = this.ac;
    if (!ac || this._irDone) return;
    this._irDone = true;
    try {
      this.nearVerb.buffer = this._makeIR(ac, 0.55, 3.4, 0.010, 4200, 0.35);
      this.farVerb.buffer = this._makeIR(ac, 2.3, 1.35, 0.028, 1500, 0.85);
    } catch (e) { /* a context that died mid-build simply stays dry */ }
  }

  setMasterVolume(v) {
    this.masterVolume = clamp(v, 0, 1.5);
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  // ------------------------------------------------------------- table builders
  _satCurve(drive) {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return c;
  }

  /** kind 0 = white, 1 = pink-ish, 2 = brown-ish. Mono, looped by every consumer. */
  _noiseTable(ac, dur, kind) {
    const n = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    const rnd = mulberry32(0xA11CE + kind * 977);
    if (kind === 0) {
      for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
    } else if (kind === 1) {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < n; i++) {
        const w = rnd() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = clamp((b0 + b1 + b2 + w * 0.1848) * 0.32, -1, 1);
      }
    } else {
      let last = 0;
      for (let i = 0; i < n; i++) {
        const w = rnd() * 2 - 1;
        last = (last + 0.018 * w) / 1.018;
        d[i] = clamp(last * 7.5, -1, 1);
      }
    }
    return buf;
  }

  /**
   * Procedural street-canyon impulse response. `dur` seconds, `decay` shapes the
   * diffuse field, `tap` is the first slap-back spacing, `lp` the initial one-pole
   * cutoff (progressively darker over the tail), `slap` the discrete-echo weight.
   */
  _makeIR(ac, dur, decay, tap, lp, slap) {
    const sr = ac.sampleRate;
    const n = Math.max(8, Math.floor(sr * dur));
    const buf = ac.createBuffer(2, n, sr);
    return this._fillIR(buf, sr, n, decay, tap, lp, slap);
  }

  _fillIR(buf, sr, n, decay, tap, lp, slap) {
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      const rnd = mulberry32(0x51DE + c * 7919);
      // Diffuse decaying noise through a one-pole lowpass whose cutoff falls over
      // the tail. Every exponential is stepped incrementally (one multiply per
      // sample instead of a Math.exp call) so building the IRs on the first user
      // gesture costs a couple of milliseconds, not a visible hitch.
      let z = 0;
      let env = 1;                                  // exp(-decay * s)
      const envStep = Math.exp(-decay / sr);
      let atk = 1;                                  // exp(-260 * s)
      const atkStep = Math.exp(-260 / sr);
      let fcK = 1;                                  // exp(-1.9 * s)
      const fcStep = Math.exp(-1.9 / sr);
      const twoPiOverSr = 2 * Math.PI / sr;
      for (let i = 0; i < n; i++) {
        const w = rnd() * 2 - 1;
        const fc = 300 + (lp - 300) * fcK;
        const a = Math.min(1, fc * twoPiOverSr);
        z += a * (w - z);
        d[i] = z * env * (1 - atk) * 0.55;
        env *= envStep; atk *= atkStep; fcK *= fcStep;
      }
      // discrete slap-backs off facing façades — this is what makes far shots crack twice
      let amp = slap;
      let tt = tap * (1 + c * 0.23);
      for (let k = 0; k < 9 && amp > 0.005; k++) {
        const idx = Math.floor(tt * sr);
        if (idx >= n - 4) break;
        const w = 1 + Math.floor(sr * 0.0012);
        for (let j = 0; j < w; j++) {
          const g = 1 - j / w;
          d[idx + j] += (rnd() * 2 - 1) * amp * g;
        }
        amp *= 0.62;
        tt += tap * (1.7 + rnd() * 1.4);
      }
      // normalise this channel so convolution gain is predictable
      let peak = 0;
      for (let i = 0; i < n; i++) { const a2 = Math.abs(d[i]); if (a2 > peak) peak = a2; }
      if (peak > 0) { const inv = 0.98 / peak; for (let i = 0; i < n; i++) d[i] *= inv; }
    }
    return buf;
  }

  // ------------------------------------------------------------- voice plumbing
  /**
   * Claim a voice. Returns null when audio is unavailable. `dur` is the voice's
   * lifetime in seconds, `prio` higher = harder to steal.
   */
  _voice(prio, dur, level, pan, dest) {
    const ac = this.ac;
    if (!ac || !this.enabled) return null;
    const now = ac.currentTime;
    let v = null;
    for (let i = 0; i < VOICE_CAP; i++) {
      const p = this._pool[i];
      if (p.on && p.t1 <= now) this._release(p);
      if (!p.on && !v) v = p;
    }
    if (!v) {
      // all busy — steal the oldest of the lowest priority still running
      let best = null;
      for (let i = 0; i < VOICE_CAP; i++) {
        const p = this._pool[i];
        if (!best || p.prio < best.prio || (p.prio === best.prio && p.t0 < best.t0)) best = p;
      }
      if (!best || best.prio > prio + 1) { this.stats.dropped++; return null; }
      this._steal(best);
      this.stats.steals++;
      v = best;
    }
    const out = ac.createGain();
    out.gain.value = level == null ? 1 : level;
    const pn = ac.createStereoPanner ? ac.createStereoPanner() : null;
    if (pn) {
      pn.pan.value = clamp(pan || 0, -1, 1);
      out.connect(pn);
      pn.connect(dest || this.dryBus);
    } else {
      out.connect(dest || this.dryBus);
    }
    v.on = true; v.t0 = now; v.t1 = now + Math.max(0.02, dur); v.prio = prio;
    v.out = out; v.pan = pn; v.sn = 0;
    this._active++;
    this.stats.started++;
    if (this._active > this.stats.peak) this.stats.peak = this._active;
    this.stats.voices = this._active;
    return v;
  }

  _track(v, src) {
    if (v.sn < MAX_TRACKED_SRC) v.src[v.sn++] = src;
  }

  _release(v) {
    for (let i = 0; i < v.sn; i++) { v.src[i] = null; }
    v.sn = 0;
    try { if (v.pan) v.pan.disconnect(); } catch (e) { }
    try { if (v.out) v.out.disconnect(); } catch (e) { }
    v.out = null; v.pan = null; v.on = false;
    if (this._active > 0) this._active--;
    this.stats.voices = this._active;
  }

  _steal(v) {
    const ac = this.ac, now = ac.currentTime;
    if (v.out) {
      try {
        v.out.gain.cancelScheduledValues(now);
        v.out.gain.setValueAtTime(v.out.gain.value, now);
        v.out.gain.linearRampToValueAtTime(0, now + 0.006);
      } catch (e) { }
    }
    for (let i = 0; i < v.sn; i++) {
      const s = v.src[i];
      if (s && s.stop) { try { s.stop(now + 0.008); } catch (e) { } }
      v.src[i] = null;
    }
    v.sn = 0;
    try { if (v.pan) v.pan.disconnect(); } catch (e) { }
    try { if (v.out) v.out.disconnect(); } catch (e) { }
    v.out = null; v.pan = null; v.on = false;
    if (this._active > 0) this._active--;
  }

  /** Reverb send from a voice: `nearAmt`/`farAmt` in 0..1. */
  _send(v, nearAmt, farAmt) {
    if (!v || !v.out) return;
    const ac = this.ac;
    if (nearAmt > 0.001 && this.nearSend) {
      const g = ac.createGain(); g.gain.value = nearAmt;
      v.out.connect(g); g.connect(this.nearSend);
    }
    if (farAmt > 0.001 && this.farSend) {
      const g = ac.createGain(); g.gain.value = farAmt;
      v.out.connect(g); g.connect(this.farSend);
    }
  }

  // ------------------------------------------------------------ layer primitives
  /** Noise burst: table -> optional filter -> env -> dest. */
  _noise(v, t, dur, level, type, freq, q, dest, table, atk) {
    const ac = this.ac;
    if (!ac || !v || !v.out) return null;
    const buf = table === 1 ? this.nPink : table === 2 ? this.nBrown : this.nWhite;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0; src.loopEnd = buf.duration;
    const g = ac.createGain();
    let node = g;
    if (type) {
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = clamp(freq, 20, ac.sampleRate * 0.48);
      if (q != null) f.Q.value = q;
      src.connect(f); f.connect(g);
      node = g; v._lastFilter = f;
    } else {
      src.connect(g);
      v._lastFilter = null;
    }
    this._env(g.gain, t, level, atk == null ? 0.0008 : atk, dur);
    g.connect(dest || v.out);
    const off = this.rng() * Math.max(0.001, buf.duration - 0.05);
    try { src.start(t, off); src.stop(t + dur + 0.02); } catch (e) { }
    this._track(v, src);
    return g;
  }

  /** Pitch-swept oscillator (bodies, sub thumps, stings). */
  _osc(v, t, dur, level, type, f0, f1, dest, atk) {
    const ac = this.ac;
    if (!ac || !v || !v.out) return null;
    const o = ac.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(8, f0), t);
    if (f1 != null && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(8, f1), t + dur);
    const g = ac.createGain();
    this._env(g.gain, t, level, atk == null ? 0.0015 : atk, dur);
    o.connect(g); g.connect(dest || v.out);
    try { o.start(t); o.stop(t + dur + 0.02); } catch (e) { }
    this._track(v, o);
    return g;
  }

  _env(param, t, level, atk, dur) {
    const lv = Math.max(0.0002, level);
    try {
      param.setValueAtTime(0.0001, t);
      param.linearRampToValueAtTime(lv, t + Math.max(0.0004, atk));
      param.exponentialRampToValueAtTime(0.0001, t + Math.max(atk + 0.008, dur));
      param.setValueAtTime(0, t + Math.max(atk + 0.008, dur) + 0.001);
    } catch (e) { }
  }

  // ------------------------------------------------------------- distance model
  /** Listener position/orientation, defensively read from camera then player. */
  _listen() {
    const c = this.ctx;
    const cam = c.camera, pl = c.player;
    let x = 0, y = 1.6, z = 0, yaw = 0;
    const cp = cam && cam.position;
    const pp = pl && pl.position;
    if (cp && typeof cp.x === 'number') { x = cp.x; y = cp.y; z = cp.z; }
    else if (pp && typeof pp.x === 'number') { x = pp.x; y = pp.y + 1.6; z = pp.z; }
    if (pl && typeof pl.yaw === 'number') yaw = pl.yaw;
    else if (cam && cam.rotation && typeof cam.rotation.y === 'number') yaw = cam.rotation.y;
    this._lx = x; this._ly = y; this._lz = z; this._lyaw = yaw;
  }

  /**
   * Fill the distance-model scratch fields for a source at `pos`.
   * Sets _dDist, _dGain, _dPan, _dLP (air-absorption cutoff), _dDelay, _dFar (0..1).
   */
  _place(pos) {
    if (!pos || typeof pos.x !== 'number') {
      this._dDist = 0; this._dGain = 1; this._dPan = 0; this._dLP = 20000; this._dDelay = 0; this._dFar = 0;
      return 0;
    }
    this._listen();
    const dx = pos.x - this._lx, dy = pos.y - this._ly, dz = pos.z - this._lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this._dDist = d;
    // inverse-ish rolloff with a 1.5 m reference; floors out so far shots stay audible
    this._dGain = clamp(1.6 / (1 + d / 4.5), 0.02, 1.6);
    // air absorption + occlusion: brutal on the crack, gentle on the body
    this._dLP = clamp(19000 * Math.exp(-d / 26) + 380, 400, 19000);
    this._dDelay = Math.min(0.85, d / SPEED_OF_SOUND);
    this._dFar = clamp((d - 6) / 45, 0, 1);
    const yaw = this._lyaw;
    // right vector for the player's yaw convention (see player.js)
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const inv = d > 0.001 ? 1 / d : 0;
    this._dPan = clamp((dx * rx + dz * rz) * inv * 0.9, -1, 1);
    return d;
  }

  // ------------------------------------------------------------------ weapons
  /** Character params for a weapon id, blended with whatever the def exposes. */
  _gun(id) {
    const key = id || 'ar';
    let p = this._gunCache.get(key);
    // A cached entry built before weapons.js published its defs is re-derived once
    // the def shows up, so an early AI shot cannot lock in the generic voicing.
    if (p && !(p.noDef && this._hasDefs())) return p;
    const base = GUN_BASE[key] || this._guessGun(key);
    p = {};
    for (const k in base) p[k] = base[k];
    p.supp = false;
    // read the live def defensively — weapons.js is owned by another agent
    let def = null;
    try {
      const w = this.ctx.weapons;
      if (w) {
        if (w.defs && w.defs[key]) def = w.defs[key];
        else if (w.WEAPONS && w.WEAPONS[key]) def = w.WEAPONS[key];
        else if (w.def && (w.def.id === key || w.id === key)) def = w.def;
      }
    } catch (e) { def = null; }
    if (def && typeof def === 'object') {
      const name = String(def.name || '');
      p.supp = !!(def.suppressed || def.silenced || def.supp || def.silencer ||
        /supp|silen|integral/i.test(name) || /supp|silen/i.test(String(def.muzzle || '')));
      if (typeof def.pellets === 'number' && def.pellets > 1) {
        p.bodyDur *= 1.25; p.crackF *= 0.8; p.sub *= 1.15; p.tail *= 1.2;
      }
      if (typeof def.muzzleVel === 'number' && def.muzzleVel > 0) {
        // faster round = tighter, brighter crack
        const k = clamp(def.muzzleVel / 850, 0.5, 1.5);
        p.crackF *= 0.75 + 0.35 * k;
        p.crackDur /= (0.8 + 0.3 * k);
      }
      if (typeof def.dmg === 'number') p.lvl *= clamp(0.72 + def.dmg / 120, 0.7, 1.45);
      if (typeof def.cycle === 'number' && def.cycle > 0) p.mechAt = clamp(def.cycle * 0.5, 0.02, 0.45);
      const bk = String(def.boltKind || '');
      if (bk === 'bolt') { p.mech *= 1.5; p.mechF *= 0.75; }
      else if (bk === 'pump') { p.mech *= 1.35; p.mechF *= 0.65; }
      if (typeof def.rpm === 'number' && def.rpm > 500) p.tail *= clamp(700 / def.rpm, 0.6, 1.1);
      p.boltKind = bk;
      p.rl = def.rl || null;
      p.mag = def.mag || 30;
    }
    p.noDef = !def;
    if (p.supp) {
      p.crack *= 0.20; p.crackF *= 0.5; p.body *= 0.55; p.bodyDur *= 0.7;
      p.tail *= 0.28; p.tailLvl *= 0.4; p.mech *= 1.9; p.sub *= 0.5; p.verb *= 0.4;
      p.lvl *= 0.55;
    }
    this._gunCache.set(key, p);
    return p;
  }

  _hasDefs() {
    const w = this.ctx && this.ctx.weapons;
    return !!(w && (w.defs || w.WEAPONS || w.def));
  }

  /** Unknown weapon id: guess a family from the name so new guns still sound right. */
  _guessGun(id) {
    const s = String(id).toLowerCase();
    if (/shot|breach|pump|slug/.test(s)) return GUN_BASE.shotgun;
    if (/sni|bolt|ballista|dmr|lr-/.test(s)) return GUN_BASE.sniper;
    if (/smg|mp|vector|uzi|pdw/.test(s)) return GUN_BASE.smg;
    if (/pist|glock|deagle|revol|sidearm/.test(s)) return GUN_BASE.pistol;
    return GUN_BASE.ar;
  }

  /**
   * The main event. `id` is a weapon id; `position` (optional) is a THREE.Vector3-ish
   * world point — when present the shot is distance-modelled, when absent it is the
   * player's own weapon, dry and up close.
   */
  gunshot(id, position) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const p = this._gun(id);
    const d = this._place(position);
    const far = position ? this._dFar : 0;
    const distGain = position ? this._dGain : 1.15;
    const pan = position ? this._dPan : (this.rng() - 0.5) * 0.10;
    const lp = position ? this._dLP : 19000;
    const t = ac.currentTime + 0.001 + (position ? this._dDelay : 0);

    // near shots get the whole layered treatment; distant ones are mostly tail
    const lvl = clamp(p.lvl * distGain, 0.01, 1.6);
    const dur = 0.10 + p.tail * (1 + far * 2.4) + 0.25 + (position ? this._dDelay : 0);
    const v = this._voice(position ? 3 : 6, dur + 0.2, lvl, pan);
    if (!v) return;

    // one shared lowpass for air absorption, fed by all the layers
    let bus = v.out;
    if (lp < 18000) {
      const f = ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      f.Q.value = 0.4;
      f.connect(v.out);
      bus = f;
    }

    // 1) transient crack — the supersonic snap. Routed through the shared soft-clip
    //    bus when close, so it bites; when far it is what the lowpass eats first.
    const crackLvl = p.crack * (1 - far * 0.72);
    if (crackLvl > 0.01) {
      const cb = (!position || d < 22) ? this._shape(v, bus, 1.35) : bus;
      this._noise(v, t, p.crackDur * (1 + far * 1.6), crackLvl, 'highpass', clamp(p.crackF * (1 - far * 0.55), 240, 9000), 0.7, cb, 0, 0.0004);
      this._noise(v, t, p.crackDur * 0.5, crackLvl * 0.8, 'bandpass', clamp(p.crackF * 1.9, 300, 12000), 0.9, cb, 0, 0.0003);
    }

    // 2) body / punch — the low mid slam that gives the shot weight
    this._noise(v, t + 0.0015, p.bodyDur * (1 + far * 0.5), p.body * (1 - far * 0.35), 'bandpass', p.bodyF * 2.4, 0.8, bus, 1, 0.0018);
    this._osc(v, t, p.bodyDur, p.body * 0.85, 'triangle', p.bodyF, p.bodyEnd, bus, 0.0012);
    // 3) sub thump — felt more than heard, dies fast with distance
    if (p.sub > 0.01) this._osc(v, t, p.bodyDur * 1.5, p.sub * (1 - far * 0.55), 'sine', p.bodyF * 0.55, p.bodyEnd * 0.6, bus, 0.004);

    // 4) mechanical action — bolt/pump/charging handle, dry and close-mic'd only
    if (!position || d < 30) {
      const mLvl = p.mech * (position ? clamp(1 - d / 30, 0, 1) : 1);
      if (mLvl > 0.01) this._action(v, t + p.mechAt, mLvl, p.mechF, p.boltKind);
    }

    // 5) tail — short room slap up close, long canyon crack-thump far away
    const tailDur = p.tail * (1 + far * 2.6);
    if (p.tailLvl > 0.01) {
      this._noise(v, t + 0.010 + far * 0.02, tailDur, p.tailLvl * (0.7 + far * 0.9), 'bandpass',
        clamp(p.tailF * (1 - far * 0.55), 180, 6000), 0.55 + far * 0.5, bus, 1, 0.006 + far * 0.05);
      if (far > 0.25) {
        // secondary "thump" arriving off the buildings behind the shooter
        this._noise(v, t + 0.055 + far * 0.09, tailDur * 0.8, p.tailLvl * far * 0.7, 'lowpass',
          clamp(700 - far * 300, 220, 900), 0.7, bus, 2, 0.02 + far * 0.06);
      }
    }
    this._send(v, p.verb * (1 - far) * 0.55, p.verb * (0.25 + far * 1.25));

    // Some of what a distant shooter sends your way passes close enough to hear.
    // The round is supersonic, so it arrives well before the report does.
    if (position && d > 9 && d < 160 && this.rng() < 0.30) {
      this.whizz(0.3 + this.rng() * 2.4, null, ac.currentTime + d / 760);
    }
  }

  /** Per-voice soft-clip stage in front of `dest`, using the shared curve. */
  _shape(v, dest, drive) {
    const ac = this.ac;
    if (!ac.createWaveShaper || !this.satCurve) return dest;
    const ws = ac.createWaveShaper();
    ws.curve = this.satCurve;
    ws.oversample = 'none';
    const pre = ac.createGain();
    pre.gain.value = drive == null ? 1.35 : drive;
    pre.connect(ws);
    ws.connect(dest);
    return pre;
  }

  /** Bolt / pump / charging-handle mechanics: metal-on-metal clicks with a spring hiss. */
  _action(v, t, lvl, f, kind) {
    const bus = v.out;
    this._noise(v, t, 0.020, lvl, 'bandpass', f, 2.2, bus, 0, 0.0006);
    this._noise(v, t + 0.004, 0.045, lvl * 0.5, 'highpass', f * 1.4, 0.8, bus, 0, 0.002);
    this._osc(v, t, 0.030, lvl * 0.35, 'square', f * 0.55, f * 0.34, bus, 0.0008);
    if (kind === 'bolt' || kind === 'pump') {
      // the long stroke: rasp, then the closing clack
      this._noise(v, t + 0.03, 0.13, lvl * 0.30, 'bandpass', f * 0.8, 1.1, bus, 1, 0.02);
      this._noise(v, t + 0.17, 0.030, lvl * 0.85, 'bandpass', f * 0.9, 2.6, bus, 0, 0.0006);
      this._osc(v, t + 0.17, 0.045, lvl * 0.45, 'triangle', f * 0.45, f * 0.22, bus, 0.001);
    }
  }

  // --------------------------------------------------------------- projectiles
  /**
   * Bullet passing the listener. `miss` = metres off, `position` optional for pan,
   * `at` an absolute context time (rounds arrive before the report of the shot).
   */
  whizz(miss, position, at) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const m = clamp(miss == null ? 1.2 : miss, 0.15, 8);
    if (m > 6) return;
    const lvl = clamp(0.58 * (1 - m / 6.5), 0.02, 0.58);
    let pan = (this.rng() * 2 - 1) * 0.7;
    if (position) { this._place(position); pan = this._dPan; }
    const v = this._voice(2, 0.30 + (at ? Math.max(0, at - ac.currentTime) : 0), lvl, pan);
    if (!v) return;
    const t = (at != null && at > ac.currentTime ? at : ac.currentTime) + 0.001;
    // Doppler: bandpass sweeps down hard as the round passes
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3.2;
    const f0 = 2600 + this.rng() * 1400, f1 = f0 * 0.28;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + 0.085);
    f.connect(v.out);
    const src = ac.createBufferSource();
    src.buffer = this.nWhite; src.loop = true;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1, t + 0.022);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    src.connect(g); g.connect(f);
    try { src.start(t, this.rng() * 2.5); src.stop(t + 0.16); } catch (e) { }
    this._track(v, src);
    // faint crack of the round's own shockwave for very close passes
    if (m < 1.0) this._noise(v, t + 0.02, 0.03, (1 - m) * 0.30, 'highpass', 3800, 0.8, v.out, 0, 0.0005);
    this._send(v, 0.20, 0.10);
  }

  /** Bullet hitting the world. `kind` is a surface class name (see IMPACTS). */
  impact(position, kind) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const k = IMPACTS[this._surfKey(kind, IMPACTS)] || IMPACTS.concrete;
    const d = this._place(position);
    const g = position ? this._dGain * 0.72 : 0.75;
    if (g < 0.02) return;
    const t = ac.currentTime + 0.001 + (position ? this._dDelay : 0);
    const v = this._voice(2, k.dur + 0.35 + (position ? this._dDelay : 0), clamp(g, 0.02, 0.9), position ? this._dPan : 0);
    if (!v) return;
    const lp = position ? this._dLP : 19000;
    let bus = v.out;
    if (lp < 18000) {
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.connect(v.out); bus = f;
    }
    this._noise(v, t, k.dur * 0.35, 0.85, 'bandpass', k.f, 1.1, bus, 0, 0.0005);
    this._osc(v, t, k.dur * 0.7, 0.7, 'triangle', k.thump, k.thump * 0.42, bus, 0.001);
    if (k.dust > 0.05) this._noise(v, t + 0.01, k.dur * 2.4, 0.16 * k.dust, 'highpass', 2600, 0.6, bus, 1, 0.01);
    if (k.ring > 0.05) {
      for (let i = 0; i < 3; i++) {
        const f = k.f * (1 + i * 0.63 + this.rng() * 0.12);
        this._osc(v, t, k.dur * (1.6 - i * 0.3), 0.20 * k.ring / (i + 1), 'sine', f, f * 0.985, bus, 0.001);
      }
    }
    this._send(v, 0.30 * (1 - this._dFar), 0.20 + this._dFar * 0.6);
  }

  // ---------------------------------------------------------------- explosions
  explosion(position, radius) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const r = clamp(radius || 5.5, 1, 30);
    const d = this._place(position);
    const g = position ? clamp(this._dGain * 1.15, 0.05, 1.5) : 1.3;
    const t = ac.currentTime + 0.001 + (position ? this._dDelay : 0);
    const v = this._voice(9, 3.4 + (position ? this._dDelay : 0), clamp(g, 0.05, 1.4), position ? this._dPan * 0.6 : 0);
    if (!v) return;
    const far = this._dFar;
    const lp = position ? clamp(this._dLP * 1.4, 500, 19000) : 19000;
    let bus = v.out;
    {
      const f = ac.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(lp, t);
      f.frequency.exponentialRampToValueAtTime(clamp(lp * 0.18, 200, 6000), t + 0.9);
      f.connect(v.out); bus = f;
    }
    // 1) the crack of detonation
    this._noise(v, t, 0.06, 0.85 * (1 - far * 0.6), 'highpass', 2200, 0.7, bus, 0, 0.0006);
    // 2) low boom: sub sweep plus a wide noise body
    this._osc(v, t, 0.85 * (1 + far * 0.5), 1.0, 'sine', 95 * (0.9 + r / 60), 24, bus, 0.006);
    this._osc(v, t + 0.01, 0.55, 0.55, 'triangle', 150, 40, bus, 0.004);
    this._noise(v, t, 0.45, 0.75, 'lowpass', 420, 0.8, bus, 2, 0.004);
    // 3) mid body / blast wave
    this._noise(v, t + 0.005, 0.9, 0.5, 'bandpass', 700, 0.5, bus, 1, 0.01);
    // 4) debris rattle: scattered grains over the following second
    const grains = far > 0.7 ? 4 : 10;
    for (let i = 0; i < grains; i++) {
      const dt2 = 0.12 + this.rng() * 1.05;
      const f = 900 + this.rng() * 3200;
      this._noise(v, t + dt2, 0.03 + this.rng() * 0.05, 0.11 + this.rng() * 0.12, 'bandpass', f, 1.6, bus, 0, 0.0008);
    }
    // 5) long tail
    this._noise(v, t + 0.05, 1.9 + far * 1.2, 0.30, 'lowpass', clamp(1400 - far * 700, 300, 1400), 0.7, bus, 1, 0.06);
    this._send(v, 0.5 * (1 - far), 1.0);
    this.duck(0.34 + far * 0.4, 1.15 + (1 - far) * 0.5, t);
  }

  /** Duck everything except the explosion itself. `amount` is the floor gain. */
  duck(amount, recover, at) {
    const ac = this.ac;
    if (!ac || !this.duckBus) return;
    const t = at == null ? ac.currentTime : at;
    const p = this.duckBus.gain;
    try {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(clamp(amount, 0.05, 1), t + 0.03);
      p.setValueAtTime(clamp(amount, 0.05, 1), t + 0.12);
      p.linearRampToValueAtTime(1, t + 0.12 + Math.max(0.2, recover || 1));
    } catch (e) { }
  }

  // ------------------------------------------------------------------ movement
  _surfKey(name, table) {
    const raw = String(name == null ? 'concrete' : name).toLowerCase();
    let k = this._surfCache.get(raw);
    if (k) return k;
    k = 'concrete';
    if (table[raw]) k = raw;
    else {
      for (const key in table) { if (raw.indexOf(key) >= 0) { k = key; break; } }
      if (k === 'concrete') {
        // a few aliases the material names actually use
        if (/road|street|pavement|kerb|curb|sidewalk/.test(raw)) k = 'asphalt';
        else if (/rubble|debris|scree/.test(raw)) k = 'gravel';
        else if (/steel|iron|pipe|duct|car|vehicle/.test(raw) && table.metal) k = 'metal';
        else if (/plank|crate|pallet|board/.test(raw) && table.wood) k = 'wood';
        else if (/mud|soil|earth/.test(raw) && table.dirt) k = 'dirt';
        else if (/leaf|bush|hedge/.test(raw) && table.foliage) k = 'foliage';
      }
    }
    this._surfCache.set(raw, k);
    return k;
  }

  footstep(surface, speed) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const s = SURFACES[this._surfKey(surface, SURFACES)] || SURFACES.concrete;
    const sp = clamp(speed == null ? 3 : speed, 0, 12);
    const hard = clamp(sp / 7, 0.25, 1.25);            // sprint slams, walking scuffs
    const lvl = clamp(s.lvl * (0.35 + hard * 0.85) * 1.8, 0.02, 1.1);
    const v = this._voice(1, s.dur + 0.4, lvl, (this.rng() * 2 - 1) * 0.35);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    const jf = 0.88 + this.rng() * 0.26;               // per-step variation
    // heel impact
    this._noise(v, t, s.dur, 0.75, 'bandpass', s.f * jf, s.q, v.out, 0, 0.0008);
    this._osc(v, t, s.dur * 1.5, s.thumpLvl, 'triangle', s.thump * jf, s.thump * 0.45, v.out, 0.0015);
    // scuff / roll-off of the sole
    if (s.scuff > 0.05) {
      this._noise(v, t + 0.012, s.dur * 2.1, 0.16 * s.scuff * hard, 'highpass', 2400 * jf, 0.6, v.out, 1, 0.008);
    }
    // granular material: loose stones under the boot
    for (let i = 0; i < s.grain; i++) {
      const dt2 = this.rng() * s.dur * 1.9;
      this._noise(v, t + dt2, 0.012 + this.rng() * 0.02, 0.10 + this.rng() * 0.14, 'bandpass',
        1600 + this.rng() * 4200, 2.4, v.out, 0, 0.0005);
    }
    // resonant panel ring
    if (s.ring > 0.05) {
      for (let i = 0; i < 2; i++) {
        const f = s.f * (1.3 + i * 0.9) * jf;
        this._osc(v, t, 0.10 + i * 0.09, 0.10 * s.ring, 'sine', f, f * 0.99, v.out, 0.001);
      }
    }
    // gear rattle at speed
    if (hard > 0.7) this._noise(v, t + 0.02, 0.09, 0.07 * hard, 'bandpass', 5200, 1.4, v.out, 0, 0.004);
    this._send(v, 0.22, 0.05);
  }

  land(impact, surface) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const k = clamp((impact == null ? 4 : impact) / 9, 0.12, 1.4);
    const s = SURFACES[this._surfKey(surface, SURFACES)] || SURFACES.concrete;
    const v = this._voice(4, 0.9, clamp(0.55 * k + 0.12, 0.05, 0.95), 0);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    this._noise(v, t, 0.10 + k * 0.06, 0.8, 'bandpass', s.f * 0.7, 0.8, v.out, 0, 0.0012);
    this._osc(v, t, 0.20 + k * 0.14, 0.9, 'sine', s.thump * 0.8, 32, v.out, 0.003);
    this._osc(v, t, 0.13, 0.5, 'triangle', s.thump * 1.4, s.thump * 0.5, v.out, 0.0015);
    // kit and webbing settling, plus a grunt-ish body thud on a hard landing
    this._noise(v, t + 0.02, 0.22, 0.16 * k, 'bandpass', 4200, 1.2, v.out, 0, 0.006);
    if (k > 0.75) {
      this._noise(v, t + 0.03, 0.18, 0.16, 'bandpass', 340, 1.6, v.out, 1, 0.012);
      this._osc(v, t + 0.03, 0.16, 0.10, 'sawtooth', 128, 96, v.out, 0.02);
    }
    if (s.ring > 0.05) this._osc(v, t, 0.28, 0.16 * s.ring, 'sine', s.f * 1.2, s.f * 1.18, v.out, 0.002);
    this._send(v, 0.35, 0.12);
  }

  slide() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const v = this._voice(4, 1.2, 0.36, 0);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    // fabric-on-concrete: broadband noise whose band opens then closes
    const f = ac.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(2200, t + 0.16);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.75);
    f.connect(v.out);
    const src = ac.createBufferSource();
    src.buffer = this.nPink; src.loop = true;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.85, t + 0.06);
    g.gain.setValueAtTime(0.85, t + 0.32);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    src.connect(g); g.connect(f);
    try { src.start(t, this.rng() * 4); src.stop(t + 0.85); } catch (e) { }
    this._track(v, src);
    // knee-down thump + gear
    this._osc(v, t, 0.16, 0.35, 'sine', 110, 48, v.out, 0.003);
    this._noise(v, t, 0.12, 0.22, 'bandpass', 3800, 1.3, v.out, 0, 0.003);
    this._send(v, 0.28, 0.10);
  }

  mantle() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const v = this._voice(4, 0.8, 0.45, 0);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    // hands slap the ledge, boots scrape up it, gear swings
    this._noise(v, t, 0.055, 0.7, 'bandpass', 900, 1.1, v.out, 0, 0.001);
    this._noise(v, t + 0.05, 0.26, 0.30, 'bandpass', 2000, 0.7, v.out, 1, 0.03);
    this._osc(v, t, 0.12, 0.30, 'triangle', 150, 70, v.out, 0.002);
    this._noise(v, t + 0.16, 0.20, 0.18, 'bandpass', 4600, 1.5, v.out, 0, 0.01);
    this._noise(v, t + 0.30, 0.07, 0.32, 'bandpass', 1200, 1.0, v.out, 0, 0.002);
    this._send(v, 0.25, 0.08);
  }

  jump() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const v = this._voice(2, 0.5, 0.32, 0);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    this._noise(v, t, 0.10, 0.5, 'bandpass', 1500, 0.9, v.out, 0, 0.001);   // push-off
    this._noise(v, t + 0.02, 0.22, 0.30, 'highpass', 3000, 0.7, v.out, 1, 0.02); // cloth
    this._osc(v, t + 0.02, 0.20, 0.10, 'sawtooth', 190, 130, v.out, 0.03);       // exhale
    this._send(v, 0.18, 0.05);
  }

  // ------------------------------------------------------------------- feedback
  /** Mechanical reload sequence, timed off the weapon def when it exposes one. */
  reload(id, opts) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const p = this._gun(id);
    const rl = (p && p.rl) || null;
    const t0 = ac.currentTime + 0.001;
    const shell = !!(opts && opts.shell) || !!(rl && rl.shell);

    if (shell) {
      // one shotgun shell into the tube, then the pump on the last one
      const v = this._voice(5, 0.6, 0.5, 0.08);
      if (!v) return;
      this._noise(v, t0, 0.05, 0.45, 'bandpass', 1700, 1.2, v.out, 1, 0.004);      // shell out of the belt
      this._noise(v, t0 + 0.06, 0.035, 0.7, 'bandpass', 2400, 2.2, v.out, 0, 0.0008); // thumbed in
      this._osc(v, t0 + 0.06, 0.06, 0.35, 'triangle', 320, 170, v.out, 0.001);
      this._send(v, 0.25, 0.06);
      return;
    }

    const out = rl && typeof rl.out === 'number' ? rl.out : 0.48;
    const inT = rl && typeof rl.in === 'number' ? rl.in : 1.10;
    const dur = rl && typeof rl.dur === 'number' ? rl.dur : Math.max(inT + 0.7, 1.9);
    const empty = !!(opts && opts.empty);
    const v = this._voice(5, dur + 0.5, 0.55, 0.06);
    if (!v) return;
    const B = v.out;
    // magazine release
    this._noise(v, t0 + 0.04, 0.022, 0.55, 'bandpass', 3400, 2.6, B, 0, 0.0006);
    this._osc(v, t0 + 0.04, 0.035, 0.22, 'square', 900, 520, B, 0.0008);
    // magazine leaving the well: plastic scrape then it clears
    this._noise(v, t0 + out * 0.55, 0.16, 0.30, 'bandpass', 1500, 0.9, B, 1, 0.012);
    this._noise(v, t0 + out, 0.05, 0.34, 'bandpass', 900, 1.4, B, 0, 0.002);
    // fresh mag brought up and slotted home
    this._noise(v, t0 + inT - 0.16, 0.14, 0.22, 'bandpass', 2100, 0.8, B, 1, 0.02);
    this._noise(v, t0 + inT, 0.045, 0.85, 'bandpass', 1250, 1.8, B, 0, 0.0008);
    this._osc(v, t0 + inT, 0.075, 0.55, 'triangle', 260, 120, B, 0.0012);
    // mag slap to seat it
    this._noise(v, t0 + inT + 0.11, 0.035, 0.42, 'bandpass', 700, 1.2, B, 0, 0.0012);
    this._osc(v, t0 + inT + 0.11, 0.06, 0.28, 'sine', 170, 90, B, 0.0015);
    // charging handle / bolt release when the gun ran dry
    if (empty || p.boltKind === 'bolt' || p.boltKind === 'pump') {
      const bt = t0 + Math.min(dur - 0.25, inT + 0.34);
      this._noise(v, bt, 0.09, 0.28, 'bandpass', 2600, 1.2, B, 0, 0.006);        // handle pulled
      this._noise(v, bt + 0.11, 0.030, 0.75, 'bandpass', 3000, 2.4, B, 0, 0.0006); // bolt slams
      this._osc(v, bt + 0.11, 0.05, 0.40, 'square', 520, 240, B, 0.0008);
    }
    this._send(v, 0.28, 0.07);
  }

  hitmarker(head) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const v = this._voice(7, 0.20, head ? 0.52 : 0.42, 0);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    // short two-partial confirm tick; headshots ring a fifth higher and longer
    const f = head ? 2600 : 1900;
    this._osc(v, t, head ? 0.075 : 0.045, 0.7, 'sine', f, f * 0.97, v.out, 0.0008);
    this._osc(v, t, head ? 0.055 : 0.032, 0.34, 'sine', f * 1.5, f * 1.48, v.out, 0.0008);
    this._noise(v, t, 0.014, 0.22, 'highpass', 5200, 0.7, v.out, 0, 0.0004);
    if (head) this._osc(v, t + 0.05, 0.10, 0.22, 'sine', f * 2, f * 1.94, v.out, 0.002);
  }

  kill(head) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const v = this._voice(8, 0.8, 0.40, 0);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    // a distinct sting: metallic bell dyad over a short sub drop
    const base = head ? 1180 : 880;
    this._osc(v, t, 0.30, 0.42, 'sine', base, base * 0.995, v.out, 0.002);
    this._osc(v, t + 0.045, 0.36, 0.32, 'sine', base * 1.5, base * 1.49, v.out, 0.002);
    this._osc(v, t + 0.045, 0.26, 0.16, 'triangle', base * 3.01, base * 2.98, v.out, 0.002);
    this._osc(v, t, 0.22, 0.34, 'sine', 150, 70, v.out, 0.003);
    this._noise(v, t, 0.10, 0.20, 'highpass', 6000, 0.7, v.out, 0, 0.0008);
    if (head) this._noise(v, t + 0.02, 0.20, 0.14, 'bandpass', 3200, 1.4, v.out, 0, 0.004);
    this._send(v, 0.30, 0.10);
  }

  playerHit(dmg) {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const k = clamp((dmg || 12) / 40, 0.2, 1.3);
    const v = this._voice(8, 1.2, clamp(0.35 + k * 0.35, 0.1, 0.8), 0);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    // round smacking body armour: dull thud, cloth, then a brief ear ring
    this._noise(v, t, 0.09, 0.75, 'lowpass', 700, 0.8, v.out, 1, 0.0012);
    this._osc(v, t, 0.16, 0.85, 'sine', 130, 52, v.out, 0.002);
    this._noise(v, t + 0.01, 0.25, 0.22, 'bandpass', 2200, 0.9, v.out, 0, 0.008);
    if (k > 0.6) {
      const g = this._osc(v, t + 0.02, 0.9, 0.10 * k, 'sine', 4400, 4200, v.out, 0.03);
      if (g) this._osc(v, t + 0.02, 0.7, 0.05 * k, 'sine', 6100, 5900, v.out, 0.04);
    }
    this._send(v, 0.25, 0.10);
  }

  // ------------------------------------------------------------------- ambience
  ambience(on) {
    const ac = this.ac;
    this._ambOn = on !== false;
    if (!ac || !this.ambBus) return;
    const t = ac.currentTime;
    if (!this._ambBuilt && this._ambOn) this._buildAmbience();
    try {
      this.ambBus.gain.cancelScheduledValues(t);
      this.ambBus.gain.setValueAtTime(this.ambBus.gain.value, t);
      this.ambBus.gain.linearRampToValueAtTime(this._ambOn ? 1 : 0, t + 1.5);
    } catch (e) { }
  }

  _buildAmbience() {
    const ac = this.ac;
    if (!ac || this._ambBuilt) return;
    this._ambBuilt = true;
    const t = ac.currentTime;

    // --- wind: pink noise through a slowly wandering lowpass, plus a hiss layer
    const wSrc = ac.createBufferSource();
    wSrc.buffer = this.nPink; wSrc.loop = true;
    const wf = ac.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 520; wf.Q.value = 0.6;
    const wg = ac.createGain(); wg.gain.value = 0.030;
    wSrc.connect(wf).connect(wg).connect(this.ambBus);
    // two incommensurable LFOs so the bed never repeats audibly
    this._lfo(0.043, 260, wf.frequency, t);
    this._lfo(0.017, 0.018, wg.gain, t);
    this._lfo(0.0071, 0.011, wg.gain, t);
    try { wSrc.start(t); } catch (e) { }
    this._ambSrc = wSrc;

    const hSrc = ac.createBufferSource();
    hSrc.buffer = this.nWhite; hSrc.loop = true;
    const hf = ac.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 2100; hf.Q.value = 0.5;
    const hg = ac.createGain(); hg.gain.value = 0.006;
    hSrc.connect(hf).connect(hg).connect(this.ambBus);
    this._lfo(0.029, 900, hf.frequency, t);
    this._lfo(0.011, 0.004, hg.gain, t);
    try { hSrc.start(t); } catch (e) { }

    // --- distant city rumble: brown noise floor + a couple of slow low tones
    const rSrc = ac.createBufferSource();
    rSrc.buffer = this.nBrown; rSrc.loop = true;
    const rf = ac.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 110; rf.Q.value = 0.7;
    const rg = ac.createGain(); rg.gain.value = 0.030;
    rSrc.connect(rf).connect(rg).connect(this.ambBus);
    this._lfo(0.0083, 0.018, rg.gain, t);
    try { rSrc.start(t); } catch (e) { }

    const lo = ac.createOscillator(); lo.type = 'sine'; lo.frequency.value = 48;
    const lg = ac.createGain(); lg.gain.value = 0.008;
    lo.connect(lg).connect(this.ambBus);
    this._lfo(0.013, 0.007, lg.gain, t);
    this._lfo(0.0047, 6, lo.frequency, t);
    try { lo.start(t); } catch (e) { }
  }

  /** Slow LFO onto an AudioParam. Only used when building the ambience bed. */
  _lfo(rate, depth, param, t) {
    const ac = this.ac;
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = rate;
    const g = ac.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(param);
    try { o.start(t + this.rng() * 2); } catch (e) { }
  }

  /** Gunfire a few streets over: heavily filtered, all tail, random burst length. */
  farGunfire() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const shots = 1 + Math.floor(this.rng() * 5);
    const gap = 0.075 + this.rng() * 0.10;
    const pan = (this.rng() * 2 - 1) * 0.85;
    const lvl = 0.075 + this.rng() * 0.06;
    const v = this._voice(1, shots * gap + 2.4, lvl, pan);
    if (!v) return;
    const t0 = ac.currentTime + 0.001;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700 + this.rng() * 500; f.Q.value = 0.7;
    f.connect(v.out);
    for (let i = 0; i < shots; i++) {
      const t = t0 + i * gap * (0.9 + this.rng() * 0.25);
      this._noise(v, t, 0.05, 0.7, 'bandpass', 500 + this.rng() * 400, 0.9, f, 1, 0.002);
      this._osc(v, t, 0.10, 0.35, 'triangle', 130, 60, f, 0.004);
      this._noise(v, t + 0.02, 0.55, 0.22, 'lowpass', 380, 0.7, f, 2, 0.03);
    }
    this._send(v, 0.1, 1.0);
  }

  /** A dog somewhere behind the buildings. Two to four barks, formant-ish. */
  dogBark() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const n = 2 + Math.floor(this.rng() * 3);
    const pan = (this.rng() * 2 - 1) * 0.9;
    const v = this._voice(1, n * 0.42 + 1.4, 0.075 + this.rng() * 0.05, pan);
    if (!v) return;
    const t0 = ac.currentTime + 0.001;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1900; f.Q.value = 0.6;
    f.connect(v.out);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.26 + this.rng() * 0.18);
      const base = 190 + this.rng() * 130;
      // sawtooth larynx + two vocal-tract resonances, snapped open then closed
      const dur = 0.10 + this.rng() * 0.06;
      const o = ac.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * 1.5, t);
      o.frequency.exponentialRampToValueAtTime(base * 0.75, t + dur);
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 620 + this.rng() * 380; bp.Q.value = 2.4;
      const g = ac.createGain();
      this._env(g.gain, t, 0.8, 0.010, dur);
      o.connect(bp).connect(g).connect(f);
      try { o.start(t); o.stop(t + dur + 0.02); } catch (e) { }
      this._track(v, o);
      this._noise(v, t, dur * 0.6, 0.20, 'bandpass', 1500, 1.4, f, 0, 0.006);
    }
    this._send(v, 0.15, 0.9);
  }

  /** Very distant detonation / thunder — pure low-frequency tail. */
  farRumble() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const v = this._voice(1, 3.4, 0.045 + this.rng() * 0.035, (this.rng() * 2 - 1) * 0.5);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    this._osc(v, t, 1.6, 0.8, 'sine', 62, 26, v.out, 0.08);
    this._noise(v, t, 2.4, 0.55, 'lowpass', 190, 0.7, v.out, 2, 0.12);
    this._noise(v, t + 0.1, 1.4, 0.16, 'bandpass', 520, 0.6, v.out, 1, 0.2);
    this._send(v, 0.05, 1.0);
  }

  // ---------------------------------------------------------------------- bus
  _bindBus() {
    const bus = this.ctx && this.ctx.bus;
    if (!bus || typeof bus.on !== 'function') return;
    const on = (k, fn) => { try { bus.on(k, fn); } catch (e) { } };

    on('shot', e => {
      const id = (e && e.id) || this._curId();
      this.gunshot(id, null);
    });
    on('reload', e => this.reload((e && e.id) || this._curId(), e));
    on('weapon', () => this.weaponSwap());
    on('hitmarker', e => this.hitmarker(!!(e && e.head)));
    on('kill', e => this.kill(!!(e && e.head)));
    on('playerHit', e => {
      this.playerHit(e && e.dmg);
      // rounds that hit you were near-misses a moment earlier
      if (this.rng() < 0.5) this.whizz(0.5 + this.rng() * 1.2, null);
    });
    on('explosion', e => this.explosion(e && e.pos, e && e.radius));
    on('footstep', e => this.footstep(e && e.surface, e && e.speed));
    on('land', e => this.land(e && e.impact, e && e.surface));
    on('slide', () => this.slide());
    on('mantle', () => this.mantle());
    on('jump', () => this.jump());
    on('death', () => this.playerDown());
    on('respawn', () => { this.duck(1, 0.3); });
    on('wave', () => this.waveSting());
    on('banner', () => this.waveSting());
    on('ads', e => { if (e && (e.on === true || e.ads === true)) this.adsIn(); });
  }

  _curId() {
    try {
      const w = this.ctx.weapons;
      if (w) {
        if (w.id) return w.id;
        if (w.def && w.def.model) return w.def.model;
        if (w.def && w.def.id) return w.def.id;
      }
    } catch (e) { }
    return 'ar';
  }

  /** Weapon swap: cloth, sling, and the receiver settling into the shoulder. */
  weaponSwap() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const v = this._voice(4, 0.6, 0.35, 0.04);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    this._noise(v, t, 0.20, 0.34, 'bandpass', 2600, 0.7, v.out, 1, 0.02);
    this._noise(v, t + 0.14, 0.04, 0.45, 'bandpass', 1400, 1.6, v.out, 0, 0.001);
    this._osc(v, t + 0.14, 0.07, 0.25, 'triangle', 240, 110, v.out, 0.0015);
    this._noise(v, t + 0.22, 0.10, 0.16, 'bandpass', 4800, 1.4, v.out, 0, 0.005);
  }

  /** Bringing the optic up: a small cloth/kit move, deliberately quiet. */
  adsIn() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const now = ac.currentTime;
    if (this._lastAds && now - this._lastAds < 0.25) return;
    this._lastAds = now;
    const v = this._voice(1, 0.3, 0.16, 0);
    if (!v) return;
    this._noise(v, now + 0.001, 0.12, 0.5, 'bandpass', 3200, 0.7, v.out, 1, 0.012);
    this._noise(v, now + 0.06, 0.02, 0.35, 'bandpass', 1800, 2.0, v.out, 0, 0.001);
  }

  waveSting() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const now = ac.currentTime;
    if (this._lastSting && now - this._lastSting < 1.5) return;
    this._lastSting = now;
    const v = this._voice(9, 2.4, 0.34, 0);
    if (!v) return;
    const t = now + 0.001;
    // low brass-ish swell with a hit on the downbeat
    this._osc(v, t, 1.3, 0.45, 'sawtooth', 55, 55, v.out, 0.35);
    this._osc(v, t, 1.3, 0.22, 'sawtooth', 82.5, 82.4, v.out, 0.40);
    this._osc(v, t + 0.9, 0.6, 0.5, 'sine', 110, 55, v.out, 0.006);
    this._noise(v, t + 0.9, 0.5, 0.20, 'lowpass', 900, 0.7, v.out, 1, 0.01);
    this._send(v, 0.3, 0.5);
  }

  playerDown() {
    const ac = this.ac;
    if (!ac || !this.enabled) return;
    const v = this._voice(9, 3.0, 0.55, 0);
    if (!v) return;
    const t = ac.currentTime + 0.001;
    this._osc(v, t, 1.8, 0.7, 'sine', 90, 32, v.out, 0.02);
    this._noise(v, t, 0.5, 0.35, 'lowpass', 500, 0.8, v.out, 2, 0.02);
    this._osc(v, t + 0.05, 2.6, 0.10, 'sine', 5200, 4600, v.out, 0.15);  // tinnitus
    this._send(v, 0.4, 0.4);
    this.duck(0.45, 2.2, t);
  }

  // -------------------------------------------------------------------- frame
  /** Per-frame housekeeping. Allocation-free. */
  update(dt) {
    const ac = this.ac;
    if (!ac) return;
    const d = dt > 0 && dt < 1 ? dt : 0.016;
    this._t += d;

    // reap finished voices
    const now = ac.currentTime;
    for (let i = 0; i < VOICE_CAP; i++) {
      const v = this._pool[i];
      if (v.on && v.t1 <= now) this._release(v);
    }

    if (!this._ambOn) return;
    // randomised ambience events; intervals never line up, so nothing loops audibly
    this._tFarGun -= d;
    if (this._tFarGun <= 0) { this.farGunfire(); this._tFarGun = 5 + this.rng() * 16; }
    this._tDog -= d;
    if (this._tDog <= 0) { this.dogBark(); this._tDog = 18 + this.rng() * 40; }
    this._tRumble -= d;
    if (this._tRumble <= 0) { this.farRumble(); this._tRumble = 22 + this.rng() * 55; }
  }
}
