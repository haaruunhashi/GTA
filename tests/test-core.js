// Headless test of the FACELESS CITY 3D simulation core.
const C = require('../core.js');
const S = C.S;
let pass = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } pass++; console.log('ok - ' + msg); };
const inp = () => ({ fwd: 0, back: 0, left: 0, right: 0, run: 0, fire: 0, enter: 0, handbrake: 0, nitro: 0, up: 0, down: 0, reload: 0, camYaw: 0, camPitch: 0 });
function step(n, i) { for (let k = 0; k < n; k++) C.step(1 / 60, i || inp()); C.drainEvents(); }
function stepAlive(n, i) { // keep the test player alive & un-arrested: we test mechanics, not survivability
  for (let k = 0; k < n; k += 5) {
    S.player.hp = 100; S.player.armor = 100;
    if (S.player.veh) S.player.veh.hp = Math.max(S.player.veh.hp, 500);
    step(Math.min(5, n - k), i);
    if (S.state !== 'play') { S.state = 'play'; S.stateT = 0; S.player.hp = 100; }
  }
  S.player.hp = 100;
}
const P = S.player;

// --- preloaded arsenal + supercar starter (pristine new game) ---
assert(Object.keys(P.weapons).length === Object.keys(C.WEAPONS).length, 'every weapon preloaded in the inventory');
assert(P.cur === 'm4' && P.weapons.m4.mag === C.WEAPONS.m4.mag, 'starts with the M4A1 loaded');
assert(P.ammo.rifle > 0 && P.ammo.aa > 0 && P.ammo.rocket > 0, 'preloaded ammo reserves across weapon classes');
assert(S.cars[0] && S.cars[0].cls === 'super', 'the first car at spawn is a supercar');
assert(C.VEH.super && C.VEH.super.top > C.VEH.sports.top, 'the supercar out-runs the sports coupe');
assert(P.owned.vehicles.includes('heli') && P.owned.vehicles.includes('jet'), 'a helicopter and fighter jet are preloaded');
assert(S.helis.filter(h => h.owned).length >= 2, 'both aircraft spawn at the start (' + S.helis.filter(h => h.owned).length + ')');
assert(C.VEH.jet && C.VEH.jet.kind === 'plane' && C.VEH.jet.top > C.VEH.plane.top, 'the fighter jet exists and is fast');

// --- world ---
assert(C.buildings.length > 300, 'city generated (' + C.buildings.length + ' buildings)');
assert(C.buildings.some(b => b.kind === 'tower' && b.h > 60), 'downtown towers rise above 60m');
assert(C.groundY(5400, 1800) > 40, 'Sierra has real elevation (' + C.groundY(5400, 1800).toFixed(0) + 'm)');
assert(C.groundY(1300, 1989) < -8, 'downtown tunnel runs underground');
assert(C.inTunnel(1300, 1989), 'tunnel detection works');
assert(C.zoneOf(700, 500) === 'fort', 'Fort Kubra exists');
assert(C.zoneOf(2000, 3600) === 'airport', 'airport exists');
assert(C.SHOPS.length === 6 && C.HOUSES.length === 3, 'six shops and three buyable houses');
assert(C.stashes.length === 30, '30 hidden stashes placed');

// --- weapons: every US gun has its Soviet pair ---
let pairs = 0;
for (const id in C.WEAPONS) {
  const w = C.WEAPONS[id];
  if (w.nation === 'US') {
    const sov = C.WEAPONS[w.pair];
    assert(sov && sov.nation === 'SOV' && sov.pair === id, w.name + ' pairs with ' + sov.name);
    pairs++;
  }
}
assert(pairs === 7, 'seven US/Soviet weapon pairs (' + pairs + ')');

