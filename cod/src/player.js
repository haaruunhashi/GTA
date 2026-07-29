// First-person player: movement state machine, stances, slide/mantle, camera feel.
// Owner: player agent.
//
// Public API
//   update(dt)
//   position (feet, THREE.Vector3), velocity, yaw, pitch, ads, hp, state
//   stance ('stand'|'crouch'|'prone'), grounded, speed, eyeHeight
//   viewOffset (THREE.Vector3, camera-local: +x right, +y world-up, +z forward)
//   viewRoll  (radians)  — weapons.js composes with both; FOV belongs to weapons.
//   canFire, adsAllowed  — sprint-out / mantle lockouts for weapons.js
//   damage(n, dir) / kill() / respawn() / teleport(v)
//   inputOverride — {fwd,strafe,mx,my,jump,sprint,tac,crouch,prone,ads,walk}
//                   set by tools/movetest.mjs to script the controller headlessly.
//
// Bus events emitted: 'footstep' {surface,speed}, 'land' {impact}, 'slide',
//                     'mantle' {height}, 'jump', 'death', 'respawn'.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const toward = (cur, tgt, maxDelta) => (cur < tgt ? Math.min(cur + maxDelta, tgt) : Math.max(cur - maxDelta, tgt));

// --- tuning ---------------------------------------------------------------
// Speeds in m/s. Timings in seconds. Numbers chosen to sit where a modern CoD
// sits: near-instant accel, slightly slower stop, hard directional penalties.
export const MOVE = {
  walk: 4.5,
  sprint: 6.5,
  tacSprint: 8.4,
  crouch: 2.35,
  prone: 1.05,
  adsMul: 0.55,
  walkMul: 0.48,          // "walk" modifier key
  strafeMul: 0.86,
  backMul: 0.76,

  accel: 70,              // ~0.1s to top speed
  decel: 42,              // ~0.15s to a stop
  airAccel: 26,
  airCap: 3.4,            // air control can only redirect, not add speed past this
  airDrag: 0.35,

  jumpVel: 6.3,           // ~0.9 m apex at g = -22
  jumpCooldown: 0.28,
  coyote: 0.09,
  jumpBuffer: 0.12,

  sprintIn: 0.10,         // hold-to-sprint ramp
  sprintOut: 0.20,        // no firing for this long after sprint ends
  tacSprintTime: 4.0,     // tac sprint falls back to normal sprint after this
  doubleTap: 0.30,

  slideTime: 0.60,
  slideBoost: 1.28,
  slideEndSpeed: 2.6,
  slideCooldown: 0.55,
  slideSteer: 2.6,        // rad/s the slide direction can be curved

  crouchTime: 0.20,
  proneTime: 0.36,

  standH: 1.80, crouchH: 1.20, proneH: 0.62,
  standEye: 1.62, crouchEye: 1.02, proneEye: 0.40, slideEye: 0.84,
  radius: 0.36,

  mantleMin: 0.38, mantleMax: 2.05,
  mantleReach: 0.85,

  strideLen: 1.62,
  regenDelay: 4.5,
  regenRate: 34,
  respawnTime: 3.0,
  fallSafe: 13.0,         // impact speed below this does no damage
  fallDmg: 9.0,
};

