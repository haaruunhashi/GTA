// Headless movement harness for src/player.js.
//   node cod/tools/movetest.mjs
// Boots the real bundle in chromium, takes the player controller off the rAF
// loop, and drives it with a fixed 1/60 clock through scripted input while
// asserting the movement contract (no falling through the world, step-up,
// no tunnelling at speed, slide decay, mantle, respawn).
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, '..');

execFileSync(process.execPath, [path.join(rootDir, 'build.mjs')], { stdio: 'inherit' });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(rootDir, url === '/' ? 'index.html' : url);
  if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p));
const browser = await chromium.launch({
  executablePath: preinstalled,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
const errors = [];
const ignorable = t => /favicon/i.test(t) || /Failed to load resource/i.test(t);
page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/index.html?dpr=1&q=low`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true && window.__ctx && window.__ctx.player', null, { timeout: 240000 });

// ---------------------------------------------------------------- test rig
await page.evaluate(() => {
  const ctx = window.__ctx;
  const p = ctx.player;
  ctx.ai.update = () => {};            // enemies must not perturb the tests
  ctx.weapons.update = () => {};
  p.__real = p.update.bind(p);
  p.update = () => {};                 // take the controller off the rAF loop

  const ev = window.__ev = {};
  for (const k of ['footstep', 'land', 'slide', 'mantle', 'jump', 'death', 'respawn']) {
    ev[k] = [];
    ctx.bus.on(k, d => ev[k].push(d || {}));
  }
  window.__T = {
    ctx, p,
    reset() { for (const k in ev) ev[k].length = 0; },
    clearBoxes() {
      if (!this._base) this._base = ctx.world.colliders.length;
      ctx.world.colliders.length = this._base;
      ctx.world.collidersVersion = (ctx.world.collidersVersion || 0) + 1;
      ctx.physics.rebuild();
    },
    box(x0, y0, z0, x1, y1, z1) {
      if (!this._base) this._base = ctx.world.colliders.length;
      ctx.world.colliders.push(new ctx.THREE.Box3(
        new ctx.THREE.Vector3(x0, y0, z0), new ctx.THREE.Vector3(x1, y1, z1)));
      ctx.world.collidersVersion = (ctx.world.collidersVersion || 0) + 1;
      ctx.physics.rebuild();
    },
    place(x, y, z, yaw) {
      p.teleport(new ctx.THREE.Vector3(x, y, z), yaw);
      p.hp = 100; p.dead = false; p.stance = 'stand';
      p.height = 1.8; p.eyeHeight = 1.62; p.grounded = false;
      p.inputOverride = null;
      this.reset();
    },
    // yaw that makes the player face +x / -x / +z / -z
    yawTo(dx, dz) { return Math.atan2(-dx, -dz); },
    step(n, input, pre) {
      const dt = 1 / 60;
      for (let i = 0; i < n; i++) {
        if (pre) pre(i, p);
        p.inputOverride = typeof input === 'function' ? input(i) : (input || null);
        p.__real(dt);
        ctx.time += dt;
      }
    },
  };
});

// ------------------------------------------------------------------ asserts
let failed = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '   ' + detail : ''}`);
}
const run = fn => page.evaluate(fn);

// 1 — 30 s of random input must not put us through the floor or into NaN.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.place(800, 0.2, 800, 0);
    // a little obstacle course to bounce off
    T.box(806, 0, 794, 826, 4, 796);
    T.box(806, 0, 804, 826, 0.3, 824);
    T.box(794, 0, 806, 796, 1.2, 826);
    T.box(802, 0, 802, 804, 6, 804);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    let minY = Infinity, maxDrop = 0, bad = 0, prev = p.position.clone();
    let inp = { fwd: 1, strafe: 0 };
    T.step(1800, i => {
      if (i % 18 === 0) {
        inp = {
          fwd: Math.round(rnd() * 2 - 1), strafe: Math.round(rnd() * 2 - 1),
          jump: rnd() < 0.25, sprint: rnd() < 0.45, crouch: rnd() < 0.2,
          prone: rnd() < 0.06, ads: rnd() < 0.2, mx: (rnd() - 0.5) * 90,
        };
      }
      return inp;
    }, () => {
      minY = Math.min(minY, p.position.y);
      if (!isFinite(p.position.x + p.position.y + p.position.z)) bad++;
      maxDrop = Math.max(maxDrop, prev.distanceTo(p.position));
      prev.copy(p.position);
    });
    return { minY, bad, respawns: window.__ev.respawn.length, y: p.position.y, maxDrop, footsteps: window.__ev.footstep.length };
  });
  check('30 s of random input: never falls through the world',
    r.minY > -0.35 && r.bad === 0 && r.respawns === 0,
    `minY=${r.minY.toFixed(3)} nan=${r.bad} respawns=${r.respawns}`);
  check('30 s of random input: no teleport-sized frame steps', r.maxDrop < 0.6, `maxStep=${r.maxDrop.toFixed(3)}m`);
  check('footsteps are emitted while moving', r.footsteps > 30, `${r.footsteps} steps`);
}

