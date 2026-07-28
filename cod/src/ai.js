// Enemy AI: soldiers with movement, cover use, line of sight, suppression, death.
// Owner: ai agent. Public API: update(dt), hitscan(origin, dir, range, dmg, wallDist), spawnWave(n).
import * as THREE from 'three';

export class AI {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.bots = [];
  }
  spawnWave(n = 6) {
    const M = this.ctx.materials;
    for (let i = 0; i < n; i++) {
      const sp = this.ctx.world.spawnPoints[(this.ctx.rng() * this.ctx.world.spawnPoints.length) | 0];
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.05, 6, 12), new THREE.MeshStandardMaterial({ color: 0x3f4634, roughness: 0.85 }));
      body.position.y = 1.0; body.castShadow = true;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2a2f24, roughness: 0.7 }));
      head.position.y = 1.75; head.castShadow = true;
      g.add(body, head);
      g.position.set(sp.x, 0, sp.z);
      this.group.add(g);
      this.bots.push({ obj: g, hp: 100, cd: 1 + this.ctx.rng() * 2, state: 'advance', dead: false });
    }
  }
  hitscan(origin, dir, range, dmg, wallDist) {
    const ray = new THREE.Ray(origin, dir);
    let best = null, bestD = Infinity;
    for (const b of this.bots) {
      if (b.dead) continue;
      const sphere = new THREE.Sphere(b.obj.position.clone().setY(1.1), 0.62);
      const pt = new THREE.Vector3();
      if (ray.intersectSphere(sphere, pt)) {
        const d = pt.distanceTo(origin);
        if (d < bestD && d < range && d < wallDist) { best = b; bestD = d; best._pt = pt.clone(); }
      }
    }
    if (!best) return null;
    const head = best._pt.y > 1.55;
    best.hp -= dmg * (head ? 2.2 : 1);
    this.ctx.fx?.impact(best._pt, dir.clone().negate());
    this.ctx.bus.emit('hitmarker', { head });
    if (best.hp <= 0 && !best.dead) {
      best.dead = true;
      best.obj.rotation.x = -Math.PI / 2.2;
      best.obj.position.y = 0.3;
      this.ctx.bus.emit('kill', { head });
      setTimeout(() => { this.group.remove(best.obj); }, 6000);
    }
    return best;
  }
  update(dt) {
    const p = this.ctx.player.position;
    for (const b of this.bots) {
      if (b.dead) continue;
      const d = b.obj.position.distanceTo(p);
      const to = p.clone().sub(b.obj.position).setY(0).normalize();
      b.obj.rotation.y = Math.atan2(to.x, to.z);
      if (d > 16) b.obj.position.addScaledVector(to, dt * 2.6);
      b.cd -= dt;
      if (b.cd <= 0 && d < 60) {
        b.cd = 0.6 + this.ctx.rng() * 1.2;
        const from = b.obj.position.clone().setY(1.4);
        this.ctx.fx?.tracer(from, p.clone().setY(1.4).addScaledVector(new THREE.Vector3(this.ctx.rng() - 0.5, this.ctx.rng() - 0.5, this.ctx.rng() - 0.5), 1.5));
        if (this.ctx.rng() < 0.3) this.ctx.bus.emit('playerHit', { dmg: 8 });
      }
    }
    this.bots = this.bots.filter(b => b.obj.parent || !b.dead);
  }
}
