// Procedural material set for the weapon viewmodels (owned by the weapons agent).
// Gives us the polymer / phosphate-steel / anodised-aluminium contrast that makes a
// gun read as a gun instead of a grey box. Every texture is drawn in a canvas.
import * as THREE from 'three';

const TEX = new Map();

function canvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  return c;
}

function tex(key, size, draw, { repeat = 1, srgb = true, linear = false } = {}) {
  if (TEX.has(key)) return TEX.get(key);
  const t = new THREE.CanvasTexture(canvas(size, draw));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb && !linear) t.colorSpace = THREE.SRGBColorSpace;
  TEX.set(key, t);
  return t;
}

function grain(g, s, amt, alpha = 1) {
  const img = g.getImageData(0, 0, s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
    if (alpha < 1) d[i + 3] *= alpha;
  }
  g.putImageData(img, 0, 0);
}

// ---- texture painters -------------------------------------------------------

// Stippled / bead-blasted polymer, the classic pistol-grip finish.
function paintPolymer(g, s) {
  g.fillStyle = '#1b1d21'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < s * 14; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 0.6 + Math.random() * 1.6;
    const v = Math.random() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${0.06 + Math.random() * 0.1})`;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  grain(g, s, 16);
}

// Manganese-phosphate steel: dark, slightly mottled, with fine machining lines.
function paintSteel(g, s) {
  g.fillStyle = '#25282d'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 240; i++) {
    g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
    g.fillRect(0, Math.random() * s, s, 0.5 + Math.random());
  }
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.12})`;
    const r = 4 + Math.random() * 26;
    g.beginPath(); g.arc(Math.random() * s, Math.random() * s, r, 0, 7); g.fill();
  }
  // edge wear / bright scratches
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(200,205,215,${0.05 + Math.random() * 0.18})`;
    g.lineWidth = 0.6 + Math.random();
    g.beginPath();
    const x = Math.random() * s, y = Math.random() * s;
    g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 14);
    g.stroke();
  }
  grain(g, s, 12);
}

// Type-III hardcoat anodised aluminium — flatter, greyer, with extrusion lines.
function paintAlu(g, s) {
  g.fillStyle = '#33363b'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.04})`;
    g.fillRect(Math.random() * s, 0, 0.5 + Math.random() * 1.5, s);
  }
  grain(g, s, 10);
}

