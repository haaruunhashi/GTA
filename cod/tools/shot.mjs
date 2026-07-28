// Visual-review harness: builds, serves and screenshots the game at named poses.
//   node cod/tools/shot.mjs                 -> all poses to cod/shots/
//   node cod/tools/shot.mjs street alley    -> just those poses
//   node cod/tools/shot.mjs --out review1   -> write into cod/shots/review1/
// Also fails loudly on any page/console error, so agents can't ship a black screen.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(here, '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = path.join(rootDir, 'shots', outIdx >= 0 ? args[outIdx + 1] : '');
if (outIdx >= 0) args.splice(outIdx, 2);
const poses = args.length ? args : ['street', 'alley', 'rooftop', 'gunsight'];

execFileSync(process.execPath, [path.join(rootDir, 'build.mjs')], { stdio: 'inherit' });
fs.mkdirSync(outDir, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.glb': 'model/gltf-binary', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(rootDir, url === '/' ? 'index.html' : url);
  if (!file.startsWith(rootDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

// The pre-installed Chromium may not match this playwright build's expected revision.
const preinstalled = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find(p => fs.existsSync(p));
const browser = await chromium.launch({
  executablePath: preinstalled,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
const ignorable = t => /favicon/i.test(t) || /Failed to load resource/i.test(t);
page.on('console', m => { if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));

for (const pose of poses) {
  errors.length = 0;
  await page.goto(`http://127.0.0.1:${port}/index.html?shot=${pose}&frames=60&dpr=1`, { waitUntil: 'load' });
  try {
    await page.waitForFunction('window.__ready === true', null, { timeout: 240000 });
  } catch (e) {
    console.error(`[shot] ${pose}: TIMED OUT waiting for render.`);
  }
  await page.waitForTimeout(1200);
  const file = path.join(outDir, pose + '.png');
  await page.screenshot({ path: file });
  const bytes = fs.statSync(file).size;
  console.log(`[shot] ${pose} -> ${path.relative(process.cwd(), file)} (${(bytes / 1024).toFixed(0)} KB)` +
    (errors.length ? `\n  ERRORS: ${errors.slice(0, 5).join(' | ')}` : ''));
  if (errors.length) process.exitCode = 1;
}

await browser.close();
server.close();
