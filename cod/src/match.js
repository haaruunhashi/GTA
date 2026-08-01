// Match flow: game mode rules, score, timer, wave escalation, killstreaks.
// Owner: match agent. Public API: update(dt), state, score, streak.
//
// Talks to everything through ctx.bus and defensive reads of ctx.ai / ctx.ui, so
// it never breaks when a subsystem is mid-rewrite:
//   listens: kill, death
//   emits:   banner {text, sub}, score {n, reason}, matchEnd {won}, uav {on}
import * as THREE from 'three';

export const MODES = {
  tdm: {
    name: 'TEAM DEATHMATCH',
    scoreLimit: 75,
    timeLimit: 600,
    perKill: 1,
    waveSize: t => 5 + Math.floor(t / 90),      // pressure grows over the match
    keepAlive: 6,                                // hostiles to hold on the map
  },
  attrition: {
    name: 'ATTRITION',
    scoreLimit: 40,
    timeLimit: 420,
    perKill: 1,
    waveSize: t => 6 + Math.floor(t / 60),
    keepAlive: 9,
  },
};

// Reward tiers. Each is fired once per streak run, cleared on death.
const STREAKS = [
  { at: 3, id: 'uav', label: 'UAV RECON', sub: 'HOSTILES MARKED' },
  { at: 5, id: 'mortar', label: 'MORTAR STRIKE', sub: 'ROUNDS INBOUND' },
  { at: 7, id: 'gunship', label: 'GUNSHIP SUPPORT', sub: 'ON STATION' },
];

export class Match {
  constructor(ctx, modeId = 'tdm') {
    this.ctx = ctx;
    this.mode = MODES[modeId] || MODES.tdm;
    this.state = 'intro';          // intro | live | over
    this.t = 0;                    // elapsed match time
    this.stateT = 0;
    this.score = 0;                // player team
    this.enemyScore = 0;
    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this._fired = new Set();
    this._waveT = 0;
    this._uavT = 0;
    this._gunshipT = 0;
    this._mortarQ = [];

    ctx.bus.on('kill', () => this.onKill());
    ctx.bus.on('death', () => this.onDeath());
  }

  get timeLeft() { return Math.max(0, this.mode.timeLimit - this.t); }

  /* ------------------------------------------------------------ scoring */

  onKill() {
    // Kills land during the intro too — a bot killed in the opening second used
    // to be silently dropped, which the gameplay test caught.
    if (this.state === 'over') return;
    if (this.state === 'intro') { this.state = 'live'; this.stateT = 0; }
    this.kills++;
    this.score += this.mode.perKill;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    for (const s of STREAKS) {
      if (this.streak >= s.at && !this._fired.has(s.id)) {
        this._fired.add(s.id);
        this.award(s);
      }
    }
    if (this.score >= this.mode.scoreLimit) this.end(true);
  }

  onDeath() {
    this.deaths++;
    this.enemyScore++;
    this.streak = 0;
    this._fired.clear();
  }

  /* --------------------------------------------------------- killstreaks */

  award(s) {
    const { bus } = this.ctx;
    bus.emit('banner', { text: s.label, sub: s.sub });
    bus.emit('score', { n: 250, reason: s.id.toUpperCase() });
    if (s.id === 'uav') {
      this._uavT = 25;
      bus.emit('uav', { on: true });
    } else if (s.id === 'mortar') {
      this.callMortar();
    } else if (s.id === 'gunship') {
      this._gunshipT = 20;
    }
  }

  // Walk a line of shells across wherever the enemy is densest.
  callMortar() {
    const bots = (this.ctx.ai && this.ctx.ai.bots) || [];
    const alive = bots.filter(b => !b.dead);
    if (!alive.length) return;
    const anchor = alive[(this.ctx.rng() * alive.length) | 0].pos.clone();
    const dir = new THREE.Vector3(this.ctx.rng() - 0.5, 0, this.ctx.rng() - 0.5).normalize();
    for (let i = 0; i < 6; i++) {
      this._mortarQ.push({
        t: 0.9 + i * 0.55,
        pos: anchor.clone().addScaledVector(dir, (i - 2.5) * 6)
          .add(new THREE.Vector3((this.ctx.rng() - 0.5) * 4, 0, (this.ctx.rng() - 0.5) * 4)),
      });
    }
  }

