// Procedural material set for the weapon viewmodels (owned by the weapons agent).
//
// Two things make these read as a real object rather than a grey box:
//   * every mesh gets triplanar-baked UVs (see weapons-models.js) so texel density
//     is constant in metres — textures are authored to tile every TEX_METRES.
//   * every material ships a roughness/metalness map, so highlights break up, plus
//     vertex-colour edge wear that the geometry baker writes per part.
// Metals are MeshPhysicalMaterial with a little anisotropy: machined aluminium and
// phosphated steel both smear their specular along the tool path, and that streaked
// highlight is most of what tells the eye "this is metal, not plastic".
import * as THREE from 'three';

// One texture tile covers this many metres of surface. 512 px over 8 cm ~ 0.16 mm/texel.
export const TEX_METRES = 0.08;

const TEX = new Map();

function canvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  return c;
}

function tex(key, size, draw, { linear = false } = {}) {
  if (TEX.has(key)) return TEX.get(key);
  const t = new THREE.CanvasTexture(canvas(size, draw));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // anisotropic filtering is per-sample expensive and the viewmodel is always near
  // the camera at a shallow angle only along the barrel — 4 is plenty, and the
  // roughness map does not need it at all.
  t.anisotropy = linear ? 1 : 4;
  t.generateMipmaps = true;
  if (!linear) t.colorSpace = THREE.SRGBColorSpace;
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

// Fine speckle used to break up any flat fill.
function speckle(g, s, n, a) {
  for (let i = 0; i < n; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${a * Math.random()})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1, 1);
  }
}

/* ---------------------------------------------------------------- albedo maps */

// Stippled / bead-blasted polymer, the classic pistol-grip finish.
function paintPolymer(g, s) {
  g.fillStyle = '#25272b'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < s * 10; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 0.7 + Math.random() * 2.0;
    const v = Math.random() > 0.5 ? 235 : 10;
    g.fillStyle = `rgba(${v},${v},${v},${0.05 + Math.random() * 0.10})`;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  // moulding flow marks
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.03})`;
    g.lineWidth = 2 + Math.random() * 8;
    const y = Math.random() * s;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= s; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 6);
    g.stroke();
  }
  // scuffs where a polymer part rubs a plate carrier
  for (let i = 0; i < 18; i++) {
    g.strokeStyle = `rgba(180,180,186,${0.05 + Math.random() * 0.16})`;
    g.lineWidth = 0.6 + Math.random() * 1.3;
    const x = Math.random() * s, y = Math.random() * s, a = Math.random() * 6.28;
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * (10 + Math.random() * 60), y + Math.sin(a) * (4 + Math.random() * 18));
    g.stroke();
  }
  grain(g, s, 14);
}

// Manganese-phosphate steel: dark, mottled, with fine tooling lines along U.
function paintSteel(g, s) {
  g.fillStyle = '#2c3036'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 420; i++) {
    g.fillStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.05})`;
    g.fillRect(0, Math.random() * s, s, 0.5 + Math.random() * 1.2);
  }
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.13})`;
    const r = 6 + Math.random() * 40;
    g.beginPath(); g.arc(Math.random() * s, Math.random() * s, r, 0, 7); g.fill();
  }
  // bright drag scratches, mostly along the bore axis
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(206,212,224,${0.05 + Math.random() * 0.22})`;
    g.lineWidth = 0.5 + Math.random() * 1.1;
    const x = Math.random() * s, y = Math.random() * s;
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.2) * 150, y + (Math.random() - 0.5) * 10);
    g.stroke();
  }
  speckle(g, s, s * 12, 0.25);
  grain(g, s, 11);
}

