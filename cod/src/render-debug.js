// Diagnostic views for the lighting pipeline. Owner: render agent.
//
// These exist because three visual defects in a row ("shadows read as flat
// painted polygons", "shadowed asphalt loses its albedo", "no contact AO") were
// each tuned at blind and none of them closed. You cannot tune a term you have
// not looked at in isolation, so `?view=<tokens>` renders the terms one at a
// time. Comma-separated tokens, combinable:
//
//   raw     skip the grade / AA / sharpen chain entirely
//   noao    build the pipeline without the GTAO pass (A/B against the default)
//   ao      GTAO denoise buffer straight to screen
//   aox     ...contrast-stretched from [AOX_LO..1] to [0..1] so a 0.95 buffer,
//           which looks like flat white, becomes readable
//   sun     kill hemisphere + IBL + bounce: direct sunlight and shadows only
//   amb     kill the sun + bounce: the ambient/IBL term only
//   white   replace every material with flat white dielectric and hide the sky
//           dome, so what is left is purely the lighting solution
//
// So `?view=sun,white` is a shadow mask, `?view=amb,white` is the sky-ambient
// term, and `?view=amb` shows whether the ambient carries albedo and normal
// detail (the thing the round-4 critique claimed it did not).
import * as THREE from 'three';

export const AOX_LO = 0.35;

export class RenderDebug {
  constructor(tokens) {
    this.on = new Set(tokens.filter(Boolean));
    this._saved = null;
    this._white = null;
  }
  has(t) { return this.on.has(t); }
  get any() { return this.on.size > 0; }

  // Called every frame after sky.js has pushed its light values, so the
  // overrides win. Restoring is unnecessary in capture mode but keeps the
  // switches usable live.
  apply(ctx) {
    if (!this.any) return;
    const sky = ctx.sky;
    if (sky) {
      if (this.has('sun')) {
        sky.hemi.intensity = 0;
        sky.bounce.intensity = 0;
        ctx.scene.environmentIntensity = 0;
      }
      if (this.has('amb')) {
        sky.sun.intensity = 0;
        sky.bounce.intensity = 0;
      }
    }
    if (this.has('white')) {
      if (!this._white) {
        this._white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
      }
      ctx.scene.overrideMaterial = this._white;
      if (sky) sky.dome.visible = false;
      if (ctx.sky && ctx.sky.dust) ctx.sky.dust.points && (ctx.sky.dust.points.visible = false);
    }
  }
}

// A 1:1 pass that stretches the low end of a near-white buffer into the full
// range. Used for `?view=aox`.
export const AOStretchShader = {
  uniforms: { tDiffuse: { value: null }, uLo: { value: AOX_LO } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uLo;
    varying vec2 vUv;
    void main() {
      float a = texture2D( tDiffuse, vUv ).r;
      float s = clamp( ( a - uLo ) / ( 1.0 - uLo ), 0.0, 1.0 );
      gl_FragColor = vec4( vec3( s ), 1.0 );
    }`,
};
