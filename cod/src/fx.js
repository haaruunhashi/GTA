// Visual effects: tracers, muzzle flashes, per-surface impacts, decals, blood,
// shell casings, smoke, grenades and explosions.
// Owner: fx agent. Public API: tracer(a,b), muzzleFlash(p), impact(p,n), explosion(p,r), update(dt).
//
// Everything is pooled: particles live in GPU-simulated instanced fields, tracers in
// one instanced draw, decals in one quad-soup draw, casings in an InstancedMesh.
// Nothing allocates per frame and no visual is driven by setTimeout.
import * as THREE from 'three';
import { ParticleField, sprite } from './fx-particles.js';
import { TracerField } from './fx-tracers.js';
import { makeDecalFields } from './fx-decals.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3(0, 0, -1);

// ------------------------------------------------------------------ surfaces
// tile index into the hole atlas: 0 hard, 1 metal, 2 wood, 3 glass
const SURF = {
  concrete: { tile: 0, dust: [0.60, 0.58, 0.54], chip: [0.34, 0.33, 0.31], nDust: 10, nChip: 9, nSpark: 0, dustSize: 0.30, decal: 0.055, flash: 0.7 },
  brick: { tile: 0, dust: [0.55, 0.40, 0.33], chip: [0.42, 0.24, 0.18], nDust: 10, nChip: 9, nSpark: 0, dustSize: 0.30, decal: 0.055, flash: 0.7 },
  metal: { tile: 1, dust: [0.42, 0.44, 0.48], chip: [0.30, 0.32, 0.35], nDust: 3, nChip: 3, nSpark: 20, dustSize: 0.16, decal: 0.045, flash: 1.6 },
  wood: { tile: 2, dust: [0.48, 0.38, 0.26], chip: [0.40, 0.27, 0.15], nDust: 5, nChip: 14, nSpark: 0, dustSize: 0.20, decal: 0.06, flash: 0.5 },
  dirt: { tile: 0, dust: [0.42, 0.34, 0.24], chip: [0.26, 0.21, 0.14], nDust: 14, nChip: 10, nSpark: 0, dustSize: 0.38, decal: 0.07, flash: 0.35 },
  sand: { tile: 0, dust: [0.62, 0.54, 0.38], chip: [0.42, 0.36, 0.24], nDust: 16, nChip: 8, nSpark: 0, dustSize: 0.40, decal: 0.07, flash: 0.3 },
  glass: { tile: 3, dust: [0.70, 0.78, 0.86], chip: [0.72, 0.82, 0.92], nDust: 3, nChip: 16, nSpark: 4, dustSize: 0.14, decal: 0.10, flash: 1.0 },
  foliage: { tile: 0, dust: [0.24, 0.32, 0.16], chip: [0.20, 0.30, 0.12], nDust: 4, nChip: 12, nSpark: 0, dustSize: 0.20, decal: 0, flash: 0.2 },
  soft: { tile: 0, dust: [0.32, 0.30, 0.28], chip: [0.24, 0.22, 0.20], nDust: 6, nChip: 4, nSpark: 0, dustSize: 0.22, decal: 0.05, flash: 0.25 },
  flesh: { tile: 0, dust: [0.24, 0.02, 0.015], chip: [0.34, 0.02, 0.015], nDust: 4, nChip: 8, nSpark: 0, dustSize: 0.13, decal: 0, flash: 0 },
};

const NAME_TO_SURF = [
  [/asphalt|concrete|plaster|curb|gravel|stone|road|cement/, 'concrete'],
  [/brick/, 'brick'],
  [/steel|metal|corrugat|rust|chainlink|alu|iron|pipe|car_/, 'metal'],
  [/wood|plank|crate|pallet|door/, 'wood'],
  [/glass|window/, 'glass'],
  [/dirt|mud|ground|earth/, 'dirt'],
  [/sand|sandbag/, 'sand'],
  [/foliage|leaf|leaves|grass|bush|tree/, 'foliage'],
  [/tarp|rubber|cloth|fabric|canvas/, 'soft'],
];

export class FX {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    ctx.scene.add(this.group);
    this.time = 0;

