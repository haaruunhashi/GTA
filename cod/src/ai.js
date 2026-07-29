// Enemy soldiers: procedural bodies, perception, cover, squad combat, deaths.
// Owner: ai agent.
//
// Public API
//   spawnWave(n)                                  -> add n bots at world spawn points
//   hitscan(origin, dir, range, dmg, wallDist)    -> bot hit by a player bullet, or null
//   bots                                          -> live list (ui.js reads for the scoreboard)
//   update(dt)
//
// Every read of another module is defensive: world/physics/fx/player are all being
// rewritten concurrently, and a missing method must never take the game down.
import * as THREE from 'three';
import { makeSoldier } from './ai-body.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Difficulty: how fast a bot's aim converges, and how much it misses by.
const SKILL = {
  reactionTime: [0.28, 0.55],   // seconds before a spotted player is engaged
  aimTime: [0.5, 1.1],          // seconds to settle aim onto the target
  spread: [0.055, 0.020],       // radians, decays from first to second as aim settles
  burst: [3, 6],
  burstGap: [0.5, 1.1],
  dmg: [7, 13],
  range: 90,
  fov: Math.cos(THREE.MathUtils.degToRad(62)),
};

export class AI {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.bots = [];
    this.kills = 0;
    this.wave = 0;
    this._respawnQ = [];
    this._t = 0;
  }

  rng() { return this.ctx.rng ? this.ctx.rng() : Math.random(); }
  rr(a, b) { return a + this.rng() * (b - a); }

  /* ------------------------------------------------------------- spawning */

  spawnPoint(awayFrom, minDist = 25) {
    const pts = (this.ctx.world && this.ctx.world.spawnPoints) || [];
    if (!pts.length) return { x: this.rr(-20, 20), y: 0, z: this.rr(-60, 60) };
    let best = pts[0], bestD = -1;
    for (let i = 0; i < 8; i++) {
      const p = pts[(this.rng() * pts.length) | 0];
      const d = awayFrom ? Math.hypot(p.x - awayFrom.x, p.z - awayFrom.z) : 999;
      if (d > minDist) return p;
      if (d > bestD) { bestD = d; best = p; }
    }
    return best;
  }

  spawnWave(n = 6) {
    this.wave++;
    const player = this.ctx.player && this.ctx.player.position;
    for (let i = 0; i < n; i++) this.spawn(this.spawnPoint(player, 30));
    this.ctx.bus.emit('banner', { text: `WAVE ${this.wave}`, sub: `${n} HOSTILES` });
  }

  spawn(at) {
    const body = makeSoldier(this.ctx, this.rng());
    body.group.position.set(at.x, at.y || 0, at.z);
    this.group.add(body.group);
    const bot = {
      body, obj: body.group,
      pos: body.group.position,
      vel: new THREE.Vector3(),
      yaw: at.yaw != null ? at.yaw : this.rng() * TAU,
      hp: 100, dead: false, deadT: 0,
      state: 'patrol',           // patrol | advance | cover | engage | reposition
      stateT: 0,
      target: null,              // world position we are moving toward
      cover: null,
      sawT: 0, lostT: 0, reaction: 0,
      aim: new THREE.Vector3(), aimT: 0,
      burst: 0, cd: this.rr(0.4, 1.4),
      phase: this.rng() * TAU,
      speed: this.rr(2.6, 3.6),
      skill: this.rr(0.35, 1),
    };
    this.bots.push(bot);
    return bot;
  }

  /* ---------------------------------------------------------- perception */

  eye(bot, out) { return (out || _v).set(bot.pos.x, bot.pos.y + 1.55, bot.pos.z); }

  playerEye(out) {
    const p = this.ctx.player;
    if (!p) return null;
    if (p.eyePos) return p.eyePos(out || _v2);
    return (out || _v2).set(p.position.x, p.position.y + (p.eyeHeight || 1.62), p.position.z);
  }

  canSee(bot) {
    const pe = this.playerEye(_v2);
    if (!pe) return false;
    const be = this.eye(bot, _v);
    const to = _v3.copy(pe).sub(be);
    const dist = to.length();
    if (dist > SKILL.range) return false;
    to.divideScalar(dist);
    // facing cone
    const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
    if (to.x * fx + to.z * fz < SKILL.fov && bot.sawT <= 0) return false;
    // line of sight against the world
    const ph = this.ctx.physics;
    if (ph) {
      const hit = ph.rayBoxes ? ph.rayBoxes(be, to, dist) : (ph.raycast ? ph.raycast(be, to, dist) : null);
      if (hit && hit.distance < dist - 0.6) return false;
    }
    return true;
  }

  /* -------------------------------------------------------------- combat */

  shoot(bot, dt) {
    const pe = this.playerEye(_v2);
    if (!pe) return;
    const be = this.eye(bot, _v);

    // aim converges over aimTime; spread shrinks as it settles
    const aimTime = THREE.MathUtils.lerp(SKILL.aimTime[1], SKILL.aimTime[0], bot.skill);
    bot.aimT = Math.min(1, bot.aimT + dt / aimTime);
    const settle = bot.aimT * bot.aimT;
    const spread = THREE.MathUtils.lerp(SKILL.spread[0], SKILL.spread[1], settle * bot.skill);

    bot.cd -= dt;
    if (bot.cd > 0) return;

    if (bot.burst <= 0) {
      bot.burst = Math.round(this.rr(SKILL.burst[0], SKILL.burst[1]));
      bot.cd = this.rr(SKILL.burstGap[0], SKILL.burstGap[1]);
      return;
    }
    bot.burst--;
    bot.cd = 0.09;

    const dir = _v3.copy(pe).sub(be).normalize();
    dir.x += (this.rng() - 0.5) * spread;
    dir.y += (this.rng() - 0.5) * spread * 0.7;
    dir.z += (this.rng() - 0.5) * spread;
    dir.normalize();

    const muzzle = be.clone().addScaledVector(dir, 0.45);
    const end = be.clone().addScaledVector(dir, SKILL.range);
    const ph = this.ctx.physics;
    const hit = ph && ph.rayBoxes ? ph.rayBoxes(be, dir, SKILL.range) : null;
    const fx = this.ctx.fx;
    if (fx) {
      if (fx.tracer) fx.tracer(muzzle, hit ? hit.point : end);
      if (fx.muzzleFlash) fx.muzzleFlash(muzzle);
      if (hit && fx.impact) fx.impact(hit.point, hit.normal || _v.set(0, 1, 0));
    }
    if (this.ctx.audio && this.ctx.audio.gunshot) this.ctx.audio.gunshot('ar', muzzle);
    bot.body.recoil();

    // did it hit the player? cheap capsule test against the shot ray
    const p = this.ctx.player;
    if (p && !p.dead) {
      const toP = _v.copy(pe).sub(be);
      const along = toP.dot(dir);
      if (along > 0 && (!hit || hit.distance > along)) {
        const closest = _v2.copy(be).addScaledVector(dir, along);
        if (closest.distanceTo(pe) < 0.42) {
          const dmg = this.rr(SKILL.dmg[0], SKILL.dmg[1]);
          const ang = Math.atan2(bot.pos.x - p.position.x, bot.pos.z - p.position.z) - (p.yaw || 0);
          if (p.damage) p.damage(dmg, ang);
          this.ctx.bus.emit('playerHit', { dmg, dir: ang });
        }
      }
    }
  }

  /* ------------------------------------------------------- taking damage */

  hitscan(origin, dir, range, dmg, wallDist) {
    const ray = new THREE.Ray(origin, dir.clone().normalize());
    let best = null, bestD = Infinity, bestPt = null, head = false;
    for (const b of this.bots) {
      if (b.dead) continue;
      // two spheres: body and head, so headshots are a real skill check
      for (const [y, r, isHead] of [[0.95, 0.42, false], [1.62, 0.16, true]]) {
        const sphere = new THREE.Sphere(_v.set(b.pos.x, b.pos.y + y, b.pos.z), r);
        const pt = ray.intersectSphere(sphere, _v2.clone());
        if (!pt) continue;
        const d = pt.distanceTo(origin);
        if (d < bestD && d < range && d < (wallDist == null ? Infinity : wallDist)) {
          best = b; bestD = d; bestPt = pt.clone(); head = isHead;
        }
      }
    }
    if (!best) return null;

    best.hp -= dmg * (head ? 2.5 : 1);
    best.sawT = 3;                      // being shot makes you aware
    if (this.ctx.fx && this.ctx.fx.impact) {
      this.ctx.fx.impact(bestPt, dir.clone().negate(), 'flesh');
    }
    this.ctx.bus.emit('hitmarker', { head });
    if (best.hp <= 0) this.kill(best, dir, head);
    return best;
  }

  kill(bot, dir, head) {
    if (bot.dead) return;
    bot.dead = true;
    bot.deadT = 0;
    this.kills++;
    bot.body.die(dir, this.ctx.physics);
    this.ctx.bus.emit('kill', { head, name: 'HOSTILE' });
    // queue a replacement so the fight never runs dry
    this._respawnQ.push(this._t + 6);
  }

  /* --------------------------------------------------------------- brain */

  moveTo(bot, target, dt) {
    const to = _v.copy(target).sub(bot.pos);
    to.y = 0;
    const d = to.length();
    if (d < 0.8) return true;
    to.divideScalar(d);
    const want = bot.state === 'engage' ? bot.speed * 0.55 : bot.speed;
    bot.vel.x = to.x * want;
    bot.vel.z = to.z * want;

    const ph = this.ctx.physics;
    if (ph && ph.moveCapsule) {
      ph.moveCapsule(bot.pos, bot.vel, 0.34, 1.75, dt);
    } else {
      bot.pos.addScaledVector(to, want * dt);
    }
    return false;
  }

  pickCover(bot) {
    const nav = (this.ctx.world && this.ctx.world.navPoints) || [];
    const p = this.ctx.player && this.ctx.player.position;
    if (!nav.length || !p) return null;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 10; i++) {
      const n = nav[(this.rng() * nav.length) | 0];
      const dPlayer = Math.hypot(n.x - p.x, n.z - p.z);
      const dSelf = Math.hypot(n.x - bot.pos.x, n.z - bot.pos.z);
      // want: close to us, mid-range to the player, not on top of them
      const score = -dSelf * 0.5 - Math.abs(dPlayer - 22) * 0.8 + (dPlayer > 10 ? 6 : -20);
      if (score > bestScore) { bestScore = score; best = n; }
    }
    return best;
  }

  update(dt) {
    this._t += dt;
    const p = this.ctx.player;

    // replacements
    while (this._respawnQ.length && this._respawnQ[0] <= this._t) {
      this._respawnQ.shift();
      this.spawn(this.spawnPoint(p && p.position, 35));
    }

    for (const bot of this.bots) {
      if (bot.dead) {
        bot.deadT += dt;
        bot.body.update(dt, 0, true);
        continue;
      }

      const sees = this.canSee(bot);
      if (sees) { bot.sawT = 3.0; bot.lostT = 0; bot.reaction += dt; }
      else { bot.sawT -= dt; bot.lostT += dt; bot.reaction = 0; bot.aimT = Math.max(0, bot.aimT - dt); }

      bot.stateT += dt;
      const aware = bot.sawT > 0;
      const reactionTime = THREE.MathUtils.lerp(SKILL.reactionTime[1], SKILL.reactionTime[0], bot.skill);

      // ---- state machine ----
      if (!aware) {
        if (bot.state !== 'patrol' && bot.lostT > 3) { bot.state = 'patrol'; bot.target = null; bot.stateT = 0; }
        if (!bot.target || bot.stateT > 6) {
          const c = this.pickCover(bot);
          bot.target = c ? new THREE.Vector3(c.x, 0, c.z) : null;
          bot.stateT = 0;
        }
        if (bot.target) this.moveTo(bot, bot.target, dt);
      } else if (p) {
        const dist = Math.hypot(p.position.x - bot.pos.x, p.position.z - bot.pos.z);
        if (bot.state !== 'engage' && bot.state !== 'cover') { bot.state = 'advance'; bot.stateT = 0; }

        if (bot.state === 'advance') {
          // close to a fighting distance, then take cover and shoot
          if (dist > 26) this.moveTo(bot, p.position, dt);
          else { bot.state = 'cover'; bot.cover = this.pickCover(bot); bot.stateT = 0; }
        } else if (bot.state === 'cover') {
          const c = bot.cover;
          const arrived = !c || this.moveTo(bot, _v.set(c.x, 0, c.z), dt);
          if (arrived || bot.stateT > 4) { bot.state = 'engage'; bot.stateT = 0; }
        } else if (bot.state === 'engage') {
          bot.vel.x *= 0.5; bot.vel.z *= 0.5;
          if (bot.reaction > reactionTime) this.shoot(bot, dt);
          // reposition occasionally so they don't feel like turrets
          if (bot.stateT > this.rr(4, 8)) { bot.state = 'cover'; bot.cover = this.pickCover(bot); bot.stateT = 0; }
          if (dist > 34) { bot.state = 'advance'; bot.stateT = 0; }
        }

        // face the player when aware
        const want = Math.atan2(-(p.position.x - bot.pos.x), -(p.position.z - bot.pos.z));
        let d = ((want - bot.yaw + Math.PI * 3) % TAU) - Math.PI;
        bot.yaw += clamp(d, -5 * dt, 5 * dt);
      }

      // gravity / ground clamp when physics is unavailable
      if (!this.ctx.physics || !this.ctx.physics.moveCapsule) bot.pos.y = 0;

      bot.obj.rotation.y = bot.yaw;
      const speed = Math.hypot(bot.vel.x, bot.vel.z);
      bot.body.update(dt, speed, false);
      if (!aware) { bot.vel.x *= 0.9; bot.vel.z *= 0.9; }
    }

    // retire corpses
    for (let i = this.bots.length - 1; i >= 0; i--) {
      const b = this.bots[i];
      if (b.dead && b.deadT > 14) {
        this.group.remove(b.obj);
        b.body.dispose();
        this.bots.splice(i, 1);
      }
    }
  }
}
