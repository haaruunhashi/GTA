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
      // Why round 3 and round 4 both shipped with "no visible contact AO"
      // despite this pass being enabled: the radius was 2.6 m. GTAO estimates
      // the horizon angle over that radius, so at a 15 cm kerb the occluder
      // subtends almost nothing of a 2.6 m hemisphere — the buffer comes back at
      // 0.96-0.99 and even `pow(ao, 5)` only removes a few percent, spread so
      // smoothly that it is invisible. Contact AO is a *small radius* effect:
      // under a metre, so a kerb face, a lamp base or a sandbag foot fills a
      // real fraction of the hemisphere and the buffer drops to 0.5-0.7.
      // `scale` is a gamma on that (ao = pow(ao, scale)), so it only needs to be
      // mild now, and blendIntensity slightly over 1 extrapolates the multiply.
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
      gtao.updateGtaoMaterial({
        radius: 1.6,
        distanceExponent: 1.1,
        thickness: 0.7,
        scale: 1.4,
        samples: this.tier >= 3 ? 16 : 8,
        distanceFallOff: 1.0,
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

  render(dt) {
    if (!this.composer) this._build();
    this._sync(dt);
    DBG.apply(this.ctx);
    // The GTAO pass reallocates its targets on resize, so re-bind every frame
    // rather than caching a texture that can go stale.
    if (this.aoApply && this.gtao) this.aoApply.uniforms.tAO.value = this.gtao.pdRenderTarget.texture;
    this.composer.render(dt);
  }
}