    // ---- particle fields ----
    this.sparks = new ParticleField(ctx, { count: 900, map: sprite('spark'), additive: true, renderOrder: 6 });
    this.fire = new ParticleField(ctx, { count: 300, map: sprite('soft'), additive: true, renderOrder: 6 });
    this.debris = new ParticleField(ctx, { count: 700, map: sprite('chip'), additive: false, renderOrder: 4 });
    this.smokeF = new ParticleField(ctx, { count: 700, map: sprite('smoke'), additive: false, opacity: 0.85, renderOrder: 4 });
    this.bloodF = new ParticleField(ctx, { count: 300, map: sprite('blood'), additive: false, renderOrder: 4 });
    this.fields = [this.sparks, this.fire, this.debris, this.smokeF, this.bloodF];
    for (const f of this.fields) this.group.add(f.mesh);

    // ---- tracers + decals ----
    this.tracers = new TracerField(ctx, 96);
    this.group.add(this.tracers.mesh);
    const d = makeDecalFields(ctx);
    this.holes = d.holes; this.scorch = d.scorch;
    this.group.add(this.holes.mesh, this.scorch.mesh);

    // ---- dynamic lights (created once, never added/removed: no shader recompiles) ----
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffd6a0, 0, 18, 2);
      l.castShadow = false;
      l.visible = false;
      this.group.add(l);
      this.lights.push({ l, t: 0, life: 0, peak: 0, anchor: null });
    }

    this._buildFlashPool();
    this._buildCasings();
    this._buildExplosions();
    this._buildGrenades();

    this.shakeAmp = 0;
    this.shakeFreq = 1;
    this._surfCache = new Map();
    this._matMapSize = -1;

    ctx.bus.on('explosion', p => { if (p && p.pos) this.explosion(p.pos, p.radius || 5); });
  }

  /* ------------------------------------------------------------- pools */

  _buildFlashPool() {
    const star = sprite('star'), petal = sprite('petal'), soft = sprite('soft');
    const mk = (map, color, op) => new THREE.MeshBasicMaterial({
      map, color, transparent: true, opacity: op, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: true, side: THREE.DoubleSide, toneMapped: false,
    });
    const petalGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.flashes = [];
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      g.visible = false;
      const mats = [];
      const core = new THREE.Mesh(quad, mk(star, 0xffffff, 1)); core.renderOrder = 30;
      const glow = new THREE.Mesh(quad, mk(soft, 0xffb060, 1)); glow.renderOrder = 29;
      g.add(glow, core);
      mats.push(core.material, glow.material);
      const petals = [];
      for (let k = 0; k < 3; k++) {
        const hold = new THREE.Group();
        hold.rotation.z = (k / 3) * Math.PI * 2;
        const m = new THREE.Mesh(petalGeo, mk(petal, 0xffffff, 1));
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 30;
        hold.add(m);
        g.add(hold);
        petals.push(hold);
        mats.push(m.material);
      }
      this.flashes.push({ g, core, glow, petals, mats, t: 0, life: 0.05, active: false, scale: 1, seed: 0 });
    }
  }

  _buildCasings() {
    const N = 36;
    const geo = new THREE.CylinderGeometry(0.0044, 0.0040, 0.023, 7, 1);
    geo.translate(0, 0.002, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8a24a, roughness: 0.28, metalness: 1.0 });
    this.casings = new THREE.InstancedMesh(geo, mat, N);
    this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casings.frustumCulled = false;
    this.casings.castShadow = false;
    this.group.add(this.casings);
    this.cas = [];
    for (let i = 0; i < N; i++) {
      this.cas.push({
        p: new THREE.Vector3(), v: new THREE.Vector3(), e: new THREE.Euler(),
        w: new THREE.Vector3(), t: 0, life: 0, floor: -1e9, rest: false, active: false,
      });
      _m.makeScale(0, 0, 0);
      this.casings.setMatrixAt(i, _m);
    }
    this.casCursor = 0;
    this.casings.instanceMatrix.needsUpdate = true;
  }

  _buildExplosions() {
    const fireVert = /* glsl */`
      varying vec3 vN; varying vec3 vP;
      uniform float uT;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){
        vN = normalize(normalMatrix * normal);
        vec3 p = position;
        float n = sin(p.x*7.0 + uT*3.0) * sin(p.y*6.0 - uT*2.2) * sin(p.z*8.0 + uT*1.7);
        p += normal * n * 0.22;
        vP = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`;
    const fireFrag = /* glsl */`
      varying vec3 vN; varying vec3 vP;
      uniform float uT; uniform float uFade;
      void main(){
        float f = pow(1.0 - abs(vN.z), 1.4);
        vec3 hot = vec3(9.0, 6.2, 2.4);
        vec3 mid = vec3(6.0, 2.2, 0.55);
        vec3 cold = vec3(1.4, 0.35, 0.08);
        float k = clamp(uT * 1.35 + f * 0.7, 0.0, 1.0);
        vec3 c = mix(mix(hot, mid, k), cold, clamp(k * 1.4 - 0.35, 0.0, 1.0));
        float a = uFade * (0.55 + 0.45 * (1.0 - f));
        gl_FragColor = vec4(c * a, a);
      }`;
    this.booms = [];
    const sphere = new THREE.SphereGeometry(1, 20, 14);
    const quad = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.visible = false;
      const fb = new THREE.Mesh(sphere, new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uFade: { value: 1 } },
        vertexShader: fireVert, fragmentShader: fireFrag,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }));
      fb.renderOrder = 20;
      const ring = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
        map: sprite('ring'), color: 0xffe0b0, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 20;
      g.add(fb, ring);
      this.group.add(g);
      this.booms.push({ g, fb, ring, t: 0, life: 1, r: 4, active: false });
    }
  }

  _buildGrenades() {
    const geo = new THREE.CylinderGeometry(0.026, 0.026, 0.062, 10, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3c4433, roughness: 0.7, metalness: 0.4 });
    this.nades = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.castShadow = false;
      this.group.add(m);
      this.nades.push({ m, p: new THREE.Vector3(), v: new THREE.Vector3(), fuse: 0, active: false, spin: 0 });
    }
  }

  /* ------------------------------------------------------------- helpers */

  _light(x, y, z, color, peak, life, dist) {
    let best = this.lights[0], bestScore = 1e9;
    for (const e of this.lights) {
      const score = e.life > 0 ? e.peak * (1 - e.t / e.life) : -1;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    best.l.position.set(x, y, z);
    best.l.color.setHex(color);
    best.l.distance = dist;
    best.l.intensity = peak;
    best.l.visible = true;
    best.t = 0; best.life = life; best.peak = peak; best.anchor = null;
    return best;
  }

  /** Classify the surface a raycast hit, from userData, material identity or material look. */
  surfaceOf(object) {
    if (!object) return 'concrete';
    const ud = object.userData;
    if (ud) {
      if (ud.surface && SURF[ud.surface]) return ud.surface;
      if (ud.mat && SURF[ud.mat]) return ud.mat;
    }
    const mat = Array.isArray(object.material) ? object.material[0] : object.material;
    if (!mat) return 'concrete';
    if (mat.userData && mat.userData.surface && SURF[mat.userData.surface]) return mat.userData.surface;
    const cached = this._surfCache.get(mat);
    if (cached) return cached;
    let name = mat.name || '';
    // reverse-map the shared material cache (materials.js keys its cache by name)
    const cache = this.ctx.materials && this.ctx.materials.cache;
    if (!name && cache && cache.size !== this._matMapSize) {
      this._matMapSize = cache.size;
      for (const [k, v] of cache) if (v && !v.name) v.userData.mname = k;
    }
    if (!name && mat.userData && mat.userData.mname) name = mat.userData.mname;
    let kind = null;
    for (const [re, k] of NAME_TO_SURF) if (re.test(name)) { kind = k; break; }
    if (!kind) {
      if (mat.transparent && mat.opacity < 0.8) kind = 'glass';
      else if (mat.metalness > 0.55) kind = 'metal';
      else kind = 'concrete';
    }
    this._surfCache.set(mat, kind);
    return kind;
  }

  /* ------------------------------------------------------------- public FX */

  /** Tracer from a to b. opts: {speed, width, color:[r,g,b], skip} */
  tracer(a, b, opts) {
    const sp = (opts && opts.speed) || 340;
    const w = (opts && opts.width) || 0.022;
    const c = (opts && opts.color) || TRACER_COL;
    this.tracers.add(a.x, a.y, a.z, b.x, b.y, b.z, sp, w, c[0], c[1], c[2]);
  }

  /**
   * Multi-layer muzzle flash. `p` may be a Vector3 (world) or an Object3D anchor —
   * anchors are preferred for the viewmodel so the flash tracks recoil exactly.
   * opts: {dir, scale, light, smoke}
   */
  muzzleFlash(p, opts) {
    const o = opts || EMPTY;
    const scale = o.scale || 1;
    const anchor = p && p.isObject3D ? p : null;
    let f = null;
    for (const e of this.flashes) if (!e.active) { f = e; break; }
    if (!f) { f = this.flashes[0]; if (f.g.parent) f.g.parent.remove(f.g); }
    f.active = true; f.t = 0; f.life = 0.045 + scale * 0.012; f.scale = scale;
    f.seed = Math.random() * 6.283;
    f.g.visible = true;
    f.g.rotation.set(0, 0, f.seed);

    if (anchor) {
      anchor.add(f.g);
      f.g.position.set(0, 0, 0);
      anchor.updateWorldMatrix(true, false);
      _v.setFromMatrixPosition(anchor.matrixWorld);
      _v2.set(0, 0, -1).transformDirection(anchor.matrixWorld);
    } else {
      this.group.add(f.g);
      f.g.position.copy(p);
      _v.copy(p);
      _v2.copy((o.dir || _fwd));
      _q.setFromUnitVectors(_fwd, _v3.copy(_v2).normalize());
      f.g.quaternion.copy(_q);
      f.g.rotation.z += f.seed;
    }
    f.anchor = anchor;

    if (o.light !== false) {
      const e = this._light(_v.x, _v.y, _v.z, 0xffd2a0, 22 * scale * scale, 0.042, 9 * scale);
      e.anchor = anchor;
    }

    // muzzle smoke + a spray of unburnt powder sparks along the bore
    const dx = _v2.x, dy = _v2.y, dz = _v2.z;
    for (let i = 0; i < 7; i++) {
      const s = 3 + Math.random() * 9;
      this.sparks.emit(
        _v.x + dx * 0.04, _v.y + dy * 0.04, _v.z + dz * 0.04,
        dx * s + (Math.random() - 0.5) * 3.2, dy * s + (Math.random() - 0.5) * 3.2 + 0.4, dz * s + (Math.random() - 0.5) * 3.2,
        6.5, 3.0, 0.9, 0.020 * scale, 0.002, 0.10 + Math.random() * 0.14, 6, 7, 0, 0);
    }
    if (o.smoke !== false) {
      for (let i = 0; i < 2; i++) {
        this.smokeF.emit(
          _v.x + dx * 0.10, _v.y + dy * 0.10, _v.z + dz * 0.10,
          dx * 2.6 + (Math.random() - 0.5) * 0.7, dy * 2.6 + 0.35 + Math.random() * 0.4, dz * 2.6 + (Math.random() - 0.5) * 0.7,
          0.30, 0.30, 0.31, 0.06 * scale, 0.42 * scale, 0.42 + Math.random() * 0.3, -0.5, 3.4, Math.random() * 6.283, (Math.random() - 0.5) * 2);
      }
    }
    return f;
  }

  /** Lingering barrel smoke after sustained fire. */
  barrelSmoke(anchor, amount = 1) {
    anchor.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(anchor.matrixWorld);
    _v2.set(0, 0, -1).transformDirection(anchor.matrixWorld);
    this.smokeF.emit(_v.x, _v.y, _v.z,
      _v2.x * 0.5 + (Math.random() - 0.5) * 0.1, 0.45 + Math.random() * 0.25, _v2.z * 0.5 + (Math.random() - 0.5) * 0.1,
      0.34, 0.34, 0.35, 0.05, 0.34 * amount, 1.1 + Math.random() * 0.7, -0.35, 1.2, Math.random() * 6.283, (Math.random() - 0.5) * 1.2);
  }

  /** Per-surface impact. kind may be a surface name, or omitted to classify from `object`. */
  impact(p, n, kind, object) {
    let k = kind;
    // legacy two-argument call (ai.js hitting a body) -> a light blood spatter
    if (!k || !SURF[k]) k = object ? this.surfaceOf(object) : (kind === undefined ? 'flesh' : 'concrete');
    const S = SURF[k];
    const nx = n.x, ny = n.y, nz = n.z;
    const px = p.x + nx * 0.01, py = p.y + ny * 0.01, pz = p.z + nz * 0.01;

    // dust / smoke puff pushed back along the normal
    for (let i = 0; i < S.nDust; i++) {
      const s = 0.5 + Math.random() * 2.4;
      this.smokeF.emit(px, py, pz,
        nx * s + (Math.random() - 0.5) * 1.5, ny * s + (Math.random() - 0.5) * 1.5 + 0.5, nz * s + (Math.random() - 0.5) * 1.5,
        S.dust[0], S.dust[1], S.dust[2],
        S.dustSize * 0.25, S.dustSize * (1.4 + Math.random()), 0.5 + Math.random() * 0.7,
        -0.4, 4.5, Math.random() * 6.283, (Math.random() - 0.5) * 3);
    }
    // chips / splinters, gravity-bound
    for (let i = 0; i < S.nChip; i++) {
      const s = 2.5 + Math.random() * 7;
      const j = 0.75;
      this.debris.emit(px, py, pz,
        nx * s + (Math.random() - 0.5) * s * j, ny * s + (Math.random() - 0.5) * s * j + 1.2, nz * s + (Math.random() - 0.5) * s * j,
        S.chip[0], S.chip[1], S.chip[2],
        0.010 + Math.random() * 0.016, 0.006, 0.5 + Math.random() * 0.8,
        11, 0.5, Math.random() * 6.283, (Math.random() - 0.5) * 22);
    }
    // sparks on metal / glass
    for (let i = 0; i < S.nSpark; i++) {
      const s = 3 + Math.random() * 11;
      this.sparks.emit(px, py, pz,
        nx * s + (Math.random() - 0.5) * s, ny * s + (Math.random() - 0.5) * s + 1.5, nz * s + (Math.random() - 0.5) * s,
        7.0, 3.4, 1.1,
        0.014, 0.002, 0.20 + Math.random() * 0.35, 9, 0.9, 0, 0);
    }
    // impact flash + a very short light on hard hits
    if (S.flash > 0.4) {
      this.fire.emit(px, py, pz, nx * 0.3, ny * 0.3, nz * 0.3,
        5.0 * S.flash, 3.0 * S.flash, 1.6 * S.flash, 0.10 * S.flash, 0.02, 0.055, 0, 6, 0, 0);
    }
    if (S.decal > 0) {
      this.holes.add(p, n, S.decal * (0.85 + Math.random() * 0.4), S.tile);
    }
    return k;
  }

  /** Exit wound / spall on the far side of a penetrated surface. */
  penExit(p, n, kind) {
    const S = SURF[kind] || SURF.concrete;
    for (let i = 0; i < 6; i++) {
      const s = 2 + Math.random() * 6;
      this.debris.emit(p.x, p.y, p.z,
        n.x * s + (Math.random() - 0.5) * 3, n.y * s + (Math.random() - 0.5) * 3 + 1, n.z * s + (Math.random() - 0.5) * 3,
        S.chip[0], S.chip[1], S.chip[2], 0.010, 0.005, 0.5, 11, 0.6, Math.random() * 6.283, (Math.random() - 0.5) * 18);
    }
    for (let i = 0; i < 4; i++) {
      this.smokeF.emit(p.x, p.y, p.z, n.x * 1.6, n.y * 1.6 + 0.4, n.z * 1.6,
        S.dust[0], S.dust[1], S.dust[2], S.dustSize * 0.2, S.dustSize, 0.45, -0.3, 4, Math.random() * 6.283, 0);
    }
    if (S.decal > 0) this.holes.add(p, n, S.decal, S.tile);
  }

  /** Blood spray. `n` points back toward the shooter, `dir` is the bullet direction. */
  blood(p, n, dir) {
    const dx = dir ? dir.x : -n.x, dy = dir ? dir.y : -n.y, dz = dir ? dir.z : -n.z;
    for (let i = 0; i < 16; i++) {
      const s = 1.5 + Math.random() * 5.5;
      this.bloodF.emit(p.x, p.y, p.z,
        dx * s + (Math.random() - 0.5) * 3, dy * s + (Math.random() - 0.5) * 3 + 0.8, dz * s + (Math.random() - 0.5) * 3,
        0.34, 0.020, 0.014,
        0.012 + Math.random() * 0.02, 0.004, 0.35 + Math.random() * 0.4, 10, 1.2, 0, 0);
    }
    for (let i = 0; i < 5; i++) {
      this.smokeF.emit(p.x, p.y, p.z,
        dx * 1.2 + (Math.random() - 0.5) * 1.2, dy * 1.2 + (Math.random() - 0.5) * 1.2 + 0.4, dz * 1.2 + (Math.random() - 0.5) * 1.2,
        0.26, 0.018, 0.014, 0.05, 0.20, 0.28, -0.2, 5, Math.random() * 6.283, 0);
    }
  }

  /** Eject a spent case. dir is the ejection direction in world space. */
  shell(p, dir, scale = 1) {
    const c = this.cas[this.casCursor];
    this.casCursor = (this.casCursor + 1) % this.cas.length;
    c.p.copy(p);
    c.v.copy(dir).multiplyScalar(2.2 + Math.random() * 1.4);
    c.v.y += 1.3 + Math.random() * 0.7;
    // inherit the shooter's motion so cases don't hang in the air
    const pv = this.ctx.player && this.ctx.player.velocity;
    if (pv) c.v.addScaledVector(pv, 0.85);
    c.e.set(Math.random() * 6.283, Math.random() * 6.283, Math.random() * 6.283);
    c.w.set((Math.random() - 0.5) * 34, (Math.random() - 0.5) * 26, (Math.random() - 0.5) * 34);
    c.t = 0; c.life = 4.5; c.active = true; c.rest = false; c.scale = scale;
    // find the floor under the ejection point once
    const ph = this.ctx.physics;
    c.floor = p.y - 2.2;
    if (ph && ph.raycast) {
      const h = ph.raycast(_v.copy(p).setY(p.y + 0.2), _v2.set(0, -1, 0), 24);
      c.floor = h ? h.point.y : 0;
    }
  }

  /** Drifting smoke source (grenade smoke, burning wreck). */
  smoke(p, radius = 1, amount = 1) {
    for (let i = 0; i < Math.ceil(3 * amount); i++) {
      const a = Math.random() * 6.283, r = Math.random() * radius;
      this.smokeF.emit(p.x + Math.cos(a) * r, p.y + Math.random() * 0.4, p.z + Math.sin(a) * r,
        (Math.random() - 0.5) * 0.6, 0.7 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6,
        0.32, 0.32, 0.33, radius * 0.5, radius * 2.6, 2.6 + Math.random() * 2, -0.25, 0.7,
        Math.random() * 6.283, (Math.random() - 0.5) * 0.8);
    }
  }

  explosion(p, r = 5) {
    let b = null;
    for (const e of this.booms) if (!e.active) { b = e; break; }
    if (!b) b = this.booms[0];
    b.active = true; b.t = 0; b.life = 0.55; b.r = r;
    b.g.visible = true;
    b.g.position.copy(p);
    b.fb.scale.setScalar(r * 0.16);
    b.ring.scale.setScalar(r * 0.4);
    b.ring.material.opacity = 1;

    this._light(p.x, p.y, p.z, 0xffb060, 900 + r * 220, 0.42, r * 7);

    // fire + embers
    for (let i = 0; i < 42; i++) {
      const a = Math.random() * 6.283, e2 = Math.random() * 1.4 - 0.1;
      const s = (5 + Math.random() * 18) * (r / 5);
      const dx = Math.cos(a) * Math.cos(e2), dy = Math.sin(e2), dz = Math.sin(a) * Math.cos(e2);
      this.sparks.emit(p.x, p.y, p.z, dx * s, dy * s + 3, dz * s,
        8.0, 3.6, 1.2, 0.06 + Math.random() * 0.09, 0.01, 0.35 + Math.random() * 0.9, 8, 1.1, 0, 0);
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * 6.283;
      const s = (2 + Math.random() * 7) * (r / 5);
      this.fire.emit(p.x, p.y, p.z, Math.cos(a) * s, Math.random() * s * 0.8 + 1, Math.sin(a) * s,
        7.0, 2.6, 0.7, r * 0.12, r * 0.34, 0.22 + Math.random() * 0.2, 2, 3.5, 0, 0);
    }
    // debris chunks
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.283, e2 = Math.random() * 1.2;
      const s = (5 + Math.random() * 16) * (r / 5);
      this.debris.emit(p.x, p.y + 0.1, p.z,
        Math.cos(a) * Math.cos(e2) * s, Math.sin(e2) * s + 4, Math.sin(a) * Math.cos(e2) * s,
        0.20, 0.19, 0.18, 0.02 + Math.random() * 0.05, 0.01, 1.1 + Math.random() * 0.9, 12, 0.35,
        Math.random() * 6.283, (Math.random() - 0.5) * 24);
    }
    // smoke column
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.283, rr = Math.random() * r * 0.5;
      this.smokeF.emit(p.x + Math.cos(a) * rr, p.y + Math.random() * r * 0.4, p.z + Math.sin(a) * rr,
        Math.cos(a) * (1 + Math.random() * 4), 1.4 + Math.random() * 3.6, Math.sin(a) * (1 + Math.random() * 4),
        0.20, 0.19, 0.185, r * 0.16, r * (0.7 + Math.random() * 0.6), 1.6 + Math.random() * 2.4,
        -0.5, 1.5, Math.random() * 6.283, (Math.random() - 0.5) * 1.4);
    }
    // ground scorch
    const ph = this.ctx.physics;
    if (ph && ph.raycast) {
      const h = ph.raycast(_v.copy(p).setY(p.y + 0.3), _v2.set(0, -1, 0), r * 1.2);
      if (h) this.scorch.add(h.point, h.normal, r * 0.55, 0);
    }
    // camera shake, distance-weighted
    const cam = this.ctx.camera;
    const d = cam ? cam.position.distanceTo(p) : 20;
    this.shake(THREE.MathUtils.clamp((r * 2.2) / (d + 2), 0, 1.6), 1);
    this.ctx.bus.emit('boom', { pos: p, radius: r });
  }

  /** Throw a frag. Integrated here (no physics bodies) so it stays deterministic. */
  grenade(pos, vel, fuse = 2.4) {
    let n = null;
    for (const e of this.nades) if (!e.active) { n = e; break; }
    if (!n) return null;
    n.active = true;
    n.p.copy(pos); n.v.copy(vel);
    n.fuse = fuse; n.spin = 0;
    n.m.visible = true;
    n.m.position.copy(pos);
    return n;
  }

  shake(amp, freq = 1) {
    this.shakeAmp = Math.min(2.5, this.shakeAmp + amp);
    this.shakeFreq = freq;
  }

  /* ------------------------------------------------------------- frame */

  update(dt) {
    this.time += dt;
    for (const f of this.fields) f.update(dt);
    this.tracers.update(dt);
    this.holes.update(dt);
    this.scorch.update(dt);
    this._updFlashes(dt);
    this._updLights(dt);
    this._updCasings(dt);
    this._updBooms(dt);
    this._updNades(dt);
    this._updShake(dt);
  }

  _updFlashes(dt) {
    for (const f of this.flashes) {
      if (!f.active) continue;
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) {
        f.active = false; f.g.visible = false;
        if (f.g.parent) f.g.parent.remove(f.g);
        continue;
      }
      // fast pop then collapse
      const pop = Math.sin(Math.min(1, k * 1.35) * Math.PI * 0.85);
      const a = (1 - k) * (1 - k);
      const s = f.scale;
      f.core.scale.setScalar(s * (0.10 + pop * 0.16));
      f.core.rotation.z = f.seed * 2 + k * 1.2;
      f.glow.scale.setScalar(s * (0.16 + pop * 0.42));
      for (let i = 0; i < f.petals.length; i++) {
        const h = f.petals[i];
        const g = h.children[0];
        const w = s * (0.055 + pop * 0.05) * (i === 0 ? 1.15 : 0.85);
        g.scale.set(w, s * (0.10 + pop * 0.22) * (i === 1 ? 1.25 : 0.9), 1);
        h.rotation.z = f.seed + (i / f.petals.length) * 6.283;
        h.rotation.x = Math.sin(f.seed + i) * 0.12;
      }
      for (const m of f.mats) m.opacity = a;
    }
  }

  _updLights(dt) {
    for (const e of this.lights) {
      if (e.life <= 0) continue;
      e.t += dt;
      const k = e.t / e.life;
      if (k >= 1) { e.life = 0; e.l.intensity = 0; e.l.visible = false; continue; }
      if (e.anchor) {
        e.anchor.updateWorldMatrix(true, false);
        e.l.position.setFromMatrixPosition(e.anchor.matrixWorld);
      }
      e.l.intensity = e.peak * (1 - k) * (1 - k);
    }
  }

  _updCasings(dt) {
    let any = false;
    for (let i = 0; i < this.cas.length; i++) {
      const c = this.cas[i];
      if (!c.active) continue;
      any = true;
      c.t += dt;
      if (c.t > c.life) {
        c.active = false;
        _m.makeScale(0, 0, 0);
        this.casings.setMatrixAt(i, _m);
        continue;
      }
      if (!c.rest) {
        c.v.y -= 9.81 * dt;
        c.p.addScaledVector(c.v, dt);
        c.e.x += c.w.x * dt; c.e.y += c.w.y * dt; c.e.z += c.w.z * dt;
        if (c.p.y <= c.floor + 0.006) {
          c.p.y = c.floor + 0.006;
          if (Math.abs(c.v.y) < 0.55) {
            c.rest = true;
            c.v.set(0, 0, 0); c.w.set(0, 0, 0);
            c.e.set(Math.PI / 2, c.e.y, 0);
          } else {
            c.v.y = -c.v.y * 0.32;
            c.v.x *= 0.62; c.v.z *= 0.62;
            c.w.multiplyScalar(0.55);
          }
        }
      }
      const fade = c.t > c.life - 0.6 ? (c.life - c.t) / 0.6 : 1;
      _e.copy(c.e);
      _q.setFromEuler(_e);
      _v.set(1, 1, 1).multiplyScalar((c.scale || 1) * fade);
      _m.compose(c.p, _q, _v);
      this.casings.setMatrixAt(i, _m);
    }
    if (any) this.casings.instanceMatrix.needsUpdate = true;
  }

  _updBooms(dt) {
    for (const b of this.booms) {
      if (!b.active) continue;
      b.t += dt;
      const k = b.t / b.life;
      if (k >= 1) { b.active = false; b.g.visible = false; continue; }
      const grow = 1 - Math.pow(1 - k, 2.6);
      b.fb.scale.setScalar(b.r * (0.16 + grow * 0.62));
      b.fb.material.uniforms.uT.value = k;
      b.fb.material.uniforms.uFade.value = Math.max(0, 1 - k * 1.5);
      b.fb.rotation.y += dt * 1.2;
      const rk = Math.min(1, k * 2.2);
      b.ring.scale.setScalar(b.r * (0.4 + rk * 2.4));
      b.ring.material.opacity = Math.max(0, 1 - rk) * 0.9;
    }
  }

  _updNades(dt) {
    const ph = this.ctx.physics;
    for (const n of this.nades) {
      if (!n.active) continue;
      n.fuse -= dt;
      n.v.y -= 12 * dt;
      _v.copy(n.v).multiplyScalar(dt);
      const step = _v.length();
      if (step > 1e-4 && ph && ph.raycast) {
        const h = ph.raycast(n.p, _v2.copy(_v).normalize(), step + 0.05);
        if (h) {
          n.p.copy(h.point).addScaledVector(h.normal, 0.04);
          const dn = n.v.dot(h.normal);
          n.v.addScaledVector(h.normal, -2 * dn).multiplyScalar(0.42);
        } else n.p.add(_v);
      } else n.p.add(_v);
      n.spin += dt * 9;
      n.m.position.copy(n.p);
      n.m.rotation.set(n.spin, n.spin * 0.7, n.spin * 0.4);
      if (n.fuse <= 0) {
        n.active = false;
        n.m.visible = false;
        // the bus listener draws it, so damage systems and the visual stay in sync
        this.ctx.bus.emit('explosion', { pos: n.p.clone(), radius: 5.5 });
      }
    }
  }

  _updShake(dt) {
    if (this.shakeAmp <= 0.0004) { this.shakeAmp = 0; return; }
    this.shakeAmp *= Math.exp(-dt * 5.5);
    const cam = this.ctx.camera;
    if (!cam) return;
    const t = this.time, a = this.shakeAmp;
    cam.rotation.x += (Math.sin(t * 47.3) * 0.6 + Math.sin(t * 23.1 + 1.7) * 0.4) * a * 0.030;
    cam.rotation.y += (Math.sin(t * 31.7 + 1.3) * 0.6 + Math.sin(t * 17.9) * 0.4) * a * 0.032;
    cam.rotation.z += Math.sin(t * 19.1 + 2.1) * a * 0.042;
    cam.position.y += Math.sin(t * 41.0) * a * 0.014;
  }
}

const EMPTY = {};
const TRACER_COL = [7.0, 4.0, 1.4];