// --- economy ---
P.money = 100000; P.rep = 20;
// the arsenal starts preloaded, so a fresh player already owns every gun
assert(C.buyWeapon('ak47') !== null && P.weapons.ak47, 'AK-47 preloaded (already owned)');
delete P.weapons.ak47; delete P.weapons.m4; delete P.weapons.svd; delete P.weapons.stinger;
assert(C.buyWeapon('ak47') === null && P.weapons.ak47, 'buy AK-47');
assert(C.buyWeapon('m4') === null && P.weapons.m4, 'buy M4A1');
assert(C.buyWeapon('stinger') === null, 'buy Stinger (tier unlocked by rep)');
P.rep = 0; delete P.weapons.svd;
assert(C.buyWeapon('svd') !== null, 'sniper locked at low rep');
P.rep = 20;
assert(C.buyAmmo('rifle') === null && P.ammo.rifle > 0, 'buy rifle ammo');
assert(C.buyOutfit('combat') === null && P.outfit === 'combat', 'buy combat fatigues outfit');
assert(C.buyHouse('apt') === null && P.owned.houses.includes('apt'), 'buy the Eastside Apartment');
assert(C.buyVehicle('muscle') === null && P.owned.vehicles.includes('muscle'), 'buy a muscle car');
P.owned.vehicles = P.owned.vehicles.filter(v => v !== 'heli' && v !== 'jet'); // preloaded — clear to test purchase
assert(C.buyVehicle('heli') === null, 'buy a helicopter');
P.money = 100000;
assert(C.buyVehicle('plane') === null, 'buy a plane (the airway)');
assert(C.buySnack() === null && C.buyArmor() === null, 'supermarket snack + armor');

// --- save / load round trip ---
const blob = C.serialize();
const money0 = P.money;
P.money = 0; P.weapons = { fists: { ammo: Infinity, mag: 0 } };
assert(C.deserialize(blob) && P.money === money0 && P.weapons.ak47, 'save/load round trip restores money and guns');

// --- driving + nitro ---
S.cars[0].x = 300; S.cars[0].z = 1980; S.cars[0].yaw = 0; // long road east... row z=1980? ensure road:
P.x = S.cars[0].x + 3; P.z = S.cars[0].z; P.y = 0;
const iE = inp(); iE.enter = 1;
step(2, iE);
assert(P.veh === S.cars[0], 'enter the starter supercar');
const iD = inp(); iD.fwd = 1;
P.veh.x = 400; P.veh.z = 2532; P.veh.yaw = 0; P.veh.spd = 0; // on an east-west road row
let vmax = 0;
for (let i = 0; i < 300; i++) { C.step(1 / 60, iD); vmax = Math.max(vmax, P.veh.spd); } C.drainEvents();
const plain = vmax;
P.veh.x = 400; P.veh.z = 2532; P.veh.spd = 0; P.veh.yaw = 0;
iD.nitro = 1; vmax = 0;
for (let i = 0; i < 300; i++) { C.step(1 / 60, iD); vmax = Math.max(vmax, P.veh.spd); } C.drainEvents();
assert(vmax > plain + 8, 'nitro raises top speed (' + plain.toFixed(1) + ' -> ' + vmax.toFixed(1) + ' m/s)');

// --- terrain following: drive into the Sierra and gain altitude ---
P.veh.x = 5000; P.veh.z = 1800; P.veh.spd = 0;
step(240, inp());
assert(P.veh.y > 20, 'car follows mountain terrain upward (y=' + P.veh.y.toFixed(0) + ')');

// --- tunnel evasion ---
P.veh.x = 1300; P.veh.z = 1989; P.veh.spd = 0; step(240, inp());
assert(P.y < -5, 'vehicle descends into the tunnel');
C.addWanted(3);
const w0 = S.wanted;
S.evadeT = 9.9; step(30, inp());
assert(S.wanted < w0, 'tunnels burn wanted stars fast');
S.wanted = 0; S.cops = [];

