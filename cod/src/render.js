// Rendering pipeline: WebGL2 renderer, HDR lighting setup, shadows, post stack.
// Owner: render agent. Public API: resize(), render(dt), setQuality(q).
//
// Pipeline (ultra):
//   scene -> HalfFloat HDR buffer
//   GTAO           (screen-space ambient occlusion, half-ish cost, quality>=high)
//   GodRayPass     (quarter-res radial shafts from the sun, quality>=high)
//   UnrealBloom    (HDR threshold bloom, tight)
//   Composite      (CA, exposure, vignette, ACES, lift/gamma/gain, split tone,
//                   contrast, saturation, grain, sRGB encode)   <- our shader
//   SMAA           (thin-geometry-safe AA, runs on the graded LDR image)
//   Sharpen        (clamped unsharp mask)                        <- our shader
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { CompositeShader, SharpenShader } from './render-shaders.js';
import { installSoftShadows } from './render-shadows.js';
import { GodRayPass } from './render-godrays.js';
import { RenderDebug, AOStretchShader } from './render-debug.js';
import { AOApplyShader } from './render-ao.js';

const TIER = { low: 0, medium: 1, high: 2, ultra: 3 };

// Diagnostic switches, query-string only. See render-debug.js for the token list.
const DBG = new RenderDebug((new URLSearchParams(location.search).get('view') || '').split(','));
const AOVIEW = DBG.has('ao') || DBG.has('aox');

export class Render {
  constructor(ctx) {
    this.ctx = ctx;
    this.tier = TIER[ctx.config.quality] ?? 3;

    const renderer = new THREE.WebGLRenderer({
      antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
      preserveDrawingBuffer: true, // needed for deterministic screenshot capture
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, ctx.config.pixelRatioCap));
    renderer.setSize(innerWidth, innerHeight);
    // PCFShadowMap + our patched chunk: the 16-tap rotated disk honours
    // light.shadow.radius, so sky.js can pick the penumbra width per cascade.
    installSoftShadows();
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = true;
    // The scene renders scene-referred into a half-float buffer; tonemapping and
    // the display transform live in our composite pass, not in the material.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.info.autoReset = true;
    document.getElementById('app').appendChild(renderer.domElement);
    this.renderer = renderer;
    ctx.renderer = renderer;
    ctx.canvas = renderer.domElement;

    this._sunUv = new THREE.Vector2(0.5, 0.5);
    this._v = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._time = 0;

    addEventListener('resize', () => this.resize());
  }

