/* Cars + driving for the Birmingham map — the same feel as the main game.
   Car bodies: the detailed supercar GLB when present, else a procedural body.
   Both get articulated wheels that spin with speed and steer at the front. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- materials (PBR so they reflect the environment) ----------
const TIRE = new THREE.MeshStandardMaterial({ color: 0x0c0d11, metalness: 0.1, roughness: 0.82 });
const HUB = new THREE.MeshStandardMaterial({ color: 0xc6ccd6, metalness: 0.95, roughness: 0.24 });
const SPOKE = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.3 });
const TRIM = new THREE.MeshStandardMaterial({ color: 0x2b2e37, metalness: 0.85, roughness: 0.32 });
const GLASS = new THREE.MeshStandardMaterial({ color: 0x0b111c, metalness: 0.95, roughness: 0.06 });
const HEAD = new THREE.MeshBasicMaterial({ color: 0xffe9a3 });

function makeWheel(r) {
  const steerG = new THREE.Group(), spinG = new THREE.Group();
  steerG.add(spinG);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 18), TIRE);
  tire.rotation.x = Math.PI / 2; spinG.add(tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.52, r * 0.52, 0.32, 12), HUB);
  hub.rotation.x = Math.PI / 2; spinG.add(hub);
  for (let k = 0; k < 4; k++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(r * 1.7, 0.06, 0.07), SPOKE);
    s.rotation.z = k * Math.PI / 4; spinG.add(s);
  }
  return { steerG, spinG };
}

/** Procedural car body with real proportions + four articulated wheels. */
export function buildProceduralCar(color = 0xd11f2a) {
  const g = new THREE.Group();
  const len = 4.7, bh = 0.72, wid = 2.05, clr = 0.30;
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.28 });
  const chassisH = bh * 0.64;
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(len, chassisH, wid), paint);
  chassis.position.y = clr + chassisH / 2; g.add(chassis);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(len * 0.99, bh * 0.16, wid * 1.01), paint);
  belt.position.y = chassis.position.y + chassisH / 2; g.add(belt);
  const cabH = bh * 0.62, cabY = clr + chassisH + cabH / 2 - 0.05;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(len * 0.4, cabH, wid * 0.8), GLASS);
  cabin.position.set(-len * 0.05, cabY, 0); g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len * 0.36, 0.08, wid * 0.78), paint);
  roof.position.set(-len * 0.05, cabY + cabH / 2, 0); g.add(roof);
  for (const sx of [1, -1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, wid * 0.98), TRIM);
    b.position.set(sx * (len / 2 - 0.03), clr + 0.22, 0); g.add(b);
  }
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.15, 0.36), HEAD);
    hl.position.set(len / 2 - 0.02, clr + 0.42, s * wid * 0.31); g.add(hl);
  }
  const wheels = [];
  const wr = 0.42, axleX = len * 0.33, axleZ = wid / 2 - 0.02;
  for (const [wx, front] of [[axleX, true], [-axleX, false]]) for (const s of [-1, 1]) {
    const w = makeWheel(wr); w.front = front;
    w.steerG.position.set(wx, wr, s * axleZ); g.add(w.steerG); wheels.push(w);
  }
  g.userData.wheels = wheels; g.userData.wheelR = wr;
  return g;
}

/** Load the detailed supercar GLB; falls back to the procedural body. */
export async function loadCar(url = './assets/super.glb', color = 0xd11f2a) {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    // normalise: scale to ~4.6 m long, sit on the ground, face +X
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const longest = Math.max(size.x, size.z);
    const s = 4.6 / (longest || 1);
    const inner = new THREE.Group(); inner.add(root); inner.scale.setScalar(s);
    if (size.z > size.x) inner.rotation.y = Math.PI / 2;   // model runs along Z -> face +X
    inner.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(inner);
    const c = b2.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -b2.min.y, -c.z);
    const g = new THREE.Group(); g.add(inner);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // the GLB's wheels are baked in, so overlay spinners only if it has none
    g.userData.wheels = [];
    g.userData.wheelR = 0.42;
    g.userData.glb = true;
    return g;
  } catch (e) {
    console.warn('supercar GLB unavailable, using procedural body:', e.message);
    return buildProceduralCar(color);
  }
}

