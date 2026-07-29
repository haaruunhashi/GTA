// Weapons: procedural viewmodels, ADS, recoil patterns, reload, ballistics.
// Owner: weapons agent. Public API: update(dt), fire(), reload(), equip(id), def, ammo, reserve.
//
// The viewmodel lives under a single animated node parented to the camera. Every
// pose (hip / ADS / sprint / reload / inspect / draw) is an additive offset composed
// into that node, so the sight lands on dead screen centre when ADS is complete.
import * as THREE from 'three';
import { GunMats } from './weapons-materials.js';
import { BUILDERS, makeReticle } from './weapons-models.js';
import { ScopeView } from './weapons-scope.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _p2 = new THREE.Vector3();
const _fwd = new THREE.Vector3(), _rgt = new THREE.Vector3(), _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DEG = Math.PI / 180;

const smooth = t => t * t * (3 - 2 * t);
const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
// 0 -> 1 -> 0 hump used for additive animation poses
const hump = (t, a, b) => { if (t <= a || t >= b) return 0; const k = (t - a) / (b - a); return Math.sin(k * Math.PI); };
const ramp = (t, a, b) => clamp01((t - a) / Math.max(1e-4, b - a));

export const WEAPONS = {
  ar: {
    name: 'MK-4 CARBINE', model: 'ar', auto: true, sightNode: 'optic',
    rpm: 730, dmg: 32, dmgFar: 20, near: 26, far: 70,
    mag: 30, reserve: 240, pellets: 1, muzzleVel: 900, range: 340,
    pen: 0.30, penDmg: 0.60,
    spreadHip: 0.040, spreadAds: 0.0026, spreadKick: 0.0052, spreadMax: 0.090, spreadRec: 4.5,
    recoil: { v: 0.0070, h: 0.0030, pattern: 'ar', kick: 0.055, rot: 0.30, roll: 0.10 },
    adsTime: 0.22, adsFov: 54, drawTime: 0.52, holsterTime: 0.28,
    rl: { out: 0.50, in: 1.15, ammo: 1.32, dur: 2.05, extra: 0.72, chargeDur: 0.34 },
    cycle: 0.062, ejectAt: 0.30, boltKind: 'auto',
    hip: [0.118, -0.132, -0.255], hipRot: [0.020, -0.060, 0.028],
    adsDist: 0.255, tracerEvery: 3,
  },
  smg: {
    name: 'VECTOR-9', model: 'smg', auto: true, sightNode: 'optic',
    rpm: 980, dmg: 25, dmgFar: 14, near: 14, far: 40,
    mag: 32, reserve: 256, pellets: 1, muzzleVel: 700, range: 220,
    pen: 0.16, penDmg: 0.50,
    spreadHip: 0.032, spreadAds: 0.0038, spreadKick: 0.0046, spreadMax: 0.085, spreadRec: 5.2,
    recoil: { v: 0.0048, h: 0.0036, pattern: 'smg', kick: 0.042, rot: 0.24, roll: 0.14 },
    adsTime: 0.18, adsFov: 60, drawTime: 0.44, holsterTime: 0.24,
    rl: { out: 0.44, in: 1.00, ammo: 1.16, dur: 1.85, extra: 0.62, chargeDur: 0.30 },
    cycle: 0.048, ejectAt: 0.30, boltKind: 'auto',
    hip: [0.112, -0.128, -0.215], hipRot: [0.022, -0.070, 0.030],
    adsDist: 0.240, tracerEvery: 3,
  },
  shotgun: {
    name: 'KS-12 BREACHER', model: 'shotgun', auto: false, sightNode: 'irons',
    rpm: 78, dmg: 22, dmgFar: 5, near: 9, far: 26,
    mag: 6, reserve: 48, pellets: 9, muzzleVel: 420, range: 80,
    pen: 0.06, penDmg: 0.35,
    spreadHip: 0.055, spreadAds: 0.030, spreadKick: 0.004, spreadMax: 0.08, spreadRec: 5,
    recoil: { v: 0.0230, h: 0.0060, pattern: 'shotgun', kick: 0.16, rot: 0.95, roll: 0.22 },
    adsTime: 0.26, adsFov: 62, drawTime: 0.58, holsterTime: 0.32,
    rl: { shell: true, start: 0.40, per: 0.44, end: 0.52 },
    cycle: 0.62, ejectAt: 0.42, boltKind: 'pump', pumpAfterShot: true,
    hip: [0.120, -0.140, -0.235], hipRot: [0.024, -0.062, 0.030],
    adsDist: 0.230, tracerEvery: 1, tracerWidth: 0.014,
  },
  sniper: {
    name: 'LR-338 BALLISTA', model: 'sniper', auto: false, sightNode: 'optic',
    rpm: 48, dmg: 115, dmgFar: 92, near: 90, far: 260,
    mag: 5, reserve: 40, pellets: 1, muzzleVel: 1100, range: 900,
    pen: 0.55, penDmg: 0.80,
    spreadHip: 0.075, spreadAds: 0.0002, spreadKick: 0.010, spreadMax: 0.12, spreadRec: 3.0,
    recoil: { v: 0.0400, h: 0.0070, pattern: 'sniper', kick: 0.20, rot: 1.35, roll: 0.20 },
    adsTime: 0.34, adsFov: 60, drawTime: 0.72, holsterTime: 0.38,
    rl: { out: 0.62, in: 1.42, ammo: 1.60, dur: 2.70, extra: 0.60, chargeDur: 0.40 },
    cycle: 0.90, ejectAt: 0.38, boltKind: 'bolt', boltAfterShot: true,
    hip: [0.125, -0.140, -0.250], hipRot: [0.020, -0.058, 0.026],
    adsDist: 0.240, scope: true, scopeFov: 6.8, tracerEvery: 1, tracerWidth: 0.030,
  },
};