  // The composer is built on the first frame so that ctx.sky (which owns the
  // atmosphere grade parameters and the sun) already exists.
  _build() {
    const { ctx } = this;
    const w = innerWidth, h = innerHeight;
    const composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      colorSpace: THREE.LinearSRGBColorSpace,
      samples: 0,
    }));
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(w, h);

    composer.addPass(new RenderPass(ctx.scene, ctx.camera));

    if (this.tier >= 2 && !DBG.has('raw') && !DBG.has('noao')) {
      const gtao = new GTAOPass(ctx.scene, ctx.camera, w, h);
      // Off + needsSwap=false: the pass computes the AO buffer and leaves the
      // beauty alone; AOApplyShader below does the compositing, because three's
      // flat multiply is the wrong operator here (see render-ao.js).
      gtao.output = AOVIEW ? GTAOPass.OUTPUT.Denoise : GTAOPass.OUTPUT.Off;
      gtao.needsSwap = AOVIEW;
      gtao.blendIntensity = 1.0;
      // Round 3 and round 4 both shipped "no visible contact AO" with this pass
      // enabled. Two separate causes, both now addressed:
      //   * the blend (see render-ao.js), and
      //   * the radius. 2.6 m was too *large* — a 15 cm kerb subtends almost
      //     nothing of a 2.6 m hemisphere, so the buffer came back at 0.97 and no
      //     gamma on that is visible. 0.85 m then overshot the other way: the
      //     darkening was real but only ~10 screen pixels tall at a sandbag foot,
      //     which is invisible at a glance. 1.6 m is the scale that actually
      //     reads: it puts a ~0.5 m gradient of shade on the ground around a
      //     prop, which is what the eye uses to seat an object on a surface.
      //
      // `thickness` was the third and decisive cause. three's GTAO rejects a
      // sample outright unless `abs(viewDelta.z) < thickness` — a depth-space
      // test, not a world-distance one. This camera looks *along* the road, so
      // the sandbag that should shade the tarmac a metre in front of it differs
      // from that tarmac by about a metre of view depth; at thickness 0.7-0.9
      // every such sample was discarded and the occlusion footprint collapsed to
      // ~20 screen pixels around the silhouette. Measured on the stretched AO
      // view: ground AO went 0.30 -> 1.000 (exactly, sd 0) within 25 px of the
      // sandbag feet. thickness has to be comfortably larger than the radius for
      // grazing views. distanceFallOff also had to come down: at 1.0 it weights
      // step j by 2/(j+2), so the outer half of the radius contributed almost
      // nothing even when the samples were accepted.
      gtao.updateGtaoMaterial({
        radius: 1.6,
        distanceExponent: 1.5,
        thickness: 4.0,
        scale: 1.25,
        distanceFallOff: 0.25,
        samples: this.tier >= 3 ? 16 : 8,
        screenSpaceRadius: false,
      });
      // Denoise has to be gentle or it smears the contact gradient back out:
      // a 3 px radius over a half-metre feature is most of the feature.
      gtao.updatePdMaterial({ lumaPhi: 8, depthPhi: 2.0, normalPhi: 5, radius: 2.2, radiusExponent: 1, rings: 2, samples: this.tier >= 3 ? 12 : 6 });
      composer.addPass(gtao);
      this.gtao = gtao;

      if (!AOVIEW) {
        this.aoApply = new ShaderPass(AOApplyShader);
        this.aoApply.uniforms.tAO.value = gtao.pdRenderTarget.texture;
        this.aoApply.uniforms.uTexel.value = [1 / w, 1 / h];
        composer.addPass(this.aoApply);
      }
    }

    if (DBG.has('aox')) {
      const st = new ShaderPass(AOStretchShader);
      composer.addPass(st);
    }

    if (this.tier >= 2 && !AOVIEW) {
      this.godrays = new GodRayPass(w, h, 0.25);
      composer.addPass(this.godrays);
    }

    if (!DBG.any) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.28, 0.45, 1.55);
      composer.addPass(this.bloom);
    }

    this.composite = new ShaderPass(CompositeShader);
    this.composite.uniforms.uResolution.value.set(w, h);
    if (!AOVIEW && !DBG.has('raw')) composer.addPass(this.composite);

    if (this.tier >= 1 && !DBG.any) composer.addPass(new SMAAPass());

    if (this.tier >= 2 && !DBG.any) {
      this.sharpen = new ShaderPass(SharpenShader);
      this.sharpen.uniforms.uResolution.value.set(w, h);
      composer.addPass(this.sharpen);
    }

    // make sure the very last pass writes to the canvas
    const last = composer.passes[composer.passes.length - 1];
    last.renderToScreen = true;
    this.composer = composer;
  }

  resize() {
    const { camera } = this.ctx;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    if (!this.composer) return;
    this.composer.setSize(innerWidth, innerHeight);
    this.composite.uniforms.uResolution.value.set(innerWidth, innerHeight);
    if (this.aoApply) this.aoApply.uniforms.uTexel.value = [1 / innerWidth, 1 / innerHeight];
    if (this.sharpen) this.sharpen.uniforms.uResolution.value.set(innerWidth, innerHeight);
    if (this.godrays) this.godrays.setSize(innerWidth, innerHeight);
  }

  // Pull the look parameters from the atmosphere module every frame so a
  // time-of-day change immediately re-grades the image.
  _sync(dt) {
    const sky = this.ctx.sky;
    const cam = this.ctx.camera;
    this._time += dt;
    const u = this.composite.uniforms;
    u.uTime.value = this._time;

    const p = sky && sky.post;
    if (p) {
      u.uExposure.value = p.exposure;
      u.uContrast.value = p.contrast;
      u.uSaturation.value = p.saturation;
      u.uLift.value.copy(p.lift);
      u.uGammaC.value.copy(p.gamma);
      u.uGain.value.copy(p.gain);
      u.uShadowTint.value.copy(p.shadowTint);
      u.uHighTint.value.copy(p.highTint);
      u.uSplit.value = p.split;
      u.uToe.value = p.toe;
      u.uVignette.value = p.vignette;
      u.uCA.value = p.ca;
      u.uGrain.value = p.grain;
      if (p.white !== undefined) u.uWhite.value = p.white;
      if (this.sharpen) this.sharpen.uniforms.uAmount.value = p.sharpen;
      if (this.bloom) {
        this.bloom.strength = p.bloom;
        this.bloom.threshold = p.bloomThreshold;
        this.bloom.radius = p.bloomRadius;
      }
    }

    if (this.godrays && sky && sky.sunDir) {
      cam.getWorldDirection(this._fwd);
      const facing = this._fwd.dot(sky.sunDir);
      this._v.copy(sky.sunDir).multiplyScalar(900).add(cam.position).project(cam);
      this._sunUv.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5);
      // fade out as the sun leaves the frame, kill it when it's behind us
      const off = Math.max(Math.abs(this._sunUv.x - 0.5) - 0.5, Math.abs(this._sunUv.y - 0.5) - 0.5, 0);
      const vis = THREE.MathUtils.smoothstep(facing, 0.05, 0.55) * Math.exp(-off * 5.0);
      this.godrays.setSun(this._sunUv, vis);
      this.godrays.intensity = (p ? p.godrays : 0.8);
      this.godrays.radial.uniforms.uDensity.value = p ? p.godrayDensity : 0.8;
      this.godrays.radial.uniforms.uDecay.value = 0.955;
      this.godrays.bright.uniforms.uThreshold.value = p ? p.godrayThreshold : 1.1;
      this.godrays.combine.uniforms.uStreak.value = (p && p.streak !== undefined) ? p.streak : 0.5;
      if (p) this.godrays.combine.uniforms.uTint.value.copy(p.godrayTint);
    }
  }

  setQuality(q) {
    const t = TIER[q];
    if (t === undefined || t === this.tier) return;
    this.tier = t;
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
  }

  // Anything parented to the camera is viewmodel space: it is drawn at a
  // different effective FOV and sits ~40 cm from the eye, so it must never be
  // rasterised into the world shadow map. It is worth enforcing here rather than
  // trusting the flag at construction time, because the cost of getting it wrong
  // is spectacular and was in fact the biggest single lighting defect in the
  // round-4 frame: shots/lightdbg7/street-sunwhite.png shows a hard-edged black
  // quadrilateral covering most of the road, stair-stepped in ~15 px blocks. That
  // is a 40 cm object — eight shadow texels across a 156 m cascade — smeared by
  // an 11-degree sun into a 30 m shadow on the tarmac. It is exactly what the
  // critique called "flat blue painted polygons": not a grading failure and not a
  // cascade failure, the gun's own shadow.
  _noViewmodelShadows() {
    const cam = this.ctx.camera;
    if (!cam) return;
    // cheap change detector so the traverse is not paid every frame
    let n = 0;
    for (const c of cam.children) n += 1 + (c.children ? c.children.length : 0);
    if (n === this._vmCount) return;
    this._vmCount = n;
    for (const c of cam.children) c.traverse(o => { o.castShadow = false; });
  }

  render(dt) {
    if (!this.composer) this._build();
    this._noViewmodelShadows();
    this._sync(dt);
    DBG.apply(this.ctx);
    // The GTAO pass reallocates its targets on resize, so re-bind every frame
    // rather than caching a texture that can go stale.
    if (this.aoApply && this.gtao) this.aoApply.uniforms.tAO.value = this.gtao.pdRenderTarget.texture;
    this.composer.render(dt);
  }
}
