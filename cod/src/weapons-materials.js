// Material set for the weapon viewmodels (owned by the weapons agent).
//
// DELIBERATELY UNTEXTURED. An earlier version painted canvas albedo/roughness maps
// for every part at ~0.16 mm per texel. The viewmodel only covers ~300 px of screen
// for ~46 cm of weapon, i.e. roughly 1.4 mm per pixel, so those maps were minified
// ~9x and aliased into moire: the buttpad's stipple read as a chequerboard and the
// ripstop sleeve read as pastel foil gift wrap. Detail you cannot resolve is not
// detail, it is noise.
//
// So the weapon reads through the three things that survive at this screen size:
//   * a correct value / roughness / metalness split per part — dark polymer,
//     phosphate steel, anodised aluminium and bright bare barrel steel all sit at
//     different values and gloss, which is what makes a gun look like a gun;
//   * baked vertex-colour edge wear (see weapons-geo.js), which puts a bright rim on
//     every machined edge — resolution independent, no UVs involved, cannot alias;
//   * specular from the scene environment, which is what actually lights a black
//     rifle. Albedo on gunmetal is nearly nothing; the highlights carry the read.
//
// If detail maps come back, they must be authored at the on-screen texel rate
// (~1 mm/texel, i.e. TEX_METRES around 0.5) and verified in a capture first.
import * as THREE from 'three';

// metres per texture tile, if any map is ever reintroduced (see note above)
export const TEX_METRES = 0.5;

const TEX = new Map();

function canvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  return c;
}

function tex(key, size, draw) {
  if (TEX.has(key)) return TEX.get(key);
  const t = new THREE.CanvasTexture(canvas(size, draw));
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 1;
  t.colorSpace = THREE.SRGBColorSpace;
  TEX.set(key, t);
  return t;
}

// name -> [colour, roughness, metalness, envIntensity]
// Chosen so no two adjacent parts share both value and gloss: the receiver reads
// darker and flatter than the barrel, and the polymer furniture flatter still.
const DEFS = {
  // furniture
  polymer: [0x23252a, 0.70, 0.06, 1.00],
  polymerTan: [0x6b5b3e, 0.74, 0.05, 1.00],
  rubber: [0x191b1e, 0.90, 0.00, 0.80],
  wood: [0x4f3520, 0.55, 0.00, 1.00],
  // metal
  alu: [0x4a4e55, 0.44, 0.60, 1.25],   // anodised receiver, rails, handguard
  steel: [0x676d75, 0.34, 0.88, 1.40],   // bare barrel / bolt
  steelDark: [0x34373c, 0.48, 0.72, 1.15],   // phosphate: brake, sights, port cover
  brass: [0xc9a349, 0.28, 1.00, 1.60],
  optic: [0x2b2e33, 0.46, 0.30, 1.10],
  // arms
  glove: [0x24262b, 0.68, 0.03, 1.00],
  gloveGrip: [0x2e3136, 0.50, 0.06, 1.15],   // rubberised knuckle plate: glossier, so
                                             // it catches a highlight and the hand reads
  sleeve: [0x46422f, 0.85, 0.00, 1.00],
};

export class GunMats {
  constructor(ctx) { this.ctx = ctx; this.cache = new Map(); }

  // Weapon materials are owned here, full stop. There used to be a hook that adopted
  // `gun_<name>` from the shared materials module if it existed; that silently started
  // resolving to that module's untextured default and rendered the whole rifle flat
  // white. Anything the viewmodel needs, it builds itself.
  get(name) {
    if (!this.cache.has(name)) this.cache.set(name, this._build(name));
    return this.cache.get(name);
  }

  _build(name) {
    const d = DEFS[name];
    if (d) {
      return new THREE.MeshStandardMaterial({
        name: 'gun_' + name,
        color: d[0], roughness: d[1], metalness: d[2], envMapIntensity: d[3],
        vertexColors: true,
      });
    }
    switch (name) {
      // Optic glass: a thin tinted pane. depthWrite off so the reticle behind it and
      // the tube interior both stay visible.
      case 'lens': return new THREE.MeshPhysicalMaterial({
        name: 'gun_lens',
        color: 0x2f5570, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.34,
        envMapIntensity: 3.0, side: THREE.DoubleSide, depthWrite: false,
      });
      case 'lensAmber': return new THREE.MeshPhysicalMaterial({
        name: 'gun_lensAmber',
        color: 0x7a5622, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.30,
        envMapIntensity: 3.0, side: THREE.DoubleSide, depthWrite: false,
      });
      case 'tritium': return new THREE.MeshBasicMaterial({ color: 0x7fffc0, toneMapped: false });
      default: return new THREE.MeshStandardMaterial({
        color: 0x3f4348, roughness: 0.55, metalness: 0.5, vertexColors: true,
      });
    }
  }
}

/* ------------------------------------------------------------------ reticles */

// Red-dot reticle sprite: a 2-MOA dot with a tight glow, or the EOTech ring/dot.
// This is the one map worth keeping — it is drawn at a fixed ~70 px on screen, so it
// is magnified rather than minified and cannot alias.
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