// Type-III hardcoat anodised aluminium: flat charcoal with extrusion lines along U.
function paintAlu(g, s) {
  g.fillStyle = '#3a3e44'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(255,255,255,${0.010 + Math.random() * 0.035})`;
    g.fillRect(0, Math.random() * s, s, 0.4 + Math.random() * 1.4);
  }
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.07})`;
    const r = 10 + Math.random() * 50;
    g.beginPath(); g.arc(Math.random() * s, Math.random() * s, r, 0, 7); g.fill();
  }
  // worn-through anodising: patches of bright bare alloy
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const gr = g.createRadialGradient(x, y, 0, x, y, 6 + Math.random() * 20);
    gr.addColorStop(0, `rgba(196,202,212,${0.14 + Math.random() * 0.22})`);
    gr.addColorStop(1, 'rgba(196,202,212,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, 26, 0, 7); g.fill();
  }
  speckle(g, s, s * 10, 0.22);
  grain(g, s, 9);
}

function paintRubber(g, s) {
  g.fillStyle = '#141519'; g.fillRect(0, 0, s, s);
  const n = 26, c = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const o = (y % 2) * c * 0.5;
    g.fillStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.05})`;
    g.beginPath(); g.arc(x * c + o + c / 2, y * c + c / 2, c * 0.30, 0, 7); g.fill();
  }
  grain(g, s, 8);
}

function paintWood(g, s) {
  g.fillStyle = '#4d3119'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 220; i++) {
    const y = Math.random() * s;
    g.strokeStyle = `rgba(${20 + Math.random() * 70},${10 + Math.random() * 34},0,${0.05 + Math.random() * 0.18})`;
    g.lineWidth = 0.7 + Math.random() * 3.4;
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= s; x += 24) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 5);
    g.stroke();
  }
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const gr = g.createRadialGradient(x, y, 0, x, y, 18);
    gr.addColorStop(0, 'rgba(228,214,190,0.20)'); gr.addColorStop(1, 'rgba(228,214,190,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill();
  }
  grain(g, s, 12);
}

// Tactical glove: ribbed synthetic with stitching runs and a leather palm feel.
function paintGlove(g, s) {
  g.fillStyle = '#22242a'; g.fillRect(0, 0, s, s);
  // woven weft
  for (let i = 0; i < s; i += 3) {
    g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.035})`;
    g.fillRect(0, i, s, 1.2);
    g.fillStyle = `rgba(0,0,0,${0.03 + Math.random() * 0.05})`;
    g.fillRect(i, 0, 1.2, s);
  }
  // stitch runs
  for (let i = 0; i < 5; i++) {
    const y = Math.random() * s;
    for (let x = 0; x < s; x += 9) {
      g.fillStyle = `rgba(150,150,158,${0.18 + Math.random() * 0.16})`;
      g.fillRect(x, y, 5, 1.5);
    }
  }
  // worn knuckle/palm highlights
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * s, y = Math.random() * s;
    const gr = g.createRadialGradient(x, y, 0, x, y, 22);
    gr.addColorStop(0, `rgba(120,122,132,${0.10 + Math.random() * 0.14})`);
    gr.addColorStop(1, 'rgba(120,122,132,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, 22, 0, 7); g.fill();
  }
  grain(g, s, 10);
}

// Ripstop sleeve: coarse square grid, dusty multicam-ish desaturated tan.
function paintSleeve(g, s) {
  g.fillStyle = '#4a4535'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${60 + Math.random() * 70},${56 + Math.random() * 60},${40 + Math.random() * 40},0.5)`;
    const w = 30 + Math.random() * 90, h = 24 + Math.random() * 70;
    g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, w, h, Math.random() * 3, 0, 7); g.fill();
  }
  for (let i = 0; i < s; i += 11) {
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(i, 0, 1.4, s); g.fillRect(0, i, 1.4, s);
  }
  grain(g, s, 13);
}

/* -------------------------------------------------- roughness / metalness maps */
// G = roughness, B = metalness. Painted linear (no colour-space conversion).

function mrPaint(base, mrough, mmet, streaks) {
  return (g, s) => {
    g.fillStyle = `rgb(0,${Math.round(mrough * 255)},${Math.round(mmet * 255)})`;
    g.fillRect(0, 0, s, s);
    if (streaks) {
      for (let i = 0; i < 520; i++) {
        const v = Math.round(THREE.MathUtils.clamp(mrough + (Math.random() - 0.5) * 0.5, 0, 1) * 255);
        g.fillStyle = `rgba(0,${v},${Math.round(mmet * 255)},${0.25 + Math.random() * 0.5})`;
        g.fillRect(0, Math.random() * s, s, 0.5 + Math.random() * 2.0);
      }
    }
    // blotchy oil / handling film — the strongest single cue that a gun is used
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 8 + Math.random() * 46;
      const v = Math.round(THREE.MathUtils.clamp(mrough + (Math.random() - 0.55) * 0.42, 0.05, 1) * 255);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(0,${v},${Math.round(mmet * 255)},0.55)`);
      gr.addColorStop(1, `rgba(0,${v},${Math.round(mmet * 255)},0)`);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    void base;
  };
}

