// Atmosphere: analytic sky, sun rig + fitted shadow cascades, image-based
// lighting, height fog / aerial perspective, volumetric dust, time-of-day.
// Owner: atmosphere agent. Public API: update(dt), setTimeOfDay(t01),
// setPreset(name), sunDir, post (grade parameters read by render.js).
import * as THREE from 'three';
import { SkyMaterial } from './sky-material.js';
import { installAtmosphericFog } from './sky-fog.js';
import { DustMotes } from './sky-dust.js';
import { installSoftShadows } from './render-shadows.js';

// ---------------------------------------------------------------------------
// Look presets, anchored on sun elevation.  setTimeOfDay() drives elevation and
// blends between the anchors, so every intermediate time is also tuned.
// ---------------------------------------------------------------------------
const PRESETS = {
  // heavy, low, orange-blue overcast dusk
  dusk: {
    elev: 1.5, azim: -108,
    sunColor: [1.0, 0.46, 0.20], sunIntensity: 2.6,
    skyLum: 2.60, turbidity: 6.5, rayleigh: 3.4, mie: 0.011, mieG: 0.88, skyGamma: 1.45, sunDisc: 44,
    ground: [0.030, 0.028, 0.030],
    cloudCover: 0.46, cloudSharp: 0.12, cloudScale: 1.35,
    cloudLit: [1.00, 0.58, 0.34], cloudDark: [0.10, 0.12, 0.20], cloudAmb: 0.56,
    zenith: [0.085, 0.150, 0.340], skyBlue: 0.74,
    hemiSky: [0.34, 0.42, 0.60], hemiGround: [0.15, 0.12, 0.10], hemiInt: 1.55, envInt: 2.90,
    bounce: [0.55, 0.34, 0.22], bounceInt: 1.25,
    fog: { density: 0.0090, falloff: 13, base: -1, start: 14,
           color: [0.060, 0.072, 0.100], lowColor: [0.165, 0.120, 0.090],
           sunColor: [0.46, 0.23, 0.11], minT: 0.10, aniso: 0.74 },
    post: {
      exposure: 2.05, contrast: 1.08, saturation: 1.03, toe: 0.016, split: 0.44, white: 0.950,
      lift: [-0.004, 0.000, 0.008], gamma: [1.0, 1.0, 1.02], gain: [1.02, 0.995, 0.985],
      shadowTint: [0.86, 0.96, 1.12], highTint: [1.10, 0.99, 0.86],
      vignette: 0.46, ca: 1.5, grain: 0.038, sharpen: 0.52,
      bloom: 0.30, bloomThreshold: 1.35, bloomRadius: 0.48,
      godrays: 0.42, godrayDensity: 0.55, godrayThreshold: 2.0, godrayTint: [1.0, 0.66, 0.40],
      streak: 0.55,
    },
  },
  // the default: low warm sun, long shadows, deep contrast
  golden: {
    elev: 11, azim: -124,
    // ROUND 5, MEASURED. tools/_cmp.mjs classifies every road pixel as lit or
    // shaded using the ?view=sun,white mask and then reports the beauty frame in
    // each class. On shots/lightdbg7 that came back at **1.95:1**. That single
    // number is the whole of defects 11 and 12 and it explains why four rounds of
    // shape/penumbra/hue tuning did nothing: at a two-stop-total key:fill ratio a
    // shadow *cannot* read as a shadow, only as a tint, no matter how well its
    // edge is filtered. A golden-hour street is 4-6:1 on the display and more in
    // linear. The lit road was also simply dark (luma 90 where COD sits 110-150)
    // and the shade bright (luma 46 where it should be high 20s).
    //
    // The second half of the measurement: shaded road came back R53 G45 B39 —
    // *warm*, red above blue. Round 4 was told the shadows were too blue and the
    // fix over-shot into the opposite failure, which is the monochrome-amber
    // frame of defect 12. The warm term doing it is `bounce`: unshadowed, and at
    // bounceInt 1.70 x sunIntensity it was putting more energy into shaded tarmac
    // than the sky was. So: sun up 1.75x, the two warm fill terms down hard, the
    // cool sky term back up in chroma, and the sun leak through the shadow cut
    // from 8 % to 3.5 %.
    // ROUND 7, MEASURED on shots/lightao1 (tools/_cmp.mjs): sunlit road came
    // back at **luma 200, sd 21** and shaded road at 56 with B/R 0.77. Both
    // halves of that are defects. 200 is deep into the ACES shoulder plus the
    // 0.925 white-point stretch, so the asphalt albedo and normal map are being
    // compressed out of existence — that is the "flat pale wash" on the lit road
    // and the reason the shadow boundary reads as a painted edge rather than a
    // tonal step on one continuous material. And B/R 0.77 means the *shade* is
    // warmer than the key, i.e. defect 12 had come back: a one-hue image.
    // Round 5 cut the warm fills but left envInt high, and the PMREM of a
    // golden-hour sky is dominated by the amber horizon, not the blue zenith —
    // so "sky ambient" was the warm term all along. The fix is to take the key
    // down out of the shoulder and the fill down further still (fill -45 %, key
    // -30 %), and to move what is left of the fill from the amber IBL into the
    // hemisphere, which is the only cool term in the rig.
    sunColor: [1.0, 0.74, 0.47], sunIntensity: 16.5,
    // skyLum was 5.2, which drove the whole sky dome past the ACES shoulder:
    // every azimuth of the horizon saturated to uSunColor and the upper frame
    // clipped to a flat 225-luma amber wash. Lower luminance is what lets the
    // Rayleigh blue and the cloud form survive the tonemapper.
    skyLum: 3.10, turbidity: 3.4, rayleigh: 3.6, mie: 0.0055, mieG: 0.86, skyGamma: 1.20, sunDisc: 78,
    ground: [0.040, 0.038, 0.036],
    // cloudSharp is the smoothstep half-width on coverage: 0.34 was so wide
    // that every cloud was a 60 %-of-frame gradient, i.e. haze. 0.13 gives an
    // edge, and the erosion + sun-side shading in sky-material.js gives form.
    cloudCover: 0.40, cloudSharp: 0.13, cloudScale: 1.45,
    cloudLit: [1.00, 0.88, 0.74], cloudDark: [0.13, 0.16, 0.26], cloudAmb: 0.62,
    zenith: [0.130, 0.250, 0.580], skyBlue: 0.82,
    // Shadow fill. hemiSky is cool but not a pure blue — a saturated sky tint
    // over dark asphalt just paints it flat blue and eats the albedo. The
    // bounce term is deliberately warm: it stands in for sunlight coming back
    // off the lit brick, and being *directional* it is the only thing that puts
    // normal-map relief on shadowed ground. Both are up hard from round 4:
    // shadowed asphalt was landing at luma 20, where no albedo or normal detail
    // can survive the grade, which is exactly why the shadow read as a decal.
    // Measured on shots/lightdbg6: shadowed asphalt came out R33 G37 B67 —
    // blue at twice red, on a material whose albedo is neutral grey. That is
    // where "flat blue painted polygons" comes from: not the shadow *shape*, the
    // shadow *hue*. The cool fill was being supplied twice, by a saturated
    // hemiSky and by a PMREM of a sky whose zenith is [0.13,0.25,0.58] (blue at
    // 4.5x red) at envIntensity 2.05, and then pushed a third time by the
    // grade's shadowTint. Skylight really is blue, but shade on a street is not
    // 2:1 blue, because half of what reaches it is warm bounce off the sunlit
    // facade opposite. So: desaturate the hemisphere, cut the over-amplified
    // IBL, and put the missing energy into the *warm, directional* bounce, which
    // is also the only term that gives shadowed ground any normal-map relief.
    // Target: shaded tarmac around luma 28 with blue ~1.35x red, sunlit tarmac
    // around 120. hemiSky carries the chroma (it is the only term that is cool
    // *and* unshadowed), bounce keeps its hue but a third of its energy so it
    // still lifts shadow-side walls and gives shaded ground some directional
    // relief without repainting the shade amber.
    // Fill budget, round 7. Probing matched road patches through the sun mask
    // (tools/_hist.mjs on street-sunwhite vs street-base) gives the honest
    // numbers: fully sunlit mid-road luma 163, fully shadowed mid-road luma 28
    // with B/R 1.04 — a 5.8:1 key:fill on a cool shade, which is the two-colour
    // golden hour the critique asked for. But the same cut put shadowed *props*
    // at luma 14: the sandbag stack went to a black silhouette, which is the
    // round-3 "loses its albedo in shade" failure moved onto the props. So the
    // fill goes back up — but all of the increase lands on the hemisphere, the
    // one term that is both cool and unshadowed, rather than on the amber IBL or
    // the warm bounce that made the image monochrome in the first place.
    // hemiGround is warmed slightly: it is what lifts the undersides of stacked
    // props, and bounce off sunlit tarmac really is warm.
    hemiSky: [0.42, 0.58, 0.95], hemiGround: [0.28, 0.24, 0.20], hemiInt: 1.70, envInt: 1.05,
    bounce: [1.00, 0.84, 0.70], bounceInt: 0.52,
    fog: { density: 0.0046, falloff: 15, base: -1, start: 18,
           color: [0.072, 0.098, 0.150], lowColor: [0.118, 0.122, 0.148],
           sunColor: [0.34, 0.20, 0.10], minT: 0.12, aniso: 0.72 },
    post: {
      // white 0.925 was stretching an already-shouldered highlight another 8 %
      // toward clipping; 0.965 keeps the sun disc and specular clipping (true
      // whites are still present, verified by histogram) while giving the lit
      // asphalt back its texture.
      exposure: 1.34, contrast: 1.13, saturation: 1.07, toe: 0.012, split: 0.50, white: 0.965,
      lift: [-0.002, 0.000, 0.006], gamma: [1.0, 1.0, 1.01], gain: [1.03, 1.0, 0.975],
      shadowTint: [0.90, 0.98, 1.10], highTint: [1.12, 1.00, 0.84],
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
    skyLum: 4.80, turbidity: 3.0, rayleigh: 2.0, mie: 0.005, mieG: 0.80, skyGamma: 1.22, sunDisc: 90,
    ground: [0.060, 0.058, 0.055],
    cloudCover: 0.22, cloudSharp: 0.15, cloudScale: 1.50,
    cloudLit: [1.00, 0.99, 0.97], cloudDark: [0.20, 0.24, 0.34], cloudAmb: 0.72,
    zenith: [0.22, 0.40, 0.86], skyBlue: 0.88,
    hemiSky: [0.50, 0.62, 0.86], hemiGround: [0.22, 0.20, 0.17], hemiInt: 1.15, envInt: 2.55,
    bounce: [0.62, 0.58, 0.50], bounceInt: 0.90,
    fog: { density: 0.0026, falloff: 30, base: -1, start: 26,
           color: [0.085, 0.105, 0.145], lowColor: [0.130, 0.140, 0.165],
           sunColor: [0.34, 0.34, 0.36], minT: 0.18, aniso: 0.60 },
    post: {
      exposure: 1.20, contrast: 1.11, saturation: 1.03, toe: 0.016, split: 0.36, white: 0.940,
      lift: [-0.006, 0.000, 0.005], gamma: [1.0, 1.0, 1.0], gain: [1.01, 1.0, 0.99],
      shadowTint: [0.88, 0.96, 1.10], highTint: [1.05, 1.00, 0.93],
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

    // --- sun rig: ONE fitted shadow cascade -------------------------------
    // Round 4's "flat blue painted polygons" were a two-cascade artefact, not a
    // grading problem. Two shadow-casting directionals each carrying half the
    // sun's intensity means a pixel inside only one frustum is exactly half
    // shadowed — so the near cascade's ortho box printed its own hard-edged
    // quadrilateral across the road at 50 % grey. One map, wide enough to cover
    // the whole visible street, has no seam anywhere; the softness the second
    // cascade was buying is now bought properly by PCSS (render-shadows.js),
    // which widens the penumbra with occluder height instead.
    const mapSize = ctx.config.shadowMapSize;
    const size = Math.min(4096, Math.round(mapSize * (tier >= 3 ? 1.5 : 1)));
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this._setupShadow(this.sun, size, tier >= 2 ? 78 : 55);
    scene.add(this.sun, this.sun.target);

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

  _setupShadow(light, size, radius) {
    const s = light.shadow;
    s.mapSize.set(size, size);
    s.camera.near = 0.5;
    s.camera.far = radius * 4 + 60;
    s.camera.left = -radius; s.camera.right = radius;
    s.camera.top = radius; s.camera.bottom = -radius;
    // The receiver-plane bias in render-shadows.js does the heavy lifting, so
    // these two only have to cover depth quantisation — keeping them small is
    // what stops contact shadows detaching (peter-panning) from prop feet.
    s.bias = -0.0002;
    s.normalBias = 0.022;
    // With PCSS, `radius` is the *maximum* penumbra (and the blocker-search
    // disk), in shadow texels. At a ~5 cm texel, 15 texels is a ~0.75 m
    // penumbra: what a parapet ten metres up should throw onto the road, while
    // a kerb still lands a near-hard edge because its blocker depth is tiny.
    s.radius = 15;
    s.blurSamples = 12;
    // Let ~8 % of the sun through in shadow (three mixes this in getShadow()).
    // This is the direct answer to "shadowed asphalt loses its albedo and normal
    // detail": ambient fill alone is smooth, so it lifts the luminance without
    // restoring any relief, and the shadow ends up a flat tinted plate. A small
    // fraction of the *directional* term keeps the normal map, the albedo hue
    // and the specular response alive inside the shadow — just eleven stops
    // down — so the road in shade still reads as the same road.
    // ...but 8 % of a 22-unit warm sun is more warm light than the whole sky puts
    // into the shade, which is half of why the shadows measured amber. 3.5 % is
    // enough to keep the normal map and the specular alive without tinting.
    s.intensity = 0.965;
    s.camera.updateProjectionMatrix();
    light.userData.fitRadius = radius;
    const texel = (radius * 2) / size;
    light.userData.texel = texel;
    // Penumbra growth handed to the shadow chunk, in texels per unit of
    // normalised shadow-camera depth: SOFTEN metres of penumbra per metre of
    // occluder height above the receiver. Physically the sun gives ~0.009;
    // COD-ish softness wants an order more than that.
    const SOFTEN = 0.075;
    // base is the contact penumbra floor in texels. 1.1 left the texel grid
    // visible as ~15 px stair-steps on near-field tarmac (measurable on the
    // ?view=sun,white mask); 1.8 hides the grid while a kerb still lands inside
    // ~9 cm of the geometry.
    installSoftShadows({ growth: ((s.camera.far - s.camera.near) * SOFTEN) / texel, base: 1.8 });
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

    const col = new THREE.Color(p.sunColor[0], p.sunColor[1], p.sunColor[2]);
    this.sun.color.copy(col); this.sun.intensity = p.sunIntensity;
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

    // push the cascade forward so the texel budget is spent on what's on screen
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    this._fitCascade(this.sun, c.clone().addScaledVector(fwd, this.sun.userData.fitRadius * 0.42));

    // the sky dome rides with the camera so it never clips
    this.dome.position.copy(cam.position);

    if (this.dust) this.dust.update(dt, cam);
  }
}
