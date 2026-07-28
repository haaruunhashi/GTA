// First-person player: movement state machine, camera, stance, view feel.
// Owner: player agent. Public API: update(dt), position, velocity, state.
import * as THREE from 'three';

const SPEED = { walk: 4.4, sprint: 7.2, crouch: 2.2, ads: 3.0 };

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.position = new THREE.Vector3(0, 0, 40);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI; this.pitch = 0;
    this.radius = 0.38; this.height = 1.8; this.eye = 1.62;
    this.grounded = true;
    this.state = 'idle';   // idle | walk | sprint | crouch | air | slide
    this.ads = false;
    this.hp = 100;
    this.bob = 0;
    this.sens = 0.0022;
  }
  update(dt) {
    const { input, physics, camera } = this.ctx;
    if (input && input.enabled) {
      this.yaw -= input.mouse.dx * this.sens * (this.ads ? 0.6 : 1);
      this.pitch = THREE.MathUtils.clamp(this.pitch - input.mouse.dy * this.sens * (this.ads ? 0.6 : 1), -1.45, 1.45);

      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const wish = new THREE.Vector3();
      if (input.down('KeyW')) wish.add(f);
      if (input.down('KeyS')) wish.sub(f);
      if (input.down('KeyD')) wish.add(r);
      if (input.down('KeyA')) wish.sub(r);
      const crouch = input.down('ControlLeft');
      this.ads = input.mouse.right;
      const sprint = input.down('ShiftLeft') && wish.lengthSq() > 0 && !this.ads && !crouch;
      const spd = crouch ? SPEED.crouch : sprint ? SPEED.sprint : this.ads ? SPEED.ads : SPEED.walk;
      if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(spd);
      const accel = this.grounded ? 14 : 3;
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, wish.x, accel, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, wish.z, accel, dt);
      if (input.down('Space') && this.grounded) { this.velocity.y = 6.2; this.grounded = false; }
      this.state = !this.grounded ? 'air' : crouch ? 'crouch' : sprint ? 'sprint' : wish.lengthSq() > 0 ? 'walk' : 'idle';
      this.eye = THREE.MathUtils.damp(this.eye, crouch ? 1.05 : 1.62, 12, dt);
    }
    const res = physics.moveCapsule(this.position, this.velocity, this.radius, this.height, dt);
    this.grounded = res.grounded;

    const speed2d = Math.hypot(this.velocity.x, this.velocity.z);
    this.bob += dt * speed2d * 1.5;
    const bobAmt = this.ads ? 0.004 : 0.02;
    camera.position.copy(this.position);
    camera.position.y += this.eye + Math.sin(this.bob * 2) * bobAmt;
    camera.position.x += Math.cos(this.bob) * bobAmt * 0.6;
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