export const SLOTS = ['ar', 'smg', 'shotgun', 'sniper'];

// Per-shot recoil patterns: [verticalScale, horizontalScale] for shot index i.
function pattern(kind, i, rng) {
  switch (kind) {
    case 'ar': {
      const v = i < 3 ? 1.15 - i * 0.05 : 0.80 + Math.sin(i * 0.4) * 0.12;
      const h = i < 3 ? (i - 1) * 0.25 : Math.sin(i * 0.62) * 1.1 + 0.45 + (rng() - 0.5) * 0.5;
      return [v, h];
    }
    case 'smg': {
      const v = i < 2 ? 1.1 : 0.72 + Math.sin(i * 0.7) * 0.16;
      const h = Math.sin(i * 0.9 + 0.6) * 1.25 + (rng() - 0.5) * 1.1;
      return [v, h];
    }
    case 'shotgun': return [1.0, (rng() - 0.5) * 1.2];
    case 'sniper': return [1.0, (rng() - 0.5) * 0.8];
    default: return [1, (rng() - 0.5)];
  }
}

// Penetration resistance per surface class.
const PEN_MUL = { concrete: 0.35, brick: 0.4, metal: 0.5, wood: 0.85, glass: 1.0, dirt: 0.6, sand: 0.5, foliage: 1.0, soft: 0.9 };

// Deterministic capture setups. Any name not in world POSES falls back to POSES.street,
// so these double as screenshot modes for the review harness.
const SHOTMODES = {
  gunsight: { w: 'ar', ads: 1 },
  whip: { w: 'ar', ads: 0 },
  wfire: { w: 'ar', ads: 0, fire: 1 },
  wads: { w: 'ar', ads: 1, fire: 1 },
  wsmg: { w: 'smg', ads: 0, fire: 1 },
  wsmgads: { w: 'smg', ads: 1 },
  wshot: { w: 'shotgun', ads: 0, fire: 1 },
  wshotads: { w: 'shotgun', ads: 1 },
  wsniper: { w: 'sniper', ads: 1 },
  wsniperhip: { w: 'sniper', ads: 0 },
  wreload: { w: 'ar', ads: 0, reload: 0.62 },
  wreload2: { w: 'ar', ads: 0, reload: 1.55 },
  winspect: { w: 'ar', ads: 0, inspect: 1.0 },
  wboom: { w: 'ar', ads: 0, boom: 1 },
  wsprint: { w: 'ar', ads: 0, sprint: 1 },
};

export class Weapons {
  constructor(ctx) {
    this.ctx = ctx;
    this.mats = new GunMats(ctx);
    this.rng = ctx.rng || Math.random;

    this.rig = new THREE.Group();          // camera-space root (weapon inertia / lag)
    this.gun = new THREE.Group();          // the animated node
    this.rig.add(this.gun);
    ctx.camera.add(this.rig);

    // a soft key light so the viewmodel never sinks into shadow
    this.fill = new THREE.PointLight(0xbfd2e8, 2.2, 3.2, 2);
    this.fill.position.set(0.35, 0.35, 0.25);
    this.fill.castShadow = false;
    this.rig.add(this.fill);

    this.models = {};
    this.store = {};
    for (const id of SLOTS) this.store[id] = { ammo: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };

    this.id = 'ar';
    this.prevId = 'smg';
    this.def = WEAPONS.ar;

    this.cool = 0;
    this.shotIndex = 0;
    this.sinceShot = 99;
    this.triggerWasDown = false;

    this.adsT = 0; this.adsWant = false;
    this.sprintT = 0;
    this.spreadKick = 0;
    this.spreadRad = WEAPONS.ar.spreadHip;

    this.reloadA = null;                  // {t, dur, empty, shells, done}
    this.cycleA = null;                   // {t, dur, ejected}
    this.inspectT = -1;
    this.swap = null;                     // {t, dur, phase, next}

    // recoil: camera offset (applied as a delta so the player keeps their own aim)
    this.rc = { p: 0, y: 0, tp: 0, ty: 0, pp: 0, py: 0 };
    // viewmodel springs: z back, pitch, yaw, roll, vertical
    this.k = { z: 0, zv: 0, rx: 0, rxv: 0, ry: 0, ryv: 0, rz: 0, rzv: 0, y: 0, yv: 0 };

    this.sway = { x: 0, y: 0, tx: 0, ty: 0 };
    this.bobPhase = 0;
    this.breath = 0;
    this.lastYaw = 0; this.lastPitch = 0;
    this.heat = 0;

    this.scope = new ScopeView(ctx);
    this.scopeBlend = 0;

    this.mode = SHOTMODES[ctx.config && ctx.config.shot] || null;
    this._equipNow(this.mode ? this.mode.w : 'ar');
    this.fovTarget = ctx.config.fov;
  }

