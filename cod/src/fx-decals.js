// Oriented bullet-hole / scorch decals. One draw call per field: a fixed pool of
// quads in a single BufferGeometry whose corner positions are written on spawn and
// whose per-vertex alpha is ticked for the fade-out. Ring buffer = hard budget.
import * as THREE from 'three';

const _t = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3();

function holeAtlas() {
  const S = 512, T = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);

  const tile = (tx, ty, draw) => { g.save(); g.translate(tx * T, ty * T); g.beginPath(); g.rect(0, 0, T, T); g.clip(); draw(g, T); g.restore(); };

  // generic hard-surface hole: dark crater, bright chipped halo, radial cracks
  tile(0, 0, (g, s) => {
    const c0 = s / 2;
    let grd = g.createRadialGradient(c0, c0, 0, c0, c0, s * 0.42);
    grd.addColorStop(0.0, 'rgba(180,178,172,0.55)');
    grd.addColorStop(0.35, 'rgba(150,148,142,0.30)');
    grd.addColorStop(1.0, 'rgba(150,148,142,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 7, r = s * (0.16 + Math.random() * 0.24);
      g.fillStyle = `rgba(210,206,198,${0.10 + Math.random() * 0.25})`;
      g.beginPath(); g.arc(c0 + Math.cos(a) * r, c0 + Math.sin(a) * r, s * (0.01 + Math.random() * 0.035), 0, 7); g.fill();
    }
    grd = g.createRadialGradient(c0, c0, 0, c0, c0, s * 0.15);
    grd.addColorStop(0, 'rgba(10,9,8,0.95)');
    grd.addColorStop(0.6, 'rgba(18,16,14,0.85)');
    grd.addColorStop(1, 'rgba(30,28,26,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(c0, c0, s * 0.15, 0, 7); g.fill();
    g.strokeStyle = 'rgba(20,18,16,0.5)';
    for (let i = 0; i < 7; i++) {
      g.lineWidth = 0.8 + Math.random() * 1.6;
      g.beginPath(); g.moveTo(c0, c0);
      const a = Math.random() * 7, r = s * (0.16 + Math.random() * 0.24);
      g.lineTo(c0 + Math.cos(a) * r, c0 + Math.sin(a) * r); g.stroke();
    }
  });

  // metal: punched hole with a bright torn lip
  tile(1, 0, (g, s) => {
    const c0 = s / 2;
    let grd = g.createRadialGradient(c0, c0, s * 0.06, c0, c0, s * 0.20);
    grd.addColorStop(0, 'rgba(6,6,7,0.98)');
    grd.addColorStop(0.55, 'rgba(230,236,245,0.75)');
    grd.addColorStop(0.8, 'rgba(120,124,132,0.35)');
    grd.addColorStop(1, 'rgba(90,94,100,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(c0, c0, s * 0.2, 0, 7); g.fill();
    g.strokeStyle = 'rgba(200,206,216,0.45)';
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 7;
      g.lineWidth = 0.7 + Math.random() * 1.4;
      g.beginPath();
      g.moveTo(c0 + Math.cos(a) * s * 0.14, c0 + Math.sin(a) * s * 0.14);
      g.lineTo(c0 + Math.cos(a) * s * (0.2 + Math.random() * 0.16), c0 + Math.sin(a) * s * (0.2 + Math.random() * 0.16));
      g.stroke();
    }
  });

  // wood: splintered hole
  tile(0, 1, (g, s) => {
    const c0 = s / 2;
    const grd = g.createRadialGradient(c0, c0, 0, c0, c0, s * 0.30);
    grd.addColorStop(0, 'rgba(14,10,7,0.95)');
    grd.addColorStop(0.35, 'rgba(60,40,24,0.6)');
    grd.addColorStop(1, 'rgba(90,64,38,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(c0, c0, s * 0.3, 0, 7); g.fill();
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 7, r0 = s * 0.08, r1 = s * (0.16 + Math.random() * 0.26);
      g.strokeStyle = `rgba(${150 + Math.random() * 60 | 0},${110 + Math.random() * 40 | 0},70,${0.25 + Math.random() * 0.4})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      g.moveTo(c0 + Math.cos(a) * r0, c0 + Math.sin(a) * r0);
      g.lineTo(c0 + Math.cos(a) * r1, c0 + Math.sin(a) * r1);
      g.stroke();
    }
  });

  // glass: spider-web crack
  tile(1, 1, (g, s) => {
    const c0 = s / 2;
    g.strokeStyle = 'rgba(235,245,255,0.55)';
    const rays = 11, R = [];
    for (let i = 0; i < rays; i++) R.push((i / rays) * Math.PI * 2 + Math.random() * 0.2);
    for (const a of R) {
      g.lineWidth = 0.6 + Math.random() * 1.8;
      g.beginPath(); g.moveTo(c0, c0);
      let r = 0;
      while (r < s * 0.44) { r += s * (0.05 + Math.random() * 0.08); g.lineTo(c0 + Math.cos(a + (Math.random() - 0.5) * 0.16) * r, c0 + Math.sin(a + (Math.random() - 0.5) * 0.16) * r); }
      g.stroke();
    }
    for (let ring = 1; ring <= 4; ring++) {
      const rr = s * 0.10 * ring;
      g.lineWidth = 0.5 + Math.random();
      g.strokeStyle = `rgba(225,238,255,${0.4 - ring * 0.06})`;
      g.beginPath();
      for (let i = 0; i <= rays; i++) {
        const a = R[i % rays], x = c0 + Math.cos(a) * rr * (0.9 + Math.random() * 0.2), y = c0 + Math.sin(a) * rr * (0.9 + Math.random() * 0.2);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.stroke();
    }
    const grd = g.createRadialGradient(c0, c0, 0, c0, c0, s * 0.09);
    grd.addColorStop(0, 'rgba(10,14,18,0.8)');
    grd.addColorStop(1, 'rgba(200,220,240,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(c0, c0, s * 0.09, 0, 7); g.fill();
  });

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function scorchTex() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  const c0 = S / 2;
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * 7, d = Math.pow(Math.random(), 0.7) * c0 * 0.85;
    const x = c0 + Math.cos(a) * d, y = c0 + Math.sin(a) * d, r = S * (0.04 + Math.random() * 0.14);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(6,5,5,0.42)');
    grd.addColorStop(1, 'rgba(6,5,5,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.globalCompositeOperation = 'destination-in';
  const grd = g.createRadialGradient(c0, c0, 0, c0, c0, c0);
  grd.addColorStop(0, 'rgba(0,0,0,1)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.9)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT = /* glsl */`
attribute float aAlpha;
varying vec2 vUv;
varying float vA;
void main() {
  vUv = uv; vA = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying float vA;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(t.rgb, a);
}`;

export class DecalField {
  /** kinds: number of atlas tiles across/down (2 for the hole atlas, 1 for scorch) */
  constructor(ctx, { count = 128, map, tiles = 1, renderOrder = 3, life = 26, fade = 5 } = {}) {
    this.ctx = ctx;
    this.n = count; this.tiles = tiles; this.life = life; this.fade = fade;
    this.cursor = 0;
    this.pos = new Float32Array(count * 12);
    this.uv = new Float32Array(count * 8);
    this.alpha = new Float32Array(count * 4);
    const idx = new Uint16Array(count * 6);
    for (let i = 0; i < count; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    const geo = new THREE.BufferGeometry();
    this.bPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.bUv = new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage);
    this.bA = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.bPos);
    geo.setAttribute('uv', this.bUv);
    geo.setAttribute('aAlpha', this.bA);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8,
      side: THREE.DoubleSide, toneMapped: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.birth = new Float32Array(count).fill(-1e9);
    this.time = 0;
    this.live = 0;
  }

  add(p, n, size, tile = 0, roll = Math.random() * 6.283, lifeScale = 1) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.n;
    // build an orthonormal basis around the surface normal
    _up.set(0, 1, 0);
    if (Math.abs(n.y) > 0.92) _up.set(1, 0, 0);
    _t.crossVectors(_up, n).normalize();
    _b.crossVectors(n, _t).normalize();
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const tx = _t.x * cr + _b.x * sr, ty = _t.y * cr + _b.y * sr, tz = _t.z * cr + _b.z * sr;
    const bx = -_t.x * sr + _b.x * cr, by = -_t.y * sr + _b.y * cr, bz = -_t.z * sr + _b.z * cr;
    const ox = p.x + n.x * 0.012, oy = p.y + n.y * 0.012, oz = p.z + n.z * 0.012;
    const o = i * 12;
    const P = this.pos;
    const sx = tx * size, sy = ty * size, sz = tz * size;
    const ux = bx * size, uy = by * size, uz = bz * size;
    P[o + 0] = ox - sx - ux; P[o + 1] = oy - sy - uy; P[o + 2] = oz - sz - uz;
    P[o + 3] = ox + sx - ux; P[o + 4] = oy + sy - uy; P[o + 5] = oz + sz - uz;
    P[o + 6] = ox + sx + ux; P[o + 7] = oy + sy + uy; P[o + 8] = oz + sz + uz;
    P[o + 9] = ox - sx + ux; P[o + 10] = oy - sy + uy; P[o + 11] = oz - sz + uz;
    const T = this.tiles, tu = (tile % T) / T, tv = ((tile / T) | 0) / T, w = 1 / T;
    const u = this.uv, j = i * 8;
    u[j] = tu; u[j + 1] = tv;
    u[j + 2] = tu + w; u[j + 3] = tv;
    u[j + 4] = tu + w; u[j + 5] = tv + w;
    u[j + 6] = tu; u[j + 7] = tv + w;
    this.birth[i] = this.time;
    this.lifeScale = lifeScale;
    this.bPos.needsUpdate = true;
    this.bUv.needsUpdate = true;
    this.dirty = true;
    this.live = Math.min(this.n, this.live + 1);
  }

  update(dt) {
    this.time += dt;
    if (!this.live) return;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const age = this.time - this.birth[i];
      let a = 0;
      if (age >= 0 && age < this.life) {
        a = age < 0.04 ? age / 0.04 : 1;
        const left = this.life - age;
        if (left < this.fade) a *= left / this.fade;
        any = true;
      }
      const j = i * 4;
      if (this.alpha[j] !== a) { this.alpha[j] = this.alpha[j + 1] = this.alpha[j + 2] = this.alpha[j + 3] = a; this.dirty = true; }
    }
    if (this.dirty) { this.bA.needsUpdate = true; this.dirty = false; }
    if (!any) this.live = 0;
  }
}

export function makeDecalFields(ctx) {
  return {
    holes: new DecalField(ctx, { count: 160, map: holeAtlas(), tiles: 2, life: 30, fade: 6, renderOrder: 3 }),
    scorch: new DecalField(ctx, { count: 24, map: scorchTex(), tiles: 1, life: 60, fade: 12, renderOrder: 2 }),
  };
}
