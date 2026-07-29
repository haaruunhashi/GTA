// Custom full-screen shaders for the post stack. Owner: render agent.
// All of these are hand-written ShaderPass payloads (no addon shaders).
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Composite / grade: chromatic aberration -> exposure -> vignette -> ACES
// filmic tonemap -> lift/gamma/gain -> shadow/highlight split tone -> contrast
// -> saturation -> film grain -> sRGB encode.  One pass, one dependent texture
// fetch triple (CA), everything else is ALU.
// ---------------------------------------------------------------------------
export const CompositeShader = {
  name: 'CompositeGrade',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uExposure: { value: 1.0 },
    uCA: { value: 1.0 },          // chromatic aberration strength (px at corner)
    uVignette: { value: 0.42 },   // 0 = off
    uVigSoft: { value: 0.55 },
    uGrain: { value: 0.035 },
    uContrast: { value: 1.06 },
    uSaturation: { value: 1.02 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGammaC: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uShadowTint: { value: new THREE.Vector3(0.86, 0.96, 1.08) }, // teal-ish shadows
    uHighTint: { value: new THREE.Vector3(1.06, 1.0, 0.92) },    // warm highlights
    uSplit: { value: 0.5 },
    uToe: { value: 0.0 },          // black point: crush toward true black
    uWhite: { value: 0.95 },       // white point: everything above this clips
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uTime, uExposure, uCA, uVignette, uVigSoft, uGrain, uContrast, uSaturation, uSplit, uToe, uWhite;
    uniform vec3 uLift, uGammaC, uGain, uShadowTint, uHighTint;

    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

    // --- ACES (Stephen Hill fit), sRGB primaries in / out -------------------
    const mat3 ACESIn = mat3(
      0.59719, 0.07600, 0.02840,
      0.35458, 0.90834, 0.13383,
      0.04823, 0.01566, 0.83777);
    const mat3 ACESOut = mat3(
       1.60475, -0.10208, -0.00327,
      -0.53108,  1.10813, -0.07276,
      -0.07367, -0.00605,  1.07602);
    vec3 rrt(vec3 v) {
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 acesFitted(vec3 c) {
      c = ACESIn * c;
      c = rrt(c);
      c = ACESOut * c;
      return clamp(c, 0.0, 1.0);
    }
    vec3 srgbEncode(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    }
    float hash13(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);

      // Chromatic aberration: strictly radial and gated to the outer edge of
      // the frame. rn is 1.0 at the edge midpoints, ~1.41 in the corners; the
      // gate is exactly zero until rn > 0.80 (i.e. the outer ~20% of frame)
      // and ramps as a cubic, so nothing fringes mid-frame.
      float rn = length(c) * 2.0;
      float gate = smoothstep(0.80, 1.34, rn);
      gate *= gate * gate;
      vec3 col;
      if (uCA > 0.0001 && gate > 0.0005) {
        vec2 rd = c / max(length(c), 1e-5);
        vec2 off = rd * gate * uCA * 2.2 / uResolution;
        col.r = texture2D(tDiffuse, uv + off).r;
        col.g = texture2D(tDiffuse, uv).g;
        col.b = texture2D(tDiffuse, uv - off).b;
      } else {
        col = texture2D(tDiffuse, uv).rgb;
      }
      col = max(col, 0.0);

      // exposure (scene-referred, before the tonemapper)
      col *= uExposure;

      // vignette in linear light so it darkens rather than greys
      float vig = 1.0 - uVignette * smoothstep(uVigSoft * 0.18, 0.72, r2);
      col *= vig;

      // filmic tonemap -> display referred
      col = acesFitted(col);
      col = srgbEncode(col);

      // lift / gamma / gain
      col = uGain * (col + uLift * (1.0 - col));
      col = pow(max(col, 0.0), 1.0 / max(uGammaC, vec3(0.05)));

      // shadow / highlight split toning
      float l = dot(col, LUMA);
      float sw = 1.0 - smoothstep(0.0, 0.55, l);
      float hw = smoothstep(0.42, 1.0, l);
      col *= mix(vec3(1.0), uShadowTint, sw * uSplit);
      col *= mix(vec3(1.0), uHighTint, hw * uSplit);

      // contrast around a slightly low pivot (keeps the sky from blowing while
      // the shadows still get pushed down)
      col = (col - 0.50) * uContrast + 0.50;
      // Black point + white point. Anything at or below uToe becomes true
      // black; anything at or above uWhite clips to paper white, so the
      // histogram actually touches both ends instead of sitting in a tan band.
      col = (col - uToe) / max(uWhite - uToe, 0.05);
      col = clamp(col, 0.0, 1.0);

      // saturation
      l = dot(col, LUMA);
      col = mix(vec3(l), col, uSaturation);

      // film grain: stronger in the shadows, animated
      float n = hash13(vec3(gl_FragCoord.xy, floor(uTime * 24.0)));
      col += (n - 0.5) * uGrain * (1.0 - 0.65 * smoothstep(0.0, 0.7, l));

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

// ---------------------------------------------------------------------------
// Sharpen: 4-tap unsharp mask with a soft clamp so it doesn't ring on edges.
// Runs after AA, in display space. ~5 texture fetches.
// ---------------------------------------------------------------------------
export const SharpenShader = {
  name: 'Sharpen',
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAmount: { value: 0.35 },
  },
  vertexShader: CompositeShader.vertexShader,
  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uAmount;
    void main() {
      vec2 t = 1.0 / uResolution;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      vec3 b = texture2D(tDiffuse, vUv + vec2(t.x, 0.0)).rgb
             + texture2D(tDiffuse, vUv - vec2(t.x, 0.0)).rgb
             + texture2D(tDiffuse, vUv + vec2(0.0, t.y)).rgb
             + texture2D(tDiffuse, vUv - vec2(0.0, t.y)).rgb;
      b *= 0.25;
      vec3 d = c - b;
      d = sign(d) * min(abs(d), vec3(0.22));   // clamp halo
      gl_FragColor = vec4(clamp(c + d * uAmount, 0.0, 1.0), 1.0);
    }
  `,
};
