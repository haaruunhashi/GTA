// Visual effects: tracers, muzzle flashes, impacts, decals, blood, smoke, explosions.
// Owner: fx agent. Public API: tracer(a,b), muzzleFlash(p), impact(p,n), explosion(p,r), update(dt).
import * as THREE from 'three';

export class FX {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    ctx.scene.add(this.group);
    this.items = [];
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, toneMapped: false });
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 1, toneMapped: false });
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc070, toneMapped: false });
  }
  tracer(a, b) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 6), this.tracerMat.clone());
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.group.add(m);
    this.items.push({ m, life: 0.06, t: 0, kind: 'tracer' });
  }
  muzzleFlash(p) {
    const l = new THREE.PointLight(0xffd8a0, 40, 14, 2);
    l.position.copy(p);
    this.group.add(l);
    this.items.push({ m: l, life: 0.05, t: 0, kind: 'light' });
  }
  impact(p, n) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), this.sparkMat.clone());
    m.position.copy(p).addScaledVector(n, 0.03);
    this.group.add(m);
    this.items.push({ m, life: 0.18, t: 0, kind: 'impact' });
  }
  explosion(p, r = 5) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r * 0.4, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, toneMapped: false }));
    m.position.copy(p);
    this.group.add(m);
    this.items.push({ m, life: 0.5, t: 0, kind: 'boom', r });
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) { this.group.remove(it.m); it.m.geometry?.dispose?.(); this.items.splice(i, 1); continue; }
      if (it.kind === 'light') it.m.intensity = 40 * (1 - k);
      else if (it.m.material) it.m.material.opacity = 1 - k;
      if (it.kind === 'boom') it.m.scale.setScalar(1 + k * 2);
    }
  }
}
