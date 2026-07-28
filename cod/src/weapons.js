// Weapons: procedural viewmodels, ADS, recoil patterns, reload, ballistics.
// Owner: weapons agent. Public API: update(dt), fire(), reload(), equip(id), current.
import * as THREE from 'three';

export const WEAPONS = {
  ar: { name: 'MK-4 CARBINE', rpm: 720, dmg: 28, mag: 30, reload: 2.1, spread: 0.006, recoil: [0.9, 0.35], range: 220 },
  smg: { name: 'VECTOR-9', rpm: 950, dmg: 21, mag: 32, reload: 1.8, spread: 0.010, recoil: [0.6, 0.5], range: 120 },
  sniper: { name: 'LR-338', rpm: 45, dmg: 110, mag: 5, reload: 3.0, spread: 0.0005, recoil: [3.4, 0.9], range: 600 },
};

export class Weapons {
  constructor(ctx) {
    this.ctx = ctx;
    this.rig = new THREE.Group();       // parented to the camera — the viewmodel
    ctx.camera.add(this.rig);
    this.id = 'ar';
    this.ammo = WEAPONS.ar.mag;
    this.reserve = 180;
    this.cool = 0; this.reloading = 0;
    this.recoil = new THREE.Vector2();
    this.buildViewmodel();
  }
  get def() { return WEAPONS[this.id]; }
  buildViewmodel() {
    this.rig.clear();
    const M = this.ctx.materials;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), M.get('metal'));
    body.position.set(0.16, -0.14, -0.42);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.35, 12), M.get('metal'));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0.16, -0.115, -0.78);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.09), M.get('metal'));
    mag.position.set(0.16, -0.24, -0.36);
    for (const m of [body, barrel, mag]) { m.castShadow = false; m.renderOrder = 10; this.rig.add(m); }
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0.16, -0.115, -0.95);
    this.rig.add(this.muzzle);
  }
  update(dt) {
    const { input, player, camera } = this.ctx;
    this.cool -= dt;
    if (this.reloading > 0) { this.reloading -= dt; if (this.reloading <= 0) this.finishReload(); }
    if (input?.enabled) {
      if (input.down('KeyR')) this.reload();
      if (input.mouse.left && this.cool <= 0 && this.reloading <= 0 && this.ammo > 0) this.fire();
    }
    // recoil spring back into the camera
    this.recoil.multiplyScalar(Math.exp(-dt * 9));
    // viewmodel sway / ADS pose
    const target = player.ads ? new THREE.Vector3(-0.0, -0.055, -0.28) : new THREE.Vector3(0, 0, 0);
    this.rig.position.lerp(target, 1 - Math.exp(-dt * 16));
    camera.fov = THREE.MathUtils.damp(camera.fov, player.ads ? this.ctx.config.adsFov : this.ctx.config.fov, 12, dt);
    camera.updateProjectionMatrix();
  }
  fire() {
    const d = this.def;
    this.cool = 60 / d.rpm;
    this.ammo--;
    const { camera, fx, ai, physics } = this.ctx;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const spread = this.ctx.player.ads ? d.spread * 0.35 : d.spread;
    dir.x += (Math.random() - 0.5) * spread; dir.y += (Math.random() - 0.5) * spread;
    dir.normalize();
    const origin = camera.position.clone();
    const hit = physics.raycast(origin, dir, d.range);
    const enemyHit = ai?.hitscan(origin, dir, d.range, d.dmg, hit ? hit.distance : d.range);
    fx?.tracer(this.muzzle.getWorldPosition(new THREE.Vector3()), hit ? hit.point : origin.clone().addScaledVector(dir, d.range));
    fx?.muzzleFlash(this.muzzle.getWorldPosition(new THREE.Vector3()));
    if (hit && !enemyHit) fx?.impact(hit.point, hit.normal);
    this.ctx.audio?.gunshot(this.id);
    this.recoil.x += d.recoil[0] * 0.01;
    this.ctx.player.pitch += d.recoil[0] * 0.006;
    this.ctx.player.yaw += (Math.random() - 0.5) * d.recoil[1] * 0.006;
    this.ctx.bus.emit('shot', { id: this.id });
  }
  reload() {
    if (this.reloading > 0 || this.ammo === this.def.mag || this.reserve <= 0) return;
    this.reloading = this.def.reload;
    this.ctx.bus.emit('reload', {});
  }
  finishReload() {
    const need = this.def.mag - this.ammo;
    const take = Math.min(need, this.reserve);
    this.ammo += take; this.reserve -= take;
  }
}
