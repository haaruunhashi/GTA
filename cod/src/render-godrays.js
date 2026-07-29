// Screen-space volumetric light shafts (radial occlusion blur toward the sun).
// Owner: render agent. Runs at quarter resolution: one bright-pass + two radial
// blur iterations + an additive combine, so the whole effect is ~1.2 full-res
// texture fetches per pixel.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Bright pass: keeps only what is much brighter than the scene mid-tone (sky,
// sun disc, hot windows) and fades it out away from the sun so shafts stay local.
const BrightShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uThreshold: { value: 1.1 },
    uAspect: { value: 1.777 },
    uFalloff: { value: 0.42 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uThreshold, uAspect, uFalloff;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = max(max(c.r, c.g), c.b);
      vec3 hi = c * max(l - uThreshold, 0.0) / max(l, 1e-4);
      vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
      float m = exp(-dot(d, d) / max(uFalloff * uFalloff, 1e-3));
      gl_FragColor = vec4(hi * m, 1.0);
    }
  `,
};

const RadialShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uDensity: { value: 0.75 },
    uDecay: { value: 0.95 },
    uStep: { value: 1.0 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uDensity, uDecay, uStep;
    void main() {
      const int N = 10;
      vec2 dir = (vUv - uSun) * (uDensity / float(N)) * uStep;
      vec2 uv = vUv;
      vec3 acc = vec3(0.0);
      float w = 1.0, tot = 0.0;
      for (int i = 0; i < N; i++) {
        acc += texture2D(tDiffuse, uv).rgb * w;
        tot += w;
        uv -= dir;
        w *= uDecay;
      }
      gl_FragColor = vec4(acc / max(tot, 1e-4), 1.0);
    }
  `,
};

const CombineShader = {
  uniforms: {
    tDiffuse: { value: null },
    tShafts: { value: null },
    uIntensity: { value: 0.8 },
    uStreak: { value: 0.5 },
    uTint: { value: new THREE.Color(1, 0.86, 0.66) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse, tShafts;
    uniform float uIntensity, uStreak;
    uniform vec3 uTint;
    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec3 s = texture2D(tShafts, vUv).rgb;

      // Anamorphic-ish horizontal streak: a short 1D smear of the shaft buffer.
      // This is the directional signature of a real anamorphic lens flare, and
      // reads as structure rather than as the radial smear a big blur gives.
      vec3 st = vec3(0.0);
      if (uStreak > 0.001) {
        const int M = 8;
        float tot = 0.0;
        for (int i = -M; i <= M; i++) {
          float fi = float(i);
          float w = exp(-fi * fi / 26.0);
          st += texture2D(tShafts, vUv + vec2(fi * 0.010, 0.0)).rgb * w;
          tot += w;
        }
        st /= max(tot, 1e-4);
      }

      vec3 add = (s + st * uStreak * 1.6) * uTint * uIntensity;
      gl_FragColor = vec4(base + add, 1.0);
    }
  `,
};

export class GodRayPass extends Pass {
  constructor(width, height, scale = 0.25) {
    super();
    this.needsSwap = true;
    this.scale = scale;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.bright = new THREE.ShaderMaterial({ ...BrightShader, uniforms: THREE.UniformsUtils.clone(BrightShader.uniforms) });
    this.radial = new THREE.ShaderMaterial({ ...RadialShader, uniforms: THREE.UniformsUtils.clone(RadialShader.uniforms) });
    this.combine = new THREE.ShaderMaterial({ ...CombineShader, uniforms: THREE.UniformsUtils.clone(CombineShader.uniforms) });
    this.quad = new FullScreenQuad(null);
    this.setSize(width, height);
    this.intensity = 0.8;
    this.enabled = true;
  }
  setSize(w, h) {
    this.rtA.setSize(Math.max(1, Math.round(w * this.scale)), Math.max(1, Math.round(h * this.scale)));
    this.rtB.setSize(this.rtA.width, this.rtA.height);
    this.bright.uniforms.uAspect.value = w / Math.max(h, 1);
  }
  setSun(uv, visibility) {
    this.bright.uniforms.uSun.value.copy(uv);
    this.radial.uniforms.uSun.value.copy(uv);
    this._vis = visibility;
  }
  render(renderer, writeBuffer, readBuffer) {
    const vis = this._vis === undefined ? 1 : this._vis;
    if (vis <= 0.001 || this.intensity <= 0.001) {
      // straight copy — cheaper than the full chain when the sun is behind us
      this.combine.uniforms.tDiffuse.value = readBuffer.texture;
      this.combine.uniforms.tShafts.value = readBuffer.texture;
      this.combine.uniforms.uIntensity.value = 0;
      this.combine.uniforms.uStreak.value = 0;
      this.quad.material = this.combine;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.quad.render(renderer);
      return;
    }
    const old = renderer.getRenderTarget();
    // 1. bright pass, downsampled
    this.bright.uniforms.tDiffuse.value = readBuffer.texture;
    this.quad.material = this.bright;
    renderer.setRenderTarget(this.rtA);
    renderer.clear();
    this.quad.render(renderer);
    // 2. two radial blur iterations (effective 100 taps for 20 fetches)
    this.radial.uniforms.tDiffuse.value = this.rtA.texture;
    this.radial.uniforms.uStep.value = 1.0;
    this.quad.material = this.radial;
    renderer.setRenderTarget(this.rtB);
    this.quad.render(renderer);
    this.radial.uniforms.tDiffuse.value = this.rtB.texture;
    this.radial.uniforms.uStep.value = 0.1;
    renderer.setRenderTarget(this.rtA);
    this.quad.render(renderer);
    // 3. additive combine at full res
    this.combine.uniforms.tDiffuse.value = readBuffer.texture;
    this.combine.uniforms.tShafts.value = this.rtA.texture;
    this.combine.uniforms.uIntensity.value = this.intensity * vis;
    this.quad.material = this.combine;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    renderer.setRenderTarget(old);
  }
  dispose() { this.rtA.dispose(); this.rtB.dispose(); this.quad.dispose(); }
}
