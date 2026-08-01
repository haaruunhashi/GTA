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

// name -> [colour, roughness, metalness, envIntensity, anisotropy]
//
// VALUES ARE CALIBRATED, NOT PICKED BY EYE. Sampling the round-6 capture over the
// weapon's screen region gave 12.5 % of pixels at luma < 3 (pure crushed black: the
// magazine, the gloves, every surface facing away from the sun) against blown 254s on
// the barrel and optic hood — a weapon with no mid-tones at all, which is what reads
// as "flat". Two things caused it: albedos around 0.012 linear, which return nothing
// under anything but direct sun, and metals at envIntensity 0.60 against a scene
// environmentIntensity of 2.9, which clipped. So albedos come up into the 0.025-0.05
// linear band real gun polymer actually sits in, metal envIntensity comes down, and
// weapons.js lights the viewmodel with its own small rig so form survives world shadow.
//
// The gunmetal/polymer distinction is carried by GLOSS, not by value — they sit at
// similar darkness, but anodised aluminium has a tight anisotropic highlight streaked
// along the bore axis (the UV bake in weapons-geo.js puts U along Z for exactly this)
// while polymer is broad and matte. That contrast is what makes a gun read as a gun.
// [colour, roughness, metalness, envIntensity, anisotropy, detailMap]
// `roughness` is the EFFECTIVE value wanted on screen; where detailMap is set the
// stored roughness is divided by the map's 0.80 mean so the two agree.
const DEFS = {
  // furniture — matte, low chroma, no anisotropy
  polymer: [0x2f3136, 0.66, 0.02, 0.40, 0, 1],
  polymerTan: [0x6a5c42, 0.70, 0.02, 0.40, 0, 1],
  rubber: [0x232528, 0.88, 0.00, 0.30],
  wood: [0x53381f, 0.52, 0.00, 0.45, 0, 1],
  // metal — glossier, anisotropic along the bore. envIntensity is down from round 11:
  // the up-facing top rail was clipping to 250 against a near-black receiver behind it.
  alu: [0x4a4f57, 0.52, 0.88, 0.30, 0.55, 1],   // anodised receiver, rails, handguard
  steel: [0x70777f, 0.34, 1.00, 0.38, 0.70, 1],   // bare barrel / bolt
  steelDark: [0x2c2f34, 0.60, 0.86, 0.30, 0.45, 1],   // phosphate: brake, sights, port cover
  brass: [0xb08a37, 0.30, 1.00, 0.70],
  optic: [0x2a2d32, 0.38, 0.35, 0.30, 0.30, 1],
  // arms
  glove: [0x2b2d31, 0.72, 0.02, 0.42, 0, 1],
  gloveGrip: [0x3a3e44, 0.46, 0.06, 0.55],   // rubberised knuckle plate: glossier, so
                                             // it catches a highlight and the hand reads
  sleeve: [0x4a4634, 0.84, 0.00, 0.45, 0, 1],
};
const DETAIL_MEAN = 0.80;

/* ------------------------------------------------------------- detail map */

// ONE map, roughness only, and it is authored to the rule the header lays down: the
// weapon covers ~1.4 mm of object per screen pixel, so at TEX_METRES = 0.5 a 512 px
// tile is ~1 mm/texel — magnified about 1.4x on screen rather than minified. The
// round-4 "pastel foil gift wrap" failure was not caused by having a map, it was
// caused by high-frequency CONTENT being minified ~9x. So everything drawn here is
// deliberately low frequency: the tightest feature is a ~13 mm brushing streak, which
// is still ~9 screen pixels wide at the distance the viewmodel is actually rendered.
//
// Roughness only, because roughness is what separates gunmetal from polymer, and it
// cannot shift hue — a bad roughness map looks slightly wrong, a bad albedo or normal
// map looks like foil.
let ROUGH = null;
function roughnessDetail() {
  if (ROUGH) return ROUGH;
  const S = 512;
  const c = canvas(S, (g) => {
    g.fillStyle = '#cccccc'; g.fillRect(0, 0, S, S);       // mean 0.80
    // brushing along U (the UV bake runs U down the bore), so streaks follow the barrel
    for (let i = 0; i < 46; i++) {
      const y = (i + Math.sin(i * 2.7) * 0.4) * (S / 46);
      const v = 178 + Math.floor(Math.sin(i * 1.9) * 26 + Math.sin(i * 0.7) * 22);
      g.strokeStyle = `rgb(${v},${v},${v})`;
      g.lineWidth = S / 46 * (0.5 + 0.5 * Math.abs(Math.sin(i * 1.3)));
      g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
    }
    // broad wear/oil blotches: polished patches where a hand or a sling rubs
    for (let i = 0; i < 14; i++) {
      const x = ((i * 137.5) % 360) / 360 * S, y = ((i * 71.3) % 360) / 360 * S;
      const r = S * (0.07 + (i % 4) * 0.028);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const v = i % 3 === 0 ? 255 : 150;                    // duller grime / polished wear
      gr.addColorStop(0, `rgba(${v},${v},${v},0.42)`);
      gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;   // UVs are metres*2 and go negative
  t.colorSpace = THREE.NoColorSpace;          // data, not colour
  t.anisotropy = 8;                           // the grazing angles are the whole problem
  ROUGH = t;
  return t;
}

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
      // Anisotropic parts need MeshPhysicalMaterial; everything else stays on the
      // cheaper Standard shader. Only three materials take the upgrade, so the
      // viewmodel is still 3-6 draw calls and a handful of shader variants.
      const p = {
        name: 'gun_' + name,
        color: d[0], metalness: d[2], envMapIntensity: d[3], vertexColors: true,
        roughness: d[5] ? d[1] / DETAIL_MEAN : d[1],
      };
      if (d[5]) p.roughnessMap = roughnessDetail();
      // Anisotropic parts need MeshPhysicalMaterial; everything else stays on the
      // cheaper Standard shader. Only four materials take the upgrade, so the
      // viewmodel is still 3-6 draw calls and a handful of shader variants.
      if (d[4]) {
        p.anisotropy = d[4];      // U runs along the bore, so the streak follows
        p.anisotropyRotation = 0; // the barrel
        return new THREE.MeshPhysicalMaterial(p);
      }
      return new THREE.MeshStandardMaterial(p);
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
