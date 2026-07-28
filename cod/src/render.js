// Rendering pipeline: WebGL2 renderer, HDR lighting setup, shadows, post stack.
// Owner: render agent. Public API: init(ctx), resize(), render(dt), setQuality(q).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export class Render {
  constructor(ctx) {
    this.ctx = ctx;
    const renderer = new THREE.WebGLRenderer({
      antialias: false, powerPreference: 'high-performance', stencil: false,
      preserveDrawingBuffer: true, // needed for deterministic screenshot capture
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, ctx.config.pixelRatioCap));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(renderer.domElement);
    this.renderer = renderer;
    ctx.renderer = renderer;
    ctx.canvas = renderer.domElement;

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.addPass(new RenderPass(ctx.scene, ctx.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.7, 0.85);
    composer.addPass(this.bloom);
    composer.addPass(new SMAAPass(innerWidth, innerHeight));
    composer.addPass(new OutputPass());
    this.composer = composer;

    addEventListener('resize', () => this.resize());
  }
  resize() {
    const { camera } = this.ctx;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
  }
  render(dt) {
    this.composer.render(dt);
  }
}