// --- helicopter flight ---
const pressEnter = () => { const i = inp(); i.enter = 1; step(2, i); };
pressEnter(); // exit car (in tunnel)
assert(!P.veh, 'exit vehicle');
const myHeli = S.helis.find(h => h.owned);
assert(myHeli, 'purchased helicopter delivered');
P.x = myHeli.x + 3; P.z = myHeli.z; P.y = myHeli.y;
pressEnter();
assert(P.veh === myHeli, 'board the helicopter');
const iF = inp(); iF.up = 1; iF.fwd = 1;
step(180, iF);
assert(P.veh.y > C.groundY(P.veh.x, P.veh.z) + 10, 'helicopter climbs (alt=' + (P.veh.y - C.groundY(P.veh.x, P.veh.z)).toFixed(0) + 'm)');
// land + exit
const iL = inp(); iL.down = 1;
for (let i = 0; i < 600 && P.veh.y > C.groundY(P.veh.x, P.veh.z) + 0.7; i++) C.step(1 / 60, iL);
C.drainEvents();
pressEnter();
assert(!P.veh, 'land and dismount');

// --- aircraft armament: jet cannons + bombs, heli bombs ---
const jet = S.helis.find(h => h.cls === 'jet');
assert(jet, 'the preloaded fighter jet is in the world');
jet.y = C.groundY(jet.x, jet.z) + 70; jet.spd = 90; jet.fall = -1; P.veh = jet;
S.bullets = []; S.bombs = [];
const iAir = inp(); iAir.fire = 1;
stepAlive(24, iAir);
assert(S.bullets.length > 0, 'the jet fires its cannons');
S.bombs = []; jet.y = C.groundY(jet.x, jet.z) + 70;
const iDrop = inp(); iDrop.bomb = 1;
stepAlive(4, iDrop);
assert(S.bombs.length > 0, 'the jet drops a bomb');
const beforeFall = S.bombs.length;
stepAlive(300, inp());
assert(S.bombs.length < beforeFall, 'dropped bombs fall and detonate');
const heli2 = S.helis.find(h => h.cls === 'heli' && h.owned);
assert(heli2, 'the preloaded helicopter is in the world');
heli2.y = C.groundY(heli2.x, heli2.z) + 60; heli2.fall = -1; P.veh = heli2; S.bombs = [];
stepAlive(4, iDrop);
assert(S.bombs.length > 0, 'the helicopter drops bombs too');
P.veh = null; S.bombs = []; S.bullets = [];

// --- city mission: courier ---
P.veh = null;
const cm = C.MISSIONS.courier.marker;
P.x = cm.x; P.z = cm.z; P.y = 0;
step(5);
assert(S.mission && S.mission.id === 'courier', 'COURIER RUN starts at its marker');
P.x = 2582; P.z = 2745;
const m1 = P.money;
step(5);
assert(!S.mission && P.money > m1, 'courier pays out');

// --- ops: hostiles spawn & rifle kills count ---
C.equip('m4'); P.weapons.m4.mag = 30; P.ammo.rifle = 500;
const op = C.MISSIONS.op1.marker;
P.x = op.x; P.z = op.z; P.y = 0;
step(5);
assert(S.mission && S.mission.id === 'op1', 'FIRST CONTACT triggers');
step(60);
assert(S.enemies.filter(e => e.gmTag === 'op1').length > 0, 'hostiles spawn at the camp');
let guard = 0;
while (S.mission && S.mission.id === 'op1' && guard++ < 400) {
  const e = S.enemies.find(e2 => e2.gmTag === 'op1' && e2.state !== 'down');
  if (!e) { stepAlive(30); continue; }
  P.x = e.x - 8; P.z = e.z; P.y = C.groundY(P.x, P.z);
  const iS = inp(); iS.fire = 1;
  iS.camYaw = Math.atan2(e.z - P.z, e.x - P.x); iS.camPitch = 0;
  P.weapons.m4.mag = 30; P.reloadT = 0;
  stepAlive(20, iS);
}
assert(S.done.op1, 'FIRST CONTACT completed by shooting hostiles (' + guard + ' loops)');

