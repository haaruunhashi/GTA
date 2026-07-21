/* FACELESS CITY — a top-down GTA-style open world where nobody has a face.
   Three zones: the city (free roam + GTA missions), the Outfield (tactical ops),
   and Sierra Negra (mountain guerrilla war: tanks, helicopters, Stingers).
   No music by design: only gameplay sound effects. */
(() => {
'use strict';

// ---------- constants ----------
const T = 40;
const CITYW = 62, FIELDW = 42, MTNW = 46;
const GW = CITYW + FIELDW + MTNW, GH = 62;
const WW = GW * T, WH = GH * T;
const FIELD_X0 = CITYW * T;          // Outfield begins
const MTN_X0 = (CITYW + FIELDW) * T; // Sierra begins
const ROAD = 0, SIDE = 1, GRASS = 2, BLDG = 3, DIRT = 4, MTN = 5, ROCK = 6, MROAD = 7;
const TAU = Math.PI * 2;
const SKIN = '#d9c6ad';
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
function angDiff(a, b) {
  let d = Math.abs((a - b) % TAU); return d > Math.PI ? TAU - d : d;
}

// ---------- map ----------
const tiles = new Uint8Array(GW * GH);
const mshade = new Float32Array(GW * GH); // mountain height 0..1
const buildings = [];
const trees = [];
const lamps = [];
const covers = [];   // solid props: sandbag|crate|rock|wreck|tent|pine|boulder
const craters = [];
function tileAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= GW || ty >= GH) return BLDG;
  return tiles[ty * GW + tx];
}
function solidAt(px, py) {
  const t = tileAt(Math.floor(px / T), Math.floor(py / T));
  return t === BLDG || t === ROCK;
}
const isRoadT = (tx, ty) => tx >= 0 && ty >= 0 && tx < CITYW && ty < GH && ((tx % 10) < 2 || (ty % 10) < 2);
const isCross = (tx, ty) => (tx % 10) < 2 && (ty % 10) < 2;
const zoneOf = (px) => px < FIELD_X0 ? 'city' : px < MTN_X0 ? 'outfield' : 'sierra';

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
    if (rnd() < 0.18) {
      for (let ty = gy * 10 + 3; ty <= gy * 10 + 8; ty++)
        for (let tx = gx * 10 + 3; tx <= gx * 10 + 8; tx++) tiles[ty * GW + tx] = GRASS;
      const n = 4 + (rnd() * 5 | 0);
      for (let i = 0; i < n; i++) trees.push({ x: x0 + 20 + rnd() * (S - 40), y: y0 + 20 + rnd() * (S - 40), r: 12 + rnd() * 9 });
      continue;
    }
    const addB = (x, y, w, h) => buildings.push({
      x: x + 6, y: y + 6, w: w - 12, h: h - 12,
      c: BPAL[(rnd() * BPAL.length) | 0], hgt: 22 + rnd() * 44,
      vents: 1 + (rnd() * 3 | 0), tower: rnd() < 0.22, ant: rnd() < 0.3
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
  // --- the Outfield ---
  for (let y = 0; y < GH; y++) for (let x = CITYW; x < CITYW + FIELDW; x++)
    tiles[y * GW + x] = rnd() < 0.12 ? GRASS : DIRT;
  for (let i = 0; i < 26; i++)
    craters.push({ x: FIELD_X0 + 120 + rnd() * (FIELDW * T - 240), y: 80 + rnd() * (WH - 160), r: 14 + rnd() * 22 });
  for (let i = 0; i < 30; i++)
    covers.push({ x: FIELD_X0 + 100 + rnd() * (FIELDW * T - 200), y: 60 + rnd() * (WH - 120), r: 9 + rnd() * 8, type: 'rock', a: rnd() * TAU });
  for (let i = 0; i < 10; i++)
    covers.push({ x: FIELD_X0 + 160 + rnd() * (FIELDW * T - 320), y: 100 + rnd() * (WH - 200), r: 20, type: 'wreck', a: rnd() * TAU });
  // --- Sierra Negra (mountains) ---
  const CGX = 14, CGY = 9, coarse = [];
  for (let i = 0; i < CGX * CGY; i++) coarse.push(rnd());
  const MTX0 = CITYW + FIELDW;
  for (let y = 0; y < GH; y++) for (let x = MTX0; x < GW; x++) {
    const u = (x - MTX0) / (MTNW - 1) * (CGX - 1), v = y / (GH - 1) * (CGY - 1);
    const iu = Math.min(CGX - 2, u | 0), iv = Math.min(CGY - 2, v | 0);
    const fu = u - iu, fv = v - iv;
    const h00 = coarse[iv * CGX + iu], h10 = coarse[iv * CGX + iu + 1];
    const h01 = coarse[(iv + 1) * CGX + iu], h11 = coarse[(iv + 1) * CGX + iu + 1];
    let h = h00 * (1 - fu) * (1 - fv) + h10 * fu * (1 - fv) + h01 * (1 - fu) * fv + h11 * fu * fv;
    h = h * 0.72 + (x - MTX0) / MTNW * 0.34;
    mshade[y * GW + x] = h;
    tiles[y * GW + x] = h > 0.72 ? ROCK : MTN;
  }
  // main trail winding east + spurs to the three sites
  const carve = (tx, ty) => {
    for (let dy = -2; dy <= 3; dy++) for (let dx = -2; dx <= 3; dx++) {
      const X = tx + dx, Y = ty + dy;
      if (X < MTX0 || X >= GW || Y < 0 || Y >= GH) continue;
      if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) tiles[Y * GW + X] = MROAD;
      else if (tiles[Y * GW + X] === ROCK) tiles[Y * GW + X] = MTN;
    }
  };
  for (let tx = MTX0; tx < GW; tx++) carve(tx, 31 + Math.round(9 * Math.sin((tx - MTX0) / 6.5)));
  const spur = (tx, fromY, toY) => {
    const s = Math.sign(toY - fromY);
    for (let y = fromY; y !== toY + s; y += s) carve(tx, y);
  };
  spur(112, 31 + Math.round(9 * Math.sin((112 - MTX0) / 6.5)), 14);
  spur(128, 31 + Math.round(9 * Math.sin((128 - MTX0) / 6.5)), 40);
  spur(140, 31 + Math.round(9 * Math.sin((140 - MTX0) / 6.5)), 24);
  // clear the three sites, then forest + boulders
  const SITES = [[112, 14], [128, 40], [140, 24]];
  for (const [sx, sy] of SITES)
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      const X = sx + dx, Y = sy + dy;
      if (X >= MTX0 && X < GW && Y >= 0 && Y < GH && tiles[Y * GW + X] === ROCK) tiles[Y * GW + X] = MTN;
    }
  let placed = 0, guard = 0;
  while (placed < 120 && guard++ < 3000) {
    const tx = MTX0 + (rnd() * MTNW | 0), ty = rnd() * GH | 0;
    if (tiles[ty * GW + tx] !== MTN) continue;
    const px = tx * T + rnd() * T, py = ty * T + rnd() * T;
    if (SITES.some(([sx, sy]) => dist(px, py, sx * T, sy * T) < 90)) continue;
    covers.push({ x: px, y: py, r: 9, type: 'pine', a: 0 });
    placed++;
  }
  for (let i = 0; i < 24; i++) {
    const tx = MTX0 + (rnd() * MTNW | 0), ty = rnd() * GH | 0;
    if (tiles[ty * GW + tx] === MTN)
      covers.push({ x: tx * T + 20, y: ty * T + 20, r: 12 + rnd() * 6, type: 'boulder', a: rnd() * TAU });
  }
  // sandbag half-rings at sites (mujahideen positions)
  for (const [sx, sy] of SITES) {
    const cx2 = sx * T, cy2 = sy * T, n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + 0.4;
      covers.push({ x: cx2 + Math.cos(a) * 130, y: cy2 + Math.sin(a) * 130, r: 13, type: 'sandbag', a: a + Math.PI / 2 });
    }
    covers.push({ x: cx2 - 40, y: cy2 + 20, r: 11, type: 'crate', a: 0.4 });
  }
})();

// ---------- outfield camps & ops ----------
function buildCamp(cx, cy) {
  const n = 8 + (rnd() * 4 | 0);
  for (let i = 0; i < n; i++) {
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

// ---------- city missions (regular GTA jobs) ----------
const CITY_M = [
  { name: 'COURIER RUN', gx: 12.5 * T, gy: 12.5 * T, dx: 42.5 * T, dy: 42.5 * T, time: 60, reward: 300,
    brief: 'Package aboard. Reach the drop, southeast side — 60 seconds.' },
  { name: 'REPO MAN', gx: 52.5 * T, gy: 12.5 * T, carX: 20.5 * T, carY: 40.5 * T, dx: 50.5 * T, dy: 32.5 * T, reward: 500,
    brief: 'A marked coupe is parked across town. Bring it to the garage. Do not wreck it.' },
  { name: 'GETAWAY DRIVER', gx: 12.5 * T, gy: 52.5 * T, dx: 52.5 * T, dy: 52.5 * T, reward: 800,
    brief: 'He is in. The law is already coming — get him to the drop.' }
];
const cmDone = [false, false, false];
let cm = { idx: -1, phase: 0, t: 0, car: null };

// ---------- Sierra guerrilla missions ----------
const GOPS = [
  { name: 'STINGER RIDGE', x: 112 * T, y: 14 * T, helis: 3, tanks: 0, inf: 0, rockets: 6, reward: 1500,
    brief: 'Gunships inbound. Lock the Stinger on them and bring all 3 down.' },
  { name: 'CONVOY AMBUSH', x: 128 * T, y: 40 * T, helis: 0, tanks: 2, inf: 4, rockets: 4, reward: 2500,
    brief: 'Armor column with foot escort. Rockets kill tanks; rifles do not.' },
  { name: 'MOUNTAIN STORM', x: 140 * T, y: 24 * T, helis: 2, tanks: 2, inf: 6, rockets: 8, reward: 4000,
    brief: 'Everything at once. Fight from the treeline like you were born here.' }
];
const gmDone = [false, false, false];
let gm = { idx: -1 };

const busy = () => op.idx >= 0 || cm.idx >= 0 || gm.idx >= 0;

// ---------- sprites ----------
const glow = document.createElement('canvas'); glow.width = glow.height = 128;
{
  const g = glow.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,190,110,0.55)'); gr.addColorStop(0.4, 'rgba(255,170,90,0.18)'); gr.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
}
const mm = document.createElement('canvas'); mm.width = GW * 2; mm.height = GH * 2;
{
  const g = mm.getContext('2d');
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const t = tiles[y * GW + x];
    g.fillStyle = t === ROAD ? '#20242c' : t === SIDE ? '#3c414c' : t === GRASS ? '#2f4632'
      : t === DIRT ? '#4a4034' : t === MTN ? '#3d443a' : t === ROCK ? '#5c5e63' : t === MROAD ? '#5d4f3a' : '#565064';
    g.fillRect(x * 2, y * 2, 2, 2);
  }
}

