// GPU particle field for fx.js — instanced camera-facing quads, simulated entirely
// in the vertex shader (position = p0 + v*integral(drag) + gravity), so the CPU only
// ever writes a spawn record into a ring buffer. Zero per-frame allocation.
import * as THREE from 'three';

/* ------------------------------------------------------------ sprite atlas */

const TEX = new Map();
function canvasTex(key, size, draw) {
  if (TEX.has(key)) return TEX.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  TEX.set(key, t);
  return t;
}

function radial(g, s, stops, cx, cy, r) {
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [p, c] of stops) grd.addColorStop(p, c);
  g.fillStyle = grd;
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
}

export function sprite(kind) {
  switch (kind) {
    // soft round falloff — sparks, glow, dust cores
    case 'soft': return canvasTex('soft', 64, (g, s) => {
      radial(g, s, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']], s / 2, s / 2, s / 2);
    });
    // hot point with a tight core — metal sparks / embers
    case 'spark': return canvasTex('spark', 64, (g, s) => {
      radial(g, s, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,240,210,0.9)'], [0.55, 'rgba(255,150,60,0.25)'], [1, 'rgba(255,80,20,0)']], s / 2, s / 2, s / 2);
    });
    // lumpy smoke puff: several offset blobs inside a global falloff
    case 'smoke': return canvasTex('smoke', 128, (g, s) => {
      g.clearRect(0, 0, s, s);
      const c = s / 2;
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * 7, d = Math.pow(Math.random(), 0.6) * c * 0.52;
        const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d, r = c * (0.16 + Math.random() * 0.3);
        radial(g, s, [[0, 'rgba(255,255,255,0.34)'], [1, 'rgba(255,255,255,0)']], x, y, r);
      }
      // clip to a circle so the puff never shows a square edge
      g.globalCompositeOperation = 'destination-in';
      radial(g, s, [[0, 'rgba(0,0,0,1)'], [0.62, 'rgba(0,0,0,0.95)'], [1, 'rgba(0,0,0,0)']], c, c, c);
      g.globalCompositeOperation = 'source-over';
    });
    // angular fragment — concrete chips, wood splinters, debris
    case 'chip': return canvasTex('chip', 32, (g, s) => {
      g.clearRect(0, 0, s, s);
      g.fillStyle = '#fff';
      g.beginPath();
      const n = 5;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.4;
        const r = s * (0.22 + Math.random() * 0.22);
        const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.fill();
    });
    // four-point star flare for the muzzle flash core
    case 'star': return canvasTex('star', 128, (g, s) => {
      g.clearRect(0, 0, s, s);
      const c = s / 2;
      radial(g, s, [[0, 'rgba(255,255,255,1)'], [0.14, 'rgba(255,246,220,0.85)'], [0.4, 'rgba(255,190,110,0.20)'], [1, 'rgba(255,140,50,0)']], c, c, c);
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 4; k++) {
        g.save(); g.translate(c, c); g.rotate(k * Math.PI / 4);
        const w = k & 1 ? s * 0.012 : s * 0.02, l = k & 1 ? c * 0.6 : c * 0.98;
        const grd = g.createLinearGradient(-l, 0, l, 0);
        grd.addColorStop(0, 'rgba(255,200,120,0)');
        grd.addColorStop(0.5, 'rgba(255,250,230,0.85)');
        grd.addColorStop(1, 'rgba(255,200,120,0)');
        g.fillStyle = grd; g.fillRect(-l, -w, l * 2, w * 2);
        g.restore();
      }
      g.globalCompositeOperation = 'source-over';
    });
    // muzzle-flash petal: a teardrop of flame
    case 'petal': return canvasTex('petal', 128, (g, s) => {
      g.clearRect(0, 0, s, s);
      const c = s / 2;
      for (let i = 0; i < 22; i++) {
        const t = i / 21;
        const y = s * (0.94 - t * 0.9);
        const r = s * (0.06 + Math.sin(t * Math.PI) * 0.20) * (1 - t * 0.35);
        const a = 0.5 * (1 - t * 0.7);
        radial(g, s, [[0, `rgba(255,${230 - t * 90 | 0},${170 - t * 130 | 0},${a})`], [1, 'rgba(255,120,30,0)']], c, y, r);
      }
    });
    // expanding shock ring
    case 'ring': return canvasTex('ring', 128, (g, s) => {
      g.clearRect(0, 0, s, s);
      const c = s / 2;
      const grd = g.createRadialGradient(c, c, 0, c, c, c);
      grd.addColorStop(0.0, 'rgba(255,255,255,0)');
      grd.addColorStop(0.72, 'rgba(255,255,255,0)');
      grd.addColorStop(0.86, 'rgba(255,255,255,0.85)');
      grd.addColorStop(0.95, 'rgba(255,235,200,0.25)');
      grd.addColorStop(1.0, 'rgba(255,220,180,0)');
      g.fillStyle = grd; g.fillRect(0, 0, s, s);
    });
    // blood droplet cluster
    case 'blood': return canvasTex('blood', 64, (g, s) => {
      g.clearRect(0, 0, s, s);
      radial(g, s, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']], s / 2, s / 2, s / 2);
    });
    default: return sprite('soft');
  }
}