function paintRubber(g, s) {
  g.fillStyle = '#121316'; g.fillRect(0, 0, s, s);
  const n = 22, c = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const o = (y % 2) * c * 0.5;
    g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.04})`;
    g.beginPath(); g.arc(x * c + o + c / 2, y * c + c / 2, c * 0.3, 0, 7); g.fill();
  }
  grain(g, s, 8);
}

function paintWood(g, s) {
  g.fillStyle = '#4a2f19'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 160; i++) {
    const y = Math.random() * s;
    g.strokeStyle = `rgba(${20 + Math.random() * 60},${10 + Math.random() * 30},0,${0.06 + Math.random() * 0.18})`;
    g.lineWidth = 0.7 + Math.random() * 3;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= s; x += 24) g.lineTo(x, y + Math.sin(x * 0.03 + i) * 4);
    g.stroke();
  }
  grain(g, s, 14);
}

// Bump map: a light/dark height field, reused as a cheap normal proxy.
function paintKnurl(g, s) {
  g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
  const n = 26, c = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = ((x + y) & 1) ? '#c8c8c8' : '#3c3c3c';
    g.fillRect(x * c, y * c, c * 0.9, c * 0.9);
  }
}

// ---- material factory -------------------------------------------------------

export class GunMats {
  constructor(ctx) { this.ctx = ctx; this.cache = new Map(); }

  get(name) {
    if (!this.cache.has(name)) this.cache.set(name, this._shared(name) || this._build(name));
    return this.cache.get(name);
  }

  // Give the materials agent a hook: if it publishes `gun_<name>` we use it.
  _shared(name) {
    const m = this.ctx.materials?.get?.('gun_' + name);
    if (!m) return null;
    const isFallback = m.isMeshStandardMaterial && m.color?.getHex() === 0x999999 && m.roughness === 0.8;
    return isFallback ? null : m;
  }

  _build(name) {
    switch (name) {
      case 'polymer': return new THREE.MeshStandardMaterial({
        map: tex('polymer', 256, paintPolymer, { repeat: 3 }),
        bumpMap: tex('polymer', 256, paintPolymer, { repeat: 3 }), bumpScale: 0.35,
        color: 0xbcbcbc, roughness: 0.78, metalness: 0.04,
      });
      case 'polymerTan': return new THREE.MeshStandardMaterial({
        map: tex('polymer', 256, paintPolymer, { repeat: 3 }),
        color: 0x9a8158, roughness: 0.8, metalness: 0.04,
      });
      case 'steel': return new THREE.MeshStandardMaterial({
        map: tex('steel', 256, paintSteel, { repeat: 2 }),
        color: 0xcfd3d8, roughness: 0.38, metalness: 0.95,
      });
      case 'steelDark': return new THREE.MeshStandardMaterial({
        map: tex('steel', 256, paintSteel, { repeat: 2 }),
        color: 0x8b9098, roughness: 0.5, metalness: 0.92,
      });
      case 'alu': return new THREE.MeshStandardMaterial({
        map: tex('alu', 256, paintAlu, { repeat: 2 }),
        color: 0xb6bac0, roughness: 0.46, metalness: 0.88,
      });
      case 'rubber': return new THREE.MeshStandardMaterial({
        map: tex('rubber', 256, paintRubber, { repeat: 2 }),
        bumpMap: tex('knurl', 128, paintKnurl, { repeat: 3 }), bumpScale: 0.22,
        color: 0xa8a8a8, roughness: 0.95, metalness: 0.0,
      });
      case 'wood': return new THREE.MeshStandardMaterial({
        map: tex('wood', 256, paintWood, { repeat: 1 }),
        color: 0xc9b89c, roughness: 0.55, metalness: 0.0,
      });
      case 'brass': return new THREE.MeshStandardMaterial({ color: 0xc9a349, roughness: 0.3, metalness: 1.0 });
      case 'optic': return new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.55, metalness: 0.6 });
      case 'lens': return new THREE.MeshPhysicalMaterial({
        color: 0x2a4a5e, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.42,
        envMapIntensity: 2.2, side: THREE.DoubleSide, depthWrite: false,
      });
      case 'lensAmber': return new THREE.MeshPhysicalMaterial({
        color: 0x6a4a1e, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.35,
        envMapIntensity: 2.4, side: THREE.DoubleSide, depthWrite: false,
      });
      case 'tritium': return new THREE.MeshBasicMaterial({ color: 0x7fffc0, toneMapped: false });
      default: return new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.6, metalness: 0.5 });
    }
  }
}

// Red-dot reticle sprite texture: a 2-MOA dot inside a broken ring.
export function reticleTexture(kind = 'dot') {
  return tex('reticle_' + kind, 256, (g, s) => {
    g.clearRect(0, 0, s, s);
    const c = s / 2;
    const glow = g.createRadialGradient(c, c, 0, c, c, s * 0.10);
    glow.addColorStop(0, 'rgba(255,60,40,1)');
    glow.addColorStop(0.22, 'rgba(255,40,25,0.85)');
    glow.addColorStop(1, 'rgba(255,20,10,0)');
    g.fillStyle = glow; g.fillRect(0, 0, s, s);
    g.fillStyle = '#ffd8cc';
    g.beginPath(); g.arc(c, c, s * 0.022, 0, 7); g.fill();
    if (kind === 'holo') {
      g.strokeStyle = 'rgba(255,50,30,0.75)'; g.lineWidth = s * 0.014;
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.arc(c, c, s * 0.30, i * Math.PI / 2 + 0.28, i * Math.PI / 2 + Math.PI / 2 - 0.28); g.stroke();
      }
    }
  }, { srgb: true });
}
