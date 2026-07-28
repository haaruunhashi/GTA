// Atmosphere: sky dome, sun/moon, image-based lighting, fog, time-of-day.
// Owner: atmosphere agent. Public API: init(), update(dt), setTimeOfDay(t01).
import * as THREE from 'three';
import { Sky as ThreeSky } from 'three/addons/objects/Sky.js';

export class Sky {
  constructor(ctx) {
    this.ctx = ctx;
    const { scene } = ctx;

    this.sky = new ThreeSky();
    this.sky.scale.setScalar(10000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 2.2;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(ctx.config.shadowMapSize, ctx.config.shadowMapSize);
    s.camera.near = 0.5; s.camera.far = 260;
    s.camera.left = -70; s.camera.right = 70; s.camera.top = 70; s.camera.bottom = -70;
    s.bias = -0.0006; s.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9fb8d8, 0x544a3c, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xa9b6c4, 0.0042);

    this.setTimeOfDay(0.32);
    this.buildEnv();
  }
  setTimeOfDay(t01) {
    this.tod = t01;
    const elev = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(4, 62, Math.sin(t01 * Math.PI)));
    const azim = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-140, 140, t01));
    const dir = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
    this.sky.material.uniforms.sunPosition.value.copy(dir);
    this.sunDir = dir;
    this.sun.position.copy(dir).multiplyScalar(120);
  }
  buildEnv() {
    const pmrem = new THREE.PMREMGenerator(this.ctx.renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromScene(new THREE.Scene().add(this.sky.clone()), 0.04);
    this.ctx.scene.environment = rt.texture;
    this.ctx.scene.environmentIntensity = 1.0;
    pmrem.dispose();
  }
  update(dt) {
    // keep the shadow frustum centred on the player
    const p = this.ctx.player?.position;
    if (p) {
      this.sun.position.copy(this.sunDir).multiplyScalar(120).add(p);
      this.sun.target.position.copy(p);
      this.sun.target.updateMatrixWorld();
    }
  }
}