/* ------------------------------------------------------------ particle field */

const VERT = /* glsl */`
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec3 aCol;
attribute vec4 aP;   // birth, life, size0, size1
attribute vec4 aQ;   // gravity, drag, rot0, spin
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
void main() {
  float age = uTime - aP.x;
  float t = age / max(aP.y, 1e-3);
  if (age < 0.0 || t > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float k = max(aQ.y, 1e-4);
  float e = (1.0 - exp(-k * age)) / k;
  vec3 p = aPos + aVel * e;
  p.y -= 0.5 * aQ.x * age * age;
  float sz = mix(aP.z, aP.w, t);
  float rot = aQ.z + aQ.w * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec2 q = (uv - 0.5) * sz;
  float cr = cos(rot), sr = sin(rot);
  mv.xy += vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vCol = aCol;
#ifdef SOFT
  vA = smoothstep(0.0, 0.14, t) * (1.0 - smoothstep(0.25, 1.0, t));
#else
  vA = smoothstep(0.0, 0.05, t) * pow(1.0 - t, 1.7);
#endif
}`;

const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vCol;
varying float vA;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vA * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * t.rgb, a);
}`;

export class ParticleField {
  /** opts: {count, map, additive, opacity, renderOrder} */
  constructor(ctx, opts) {
    this.ctx = ctx;
    this.n = opts.count;
    this.cursor = 0;
    const n = this.n;
    this.aPos = new Float32Array(n * 3);
    this.aVel = new Float32Array(n * 3);
    this.aCol = new Float32Array(n * 3);
    this.aP = new Float32Array(n * 4);
    this.aQ = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) this.aP[i * 4 + 1] = 1; // life>0 so nothing divides by zero

    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const IBA = THREE.InstancedBufferAttribute;
    this.bPos = new IBA(this.aPos, 3); this.bVel = new IBA(this.aVel, 3);
    this.bCol = new IBA(this.aCol, 3); this.bP = new IBA(this.aP, 4); this.bQ = new IBA(this.aQ, 4);
    for (const b of [this.bPos, this.bVel, this.bCol, this.bP, this.bQ]) b.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.bPos);
    geo.setAttribute('aVel', this.bVel);
    geo.setAttribute('aCol', this.bCol);
    geo.setAttribute('aP', this.bP);
    geo.setAttribute('aQ', this.bQ);
    geo.instanceCount = n;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMap: { value: opts.map }, uOpacity: { value: opts.opacity ?? 1 } },
      vertexShader: VERT, fragmentShader: FRAG,
      defines: opts.additive ? {} : { SOFT: '' },
      transparent: true, depthWrite: false, depthTest: true,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? 4;
    this.dirty = false;
    this.time = 0;
  }

  /** All arguments are plain numbers so nothing is allocated on a spawn. */
  emit(px, py, pz, vx, vy, vz, r, g, b, size0, size1, life, grav, drag, rot, spin) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.n;
    const i3 = i * 3, i4 = i * 4;
    this.aPos[i3] = px; this.aPos[i3 + 1] = py; this.aPos[i3 + 2] = pz;
    this.aVel[i3] = vx; this.aVel[i3 + 1] = vy; this.aVel[i3 + 2] = vz;
    this.aCol[i3] = r; this.aCol[i3 + 1] = g; this.aCol[i3 + 2] = b;
    this.aP[i4] = this.time; this.aP[i4 + 1] = life; this.aP[i4 + 2] = size0; this.aP[i4 + 3] = size1;
    this.aQ[i4] = grav; this.aQ[i4 + 1] = drag; this.aQ[i4 + 2] = rot; this.aQ[i4 + 3] = spin;
    this.dirty = true;
  }

  update(dt) {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    if (this.dirty) {
      this.bPos.needsUpdate = this.bVel.needsUpdate = this.bCol.needsUpdate = true;
      this.bP.needsUpdate = this.bQ.needsUpdate = true;
      this.dirty = false;
    }
  }
}