// 2 — step a 0.3 m ledge without jumping.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.box(810, 0, 790, 830, 0.3, 810);
    T.place(806, 0.05, 800, T.yawTo(1, 0));
    T.step(150, { fwd: 1 });
    return { y: p.position.y, x: p.position.x, jumps: window.__ev.jump.length, state: p.state };
  });
  check('steps a 0.3 m ledge without jumping',
    r.y > 0.27 && r.x > 810.2 && r.jumps === 0,
    `y=${r.y.toFixed(3)} x=${r.x.toFixed(2)} jumps=${r.jumps}`);
}

// 3 — 30 m/s into a wall must not tunnel.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.box(820, 0, 780, 821, 5, 830);
    T.place(810, 0.05, 800, T.yawTo(1, 0));
    let maxX = -Infinity;
    T.step(120, { fwd: 1 }, (i) => { p.velocity.x = 30; p.velocity.z = 0; maxX = Math.max(maxX, p.position.x); });
    maxX = Math.max(maxX, p.position.x);
    return { x: p.position.x, maxX };
  });
  check('cannot pass a wall at 30 m/s', r.maxX < 819.9, `maxX=${r.maxX.toFixed(3)} (wall at 820)`);
}

// 4 — slide carries momentum then decays below walk speed and exits.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.place(800, 0.05, 800, T.yawTo(1, 0));
    T.step(90, { fwd: 1, sprint: true });
    const sprintSpeed = p.speed;
    T.step(1, { fwd: 1, sprint: true, crouch: true });
    const entry = p.speed;
    const started = p.state === 'slide';
    T.step(3, { fwd: 1, sprint: true, crouch: true });
    const peak = p.speed;
    T.step(45, { fwd: 1, sprint: true, crouch: true });   // 0.75 s later
    return { sprintSpeed, entry, peak, started, end: p.speed, state: p.state, slides: window.__ev.slide.length };
  });
  check('sprint reaches sprint speed', r.sprintSpeed > 6.0, `${r.sprintSpeed.toFixed(2)} m/s`);
  check('slide boosts past sprint speed', r.started && r.peak > r.sprintSpeed * 1.05 && r.slides === 1,
    `entry=${r.peak.toFixed(2)} vs sprint=${r.sprintSpeed.toFixed(2)}`);
  check('slide decays to walk speed and exits within 0.75 s',
    r.end <= 4.5 && r.state !== 'slide',
    `end=${r.end.toFixed(2)} m/s state=${r.state}`);
}

// 5 — mantle a 1.2 m box.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.box(802, 0, 790, 812, 1.2, 810);
    T.place(800.5, 0.05, 800, T.yawTo(1, 0));
    T.step(20, { fwd: 1 });
    const before = p.position.y;
    T.step(90, { fwd: 1, jump: true });
    return { before, y: p.position.y, x: p.position.x, mantles: window.__ev.mantle.length, h: (window.__ev.mantle[0] || {}).height };
  });
  check('mantles a 1.2 m box', r.mantles >= 1 && r.y > 1.15 && r.x > 802,
    `mantles=${r.mantles} y=${r.y.toFixed(3)} x=${r.x.toFixed(2)}`);
}

