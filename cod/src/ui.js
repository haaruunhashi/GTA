// HUD: crosshair, ammo, health, hit feedback, killfeed, compass, scoreboard.
// Owner: ui agent. Driven entirely by ctx.bus events + a defensive read of
// ctx.player / ctx.weapons each frame (those modules are rebuilt often, so every
// field access here is optional — the HUD must never take the game down).
//
// Bus events consumed:
//   hitmarker {head}  kill {head, name}  playerHit {dmg, dir}  ads {on}
//   reload {}  shot {}  death {}  respawn {}  score {n, reason}  banner {text, sub}

const CSS = `
.hud { position:absolute; }
#xh { left:50%; top:50%; transform:translate(-50%,-50%); width:44px; height:44px; transition:opacity .09s; }
#xh i { position:absolute; left:50%; top:50%; width:2px; height:8px; margin:-4px 0 0 -1px;
  background:#e8f0f8; box-shadow:0 0 3px #000c, 0 0 1px #000; border-radius:1px; }
#xh b { position:absolute; left:50%; top:50%; width:2px; height:2px; margin:-1px 0 0 -1px;
  background:#e8f0f8; box-shadow:0 0 3px #000c; border-radius:50%; opacity:.9; }
#hm { left:50%; top:50%; transform:translate(-50%,-50%) scale(1); opacity:0;
  width:26px; height:26px; }
#hm i { position:absolute; left:50%; top:50%; width:2px; height:9px; margin:-4.5px 0 0 -1px;
  background:#fff; box-shadow:0 0 4px #000; }

#ammo { right:52px; bottom:44px; text-align:right; text-shadow:0 2px 10px #000b; }
#ammo .wn { font-size:12px; letter-spacing:.28em; color:#c9a24d; margin-bottom:2px; }
#ammo .mag { font-size:46px; font-weight:700; line-height:.95; letter-spacing:.02em; }
#ammo .res { font-size:17px; color:#93a3b3; margin-left:2px; }
#ammo .mode { font-size:11px; letter-spacing:.22em; color:#7d8b99; margin-top:4px; }
#ammo.low .mag { color:#ff6a55; }
#ammo .rl { font-size:12px; letter-spacing:.24em; color:#ffcf6a; height:14px; opacity:0; transition:opacity .12s; }

#hp { left:52px; bottom:46px; width:230px; text-shadow:0 2px 10px #000b; }
#hp .l { font-size:11px; letter-spacing:.26em; color:#8b99a7; margin-bottom:5px; }
#hp .bar { height:4px; background:#0e151d; box-shadow:inset 0 0 0 1px #ffffff14; }
#hp .bar i { display:block; height:100%; width:100%; background:#dbe6f0; transition:width .18s; }
#hp.hurt .bar i { background:#ff5a45; }

#feed { right:34px; top:26px; text-align:right; font-size:13.5px; line-height:1.75;
  letter-spacing:.04em; text-shadow:0 2px 8px #000c; }
#feed div { animation:fadein .18s ease-out; }
@keyframes fadein { from { opacity:0; transform:translateX(12px);} to { opacity:1; transform:none; } }

#compass { left:50%; top:22px; transform:translateX(-50%); width:420px; height:22px;
  overflow:hidden; mask-image:linear-gradient(90deg,#0000,#000 18%,#000 82%,#0000); }
#compass .strip { position:absolute; top:0; height:22px; white-space:nowrap; }
#compass span { position:absolute; top:3px; font-size:12px; letter-spacing:.18em; color:#c2ced9;
  transform:translateX(-50%); text-shadow:0 2px 6px #000c; }
#compass em { position:absolute; top:9px; width:1px; height:5px; background:#8a97a4; }
#compass .n { position:absolute; left:50%; top:0; width:1px; height:9px; background:#c9a24d; }

#match { left:50%; top:48px; transform:translateX(-50%); display:flex; align-items:center;
  gap:16px; font-variant-numeric:tabular-nums; text-shadow:0 2px 8px #000c; }
#match .s { font-size:22px; font-weight:700; min-width:46px; text-align:center; }
#match .us { color:#7fd3ff; } #match .them { color:#ff8a7a; }
#match .clk { font-size:14px; letter-spacing:.16em; color:#c2ced9; }
#match .lim { font-size:10px; letter-spacing:.22em; color:#7d8b99; text-align:center; }

#pops { left:50%; top:56%; transform:translateX(-50%); text-align:center; }
#pops div { font-size:19px; font-weight:700; color:#ffd76a; text-shadow:0 2px 10px #000d;
  animation:pop 1.1s ease-out forwards; }
@keyframes pop { 0%{opacity:0;transform:translateY(6px) scale(.9)} 12%{opacity:1;transform:none}
  70%{opacity:1} 100%{opacity:0;transform:translateY(-14px)} }

#banner { left:50%; top:16%; transform:translateX(-50%); text-align:center; opacity:0;
  transition:opacity .3s; }
#banner .t { font-size:30px; font-weight:700; letter-spacing:.22em; text-shadow:0 3px 16px #000d; }
#banner .s { font-size:13px; letter-spacing:.3em; color:#a9b6c3; margin-top:6px; }

#dmg { position:absolute; inset:0; }
#dmg i { position:absolute; left:50%; top:50%; width:120px; height:120px; margin:-60px 0 0 -60px;
  opacity:0; transition:opacity .5s;
  background:conic-gradient(from -18deg, #ff3a2a00, #ff3a2acc 18deg, #ff3a2a00 36deg); }
#vig { position:absolute; inset:0; box-shadow:inset 0 0 200px #7a0c0c00; transition:box-shadow .3s; }
#dead { position:absolute; inset:0; background:#12060699; opacity:0; transition:opacity .4s;
  display:flex; align-items:center; justify-content:center; }
#dead .t { font-size:34px; font-weight:700; letter-spacing:.3em; }

#board { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  min-width:520px; background:#080c11e6; box-shadow:0 0 0 1px #ffffff1a, 0 24px 60px #000a;
  padding:18px 22px; display:none; }
#board h4 { margin:0 0 12px; font-size:13px; letter-spacing:.3em; color:#c9a24d; font-weight:600; }
#board table { width:100%; border-collapse:collapse; font-size:14px; }
#board td, #board th { padding:5px 8px; text-align:left; color:#cdd8e2; font-weight:400; }
#board th { font-size:11px; letter-spacing:.2em; color:#7d8b99; border-bottom:1px solid #ffffff14; }
#board td.n { text-align:right; font-variant-numeric:tabular-nums; }
`;