// ---------- audio (SFX only — no music, by design) ----------
let AC = null, sirenOsc = null, sirenGain = null, engOsc = null, engGain = null;
function audioInit() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    sirenOsc = AC.createOscillator(); sirenGain = AC.createGain();
    sirenGain.gain.value = 0; sirenOsc.frequency.value = 700;
    sirenOsc.connect(sirenGain); sirenGain.connect(AC.destination); sirenOsc.start();
    engOsc = AC.createOscillator(); engGain = AC.createGain();
    engOsc.type = 'sawtooth'; engOsc.frequency.value = 60; engGain.gain.value = 0;
    engOsc.connect(engGain); engGain.connect(AC.destination); engOsc.start();
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
    else if (kind === 'boom') { o.type = 'sawtooth'; o.frequency.setValueAtTime(48, t0); o.frequency.exponentialRampToValueAtTime(24, t0 + 0.45); g.gain.setValueAtTime(0.22, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5); o.start(t0); o.stop(t0 + 0.5); }
    else if (kind === 'lock') { o.type = 'sine'; o.frequency.setValueAtTime(1250, t0); g.gain.setValueAtTime(0.07, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12); o.start(t0); o.stop(t0 + 0.13); }
    else if (kind === 'missile') { o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t0); o.frequency.exponentialRampToValueAtTime(900, t0 + 0.3); g.gain.setValueAtTime(0.08, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35); o.start(t0); o.stop(t0 + 0.36); }
  } catch (e) { /* ignore */ }
}

// ---------- state ----------
const keys = {};
const mouse = { x: 0, y: 0, down: false, wx: 0, wy: 0 };
let state = 'intro';
let stateT = 0;
let cars = [], peds = [], cops = [], enemies = [], tanks = [], helis = [];
let bullets = [], missiles = [], shells = [], explosions = [];
let pickups = [], pops = [], smoke = [], flashes = [], skids = [], streaks = [];
let wanted = 0, heat = 0, evadeT = 0, sirenPhase = 0, shake = 0;
let cam = { x: 0, y: 0 };
let msg = '', msgT = 0, fieldToast = false, curZone = 'city';

const player = {
  x: 0, y: 0, a: 0, hp: 100, money: 0, car: null,
  phase: 0, punchT: 0, downT: 0, moving: false,
  mag: 30, reloadT: 0, fireT: 0, hitT: 0,
  nitro: 100, rockets: 0, weapon: 'rifle',
  lockTgt: null, lockT: 0, lockedSfx: false
};
const MAG = 30;

function toast(t, secs) { msg = t; msgT = secs || 2.5; }
function popup(x, y, txt, col) { pops.push({ x, y, txt, col: col || '#8fe388', t: 1.4 }); }

function resetGame() {
  cars = []; peds = []; cops = []; enemies = []; tanks = []; helis = [];
  bullets = []; missiles = []; shells = []; explosions = [];
  pickups = []; pops = []; smoke = []; flashes = []; skids = []; streaks = [];
  wanted = 0; heat = 0; evadeT = 0; shake = 0; fieldToast = false; curZone = 'city';
  op = { idx: -1, kills: 0, spawned: 0, coolT: 0 };
  cm = { idx: -1, phase: 0, t: 0, car: null };
  gm = { idx: -1 };
  player.x = 32.5 * T; player.y = 32.5 * T; player.a = 0;
  player.hp = 100; player.money = 0; player.car = null; player.downT = 0;
  player.mag = MAG; player.reloadT = 0; player.fireT = 0; player.hitT = 0;
  player.nitro = 100; player.rockets = 0; player.weapon = 'rifle';
  player.lockTgt = null; player.lockT = 0;
  cars.push(mkCar(31 * T, 32.5 * T, -Math.PI / 2, 'free', 'sports'));
  cam.x = player.x; cam.y = player.y;
  toast('Blank City. Grab the coupe (E). Jobs in town, ops east, war in the mountains.', 5);
}