function paintKnurl(g, s) {
  g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
  const n = 30, c = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = ((x + y) & 1) ? '#cdcdcd' : '#383838';
    g.fillRect(x * c, y * c, c * 0.92, c * 0.92);
  }
}

/* --------------------------------------------------------- material factory */

const S = 512;

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
        map: tex('polymer', S, paintPolymer),
        roughnessMap: tex('mrPoly', 256, mrPaint(0, 0.78, 0.02, false), { linear: true }),
        color: 0xc4c6ca, roughness: 1.0, metalness: 0.03,
        envMapIntensity: 1.15, vertexColors: true,
      });
      case 'polymerTan': return new THREE.MeshStandardMaterial({
        map: tex('polymer', S, paintPolymer),
        roughnessMap: tex('mrPoly', 256, mrPaint(0, 0.78, 0.02, false), { linear: true }),
        color: 0x8f7a52, roughness: 1.0, metalness: 0.03,
        envMapIntensity: 1.1, vertexColors: true,
      });
      case 'steel': return new THREE.MeshStandardMaterial({
        map: tex('steel', S, paintSteel),
        roughnessMap: tex('mrSteel', 256, mrPaint(0, 0.34, 1.0, true), { linear: true }),
        color: 0xc2c7ce, roughness: 1.0, metalness: 0.94,
        envMapIntensity: 1.5, vertexColors: true,
      });
      case 'steelDark': return new THREE.MeshStandardMaterial({
        map: tex('steel', S, paintSteel),
        roughnessMap: tex('mrSteelD', 256, mrPaint(0, 0.46, 1.0, true), { linear: true }),
        color: 0x8d9299, roughness: 1.0, metalness: 0.90,
        envMapIntensity: 1.35, vertexColors: true,
      });
      case 'alu': return new THREE.MeshStandardMaterial({
        map: tex('alu', S, paintAlu),
        roughnessMap: tex('mrAlu', 256, mrPaint(0, 0.42, 0.85, true), { linear: true }),
        color: 0xa9aeb6, roughness: 1.0, metalness: 1.0,
        envMapIntensity: 1.45, vertexColors: true,
      });
      case 'rubber': return new THREE.MeshStandardMaterial({
        map: tex('rubber', S, paintRubber),
        roughnessMap: tex('mrRub', 256, mrPaint(0, 0.93, 0.0, false), { linear: true }),
        color: 0xa2a2a6, roughness: 1.0, metalness: 0.0,
        envMapIntensity: 0.9, vertexColors: true,
      });
      case 'wood': return new THREE.MeshStandardMaterial({
        map: tex('wood', S, paintWood),
        roughnessMap: tex('mrWood', 256, mrPaint(0, 0.5, 0.0, true), { linear: true }),
        color: 0xcdbba0, roughness: 1.0, metalness: 0.0,
        envMapIntensity: 1.0, vertexColors: true,
      });
      case 'glove': return new THREE.MeshStandardMaterial({
        map: tex('glove', S, paintGlove),
        roughnessMap: tex('mrGlove', 256, mrPaint(0, 0.72, 0.02, false), { linear: true }),
        color: 0xb8bcc4, roughness: 1.0, metalness: 0.02,
        envMapIntensity: 1.05, vertexColors: true,
      });
      case 'gloveGrip': return new THREE.MeshStandardMaterial({
        map: tex('rubber', S, paintRubber),
        color: 0x8e9098, roughness: 0.88, metalness: 0.02,
        envMapIntensity: 0.9, vertexColors: true,
      });
      case 'sleeve': return new THREE.MeshStandardMaterial({
        map: tex('sleeve', S, paintSleeve),
        roughnessMap: tex('mrSleeve', 256, mrPaint(0, 0.88, 0.0, false), { linear: true }),
        color: 0xb0ab98, roughness: 1.0, metalness: 0.0,
        envMapIntensity: 1.0, vertexColors: true,
      });
      case 'brass': return new THREE.MeshStandardMaterial({
        color: 0xc9a349, roughness: 0.28, metalness: 1.0, envMapIntensity: 1.6, vertexColors: true,
      });
      case 'optic': return new THREE.MeshStandardMaterial({
        map: tex('alu', S, paintAlu),
        roughnessMap: tex('mrOptic', 256, mrPaint(0, 0.52, 0.55, true), { linear: true }),
        color: 0x4c4f55, roughness: 1.0, metalness: 0.62, envMapIntensity: 1.25, vertexColors: true,
      });
      case 'lens': return new THREE.MeshPhysicalMaterial({
        color: 0x2f5570, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.36,
        envMapIntensity: 3.0, side: THREE.DoubleSide, depthWrite: false,
      });
      case 'lensAmber': return new THREE.MeshPhysicalMaterial({
        color: 0x7a5622, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.32,
        envMapIntensity: 3.0, side: THREE.DoubleSide, depthWrite: false,
      });
      case 'tritium': return new THREE.MeshBasicMaterial({ color: 0x7fffc0, toneMapped: false });
      default: return new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.6, metalness: 0.5, vertexColors: true });
    }
  }
}

