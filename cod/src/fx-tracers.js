// Additive bullet tracers: one InstancedBufferGeometry, the streak is integrated in
// the vertex shader (head travels start->end at muzzle velocity, tail trails behind).
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec3 aA;
attribute vec3 aB;
attribute vec4 aP;    // birth, life, speed, width
attribute vec3 aC;
uniform float uTime;
varying vec2 vUv;
varying vec3 vC;
varying float vA;
void main() {
  float age = uTime - aP.x;
  if (age < 0.0 || age > aP.y) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec3 d = aB - aA;
  float L = length(d);
  vec3 dir = d / max(L, 1e-4);
  float trav = aP.z * age;
  float head = min(trav, L);
  float streak = min(L * 0.55, 8.0);
  vec3 tail = aA + dir * max(head - streak, 0.0);
  vec3 hd = aA + dir * head;
  vec3 mvT = (modelViewMatrix * vec4(tail, 1.0)).xyz;
  vec3 mvH = (modelViewMatrix * vec4(hd, 1.0)).xyz;
  vec3 p = mix(mvT, mvH, uv.y);
  vec3 ax = mvH - mvT;
  float axl = length(ax);
  ax = axl > 1e-5 ? ax / axl : vec3(0.0, 0.0, 1.0);
  vec3 view = normalize(-p);
  vec3 c = cross(ax, view);
  float cl = length(c);
  vec3 side = cl > 1e-3 ? c / cl : vec3(1.0, 0.0, 0.0);
  float w = aP.w * (1.0 + (1.0 - min(cl, 1.0)) * 2.5);
  p += side * (uv.x - 0.5) * 2.0 * w;
  gl_Position = projectionMatrix * vec4(p, 1.0);
  vUv = uv;
  vC = aC;
  vA = 1.0 - smoothstep(0.55, 1.0, age / aP.y);
}`;

const FRAG = /* glsl */`
varying vec2 vUv;
varying vec3 vC;
varying float vA;
void main() {
  float e = 1.0 - abs(vUv.x * 2.0 - 1.0);
  e = pow(max(e, 0.0), 1.6);
  float head = 0.18 + 1.5 * pow(vUv.y, 3.5);
  float a = e * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vC * head * a, a);
}`;

export class TracerField {
  constructor(ctx, count = 96) {
    this.ctx = ctx;
    this.n = count;
    this.cursor = 0;
    this.time = 0;
    this.aA = new Float32Array(count * 3);
    this.aB = new Float32Array(count * 3);
    this.aC = new Float32Array(count * 3);
    this.aP = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) this.aP[i * 4 + 1] = 1;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const IBA = THREE.InstancedBufferAttribute;
    this.bA = new IBA(this.aA, 3); this.bB = new IBA(this.aB, 3);
    this.bC = new IBA(this.aC, 3); this.bP = new IBA(this.aP, 4);
    for (const b of [this.bA, this.bB, this.bC, this.bP]) b.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aA', this.bA);
    geo.setAttribute('aB', this.bB);
    geo.setAttribute('aC', this.bC);
    geo.setAttribute('aP', this.bP);
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  add(ax, ay, az, bx, by, bz, speed, width, r, g, b) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.n;
    const i3 = i * 3, i4 = i * 4;
    this.aA[i3] = ax; this.aA[i3 + 1] = ay; this.aA[i3 + 2] = az;
    this.aB[i3] = bx; this.aB[i3 + 1] = by; this.aB[i3 + 2] = bz;
    this.aC[i3] = r; this.aC[i3 + 1] = g; this.aC[i3 + 2] = b;
    const L = Math.hypot(bx - ax, by - ay, bz - az);
    this.aP[i4] = this.time;
    this.aP[i4 + 1] = L / speed + 0.055;
    this.aP[i4 + 2] = speed;
    this.aP[i4 + 3] = width;
    this.dirty = true;
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.dirty) {
      this.bA.needsUpdate = this.bB.needsUpdate = this.bC.needsUpdate = this.bP.needsUpdate = true;
      this.dirty = false;
    }
  }
}
