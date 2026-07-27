/* Multiplayer client: sends your state, interpolates everyone else.
   Remote players are drawn as cars (when driving) or mannequins (on foot). */
import * as THREE from 'three';

const LERP_MS = 120;   // render remote players this far in the past, so motion is smooth

export class Net {
  /**
   * @param {object} o
   * @param {string} [o.url]   ws:// or wss:// endpoint; defaults to this page's host
   * @param {string} [o.room]
   * @param {string} [o.name]
   * @param {(id:number, p:object)=>THREE.Object3D} o.makeAvatar  builds a mesh for a remote player
   * @param {(e:object)=>void} [o.onEvent]  world events from other players
   */
  constructor(o) {
    this.url = o.url || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    this.room = o.room || 'birmingham';
    this.name = (o.name || 'player').slice(0, 24);
    this.makeAvatar = o.makeAvatar;
    this.onEvent = o.onEvent || (() => {});
    this.scene = o.scene;
    this.id = null;
    this.connected = false;
    this.players = new Map();     // id -> { mesh, buf:[{t,x,y,z,yaw,spd,veh}] , info }
    this.lastSend = 0;
    this.sendHz = 15;
    this.status = 'connecting';
    this._connect();
  }

  _connect() {
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this.status = 'failed'; return; }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true; this.status = 'online';
      ws.send(JSON.stringify({ t: 'join', room: this.room, name: this.name }));
    };
    ws.onclose = () => {
      this.connected = false; this.status = 'offline';
      for (const [id] of this.players) this._removePlayer(id);
      clearTimeout(this._retry);
      this._retry = setTimeout(() => this._connect(), 2500);   // auto-reconnect
    };
    ws.onerror = () => { this.status = 'error'; };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'welcome') {
        this.id = m.id;
        for (const p of m.players) this._upsert(p);
      } else if (m.t === 'snap') {
        for (const p of m.players) { if (p.id !== this.id) this._upsert(p); }
        const seen = new Set(m.players.map(p => p.id));
        for (const [id] of this.players) if (!seen.has(id)) this._removePlayer(id);
      } else if (m.t === 'joined') {
        this._upsert(m.p);
      } else if (m.t === 'left') {
        this._removePlayer(m.id);
      } else if (m.t === 'ev') {
        this.onEvent(m);
      } else if (m.t === 'full') {
        this.status = 'room full';
      }
    };
  }

  _upsert(p) {
    let rec = this.players.get(p.id);
    if (!rec) {
      const mesh = this.makeAvatar(p.id, p);
      if (mesh) this.scene.add(mesh);
      rec = { mesh, buf: [], info: p, veh: p.veh };
      this.players.set(p.id, rec);
    }
    rec.info = p;
    // remote vehicle change -> rebuild the avatar
    if (rec.veh !== p.veh) {
      if (rec.mesh) this.scene.remove(rec.mesh);
      rec.mesh = this.makeAvatar(p.id, p);
      if (rec.mesh) this.scene.add(rec.mesh);
      rec.veh = p.veh;
    }
    rec.buf.push({ t: performance.now(), x: p.x, y: p.y, z: p.z, yaw: p.yaw, spd: p.spd });
    if (rec.buf.length > 20) rec.buf.shift();
  }

  _removePlayer(id) {
    const rec = this.players.get(id);
    if (rec && rec.mesh) this.scene.remove(rec.mesh);
    this.players.delete(id);
  }

  /** Send your state (rate-limited) and interpolate everyone else. */
  update(local, dt) {
    const now = performance.now();
    if (this.connected && now - this.lastSend > 1000 / this.sendHz) {
      this.lastSend = now;
      this.ws.send(JSON.stringify({
        t: 'state', x: local.x, y: local.y, z: local.z,
        yaw: local.yaw, spd: local.spd || 0, hp: local.hp === undefined ? 100 : local.hp,
        veh: local.veh || null
      }));
    }
    const renderAt = now - LERP_MS;
    for (const [, rec] of this.players) {
      const b = rec.buf;
      if (!rec.mesh || b.length === 0) continue;
      let a = b[0], c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) {
        if (b[i].t <= renderAt && b[i + 1].t >= renderAt) { a = b[i]; c = b[i + 1]; break; }
      }
      const span = Math.max(1, c.t - a.t);
      const k = Math.max(0, Math.min(1, (renderAt - a.t) / span));
      rec.mesh.position.set(a.x + (c.x - a.x) * k, a.y + (c.y - a.y) * k, a.z + (c.z - a.z) * k);
      // shortest-arc yaw
      let d = c.yaw - a.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      rec.mesh.rotation.y = -(a.yaw + d * k);
      // spin remote wheels from reported speed
      const ws = rec.mesh.userData && rec.mesh.userData.wheels;
      if (ws && ws.length) {
        const spin = (a.spd + (c.spd - a.spd) * k) * dt / (rec.mesh.userData.wheelR || 0.42);
        for (const w of ws) w.spinG.rotation.z -= spin;
      }
    }
  }

  /** Tell the room something happened (shot, explosion, kill...). */
  event(k, x, y, z, a, n) {
    if (this.connected) this.ws.send(JSON.stringify({ t: 'ev', k, x, y, z, a, n }));
  }
  chat(m) { if (this.connected) this.ws.send(JSON.stringify({ t: 'chat', m })); }
  get count() { return this.players.size + (this.id ? 1 : 0); }
}
