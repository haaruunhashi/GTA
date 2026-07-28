// Dust motes: a shell of points that rides with the camera and only lights up
// where the sun catches them, so sunbeams get something to hang in.
import * as THREE from 'three';

const VERT = /* glsl */`
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform vec3 uSunDir;
varying float vGlint;
void main() {
  vec3 p = position;
  // slow convection drift, unique per mote
  p.x += sin( uTime * 0.22 + aPhase ) * 0.5;
  p.y += sin( uTime * 0.15 + aPhase * 1.7 ) * 0.35;
  p.z += cos( uTime * 0.19 + aPhase * 0.8 ) * 0.5;

  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * ( 26.0 / max( -mv.z, 0.4 ) );

  // motes only glint when we're looking into the sun
  vec3 viewDir = normalize( ( modelMatrix * vec4( p, 1.0 ) ).xyz - cameraPosition );
  vGlint = pow( max( dot( viewDir, uSunDir ), 0.0 ), 6.0 );
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
varying float vGlint;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep( 0.5, 0.0, length( d ) );
  float i = ( 0.10 + 0.90 * vGlint ) * uIntensity;
  gl_FragColor = vec4( uColor * i, a * i );
}`;

export class DustMotes {
  constructor(ctx, count = 900) {
    this.ctx = ctx;
    this.radius = 26;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const rng = ctx.rng || Math.random;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rng() - 0.5) * this.radius * 2;
      pos[i * 3 + 1] = rng() * 9;
      pos[i * 3 + 2] = (rng() - 0.5) * this.radius * 2;
      size[i] = 0.4 + rng() * 1.5;
      phase[i] = rng() * 100;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uColor: { value: new THREE.Color(1, 0.9, 0.75) },
        uIntensity: { value: 1 },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      toneMapped: false, fog: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    ctx.scene.add(this.points);
    this._t = 0;
  }
  setSun(dir, color, exposure) {
    this.mat.uniforms.uSunDir.value.copy(dir);
    this.mat.uniforms.uColor.value.copy(color);
    this.mat.uniforms.uIntensity.value = 0.55 * (exposure || 1);
  }
  update(dt, cam) {
    this._t += dt;
    this.mat.uniforms.uTime.value = this._t;
    // keep the cloud centred on the camera, snapped so motes don't slide with us
    const r = this.radius;
    this.points.position.set(
      Math.round(cam.position.x / r) * r,
      0,
      Math.round(cam.position.z / r) * r,
    );
  }
}
