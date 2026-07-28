// Collision + dynamics: capsule-vs-world sweeping, ray casts, overlap queries,
// rigid props and a small ragdoll solver.
// Owner: physics agent.
//
// Public API
//   moveCapsule(pos, vel, radius, height, dt, opts) -> {pos, grounded, normal, wall, stepped, landed}
//   capsuleOverlaps(pos, radius, height)            -> bool   (free-space test)
//   raycast(origin, dir, maxDist)                   -> {point, normal, distance, object} | null
//   rayBoxes(origin, dir, maxDist)                  -> {point, normal, distance, box} | null  (fast; colliders only)
//   overlapSphere(center, radius) / overlapBox(box) -> [{box|body, point, distance}]
//   applyExplosion(center, radius, force)
//   addBody(opts) / removeBody(b)                   -> rigid props (crates, barrels, casings, grenades)
//   ragdoll(spec)                                   -> constrained-point skeleton for AI deaths
//   update(dt)
//
// Driven entirely by `ctx.world.colliders` (THREE.Box3[]) plus, optionally,
// triangle meshes opted in via `mesh.userData.collide = true` or
// `ctx.world.collisionMeshes`, which get a three-mesh-bvh bounds tree.
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

// BVH-accelerated raycasting for any mesh that has a bounds tree.
if (!THREE.Mesh.prototype.__bvhPatched) {
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  THREE.Mesh.prototype.__bvhPatched = true;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const CELL = 6;
const KEY = (ix, iz) => (ix * 73856093) ^ (iz * 19349663);

export class Physics {
  constructor(ctx) {
    this.ctx = ctx;
    this.gravity = -22.0;
    this.floorY = 0;                 // world ground plane fallback
    this.stepHeight = 0.45;
    this.maxIterations = 5;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;

    this.bodies = [];
    this.ragdolls = [];

    this._grid = new Map();
    this._boxes = [];
    this._huge = [];
    this._meshes = [];               // {mesh, bvh, inv}
    this._sig = -1;

    // scratch — never aliased across nested calls
    this._v0 = new THREE.Vector3(); this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
    this._probe = new THREE.Vector3(); this._probe2 = new THREE.Vector3();
    this._mv0 = new THREE.Vector3(); this._mv1 = new THREE.Vector3(); this._mv2 = new THREE.Vector3();
    this._seg = new THREE.Line3();
    this._box = new THREE.Box3(); this._box2 = new THREE.Box3(); this._box3 = new THREE.Box3();
    this._push = { n: new THREE.Vector3(), depth: 0 };
    this._tri1 = new THREE.Vector3(); this._tri2 = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._seen = new Set();
    this._lists = [[], [], [], [], [], [], [], []];
  }

  get colliders() { return (this.ctx.world && this.ctx.world.colliders) || []; }

  // --------------------------------------------------------------- broadphase

  // The world agent rebuilds geometry underneath us, so re-hash whenever the
  // collider set or the world root changes shape.
  _sync() {
    const w = this.ctx.world;
    if (!w) return;
    const sig = (w.colliders ? w.colliders.length : 0) * 1e6 +
      (w.root ? w.root.children.length : 0) * 1e3 + (w.collidersVersion || 0);
    if (sig === this._sig) return;
    this._sig = sig;
    this.rebuild();
  }

  rebuild() {
    const w = this.ctx.world || {};
    this._boxes.length = 0;
    this._huge.length = 0;
    this._grid.clear();
    for (const c of (w.colliders || [])) {
      let b = c;
      if (!(c && c.isBox3)) {
        if (c && c.isObject3D) { c.updateMatrixWorld(); b = new THREE.Box3().setFromObject(c); }
        else if (c && c.box && c.box.isBox3) b = c.box;
        else continue;
      }
      if (b.isEmpty() || !isFinite(b.min.x) || !isFinite(b.max.x)) continue;
      this._boxes.push(b);
    }
    for (let i = 0; i < this._boxes.length; i++) this._insert(this._boxes[i], i);
    this._syncMeshes();
  }

  _insert(b, i) {
    const x0 = Math.floor(b.min.x / CELL), x1 = Math.floor(b.max.x / CELL);
    const z0 = Math.floor(b.min.z / CELL), z1 = Math.floor(b.max.z / CELL);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 2048) { this._huge.push(i); return; }
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = KEY(x, z);
        let a = this._grid.get(k);
        if (!a) this._grid.set(k, (a = []));
        a.push(i);
      }
    }
  }

  _syncMeshes() {
    const w = this.ctx.world;
    if (!w || !w.root) { this._meshes.length = 0; return; }
    const wanted = [];
    if (Array.isArray(w.collisionMeshes)) for (const m of w.collisionMeshes) if (m && m.isMesh) wanted.push(m);
    w.root.traverse(o => {
      if (o.isMesh && o.userData && o.userData.collide === true && wanted.indexOf(o) < 0) wanted.push(o);
    });
    const keep = [];
    for (const m of wanted) {
      const found = this._meshes.find(e => e.mesh === m);
      if (found) { keep.push(found); continue; }
      try {
        const g = m.geometry;
        if (!g || !g.attributes || !g.attributes.position) continue;
        const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
        if (tris > 250000) continue;
        const bvh = g.boundsTree || (g.boundsTree = new MeshBVH(g, { maxLeafTris: 8 }));
        m.updateMatrixWorld();
        keep.push({ mesh: m, bvh, inv: new THREE.Matrix4().copy(m.matrixWorld).invert() });
      } catch (e) { /* geometry the BVH can't take — the box colliders still cover it */ }
    }
    this._meshes = keep;
  }

  // Collider indices whose grid cells overlap [min,max].
  _query(min, max, out) {
    out.length = 0;
    const x0 = Math.floor(min.x / CELL), x1 = Math.floor(max.x / CELL);
    const z0 = Math.floor(min.z / CELL), z1 = Math.floor(max.z / CELL);
    const seen = this._seen;
    seen.clear();
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const a = this._grid.get(KEY(x, z));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) if (!seen.has(a[i])) { seen.add(a[i]); out.push(a[i]); }
      }
    }
    for (let i = 0; i < this._huge.length; i++) {
      const k = this._huge[i];
      if (!seen.has(k)) { seen.add(k); out.push(k); }
    }
    return out;
  }

  // ---------------------------------------------------------- capsule vs AABB

  // Exact for a *vertical* capsule: axis at (px,pz), sphere centres from y0..y1.
  _boxPush(px, y0, y1, pz, r, b, out) {
    const qx = clamp(px, b.min.x, b.max.x);
    const qz = clamp(pz, b.min.z, b.max.z);
    let dy = 0;
    if (y1 < b.min.y) dy = y1 - b.min.y;
    else if (y0 > b.max.y) dy = y0 - b.max.y;
    const dx = px - qx, dz = pz - qz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r * r) return false;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      out.n.set(dx / d, dy / d, dz / d);
      out.depth = r - d;
      return true;
    }
    // Axis is inside the box — escape along the cheapest face.
    let bd = b.max.x - px + r, bx = 1, by = 0, bz = 0;
    let c = px - b.min.x + r; if (c < bd) { bd = c; bx = -1; by = 0; bz = 0; }
    c = b.max.z - pz + r; if (c < bd) { bd = c; bx = 0; by = 0; bz = 1; }
    c = pz - b.min.z + r; if (c < bd) { bd = c; bx = 0; by = 0; bz = -1; }
    c = b.max.y - y0 + r; if (c < bd) { bd = c; bx = 0; by = 1; bz = 0; }
    c = y1 - b.min.y + r; if (c < bd) { bd = c; bx = 0; by = -1; bz = 0; }
    out.n.set(bx, by, bz);
    out.depth = bd;
    return true;
  }

  // Push the capsule out of everything it overlaps. Mutates pos (and vel).
  _depenetrate(pos, radius, height, vel, res) {
    const r = radius;
    res = res || {};
    res.grounded = false; res.wall = false; res.ceiling = false;
    if (!res.normal) res.normal = new THREE.Vector3(0, 1, 0);
    res.normal.set(0, 1, 0);
    const list = this._lists[0];
    const push = this._push;
    const bx = this._box;

    for (let it = 0; it < this.maxIterations; it++) {
      let y0 = pos.y + r, y1 = Math.max(y0, pos.y + height - r);
      bx.min.set(pos.x - r, pos.y, pos.z - r);
      bx.max.set(pos.x + r, pos.y + height, pos.z + r);
      this._query(bx.min, bx.max, list);
      let hits = 0;
      for (let i = 0; i < list.length; i++) {
        const b = this._boxes[list[i]];
        if (b.max.x < bx.min.x || b.min.x > bx.max.x ||
          b.max.y < bx.min.y || b.min.y > bx.max.y ||
          b.max.z < bx.min.z || b.min.z > bx.max.z) continue;
        if (!this._boxPush(pos.x, y0, y1, pos.z, r, b, push)) continue;
        hits++;
        pos.addScaledVector(push.n, push.depth + 1e-4);
        if (push.n.y > 0.55) { res.grounded = true; res.normal.copy(push.n); }
        else if (push.n.y < -0.55) res.ceiling = true;
        else res.wall = true;
        if (vel) { const vn = vel.dot(push.n); if (vn < 0) vel.addScaledVector(push.n, -vn); }
        y0 = pos.y + r; y1 = Math.max(y0, pos.y + height - r);
      }
      const meshHit = this._meshes.length
        ? this._resolveMeshes(pos, radius, height, vel, res) : false;
      if (!hits && !meshHit) break;
    }
    if (pos.y < this.floorY) {
      pos.y = this.floorY;
      res.grounded = true; res.normal.set(0, 1, 0);
      if (vel && vel.y < 0) vel.y = 0;
    }
    return res;
  }

  // Capsule vs triangle soup through three-mesh-bvh.
  _resolveMeshes(pos, radius, height, vel, res) {
    let any = false;
    const seg = this._seg, bx = this._box2;
    for (const e of this._meshes) {
      const m = e.mesh;
      if (!m.parent) continue;
      m.updateMatrixWorld();
      e.inv.copy(m.matrixWorld).invert();
      const s = this._mv0.setFromMatrixScale(m.matrixWorld);
      const scale = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1;
      const r = radius / scale;
      seg.start.set(pos.x, pos.y + radius, pos.z).applyMatrix4(e.inv);
      seg.end.set(pos.x, pos.y + Math.max(radius, height - radius), pos.z).applyMatrix4(e.inv);
      bx.makeEmpty();
      bx.expandByPoint(seg.start); bx.expandByPoint(seg.end);
      bx.min.addScalar(-r); bx.max.addScalar(r);
      const t1 = this._tri1, t2 = this._tri2;
      let moved = false;
      try {
        e.bvh.shapecast({
          intersectsBounds: box => box.intersectsBox(bx),
          intersectsTriangle: tri => {
            const d = tri.closestPointToSegment(seg, t1, t2);
            if (d < r) {
              const depth = r - d;
              const n = t2.sub(t1);
              if (n.lengthSq() < 1e-14) return false;
              n.normalize();
              seg.start.addScaledVector(n, depth);
              seg.end.addScaledVector(n, depth);
              moved = true;
            }
            return false;
          },
        });
      } catch (err) { continue; }
      if (!moved) continue;
      const after = this._mv1.copy(seg.start).applyMatrix4(m.matrixWorld);
      const delta = this._mv2.set(after.x - pos.x, after.y - (pos.y + radius), after.z - pos.z);
      if (delta.lengthSq() < 1e-12) continue;
      any = true;
      pos.add(delta);
      const n = this._mv0.copy(delta).normalize();
      if (res) {
        if (n.y > 0.55) { res.grounded = true; res.normal.copy(n); }
        else if (n.y < -0.55) res.ceiling = true;
        else res.wall = true;
      }
      if (vel) { const vn = vel.dot(n); if (vn < 0) vel.addScaledVector(n, -vn); }
    }
    return any;
  }

  /** True if a capsule at `pos` (feet) intersects the world. */
  capsuleOverlaps(pos, radius, height) {
    this._sync();
    const r = radius;
    if (pos.y < this.floorY - 1e-4) return true;
    const y0 = pos.y + r, y1 = Math.max(y0, pos.y + height - r);
    const list = this._lists[1];
    const bx = this._box3;
    bx.min.set(pos.x - r, pos.y, pos.z - r);
    bx.max.set(pos.x + r, pos.y + height, pos.z + r);
    this._query(bx.min, bx.max, list);
    for (let i = 0; i < list.length; i++) {
      const b = this._boxes[list[i]];
      if (b.max.y < bx.min.y || b.min.y > bx.max.y) continue;
      if (this._boxPush(pos.x, y0, y1, pos.z, r, b, this._push)) return true;
    }
    if (this._meshes.length) {
      const p = this._probe2.copy(pos);
      if (this._resolveMeshes(p, radius, height, null, null)) return true;
    }
    return false;
  }

  // ----------------------------------------------------------------- movement

  /**
   * Sweep and resolve a vertical capsule. `pos` is the FEET position.
   * opts: {gravity:false, gravityScale, stepHeight, wasGrounded, snapDown:false}
   */
  moveCapsule(pos, vel, radius, height, dt, opts) {
    this._sync();
    opts = opts || {};
    const stepH = opts.stepHeight != null ? opts.stepHeight : this.stepHeight;
    if (opts.gravity !== false) {
      vel.y += this.gravity * (opts.gravityScale != null ? opts.gravityScale : 1) * dt;
    }
    const vy0 = vel.y;
    const wasGrounded = !!opts.wasGrounded;

    // Sub-step so nothing tunnels: never travel more than 40% of the radius.
    const travel = Math.hypot(vel.x, vel.y, vel.z) * dt;
    const steps = clamp(Math.ceil(travel / (radius * 0.4)), 1, 48);
    const h = dt / steps;

    let grounded = false, wall = false, ceiling = false, stepped = false;
    const normal = this._v3.set(0, 1, 0);
    const res = this._res || (this._res = { normal: new THREE.Vector3() });

    for (let s = 0; s < steps; s++) {
      // --- horizontal ---
      const px = pos.x, pz = pos.z, py = pos.y;
      const wantX = vel.x * h, wantZ = vel.z * h;
      pos.x += wantX; pos.z += wantZ;
      this._depenetrate(pos, radius, height, vel, res);
      grounded = grounded || res.grounded; wall = wall || res.wall; ceiling = ceiling || res.ceiling;
      if (res.grounded) normal.copy(res.normal);

      // --- step up: retry a blocked horizontal move from a raised position ---
      const gotX = pos.x - px, gotZ = pos.z - pz;
      const want2 = wantX * wantX + wantZ * wantZ;
      const got2 = gotX * gotX + gotZ * gotZ;
      if (res.wall && stepH > 0 && want2 > 1e-9 && got2 < want2 * 0.64 && (grounded || wasGrounded)) {
        const sx = pos.x, sy = pos.y, sz = pos.z;
        const ty = py + stepH;
        const probe = this._probe;
        probe.set(px, ty, pz);
        if (!this.capsuleOverlaps(probe, radius, height)) {
          pos.set(px + wantX, ty, pz + wantZ);
          const r2 = this._depenetrate(pos, radius, height, null, this._resB || (this._resB = { normal: new THREE.Vector3() }));
          let landedY = ty;
          const N = 12, dstep = stepH / N;
          for (let k = 1; k <= N; k++) {
            probe.set(pos.x, ty - dstep * k, pos.z);
            if (this.capsuleOverlaps(probe, radius, height)) break;
            landedY = ty - dstep * k;
          }
          const nx = pos.x - px, nz = pos.z - pz;
          const n2 = nx * nx + nz * nz;
          if (!r2.wall && n2 > got2 * 1.05 + 1e-10 && landedY <= py + stepH + 1e-3) {
            pos.y = landedY;
            const r3 = this._depenetrate(pos, radius, height, null, this._resC || (this._resC = { normal: new THREE.Vector3() }));
            grounded = true; stepped = true;
            if (vel.y < 0) vel.y = 0;
            if (r3.grounded) normal.copy(r3.normal);
          } else {
            pos.set(sx, sy, sz);
          }
        }
      }

      // --- vertical ---
      pos.y += vel.y * h;
      this._depenetrate(pos, radius, height, vel, res);
      grounded = grounded || res.grounded; wall = wall || res.wall; ceiling = ceiling || res.ceiling;
      if (res.grounded) normal.copy(res.normal);
    }

    // --- stick to the ground going down stairs / shallow slopes ---
    if (!grounded && wasGrounded && vel.y <= 0.05 && opts.snapDown !== false) {
      const probe = this._probe;
      const N = 10;
      for (let k = 1; k <= N; k++) {
        const y = pos.y - (stepH / N) * k;
        probe.set(pos.x, y, pos.z);
        if (this.capsuleOverlaps(probe, radius, height)) {
          pos.y = pos.y - (stepH / N) * (k - 1);
          this._depenetrate(pos, radius, height, null);
          grounded = true; vel.y = 0;
          break;
        }
      }
    }
    const landed = (grounded && !wasGrounded && vy0 < -1) ? -vy0 : 0;
    if (grounded && vel.y < 0) vel.y = 0;
    if (ceiling && vel.y > 0) vel.y = 0;

    return { pos, grounded, normal: normal.clone(), wall, ceiling, stepped, landed };
  }

  // -------------------------------------------------------------- ray casting

  /** Visual raycast against the world meshes (BVH-accelerated where present). */
  raycast(origin, dir, maxDist = 300) {
    const root = this.ctx.world && this.ctx.world.root;
    const d = this._v0.copy(dir).normalize();
    if (!root) return this.rayBoxes(origin, d, maxDist);
    this.raycaster.set(origin, d);
    this.raycaster.near = 0;
    this.raycaster.far = maxDist;
    let hits;
    try { hits = this.raycaster.intersectObject(root, true); }
    catch (e) { return this.rayBoxes(origin, d, maxDist); }
    let h = null;
    for (const c of hits) {
      const o = c.object;
      if (o && (o.visible === false || (o.userData && o.userData.noHit))) continue;
      h = c; break;
    }
    if (!h) return null;
    const n = h.face
      ? h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize()
      : new THREE.Vector3(0, 1, 0);
    return { point: h.point.clone(), normal: n, object: h.object, distance: h.distance };
  }

  /** Fast slab test against collider boxes only — AI line of sight, ledge probes. */
  rayBoxes(origin, dir, maxDist = 300) {
    this._sync();
    const d = this._v1.copy(dir).normalize();
    const ix = 1 / (d.x || 1e-12), iy = 1 / (d.y || 1e-12), iz = 1 / (d.z || 1e-12);
    const ex = origin.x + d.x * maxDist, ey = origin.y + d.y * maxDist, ez = origin.z + d.z * maxDist;
    const min = this._v2.set(Math.min(origin.x, ex), Math.min(origin.y, ey), Math.min(origin.z, ez));
    const max = this._v0.set(Math.max(origin.x, ex), Math.max(origin.y, ey), Math.max(origin.z, ez));
    const list = this._lists[2];
    this._query(min, max, list);
    let best = null, bestT = maxDist, bestAxis = 0, bestSign = 1;
    for (let i = 0; i < list.length; i++) {
      const b = this._boxes[list[i]];
      let t0 = 0, t1 = bestT, axis = -1, sign = 1;
      // x
      let ta = (b.min.x - origin.x) * ix, tb = (b.max.x - origin.x) * ix, sg = -1;
      if (ta > tb) { const t = ta; ta = tb; tb = t; sg = 1; }
      if (ta > t0) { t0 = ta; axis = 0; sign = sg; }
      if (tb < t1) t1 = tb;
      // y
      ta = (b.min.y - origin.y) * iy; tb = (b.max.y - origin.y) * iy; sg = -1;
      if (ta > tb) { const t = ta; ta = tb; tb = t; sg = 1; }
      if (ta > t0) { t0 = ta; axis = 1; sign = sg; }
      if (tb < t1) t1 = tb;
      // z
      ta = (b.min.z - origin.z) * iz; tb = (b.max.z - origin.z) * iz; sg = -1;
      if (ta > tb) { const t = ta; ta = tb; tb = t; sg = 1; }
      if (ta > t0) { t0 = ta; axis = 2; sign = sg; }
      if (tb < t1) t1 = tb;
      if (t0 <= t1 && t0 >= 0 && t0 < bestT) { bestT = t0; best = b; bestAxis = axis; bestSign = sign; }
    }
    if (!best) {
      if (d.y < -1e-6) {
        const t = (this.floorY - origin.y) / d.y;
        if (t >= 0 && t <= maxDist) {
          return { point: origin.clone().addScaledVector(d, t), normal: new THREE.Vector3(0, 1, 0), distance: t, box: null };
        }
      }
      return null;
    }
    const n = new THREE.Vector3();
    if (bestAxis === 0) n.set(bestSign, 0, 0); else if (bestAxis === 1) n.set(0, bestSign, 0); else n.set(0, 0, bestSign);
    if (d.y < -1e-6) {
      const t = (this.floorY - origin.y) / d.y;
      if (t >= 0 && t < bestT) {
        return { point: origin.clone().addScaledVector(d, t), normal: new THREE.Vector3(0, 1, 0), distance: t, box: null };
      }
    }
    return { point: origin.clone().addScaledVector(d, bestT), normal: n, distance: bestT, box: best };
  }

  // -------------------------------------------------------------- overlap API

  /** Colliders + rigid bodies inside a sphere — explosions, triggers. */
  overlapSphere(center, radius) {
    this._sync();
    const out = [];
    const min = this._v2.set(center.x - radius, center.y - radius, center.z - radius);
    const max = this._v0.set(center.x + radius, center.y + radius, center.z + radius);
    const list = this._lists[3];
    this._query(min, max, list);
    for (let i = 0; i < list.length; i++) {
      const b = this._boxes[list[i]];
      const p = new THREE.Vector3(
        clamp(center.x, b.min.x, b.max.x),
        clamp(center.y, b.min.y, b.max.y),
        clamp(center.z, b.min.z, b.max.z));
      const d = p.distanceTo(center);
      if (d <= radius) out.push({ box: b, point: p, distance: d });
    }
    for (const body of this.bodies) {
      const d = body.pos.distanceTo(center) - body.radius;
      if (d <= radius) out.push({ body, point: body.pos.clone(), distance: Math.max(0, d) });
    }
    return out;
  }

  overlapBox(box) {
    this._sync();
    const out = [];
    const list = this._lists[4];
    this._query(box.min, box.max, list);
    for (let i = 0; i < list.length; i++) {
      const b = this._boxes[list[i]];
      if (b.intersectsBox(box)) out.push({ box: b });
    }
    for (const body of this.bodies) if (box.containsPoint(body.pos)) out.push({ body });
    return out;
  }

  /** Radial impulse on props and ragdolls. Returns everything in range. */
  applyExplosion(center, radius, force = 20) {
    const hits = this.overlapSphere(center, radius);
    for (const h of hits) {
      if (!h.body) continue;
      const dir = h.body.pos.clone().sub(center);
      const dist = Math.max(0.3, dir.length());
      dir.normalize();
      dir.y += 0.55;
      dir.normalize();
      const f = force * (1 - clamp(dist / radius, 0, 1)) / Math.max(0.2, h.body.mass);
      h.body.vel.addScaledVector(dir, f);
      const rr = this.ctx.rng || Math.random;
      h.body.spin.set((rr() - .5) * f, (rr() - .5) * f, (rr() - .5) * f);
      h.body.sleep = 0;
    }
    for (const r of this.ragdolls) r.impulse(center, radius, force);
    return hits;
  }

  // ------------------------------------------------------------- rigid bodies

  /**
   * A cheap sphere-approximated rigid prop.
   * opts: {mesh, pos, vel, spin, radius, mass, restitution, friction, gravity, life, onHit}
   */
  addBody(opts = {}) {
    const b = {
      mesh: opts.mesh || null,
      pos: opts.pos ? opts.pos.clone() : new THREE.Vector3(),
      vel: opts.vel ? opts.vel.clone() : new THREE.Vector3(),
      spin: opts.spin ? opts.spin.clone() : new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      radius: opts.radius != null ? opts.radius : 0.12,
      mass: opts.mass != null ? opts.mass : 1,
      restitution: opts.restitution != null ? opts.restitution : 0.32,
      friction: opts.friction != null ? opts.friction : 0.55,
      gravityScale: opts.gravity != null ? opts.gravity : 1,
      life: opts.life != null ? opts.life : Infinity,
      onHit: opts.onHit || null,
      sleep: 0, dead: false,
      userData: opts.userData || {},
    };
    if (b.mesh) { b.quat.copy(b.mesh.quaternion); if (!opts.pos) b.pos.copy(b.mesh.position); }
    this.bodies.push(b);
    return b;
  }

  removeBody(b) {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    b.dead = true;
  }

  _stepBody(b, dt) {
    if (b.sleep > 1.2) return;
    b.vel.y += this.gravity * b.gravityScale * dt;
    const travel = b.vel.length() * dt;
    const steps = clamp(Math.ceil(travel / Math.max(0.02, b.radius * 0.8)), 1, 10);
    const h = dt / steps;
    const list = this._lists[5];
    let resting = true;
    for (let s = 0; s < steps; s++) {
      b.pos.addScaledVector(b.vel, h);
      if (b.pos.y - b.radius < this.floorY) {
        b.pos.y = this.floorY + b.radius;
        this._bounce(b, this._v0.set(0, 1, 0));
      }
      this._box.min.set(b.pos.x - b.radius, b.pos.y - b.radius, b.pos.z - b.radius);
      this._box.max.set(b.pos.x + b.radius, b.pos.y + b.radius, b.pos.z + b.radius);
      this._query(this._box.min, this._box.max, list);
      for (let i = 0; i < list.length; i++) {
        const box = this._boxes[list[i]];
        const q = this._v1.set(
          clamp(b.pos.x, box.min.x, box.max.x),
          clamp(b.pos.y, box.min.y, box.max.y),
          clamp(b.pos.z, box.min.z, box.max.z));
        const d = this._v0.copy(b.pos).sub(q);
        let len = d.length();
        if (len >= b.radius) continue;
        if (len < 1e-6) { d.set(0, 1, 0); len = 1e-6; }
        d.divideScalar(len);
        b.pos.addScaledVector(d, b.radius - len);
        this._bounce(b, d);
      }
      if (b.vel.lengthSq() > 0.25) resting = false;
    }
    b.sleep = resting ? b.sleep + dt : 0;
    b.spin.multiplyScalar(Math.exp(-dt * 1.4));
    if (b.spin.lengthSq() > 1e-8) {
      const ax = this._v2.copy(b.spin);
      const ang = ax.length() * dt;
      ax.normalize();
      this._q.setFromAxisAngle(ax, ang);
      b.quat.premultiply(this._q);
    }
    if (b.mesh) { b.mesh.position.copy(b.pos); b.mesh.quaternion.copy(b.quat); }
  }

  _bounce(b, n) {
    const vn = b.vel.dot(n);
    if (vn < 0) {
      const t = this._v3.copy(b.vel).addScaledVector(n, -vn);   // tangential
      b.vel.copy(t).multiplyScalar(Math.max(0, 1 - b.friction * 0.4));
      b.vel.addScaledVector(n, -vn * b.restitution);
      if (b.onHit && -vn > 0.8) b.onHit(b, n, -vn);
      b.sleep = 0;
    }
  }

  // ------------------------------------------------------------------ ragdoll

  /**
   * Constrained-point (Verlet) skeleton for deaths.
   * spec: {points:[{pos, radius?, mass?, pinned?, vel?}], links:[[a,b,len?,stiff?]], vel?, life?}
   * -> {points, links, pos(i), step(dt), impulse(c,r,f), remove()}
   */
  ragdoll(spec = {}) {
    const phys = this;
    const pts = (spec.points || []).map(p => {
      const pos = p.pos ? p.pos.clone() : new THREE.Vector3();
      const v = p.vel || spec.vel || new THREE.Vector3();
      return {
        cur: pos.clone(),
        prev: pos.clone().addScaledVector(v, -1 / 60),
        radius: p.radius != null ? p.radius : 0.12,
        mass: p.mass != null ? p.mass : 1,
        pinned: !!p.pinned,
      };
    });
    const links = (spec.links || []).map(l => ({
      a: l[0], b: l[1],
      len: l[2] != null ? l[2] : (pts[l[0]] && pts[l[1]] ? pts[l[0]].cur.distanceTo(pts[l[1]].cur) : 0.3),
      stiff: l[3] != null ? l[3] : 1,
    }));
    const rd = {
      points: pts, links, dead: false,
      life: spec.life != null ? spec.life : 12,
      pos(i) { return pts[i].cur; },
      remove() {
        rd.dead = true;
        const k = phys.ragdolls.indexOf(rd);
        if (k >= 0) phys.ragdolls.splice(k, 1);
      },
      impulse(c, r, f) {
        for (const p of pts) {
          if (p.pinned) continue;
          const d = p.cur.distanceTo(c);
          if (d > r) continue;
          const dir = p.cur.clone().sub(c);
          if (dir.lengthSq() < 1e-8) dir.set(0, 1, 0);
          dir.normalize().multiplyScalar(f * (1 - d / r) / (p.mass * 60));
          p.prev.sub(dir);
        }
      },
      step(dt) { phys._stepRagdoll(rd, dt); },
    };
    this.ragdolls.push(rd);
    return rd;
  }

  _stepRagdoll(rd, dt) {
    const g = this.gravity * dt * dt;
    const damp = 0.985;
    const list = this._lists[6];
    for (const p of rd.points) {
      if (p.pinned) continue;
      const vx = (p.cur.x - p.prev.x) * damp;
      const vy = (p.cur.y - p.prev.y) * damp;
      const vz = (p.cur.z - p.prev.z) * damp;
      p.prev.copy(p.cur);
      p.cur.set(p.cur.x + vx, p.cur.y + vy + g, p.cur.z + vz);
    }
    for (let it = 0; it < 5; it++) {
      for (const l of rd.links) {
        const a = rd.points[l.a], b = rd.points[l.b];
        if (!a || !b) continue;
        const dx = b.cur.x - a.cur.x, dy = b.cur.y - a.cur.y, dz = b.cur.z - a.cur.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = ((d - l.len) / d) * 0.5 * l.stiff;
        if (!a.pinned) { a.cur.x += dx * diff; a.cur.y += dy * diff; a.cur.z += dz * diff; }
        if (!b.pinned) { b.cur.x -= dx * diff; b.cur.y -= dy * diff; b.cur.z -= dz * diff; }
      }
      for (const p of rd.points) {
        if (p.pinned) continue;
        if (p.cur.y - p.radius < this.floorY) {
          p.cur.y = this.floorY + p.radius;
          p.prev.x += (p.cur.x - p.prev.x) * 0.4;    // ground friction
          p.prev.z += (p.cur.z - p.prev.z) * 0.4;
        }
        this._box.min.set(p.cur.x - p.radius, p.cur.y - p.radius, p.cur.z - p.radius);
        this._box.max.set(p.cur.x + p.radius, p.cur.y + p.radius, p.cur.z + p.radius);
        this._query(this._box.min, this._box.max, list);
        for (let i = 0; i < list.length; i++) {
          const box = this._boxes[list[i]];
          const q = this._v1.set(
            clamp(p.cur.x, box.min.x, box.max.x),
            clamp(p.cur.y, box.min.y, box.max.y),
            clamp(p.cur.z, box.min.z, box.max.z));
          const d = this._v0.copy(p.cur).sub(q);
          let len = d.length();
          if (len >= p.radius) continue;
          if (len < 1e-6) { d.set(0, 1, 0); len = 1e-6; }
          p.cur.addScaledVector(d.divideScalar(len), p.radius - len);
        }
      }
    }
    rd.life -= dt;
    if (rd.life <= 0) rd.remove();
  }

  // --------------------------------------------------------------------- tick

  update(dt) {
    this._sync();
    if (!(dt > 0)) return;
    const h = Math.min(dt, 1 / 30);
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.bodies.splice(i, 1); b.dead = true;
        if (b.mesh && b.mesh.parent) b.mesh.parent.remove(b.mesh);
        continue;
      }
      this._stepBody(b, h);
    }
    for (let i = this.ragdolls.length - 1; i >= 0; i--) this._stepRagdoll(this.ragdolls[i], h);
  }
}