// --- war1: gunships + AA lock ---
S.done.op1 = 1;
const w1 = C.MISSIONS.war1.marker;
P.x = w1.x; P.z = w1.z; P.y = C.groundY(P.x, P.z);
step(5);
assert(S.mission && S.mission.id === 'war1', 'STINGER RIDGE starts');
assert(S.helis.filter(h => h.gmTag === 'war1').length === 3, 'three hostile gunships spawned');
assert(P.weapons.stinger || P.weapons.strela, 'AA launcher in inventory');
C.equip(P.weapons.stinger ? 'stinger' : 'strela');
guard = 0;
while (S.mission && S.mission.id === 'war1' && guard++ < 300) {
  const h = S.helis.find(h2 => h2.gmTag === 'war1' && !h2.dead && h2.fall < 0);
  if (!h) { stepAlive(30); continue; }
  P.x = Math.max(h.x - 80, C.WORLD.SIERRA_X0 + 100); P.z = h.z; P.y = C.groundY(P.x, P.z);
  h.x = P.x + 80; h.z = P.z; h.y = P.y + 50;
  const iA = inp();
  iA.camYaw = 0; iA.camPitch = Math.atan2(h.y - (P.y + 1.5), 80);
  P.ammo.aa = Math.max(P.ammo.aa, 3);
  stepAlive(70, iA);          // build lock
  iA.fire = 1; P.fireT = 0;
  stepAlive(5, iA);
  iA.fire = 0;
  stepAlive(160, iA);         // missile flight + fall
}
assert(S.done.war1, 'STINGER RIDGE won — gunships downed with locked AA rockets');

// --- war2: tanks fire shells; rockets kill armor ---
const w2 = C.MISSIONS.war2.marker;
P.x = w2.x; P.z = w2.z; P.y = C.groundY(P.x, P.z);
step(5);
assert(S.mission && S.mission.id === 'war2', 'CONVOY AMBUSH starts');
assert(S.tanks.filter(t => t.gmTag === 'war2').length === 2, 'two hostile tanks spawned');
let shellSeen = false;
for (let i = 0; i < 900 && !shellSeen; i++) { S.player.hp = 100; C.step(1 / 60, inp()); if (S.shellsList.length) shellSeen = true; }
C.drainEvents();
assert(shellSeen, 'tanks fire main-gun shells');
C.equip(P.weapons.strela ? 'strela' : 'stinger');
guard = 0;
while (S.mission && S.mission.id === 'war2' && guard++ < 500) {
  const tk = S.tanks.find(t => t.gmTag === 'war2' && !t.dead);
  if (tk) {
    P.x = Math.max(tk.x - 60, C.WORLD.SIERRA_X0 + 100); P.z = tk.z; P.y = C.groundY(P.x, P.z);
    tk.x = P.x + 60; tk.z = P.z; tk.y = C.groundY(tk.x, tk.z);
    const iA = inp(); iA.camYaw = 0; iA.camPitch = 0;
    P.ammo.aa = Math.max(P.ammo.aa, 3);
    stepAlive(70, iA);
    iA.fire = 1; P.fireT = 0;
    stepAlive(5, iA); iA.fire = 0;
    stepAlive(120, iA);
  } else {
    const e = S.enemies.find(e2 => e2.gmTag === 'war2' && e2.state !== 'down');
    if (!e) { stepAlive(30); continue; }
    C.equip('m4'); P.weapons.m4.mag = 30; P.ammo.rifle = 500; P.reloadT = 0;
    P.x = e.x - 8; P.z = e.z; P.y = C.groundY(P.x, P.z);
    const iS = inp(); iS.fire = 1; iS.camYaw = Math.atan2(e.z - P.z, e.x - P.x);
    stepAlive(20, iS);
    C.equip(P.weapons.strela ? 'strela' : 'stinger');
  }
}
assert(S.done.war2, 'CONVOY AMBUSH won — armor killed with rockets, escort with rifle');

