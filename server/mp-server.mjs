/* Blank City — multiplayer server.
 *
 * A small authoritative-relay game server: clients send their own state at a fixed
 * rate, the server validates/rate-limits it and broadcasts room snapshots. Shared
 * world events (shots, kills, sector capture) are relayed too.
 *
 * Run:   node server/mp-server.mjs
 * Env:   PORT (default 8787)   ROOM_MAX (default 16)   TICK_HZ (default 15)
 *
 * It also serves the static game over the same port, so one process is enough:
 *   http://localhost:8787/birmingham.html
 */
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, normalize } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { WebSocketServer } from 'ws';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8787);
const ROOM_MAX = Number(process.env.ROOM_MAX || 16);
const TICK_HZ = Number(process.env.TICK_HZ || 15);
const MAX_MSG_BYTES = 4096;          // reject anything bigger — cheap abuse guard
const CLIENT_MSG_PER_SEC = 40;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.css': 'text/css', '.map': 'application/json'
};

// ---------- static file server ----------
const http = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const safe = normalize(url).replace(/^(\.\.[/\\])+/, '');
  const path = join(ROOT, safe === '/' ? 'index.html' : safe);
  if (!path.startsWith(ROOT) || !existsSync(path) || statSync(path).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
});

// ---------- rooms ----------
/** @type {Map<string, Map<number, object>>} roomId -> (playerId -> player) */
const rooms = new Map();
let nextId = 1;

const room = id => {
  if (!rooms.has(id)) rooms.set(id, new Map());
  return rooms.get(id);
};
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, max = 24) => (typeof v === 'string' ? v.slice(0, max).replace(/[<>&]/g, '') : '');

const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG_BYTES });

wss.on('connection', (ws, req) => {
  const id = nextId++;
  const ip = req.socket.remoteAddress;
  let joined = null;                 // room id once the client sends "join"
  let msgWindow = Date.now(), msgCount = 0;

  const self = {
    id, name: 'player' + id, room: null,
    x: 0, y: 0, z: 0, yaw: 0, veh: null, spd: 0, hp: 100, t: Date.now()
  };

  const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

  ws.on('message', (raw) => {
    // rate limit
    const now = Date.now();
    if (now - msgWindow > 1000) { msgWindow = now; msgCount = 0; }
    if (++msgCount > CLIENT_MSG_PER_SEC) return;
    if (raw.length > MAX_MSG_BYTES) return;

    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      const rid = str(m.room || 'birmingham', 32) || 'birmingham';
      const r = room(rid);
      if (r.size >= ROOM_MAX) { send({ t: 'full', max: ROOM_MAX }); ws.close(); return; }
      self.name = str(m.name) || self.name;
      self.room = rid; joined = rid;
      r.set(id, self);
      send({ t: 'welcome', id, room: rid, tickHz: TICK_HZ,
             players: [...r.values()].filter(p => p.id !== id).map(pub) });
      broadcast(rid, { t: 'joined', p: pub(self) }, id);
      console.log(`[+] ${self.name} (#${id}) -> ${rid}  (${r.size}/${ROOM_MAX})  ${ip}`);
      return;
    }
    if (!joined) return;             // must join before anything else

    if (m.t === 'state') {
      self.x = num(m.x); self.y = num(m.y); self.z = num(m.z);
      self.yaw = num(m.yaw); self.spd = num(m.spd);
      self.hp = Math.max(0, Math.min(100, num(m.hp, 100)));
      self.veh = m.veh === null || m.veh === undefined ? null : str(m.veh, 12);
      self.t = now;
    } else if (m.t === 'ev') {
      // world events other clients should see: shot, boom, kill, capture...
      const kind = str(m.k, 16);
      if (!kind) return;
      broadcast(joined, { t: 'ev', from: id, k: kind,
        x: num(m.x), y: num(m.y), z: num(m.z), a: num(m.a), n: str(m.n, 24) }, id);
    } else if (m.t === 'chat') {
      const text = str(m.m, 160);
      if (text) broadcast(joined, { t: 'chat', from: id, name: self.name, m: text });
    } else if (m.t === 'ping') {
      send({ t: 'pong', c: num(m.c) });
    }
  });

  ws.on('close', () => {
    if (joined) {
      const r = rooms.get(joined);
      if (r) { r.delete(id); if (!r.size) rooms.delete(joined); }
      broadcast(joined, { t: 'left', id });
      console.log(`[-] ${self.name} (#${id}) left ${joined}`);
    }
  });
  ws.on('error', () => {});
  ws.__id = id;
});

function pub(p) {
  return { id: p.id, name: p.name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
           yaw: +p.yaw.toFixed(3), spd: +p.spd.toFixed(1), veh: p.veh, hp: p.hp };
}
function broadcast(rid, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    const pid = client.__id;
    const r = rooms.get(rid);
    if (!r || !r.has(pid)) continue;
    if (exceptId && pid === exceptId) continue;
    client.send(data);
  }
}

// ---------- snapshot tick ----------
setInterval(() => {
  const stale = Date.now() - 15000;
  for (const [rid, r] of rooms) {
    for (const [pid, p] of r) if (p.t < stale) r.delete(pid);   // drop zombies
    if (!r.size) { rooms.delete(rid); continue; }
    const snap = JSON.stringify({ t: 'snap', players: [...r.values()].map(pub) });
    for (const client of wss.clients) {
      if (client.readyState === 1 && r.has(client.__id)) client.send(snap);
    }
  }
}, 1000 / TICK_HZ);

http.listen(PORT, () => {
  console.log(`Blank City multiplayer on http://localhost:${PORT}`);
  console.log(`  game:  http://localhost:${PORT}/birmingham.html`);
  console.log(`  ws:    ws://localhost:${PORT}   rooms max ${ROOM_MAX}, tick ${TICK_HZ}Hz`);
});
