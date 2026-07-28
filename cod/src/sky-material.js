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

  // sun disc + glow
  float disc = smoothstep(0.9995 - 0.0006 * (60.0 / max(uSunDisc, 1.0)), 1.0, cosT);
  float glow = pow(max(cosT, 0.0), 220.0) * 0.6 + pow(max(cosT, 0.0), 8.0) * 0.06;
  sky += uSunColor * (disc * uSunDisc + glow) * (0.35 + 0.65 * sunUp);

  // ground half
  sky = mix(uGround * (0.3 + sunUp), sky, smoothstep(-0.06, 0.06, up));

  // cloud layer, projected onto a plane above the viewer
  if (up > 0.002) {
    vec2 uv = dir.xz / (up + 0.12) * (0.55 / max(uCloudScale, 0.05));
    uv += vec2(uTime * 0.0035, uTime * 0.0016);
    float n = fbm(uv * 1.6) * 0.62 + fbm(uv * 4.7 + 9.0) * 0.38;
    float cov = smoothstep(1.0 - uCloudCover - uCloudSharp, 1.0 - uCloudCover + uCloudSharp, n);
    cov *= smoothstep(0.0, 0.16, up);                 // fade into the horizon haze
    float shade = smoothstep(0.25, 0.95, fbm(uv * 3.1 + 31.0));
    float rim = pow(max(cosT, 0.0), 4.0);
    vec3 cloud = mix(uCloudDark, uCloudLit, shade * uCloudAmb + rim * 0.5);
    cloud += uSunColor * rim * 0.35 * cov;
    sky = mix(sky, cloud * uSkyLum * 0.42, cov * 0.92);
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
      uTime: { value: 0 },
    },
  });
}