// --- heist: steal the tank from Fort Kubra ---
const hm = C.MISSIONS.heist.marker;
S.mission = null;
P.x = hm.x; P.z = hm.z; P.y = 0;
step(5);
assert(S.mission && S.mission.id === 'heist', 'THE KUBRA JOB starts');
const htank = S.tanks.find(t => t.heist);
assert(htank && C.zoneOf(htank.x, htank.z) === 'fort', 'target T-80 parked inside the base');
P.x = htank.x + 4; P.z = htank.z; P.y = 0;
(() => { const i = inp(); i.enter = 1; S.player.hp = 100; step(2, i); })();
assert(P.veh === htank, 'player steals the T-80');
assert(S.wanted >= 4, 'army responds at maximum force (wanted=' + S.wanted + ')');
// tank main gun works
const iT = inp(); iT.fire = 1; iT.camYaw = 0;
stepAlive(5, iT);
assert(S.shellsList.some(s => s.friendly), 'player tank fires its cannon');
// deliver: teleport the drive (physics already proven)
htank.x = C.SITES[0].x; htank.z = C.SITES[0].z; S.mission.phase = 1;
const mh = P.money;
stepAlive(5);
assert(S.done.heist && P.money > mh, 'heist complete — tank delivered and now owned');
assert(P.owned.vehicles.includes('tank'), 'T-80 added to owned vehicles');

// --- fort garrison hostility (fresh trespass) ---
S.mission = null; S.wanted = 0; S.soldiers = [];
P.veh = null; P.x = 700; P.z = 500; P.y = 0;
stepAlive(120);
assert(S.wanted >= 2 && S.soldiers.length > 0, 'trespassing Fort Kubra draws garrison (' + S.soldiers.length + ' soldiers)');

// --- police heli at high wanted ---
S.wanted = 5; P.x = 1500; P.z = 2000; P.y = 0;
stepAlive(30);
assert(S.helis.some(h => h.copHeli), 'police gunship joins at high wanted');
S.wanted = 0; stepAlive(5);

// --- taxi + race + airrace markers exist and unlock chain sane ---
S.done.getaway = 1;
assert(C.unlocked('taxi') && C.unlocked('race') && C.unlocked('airrace'), 'taxi, street race, air race unlocked after getaway');
assert(C.unlocked('heist'), 'heist unlocked after war2');

// --- stunt ramps: launch off the airport ramp, get paid ---
S.mission = null; S.wanted = 0;
P.veh = null;
const stuntCar = C.factories.mkCar(1520, 3480, 0, 'free', 'sports');
S.cars.push(stuntCar);
P.x = stuntCar.x + 2; P.z = stuntCar.z; P.y = 0;
(() => { const i = inp(); i.enter = 1; step(2, i); })();
assert(P.veh === stuntCar, 'board the stunt car');
const iRamp = inp(); iRamp.fwd = 1; iRamp.nitro = 1;
let flew = false, moneyBefore = P.money;
for (let k = 0; k < 700; k++) {
  C.step(1 / 60, iRamp);
  if (P.veh && P.veh.air) flew = true;
  if (!P.veh) break;
}
C.drainEvents();
assert(flew, 'car goes airborne off the airport ramp');
assert(P.money > moneyBefore, 'stunt bonus paid (+$' + (P.money - moneyBefore) + ')');

