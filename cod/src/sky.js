// Atmosphere: analytic sky, sun rig + fitted shadow cascades, image-based
// lighting, height fog / aerial perspective, volumetric dust, time-of-day.
// Owner: atmosphere agent. Public API: update(dt), setTimeOfDay(t01),
// setPreset(name), sunDir, post (grade parameters read by render.js).
import * as THREE from 'three';
import { SkyMaterial } from './sky-material.js';
import { installAtmosphericFog } from './sky-fog.js';
import { DustMotes } from './sky-dust.js';

// ---------------------------------------------------------------------------
// Look presets, anchored on sun elevation.  setTimeOfDay() drives elevation and
// blends between the anchors, so every intermediate time is also tuned.
// ---------------------------------------------------------------------------
const PRESETS = {
  // heavy, low, orange-blue overcast dusk
  dusk: {
    elev: 1.5, azim: -108,
    sunColor: [1.0, 0.46, 0.20], sunIntensity: 2.6,
    skyLum: 3.4, turbidity: 6.5, rayleigh: 3.4, mie: 0.011, mieG: 0.88, skyGamma: 1.45, sunDisc: 26,
    ground: [0.030, 0.028, 0.030],
    cloudCover: 0.44, cloudSharp: 0.30, cloudScale: 1.0,
    cloudLit: [1.00, 0.58, 0.34], cloudDark: [0.10, 0.10, 0.14], cloudAmb: 0.55,
    hemiSky: [0.28, 0.34, 0.48], hemiGround: [0.10, 0.08, 0.07], hemiInt: 0.30, envInt: 1.15,
    fog: { density: 0.017, falloff: 30, base: -2, color: [0.045, 0.055, 0.078], sunColor: [0.42, 0.20, 0.10], minT: 0.05, aniso: 0.76 },
    post: {
      exposure: 1.30, contrast: 1.04, saturation: 1.00, toe: 0.020, split: 0.60,
      lift: [-0.004, 0.002, 0.014], gamma: [1.0, 1.0, 1.02], gain: [1.02, 0.995, 0.985],
      shadowTint: [0.80, 0.94, 1.16], highTint: [1.10, 0.99, 0.86],
      vignette: 0.52, ca: 1.3, grain: 0.040, sharpen: 0.32,
      bloom: 0.42, bloomThreshold: 0.85, bloomRadius: 0.70,
      godrays: 1.10, godrayDensity: 0.85, godrayThreshold: 0.75, godrayTint: [1.0, 0.66, 0.40],
    },
  },
  // the default: low warm sun, long shadows, deep contrast
  golden: {
    elev: 11, azim: -132,
    sunColor: [1.0, 0.72, 0.44], sunIntensity: 5.2,
    skyLum: 5.2, turbidity: 4.4, rayleigh: 2.7, mie: 0.0075, mieG: 0.86, skyGamma: 1.32, sunDisc: 40,
    ground: [0.040, 0.038, 0.036],
    cloudCover: 0.30, cloudSharp: 0.34, cloudScale: 1.0,
    cloudLit: [1.00, 0.86, 0.70], cloudDark: [0.13, 0.14, 0.18], cloudAmb: 0.60,
    hemiSky: [0.34, 0.44, 0.62], hemiGround: [0.13, 0.10, 0.08], hemiInt: 0.26, envInt: 1.05,
    fog: { density: 0.0105, falloff: 26, base: -2, color: [0.052, 0.064, 0.086], sunColor: [0.50, 0.30, 0.16], minT: 0.055, aniso: 0.74 },
    post: {
      exposure: 1.05, contrast: 1.10, saturation: 1.06, toe: 0.024, split: 0.55,
      lift: [-0.006, 0.001, 0.012], gamma: [1.0, 1.0, 1.015], gain: [1.03, 1.0, 0.975],
      shadowTint: [0.82, 0.95, 1.14], highTint: [1.09, 1.00, 0.87],
      vignette: 0.46, ca: 1.1, grain: 0.032, sharpen: 0.38,
      bloom: 0.34, bloomThreshold: 1.00, bloomRadius: 0.62,
      godrays: 0.95, godrayDensity: 0.80, godrayThreshold: 0.95, godrayTint: [1.0, 0.80, 0.55],
    },
  },
  // harsh, high, near-white midday
  midday: {
    elev: 64, azim: -40,
    sunColor: [1.0, 0.96, 0.90], sunIntensity: 8.5,
    skyLum: 7.0, turbidity: 3.0, rayleigh: 2.0, mie: 0.005, mieG: 0.80, skyGamma: 1.22, sunDisc: 55,
    ground: [0.060, 0.058, 0.055],
    cloudCover: 0.20, cloudSharp: 0.38, cloudScale: 1.15,
    cloudLit: [1.00, 0.99, 0.97], cloudDark: [0.20, 0.22, 0.28], cloudAmb: 0.70,
    hemiSky: [0.42, 0.54, 0.76], hemiGround: [0.18, 0.16, 0.13], hemiInt: 0.22, envInt: 1.0,
    fog: { density: 0.0048, falloff: 42, base: -2, color: [0.072, 0.090, 0.120], sunColor: [0.40, 0.40, 0.42], minT: 0.10, aniso: 0.62 },
    post: {
      exposure: 0.80, contrast: 1.13, saturation: 1.02, toe: 0.026, split: 0.42,
      lift: [-0.008, 0.000, 0.010], gamma: [1.0, 1.0, 1.0], gain: [1.01, 1.0, 0.99],
      shadowTint: [0.84, 0.95, 1.12], highTint: [1.05, 1.00, 0.93],
      vignette: 0.38, ca: 0.9, grain: 0.026, sharpen: 0.40,
      bloom: 0.26, bloomThreshold: 1.25, bloomRadius: 0.55,
      godrays: 0.45, godrayDensity: 0.72, godrayThreshold: 1.40, godrayTint: [1.0, 0.94, 0.82],
    },
  },
};
const ORDER = ['dusk', 'golden', 'midday'];

