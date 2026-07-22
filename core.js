/* FACELESS CITY 3D — simulation core (no DOM, no rendering).
   Runs in the browser (window.FCCore) and in Node (module.exports) so the
   whole game logic is testable headlessly.
   World: city + Fort Kubra military base + airport + the Outfield + Sierra Negra
   mountains, underground tunnels, shops, houses, US/Soviet weapon pairs,
   missions, wanted system, persistent saves. No music, no women, no drugs. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FCCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
'use strict';
const C = {};

// ---------- math ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const d2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const R = (a, b) => a + Math.random() * (b - a);
function angLerp(a, b, t) {
  let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
  return a + d * t;
}
function angDiff(a, b) { let d = Math.abs((a - b) % TAU); return d > Math.PI ? TAU - d : d; }
let seed = 1234567;
function rnd() { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; }
C.utils = { clamp, lerp, d2, d3, angLerp, angDiff, TAU };

// ---------- world constants ----------
const W = 6000, D = 4000;               // world extent (x, z)
const CITY = { x0: 200, z0: 900, x1: 2900, z1: 3100 };
const FORT = { x0: 250, z0: 150, x1: 1150, z1: 850 };
const AIRPORT = { x0: 1250, z0: 3250, x1: 2950, z1: 3950 };
const OUTF_X0 = 3000, SIERRA_X0 = 4300;
const P = 108, RW = 18;                 // city block period / road width
C.WORLD = { W, D, CITY, FORT, AIRPORT, OUTF_X0, SIERRA_X0, P, RW };

const inCity = (x, z) => x > CITY.x0 && x < CITY.x1 && z > CITY.z0 && z < CITY.z1;
const inFort = (x, z) => x > FORT.x0 && x < FORT.x1 && z > FORT.z0 && z < FORT.z1;
const inAirport = (x, z) => x > AIRPORT.x0 && x < AIRPORT.x1 && z > AIRPORT.z0 && z < AIRPORT.z1;
const zoneOf = (x, z) => inFort(x, z) ? 'fort' : inAirport(x, z) ? 'airport'
  : x >= SIERRA_X0 ? 'sierra' : x >= OUTF_X0 ? 'outfield' : inCity(x, z) ? 'city' : 'fringe';
C.zoneOf = zoneOf;
const isCityRoad = (x, z) => inCity(x, z) && (((x - CITY.x0) % P) < RW || ((z - CITY.z0) % P) < RW);
C.isCityRoad = isCityRoad;

// ---------- tunnels ----------
const TUNNELS = [
  { z: 1989, x0: 900, x1: 1700, ramp: 70, depth: -9, w: 14, name: 'Downtown Tunnel' },
  { z: 1557, x0: 2650, x1: 3350, ramp: 70, depth: -9, w: 14, name: 'Border Tunnel' }
];
C.TUNNELS = TUNNELS;
function tunnelAt(x, z) {
  for (const t of TUNNELS) {
    if (Math.abs(z - t.z) > t.w / 2) continue;
    if (x < t.x0 - t.ramp || x > t.x1 + t.ramp) continue;
    let y = t.depth;
    if (x < t.x0) y = lerp(0, t.depth, (x - (t.x0 - t.ramp)) / t.ramp);
    else if (x > t.x1) y = lerp(t.depth, 0, (x - t.x1) / t.ramp);
    return { t, y };
  }
  return null;
}
C.inTunnel = (x, z) => { const r = tunnelAt(x, z); return !!(r && r.y < -3); };

// ---------- mountains ----------
const NG = 24, noiseG = [];
for (let i = 0; i < NG * NG; i++) noiseG.push(rnd());
function vnoise(u, v) {
  u = Math.abs(u) % (NG - 1); v = Math.abs(v) % (NG - 1);
  const iu = u | 0, iv = v | 0, fu = u - iu, fv = v - iv;
  const s = (a, b) => noiseG[(b % NG) * NG + (a % NG)];
  return lerp(lerp(s(iu, iv), s(iu + 1, iv), fu), lerp(s(iu, iv + 1), s(iu + 1, iv + 1), fu), fv);
}
const trailZ = (x) => 2000 + 900 * Math.sin((x - SIERRA_X0) / 500);
function rawMtnH(x, z) {
  const t = clamp((x - SIERRA_X0) / 500, 0, 1); // foothill blend
  const n = vnoise(x / 260, z / 260) * 0.7 + vnoise(x / 90, z / 90) * 0.3;
  return t * ((x - SIERRA_X0) / 1700 * 110 + n * 150);
}
const SITES = [{ x: 4800, z: 1000 }, { x: 5200, z: 2900 }, { x: 5650, z: 1700 }];
function mtnH(x, z) {
  let h = rawMtnH(x, z);
  const dt = Math.abs(z - trailZ(x));
  if (dt < 26) h = lerp(rawMtnH(x, trailZ(x)), h, clamp((dt - 10) / 16, 0, 1));
  for (const s of SITES) {
    const ds = d2(x, z, s.x, s.z);
    if (ds < 160) h = lerp(rawMtnH(s.x, s.z), h, clamp((ds - 90) / 70, 0, 1));
  }
  return h;
}
function groundY(x, z) {
  const tn = tunnelAt(x, z);
  if (tn) return tn.y;
  if (x >= SIERRA_X0 - 200) return mtnH(x, z);
  return 0;
}
C.groundY = groundY;

// ---------- static world: buildings, props, shops, stashes ----------
const buildings = [];   // {x0,z0,x1,z1,h,kind}  solid AABBs
const props = [];       // {x,z,y,r,h,type} cylinders: cover & solid
const lamps = [];
const stashes = [];     // hidden money crates
const parks = [];
function addB(x0, z0, x1, z1, h, kind) { buildings.push({ x0, z0, x1, z1, h, kind: kind || 'block' }); }

(function buildWorld() {
  // city blocks
  const bx = Math.floor((CITY.x1 - CITY.x0) / P), bz = Math.floor((CITY.z1 - CITY.z0) / P);
  for (let i = 0; i < bx; i++) for (let j = 0; j < bz; j++) {
    const x0 = CITY.x0 + i * P + RW, z0 = CITY.z0 + j * P + RW;
    const x1 = x0 + (P - RW), z1 = z0 + (P - RW);
    if (x1 > CITY.x1 || z1 > CITY.z1) continue;
    // keep tunnels clear of foundations
    if (TUNNELS.some(t => z0 - 10 < t.z && z1 + 10 > t.z && x1 > t.x0 - t.ramp && x0 < t.x1 + t.ramp)) continue;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (rnd() < 0.12) { parks.push({ x0, z0, x1, z1 }); continue; }
    const downtown = d2(cx, cz, 1550, 2000) < 620;
    const split = rnd();
    const hgt = () => downtown ? 40 + rnd() * 95 : 10 + rnd() * 22;
    const m = 6;
    if (split < 0.45) addB(x0 + m, z0 + m, x1 - m, z1 - m, hgt(), downtown ? 'tower' : 'block');
    else if (split < 0.75) {
      addB(x0 + m, z0 + m, cx - 3, z1 - m, hgt(), downtown ? 'tower' : 'block');
      addB(cx + 3, z0 + m, x1 - m, z1 - m, hgt(), downtown ? 'tower' : 'block');
    } else {
      addB(x0 + m, z0 + m, x1 - m, cz - 3, hgt(), downtown ? 'tower' : 'block');
      addB(x0 + m, cz + 3, x1 - m, z1 - m, hgt(), 'block');
    }
  }
  // lamps at city intersections
  for (let x = CITY.x0 + RW / 2; x < CITY.x1; x += P)
    for (let z = CITY.z0 + RW / 2; z < CITY.z1; z += P)
      lamps.push({ x, z });
  // Fort Kubra: walls (with south gate), hangars, towers
  const wT = 3, wH = 6, gate = { x0: 650, x1: 750 };
  addB(FORT.x0, FORT.z0, FORT.x1, FORT.z0 + wT, wH, 'wall');
  addB(FORT.x0, FORT.z1 - wT, gate.x0, FORT.z1, wH, 'wall');
  addB(gate.x1, FORT.z1 - wT, FORT.x1, FORT.z1, wH, 'wall');
  addB(FORT.x0, FORT.z0, FORT.x0 + wT, FORT.z1, wH, 'wall');
  addB(FORT.x1 - wT, FORT.z0, FORT.x1, FORT.z1, wH, 'wall');
  addB(400, 300, 560, 420, 12, 'hangar'); addB(700, 300, 860, 420, 12, 'hangar');
  addB(950, 500, 1050, 600, 24, 'tower');
  // airport: terminal + hangars (runway is flat decor)
  addB(1350, 3750, 1750, 3860, 15, 'terminal');
  addB(2500, 3300, 2650, 3420, 14, 'hangar'); addB(2700, 3300, 2850, 3420, 14, 'hangar');
  // outfield camps
  for (const c of [{ x: 3350, z: 1100 }, { x: 3800, z: 2800 }, { x: 3550, z: 2000 }]) {
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + rnd() * 0.4, d = 55 + rnd() * 40;
      props.push({ x: c.x + Math.cos(a) * d, z: c.z + Math.sin(a) * d, y: 0, r: 3, h: 1.2, type: 'sandbag' });
    }
    props.push({ x: c.x, z: c.z - 18, y: 0, r: 6, h: 3.5, type: 'tent' });
    props.push({ x: c.x + 22, z: c.z + 10, y: 0, r: 2.4, h: 2, type: 'crate' });
  }
  for (let i = 0; i < 40; i++)
    props.push({ x: R(OUTF_X0, SIERRA_X0), z: R(100, D - 100), y: 0, r: R(2, 4), h: R(1.5, 3), type: 'rock' });
  // sierra pines, boulders, site sandbags
  for (let i = 0; i < 260; i++) {
    const x = R(SIERRA_X0, W - 80), z = R(80, D - 80);
    if (SITES.some(s => d2(x, z, s.x, s.z) < 100)) continue;
    props.push({ x, z, y: mtnH(x, z), r: 2.2, h: 11, type: 'pine' });
  }
  for (let i = 0; i < 40; i++) {
    const x = R(SIERRA_X0, W - 80), z = R(80, D - 80);
    props.push({ x, z, y: mtnH(x, z), r: R(2.5, 5), h: R(2, 4), type: 'boulder' });
  }
  for (const s of SITES) {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + 0.3;
      props.push({ x: s.x + Math.cos(a) * 45, z: s.z + Math.sin(a) * 45, y: mtnH(s.x, s.z), r: 3, h: 1.2, type: 'sandbag' });
    }
    props.push({ x: s.x - 15, z: s.z + 8, y: mtnH(s.x, s.z), r: 2.4, h: 2, type: 'crate' });
  }
  // city street trees along park edges
  for (const p of parks) for (let i = 0; i < 8; i++)
    props.push({ x: R(p.x0 + 8, p.x1 - 8), z: R(p.z0 + 8, p.z1 - 8), y: 0, r: 1.5, h: 9, type: 'tree' });
  // hidden stashes
  for (let i = 0; i < 30; i++) {
    let x, z, tries = 0;
    do { x = R(250, W - 150); z = R(150, D - 150); } while (solidAt(x, groundY(x, z) + 1, z) && tries++ < 20);
    stashes.push({ x, z, amt: 200 + (rnd() * 600 | 0), found: false });
  }
})();
C.buildings = buildings; C.props = props; C.lamps = lamps; C.parks = parks; C.stashes = stashes; C.SITES = SITES;

function solidAt(x, y, z) { // static solids only
  for (const b of buildings)
    if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && y < b.h) return true;
  return false;
}
C.solidAt = solidAt;
function propBlock(x, y, z, pad) {
  for (const p of props) {
    if (p.type === 'tree' || p.type === 'pine') { // trunks only block a thin core
      if (d2(x, z, p.x, p.z) < 0.8 + (pad || 0) && y < p.y + p.h) return p;
      continue;
    }
    if (d2(x, z, p.x, p.z) < p.r + (pad || 0) && y < p.y + p.h) return p;
  }
  return null;
}

// ---------- shops / houses / dealers ----------
const SHOPS = [
  { id: 'armory', name: 'LIBERTY ARMS (US weapons)', x: 1231, z: 1450, type: 'guns', nation: 'US' },
  { id: 'blackmarket', name: 'SIERRA BLACK MARKET (Soviet weapons)', x: 4800, z: 950, type: 'guns', nation: 'SOV' },
  { id: 'market', name: 'MONO MART SUPERMARKET', x: 1663, z: 2314, type: 'market' },
  { id: 'clothes', name: 'THREADS & CO CLOTHING', x: 2095, z: 1666, type: 'clothes' },
  { id: 'dealer', name: 'PRESTIGE MOTORS', x: 2419, z: 2530, type: 'cars' },
  { id: 'airdealer', name: 'SKYLINE AVIATION', x: 1900, z: 3700, type: 'aircraft' }
];
const HOUSES = [
  { id: 'apt', name: 'Eastside Apartment', x: 907, z: 2746, price: 8000, rent: 150 },
  { id: 'pent', name: 'Downtown Penthouse', x: 1555, z: 1990, price: 50000, rent: 900 },
  { id: 'cabin', name: 'Sierra Cabin', x: 4820, z: 1060, price: 15000, rent: 300 }
];
C.SHOPS = SHOPS; C.HOUSES = HOUSES;
const OUTFITS = [
  { id: 'olive', name: 'Olive Sweater', body: 0x4a5138, legs: 0x2c2c31, price: 0 },
  { id: 'suit', name: 'Charcoal Suit', body: 0x2e3138, legs: 0x26282e, price: 800 },
  { id: 'track', name: 'Navy Tracksuit', body: 0x31465e, legs: 0x31465e, price: 400 },
  { id: 'combat', name: 'Combat Fatigues', body: 0x3a4036, legs: 0x33382c, price: 1200 },
  { id: 'winter', name: 'Sierra Parka', body: 0x6b5d45, legs: 0x3d3d4d, price: 900 },
  { id: 'tailor', name: "The Tailor's Cut", body: 0x23252e, legs: 0x191b22, price: 0, story: true }
];
C.OUTFITS = OUTFITS;

// ---------- weapons: every US gun has its Soviet counterpart ----------
const WEAPONS = {
  fists:   { name: 'Fists', cls: 'melee', dmg: 20, rof: 2.5, range: 2.2 },
  m1911:   { name: 'M1911', nation: 'US', pair: 'makarov', cls: 'pistol', dmg: 26, rof: 3.5, mag: 8, spread: 0.02, price: 400, auto: false, tier: 0 },
  makarov: { name: 'Makarov PM', nation: 'SOV', pair: 'm1911', cls: 'pistol', dmg: 24, rof: 4.2, mag: 8, spread: 0.024, price: 350, auto: false, tier: 0 },
  spas:    { name: 'SPAS-12', nation: 'US', pair: 'saiga', cls: 'shotgun', dmg: 13, pellets: 8, rof: 1.1, mag: 7, spread: 0.09, price: 1600, auto: false, tier: 1 },
  saiga:   { name: 'Saiga-12', nation: 'SOV', pair: 'spas', cls: 'shotgun', dmg: 12, pellets: 8, rof: 1.9, mag: 8, spread: 0.11, price: 1900, auto: false, tier: 1 },
  m4:      { name: 'M4A1', nation: 'US', pair: 'ak47', cls: 'rifle', dmg: 30, rof: 11, mag: 30, spread: 0.014, price: 3200, auto: true, tier: 1 },
  ak47:    { name: 'AK-47', nation: 'SOV', pair: 'm4', cls: 'rifle', dmg: 38, rof: 9, mag: 30, spread: 0.03, price: 2800, auto: true, tier: 1 },
  m24:     { name: 'M24 SWS', nation: 'US', pair: 'svd', cls: 'sniper', dmg: 95, rof: 0.8, mag: 5, spread: 0.001, price: 5200, auto: false, tier: 2 },
  svd:     { name: 'Dragunov SVD', nation: 'SOV', pair: 'm24', cls: 'sniper', dmg: 80, rof: 1.6, mag: 10, spread: 0.004, price: 5600, auto: false, tier: 2 },
  m60:     { name: 'M60', nation: 'US', pair: 'pkm', cls: 'mg', dmg: 32, rof: 9, mag: 100, spread: 0.045, price: 7500, auto: true, tier: 2 },
  pkm:     { name: 'PKM', nation: 'SOV', pair: 'm60', cls: 'mg', dmg: 34, rof: 10, mag: 100, spread: 0.05, price: 7200, auto: true, tier: 2 },
  law:     { name: 'M72 LAW', nation: 'US', pair: 'rpg7', cls: 'rocket', dmg: 300, splash: 12, rof: 0.5, mag: 1, price: 6000, tier: 2 },
  rpg7:    { name: 'RPG-7', nation: 'SOV', pair: 'law', cls: 'rocket', dmg: 350, splash: 14, rof: 0.45, mag: 1, price: 5200, tier: 2 },
  stinger: { name: 'FIM-92 Stinger', nation: 'US', pair: 'strela', cls: 'aa', dmg: 400, splash: 10, rof: 0.4, mag: 1, price: 14000, tier: 3 },
  strela:  { name: '9K32 Strela-2', nation: 'SOV', pair: 'stinger', cls: 'aa', dmg: 360, splash: 10, rof: 0.5, mag: 1, price: 12000, tier: 3 }
};
const AMMO_PRICE = { pistol: 30, shotgun: 60, rifle: 90, sniper: 120, mg: 200, rocket: 900, aa: 1800 };
const AMMO_PACK = { pistol: 32, shotgun: 24, rifle: 60, sniper: 15, mg: 100, rocket: 1, aa: 1 };
C.WEAPONS = WEAPONS; C.AMMO_PRICE = AMMO_PRICE; C.AMMO_PACK = AMMO_PACK;
const repTier = (rep) => rep >= 18 ? 3 : rep >= 10 ? 2 : rep >= 4 ? 1 : 0;
C.repTier = repTier;

// ---------- vehicles catalog ----------
const VEH = {
  sedan:  { kind: 'car', top: 38, acc: 9,  hp: 100, price: 4000, name: 'Sedan' },
  taxi:   { kind: 'car', top: 38, acc: 9,  hp: 100, price: 4500, name: 'Taxi' },
  van:    { kind: 'car', top: 31, acc: 7,  hp: 130, price: 5500, name: 'Van' },
  pickup: { kind: 'car', top: 35, acc: 8,  hp: 120, price: 5000, name: 'Pickup' },
  muscle: { kind: 'car', top: 47, acc: 12, hp: 110, price: 9000, name: 'Muscle' },
  sports: { kind: 'car', top: 56, acc: 15, hp: 90,  price: 14000, name: 'Sports Coupe' },
  super:  { kind: 'car', top: 70, acc: 21, hp: 95,  price: 30000, name: 'Supercar' },
  cop:    { kind: 'car', top: 48, acc: 13, hp: 120, name: 'Cruiser' },
  apc:    { kind: 'car', top: 26, acc: 6,  hp: 400, name: 'APC' },
  heli:   { kind: 'heli', top: 60, acc: 18, hp: 220, price: 32000, name: 'Sparrow Heli' },
  hind:   { kind: 'heli', top: 55, acc: 15, hp: 500, name: 'Gunship' },
  plane:  { kind: 'plane', top: 95, acc: 12, hp: 160, price: 48000, name: 'Duster Plane' },
  jet:    { kind: 'plane', top: 135, acc: 24, hp: 220, price: 95000, name: 'Fighter Jet' },
  tank:   { kind: 'tank', top: 13, acc: 4,  hp: 1200, name: 'T-80 Tank' }
};
C.VEH = VEH;

// ---------- game state ----------
const S = {
  state: 'play', stateT: 0,
  player: null, cars: [], peds: [], cops: [], footCops: [], soldiers: [],
  enemies: [], tanks: [], helis: [], bullets: [], rockets: [], shellsList: [], bombs: [],
  pickups: [], wanted: 0, evadeT: 0, time: 0, rentT: 0,
  mission: null,           // active mission object
  done: {},                // mission id -> true
  events: []               // renderer/sfx queue
};
C.S = S;
const ev = (t, o) => S.events.push(Object.assign({ t }, o));
const toast = (msg, secs) => ev('toast', { msg, secs: secs || 3 });

function mkPlayer() {
  // preloaded arsenal: every weapon in the inventory, magazines full, healthy reserves
  const weapons = { fists: { ammo: Infinity, mag: 0 } };
  for (const id in WEAPONS) { if (id === 'fists') continue; weapons[id] = { mag: WEAPONS[id].mag || 1 }; }
  const ammo = { pistol: 96, shotgun: 48, rifle: 240, sniper: 30, mg: 500, rocket: 8, aa: 6 };
  return {
    kind: 'player', x: 1505, y: 0, z: 2056, vy: 0, yaw: 0, pitch: 0,
    hp: 100, armor: 0, money: 500, rep: 0,
    weapons, cur: 'm4',
    ammo,
    mag: 0, reloadT: 0, fireT: 0, punchT: 0, hitT: 0, downT: 0,
    veh: null, nitro: 100, outfit: 'olive',
    owned: { houses: [], vehicles: ['heli', 'jet'] }, lockTgt: null, lockT: 0,
    onGround: true, moving: false, phase: 0
  };
}
const PTYPES = ['casual', 'hoodie', 'suit', 'worker', 'tracksuit', 'jogger'];
function mkPed(x, z) {
  const pt = PTYPES[(Math.random() * PTYPES.length) | 0];
  return { kind: 'ped', ptype: pt, x, z, y: groundY(x, z), yaw: R(0, TAU),
    spd: pt === 'jogger' ? R(3.4, 4.6) : R(1.1, 1.8), state: 'walk', t: R(1, 4),
    size: R(0.92, 1.1), hp: 60, phase: Math.random() * TAU, dead: false, downT: 0 };
}
function mkCar(x, z, yaw, type, cls) {
  cls = cls || (type === 'cop' ? 'cop' : ['sedan', 'taxi', 'van', 'pickup', 'muscle', 'sports'][(Math.random() * 6) | 0]);
  const v = VEH[cls];
  return { kind: 'car', cls, type, x, z, y: groundY(x, z), yaw, spd: 0, hp: v.hp,
    dirx: 0, dirz: 0, lane: 0, stateT: 0, aiState: 'go', ex: 0, ez: 0, planCd: 0,
    cruise: R(9, 15), flash: 0, dead: false, colorSeed: Math.random(), braking: false, owned: false };
}
function mkHeli(x, z, cls, hostile) {
  const v = VEH[cls || 'heli'];
  return { kind: 'heli', cls: cls || 'heli', x, z, y: groundY(x, z) + (hostile ? 55 : 0),
    yaw: 0, spd: 0, vy: 0, hp: v.hp, rotor: 0, hostile: !!hostile,
    cd: R(2, 4), burst: 0, bt: 0, orb: R(0, TAU), fall: -1, dead: false, owned: false };
}
function mkTank(x, z, hostile) {
  return { kind: 'tank', cls: 'tank', x, z, y: groundY(x, z), yaw: R(0, TAU), ta: 0,
    spd: 0, hp: VEH.tank.hp, cd: R(2.5, 4), losT: 0, los: false, hostile: !!hostile,
    dead: false, boomed: false, owned: false };
}
function mkSoldier(x, z, elite) {
  return { kind: 'soldier', x, z, y: groundY(x, z), yaw: R(0, TAU), hp: elite ? 160 : 80,
    elite: !!elite, cx: x, cz: z, moveT: 0, cd: R(0.5, 1.5), volley: 5, los: false, losT: 0,
    phase: Math.random() * TAU, state: 'move', downT: 0, dead: false, gmTag: null };
}
C.factories = { mkPed, mkCar, mkHeli, mkTank, mkSoldier };

function reset(keepProgress) {
  const prev = S.player;
  S.player = mkPlayer();
  if (keepProgress && prev) {
    for (const k of ['money', 'rep', 'weapons', 'ammo', 'outfit', 'owned', 'cur'])
      S.player[k] = prev[k];
  }
  S.cars = []; S.peds = []; S.cops = []; S.footCops = []; S.soldiers = [];
  S.enemies = []; S.tanks = []; S.helis = []; S.bullets = []; S.rockets = []; S.shellsList = []; S.bombs = [];
  S.pickups = []; S.wanted = 0; S.evadeT = 0; S.mission = null; S.state = 'play';
  // starter supercar + owned garage vehicles at spawn
  S.cars.push(mkCar(1505, 2036, Math.PI / 2, 'free', 'super'));
  let off = 0;
  for (const vc of S.player.owned.vehicles) {
    if (VEH[vc].kind === 'car') { const c = mkCar(1505, 2020 - off * 8, Math.PI / 2, 'free', vc); c.owned = true; S.cars.push(c); }
    else if (VEH[vc].kind === 'heli') { const h = mkHeli(1470, 2016 - off * 20, vc); h.owned = true; S.helis.push(h); }
    else if (VEH[vc].kind === 'plane') { const h = mkHeli(2100 + off * 30, 3600, vc); h.owned = true; h.kind = 'plane'; S.helis.push(h); }
    else if (VEH[vc].kind === 'tank') { const t = mkTank(4850, 1100); t.owned = true; S.tanks.push(t); }
    off++;
  }
  toast('Blank City. Jobs in town, war out east. Everything you earn is saved.', 5);
}
C.reset = reset;

// ---------- save / load ----------
C.serialize = function () {
  const p = S.player;
  const w = {};
  for (const k in p.weapons) if (k !== 'fists') w[k] = { ammo: p.weapons[k].ammo, mag: p.weapons[k].mag };
  return JSON.stringify({
    money: p.money, rep: p.rep, outfit: p.outfit, cur: p.cur === 'fists' ? 'fists' : p.cur,
    weapons: w, ammo: p.ammo, owned: p.owned, done: S.done,
    stashes: stashes.map(s => s.found)
  });
};
C.deserialize = function (str) {
  try {
    const d = JSON.parse(str);
    const p = S.player;
    p.money = d.money || 0; p.rep = d.rep || 0; p.outfit = d.outfit || 'olive';
    p.ammo = Object.assign(p.ammo, d.ammo || {});
    p.owned = d.owned || { houses: [], vehicles: [] };
    for (const k in (d.weapons || {})) p.weapons[k] = d.weapons[k];
    if (d.cur && p.weapons[d.cur]) p.cur = d.cur;
    S.done = d.done || {};
    (d.stashes || []).forEach((f, i) => { if (stashes[i]) stashes[i].found = f; });
    return true;
  } catch (e) { return false; }
};

// ---------- economy ----------
C.buyWeapon = function (id) {
  const w = WEAPONS[id], p = S.player;
  if (!w || !w.price) return 'no such weapon';
  if (repTier(p.rep) < w.tier) return 'locked — earn more reputation';
  if (p.weapons[id]) return 'already owned';
  if (p.money < w.price) return 'not enough cash';
  p.money -= w.price;
  p.weapons[id] = { mag: w.mag || 1 };
  p.ammo[w.cls] = (p.ammo[w.cls] || 0) + (AMMO_PACK[w.cls] || 0) * 2;
  p.cur = id; p.mag = w.mag || 1;
  ev('sfx', { k: 'cash' });
  return null;
};
C.buyAmmo = function (cls) {
  const p = S.player;
  if (!AMMO_PRICE[cls]) return 'bad ammo class';
  if (p.money < AMMO_PRICE[cls]) return 'not enough cash';
  p.money -= AMMO_PRICE[cls]; p.ammo[cls] += AMMO_PACK[cls];
  ev('sfx', { k: 'cash' });
  return null;
};
C.buySnack = function () {
  const p = S.player;
  if (p.money < 15) return 'not enough cash';
  p.money -= 15; p.hp = clamp(p.hp + 35, 0, 100); ev('sfx', { k: 'cash' });
  return null;
};
C.buyArmor = function () {
  const p = S.player;
  if (p.money < 400) return 'not enough cash';
  p.money -= 400; p.armor = 100; ev('sfx', { k: 'cash' });
  return null;
};
C.buyOutfit = function (id) {
  const o = OUTFITS.find(o2 => o2.id === id), p = S.player;
  if (!o) return 'no such outfit';
  if (o.story && !S.done.m8) return 'finish the Tailor\'s story first';
  if (p.money < o.price) return 'not enough cash';
  p.money -= o.price; p.outfit = id; ev('sfx', { k: 'cash' });
  return null;
};
C.buyVehicle = function (cls) {
  const v = VEH[cls], p = S.player;
  if (!v || !v.price) return 'not for sale';
  if (p.money < v.price) return 'not enough cash';
  if (p.owned.vehicles.includes(cls)) return 'already owned';
  p.money -= v.price; p.owned.vehicles.push(cls);
  // deliver it next to the buyer
  if (v.kind === 'car') { const c = mkCar(p.x + 8, p.z + 8, 0, 'free', cls); c.owned = true; S.cars.push(c); }
  else if (v.kind === 'heli') { const h = mkHeli(p.x + 15, p.z + 15); h.owned = true; S.helis.push(h); }
  else if (v.kind === 'plane') { const h = mkHeli(1900, 3600, 'plane'); h.owned = true; h.kind = 'plane'; S.helis.push(h); toast('Your plane is waiting on the runway.', 4); }
  ev('sfx', { k: 'cash' });
  return null;
};
C.buyHouse = function (id) {
  const h = HOUSES.find(h2 => h2.id === id), p = S.player;
  if (!h) return 'no such property';
  if (p.owned.houses.includes(id)) return 'already owned';
  if (p.money < h.price) return 'not enough cash';
  p.money -= h.price; p.owned.houses.push(id);
  toast('Property acquired: ' + h.name + '. Rent pays out while you play.', 4);
  ev('sfx', { k: 'cash' });
  return null;
};

// ---------- stunt ramps ----------
const RAMPS = [
  { x: 1600, z: 3480, yaw: 0, len: 18, w: 8, h: 4.5 },
  { x: 2350, z: 3620, yaw: Math.PI, len: 18, w: 8, h: 4.5 },
  { x: 3200, z: 1500, yaw: 0.6, len: 16, w: 7, h: 4 },
  { x: 3700, z: 2400, yaw: -1.2, len: 16, w: 7, h: 4 },
  { x: 3500, z: 950, yaw: 2.5, len: 16, w: 7, h: 4 },
  { x: 350, z: 1000, yaw: 0.8, len: 14, w: 7, h: 3.5 },
  { x: 2610, z: 3080, yaw: -0.5, len: 14, w: 7, h: 3.5 },
  { x: 4480, z: 2010, yaw: 0, len: 16, w: 7, h: 4 }
];
C.RAMPS = RAMPS;
function rampAt(x, z) {
  for (const r of RAMPS) {
    const dx = x - r.x, dz = z - r.z;
    const ca = Math.cos(-r.yaw), sa = Math.sin(-r.yaw);
    const lx = ca * dx - sa * dz, lz = sa * dx + ca * dz;
    if (lx >= 0 && lx <= r.len && Math.abs(lz) <= r.w / 2) return { r, y: (lx / r.len) * r.h };
  }
  return null;
}
C.rampAt = rampAt;

// ---------- combat ----------
function losClear(ax, ay, az, bx, by, bz) {
  const d = Math.hypot(bx - ax, bz - az), steps = Math.ceil(d / 4);
  for (let i = 1; i < steps; i++) {
    const x = ax + (bx - ax) * i / steps, y = ay + (by - ay) * i / steps, z = az + (bz - az) * i / steps;
    if (solidAt(x, y, z)) return false;
    if (y < groundY(x, z) - 0.5) return false;
    const p = propBlock(x, y, z, 0);
    if (p && p.type !== 'tree' && p.type !== 'pine') return false;
  }
  return true;
}
C.losClear = losClear;
function fireBullet(x, y, z, yaw, pitch, friendly, dmg, spread) {
  const s = spread || 0;
  const a = yaw + R(-s, s), p2 = pitch + R(-s, s);
  const cp = Math.cos(p2);
  S.bullets.push({ x, y, z, dx: Math.cos(a) * cp, dy: Math.sin(p2), dz: Math.sin(a) * cp,
    spd: 320, ttl: 0.9, friendly, dmg });
  ev('flash', { x, y, z });
}
C.fireBullet = fireBullet;
function explode(x, y, z, r, dmg) {
  ev('boom', { x, y, z, r });
  const p = S.player;
  const hurt = (tx, ty, tz) => { const dd = Math.hypot(tx - x, ty - y, tz - z); return dd < r + 6 ? dmg * clamp(1 - dd / (r + 10), 0.2, 1) : 0; };
  if (!p.veh) { const h = hurt(p.x, p.y + 1, p.z); if (h) { damagePlayer(h); } }
  else p.veh.hp -= hurt(p.veh.x, p.veh.y + 1, p.veh.z) * 0.9;
  for (const e of S.enemies.concat(S.soldiers, S.footCops)) if (e.state !== 'down' && hurt(e.x, e.y + 1, e.z)) killInfantry(e);
  for (const pd of S.peds) if (pd.state !== 'down' && hurt(pd.x, pd.y + 1, pd.z)) koPed(pd, 'boom');
  for (const t of S.tanks) if (!t.dead && hurt(t.x, t.y + 1, t.z)) t.hp -= dmg * 0.6;
  for (const h of S.helis) if (!h.dead && h.fall < 0 && hurt(h.x, h.y, h.z)) h.hp -= dmg * 0.7;
  for (const c of S.cars) { const h = hurt(c.x, c.y + 1, c.z); if (h) c.hp -= h; }
  for (const c of S.cops) { const h = hurt(c.x, c.y + 1, c.z); if (h) c.hp -= h; }
}
C.explode = explode;
function damagePlayer(dmg) {
  const p = S.player;
  if (p.armor > 0) { const soak = Math.min(p.armor, dmg * 0.6); p.armor -= soak; dmg -= soak; }
  p.hp -= dmg; p.hitT = 0.4;
}
function killInfantry(e) {
  if (e.state === 'down') return;
  e.state = 'down'; e.downT = 20;
  S.pickups.push({ x: e.x, z: e.z, y: e.y, amt: 25 + (Math.random() * 60 | 0), kind: 'cash', t: 40 });
  if (e.kind === 'soldier' && !e.gmTag) addWanted(1); // killing the military is noticed
  if (S.mission && S.mission.def.onKill) S.mission.def.onKill(e);
  if (S.mission && S.mission.mark === e) S.mission.killed = true;
  ev('sfx', { k: 'punch' });
}
C.killInfantry = killInfantry;
function koPed(pd, cause) {
  if (pd.state === 'down') return;
  pd.state = 'down'; pd.downT = 18;
  S.pickups.push({ x: pd.x, z: pd.z, y: pd.y, amt: 10 + (Math.random() * 50 | 0), kind: 'cash', t: 30 });
  scare(pd.x, pd.z, 60);
  addWanted(1);
  ev('sfx', { k: cause === 'car' ? 'crash' : 'punch' });
}
function scare(x, z, r) {
  for (const pd of S.peds) if (pd.state === 'walk' && d2(pd.x, pd.z, x, z) < r) {
    pd.state = 'flee'; pd.t = R(3, 6);
    pd.yaw = Math.atan2(pd.z - z, pd.x - x) + R(-0.5, 0.5);
  }
}
function addWanted(n) { S.wanted = clamp(S.wanted + n, 1, 5); S.evadeT = 0; }
C.addWanted = addWanted;

// ---------- infantry AI (shared by mission hostiles, soldiers, foot cops) ----------
function coverPoint(e, px, pz) {
  let best = null, bs = 1e9;
  for (const c of props) {
    if (c.type === 'tent' || c.type === 'tree' || c.type === 'pine') continue;
    const dc = d2(c.x, c.z, e.x, e.z);
    if (dc > 140) continue;
    const dp = d2(c.x, c.z, px, pz);
    const score = Math.abs(dp - 55) + dc * 0.55 + (dp < 25 ? 200 : 0);
    if (score < bs) { bs = score; best = c; }
  }
  return best;
}
function updateInfantry(e, dt, weaponDmg) {
  if (e.state === 'down') {
    e.downT -= dt;
    if (e.downT <= 0) e.dead = true;
    return;
  }
  const p = S.player;
  const px = p.x, pz = p.z, py = p.y;
  const d = d2(e.x, e.z, px, pz);
  e.losT -= dt;
  if (e.losT <= 0) { e.los = losClear(e.x, e.y + 1.5, e.z, px, py + 1.2, pz); e.losT = 0.2; }
  e.moveT -= dt;
  if (e.moveT <= 0) {
    const best = coverPoint(e, px, pz);
    if (best) {
      const away = Math.atan2(best.z - pz, best.x - px);
      e.cx = best.x + Math.cos(away) * (best.r + 2.5);
      e.cz = best.z + Math.sin(away) * (best.r + 2.5);
    } else {
      const a = Math.atan2(e.z - pz, e.x - px) + R(-1.2, 1.2);
      e.cx = px + Math.cos(a) * R(35, 60); e.cz = pz + Math.sin(a) * R(35, 60);
    }
    e.moveT = R(2.5, 5);
  }
  const dm = d2(e.x, e.z, e.cx, e.cz);
  if (dm > 2.5) {
    const ma = Math.atan2(e.cz - e.z, e.cx - e.x);
    const sp = e.elite ? 5.6 : 4.6;
    const nx = e.x + Math.cos(ma) * sp * dt, nz = e.z + Math.sin(ma) * sp * dt;
    if (!solidAt(nx, e.y + 1, nz)) { e.x = nx; e.z = nz; } else e.moveT = 0;
    e.phase += sp * dt * 2;
    if (!e.los) e.yaw = angLerp(e.yaw, ma, clamp(8 * dt, 0, 1));
  }
  const pb = propBlock(e.x, e.y + 0.5, e.z, 0.5);
  if (pb) { const n = Math.atan2(e.z - pb.z, e.x - pb.x); e.x = pb.x + Math.cos(n) * (pb.r + 0.6); e.z = pb.z + Math.sin(n) * (pb.r + 0.6); }
  e.y = groundY(e.x, e.z);
  if (e.los) e.yaw = angLerp(e.yaw, Math.atan2(pz - e.z, px - e.x), clamp(10 * dt, 0, 1));
  e.cd -= dt;
  if (e.los && d < 120 && e.cd <= 0) {
    const pitch = Math.atan2((py + 1.2) - (e.y + 1.5), d);
    fireBullet(e.x + Math.cos(e.yaw) * 1, e.y + 1.5, e.z + Math.sin(e.yaw) * 1,
      e.yaw, pitch, false, weaponDmg || 9, 0.03 + d * 0.0004);
    ev('sfx', { k: 'eshot' });
    e.volley--;
    e.cd = e.volley > 0 ? R(0.12, 0.2) : R(1.0, 2.2);
    if (e.volley <= 0) e.volley = e.elite ? 8 : 5;
  }
}

// ---------- peds ----------
function updatePed(pd, dt) {
  if (pd.state === 'script') { pd.y = groundY(pd.x, pd.z); return; }
  pd.t -= dt;
  if (pd.state === 'down') { pd.downT -= dt; if (pd.downT <= 0) pd.dead = true; return; }
  const p = S.player;
  if (pd.state === 'flee') {
    if (pd.t <= 0) { pd.state = 'walk'; pd.t = R(1, 3); }
    const sp = 6;
    const nx = pd.x + Math.cos(pd.yaw) * sp * dt, nz = pd.z + Math.sin(pd.yaw) * sp * dt;
    if (solidAt(nx, pd.y + 1, nz)) pd.yaw += R(1.2, 2.2); else { pd.x = nx; pd.z = nz; }
    pd.phase += sp * dt * 2; pd.y = groundY(pd.x, pd.z);
    return;
  }
  if (pd.t <= 0) { pd.t = R(1, 4); if (Math.random() < 0.5) pd.yaw = (Math.random() * 4 | 0) * Math.PI / 2 + R(-0.2, 0.2); }
  const nx = pd.x + Math.cos(pd.yaw) * pd.spd * dt, nz = pd.z + Math.sin(pd.yaw) * pd.spd * dt;
  // peds keep to sidewalks: near road edge but not building
  if (!solidAt(nx + Math.cos(pd.yaw) * 1.5, pd.y + 1, nz + Math.sin(pd.yaw) * 1.5) && inCity(nx, nz)) {
    pd.x = nx; pd.z = nz; pd.phase += pd.spd * dt * 2;
  } else { pd.yaw += Math.PI / 2 + R(0, Math.PI); pd.t = R(1, 3); }
  pd.y = groundY(pd.x, pd.z);
  if (p.veh && p.veh.kind === 'car' && Math.abs(p.veh.spd) > 15 && d2(pd.x, pd.z, p.x, p.z) < 30) {
    pd.state = 'flee'; pd.t = 3; pd.yaw = Math.atan2(pd.z - p.z, pd.x - p.x) + R(-0.4, 0.4);
  }
}

// ---------- traffic ----------
function laneFor(x, z) {
  const lx = (x - CITY.x0) % P, lz = (z - CITY.z0) % P;
  const onXRoad = lz < RW, onZRoad = lx < RW;
  if (onXRoad && !onZRoad) { // road running along x
    const zc = z - lz;
    return lz < RW / 2 ? { dx: -1, dz: 0, lane: zc + RW * 0.25 } : { dx: 1, dz: 0, lane: zc + RW * 0.75 };
  }
  if (onZRoad && !onXRoad) {
    const xc = x - lx;
    return lx < RW / 2 ? { dx: 0, dz: 1, lane: xc + RW * 0.25 } : { dx: 0, dz: -1, lane: xc + RW * 0.75 };
  }
  return null;
}
C.laneFor = laneFor;
function updateTraffic(c, dt) {
  const p = S.player;
  const lookX = c.x + Math.cos(c.yaw) * 12, lookZ = c.z + Math.sin(c.yaw) * 12;
  let blocked = false;
  for (const o of S.cars) if (o !== c && d2(o.x, o.z, lookX, lookZ) < 8) blocked = true;
  if (d2(p.x, p.z, lookX, lookZ) < (p.veh ? 9 : 5)) blocked = true;
  for (const pd of S.peds) if (pd.state !== 'down' && d2(pd.x, pd.z, lookX, lookZ) < 5) blocked = true;
  const target = blocked ? 0 : c.cruise;
  c.braking = blocked && c.spd > 4;
  c.spd += clamp(target - c.spd, -30 * dt, 8 * dt);
  if (c.aiState === 'turn') {
    const ta = Math.atan2(c.ez - c.z, c.ex - c.x);
    c.yaw = angLerp(c.yaw, ta, clamp(5 * dt, 0, 1));
    const sp = Math.max(c.spd, 5);
    c.x += Math.cos(ta) * sp * dt; c.z += Math.sin(ta) * sp * dt;
    if (d2(c.x, c.z, c.ex, c.ez) < 3) {
      c.aiState = 'go';
      const L = laneFor(c.x, c.z);
      if (L) { c.dirx = L.dx; c.dirz = L.dz; c.lane = L.lane; }
    }
    c.y = groundY(c.x, c.z);
    return;
  }
  c.yaw = angLerp(c.yaw, Math.atan2(c.dirz, c.dirx), clamp(7 * dt, 0, 1));
  c.x += c.dirx * c.spd * dt; c.z += c.dirz * c.spd * dt;
  if (c.dirx !== 0) c.z += (c.lane - c.z) * clamp(3 * dt, 0, 1);
  else c.x += (c.lane - c.x) * clamp(3 * dt, 0, 1);
  c.y = groundY(c.x, c.z);
  c.planCd -= dt;
  const fx = c.x + c.dirx * 22, fz = c.z + c.dirz * 22;
  const lx = (fx - CITY.x0) % P, lz2 = (fz - CITY.z0) % P;
  if (c.planCd <= 0 && lx < RW && lz2 < RW && inCity(fx, fz)) { // intersection ahead
    const ix = fx - lx + RW / 2, iz = fz - lz2 + RW / 2;
    const dirs = [{ x: c.dirx, z: c.dirz }, { x: -c.dirz, z: c.dirx }, { x: c.dirz, z: -c.dirx }];
    const opts = dirs.filter(nd => isCityRoad(ix + nd.x * RW * 2, iz + nd.z * RW * 2) &&
      inCity(ix + nd.x * P * 0.7, iz + nd.z * P * 0.7));
    if (!opts.length) { c.dead = true; return; }
    let nd = (opts[0].x === c.dirx && opts[0].z === c.dirz && Math.random() < 0.6) ? opts[0] : opts[(Math.random() * opts.length) | 0];
    c.planCd = 6;
    if (nd.x !== c.dirx || nd.z !== c.dirz) {
      c.aiState = 'turn';
      c.ex = ix + nd.x * RW * 1.5 + (nd.x !== 0 ? 0 : (nd.z === 1 ? RW * -0.25 : RW * 0.25));
      c.ez = iz + nd.z * RW * 1.5 + (nd.z !== 0 ? 0 : (nd.x === 1 ? RW * 0.25 : RW * -0.25));
      // lane offset for the new direction
      if (nd.x !== 0) c.ez = iz + (nd.x === 1 ? RW * 0.25 : -RW * 0.25);
      else c.ex = ix + (nd.z === 1 ? -RW * 0.25 : RW * 0.25);
      c.dirx = nd.x; c.dirz = nd.z;
    }
  }
  if (!inCity(c.x, c.z)) c.dead = true;
}

// ---------- cops & military ----------
function updateCopCar(c, dt) {
  const p = S.player;
  c.flash += dt;
  const d = d2(c.x, c.z, p.x, p.z);
  const desired = Math.atan2(p.z - c.z, p.x - c.x);
  c.yaw = angLerp(c.yaw, desired, clamp(2.4 * dt, 0, 1));
  const target = d > 60 ? VEH.cop.top : (p.veh ? 30 : 9);
  c.spd += clamp(target - c.spd, -40 * dt, 20 * dt);
  const nx = c.x + Math.cos(c.yaw) * c.spd * dt;
  const nz = c.z + Math.sin(c.yaw) * c.spd * dt;
  if (solidAt(nx + Math.cos(c.yaw) * 3, c.y + 1, nz + Math.sin(c.yaw) * 3) || propBlock(nx, c.y + 0.5, nz, 2)) {
    c.spd *= -0.4; c.yaw += R(-0.5, 0.5);
  } else { c.x = nx; c.z = nz; }
  c.y = groundY(c.x, c.z);
  if (c.hp <= 0 && !c.boomed) { c.boomed = true; c.dead = true; explode(c.x, c.y + 1, c.z, 7, 60); }
  // drop a foot cop when close & stopped
  if (S.wanted >= 2 && d < 25 && Math.abs(c.spd) < 4 && !c.dropped) {
    c.dropped = true;
    const fc = mkSoldier(c.x + 2, c.z + 2, S.wanted >= 4);
    fc.kind = 'footcop';
    S.footCops.push(fc);
  }
  if (!p.veh) {
    if (d < 6 && Math.abs(c.spd) < 12) bust();
    if (d < 4 && Math.abs(c.spd) >= 12) { damagePlayer(25); p.downT = 1.2; c.spd *= 0.3; ev('sfx', { k: 'crash' }); }
  } else if (d < 9) {
    const pc = p.veh;
    if (Math.abs(c.spd) > 10) { pc.hp -= 6; pc.spd *= 0.8; c.spd *= 0.4; ev('sfx', { k: 'crash' }); }
    if (Math.abs(pc.spd) < 5) { c.arrestT = (c.arrestT || 0) + dt; if (c.arrestT > 2.5) bust(); }
    else c.arrestT = 0;
  }
}
function bust() {
  if (S.state !== 'play') return;
  S.state = 'busted'; S.stateT = 0; ev('sfx', { k: 'crash' });
}
function waste() {
  if (S.state !== 'play') return;
  S.state = 'wasted'; S.stateT = 0; ev('sfx', { k: 'crash' });
}
C.bust = bust; C.waste = waste;

// ---------- tanks (hostile AI or player-driven handled in vehicle physics) ----------
function updateTankAI(tk, dt) {
  if (tk.dead) return;
  if (tk.hp <= 0) {
    if (!tk.boomed) {
      tk.boomed = true; explode(tk.x, tk.y + 1, tk.z, 16, 120);
      props.push({ x: tk.x, z: tk.z, y: tk.y, r: 4, h: 2.5, type: 'wreck' });
      if (S.mission && S.mission.def.onTankKill) S.mission.def.onTankKill(tk);
    }
    tk.dead = true; return;
  }
  if (tk.owned || S.player.veh === tk) return; // player's
  if (!tk.hostile) return;                     // parked
  const p = S.player;
  const d = d2(tk.x, tk.z, p.x, p.z);
  const angTo = Math.atan2(p.z - tk.z, p.x - tk.x);
  tk.losT -= dt;
  if (tk.losT <= 0) { tk.los = losClear(tk.x, tk.y + 2.5, tk.z, p.x, p.y + 1.2, p.z); tk.losT = 0.35; }
  tk.yaw = angLerp(tk.yaw, angTo, clamp(0.5 * dt, 0, 1));
  const wantSpd = d > 70 ? VEH.tank.top : 0;
  tk.spd += clamp(wantSpd - tk.spd, -12 * dt, 5 * dt);
  const nx = tk.x + Math.cos(tk.yaw) * tk.spd * dt, nz = tk.z + Math.sin(tk.yaw) * tk.spd * dt;
  if (!solidAt(nx + Math.cos(tk.yaw) * 5, tk.y + 1, nz + Math.sin(tk.yaw) * 5)) { tk.x = nx; tk.z = nz; }
  else tk.yaw += 0.5 * dt;
  // crush props
  const pb = propBlock(tk.x, tk.y + 0.5, tk.z, 3);
  if (pb && pb.type !== 'wreck') { const i = props.indexOf(pb); if (i >= 0) props.splice(i, 1); }
  tk.y = groundY(tk.x, tk.z);
  tk.ta = angLerp(tk.ta, angTo, clamp(1.1 * dt, 0, 1));
  tk.cd -= dt;
  if (tk.cd <= 0 && tk.los && d < 170 && angDiff(tk.ta, angTo) < 0.12) {
    S.shellsList.push({ x: tk.x + Math.cos(tk.ta) * 6, y: tk.y + 2.4, z: tk.z + Math.sin(tk.ta) * 6,
      dx: Math.cos(tk.ta), dz: Math.sin(tk.ta), dy: clamp(((p.y + 1) - (tk.y + 2.4)) / d, -0.3, 0.3), ttl: 2.5, friendly: false });
    ev('sfx', { k: 'boom' }); ev('flash', { x: tk.x + Math.cos(tk.ta) * 6.5, y: tk.y + 2.4, z: tk.z + Math.sin(tk.ta) * 6.5 });
    tk.cd = R(3, 4.5);
  }
}

// ---------- helis (hostile gunship AI; player heli in vehicle physics) ----------
function updateHeliAI(h, dt) {
  if (h.dead) return;
  h.rotor += dt * 30;
  const p = S.player;
  if (h.fall >= 0) {
    h.fall += dt;
    h.yaw += 5 * dt;
    h.x += Math.cos(h.yaw) * 20 * dt; h.z += Math.sin(h.yaw) * 20 * dt;
    h.y -= 26 * dt;
    ev('smoke', { x: h.x, y: h.y, z: h.z });
    if (h.y <= groundY(h.x, h.z) + 1) {
      explode(h.x, h.y, h.z, 18, 130); h.dead = true;
      if (S.mission && S.mission.def.onHeliKill) S.mission.def.onHeliKill(h);
    }
    return;
  }
  if (h.hp <= 0) { h.fall = 0; ev('sfx', { k: 'crash' }); return; }
  if (h.owned || p.veh === h) return;
  if (!h.hostile) return;
  if (h.fleeRoute) {
    const wp = h.fleeRoute[h.fri || 0];
    if (wp) {
      const ma = Math.atan2(wp.z - h.z, wp.x - h.x);
      h.x += Math.cos(ma) * 27 * dt; h.z += Math.sin(ma) * 27 * dt;
      h.yaw = ma;
      if (d2(h.x, h.z, wp.x, wp.z) < 35) h.fri = (h.fri || 0) + 1;
    } else h.escaped = (h.escaped || 0) + dt;
    const ty2 = Math.max(groundY(h.x, h.z) + 45, 55);
    h.y += clamp(ty2 - h.y, -12 * dt, 12 * dt);
  } else {
  h.orb += 0.4 * dt;
  const tx = p.x + Math.cos(h.orb) * 90, tz = p.z + Math.sin(h.orb) * 90;
  const ma = Math.atan2(tz - h.z, tx - h.x);
  const spd = clamp(d2(h.x, h.z, tx, tz) * 0.8, 12, 46);
  h.x += Math.cos(ma) * spd * dt; h.z += Math.sin(ma) * spd * dt;
  const targetY = Math.max(groundY(h.x, h.z) + 40, p.y + 35);
  h.y += clamp(targetY - h.y, -14 * dt, 14 * dt);
  h.yaw = angLerp(h.yaw, Math.atan2(p.z - h.z, p.x - h.x), clamp(2 * dt, 0, 1));
  }
  h.cd -= dt;
  if (h.cd <= 0) { h.burst = 10; h.bt = 0; h.cd = R(2.5, 4); }
  if (h.burst > 0) {
    h.bt -= dt;
    if (h.bt <= 0) {
      h.bt = 0.08; h.burst--;
      const dd = Math.max(1, d3({ x: h.x, y: h.y, z: h.z }, { x: p.x, y: p.y, z: p.z }));
      let lx = p.x, lz = p.z;
      if (p.veh && p.veh.kind === 'car') { lx += Math.cos(p.veh.yaw) * p.veh.spd * 0.4; lz += Math.sin(p.veh.yaw) * p.veh.spd * 0.4; }
      const fy = Math.atan2(lz - h.z, lx - h.x);
      const fp = Math.atan2((p.y + 1) - h.y, d2(h.x, h.z, lx, lz));
      fireBullet(h.x, h.y - 1, h.z, fy, fp, false, 10, 0.05);
      ev('sfx', { k: 'eshot' });
    }
  }
}

// ---------- projectiles ----------
function updateBullets(dt) {
  const p = S.player;
  for (const b of S.bullets) {
    b.ttl -= dt;
    const step = b.spd * dt, sub = Math.ceil(step / 1.4);
    for (let i = 0; i < sub && b.ttl > 0; i++) {
      b.x += b.dx * step / sub; b.y += b.dy * step / sub; b.z += b.dz * step / sub;
      if (b.y <= groundY(b.x, b.z)) { b.ttl = 0; break; }
      if (solidAt(b.x, b.y, b.z)) { b.ttl = 0; break; }
      const pb = propBlock(b.x, b.y, b.z, 0);
      if (pb) { b.ttl = 0; break; }
      if (b.friendly) {
        let hit = false;
        for (const e of S.enemies.concat(S.soldiers, S.footCops)) {
          if (e.state === 'down') continue;
          if (d2(e.x, e.z, b.x, b.z) < 1.3 && b.y > e.y - 0.2 && b.y < e.y + 2.2) {
            e.hp -= b.dmg; e.moveT = 0; b.ttl = 0; hit = true;
            if (e.hp <= 0) killInfantry(e);
            break;
          }
        }
        if (!hit) for (const pd of S.peds) {
          if (pd.state === 'down') continue;
          if (d2(pd.x, pd.z, b.x, b.z) < 1.3 && b.y > pd.y - 0.2 && b.y < pd.y + 2.2) {
            pd.hp -= b.dmg; b.ttl = 0;
            if (pd.hp <= 0) koPed(pd, 'shot'); else { pd.state = 'flee'; pd.t = 4; scare(pd.x, pd.z, 40); addWanted(1); }
            break;
          }
        }
        if (b.ttl > 0) for (const h of S.helis) {
          if (h.dead || h.fall >= 0 || h.owned || h === p.veh) continue;
          if (d3(h, b) < 6) { h.hp -= b.dmg * 0.5; b.ttl = 0; break; }
        }
        if (b.ttl > 0) for (const tk of S.tanks) {
          if (tk.dead || tk.owned || tk === p.veh) continue;
          if (d2(tk.x, tk.z, b.x, b.z) < 6 && b.y < tk.y + 4) { b.ttl = 0; break; } // armor shrugs it off
        }
        if (b.ttl > 0) for (const c of S.cops) {
          if (d2(c.x, c.z, b.x, b.z) < 3 && b.y < c.y + 2.5) { c.hp -= b.dmg; b.ttl = 0; addWanted(1); break; }
        }
        if (b.ttl > 0) for (const c of S.cars) {
          if (c === p.veh) continue;
          if (d2(c.x, c.z, b.x, b.z) < 3 && b.y < c.y + 2.5) { c.hp -= b.dmg * 0.6; b.ttl = 0; break; }
        }
      } else {
        if (p.veh) {
          if (d2(p.veh.x, p.veh.z, b.x, b.z) < 3.5 && Math.abs(b.y - (p.veh.y + 1.5)) < 4) { p.veh.hp -= b.dmg * 0.5; b.ttl = 0; }
        } else if (d2(p.x, p.z, b.x, b.z) < 1.1 && b.y > p.y - 0.2 && b.y < p.y + 2.2) {
          damagePlayer(b.dmg); b.ttl = 0;
        }
      }
    }
  }
  S.bullets = S.bullets.filter(b => b.ttl > 0);
  for (const s of S.shellsList) {
    s.ttl -= dt;
    s.x += s.dx * 90 * dt; s.y += s.dy * 90 * dt; s.z += s.dz * 90 * dt;
    let boom = s.ttl <= 0 || s.y <= groundY(s.x, s.z) || solidAt(s.x, s.y, s.z) || propBlock(s.x, s.y, s.z, 0);
    if (!boom && !s.friendly) {
      if (!p.veh && d2(p.x, p.z, s.x, s.z) < 3) boom = true;
      if (p.veh && d2(p.veh.x, p.veh.z, s.x, s.z) < 5) boom = true;
    }
    if (!boom && s.friendly) {
      for (const tk of S.tanks) if (!tk.dead && tk !== p.veh && d2(tk.x, tk.z, s.x, s.z) < 6) { boom = true; break; }
      if (!boom) for (const e of S.enemies.concat(S.soldiers, S.footCops)) if (e.state !== 'down' && d2(e.x, e.z, s.x, s.z) < 3) { boom = true; break; }
      if (!boom) for (const c of S.cops) if (d2(c.x, c.z, s.x, s.z) < 4) { boom = true; break; }
    }
    if (boom) { explode(s.x, s.y, s.z, 14, 130); s.ttl = 0; }
  }
  S.shellsList = S.shellsList.filter(s => s.ttl > 0);
  for (const m of S.rockets) {
    m.ttl -= dt;
    m.spd = Math.min(160, m.spd + 140 * dt);
    const guided = m.tgt && !m.tgt.dead && !(m.tgt.fall >= 0);
    if (guided) {
      const aimY = m.tgt.y + (m.tgt.kind === 'tank' ? 2.5 : 0);
      const ty = Math.atan2(m.tgt.z - m.z, m.tgt.x - m.x);
      const tp = Math.atan2(aimY - m.y, d2(m.x, m.z, m.tgt.x, m.tgt.z));
      m.yaw = angLerp(m.yaw, ty, clamp(3.5 * dt, 0, 1));
      m.pitch = angLerp(m.pitch, tp, clamp(3.5 * dt, 0, 1));
    }
    const cp = Math.cos(m.pitch);
    m.x += Math.cos(m.yaw) * cp * m.spd * dt;
    m.z += Math.sin(m.yaw) * cp * m.spd * dt;
    m.y += Math.sin(m.pitch) * m.spd * dt;
    if (guided) m.y = Math.max(m.y, groundY(m.x, m.z) + 1.2); // guided rockets skim terrain
    ev('smoke', { x: m.x, y: m.y, z: m.z });
    let hit = false;
    for (const h of S.helis) if (!h.dead && h.fall < 0 && !h.owned && h !== p.veh && d3(h, m) < 7) { h.hp -= m.dmg; hit = true; break; }
    if (!hit) for (const tk of S.tanks) if (!tk.dead && !tk.owned && tk !== p.veh && d2(tk.x, tk.z, m.x, m.z) < 7 && m.y < tk.y + 5) { tk.hp -= m.dmg; hit = true; break; }
    if (hit || m.ttl <= 0 || m.y <= groundY(m.x, m.z) || solidAt(m.x, m.y, m.z)) {
      explode(m.x, m.y, m.z, m.splash || 12, 90); m.ttl = 0;
    }
  }
  S.rockets = S.rockets.filter(m => m.ttl > 0);
  // air-dropped bombs — parabolic fall, big blast on impact
  for (const b of S.bombs) {
    b.ttl -= dt;
    b.vy -= 22 * dt;
    b.x += b.dx * dt; b.z += b.dz * dt; b.y += b.vy * dt;
    ev('smoke', { x: b.x, y: b.y, z: b.z });
    const gyb = groundY(b.x, b.z);
    if (b.ttl <= 0 || b.y <= gyb || solidAt(b.x, b.y, b.z) || propBlock(b.x, b.y, b.z, 0)) {
      explode(b.x, Math.max(b.y, gyb), b.z, 24, 240); b.ttl = 0; ev('shake', { n: 8 });
    }
  }
  S.bombs = S.bombs.filter(b => b.ttl > 0);
}

// ---------- player: on foot ----------
function playerFoot(dt, inp) {
  const p = S.player;
  if (p.downT > 0) { p.downT -= dt; return; }
  p.pitch = inp.camPitch;
  const aiming = p.cur !== 'fists';
  if (aiming) p.yaw = inp.camYaw;
  const sp = (inp.run ? 7.5 : 4.5);
  let mx = 0, mz = 0;
  if (inp.fwd || inp.back || inp.left || inp.right) {
    const f = (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0);
    const r = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const a = p.yaw + Math.atan2(r, f) * (f < 0 && !r ? -1 : 1);
    const ang = p.yaw + Math.atan2(r, Math.max(f, -1) === f && f !== 0 ? f : (f || 0.0001));
    // simpler: move vector in camera space
    mx = Math.cos(p.yaw) * f + Math.cos(p.yaw + Math.PI / 2) * r;
    mz = Math.sin(p.yaw) * f + Math.sin(p.yaw + Math.PI / 2) * r;
    const L = Math.hypot(mx, mz) || 1;
    mx /= L; mz /= L;
  }
  const wantMove = !!(mx || mz);
  // smooth acceleration/deceleration of the movement velocity so start/stop isn't a snap
  p.mvx = p.mvx || 0; p.mvz = p.mvz || 0;
  const tvx = wantMove ? mx * sp : 0, tvz = wantMove ? mz * sp : 0;
  const accel = wantMove ? 14 : 20;
  p.mvx += (tvx - p.mvx) * clamp(accel * dt, 0, 1);
  p.mvz += (tvz - p.mvz) * clamp(accel * dt, 0, 1);
  const vmag = Math.hypot(p.mvx, p.mvz);
  p.moving = vmag > 0.3;
  if (!aiming && vmag > 0.3) p.yaw = angLerp(p.yaw, Math.atan2(p.mvz, p.mvx), clamp(10 * dt, 0, 1));
  if (vmag > 0.01) {
    const nx = p.x + p.mvx * dt, nz = p.z + p.mvz * dt;
    if (!solidAt(nx + Math.sign(p.mvx) * 0.6, p.y + 1, p.z)) p.x = clamp(nx, 5, W - 5); else p.mvx = 0;
    if (!solidAt(p.x, p.y + 1, nz + Math.sign(p.mvz) * 0.6)) p.z = clamp(nz, 5, D - 5); else p.mvz = 0;
    p.phase += vmag * dt * 2;
  }
  const pb = propBlock(p.x, p.y + 0.5, p.z, 0.5);
  if (pb) { const n = Math.atan2(p.z - pb.z, p.x - pb.x); p.x = pb.x + Math.cos(n) * (pb.r + 0.6); p.z = pb.z + Math.sin(n) * (pb.r + 0.6); }
  const gy = groundY(p.x, p.z);
  p.y += clamp(gy - p.y, -30 * dt, 30 * dt); // follow terrain / ramps
  // weapon handling
  const wid = p.cur, w = WEAPONS[wid];
  p.fireT = Math.max(0, p.fireT - dt);
  p.punchT = Math.max(0, p.punchT - dt);
  if (inp.reload && w.mag && p.weapons[wid].mag < w.mag && p.ammo[w.cls] > 0 && p.reloadT <= 0) {
    p.reloadT = 1.4; ev('sfx', { k: 'reload' });
  }
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      const need = w.mag - p.weapons[wid].mag;
      const take = Math.min(need, p.ammo[w.cls]);
      p.weapons[wid].mag += take; p.ammo[w.cls] -= take;
    }
  } else if (inp.fire && p.fireT <= 0) {
    if (wid === 'fists') {
      p.fireT = 1 / w.rof; p.punchT = 0.35; ev('sfx', { k: 'punch' });
      for (const pd of S.peds) {
        if (pd.state !== 'down' && d2(pd.x, pd.z, p.x, p.z) < w.range + 0.6) {
          const rel = Math.atan2(pd.z - p.z, pd.x - p.x);
          if (angDiff(rel, p.yaw) < 1.2) { pd.hp -= 40; if (pd.hp <= 0) koPed(pd, 'punch'); else { pd.state = 'flee'; pd.t = 5; addWanted(1); } break; }
        }
      }
      for (const e of S.enemies.concat(S.soldiers, S.footCops))
        if (e.state !== 'down' && d2(e.x, e.z, p.x, p.z) < w.range + 0.6) { e.hp -= 55; if (e.hp <= 0) killInfantry(e); break; }
    } else if (w.cls === 'rocket' || w.cls === 'aa') {
      if (p.ammo[w.cls] > 0) {
        p.fireT = 1 / w.rof; p.ammo[w.cls]--;
        const tgt = (w.cls === 'aa' && p.lockT >= 1) ? p.lockTgt : null;
        S.rockets.push({ x: p.x + Math.cos(p.yaw) * 1.2, y: p.y + 1.5, z: p.z + Math.sin(p.yaw) * 1.2,
          yaw: p.yaw, pitch: p.pitch, spd: 70, tgt, ttl: 5, dmg: w.dmg, splash: w.splash });
        ev('sfx', { k: 'missile' });
      }
    } else if (p.weapons[wid].mag > 0) {
      p.weapons[wid].mag--;
      p.fireT = 1 / w.rof;
      const n = w.pellets || 1;
      for (let i = 0; i < n; i++)
        fireBullet(p.x + Math.cos(p.yaw) * 0.8, p.y + 1.5, p.z + Math.sin(p.yaw) * 0.8,
          p.yaw, p.pitch, true, w.dmg, w.spread + (p.moving ? 0.02 : 0));
      ev('sfx', { k: 'shot' });
      if (inCity(p.x, p.z)) { scare(p.x, p.z, 45); addWanted(S.wanted ? 0 : 1); if (S.wanted === 0) addWanted(1); }
      if (p.weapons[wid].mag === 0 && p.ammo[w.cls] > 0) { p.reloadT = 1.5; ev('sfx', { k: 'reload' }); }
    }
  }
  // AA lock-on
  if (w.cls === 'aa') {
    let best = null, bd = 0.3;
    for (const h of S.helis) {
      if (h.dead || h.fall >= 0 || h.owned || h === p.veh) continue;
      const dd = d3(h, { x: p.x, y: p.y + 1.5, z: p.z });
      if (dd > 400) continue;
      const ty = Math.atan2(h.z - p.z, h.x - p.x);
      const tp = Math.atan2(h.y - (p.y + 1.5), d2(p.x, p.z, h.x, h.z));
      const da = angDiff(p.yaw, ty) + Math.abs(p.pitch - tp) * 0.7;
      if (da < bd) { bd = da; best = h; }
    }
    if (!best) for (const tk of S.tanks) {
      if (tk.dead || tk.owned || tk === p.veh) continue;
      const ty = Math.atan2(tk.z - p.z, tk.x - p.x);
      if (d2(p.x, p.z, tk.x, tk.z) < 300 && angDiff(p.yaw, ty) < 0.25) { best = tk; break; }
    }
    if (best !== p.lockTgt) { p.lockTgt = best; p.lockT = best ? 0.15 : 0; }
    else if (best) { const was = p.lockT; p.lockT = Math.min(1, p.lockT + dt / 0.9); if (p.lockT >= 1 && was < 1) ev('sfx', { k: 'lock' }); }
  } else { p.lockTgt = null; p.lockT = 0; }
  // hostile melee pressure
  for (const e of S.enemies.concat(S.soldiers, S.footCops))
    if (e.state !== 'down' && d2(e.x, e.z, p.x, p.z) < 2) damagePlayer(12 * dt);
  // pickups & stashes
  for (const g of S.pickups) if (d2(g.x, g.z, p.x, p.z) < 2.5) {
    if (g.kind === 'cash') { p.money += g.amt; ev('popup', { msg: '+$' + g.amt }); }
    g.t = 0; ev('sfx', { k: 'cash' });
  }
  for (const st of stashes) if (!st.found && d2(st.x, st.z, p.x, p.z) < 3) {
    st.found = true; p.money += st.amt; p.rep += 1;
    ev('popup', { msg: 'STASH +$' + st.amt });
    ev('sfx', { k: 'cash' });
    const left = stashes.filter(s2 => !s2.found).length;
    toast('Hidden stash found! ' + left + ' remain out there.', 3);
  }
  // vehicle entry
  if (inp.enter) {
    inp.enter = false;
    let best = null, bd = 6, bt = null;
    for (const c of S.cars) { const dd = d2(c.x, c.z, p.x, p.z); if (dd < bd) { bd = dd; best = c; bt = 'car'; } }
    for (const c of S.cops) { const dd = d2(c.x, c.z, p.x, p.z); if (dd < bd) { bd = dd; best = c; bt = 'cop'; } }
    for (const h of S.helis) { if (h.hostile || h.dead) continue; const dd = d2(h.x, h.z, p.x, p.z); if (dd < Math.max(bd, 8) && Math.abs(h.y - p.y) < 4) { bd = dd; best = h; bt = 'heli'; } }
    for (const tk of S.tanks) { if (tk.dead) continue; const dd = d2(tk.x, tk.z, p.x, p.z); if (dd < Math.max(bd, 8)) { bd = dd; best = tk; bt = 'tank'; } }
    if (best) {
      if (bt === 'car' && best.type === 'traffic') {
        const drv = mkPed(best.x + 2, best.z + 2); drv.state = 'flee'; drv.t = 6; S.peds.push(drv);
        addWanted(1); scare(best.x, best.z, 50);
        best.type = 'free';
      }
      if (bt === 'cop') { S.cops = S.cops.filter(c => c !== best); S.cars.push(best); best.type = 'free'; addWanted(2); }
      if (bt === 'tank' && best.hostile) return; // can't jack a fighting tank
      if (bt === 'tank') best.cd = 0;
      if (bt === 'tank' && inFort(best.x, best.z)) { addWanted(4); toast('THEY SEE YOU. Get that armor out of Fort Kubra!', 4); if (S.mission && S.mission.def.onTankSteal) S.mission.def.onTankSteal(best); }
      p.veh = best; ev('sfx', { k: 'door' });
    }
  }
}

// ---------- player: vehicles ----------
function playerVehicle(dt, inp) {
  const p = S.player, v = p.veh, cfg = VEH[v.cls];
  if (inp.enter) {
    inp.enter = false;
    // dismount beside vehicle (helis must be low)
    if (v.kind === 'heli' || v.kind === 'plane') {
      if (v.y > groundY(v.x, v.z) + 4) { toast('Land first.', 1.5); }
      else { p.veh = null; p.x = v.x + 4; p.z = v.z + 4; p.y = groundY(p.x, p.z); ev('sfx', { k: 'door' }); return; }
    } else {
      p.veh = null; p.x = v.x + Math.cos(v.yaw + Math.PI / 2) * 4; p.z = v.z + Math.sin(v.yaw + Math.PI / 2) * 4;
      if (solidAt(p.x, p.y + 1, p.z)) { p.x = v.x - Math.cos(v.yaw + Math.PI / 2) * 4; p.z = v.z - Math.sin(v.yaw + Math.PI / 2) * 4; }
      p.y = groundY(p.x, p.z); ev('sfx', { k: 'door' }); return;
    }
  }
  const broken = v.hp <= 0;
  if (broken && (v.kind === 'heli' || v.kind === 'plane') && v.fall < 0) { v.fall = 0; }
  if (v.kind === 'car' || v.kind === 'tank') {
    const isTank = v.kind === 'tank';
    const boost = inp.nitro && !isTank && p.nitro > 0 && !broken && inp.fwd;
    let top = broken ? 6 : cfg.top, acc = cfg.acc;
    if (boost) { top += 16; acc += 14; p.nitro = Math.max(0, p.nitro - 30 * dt); ev('nitro', {}); }
    else p.nitro = Math.min(100, p.nitro + 8 * dt);
    if (inp.fwd && !broken) v.spd += (v.spd < 0 ? 30 : acc) * dt;
    if (inp.back && !broken) v.spd -= (v.spd > 0 ? 28 : acc * 0.6) * dt;
    v.spd = clamp(v.spd, -top * 0.4, top);
    v.spd -= v.spd * (inp.handbrake ? 2.4 : 0.5) * dt;
    if (!inp.fwd && !inp.back) v.spd -= v.spd * 1.0 * dt;
    const steer = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const prevSpd = v.spd;
    const turnRate = steer * (inp.handbrake ? 2.6 : isTank ? 0.9 : 1.8) * dt * clamp(v.spd / (isTank ? 4 : 12), -1, 1);
    v.yaw += turnRate;
    v.braking = inp.back && v.spd > 3;
    // body dynamics (for the renderer): roll leans into turns, pitch dives on brake / squats on accel, plus a bob
    if (!isTank) {
      const latG = (turnRate / Math.max(dt, 0.001)) * v.spd * 0.010;
      const lonG = (v.spd - prevSpd) / Math.max(dt, 0.001);
      v.roll = (v.roll || 0) + (clamp(-latG, -0.22, 0.22) - (v.roll || 0)) * clamp(9 * dt, 0, 1);
      v.pitch = (v.pitch || 0) + (clamp(lonG * 0.010, -0.16, 0.16) - (v.pitch || 0)) * clamp(7 * dt, 0, 1);
      v.bob = Math.sin((v.bobT = (v.bobT || 0) + dt * (6 + Math.abs(v.spd) * 0.3)) ) * Math.min(0.05, Math.abs(v.spd) * 0.002);
    }
    const nx = v.x + Math.cos(v.yaw) * v.spd * dt;
    const nz = v.z + Math.sin(v.yaw) * v.spd * dt;
    const nose = isTank ? 5 : 2.6;
    if (solidAt(nx + Math.cos(v.yaw) * nose, v.y + 1, nz + Math.sin(v.yaw) * nose) ||
        (!isTank && propBlock(nx, v.y + 0.5, nz, 2))) {
      if (Math.abs(v.spd) > 12) { v.hp -= Math.abs(v.spd) / 2.5; ev('sfx', { k: 'crash' }); ev('shake', { n: Math.abs(v.spd) / 8 }); }
      v.spd *= -0.35;
    } else {
      if (isTank) { const pb = propBlock(nx, v.y + 0.5, nz, 3); if (pb && pb.type !== 'wreck') { const i = props.indexOf(pb); if (i >= 0) props.splice(i, 1); } }
      v.x = nx; v.z = nz;
    }
    v.x = clamp(v.x, 8, W - 8); v.z = clamp(v.z, 8, D - 8);
    const gy = groundY(v.x, v.z);
    if (isTank) v.y += clamp(gy - v.y, -40 * dt, 40 * dt);
    else {
      // stunt ramps + airtime bonuses
      v.vy = v.vy || 0;
      const rr2 = rampAt(v.x, v.z);
      if (v.air) {
        v.airT += dt; v.vy -= 22 * dt; v.y += v.vy * dt;
        if (v.y <= gy + 0.05) {
          v.y = gy; v.air = false; v.vy = 0;
          if (v.airT > 0.85) {
            const bonus = Math.round(60 * v.airT * v.airT + Math.abs(v.spd) * 2);
            p.money += bonus; p.rep += 1;
            ev('popup', { msg: 'INSANE STUNT +$' + bonus });
            ev('sfx', { k: 'win' }); ev('shake', { n: 4 });
          } else if (v.airT > 0.3) ev('shake', { n: 2 });
        }
      } else if (rr2 && rr2.y >= gy - 0.01) {
        v.y = gy + rr2.y; v.onRamp = rr2.r;
      } else if (v.onRamp) {
        const rmp = v.onRamp; v.onRamp = null;
        if (Math.abs(v.spd) > 10) { v.air = true; v.airT = 0; v.vy = Math.abs(v.spd) * (rmp.h / rmp.len) * 0.95; }
        else v.y += clamp(gy - v.y, -40 * dt, 40 * dt);
      } else v.y += clamp(gy - v.y, -40 * dt, 40 * dt);
    }
    // tank turret + cannon
    if (isTank) {
      v.ta = angLerp(v.ta, inp.camYaw, clamp(2 * dt, 0, 1));
      v.cd = Math.max(0, (v.cd || 0) - dt);
      if (inp.fire && v.cd <= 0) {
        v.cd = 2.2;
        S.shellsList.push({ x: v.x + Math.cos(v.ta) * 6, y: v.y + 2.4, z: v.z + Math.sin(v.ta) * 6,
          dx: Math.cos(v.ta) * Math.cos(inp.camPitch), dz: Math.sin(v.ta) * Math.cos(inp.camPitch),
          dy: Math.sin(inp.camPitch), ttl: 2.5, friendly: true });
        ev('sfx', { k: 'boom' }); ev('shake', { n: 5 });
      }
    }
    // collisions with other cars / peds / infantry
    for (const o of S.cars.concat(S.cops)) {
      if (o === v) continue;
      const dd = d2(o.x, o.z, v.x, v.z);
      if (dd < 5.5) {
        const n = Math.atan2(o.z - v.z, o.x - v.x);
        o.x += Math.cos(n) * (5.5 - dd); o.z += Math.sin(n) * (5.5 - dd);
        if (Math.abs(v.spd) > 14) { v.hp -= isTank ? 0 : 3; o.hp -= isTank ? 60 : 10; ev('sfx', { k: 'crash' }); if (o.type === 'cop') addWanted(1); }
        if (!isTank) v.spd *= 0.6;
        if (o.type === 'traffic') { o.cruise = 0; }
      }
    }
    for (const pd of S.peds) if (pd.state !== 'down' && d2(pd.x, pd.z, v.x, v.z) < (isTank ? 5 : 3) && Math.abs(v.spd) > 6) koPed(pd, 'car');
    for (const e of S.enemies.concat(S.soldiers, S.footCops)) if (e.state !== 'down' && d2(e.x, e.z, v.x, v.z) < (isTank ? 5 : 3) && Math.abs(v.spd) > 6) killInfantry(e);
    for (const g of S.pickups) if (g.kind === 'cash' && d2(g.x, g.z, v.x, v.z) < 4) { p.money += g.amt; g.t = 0; ev('popup', { msg: '+$' + g.amt }); ev('sfx', { k: 'cash' }); }
    if (v.hp < 40) ev('smoke', { x: v.x, y: v.y + 1, z: v.z });
  } else { // heli / plane
    const isPlane = v.kind === 'plane' || v.cls === 'plane';
    v.rotor = (v.rotor || 0) + dt * 30;
    if (v.fall >= 0) { // shot down with player inside
      v.fall += dt; v.y -= 30 * dt; v.yaw += 4 * dt;
      if (v.y <= groundY(v.x, v.z) + 1) { explode(v.x, v.y, v.z, 18, 200); v.dead = true; p.veh = null; waste(); }
      return;
    }
    if (inp.fwd && !broken) v.spd += cfg.acc * dt;
    if (inp.back) v.spd -= cfg.acc * 0.7 * dt;
    v.spd = clamp(v.spd, isPlane ? 0 : -10, cfg.top);
    v.spd -= v.spd * 0.15 * dt;
    v.yaw += ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * (isPlane ? 0.9 : 1.6) * dt;
    const gy2 = groundY(v.x, v.z);
    const flying = v.y > gy2 + 0.6;
    if (isPlane) {
      const lift = v.spd > 32;
      if (lift && inp.up) v.vy = clamp(v.vy + 18 * dt, -20, 16);
      else if (inp.down) v.vy = clamp(v.vy - 20 * dt, -22, 16);
      else v.vy += ((lift ? 0 : -14) - v.vy * 0.8) * dt;
      if (!flying && v.spd < 30) v.vy = Math.min(v.vy, 0);
    } else {
      if (inp.up && !broken) v.vy = clamp(v.vy + 22 * dt, -18, 14);
      else if (inp.down) v.vy = clamp(v.vy - 22 * dt, -18, 14);
      else v.vy -= v.vy * 2.2 * dt;
      if (!flying && !inp.up) v.spd -= v.spd * 2 * dt;
    }
    v.x += Math.cos(v.yaw) * v.spd * dt;
    v.z += Math.sin(v.yaw) * v.spd * dt;
    v.y += v.vy * dt;
    v.x = clamp(v.x, 10, W - 10); v.z = clamp(v.z, 10, D - 10);
    const g3 = groundY(v.x, v.z);
    if (v.y < g3) {
      if (v.vy < -12 || v.spd > 55) { v.hp -= 80; ev('sfx', { k: 'crash' }); ev('shake', { n: 8 }); }
      v.y = g3; v.vy = 0;
    }
    if (v.y > 320) v.y = 320;
    // rooftop collision
    if (solidAt(v.x, v.y, v.z)) { v.hp -= 100; explode(v.x, v.y, v.z, 10, 60); v.y += 4; v.spd *= 0.3; }
    // aircraft armament — machine guns + bomb payload (helis and the fighter jet)
    const armedAir = !isPlane || v.cls === 'jet';
    if (armedAir && inp.fire) {
      v.gcd = Math.max(0, (v.gcd || 0) - dt);
      if (v.gcd <= 0) {
        v.gcd = isPlane ? 0.06 : 0.09; // the jet's cannons rip faster
        const pitch = isPlane ? clamp(inp.camPitch, -0.7, 0.3) : clamp(inp.camPitch, -1, 0.3);
        fireBullet(v.x + Math.cos(v.yaw) * 3.2, v.y - (isPlane ? 0.2 : 1), v.z + Math.sin(v.yaw) * 3.2, v.yaw, pitch, true, isPlane ? 26 : 18, isPlane ? 0.014 : 0.03);
        ev('sfx', { k: 'shot' });
      }
    } else v.gcd = 0;
    if (armedAir) {
      v.bcd = Math.max(0, (v.bcd || 0) - dt);
      if (inp.bomb && v.bcd <= 0) {
        v.bcd = 0.6;
        S.bombs.push({ x: v.x, y: v.y - 1.2, z: v.z, dx: Math.cos(v.yaw) * v.spd, dz: Math.sin(v.yaw) * v.spd, vy: -1.5, ttl: 9, friendly: true });
        ev('sfx', { k: 'shot' });
      }
    }
  }
  p.x = v.x; p.z = v.z; p.y = v.y;
  if (broken && v.kind === 'car') toast('This vehicle is wrecked — E to bail.', 0.2);
}

// ---------- missions ----------
const MISSIONS = {};
function defMission(id, def) { def.id = id; MISSIONS[id] = def; }
C.MISSIONS = MISSIONS;
function missionDone(id, reward, rep, msg) {
  S.done[id] = (S.done[id] || 0) + 1;
  const mult = S.done[id] > 1 && !MISSIONS[id].repeatable ? 0.5 : 1;
  S.player.money += Math.round(reward * mult);
  S.player.rep += rep;
  ev('passed', { name: MISSIONS[id].name, reward: Math.round(reward * mult), rep, msg: msg || '' });
  ev('sfx', { k: 'win' });
  if (MISSIONS[id].outro) ev('cutscene', { lines: MISSIONS[id].outro });
  S.mission = null;
}
function cutscene(lines) { ev('cutscene', { lines }); }
// script cars: mission-owned vehicles driven along waypoint routes
function driveRoute(c, dt, cruise) {
  const wp = c.route && c.route[c.ri || 0];
  if (!wp) { c.spd -= c.spd * 2 * dt; return true; }
  const d = d2(c.x, c.z, wp.x, wp.z);
  if (d < 10) { c.ri = (c.ri || 0) + 1; return driveRoute(c, dt, cruise); }
  const ta = Math.atan2(wp.z - c.z, wp.x - c.x);
  c.yaw = angLerp(c.yaw, ta, clamp(2.2 * dt, 0, 1));
  c.spd += clamp(cruise - c.spd, -30 * dt, 12 * dt);
  c.x += Math.cos(c.yaw) * c.spd * dt;
  c.z += Math.sin(c.yaw) * c.spd * dt;
  c.y = groundY(c.x, c.z);
  return false;
}
C.driveRoute = driveRoute;
const RP = (i, j) => ({ x: 209 + i * 108, z: 909 + j * 108 }); // city intersection grid
function mkScriptCar(x, z, yaw, cls, route) {
  const c = mkCar(x, z, yaw, 'script', cls);
  c.route = route; c.ri = 0;
  S.cars.push(c);
  return c;
}
function missionFail(msg) { toast('FAILED — ' + msg, 3.5); if (S.mission && S.mission.def.cleanup) S.mission.def.cleanup(); S.mission = null; }
C.missionFail = missionFail;
function startMission(id) {
  const def = MISSIONS[id];
  S.mission = { id, def, phase: 0, t: 0, data: {} };
  if (def.start) def.start(S.mission);
  if (def.intro) ev('cutscene', { lines: def.intro });
  toast(def.name + ': ' + def.brief, 6);
  ev('sfx', { k: 'reload' });
}
C.startMission = startMission;
const unlocked = (id) => {
  const pre = MISSIONS[id].prereq;
  return !pre || !!S.done[pre];
};
C.unlocked = unlocked;

// --- city chain ---
defMission('courier', {
  name: 'COURIER RUN', marker: { x: 853, z: 1233 }, reward: 400, rep: 2,
  brief: 'Package aboard. Cross town to the drop in 90 seconds.',
  start(m) { m.t = 90; m.target = { x: 2582, z: 2745 }; },
  update(m, dt) {
    m.t -= dt;
    if (m.t <= 0) return missionFail('the package expired.');
    if (d2(S.player.x, S.player.z, m.target.x, m.target.z) < 8) missionDone('courier', 400, 2, 'Delivered with ' + Math.ceil(m.t) + 's spare.');
  }
});
defMission('repo', {
  name: 'REPO MAN', marker: { x: 2419, z: 1341 }, prereq: 'courier', reward: 700, rep: 2,
  brief: 'A marked coupe sits across town. Bring it to the garage unwrecked.',
  start(m) {
    m.car = mkCar(640, 2530, Math.PI / 2, 'free', 'sports'); m.car.repo = true;
    S.cars.push(m.car);
    m.target = { x: 2095, z: 2740 };
  },
  cleanup() { const m = S.mission; if (m && m.car) m.car.repo = false; },
  update(m, dt) {
    if (m.car.dead || m.car.hp < 25) return missionFail('you wrecked the merchandise.');
    if (m.phase === 0 && S.player.veh === m.car) { m.phase = 1; toast('Got it. Garage is marked. Keep it clean.', 4); }
    if (m.phase === 1 && S.player.veh === m.car && d2(m.car.x, m.car.z, m.target.x, m.target.z) < 10) {
      m.car.repo = false;
      missionDone('repo', 700, 2, 'Clean pickup.');
    }
  }
});
defMission('getaway', {
  name: 'GETAWAY DRIVER', marker: { x: 907, z: 2854 }, prereq: 'repo', reward: 1000, rep: 3,
  brief: 'He is in. Three stars of heat. Reach the drop.',
  start(m) { addWanted(3); m.target = { x: 2740, z: 1010 }; },
  update(m, dt) {
    if (d2(S.player.x, S.player.z, m.target.x, m.target.z) < 10) {
      S.wanted = 0; S.cops = []; S.footCops = [];
      missionDone('getaway', 1000, 3, 'He vanished into the crowd. Nobody saw anything.');
    }
  }
});
defMission('taxi', {
  name: 'TAXI FARES', marker: { x: 1663, z: 2422 }, prereq: 'getaway', repeatable: true, reward: 0, rep: 0,
  brief: 'Fares waiting, real money. Each drop pays. Leave the stand to quit.',
  start(m) { m.fares = 0; m.next(m); },
  next(m) {
    const spots = [{ x: 853, z: 1666 }, { x: 2311, z: 2854 }, { x: 1447, z: 1017 }, { x: 2740, z: 1990 }, { x: 640, z: 2206 }];
    m.target = spots[(Math.random() * spots.length) | 0];
    m.t = 75;
    toast('Fare ' + (m.fares + 1) + ': take him to the marked corner. ' + Math.round(m.t) + 's.', 4);
  },
  update(m, dt) {
    m.t -= dt;
    if (m.t <= 0) return missionFail('fare bailed out. ' + m.fares + ' fares paid.');
    if (d2(S.player.x, S.player.z, m.target.x, m.target.z) < 9) {
      const pay = 150 + (Math.random() * 150 | 0);
      S.player.money += pay; S.player.rep += 1; m.fares++;
      ev('popup', { msg: '+$' + pay }); ev('sfx', { k: 'cash' });
      S.done.taxi = (S.done.taxi || 0) + 1;
      if (m.fares >= 5) return missionDone('taxi', 500, 2, 'Shift complete: 5 fares.');
      MISSIONS.taxi.next(m);
    }
  }
});
defMission('race', {
  name: 'STREET GP', marker: { x: 1015, z: 2960 }, prereq: 'getaway', repeatable: true, reward: 1200, rep: 2,
  brief: 'Six checkpoints across the city. Beat 95 seconds.',
  start(m) {
    m.cps = [{ x: 1447, z: 2530 }, { x: 2311, z: 2422 }, { x: 2740, z: 1666 }, { x: 1879, z: 1017 }, { x: 961, z: 1341 }, { x: 1015, z: 2960 }];
    m.i = 0; m.t = 0;
  },
  update(m, dt) {
    m.t += dt;
    const cp = m.cps[m.i];
    if (d2(S.player.x, S.player.z, cp.x, cp.z) < 14) {
      m.i++;
      ev('sfx', { k: 'cash' });
      if (m.i >= m.cps.length) {
        if (m.t <= 95) missionDone('race', 1200, 2, 'GP won in ' + m.t.toFixed(1) + 's.');
        else missionFail('finished in ' + m.t.toFixed(1) + 's — too slow, no purse.');
      } else toast('Checkpoint ' + m.i + '/6 — ' + (95 - m.t).toFixed(0) + 's left', 1.5);
    }
    if (m.t > 95 && m.i < m.cps.length) missionFail('time gone.');
  }
});
// --- outfield ops ---
const CAMPS = [{ x: 3350, z: 1100 }, { x: 3800, z: 2800 }, { x: 3550, z: 2000 }];
C.CAMPS = CAMPS;
['op1', 'op2', 'op3'].forEach((id, i) => {
  const need = [8, 12, 16][i], reward = [800, 1500, 2500][i];
  defMission(id, {
    name: ['FIRST CONTACT', 'SUPPLY RAID', 'GHOST PROTOCOL'][i],
    marker: { x: CAMPS[i].x - 90, z: CAMPS[i].z + 10 },
    prereq: i === 0 ? null : 'op' + i, reward, rep: 3 + (i === 2 ? 1 : 0),
    brief: 'Clear ' + need + ' hostiles from the camp. Use the sandbags.',
    start(m) { m.kills = 0; m.spawned = 0; m.need = need; },
    onKill(e) { if (e.gmTag === S.mission.id) S.mission.kills++; },
    cleanup() { S.enemies = S.enemies.filter(e => e.state === 'down'); },
    update(m, dt) {
      const camp = CAMPS[i];
      if (d2(S.player.x, S.player.z, camp.x, camp.z) > 600) return missionFail('you left the fight.');
      const alive = S.enemies.filter(e => e.gmTag === m.id && e.state !== 'down').length;
      if (m.spawned < m.need && alive < 5) {
        const a = Math.random() * TAU, dd = R(40, 80);
        const e = mkSoldier(camp.x + Math.cos(a) * dd, camp.z + Math.sin(a) * dd, i === 2 && m.spawned % 3 === 0);
        e.kind = 'hostile'; e.gmTag = m.id;
        if (d2(e.x, e.z, S.player.x, S.player.z) > 30) { S.enemies.push(e); m.spawned++; }
      }
      if (m.kills >= m.need) missionDone(m.id, reward, MISSIONS[m.id].rep, 'Camp cleared.');
    }
  });
});
// --- sierra guerrilla war ---
['war1', 'war2', 'war3'].forEach((id, i) => {
  const cfg = [{ helis: 3, tanks: 0, inf: 0, reward: 2500 }, { helis: 0, tanks: 2, inf: 5, reward: 4000 }, { helis: 2, tanks: 2, inf: 7, reward: 6000 }][i];
  defMission(id, {
    name: ['STINGER RIDGE', 'CONVOY AMBUSH', 'MOUNTAIN STORM'][i],
    marker: { x: SITES[i].x, z: SITES[i].z },
    prereq: i === 0 ? 'op1' : 'war' + i, reward: cfg.reward, rep: 4 + (i === 2 ? 1 : 0),
    brief: ['Gunships inbound. Lock your AA launcher and drop all three.',
      'Armor column with escort. Rockets kill tanks; rifles do not.',
      'Everything at once. Fight from the treeline.'][i],
    start(m) {
      m.left = cfg.helis + cfg.tanks + cfg.inf;
      const s = SITES[i], p = S.player;
      for (let k = 0; k < cfg.helis; k++) { const h = mkHeli(s.x + R(-300, 300), s.z + R(-300, 300), 'hind', true); h.gmTag = id; S.helis.push(h); }
      for (let k = 0; k < cfg.tanks; k++) { const t = mkTank(s.x + R(-120, 120), s.z + R(-120, 120), true); t.gmTag = id; S.tanks.push(t); }
      for (let k = 0; k < cfg.inf; k++) { const e = mkSoldier(s.x + R(-70, 70), s.z + R(-70, 70)); e.kind = 'hostile'; e.gmTag = id; S.enemies.push(e); }
      // the rebels leave you AA hardware if you have none
      if (!p.weapons.strela && !p.weapons.stinger && (cfg.helis || cfg.tanks)) {
        p.weapons.strela = { mag: 1 }; p.ammo.aa += cfg.helis + cfg.tanks + 2; p.cur = 'strela';
        toast('The rebels left you a Strela-2 and rockets by the crates.', 4);
      } else p.ammo.aa += cfg.helis + cfg.tanks;
      p.ammo.rifle += 90;
    },
    onKill(e) { if (e.gmTag === id) S.mission.left--; },
    onHeliKill(h) { if (h.gmTag === id) S.mission.left--; },
    onTankKill(t) { if (t.gmTag === id) S.mission.left--; },
    cleanup() {
      S.helis = S.helis.filter(h => !h.gmTag);
      S.tanks = S.tanks.filter(t => !t.gmTag || t.dead);
      S.enemies = S.enemies.filter(e => e.gmTag !== id || e.state === 'down');
    },
    update(m, dt) {
      if (S.player.x < SIERRA_X0 - 400) return missionFail('you left the mountains.');
      if (m.left <= 0) missionDone(id, cfg.reward, MISSIONS[id].rep, 'The mountain is quiet again.');
    }
  });
});
// --- Fort Kubra heist ---
defMission('heist', {
  name: 'THE KUBRA JOB', marker: { x: 700, z: 900 }, prereq: 'war2', reward: 12000, rep: 8,
  brief: 'The rebels want a T-80 from Fort Kubra. Steal it, survive, deliver it to Stinger Ridge.',
  start(m) {
    m.phase = 0;
    m.tank = mkTank(500, 500, false); m.tank.heist = true;
    S.tanks.push(m.tank);
    toast('The armor is parked inside the base. The army will not be polite.', 5);
  },
  onTankSteal(tk) { if (tk.heist) { S.mission.phase = 1; toast('DELIVER THE ARMOR: Stinger Ridge, far east. Army inbound.', 5); } },
  cleanup() { S.soldiers = S.soldiers.filter(s2 => s2.state === 'down'); },
  update(m, dt) {
    if (m.tank.dead) return missionFail('the tank is scrap.');
    if (m.phase === 1 && S.player.veh === m.tank && d2(m.tank.x, m.tank.z, SITES[0].x, SITES[0].z) < 60) {
      S.wanted = 0; S.cops = []; S.soldiers = []; S.footCops = [];
      m.tank.owned = true; m.tank.heist = false;
      S.player.owned.vehicles.includes('tank') || S.player.owned.vehicles.push('tank');
      missionDone('heist', 12000, 8, 'The rebels salute. The tank is yours now.');
    }
  }
});
// --- air race ---
defMission('airrace', {
  name: 'CANYON RUN', marker: { x: 1990, z: 3700 }, prereq: 'getaway', repeatable: true, reward: 2000, rep: 2,
  brief: 'Fly through 5 rings ending over the Sierra. Aircraft required. 120 seconds.',
  start(m) {
    m.rings = [{ x: 2600, z: 3400, y: 60 }, { x: 3400, z: 2600, y: 80 }, { x: 4200, z: 2000, y: 90 }, { x: 4900, z: 1500, y: 120 }, { x: 5400, z: 1800, y: 140 }];
    m.i = 0; m.t = 120;
  },
  update(m, dt) {
    m.t -= dt;
    if (m.t <= 0) return missionFail('out of time.');
    const p = S.player;
    if (!p.veh || (p.veh.kind !== 'heli' && p.veh.kind !== 'plane')) {
      if (m.t < 110) return missionFail('no aircraft.');
      return;
    }
    const r = m.rings[m.i];
    if (d2(p.x, p.z, r.x, r.z) < 26 && Math.abs(p.y - r.y) < 22) {
      m.i++; ev('sfx', { k: 'cash' });
      if (m.i >= m.rings.length) missionDone('airrace', 2000, 2, 'Canyon Run beaten with ' + Math.ceil(m.t) + 's left.');
      else toast('Ring ' + m.i + '/5', 1.2);
    }
  }
});

// ================= THE TAILOR — eight-mission story arc =================
// The one man in Blank City who can tell everyone apart. By their clothes.
const TSHOP = { x: 2041, z: 1666 };
defMission('m1', {
  name: 'MEASURED', marker: TSHOP, reward: 1200, rep: 4,
  brief: 'Follow the gray sedan. Not too close. Not too far.',
  intro: [['THE TAILOR', 'Everyone in this city looks the same to you. Not to me. I measured half of them.'],
    ['THE TAILOR', 'A courier in an off-the-rack gray suit is about to drive across town. Follow him. Stay back.'],
    ['THE TAILOR', 'If he stops somewhere interesting, you make sure nothing happens to him. He owes me a fitting.']],
  banner(m) { return m.phase === 0 ? 'TAIL THE SEDAN' + (m.lostT > 2 ? ' — DON\'T LOSE HIM!' : m.susT > 0.5 ? ' — TOO CLOSE!' : '') : m.phase === 1 ? 'PROTECT THE COURIER — ' + m.kills + '/3' : m.phase === 2 ? 'TAKE THE BRIEFCASE' : 'RETURN TO THE TAILOR'; },
  start(m) {
    m.route = [RP(16, 7), RP(16, 10), RP(12, 10), RP(12, 14), RP(8, 14), RP(6, 14)];
    m.car = mkScriptCar(RP(16, 7).x, RP(16, 7).z - 30, Math.PI / 2, 'sedan', m.route);
    m.lostT = 0; m.susT = 0; m.kills = 0; m.spawned = false;
    m.target = { x: m.car.x, z: m.car.z };
  },
  onKill(e) { if (e.gmTag === 'm1') S.mission.kills++; },
  cleanup() { const m = S.mission; if (m && m.car) m.car.dead = true; S.enemies = S.enemies.filter(e => e.gmTag !== 'm1' || e.state === 'down'); if (m && m.courier) m.courier.dead = true; },
  update(m, dt) {
    const p = S.player;
    if (m.phase === 0) {
      const arrived = driveRoute(m.car, dt, 13);
      m.target = { x: m.car.x, z: m.car.z };
      const d = d2(p.x, p.z, m.car.x, m.car.z);
      if (!arrived) {
        if (d > 120) { m.lostT += dt; if (m.lostT > 6) return missionFail('you lost the sedan.'); } else m.lostT = 0;
        if (d < 20) { m.susT += dt; if (m.susT > 2.5) return missionFail('he spotted you and bolted.'); } else m.susT = Math.max(0, m.susT - dt);
      } else {
        m.phase = 1;
        m.courier = mkPed(m.car.x + 3, m.car.z + 2); m.courier.state = 'script'; S.peds.push(m.courier);
        for (let k = 0; k < 3; k++) {
          const a = k / 3 * TAU;
          const e = mkSoldier(m.car.x + Math.cos(a) * 45, m.car.z + Math.sin(a) * 45);
          e.kind = 'hostile'; e.gmTag = 'm1'; S.enemies.push(e);
        }
        m.doorT = 0;
        toast('AMBUSH! Keep them off the courier!', 4);
        ev('sfx', { k: 'crash' });
      }
    } else if (m.phase === 1) {
      for (const e of S.enemies) {
        if (e.gmTag !== 'm1' || e.state === 'down') continue;
        e.cx = m.courier.x; e.cz = m.courier.z; e.moveT = 1;
        if (d2(e.x, e.z, m.courier.x, m.courier.z) < 4) { m.doorT += dt; if (m.doorT > 5) return missionFail('the courier is gone. The Tailor will not be pleased.'); }
      }
      if (m.kills >= 3) { m.phase = 2; m.target = { x: m.car.x, z: m.car.z }; toast('Grab the briefcase from the sedan.', 3); }
    } else if (m.phase === 2) {
      if (d2(p.x, p.z, m.car.x, m.car.z) < 5) { m.phase = 3; m.target = TSHOP; toast('Bring it back to the shop.', 3); ev('sfx', { k: 'cash' }); }
    } else if (d2(p.x, p.z, TSHOP.x, TSHOP.z) < 7) {
      if (m.courier) m.courier.dead = true;
      missionDone('m1', 1200, 4, 'The courier lives. The briefcase talks.');
    }
  },
  outro: [['THE TAILOR', 'Three men in identical cheap jackets. Amateurs. You can tell everything from a hem.'],
    ['THE TAILOR', 'Someone is hunting my clients. Come back when you are ready to pull a thread.']]
});
defMission('m2', {
  name: 'ALTERATIONS', marker: TSHOP, prereq: 'm1', reward: 1800, rep: 4,
  brief: 'Plant a tracker. Then pull it in — hard.',
  intro: [['THE TAILOR', 'The jackets came from a warehouse crew run by a man they call Herringbone.'],
    ['THE TAILOR', 'His driver parks by MONO MART. Put this under the wheel arch. Do not be seen — no stars.'],
    ['THE TAILOR', 'When he runs — and he will run — you stop that car by any means you like.']],
  banner(m) { return m.phase === 0 ? (m.plantT > 0 ? 'PLANTING… ' + Math.ceil(3 - m.plantT) : 'PLANT THE TRACKER (stand by the car, stay clean)') : m.phase === 1 ? 'RAM THE CAR — ' + Math.max(0, Math.ceil(m.car.hp)) + '%' : 'SUBDUE THE DRIVER'; },
  start(m) {
    m.car = mkScriptCar(1717, 2314, 0, 'muscle', null);
    m.car.hp = 260;
    m.plantT = 0;
    m.target = { x: 1717, z: 2314 };
  },
  cleanup() { const m = S.mission; if (m && m.car) m.car.dead = true; if (m && m.driver) m.driver.dead = true; },
  update(m, dt) {
    const p = S.player;
    if (m.phase === 0) {
      if (S.wanted > 0) return missionFail('too much heat — he made you.');
      if (!p.veh && d2(p.x, p.z, m.car.x, m.car.z) < 5) {
        m.plantT += dt;
        if (m.plantT >= 3) {
          m.phase = 1;
          m.car.route = [RP(14, 13), RP(14, 9), RP(10, 9), RP(10, 5), RP(5, 5)]; m.car.ri = 0;
          toast('Tracker on. He is MOVING. Wreck that car!', 4);
          ev('sfx', { k: 'lock' });
        }
      } else m.plantT = 0;
    } else if (m.phase === 1) {
      const done2 = driveRoute(m.car, dt, 17);
      m.target = { x: m.car.x, z: m.car.z };
      if (p.veh && d2(p.veh.x, p.veh.z, m.car.x, m.car.z) < 7 && Math.abs(p.veh.spd) > 8) { m.car.hp -= Math.abs(p.veh.spd) * 1.4 * dt * 8; ev('shake', { n: 2 }); }
      if (m.car.hp <= 80) {
        m.phase = 2;
        m.car.route = null;
        m.driver = mkPed(m.car.x + 2, m.car.z + 2); m.driver.state = 'flee'; m.driver.t = 99; m.driver.hp = 80; S.peds.push(m.driver);
        toast('He bailed! Run him down and put him on the pavement.', 4);
      } else if (done2) return missionFail('he reached the warehouse. Tracker gone.');
    } else {
      m.target = { x: m.driver.x, z: m.driver.z };
      if (m.driver.state === 'down') missionDone('m2', 1800, 4, 'He talked before he napped: the warehouse is at the airport.');
    }
  },
  outro: [['DRIVER', 'Okay! OKAY. Herringbone runs it out of the airport hangars. Nobody sees his face. Nobody sees ANYBODY\'S face!'],
    ['THE TAILOR', 'Mm. And yet his trousers break at the ankle. A monster.']]
});
defMission('m3', {
  name: 'DRY CLEANING', marker: TSHOP, prereq: 'm2', reward: 2200, rep: 4,
  brief: 'Three dirty packages. One clean tunnel. The law is already watching.',
  intro: [['THE TAILOR', 'Herringbone left three parcels with people who should not have them. Evidence, of a kind.'],
    ['THE TAILOR', 'The police are sniffing all three. You will be quicker. Collect them and go underground. Literally.']],
  banner(m) { return m.got < 3 ? 'PACKAGES ' + m.got + '/3 — ' + Math.ceil(m.t) + 's' : 'GET TO THE TUNNEL — ' + Math.ceil(m.t) + 's'; },
  start(m) {
    m.pts = [RP(2, 2), RP(22, 4), RP(12, 18)].map(q => ({ x: q.x, z: q.z, got: false }));
    m.got = 0; m.t = 170;
    m.target = m.pts[0];
  },
  update(m, dt) {
    const p = S.player;
    m.t -= dt;
    S.wanted = Math.max(S.wanted, 2); S.evadeT = 0;
    if (m.t <= 0) return missionFail('the parcels walked off.');
    for (const q of m.pts) if (!q.got && d2(p.x, p.z, q.x, q.z) < 6) { q.got = true; m.got++; ev('sfx', { k: 'cash' }); ev('popup', { msg: 'PACKAGE ' + m.got + '/3' }); }
    const next = m.pts.find(q => !q.got);
    m.target = next || { x: 1300, z: 1989 };
    if (m.got >= 3 && C.inTunnel(p.x, p.z)) {
      S.wanted = 0; S.cops = [];
      missionDone('m3', 2200, 4, 'Handed off in the dark. Nobody followed.');
    }
  },
  outro: [['THE TAILOR', 'Receipts, ledgers, and one photograph of a man whose suit I would not bury someone in.'],
    ['THE TAILOR', 'They know I have them now. Which means we should expect... customers.']]
});
defMission('m4', {
  name: 'THE FITTING', marker: TSHOP, prereq: 'm3', reward: 2600, rep: 5,
  brief: 'Herringbone sends hitmen. Hold the shop.',
  intro: [['THE TAILOR', 'Twelve appointments, none of them booked. They want the parcels back.'],
    ['THE TAILOR', 'I will be in the back, pressing a suit. Do not let anyone reach my door.']],
  banner(m) { return 'DEFEND THE SHOP — ' + m.kills + '/12' + (m.doorT > 4 ? '  THEY\'RE AT THE DOOR!' : ''); },
  start(m) {
    m.kills = 0; m.spawned = 0; m.doorT = 0; m.waveT = 0;
    const p = S.player;
    p.armor = 100; p.ammo.rifle += 90;
    m.target = TSHOP;
  },
  onKill(e) { if (e.gmTag === 'm4') S.mission.kills++; },
  cleanup() { S.enemies = S.enemies.filter(e => e.gmTag !== 'm4' || e.state === 'down'); },
  update(m, dt) {
    m.waveT -= dt;
    const alive = S.enemies.filter(e => e.gmTag === 'm4' && e.state !== 'down').length;
    if (m.spawned < 12 && alive < 4 && m.waveT <= 0) {
      m.waveT = 2;
      const a = Math.random() * TAU, d = R(70, 100);
      const e = mkSoldier(TSHOP.x + Math.cos(a) * d, TSHOP.z + Math.sin(a) * d, m.spawned >= 8);
      e.kind = 'hostile'; e.gmTag = 'm4'; S.enemies.push(e);
      m.spawned++;
    }
    let atDoor = false;
    for (const e of S.enemies) {
      if (e.gmTag !== 'm4' || e.state === 'down') continue;
      e.cx = TSHOP.x; e.cz = TSHOP.z; e.moveT = 1;
      if (d2(e.x, e.z, TSHOP.x, TSHOP.z) < 9) atDoor = true;
    }
    m.doorT = atDoor ? m.doorT + dt : Math.max(0, m.doorT - dt);
    if (m.doorT > 8) return missionFail('they got inside. The Tailor is gone.');
    if (m.kills >= 12) missionDone('m4', 2600, 5, 'Twelve alterations, all final.');
  },
  outro: [['THE TAILOR', 'Look at them. Squares, all of them. Herringbone buys in bulk.'],
    ['THE TAILOR', 'My informant knows where the money sleeps. Keep him breathing tomorrow.']]
});
defMission('m5', {
  name: 'LOOSE THREADS', marker: TSHOP, prereq: 'm4', reward: 3000, rep: 5,
  brief: 'Overwatch. The informant walks. You make sure he keeps walking.',
  intro: [['THE TAILOR', 'My man will take a stroll and be seen. Bait, in a decent overcoat.'],
    ['THE TAILOR', 'Herringbone\'s people will come for him on foot. You will be somewhere high-minded with a rifle.'],
    ['THE TAILOR', 'Six of them, by my count. Do not let one touch that overcoat.']],
  banner(m) { return 'PROTECT THE INFORMANT — ' + m.kills + '/6 DOWN'; },
  start(m) {
    const p = S.player;
    if (!p.weapons.m24 && !p.weapons.svd) { p.weapons.m24 = { mag: 5 }; toast('The Tailor left an M24 in the alley.', 3); }
    p.ammo.sniper += 20;
    m.walker = mkPed(TSHOP.x + 5, TSHOP.z); m.walker.state = 'script'; S.peds.push(m.walker);
    m.A = { x: TSHOP.x, z: TSHOP.z }; m.B = RP(17, 7);
    m.leg = 0; m.kills = 0; m.spawned = 0; m.spawnT = 2;
  },
  onKill(e) { if (e.gmTag === 'm5') S.mission.kills++; },
  cleanup() { const m = S.mission; if (m && m.walker) m.walker.dead = true; S.enemies = S.enemies.filter(e => e.gmTag !== 'm5' || e.state === 'down'); },
  update(m, dt) {
    const w = m.walker;
    const dst = m.leg % 2 === 0 ? m.B : m.A;
    const dd = d2(w.x, w.z, dst.x, dst.z);
    if (dd > 3) {
      const a = Math.atan2(dst.z - w.z, dst.x - w.x);
      w.x += Math.cos(a) * 1.7 * dt; w.z += Math.sin(a) * 1.7 * dt; w.yaw = a; w.phase += 3 * dt;
    } else m.leg++;
    m.target = { x: w.x, z: w.z };
    m.spawnT -= dt;
    if (m.spawned < 6 && m.spawnT <= 0) {
      m.spawnT = 8;
      const a = Math.random() * TAU;
      const e = mkSoldier(w.x + Math.cos(a) * R(80, 110), w.z + Math.sin(a) * R(80, 110));
      e.kind = 'hostile'; e.gmTag = 'm5'; S.enemies.push(e);
      m.spawned++;
      ev('popup', { msg: 'ASSASSIN INBOUND' });
    }
    for (const e of S.enemies) {
      if (e.gmTag !== 'm5' || e.state === 'down') continue;
      e.cx = w.x; e.cz = w.z; e.moveT = 1;
      if (d2(e.x, e.z, w.x, w.z) < 4) return missionFail('the overcoat has a hole in it now.');
    }
    if (m.kills >= 6) missionDone('m5', 3000, 5, 'Six tailors\' dummies, none of them mine.');
  },
  outro: [['INFORMANT', 'The money rides Thursdays. Armored car, police escort, straight through town. Herringbone\'s pension.'],
    ['THE TAILOR', 'Then Thursday you become a bank.']]
});
defMission('m6', {
  name: 'OFF THE RACK', marker: TSHOP, prereq: 'm5', reward: 4500, rep: 6,
  brief: 'Hijack the armored car out from under its escort.',
  intro: [['THE TAILOR', 'An APC full of Herringbone\'s laundered cash, dressed as police work.'],
    ['THE TAILOR', 'Break the escort, stop the box, and drive it to Prestige Motors. They owe me a favor and a paint booth.']],
  banner(m) { return m.phase === 0 ? 'STOP THE APC — ARMOR ' + Math.max(0, Math.ceil(m.apc.hp / 6)) + '%' : 'DELIVER THE APC TO PRESTIGE MOTORS'; },
  start(m) {
    const route = [RP(2, 16), RP(2, 8), RP(8, 8), RP(8, 4), RP(16, 4), RP(24, 4)];
    m.apc = mkScriptCar(route[0].x, route[0].z, 0, 'apc', route.slice(1));
    m.apc.hp = 600;
    m.esc = [0, 1].map(k => {
      const c2 = mkScriptCar(route[0].x, route[0].z + (k ? 14 : -14), 0, 'cop', route.slice(1).map(q => ({ x: q.x, z: q.z + (k ? 14 : -14) })));
      c2.hp = 120;
      return c2;
    });
    S.wanted = Math.max(S.wanted, 3);
    m.target = { x: m.apc.x, z: m.apc.z };
  },
  cleanup() { const m = S.mission; if (m) { if (m.apc && S.player.veh !== m.apc) m.apc.dead = true; for (const e2 of m.esc || []) e2.dead = true; } },
  update(m, dt) {
    const p = S.player;
    S.evadeT = 0;
    for (const e2 of m.esc) {
      if (e2.dead) continue;
      if (e2.hp <= 0) { e2.dead = true; explode(e2.x, e2.y + 1, e2.z, 7, 50); continue; }
      driveRoute(e2, dt, 15);
    }
    if (m.phase === 0) {
      const escaped = driveRoute(m.apc, dt, 14);
      m.target = { x: m.apc.x, z: m.apc.z };
      if (p.veh && d2(p.veh.x, p.veh.z, m.apc.x, m.apc.z) < 8 && Math.abs(p.veh.spd) > 8) m.apc.hp -= Math.abs(p.veh.spd) * 1.2 * dt * 8;
      if (m.apc.hp <= 250) { m.apc.route = null; m.phase = 0.5; toast('The APC is stalled — jack it (E)!', 4); }
      if (escaped) return missionFail('the convoy made it through.');
    }
    if (m.phase === 0.5 && p.veh === m.apc) { m.phase = 1; m.target = { x: 2419, z: 2530 }; toast('It drives like a safe. Prestige Motors. Go.', 3); }
    if (m.phase === 1) {
      if (m.apc.hp <= 30) return missionFail('the armored car is scrap. So is the plan.');
      if (p.veh === m.apc && d2(m.apc.x, m.apc.z, 2419, 2530) < 12) {
        S.wanted = 0; S.cops = [];
        if (!S.player.owned.vehicles.includes('apc')) S.player.owned.vehicles.push('apc');
        m.apc.owned = true; m.apc.type = 'free';
        missionDone('m6', 4500, 6, 'One armored car, resprayed. It is yours now.');
      }
    }
  },
  outro: [['THE TAILOR', 'Herringbone\'s pension fund, in a box with wheels. He will come out of his hangar for this.'],
    ['THE TAILOR', 'Good. I have wanted to measure him for a long, long time.']]
});
defMission('m7', {
  name: 'BESPOKE', marker: { x: 2575, z: 3450 }, prereq: 'm6', reward: 6000, rep: 7,
  brief: 'Raid the hangar. Take the ledger. Leave by air.',
  intro: [['THE TAILOR', 'The warehouse crew is at the hangars, guarding a ledger with every name Herringbone owns.'],
    ['THE TAILOR', 'Eight guards. One book. And a borrowed helicopter on the runway when it gets loud.'],
    ['THE TAILOR', 'Take the ledger to my cabin in the Sierra. Fly carefully. Or do not — it is insured.']],
  banner(m) { return m.phase === 0 ? 'CLEAR THE HANGARS — ' + m.kills + '/8' : m.phase === 1 ? 'TAKE THE LEDGER' : 'FLY THE LEDGER TO THE SIERRA CABIN'; },
  start(m) {
    m.kills = 0;
    for (let k = 0; k < 8; k++) {
      const e = mkSoldier(2500 + R(0, 350), 3300 + R(0, 120), k % 3 === 0);
      e.kind = 'hostile'; e.gmTag = 'm7'; S.enemies.push(e);
    }
    m.heli = mkHeli(2150, 3620);
    S.helis.push(m.heli);
    m.target = { x: 2675, z: 3360 };
    S.player.ammo.rifle += 60;
  },
  onKill(e) { if (e.gmTag === 'm7') S.mission.kills++; },
  cleanup() { S.enemies = S.enemies.filter(e => e.gmTag !== 'm7' || e.state === 'down'); const m = S.mission; if (m && m.heli && S.player.veh !== m.heli) m.heli.dead = true; },
  update(m, dt) {
    const p = S.player;
    if (m.phase === 0 && m.kills >= 8) { m.phase = 1; m.target = { x: 2675, z: 3360 }; toast('Hangars clear. The ledger is inside.', 3); }
    else if (m.phase === 1 && !p.veh && d2(p.x, p.z, 2675, 3360) < 6) { m.phase = 2; m.target = { x: 4820, z: 1060 }; toast('Ledger secured. Get airborne — Sierra cabin.', 4); ev('sfx', { k: 'cash' }); }
    else if (m.phase === 2) {
      const inAir = p.veh && (p.veh.kind === 'heli' || p.veh.kind === 'plane');
      if (inAir) m.flew = true;
      if (d2(p.x, p.z, 4820, 1060) < 40 && m.flew && (!p.veh || p.veh.y < C.groundY(p.veh.x, p.veh.z) + 5)) {
        missionDone('m7', 6000, 7, 'Every name in the book. Including one that surprised even the Tailor.');
      }
    }
  },
  outro: [['THE TAILOR', 'This ledger says Herringbone commissioned a suit. My cut. My cloth. My label.'],
    ['THE TAILOR', 'Somewhere out there is a man wearing my work, doing THIS with it. That ends tomorrow.']]
});
defMission('m8', {
  name: 'FINAL CUT', marker: TSHOP, prereq: 'm7', reward: 10000, rep: 10,
  brief: 'Herringbone runs for the mountains in a gunship. Cut the thread.',
  intro: [['THE TAILOR', 'He is leaving. Gunship, escort, headed for the Sierra with everything he can carry.'],
    ['THE TAILOR', 'In a city with no faces, a man is only his clothes. He is wearing MY clothes.'],
    ['THE TAILOR', 'Bring me back my suit. The man inside it is optional.']],
  banner(m) { return m.phase === 0 ? 'SHOOT DOWN HERRINGBONE\'S GUNSHIP' : 'FINISH HIS CREW — ' + m.kills + '/4'; },
  start(m) {
    const p = S.player;
    if (!p.weapons.stinger && !p.weapons.strela) p.weapons.strela = { mag: 1 };
    p.ammo.aa += 6;
    m.boss = mkHeli(2100, 1600, 'hind', true);
    m.boss.hp = 520; m.boss.gmTag = 'm8boss';
    m.boss.fleeRoute = [{ x: 3000, z: 1700 }, { x: 3800, z: 1900 }, { x: 4500, z: 1900 }, { x: 5000, z: 1500 }, { x: 4830, z: 1010 }];
    const esc2 = mkHeli(2050, 1650, 'hind', true);
    esc2.hp = 260; esc2.gmTag = 'm8esc';
    esc2.fleeRoute = m.boss.fleeRoute.map(q => ({ x: q.x, z: q.z + 60 }));
    S.helis.push(m.boss, esc2);
    m.kills = 0;
  },
  onHeliKill(h) { if (h.gmTag === 'm8boss') { S.mission.phase = 1; toast('He is DOWN. His crew is scattering at the ridge — none of them walk away.', 5); for (let k = 0; k < 4; k++) { const e = mkSoldier(4800 + R(-40, 40), 1000 + R(-40, 40), k === 0); e.kind = 'hostile'; e.gmTag = 'm8'; S.enemies.push(e); } } },
  onKill(e) { if (e.gmTag === 'm8') S.mission.kills++; },
  cleanup() { S.helis = S.helis.filter(h => !h.gmTag || h.dead); S.enemies = S.enemies.filter(e => e.gmTag !== 'm8' || e.state === 'down'); },
  update(m, dt) {
    if (m.phase === 0) {
      m.target = { x: m.boss.x, z: m.boss.z };
      if (m.boss.escaped > 18) return missionFail('the gunship slipped over the ridge.');
    } else {
      m.target = { x: 4800, z: 1000 };
      if (m.kills >= 4) {
        missionDone('m8', 10000, 10, 'The suit came back folded. The story is over — the city is yours.');
        toast('THE TAILOR\'S CUT unlocked at Threads & Co.', 6);
      }
    }
  },
  outro: [['THE TAILOR', 'A perfect fit, even now. I will sponge the smoke out of it.'],
    ['THE TAILOR', 'You know the strangest part? Under all of it — he looked exactly like everyone else.'],
    ['THE TAILOR', 'Come by the shop. I made you something. On the house.']]
});


// ================= THE CAPTAIN — crooked cop chain (4 missions) =================
const PRECINCT = { x: 1231, z: 2854 };
defMission('cop1', {
  name: 'PROFESSIONAL COURTESY', marker: PRECINCT, prereq: 'getaway', reward: 1500, rep: 3,
  brief: 'A cruiser is hauling evidence to the courthouse. It never arrives.',
  intro: [['THE CAPTAIN', 'I run a clean precinct. Clean, because I decide what stays in the evidence room.'],
    ['THE CAPTAIN', 'A cruiser is moving a box that has my name in it. Stop that car. Torch it if you have to.'],
    ['THE CAPTAIN', 'And do try not to make it look like exactly what it is.']],
  banner(m) { return m.phase === 0 ? 'INTERCEPT THE EVIDENCE CRUISER — ' + Math.max(0, Math.ceil(m.car.hp / 1.2)) + '%' : 'GET CLEAR — LOSE THE HEAT'; },
  start(m) {
    const route = [RP(6, 18), RP(6, 12), RP(12, 12), RP(12, 6), RP(20, 6)];
    m.car = mkScriptCar(route[0].x, route[0].z, 0, 'cop', route.slice(1));
    m.car.hp = 130;
    m.target = { x: m.car.x, z: m.car.z };
  },
  cleanup() { const m = S.mission; if (m && m.car) m.car.dead = true; },
  update(m, dt) {
    const p = S.player;
    if (m.phase === 0) {
      const escaped = driveRoute(m.car, dt, 16);
      m.target = { x: m.car.x, z: m.car.z };
      if (p.veh && d2(p.veh.x, p.veh.z, m.car.x, m.car.z) < 7 && Math.abs(p.veh.spd) > 8) { m.car.hp -= Math.abs(p.veh.spd) * 1.3 * dt * 8; ev('shake', { n: 2 }); }
      if (m.car.hp <= 0) { m.car.dead = true; explode(m.car.x, m.car.y + 1, m.car.z, 8, 40); m.phase = 1; S.wanted = Math.max(S.wanted, 3); toast('Evidence gone. Now the whole precinct wants you. Lose them.', 4); }
      else if (escaped) return missionFail('the cruiser reached the courthouse.');
    } else {
      m.target = null;
      if (S.wanted === 0) missionDone('cop1', 1500, 3, 'No car, no box, no problem.');
    }
  },
  outro: [['THE CAPTAIN', 'See? A tragic traffic accident. Happens every day in this city.'],
    ['THE CAPTAIN', 'There is a witness who thinks he saw something. Fix his memory tomorrow.']]
});
defMission('cop2', {
  name: 'WITNESS PROTECTION', marker: PRECINCT, prereq: 'cop1', reward: 1800, rep: 3,
  brief: 'Scare the witness out of town. Do NOT kill him — a body is paperwork.',
  intro: [['THE CAPTAIN', 'The witness lives above the supermarket. Nervous type. Give him a reason to leave the state.'],
    ['THE CAPTAIN', 'Chase him to the edge of town. On foot, in a car, I do not care. But he walks away alive.'],
    ['THE CAPTAIN', 'A dead witness is a murder. A frightened one is just... gone.']],
  banner(m) { return m.phase === 0 ? 'FIND THE WITNESS AT MONO MART' : 'HERD HIM TO THE CITY EDGE (keep him alive!)'; },
  start(m) {
    m.wit = mkPed(1663, 2360); m.wit.state = 'script'; m.wit.hp = 100; S.peds.push(m.wit);
    m.target = { x: 1663, z: 2360 };
    m.flee = { x: 2740, z: 2960 };
  },
  cleanup() { const m = S.mission; if (m && m.wit) m.wit.dead = true; },
  update(m, dt) {
    const p = S.player;
    const w = m.wit;
    if (w.state === 'down' || w.hp <= 0) return missionFail('you killed him. The Captain wanted him scared, not silent.');
    if (m.phase === 0) {
      if (d2(p.x, p.z, w.x, w.z) < 12) { m.phase = 1; w.state = 'flee'; w.t = 999; toast('He runs! Chase him east — do not shoot!', 4); ev('sfx', { k: 'crash' }); }
    } else {
      // he flees away from the player, toward the edge
      const away = Math.atan2(w.z - p.z, w.x - p.x);
      const toEdge = Math.atan2(m.flee.z - w.z, m.flee.x - w.x);
      w.yaw = angLerp(away, toEdge, 0.4);
      const sp = d2(p.x, p.z, w.x, w.z) < 40 ? 6.5 : 3;
      const nx = w.x + Math.cos(w.yaw) * sp * dt, nz = w.z + Math.sin(w.yaw) * sp * dt;
      if (!solidAt(nx, w.y + 1, nz)) { w.x = nx; w.z = nz; }
      w.y = groundY(w.x, w.z); w.phase += sp * dt * 2;
      m.target = { x: w.x, z: w.z };
      if (d2(w.x, w.z, m.flee.x, m.flee.z) < 25) { w.dead = true; missionDone('cop2', 1800, 3, 'He is on a bus and never coming back.'); }
    }
  },
  outro: [['THE CAPTAIN', 'Good. Quiet. I like quiet.'],
    ['THE CAPTAIN', 'The businesses on my streets are behind on their gratitude. Collection day is tomorrow.']]
});
defMission('cop3', {
  name: 'COLLECTION DAY', marker: PRECINCT, prereq: 'cop2', reward: 2000, rep: 3,
  brief: 'Four businesses. One afternoon. Cash only.',
  intro: [['THE CAPTAIN', 'Four establishments enjoy my protection. Today they pay for it.'],
    ['THE CAPTAIN', 'Visit all four before the shift changes. Some owners forget their manners — remind them.']],
  banner(m) { return 'SHAKEDOWNS ' + m.got + '/4 — ' + Math.ceil(m.t) + 's'; },
  start(m) {
    m.spots = [{ x: 1231, z: 1450 }, { x: 1663, z: 2314 }, { x: 2041, z: 1666 }, { x: 2419, z: 2530 }].map(q => ({ x: q.x, z: q.z, got: false }));
    m.got = 0; m.t = 150;
    m.target = m.spots[0];
  },
  update(m, dt) {
    const p = S.player;
    m.t -= dt;
    if (m.t <= 0) return missionFail('shift changed. The Captain hates loose ends.');
    for (const q of m.spots) if (!q.got && d2(p.x, p.z, q.x, q.z) < 7) {
      q.got = true; m.got++;
      const take = 200 + (Math.random() * 200 | 0);
      p.money += take; ev('popup', { msg: 'COLLECTED +$' + take }); ev('sfx', { k: 'cash' });
    }
    const next = m.spots.find(q => !q.got);
    m.target = next || PRECINCT;
    if (m.got >= 4) missionDone('cop3', 2000, 3, 'Everyone paid. The Captain gets his cut. You get yours.');
  },
  outro: [['THE CAPTAIN', 'You have been very useful. Almost too useful.'],
    ['THE CAPTAIN', 'Which is a problem. You know where the bodies are parked. Nothing personal.']]
});
defMission('cop4', {
  name: 'INTERNAL AFFAIRS', marker: PRECINCT, prereq: 'cop3', reward: 5000, rep: 6,
  brief: "The Captain sets you up. Six units and a chopper. Reach the safehouse alive.",
  intro: [['THE CAPTAIN', 'You walked into my precinct like you belonged. That was the mistake.'],
    ['THE CAPTAIN', 'Every unit in the city has your description. Well — your outfit. It is all anyone has here.'],
    ['THE CAPTAIN', 'Run. It is more fun when they run.']],
  banner(m) { return 'ESCAPE THE SETUP — REACH THE SAFEHOUSE'; },
  start(m) {
    S.wanted = 5; S.evadeT = 0;
    const h = mkHeli(PRECINCT.x + 100, PRECINCT.z + 100, 'hind', true); h.copHeli = true; S.helis.push(h);
    m.safe = { x: 907, z: 2746 };  // Eastside Apartment
    m.target = m.safe;
    S.player.armor = 100;
  },
  update(m, dt) {
    const p = S.player;
    S.wanted = Math.max(S.wanted, 4); S.evadeT = 0;   // can't just wait it out
    if (d2(p.x, p.z, m.safe.x, m.safe.z) < 8) {
      S.wanted = 0; S.cops = []; S.footCops = []; S.helis = S.helis.filter(h => !h.copHeli);
      missionDone('cop4', 5000, 6, 'Safehouse. The Captain will keep. Everyone in this city does.');
    }
  },
  outro: [['THE CAPTAIN', '(radio) ...he reached the safehouse. Of course he did.'],
    ['THE CAPTAIN', '(radio) Pull everyone back. We will settle up another day. In this city, we always meet again.']]
});

// ================= CONTRACTS — repeatable assassination board =================
const CONTRACT_BOARD = { x: 4800, z: 950 };   // the black market, Sierra
const HIT_SPOTS = [
  { x: 1447, z: 1017 }, { x: 2311, z: 2854 }, { x: 853, z: 1666 }, { x: 2740, z: 1990 },
  { x: 1015, z: 2960 }, { x: 2575, z: 1450 }, { x: 640, z: 2206 }, { x: 1879, z: 2530 }
];
defMission('contract', {
  name: 'CONTRACT', marker: CONTRACT_BOARD, prereq: 'getaway', repeatable: true, reward: 0, rep: 0,
  brief: 'A name, a place, and a fee. Silence pays double.',
  intro: [['THE BROKER', 'In a city of identical men, a contract is just a set of coordinates and a suit description.'],
    ['THE BROKER', 'The mark is in town, with company. Do it quiet and the bonus is yours. Do it loud... it still counts.']],
  banner(m) { return m.phase === 0 ? 'REACH THE MARK' + (m.done ? '' : '') : 'ELIMINATE THE MARK — ' + (m.silent ? 'STAYING QUIET (2x)' : 'LOUD') + (m.guards ? ' — GUARDS ' + m.guards : ''); },
  start(m) {
    const n = (S.done.contract || 0);
    m.spot = HIT_SPOTS[(Math.random() * HIT_SPOTS.length) | 0];
    m.pay = 1500 + n * 400;
    m.phase = 0; m.spawned = false; m.silent = true; m.guards = 0;
    m.target = m.spot;
    toast('CONTRACT: mark waiting ' + (n + 1) + '. Reach the marker.', 4);
  },
  cleanup() { S.enemies = S.enemies.filter(e => e.gmTag !== 'contract' || e.state === 'down'); if (S.mission && S.mission.mark) S.mission.mark.dead = true; },
  onKill(e) {
    const m = S.mission;
    if (e === m.mark) { m.killed = true; }
    else if (e.gmTag === 'contract') m.guards = Math.max(0, m.guards - 1);
  },
  update(m, dt) {
    const p = S.player;
    if (m.phase === 0) {
      if (d2(p.x, p.z, m.spot.x, m.spot.z) < 40) {
        m.phase = 1;
        m.mark = mkSoldier(m.spot.x, m.spot.z, true);
        m.mark.kind = 'hostile'; m.mark.gmTag = 'contractmark'; m.mark.hp = 120;
        S.enemies.push(m.mark);
        for (let k = 0; k < 2; k++) {
          const a = k / 2 * TAU;
          const g = mkSoldier(m.spot.x + Math.cos(a) * 12, m.spot.z + Math.sin(a) * 12);
          g.kind = 'hostile'; g.gmTag = 'contract'; S.enemies.push(g); m.guards++;
        }
        toast('There he is. The one in the pinstripe. Take the shot.', 4);
      }
    } else {
      if (S.wanted > 0) m.silent = false;
      m.target = m.mark && m.mark.state !== 'down' ? { x: m.mark.x, z: m.mark.z } : null;
      if (m.mark && m.mark.state === 'down') {
        const pay = m.silent ? m.pay * 2 : m.pay;
        S.enemies = S.enemies.filter(e => e.gmTag !== 'contract' || e.state === 'down');
        missionDone('contract', pay, 3, m.silent ? 'Clean. Nobody even looked up. Double fee.' : 'Messy, but done.');
      }
    }
  },
  outro: [['THE BROKER', 'Another name off the list. There is always another name.']]
});

// ---------- ambient spawning ----------
function spawnAmbient() {
  const p = S.player;
  const inTown = inCity(p.x, p.z);
  if (inTown) {
    const near = S.peds.filter(pd => d2(pd.x, pd.z, p.x, p.z) < 260);
    if (near.length < 16 && S.peds.length < 30) {
      const a = Math.random() * TAU, dd = R(90, 220);
      const x = p.x + Math.cos(a) * dd, z = p.z + Math.sin(a) * dd;
      if (inCity(x, z) && !solidAt(x, 1, z)) S.peds.push(mkPed(x, z));
    }
    const traffic = S.cars.filter(c => c.type === 'traffic');
    if (traffic.length < 9) {
      const a = Math.random() * TAU, dd = R(120, 280);
      const x = p.x + Math.cos(a) * dd, z = p.z + Math.sin(a) * dd;
      const L = laneFor(x, z);
      if (L && inCity(x, z)) {
        const c = mkCar(L.dx !== 0 ? x : L.lane, L.dx !== 0 ? L.lane : z, Math.atan2(L.dz, L.dx), 'traffic');
        c.dirx = L.dx; c.dirz = L.dz; c.lane = L.lane;
        if (!S.cars.some(o => d2(o.x, o.z, c.x, c.z) < 20)) S.cars.push(c);
      }
    }
  }
  S.peds = S.peds.filter(pd => !pd.dead && d2(pd.x, pd.z, p.x, p.z) < 420);
  S.cars = S.cars.filter(c => !c.dead && (c.owned || c.repo || c.type === 'script' || c === p.veh || c.type === 'free' || d2(c.x, c.z, p.x, p.z) < 500));
  // cops
  const hidden = C.inTunnel(p.x, p.z);
  if (S.wanted > 0 && !hidden) {
    while (S.cops.length < S.wanted) {
      const a = Math.random() * TAU, dd = R(150, 260);
      const x = p.x + Math.cos(a) * dd, z = p.z + Math.sin(a) * dd;
      if (isCityRoad(x, z) || !inCity(x, z)) S.cops.push(mkCar(clamp(x, 100, W - 100), clamp(z, 100, D - 100), 0, 'cop'));
      else break;
    }
    if (S.wanted >= 4 && !S.helis.some(h => h.copHeli)) {
      const h = mkHeli(p.x + 200, p.z + 200, 'hind', true); h.copHeli = true; S.helis.push(h);
    }
  }
  if (S.wanted === 0) { S.cops = []; S.footCops = S.footCops.filter(f => f.state === 'down'); S.helis = S.helis.filter(h => !h.copHeli); }
  S.cops = S.cops.filter(c => !c.dead);
  // fort garrison reacts to trespass
  if (inFort(p.x, p.z)) {
    if (!S._fortWarned) { S._fortWarned = true; toast('RESTRICTED AREA — FORT KUBRA. Lethal force authorized.', 4); addWanted(2); }
    const garrison = S.soldiers.filter(s2 => s2.state !== 'down').length;
    if (garrison < 4 + S.wanted) {
      const s2 = mkSoldier(R(FORT.x0 + 40, FORT.x1 - 40), R(FORT.z0 + 40, FORT.z1 - 40), S.wanted >= 4);
      if (d2(s2.x, s2.z, p.x, p.z) > 40) S.soldiers.push(s2);
    }
  } else S._fortWarned = false;
  S.soldiers = S.soldiers.filter(s2 => !s2.dead);
  S.footCops = S.footCops.filter(f => !f.dead);
  S.enemies = S.enemies.filter(e => !e.dead);
  S.tanks = S.tanks.filter(t => !t.dead || t.owned);
  S.helis = S.helis.filter(h => !h.dead);
}

// ---------- fail states ----------
function afterFail(kind) {
  const p = S.player;
  const cut = Math.floor(p.money * (kind === 'busted' ? 0.1 : 0.15));
  p.money -= cut;
  S.wanted = 0; S.cops = []; S.footCops = []; S.soldiers = []; S.bullets = []; S.shellsList = []; S.rockets = [];
  if (S.mission) missionFail(kind === 'busted' ? 'you got busted.' : 'you got wasted.');
  p.hp = 100; p.downT = 0; p.veh = null;
  // respawn at an owned house if any, else hospital
  const home = p.owned.houses.length ? HOUSES.find(h => h.id === p.owned.houses[0]) : null;
  p.x = home ? home.x : 1505; p.z = home ? home.z : 2056; p.y = groundY(p.x, p.z);
  S.state = 'play';
  toast(kind === 'busted' ? 'Busted. The judge did not even look up. Fined $' + cut : 'Wasted. The hospital took $' + cut, 4);
  ev('respawn', {});
}

// ---------- master step ----------
let lastZone = 'city';
C.step = function (dt, inp) {
  const p = S.player;
  S.time += dt; S.stateT += dt;
  if (S.state === 'busted' || S.state === 'wasted') {
    if (S.stateT > 3) afterFail(S.state);
    return;
  }
  const z = zoneOf(p.x, p.z);
  if (z !== lastZone) {
    lastZone = z;
    const names = { city: 'BLANK CITY', fort: 'FORT KUBRA — RESTRICTED', airport: 'INTERNATIONAL AIRPORT', outfield: 'THE OUTFIELD', sierra: 'SIERRA NEGRA', fringe: '' };
    if (names[z]) ev('zone', { name: names[z] });
  }
  spawnAmbient();
  // mission proximity starts
  if (!S.mission) {
    for (const id in MISSIONS) {
      const def = MISSIONS[id];
      if (S.done[id] && !def.repeatable) continue;
      if (!unlocked(id)) continue;
      if (d2(p.x, p.z, def.marker.x, def.marker.z) < 7) { startMission(id); break; }
    }
  } else S.mission.def.update(S.mission, dt);
  // rent from properties
  S.rentT += dt;
  if (S.rentT > 60) {
    S.rentT = 0;
    let rent = 0;
    for (const id of p.owned.houses) rent += HOUSES.find(h => h.id === id).rent;
    if (rent) { p.money += rent; ev('popup', { msg: 'RENT +$' + rent }); }
  }
  if (p.veh) playerVehicle(dt, inp); else playerFoot(dt, inp);
  for (const c of S.cars) if (c.type === 'traffic') updateTraffic(c, dt);
  for (const c of S.cops) updateCopCar(c, dt);
  for (const pd of S.peds) updatePed(pd, dt);
  for (const e of S.enemies) updateInfantry(e, dt, 10);
  for (const s2 of S.soldiers) updateInfantry(s2, dt, 12);
  for (const f of S.footCops) updateInfantry(f, dt, 8);
  for (const t of S.tanks) updateTankAI(t, dt);
  for (const h of S.helis) updateHeliAI(h, dt);
  updateBullets(dt);
  for (const g of S.pickups) g.t -= dt;
  S.pickups = S.pickups.filter(g => g.t > 0);
  p.hitT = Math.max(0, p.hitT - dt);
  // wanted evasion — tunnels hide you well
  const copNear = S.cops.some(c => d2(c.x, c.z, p.x, p.z) < 120) || S.footCops.some(f => f.state !== 'down' && d2(f.x, f.z, p.x, p.z) < 60);
  const hidden = C.inTunnel(p.x, p.z);
  if (S.wanted > 0 && (!copNear || hidden)) {
    S.evadeT += dt * (hidden ? 3.5 : 1);
    if (S.evadeT > 10) { S.wanted--; S.evadeT = 0; if (S.wanted === 0) toast('You lost the heat.', 2.5); else if (hidden) toast('Underground. They are losing you...', 2); }
  } else S.evadeT = 0;
  if (p.hp <= 0) waste();
  p.hp = clamp(p.hp + dt * 0.5, 0, 100);
  ev._drain = null;
};
C.drainEvents = function () { const e = S.events; S.events = []; return e; };
C.shopAt = function () {
  const p = S.player;
  for (const s of SHOPS) if (d2(s.x, s.z, p.x, p.z) < 7) return s;
  return null;
};
C.houseAt = function () {
  const p = S.player;
  for (const h of HOUSES) if (d2(h.x, h.z, p.x, p.z) < 7) return h;
  return null;
};
C.switchWeapon = function (dir) {
  const p = S.player, ids = Object.keys(p.weapons);
  let i = ids.indexOf(p.cur);
  i = (i + dir + ids.length) % ids.length;
  p.cur = ids[i];
  ev('sfx', { k: 'door' });
};
C.equip = function (id) { if (S.player.weapons[id]) S.player.cur = id; };

reset(false);
return C;
});
