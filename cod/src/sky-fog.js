// Atmospheric fog: exponential *height* fog with analytic integration along the
// view ray, plus directional in-scatter so the air glows around the sun.
// Replaces three's built-in fog chunks with generated GLSL — the parameters are
// baked in as literals and every material is recompiled when they change, which
// costs one hitch per time-of-day change and nothing per frame.
import * as THREE from 'three';

let installed = false;
let lastKey = '';

const f = (n) => {
  const v = Number.isFinite(n) ? n : 0;
  return Math.abs(v) < 1e-6 ? '0.0' : (v.toFixed(6).includes('.') ? v.toFixed(6) : v.toFixed(1));
};

export function installAtmosphericFog(ctx, fog, sunDir, sunColor) {
  const key = JSON.stringify([fog, sunDir.toArray().map(v => +v.toFixed(3)), sunColor]);
  if (key === lastKey) return;
  lastKey = key;

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;

  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  #ifdef USE_INSTANCING
    vFogWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
  #else
    vFogWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  #endif
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;

  const vec3  FOG_COLOR   = vec3(${f(fog.color[0])}, ${f(fog.color[1])}, ${f(fog.color[2])});
  const vec3  FOG_SUN     = vec3(${f(fog.sunColor[0])}, ${f(fog.sunColor[1])}, ${f(fog.sunColor[2])});
  const vec3  FOG_SUNDIR  = vec3(${f(sunDir.x)}, ${f(sunDir.y)}, ${f(sunDir.z)});
  const float FOG_DENSITY = ${f(fog.density)};
  const float FOG_FALLOFF = ${f(fog.falloff)};
  const float FOG_BASE    = ${f(fog.base)};
  const float FOG_MINT    = ${f(fog.minT)};
  const float FOG_ANISO   = ${f(fog.aniso)};

  // Integral of density * exp(-(y - base)/falloff) along the ray, exact.
  float fogOpticalDepth( vec3 camPos, vec3 dir, float dist ) {
    float h = ( camPos.y - FOG_BASE ) / FOG_FALLOFF;
    float dy = dir.y / FOG_FALLOFF;
    float baseD = FOG_DENSITY * exp( -h );
    if ( abs( dy ) < 1e-4 ) return baseD * dist;
    return baseD * ( 1.0 - exp( -dy * dist ) ) / dy;
  }
#endif`;

  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  {
    vec3 toFrag = vFogWorld - cameraPosition;
    float dist = max( length( toFrag ), 1e-4 );
    vec3 dir = toFrag / dist;

    float od = max( fogOpticalDepth( cameraPosition, dir, dist ), 0.0 );
    float trans = clamp( exp( -od ), FOG_MINT, 1.0 );

    // Henyey-Greenstein in-scatter toward the sun
    float c = dot( dir, FOG_SUNDIR );
    float g = FOG_ANISO;
    float g2 = g * g;
    float hg = ( 1.0 - g2 ) / ( 4.0 * 3.14159265 * pow( 1.0 + g2 - 2.0 * g * c, 1.5 ) );
    vec3 inscatter = FOG_COLOR + FOG_SUN * hg * 2.6;

    gl_FragColor.rgb = mix( inscatter, gl_FragColor.rgb, trans );
  }
#endif`;

  // Force every already-compiled material to pick up the new chunks.
  if (installed && ctx.scene) {
    ctx.scene.traverse(o => {
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) m.forEach(x => (x.needsUpdate = true));
      else m.needsUpdate = true;
    });
  }
  installed = true;
}