// generic deep numeric interpolation over the preset structure
function lerpDeep(a, b, t) {
  if (typeof a === 'number') return a + (b - a) * t;
  if (Array.isArray(a)) return a.map((v, i) => lerpDeep(v, b[i], t));
  const o = {};
  for (const k in a) o[k] = lerpDeep(a[k], b[k], t);
  return o;
}
function blendByElevation(elev) {
  const e = ORDER.map(k => PRESETS[k].elev);
  if (elev <= e[0]) return structuredClone(PRESETS[ORDER[0]]);
  if (elev >= e[e.length - 1]) return structuredClone(PRESETS[ORDER[ORDER.length - 1]]);
  for (let i = 0; i < ORDER.length - 1; i++) {
    if (elev <= e[i + 1]) {
      const t = (elev - e[i]) / (e[i + 1] - e[i]);
      // ease so we linger in the tuned looks rather than the midpoints
      const s = t * t * (3 - 2 * t);
      return lerpDeep(PRESETS[ORDER[i]], PRESETS[ORDER[i + 1]], s);
    }
  }
  return structuredClone(PRESETS.golden);
}

const V3 = a => new THREE.Vector3(a[0], a[1], a[2]);

export class Sky {
  constructor(ctx) {
    this.ctx = ctx;
    const { scene } = ctx;
    const tier = { low: 0, medium: 1, high: 2, ultra: 3 }[ctx.config.quality] ?? 3;
    this.tier = tier;

    // --- sky dome (one material, two meshes: one for the scene, one for IBL) ---
    this.skyMat = SkyMaterial();
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.dome = new THREE.Mesh(box, this.skyMat);
    this.dome.scale.setScalar(6000);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(box, this.skyMat);
    this.envDome.scale.setScalar(8);
    this.envDome.frustumCulled = false;
    this.envScene.add(this.envDome);

    // --- sun rig: a tight near cascade plus a cheap wide one --------------
    const mapSize = ctx.config.shadowMapSize;
    this.sunNear = new THREE.DirectionalLight(0xffffff, 1);
    this.sunNear.castShadow = true;
    this._setupShadow(this.sunNear, mapSize, 26, -0.0006, 0.018);
    scene.add(this.sunNear, this.sunNear.target);

    this.sunFar = null;
    if (tier >= 2) {
      this.sunFar = new THREE.DirectionalLight(0xffffff, 1);
      this.sunFar.castShadow = true;
      this._setupShadow(this.sunFar, Math.min(mapSize, 1024), 120, -0.0022, 0.09);
      scene.add(this.sunFar, this.sunFar.target);
    } else {
      this._setupShadow(this.sunNear, mapSize, 70, -0.0012, 0.045);
    }

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.25);
    scene.add(this.hemi);

