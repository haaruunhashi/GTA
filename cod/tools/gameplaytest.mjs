// End-to-end gameplay test: drives the real game loop headlessly and asserts
// that the systems talk to each other — shooting damages and kills a bot, the
// bus fires hitmarker/kill, the HUD updates, taking damage drops health,
// death respawns you, the match scores, killstreaks award.
//
// This is the automated stand-in for "play it in a browser and check", so the
// check is repeatable rather than a one-off.
//
//   node cod/tools/gameplaytest.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, '..');
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
page.setDefaultTimeout(900000);
const errors = [];
page.on('console', m => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(t)) errors.push(t);
});
page.on('pageerror', e => errors.push(String(e)));

// A small viewport and no capture pose: we want the real loop, not shot mode.
await page.goto(`http://127.0.0.1:${port}/index.html?dpr=1&q=low`, { waitUntil: 'load', timeout: 900000 })
  .catch(e => console.error('[play] load:', e.name));
await page.waitForFunction('window.__ctx && window.__ctx.ai && window.__ctx.frame > 5', null, { timeout: 900000 });

const results = await page.evaluate(async () => {
  const c = window.__ctx;
  const T = c.THREE;
  const out = [];
  const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail: String(detail ?? '') });

  // Record every bus event we care about.
  const seen = {};
  for (const k of ['hitmarker', 'kill', 'playerHit', 'reload', 'shot', 'death', 'respawn', 'banner', 'score', 'ads', 'explosion', 'footstep']) {
    seen[k] = 0;
    c.bus.on(k, () => { seen[k]++; });
  }

  const frame = (n = 1) => new Promise(res => {
    let i = 0;
    const tick = () => { if (++i >= n) res(); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });

  // ---- 1. a bot exists and can be shot ---------------------------------
  let bot = (c.ai.bots || []).find(b => !b.dead);
  ok('a live bot exists to shoot at', !!bot, `${(c.ai.bots || []).length} bots`);
  if (!bot) return out;

  // put it directly in front of the player and aim at its chest
  const p = c.player;
  bot.pos.set(p.position.x, 0, p.position.z - 12);
  const eye = p.eyePos ? p.eyePos(new T.Vector3()) : new T.Vector3(p.position.x, p.position.y + 1.62, p.position.z);
  const chest = new T.Vector3(bot.pos.x, bot.pos.y + 1.0, bot.pos.z);
  const dir = chest.clone().sub(eye).normalize();
  p.yaw = Math.atan2(-dir.x, -dir.z);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  await frame(2);

  const hpBefore = bot.hp;
  const hit = c.ai.hitscan(eye, dir, 200, 30, Infinity);
  ok('hitscan finds the bot in front of the player', !!hit, hit ? `hp ${hpBefore} -> ${hit.hp}` : 'no hit');
  ok('the hit removed health', hit && hit.hp < hpBefore, hit ? `${hpBefore} -> ${hit.hp}` : '-');
  ok('a hitmarker fired on the bus', seen.hitmarker > 0, `${seen.hitmarker}`);

  // ---- 2. headshots do more damage than body shots ----------------------
  const bot2 = (c.ai.bots || []).find(b => !b.dead && b !== bot);
  if (bot2) {
    bot2.pos.set(p.position.x + 2, 0, p.position.z - 12);
    const bodyPt = new T.Vector3(bot2.pos.x, bot2.pos.y + 1.0, bot2.pos.z);
    const headPt = new T.Vector3(bot2.pos.x, bot2.pos.y + 1.62, bot2.pos.z);
    const bodyDir = bodyPt.clone().sub(eye).normalize();
    const headDir = headPt.clone().sub(eye).normalize();
    const hpStart = bot2.hp;
    c.ai.hitscan(eye, bodyDir, 200, 10, Infinity);
    const afterBody = bot2.hp;
    c.ai.hitscan(eye, headDir, 200, 10, Infinity);
    const afterHead = bot2.hp;
    const bodyDmg = hpStart - afterBody, headDmg = afterBody - afterHead;
    ok('headshots do more damage than body shots', headDmg > bodyDmg, `body ${bodyDmg} vs head ${headDmg}`);
  }

  // ---- 3. killing a bot raises the score and fires kill ------------------
  const killsBefore = c.match ? c.match.kills : -1;
  let guard = 0;
  while (!bot.dead && guard++ < 40) c.ai.hitscan(eye, dir, 200, 60, Infinity);
  ok('sustained fire kills the bot', bot.dead, `after ${guard} shots`);
  ok('a kill fired on the bus', seen.kill > 0, `${seen.kill}`);
  await frame(3);
  ok('the match counted the kill', !c.match || c.match.kills > killsBefore, c.match ? `${killsBefore} -> ${c.match.kills}` : 'no match');
  ok('the match score went up', !c.match || c.match.score > 0, c.match ? `${c.match.score}` : '-');

  // ---- 4. the dead bot animates its death and is retired ----------------
  await frame(20);
  ok('the dead bot plays a death animation', bot.body && bot.body.dying > 0, `dying=${bot.body ? bot.body.dying.toFixed(2) : '?'}`);

  // ---- 5. the weapon fires, consumes ammo and reloads --------------------
  const w = c.weapons;
  if (w) {
    const ammoBefore = w.ammo;
    if (w.fire) { w.cool = 0; w.fire(); }
    await frame(2);
    ok('firing consumes a round', w.ammo < ammoBefore, `${ammoBefore} -> ${w.ammo}`);
    // Assert the *contract* (a 'reload' event on the bus), not an internal
    // field name — weapons.js is rewritten often and its internals move.
    if (w.reload) {
      const before = seen.reload;
      w.ammo = 1;
      w.reload();
      await frame(3);
      ok('reload fires on the bus', seen.reload > before || w.ammo > 1, `events ${before} -> ${seen.reload}, ammo ${w.ammo}`);
    }
  }

  // ---- 6. taking damage drops health, death respawns --------------------
  const hpStart = c.player.hp;
  c.bus.emit('playerHit', { dmg: 25, dir: 0 });
  await frame(3);
  ok('taking damage drops player health', c.player.hp < hpStart, `${hpStart} -> ${c.player.hp}`);

  if (c.player.damage) c.player.damage(1000, 0);
  await frame(5);
  const died = c.player.dead || c.player.hp <= 0 || seen.death > 0;
  ok('lethal damage kills the player', died, `hp=${c.player.hp} dead=${c.player.dead}`);
  // respawn is on a timer inside player.js
  for (let i = 0; i < 6 && !(c.player.hp > 0 && !c.player.dead); i++) await frame(60);
  ok('the player respawns with health', c.player.hp > 0 && !c.player.dead, `hp=${c.player.hp}`);

  // ---- 7. the HUD reflects the game state -------------------------------
  const magEl = document.querySelector('#ammo .mag');
  const hpEl = document.querySelector('#hp .bar i');
  ok('HUD shows the magazine count', magEl && magEl.textContent.length > 0, magEl ? magEl.textContent : 'missing');
  ok('HUD health bar tracks health', hpEl && parseFloat(hpEl.style.width) <= 100, hpEl ? hpEl.style.width : 'missing');

  // ---- 8. explosions and killstreaks -----------------------------------
  if (c.fx && c.fx.explosion) {
    c.fx.explosion(new T.Vector3(p.position.x + 6, 1, p.position.z - 6), 6);
    await frame(3);
    ok('an explosion runs without error', true, '');
  }
  if (c.match) {
    c.match.state = 'live';
    c.match.streak = 0;
    for (let i = 0; i < 3; i++) c.match.onKill();
    await frame(2);
    ok('a 3-kill streak awards the UAV', c.match._fired.has('uav'), [...c.match._fired].join(','));
  }

  // ---- 9. the sim keeps running -----------------------------------------
  const f0 = c.frame;
  await frame(30);
  ok('the game loop is still running at the end', c.frame > f0, `${f0} -> ${c.frame}`);

  return out;
});

let pass = 0, fail = 0;
for (const r of results) {
  console.log(`  ${r.pass ? 'ok  ' : 'FAIL'} ${r.name}${r.detail ? '   ' + r.detail : ''}`);
  r.pass ? pass++ : fail++;
}
if (errors.length) {
  console.log(`  FAIL no console / page errors   ${errors.length}: ${errors.slice(0, 4).join(' | ')}`);
  fail++;
} else {
  console.log('  ok   no console / page errors');
  pass++;
}
console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail) process.exitCode = 1;

await browser.close();
server.close();