// 6 — a 2.6 m wall is NOT mantleable (jump instead).
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.box(802, 0, 790, 812, 2.6, 810);
    T.place(800.5, 0.05, 800, T.yawTo(1, 0));
    T.step(20, { fwd: 1 });
    T.step(90, { fwd: 1, jump: true });
    return { y: p.position.y, mantles: window.__ev.mantle.length, jumps: window.__ev.jump.length };
  });
  check('does not mantle a 2.6 m wall', r.mantles === 0 && r.y < 0.4 && r.jumps > 0,
    `mantles=${r.mantles} jumps=${r.jumps} y=${r.y.toFixed(2)}`);
}

// 7 — jump emits, lands, and the landing impulse is reported.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.place(800, 0.05, 800, 0);
    T.step(30, null);
    T.reset();                       // ignore the settle-drop onto the ground
    T.step(2, { jump: true });
    const apexUp = p.velocity.y;
    let maxY = 0;
    T.step(90, null, () => { maxY = Math.max(maxY, p.position.y); });
    return { apexUp, maxY, jumps: window.__ev.jump.length, lands: window.__ev.land.length, impact: (window.__ev.land[0] || {}).impact, y: p.position.y, grounded: p.grounded };
  });
  check('jump reaches ~0.9 m and lands, emitting both events',
    r.jumps === 1 && r.lands === 1 && r.impact > 4 && r.maxY > 0.75 && r.grounded && Math.abs(r.y) < 0.05,
    `apex=${r.maxY.toFixed(2)}m impact=${(r.impact || 0).toFixed(2)} y=${r.y.toFixed(3)}`);
}

// 8 — crouch / stance timings and blocked stand-up.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.place(800, 0.05, 800, 0);
    T.step(20, null);
    const standH = p.height;
    T.step(13, { crouch: true });        // ~0.216 s -> fully crouched
    const crouchH = p.height;
    T.box(798, 1.35, 798, 802, 3, 802);  // low ceiling above us
    T.step(30, null);                    // release crouch: must stay down
    const blocked = p.height;
    T.clearBoxes();
    T.step(30, null);
    return { standH, crouchH, blocked, freed: p.height };
  });
  check('crouch completes in ~0.2 s', r.crouchH < 1.25 && r.standH > 1.75,
    `stand=${r.standH.toFixed(2)} crouch=${r.crouchH.toFixed(2)}`);
  check('cannot stand under a low ceiling', r.blocked < 1.3 && r.freed > 1.75,
    `blocked=${r.blocked.toFixed(2)} freed=${r.freed.toFixed(2)}`);
}

// 9 — directional penalties: backpedal and strafe are slower than forward.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    const spd = inp => { T.place(800, 0.05, 800, 0); T.step(60, inp); return p.speed; };
    return { f: spd({ fwd: 1 }), b: spd({ fwd: -1 }), s: spd({ strafe: 1 }), ads: spd({ fwd: 1, ads: true }) };
  });
  check('backpedal and strafe are penalised', r.b < r.f * 0.85 && r.s < r.f * 0.95,
    `fwd=${r.f.toFixed(2)} back=${r.b.toFixed(2)} strafe=${r.s.toFixed(2)}`);
  check('ADS slows movement', r.ads < r.f * 0.7, `ads=${r.ads.toFixed(2)}`);
}

// 10 — death and respawn at a world spawn point.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.place(800, 0.05, 800, 0);
    p.kill();
    const deadState = p.state;
    T.step(60, null);
    const stillDead = p.dead;
    T.step(150, null);
    const pts = (T.ctx.world.spawnPoints || []);
    const near = pts.some(s => Math.hypot(s.x - p.position.x, s.z - p.position.z) < 1.5);
    return { deadState, stillDead, dead: p.dead, hp: p.hp, near, pts: pts.length,
      deaths: window.__ev.death.length, respawns: window.__ev.respawn.length, pos: [p.position.x, p.position.z] };
  });
  check('death then respawn restores hp at a spawn point',
    r.deadState === 'dead' && r.stillDead && !r.dead && r.hp === 100 && r.deaths === 1 && r.respawns === 1 && (r.pts === 0 || r.near),
    `hp=${r.hp} near=${r.near} pts=${r.pts}`);
}