// ---------- factories ----------
const CLASSES = {
  sedan:  { max: 380, acc: 260, L: 38, W: 19 },
  sports: { max: 540, acc: 400, L: 38, W: 16 },
  muscle: { max: 470, acc: 340, L: 40, W: 19 },
  taxi:   { max: 380, acc: 260, L: 38, W: 19 },
  van:    { max: 310, acc: 210, L: 46, W: 22 },
  pickup: { max: 350, acc: 250, L: 42, W: 20 },
  cop:    { max: 430, acc: 330, L: 38, W: 19 }
};
const CARPAL = ['#7d3b3b', '#3b5a7d', '#6e6a52', '#42425a', '#7a6a3f', '#513f5e', '#3f5e51', '#8a8578'];
function trafficClass() {
  const r = Math.random();
  return r < 0.28 ? 'sedan' : r < 0.43 ? 'taxi' : r < 0.57 ? 'van' : r < 0.72 ? 'pickup' : r < 0.88 ? 'muscle' : 'sports';
}
function mkCar(x, y, a, type, cls) {
  cls = cls || (type === 'cop' ? 'cop' : trafficClass());
  return { x, y, a, spd: 0, type, cls, dirx: 0, diry: 0, lane: 0,
    state: 'go', ex: 0, ey: 0, cruise: R(75, 115), hp: 100, planCd: 0, flash: 0, panicT: 0,
    c: type === 'cop' ? '#e8e8ea' : cls === 'taxi' ? '#d8b23a' : CARPAL[(Math.random() * CARPAL.length) | 0],
    dead: false, repo: false, braking: false };
}
// every inhabitant is a faceless man — but not the same man
const PTYPES = ['casual', 'hoodie', 'suit', 'worker', 'tracksuit', 'jogger'];
const PEDPAL = ['#4a4f38', '#5a4632', '#39465a', '#5e3a3a', '#46523f', '#3d3d4d', '#6b5d45', '#525a63'];
const BEANIES = ['#7d3b3b', '#3b5a7d', '#46523f', '#2c2c34'];
function mkPed(x, y) {
  const pt = PTYPES[(Math.random() * PTYPES.length) | 0];
  const p = { x, y, a: R(0, TAU), spd: R(36, 55), state: 'walk', t: R(0.5, 3),
    ptype: pt, col: PEDPAL[(Math.random() * PEDPAL.length) | 0], col2: null, hat: null,
    size: R(0.92, 1.12), wid: R(0.9, 1.25),
    phase: Math.random() * TAU, hp: 100, downT: 0, dead: false, fade: 1 };
  if (pt === 'suit') { p.col = ['#2e3138', '#33303c', '#3a3f4a'][(Math.random() * 3) | 0]; p.wid = R(0.95, 1.1); }
  if (pt === 'worker') { p.col = '#b7bd3c'; p.hat = '#e0c832'; p.wid = R(1.05, 1.3); }
  if (pt === 'hoodie') { p.col2 = p.col; }
  if (pt === 'tracksuit') { p.col = ['#31465e', '#513f5e', '#3f5e51'][(Math.random() * 3) | 0]; p.col2 = '#d8d4c8'; }
  if (pt === 'jogger') { p.col = ['#6e6a52', '#5e3a3a'][(Math.random() * 2) | 0]; p.spd = R(85, 120); p.size = R(0.9, 1.0); p.wid = R(0.85, 1.0); }
  if (!p.hat && Math.random() < 0.22) p.hat = BEANIES[(Math.random() * BEANIES.length) | 0];
  return p;
}
function mkEnemy(x, y, elite) {
  return { x, y, a: R(0, TAU), hp: elite ? 150 : 70, elite: !!elite, state: 'move',
    cx: x, cy: y, moveT: 0, cd: R(0.6, 1.6), volley: 5, los: false, losT: 0,
    phase: Math.random() * TAU, dead: false, downT: 0, fade: 1, gm: false };
}
function mkTank(x, y) {
  return { x, y, a: R(0, TAU), ta: 0, spd: 0, hp: 320, cd: R(2, 3.5), los: false, losT: 0, dead: false, boomed: false };
}
function mkHeli(x, y) {
  return { x, y, a: 0, hp: 130, cd: R(2, 3.5), burst: 0, bt: 0, orb: R(0, TAU), fall: -1, dead: false, rotor: 0 };
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
  if (nearPeds.length < 22 && peds.length < 40 && zoneOf(player.x) === 'city') {
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
  cars = cars.filter(c => !c.dead && (c === player.car || c === cm.car || c.type === 'free'
    ? dist(c.x, c.y, player.x, player.y) < 4200 : dist(c.x, c.y, player.x, player.y) < 1700));
  const free = cars.filter(c => c.type === 'free' && c !== player.car && c !== cm.car);
  if (free.length > 6) free.sort((a, b) => dist(b.x, b.y, player.x, player.y) - dist(a.x, a.y, player.x, player.y))[0].dead = true;
  if (zoneOf(player.x) !== 'city') {
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

// ---------- outfield ops ----------
function opAlive() { return enemies.filter(e => e.state !== 'down' && !e.gm).length; }
function startOp(i) {
  op.idx = i; op.kills = 0; op.spawned = 0;
  enemies = enemies.filter(e => e.gm); bullets = [];
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
    toast('OPERATION ' + o.name + ' complete. Payout: $' + o.reward, 5);
    sfx('win');
  } else toast('Operation aborted.', 3);
  op.idx = -1; op.coolT = 3;
  for (const e of enemies) if (e.state !== 'down' && !e.gm) { e.state = 'down'; e.downT = 6; }
}
function updateOps(dt) {
  op.coolT = Math.max(0, op.coolT - dt);
  if (op.idx < 0) {
    if (op.coolT > 0 || busy()) return;
    for (let i = 0; i < OPS.length; i++) {
      if (i > 0 && !opDone[i - 1]) continue;
      if (dist(player.x, player.y, OPS[i].mx, OPS[i].my) < 34) { startOp(i); break; }
    }
    return;
  }
  const o = OPS[op.idx], camp = CAMPS[o.camp];
  if (player.x < FIELD_X0 - 60 || player.x > MTN_X0 + 60) { endOp(false); return; }
  const alive = opAlive();
  if (op.spawned < o.need && alive < (op.idx === 0 ? 4 : 5)) {
    const n = Math.min(o.need - op.spawned, (op.idx === 0 ? 4 : 5) - alive);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, d = R(150, 260);
      let ex = camp.x + Math.cos(a) * d, ey = camp.y + Math.sin(a) * d;
      ex = clamp(ex, FIELD_X0 + 40, MTN_X0 - 40); ey = clamp(ey, 40, WH - 40);
      if (dist(ex, ey, player.x, player.y) < 140) continue;
      op.spawned++;
      enemies.push(mkEnemy(ex, ey, o.eliteEvery && (op.spawned % o.eliteEvery === 0)));
    }
  }
  if (op.kills >= o.need) endOp(true);
}

// ---------- city missions ----------
function startCityM(i) {
  cm.idx = i; cm.phase = 0; cm.t = CITY_M[i].time || 0; cm.car = null;
  const m = CITY_M[i];
  if (i === 1) {
    cm.car = mkCar(m.carX, m.carY, Math.PI / 2, 'free', 'sports');
    cm.car.repo = true; cm.car.c = '#c8cdd6';
    cars.push(cm.car);
  }
  if (i === 2) { wanted = 3; heat = 1; }
  toast(m.name + ': ' + m.brief, 5);
  sfx('reload');
}
function winCityM() {
  const m = CITY_M[cm.idx];
  cmDone[cm.idx] = true;
  player.money += m.reward;
  popup(player.x, player.y - 24, '+$' + m.reward, '#ffd23f');
  toast(m.name + ' done. Payout: $' + m.reward, 4);
  sfx('win');
  if (cm.car) cm.car.repo = false;
  cm = { idx: -1, phase: 0, t: 0, car: null };
}
function failCityM(why) {
  toast('Job failed — ' + why, 3.5);
  if (cm.car) cm.car.repo = false;
  cm = { idx: -1, phase: 0, t: 0, car: null };
}
function updateCityM(dt) {
  if (cm.idx < 0) {
    if (busy()) return;
    for (let i = 0; i < CITY_M.length; i++) {
      if (i > 0 && !cmDone[i - 1]) continue;
      if (dist(player.x, player.y, CITY_M[i].gx, CITY_M[i].gy) < 32) { startCityM(i); break; }
    }
    return;
  }
  const m = CITY_M[cm.idx];
  if (cm.idx === 0) {
    cm.t -= dt;
    if (cm.t <= 0) { failCityM('the package expired.'); return; }
    if (dist(player.x, player.y, m.dx, m.dy) < 36) winCityM();
  } else if (cm.idx === 1) {
    if (!cm.car || cm.car.dead) { failCityM('you lost the car.'); return; }
    if (cm.car.hp < 30) { failCityM('you wrecked the merchandise.'); return; }
    if (cm.phase === 0 && player.car === cm.car) { cm.phase = 1; toast('Got it. Garage is marked — keep it clean.', 4); }
    if (cm.phase === 1 && player.car === cm.car && dist(cm.car.x, cm.car.y, m.dx, m.dy) < 44) winCityM();
  } else {
    if (dist(player.x, player.y, m.dx, m.dy) < 38) { wanted = 0; cops = []; winCityM(); }
  }
}

// ---------- Sierra guerrilla missions ----------
function startGM(i) {
  gm.idx = i;
  const g = GOPS[i];
  player.rockets = Math.max(player.rockets, g.rockets);
  player.weapon = g.helis > 0 || g.tanks > 0 ? 'stinger' : 'rifle';
  for (let k = 0; k < g.helis; k++) {
    const a = Math.random() * TAU;
    helis.push(mkHeli(clamp(g.x + Math.cos(a) * 700, MTN_X0 + 60, WW - 60), clamp(g.y + Math.sin(a) * 700, 60, WH - 60)));
  }
  for (let k = 0; k < g.tanks; k++) {
    const a = Math.random() * TAU;
    tanks.push(mkTank(clamp(g.x + Math.cos(a) * 380, MTN_X0 + 60, WW - 60), clamp(g.y + Math.sin(a) * 380, 60, WH - 60)));
  }
  for (let k = 0; k < g.inf; k++) {
    const a = Math.random() * TAU;
    const e = mkEnemy(clamp(g.x + Math.cos(a) * R(180, 280), MTN_X0 + 40, WW - 40), clamp(g.y + Math.sin(a) * R(180, 280), 40, WH - 40));
    e.gm = true; enemies.push(e);
  }
  for (let k = 0; k < 3; k++)
    pickups.push({ x: g.x + R(-60, 60), y: g.y + R(-60, 60), amt: 2, t: 9999, rock: true });
  toast(g.name + ': ' + g.brief, 6);
  sfx('reload');
}
function clearGMUnits() {
  tanks = []; helis = [];
  enemies = enemies.filter(e => !e.gm);
  shells = []; missiles = [];
  pickups = pickups.filter(p => !p.rock);
}
function endGM(won) {
  if (gm.idx < 0) return;
  const g = GOPS[gm.idx];
  if (won) {
    gmDone[gm.idx] = true;
    player.money += g.reward;
    popup(player.x, player.y - 24, '+$' + g.reward, '#ffd23f');
    toast(g.name + ' — the mountain is quiet again. Payout: $' + g.reward, 5);
    sfx('win');
    if (gmDone.every(Boolean)) setTimeout(() => toast('The Sierra is yours. Every gunship down, every tank burning.', 6), 2600);
  } else toast('You slipped away. The guerrilla war can wait.', 3.5);
  gm.idx = -1;
  clearGMUnits();
}
function updateGM(dt) {
  if (gm.idx < 0) {
    if (busy()) return;
    for (let i = 0; i < GOPS.length; i++) {
      if (i > 0 && !gmDone[i - 1]) continue;
      if (dist(player.x, player.y, GOPS[i].x, GOPS[i].y) < 36) { startGM(i); break; }
    }
    return;
  }
  if (player.x < MTN_X0 - 80) { endGM(false); return; }
  const remaining = tanks.filter(t => !t.dead).length + helis.filter(h => !h.dead).length
    + enemies.filter(e => e.gm && e.state !== 'down').length;
  if (remaining === 0) endGM(true);
}

// ---------- combat helpers ----------
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
function explode(x, y, r, dmg) {
  explosions.push({ x, y, r, t: 0 });
  shake = Math.min(18, shake + (r > 50 ? 12 : 7));
  sfx('boom');
  for (let i = 0; i < 8; i++) smoke.push({ x: x + R(-r / 3, r / 3), y: y + R(-r / 3, r / 3), r: R(6, 14), t: R(0.8, 1.6) });
  const dP = dist(x, y, player.x, player.y);
  if (!player.car && dP < r + 12) { player.hp -= dmg * clamp(1 - dP / (r + 40), 0.25, 1); player.hitT = 0.5; }
  if (player.car && dist(x, y, player.car.x, player.car.y) < r + 20) player.car.hp -= dmg * 0.8;
  for (const e of enemies) if (e.state !== 'down' && dist(x, y, e.x, e.y) < r) killEnemy(e);
  for (const tk of tanks) if (!tk.dead && dist(x, y, tk.x, tk.y) < r + 12) tk.hp -= 90;
  for (const h of helis) if (h.fall < 0 && !h.dead && dist(x, y, h.x, h.y) < r) h.hp -= 90;
  for (const p of peds) if (p.state !== 'down' && dist(x, y, p.x, p.y) < r) { p.state = 'down'; p.downT = 20; p.hp = 0; }
  for (const c of cars) if (dist(x, y, c.x, c.y) < r + 12) c.hp -= 60;
}
function killEnemy(e) {
  if (e.state === 'down') return;
  e.state = 'down'; e.downT = 25;
  if (op.idx >= 0 && !e.gm) op.kills++;
  const amt = 30 + (Math.random() * 50 | 0);
  pickups.push({ x: e.x + R(-6, 6), y: e.y + R(-6, 6), amt, t: 40 });
  sfx('punch');
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
        if (b.ttl > 0) for (const h of helis) {
          if (h.dead || h.fall >= 0) continue;
          if (dist(h.x, h.y, b.x, b.y) < 24) { h.hp -= 4; b.ttl = 0; break; }
        }
        if (b.ttl > 0) for (const tk of tanks) {
          if (tk.dead) continue;
          if (dist(tk.x, tk.y, b.x, b.y) < 26) { b.ttl = 0; flashes.push({ x: b.x, y: b.y, t: 0.05 }); break; }
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

function updateMissiles(dt) {
  for (const m of missiles) {
    m.ttl -= dt;
    m.spd = Math.min(760, m.spd + 700 * dt);
    if (m.tgt && !m.tgt.dead && !(m.tgt.fall >= 0)) {
      const ta = Math.atan2(m.tgt.y - m.y, m.tgt.x - m.x);
      m.a = angLerp(m.a, ta, clamp(4.2 * dt, 0, 1));
    }
    m.x += Math.cos(m.a) * m.spd * dt;
    m.y += Math.sin(m.a) * m.spd * dt;
    smoke.push({ x: m.x - Math.cos(m.a) * 8, y: m.y - Math.sin(m.a) * 8, r: R(2.5, 4.5), t: 0.5 });
    let hit = false;
    for (const h of helis) if (!h.dead && h.fall < 0 && dist(h.x, h.y, m.x, m.y) < 26) { h.hp -= 160; hit = true; break; }
    if (!hit) for (const tk of tanks) if (!tk.dead && dist(tk.x, tk.y, m.x, m.y) < 28) { tk.hp -= 170; hit = true; break; }
    if (hit || m.ttl <= 0 || solidAt(m.x, m.y)) { explode(m.x, m.y, 42, 30); m.ttl = 0; }
  }
  missiles = missiles.filter(m => m.ttl > 0);
}

function updateShells(dt) {
  for (const s of shells) {
    s.ttl -= dt;
    s.x += Math.cos(s.a) * 340 * dt;
    s.y += Math.sin(s.a) * 340 * dt;
    let boom = s.ttl <= 0 || solidAt(s.x, s.y);
    if (!boom) for (const c of covers) if (dist(c.x, c.y, s.x, s.y) < c.r) { boom = true; break; }
    if (!boom && !player.car && dist(player.x, player.y, s.x, s.y) < 15) boom = true;
    if (!boom && player.car && dist(player.car.x, player.car.y, s.x, s.y) < 21) boom = true;
    if (boom) { explode(s.x, s.y, 55, 45); s.ttl = 0; }
  }
  shells = shells.filter(s => s.ttl > 0);
}

// ---------- player ----------
const armed = () => !player.car && player.x > FIELD_X0 && state === 'play';
const inSierra = () => player.x > MTN_X0;

function updateLock(dt) {
  if (!armed() || player.weapon !== 'stinger') { player.lockTgt = null; player.lockT = 0; return; }
  let best = null, bd = 0.34;
  const cand = helis.filter(h => !h.dead && h.fall < 0).concat(tanks.filter(t => !t.dead));
  for (const c of cand) {
    const d = dist(c.x, c.y, player.x, player.y);
    if (d > 950) continue;
    const da = angDiff(player.a, Math.atan2(c.y - player.y, c.x - player.x));
    if (da < bd) { bd = da; best = c; }
  }
  if (best !== player.lockTgt) { player.lockTgt = best; player.lockT = best ? 0.15 : 0; player.lockedSfx = false; }
  else if (best) {
    player.lockT = Math.min(1, player.lockT + dt / 0.9);
    if (player.lockT >= 1 && !player.lockedSfx) { sfx('lock'); player.lockedSfx = true; }
  }
}

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
  // weapon switch (Q) — Stinger only exists in the Sierra
  if (keys.KeyQ) {
    keys.KeyQ = false;
    if (inSierra()) { player.weapon = player.weapon === 'rifle' ? 'stinger' : 'rifle'; sfx('door'); }
  }
  if (!inSierra() && player.weapon === 'stinger') player.weapon = 'rifle';
  if (armed()) {
    player.a = Math.atan2(mouse.wy - player.y, mouse.wx - player.x);
    player.fireT = Math.max(0, player.fireT - dt);
    updateLock(dt);
    if (player.weapon === 'rifle') {
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
    } else { // stinger
      if (mouse.down && player.fireT <= 0 && player.rockets > 0) {
        player.fireT = 1.15; player.rockets--;
        const tgt = (player.lockT >= 1) ? player.lockTgt : null;
        missiles.push({ x: player.x + Math.cos(player.a) * 16, y: player.y + Math.sin(player.a) * 16,
          a: player.a, spd: 380, tgt, ttl: 4 });
        sfx('missile');
        shake = Math.min(18, shake + 3);
      }
    }
  }
  player.punchT = Math.max(0, player.punchT - dt);
  if (keys.Space && player.punchT === 0) {
    player.punchT = 0.4; sfx('punch');
    for (const p of peds) {
      const d = dist(p.x, p.y, player.x, player.y);
      if (d < 34 && p.state !== 'down') {
        const rel = Math.atan2(p.y - player.y, p.x - player.x);
        if (angDiff(rel, player.a) < 1.2) {
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
    if (g.rock) { player.rockets = Math.min(8, player.rockets + g.amt); popup(player.x, player.y - 14, '+' + g.amt + ' ROCKETS', '#8fd0ff'); }
    else { player.money += g.amt; popup(player.x, player.y - 14, '+$' + g.amt); }
    g.t = 0; sfx('cash');
  }
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
  const c = player.car, cls = CLASSES[c.cls] || CLASSES.sedan;
  const up = keys.ArrowUp || keys.KeyW, dn = keys.ArrowDown || keys.KeyS;
  const lf = keys.ArrowLeft || keys.KeyA, rt = keys.ArrowRight || keys.KeyD;
  const hb = keys.Space;
  const boost = (keys.ShiftLeft || keys.ShiftRight) && up && player.nitro > 0 && c.hp > 0;
  const broken = c.hp <= 0;
  c.braking = dn && c.spd > 20;
  let maxS = broken ? 60 : cls.max, acc = cls.acc;
  if (boost) { maxS += 170; acc += 380; player.nitro = Math.max(0, player.nitro - 38 * dt); }
  else player.nitro = Math.min(100, player.nitro + 9 * dt);
  if (up && !broken) c.spd += (c.spd < 0 ? 500 : acc) * dt;
  if (dn && !broken) c.spd -= (c.spd > 0 ? 460 : 200) * dt;
  c.spd = clamp(c.spd, -150, maxS);
  c.spd -= c.spd * (hb ? 2.6 : 0.55) * dt;
  if (!up && !dn) c.spd -= c.spd * 1.1 * dt;
  const steer = (rt ? 1 : 0) - (lf ? 1 : 0);
  c.a += steer * (hb ? 3.6 : 2.5) * dt * clamp(c.spd / 150, -1, 1);
  const nx = c.x + Math.cos(c.a) * c.spd * dt;
  const ny = c.y + Math.sin(c.a) * c.spd * dt;
  if (carBlocked(nx, ny, c.a)) {
    if (Math.abs(c.spd) > 100) { c.hp -= Math.abs(c.spd) / 28; sfx('crash'); shake = Math.min(14, shake + Math.abs(c.spd) / 60); }
    c.spd *= -0.35;
  } else { c.x = nx; c.y = ny; }
  c.x = clamp(c.x, 20, WW - 20); c.y = clamp(c.y, 20, WH - 20);
  // nitro & drift effects
  if (boost) {
    smoke.push({ x: c.x - Math.cos(c.a) * (cls.L / 2 + 4), y: c.y - Math.sin(c.a) * (cls.L / 2 + 4), r: R(2.5, 5), t: 0.35, flame: true });
    if (Math.random() < 0.7) streaks.push({ x: c.x + R(-VW / 3, VW / 3) * 0.5, y: c.y + R(-VH / 3, VH / 3) * 0.5, a: c.a + Math.PI, t: 0.25 });
  }
  if (hb && Math.abs(c.spd) > 120) {
    const rx = c.x - Math.cos(c.a) * (cls.L / 2 - 4), ry = c.y - Math.sin(c.a) * (cls.L / 2 - 4);
    const px2 = Math.cos(c.a + Math.PI / 2) * (cls.W / 2 - 2), py2 = Math.sin(c.a + Math.PI / 2) * (cls.W / 2 - 2);
    skids.push({ x: rx + px2, y: ry + py2, t: 8 }, { x: rx - px2, y: ry - py2, t: 8 });
    if (skids.length > 500) skids.splice(0, skids.length - 500);
  }
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
  for (const tk of tanks) {
    if (tk.dead) continue;
    const d = dist(tk.x, tk.y, c.x, c.y);
    if (d < 42) {
      const n = Math.atan2(c.y - tk.y, c.x - tk.x);
      c.x += Math.cos(n) * (42 - d); c.y += Math.sin(n) * (42 - d);
      if (Math.abs(c.spd) > 80) { c.hp -= 20; c.spd *= 0.3; sfx('crash'); }
    }
  }
  for (const p of peds) {
    if (p.state === 'down') continue;
    if (dist(p.x, p.y, c.x, c.y) < 19 && Math.abs(c.spd) > 70) koPed(p, 'car');
  }
  for (const e of enemies) {
    if (e.state !== 'down' && dist(e.x, e.y, c.x, c.y) < 19 && Math.abs(c.spd) > 70) killEnemy(e);
  }
  for (const g of pickups) if (!g.rock && dist(g.x, g.y, c.x, c.y) < 22) {
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
  c.braking = blocked && c.spd > 30;
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
    if (p.t <= 0) { p.state = 'walk'; p.t = R(1, 3); }
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

// ---------- infantry / tanks / helis ----------
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
    } else {
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
  e.cd -= dt;
  if (e.los && d < 470 && e.cd <= 0) {
    const spread = 0.06 + d * 0.00022 + (dm > 12 ? 0.09 : 0);
    fireBullet(e.x + Math.cos(e.a) * 12, e.y + Math.sin(e.a) * 12, e.a + R(-spread, spread), false, 0);
    sfx('eshot');
    e.volley--;
    e.cd = e.volley > 0 ? R(0.13, 0.22) : R(1.1, 2.2);
    if (e.volley <= 0) e.volley = e.elite ? 8 : 5;
  }
  if (!player.car && d < 26 && e.cd <= 0.5) { player.hp -= 10 * dt * 4; player.hitT = 0.3; }
}

function updateTank(tk, dt) {
  if (tk.dead) return;
  if (tk.hp <= 0) {
    if (!tk.boomed) { tk.boomed = true; explode(tk.x, tk.y, 70, 50); covers.push({ x: tk.x, y: tk.y, r: 20, type: 'wreck', a: tk.a }); }
    tk.dead = true; return;
  }
  const px = player.x, py = player.y;
  const d = dist(tk.x, tk.y, px, py);
  const angTo = Math.atan2(py - tk.y, px - tk.x);
  tk.losT -= dt;
  if (tk.losT <= 0) { tk.los = los(tk.x, tk.y, px, py); tk.losT = 0.3; }
  // hull: grind toward the player, slow and implacable
  tk.a = angLerp(tk.a, angTo, clamp(0.55 * dt, 0, 1));
  const wantSpd = d > 280 ? 55 : 0;
  tk.spd = tk.spd + clamp(wantSpd - tk.spd, -80 * dt, 40 * dt);
  const nx = tk.x + Math.cos(tk.a) * tk.spd * dt;
  const ny = tk.y + Math.sin(tk.a) * tk.spd * dt;
  let blocked = solidAt(nx + Math.cos(tk.a) * 24, ny + Math.sin(tk.a) * 24);
  if (!blocked) { tk.x = nx; tk.y = ny; } else tk.a += 0.5 * dt;
  // tanks crush cover props in their way
  for (const c of covers) {
    if (c.type === 'wreck') continue;
    if (dist(c.x, c.y, tk.x, tk.y) < c.r + 20) { const i = covers.indexOf(c); if (i >= 0) covers.splice(i, 1); break; }
  }
  // turret + main gun
  tk.ta = angLerp(tk.ta, angTo, clamp(1.2 * dt, 0, 1));
  tk.cd -= dt;
  if (tk.cd <= 0 && tk.los && d < 640 && angDiff(tk.ta, angTo) < 0.14) {
    shells.push({ x: tk.x + Math.cos(tk.ta) * 34, y: tk.y + Math.sin(tk.ta) * 34, a: tk.ta, ttl: 2.4 });
    flashes.push({ x: tk.x + Math.cos(tk.ta) * 36, y: tk.y + Math.sin(tk.ta) * 36, t: 0.09 });
    sfx('boom');
    tk.cd = R(3, 4.5);
  }
}

function updateHeli(h, dt) {
  if (h.dead) return;
  h.rotor += dt * 30;
  if (h.fall >= 0) { // shot down: spiral in
    h.fall += dt;
    h.a += 5.5 * dt;
    h.x += Math.cos(h.a) * 70 * dt;
    h.y += Math.sin(h.a) * 70 * dt + 26 * dt;
    smoke.push({ x: h.x, y: h.y, r: R(5, 10), t: 1, flame: Math.random() < 0.4 });
    if (h.fall > 1.4) { explode(h.x, h.y, 75, 55); h.dead = true; }
    return;
  }
  if (h.hp <= 0) { h.fall = 0; sfx('crash'); return; }
  const px = player.x, py = player.y;
  h.orb += 0.45 * dt;
  const txp = px + Math.cos(h.orb) * 300, typ = py + Math.sin(h.orb) * 300;
  const ma = Math.atan2(typ - h.y, txp - h.x);
  const spd = clamp(dist(h.x, h.y, txp, typ) * 1.2, 60, 240);
  h.x += Math.cos(ma) * spd * dt;
  h.y += Math.sin(ma) * spd * dt;
  h.a = angLerp(h.a, Math.atan2(py - h.y, px - h.x), clamp(2.2 * dt, 0, 1));
  h.cd -= dt;
  if (h.cd <= 0) { h.burst = 9; h.bt = 0; h.cd = R(2.6, 4.2); }
  if (h.burst > 0) {
    h.bt -= dt;
    if (h.bt <= 0) {
      h.bt = 0.075; h.burst--;
      let lx = px, ly = py;
      if (player.car) { lx += Math.cos(player.a) * player.car.spd * 0.35; ly += Math.sin(player.a) * player.car.spd * 0.35; }
      const fa = Math.atan2(ly - h.y, lx - h.x) + R(-0.12, 0.12);
      fireBullet(h.x + Math.cos(fa) * 20, h.y + Math.sin(fa) * 20, fa, false, 0);
      sfx('eshot');
    }
  }
}

// ---------- fail states ----------
function bust() { if (state === 'play') { state = 'busted'; stateT = 0; sfx('crash'); } }
function waste() { if (state === 'play') { state = 'wasted'; stateT = 0; sfx('crash'); } }
function afterFail(kind) {
  const cut = Math.floor(player.money * (kind === 'busted' ? 0.3 : 0.4));
  player.money -= cut;
  wanted = 0; heat = 0; cops = []; bullets = []; shells = []; missiles = [];
  if (op.idx >= 0) endOp(false);
  if (gm.idx >= 0) endGM(false);
  if (cm.idx >= 0) failCityM(kind === 'busted' ? 'you got busted.' : 'you got wasted.');
  player.hp = 100; player.downT = 0; player.car = null;
  player.x = 32.5 * T; player.y = 32.5 * T;
  state = 'play';
  toast(kind === 'busted' ? ('Busted. The judge fined you $' + cut) : ('Wasted. Hospital took $' + cut), 4);
}

// ---------- update ----------
function update(dt) {
  stateT += dt;
  if (state === 'intro') return;
  if (state === 'busted' || state === 'wasted') { if (stateT > 3) afterFail(state); return; }
  const z = zoneOf(player.x);
  if (z !== curZone) {
    curZone = z;
    toast(z === 'city' ? 'BLANK CITY' : z === 'outfield' ? 'THE OUTFIELD — operations territory' : 'SIERRA NEGRA — guerrilla country', 3);
  }
  spawnStuff();
  updateOps(dt);
  updateCityM(dt);
  updateGM(dt);
  if (player.car) updatePlayerCar(dt); else updatePlayerFoot(dt);
  for (const c of cars) if (c.type === 'traffic') updateTraffic(c, dt);
  for (const c of cops) updateCop(c, dt);
  for (const p of peds) updatePed(p, dt);
  for (const e of enemies) updateEnemy(e, dt);
  enemies = enemies.filter(e => !e.dead);
  for (const tk of tanks) updateTank(tk, dt);
  for (const h of helis) updateHeli(h, dt);
  updateBullets(dt);
  updateMissiles(dt);
  updateShells(dt);
  for (const ex of explosions) ex.t += dt;
  explosions = explosions.filter(ex => ex.t < 0.6);
  for (const g of pickups) if (!g.rock) g.t -= dt;
  pickups = pickups.filter(g => g.t > 0);
  for (const s of smoke) { s.t -= dt * 0.9; s.y -= 12 * dt; s.r += 8 * dt; }
  smoke = smoke.filter(s => s.t > 0);
  for (const s of skids) s.t -= dt;
  skids = skids.filter(s => s.t > 0);
  for (const s of streaks) s.t -= dt;
  streaks = streaks.filter(s => s.t > 0);
  for (const p of pops) { p.t -= dt; p.y -= 26 * dt; }
  pops = pops.filter(p => p.t > 0);
  msgT -= dt; if (msgT <= 0) msg = '';
  player.hitT = Math.max(0, player.hitT - dt);
  shake = Math.max(0, shake - shake * 3.2 * dt - 0.4 * dt);

  heat = Math.max(0, heat - dt * 0.02);
  const copNear = cops.some(c => dist(c.x, c.y, player.x, player.y) < 520);
  if (wanted > 0 && !copNear && cm.idx !== 2) {
    evadeT += dt;
    if (evadeT > 9) { wanted--; evadeT = 0; if (wanted === 0) toast('You lost the heat.', 2.5); }
  } else evadeT = 0;

  if (AC && sirenGain) {
    sirenPhase += dt * 7;
    const on = wanted > 0 && copNear;
    sirenGain.gain.value = on ? 0.028 : 0;
    if (on) sirenOsc.frequency.value = 620 + (Math.sin(sirenPhase) > 0 ? 260 : 0);
  }
  if (AC && engGain) {
    if (player.car) {
      engGain.gain.value = 0.016;
      engOsc.frequency.value = 52 + Math.abs(player.car.spd) * 0.32 + (player.nitro < 100 && (keys.ShiftLeft || keys.ShiftRight) ? 30 : 0);
    } else engGain.gain.value = 0;
  }

  if (player.hp <= 0) waste();
  player.hp = clamp(player.hp + dt * (busy() ? 1.6 : 0.8), 0, 100);

  const fx = player.x + (player.car ? Math.cos(player.a) * clamp(player.car.spd, -150, 150) * 1.1 : 0);
  const fy = player.y + (player.car ? Math.sin(player.a) * clamp(player.car.spd, -150, 150) * 1.1 : 0);
  cam.x += (fx - cam.x) * clamp(3.2 * dt, 0, 1);
  cam.y += (fy - cam.y) * clamp(3.2 * dt, 0, 1);
}

// ---------- drawing ----------
function drawPerson(p, kind) { // 'ped' | 'player' | 'enemy'
  const isPlayer = kind === 'player';
  const down = (p.state === 'down') || (isPlayer && player.downT > 0);
  ctx.save();
  ctx.globalAlpha = p.fade !== undefined ? p.fade : 1;
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a + (down ? 0.5 : 0));
  const sz = p.size || 1, wid = p.wid || 1;
  ctx.scale(sz, sz);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 3, down ? 13 : 8, down ? 8 : 6 * wid, 0, 0, TAU); ctx.fill();
  const col = isPlayer ? '#4a5138' : kind === 'enemy' ? (p.elite ? '#2c3038' : '#3a4036') : p.col;
  if (down) {
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 6 * wid, 0, 0, TAU); ctx.fill();
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
  if (gun) {
    const stinger = isPlayer && player.weapon === 'stinger';
    ctx.strokeStyle = stinger ? '#3d4436' : '#23252b';
    ctx.lineWidth = stinger ? 5 : 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(stinger ? -6 : 2, 3); ctx.lineTo(stinger ? 14 : 16, stinger ? 1 : -1); ctx.stroke();
    if (stinger) { ctx.fillStyle = '#6f7a62'; ctx.fillRect(10, -1.5, 6, 5); ctx.fillStyle = SKIN; }
    ctx.beginPath(); ctx.arc(6, 3, 2.7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(11, 0, 2.7, 0, TAU); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(punching ? 13 : swing, -8 * wid, 2.7, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(-swing, 8 * wid, 2.7, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(0, 0, 6.5, 9 * wid, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
  if (kind === 'enemy') {
    ctx.fillStyle = p.elite ? '#454b58' : '#2e332c';
    ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 6.5 * wid, 0, 0, TAU); ctx.fill();
  }
  if (kind === 'ped') {
    if (p.ptype === 'worker') { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-2, -6 * wid); ctx.lineTo(-2, 6 * wid); ctx.stroke(); }
    if (p.ptype === 'tracksuit' && p.col2) { ctx.strokeStyle = p.col2; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(0, -8.4 * wid); ctx.lineTo(0, 8.4 * wid); ctx.stroke(); }
    if (p.ptype === 'suit') { ctx.fillStyle = '#e8e4d8'; ctx.beginPath(); ctx.moveTo(4.5, -1.6); ctx.lineTo(7.5, 0); ctx.lineTo(4.5, 1.6); ctx.closePath(); ctx.fill(); }
  }
  // the head: smooth, blank, featureless — same for every man here
  ctx.fillStyle = SKIN;
  ctx.beginPath(); ctx.arc(1.5, 0, 5.2, 0, TAU); ctx.fill();
  if (kind === 'ped' && p.ptype === 'hoodie') {
    ctx.strokeStyle = p.col2 || col; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(1.5, 0, 5.8, 0, TAU); ctx.stroke();
  }
  if (kind === 'ped' && p.hat) {
    ctx.fillStyle = p.hat;
    ctx.beginPath(); ctx.arc(0.4, 0, 4.2, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.arc(3, -1.5, 2, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawCar(c) {
  const cls = CLASSES[c.cls] || CLASSES.sedan;
  const L = cls.L, W = cls.W, hl = L / 2, hw = W / 2;
  ctx.save();
  ctx.translate(c.x, c.y); ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.ellipse(0, 3, hl + 1, hw + 2, 0, 0, TAU); ctx.fill();
  const dmg = c.hp < 45;
  rr(-hl, -hw, L, W, 5); ctx.fillStyle = dmg ? shade(c.c, -30) : c.c; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.4; ctx.stroke();
  // body sheen
  const sheen = ctx.createLinearGradient(0, -hw, 0, hw);
  sheen.addColorStop(0, 'rgba(255,255,255,0.20)'); sheen.addColorStop(0.45, 'rgba(255,255,255,0.03)'); sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
  rr(-hl + 1, -hw + 1, L - 2, W - 2, 4); ctx.fillStyle = sheen; ctx.fill();
  ctx.fillStyle = '#1d2530';
  rr(hl - 14, -hw + 2.5, 6, W - 5, 2); ctx.fill();
  rr(-hl + 7, -hw + 2.5, 5, W - 5, 2); ctx.fill();
  if (c.cls === 'van') { rr(-hl + 4, -hw + 2, L * 0.62, W - 4, 3); ctx.fillStyle = shade(c.c, -18); ctx.fill(); }
  else if (c.cls === 'pickup') {
    rr(-hl + 3, -hw + 2, L * 0.38, W - 4, 2); ctx.fillStyle = shade(c.c, -26); ctx.fill();
    rr(-2, -hw + 3, L * 0.3, W - 6, 3); ctx.fillStyle = shade(c.c, -14); ctx.fill();
  } else { rr(-hl + 12, -hw + 2, L - 26, W - 4, 3); ctx.fillStyle = shade(c.c, -18); ctx.fill(); }
  if (c.cls === 'sports') {
    ctx.fillStyle = shade(c.c, -34); rr(-hl - 1, -hw + 1, 4, W - 2, 1); ctx.fill(); // spoiler
  }
  if (c.cls === 'muscle') {
    ctx.fillStyle = 'rgba(20,20,24,0.55)'; ctx.fillRect(hl - 14, -2.5, 12, 5); // hood stripe
  }
  if (c.cls === 'taxi') {
    ctx.fillStyle = '#f2ede2'; ctx.fillRect(-4, -3, 8, 6);
    ctx.fillStyle = '#1c1c22'; ctx.font = 'bold 5px monospace'; ctx.textAlign = 'center'; ctx.fillText('TAXI', 0, 2);
  }
  if (c.type === 'cop') {
    ctx.fillStyle = '#20242c'; rr(-hl, -hw, 10, W, 4); ctx.fill();
    ctx.fillStyle = ((c.flash * 6 | 0) % 2) ? '#ff4a4a' : '#3f7dff';
    rr(-4, -6, 6, 12, 2); ctx.fill();
  }
  if (c.repo) { // repo target: bobbing arrow
    ctx.save(); ctx.rotate(-c.a);
    ctx.fillStyle = '#5ad0e8';
    const bob = Math.sin(performance.now() / 200) * 3;
    ctx.beginPath(); ctx.moveTo(0, -34 + bob); ctx.lineTo(-7, -44 + bob); ctx.lineTo(7, -44 + bob); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#ffe9a3'; ctx.fillRect(hl - 2, -hw + 1.5, 2.5, 4); ctx.fillRect(hl - 2, hw - 5.5, 2.5, 4);
  ctx.fillStyle = c.braking ? '#ff2222' : '#c33';
  ctx.fillRect(-hl - 0.5, -hw + 1.5, 2, 4); ctx.fillRect(-hl - 0.5, hw - 5.5, 2, 4);
  if (c.braking) {
    ctx.fillStyle = 'rgba(255,40,40,0.35)';
    ctx.beginPath(); ctx.arc(-hl - 2, -hw + 3.5, 5, 0, TAU); ctx.arc(-hl - 2, hw - 3.5, 5, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

function drawTank(tk) {
  ctx.save();
  ctx.translate(tk.x, tk.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(2, 4, 27, 19, 0, 0, TAU); ctx.fill();
  ctx.rotate(tk.a);
  ctx.fillStyle = '#33382c'; rr(-24, -16, 48, 8, 3); ctx.fill(); rr(-24, 8, 48, 8, 3); ctx.fill(); // tracks
  ctx.fillStyle = '#4a5140'; rr(-22, -11, 44, 22, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.07)'; rr(-20, -9, 40, 8, 3); ctx.fill();
  ctx.rotate(-tk.a + tk.ta);
  ctx.fillStyle = '#3d4436';
  ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
  ctx.fillStyle = '#2c3026'; ctx.fillRect(8, -2.5, 30, 5);
  ctx.restore();
}

function drawHeli(h) {
  // ground shadow, displaced — it's flying
  ctx.save();
  ctx.translate(h.x + 26, h.y + 34);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 0, 26, 12, h.a, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(h.x, h.y);
  const tilt = h.fall >= 0 ? h.fall * 0.5 : 0;
  ctx.rotate(h.a);
  ctx.scale(1.25 - tilt * 0.3, 1.25 - tilt * 0.3);
  ctx.fillStyle = '#3c424c';
  ctx.beginPath(); ctx.ellipse(2, 0, 20, 9, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.fillStyle = '#232833'; rr(-34, -2.5, 20, 5, 2); ctx.fill(); // tail boom
  ctx.fillStyle = '#1d2530';
  ctx.beginPath(); ctx.ellipse(11, 0, 7, 5.5, 0, 0, TAU); ctx.fill(); // canopy
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath(); ctx.ellipse(12, -1.5, 4, 2.4, 0, 0, TAU); ctx.fill();
  // rotor: spinning blur disc + blades
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#cfd4dd';
  ctx.beginPath(); ctx.arc(2, 0, 30, 0, TAU); ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = '#20242c'; ctx.lineWidth = 2;
  for (let i = 0; i < 2; i++) {
    const ra = h.rotor + i * Math.PI;
    ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(2 + Math.cos(ra) * 30, Math.sin(ra) * 30); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2c313b'; ctx.beginPath(); ctx.arc(-32, 0, 4, 0, TAU); ctx.fill();
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
  const r2 = clamp((n >> 16) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r2},${g},${b})`;
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
  } else if (c.type === 'rock' || c.type === 'boulder') {
    ctx.fillStyle = c.type === 'boulder' ? '#5d6066' : '#555251';
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
  } else if (c.type === 'pine') {
    ctx.rotate(-(c.a || 0));
    ctx.fillStyle = '#1e3322';
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-11, 6); ctx.lineTo(11, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a4a30';
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(-8, -2); ctx.lineTo(8, -2); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawMarker(x, y, label, sub, color, locked) {
  const pulse = 1 + Math.sin(performance.now() / 300) * 0.12;
  ctx.strokeStyle = locked ? 'rgba(160,160,160,0.5)' : color;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, 26 * pulse, 0, TAU); ctx.stroke();
  ctx.fillStyle = locked ? 'rgba(160,160,160,0.25)' : color.replace(/[\d.]+\)$/, '0.2)');
  ctx.beginPath(); ctx.arc(x, y, 26 * pulse, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e8e4d8'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText(label, x, y - 34);
  if (sub) ctx.fillText(sub, x, y + 4);
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b1e26'; ctx.fillRect(0, 0, VW, VH);
  const zoom = 1 - (player.car ? clamp(Math.abs(player.car.spd) / 2200, 0, 0.16) : 0);
  const shx = shake > 0.1 ? R(-shake, shake) : 0, shy = shake > 0.1 ? R(-shake, shake) : 0;
  ctx.translate(VW / 2 + shx, VH / 2 + shy); ctx.scale(zoom, zoom); ctx.translate(-cam.x, -cam.y);
  const vx0 = cam.x - VW / 2 / zoom - 60, vy0 = cam.y - VH / 2 / zoom - 60;
  const vx1 = cam.x + VW / 2 / zoom + 60, vy1 = cam.y + VH / 2 / zoom + 60;
  const tx0 = clamp(Math.floor(vx0 / T), 0, GW - 1), ty0 = clamp(Math.floor(vy0 / T), 0, GH - 1);
  const tx1 = clamp(Math.ceil(vx1 / T), 0, GW), ty1 = clamp(Math.ceil(vy1 / T), 0, GH);

  for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) {
    const t = tiles[ty * GW + tx];
    if (t === DIRT) {
      const v = (tx * 7 + ty * 13) % 4;
      ctx.fillStyle = ['#4a4034', '#463d33', '#4e4437', '#453b30'][v];
    } else if (t === MTN || t === ROCK || t === MROAD) {
      const h = mshade[ty * GW + tx];
      if (t === MROAD) ctx.fillStyle = '#5d4f3a';
      else if (t === ROCK) ctx.fillStyle = h > 0.86 ? '#9aa0a8' : h > 0.79 ? '#6e7178' : '#5c5e63';
      else ctx.fillStyle = h > 0.6 ? '#4b5244' : h > 0.45 ? '#42493c' : '#3a4136';
      ctx.fillRect(tx * T, ty * T, T, T);
      if (t === ROCK) { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(tx * T, ty * T, T, 4); }
      continue;
    } else ctx.fillStyle = t === ROAD ? '#292d36' : t === GRASS ? '#2e4331' : t === SIDE ? '#454a55' : '#3b3f49';
    ctx.fillRect(tx * T, ty * T, T, T);
    if (t === SIDE) { ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.strokeRect(tx * T + .5, ty * T + .5, T, T); }
  }
  for (const cr of craters) if (cr.x > vx0 && cr.x < vx1 && cr.y > vy0 && cr.y < vy1) {
    ctx.fillStyle = 'rgba(20,16,12,0.55)';
    ctx.beginPath(); ctx.arc(cr.x, cr.y, cr.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
  }
  // road markings + crosswalks (city)
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
  ctx.fillStyle = 'rgba(230,230,235,0.22)';
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
    const cx0 = i * 10 * T, cy0 = j * 10 * T;
    if (cx0 + 2 * T < vx0 - 60 || cx0 > vx1 + 60 || cy0 + 2 * T < vy0 - 60 || cy0 > vy1 + 60) continue;
    for (let k = 0; k < 5; k++) {
      const off = 6 + k * 15;
      ctx.fillRect(cx0 - 14, cy0 + off, 10, 7); ctx.fillRect(cx0 + 2 * T + 4, cy0 + off, 10, 7);
      ctx.fillRect(cx0 + off, cy0 - 14, 7, 10); ctx.fillRect(cx0 + off, cy0 + 2 * T + 4, 7, 10);
    }
  }
  // skid marks
  ctx.fillStyle = 'rgba(15,15,18,0.5)';
  for (const s of skids) {
    ctx.globalAlpha = clamp(s.t / 8, 0, 1) * 0.6;
    ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
  for (const tr of trees) if (tr.x > vx0 && tr.x < vx1 && tr.y > vy0 && tr.y < vy1) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(tr.x + 3, tr.y + 3, tr.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#26402b'; ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#31543a'; ctx.beginPath(); ctx.arc(tr.x - tr.r * 0.25, tr.y - tr.r * 0.25, tr.r * 0.62, 0, TAU); ctx.fill();
  }
  // mission markers
  for (let i = 0; i < OPS.length; i++) {
    const o = OPS[i];
    if (o.mx < vx0 || o.mx > vx1 || o.my < vy0 || o.my > vy1) continue;
    const locked = i > 0 && !opDone[i - 1];
    drawMarker(o.mx, o.my, locked ? 'LOCKED' : (opDone[i] ? o.name + ' ✓' : 'OP: ' + o.name),
      (!locked && !opDone[i]) ? '$' + o.reward : '', opDone[i] ? 'rgba(127,217,138,0.8)' : 'rgba(255,210,63,0.9)', locked);
  }
  for (let i = 0; i < CITY_M.length; i++) {
    const m = CITY_M[i];
    const locked = i > 0 && !cmDone[i - 1];
    if (m.gx > vx0 && m.gx < vx1 && m.gy > vy0 && m.gy < vy1 && cm.idx !== i)
      drawMarker(m.gx, m.gy, locked ? 'LOCKED' : (cmDone[i] ? m.name + ' ✓' : 'JOB: ' + m.name),
        (!locked && !cmDone[i]) ? '$' + m.reward : '', cmDone[i] ? 'rgba(127,217,138,0.8)' : 'rgba(90,208,232,0.9)', locked);
    if (cm.idx === i && (cm.idx !== 1 || cm.phase === 1))
      drawMarker(m.dx, m.dy, 'DROP', '', 'rgba(90,208,232,0.95)', false);
  }
  for (let i = 0; i < GOPS.length; i++) {
    const g = GOPS[i];
    if (g.x < vx0 || g.x > vx1 || g.y < vy0 || g.y > vy1) continue;
    const locked = i > 0 && !gmDone[i - 1];
    if (gm.idx !== i)
      drawMarker(g.x, g.y, locked ? 'LOCKED' : (gmDone[i] ? g.name + ' ✓' : 'WAR: ' + g.name),
        (!locked && !gmDone[i]) ? '$' + g.reward : '', gmDone[i] ? 'rgba(127,217,138,0.8)' : 'rgba(255,120,90,0.9)', locked);
  }
  for (const g of pickups) if (g.x > vx0 && g.x < vx1 && g.y > vy0 && g.y < vy1) {
    if (g.rock) {
      ctx.fillStyle = '#33506b'; ctx.fillRect(g.x - 8, g.y - 6, 16, 12);
      ctx.strokeStyle = '#8fd0ff'; ctx.lineWidth = 1.5; ctx.strokeRect(g.x - 8, g.y - 6, 16, 12);
      ctx.fillStyle = '#c8e4f8'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.fillText('AA', g.x, g.y + 3);
    } else {
      ctx.fillStyle = '#2f7d43'; ctx.beginPath(); ctx.arc(g.x, g.y, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#79d98c'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = '#c8f0c8'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText('$', g.x, g.y + 3);
    }
  }
  for (const p of peds) if (p.state === 'down') drawPerson(p, 'ped');
  for (const e of enemies) if (e.state === 'down') drawPerson(e, 'enemy');
  for (const c of covers) if (c.x + 34 > vx0 && c.x - 34 < vx1 && c.y + 34 > vy0 && c.y - 34 < vy1) drawCover(c);
  for (const tk of tanks) if (!tk.dead) drawTank(tk);
  for (const c of cars) if (c !== player.car && c.x > vx0 - 40 && c.x < vx1 + 40 && c.y > vy0 - 40 && c.y < vy1 + 40) drawCar(c);
  for (const c of cops) drawCar(c);
  if (player.car) drawCar(player.car);
  for (const p of peds) if (p.state !== 'down' && p.x > vx0 && p.x < vx1 && p.y > vy0 && p.y < vy1) drawPerson(p, 'ped');
  for (const e of enemies) if (e.state !== 'down' && e.x > vx0 && e.x < vx1 && e.y > vy0 && e.y < vy1) drawPerson(e, 'enemy');
  if (!player.car) drawPerson(player, 'player');
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (const b of bullets) {
    ctx.strokeStyle = b.friendly ? 'rgba(255,232,160,0.9)' : 'rgba(255,150,130,0.9)';
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(b.a) * 12, b.y - Math.sin(b.a) * 12);
    ctx.stroke();
  }
  for (const m of missiles) {
    ctx.strokeStyle = 'rgba(200,220,255,0.95)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - Math.cos(m.a) * 14, m.y - Math.sin(m.a) * 14); ctx.stroke();
  }
  for (const s of shells) {
    ctx.fillStyle = '#ffcf8a'; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, TAU); ctx.fill();
  }
  for (const f of flashes) {
    ctx.fillStyle = `rgba(255,220,140,${clamp(f.t / 0.06, 0, 1) * 0.9})`;
    ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, TAU); ctx.fill();
  }
  for (const s of smoke) {
    ctx.fillStyle = s.flame ? `rgba(255,${120 + (Math.random() * 80 | 0)},40,${0.5 * s.t})` : `rgba(120,120,125,${0.35 * s.t})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
  }
  // buildings with parallax height + lit windows
  let bIdx = 0;
  for (const b of buildings) {
    bIdx++;
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
    // windows on the two most visible walls
    if (Math.abs(oy) > 5) {
      const wy = oy > 0 ? b.y + b.h : b.y;
      const n = Math.floor(b.w / 20);
      for (let w = 0; w < n; w++) {
        const wx = b.x + 10 + w * 20;
        const lit = ((bIdx * 31 + w * 17) % 10) < 3;
        ctx.fillStyle = lit ? 'rgba(255,215,150,0.85)' : 'rgba(22,26,34,0.8)';
        ctx.fillRect(wx + ox * 0.5 - 3, wy + oy * 0.5 - 4, 6, 8);
      }
    }
    if (Math.abs(ox) > 5) {
      const wx2 = ox > 0 ? b.x + b.w : b.x;
      const n2 = Math.floor(b.h / 20);
      for (let w = 0; w < n2; w++) {
        const wy2 = b.y + 10 + w * 20;
        const lit = ((bIdx * 37 + w * 13) % 10) < 3;
        ctx.fillStyle = lit ? 'rgba(255,215,150,0.85)' : 'rgba(22,26,34,0.8)';
        ctx.fillRect(wx2 + ox * 0.5 - 4, wy2 + oy * 0.5 - 3, 8, 6);
      }
    }
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
    if (b.ant) {
      ctx.strokeStyle = '#22252c'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(b.x + ox + 16, b.y + oy + b.h - 14); ctx.lineTo(b.x + ox + 16, b.y + oy + b.h - 26); ctx.stroke();
      if ((performance.now() / 700 | 0) % 2) { ctx.fillStyle = '#ff5555'; ctx.beginPath(); ctx.arc(b.x + ox + 16, b.y + oy + b.h - 26, 2, 0, TAU); ctx.fill(); }
    }
  }
  // helicopters fly above everything
  for (const h of helis) if (!h.dead) drawHeli(h);
  // explosions
  for (const ex of explosions) {
    const p2 = ex.t / 0.6;
    ctx.globalAlpha = 1 - p2;
    ctx.strokeStyle = 'rgba(255,220,160,0.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r * (0.4 + p2 * 1.2), 0, TAU); ctx.stroke();
    const fg = ctx.createRadialGradient(ex.x, ex.y, 2, ex.x, ex.y, ex.r * (0.3 + p2 * 0.7));
    fg.addColorStop(0, 'rgba(255,240,190,0.95)'); fg.addColorStop(0.5, 'rgba(255,140,50,0.8)'); fg.addColorStop(1, 'rgba(80,40,20,0)');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.r * (0.3 + p2 * 0.7), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // dusk tint (lighter over the Sierra — thin mountain air)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = curZone === 'sierra' ? 'rgba(24,30,58,0.22)' : 'rgba(18,26,54,0.30)';
  ctx.fillRect(0, 0, VW, VH);
  ctx.translate(VW / 2 + shx, VH / 2 + shy); ctx.scale(zoom, zoom); ctx.translate(-cam.x, -cam.y);
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lamps) if (l.x > vx0 && l.x < vx1 && l.y > vy0 && l.y < vy1) {
    ctx.drawImage(glow, l.x - 54, l.y - 54, 108, 108);
    ctx.fillStyle = '#ffd9a0'; ctx.beginPath(); ctx.arc(l.x, l.y, 2.5, 0, TAU); ctx.fill();
  }
  for (const c of allCars()) {
    if (Math.abs(c.spd) < 4 && c.type !== 'free') continue;
    if (c.x < vx0 || c.x > vx1 || c.y < vy0 || c.y > vy1) continue;
    // headlight cones
    ctx.fillStyle = 'rgba(255,225,160,0.10)';
    for (const s of [-1, 1]) {
      const hx0 = c.x + Math.cos(c.a) * 18 + Math.cos(c.a + Math.PI / 2) * 6 * s;
      const hy0 = c.y + Math.sin(c.a) * 18 + Math.sin(c.a + Math.PI / 2) * 6 * s;
      ctx.beginPath();
      ctx.moveTo(hx0, hy0);
      ctx.lineTo(hx0 + Math.cos(c.a - 0.22) * 95, hy0 + Math.sin(c.a - 0.22) * 95);
      ctx.lineTo(hx0 + Math.cos(c.a + 0.22) * 95, hy0 + Math.sin(c.a + 0.22) * 95);
      ctx.closePath(); ctx.fill();
    }
    const hx = c.x + Math.cos(c.a) * 34, hy = c.y + Math.sin(c.a) * 34;
    ctx.globalAlpha = 0.45; ctx.drawImage(glow, hx - 32, hy - 32, 64, 64); ctx.globalAlpha = 1;
  }
  // nitro speed streaks
  for (const s of streaks) {
    ctx.strokeStyle = `rgba(180,210,255,${clamp(s.t / 0.25, 0, 1) * 0.5})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(s.a) * 40, s.y + Math.sin(s.a) * 40); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
  for (const p of pops) {
    ctx.globalAlpha = clamp(p.t, 0, 1);
    ctx.fillStyle = '#000'; ctx.fillText(p.txt, p.x + 1, p.y + 1);
    ctx.fillStyle = p.col; ctx.fillText(p.txt, p.x, p.y);
    ctx.globalAlpha = 1;
  }
  // lock-on reticle (world space)
  if (armed() && player.weapon === 'stinger' && player.lockTgt) {
    const t2 = player.lockTgt, lk = player.lockT >= 1;
    ctx.strokeStyle = lk ? 'rgba(255,80,80,0.95)' : 'rgba(255,210,63,0.8)';
    ctx.lineWidth = 2.5;
    const rr3 = lk ? 30 : 44 - player.lockT * 14;
    ctx.save(); ctx.translate(t2.x, t2.y); ctx.rotate(lk ? 0 : performance.now() / 400);
    for (let i = 0; i < 4; i++) {
      const a2 = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a2 - 0.3) * rr3, Math.sin(a2 - 0.3) * rr3);
      ctx.lineTo(Math.cos(a2 + 0.3) * rr3, Math.sin(a2 + 0.3) * rr3);
      ctx.stroke();
    }
    ctx.restore();
    if (lk) { ctx.fillStyle = 'rgba(255,80,80,0.95)'; ctx.font = 'bold 10px monospace'; ctx.fillText('LOCKED', t2.x, t2.y - 40); }
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
  // nitro
  if (player.car) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(20, 42, 164, 12);
    ctx.fillStyle = '#4d9de8'; ctx.fillRect(22, 44, 160 * player.nitro / 100, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.strokeRect(20.5, 42.5, 164, 12);
    ctx.fillStyle = '#cfe4f8'; ctx.font = 'bold 9px monospace'; ctx.fillText('NITRO (hold SHIFT)', 24, 51);
    // speedo
    const spd = Math.abs(player.car.spd);
    ctx.textAlign = 'right'; ctx.font = 'bold 26px "Arial Black", Impact, sans-serif';
    ctx.fillStyle = '#0e0e10'; ctx.fillText((spd * 0.45 | 0) + '', VW - 21, VH - 27);
    ctx.fillStyle = spd > 400 ? '#8fd0ff' : '#e8e4d8'; ctx.fillText((spd * 0.45 | 0) + '', VW - 22, VH - 28);
    ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#9aa3b5'; ctx.fillText('MPH', VW - 22, VH - 14);
  }
  if (armed()) {
    ctx.textAlign = 'right'; ctx.font = 'bold 22px monospace';
    if (player.weapon === 'rifle') {
      ctx.fillStyle = '#0e0e10'; ctx.fillText('AMMO ' + player.mag + '/' + MAG, VW - 21, VH - 27);
      ctx.fillStyle = player.mag > 6 ? '#e8e4d8' : '#e8a04a';
      ctx.fillText('AMMO ' + player.mag + '/' + MAG, VW - 22, VH - 28);
      if (player.reloadT > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(VW - 182, VH - 22, 160, 8);
        ctx.fillStyle = '#e8a04a'; ctx.fillRect(VW - 182, VH - 22, 160 * (1 - player.reloadT / 1.3), 8);
      }
    } else {
      ctx.fillStyle = '#0e0e10'; ctx.fillText('STINGER × ' + player.rockets, VW - 21, VH - 27);
      ctx.fillStyle = player.rockets > 0 ? '#8fd0ff' : '#e8604a';
      ctx.fillText('STINGER × ' + player.rockets, VW - 22, VH - 28);
    }
    if (inSierra()) {
      ctx.font = 'bold 11px monospace'; ctx.fillStyle = '#9aa3b5';
      ctx.fillText('[Q] switch weapon', VW - 22, VH - 50);
    }
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
  let banner = '';
  if (op.idx >= 0) banner = OPS[op.idx].name + ' — HOSTILES ' + op.kills + '/' + OPS[op.idx].need;
  else if (cm.idx === 0) banner = 'COURIER RUN — ' + Math.ceil(cm.t) + 's TO DROP';
  else if (cm.idx === 1) banner = cm.phase === 0 ? 'REPO MAN — STEAL THE MARKED COUPE' : 'REPO MAN — DELIVER TO THE GARAGE';
  else if (cm.idx === 2) banner = 'GETAWAY — REACH THE DROP';
  else if (gm.idx >= 0) {
    const hLeft = helis.filter(h => !h.dead).length, tLeft = tanks.filter(t => !t.dead).length,
      iLeft = enemies.filter(e => e.gm && e.state !== 'down').length;
    banner = GOPS[gm.idx].name + ' —' + (hLeft ? ' GUNSHIPS ' + hLeft : '') + (tLeft ? ' ARMOR ' + tLeft : '') + (iLeft ? ' INFANTRY ' + iLeft : '');
    if (!hLeft && !tLeft && !iLeft) banner = GOPS[gm.idx].name;
  }
  if (banner) {
    ctx.textAlign = 'center'; ctx.font = 'bold 15px monospace';
    const w = ctx.measureText(banner).width + 28;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(VW / 2 - w / 2, 18, w, 26);
    ctx.strokeStyle = gm.idx >= 0 ? 'rgba(255,120,90,0.7)' : cm.idx >= 0 ? 'rgba(90,208,232,0.7)' : 'rgba(255,210,63,0.7)';
    ctx.strokeRect(VW / 2 - w / 2, 18, w, 26);
    ctx.fillStyle = gm.idx >= 0 ? '#ff9a80' : cm.idx >= 0 ? '#8fdcec' : '#ffd23f';
    ctx.fillText(banner, VW / 2, 36);
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
  for (const tk of tanks) if (!tk.dead) dot(tk.x, tk.y, '#a0e858', 3.4);
  for (const h of helis) if (!h.dead) dot(h.x, h.y, '#ff3a3a', 3.2);
  for (const g of pickups) dot(g.x, g.y, g.rock ? '#8fd0ff' : '#79d98c', 2);
  for (let i = 0; i < OPS.length; i++) if (!(i > 0 && !opDone[i - 1])) dot(OPS[i].mx, OPS[i].my, opDone[i] ? '#79d98c' : '#ffd23f', 3);
  for (let i = 0; i < CITY_M.length; i++) if (!(i > 0 && !cmDone[i - 1])) dot(CITY_M[i].gx, CITY_M[i].gy, cmDone[i] ? '#79d98c' : '#5ad0e8', 3);
  for (let i = 0; i < GOPS.length; i++) if (!(i > 0 && !gmDone[i - 1])) dot(GOPS[i].x, GOPS[i].y, gmDone[i] ? '#79d98c' : '#ff785a', 3);
  if (cm.idx === 0 || (cm.idx === 1 && cm.phase === 1) || cm.idx === 2) dot(CITY_M[cm.idx].dx, CITY_M[cm.idx].dy, '#ffffff', 3);
  if (cm.idx === 1 && cm.phase === 0 && cm.car) dot(cm.car.x, cm.car.y, '#5ad0e8', 3);
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
  const zoom = 1 - (player.car ? clamp(Math.abs(player.car.spd) / 2200, 0, 0.16) : 0);
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
  player, OPS, CAMPS, CITY_M, GOPS, MTN_X0, FIELD_X0,
  get state() { return state; }, get op() { return op; }, get cm() { return cm; }, get gm() { return gm; },
  get enemies() { return enemies; }, get cops() { return cops; }, get tanks() { return tanks; },
  get helis() { return helis; }, get missiles() { return missiles; }, get shells() { return shells; },
  get cars() { return cars; }, get peds() { return peds; },
  get wanted() { return wanted; }, get bullets() { return bullets; }
};
})();