// ================= THE TAILOR story arc =================
const drain = () => C.drainEvents();
function killTagged(tag, n) {
  let guard = 0;
  while (guard++ < 4000) {
    const e = S.enemies.find(e2 => e2.gmTag === tag && e2.state !== 'down');
    if (e) C.killInfantry(e);
    stepAlive(10);
    const done2 = S.enemies.filter(e2 => e2.gmTag === tag && e2.state === 'down').length;
    if (!S.mission || done2 >= n) break;
  }
}
S.mission = null; S.wanted = 0; S.cops = []; P.veh = null;
let sguard = 0;
// m1 MEASURED — tail, ambush, briefcase
P.x = 2041; P.z = 1666; P.y = 0;
step(5);
assert(S.mission && S.mission.id === 'm1', 'MEASURED starts at the Tailor');
assert(C.drainEvents !== undefined, 'events api');
let m = S.mission;
assert(m.car && m.car.type === 'script', 'tail target sedan spawned on a route');
// fast-forward the tail: park ourselves mid-band and skip the car to its last waypoint
m.car.ri = m.car.route.length - 1;
m.car.x = m.car.route[m.car.route.length - 1].x - 14; m.car.z = m.car.route[m.car.route.length - 1].z;
sguard = 0;
while (S.mission && S.mission.phase === 0 && sguard++ < 600) { P.x = m.car.x - 60; P.z = m.car.z; P.y = 0; stepAlive(5); }
assert(S.mission && S.mission.phase === 1, 'ambush phase triggers at route end');
killTagged('m1', 3);
assert(S.mission && S.mission.phase === 2, 'hitmen down — briefcase phase');
P.x = m.car.x; P.z = m.car.z; stepAlive(5);
P.x = 2041; P.z = 1666; stepAlive(5);
assert(S.done.m1 === 1, 'MEASURED passed');
// m2 ALTERATIONS — plant, ram, subdue
C.startMission('m2'); m = S.mission; drain();
S.wanted = 0; S.cops = [];
P.veh = null; P.x = m.car.x + 2; P.z = m.car.z; P.y = 0;
stepAlive(200);
assert(S.mission && S.mission.phase === 1, 'tracker planted, target fleeing');
m.car.hp = 70; stepAlive(10);
assert(S.mission && S.mission.phase === 2 && m.driver, 'target rammed out — driver bailed');
m.driver.state = 'down'; m.driver.downT = 20; stepAlive(5);
assert(S.done.m2 === 1, 'ALTERATIONS passed');
// m3 DRY CLEANING — timed pickups under heat, tunnel dropoff
C.startMission('m3'); m = S.mission; drain();
for (const q of m.pts) { P.x = q.x; P.z = q.z; P.y = 0; stepAlive(5); }
assert(m.got === 3, 'all three packages collected');
assert(S.wanted >= 2, 'police heat pinned during the run');
P.x = 1300; P.z = 1989; P.y = -9; stepAlive(5);
assert(S.done.m3 === 1, 'DRY CLEANING passed underground');
// m4 THE FITTING — defend the shop
C.startMission('m4'); m = S.mission; drain();
P.x = 2041; P.z = 1680; P.y = 0;
killTagged('m4', 12);
assert(S.done.m4 === 1, 'THE FITTING passed (12 hitmen down)');
// m5 LOOSE THREADS — overwatch
C.startMission('m5'); m = S.mission; drain();
killTagged('m5', 6);
assert(S.done.m5 === 1, 'LOOSE THREADS passed (informant alive)');
// m6 OFF THE RACK — convoy hijack
C.startMission('m6'); m = S.mission; drain();
m.apc.hp = 200; stepAlive(10);
assert(S.mission && S.mission.phase === 0.5, 'APC stalled');
P.veh = null; P.x = m.apc.x + 3; P.z = m.apc.z; P.y = C.groundY(P.x, P.z);
(() => { const i = inp(); i.enter = 1; S.player.hp = 100; step(2, i); })();
assert(P.veh === m.apc, 'APC jacked');
m.apc.x = 2419; m.apc.z = 2530; stepAlive(5);
assert(S.done.m6 === 1 && P.owned.vehicles.includes('apc'), 'OFF THE RACK passed — APC owned');
// m7 BESPOKE — hangar raid + air escape
C.startMission('m7'); m = S.mission; drain();
killTagged('m7', 8);
assert(S.mission && S.mission.phase === 1, 'hangars cleared');
P.veh = null; P.x = 2675; P.z = 3360; P.y = 0; stepAlive(5);
assert(S.mission && S.mission.phase === 2, 'ledger secured');
P.x = m.heli.x + 3; P.z = m.heli.z; P.y = m.heli.y;
(() => { const i = inp(); i.enter = 1; S.player.hp = 100; step(2, i); })();
assert(P.veh === m.heli, 'borrowed heli boarded');
m.heli.x = 4820; m.heli.z = 1060; m.heli.y = C.groundY(4820, 1060) + 1; stepAlive(5);
assert(S.done.m7 === 1, 'BESPOKE passed — ledger delivered by air');
// m8 FINAL CUT — gunship boss + LZ cleanup
if (P.veh) { const i = inp(); i.enter = 1; step(2, i); }
C.startMission('m8'); m = S.mission; drain();
assert(m.boss && m.boss.fleeRoute, 'Herringbone flees by gunship');
m.boss.hp = 0;
sguard = 0;
while (S.mission && S.mission.phase === 0 && sguard++ < 900) stepAlive(5);
assert(S.mission && S.mission.phase === 1, 'boss gunship downed — LZ fight begins');
killTagged('m8', 4);
assert(S.done.m8 === 1, 'FINAL CUT passed — story complete');
P.money = 5000;
assert(C.buyOutfit('tailor') === null && P.outfit === 'tailor', "story reward outfit unlocked: The Tailor's Cut");
const evs = drain();