  // The gunship strafes: pick off a hostile every so often while on station.
  gunshipTick(dt) {
    this._gunshipCd = (this._gunshipCd || 0) - dt;
    if (this._gunshipCd > 0) return;
    this._gunshipCd = 1.1;
    const bots = (this.ctx.ai && this.ctx.ai.bots) || [];
    const alive = bots.filter(b => !b.dead);
    if (!alive.length) return;
    const target = alive[(this.ctx.rng() * alive.length) | 0];
    const at = target.pos.clone().setY(target.pos.y + 1);
    if (this.ctx.fx && this.ctx.fx.tracer) {
      this.ctx.fx.tracer(at.clone().add(new THREE.Vector3(20, 90, 30)), at);
    }
    if (this.ctx.fx && this.ctx.fx.explosion) this.ctx.fx.explosion(at, 3);
    if (this.ctx.ai && this.ctx.ai.kill) this.ctx.ai.kill(target, new THREE.Vector3(0, -1, 0), false);
  }

  /* ---------------------------------------------------------------- flow */

  end(won) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.stateT = 0;
    this.ctx.bus.emit('banner', {
      text: won ? 'VICTORY' : 'DEFEAT',
      sub: `${this.kills} KILLS / ${this.deaths} DEATHS / BEST STREAK ${this.bestStreak}`,
    });
    this.ctx.bus.emit('matchEnd', { won, kills: this.kills, deaths: this.deaths });
  }

  restart() {
    this.state = 'live';
    this.t = 0; this.stateT = 0;
    this.score = 0; this.enemyScore = 0;
    this.kills = 0; this.deaths = 0;
    this.streak = 0; this._fired.clear();
    this.ctx.bus.emit('banner', { text: this.mode.name, sub: `FIRST TO ${this.mode.scoreLimit}` });
  }

  update(dt) {
    this.stateT += dt;

    if (this.state === 'intro') {
      if (this.stateT > 0.6) {
        this.state = 'live';
        this.stateT = 0;
        this.ctx.bus.emit('banner', { text: this.mode.name, sub: `FIRST TO ${this.mode.scoreLimit}` });
      }
      return;
    }

    if (this.state === 'over') {
      if (this.stateT > 8) this.restart();
      return;
    }

    this.t += dt;
    if (this.timeLeft <= 0) this.end(this.score > this.enemyScore);

    // ---- keep the map populated, escalating with match time ----
    const ai = this.ctx.ai;
    if (ai && ai.spawnWave) {
      const alive = (ai.bots || []).filter(b => !b.dead).length;
      this._waveT -= dt;
      if (alive < this.mode.keepAlive && this._waveT <= 0) {
        const want = Math.min(this.mode.waveSize(this.t), this.mode.keepAlive) - alive;
        if (want > 0) ai.spawnWave(want);
        this._waveT = 12;
      }
    }

    // ---- active killstreaks ----
    if (this._uavT > 0) {
      this._uavT -= dt;
      if (this._uavT <= 0) this.ctx.bus.emit('uav', { on: false });
    }
    if (this._gunshipT > 0) {
      this._gunshipT -= dt;
      this.gunshipTick(dt);
    }
    for (let i = this._mortarQ.length - 1; i >= 0; i--) {
      const m = this._mortarQ[i];
      m.t -= dt;
      if (m.t <= 0) {
        this._mortarQ.splice(i, 1);
        if (this.ctx.fx && this.ctx.fx.explosion) this.ctx.fx.explosion(m.pos, 7);
        this.ctx.bus.emit('explosion', { pos: m.pos, radius: 7 });
        // anything caught in the blast goes down
        const bots = (this.ctx.ai && this.ctx.ai.bots) || [];
        for (const b of bots) {
          if (b.dead) continue;
          if (b.pos.distanceTo(m.pos) < 7) {
            this.ctx.ai.kill(b, new THREE.Vector3(0, -1, 0), false);
          }
        }
      }
    }
  }
}
