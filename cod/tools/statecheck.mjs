// Fast structural check of the running game — no waiting for 40 warm-up frames.
// Loads the bundle, steps a handful of frames, then reports what actually exists
// in the scene: AI bodies, draw calls, triangle counts, subsystem presence and
// any console errors. Use this to verify wiring; use shot.mjs to judge looks.
//
//   node cod/tools/statecheck.mjs [pose]
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, '..');
const pose = process.argv[2] || 'squad';

execFileSync(process.execPath, [path.join(rootDir, 'build.mjs')], { stdio: 'inherit' });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(rootDir, url === '/' ? 'index.html' : url);
  if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(t)) errors.push(t);
});
page.on('pageerror', e => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/index.html?shot=${pose}&frames=6&dpr=1&debug=1`,
  { waitUntil: 'load', timeout: 600000 }).catch(e => console.error('[state] load:', e.name));
await page.waitForFunction('window.__ctx && window.__ctx.ai && window.__ctx.frame > 3', null, { timeout: 600000 })
  .catch(e => console.error('[state] never stepped:', e.name));

const report = await page.evaluate(() => {
  const c = window.__ctx;
  const out = { frame: c.frame, subsystems: {}, ai: {}, render: {}, match: {} };
  for (const k of ['render', 'materials', 'sky', 'world', 'physics', 'player', 'weapons', 'fx', 'ai', 'ui', 'audio', 'match']) {
    out.subsystems[k] = !!c[k];
  }
  const bots = (c.ai && c.ai.bots) || [];
  out.ai.count = bots.length;
  out.ai.bodies = bots.map(b => {
    let meshes = 0;
    if (b.obj) b.obj.traverse(o => { if (o.isMesh) meshes++; });
    return {
      pos: b.pos ? [+b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2)] : null,
      meshes, dead: !!b.dead, state: b.state,
      inScene: !!(b.obj && b.obj.parent),
      visible: !!(b.obj && b.obj.visible),
    };
  }).slice(0, 6);
  // Where does each bot land on screen, and is something in the way? This is
  // how you tell "my pose was wrong" from "a prop is occluding them".
  const T = c.THREE;
  const cam = c.camera;
  cam.updateMatrixWorld();
  const eye = cam.getWorldPosition(new T.Vector3());
  out.ai.onScreen = bots.slice(0, 6).map(b => {
    const chest = new T.Vector3(b.pos.x, b.pos.y + 1.1, b.pos.z);
    const ndc = chest.clone().project(cam);
    const to = chest.clone().sub(eye);
    const dist = to.length();
    let blockedBy = null;
    if (c.physics && c.physics.rayBoxes) {
      const hit = c.physics.rayBoxes(eye, to.clone().normalize(), dist);
      if (hit && hit.distance < dist - 0.4) blockedBy = +hit.distance.toFixed(2);
    }
    return {
      px: Math.round((ndc.x * 0.5 + 0.5) * 1600),
      py: Math.round((-ndc.y * 0.5 + 0.5) * 900),
      inFrustum: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z > -1 && ndc.z < 1,
      dist: +dist.toFixed(1),
      occludedAt: blockedBy,
    };
  });

  const info = c.renderer && c.renderer.info;
  if (info) {
    out.render.calls = info.render.calls;
    out.render.triangles = info.render.triangles;
    out.render.programs = info.programs ? info.programs.length : -1;
    out.render.textures = info.memory.textures;
    out.render.geometries = info.memory.geometries;
  }
  out.world = { colliders: (c.world && c.world.colliders || []).length,
    navPoints: (c.world && c.world.navPoints || []).length,
    spawnPoints: (c.world && c.world.spawnPoints || []).length };
  if (c.match) out.match = { state: c.match.state, score: c.match.score, mode: c.match.mode && c.match.mode.name };
  out.player = c.player ? { pos: [+c.player.position.x.toFixed(2), +c.player.position.y.toFixed(2), +c.player.position.z.toFixed(2)], hp: c.player.hp, state: c.player.state } : null;
  return out;
});

console.log(JSON.stringify(report, null, 2));
if (errors.length) {
  console.error(`\n[state] ${errors.length} CONSOLE ERROR(S):`);
  for (const e of errors.slice(0, 8)) console.error('  ' + e);
  process.exitCode = 1;
}

await browser.close();
server.close();