    // fog is a custom shader-chunk override (height fog + aerial perspective)
    scene.fog = new THREE.FogExp2(0x808080, 0.0001);

    // exported grade parameters, mutated in place (render.js reads these)
    this.post = {
      exposure: 1, contrast: 1, saturation: 1, toe: 0, split: 0.5,
      lift: new THREE.Vector3(), gamma: new THREE.Vector3(1, 1, 1), gain: new THREE.Vector3(1, 1, 1),
      shadowTint: new THREE.Vector3(1, 1, 1), highTint: new THREE.Vector3(1, 1, 1),
      vignette: 0.4, ca: 1, grain: 0.03, sharpen: 0.35,
      bloom: 0.3, bloomThreshold: 1, bloomRadius: 0.6,
      godrays: 0.9, godrayDensity: 0.8, godrayThreshold: 1.0, godrayTint: new THREE.Color(1, 1, 1),
    };

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this._pmrem = null;
    this._t = 0;
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this._center = new THREE.Vector3();

    this.dust = tier >= 2 ? new DustMotes(ctx, 900) : null;

    this.setTimeOfDay(0.075);   // cinematic golden hour by default
  }

  _setupShadow(light, size, radius, bias, normalBias) {
    const s = light.shadow;
    s.mapSize.set(size, size);
    s.camera.near = 0.5;
    s.camera.far = radius * 4 + 60;
    s.camera.left = -radius; s.camera.right = radius;
    s.camera.top = radius; s.camera.bottom = -radius;
    s.bias = bias;
    s.normalBias = normalBias;
    s.radius = 2.2;              // PCF kernel widening (soft contact-ish falloff)
    s.blurSamples = 12;
    s.camera.updateProjectionMatrix();
    light.userData.fitRadius = radius;
    light.userData.texel = (radius * 2) / size;
  }

  // t01: 0 = sun on the horizon at dawn, 0.5 = zenith, 1 = horizon at dusk
  setTimeOfDay(t01) {
    this.tod = THREE.MathUtils.clamp(t01, 0, 1);
    const s = Math.sin(Math.PI * this.tod);
    const elev = 1.5 + 63 * Math.pow(s, 0.85);
    const p = blendByElevation(elev);
    this._apply(p, elev, THREE.MathUtils.lerp(p.azim - 30, p.azim + 30, this.tod));
  }

  setPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    this._apply(structuredClone(p), p.elev, p.azim);
  }

  _apply(p, elevDeg, azimDeg) {
    this.params = p;
    const el = THREE.MathUtils.degToRad(elevDeg);
    const az = THREE.MathUtils.degToRad(azimDeg);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();

    // sky material
    const u = this.skyMat.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uTurbidity.value = p.turbidity;
    u.uRayleigh.value = p.rayleigh;
    u.uMieCoef.value = p.mie;
    u.uMieG.value = p.mieG;
    u.uSkyLum.value = p.skyLum;
    u.uSkyGamma.value = p.skyGamma;
    u.uSunDisc.value = p.sunDisc;
    u.uSunColor.value.set(p.sunColor[0], p.sunColor[1], p.sunColor[2]);
    u.uGround.value.set(p.ground[0], p.ground[1], p.ground[2]);
    u.uCloudCover.value = p.cloudCover;
    u.uCloudSharp.value = p.cloudSharp;
    u.uCloudScale.value = p.cloudScale;
    u.uCloudLit.value.set(p.cloudLit[0], p.cloudLit[1], p.cloudLit[2]);
    u.uCloudDark.value.set(p.cloudDark[0], p.cloudDark[1], p.cloudDark[2]);
    u.uCloudAmb.value = p.cloudAmb;

    // sun lights — intensity is split across the cascades so the total energy
    // hitting a surface is unchanged
    const n = this.sunFar ? 0.5 : 1.0;
    const col = new THREE.Color(p.sunColor[0], p.sunColor[1], p.sunColor[2]);
    this.sunNear.color.copy(col); this.sunNear.intensity = p.sunIntensity * n;
    if (this.sunFar) { this.sunFar.color.copy(col); this.sunFar.intensity = p.sunIntensity * n; }
    this.hemi.color.setRGB(p.hemiSky[0], p.hemiSky[1], p.hemiSky[2]);
    this.hemi.groundColor.setRGB(p.hemiGround[0], p.hemiGround[1], p.hemiGround[2]);
    this.hemi.intensity = p.hemiInt;
    this.ctx.scene.environmentIntensity = p.envInt;

    // grade
    const q = this.post, s = p.post;
    q.exposure = s.exposure; q.contrast = s.contrast; q.saturation = s.saturation;
    q.toe = s.toe; q.split = s.split;
    q.lift.set(...s.lift); q.gamma.set(...s.gamma); q.gain.set(...s.gain);
    q.shadowTint.set(...s.shadowTint); q.highTint.set(...s.highTint);
    q.vignette = s.vignette; q.ca = s.ca; q.grain = s.grain; q.sharpen = s.sharpen;
    q.bloom = s.bloom; q.bloomThreshold = s.bloomThreshold; q.bloomRadius = s.bloomRadius;
    q.godrays = s.godrays; q.godrayDensity = s.godrayDensity; q.godrayThreshold = s.godrayThreshold;
    q.godrayTint.setRGB(...s.godrayTint);

    if (this.dust) this.dust.setSun(this.sunDir, col, p.post.exposure);

    installAtmosphericFog(this.ctx, p.fog, this.sunDir, p.sunColor);
    this._buildEnv();
  }

  _buildEnv() {
    if (!this.ctx.renderer) return;
    if (!this._pmrem) this._pmrem = new THREE.PMREMGenerator(this.ctx.renderer);
    this.skyMat.uniforms.uTime.value = this._t;
    const rt = this._pmrem.fromScene(this.envScene, 0.0, 0.1, 200);
    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
    this.ctx.scene.environment = rt.texture;
  }

  // Fit an orthographic shadow frustum around the player, biased forward along
  // the view, and snap it to whole texels so the shadow edge doesn't crawl.
  _fitCascade(light, center) {
    const r = light.userData.fitRadius;
    const dir = this.sunDir;
    const right = this._tmp.set(0, 0, 0).crossVectors(dir, this._up);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const texel = light.userData.texel;
    let x = center.dot(right), y = center.dot(up);
    const z = center.dot(dir);
    x = Math.round(x / texel) * texel;
    y = Math.round(y / texel) * texel;
    const snapped = right.clone().multiplyScalar(x).add(up.clone().multiplyScalar(y)).add(dir.clone().multiplyScalar(z));
    const dist = r * 2 + 40;
    light.position.copy(dir).multiplyScalar(dist).add(snapped);
    light.target.position.copy(snapped);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
  }

  update(dt) {
    this._t += dt;
    this.skyMat.uniforms.uTime.value = this._t;

    const cam = this.ctx.camera;
    const p = this.ctx.player?.position;
    const c = this._center;
    if (p) c.copy(p); else c.copy(cam.position);
    c.y = Math.max(c.y, 0) + 1.0;

    // push the near cascade forward so the budget is spent on what's on screen
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const nearCenter = c.clone().addScaledVector(fwd, this.sunFar ? 14 : 24);
    this._fitCascade(this.sunNear, nearCenter);
    if (this.sunFar) this._fitCascade(this.sunFar, c.clone().addScaledVector(fwd, 55));

    // the sky dome rides with the camera so it never clips
    this.dome.position.copy(cam.position);

    if (this.dust) this.dust.update(dt, cam);
  }
}
