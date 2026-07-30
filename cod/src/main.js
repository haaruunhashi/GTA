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
import { Match } from './match.js';

// Capture poses that belong to the coordinator rather than the map: `bots`
// places soldiers at fixed spots so a frame is guaranteed to contain the AI.
const POSES_EXTRA = {
  squad: {
    pos: [0, 1.7, 20], look: [0, 1.5, -12],
    bots: [[-3.4, 0, 4], [2.6, 0, -1], [-1.2, 0, -7], [4.6, 0, -11]],
  },
};

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
  ctx.match = new Match(ctx, CONFIG.mode);
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
  shotPose = POSES_EXTRA[name] || POSES[name] || POSES.street;
  ctx.input.enabled = false;
  ctx.player.position.set(shotPose.pos[0], Math.max(0, shotPose.pos[1] - 1.62), shotPose.pos[2]);
  const look = new THREE.Vector3(...shotPose.look).sub(new THREE.Vector3(...shotPose.pos));
  ctx.player.yaw = Math.atan2(-look.x, -look.z);
  ctx.player.pitch = Math.asin(THREE.MathUtils.clamp(look.clone().normalize().y, -1, 1));
  ctx.player.ads = !!shotPose.ads;
  // park soldiers in frame, facing the camera, so the AI is actually reviewable
  if (shotPose.bots && ctx.ai && ctx.ai.bots) {
    shotPose.bots.forEach((at, i) => {
      const bot = ctx.ai.bots[i];
      if (!bot) return;
      bot.pos.set(at[0], at[1], at[2]);
      bot.yaw = Math.atan2(-(ctx.player.position.x - at[0]), -(ctx.player.position.z - at[2]));
      bot.state = 'engage';
      bot.sawT = 5;
      bot.vel.set(0, 0, 0);
    });
  }
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
  // Capture mode leaves the match rules out of the loop so reinforcement waves
  // and killstreaks can't make a review frame non-deterministic.
  if (!CONFIG.shot) ctx.match.update(dt);
  ctx.ai.update(dt);
  ctx.physics.update(dt);
  ctx.fx.update(dt);
  ctx.sky.update(dt);
  ctx.ui.update(dt);
  ctx.audio.update(dt);
  ctx.input.endFrame();
}

init();
