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
import { GodRayPass } from './render-godrays.js';

const TIER = { low: 0, medium: 1, high: 2, ultra: 3 };

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
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

    if (this.tier >= 2) {
      const gtao = new GTAOPass(ctx.scene, ctx.camera, w, h);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 1.0;
      gtao.updateGtaoMaterial({
        radius: 0.55,            // metres — contact shadows, not a global wash
        distanceExponent: 1.4,
        thickness: 0.35,         // thin => no dark halo behind thin geometry
        scale: 1.35,
        samples: this.tier >= 3 ? 16 : 8,
        distanceFallOff: 0.9,
        screenSpaceRadius: false,
      });
      gtao.updatePdMaterial({ lumaPhi: 8, depthPhi: 2.5, normalPhi: 4, radius: 3, radiusExponent: 1, rings: 2, samples: this.tier >= 3 ? 12 : 6 });
      composer.addPass(gtao);
      this.gtao = gtao;
    }

    if (this.tier >= 2) {
      this.godrays = new GodRayPass(w, h, 0.25);
      composer.addPass(this.godrays);
    }

    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.34, 0.62, 1.05);
    composer.addPass(this.bloom);

    this.composite = new ShaderPass(CompositeShader);
    this.composite.uniforms.uResolution.value.set(w, h);
    composer.addPass(this.composite);

    if (this.tier >= 1) composer.addPass(new SMAAPass());

    if (this.tier >= 2) {
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
    this.composer.render(dt);
  }
}