/** The main game's car handling: accel/brake, speed-scaled steering, body roll,
 *  brake dive, accel squat, road bob, nitro. Ground height comes from the map. */
export class CarSim {
  constructor(opts = {}) {
    this.x = opts.x || 0; this.z = opts.z || 0; this.y = opts.y || 0;
    this.yaw = opts.yaw || 0;
    this.spd = 0; this.steer = 0; this.wheelSpin = 0;
    this.roll = 0; this.pitch = 0; this.bob = 0; this.bobT = 0;
    this.braking = false;
    this.top = opts.top || 62;      // m/s
    this.acc = opts.acc || 18;
    this.nitro = 100;
  }
  step(dt, inp, groundAt) {
    const prevSpd = this.spd;
    const boost = inp.nitro && this.nitro > 0 && inp.fwd;
    if (boost) this.nitro = Math.max(0, this.nitro - 26 * dt);
    else this.nitro = Math.min(100, this.nitro + 7 * dt);
    const top = this.top * (boost ? 1.25 : 1);
    if (inp.fwd) this.spd += (this.spd < 0 ? 30 : this.acc * (boost ? 1.5 : 1)) * dt;
    if (inp.back) this.spd -= (this.spd > 0 ? 28 : this.acc * 0.6) * dt;
    if (!inp.fwd && !inp.back) this.spd -= this.spd * 1.0 * dt;
    if (inp.handbrake) this.spd -= this.spd * 2.6 * dt;
    this.spd = clamp(this.spd, -14, top);
    this.braking = !!inp.back && this.spd > 3;

    const steerIn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const turnRate = steerIn * (inp.handbrake ? 2.6 : 1.8) * dt * clamp(this.spd / 12, -1, 1);
    this.yaw += turnRate;
    this.steer += (steerIn - this.steer) * clamp(10 * dt, 0, 1);
    this.wheelSpin += this.spd * dt;

    // body dynamics
    const latG = (turnRate / Math.max(dt, 0.001)) * this.spd * 0.010;
    const lonG = (this.spd - prevSpd) / Math.max(dt, 0.001);
    this.roll += (clamp(-latG, -0.22, 0.22) - this.roll) * clamp(9 * dt, 0, 1);
    this.pitch += (clamp(lonG * 0.010, -0.16, 0.16) - this.pitch) * clamp(7 * dt, 0, 1);
    this.bobT += dt * (6 + Math.abs(this.spd) * 0.3);
    this.bob = Math.sin(this.bobT) * Math.min(0.05, Math.abs(this.spd) * 0.002);

    this.x += Math.cos(this.yaw) * this.spd * dt;
    this.z += Math.sin(this.yaw) * this.spd * dt;

    const g = groundAt ? groundAt(this.x, this.z) : 0;
    if (g !== null && g !== undefined) this.y += (g - this.y) * Math.min(1, 12 * dt);
    return g !== null && g !== undefined;
  }
  /** Push the sim state onto a car mesh (body lean + spinning/steering wheels). */
  applyTo(mesh, dt) {
    mesh.position.set(this.x, this.y + this.bob, this.z);
    mesh.rotation.set(this.pitch, -this.yaw, this.roll, 'YXZ');
    const ws = mesh.userData.wheels;
    if (ws && ws.length) {
      const spin = this.spd * dt / (mesh.userData.wheelR || 0.42);
      for (const w of ws) { w.spinG.rotation.z -= spin; if (w.front) w.steerG.rotation.y = this.steer * 0.55; }
    }
  }
  get mph() { return Math.round(Math.abs(this.spd) * 2.237); }
}