// 11 — health regenerates only after the delay.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.place(800, 0.05, 800, 0);
    p.damage(45);
    const hurt = p.hp;
    T.step(180, null);              // 3 s — still inside the delay
    const during = p.hp;
    T.step(300, null);              // 5 s more
    return { hurt, during, after: p.hp };
  });
  check('health regen waits then heals to full', r.hurt === 55 && r.during === 55 && r.after === 100,
    `hurt=${r.hurt} at3s=${r.during} after=${r.after}`);
}

// 12 — corner jitter: pushing into an inside corner must come to rest.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.box(802, 0, 790, 812, 3, 802);
    T.box(790, 0, 802, 802, 3, 812);
    T.place(800.8, 0.05, 800.8, T.yawTo(1, 1));
    T.step(60, { fwd: 1, sprint: true });
    const a = p.position.clone();
    let wobble = 0;
    T.step(60, { fwd: 1, sprint: true }, () => { wobble = Math.max(wobble, Math.abs(p.velocity.x) + Math.abs(p.velocity.z)); });
    return { drift: a.distanceTo(p.position), wobble, inside: p.position.x < 802.4 && p.position.z < 802.4 };
  });
  check('no jitter or squeeze-through in an inside corner', r.drift < 0.25 && r.inside,
    `drift=${r.drift.toFixed(3)} residualVel=${r.wobble.toFixed(2)}`);
}

// 13 — viewOffset / viewRoll stay bounded (weapons composes with them).
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.place(800, 0.05, 800, 0);
    let maxOff = 0, maxRoll = 0, moved = 0;
    T.step(300, i => ({ fwd: 1, sprint: i > 60, strafe: i > 200 ? 1 : 0 }), () => {
      maxOff = Math.max(maxOff, p.viewOffset.length());
      maxRoll = Math.max(maxRoll, Math.abs(p.viewRoll));
      if (p.viewOffset.length() > 0.002) moved++;
    });
    return { maxOff, maxRoll, moved };
  });
  check('view bob/roll are alive but bounded', r.moved > 100 && r.maxOff < 0.25 && r.maxRoll < 0.25,
    `maxOffset=${r.maxOff.toFixed(3)}m maxRoll=${(r.maxRoll * 57.3).toFixed(1)}deg`);
}

// 14 — tactical sprint (double tap) is faster, and firing is locked out.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.place(800, 0.05, 800, 0);
    T.step(20, { fwd: 1 });
    const walkFire = p.canFire;
    T.step(2, { fwd: 1, sprint: true });     // tap
    T.step(4, { fwd: 1 });                   // release inside the double-tap window
    T.step(120, { fwd: 1, sprint: true });   // hold -> tactical sprint
    const tac = p.speed, tacState = p.state, fireWhileSprint = p.canFire;
    T.step(1, { fwd: 1 });                   // let go
    const justAfter = p.canFire;
    T.step(18, { fwd: 1 });                  // 0.3 s later
    return { walkFire, tac, tacState, fireWhileSprint, justAfter, later: p.canFire };
  });
  check('double-tap gives tactical sprint',
    r.tacState === 'tacsprint' && r.tac > 8.0, `${r.tac.toFixed(2)} m/s state=${r.tacState}`);
  check('sprint blocks firing, with a sprint-out delay',
    r.walkFire && !r.fireWhileSprint && !r.justAfter && r.later,
    `walk=${r.walkFire} sprint=${r.fireWhileSprint} +0.02s=${r.justAfter} +0.3s=${r.later}`);
}

// 15 — slide cancel: jumping out of a slide keeps the momentum.
{
  const r = await run(() => {
    const T = window.__T, p = T.p;
    T.clearBoxes();
    T.place(800, 0.05, 800, 0);
    T.step(90, { fwd: 1, sprint: true });
    T.step(10, { fwd: 1, sprint: true, crouch: true });
    const sliding = p.state === 'slide', sp = p.speed;
    T.step(2, { fwd: 1, crouch: true, jump: true });
    return { sliding, sp, state: p.state, speed: p.speed, vy: p.velocity.y };
  });
  check('slide can be cancelled into a jump with momentum',
    r.sliding && r.state === 'air' && r.vy > 4 && r.speed > r.sp * 0.85,
    `slideSpd=${r.sp.toFixed(2)} outSpd=${r.speed.toFixed(2)} vy=${r.vy.toFixed(2)}`);
}

check('no console / page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
