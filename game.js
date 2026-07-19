/* FACELESS CITY — a top-down GTA-style open world with CoD-style tactical ops.
   Everyone here — you, pedestrians, cops, hostiles — has a smooth, blank mannequin head.
   No music by design: only gameplay sound effects. */
(() => {
'use strict';

// ---------- constants ----------
const T = 40;                  // tile px
const CITYW = 62;              // city tile columns
const FIELDW = 42;             // outfield tile columns (the warzone)
const GW = CITYW + FIELDW;     // grid width
const GH = 62;                 // grid height
const WW = GW * T, WH = GH * T;
const FIELD_X0 = CITYW * T;    // px where the Outfield begins
const ROAD = 0, SIDE = 1, GRASS = 2, BLDG = 3, DIRT = 4;
const TAU = Math.PI * 2;
const SKIN = '#d9c6ad';        // the mannequin beige — everyone gets it
const SKIN_SHADE = '#c2ad92';

const cvs = document.getElementById('game');
const ctx = cvs.getContext('2d');
let VW = 0, VH = 0;
function resize() { VW = cvs.width = window.innerWidth; VH = cvs.height = window.innerHeight; }
window.addEventListener('resize', resize); resize();

let seed = 987654321;
function rnd() { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; }
const R = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
function angLerp(a, b, t) {
  let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
  return a + d * t;
}

// ---------- map ----------
const tiles = new Uint8Array(GW * GH);
const buildings = [];   // {x,y,w,h,c,hgt,vents,tower}
const trees = [];
const lamps = [];
const covers = [];      // {x,y,r,type,a} solid props: sandbag|crate|rock|wreck|tent
const craters = [];
function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return BLDG;
  return tiles[ty * GW + tx];
}
const solidAt = (px, py) => tileAt(Math.floor(px / T), Math.floor(py / T)) === BLDG;
const isRoadT = (tx, ty) => tx >= 0 && ty >= 0 && tx < CITYW && ty < GH && ((tx % 10) < 2 || (ty % 10) < 2);
const isCross = (tx, ty) => (tx % 10) < 2 && (ty % 10) < 2;
const inField = (px) => px > FIELD_X0;

const BPAL = ['#5d5464', '#6b5a4e', '#54616b', '#665e55', '#4e5a52', '#6d6360', '#595063', '#615755'];
(function buildMap() {
  // --- city ---
  for (let y = 0; y < GH; y++) for (let x = 0; x < CITYW; x++) {
    if ((x % 10) < 2 || (y % 10) < 2) { tiles[y * GW + x] = ROAD; continue; }
    const lx = (x % 10) - 2, ly = (y % 10) - 2;
    tiles[y * GW + x] = (lx === 0 || lx === 7 || ly === 0 || ly === 7) ? SIDE : BLDG;
  }
  for (let gy = 0; gy < 6; gy++) for (let gx = 0; gx < 6; gx++) {
    const x0 = (gx * 10 + 3) * T, y0 = (gy * 10 + 3) * T, S = 6 * T;
    if (rnd() < 0.18) { // park
      for (let ty = gy * 10 + 3; ty <= gy * 10 + 8; ty++)
        for (let tx = gx * 10 + 3; tx <= gx * 10 + 8; tx++) tiles[ty * GW + tx] = GRASS;
      const n = 4 + (rnd() * 5 | 0);
      for (let i = 0; i < n; i++) trees.push({ x: x0 + 20 + rnd() * (S - 40), y: y0 + 20 + rnd() * (S - 40), r: 12 + rnd() * 9 });
      continue;
    }
    const addB = (x, y, w, h) => buildings.push({
      x: x + 6, y: y + 6, w: w - 12, h: h - 12,
      c: BPAL[(rnd() * BPAL.length) | 0], hgt: 22 + rnd() * 40,
      vents: 1 + (rnd() * 3 | 0), tower: rnd() < 0.22
    });
    const r = rnd();
    if (r < 0.3) addB(x0, y0, S, S);
    else if (r < 0.5) { addB(x0, y0, S / 2, S); addB(x0 + S / 2, y0, S / 2, S); }
    else if (r < 0.7) { addB(x0, y0, S, S / 2); addB(x0, y0 + S / 2, S, S / 2); }
    else { addB(x0, y0, S / 2, S / 2); addB(x0 + S / 2, y0, S / 2, S / 2); addB(x0, y0 + S / 2, S / 2, S / 2); addB(x0 + S / 2, y0 + S / 2, S / 2, S / 2); }
  }
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
    const cx = i * 10 * T, cy = j * 10 * T;
    for (const [lx, ly] of [[cx - 10, cy - 10], [cx + 2 * T + 10, cy - 10], [cx - 10, cy + 2 * T + 10], [cx + 2 * T + 10, cy + 2 * T + 10]])
      if (lx > 0 && ly > 0 && lx < FIELD_X0 && ly < WH) lamps.push({ x: lx, y: ly });
  }
  // --- the Outfield (warzone) ---
  for (let y = 0; y < GH; y++) for (let x = CITYW; x < GW; x++)
    tiles[y * GW + x] = rnd() < 0.12 ? GRASS : DIRT;
  for (let i = 0; i < 26; i++)
    craters.push({ x: FIELD_X0 + 120 + rnd() * (FIELDW * T - 240), y: 80 + rnd() * (WH - 160), r: 14 + rnd() * 22 });
  for (let i = 0; i < 30; i++) { // scattered rocks & dead trees
    const x = FIELD_X0 + 100 + rnd() * (FIELDW * T - 200), y = 60 + rnd() * (WH - 120);
    covers.push({ x, y, r: 9 + rnd() * 8, type: 'rock', a: rnd() * TAU });
  }
  for (let i = 0; i < 10; i++) { // wrecked vehicles
    const x = FIELD_X0 + 160 + rnd() * (FIELDW * T - 320), y = 100 + rnd() * (WH - 200);
    covers.push({ x, y, r: 20, type: 'wreck', a: rnd() * TAU });
  }
})();

// camps + operations
function buildCamp(cx, cy) {
  const n = 8 + (rnd() * 4 | 0);
  for (let i = 0; i < n; i++) { // sandbag ring
    const a = (i / n) * TAU + rnd() * 0.4, d = 120 + rnd() * 90;
    covers.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: 13, type: 'sandbag', a: a + Math.PI / 2 });
  }
  for (let i = 0; i < 4; i++)
    covers.push({ x: cx + R(-70, 70), y: cy + R(-70, 70), r: 11, type: 'crate', a: rnd() * 0.8 });
  covers.push({ x: cx, y: cy - 40, r: 22, type: 'tent', a: 0 });
  covers.push({ x: cx + 55, y: cy + 30, r: 22, type: 'tent', a: 0.3 });
}
const CAMPS = [
  { x: FIELD_X0 + 26 * T, y: 18 * T },
  { x: FIELD_X0 + 33 * T, y: 44 * T },
  { x: FIELD_X0 + 14 * T, y: 31 * T }
];
CAMPS.forEach(c => buildCamp(c.x, c.y));
const OPS = [
  { name: 'FIRST CONTACT', camp: 0, need: 8, reward: 500, eliteEvery: 0, mx: CAMPS[0].x - 300, my: CAMPS[0].y + 20 },
  { name: 'SUPPLY RAID', camp: 1, need: 12, reward: 1000, eliteEvery: 5, mx: CAMPS[1].x - 300, my: CAMPS[1].y - 40 },
  { name: 'GHOST PROTOCOL', camp: 2, need: 16, reward: 2000, eliteEvery: 3, mx: CAMPS[2].x + 40, my: CAMPS[2].y - 300 }
];
const opDone = [false, false, false];
let op = { idx: -1, kills: 0, spawned: 0, coolT: 0 };

// glow sprite
const glow = document.createElement('canvas'); glow.width = glow.height = 128;
{
  const g = glow.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,190,110,0.55)'); gr.addColorStop(0.4, 'rgba(255,170,90,0.18)'); gr.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
}
// minimap sprite
const mm = document.createElement('canvas'); mm.width = GW * 2; mm.height = GH * 2;
{
  const g = mm.getContext('2d');
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const t = tiles[y * GW + x];
    g.fillStyle = t === ROAD ? '#20242c' : t === SIDE ? '#3c414c' : t === GRASS ? '#2f4632' : t === DIRT ? '#4a4034' : '#565064';
    g.fillRect(x * 2, y * 2, 2, 2);
  }
}