// A tiny damped spring — used for every camera impulse (footfalls, landings,
// hits, mantles) so the view never reads as a looping sine.
class Spring {
  constructor(k, d, n = 1) {
    this.k = k; this.d = d;
    this.x = n === 1 ? 0 : new Float64Array(n);
    this.v = n === 1 ? 0 : new Float64Array(n);
    this.n = n;
  }
  step(dt) {
    // sub-step so a stiff spring stays stable on a long frame
    const it = dt > 1 / 90 ? Math.ceil(dt * 90) : 1, h = dt / it;
    for (let i = 0; i < it; i++) {
      if (this.n === 1) {
        this.v += (-this.k * this.x - this.d * this.v) * h;
        this.x += this.v * h;
      } else {
        for (let j = 0; j < this.n; j++) {
          this.v[j] += (-this.k * this.x[j] - this.d * this.v[j]) * h;
          this.x[j] += this.v[j] * h;
        }
      }
    }
  }
  kick(a, j = 0) { if (this.n === 1) this.v += a; else this.v[j] += a; }
}

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    const sp = (ctx.world && ctx.world.spawnPoints && ctx.world.spawnPoints[0]) || null;

    this.position = new THREE.Vector3(sp ? sp.x : 0, sp ? sp.y : 0, sp ? sp.z : 40);
    this.velocity = new THREE.Vector3();
    this.yaw = sp && sp.yaw != null ? sp.yaw : Math.PI;
    this.pitch = 0;
    this.sens = 0.0022;

    this.radius = MOVE.radius;
    this.height = MOVE.standH;
    this.eyeHeight = MOVE.standEye;

    this.state = 'idle';     // idle|walk|sprint|tacsprint|crouch|prone|air|slide|mantle|dead
    this.stance = 'stand';   // stand|crouch|prone
    this.grounded = true;
    this.wasGrounded = true;
    this.speed = 0;
    this.ads = false;
    this.adsAllowed = true;
    this.canFire = true;
    this.hp = 100; this.maxHp = 100; this.dead = false;

    this.viewOffset = new THREE.Vector3();
    this.viewRoll = 0;

    // --- internals ---
    this._prev = {};                 // edge detection over any input source
    this.inputOverride = null;
    this.in = { fwd: 0, strafe: 0, mx: 0, my: 0 };

    this._sprintHold = 0;
    this._sprintOutT = 0;
    this._tacT = 0;
    this._lastSprintTap = -9;
    this._tacArmed = false;
    this._sprinting = false;

    this._slideT = 0; this._slideCD = 0; this._slideDir = new THREE.Vector3(0, 0, -1);
    this._slideSpeed = 0; this._slideRoll = 0;

    this._jumpCD = 0; this._airT = 0; this._jumpBuf = 0; this._wallT = 0;
    this._slideK = 3; this._mantleArc = 0; this._viewPitch = 0; this._viewYaw = 0;
    this.stepped = false; this.targetSpeed = 0;
    this._proneToggle = false;

    this._mantle = null;
    this._mantleCD = 0;

    this._stridePhase = 0; this._footL = false;
    this._breath = 0; this._idleT = 0;
    this._bob = new Spring(150, 15, 3);   // x,y,z camera-local bob/land/hit
    this._ang = new Spring(120, 13, 2);   // pitch, yaw kick
    this._rollS = new Spring(110, 14);    // roll kick
    this._rollTarget = 0;

    this._regenT = 0; this._respawnT = 0;
    this._pendingDmg = 0; this._hpAtHit = this.hp;

    this._fwd = new THREE.Vector3(); this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3(); this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3(); this._probe = new THREE.Vector3();

    if (ctx.bus) {
      ctx.bus.on('playerHit', p => {
        const dmg = (p && p.dmg) || 0;
        this._regenT = 0;
        this._pendingDmg += dmg;                 // ui.js may already subtract it
        this._hpAtHit = this.hp;
        const a = (this.ctx.rng ? this.ctx.rng() : Math.random()) * TAU;
        const s = clamp(dmg / 30, 0.15, 1);
        this._ang.kick(-26 * s * Math.abs(Math.cos(a)), 0);
        this._ang.kick(18 * s * Math.sin(a), 1);
        this._rollS.kick(24 * s * Math.sin(a));
        this._bob.kick(-2.0 * s * Math.sin(a), 0);
        this._bob.kick(-1.5 * s, 1);
      });
      ctx.bus.on('explosion', () => { this._regenT = 0; });
    }
  }

  // ---------------------------------------------------------------- helpers
  get moving() { return this.in.fwd !== 0 || this.in.strafe !== 0; }
  get sprinting() { return this._sprinting; }
  get sliding() { return this._slideT > 0; }
  get mantling() { return !!this._mantle; }
  /** Eye position in world space (before view offsets) — AI / weapons use this. */
  eyePos(out) { return (out || new THREE.Vector3()).set(this.position.x, this.position.y + this.eyeHeight, this.position.z); }

  teleport(v, yaw) {
    this.position.copy(v);
    this.velocity.set(0, 0, 0);
    if (yaw != null) this.yaw = yaw;
    this._mantle = null; this._slideT = 0;
    this.state = 'idle';
  }

  damage(n, dir) {
    if (this.dead) return;
    this.hp = Math.max(0, this.hp - n);
    this._regenT = 0;
    const s = clamp(n / 30, 0.15, 1);
    this._ang.kick(-26 * s, 0);
    this._bob.kick(-1.5 * s, 1);
    if (dir) this._rollS.kick(24 * s * Math.sign(dir));
    if (this.hp <= 0) this.kill();
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.state = 'dead';
    this._mantle = null;
    this._slideT = 0;
    this._respawnT = MOVE.respawnTime;
    this.ads = false;
    this._ang.kick(-130, 0);
    this._rollS.kick(94);
    if (this.ctx.bus) this.ctx.bus.emit('death', { pos: this.position.clone() });
  }

  respawn() {
    const w = this.ctx.world;
    const pts = (w && w.spawnPoints) || [];
    let p = null;
    if (pts.length) {
      const r = this.ctx.rng ? this.ctx.rng() : Math.random();
      p = pts[Math.min(pts.length - 1, Math.floor(r * pts.length))];
    }
    this.position.set(p ? p.x : 0, (p && p.y != null ? p.y : 0) + 0.05, p ? p.z : 40);
    this.velocity.set(0, 0, 0);
    if (p && p.yaw != null) this.yaw = p.yaw;
    this.pitch = 0;
    this.hp = this.maxHp;
    this.dead = false;
    this.stance = 'stand';
    this.height = MOVE.standH; this.eyeHeight = MOVE.standEye;
    this.state = 'idle';
    this._slideT = 0; this._slideCD = 0; this._mantle = null;
    this._proneToggle = false; this._regenT = 0; this._respawnT = 0;
    this._bob.x[0] = this._bob.x[1] = this._bob.x[2] = 0;
    this._bob.v[0] = this._bob.v[1] = this._bob.v[2] = 0;
    this._ang.x[0] = this._ang.x[1] = this._ang.v[0] = this._ang.v[1] = 0;
    this._rollS.x = this._rollS.v = 0;
    this.viewRoll = 0; this.viewOffset.set(0, 0, 0);
    if (this.ctx.bus) this.ctx.bus.emit('respawn', { pos: this.position.clone() });
  }

  // ------------------------------------------------------------------ input
  _read(dt) {
    const o = this.inputOverride;
    const inp = this.ctx.input;
    const s = { fwd: 0, strafe: 0, mx: 0, my: 0, jump: false, sprint: false, tac: false, crouch: false, prone: false, ads: false, walk: false };
    if (o) {
      if (o.fwd) s.fwd = clamp(o.fwd, -1, 1);
      if (o.strafe) s.strafe = clamp(o.strafe, -1, 1);
      s.mx = o.mx || 0; s.my = o.my || 0;
      s.jump = !!o.jump; s.sprint = !!o.sprint; s.tac = !!o.tac;
      s.crouch = !!o.crouch; s.prone = !!o.prone; s.ads = !!o.ads; s.walk = !!o.walk;
    } else if (inp && inp.enabled) {
      if (inp.down('KeyW') || inp.down('ArrowUp')) s.fwd += 1;
      if (inp.down('KeyS') || inp.down('ArrowDown')) s.fwd -= 1;
      if (inp.down('KeyD') || inp.down('ArrowRight')) s.strafe += 1;
      if (inp.down('KeyA') || inp.down('ArrowLeft')) s.strafe -= 1;
      s.mx = inp.mouse.dx; s.my = inp.mouse.dy;
      s.jump = inp.down('Space');
      s.sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
      s.crouch = inp.down('ControlLeft') || inp.down('ControlRight');
      s.prone = inp.down('KeyC') || inp.down('KeyX');
      s.ads = !!inp.mouse.right;
      s.walk = inp.down('AltLeft');
    }
    // edges (source-agnostic)
    const p = this._prev;
    s.jumpP = s.jump && !p.jump;
    s.crouchP = s.crouch && !p.crouch;
    s.proneP = s.prone && !p.prone;
    s.sprintP = s.sprint && !p.sprint;
    this._prev = { jump: s.jump, crouch: s.crouch, prone: s.prone, sprint: s.sprint };
    this.in = s;
    return s;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    dt = clamp(dt || 0, 0, 0.05);
    const { camera, config } = this.ctx;

    // Deterministic capture mode: the pose owns the camera completely.
    if (config && config.shot) {
      this.viewOffset.set(0, 0, 0); this.viewRoll = 0;
      this.state = 'idle';
      if (camera) {
        camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
        camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      }
      return;
    }

    const s = this._read(dt);
    this._look(s, dt);

    if (this.dead) {
      this._deadUpdate(dt);
      this._applyCamera(dt);
      return;
    }

    // timers
    this._slideCD = Math.max(0, this._slideCD - dt);
    this._jumpCD = Math.max(0, this._jumpCD - dt);
    this._mantleCD = Math.max(0, this._mantleCD - dt);
    this._sprintOutT = Math.max(0, this._sprintOutT - dt);
    this._jumpBuf = s.jumpP ? MOVE.jumpBuffer : Math.max(0, this._jumpBuf - dt);

    this._basis();

    if (this._mantle) {
      this._mantleUpdate(dt);
    } else {
      this._stance(s, dt);
      this._locomotion(s, dt);
      this._sweep(dt);
    }

    this._health(dt);
    this._cameraFeel(s, dt);
    this._applyCamera(dt);
  }

  _look(s, dt) {
    if (this.dead) return;
    const m = this.sens * (this.ads ? 0.62 : 1) * (this.mantling ? 0.5 : 1);
    this.yaw -= s.mx * m;
    this.pitch = clamp(this.pitch - s.my * m, -1.48, 1.48);
    if (this.yaw > TAU) this.yaw -= TAU; else if (this.yaw < -TAU) this.yaw += TAU;
  }

  _basis() {
    this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  // ----------------------------------------------------------------- stances
  _stance(s, dt) {
    // prone toggles, crouch is a hold (with slide taking priority)
    if (s.proneP) {
      this._proneToggle = this.stance !== 'prone';
      if (this._proneToggle) this.stance = 'prone';
      else this.stance = s.crouch ? 'crouch' : 'stand';
    } else if (this.stance === 'prone') {
      if (s.jumpP || (s.crouchP && !this.sliding) || s.sprintP) { this.stance = 'crouch'; this._proneToggle = false; }
    }

    if (this.stance !== 'prone' && !this.sliding) {
      this.stance = s.crouch ? 'crouch' : 'stand';
    }
    if (this.sliding) this.stance = 'crouch';

    // target capsule for the stance; never grow into geometry
    let tH = MOVE.standH, tEye = MOVE.standEye, rate = 1 / MOVE.crouchTime;
    if (this.sliding) { tH = MOVE.crouchH; tEye = MOVE.slideEye; rate = 1 / 0.12; }
    else if (this.stance === 'crouch') { tH = MOVE.crouchH; tEye = MOVE.crouchEye; }
    else if (this.stance === 'prone') { tH = MOVE.proneH; tEye = MOVE.proneEye; rate = 1 / MOVE.proneTime; }
    if (this.stance === 'prone' || this.height < MOVE.crouchH) rate = 1 / MOVE.proneTime;

    if (tH > this.height) {
      // blocked from standing up? stay low.
      this._probe.copy(this.position);
      if (this.ctx.physics && this.ctx.physics.capsuleOverlaps(this._probe, this.radius, tH + 0.02)) {
        tH = this.height; tEye = this.eyeHeight;
      }
    }
    const step = Math.max(Math.abs(MOVE.standH - MOVE.crouchH), 0.01) * rate * dt;
    this.height = toward(this.height, tH, step);
    this.eyeHeight = toward(this.eyeHeight, tEye, Math.max(Math.abs(MOVE.standEye - MOVE.crouchEye), 0.01) * rate * dt);
  }

  _stanceSpeed() {
    if (this.stance === 'prone') return MOVE.prone;
    if (this.stance === 'crouch') return MOVE.crouch;
    return MOVE.walk;
  }

  // ------------------------------------------------------------- locomotion
  _locomotion(s, dt) {
    const wish = this._wish.set(0, 0, 0);
    let f = s.fwd, st = s.strafe;
    const len = Math.hypot(f, st);
    if (len > 1e-4) {
      f /= len; st /= len;
      wish.copy(this._fwd).multiplyScalar(f).addScaledVector(this._right, st).normalize();
    }
    const hasWish = len > 1e-4;

    // ---- sprint state machine (in-delay, tac double tap, out lockout) ----
    const now = this.ctx.time || 0;
    if (s.sprintP) {
      if (now - this._lastSprintTap < MOVE.doubleTap) this._tacArmed = true;
      this._lastSprintTap = now;
    }
    if (s.tac) this._tacArmed = true;
    // sprint survives a short hop (CoD keeps you sprinting over a gap)
    const canSprint = hasWish && f > 0.32 && (this.grounded || this._airT < 0.6) && !this.sliding &&
      this.stance === 'stand' && !s.ads && !s.walk && !this._mantle;
    if (s.sprint && canSprint) this._sprintHold = Math.min(this._sprintHold + dt, 1);
    else if (!s.sprint || !hasWish) this._sprintHold = 0;

    const wasSprinting = this._sprinting;
    this._sprinting = s.sprint && canSprint && this._sprintHold >= MOVE.sprintIn;
    if (this._sprinting) {
      this._tacT += dt;
      if (this._tacT > MOVE.tacSprintTime) this._tacArmed = false;
    } else {
      this._tacT = 0;
      if (!s.sprint) this._tacArmed = false;
    }
    const tac = this._sprinting && this._tacArmed;
    if (wasSprinting && !this._sprinting) this._sprintOutT = MOVE.sprintOut;

    this.adsAllowed = !this._sprinting && !this.sliding && !this._mantle;
    this.ads = s.ads && this.adsAllowed;
    this.canFire = !this._sprinting && this._sprintOutT <= 0 && !this._mantle && !this.dead;

    // ---- slide entry ----
    if (s.crouchP && !this.sliding && this._slideCD <= 0 && this.grounded &&
      (wasSprinting || this._sprinting || this.speed > MOVE.walk * 1.02)) {
      this._enterSlide();
    }

    // ---- jump / mantle ----
    if (this._jumpBuf > 0 && this._jumpCD <= 0 && !this._mantle) {
      const airOk = this.grounded || this._airT < MOVE.coyote;
      if (this._mantleCD <= 0 && this._tryMantle()) {
        this._jumpBuf = 0;
      } else if (airOk && this.stance !== 'prone') {
        this._jumpBuf = 0;
        if (this.sliding) this._exitSlide(true);
        this.velocity.y = MOVE.jumpVel;
        this.grounded = false;
        this._jumpCD = MOVE.jumpCooldown;
        this._airT = MOVE.coyote;
        this._bob.kick(0.8, 1);
        if (this.ctx.bus) this.ctx.bus.emit('jump', { pos: this.position.clone() });
      } else if (this.stance === 'prone') {
        this._jumpBuf = 0;
        this.stance = 'crouch'; this._proneToggle = false;
      }
    }
    // auto-vault: running into waist-high geometry keeps the flow going
    if (!this._mantle && this._mantleCD <= 0 && this.grounded && this._wallT > 0.06 &&
      (this._sprinting || this.speed > MOVE.walk * 0.85) && f > 0.5) {
      this._tryMantle(1.25);
    }
    if (this._mantle) return;

    // ---- target speed ----
    let target = this._stanceSpeed();
    if (this._sprinting) target = tac ? MOVE.tacSprint : MOVE.sprint;
    if (this.ads && this.stance !== 'prone') target *= MOVE.adsMul;
    if (s.walk) target *= MOVE.walkMul;
    // directional penalty (blends smoothly around the circle)
    if (hasWish && !this._sprinting) {
      const fm = f >= 0 ? 1 : MOVE.backMul;
      target *= Math.sqrt((f * fm) * (f * fm) + (st * MOVE.strafeMul) * (st * MOVE.strafeMul));
    }
    this.targetSpeed = target;

    if (this.sliding) {
      this._slideUpdate(dt, s, wish, hasWish);
    } else if (this.grounded) {
      const vx = this.velocity.x, vz = this.velocity.z;
      const tx = hasWish ? wish.x * target : 0, tz = hasWish ? wish.z * target : 0;
      const cur = Math.hypot(vx, vz);
      const rate = (hasWish && cur < target + 0.2 ? MOVE.accel : MOVE.decel) * dt;
      const dx = tx - vx, dz = tz - vz;
      const dl = Math.hypot(dx, dz);
      if (dl <= rate || dl < 1e-6) { this.velocity.x = tx; this.velocity.z = tz; }
      else { this.velocity.x += (dx / dl) * rate; this.velocity.z += (dz / dl) * rate; }
    } else {
      // air control: redirect, don't accelerate past the cap
      if (hasWish) {
        const proj = this.velocity.x * wish.x + this.velocity.z * wish.z;
        const cap = Math.max(target, MOVE.airCap);
        const add = Math.min(MOVE.airAccel * dt, Math.max(0, cap - proj));
        this.velocity.x += wish.x * add;
        this.velocity.z += wish.z * add;
      }
      const drag = Math.max(0, 1 - MOVE.airDrag * dt);
      this.velocity.x *= drag; this.velocity.z *= drag;
    }

    // ---- state label ----
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.sliding) this.state = 'slide';
    else if (!this.grounded) this.state = 'air';
    else if (this._sprinting) this.state = tac ? 'tacsprint' : 'sprint';
    else if (this.stance === 'prone') this.state = 'prone';
    else if (this.stance === 'crouch') this.state = 'crouch';
    else this.state = sp > 0.35 ? 'walk' : 'idle';
  }

  // --------------------------------------------------------------- the slide
  _enterSlide() {
    const sp = Math.hypot(this.velocity.x, this.velocity.z);
    this._slideDir.set(this.velocity.x, 0, this.velocity.z);
    if (this._slideDir.lengthSq() < 1e-6) this._slideDir.copy(this._fwd);
    this._slideDir.normalize();
    this._slideSpeed = Math.max(sp, MOVE.walk) * MOVE.slideBoost;
    // fixed decay rate: from the entry speed down to slideEndSpeed over slideTime
    this._slideK = Math.log(Math.max(this._slideSpeed / MOVE.slideEndSpeed, 1.05)) / MOVE.slideTime;
    this._slideT = MOVE.slideTime;
    this.stance = 'crouch';
    this._sprinting = false;
    this._sprintHold = 0;
    this._sprintOutT = MOVE.sprintOut;
    // sign of the camera roll follows which way you're leaning off your run line
    const cross = this._fwd.x * this._slideDir.z - this._fwd.z * this._slideDir.x;
    this._slideRoll = Math.abs(cross) > 0.08 ? Math.sign(cross) : 1;
    this._bob.kick(-3.0, 1);
    this._ang.kick(18, 0);
    if (this.ctx.bus) this.ctx.bus.emit('slide', { speed: this._slideSpeed, pos: this.position.clone() });
  }

  _slideUpdate(dt, s, wish, hasWish) {
    this._slideT -= dt;
    // Momentum decay: the boost is held for the first fraction of the slide and
    // then bleeds off hard, so 0.6 s lands right around a crouch-walk.
    const u = 1 - clamp(this._slideT / MOVE.slideTime, 0, 1);
    const k = this._slideK * (0.35 + 1.3 * u);
    this._slideSpeed = Math.max(0, this._slideSpeed * (1 - k * dt) - 0.8 * dt);
    // slight steering
    if (hasWish) {
      const cross = this._slideDir.x * wish.z - this._slideDir.z * wish.x;
      const a = clamp(-cross, -1, 1) * MOVE.slideSteer * dt;
      const cs = Math.cos(a), sn = Math.sin(a);
      const x = this._slideDir.x * cs + this._slideDir.z * sn;
      const z = -this._slideDir.x * sn + this._slideDir.z * cs;
      this._slideDir.set(x, 0, z).normalize();
    }
    this.velocity.x = this._slideDir.x * this._slideSpeed;
    this.velocity.z = this._slideDir.z * this._slideSpeed;
    if (this._slideT <= 0 || this._slideSpeed <= MOVE.slideEndSpeed || !this.grounded) this._exitSlide(false);
  }

  _exitSlide(canceled) {
    if (this._slideT <= 0 && !canceled) this._slideT = 0;
    this._slideT = 0;
    this._slideCD = MOVE.slideCooldown;
    this._bob.kick(0.5, 1);
    if (!this.in.crouch) this.stance = 'stand';
  }

  // -------------------------------------------------------- mantle and vault
  /** Find a ledge in front of the player. Returns {top, dist, height} or null. */
  _probeLedge(maxH) {
    const ph = this.ctx.physics;
    if (!ph || !ph.rayBoxes) return null;
    const top = MOVE.mantleMax;
    const hi = Math.min(maxH != null ? maxH : top, top);
    const feet = this.position.y;
    const reach = this.radius + MOVE.mantleReach;

    // 1) is there something in front at chest / knee height?
    let wallDist = -1;
    for (const h of [0.35, 0.75, 1.15, 1.55]) {
      if (h > hi + 0.35) break;
      this._tmp.set(this.position.x, feet + h, this.position.z);
      const hit = ph.rayBoxes(this._tmp, this._fwd, reach);
      if (hit && Math.abs(hit.normal.y) < 0.5) { wallDist = hit.distance; break; }
    }
    if (wallDist < 0) return null;

    // 2) drop a ray behind the lip to find the surface we'd end up on
    const down = this._tmp2.set(0, -1, 0);
    for (const push of [0.34, 0.62, 0.95]) {
      const d = wallDist + this.radius * 0.6 + push;
      if (d > reach + 0.9) break;
      this._tmp.set(this.position.x + this._fwd.x * d, feet + hi + 0.55, this.position.z + this._fwd.z * d);
      const hit = ph.rayBoxes(this._tmp, down, hi + 0.55 + 0.05);
      if (!hit || hit.normal.y < 0.6) continue;
      const topY = hit.point.y;
      const height = topY - feet;
      if (height < MOVE.mantleMin || height > hi + 1e-3) continue;
      // 3) is there room to stand (or at least crouch) up there?
      this._probe.set(this._tmp.x, topY + 0.02, this._tmp.z);
      const stand = !ph.capsuleOverlaps(this._probe, this.radius, MOVE.standH);
      const crouch = stand || !ph.capsuleOverlaps(this._probe, this.radius, MOVE.crouchH);
      if (!crouch) continue;
      return { x: this._probe.x, y: topY + 0.02, z: this._probe.z, height, stand };
    }
    return null;
  }

  _tryMantle(maxH) {
    const l = this._probeLedge(maxH);
    if (!l) return false;
    const dur = 0.30 + 0.26 * clamp(l.height / MOVE.mantleMax, 0, 1);
    this._mantle = {
      t: 0, dur,
      from: this.position.clone(),
      to: new THREE.Vector3(l.x, l.y, l.z),
      height: l.height, stand: l.stand,
    };
    this.state = 'mantle';
    this.velocity.set(0, 0, 0);
    this._slideT = 0;
    this.ads = false;
    this.canFire = false;
    this._bob.kick(-1.6, 1);
    this._ang.kick(-40, 0);
    if (this.ctx.bus) this.ctx.bus.emit('mantle', { height: l.height, pos: this.position.clone() });
    return true;
  }

  _mantleUpdate(dt) {
    const m = this._mantle;
    m.t += dt;
    const u = clamp(m.t / m.dur, 0, 1);
    // rise first, then translate over the lip — a smooth arc, not a lerp
    const uy = clamp(u / 0.62, 0, 1);
    const ey = 1 - Math.pow(1 - uy, 3);
    const ux = clamp((u - 0.22) / 0.78, 0, 1);
    const ex = ux * ux * (3 - 2 * ux);
    this.position.x = m.from.x + (m.to.x - m.from.x) * ex;
    this.position.z = m.from.z + (m.to.z - m.from.z) * ex;
    this.position.y = m.from.y + (m.to.y - m.from.y) * ey;
    this.grounded = false;
    this.speed = 0;
    this.state = 'mantle';
    this.canFire = false;
    this.adsAllowed = false;
    // camera arc: dip and lean into the climb
    const arc = Math.sin(u * Math.PI);
    this.viewOffset.set(0, 0, 0);
    this._bob.x[1] -= 0;             // spring keeps its own state
    this._mantleArc = arc;
    if (u >= 1) {
      this._mantle = null;
      this._mantleCD = 0.22;
      this._mantleArc = 0;
      this.grounded = true;
      this.velocity.set(this._fwd.x * 1.8, 0, this._fwd.z * 1.8);
      if (!m.stand) this.stance = 'crouch';
      this._sweep(1 / 120);
      this._bob.kick(-2.0, 1);
    }
  }

  // ------------------------------------------------------------------ sweep
  _sweep(dt) {
    const ph = this.ctx.physics;
    if (!ph) { this.position.addScaledVector(this.velocity, dt); return; }
    // Split long frames so grounding/step-up stay exact and nothing tunnels.
    const iters = clamp(Math.ceil(dt / (1 / 90)), 1, 4);
    const h = dt / iters;
    const stepH = this.stance === 'prone' ? 0.16 : this.stance === 'crouch' ? 0.32 : 0.45;
    let grounded = false, landed = 0, wall = false, stepped = false;
    this.wasGrounded = this.grounded;
    let was = this.grounded;
    for (let i = 0; i < iters; i++) {
      const r = ph.moveCapsule(this.position, this.velocity, this.radius, Math.max(this.height, 0.4), h, {
        wasGrounded: was, stepHeight: stepH,
      });
      grounded = grounded || r.grounded;
      wall = wall || r.wall;
      stepped = stepped || r.stepped;
      if (r.landed > landed) landed = r.landed;
      was = r.grounded;
    }
    if (!isFinite(this.position.x) || !isFinite(this.position.y) || !isFinite(this.position.z)) {
      this.respawn();
      return;
    }
    // last-resort floor guard: never fall out of the world
    const floor = (ph.floorY != null ? ph.floorY : 0) - 6;
    if (this.position.y < floor) { this.respawn(); return; }

    this.grounded = grounded;
    this.stepped = stepped;
    this._wallT = wall ? (this._wallT || 0) + dt : 0;
    this._airT = grounded ? 0 : this._airT + dt;
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);

    if (landed > 0) this._onLand(landed);
    if (grounded && this.velocity.y < 0) this.velocity.y = 0;
  }

  _onLand(impact) {
    const s = clamp(impact / 14, 0, 1.6);
    this._bob.kick(-2.6 * s, 1);
    this._ang.kick(-40 * s, 0);
    if (this.ctx.bus) this.ctx.bus.emit('land', { impact, pos: this.position.clone(), surface: this._surface() });
    if (impact > MOVE.fallSafe) this.damage((impact - MOVE.fallSafe) * MOVE.fallDmg);
  }

  _surface() {
    const ph = this.ctx.physics;
    if (!ph) return 'concrete';
    try {
      this._tmp.set(this.position.x, this.position.y + 0.35, this.position.z);
      const hit = ph.raycast ? ph.raycast(this._tmp, this._tmp2.set(0, -1, 0), 1.1) : null;
      const o = hit && hit.object;
      if (o) {
        if (o.userData && o.userData.surface) return o.userData.surface;
        const m = o.material;
        const name = m && (Array.isArray(m) ? m[0] && m[0].name : m.name);
        if (name) return String(name).toLowerCase();
      }
    } catch (e) { /* world is being rebuilt under us */ }
    return 'concrete';
  }

  // ----------------------------------------------------------------- health
  _health(dt) {
    // ui.js subtracts damage on 'playerHit'; if nothing did, we do it ourselves.
    if (this._pendingDmg > 0) {
      if (this.hp >= this._hpAtHit) this.hp = Math.max(0, this.hp - this._pendingDmg);
      this._pendingDmg = 0;
      if (this.hp <= 0) this.kill();
    }
    if (this.dead) return;
    if (this.hp <= 0) { this.kill(); return; }
    this._regenT += dt;
    if (this._regenT > MOVE.regenDelay && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + MOVE.regenRate * dt);
    }
  }

  _deadUpdate(dt) {
    this._respawnT -= dt;
    this.velocity.x *= Math.max(0, 1 - 6 * dt);
    this.velocity.z *= Math.max(0, 1 - 6 * dt);
    this._sweep(dt);
    this.eyeHeight = toward(this.eyeHeight, 0.32, 2.2 * dt);
    this.state = 'dead';
    this.canFire = false; this.adsAllowed = false; this.ads = false;
    this._bob.step(dt); this._ang.step(dt); this._rollS.step(dt);
    this.viewOffset.set(0, this._bob.x[1] * 0.2, 0);
    this.viewRoll = clamp(this._rollS.x, -30, 30) * (Math.PI / 180) + 0.42;
    if (this._respawnT <= 0) this.respawn();
  }

  // ------------------------------------------------------------ camera feel
  _cameraFeel(s, dt) {
    // --- footfalls drive the bob: impulses into a spring, never a raw sine ---
    const sp = this.speed;
    if (this.grounded && !this.sliding && !this._mantle && sp > 0.5) {
      const stride = MOVE.strideLen * (this.stance === 'prone' ? 0.55 : this.stance === 'crouch' ? 0.72 : 1) *
        (this._sprinting ? 1.16 : 1);
      this._stridePhase += (sp * dt) / stride;
      while (this._stridePhase >= 1) {
        this._stridePhase -= 1;
        this._footL = !this._footL;
        const w = clamp(sp / MOVE.sprint, 0.25, 1.35);
        this._bob.kick(-1.15 * w, 1);
        this._bob.kick((this._footL ? 1 : -1) * 0.8 * w, 0);
        this._rollS.kick((this._footL ? 1 : -1) * 2.4 * w);
        this._ang.kick(-2.2 * w, 0);
        if (this.ctx.bus) this.ctx.bus.emit('footstep', { surface: this._surface(), speed: sp, foot: this._footL ? 'L' : 'R', pos: this.position.clone() });
      }
    } else if (!this.grounded) {
      this._stridePhase = 0.5;   // land on a fresh footfall
    }

    // --- strafe / slide view roll ---
    let rollT = -s.strafe * 0.85;
    if (this.sliding) rollT += this._slideRoll * 5.2 * clamp(this._slideT / MOVE.slideTime, 0, 1);
    if (!this.grounded) rollT *= 0.6;
    if (this.ads) rollT *= 0.4;
    this._rollTarget = THREE.MathUtils.damp(this._rollTarget, rollT, 9, dt);

    // --- springs ---
    this._bob.step(dt); this._ang.step(dt); this._rollS.step(dt);

    // --- breathing / idle sway; heavier when scoped ---
    this._breath += dt * (this.ads ? 0.85 : 1.15);
    const moving = sp > 0.4;
    this._idleT = moving ? 0 : this._idleT + dt;
    const bAmp = (this.ads ? 0.016 : 0.006) * (moving ? 0.35 : 1) * (this.stance === 'prone' ? 0.4 : 1) *
      (s.walk && this.ads ? 0.25 : 1);   // "hold breath" while walk-key is down in ADS
    const bx = Math.sin(this._breath * TAU * 0.21) * 0.6 + Math.sin(this._breath * TAU * 0.13 + 1.3) * 0.4;
    const by = Math.sin(this._breath * TAU * 0.34 + 0.7) * 0.5 + Math.sin(this._breath * TAU * 0.17) * 0.5;

    // --- speed lean: a touch of forward push at high speed ---
    const lean = clamp((sp - MOVE.walk) / (MOVE.tacSprint - MOVE.walk), 0, 1);

    const scale = this.ads ? 0.35 : 1;
    this.viewOffset.set(
      (this._bob.x[0] * 0.10 + bx * bAmp) * scale,
      (this._bob.x[1] * 0.13 + by * bAmp * 0.7) * scale + (this.sliding ? -0.06 : 0),
      (this._bob.x[2] * 0.08) * scale + lean * 0.035 + (this.sliding ? 0.05 : 0)
    );
    if (this._mantleArc) {
      this.viewOffset.y -= 0.16 * this._mantleArc;
      this.viewOffset.z += 0.10 * this._mantleArc;
    }
    const pitchKick = this._ang.x[0] * (this.ads ? 0.4 : 1);
    const yawKick = this._ang.x[1] * (this.ads ? 0.4 : 1);
    this._viewPitch = pitchKick * (Math.PI / 180);
    this._viewYaw = yawKick * (Math.PI / 180);
    this.viewRoll = (this._rollTarget + this._rollS.x * (this.ads ? 0.35 : 1) +
      (this._mantleArc ? this._mantleArc * 3.5 : 0)) * (Math.PI / 180);
  }

  _applyCamera(dt) {
    const cam = this.ctx.camera;
    if (!cam) return;
    const vo = this.viewOffset;
    this._basis();
    cam.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    cam.position.x += this._right.x * vo.x + this._fwd.x * vo.z;
    cam.position.z += this._right.z * vo.x + this._fwd.z * vo.z;
    cam.position.y += vo.y;
    cam.rotation.set(
      clamp(this.pitch + (this._viewPitch || 0), -1.53, 1.53),
      this.yaw + (this._viewYaw || 0),
      this.viewRoll,
      'YXZ'
    );
  }
}
