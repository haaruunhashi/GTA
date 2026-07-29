// Sniper scope: a real second camera rendered to a texture, presented through a
// lens shader with eye-relief vignette, pincushion + chromatic edge and a duplex
// mil-dot reticle. Everything outside the ocular circle is black, as in COD.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex;
uniform float uAspect, uBlend, uRadius, uVig, uTime, uGlint;
uniform vec2 uEye;
varying vec2 vUv;

float lineMask(float d, float w) { return 1.0 - smoothstep(w * 0.45, w, abs(d)); }

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= uAspect;
  vec2 q = p - uEye;
  float r = length(q);
  float R = uRadius;

  // ---- scope image ----
  vec2 sp = q / R;
  float rr = dot(sp, sp);
  vec2 d = sp * (1.0 + 0.055 * rr);
  float ca = 0.0035 + 0.020 * rr;
  vec3 col;
  col.r = texture2D(uTex, (d * (1.0 + ca)) * 0.5 + 0.5).r;
  col.g = texture2D(uTex, d * 0.5 + 0.5).g;
  col.b = texture2D(uTex, (d * (1.0 - ca)) * 0.5 + 0.5).b;
  col *= 1.04;
  // slight cool glass tint + edge falloff
  col *= mix(vec3(1.0), vec3(0.90, 0.96, 1.06), 0.35);
  col *= 1.0 - 0.55 * smoothstep(0.55, 1.0, sqrt(rr));

  // ---- reticle (drawn in scope-normalised space) ----
  vec2 s = sp;
  float thin = 0.0055, thick = 0.028;
  float wx = mix(thin, thick, smoothstep(0.60, 0.70, abs(s.x)));
  float wy = mix(thin, thick, smoothstep(0.60, 0.70, abs(s.y)));
  float hor = lineMask(s.y, wx) * step(0.055, abs(s.x)) * step(abs(s.x), 0.98);
  float ver = lineMask(s.x, wy) * step(0.055, abs(s.y)) * step(abs(s.y), 0.98);
  float ret = max(hor, ver);
  for (int i = 1; i <= 3; i++) {
    float o = 0.20 * float(i);
    ret = max(ret, 1.0 - smoothstep(0.012, 0.020, length(s - vec2(o, 0.0))));
    ret = max(ret, 1.0 - smoothstep(0.012, 0.020, length(s + vec2(o, 0.0))));
    ret = max(ret, 1.0 - smoothstep(0.012, 0.020, length(s - vec2(0.0, o))));
    ret = max(ret, 1.0 - smoothstep(0.012, 0.020, length(s + vec2(0.0, o))));
  }
  col = mix(col, vec3(0.006, 0.006, 0.008), ret * 0.96);
  float dot0 = 1.0 - smoothstep(0.006, 0.013, length(s));
  col += vec3(2.2, 0.20, 0.10) * dot0;

  // ---- eye relief: a dark ring that eats the edge when the eye box is off ----
  float ev = smoothstep(R * (1.0 + uVig), R * (0.55 - uVig * 0.25), r);
  col *= mix(0.015, 1.0, ev);

  // ocular ring highlight + a faint moving glint on the glass
  float ring = smoothstep(R * 1.002, R * 0.985, r) - smoothstep(R * 0.985, R * 0.94, r);
  col += vec3(0.35, 0.40, 0.50) * ring * 0.5;
  col += vec3(0.20, 0.26, 0.34) * uGlint * smoothstep(0.9, 0.0, abs(q.x * 0.9 - q.y - sin(uTime * 0.4) * 0.5)) * smoothstep(R, R * 0.2, r);

  float mask = smoothstep(R + 0.010, R - 0.004, r);
  vec3 outc = col * mask;
  gl_FragColor = vec4(outc, uBlend);
}`;

export class ScopeView {
  constructor(ctx) {
    this.ctx = ctx;
    const size = ctx.config && (ctx.config.quality === 'low' || ctx.config.shot) ? 640 : 900;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false,
    });
    this.cam = new THREE.PerspectiveCamera(7.5, 1, 0.05, 4000);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: this.rt.texture },
        uAspect: { value: 1.78 }, uBlend: { value: 0 }, uRadius: { value: 0.62 },
        uVig: { value: 0 }, uTime: { value: 0 }, uGlint: { value: 0 },
        uEye: { value: new THREE.Vector2() },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat);
    this.quad.position.set(0, 0, -0.05);
    this.quad.renderOrder = 60;
    this.quad.frustumCulled = false;
    this.quad.visible = false;
    ctx.camera.add(this.quad);
    this.blend = 0;
    this.time = 0;
  }

  setZoom(fovDeg) { this.fov = fovDeg; }

  /** Render the world through the scope. `hidden` objects are skipped (the viewmodel). */
  renderRT(hidden, fovDeg) {
    const r = this.ctx.renderer, cam = this.ctx.camera;
    if (!r) return;
    cam.updateMatrixWorld(true);
    this.cam.position.setFromMatrixPosition(cam.matrixWorld);
    this.cam.quaternion.setFromRotationMatrix(cam.matrixWorld);
    this.cam.fov = fovDeg;
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld(true);
    const prev = r.getRenderTarget();
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    for (let i = 0; i < hidden.length; i++) { const o = hidden[i]; if (o) { o.__sv = o.visible; o.visible = false; } }
    r.setRenderTarget(this.rt);
    r.clear(true, true, false);
    r.render(this.ctx.scene, this.cam);
    r.setRenderTarget(prev);
    r.shadowMap.autoUpdate = auto;
    for (let i = 0; i < hidden.length; i++) { const o = hidden[i]; if (o) o.visible = o.__sv; }
  }

  /** blend 0..1, sway = eye-box offset in screen units, vig = extra scope shadow */
  update(dt, blend, swayX, swayY, vig) {
    this.time += dt;
    this.blend = blend;
    const u = this.mat.uniforms;
    const cam = this.ctx.camera;
    this.quad.visible = blend > 0.002;
    if (!this.quad.visible) return;
    const z = 0.05;
    const h = 2 * z * Math.tan((cam.fov * Math.PI / 180) / 2) * 1.02;
    this.quad.scale.set(h * cam.aspect, h, 1);
    u.uAspect.value = cam.aspect;
    u.uBlend.value = Math.min(1, blend * 1.25);
    u.uRadius.value = 0.60 + (1 - blend) * 0.22;
    u.uEye.value.set(swayX, swayY);
    u.uVig.value = vig;
    u.uTime.value = this.time;
    u.uGlint.value = 0.35;
  }
}