// ---------- audio (SFX only — this game has no music) ----------
let AC = null, sirenOsc = null, sirenGain = null;
function audioInit() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    sirenOsc = AC.createOscillator(); sirenGain = AC.createGain();
    sirenGain.gain.value = 0; sirenOsc.frequency.value = 700;
    sirenOsc.connect(sirenGain); sirenGain.connect(AC.destination); sirenOsc.start();
  } catch (e) { AC = null; }
}
function sfx(kind) {
  if (!AC) return;
  try {
    const t0 = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    if (kind === 'punch') { o.type = 'square'; o.frequency.setValueAtTime(95, t0); g.gain.setValueAtTime(0.12, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09); o.start(t0); o.stop(t0 + 0.1); }
    else if (kind === 'cash') { o.type = 'sine'; o.frequency.setValueAtTime(950, t0); o.frequency.setValueAtTime(1420, t0 + 0.07); g.gain.setValueAtTime(0.09, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16); o.start(t0); o.stop(t0 + 0.17); }
    else if (kind === 'crash') { o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t0); g.gain.setValueAtTime(0.14, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2); o.start(t0); o.stop(t0 + 0.21); }
    else if (kind === 'door') { o.type = 'triangle'; o.frequency.setValueAtTime(240, t0); g.gain.setValueAtTime(0.08, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1); o.start(t0); o.stop(t0 + 0.11); }
    else if (kind === 'shot') { o.type = 'square'; o.frequency.setValueAtTime(1600, t0); o.frequency.exponentialRampToValueAtTime(120, t0 + 0.07); g.gain.setValueAtTime(0.10, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08); o.start(t0); o.stop(t0 + 0.09); }
    else if (kind === 'eshot') { o.type = 'square'; o.frequency.setValueAtTime(1100, t0); o.frequency.exponentialRampToValueAtTime(90, t0 + 0.08); g.gain.setValueAtTime(0.05, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09); o.start(t0); o.stop(t0 + 0.1); }
    else if (kind === 'reload') { o.type = 'triangle'; o.frequency.setValueAtTime(500, t0); o.frequency.setValueAtTime(350, t0 + 0.1); g.gain.setValueAtTime(0.07, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22); o.start(t0); o.stop(t0 + 0.23); }
    else if (kind === 'win') { o.type = 'sine'; o.frequency.setValueAtTime(660, t0); o.frequency.setValueAtTime(880, t0 + 0.12); o.frequency.setValueAtTime(1180, t0 + 0.24); g.gain.setValueAtTime(0.09, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5); o.start(t0); o.stop(t0 + 0.5); }
  } catch (e) { /* ignore */ }
}

// ---------- state ----------
const keys = {};
const mouse = { x: 0, y: 0, down: false, wx: 0, wy: 0 };
let state = 'intro'; // intro | play | busted | wasted
let stateT = 0;
let cars = [], peds = [], cops = [], enemies = [], bullets = [], pickups = [], pops = [], smoke = [], flashes = [];
let wanted = 0, heat = 0, evadeT = 0, sirenPhase = 0;
let cam = { x: 0, y: 0 };
let msg = '', msgT = 0, fieldToast = false;

const player = {
  x: 0, y: 0, a: 0, hp: 100, money: 0, car: null,
  phase: 0, punchT: 0, downT: 0, moving: false,
  mag: 30, reloadT: 0, fireT: 0, hitT: 0
};
const MAG = 30;

function toast(t, secs) { msg = t; msgT = secs || 2.5; }
function popup(x, y, txt, col) { pops.push({ x, y, txt, col: col || '#8fe388', t: 1.4 }); }

function resetGame() {
  cars = []; peds = []; cops = []; enemies = []; bullets = []; pickups = []; pops = []; smoke = []; flashes = [];
  wanted = 0; heat = 0; evadeT = 0; fieldToast = false;
  op = { idx: -1, kills: 0, spawned: 0, coolT: 0 };
  player.x = 32.5 * T; player.y = 32.5 * T; player.a = 0;
  player.hp = 100; player.money = 0; player.car = null; player.downT = 0;
  player.mag = MAG; player.reloadT = 0; player.fireT = 0; player.hitT = 0;
  cars.push(mkCar(31 * T, 32.5 * T, -Math.PI / 2, 'free'));
  cam.x = player.x; cam.y = player.y;
  toast('Faceless City. Grab the car (E). Operations wait east, in the Outfield.', 5);
}

// ---------- factories ----------
const CARPAL = ['#7d3b3b', '#3b5a7d', '#6e6a52', '#42425a', '#7a6a3f', '#513f5e', '#3f5e51', '#8a8578'];
function mkCar(x, y, a, type) {
  return { x, y, a, spd: 0, type, dirx: 0, diry: 0, lane: 0,
    state: 'go', ex: 0, ey: 0, cruise: R(75, 115), hp: 100, planCd: 0, flash: 0, panicT: 0,
    c: type === 'cop' ? '#e8e8ea' : CARPAL[(Math.random() * CARPAL.length) | 0], dead: false };
}
const PEDPAL = ['#4a4f38', '#5a4632', '#39465a', '#5e3a3a', '#46523f', '#3d3d4d', '#6b5d45', '#525a63'];
function mkPed(x, y) {
  return { x, y, a: R(0, TAU), spd: R(36, 55), state: 'walk', t: R(0.5, 3),
    col: PEDPAL[(Math.random() * PEDPAL.length) | 0], phase: Math.random() * TAU, hp: 100, downT: 0, dead: false, fade: 1 };
}
function mkEnemy(x, y, elite) {
  return { x, y, a: R(0, TAU), hp: elite ? 150 : 70, elite: !!elite, state: 'move',
    cx: x, cy: y, moveT: 0, cd: R(0.6, 1.6), volley: 5, los: false, losT: 0,
    phase: Math.random() * TAU, dead: false, downT: 0, fade: 1 };
}

function pickSpawn(pred, dMin, dMax, tries) {
  for (let i = 0; i < (tries || 40); i++) {
    const ang = Math.random() * TAU, d = R(dMin, dMax);
    const px = player.x + Math.cos(ang) * d, py = player.y + Math.sin(ang) * d;
    const tx = Math.floor(px / T), ty = Math.floor(py / T);
    if (tx < 1 || ty < 1 || tx >= GW - 1 || ty >= GH - 1) continue;
    if (pred(tx, ty)) return { px, py, tx, ty };
  }
  return null;
}

function laneFor(tx, ty) {
  if (!isRoadT(tx, ty)) return null;
  if ((ty % 10) < 2 && (tx % 10) >= 2) {
    const sub = ty % 10, laneY = ty * T + T / 2;
    return sub === 0 ? { dirx: -1, diry: 0, lane: laneY } : { dirx: 1, diry: 0, lane: laneY };
  }
  if ((tx % 10) < 2 && (ty % 10) >= 2) {
    const sub = tx % 10, laneX = tx * T + T / 2;
    return sub === 0 ? { dirx: 0, diry: 1, lane: laneX } : { dirx: 0, diry: -1, lane: laneX };
  }
  return null;
}

function spawnStuff() {
  const nearPeds = peds.filter(p => dist(p.x, p.y, player.x, player.y) < 1300);
  if (nearPeds.length < 22 && peds.length < 40 && !inField(player.x)) {
    const s = pickSpawn((tx, ty) => tileAt(tx, ty) === SIDE, 500, 1000);
    if (s) peds.push(mkPed(s.px, s.py));
  }
  peds = peds.filter(p => !p.dead && dist(p.x, p.y, player.x, player.y) < 1600);
  const traffic = cars.filter(c => c.type === 'traffic');
  if (traffic.length < 10 && player.x < FIELD_X0 + 400) {
    const s = pickSpawn((tx, ty) => isRoadT(tx, ty) && !isCross(tx, ty), 600, 1100);
    if (s) {
      const L = laneFor(s.tx, s.ty);
      if (L) {
        const c = mkCar((L.diry !== 0 ? L.lane : s.px), (L.dirx !== 0 ? L.lane : s.py), Math.atan2(L.diry, L.dirx), 'traffic');
        c.dirx = L.dirx; c.diry = L.diry; c.lane = L.lane;
        if (!cars.some(o => dist(o.x, o.y, c.x, c.y) < 90)) cars.push(c);
      }
    }
  }
  cars = cars.filter(c => !c.dead && (c === player.car || c.type === 'free'
    ? dist(c.x, c.y, player.x, player.y) < 2800 : dist(c.x, c.y, player.x, player.y) < 1700));
  const free = cars.filter(c => c.type === 'free' && c !== player.car);
  if (free.length > 6) free.sort((a, b) => dist(b.x, b.y, player.x, player.y) - dist(a.x, a.y, player.x, player.y))[0].dead = true;
  // cops never follow into the Outfield
  if (inField(player.x)) {
    if (wanted > 0 || cops.length) {
      wanted = 0; cops = [];
      if (!fieldToast) { toast('The law does not follow you out here.', 3); fieldToast = true; }
    }
    return;
  }
  fieldToast = false;
  while (cops.length < wanted + (wanted > 2 ? 1 : 0)) {
    const s = pickSpawn((tx, ty) => isRoadT(tx, ty) && !isCross(tx, ty), 650, 1000);
    if (!s) break;
    cops.push(mkCar(s.px, s.py, Math.atan2(player.y - s.py, player.x - s.px), 'cop'));
  }
  if (wanted === 0 && cops.length) cops = [];
  cops = cops.filter(c => !c.dead);
}

