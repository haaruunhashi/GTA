// CLAUDE OF DUTY — bootstrap and frame loop.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeContext, Input } from './engine.js';
import { Render } from './render.js';
import { Materials } from './materials.js';
import { Sky } from './sky.js';
import { World, POSES } from './world.js';
import { Physics } from './physics.js';
import { Player } from './player.js';
import { Weapons } from './weapons.js';
import { FX } from './fx.js';
import { AI } from './ai.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';

const ctx = makeContext(CONFIG);
window.__ctx = ctx;

function boot(pct, label) {
  const b = document.getElementById('boot');
  if (!b) return;
  b.querySelector('.b i').style.width = pct + '%';
  if (label) b.querySelector('.s').textContent = label;
  if (pct >= 100) b.remove();
}

async function init() {
  boot(8, 'RENDERER');
  ctx.render = new Render(ctx);
  ctx.materials = new Materials(ctx);
  boot(24, 'ATMOSPHERE');
  ctx.sky = new Sky(ctx);
  boot(42, 'WORLD');
  ctx.world = new World(ctx).build();
  ctx.physics = new Physics(ctx);
  boot(62, 'PLAYER');
  ctx.player = new Player(ctx);
  ctx.scene.add(ctx.camera);
  ctx.weapons = new Weapons(ctx);
  ctx.fx = new FX(ctx);
  boot(78, 'AI');
  ctx.ai = new AI(ctx);
  ctx.ai.spawnWave(8);
  ctx.ui = new UI(ctx);
  ctx.audio = new Audio(ctx);
  ctx.input = new Input(ctx.renderer.domElement);
  boot(92, 'COMPILING SHADERS');
  ctx.renderer.compile(ctx.scene, ctx.camera);
  boot(100);

  if (CONFIG.shot) setupShot(CONFIG.shot);
  requestAnimationFrame(loop);
}

// ---- deterministic capture mode for the visual-review harness ----
let shotPose = null;
function setupShot(name) {
  shotPose = POSES[name] || POSES.street;
  ctx.input.enabled = false;
  ctx.player.position.set(shotPose.pos[0], Math.max(0, shotPose.pos[1] - 1.62), shotPose.pos[2]);
  const look = new THREE.Vector3(...shotPose.look).sub(new THREE.Vector3(...shotPose.pos));
  ctx.player.yaw = Math.atan2(-look.x, -look.z);
  ctx.player.pitch = Math.asin(THREE.MathUtils.clamp(look.clone().normalize().y, -1, 1));
  ctx.player.ads = !!shotPose.ads;
}

let last = performance.now();
let warmed = 0;
function loop(now) {
  requestAnimationFrame(loop);
  // Capture mode steps on a fixed clock so a slow software rasteriser still
  // produces the exact same frame as a fast GPU.
  let dt = CONFIG.shot ? 1 / 60 : Math.min((now - last) / 1000, 0.05);
  last = now;
  step(dt);
  ctx.render.render(dt);
  if (CONFIG.shot) {
    warmed++;
    if (warmed >= CONFIG.shotFrames) window.__ready = true;
  } else window.__ready = true;
}

function step(dt) {
  ctx.dt = dt; ctx.time += dt; ctx.frame++;
  ctx.input.beginFrame();
  ctx.player.update(dt);
  if (shotPose) { ctx.player.ads = !!shotPose.ads; }
  ctx.weapons.update(dt);
  ctx.ai.update(dt);
  ctx.physics.update(dt);
  ctx.fx.update(dt);
  ctx.sky.update(dt);
  ctx.ui.update(dt);
  ctx.audio.update(dt);
  ctx.input.endFrame();
}

init();
