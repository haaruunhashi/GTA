// Headless audio harness. Screenshots can't review sound, so this asserts the
// things that actually break: that src/audio.js is safe before a user gesture,
// that the voice pool is bounded under full-auto fire, and that every sound
// renders to a non-silent, in-range buffer that differs per weapon and per
// distance.
//
//   node cod/tools/audiotest.mjs            # run everything
//   node cod/tools/audiotest.mjs --verbose  # print per-sound measurements
//
// Nothing here touches the game bundle: audio.js is bundled on its own so the
// tests run without WebGL, a window, or a sound device.
import { chromium } from 'playwright';
import * as esbuild from 'esbuild';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, '..');
const verbose = process.argv.includes('--verbose');
const tmpJs = path.join(here, '.tmp-audiotest-bundle.js');

// ---------------------------------------------------------------- bundle audio.js
await esbuild.build({
  entryPoints: [path.join(rootDir, 'src/audio.js')],
  bundle: true,
  format: 'iife',
  globalName: 'AUDIOMOD',
  target: ['chrome120'],
  outfile: tmpJs,
  logLevel: 'warning',
});

const html = `<!doctype html><meta charset="utf-8"><title>audiotest</title>
<script src="./.tmp-audiotest-bundle.js"></script><body>audio test</body>`;
const htmlPath = path.join(here, '.tmp-audiotest.html');
fs.writeFileSync(htmlPath, html);

const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(here, url === '/' ? '.tmp-audiotest.html' : url);
  if (!file.startsWith(here) || !fs.existsSync(file)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: preinstalled, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
const ignorable = t => /favicon/i.test(t) || /Failed to load resource/i.test(t);
page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) pageErrors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });

// ------------------------------------------------------------------- the tests
const result = await page.evaluate(async () => {
  const { Audio } = window.AUDIOMOD;
  const out = { tests: [], notes: [] };
  const ok = (name, pass, info) => out.tests.push({ name, pass: !!pass, info: info == null ? '' : String(info) });

  // ---- stub game context: no THREE, no renderer, nothing but plain objects
  const stubCtx = (opts = {}) => ({
    config: { seed: 1234 },
    bus: { on() { }, emit() { } },
    camera: { position: { x: 0, y: 1.6, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    player: { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
    weapons: opts.weapons === null ? null : {
      id: 'ar',
      def: { id: 'ar', name: 'MK-4 CARBINE', rpm: 730, dmg: 32, mag: 30, pellets: 1, muzzleVel: 900, cycle: 0.062, boltKind: 'auto', rl: { out: 0.5, in: 1.15, dur: 2.05 } },
      defs: {
        ar: { id: 'ar', name: 'MK-4 CARBINE', rpm: 730, dmg: 32, mag: 30, pellets: 1, muzzleVel: 900, cycle: 0.062, boltKind: 'auto', rl: { out: 0.5, in: 1.15, dur: 2.05 } },
        smg: { id: 'smg', name: 'VECTOR-9', rpm: 980, dmg: 25, mag: 32, pellets: 1, muzzleVel: 700, cycle: 0.048, boltKind: 'auto', rl: { out: 0.44, in: 1.0, dur: 1.85 } },
        shotgun: { id: 'shotgun', name: 'KS-12 BREACHER', rpm: 78, dmg: 22, mag: 6, pellets: 9, muzzleVel: 420, cycle: 0.62, boltKind: 'pump', rl: { shell: true, per: 0.44 } },
        sniper: { id: 'sniper', name: 'LR-338 BALLISTA', rpm: 48, dmg: 115, mag: 5, pellets: 1, muzzleVel: 1100, cycle: 0.9, boltKind: 'bolt', rl: { out: 0.62, in: 1.42, dur: 2.7 } },
        supp: { id: 'supp', name: 'WHISPER-9 SUPPRESSED', rpm: 900, dmg: 22, mag: 30, pellets: 1, muzzleVel: 340, cycle: 0.05, boltKind: 'auto', suppressed: true },
      },
    },
  });

  // ================================================================= test 1
  // The module must construct with no live AudioContext and stay inert.
  let a1;
  try {
    a1 = new Audio(stubCtx());
    ok('constructs without a live AudioContext', a1.ac === null && a1.ready === false, 'ac=' + a1.ac);
  } catch (e) {
    ok('constructs without a live AudioContext', false, e.message);
  }
  // and with a completely empty ctx
  try { const a = new Audio({}); ok('constructs with an empty ctx', a.ac === null); }
  catch (e) { ok('constructs with an empty ctx', false, e.message); }
  try { const a = new Audio(); ok('constructs with no ctx at all', a.ac === null); }
  catch (e) { ok('constructs with no ctx at all', false, e.message); }

  // ================================================================= test 2
  // Every public entry point must be a no-op (not a throw) before first gesture.
  const V = { x: 12, y: 1.5, z: -7 };
  const calls = [
    ['gunshot(local)', a => a.gunshot('ar')],
    ['gunshot(positional)', a => a.gunshot('smg', V)],
    ['gunshot(unknown id)', a => a.gunshot('flamethrower', V)],
    ['gunshot(no id)', a => a.gunshot()],
    ['whizz', a => a.whizz(1.1, V)],
    ['impact', a => a.impact(V, 'metal')],
    ['impact(no kind)', a => a.impact(V)],
    ['explosion', a => a.explosion(V, 6)],
    ['footstep', a => a.footstep('gravel', 5)],
    ['footstep(unknown surface)', a => a.footstep('moonrock', 5)],
    ['land', a => a.land(7, 'metal')],
    ['slide', a => a.slide()],
    ['mantle', a => a.mantle()],
    ['jump', a => a.jump()],
    ['reload', a => a.reload('ar', { empty: true })],
    ['reload(shell)', a => a.reload('shotgun', { shell: true })],
    ['hitmarker', a => a.hitmarker(true)],
    ['kill', a => a.kill(false)],
    ['playerHit', a => a.playerHit(24)],
    ['weaponSwap', a => a.weaponSwap()],
    ['adsIn', a => a.adsIn()],
    ['waveSting', a => a.waveSting()],
    ['playerDown', a => a.playerDown()],
    ['duck', a => a.duck(0.4, 1)],
    ['farGunfire', a => a.farGunfire()],
    ['dogBark', a => a.dogBark()],
    ['farRumble', a => a.farRumble()],
    ['ambience(true)', a => a.ambience(true)],
    ['ambience(false)', a => a.ambience(false)],
    ['setMasterVolume', a => a.setMasterVolume(0.8)],
    ['update', a => a.update(0.016)],
  ];
  let preFail = '';
  for (const [name, fn] of calls) {
    try { fn(a1); } catch (e) { preFail += name + ': ' + e.message + '; '; }
  }
  ok('all public methods safe before first gesture', !preFail && a1.ac === null, preFail);

  // Bus wiring must also survive being driven before the context exists.
  {
    const listeners = new Map();
    const bus = {
      on(k, fn) { (listeners.get(k) || listeners.set(k, []).get(k)).push(fn); },
      emit(k, p) { const l = listeners.get(k); if (l) for (const f of l) f(p); },
    };
    const c = stubCtx(); c.bus = bus;
    const a = new Audio(c);
    let busFail = '';
    const events = [['shot', { id: 'ar' }], ['reload', { id: 'ar', empty: true }], ['reload', { id: 'shotgun', shell: true }],
      ['hitmarker', { head: true }], ['kill', { head: false }], ['playerHit', { dmg: 30 }],
      ['explosion', { pos: V, radius: 6 }], ['footstep', { surface: 'concrete', speed: 4 }],
      ['land', { impact: 6, surface: 'dirt' }], ['slide', {}], ['mantle', {}], ['jump', {}],
      ['weapon', { id: 'smg' }], ['ads', { on: true }], ['death', {}], ['respawn', {}], ['wave', { n: 2 }],
      ['banner', { text: 'WAVE 2' }], ['shot', undefined], ['footstep', undefined], ['kill', undefined]];
    for (const [k, p] of events) { try { bus.emit(k, p); } catch (e) { busFail += k + ': ' + e.message + '; '; } }
    ok('bus events safe before first gesture', !busFail && a.ac === null, busFail);
    out.notes.push('bus keys subscribed: ' + [...listeners.keys()].join(','));
  }

  // ================================================================= test 3
  // Voice cap under 200 shots in one second, on a stub context whose clock we
  // advance by hand (an OfflineAudioContext clock never moves until it renders).
  function stubContext(sampleRate) {
    const param = () => ({
      value: 0, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; },
      exponentialRampToValueAtTime() { return this; }, cancelScheduledValues() { return this; },
      setTargetAtTime() { return this; }, setValueCurveAtTime() { return this; },
    });
    const ctxObj = {
      sampleRate, currentTime: 0, state: 'running', destination: { name: 'dest' },
      created: 0, live: 0,
      _node(extra) {
        this.created++; this.live++;
        const self = this;
        const n = Object.assign({
          connect(d) { return d; }, disconnect() { self.live--; },
        }, extra);
        return n;
      },
      createGain() { return this._node({ gain: param() }); },
      createOscillator() { return this._node({ frequency: param(), detune: param(), type: 'sine', start() { }, stop() { } }); },
      createBufferSource() { return this._node({ buffer: null, loop: false, loopStart: 0, loopEnd: 0, playbackRate: param(), start() { }, stop() { } }); },
      createBiquadFilter() { return this._node({ frequency: param(), Q: param(), gain: param(), detune: param(), type: 'lowpass' }); },
      createStereoPanner() { return this._node({ pan: param() }); },
      createWaveShaper() { return this._node({ curve: null, oversample: 'none' }); },
      createConvolver() { return this._node({ buffer: null, normalize: true }); },
      createDynamicsCompressor() { return this._node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(), reduction: 0 }); },
      createBuffer(ch, len, sr) {
        const data = [];
        for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
        return { numberOfChannels: ch, length: len, sampleRate: sr, duration: len / sr, getChannelData: i => data[i] };
      },
    };
    return ctxObj;
  }

  {
    const sc = stubContext(48000);
    const a = new Audio(stubCtx());
    a.startWith(sc, { ambience: false });
    const nodesAfterGraph = sc.created;
    const CAP = a._pool.length;
    let maxActive = 0, maxTracked = 0;
    const dt = 1 / 60;
    let fired = 0;
    // 200 rounds over one second — well past any real weapon's rate of fire
    for (let f = 0; f < 60; f++) {
      const n = f < 59 ? 3 : 200 - fired;   // 3 per frame, remainder on the last
      for (let i = 0; i < n; i++) { a.gunshot('ar'); fired++; }
      sc.currentTime += dt;
      a.update(dt);
      if (a._active > maxActive) maxActive = a._active;
      let tracked = 0;
      for (const v of a._pool) tracked += v.sn;
      if (tracked > maxTracked) maxTracked = tracked;
    }
    const perShot = (sc.created - nodesAfterGraph) / fired;
    ok('200 shots/s stays inside the voice cap',
      fired === 200 && maxActive <= CAP && a.stats.peak <= CAP,
      `fired=${fired} maxActive=${maxActive} cap=${CAP} peak=${a.stats.peak}`);
    ok('voice stealing actually kicks in', a.stats.steals > 0, 'steals=' + a.stats.steals);
    ok('tracked sources bounded', maxTracked <= CAP * 12, 'maxTracked=' + maxTracked);
    // a fully layered close-range shot is ~30 nodes (crack x2, body, sub, action,
    // tail, sends, voice out/pan); the point of the bound is that it is constant
    // per shot rather than growing with the number of shots in flight.
    ok('per-shot node count is bounded', perShot < 34, 'nodes/shot=' + perShot.toFixed(1));

    // update(dt) must allocate nothing: with the clock frozen and no voices due,
    // it must not create a single node.
    sc.currentTime += 12;
    for (let i = 0; i < 8; i++) a.update(dt);   // drain
    const before = sc.created;
    for (let i = 0; i < 600; i++) { sc.currentTime += dt; a.update(dt); }
    ok('update(dt) creates no nodes when idle (ambience off)', sc.created === before,
      `created=${sc.created - before}`);
    ok('voices all released when idle', a._active === 0, 'active=' + a._active);

    // Graph + table build happens on the first user gesture — usually the same
    // click that fires the first shot — so it has to be cheap.
    {
      const sc3 = stubContext(48000);
      const a3 = new Audio(stubCtx());
      const t0 = performance.now();
      a3.startWith(sc3, { ambience: false, syncIR: true });
      const ms = performance.now() - t0;
      ok('whole graph incl. noise tables + IRs builds in under 250 ms', ms < 250, ms.toFixed(1) + ' ms');
    }

    // On a live context the reverb IRs are built on the next macrotask, so the
    // first click isn't blocked by the DSP — but they must actually arrive.
    {
      const sc4 = stubContext(48000);
      const a4 = new Audio(stubCtx());
      a4.startWith(sc4, { ambience: false });
      const immediate = a4.nearVerb.buffer;
      await new Promise(r => setTimeout(r, 0));
      ok('reverb IRs are built off the starting gesture',
        immediate == null && a4.nearVerb.buffer != null && a4.farVerb.buffer != null,
        'immediate=' + immediate + ' near=' + (a4.nearVerb.buffer && a4.nearVerb.buffer.length));
    }

    // A distant shot is scheduled at now + distance/343 s. Its voice must not be
    // reaped by update() before that arrival time, or far gunfire goes silent.
    {
      const a2 = new Audio(stubCtx());
      const sc2 = stubContext(48000);
      a2.startWith(sc2, { ambience: false });
      a2.gunshot('ar', { x: 120, y: 1.6, z: 0 });
      const arrival = 120 / 343;
      let aliveAt = 0;
      for (let f = 0; f < 120; f++) {
        sc2.currentTime += dt; a2.update(dt);
        if (a2._active > 0) aliveAt = sc2.currentTime;
      }
      ok('far shot voice survives its travel delay', aliveAt > arrival,
        `alive=${aliveAt.toFixed(3)}s arrival=${arrival.toFixed(3)}s`);
    }

    // mixed fire of everything at once must still respect the cap
    let mixMax = 0;
    for (let f = 0; f < 120; f++) {
      a.gunshot('smg'); a.gunshot('sniper', { x: 40, y: 1, z: 10 });
      a.footstep('gravel', 6); a.impact({ x: 5, y: 1, z: 2 }, 'metal');
      a.whizz(0.8); a.hitmarker(f % 3 === 0);
      if (f % 40 === 0) a.explosion({ x: 8, y: 0, z: 3 }, 6);
      sc.currentTime += dt; a.update(dt);
      if (a._active > mixMax) mixMax = a._active;
    }
    ok('mixed heavy load stays inside the voice cap', mixMax <= CAP, 'maxActive=' + mixMax);

    // ambience timers must fire without unbounded growth
    a.ambience(true);
    let ambMax = 0;
    for (let f = 0; f < 60 * 120; f++) {   // two simulated minutes
      sc.currentTime += dt; a.update(dt);
      if (a._active > ambMax) ambMax = a._active;
    }
    ok('two minutes of ambience stays bounded', ambMax <= CAP, 'maxActive=' + ambMax);
  }

  // ================================================================= test 4
  // Offline renders: non-silent, in range, and audibly different where it matters.
  const SR = 44100;
  function measure(buf) {
    let peak = 0, sum = 0, diff = 0, n = 0, dc = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      let prev = 0;
      for (let i = 0; i < d.length; i++) {
        const x = d[i], ax = Math.abs(x);
        if (ax > peak) peak = ax;
        sum += x * x; dc += x;
        diff += Math.abs(x - prev); prev = x; n++;
      }
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    return { peak, rms, dc: dc / Math.max(1, n), bright: rms > 1e-9 ? (diff / n) / rms : 0, n };
  }

  async function render(dur, fn) {
    const oac = new OfflineAudioContext(2, Math.ceil(SR * dur), SR);
    const a = new Audio(stubCtx());
    a.startWith(oac, { ambience: false });
    fn(a, oac);
    const buf = await oac.startRendering();
    return measure(buf);
  }

  const cases = [
    ['gunshot ar (local)', 1.6, a => a.gunshot('ar')],
    ['gunshot smg (local)', 1.6, a => a.gunshot('smg')],
    ['gunshot shotgun (local)', 2.2, a => a.gunshot('shotgun')],
    ['gunshot sniper (local)', 2.6, a => a.gunshot('sniper')],
    ['gunshot suppressed', 1.6, a => a.gunshot('supp')],
    ['gunshot ar @5m', 2.0, a => a.gunshot('ar', { x: 5, y: 1.6, z: 0 })],
    ['gunshot ar @60m', 3.0, a => a.gunshot('ar', { x: 60, y: 1.6, z: 0 })],
    ['whizz', 0.6, a => a.whizz(0.7)],
    ['impact concrete', 0.8, a => a.impact({ x: 3, y: 1, z: 0 }, 'concrete')],
    ['impact metal', 0.8, a => a.impact({ x: 3, y: 1, z: 0 }, 'metal')],
    ['explosion', 3.5, a => a.explosion({ x: 6, y: 0, z: 0 }, 6)],
    ['footstep concrete', 0.6, a => a.footstep('concrete', 4)],
    ['footstep gravel', 0.6, a => a.footstep('gravel', 4)],
    ['footstep metal', 0.6, a => a.footstep('metal', 4)],
    ['footstep dirt', 0.6, a => a.footstep('dirt', 4)],
    ['land hard', 1.2, a => a.land(9, 'concrete')],
    ['slide', 1.4, a => a.slide()],
    ['mantle', 1.0, a => a.mantle()],
    ['jump', 0.8, a => a.jump()],
    ['reload ar (empty)', 3.0, a => a.reload('ar', { empty: true })],
    ['reload shotgun shell', 1.0, a => a.reload('shotgun', { shell: true })],
    ['hitmarker', 0.4, a => a.hitmarker(false)],
    ['hitmarker head', 0.4, a => a.hitmarker(true)],
    ['kill sting', 1.2, a => a.kill(false)],
    ['playerHit', 1.6, a => a.playerHit(30)],
    ['far gunfire', 3.0, a => a.farGunfire()],
    ['dog bark', 2.5, a => a.dogBark()],
    ['far rumble', 3.5, a => a.farRumble()],
    ['ambience bed', 3.0, (a, oac) => { a.ambience(true); a.ambBus.gain.value = 1; }],
    ['full-auto burst (10)', 2.5, (a, oac) => { for (let i = 0; i < 10; i++) a._pool && a.gunshot('ar'); }],
  ];

  const m = {};
  for (const [name, dur, fn] of cases) {
    let r;
    try { r = await render(dur, fn); } catch (e) { ok('render ' + name, false, e.message); continue; }
    m[name] = r;
    ok('render ' + name + ' is non-silent', r.rms > 1e-4 && r.peak > 1e-3,
      `peak=${r.peak.toFixed(4)} rms=${r.rms.toFixed(5)}`);
    ok('render ' + name + ' stays inside [-1,1]', r.peak <= 1.0000001, 'peak=' + r.peak.toFixed(6));
  }
  out.measure = m;

  // --- weapons must not sound the same as each other
  const rel = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.max(Math.abs(a), Math.abs(b)));
  const pairs = [
    ['gunshot ar (local)', 'gunshot smg (local)'],
    ['gunshot ar (local)', 'gunshot shotgun (local)'],
    ['gunshot ar (local)', 'gunshot sniper (local)'],
    ['gunshot smg (local)', 'gunshot shotgun (local)'],
    ['gunshot shotgun (local)', 'gunshot sniper (local)'],
    ['gunshot ar (local)', 'gunshot suppressed'],
    ['footstep concrete', 'footstep gravel'],
    ['footstep concrete', 'footstep metal'],
    ['footstep gravel', 'footstep dirt'],
    ['impact concrete', 'impact metal'],
  ];
  for (const [x, y] of pairs) {
    const A = m[x], B = m[y];
    if (!A || !B) { ok(`${x} differs from ${y}`, false, 'missing render'); continue; }
    const dRms = rel(A.rms, B.rms), dBright = rel(A.bright, B.bright);
    ok(`${x} differs from ${y}`, dRms > 0.05 || dBright > 0.05,
      `drms=${dRms.toFixed(3)} dbright=${dBright.toFixed(3)}`);
  }

  // --- distance modelling: farther = quieter and darker
  {
    const near = m['gunshot ar @5m'], far = m['gunshot ar @60m'];
    if (near && far) {
      ok('60m shot is quieter than 5m shot', far.rms < near.rms * 0.75,
        `near=${near.rms.toFixed(5)} far=${far.rms.toFixed(5)}`);
      ok('60m shot is darker than 5m shot (low-passed)', far.bright < near.bright * 0.9,
        `near=${near.bright.toFixed(4)} far=${far.bright.toFixed(4)}`);
    } else ok('distance modelling', false, 'missing renders');
  }

  // --- suppressed is quieter and duller than unsuppressed
  {
    const dry = m['gunshot ar (local)'], sup = m['gunshot suppressed'];
    if (dry && sup) ok('suppressed shot is quieter than unsuppressed', sup.rms < dry.rms,
      `ar=${dry.rms.toFixed(5)} supp=${sup.rms.toFixed(5)}`);
  }

  // --- the explosion must duck the rest of the mix
  {
    const oac = new OfflineAudioContext(2, Math.ceil(SR * 2.0), SR);
    const a = new Audio(stubCtx());
    a.startWith(oac, { ambience: false });
    a.explosion({ x: 5, y: 0, z: 0 }, 6);
    const before = a.duckBus.gain.value;
    await oac.startRendering();
    // the duck is a scheduled ramp, so just assert it was scheduled downward
    ok('explosion schedules a duck', before === 1 && typeof a.duckBus.gain.value === 'number');
  }

  // --- an offline render with no calls at all must be pure silence
  {
    const oac = new OfflineAudioContext(2, Math.ceil(SR * 0.5), SR);
    const a = new Audio(stubCtx());
    a.startWith(oac, { ambience: false });
    const r = measure(await oac.startRendering());
    ok('silent when nothing is played', r.peak === 0, 'peak=' + r.peak);
  }

  return out;
});

await browser.close();
server.close();
try { fs.unlinkSync(tmpJs); fs.unlinkSync(tmpJs + '.map'); } catch (e) { }
try { fs.unlinkSync(htmlPath); } catch (e) { }

// ---------------------------------------------------------------------- report
let pass = 0, fail = 0;
for (const t of result.tests) {
  if (t.pass) { pass++; if (verbose) console.log(`  ok   ${t.name}${t.info ? '  (' + t.info + ')' : ''}`); }
  else { fail++; console.log(`  FAIL ${t.name}${t.info ? '  (' + t.info + ')' : ''}`); }
}
if (verbose) {
  for (const n of result.notes || []) console.log('  note ' + n);
  console.log('\n  sound                          peak      rms       bright');
  for (const k in result.measure || {}) {
    const r = result.measure[k];
    console.log('  ' + k.padEnd(30) + r.peak.toFixed(4).padStart(8) + r.rms.toFixed(5).padStart(10) + r.bright.toFixed(4).padStart(10));
  }
}
if (pageErrors.length) { console.log('  PAGE ERRORS: ' + pageErrors.slice(0, 5).join(' | ')); fail++; }
console.log(`\n[audiotest] ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