// ---------- operations (the CoD layer) ----------
function opAlive() { return enemies.filter(e => e.state !== 'down').length; }
function startOp(i) {
  op.idx = i; op.kills = 0; op.spawned = 0;
  enemies = []; bullets = [];
  player.mag = MAG; player.reloadT = 0;
  toast('OPERATION ' + OPS[i].name + ' — clear ' + OPS[i].need + ' hostiles. Use cover.', 5);
  sfx('reload');
}
function endOp(won) {
  if (op.idx < 0) return;
  const o = OPS[op.idx];
  if (won) {
    opDone[op.idx] = true;
    player.money += o.reward;
    popup(player.x, player.y - 24, '+$' + o.reward, '#ffd23f');
    toast('OPERATION ' + o.name + ' complete. Payout: $' + o.reward +
      (op.idx < 2 && !opDone[op.idx + 1] ? '. Next op unlocked.' : ''), 5);
    sfx('win');
    if (opDone.every(Boolean)) setTimeout(() => toast('All operations cleared. The Outfield is yours.', 5), 2600);
  } else toast('Operation aborted.', 3);
  op.idx = -1; op.coolT = 3;
  for (const e of enemies) if (e.state !== 'down') { e.state = 'down'; e.downT = 6; }
}
function updateOps(dt) {
  op.coolT = Math.max(0, op.coolT - dt);
  if (op.idx < 0) {
    if (op.coolT > 0) return;
    for (let i = 0; i < OPS.length; i++) {
      if (i > 0 && !opDone[i - 1]) continue;
      if (dist(player.x, player.y, OPS[i].mx, OPS[i].my) < 34) { startOp(i); break; }
    }
    return;
  }
  const o = OPS[op.idx], camp = CAMPS[o.camp];
  // abort if player retreats to the city
  if (player.x < FIELD_X0 - 60) { endOp(false); return; }
  // waves: keep pressure on while there are hostiles left to spawn
  const alive = opAlive();
  if (op.spawned < o.need && alive < (op.idx === 0 ? 4 : 5)) {
    const n = Math.min(o.need - op.spawned, (op.idx === 0 ? 4 : 5) - alive);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, d = R(150, 260);
      let ex = camp.x + Math.cos(a) * d, ey = camp.y + Math.sin(a) * d;
      ex = clamp(ex, FIELD_X0 + 40, WW - 40); ey = clamp(ey, 40, WH - 40);
      if (dist(ex, ey, player.x, player.y) < 140) continue;
      op.spawned++;
      enemies.push(mkEnemy(ex, ey, o.eliteEvery && (op.spawned % o.eliteEvery === 0)));
    }
  }
  if (op.kills >= o.need) endOp(true);
}

// line of sight: blocked by buildings and cover props
function los(x1, y1, x2, y2) {
  const d = dist(x1, y1, x2, y2), steps = Math.ceil(d / 14);
  for (let i = 1; i < steps; i++) {
    const x = x1 + (x2 - x1) * i / steps, y = y1 + (y2 - y1) * i / steps;
    if (solidAt(x, y)) return false;
    for (const c of covers) if (dist(c.x, c.y, x, y) < c.r - 2) return false;
  }
  return true;
}
function pushOutOfCovers(o, r) {
  for (const c of covers) {
    const d = dist(c.x, c.y, o.x, o.y), min = c.r + r;
    if (d < min && d > 0.01) {
      const n = Math.atan2(o.y - c.y, o.x - c.x);
      o.x += Math.cos(n) * (min - d); o.y += Math.sin(n) * (min - d);
    }
  }
}

function fireBullet(x, y, a, friendly, dmg) {
  bullets.push({ x, y, a, spd: 820, ttl: 0.75, friendly, dmg });
  flashes.push({ x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6, t: 0.06 });
}

function updateBullets(dt) {
  for (const b of bullets) {
    b.ttl -= dt;
    const step = b.spd * dt, sub = Math.ceil(step / 8);
    for (let i = 0; i < sub && b.ttl > 0; i++) {
      b.x += Math.cos(b.a) * step / sub; b.y += Math.sin(b.a) * step / sub;
      if (solidAt(b.x, b.y)) { b.ttl = 0; break; }
      let stop = false;
      for (const c of covers) if (dist(c.x, c.y, b.x, b.y) < c.r - 1) { stop = true; break; }
      if (stop) { b.ttl = 0; break; }
      if (b.friendly) {
        for (const e of enemies) {
          if (e.state === 'down') continue;
          if (dist(e.x, e.y, b.x, b.y) < 9) {
            e.hp -= b.dmg; e.moveT = 0; b.ttl = 0;
            if (e.hp <= 0) killEnemy(e);
            break;
          }
        }
      } else {
        if (player.car) {
          if (dist(player.car.x, player.car.y, b.x, b.y) < 17) { player.car.hp -= 4; b.ttl = 0; sfx('crash'); }
        } else if (dist(player.x, player.y, b.x, b.y) < 8) {
          player.hp -= R(8, 14); player.hitT = 0.35; b.ttl = 0;
        }
      }
    }
  }
  bullets = bullets.filter(b => b.ttl > 0);
  for (const f of flashes) f.t -= dt;
  flashes = flashes.filter(f => f.t > 0);
}

function killEnemy(e) {
  e.state = 'down'; e.downT = 25; op.kills++;
  const amt = 30 + (Math.random() * 50 | 0);
  pickups.push({ x: e.x + R(-6, 6), y: e.y + R(-6, 6), amt, t: 40 });
  sfx('punch');
}

function updateEnemy(e, dt) {
  if (e.state === 'down') {
    e.downT -= dt;
    if (e.downT < 3) e.fade = Math.max(0, e.downT / 3);
    if (e.downT <= 0) e.dead = true;
    return;
  }
  const px = player.x, py = player.y;
  const d = dist(e.x, e.y, px, py);
  e.losT -= dt;
  if (e.losT <= 0) { e.los = los(e.x, e.y, px, py); e.losT = 0.18; }
  e.moveT -= dt;
  if (e.moveT <= 0) {
    // guerrilla move: pick a cover point on the far side of a prop, holding a ~200px ring
    let best = null, bs = 1e9;
    for (const c of covers) {
      if (c.type === 'tent') continue;
      const dc = dist(c.x, c.y, e.x, e.y);
      if (dc > 420) continue;
      const dp = dist(c.x, c.y, px, py);
      const score = Math.abs(dp - 200) + dc * 0.55 + (dp < 90 ? 400 : 0);
      if (score < bs) { bs = score; best = c; }
    }
    if (best) {
      const away = Math.atan2(best.y - py, best.x - px);
      e.cx = best.x + Math.cos(away) * (best.r + 11);
      e.cy = best.y + Math.sin(away) * (best.r + 11);
    } else { // no cover: skirmish sidestep
      const a = Math.atan2(e.y - py, e.x - px) + R(-1.2, 1.2);
      e.cx = px + Math.cos(a) * R(160, 240); e.cy = py + Math.sin(a) * R(160, 240);
    }
    e.cx = clamp(e.cx, FIELD_X0 + 20, WW - 20); e.cy = clamp(e.cy, 20, WH - 20);
    e.moveT = R(2.5, 5);
  }
  const dm = dist(e.x, e.y, e.cx, e.cy);
  if (dm > 12) {
    const ma = Math.atan2(e.cy - e.y, e.cx - e.x);
    const sp = e.elite ? 120 : 100;
    const nx = e.x + Math.cos(ma) * sp * dt, ny = e.y + Math.sin(ma) * sp * dt;
    if (!solidAt(nx, ny)) { e.x = nx; e.y = ny; } else e.moveT = 0;
    e.phase += sp * dt * 0.09;
    if (!e.los) e.a = angLerp(e.a, ma, clamp(8 * dt, 0, 1));
  }
  pushOutOfCovers(e, 6);
  if (e.los) e.a = angLerp(e.a, Math.atan2(py - e.y, px - e.x), clamp(10 * dt, 0, 1));
  // fire discipline: volleys with pauses
  e.cd -= dt;
  if (e.los && d < 470 && e.cd <= 0) {
    const spread = 0.06 + d * 0.00022 + (dm > 12 ? 0.09 : 0);
    fireBullet(e.x + Math.cos(e.a) * 12, e.y + Math.sin(e.a) * 12, e.a + R(-spread, spread), false, 0);
    sfx('eshot');
    e.volley--;
    e.cd = e.volley > 0 ? R(0.13, 0.22) : R(1.1, 2.2);
    if (e.volley <= 0) e.volley = e.elite ? 8 : 5;
  }
  // run over by player car
  if (player.car && dist(e.x, e.y, player.car.x, player.car.y) < 19 && Math.abs(player.car.spd) > 70) killEnemy(e);
  // melee if you get close
  if (!player.car && d < 26 && e.cd <= 0.5) { player.hp -= 10 * dt * 4; player.hitT = 0.3; }
}

