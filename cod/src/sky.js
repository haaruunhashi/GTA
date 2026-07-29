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
    cloudLit: [1.00, 0.58, 0.34], cloudDark: [0.11, 0.13, 0.21], cloudAmb: 0.52,
    zenith: [0.085, 0.140, 0.310], skyBlue: 0.60,
    hemiSky: [0.30, 0.38, 0.56], hemiGround: [0.14, 0.11, 0.09], hemiInt: 1.25, envInt: 2.45,
    bounce: [0.55, 0.34, 0.22], bounceInt: 1.05,
    fog: { density: 0.0090, falloff: 13, base: -1, start: 14,
           color: [0.060, 0.072, 0.100], lowColor: [0.165, 0.120, 0.090],
           sunColor: [0.46, 0.23, 0.11], minT: 0.10, aniso: 0.74 },
    post: {
      exposure: 2.05, contrast: 1.10, saturation: 1.02, toe: 0.022, split: 0.50, white: 0.950,
      lift: [-0.006, 0.000, 0.010], gamma: [1.0, 1.0, 1.02], gain: [1.02, 0.995, 0.985],
      shadowTint: [0.80, 0.94, 1.16], highTint: [1.10, 0.99, 0.86],
      vignette: 0.46, ca: 1.5, grain: 0.038, sharpen: 0.52,
      bloom: 0.30, bloomThreshold: 1.35, bloomRadius: 0.48,
      godrays: 0.42, godrayDensity: 0.55, godrayThreshold: 2.0, godrayTint: [1.0, 0.66, 0.40],
      streak: 0.55,
    },
  },
  // the default: low warm sun, long shadows, deep contrast
  golden: {
    elev: 11, azim: -124,
    sunColor: [1.0, 0.74, 0.47], sunIntensity: 11.0,
    skyLum: 5.2, turbidity: 3.4, rayleigh: 3.6, mie: 0.0055, mieG: 0.86, skyGamma: 1.20, sunDisc: 46,
    ground: [0.040, 0.038, 0.036],
    cloudCover: 0.30, cloudSharp: 0.34, cloudScale: 1.0,
    cloudLit: [1.00, 0.86, 0.70], cloudDark: [0.16, 0.20, 0.30], cloudAmb: 0.56,
    zenith: [0.130, 0.240, 0.520], skyBlue: 0.58,
    hemiSky: [0.30, 0.46, 0.92], hemiGround: [0.16, 0.14, 0.12], hemiInt: 0.80, envInt: 1.35,
    bounce: [0.46, 0.40, 0.40], bounceInt: 0.45,
    fog: { density: 0.0046, falloff: 15, base: -1, start: 18,
           color: [0.072, 0.098, 0.150], lowColor: [0.118, 0.122, 0.148],
           sunColor: [0.34, 0.20, 0.10], minT: 0.12, aniso: 0.72 },
    post: {
      exposure: 1.20, contrast: 1.16, saturation: 1.10, toe: 0.026, split: 0.62, white: 0.910,
      lift: [-0.010, 0.000, 0.012], gamma: [1.0, 1.0, 1.02], gain: [1.03, 1.0, 0.975],
      shadowTint: [0.72, 0.90, 1.28], highTint: [1.12, 1.00, 0.84],
      vignette: 0.42, ca: 1.4, grain: 0.030, sharpen: 0.55,
      bloom: 0.28, bloomThreshold: 1.55, bloomRadius: 0.45,
      godrays: 0.30, godrayDensity: 0.52, godrayThreshold: 2.6, godrayTint: [1.0, 0.80, 0.55],
      streak: 0.50,
    },
  },
  // harsh, high, near-white midday
  midday: {
    elev: 64, azim: -40,
    sunColor: [1.0, 0.96, 0.90], sunIntensity: 8.5,
    skyLum: 7.0, turbidity: 3.0, rayleigh: 2.0, mie: 0.005, mieG: 0.80, skyGamma: 1.22, sunDisc: 55,
    ground: [0.060, 0.058, 0.055],
    cloudCover: 0.20, cloudSharp: 0.38, cloudScale: 1.15,
    cloudLit: [1.00, 0.99, 0.97], cloudDark: [0.22, 0.26, 0.36], cloudAmb: 0.70,
    zenith: [0.22, 0.40, 0.82], skyBlue: 0.72,
    hemiSky: [0.46, 0.60, 0.86], hemiGround: [0.21, 0.19, 0.16], hemiInt: 0.90, envInt: 1.95,
    bounce: [0.62, 0.58, 0.50], bounceInt: 0.70,
    fog: { density: 0.0026, falloff: 30, base: -1, start: 26,
           color: [0.085, 0.105, 0.145], lowColor: [0.130, 0.140, 0.165],
           sunColor: [0.34, 0.34, 0.36], minT: 0.18, aniso: 0.60 },
    post: {
      exposure: 1.20, contrast: 1.14, saturation: 1.02, toe: 0.026, split: 0.38, white: 0.940,
      lift: [-0.010, 0.000, 0.006], gamma: [1.0, 1.0, 1.0], gain: [1.01, 1.0, 0.99],
      shadowTint: [0.84, 0.95, 1.12], highTint: [1.05, 1.00, 0.93],
      vignette: 0.36, ca: 1.2, grain: 0.024, sharpen: 0.55,
      bloom: 0.22, bloomThreshold: 1.90, bloomRadius: 0.40,
      godrays: 0.18, godrayDensity: 0.45, godrayThreshold: 3.2, godrayTint: [1.0, 0.94, 0.82],
      streak: 0.35,
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
      this._setupShadow(this.sunFar, Math.min(mapSize, 1536), 95, -0.0014, 0.055);
      scene.add(this.sunFar, this.sunFar.target);
    } else {
      this._setupShadow(this.sunNear, mapSize, 70, -0.0012, 0.045);
    }

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.25);
    scene.add(this.hemi);

    // Cheap single-bounce fill: an unshadowed directional from the anti-sun
    // side, slightly above the horizon. Sun-facing surfaces barely notice it;
    // shadow-side walls get their albedo and normal detail back.
    this.bounce = new THREE.DirectionalLight(0xffffff, 0);
    this.bounce.castShadow = false;
    scene.add(this.bounce, this.bounce.target);

    // fog is a custom shader-chunk override (height fog + aerial perspective)
    scene.fog = new THREE.FogExp2(0x808080, 0.0001);

    // exported grade parameters, mutated in place (render.js reads these)
    this.post = {
      exposure: 1, contrast: 1, saturation: 1, toe: 0, split: 0.5,
      lift: new THREE.Vector3(), gamma: new THREE.Vector3(1, 1, 1), gain: new THREE.Vector3(1, 1, 1),
      shadowTint: new THREE.Vector3(1, 1, 1), highTint: new THREE.Vector3(1, 1, 1),
      vignette: 0.4, ca: 1, grain: 0.03, sharpen: 0.35, white: 0.95,
      bloom: 0.3, bloomThreshold: 1, bloomRadius: 0.6,
      godrays: 0.9, godrayDensity: 0.8, godrayThreshold: 1.0, godrayTint: new THREE.Color(1, 1, 1),
      streak: 0.5,
    };

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this._pmrem = null;
    this._t = 0;
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();
    this._center = new THREE.Vector3();

    this.dust = tier >= 2 ? new DustMotes(ctx, 420) : null;

    // Golden hour proper: ~13 deg elevation gives shadows ~4.2x object height,
    // and the azimuth lands ~40 deg off the street axis so building shadows rake
    // across the road instead of running away down it.
    this.setTimeOfDay(0.059);
  }

  _setupShadow(light, size, radius, bias, normalBias, pcf) {
    const s = light.shadow;
    s.mapSize.set(size, size);
    s.camera.near = 0.5;
    s.camera.far = radius * 4 + 60;
    s.camera.left = -radius; s.camera.right = radius;
    s.camera.top = radius; s.camera.bottom = -radius;
    s.bias = bias;
    s.normalBias = normalBias;
    // Penumbra width, in shadow texels, for the rotated-disk PCF installed by
    // render-shadows.js. The near cascade has ~2.5 cm texels, so 2.5 texels is a
    // ~6 cm penumbra — crisp contact. The far cascade has ~12 cm texels, so 4
    // texels there is a ~50 cm penumbra: distance softens, as it should.
    s.radius = pcf === undefined ? 2.5 : pcf;
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
    u.uZenith.value.setRGB(p.zenith[0], p.zenith[1], p.zenith[2]);
    u.uSkyBlue.value = p.skyBlue;

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

    // bounce fill: mirror of the sun across the vertical axis, lifted a little
    // so it rakes the shadow face instead of only the undersides
    const bd = new THREE.Vector3(-this.sunDir.x, 0.30, -this.sunDir.z).normalize();
    this.bounce.position.copy(bd).multiplyScalar(180);
    this.bounce.target.position.set(0, 0, 0);
    this.bounce.target.updateMatrixWorld();
    this.bounce.color.setRGB(p.bounce[0], p.bounce[1], p.bounce[2]);
    this.bounce.intensity = p.bounceInt * p.sunIntensity * 0.16;

    // grade
    const q = this.post, s = p.post;
    q.exposure = s.exposure; q.contrast = s.contrast; q.saturation = s.saturation;
    q.toe = s.toe; q.split = s.split;
    q.lift.set(...s.lift); q.gamma.set(...s.gamma); q.gain.set(...s.gain);
    q.shadowTint.set(...s.shadowTint); q.highTint.set(...s.highTint);
    q.vignette = s.vignette; q.ca = s.ca; q.grain = s.grain; q.sharpen = s.sharpen;
    q.white = s.white; q.streak = s.streak;
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