/* ------------------------------------------------------------------ reticles */

// Red-dot reticle sprite: a 2-MOA dot with a tight glow, or the EOTech ring/dot.
export function reticleTexture(kind = 'dot') {
  return tex('reticle_' + kind, 256, (g, s) => {
    g.clearRect(0, 0, s, s);
    const c = s / 2;
    if (kind === 'holo') {
      // 65 MOA ring, broken at the cardinal points, with a 1 MOA centre dot
      g.strokeStyle = 'rgba(255,64,38,0.92)'; g.lineWidth = s * 0.030;
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.arc(c, c, s * 0.33, i * Math.PI / 2 + 0.16, i * Math.PI / 2 + Math.PI / 2 - 0.16); g.stroke();
      }
      const gl = g.createRadialGradient(c, c, 0, c, c, s * 0.09);
      gl.addColorStop(0, 'rgba(255,150,120,1)');
      gl.addColorStop(0.30, 'rgba(255,50,28,0.75)');
      gl.addColorStop(1, 'rgba(255,30,12,0)');
      g.fillStyle = gl; g.fillRect(0, 0, s, s);
      g.fillStyle = '#ffe6dd';
      g.beginPath(); g.arc(c, c, s * 0.030, 0, 7); g.fill();
    } else {
      const glow = g.createRadialGradient(c, c, 0, c, c, s * 0.16);
      glow.addColorStop(0, 'rgba(255,120,90,1)');
      glow.addColorStop(0.18, 'rgba(255,52,32,0.85)');
      glow.addColorStop(0.45, 'rgba(255,32,16,0.28)');
      glow.addColorStop(1, 'rgba(255,20,10,0)');
      g.fillStyle = glow; g.fillRect(0, 0, s, s);
      g.fillStyle = '#fff0e8';
      g.beginPath(); g.arc(c, c, s * 0.055, 0, 7); g.fill();
    }
  });
}