// ---------- crime ----------
function addWanted(n) { wanted = clamp(wanted + n, 1, 5); heat = 1; evadeT = 0; }
function koPed(p, cause) {
  if (p.state === 'down') return;
  p.state = 'down'; p.downT = 20; p.hp = 0;
  const amt = 10 + (Math.random() * 50 | 0);
  pickups.push({ x: p.x + R(-8, 8), y: p.y + R(-8, 8), amt, t: 30 });
  scare(p.x, p.y, 260);
  addWanted(1);
  sfx(cause === 'car' ? 'crash' : 'punch');
}
function scare(x, y, r) {
  for (const p of peds) if (p.state === 'walk' && dist(p.x, p.y, x, y) < r) {
    p.state = 'flee'; p.t = R(3, 6);
    p.a = Math.atan2(p.y - y, p.x - x) + R(-0.5, 0.5);
  }
}

// ---------- player ----------
const armed = () => !player.car && inField(player.x) && state === 'play';

function updatePlayerFoot(dt) {
  if (player.downT > 0) { player.downT -= dt; return; }
  let dx = 0, dy = 0;
  if (keys.ArrowUp || keys.KeyW) dy -= 1;
  if (keys.ArrowDown || keys.KeyS) dy += 1;
  if (keys.ArrowLeft || keys.KeyA) dx -= 1;
  if (keys.ArrowRight || keys.KeyD) dx += 1;
  const spd = (keys.ShiftLeft || keys.ShiftRight) ? 205 : 135;
  player.moving = !!(dx || dy);
  if (player.moving) {
    const a = Math.atan2(dy, dx);
    if (!armed()) player.a = angLerp(player.a, a, clamp(14 * dt, 0, 1));
    const nx = player.x + Math.cos(a) * spd * dt;
    const ny = player.y + Math.sin(a) * spd * dt;
    if (!solidAt(nx + Math.sign(Math.cos(a)) * 6, player.y)) player.x = clamp(nx, 8, WW - 8);
    if (!solidAt(player.x, ny + Math.sign(Math.sin(a)) * 6)) player.y = clamp(ny, 8, WH - 8);
    player.phase += spd * dt * 0.09;
  }
  pushOutOfCovers(player, 6);
  for (const c of allCars()) {
    const d = dist(c.x, c.y, player.x, player.y);
    if (d < 24 && c !== player.car) {
      const n = Math.atan2(player.y - c.y, player.x - c.x);
      player.x += Math.cos(n) * (24 - d); player.y += Math.sin(n) * (24 - d);
      if (Math.abs(c.spd) > 90) { player.hp -= Math.abs(c.spd) * 0.09; player.downT = 1.1; sfx('crash'); }
    }
  }
  // rifle — only drawn in the Outfield; holstered in the city
  if (armed()) {
    player.a = Math.atan2(mouse.wy - player.y, mouse.wx - player.x);
    player.fireT = Math.max(0, player.fireT - dt);
    if (player.reloadT > 0) {
      player.reloadT -= dt;
      if (player.reloadT <= 0) { player.mag = MAG; sfx('reload'); }
    } else if (keys.KeyR && player.mag < MAG) { player.reloadT = 1.1; sfx('reload'); }
    else if (mouse.down && player.fireT <= 0) {
      if (player.mag > 0) {
        player.mag--; player.fireT = 0.11;
        const spread = player.moving ? 0.055 : 0.028;
        fireBullet(player.x + Math.cos(player.a) * 14, player.y + Math.sin(player.a) * 14,
          player.a + R(-spread, spread), true, 34);
        sfx('shot');
        if (player.mag === 0) player.reloadT = 1.3;
      }
    }
  }
  // punch
  player.punchT = Math.max(0, player.punchT - dt);
  if (keys.Space && player.punchT === 0) {
    player.punchT = 0.4; sfx('punch');
    for (const p of peds) {
      const d = dist(p.x, p.y, player.x, player.y);
      if (d < 34 && p.state !== 'down') {
        const rel = Math.atan2(p.y - player.y, p.x - player.x);
        let da = Math.abs(((rel - player.a) % TAU + TAU) % TAU); if (da > Math.PI) da = TAU - da;
        if (da < 1.2) {
          p.hp -= 55;
          if (p.hp <= 0) koPed(p, 'punch');
          else { p.state = 'flee'; p.t = 5; p.a = rel; scare(p.x, p.y, 150); addWanted(1); }
          break;
        }
      }
    }
    for (const e of enemies) {
      if (e.state !== 'down' && dist(e.x, e.y, player.x, player.y) < 34) { e.hp -= 60; if (e.hp <= 0) killEnemy(e); break; }
    }
  }
  for (const g of pickups) if (dist(g.x, g.y, player.x, player.y) < 16) {
    player.money += g.amt; g.t = 0; popup(player.x, player.y - 14, '+$' + g.amt); sfx('cash');
  }
  // enter car
  let best = null, bd = 52;
  for (const c of allCars()) { const d = dist(c.x, c.y, player.x, player.y); if (d < bd) { bd = d; best = c; } }
  if (best) {
    toast('Press E to ' + (best.type === 'cop' ? 'jack the cop car' : best.type === 'traffic' ? 'carjack' : 'enter'), 0.15);
    if (keys.KeyE) {
      keys.KeyE = false; sfx('door');
      if (best.type === 'traffic') { const drv = mkPed(best.x, best.y); drv.state = 'flee'; drv.t = 6; drv.a = R(0, TAU); peds.push(drv); addWanted(1); scare(best.x, best.y, 200); }
      if (best.type === 'cop') { cops = cops.filter(c => c !== best); addWanted(2); }
      best.type = 'free'; best.state = 'go';
      player.car = best; player.x = best.x; player.y = best.y;
    }
  }
}

function updatePlayerCar(dt) {
  const c = player.car;
  const up = keys.ArrowUp || keys.KeyW, dn = keys.ArrowDown || keys.KeyS;
  const lf = keys.ArrowLeft || keys.KeyA, rt = keys.ArrowRight || keys.KeyD;
  const hb = keys.Space;
  const broken = c.hp <= 0;
  if (up && !broken) c.spd += (c.spd < 0 ? 500 : 270) * dt;
  if (dn && !broken) c.spd -= (c.spd > 0 ? 460 : 200) * dt;
  c.spd = clamp(c.spd, -150, broken ? 60 : 400);
  c.spd -= c.spd * (hb ? 2.6 : 0.75) * dt;
  if (!up && !dn) c.spd -= c.spd * 1.1 * dt;
  const steer = (rt ? 1 : 0) - (lf ? 1 : 0);
  c.a += steer * (hb ? 3.6 : 2.5) * dt * clamp(c.spd / 150, -1, 1);
  const nx = c.x + Math.cos(c.a) * c.spd * dt;
  const ny = c.y + Math.sin(c.a) * c.spd * dt;
  if (carBlocked(nx, ny, c.a)) {
    if (Math.abs(c.spd) > 100) { c.hp -= Math.abs(c.spd) / 28; sfx('crash'); }
    c.spd *= -0.35;
  } else { c.x = nx; c.y = ny; }
  c.x = clamp(c.x, 20, WW - 20); c.y = clamp(c.y, 20, WH - 20);
  for (const o of allCars()) {
    if (o === c) continue;
    const d = dist(o.x, o.y, c.x, c.y);
    if (d < 32) {
      const n = Math.atan2(o.y - c.y, o.x - c.x);
      o.x += Math.cos(n) * (32 - d); o.y += Math.sin(n) * (32 - d);
      if (Math.abs(c.spd) > 140) { sfx('crash'); c.hp -= 3; if (o.type === 'cop') addWanted(1); else { scare(o.x, o.y, 200); heat = Math.max(heat, 0.5); } }
      c.spd *= 0.55;
      if (o.type === 'traffic') { o.cruise = 0; o.panicT = 3; }
    }
  }
  for (const p of peds) {
    if (p.state === 'down') continue;
    if (dist(p.x, p.y, c.x, c.y) < 19 && Math.abs(c.spd) > 70) koPed(p, 'car');
  }
  for (const g of pickups) if (dist(g.x, g.y, c.x, c.y) < 22) {
    player.money += g.amt; g.t = 0; popup(c.x, c.y - 16, '+$' + g.amt); sfx('cash');
  }
  if (c.hp < 45 && Math.random() < 0.35) smoke.push({ x: c.x - Math.cos(c.a) * 14, y: c.y - Math.sin(c.a) * 14, r: R(3, 6), t: 1 });
  if (broken) toast('This car is wrecked — press E to bail', 0.15);
  player.x = c.x; player.y = c.y; player.a = c.a;
  if (keys.KeyE) {
    keys.KeyE = false; sfx('door');
    const side = c.a - Math.PI / 2;
    let ex = c.x + Math.cos(side) * 30, ey = c.y + Math.sin(side) * 30;
    if (solidAt(ex, ey)) { ex = c.x - Math.cos(side) * 30; ey = c.y - Math.sin(side) * 30; }
    if (!solidAt(ex, ey)) { player.car = null; player.x = ex; player.y = ey; }
  }
}

