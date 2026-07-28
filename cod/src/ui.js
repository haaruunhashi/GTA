// HUD and menus: crosshair, ammo, health, hitmarkers, killfeed, damage vignette.
// Owner: ui agent. Public API: update(dt).
export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    const el = document.getElementById('ui');
    el.innerHTML = `
      <style>
        .hud { position:absolute; font-variant-numeric: tabular-nums; }
        #xh { left:50%; top:50%; transform:translate(-50%,-50%); width:22px; height:22px; }
        #xh i { position:absolute; background:#dfe8f0; box-shadow:0 0 2px #000a; }
        #ammo { right:46px; bottom:34px; text-align:right; }
        #ammo b { font-size:44px; font-weight:700; letter-spacing:.04em; }
        #ammo span { font-size:18px; color:#9fb0c0; }
        #ammo .n { font-size:13px; color:#c9a24d; letter-spacing:.25em; }
        #hp { left:46px; bottom:40px; width:220px; }
        #hp .bar { height:5px; background:#1b2430; }
        #hp .bar i { display:block; height:100%; background:#d8e2ec; width:100%; }
        #hp .l { font-size:12px; letter-spacing:.25em; color:#9fb0c0; margin-bottom:6px; }
        #hm { left:50%; top:50%; transform:translate(-50%,-50%); opacity:0; font-size:26px; color:#fff; }
        #feed { right:34px; top:28px; text-align:right; font-size:14px; line-height:1.6; color:#cfd8e2; }
        #vig { position:absolute; inset:0; box-shadow: inset 0 0 220px #8b0f0f00; transition: box-shadow .25s; }
      </style>
      <div id="vig"></div>
      <div class="hud" id="xh"></div>
      <div class="hud" id="hm">✕</div>
      <div class="hud" id="ammo"><div class="n" id="wname">MK-4 CARBINE</div><b id="mag">30</b><span id="res"> / 180</span></div>
      <div class="hud" id="hp"><div class="l">HEALTH</div><div class="bar"><i id="hpbar"></i></div></div>
      <div class="hud" id="feed"></div>`;
    const xh = el.querySelector('#xh');
    for (const s of [[10, 0, 2, 7], [10, 15, 2, 7], [0, 10, 7, 2], [15, 10, 7, 2]]) {
      const i = document.createElement('i');
      i.style.cssText = `left:${s[0]}px;top:${s[1]}px;width:${s[2]}px;height:${s[3]}px`;
      xh.appendChild(i);
    }
    this.el = el;
    this.hm = el.querySelector('#hm');
    ctx.bus.on('hitmarker', () => { this.hm.style.opacity = 1; this.hmT = 0.12; });
    ctx.bus.on('kill', () => this.feed('YOU', 'ENEMY'));
    ctx.bus.on('playerHit', ({ dmg }) => {
      ctx.player.hp = Math.max(0, ctx.player.hp - dmg);
      el.querySelector('#vig').style.boxShadow = 'inset 0 0 220px #8b0f0fcc';
      clearTimeout(this._vt);
      this._vt = setTimeout(() => { el.querySelector('#vig').style.boxShadow = 'inset 0 0 220px #8b0f0f00'; }, 220);
    });
  }
  feed(a, b) {
    const f = this.el.querySelector('#feed');
    const d = document.createElement('div');
    d.innerHTML = `<span style="color:#7fd3ff">${a}</span> ✕ <span style="color:#ff8a7a">${b}</span>`;
    f.prepend(d);
    setTimeout(() => d.remove(), 5000);
  }
  update(dt) {
    const w = this.ctx.weapons, p = this.ctx.player;
    this.el.querySelector('#mag').textContent = w.ammo;
    this.el.querySelector('#res').textContent = ' / ' + w.reserve;
    this.el.querySelector('#wname').textContent = w.def.name;
    this.el.querySelector('#hpbar').style.width = p.hp + '%';
    if (this.hmT > 0) { this.hmT -= dt; if (this.hmT <= 0) this.hm.style.opacity = 0; }
  }
}