const DIRS = [
  [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
  [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'],
];

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    const el = document.getElementById('ui');
    el.innerHTML = `<style>${CSS}</style>
      <div id="vig"></div>
      <div id="dmg"></div>
      <div class="hud" id="compass"><div class="strip"></div><div class="n"></div></div>
      <div class="hud" id="xh"></div>
      <div class="hud" id="hm"></div>
      <div class="hud" id="match">
        <div class="s us">0</div>
        <div><div class="clk">0:00</div><div class="lim">TEAM DEATHMATCH</div></div>
        <div class="s them">0</div>
      </div>
      <div class="hud" id="banner"><div class="t"></div><div class="s"></div></div>
      <div class="hud" id="pops"></div>
      <div class="hud" id="ammo">
        <div class="wn">—</div><div><span class="mag">0</span><span class="res">/0</span></div>
        <div class="mode">SEMI</div><div class="rl">RELOADING</div>
      </div>
      <div class="hud" id="hp"><div class="l">HEALTH</div><div class="bar"><i></i></div></div>
      <div class="hud" id="feed"></div>
      <div id="dead"><div class="t">YOU DIED</div></div>
      <div id="board"><h4>SCOREBOARD</h4><table>
        <tr><th>OPERATOR</th><th class="n">K</th><th class="n">D</th><th class="n">SCORE</th></tr>
        <tbody></tbody></table></div>`;
    this.el = el;
    this.q = s => el.querySelector(s);

    // crosshair: four ticks whose offset tracks the weapon's current spread
    this.ticks = [];
    for (let i = 0; i < 4; i++) {
      const t = document.createElement('i');
      t.style.transform = `rotate(${i * 90}deg) translateY(-8px)`;
      this.q('#xh').appendChild(t);
      this.ticks.push(t);
    }
    this.q('#xh').appendChild(document.createElement('b'));
    for (let i = 0; i < 4; i++) {
      const t = document.createElement('i');
      t.style.transform = `rotate(${45 + i * 90}deg) translateY(-13px)`;
      this.q('#hm').appendChild(t);
    }
    this.buildCompass();

    this.kills = 0; this.deaths = 0; this.score = 0;
    this.hmT = 0; this.ads = false;
    this._dmgMarks = [];
    this._lastHp = 100;

    const bus = ctx.bus;
    bus.on('ads', p => this.setAds(!!(p && p.on)));
    bus.on('hitmarker', p => this.hitmarker(p && p.head));
    bus.on('kill', p => {
      this.kills++; this.score += (p && p.head) ? 150 : 100;
      this.feed('YOU', (p && p.name) || 'ENEMY', p && p.head);
      this.pop((p && p.head) ? '+150 HEADSHOT' : '+100');
    });
    bus.on('score', p => { this.score += (p && p.n) || 0; if (p && p.reason) this.pop(`+${p.n} ${p.reason}`); });
    bus.on('playerHit', p => this.playerHit(p));
    bus.on('reload', () => this.showReload());
    bus.on('death', () => { this.deaths++; this.q('#dead').style.opacity = 1; });
    bus.on('respawn', () => { this.q('#dead').style.opacity = 0; });
    bus.on('banner', p => this.banner(p && p.text, p && p.sub));
  }

  buildCompass() {
    const strip = this.q('#compass .strip');
    // three copies of the rose so it can scroll seamlessly through 360deg
    for (let rep = -1; rep <= 1; rep++) {
      for (const [deg, label] of DIRS) {
        const s = document.createElement('span');
        s.textContent = label;
        s.dataset.deg = deg + rep * 360;
        strip.appendChild(s);
      }
      for (let d = 0; d < 360; d += 15) {
        if (d % 45 === 0) continue;
        const m = document.createElement('em');
        m.dataset.deg = d + rep * 360;
        strip.appendChild(m);
      }
    }
    this.compassMarks = [...strip.children];
  }

  setAds(on) {
    this.ads = on;
    this.q('#xh').style.opacity = on ? 0 : 1;
  }

  hitmarker(head) {
    const hm = this.q('#hm');
    hm.style.opacity = 1;
    hm.style.transform = 'translate(-50%,-50%) scale(1.35)';
    for (const i of hm.children) i.style.background = head ? '#ff5d45' : '#ffffff';
    this.hmT = 0.14;
    requestAnimationFrame(() => { hm.style.transform = 'translate(-50%,-50%) scale(1)'; });
  }

  playerHit(p) {
    const dmg = (p && p.dmg) || 0;
    const hp = this.ctx.player && this.ctx.player.hp;
    // player.js owns hp; only subtract here if nobody else did
    if (this.ctx.player && hp === this._lastHp && !this.ctx.player.damage) {
      this.ctx.player.hp = Math.max(0, hp - dmg);
    }
    const vig = this.q('#vig');
    vig.style.boxShadow = `inset 0 0 200px #7a0c0c${Math.min(255, 90 + dmg * 6).toString(16).padStart(2, '0')}`;
    clearTimeout(this._vt);
    this._vt = setTimeout(() => { vig.style.boxShadow = 'inset 0 0 200px #7a0c0c00'; }, 260);
    // directional damage indicator
    const el = document.createElement('i');
    const ang = p && p.dir != null ? p.dir : (this.ctx.rng ? this.ctx.rng() : Math.random()) * Math.PI * 2;
    el.style.transform = `rotate(${(ang * 180) / Math.PI}deg)`;
    this.q('#dmg').appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = 1; });
    setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 600); }, 700);
  }

  showReload() {
    const rl = this.q('#ammo .rl');
    rl.style.opacity = 1;
    clearTimeout(this._rt);
    const t = (this.ctx.weapons && this.ctx.weapons.def && this.ctx.weapons.def.reload) || 2;
    this._rt = setTimeout(() => { rl.style.opacity = 0; }, t * 1000);
  }

  feed(a, b, head) {
    const f = this.q('#feed');
    const d = document.createElement('div');
    d.innerHTML = `<span style="color:#7fd3ff">${a}</span>` +
      `<span style="color:${head ? '#ff5d45' : '#9fb0c0'};margin:0 8px">${head ? '❯❯' : '❯'}</span>` +
      `<span style="color:#ff8a7a">${b}</span>`;
    f.prepend(d);
    while (f.children.length > 5) f.lastChild.remove();
    setTimeout(() => d.remove(), 6000);
  }

  pop(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.q('#pops').prepend(d);
    setTimeout(() => d.remove(), 1200);
  }

  banner(text, sub) {
    const b = this.q('#banner');
    b.querySelector('.t').textContent = text || '';
    b.querySelector('.s').textContent = sub || '';
    b.style.opacity = 1;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { b.style.opacity = 0; }, 2600);
  }

  update(dt) {
    const p = this.ctx.player, w = this.ctx.weapons;

    if (w) {
      const def = w.def || {};
      this.q('#ammo .wn').textContent = def.name || '—';
      this.q('#ammo .mag').textContent = w.ammo != null ? w.ammo : 0;
      this.q('#ammo .res').textContent = '/' + (w.reserve != null ? w.reserve : 0);
      this.q('#ammo .mode').textContent = def.mode || (def.rpm > 400 ? 'AUTO' : 'SEMI');
      this.q('#ammo').classList.toggle('low', (w.ammo || 0) <= Math.max(1, (def.mag || 30) * 0.25));
      // crosshair opens with the weapon's live spread
      const spread = w.currentSpread != null ? w.currentSpread : (def.spread || 0.006);
      const gap = 6 + Math.min(26, spread * 1400);
      for (let i = 0; i < 4; i++) {
        this.ticks[i].style.transform = `rotate(${i * 90}deg) translateY(-${gap}px)`;
      }
      if (w.ads != null && w.ads !== this.ads) this.setAds(w.ads);
      else if (p && p.ads != null && p.ads !== this.ads) this.setAds(p.ads);
    }

    if (p) {
      const hp = Math.max(0, Math.min(100, p.hp != null ? p.hp : 100));
      this.q('#hp .bar i').style.width = hp + '%';
      this.q('#hp').classList.toggle('hurt', hp < 35);
      this._lastHp = p.hp;

      // compass scrolls with yaw: 3.2 px per degree, north pinned to the marker
      const deg = ((-(p.yaw || 0) * 180) / Math.PI) % 360;
      for (const m of this.compassMarks) {
        let d = parseFloat(m.dataset.deg) - deg;
        m.style.left = 210 + d * 3.2 + 'px';
      }
    }

    const m = this.ctx.match;
    if (m) {
      this.q('#match .us').textContent = m.score | 0;
      this.q('#match .them').textContent = m.enemyScore | 0;
      const left = Math.max(0, m.timeLeft | 0);
      this.q('#match .clk').textContent = `${(left / 60) | 0}:${String(left % 60).padStart(2, '0')}`;
      this.q('#match .lim').textContent = (m.mode && m.mode.name) || '';
    }

    if (this.hmT > 0) {
      this.hmT -= dt;
      if (this.hmT <= 0) this.q('#hm').style.opacity = 0;
    }

    // scoreboard on Tab
    const board = this.q('#board');
    const show = this.ctx.input && this.ctx.input.down && this.ctx.input.down('Tab');
    if (show !== this._boardShown) {
      this._boardShown = show;
      board.style.display = show ? 'block' : 'none';
      if (show) this.fillBoard();
    }
  }

  fillBoard() {
    const bots = (this.ctx.ai && this.ctx.ai.bots) || [];
    const alive = bots.filter(b => !b.dead).length;
    const rows = [
      ['YOU', this.kills, this.deaths, this.score],
      ['ENEMY SQUAD', bots.length - alive, this.kills, (bots.length - alive) * 100],
    ];
    this.q('#board tbody').innerHTML = rows.map(r =>
      `<tr><td>${r[0]}</td><td class="n">${r[1]}</td><td class="n">${r[2]}</td><td class="n">${r[3]}</td></tr>`
    ).join('');
  }
}