  get ammo() { return this.store[this.id].ammo; }
  set ammo(v) { this.store[this.id].ammo = v; }
  get reserve() { return this.store[this.id].reserve; }
  set reserve(v) { this.store[this.id].reserve = v; }
  get model() { return this.models[this.id]; }

  /* ----------------------------------------------------------- viewmodel */

  _build(id) {
    if (this.models[id]) return this.models[id];
    const def = WEAPONS[id];
    const m = BUILDERS[def.model](this.mats);
    m.root.visible = false;
    m.root.traverse(o => { o.frustumCulled = false; if (o.isMesh) o.renderOrder = 12; });
    this.gun.add(m.root);

    // where the sight sits in gun space -> the ADS offset that puts it on screen centre
    const sight = (def.sightNode === 'irons' ? m.irons : m.optic) || m.optic || m.irons;
    m.sight = sight;
    const sp = sight ? sight.position : new THREE.Vector3(0, 0.04, -0.1);
    m.adsPos = new THREE.Vector3(-sp.x, -sp.y, -def.adsDist - sp.z);

    // collimated dot for the non-magnified optics
    if (m.optic && !def.scope) {
      const style = def.model === 'smg' ? 'holo' : 'dot';
      const ret = makeReticle(style, 0xffffff, style === 'holo' ? 0.062 : 0.046);
      ret.material.depthTest = true;
      ret.material.color.setRGB(style === 'holo' ? 5.5 : 6.5, 0.55, 0.30);
      ret.position.copy(m.optic.position);
      ret.position.z -= 0.006;
      ret.visible = true;
      m.root.add(ret);
      m.reticle = ret;
    }

    m.base = {
      mag: m.mag ? m.mag.position.clone() : null,
      bolt: m.bolt ? m.bolt.position.clone() : null,
      charging: m.charging ? m.charging.position.clone() : null,
      pump: m.pump ? m.pump.position.clone() : null,
      boltRot: m.bolt ? m.bolt.rotation.z : 0,
    };
    this.models[id] = m;
    return m;
  }

  _equipNow(id) {
    if (this.models[this.id]) this.models[this.id].root.visible = false;
    this.id = id;
    this.def = WEAPONS[id];
    const m = this._build(id);
    m.root.visible = true;
    this.shotIndex = 0;
    this.cycleA = null;
    this.reloadA = null;
    this.scope.setZoom(this.def.scopeFov || 20);
    this.ctx.bus.emit('weapon', { id, def: this.def });
  }

  equip(id, instant) {
    if (!WEAPONS[id] || id === this.id) return;
    if (instant) { this._equipNow(id); return; }
    if (this.swap) return;
    this.prevId = this.id;
    this.reloadA = null;
    this.swap = { t: 0, dur: this.def.holsterTime, phase: 'holster', next: id };
  }

  /* ----------------------------------------------------------- firing */

  canFire() {
    return this.cool <= 0 && !this.swap && !this.cycleA && this.ammo > 0 &&
      (!this.reloadA || this.def.rl.shell) && this.sprintT < 0.5;
  }

