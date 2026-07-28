// Collision + dynamics: capsule-vs-world resolution, ray casts, rigid props, ragdolls.
// Owner: physics agent. Public API: moveCapsule(pos, vel, radius, height, dt) -> {pos, grounded},
// raycast(origin, dir, maxDist) -> {hit, point, normal, object}, update(dt).
import * as THREE from 'three';

export class Physics {
  constructor(ctx) {
    this.ctx = ctx;
    this.gravity = -21.0;
    this.raycaster = new THREE.Raycaster();
    this._v = new THREE.Vector3();
  }
  get boxes() { return this.ctx.world.colliders; }

  // Axis-separated box resolution — cheap and stable for a blockout world.
  moveCapsule(pos, vel, radius, height, dt) {
    let grounded = false;
    const step = (axis) => {
      pos[axis] += vel[axis] * dt;
      const lo = new THREE.Vector3(pos.x - radius, pos.y, pos.z - radius);
      const hi = new THREE.Vector3(pos.x + radius, pos.y + height, pos.z + radius);
      const me = new THREE.Box3(lo, hi);
      for (const b of this.boxes) {
        if (!b.intersectsBox(me)) continue;
        if (axis === 'y') {
          if (vel.y <= 0) { pos.y = b.max.y; grounded = true; } else pos.y = b.min.y - height;
          vel.y = 0;
        } else {
          const c = (b.min[axis] + b.max[axis]) / 2;
          pos[axis] = pos[axis] < c ? b.min[axis] - radius : b.max[axis] + radius;
          vel[axis] = 0;
        }
        me.min.set(pos.x - radius, pos.y, pos.z - radius);
        me.max.set(pos.x + radius, pos.y + height, pos.z + radius);
      }
    };
    vel.y += this.gravity * dt;
    step('x'); step('z'); step('y');
    if (pos.y <= 0) { pos.y = 0; vel.y = 0; grounded = true; }
    return { pos, grounded };
  }

  raycast(origin, dir, maxDist = 300) {
    this.raycaster.set(origin, dir.clone().normalize());
    this.raycaster.far = maxDist;
    const hits = this.raycaster.intersectObject(this.ctx.world.root, true);
    if (!hits.length) return null;
    const h = hits[0];
    return { point: h.point, normal: h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0), object: h.object, distance: h.distance };
  }
  update(dt) {}
}
