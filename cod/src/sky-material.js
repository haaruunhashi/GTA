// Analytic sky: Rayleigh + Mie single scattering with a sun disc, plus a
// procedural cloud layer. Driven entirely by uniforms from sky.js.
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w;   // force to the far plane
}`;

const FRAG = /* glsl */`
varying vec3 vDir;
uniform vec3 uSunDir, uSunColor, uGround, uCloudLit, uCloudDark;
uniform float uTurbidity, uRayleigh, uMieCoef, uMieG, uSkyLum, uSkyGamma, uSunDisc;
uniform float uCloudCover, uCloudSharp, uCloudScale, uCloudAmb, uTime;
uniform vec3 uZenith;
uniform float uSkyBlue;

const vec3 K_RAYLEIGH = vec3(5.8e-6, 13.5e-6, 33.1e-6) * 1.0e6;
const float PI = 3.141592653589793;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.02 + 17.0; a *= 0.5; }
  return v;
}

float rayleighPhase(float c) { return (3.0 / (16.0 * PI)) * (1.0 + c * c); }
float miePhase(float c, float g) {
  float g2 = g * g;
  return (1.0 / (4.0 * PI)) * ((1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

void main() {
  vec3 dir = normalize(vDir);
  float up = dir.y;
  float cosT = dot(dir, uSunDir);

  // optical depth along the view ray, thickening hard toward the horizon
  float zenith = acos(clamp(up, -1.0, 1.0));
  float denom = cos(zenith) + 0.15 * pow(max(0.001, 93.885 - degrees(zenith)), -1.253);
  float sR = uRayleigh / max(denom, 0.02);
  float sM = uMieCoef * uTurbidity * 12.0 / max(denom, 0.02);

  vec3 betaR = K_RAYLEIGH * sR;
  vec3 betaM = vec3(uMieCoef * uTurbidity * 6.0) * sM;
  vec3 extinct = exp(-(betaR + betaM) * 0.9);

  float sunUp = clamp(uSunDir.y * 4.0 + 0.15, 0.0, 1.0);
  vec3 scatter = (betaR * rayleighPhase(cosT) + betaM * miePhase(cosT, uMieG)) /
                 max(betaR + betaM, vec3(1e-6));
  vec3 sky = scatter * (1.0 - extinct) * uSunColor * uSkyLum * (0.25 + 0.75 * sunUp);

  // Horizon shaping. Once the optical depth gets long the term above saturates
  // to uSunColor * uSkyLum at *every* azimuth, so the whole horizon becomes one
  // uniform hot band and washes to near-white. A real low sun only burns the
  // stretch of horizon it is standing in; 90 degrees away the band is cooler
  // and a stop or two down. Attenuate with angular distance from the sun so the
  // far end of the street has a horizon dark enough to silhouette against.
  {
    float hz = 1.0 - smoothstep(0.0, 0.36, max(up, 0.0));   // 1 at horizon, 0 by ~21 deg
    float toSun = pow(max(cosT, 0.0), 1.5);
    sky *= mix(1.0, mix(0.26, 1.05, toSun), hz);
  }

  // The single-scattering term above is achromatic by construction: dividing by
  // (betaR + betaM) normalises the Rayleigh colour straight back out, and with
  // these coefficients (1 - extinct) saturates to white, so the whole dome ends
  // up the hue of uSunColor. That is what makes a golden-hour frame monochrome
  // amber. Put the Rayleigh blue back explicitly: cool overhead and away from
  // the sun, warm haze burning through toward the sun and along the horizon.
  {
    float zen  = smoothstep(-0.05, 0.50, up);          // horizon -> zenith
    float away = 1.0 - pow(max(cosT, 0.0), 2.2);       // toward sun -> away
    float w = zen * away * uSkyBlue;
    sky = mix(sky, uZenith * uSkyLum * (0.16 + 0.42 * sunUp), w);
  }

  // Sun disc: a real angular disc (~0.8 deg radius) with a soft limb and a
  // tight two-lobe glow. Small and hot, so it clips white through the
  // tonemapper instead of smearing across a sixth of the frame.
  float ang = acos(clamp(cosT, -1.0, 1.0));
  const float SUN_R = 0.0145;
  float limb = 1.0 - 0.42 * smoothstep(0.0, SUN_R, ang);
  float disc = smoothstep(SUN_R * 1.18, SUN_R * 0.70, ang) * limb;
  float glow = exp(-(ang * ang) / 0.0022) * 0.30      // tight halo, ~3 deg
             + exp(-(ang * ang) / 0.090) * 0.045;     // broad forward scatter
  sky += uSunColor * (disc * uSunDisc + glow * uSkyLum * 0.30) * (0.35 + 0.65 * sunUp);

  // ground half
  sky = mix(uGround * (0.3 + sunUp), sky, smoothstep(-0.06, 0.06, up));

  // Cloud layer, projected onto a plane above the viewer.
  //
  // Round 4 read this as "blurry haze rather than cloud form", and it was: a
  // single wide smoothstep over plain fbm gives a soft blob field, and the
  // shading was an *independent* noise, so the light and dark patches had no
  // relationship to the shape they were sitting on. Two changes fix the read:
  //   - erosion: subtract high-frequency detail weighted by (1 - base), which
  //     eats into the edges and leaves cauliflower boundaries rather than a
  //     Gaussian falloff;
  //   - directional self-shading: sample the same density field offset toward
  //     the sun. Where the sun-side sample is thinner the puff is facing the
  //     light and goes hot; where it is thicker we are in the puff's own
  //     shadow and it goes to the cool dark colour. That is what makes a cloud
  //     read as a solid object instead of a stain.
  if (up > 0.002) {
    vec2 uv = dir.xz / (up + 0.12) * (0.55 / max(uCloudScale, 0.05));
    uv += vec2(uTime * 0.0035, uTime * 0.0016);
    float base = fbm(uv * 1.25);
    float det  = fbm(uv * 5.3 + 9.0);
    // zero-mean detail scaled by (1 - base): the thin edges of a puff get
    // chewed into lobes while dense cores stay solid, and the coverage
    // statistics are left where uCloudCover expects them.
    float n = base - (1.0 - base) * (det - 0.5) * 0.75;
    // fbm here is a 5-octave sum in [0, 0.97] clustered around 0.48, so map
    // coverage onto the useful part of that range rather than 1 - cover.
    float edge = mix(0.74, 0.28, clamp(uCloudCover, 0.0, 1.0));
    float sh = max(uCloudSharp, 0.02);
    float cov = smoothstep(edge - sh, edge + sh, n);
    cov *= smoothstep(0.005, 0.14, up);               // fade into the horizon haze

    // density gradient toward the sun -> which face of the puff is lit
    vec2 sdir = normalize(uSunDir.xz + vec2(1e-5, 0.0));
    float nSun = fbm((uv + sdir * 0.16) * 1.25);
    float lit = clamp(0.5 + (base - nSun) * 3.2, 0.0, 1.0);
    lit = lit * lit * (3.0 - 2.0 * lit);
    // thick cores stay dark underneath even on the lit side
    float thin = 1.0 - smoothstep(edge + sh, edge + sh + 0.30, n);

    float rim = pow(max(cosT, 0.0), 4.0);
    vec3 cloud = mix(uCloudDark, uCloudLit, uCloudAmb * mix(0.18, 1.0, lit * (0.45 + 0.55 * thin)));
    cloud += uSunColor * (rim * 0.42 + lit * thin * 0.10) * cov;
    sky = mix(sky, cloud * uSkyLum * 0.52, cov * 0.94);
  }

  sky = pow(max(sky, vec3(0.0)), vec3(uSkyGamma));
  gl_FragColor = vec4(sky, 1.0);
}`;

export function SkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'SkyMaterial',
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0, 0.2, -1) },
      uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
      uGround: { value: new THREE.Color(0.04, 0.038, 0.036) },
      uTurbidity: { value: 4.4 },
      uRayleigh: { value: 2.7 },
      uMieCoef: { value: 0.0075 },
      uMieG: { value: 0.86 },
      uSkyLum: { value: 5.2 },
      uSkyGamma: { value: 1.32 },
      uSunDisc: { value: 40 },
      uCloudCover: { value: 0.3 },
      uCloudSharp: { value: 0.34 },
      uCloudScale: { value: 1.0 },
      uCloudLit: { value: new THREE.Color(1, 0.86, 0.7) },
      uCloudDark: { value: new THREE.Color(0.13, 0.14, 0.18) },
      uCloudAmb: { value: 0.6 },
      uZenith: { value: new THREE.Color(0.14, 0.26, 0.52) },
      uSkyBlue: { value: 0.55 },
      uTime: { value: 0 },
    },
  });
}