  fire() {
    const d = this.def, ctx = this.ctx;
    if (this.reloadA && d.rl.shell) this.reloadA = null;   // pump guns fire out of a reload
    this.cool = 60 / d.rpm;
    this.ammo--;
    this.shotIndex++;
    this.sinceShot = 0;
    this.heat = Math.min(1.6, this.heat + 0.14);

    const cam = ctx.camera;
    cam.updateMatrixWorld(true);
    _o.setFromMatrixPosition(cam.matrixWorld);
    _fwd.set(0, 0, -1).transformDirection(cam.matrixWorld);
    _rgt.set(1, 0, 0).transformDirection(cam.matrixWorld);
    _up.set(0, 1, 0).transformDirection(cam.matrixWorld);

    const spread = this.spreadRad;
    const n = d.pellets;
    for (let i = 0; i < n; i++) {
      const ang = this.rng() * 6.283;
      const rad = Math.sqrt(this.rng()) * spread * (n > 1 ? 1 : 1);
      _d.copy(_fwd).addScaledVector(_rgt, Math.cos(ang) * rad).addScaledVector(_up, Math.sin(ang) * rad).normalize();
      this._trace(_o, _d, i === 0 || (this.shotIndex % (d.tracerEvery || 1)) === 0);
    }

    // muzzle flash on the moving muzzle anchor so it tracks recoil exactly
    const m = this.model;
    if (m && m.muzzle) {
      ctx.fx?.muzzleFlash(m.muzzle, { scale: d.pellets > 1 ? 1.5 : d.model === 'sniper' ? 1.45 : 1.0 });
    }

    // recoil
    const [pv, ph] = pattern(d.recoil.pattern, this.shotIndex, this.rng);
    this.rc.tp += d.recoil.v * pv;
    this.rc.ty += d.recoil.h * ph;
    const K = d.recoil;
    this.k.zv += K.kick * 7.5;
    this.k.rxv += K.rot * 7.5;
    this.k.ryv += (this.rng() - 0.5) * K.rot * 3.2;
    this.k.rzv += (this.rng() - 0.5) * K.roll * 9;
    this.k.yv += K.kick * 1.6;
    this.spreadKick = Math.min(d.spreadMax, this.spreadKick + d.spreadKick);
    ctx.fx?.shake(d.model === 'sniper' ? 0.28 : d.pellets > 1 ? 0.22 : 0.06);

    // cycling: bolt/pump animation, shell ejection
    const cycDur = d.cycle;
    this.cycleA = { t: 0, dur: cycDur, ejected: false };
    if (d.pumpAfterShot || d.boltAfterShot) this.cycleA.manual = true;

    ctx.audio?.gunshot(this.id);
    ctx.bus.emit('shot', { id: this.id, ammo: this.ammo });
    if (this.ammo <= 0) this.reload();
  }

  /** One bullet: hit test, penetration chain, tracer, impacts. */
  _trace(origin, dir, showTracer) {
    const ctx = this.ctx, d = this.def;
    const phys = ctx.physics, ai = ctx.ai, fx = ctx.fx;
    _p2.copy(origin);
    let remaining = d.range;
    let dmgMul = 1;
    let endX = origin.x + dir.x * remaining, endY = origin.y + dir.y * remaining, endZ = origin.z + dir.z * remaining;
    let penLeft = d.pen;

    for (let layer = 0; layer < 3; layer++) {
      const hit = phys ? phys.raycast(_p2, dir, remaining) : null;
      const wallDist = hit ? hit.distance : remaining;

      // enemies in front of the wall
      let bot = null;
      if (ai && ai.hitscan) {
        const dist = this._enemyDist(_p2, dir, Math.min(wallDist, remaining));
        const dmg = this._damageAt(dist + (d.range - remaining)) * dmgMul;
        bot = ai.hitscan(_p2.clone(), dir.clone(), remaining, dmg, wallDist);
      }
      if (bot) {
        const pt = bot._pt || (bot.obj && bot.obj.position) || null;
        if (pt) {
          _v3.copy(pt);
          fx?.blood(_v3, _v.copy(dir).negate(), dir);
          endX = _v3.x; endY = _v3.y; endZ = _v3.z;
        }
        break;
      }
      if (!hit) {
        endX = _p2.x + dir.x * remaining; endY = _p2.y + dir.y * remaining; endZ = _p2.z + dir.z * remaining;
        break;
      }

      const surf = fx ? fx.impact(hit.point, hit.normal, null, hit.object) : 'concrete';
      endX = hit.point.x; endY = hit.point.y; endZ = hit.point.z;

      // penetration: probe for the far face within the remaining penetration budget
      const budget = penLeft * (PEN_MUL[surf] || 0.4);
      if (budget < 0.02 || layer === 2) break;
      _v.copy(hit.point).addScaledVector(dir, budget);
      _v2.copy(dir).negate();
      const exit = phys.raycast(_v, _v2, budget);
      if (!exit) break;                                    // too thick, bullet stops
      const thickness = budget - exit.distance;
      fx?.penExit(exit.point, exit.normal, surf);
      penLeft -= Math.max(0.01, thickness) / Math.max(0.05, PEN_MUL[surf] || 0.4);
      dmgMul *= d.penDmg;
      remaining -= hit.distance + (budget - exit.distance) + 0.02;
      if (remaining <= 1) break;
      _p2.copy(exit.point).addScaledVector(dir, 0.02);
    }

    if (showTracer && fx) {
      const m = this.model;
      if (m && m.muzzle) {
        m.muzzle.updateWorldMatrix(true, false);
        _v.setFromMatrixPosition(m.muzzle.matrixWorld);
      } else _v.copy(origin);
      _v2.set(endX, endY, endZ);
      fx.tracer(_v, _v2, { speed: d.muzzleVel * 0.42, width: d.tracerWidth || 0.020 });
    }
  }