// ================= THE CAPTAIN crooked-cop chain =================
S.mission = null; S.wanted = 0; S.cops = []; P.veh = null; S.helis = [];
C.startMission('cop1'); m = S.mission; drain();
assert(m.car && m.car.type === 'script', 'PROFESSIONAL COURTESY spawns the evidence cruiser');
m.car.hp = 0; stepAlive(6);
assert(S.mission && S.mission.phase === 1 && S.wanted >= 3, 'cruiser destroyed, heat spikes');
S.wanted = 0; stepAlive(6);
assert(S.done.cop1 === 1, 'PROFESSIONAL COURTESY passed');
C.startMission('cop2'); m = S.mission; drain();
assert(m.wit && m.wit.state === 'script', 'WITNESS PROTECTION spawns the witness');
P.x = m.wit.x; P.z = m.wit.z; P.y = 0; stepAlive(4);
assert(S.mission && S.mission.phase === 1, 'witness spooked, now fleeing');
m.wit.x = m.flee.x - 30; m.wit.z = m.flee.z;
sguard = 0;
while (S.mission && S.mission.id === 'cop2' && sguard++ < 120) { P.x = m.wit.x - 25; P.z = m.wit.z; P.y = 0; stepAlive(5); }
assert(S.done.cop2 === 1, 'WITNESS PROTECTION passed (herded alive)');
C.startMission('cop3'); m = S.mission; drain();
for (const q of m.spots) { P.x = q.x; P.z = q.z; P.y = 0; stepAlive(4); }
assert(S.done.cop3 === 1, 'COLLECTION DAY passed (4 shakedowns)');
C.startMission('cop4'); m = S.mission; drain();
assert(S.wanted >= 4 && S.helis.some(h => h.copHeli), 'INTERNAL AFFAIRS: full heat + police chopper');
P.x = m.safe.x; P.z = m.safe.z; P.y = 0; stepAlive(4);
assert(S.done.cop4 === 1 && S.wanted === 0, 'INTERNAL AFFAIRS passed at the safehouse');
// ================= CONTRACTS =================
S.mission = null; S.wanted = 0;
C.startMission('contract'); m = S.mission; drain();
assert(m.spot && m.pay >= 1500, 'CONTRACT issues a mark and a fee');
P.x = m.spot.x; P.z = m.spot.z; P.y = C.groundY(P.x, P.z); stepAlive(4);
assert(S.mission && S.mission.phase === 1 && m.mark, 'reached the mark — target + guards spawn');
const cmoney = P.money;
C.killInfantry(m.mark); stepAlive(4);
assert(S.done.contract >= 1, 'CONTRACT completed by eliminating the mark');
assert(P.money >= cmoney + m.pay * 2 - 1, 'silent kill paid the double bonus (+$' + (P.money - cmoney) + ')');
// a second contract issues a fresh, harder one
C.startMission('contract'); const m2b = S.mission; drain();
assert(m2b.pay > 1500, 'repeat contract scales the fee (' + m2b.pay + ')');
C.missionFail('cleanup');

console.log('\nCORE_OK — ' + pass + ' assertions passed');