function carBlocked(x, y, a) {
  const ca = Math.cos(a), sa = Math.sin(a);
  for (const [fx, fy] of [[17, 8], [17, -8], [-17, 8], [-17, -8]]) {
    if (solidAt(x + fx * ca - fy * sa, y + fx * sa + fy * ca)) return true;
  }
  for (const c of covers) if (dist(c.x, c.y, x, y) < c.r + 14) return true;
  return false;
}
function allCars() { return cars.concat(cops); }

// ---------- traffic / cops / peds ----------
function updateTraffic(c, dt) {
  c.panicT = Math.max(0, (c.panicT || 0) - dt);
  const lookX = c.x + Math.cos(c.a) * 52, lookY = c.y + Math.sin(c.a) * 52;
  let blocked = false;
  for (const o of allCars()) if (o !== c && dist(o.x, o.y, lookX, lookY) < 36) blocked = true;
  if (!player.car && dist(player.x, player.y, lookX, lookY) < 30) blocked = true;
  for (const p of peds) if (p.state !== 'down' && dist(p.x, p.y, lookX, lookY) < 26) blocked = true;
  const target = blocked ? 0 : (c.panicT > 0 ? 40 : c.cruise || 90);
  c.spd += clamp(target - c.spd, -260 * dt, 90 * dt);
  if (c.spd < 1 && blocked) c.spd = 0;

  if (c.state === 'turn') {
    const ta = Math.atan2(c.ey - c.y, c.ex - c.x);
    c.a = angLerp(c.a, ta, clamp(6 * dt, 0, 1));
    const sp = Math.max(c.spd, 40);
    c.x += Math.cos(ta) * sp * dt; c.y += Math.sin(ta) * sp * dt;
    if (dist(c.x, c.y, c.ex, c.ey) < 10) {
      c.state = 'go';
      const L = laneFor(Math.floor(c.x / T), Math.floor(c.y / T));
      if (L) c.lane = L.lane;
    }
    return;
  }
  c.a = angLerp(c.a, Math.atan2(c.diry, c.dirx), clamp(8 * dt, 0, 1));
  c.x += c.dirx * c.spd * dt; c.y += c.diry * c.spd * dt;
  if (c.dirx !== 0) c.y += (c.lane - c.y) * clamp(4 * dt, 0, 1);
  else c.x += (c.lane - c.x) * clamp(4 * dt, 0, 1);

  c.planCd -= dt;
  const ftx = Math.floor((c.x + c.dirx * T * 1.3) / T), fty = Math.floor((c.y + c.diry * T * 1.3) / T);
  if (c.planCd <= 0 && isCross(ftx, fty) && ftx < CITYW) {
    const X0 = ftx - (ftx % 10), Y0 = fty - (fty % 10);
    const cxp = (X0 + 1) * T, cyp = (Y0 + 1) * T;
    const d = { x: c.dirx, y: c.diry };
    const opts = [];
    for (const nd of [d, { x: -d.y, y: d.x }, { x: d.y, y: -d.x }]) {
      const bx = Math.floor((cxp + nd.x * 2.4 * T) / T), by = Math.floor((cyp + nd.y * 2.4 * T) / T);
      if (isRoadT(bx, by)) opts.push(nd);
    }
    let nd;
    if (!opts.length) { c.dead = true; return; }
    if (opts[0] === d && Math.random() < 0.62) nd = d;
    else nd = opts[(Math.random() * opts.length) | 0];
    c.planCd = (4.5 * T) / Math.max(40, c.cruise);
    if (nd !== d) {
      let ex, ey;
      if (nd.x !== 0) { ex = cxp + nd.x * 1.7 * T; ey = nd.x === 1 ? cyp + T / 2 : cyp - T / 2; }
      else { ey = cyp + nd.y * 1.7 * T; ex = nd.y === 1 ? cxp - T / 2 : cxp + T / 2; }
      c.state = 'turn'; c.ex = ex; c.ey = ey; c.dirx = nd.x; c.diry = nd.y;
    }
  }
  if (c.x < 30 || c.y < 30 || c.x > FIELD_X0 + 60 || c.y > WH - 30) c.dead = true;
}

function updateCop(c, dt) {
  c.flash += dt;
  const px = player.x, py = player.y;
  const d = dist(c.x, c.y, px, py);
  const desired = Math.atan2(py - c.y, px - c.x);
  c.a = angLerp(c.a, desired, clamp(2.6 * dt, 0, 1));
  const target = d > 260 ? 330 : (player.car ? 250 : 120);
  c.spd += clamp(target - c.spd, -400 * dt, 220 * dt);
  const nx = c.x + Math.cos(c.a) * c.spd * dt;
  const ny = c.y + Math.sin(c.a) * c.spd * dt;
  if (carBlocked(nx, ny, c.a)) { c.spd *= -0.45; c.a += R(-0.6, 0.6); }
  else { c.x = nx; c.y = ny; }
  c.x = clamp(c.x, 20, WW - 20); c.y = clamp(c.y, 20, WH - 20);
  if (player.car) {
    const pc = player.car, dd = dist(c.x, c.y, pc.x, pc.y);
    if (dd < 34) {
      const n = Math.atan2(pc.y - c.y, pc.x - c.x);
      pc.x += Math.cos(n) * (34 - dd); pc.y += Math.sin(n) * (34 - dd);
      if (Math.abs(c.spd) > 120) { pc.hp -= 7; pc.spd *= 0.75; c.spd *= 0.4; sfx('crash'); }
    }
  } else {
    if (d < 30 && Math.abs(c.spd) < 160) bust();
    if (d < 20 && Math.abs(c.spd) >= 160) { player.hp -= 25; player.downT = 1.2; c.spd *= 0.3; sfx('crash'); }
  }
  if (player.car && d < 46 && Math.abs(player.car.spd) < 25) {
    c.arrestT = (c.arrestT || 0) + dt;
    if (c.arrestT > 2) bust();
  } else c.arrestT = 0;
  for (const p of peds) if (p.state !== 'down' && dist(p.x, p.y, c.x, c.y) < 18 && Math.abs(c.spd) > 90) { p.state = 'down'; p.downT = 20; p.hp = 0; scare(p.x, p.y, 200); }
}

function updatePed(p, dt) {
  p.t -= dt;
  if (p.state === 'down') {
    p.downT -= dt;
    if (p.downT < 3) p.fade = Math.max(0, p.downT / 3);
    if (p.downT <= 0) p.dead = true;
    return;
  }
  if (p.state === 'flee') {
    if (p.t <= 0) { p.state = 'walk'; p.t = R(1, 3); p.spd = R(36, 55); }
    const sp = 150;
    const nx = p.x + Math.cos(p.a) * sp * dt, ny = p.y + Math.sin(p.a) * sp * dt;
    if (solidAt(nx, ny)) p.a += R(1.2, 2.2); else { p.x = nx; p.y = ny; }
    p.phase += sp * dt * 0.09;
    return;
  }
  if (p.t <= 0) { p.t = R(1, 4); if (Math.random() < 0.5) p.a = (Math.random() * 4 | 0) * Math.PI / 2 + R(-0.2, 0.2); }
  const nx = p.x + Math.cos(p.a) * p.spd * dt, ny = p.y + Math.sin(p.a) * p.spd * dt;
  const nt = tileAt(Math.floor((nx + Math.cos(p.a) * 8) / T), Math.floor((ny + Math.sin(p.a) * 8) / T));
  if (nt === SIDE || nt === GRASS) { p.x = nx; p.y = ny; p.phase += p.spd * dt * 0.09; }
  else { p.a += Math.PI / 2 + R(0, Math.PI); p.t = R(1, 3); }
  if (player.car && Math.abs(player.car.spd) > 180 && dist(p.x, p.y, player.x, player.y) < 120) {
    p.state = 'flee'; p.t = 3; p.a = Math.atan2(p.y - player.y, p.x - player.x) + R(-0.4, 0.4);
  }
}

// ---------- fail states ----------
function bust() { if (state === 'play') { state = 'busted'; stateT = 0; sfx('crash'); } }
function waste() { if (state === 'play') { state = 'wasted'; stateT = 0; sfx('crash'); } }
function afterFail(kind) {
  const cut = Math.floor(player.money * (kind === 'busted' ? 0.3 : 0.4));
  player.money -= cut;
  wanted = 0; heat = 0; cops = []; bullets = [];
  if (op.idx >= 0) endOp(false);
  player.hp = 100; player.downT = 0; player.car = null;
  player.x = 32.5 * T; player.y = 32.5 * T;
  state = 'play';
  toast(kind === 'busted' ? ('Busted. The faceless judge fined you $' + cut) : ('Wasted. Hospital took $' + cut), 4);
}