  _damageAt(dist) {
    const d = this.def;
    if (dist <= d.near) return d.dmg;
    if (dist >= d.far) return d.dmgFar;
    return d.dmg + (d.dmgFar - d.dmg) * ((dist - d.near) / (d.far - d.near));
  }

  /** Cheap read-only probe of the AI list so damage falloff knows the range. */
  _enemyDist(o, dir, maxD) {
    const ai = this.ctx.ai;
    const list = ai && (ai.bots || ai.agents || ai.enemies);
    if (!list || !list.length) return maxD;
    let best = maxD;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || b.dead) continue;
      const obj = b.obj || b.root || b.mesh || b.group;
      const p = obj && obj.position;
      if (!p) continue;
      const dx = p.x - o.x, dy = p.y + 1.1 - o.y, dz = p.z - o.z;
      const t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t <= 0 || t > best) continue;
      const perp2 = dx * dx + dy * dy + dz * dz - t * t;
      if (perp2 < 1.6) best = t;
    }
    return best;
  }

  /* ----------------------------------------------------------- reload */

  reload() {
    const d = this.def;
    if (this.reloadA || this.swap || this.ammo >= d.mag || this.reserve <= 0) return;
    if (d.rl.shell) {
      this.reloadA = { t: 0, shell: true, next: d.rl.start, dur: 1e9 };
    } else {
      const empty = this.ammo <= 0;
      const dur = d.rl.dur + (empty ? d.rl.extra : 0);
      this.reloadA = { t: 0, dur, empty, done: false, charged: false, chargeAt: empty ? d.rl.dur + 0.10 : 1e9 };
    }
    this.ctx.bus.emit('reload', { id: this.id, empty: this.ammo <= 0 });
  }

  _finishMag() {
    const need = this.def.mag - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take;
    this.reserve -= take;
  }

  _updReload(dt) {
    const r = this.reloadA;
    if (!r) return;
    const d = this.def;
    r.t += dt;
    if (r.shell) {
      if (this.ammo >= d.mag || this.reserve <= 0) {
        if (r.t >= r.next + d.rl.end) this.reloadA = null;
        return;
      }
      if (r.t >= r.next) {
        this.ammo++; this.reserve--;
        r.next = r.t + d.rl.per;
        this.ctx.bus.emit('reload', { id: this.id, shell: true });
      }
      return;
    }
    if (!r.done && r.t >= d.rl.ammo) { r.done = true; this._finishMag(); }
    if (r.t >= r.dur) this.reloadA = null;
  }

  /* ----------------------------------------------------------- animation */

  _updSprings(dt) {
    const k = this.k, S = 190, C = 17;
    k.zv += (-S * k.z - C * k.zv) * dt; k.z += k.zv * dt;
    k.rxv += (-S * k.rx - C * k.rxv) * dt; k.rx += k.rxv * dt;
    k.ryv += (-S * k.ry - C * k.ryv) * dt; k.ry += k.ryv * dt;
    k.rzv += (-S * k.rz - C * k.rzv) * dt; k.rz += k.rzv * dt;
    k.yv += (-S * k.y - C * k.yv) * dt; k.y += k.yv * dt;
  }

  _updCamRecoil(dt) {
    const rc = this.rc, p = this.ctx.player;
    rc.tp *= Math.exp(-dt * 4.2);
    rc.ty *= Math.exp(-dt * 3.4);
    rc.p = damp(rc.p, rc.tp, 26, dt);
    rc.y = damp(rc.y, rc.ty, 22, dt);
    if (p) {
      p.pitch += rc.p - rc.pp;
      p.yaw += rc.y - rc.py;
      if (p.pitch > 1.45) p.pitch = 1.45;
      if (p.pitch < -1.45) p.pitch = -1.45;
    }
    rc.pp = rc.p; rc.py = rc.y;
  }

  /** Animate bolt / pump / charging handle / magazine and fire the ejection event. */
  _updParts(dt) {
    const m = this.model, d = this.def;
    if (!m || !m.base) return;
    const B = m.base;
    let boltBack = 0, pumpBack = 0, chargeBack = 0, boltLift = 0, magDrop = 0, magHide = false;

    const c = this.cycleA;
    if (c) {
      c.t += dt;
      const k = clamp01(c.t / c.dur);
      if (d.boltKind === 'bolt') {
        // lift -> pull -> push -> close
        boltLift = k < 0.2 ? smooth(k / 0.2) : k < 0.75 ? 1 : 1 - smooth((k - 0.75) / 0.25);
        boltBack = k < 0.2 ? 0 : k < 0.5 ? smooth((k - 0.2) / 0.3) : k < 0.8 ? 1 - smooth((k - 0.5) / 0.3) : 0;
      } else if (d.boltKind === 'pump') {
        pumpBack = k < 0.45 ? smooth(k / 0.45) : k < 0.9 ? 1 - smooth((k - 0.45) / 0.45) : 0;
        boltBack = pumpBack;
      } else {
        boltBack = k < 0.45 ? smooth(k / 0.45) : 1 - smooth(clamp01((k - 0.45) / 0.55));
      }
      if (!c.ejected && k >= (d.ejectAt || 0.3)) {
        c.ejected = true;
        this._eject();
      }
      if (k >= 1) this.cycleA = null;
    }

    const r = this.reloadA;
    if (r && !r.shell) {
      const t = r.t;
      magDrop = t < d.rl.out ? smooth(t / d.rl.out) : t < d.rl.in ? 1 : 1 - smooth(clamp01((t - d.rl.in) / 0.22));
      magHide = t > d.rl.out * 0.92 && t < d.rl.in * 0.86;
      if (r.empty) {
        const c0 = r.chargeAt, c1 = c0 + d.rl.chargeDur;
        chargeBack = t < c0 ? 0 : t < (c0 + c1) / 2 ? smooth((t - c0) / ((c1 - c0) / 2)) : 1 - smooth(clamp01((t - (c0 + c1) / 2) / ((c1 - c0) / 2)));
        boltBack = Math.max(boltBack, chargeBack);
      }
    }

    if (m.mag && B.mag) {
      m.mag.position.set(B.mag.x, B.mag.y - magDrop * 0.20, B.mag.z + magDrop * 0.03);
      m.mag.rotation.z = magDrop * 0.35;
      m.mag.visible = !magHide;
    }
    if (m.bolt && B.bolt) {
      const throwLen = m.boltThrow || 0.03;
      m.bolt.position.set(B.bolt.x, B.bolt.y, B.bolt.z + boltBack * throwLen);
      if (d.boltKind === 'bolt') m.bolt.rotation.z = B.boltRot + boltLift * (m.boltLift || 1.1);
    }
    if (m.charging && B.charging) {
      m.charging.position.set(B.charging.x, B.charging.y, B.charging.z + Math.max(chargeBack, boltBack * 0.35) * 0.055);
    }
    if (m.pump && B.pump) {
      m.pump.position.set(B.pump.x, B.pump.y, B.pump.z + pumpBack * (m.pumpThrow || 0.07));
    }
  }

  _eject() {
    const m = this.model;
    if (!m || !m.eject || !this.ctx.fx) return;
    m.eject.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(m.eject.matrixWorld);
    _v2.set(1, 0.35, 0.15).transformDirection(m.eject.matrixWorld).normalize();
    this.ctx.fx.shell(_v, _v2, this.def.model === 'shotgun' ? 1.7 : this.def.model === 'sniper' ? 1.35 : 1);
  }

  /* ----------------------------------------------------------- frame */

  update(dt) {
    const ctx = this.ctx, input = ctx.input, player = ctx.player, cam = ctx.camera;
    const d = this.def;
    this.sinceShot += dt;
    this.cool -= dt;
    this.heat = Math.max(0, this.heat - dt * 0.35);

    const mode = this.mode;
    const capture = !!mode;

    /* ---- input ---- */
    let wantAds = false, wantFire = false, wantSprint = false;
    if (input && input.enabled && !capture) {
      for (let i = 0; i < SLOTS.length; i++) if (input.pressed('Digit' + (i + 1))) this.equip(SLOTS[i]);
      if (input.pressed('KeyQ')) this.equip(this.prevId);
      if (input.pressed('KeyR')) this.reload();
      if (input.pressed('KeyF') && this.inspectT < 0 && !this.swap && !this.reloadA) this.inspectT = 0;
      if (input.pressed('KeyG')) this._throwNade();
      wantAds = !!player.ads;
      wantFire = !!input.mouse.left;
      wantSprint = player.state === 'sprint';
    } else if (capture) {
      wantAds = !!mode.ads;
      wantSprint = !!mode.sprint;
      if (mode.reload !== undefined) {
        if (!this.reloadA) { this.ammo = 4; this.reload(); }
        if (this.reloadA) this.reloadA.t = mode.reload;
      }
      if (mode.inspect !== undefined) this.inspectT = mode.inspect;
      if (mode.fire) {
        this.ammo = d.mag;
        this.cool = 0; this.cycleA = null;
        this.rc.tp = this.rc.ty = 0;
        this.fire();
        this.rc.tp = this.rc.ty = 0;
        this.spreadKick = 0;
        if (ctx.fx) ctx.fx.shakeAmp = 0;
      }
      if (mode.boom && (ctx.frame % 26) === 0) {
        _v.set(0, 0, -1).transformDirection(cam.matrixWorld).multiplyScalar(9).add(cam.position);
        _v.y = Math.max(0.6, _v.y - 0.8);
        ctx.fx?.explosion(_v, 5.5);
      }
    }

    /* ---- weapon swap ---- */
    if (this.swap) {
      this.swap.t += dt;
      if (this.swap.t >= this.swap.dur) {
        if (this.swap.phase === 'holster') {
          this._equipNow(this.swap.next);
          this.swap = { t: 0, dur: this.def.drawTime, phase: 'draw', next: null };
        } else this.swap = null;
      }
    }

    /* ---- ADS / sprint blends ---- */
    const blocked = this.sprintT > 0.35 || !!this.swap;
    this.adsWant = wantAds && !blocked;
    const adsRate = 1 / Math.max(0.05, d.adsTime);
    this.adsT = clamp01(this.adsT + (this.adsWant ? adsRate : -adsRate * 1.25) * dt);
    this.ads = this.adsT > 0.6;
    const sprintRate = wantSprint && !this.adsWant ? 6 : -8;
    this.sprintT = clamp01(this.sprintT + sprintRate * dt);

    /* ---- fire control ---- */
    if (!capture) {
      const trig = wantFire;
      if (trig && (d.auto || !this.triggerWasDown) && this.canFire()) this.fire();
      else if (trig && !this.triggerWasDown && this.ammo <= 0 && !this.reloadA) this.reload();
      this.triggerWasDown = trig;
    }

    /* ---- reload / inspect timers ---- */
    this._updReload(dt);
    if (this.inspectT >= 0 && !capture) { this.inspectT += dt; if (this.inspectT > 2.35) this.inspectT = -1; }

    /* ---- spread model ---- */
    const speed = player ? Math.hypot(player.velocity.x, player.velocity.z) : 0;
    let base = d.spreadHip + speed * 0.0022 + (player && !player.grounded ? 0.03 : 0);
    if (player && player.state === 'crouch') base *= 0.75;
    const adsBase = d.spreadAds + speed * 0.0006;
    base = base + (adsBase - base) * this.adsT;
    this.spreadKick = Math.max(0, this.spreadKick - d.spreadRec * this.spreadKick * dt - 0.0008 * dt);
    this.spreadRad = Math.min(d.spreadMax, base + this.spreadKick * (1 - this.adsT * 0.55));

    /* ---- recoil + springs ---- */
    this._updCamRecoil(dt);
    this._updSprings(dt);
    this._updParts(dt);

    /* ---- barrel smoke after sustained fire ---- */
    if (this.heat > 0.5 && this.sinceShot > 0.25 && this.model && this.model.muzzle && (ctx.frame % 7) === 0) {
      ctx.fx?.barrelSmoke(this.model.muzzle, Math.min(1, this.heat));
    }

    this._pose(dt);
    this._updScope(dt);

    /* ---- FOV: only if the player module isn't driving it ---- */
    const targetFov = ctx.config.fov + (d.adsFov - ctx.config.fov) * this.adsT;
    this.fovTarget = targetFov;
    if (!player || !player.fovOwner) {
      cam.fov = damp(cam.fov, targetFov, 14, dt);
      cam.updateProjectionMatrix();
    }
  }

  /** Compose sway, breathing, bob, pose blends, recoil and lag into the gun node. */
  _pose(dt) {
    const ctx = this.ctx, player = ctx.player, d = this.def, m = this.model;
    if (!m) return;

    /* look-velocity sway (from the actual view delta, so it works in capture too) */
    let dy = 0, dp = 0;
    if (player) {
      dy = player.yaw - this.lastYaw;
      if (dy > Math.PI) dy -= 2 * Math.PI; else if (dy < -Math.PI) dy += 2 * Math.PI;
      dp = player.pitch - this.lastPitch;
      this.lastYaw = player.yaw; this.lastPitch = player.pitch;
    }
    const swayScale = (1 - this.adsT * 0.72);
    this.sway.tx = THREE.MathUtils.clamp(-dy / Math.max(dt, 1e-3) * 0.010, -0.09, 0.09);
    this.sway.ty = THREE.MathUtils.clamp(dp / Math.max(dt, 1e-3) * 0.010, -0.07, 0.07);
    this.sway.x = damp(this.sway.x, this.sway.tx, 9, dt);
    this.sway.y = damp(this.sway.y, this.sway.ty, 9, dt);

    /* breathing */
    this.breath += dt;
    const br = Math.sin(this.breath * 1.15), br2 = Math.sin(this.breath * 0.74 + 1.1);
    const brAmp = (this.adsT > 0.5 ? 0.0016 : 0.0042);

    /* walk / sprint bob */
    const speed = player ? Math.hypot(player.velocity.x, player.velocity.z) : 0;
    const moving = speed > 0.35;
    this.bobPhase += dt * (2.6 + speed * 1.35);
    const bobAmp = Math.min(1, speed / 6.0) * (1 - this.adsT * 0.78);
    const bx = Math.sin(this.bobPhase) * 0.022 * bobAmp;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.017 * bobAmp;
    const brz = Math.sin(this.bobPhase) * 0.030 * bobAmp;

    /* pose blend: hip -> ads -> sprint */
    const hip = d.hip, hr = d.hipRot;
    let px = hip[0], py = hip[1], pz = hip[2];
    let rx = hr[0], ry = hr[1], rz = hr[2];
    const a = this.adsT, as = smooth(a);
    px += (m.adsPos.x - hip[0]) * as;
    py += (m.adsPos.y - hip[1]) * as;
    pz += (m.adsPos.z - hip[2]) * as;
    rx += (0 - hr[0]) * as; ry += (0 - hr[1]) * as; rz += (0 - hr[2]) * as;

    const sp = smooth(this.sprintT) * (1 - as);
    px += (0.075) * sp; py += (-0.075) * sp; pz += (0.075) * sp;
    rx += (0.22) * sp; ry += (-0.62) * sp; rz += (0.62) * sp;

    /* draw / holster */
    if (this.swap) {
      const k = clamp01(this.swap.t / this.swap.dur);
      const w = this.swap.phase === 'holster' ? smooth(k) : 1 - smooth(k);
      py -= 0.24 * w; pz += 0.06 * w;
      rx += 1.05 * w; rz += 0.35 * w; ry += 0.30 * w;
    }

    /* reload pose */
    const r = this.reloadA;
    if (r) {
      const dur = r.shell ? 0.9 : r.dur;
      const t = r.shell ? Math.min(r.t, 0.9) : r.t;
      const w = hump(t, 0, dur) * (1 - as * 0.6);
      px -= 0.030 * w; py -= 0.048 * w; pz += 0.020 * w;
      rx += 0.20 * w; ry += 0.30 * w; rz += 0.36 * w;
      if (!r.shell && r.empty) {
        const c0 = r.chargeAt;
        const w2 = hump(r.t, c0 - 0.06, c0 + d.rl.chargeDur + 0.06);
        ry += 0.34 * w2; rz += 0.10 * w2; px -= 0.02 * w2;
      }
    }

    /* inspect */
    if (this.inspectT >= 0) {
      const t = this.inspectT;
      const w = hump(t, 0, 2.35);
      const s1 = hump(t, 0.1, 1.1), s2 = hump(t, 1.15, 2.2);
      px -= 0.035 * w; py += 0.030 * w; pz += 0.075 * w;
      rx += 0.10 * w - 0.35 * s2;
      ry += -1.15 * s1 + 0.55 * s2;
      rz += 0.55 * s1 - 0.30 * s2;
    }

    /* recoil springs */
    const k = this.k;
    pz += k.z * 0.16;
    py += k.y * 0.030;
    rx -= k.rx * 0.16;
    ry += k.ry * 0.10;
    rz += k.rz * 0.10;

    /* sway + breathing + bob */
    px += (this.sway.x + bx) * swayScale + br2 * brAmp * 0.6;
    py += (this.sway.y + by) * swayScale + br * brAmp;
    rz += (-this.sway.x * 1.6 + brz) * swayScale;
    rx += -this.sway.y * 1.2 * swayScale;
    ry += this.sway.x * 0.9 * swayScale;

    this.gun.position.set(px, py, pz);
    this.gun.rotation.set(rx, ry, rz);

    /* weapon lag against any camera offset the player module publishes */
    const vo = player && player.viewOffset;
    const vr = player && player.viewRoll;
    if (vo) this.rig.position.set(-vo.x * 0.22, -vo.y * 0.22, -(vo.z || 0) * 0.15);
    else this.rig.position.set(0, 0, 0);
    this.rig.rotation.z = vr ? -vr * 0.45 : 0;
  }

  _updScope(dt) {
    const d = this.def;
    const want = d.scope ? clamp01((this.adsT - 0.55) / 0.42) : 0;
    this.scopeBlend = damp(this.scopeBlend, want, 22, dt);
    if (this.scopeBlend > 0.003) {
      const sway = this.sway;
      const vig = 0.10 + Math.min(0.5, Math.abs(sway.x) * 2.2 + Math.abs(sway.y) * 2.2) + (1 - this.scopeBlend) * 0.5;
      this._hide = this._hide || [];
      this._hide[0] = this.rig; this._hide[1] = this.scope.quad;
      this.scope.renderRT(this._hide, d.scopeFov || 7);
      this.scope.update(dt, this.scopeBlend, sway.x * 0.22, sway.y * 0.22, vig);
      if (this.model) this.model.root.visible = this.scopeBlend < 0.85;
    } else {
      this.scope.update(dt, 0, 0, 0, 0);
      if (this.model) this.model.root.visible = true;
    }
  }

  _throwNade() {
    const ctx = this.ctx, cam = ctx.camera;
    if (!ctx.fx || !ctx.fx.grenade) return;
    cam.updateMatrixWorld(true);
    _o.setFromMatrixPosition(cam.matrixWorld);
    _fwd.set(0, 0, -1).transformDirection(cam.matrixWorld);
    _v.copy(_fwd).multiplyScalar(15);
    _v.y += 3.2;
    if (ctx.player) _v.add(ctx.player.velocity);
    ctx.fx.grenade(_o.clone().addScaledVector(_fwd, 0.4), _v, 2.3);
  }
}