// ---------- update ----------
function update(dt) {
  stateT += dt;
  if (state === 'intro') return;
  if (state === 'busted' || state === 'wasted') { if (stateT > 3) afterFail(state); return; }

  spawnStuff();
  updateOps(dt);
  if (player.car) updatePlayerCar(dt); else updatePlayerFoot(dt);
  for (const c of cars) if (c.type === 'traffic') updateTraffic(c, dt);
  for (const c of cops) updateCop(c, dt);
  for (const p of peds) updatePed(p, dt);
  for (const e of enemies) updateEnemy(e, dt);
  enemies = enemies.filter(e => !e.dead);
  updateBullets(dt);
  for (const g of pickups) g.t -= dt;
  pickups = pickups.filter(g => g.t > 0);
  for (const s of smoke) { s.t -= dt * 0.9; s.y -= 12 * dt; s.r += 8 * dt; }
  smoke = smoke.filter(s => s.t > 0);
  for (const p of pops) { p.t -= dt; p.y -= 26 * dt; }
  pops = pops.filter(p => p.t > 0);
  msgT -= dt; if (msgT <= 0) msg = '';
  player.hitT = Math.max(0, player.hitT - dt);

  heat = Math.max(0, heat - dt * 0.02);
  const copNear = cops.some(c => dist(c.x, c.y, player.x, player.y) < 520);
  if (wanted > 0 && !copNear) {
    evadeT += dt;
    if (evadeT > 9) { wanted--; evadeT = 0; if (wanted === 0) toast('You lost the heat.', 2.5); }
  } else evadeT = 0;

  if (AC && sirenGain) {
    sirenPhase += dt * 7;
    const on = wanted > 0 && copNear;
    sirenGain.gain.value = on ? 0.028 : 0;
    if (on) sirenOsc.frequency.value = 620 + (Math.sin(sirenPhase) > 0 ? 260 : 0);
  }

  if (player.hp <= 0) waste();
  player.hp = clamp(player.hp + dt * (op.idx >= 0 ? 1.6 : 0.8), 0, 100);

  const fx = player.x + (player.car ? Math.cos(player.a) * clamp(player.car.spd, -120, 120) * 0.9 : 0);
  const fy = player.y + (player.car ? Math.sin(player.a) * clamp(player.car.spd, -120, 120) * 0.9 : 0);
  cam.x += (fx - cam.x) * clamp(3.2 * dt, 0, 1);
  cam.y += (fy - cam.y) * clamp(3.2 * dt, 0, 1);
}

// ---------- drawing ----------
function drawPerson(p, kind) { // kind: 'ped' | 'player' | 'enemy'
  const isPlayer = kind === 'player';
  const down = (p.state === 'down') || (isPlayer && player.downT > 0);
  ctx.save();
  ctx.globalAlpha = p.fade !== undefined ? p.fade : 1;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a + (down ? 0.5 : 0));
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 3, down ? 13 : 8, down ? 8 : 6, 0, 0, TAU); ctx.fill();
  const col = isPlayer ? '#4a5138' : kind === 'enemy' ? (p.elite ? '#2c3038' : '#3a4036') : p.col;
  if (down) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(10, -2, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = SKIN_SHADE;
    ctx.beginPath(); ctx.arc(-12, 4, 2.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-11, -5, 2.6, 0, TAU); ctx.fill();
    ctx.restore(); return;
  }
  const swing = Math.sin(p.phase || 0) * 4 * (isPlayer && !player.moving ? 0 : 1);
  const gun = kind === 'enemy' || (isPlayer && armed());
  const punching = isPlayer && player.punchT > 0.22;
  ctx.fillStyle = SKIN;
  if (gun) { // two-handed rifle grip
    ctx.strokeStyle = '#23252b'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(2, 3); ctx.lineTo(16, -1); ctx.stroke();
    ctx.beginPath(); ctx.arc(6, 3, 2.7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(11, 0, 2.7, 0, TAU); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(punching ? 13 : swing, -8, 2.7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-swing, 8, 2.7, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 9, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  if (kind === 'enemy') { // tactical vest
    ctx.fillStyle = p.elite ? '#454b58' : '#2e332c';
    ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 6.5, 0, 0, TAU); ctx.fill();
  }
  // the head: smooth, blank, featureless — same for everyone
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(1.5, 0, 5.2, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.arc(3, -1.5, 2, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawCar(c) {
  ctx.save();
  ctx.translate(c.x, c.y); ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.ellipse(0, 3, 20, 11, 0, 0, TAU); ctx.fill();
  const dmg = c.hp < 45;
  rr(-19, -9.5, 38, 19, 5); ctx.fillStyle = dmg ? shade(c.c, -30) : c.c; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = '#1d2530';
  rr(5, -7, 6, 14, 2); ctx.fill();
  rr(-11, -7, 5, 14, 2); ctx.fill();
  rr(-7, -7.5, 12, 15, 3); ctx.fillStyle = shade(c.c, -18); ctx.fill();
  if (c.type === 'cop') {
    ctx.fillStyle = '#20242c'; rr(-19, -9.5, 10, 19, 4); ctx.fill();
    ctx.fillStyle = ((c.flash * 6 | 0) % 2) ? '#ff4a4a' : '#3f7dff';
    rr(-4, -6, 6, 12, 2); ctx.fill();
  }
  ctx.fillStyle = '#ffe9a3'; ctx.fillRect(17, -8, 2.5, 4); ctx.fillRect(17, 4, 2.5, 4);
  ctx.fillStyle = '#c33'; ctx.fillRect(-19.5, -8, 2, 4); ctx.fillRect(-19.5, 4, 2, 4);
  ctx.restore();
}
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function drawCover(c) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a || 0);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(2, 3, c.r, c.r * 0.8, 0, 0, TAU); ctx.fill();
  if (c.type === 'sandbag') {
    ctx.fillStyle = '#6b5f42';
    rr(-c.r, -c.r * 0.6, c.r * 2, c.r * 1.2, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.moveTo(-c.r * 0.6, -c.r * 0.6); ctx.lineTo(-c.r * 0.6, c.r * 0.6);
    ctx.moveTo(c.r * 0.2, -c.r * 0.6); ctx.lineTo(c.r * 0.2, c.r * 0.6); ctx.stroke();
  } else if (c.type === 'crate') {
    ctx.fillStyle = '#5c5346'; ctx.fillRect(-c.r, -c.r, c.r * 2, c.r * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.strokeRect(-c.r, -c.r, c.r * 2, c.r * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.moveTo(-c.r, -c.r); ctx.lineTo(c.r, c.r); ctx.moveTo(c.r, -c.r); ctx.lineTo(-c.r, c.r); ctx.stroke();
  } else if (c.type === 'rock') {
    ctx.fillStyle = '#54525100'; ctx.fillStyle = '#555251';
    ctx.beginPath();
    for (let i = 0; i < 7; i++) { const a2 = i / 7 * TAU, rr2 = c.r * (0.8 + ((i * 37) % 10) / 25); i ? ctx.lineTo(Math.cos(a2) * rr2, Math.sin(a2) * rr2) : ctx.moveTo(Math.cos(a2) * rr2, Math.sin(a2) * rr2); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.09)';
    ctx.beginPath(); ctx.arc(-c.r * 0.25, -c.r * 0.25, c.r * 0.5, 0, TAU); ctx.fill();
  } else if (c.type === 'wreck') {
    ctx.fillStyle = '#3a3532'; rr(-19, -9.5, 38, 19, 5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    ctx.fillStyle = '#2a2624'; rr(-7, -7.5, 12, 15, 3); ctx.fill();
    ctx.fillStyle = '#1c1a19'; ctx.beginPath(); ctx.arc(10, -4, 3, 0, TAU); ctx.fill();
  } else if (c.type === 'tent') {
    ctx.fillStyle = '#41472f';
    rr(-c.r, -c.r * 0.75, c.r * 2, c.r * 1.5, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-c.r, 0); ctx.lineTo(c.r, 0); ctx.stroke();
  }
  ctx.restore();
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b1e26'; ctx.fillRect(0, 0, VW, VH);
  const zoom = 1 - (player.car ? clamp(Math.abs(player.car.spd) / 2600, 0, 0.14) : 0);
  ctx.translate(VW / 2, VH / 2); ctx.scale(zoom, zoom); ctx.translate(-cam.x, -cam.y);
  const vx0 = cam.x - VW / 2 / zoom - 60, vy0 = cam.y - VH / 2 / zoom - 60;
  const vx1 = cam.x + VW / 2 / zoom + 60, vy1 = cam.y + VH / 2 / zoom + 60;
  const tx0 = clamp(Math.floor(vx0 / T), 0, GW - 1), ty0 = clamp(Math.floor(vy0 / T), 0, GH - 1);
  const tx1 = clamp(Math.ceil(vx1 / T), 0, GW), ty1 = clamp(Math.ceil(vy1 / T), 0, GH);

  for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) {
    const t = tiles[ty * GW + tx];
    if (t === DIRT) {
      const v = (tx * 7 + ty * 13) % 4;
      ctx.fillStyle = ['#4a4034', '#463d33', '#4e4437', '#453b30'][v];
    } else ctx.fillStyle = t === ROAD ? '#292d36' : t === GRASS ? '#2e4331' : t === SIDE ? '#454a55' : '#3b3f49';
    ctx.fillRect(tx * T, ty * T, T, T);
    if (t === SIDE) { ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.strokeRect(tx * T + .5, ty * T + .5, T, T); }
  }
  for (const cr of craters) if (cr.x > vx0 && cr.x < vx1 && cr.y > vy0 && cr.y < vy1) {
    ctx.fillStyle = 'rgba(20,16,12,0.55)';
    ctx.beginPath(); ctx.arc(cr.x, cr.y, cr.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
  }
  ctx.fillStyle = '#b8a94a';
  for (let j = 0; j <= 6; j++) {
    const lineY = (j * 10 + 1) * T;
    if (lineY < vy0 || lineY > vy1) continue;
    for (let x = Math.max(0, Math.floor(vx0 / 24) * 24); x < Math.min(vx1, FIELD_X0); x += 24) {
      if ((Math.floor(x / T) % 10) < 2) continue;
      ctx.fillRect(x, lineY - 1, 12, 2);
    }
  }
  for (let i = 0; i <= 6; i++) {
    const lineX = (i * 10 + 1) * T;
    if (lineX < vx0 || lineX > vx1) continue;
    for (let y = Math.floor(vy0 / 24) * 24; y < vy1; y += 24) {
      if ((Math.floor(y / T) % 10) < 2) continue;
      ctx.fillRect(lineX - 1, y, 2, 12);
    }
  }
  for (const tr of trees) if (tr.x > vx0 && tr.x < vx1 && tr.y > vy0 && tr.y < vy1) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(tr.x + 3, tr.y + 3, tr.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#26402b'; ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#31543a'; ctx.beginPath(); ctx.arc(tr.x - tr.r * 0.25, tr.y - tr.r * 0.25, tr.r * 0.62, 0, TAU); ctx.fill();
  }
  // op markers
  for (let i = 0; i < OPS.length; i++) {
    const o = OPS[i];
    if (o.mx < vx0 || o.mx > vx1 || o.my < vy0 || o.my > vy1) continue;
    const locked = i > 0 && !opDone[i - 1];
    const pulse = 1 + Math.sin(performance.now() / 300) * 0.12;
    ctx.strokeStyle = locked ? 'rgba(160,160,160,0.5)' : (opDone[i] ? 'rgba(127,217,138,0.8)' : 'rgba(255,210,63,0.9)');
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(o.mx, o.my, 26 * pulse, 0, TAU); ctx.stroke();
    ctx.fillStyle = locked ? 'rgba(160,160,160,0.25)' : (opDone[i] ? 'rgba(127,217,138,0.2)' : 'rgba(255,210,63,0.22)');
    ctx.beginPath(); ctx.arc(o.mx, o.my, 26 * pulse, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8e4d8'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(locked ? 'LOCKED' : (opDone[i] ? o.name + ' ✓' : 'OP: ' + o.name), o.mx, o.my - 34);
    if (!locked && !opDone[i]) ctx.fillText('$' + o.reward, o.mx, o.my + 4);
  }
  for (const g of pickups) if (g.x > vx0 && g.x < vx1 && g.y > vy0 && g.y < vy1) {
    ctx.fillStyle = '#2f7d43'; ctx.beginPath(); ctx.arc(g.x, g.y, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#79d98c'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#c8f0c8'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText('$', g.x, g.y + 3);
  }
  for (const p of peds) if (p.state === 'down') drawPerson(p, 'ped');
  for (const e of enemies) if (e.state === 'down') drawPerson(e, 'enemy');
  for (const c of covers) if (c.x + 30 > vx0 && c.x - 30 < vx1 && c.y + 30 > vy0 && c.y - 30 < vy1) drawCover(c);
  for (const c of cars) if (c !== player.car && c.x > vx0 - 40 && c.x < vx1 + 40 && c.y > vy0 - 40 && c.y < vy1 + 40) drawCar(c);
  for (const c of cops) drawCar(c);
  if (player.car) drawCar(player.car);
  for (const p of peds) if (p.state !== 'down' && p.x > vx0 && p.x < vx1 && p.y > vy0 && p.y < vy1) drawPerson(p, 'ped');
  for (const e of enemies) if (e.state !== 'down' && e.x > vx0 && e.x < vx1 && e.y > vy0 && e.y < vy1) drawPerson(e, 'enemy');
  if (!player.car) drawPerson(player, 'player');
  // bullets (tracers)
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const b of bullets) {
    ctx.strokeStyle = b.friendly ? 'rgba(255,232,160,0.9)' : 'rgba(255,150,130,0.9)';
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(b.a) * 12, b.y - Math.sin(b.a) * 12);
    ctx.stroke();
  }
  for (const f of flashes) {
    ctx.fillStyle = `rgba(255,220,140,${f.t / 0.06 * 0.9})`;
    ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, TAU); ctx.fill();
  }
  for (const s of smoke) {
    ctx.fillStyle = `rgba(120,120,125,${0.35 * s.t})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
  }
  for (const b of buildings) {
    if (b.x + b.w < vx0 || b.x > vx1 || b.y + b.h < vy0 || b.y > vy1) continue;
    const k = b.hgt * 0.0016;
    const ox = clamp((b.x + b.w / 2 - cam.x) * k, -26, 26);
    const oy = clamp((b.y + b.h / 2 - cam.y) * k, -26, 26);
    const wall = shade(b.c, -34), wall2 = shade(b.c, -50);
    ctx.fillStyle = wall;
    quad(b.x, b.y, b.x + b.w, b.y, b.x + b.w + ox, b.y + oy, b.x + ox, b.y + oy);
    quad(b.x, b.y + b.h, b.x + b.w, b.y + b.h, b.x + b.w + ox, b.y + b.h + oy, b.x + ox, b.y + b.h + oy);
    ctx.fillStyle = wall2;
    quad(b.x, b.y, b.x, b.y + b.h, b.x + ox, b.y + b.h + oy, b.x + ox, b.y + oy);
    quad(b.x + b.w, b.y, b.x + b.w, b.y + b.h, b.x + b.w + ox, b.y + b.h + oy, b.x + b.w + ox, b.y + oy);
    ctx.fillStyle = b.c;
    ctx.fillRect(b.x + ox, b.y + oy, b.w, b.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(b.x + ox, b.y + oy, b.w, b.h);
    ctx.fillStyle = shade(b.c, -14);
    for (let v = 0; v < b.vents; v++)
      ctx.fillRect(b.x + ox + 12 + v * 22, b.y + oy + 10, 12, 8);
    if (b.tower) {
      ctx.fillStyle = shade(b.c, 16);
      ctx.beginPath(); ctx.arc(b.x + ox + b.w - 22, b.y + oy + b.h - 22, 11, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
    }
  }
  // dusk tint
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(18,26,54,0.30)'; ctx.fillRect(0, 0, VW, VH);
  // glows
  ctx.translate(VW / 2, VH / 2); ctx.scale(zoom, zoom); ctx.translate(-cam.x, -cam.y);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lamps) if (l.x > vx0 && l.x < vx1 && l.y > vy0 && l.y < vy1) {
    ctx.drawImage(glow, l.x - 54, l.y - 54, 108, 108);
    ctx.fillStyle = '#ffd9a0'; ctx.beginPath(); ctx.arc(l.x, l.y, 2.5, 0, TAU); ctx.fill();
  }
  for (const c of allCars()) {
    if (Math.abs(c.spd) < 4 && c.type !== 'free') continue;
    if (c.x < vx0 || c.x > vx1 || c.y < vy0 || c.y > vy1) continue;
    const hx = c.x + Math.cos(c.a) * 34, hy = c.y + Math.sin(c.a) * 34;
    ctx.globalAlpha = 0.55; ctx.drawImage(glow, hx - 32, hy - 32, 64, 64); ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
  for (const p of pops) {
    ctx.globalAlpha = clamp(p.t, 0, 1);
    ctx.fillStyle = '#000'; ctx.fillText(p.txt, p.x + 1, p.y + 1);
    ctx.fillStyle = p.col; ctx.fillText(p.txt, p.x, p.y);
    ctx.globalAlpha = 1;
  }
  drawHUD();
}

function quad(x1, y1, x2, y2, x3, y3, x4, y4) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath(); ctx.fill();
}
function star(cx, cy, r, on) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr2 = i % 2 ? r * 0.45 : r;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const x = cx + Math.cos(a) * rr2, y = cy + Math.sin(a) * rr2;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = on ? '#ffd23f' : 'rgba(255,255,255,0.14)';
  ctx.fill();
}

function drawHUD() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // hit vignette
  if (player.hitT > 0 || player.hp < 30) {
    const a = clamp(player.hitT * 1.4 + (player.hp < 30 ? 0.18 : 0), 0, 0.5);
    const gr = ctx.createRadialGradient(VW / 2, VH / 2, VH * 0.35, VW / 2, VH / 2, VH * 0.75);
    gr.addColorStop(0, 'rgba(160,30,30,0)'); gr.addColorStop(1, `rgba(160,30,30,${a})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, VW, VH);
  }
  ctx.textAlign = 'right';
  ctx.font = 'bold 30px "Arial Black", Impact, sans-serif';
  ctx.fillStyle = '#0a2313'; ctx.fillText('$' + player.money, VW - 22 + 2, 46 + 2);
  ctx.fillStyle = '#7fd98a'; ctx.fillText('$' + player.money, VW - 22, 46);
  for (let i = 0; i < 5; i++) star(VW - 34 - i * 30, 74, 11, i < wanted);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(20, 20, 164, 16);
  ctx.fillStyle = player.hp > 30 ? '#5fae6b' : '#c0504d';
  ctx.fillRect(22, 22, 160 * clamp(player.hp / 100, 0, 1), 12);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(20.5, 20.5, 164, 16);
  ctx.textAlign = 'left'; ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#dfe4ec';
  ctx.fillText('HEALTH', 24, 31);
  // ammo (only when the rifle is out)
  if (armed()) {
    ctx.textAlign = 'right'; ctx.font = 'bold 22px monospace';
    ctx.fillStyle = '#0e0e10'; ctx.fillText('AMMO ' + player.mag + '/' + MAG, VW - 21, VH - 27);
    ctx.fillStyle = player.mag > 6 ? '#e8e4d8' : '#e8a04a';
    ctx.fillText('AMMO ' + player.mag + '/' + MAG, VW - 22, VH - 28);
    if (player.reloadT > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(VW - 182, VH - 22, 160, 8);
      ctx.fillStyle = '#e8a04a'; ctx.fillRect(VW - 182, VH - 22, 160 * (1 - player.reloadT / 1.3), 8);
      ctx.textAlign = 'right'; ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#e8e4d8';
      ctx.fillText('RELOADING', VW - 22, VH - 48);
    }
    // crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5;
    const mx2 = mouse.x, my2 = mouse.y, g2 = 5;
    ctx.beginPath();
    ctx.moveTo(mx2 - g2 - 6, my2); ctx.lineTo(mx2 - g2, my2);
    ctx.moveTo(mx2 + g2, my2); ctx.lineTo(mx2 + g2 + 6, my2);
    ctx.moveTo(mx2, my2 - g2 - 6); ctx.lineTo(mx2, my2 - g2);
    ctx.moveTo(mx2, my2 + g2); ctx.lineTo(mx2, my2 + g2 + 6);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(mx2, my2, 1.2, 0, TAU); ctx.fill();
  }
  // objective banner
  if (op.idx >= 0) {
    const o = OPS[op.idx];
    ctx.textAlign = 'center'; ctx.font = 'bold 15px monospace';
    const txt = o.name + ' — HOSTILES ' + op.kills + '/' + o.need;
    const w = ctx.measureText(txt).width + 28;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(VW / 2 - w / 2, 18, w, 26);
    ctx.strokeStyle = 'rgba(255,210,63,0.7)'; ctx.strokeRect(VW / 2 - w / 2, 18, w, 26);
    ctx.fillStyle = '#ffd23f'; ctx.fillText(txt, VW / 2, 36);
  }
  // minimap
  const MR = 62, mx = 24 + MR, my = VH - 24 - MR;
  ctx.save();
  ctx.beginPath(); ctx.arc(mx, my, MR, 0, TAU); ctx.clip();
  ctx.fillStyle = '#14171e'; ctx.fillRect(mx - MR, my - MR, MR * 2, MR * 2);
  const sc = 2 / T;
  ctx.translate(mx - player.x * sc * 1.6, my - player.y * sc * 1.6);
  ctx.scale(1.6, 1.6);
  ctx.drawImage(mm, 0, 0);
  ctx.restore();
  const dot = (wx, wy, col, r2) => {
    const dx = (wx - player.x) * sc * 1.6, dy = (wy - player.y) * sc * 1.6;
    if (dx * dx + dy * dy > (MR - 5) * (MR - 5)) return;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(mx + dx, my + dy, r2 || 2.4, 0, TAU); ctx.fill();
  };
  for (const c of cops) dot(c.x, c.y, '#4d8dff', 2.8);
  for (const e of enemies) if (e.state !== 'down') dot(e.x, e.y, '#ff6a5a', 2.6);
  for (const g of pickups) dot(g.x, g.y, '#79d98c', 2);
  for (let i = 0; i < OPS.length; i++) if (!(i > 0 && !opDone[i - 1])) dot(OPS[i].mx, OPS[i].my, opDone[i] ? '#79d98c' : '#ffd23f', 3);
  dot(player.x, player.y, '#f2ede2', 3.2);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(mx, my, MR, 0, TAU); ctx.stroke();
  if (msg) {
    ctx.textAlign = 'center'; ctx.font = 'bold 15px monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const w = ctx.measureText(msg).width + 24;
    ctx.fillRect(VW / 2 - w / 2, VH - 64, w, 26);
    ctx.fillStyle = '#e8e4d8'; ctx.fillText(msg, VW / 2, VH - 46);
  }
  if (state === 'busted' || state === 'wasted') {
    ctx.fillStyle = 'rgba(0,0,0,' + clamp(stateT * 0.4, 0, 0.6) + ')';
    ctx.fillRect(0, 0, VW, VH);
    ctx.textAlign = 'center';
    const s = 1 + clamp(stateT, 0, 1) * 0.4;
    ctx.font = 'bold ' + (54 * s | 0) + 'px "Arial Black", Impact, sans-serif';
    const txt = state.toUpperCase();
    ctx.fillStyle = '#000'; ctx.fillText(txt, VW / 2 + 3, VH / 2 + 3);
    ctx.fillStyle = state === 'busted' ? '#6f9fe8' : '#c0504d';
    ctx.fillText(txt, VW / 2, VH / 2);
  }
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  // world coords of the mouse (used for aiming)
  const zoom = 1 - (player.car ? clamp(Math.abs(player.car.spd) / 2600, 0, 0.14) : 0);
  mouse.wx = cam.x + (mouse.x - VW / 2) / zoom;
  mouse.wy = cam.y + (mouse.y - VH / 2) / zoom;
  update(dt);
  if (state !== 'intro') draw();
  requestAnimationFrame(frame);
}

// ---------- input ----------
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  audioInit();
  if (state === 'intro' && (e.code === 'Enter' || e.code === 'Space')) startGame();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
cvs.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cvs.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; audioInit(); });
window.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
cvs.addEventListener('contextmenu', e => e.preventDefault());

function startGame() {
  document.getElementById('intro').style.display = 'none';
  resetGame();
  state = 'play'; stateT = 0;
}
document.getElementById('playbtn').addEventListener('click', () => { audioInit(); startGame(); });

// intro portrait: the faceless one
(function portrait() {
  const c = document.getElementById('face'); if (!c) return;
  const g = c.getContext('2d');
  const W2 = c.width, H2 = c.height, cx = W2 / 2;
  g.fillStyle = '#242b3d'; g.fillRect(0, 0, W2, H2);
  g.fillStyle = '#4a5138';
  g.beginPath();
  g.moveTo(cx - 58, H2); g.quadraticCurveTo(cx - 60, H2 - 62, cx - 30, H2 - 74);
  g.quadraticCurveTo(cx, H2 - 84, cx + 30, H2 - 74);
  g.quadraticCurveTo(cx + 60, H2 - 62, cx + 58, H2); g.closePath(); g.fill();
  g.fillStyle = SKIN_SHADE; g.fillRect(cx - 10, H2 - 92, 20, 22);
  const grad = g.createRadialGradient(cx - 12, H2 - 130, 8, cx, H2 - 122, 46);
  grad.addColorStop(0, '#e6d5bc'); grad.addColorStop(0.7, SKIN); grad.addColorStop(1, '#b39d80');
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(cx, H2 - 122, 32, 40, 0, 0, TAU); g.fill();
})();

requestAnimationFrame(frame);

// debug/test hook (harmless in normal play)
window.__FC = {
  player, OPS, CAMPS,
  get state() { return state; }, get op() { return op; },
  get enemies() { return enemies; }, get cops() { return cops; },
  get cars() { return cars; }, get peds() { return peds; },
  get wanted() { return wanted; }, get bullets() { return bullets; }
};
})();
