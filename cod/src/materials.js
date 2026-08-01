// Procedural PBR material library — no external texture files.
// Owner: materials agent. Public API: get(name) -> THREE.Material (cached).
//
// Every material is generated on <canvas> as albedo + height, from which a
// tangent-space normal map and a roughness map are derived. Materials expose
// `userData.tile` = how many METRES one texture repeat covers, so world.js can
// project world-scale UVs and nothing ever looks stretched or micro-tiled.
import * as THREE from 'three';

/* ------------------------------------------------------------------ utils */

// NOTE: every canvas here is read back with getImageData (normal/AO/roughness
// derivation), and a GPU-backed 2D context makes that readback pathologically
// slow on software rasterisers — hence willReadFrequently on every context.
const CV = (s) => { const c = document.createElement('canvas'); c.width = c.height = s; return c; };

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seeded(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return mulberry32(h >>> 0);
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;

// value-noise fbm painted with composite ops — organic, cheap, deterministic
function fbm(g, s, rnd, { octaves = 4, cells = 4, amp = 0.55, falloff = 0.55, op = 'overlay' } = {}) {
  let c = cells, a = amp;
  for (let o = 0; o < octaves; o++) {
    const n = CV(c), ng = n.getContext('2d', { willReadFrequently: true });
    const img = ng.createImageData(c, c);
    for (let i = 0; i < c * c; i++) {
      const v = (rnd() * 255) | 0;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    ng.putImageData(img, 0, 0);
    g.save();
    g.globalAlpha = a; g.globalCompositeOperation = op; g.imageSmoothingEnabled = true;
    g.drawImage(n, 0, 0, s, s);
    g.restore();
    c *= 2; a *= falloff;
  }
}

// per-pixel monochrome grain
function grain(g, s, rnd, amount) {
  const img = g.getImageData(0, 0, s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] = clamp01((d[i] + n) / 255) * 255;
    d[i + 1] = clamp01((d[i + 1] + n) / 255) * 255;
    d[i + 2] = clamp01((d[i + 2] + n) / 255) * 255;
  }
  g.putImageData(img, 0, 0);
}

// soft coloured blotches (stains, patch repairs, damp)
function blotch(g, s, rnd, { n = 14, r0 = 0.05, r1 = 0.28, hue = '30,10%,40%', alpha = 0.25, colors = null } = {}) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * s, y = rnd() * s, r = s * lerp(r0, r1, rnd());
    const col = colors ? colors[(rnd() * colors.length) | 0] : `hsl(${hue})`;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, col); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.globalAlpha = alpha * (0.5 + rnd() * 0.7); g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.restore();
  }
}

// wandering crack / scratch lines
function cracks(g, s, rnd, { n = 8, steps = 26, len = 6, w = 1.2, color = 'rgba(20,20,20,0.55)', branch = 0.25 } = {}) {
  g.save(); g.strokeStyle = color; g.lineCap = 'round';
  const walk = (x, y, a, depth) => {
    g.lineWidth = w * (1 - depth * 0.3);
    g.beginPath(); g.moveTo(x, y);
    for (let i = 0; i < steps; i++) {
      a += (rnd() - 0.5) * 0.9;
      x += Math.cos(a) * len; y += Math.sin(a) * len;
      g.lineTo(x, y);
      if (depth < 2 && rnd() < branch / steps * 6) walk(x, y, a + (rnd() - 0.5) * 2, depth + 1);
    }
    g.stroke();
  };
  for (let i = 0; i < n; i++) walk(rnd() * s, rnd() * s, rnd() * 7, 0);
  g.restore();
}

// vertical grime running down a surface
function streaks(g, s, rnd, { n = 26, alpha = 0.12, color = '20,18,14', wmax = 10 } = {}) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * s, y = rnd() * s * 0.5, h = s * (0.15 + rnd() * 0.7), w = 1 + rnd() * wmax;
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, `rgba(${color},${alpha * (0.5 + rnd())})`);
    grd.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = grd; g.fillRect(x, y, w, h);
  }
}

function speckle(g, s, rnd, { n = 3000, r = 1.6, light = 0.25, dark = 0.25 } = {}) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * s, y = rnd() * s, rr = r * (0.4 + rnd());
    const up = rnd() < 0.5;
    g.fillStyle = up ? `rgba(255,255,255,${light * rnd()})` : `rgba(0,0,0,${dark * rnd()})`;
    g.beginPath(); g.arc(x, y, rr, 0, 7); g.fill();
  }
}

// Per-pixel stone aggregate. Same read as thousands of tiny arcs, but it is a
// single ImageData pass — the map covers a lot of ground with road surfaces and
// canvas path-fills are the single most expensive thing in this file.
function aggregate(g, s, rnd, { density = 0.2, light = 44, dark = 16, warm = 6 } = {}) {
  const img = g.getImageData(0, 0, s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = rnd();
    if (k < density) {
      const v = rnd() * light;
      d[i] = clamp01((d[i] + v + warm) / 255) * 255;
      d[i + 1] = clamp01((d[i + 1] + v) / 255) * 255;
      d[i + 2] = clamp01((d[i + 2] + v * 0.8) / 255) * 255;
    } else if (k < density + 0.14) {
      const v = rnd() * dark;
      d[i] = clamp01((d[i] - v) / 255) * 255;
      d[i + 1] = clamp01((d[i + 1] - v) / 255) * 255;
      d[i + 2] = clamp01((d[i + 2] - v) / 255) * 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function brickCourse(g, s, rnd, o) {
  const { rows = 16, cols = 8, mortar = '#9a958c', h0 = 14, h1 = 26, sat0 = 18, sat1 = 34, hue = 14, lig = 4, gap = 0.06 } = o;
  g.fillStyle = mortar; g.fillRect(0, 0, s, s);
  const bh = s / rows, bw = s / cols, gx = bw * gap, gy = bh * gap * 1.6;
  for (let y = 0; y < rows; y++) {
    for (let x = -1; x <= cols; x++) {
      const ox = (y % 2) * bw / 2;
      const H = hue + (rnd() - 0.5) * h1 * 0.5 + (h1 - h0) * 0;
      const S = sat0 + rnd() * (sat1 - sat0);
      const L = lig + rnd() * 7;
      g.fillStyle = `hsl(${H} ${S}% ${L}%)`;
      g.fillRect(x * bw + ox + gx, y * bh + gy, bw - gx * 2, bh - gy * 2);
      // per-brick tonal noise
      if (rnd() < 0.35) {
        g.fillStyle = `hsla(${H} ${S}% ${L + (rnd() < 0.5 ? -3.5 : 4.5)}% / 0.42)`;
        g.fillRect(x * bw + ox + gx, y * bh + gy + bh * rnd() * 0.4, bw - gx * 2, bh * 0.35);
      }
    }
  }
}

function brickHeight(g, s, o) {
  const { rows = 16, cols = 8, gap = 0.06 } = o;
  g.fillStyle = '#4a4a4a'; g.fillRect(0, 0, s, s); // mortar recessed
  const bh = s / rows, bw = s / cols, gx = bw * gap, gy = bh * gap * 1.6;
  for (let y = 0; y < rows; y++) for (let x = -1; x <= cols; x++) {
    const ox = (y % 2) * bw / 2;
    g.fillStyle = '#c8c8c8';
    g.fillRect(x * bw + ox + gx, y * bh + gy, bw - gx * 2, bh - gy * 2);
  }
}

/* ---------------------------------------------------- macro de-tiling ---- */

// A 4 m masonry tile repeated across a 30 m facade is obvious the moment the
// eye finds a landmark and then sees it again 4 m later. Detail in the tile
// cannot fix that — the give-away is at a much lower frequency than the tile.
// So modulate albedo, roughness and a little hue with smooth noise driven by
// WORLD position, at scales of roughly 3 m, 9 m and 30 m. Costs a handful of
// sines per fragment and no extra texture memory, and it kills the repeat at
// every distance at once. `amt` scales the whole effect per material.
function macroVariation(m, o) {
  const amt = (typeof o === 'number' ? o : o.amt) ?? 1.0;
  const warm = (o && o.warm) ?? 0.06;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, renderer) => {
    if (prev) prev(sh, renderer);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvMacroPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vMacroPos;
float macroWave(vec3 p, float f, float ph) {
  return sin(p.x * f + ph) * sin(p.y * f * 0.83 + ph * 1.7) * sin(p.z * f * 1.11 + ph * 2.3);
}
float macroNoise(vec3 p) {
  // three octaves of separable sine noise -> smooth, non-repeating at map scale
  float v = 0.50 * macroWave(p, 0.33, 0.0)
          + 0.32 * macroWave(p, 0.11, 2.1)
          + 0.18 * macroWave(p, 0.041, 4.3);
  return clamp(v * 0.5 + 0.5, 0.0, 1.0);
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float mv = macroNoise(vMacroPos);
  float mv2 = macroNoise(vMacroPos.zxy * 1.37 + 11.0);
  // brightness: the dominant cue, so it gets the widest swing
  diffuseColor.rgb *= mix(0.74, 1.22, mv) * ${amt.toFixed(3)} + (1.0 - ${amt.toFixed(3)});
  // and a slow warm/cool drift so patches of wall differ in hue, not just value
  diffuseColor.r *= 1.0 + (mv2 - 0.5) * ${(warm * 2).toFixed(3)} * ${amt.toFixed(3)};
  diffuseColor.b *= 1.0 - (mv2 - 0.5) * ${(warm * 2.6).toFixed(3)} * ${amt.toFixed(3)};
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{
  float mr = macroNoise(vMacroPos * 0.71 + 5.0);
  roughnessFactor = clamp(roughnessFactor * mix(0.84, 1.14, mr), 0.04, 1.0);
}`);
  };
  // NOTE: three's default customProgramCacheKey reads `this.onBeforeCompile`,
  // so it must be invoked with the material as its receiver — calling the
  // captured reference bare throws during renderer.compile().
  const key = `macro${amt}_${warm}`;
  const base = m.customProgramCacheKey;
  m.customProgramCacheKey = function () { return base.call(this) + key; };
  return m;
}

/* ------------------------------------------------------- map construction */

function texture(canvas, srgb, tile) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// tangent-space normal from a height canvas (wrapping sobel)
function normalCanvas(hc, strength) {
  const s = hc.width;
  const src = hc.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, s, s).data;
  const out = CV(s), og = out.getContext('2d', { willReadFrequently: true });
  const img = og.createImageData(s, s), d = img.data;
  const H = (x, y) => src[((((y % s) + s) % s) * s + (((x % s) + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (H(x - 1, y - 1) + 2 * H(x - 1, y) + H(x - 1, y + 1)) - (H(x + 1, y - 1) + 2 * H(x + 1, y) + H(x + 1, y + 1));
      const dy = (H(x - 1, y - 1) + 2 * H(x, y - 1) + H(x + 1, y - 1)) - (H(x - 1, y + 1) + 2 * H(x, y + 1) + H(x + 1, y + 1));
      let nx = dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * s + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  return out;
}

// cheap box-blurred, inverted height = cavity AO
function aoCanvas(hc, strength) {
  const s = hc.width;
  const blur = CV(s), bg = blur.getContext('2d', { willReadFrequently: true });
  bg.filter = `blur(${Math.max(1, s / 96)}px)`;
  bg.drawImage(hc, 0, 0);
  bg.filter = 'none';
  const src = bg.getImageData(0, 0, s, s);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = 1 - (1 - d[i] / 255) * strength;
    d[i] = d[i + 1] = d[i + 2] = clamp01(v) * 255;
  }
  bg.putImageData(src, 0, 0);
  return blur;
}

// roughness from albedo luminance + height, remapped into [r0,r1]
function roughCanvas(albedo, height, r0, r1, rnd, fbmAmt) {
  const s = albedo.width;
  const a = albedo.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, s, s).data;
  const h = height ? height.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, s, s).data : null;
  const out = CV(s), og = out.getContext('2d', { willReadFrequently: true });
  const img = og.createImageData(s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const L = (a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11) / 255;
    const hv = h ? h[i] / 255 : 0.5;
    const v = clamp01(lerp(r1, r0, clamp01(L * 0.65 + hv * 0.35)));
    d[i] = d[i + 1] = d[i + 2] = v * 255; d[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  if (fbmAmt) { og.save(); og.globalAlpha = fbmAmt; fbm(og, s, rnd, { octaves: 3, cells: 3, amp: 0.7 }); og.restore(); }
  return out;
}

/* --------------------------------------------------------------- library */
// tile  : metres covered by one texture repeat (world.js projects UVs with it)
// size  : canvas resolution
// albedo(g,s,rnd) : paint base colour
// height(g,s,rnd) : optional; defaults to a desaturated copy of albedo
// r0/r1 : roughness at white / black luminance
// nrm   : normal strength, ao: cavity AO strength

const DEFS = {

  // Worn road asphalt — the map's single biggest surface, so the aggregate is
  // painted per-pixel (see `aggregate`) instead of with 10k canvas arcs.
  road: {
    // NOTE: the normal strength here is deliberately low. Asphalt aggregate is
    // 5–10 mm of relief seen from 1.6 m up; anything stronger and the near field
    // reads as textured rubber matting rather than road.
    tile: 6, size: 512, r0: 0.74, r1: 0.99, nrm: 0.34, ao: 0.16, metal: 0, roughFbm: 0.28,
    albedo(g, s, rnd) {
      g.fillStyle = '#25272b'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 3, amp: 0.34 });
      aggregate(g, s, rnd, { density: 0.22, light: 46, dark: 18, warm: 7 });
      // patch repairs — darker/lighter rectangles of newer tarmac
      for (let i = 0; i < 5; i++) {
        const x = rnd() * s, y = rnd() * s, w = s * (0.12 + rnd() * 0.32), h = s * (0.08 + rnd() * 0.26);
        g.save(); g.globalAlpha = 0.32; g.fillStyle = rnd() < 0.5 ? '#191b1e' : '#34363b';
        g.fillRect(x, y, w, h); g.restore();
      }
      cracks(g, s, rnd, { n: 6, steps: 26, len: 10, w: 1.5, color: 'rgba(12,12,14,0.72)' });
      cracks(g, s, rnd, { n: 3, steps: 18, len: 8, w: 3.2, color: 'rgba(44,46,50,0.38)' });
      blotch(g, s, rnd, { n: 9, r0: 0.06, r1: 0.22, colors: ['#101012', '#3b3b39', '#2b2722'], alpha: 0.3 });
      grain(g, s, rnd, 22);
    },
    height(g, s, rnd) {
      g.fillStyle = '#7d7d7d'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 3, cells: 6, amp: 0.28 });
      aggregate(g, s, rnd, { density: 0.26, light: 42, dark: 16, warm: 0 });
      // the only relief that should read at distance is the cracking
      cracks(g, s, rnd, { n: 6, steps: 26, len: 10, w: 2.1, color: 'rgba(0,0,0,0.85)' });
    },
  },

  asphalt: {
    tile: 7, size: 512, r0: 0.72, r1: 0.99, nrm: 0.4, ao: 0.18, metal: 0, roughFbm: 0.25,
    albedo(g, s, rnd) {
      g.fillStyle = '#26282c'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 3, amp: 0.35 });
      // aggregate
      for (let i = 0; i < 5200; i++) {
        const x = rnd() * s, y = rnd() * s, r = 0.7 + rnd() * 2.1;
        const l = 18 + rnd() * 34;
        g.fillStyle = `hsl(${25 + rnd() * 20} ${3 + rnd() * 6}% ${l}%)`;
        g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
      // patch repairs (darker rectangles with soft edges)
      for (let i = 0; i < 4; i++) {
        const x = rnd() * s, y = rnd() * s, w = s * (0.12 + rnd() * 0.3), h = s * (0.08 + rnd() * 0.25);
        g.save(); g.globalAlpha = 0.35; g.fillStyle = rnd() < 0.5 ? '#191b1e' : '#33353a';
        g.fillRect(x, y, w, h); g.restore();
      }
      cracks(g, s, rnd, { n: 7, steps: 30, len: 9, w: 1.6, color: 'rgba(12,12,14,0.75)' });
      cracks(g, s, rnd, { n: 4, steps: 20, len: 7, w: 3.4, color: 'rgba(40,42,46,0.4)' });
      blotch(g, s, rnd, { n: 8, r0: 0.06, r1: 0.2, colors: ['#101012', '#3a3a38'], alpha: 0.3 });
      grain(g, s, rnd, 26);
    },
    height(g, s, rnd) {
      g.fillStyle = '#7d7d7d'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 3, cells: 6, amp: 0.5 });
      for (let i = 0; i < 5200; i++) {
        const x = rnd() * s, y = rnd() * s, r = 0.7 + rnd() * 2.1;
        g.fillStyle = `rgba(255,255,255,${0.08 + rnd() * 0.22})`;
        g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
      cracks(g, s, rnd, { n: 7, steps: 30, len: 9, w: 2.2, color: 'rgba(0,0,0,0.85)' });
    },
  },

  concrete: {
    tile: 4, size: 512, r0: 0.68, r1: 0.95, nrm: 1.1, ao: 0.4, metal: 0, roughFbm: 0.2, macro: { amt: 0.55, warm: 0.03 },
    albedo(g, s, rnd) {
      g.fillStyle = '#8d8a83'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 2, amp: 0.4 });
      blotch(g, s, rnd, { n: 16, r0: 0.08, r1: 0.35, colors: ['#6f6d67', '#9c9a92', '#5f5a51'], alpha: 0.3 });
      // form-work panel seams
      g.strokeStyle = 'rgba(60,58,54,0.5)'; g.lineWidth = 2;
      for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(0, s * i / 3); g.lineTo(s, s * i / 3); g.stroke(); }
      // tie-rod holes
      for (let i = 0; i < 10; i++) {
        const x = rnd() * s, y = rnd() * s;
        g.fillStyle = 'rgba(50,48,44,0.65)'; g.beginPath(); g.arc(x, y, 2.5 + rnd() * 2, 0, 7); g.fill();
      }
      cracks(g, s, rnd, { n: 5, steps: 22, len: 8, w: 1.3, color: 'rgba(48,46,42,0.6)' });
      streaks(g, s, rnd, { n: 22, alpha: 0.11 });
      speckle(g, s, rnd, { n: 1400, r: 1.1, light: 0.2, dark: 0.22 });
      grain(g, s, rnd, 18);
    },
    height(g, s, rnd) {
      g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 4, amp: 0.5 });
      for (let i = 0; i < 900; i++) { // pores
        const x = rnd() * s, y = rnd() * s;
        g.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.5})`;
        g.beginPath(); g.arc(x, y, 0.8 + rnd() * 2.4, 0, 7); g.fill();
      }
      cracks(g, s, rnd, { n: 5, steps: 22, len: 8, w: 1.8, color: 'rgba(0,0,0,0.85)' });
      // chipped corners
      for (let i = 0; i < 6; i++) {
        const x = rnd() * s, y = rnd() * s;
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath(); g.arc(x, y, 3 + rnd() * 7, 0, 7); g.fill();
      }
    },
  },

  concrete_floor: {
    tile: 3, size: 512, r0: 0.6, r1: 0.92, nrm: 0.9, ao: 0.35, metal: 0, roughFbm: 0.3,
    albedo(g, s, rnd) {
      g.fillStyle = '#7d7a73'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 2, amp: 0.35 });
      blotch(g, s, rnd, { n: 14, r0: 0.1, r1: 0.4, colors: ['#615e58', '#8b887f', '#4c4842'], alpha: 0.35 });
      // expansion joints
      g.strokeStyle = 'rgba(45,43,40,0.8)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s, s / 2); g.moveTo(s / 2, 0); g.lineTo(s / 2, s); g.stroke();
      cracks(g, s, rnd, { n: 6, steps: 20, len: 9, w: 1.2, color: 'rgba(40,38,35,0.55)' });
      speckle(g, s, rnd, { n: 1800, r: 1.2, light: 0.16, dark: 0.2 });
      grain(g, s, rnd, 16);
    },
  },

  // Pavement. This is the top surface of every footway in the map, and it was
  // a featureless grey wash at a 2 m repeat — which is why the walkways read as
  // blown-out white ribbons. It is now laid as 600 mm slabs with real joints,
  // slab-to-slab tonal variation, lifted and cracked units, and staining. The
  // joint grid is the single most valuable cue: it gives the pavement scale.
  curb: {
    tile: 1.2, size: 512, r0: 0.66, r1: 0.96, nrm: 1.15, ao: 0.42, metal: 0, macro: { amt: 0.5, warm: 0.03 },
    albedo(g, s, rnd) {
      const n = 2, cw = s / n;                 // 2 slabs per 1.2 m tile = 600 mm
      g.fillStyle = '#54514b'; g.fillRect(0, 0, s, s);   // mortar joint colour
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const L = 44 + rnd() * 14;
          g.fillStyle = `hsl(${36 + rnd() * 14} ${3 + rnd() * 6}% ${L}%)`;
          const j = 3.5;
          g.fillRect(x * cw + j, y * cw + j, cw - j * 2, cw - j * 2);
          // a chipped corner or a sunken edge on some units
          if (rnd() < 0.5) {
            g.fillStyle = `rgba(70,66,60,${0.2 + rnd() * 0.3})`;
            const e = rnd() < 0.5;
            g.fillRect(x * cw + j, y * cw + (e ? j : cw - j - 9), cw - j * 2, 9);
          }
        }
      }
      fbm(g, s, rnd, { octaves: 4, cells: 4, amp: 0.26 });
      blotch(g, s, rnd, { n: 16, r0: 0.04, r1: 0.2, colors: ['#6a675f', '#8e8b82', '#4e4a43'], alpha: 0.28 });
      // grit and gum spots trodden into the surface
      speckle(g, s, rnd, { n: 2600, r: 1.2, light: 0.16, dark: 0.24 });
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(52,50,46,${0.2 + rnd() * 0.35})`;
        g.beginPath(); g.arc(rnd() * s, rnd() * s, 1.5 + rnd() * 4, 0, 7); g.fill();
      }
      cracks(g, s, rnd, { n: 4, steps: 18, len: 9, w: 1.2, color: 'rgba(46,44,40,0.6)' });
      grain(g, s, rnd, 18);
    },
    height(g, s, rnd) {
      const n = 2, cw = s / n;
      g.fillStyle = '#3c3c3c'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const j = 3.5;
        g.fillStyle = `rgb(${196 + (rnd() * 50 | 0)},210,210)`;
        g.fillRect(x * cw + j, y * cw + j, cw - j * 2, cw - j * 2);
      }
      fbm(g, s, rnd, { octaves: 3, cells: 8, amp: 0.22 });
      cracks(g, s, rnd, { n: 4, steps: 18, len: 9, w: 1.8, color: 'rgba(0,0,0,0.8)' });
    },
  },

  plaster: {
    tile: 5, size: 512, r0: 0.66, r1: 0.94, nrm: 1.5, ao: 0.5, metal: 0, roughFbm: 0.2, macro: { amt: 0.8, warm: 0.05 },
    albedo(g, s, rnd) {
      g.fillStyle = '#c8bda6'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 2, amp: 0.3 });
      blotch(g, s, rnd, { n: 18, r0: 0.06, r1: 0.3, colors: ['#b3a78e', '#d6cdb8', '#9d907a'], alpha: 0.3 });
      // blown plaster revealing brick underneath
      for (let i = 0; i < 5; i++) {
        const x = rnd() * s, y = rnd() * s, r = s * (0.06 + rnd() * 0.13);
        g.save();
        g.beginPath();
        for (let a = 0; a < 14; a++) {
          const an = a / 14 * 7, rr = r * (0.6 + rnd() * 0.6);
          a ? g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr) : g.moveTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr);
        }
        g.closePath(); g.clip();
        const bc = CV(128); brickCourse(bc.getContext('2d', { willReadFrequently: true }), 128, rnd, { rows: 6, cols: 3, mortar: '#8e887c', hue: 16, sat0: 22, sat1: 36, lig: 22 });
        g.drawImage(bc, x - r, y - r, r * 2, r * 2);
        g.globalAlpha = 0.35; g.fillStyle = '#4a4238'; g.fillRect(x - r, y - r, r * 2, r * 2);
        g.restore();
      }
      cracks(g, s, rnd, { n: 9, steps: 24, len: 8, w: 1.1, color: 'rgba(72,64,54,0.5)' });
      streaks(g, s, rnd, { n: 30, alpha: 0.1, color: '48,40,30' });
      grain(g, s, rnd, 14);
    },
    height(g, s, rnd) {
      g.fillStyle = '#909090'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 3, amp: 0.55 });
      for (let i = 0; i < 5; i++) {
        const x = rnd() * s, y = rnd() * s, r = s * (0.06 + rnd() * 0.13);
        g.fillStyle = 'rgba(0,0,0,0.75)'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
      cracks(g, s, rnd, { n: 9, steps: 24, len: 8, w: 1.6, color: 'rgba(0,0,0,0.8)' });
    },
  },

  // NOTE on the brick set: the low-frequency staining is deliberately weak.
  // Big blotches are exactly what the eye latches onto as "that patch again"
  // when a 4 m texture repeats across a 20 m facade. Variation between walls
  // comes from per-building tint (world.js) and from grime decals, not from
  // landmarks baked into the tile.
  brick_red: {
    tile: 4, size: 512, r0: 0.7, r1: 0.96, nrm: 1.5, ao: 0.62, metal: 0, macro: { amt: 1.0, warm: 0.07 },
    albedo(g, s, rnd) {
      brickCourse(g, s, rnd, { rows: 16, cols: 8, mortar: '#a49d90', hue: 9, sat0: 18, sat1: 38, lig: 20 });
      blotch(g, s, rnd, { n: 26, r0: 0.03, r1: 0.12, colors: ['#3a2a20', '#6b4a38', '#87796a'], alpha: 0.14 });
      streaks(g, s, rnd, { n: 30, alpha: 0.07, color: '30,22,16' });
      grain(g, s, rnd, 18);
    },
    height(g, s, rnd) { brickHeight(g, s, { rows: 16, cols: 8 }); fbm(g, s, rnd, { octaves: 2, cells: 16, amp: 0.25 }); },
  },

  brick_tan: {
    tile: 4, size: 512, r0: 0.72, r1: 0.96, nrm: 1.5, ao: 0.62, metal: 0, macro: { amt: 1.0, warm: 0.06 },
    albedo(g, s, rnd) {
      brickCourse(g, s, rnd, { rows: 14, cols: 7, mortar: '#b0a897', hue: 34, sat0: 11, sat1: 24, lig: 36 });
      blotch(g, s, rnd, { n: 24, r0: 0.03, r1: 0.12, colors: ['#5b503f', '#9d9179', '#6e6552'], alpha: 0.13 });
      streaks(g, s, rnd, { n: 26, alpha: 0.07, color: '44,38,26' });
      grain(g, s, rnd, 16);
    },
    height(g, s, rnd) { brickHeight(g, s, { rows: 14, cols: 7 }); fbm(g, s, rnd, { octaves: 2, cells: 14, amp: 0.25 }); },
  },

  brick_grey: {
    tile: 4.5, size: 512, r0: 0.72, r1: 0.97, nrm: 1.45, ao: 0.58, metal: 0, macro: { amt: 1.0, warm: 0.05 },
    albedo(g, s, rnd) {
      brickCourse(g, s, rnd, { rows: 12, cols: 6, mortar: '#8f8d88', hue: 30, sat0: 3, sat1: 10, lig: 29 });
      blotch(g, s, rnd, { n: 24, r0: 0.03, r1: 0.13, colors: ['#3e3c39', '#7b7873', '#585550'], alpha: 0.14 });
      streaks(g, s, rnd, { n: 30, alpha: 0.08, color: '26,25,22' });
      grain(g, s, rnd, 16);
    },
    height(g, s, rnd) { brickHeight(g, s, { rows: 12, cols: 6 }); fbm(g, s, rnd, { octaves: 2, cells: 12, amp: 0.25 }); },
  },

  // Fourth course rhythm so neighbouring blocks never share a brick beat.
  brick_buff: {
    tile: 3.2, size: 512, r0: 0.74, r1: 0.97, nrm: 1.4, ao: 0.6, metal: 0, macro: { amt: 1.0, warm: 0.06 },
    albedo(g, s, rnd) {
      brickCourse(g, s, rnd, { rows: 20, cols: 5, mortar: '#9b9484', hue: 26, sat0: 9, sat1: 22, lig: 30, gap: 0.05 });
      blotch(g, s, rnd, { n: 22, r0: 0.03, r1: 0.11, colors: ['#4a4034', '#8d8471', '#5e5648'], alpha: 0.14 });
      streaks(g, s, rnd, { n: 26, alpha: 0.08, color: '38,32,24' });
      grain(g, s, rnd, 16);
    },
    height(g, s, rnd) { brickHeight(g, s, { rows: 20, cols: 5, gap: 0.05 }); fbm(g, s, rnd, { octaves: 2, cells: 20, amp: 0.25 }); },
  },

  corrugated: {
    tile: 2.4, size: 512, r0: 0.35, r1: 0.78, nrm: 1.4, ao: 0.4, metal: 0.75,
    albedo(g, s, rnd) {
      g.fillStyle = '#8d9095'; g.fillRect(0, 0, s, s);
      const ribs = 16, rw = s / ribs;
      for (let i = 0; i < ribs; i++) {
        const grd = g.createLinearGradient(i * rw, 0, (i + 1) * rw, 0);
        grd.addColorStop(0, '#5f636a'); grd.addColorStop(0.45, '#a7acb2');
        grd.addColorStop(0.6, '#9aa0a6'); grd.addColorStop(1, '#565a61');
        g.fillStyle = grd; g.fillRect(i * rw, 0, rw, s);
      }
      // rust creeping up from the bottom and around fixings
      g.save(); g.globalCompositeOperation = 'multiply';
      const rg = g.createLinearGradient(0, s, 0, s * 0.45);
      rg.addColorStop(0, '#7a4a28'); rg.addColorStop(1, '#ffffff');
      g.fillStyle = rg; g.fillRect(0, 0, s, s); g.restore();
      blotch(g, s, rnd, { n: 16, r0: 0.03, r1: 0.16, colors: ['#8a5426', '#5e3a1c', '#a9702f'], alpha: 0.4 });
      // fixing screws every few ribs
      for (let y = 0; y < 4; y++) for (let i = 0; i < ribs; i += 2) {
        const x = i * rw + rw * 0.5, yy = s * (0.12 + y * 0.26);
        g.fillStyle = 'rgba(40,36,32,0.8)'; g.beginPath(); g.arc(x, yy, 2.6, 0, 7); g.fill();
        g.fillStyle = 'rgba(160,110,60,0.35)'; g.beginPath(); g.arc(x, yy + 3, 6, 0, 7); g.fill();
      }
      cracks(g, s, rnd, { n: 4, steps: 14, len: 10, w: 0.8, color: 'rgba(60,50,40,0.4)' });
      grain(g, s, rnd, 12);
    },
    height(g, s, rnd) {
      const ribs = 16, rw = s / ribs;
      for (let i = 0; i < ribs; i++) {
        const grd = g.createLinearGradient(i * rw, 0, (i + 1) * rw, 0);
        grd.addColorStop(0, '#101010'); grd.addColorStop(0.5, '#f0f0f0'); grd.addColorStop(1, '#101010');
        g.fillStyle = grd; g.fillRect(i * rw, 0, rw, s);
      }
      for (let y = 0; y < 4; y++) for (let i = 0; i < ribs; i += 2) {
        g.fillStyle = '#000'; g.beginPath(); g.arc(i * rw + rw * 0.5, s * (0.12 + y * 0.26), 2.6, 0, 7); g.fill();
      }
    },
  },

  // Corroded steel — railings, fire escapes, drainpipes, water tanks.
  // NOTE on scale: this was previously a 1.8 m tile with a 1.6 normal and pits
  // up to 3.4 px across, which put 3 cm blisters over every surface it touched
  // and made a car-sized object read as a boulder of cast iron. Rust pitting is
  // millimetres deep: the tile is now 0.9 m, the pits are fine, and the normal
  // is barely there. It is the colour mottling that should read, not relief.
  rust: {
    tile: 0.9, size: 256, r0: 0.6, r1: 0.95, nrm: 0.45, ao: 0.28, metal: 0.5,
    albedo(g, s, rnd) {
      g.fillStyle = '#6a4b32'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 5, cells: 4, amp: 0.42 });
      blotch(g, s, rnd, { n: 30, r0: 0.02, r1: 0.13, colors: ['#7d5528', '#4a3220', '#8f6535', '#3e3a34'], alpha: 0.32 });
      speckle(g, s, rnd, { n: 3200, r: 1.1, light: 0.14, dark: 0.26 });
      grain(g, s, rnd, 20);
    },
    height(g, s, rnd) {
      g.fillStyle = '#909090'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 6, amp: 0.3 });
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(0,0,0,${0.12 + rnd() * 0.3})`;
        g.beginPath(); g.arc(rnd() * s, rnd() * s, 0.5 + rnd() * 1.3, 0, 7); g.fill();
      }
    },
  },

  // Burnt-out vehicle bodywork. A torched car is NOT rust-orange: the paint has
  // gone to soot and bare blued steel, and the corrosion that follows is a thin
  // brown bloom in the seams, not the whole panel. Kept nearly flat — sheet
  // metal has no relief beyond its own buckling, which is geometry's job.
  // NOTE on values: the first version of this was #232120 at metalness 0.62,
  // which rendered as a featureless black box — a dark albedo under high
  // metalness has almost no diffuse response, so nothing but the environment
  // lights it. Burnt panels are dark but they are still visibly LIT in raking
  // sun: mid-dark grey-brown albedo, mostly dielectric, and rough.
  charred: {
    tile: 1.4, size: 256, r0: 0.52, r1: 0.9, nrm: 0.3, ao: 0.22, metal: 0.16,
    albedo(g, s, rnd) {
      // NOTE on value, take two: #39352f at metalness 0.28 came out as a
      // featureless black slab the moment the wreck stood in shadow, which is
      // where wrecks usually stand. Soot is a dielectric powder — it is dark but
      // it still scatters skylight, and burnt panels always carry pale ash and
      // heat-bleached patches. Base lifted to a mid grey-brown and the darks are
      // now the *blotches*, not the base.
      g.fillStyle = '#605a52'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 4, amp: 0.3 });
      // soot bloom and heat-bleached patches where the paint burned off
      blotch(g, s, rnd, { n: 22, r0: 0.05, r1: 0.26, colors: ['#221f1d', '#4a453f', '#332f2b'], alpha: 0.4 });
      // pale ash and bleached primer sitting on the panels
      blotch(g, s, rnd, { n: 14, r0: 0.04, r1: 0.2, colors: ['#8e887c', '#a09a8e', '#77726a'], alpha: 0.26 });
      // sparse rust bleed — restricted so it never dominates
      blotch(g, s, rnd, { n: 9, r0: 0.02, r1: 0.09, colors: ['#6d4526', '#7d5230'], alpha: 0.3 });
      // blistered paint flakes lifting off
      for (let i = 0; i < 260; i++) {
        const x = rnd() * s, y = rnd() * s, r = 1 + rnd() * 3.5;
        g.fillStyle = rnd() < 0.5 ? 'rgba(150,144,134,0.32)' : 'rgba(20,18,16,0.45)';
        g.beginPath(); g.ellipse(x, y, r, r * (0.5 + rnd()), rnd() * 3, 0, 7); g.fill();
      }
      speckle(g, s, rnd, { n: 2000, r: 1.0, light: 0.12, dark: 0.22 });
      grain(g, s, rnd, 14);
    },
    height(g, s, rnd) {
      g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 6, amp: 0.22 });
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(255,255,255,${0.1 + rnd() * 0.2})`;
        g.beginPath(); g.arc(rnd() * s, rnd() * s, 1 + rnd() * 2.5, 0, 7); g.fill();
      }
    },
  },

  steel: {
    tile: 2, size: 256, r0: 0.24, r1: 0.62, nrm: 0.8, ao: 0.25, metal: 0.95,
    albedo(g, s, rnd) {
      g.fillStyle = '#8b9099'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 4, cells: 3, amp: 0.28 });
      // brushed scratches
      g.save(); g.globalAlpha = 0.25;
      for (let i = 0; i < 400; i++) {
        g.strokeStyle = rnd() < 0.5 ? '#ffffff' : '#3c4149'; g.lineWidth = rnd() * 1.2;
        const y = rnd() * s; g.beginPath(); g.moveTo(rnd() * s, y); g.lineTo(rnd() * s, y + (rnd() - 0.5) * 6); g.stroke();
      }
      g.restore();
      blotch(g, s, rnd, { n: 8, r0: 0.04, r1: 0.16, colors: ['#6b4a2c', '#4a4c50'], alpha: 0.3 });
      grain(g, s, rnd, 12);
    },
  },

  paint_blue: paintDef('#2f5a86', 20),
  paint_green: paintDef('#3d5c3a', 21),
  paint_red: paintDef('#7a2f26', 22),
  paint_yellow: paintDef('#b58a1e', 23),
  paint_white: paintDef('#b9b6ad', 24),

  wood: {
    tile: 2.2, size: 512, r0: 0.62, r1: 0.95, nrm: 1.4, ao: 0.5, metal: 0,
    albedo(g, s, rnd) {
      const planks = 6, ph = s / planks;
      for (let p = 0; p < planks; p++) {
        const base = 26 + rnd() * 12, L = 20 + rnd() * 14;
        g.fillStyle = `hsl(${base} ${26 + rnd() * 12}% ${L}%)`;
        g.fillRect(0, p * ph, s, ph);
        // grain
        g.save(); g.globalAlpha = 0.35;
        for (let i = 0; i < 46; i++) {
          g.strokeStyle = `hsl(${base} ${20 + rnd() * 20}% ${L + (rnd() < 0.5 ? -10 : 9)}%)`;
          g.lineWidth = 0.6 + rnd() * 2.2;
          const y = p * ph + rnd() * ph;
          g.beginPath(); g.moveTo(0, y);
          for (let x = 0; x < s; x += 24) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 2.2);
          g.stroke();
        }
        g.restore();
        // knots
        if (rnd() < 0.6) {
          const kx = rnd() * s, ky = p * ph + ph * (0.3 + rnd() * 0.4);
          for (let r = 9; r > 0; r -= 1.6) {
            g.strokeStyle = `hsla(${base} 34% ${L - 10}% / 0.6)`; g.lineWidth = 1.1;
            g.beginPath(); g.ellipse(kx, ky, r, r * 0.6, 0, 0, 7); g.stroke();
          }
        }
        // gap between planks
        g.fillStyle = 'rgba(20,14,8,0.75)'; g.fillRect(0, p * ph, s, 2.5);
      }
      blotch(g, s, rnd, { n: 10, r0: 0.05, r1: 0.22, colors: ['#2a1c10', '#6a5238'], alpha: 0.22 });
      grain(g, s, rnd, 14);
    },
    height(g, s, rnd) {
      const planks = 6, ph = s / planks;
      for (let p = 0; p < planks; p++) {
        g.fillStyle = `rgb(${170 + (rnd() * 40 | 0)},${170},${170})`; g.fillRect(0, p * ph, s, ph);
        g.fillStyle = '#101010'; g.fillRect(0, p * ph, s, 3);
      }
      fbm(g, s, rnd, { octaves: 3, cells: 8, amp: 0.35 });
    },
  },

  // Crate / pallet timber. `wood` is a 2.2 m tile, which on a 700 mm crate face
  // shows a third of one plank — the crate ends up a flat brown blob with no
  // readable detail, and a stack of them reads as a monolith. This is the same
  // timber at 0.55 m so a crate face carries four boards, visible gaps and
  // stencilled markings.
  plank: {
    tile: 0.55, size: 256, r0: 0.6, r1: 0.94, nrm: 1.0, ao: 0.45, metal: 0,
    albedo(g, s, rnd) {
      const boards = 4, ph = s / boards;
      for (let p = 0; p < boards; p++) {
        const base = 30 + rnd() * 12, L = 34 + rnd() * 14;
        g.fillStyle = `hsl(${base} ${22 + rnd() * 12}% ${L}%)`;
        g.fillRect(0, p * ph, s, ph);
        g.save(); g.globalAlpha = 0.3;
        for (let i = 0; i < 20; i++) {
          g.strokeStyle = `hsl(${base} ${18 + rnd() * 18}% ${L + (rnd() < 0.5 ? -12 : 10)}%)`;
          g.lineWidth = 0.6 + rnd() * 1.6;
          const y = p * ph + rnd() * ph;
          g.beginPath(); g.moveTo(0, y);
          for (let x = 0; x < s; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 1.4);
          g.stroke();
        }
        g.restore();
        // sawn ends, splits and the dark gap between boards
        g.fillStyle = 'rgba(24,17,10,0.8)'; g.fillRect(0, p * ph, s, 2.2);
        g.fillStyle = 'rgba(210,196,168,0.25)'; g.fillRect(0, p * ph + 2.2, s, 1.2);
      }
      // stencilled shipping marks
      g.save();
      g.globalAlpha = 0.3; g.fillStyle = '#241a10';
      g.font = `bold ${s * 0.11}px sans-serif`; g.textAlign = 'center';
      g.fillText('4/7', s * 0.5, s * 0.42);
      g.strokeStyle = '#241a10'; g.lineWidth = 2.4;
      g.strokeRect(s * 0.24, s * 0.56, s * 0.5, s * 0.26);
      g.restore();
      blotch(g, s, rnd, { n: 12, r0: 0.04, r1: 0.18, colors: ['#2f2114', '#7a6242', '#4b3a24'], alpha: 0.26 });
      grain(g, s, rnd, 16);
    },
    height(g, s, rnd) {
      const boards = 4, ph = s / boards;
      for (let p = 0; p < boards; p++) {
        g.fillStyle = `rgb(${168 + (rnd() * 46 | 0)},170,170)`; g.fillRect(0, p * ph, s, ph);
        g.fillStyle = '#101010'; g.fillRect(0, p * ph, s, 2.6);
      }
      fbm(g, s, rnd, { octaves: 3, cells: 10, amp: 0.28 });
    },
  },

  dirt: {
    tile: 5, size: 512, r0: 0.82, r1: 1.0, nrm: 1.5, ao: 0.5, metal: 0,
    albedo(g, s, rnd) {
      g.fillStyle = '#6b5a44'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 5, cells: 2, amp: 0.5 });
      blotch(g, s, rnd, { n: 20, r0: 0.06, r1: 0.3, colors: ['#544730', '#7d6c52', '#41372a'], alpha: 0.35 });
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = `hsl(${30 + rnd() * 20} ${8 + rnd() * 18}% ${18 + rnd() * 34}%)`;
        g.beginPath(); g.arc(rnd() * s, rnd() * s, 0.8 + rnd() * 2.6, 0, 7); g.fill();
      }
      grain(g, s, rnd, 24);
    },
  },

  gravel: {
    tile: 2.6, size: 512, r0: 0.8, r1: 1.0, nrm: 2.2, ao: 0.7, metal: 0,
    albedo(g, s, rnd) {
      g.fillStyle = '#57544d'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 4200; i++) {
        const x = rnd() * s, y = rnd() * s, r = 1.6 + rnd() * 5;
        const L = 22 + rnd() * 32;
        g.fillStyle = `hsl(${34 + rnd() * 18} ${4 + rnd() * 10}% ${L}%)`;
        g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * 3, 0, 7); g.fill();
        g.fillStyle = `rgba(0,0,0,0.25)`;
        g.beginPath(); g.ellipse(x + r * 0.3, y + r * 0.35, r * 0.8, r * 0.5, 0, 0, 7); g.fill();
      }
      grain(g, s, rnd, 20);
    },
    height(g, s, rnd) {
      g.fillStyle = '#3a3a3a'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 4200; i++) {
        const x = rnd() * s, y = rnd() * s, r = 1.6 + rnd() * 5;
        const grd = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        grd.addColorStop(0, '#f4f4f4'); grd.addColorStop(1, '#4a4a4a');
        g.fillStyle = grd; g.beginPath(); g.ellipse(x, y, r, r * 0.75, rnd() * 3, 0, 7); g.fill();
      }
    },
  },

  sand: {
    tile: 4, size: 512, r0: 0.88, r1: 1.0, nrm: 1.0, ao: 0.35, metal: 0,
    albedo(g, s, rnd) {
      g.fillStyle = '#a89372'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 5, cells: 3, amp: 0.35 });
      blotch(g, s, rnd, { n: 14, r0: 0.08, r1: 0.3, colors: ['#8e7a5c', '#bda887'], alpha: 0.3 });
      speckle(g, s, rnd, { n: 4000, r: 1.1, light: 0.3, dark: 0.22 });
      grain(g, s, rnd, 22);
    },
  },

  // Hessian sacking. The weave must stay sub-visible at a metre: it is the
  // slump of the bag that reads, not the cloth. Kept low-contrast with a soft
  // normal so a wall of these does not shimmer or tile.
  sandbag: {
    tile: 0.42, size: 256, r0: 0.9, r1: 1.0, nrm: 0.55, ao: 0.45, metal: 0,
    albedo(g, s, rnd) {
      g.fillStyle = '#8d7d5e'; g.fillRect(0, 0, s, s);
      const step = 3;
      for (let y = 0; y < s; y += step) {
        g.fillStyle = `rgba(74,63,43,${0.08 + rnd() * 0.07})`; g.fillRect(0, y, s, 1.4);
      }
      for (let x = 0; x < s; x += step) {
        g.fillStyle = `rgba(178,161,124,${0.07 + rnd() * 0.07})`; g.fillRect(x, 0, 1.4, s);
      }
      fbm(g, s, rnd, { octaves: 4, cells: 3, amp: 0.42 });
      // damp patches, dust, mildew — this is what breaks the repeat, not the weave
      blotch(g, s, rnd, { n: 22, r0: 0.08, r1: 0.4, colors: ['#5f5236', '#a89873', '#453a28', '#6d6a52'], alpha: 0.4 });
      streaks(g, s, rnd, { n: 14, alpha: 0.14, color: '48,40,26', wmax: 14 });
      grain(g, s, rnd, 20);
    },
    height(g, s, rnd) {
      g.fillStyle = '#808080'; g.fillRect(0, 0, s, s);
      const step = 3;
      for (let y = 0; y < s; y += step) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, y, s, 1.4); }
      for (let x = 0; x < s; x += step) { g.fillStyle = 'rgba(255,255,255,0.24)'; g.fillRect(x, 0, 1.4, s); }
      // slack creases in the cloth
      fbm(g, s, rnd, { octaves: 4, cells: 2, amp: 0.62 });
      cracks(g, s, rnd, { n: 5, steps: 18, len: 12, w: 3.0, color: 'rgba(0,0,0,0.35)' });
    },
  },

  tarp: {
    tile: 2.6, size: 256, r0: 0.55, r1: 0.9, nrm: 1.6, ao: 0.45, metal: 0,
    albedo(g, s, rnd) {
      g.fillStyle = '#4e5f4a'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 4) { g.fillStyle = `rgba(30,38,28,${0.1 + rnd() * 0.1})`; g.fillRect(0, y, s, 2); }
      for (let x = 0; x < s; x += 4) { g.fillStyle = `rgba(120,134,110,${0.1 + rnd() * 0.1})`; g.fillRect(x, 0, 2, s); }
      // folds
      g.save(); g.globalAlpha = 0.35;
      for (let i = 0; i < 7; i++) {
        const x = rnd() * s, w = 8 + rnd() * 30;
        const grd = g.createLinearGradient(x, 0, x + w, 0);
        grd.addColorStop(0, '#1c241a'); grd.addColorStop(0.5, '#7d8c74'); grd.addColorStop(1, '#1c241a');
        g.fillStyle = grd; g.fillRect(x, 0, w, s);
      }
      g.restore();
      blotch(g, s, rnd, { n: 10, r0: 0.05, r1: 0.22, colors: ['#313a2c', '#6c7a62'], alpha: 0.3 });
      grain(g, s, rnd, 12);
    },
  },

  rubber: {
    tile: 1.1, size: 256, r0: 0.7, r1: 0.98, nrm: 2.0, ao: 0.6, metal: 0,
    albedo(g, s, rnd) {
      g.fillStyle = '#1d1e20'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 3, cells: 4, amp: 0.3 });
      // tread blocks
      for (let y = 0; y < s; y += s / 8) {
        for (let x = 0; x < s; x += s / 6) {
          g.fillStyle = `rgba(60,60,64,${0.35 + rnd() * 0.25})`;
          g.fillRect(x + 3, y + 3, s / 6 - 8, s / 8 - 8);
        }
      }
      speckle(g, s, rnd, { n: 1200, r: 1, light: 0.1, dark: 0.3 });
      grain(g, s, rnd, 10);
    },
    height(g, s, rnd) {
      g.fillStyle = '#303030'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += s / 8) for (let x = 0; x < s; x += s / 6) {
        g.fillStyle = '#e0e0e0'; g.fillRect(x + 3, y + 3, s / 6 - 8, s / 8 - 8);
      }
    },
  },
};

function paintDef(hex, seedSalt) {
  return {
    tile: 1.6, size: 256, r0: 0.3, r1: 0.72, nrm: 1.2, ao: 0.35, metal: 0.35, paint: hex, salt: seedSalt,
    albedo(g, s, rnd) {
      g.fillStyle = hex; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 3, cells: 3, amp: 0.22 });
      // chipped paint revealing primer + rust
      for (let i = 0; i < 90; i++) {
        const x = rnd() * s, y = rnd() * s, r = 1 + rnd() * 6;
        g.fillStyle = rnd() < 0.5 ? 'rgba(120,78,42,0.75)' : 'rgba(72,70,68,0.6)';
        g.beginPath();
        for (let a = 0; a < 8; a++) {
          const an = a / 8 * 7, rr = r * (0.5 + rnd());
          a ? g.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr) : g.moveTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr);
        }
        g.closePath(); g.fill();
      }
      // scratches
      g.save(); g.globalAlpha = 0.3;
      for (let i = 0; i < 120; i++) {
        g.strokeStyle = rnd() < 0.5 ? '#d8d2c6' : '#241c14'; g.lineWidth = rnd() * 1.4;
        const x = rnd() * s, y = rnd() * s;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 14); g.stroke();
      }
      g.restore();
      streaks(g, s, rnd, { n: 16, alpha: 0.16, color: '38,26,14', wmax: 5 });
      blotch(g, s, rnd, { n: 8, r0: 0.05, r1: 0.2, colors: ['#7a4a24', '#2a2622'], alpha: 0.3 });
      grain(g, s, rnd, 10);
    },
    height(g, s, rnd) {
      g.fillStyle = '#a0a0a0'; g.fillRect(0, 0, s, s);
      fbm(g, s, rnd, { octaves: 3, cells: 5, amp: 0.4 });
      for (let i = 0; i < 90; i++) {
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.beginPath(); g.arc(rnd() * s, rnd() * s, 1 + rnd() * 5, 0, 7); g.fill();
      }
    },
  };
}

/* ------------------------------------------------------------------ class */

export class Materials {
  constructor(ctx) { this.ctx = ctx; this.cache = new Map(); }

  get(name) {
    if (!this.cache.has(name)) this.cache.set(name, this.build(name));
    return this.cache.get(name);
  }

  /** metres covered by one texture repeat (used by world.js for world-scale UVs) */
  tile(name) { const d = DEFS[name]; return d ? d.tile : 2; }

  build(name) {
    if (DEFS[name]) return this.fromDef(name, DEFS[name]);
    switch (name) {
      case 'glass': return this.glass();
      case 'glass_broken': return this.glass(true);
      case 'window': return this.windowGlass({ depth: 0.8 });
      case 'window_deep': return this.windowGlass({ depth: 1.15, env: 2.4 });
      case 'window_broken': return this.windowGlass({ depth: 0.8, broken: true, rough: 0.34, env: 1.3 });
      case 'decal_grime': return this.decalGrime('base');
      case 'decal_drip': return this.decalGrime('drip');
      case 'decal_ao': return this.decalAO();
      case 'roadline': return this.roadline();
      case 'chainlink': return this.chainlink();
      case 'signs': return this.signs();
      case 'decal_dirt': return this.decalDirt();
      case 'foliage': return this.foliage();
      case 'black': return new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9, metalness: 0, vertexColors: true });
      case 'light_emissive': return new THREE.MeshStandardMaterial({ color: 0xffe9c0, emissive: 0xffd9a0, emissiveIntensity: 2.4, roughness: 0.4, vertexColors: true });
      // legacy aliases kept so other modules keep working
      case 'brick': return this.get('brick_red');
      case 'metal': return this.get('steel');
      default: return new THREE.MeshStandardMaterial({ color: 0x8b8880, roughness: 0.85, vertexColors: true });
    }
  }

  fromDef(name, def) {
    const rnd = seeded(name + '|' + (this.ctx.config?.seed || 0));
    const s = def.size || 256;
    const ac = CV(s); def.albedo(ac.getContext('2d', { willReadFrequently: true }), s, rnd);
    let hc;
    if (def.height) { hc = CV(s); def.height(hc.getContext('2d', { willReadFrequently: true }), s, rnd); }
    else {
      hc = CV(s); const hg = hc.getContext('2d', { willReadFrequently: true });
      hg.filter = 'grayscale(1) contrast(1.35)';
      hg.drawImage(ac, 0, 0);
      hg.filter = 'none';
    }

    const map = texture(ac, true);
    const normalMap = texture(normalCanvas(hc, def.nrm ?? 1), false);
    const roughnessMap = texture(roughCanvas(ac, hc, def.r0 ?? 0.5, def.r1 ?? 0.95, rnd, def.roughFbm || 0), false);
    const m = new THREE.MeshStandardMaterial({
      map, normalMap, roughnessMap,
      metalness: def.metal ?? 0,
      roughness: 1.0,
      normalScale: new THREE.Vector2(1, 1),
      vertexColors: true,
      envMapIntensity: def.metal > 0.4 ? 1.1 : 0.75,
    });
    if (def.ao) { m.aoMap = texture(aoCanvas(hc, def.ao), false); m.aoMapIntensity = 1.0; }
    if (def.macro) macroVariation(m, def.macro);
    m.userData.tile = def.tile;
    return m;
  }

  glass(broken = false) {
    const rnd = seeded('glass' + broken);
    const s = 256;
    const ac = CV(s), g = ac.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#0d1620'; g.fillRect(0, 0, s, s);
    // grime, water streaks, dust in the corners
    streaks(g, s, rnd, { n: 40, alpha: 0.16, color: '190,190,180', wmax: 6 });
    blotch(g, s, rnd, { n: 16, r0: 0.05, r1: 0.28, colors: ['#5a5c52', '#2a3038'], alpha: 0.2 });
    g.save(); g.globalAlpha = 0.35;
    const vg = g.createLinearGradient(0, 0, 0, s);
    vg.addColorStop(0, 'rgba(150,150,140,0.5)'); vg.addColorStop(0.5, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(150,150,140,0.4)');
    g.fillStyle = vg; g.fillRect(0, 0, s, s); g.restore();
    if (broken) cracks(g, s, rnd, { n: 5, steps: 12, len: 18, w: 1.6, color: 'rgba(230,230,235,0.75)', branch: 0.9 });
    const rc = CV(s), rg = rc.getContext('2d', { willReadFrequently: true });
    rg.fillStyle = '#1a1a1a'; rg.fillRect(0, 0, s, s);
    rg.save(); rg.globalAlpha = 0.85; fbm(rg, s, rnd, { octaves: 4, cells: 3, amp: 0.6, op: 'lighter' }); rg.restore();
    const m = new THREE.MeshPhysicalMaterial({
      map: texture(ac, true),
      roughnessMap: texture(rc, false),
      color: 0xffffff, roughness: 1.0, metalness: 0.1,
      transparent: true, opacity: 0.62, envMapIntensity: 2.2,
      side: THREE.DoubleSide, vertexColors: true,
    });
    m.userData.tile = 3;
    return m;
  }

  // Road markings. Authored UVs: u runs ALONG the line (world.js repeats it
  // every ~2 m via uvRect), v runs across its width. Painted as worn
  // thermoplastic: never pure white, scrubbed thin by tyres down the middle,
  // chipped at the edges and broken away completely in places.
  roadline() {
    const rnd = seeded('roadline');
    const s = 256;
    const ac = CV(s), g = ac.getContext('2d', { willReadFrequently: true });
    // grubby off-white; rubber and grit have greyed it
    g.fillStyle = '#8e8a7e'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 220; i++) {
      const y = rnd() * s, h = 1 + rnd() * 5;
      g.fillStyle = `hsla(${38 + rnd() * 12} ${4 + rnd() * 10}% ${44 + rnd() * 34}% / ${0.25 + rnd() * 0.5})`;
      g.fillRect(0, y, s, h);
    }
    fbm(g, s, rnd, { octaves: 4, cells: 4, amp: 0.4 });
    // tyre scuffing: dark rubber laid across the middle of the line
    g.save(); g.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 9; i++) {
      const y = s * (0.18 + rnd() * 0.64), h = s * (0.1 + rnd() * 0.3), x = rnd() * s, w = s * (0.15 + rnd() * 0.6);
      const grd = g.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.5, `rgba(90,86,80,${0.5 + rnd() * 0.4})`); grd.addColorStop(1, '#ffffff');
      g.fillStyle = grd; g.fillRect(x, y, w, h);
    }
    g.restore();
    grain(g, s, rnd, 26);

    const al = CV(s), ag = al.getContext('2d', { willReadFrequently: true });
    ag.fillStyle = '#fff'; ag.fillRect(0, 0, s, s);
    // feathered long edges — paint never ends in a razor line
    ag.save(); ag.globalCompositeOperation = 'destination-out';
    for (const [y0, y1] of [[0, s * 0.1], [s * 0.9, s]]) {
      const grd = ag.createLinearGradient(0, y0, 0, y1);
      grd.addColorStop(y0 === 0 ? 0 : 1, 'rgba(255,255,255,0.95)');
      grd.addColorStop(y0 === 0 ? 1 : 0, 'rgba(255,255,255,0)');
      ag.fillStyle = grd; ag.fillRect(0, y0, s, y1 - y0);
    }
    // chips, pitting and scrubbed-away patches
    for (let i = 0; i < 520; i++) {
      ag.globalAlpha = 0.3 + rnd() * 0.7;
      ag.beginPath(); ag.ellipse(rnd() * s, rnd() * s, 1 + rnd() * 7, 1 + rnd() * 14, 0, 0, 7); ag.fill();
    }
    // a couple of hard breaks where the line has gone entirely
    for (let i = 0; i < 2; i++) {
      ag.globalAlpha = 0.8 + rnd() * 0.2;
      const x = rnd() * s, w = s * (0.06 + rnd() * 0.12);
      const grd = ag.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      ag.fillStyle = grd; ag.fillRect(x, 0, w, s);
    }
    ag.restore();
    ag.save(); ag.globalAlpha = 0.5; fbm(ag, s, rnd, { octaves: 4, cells: 4, amp: 0.75, op: 'multiply' }); ag.restore();

    const m = new THREE.MeshStandardMaterial({
      map: texture(ac, true), alphaMap: texture(al, false),
      transparent: true, alphaTest: 0.42, roughness: 0.92, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexColors: true, depthWrite: false,
    });
    m.userData.tile = 0; // keep authored UVs
    return m;
  }

  /* ------------------------------------------------------------- windows */

  // Reflective glazing with a parallax-mapped room behind it. One quad per
  // window: the fragment shader walks the view ray into a virtual box and
  // shades the wall/floor/ceiling it hits, so the interior has real depth and
  // slides correctly as the camera moves. The PBR specular on top is what
  // catches the sky.
  windowGlass(o = {}) {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: o.rough ?? 0.07,
      metalness: 0.04,
      envMapIntensity: o.env ?? 3.8,
      vertexColors: true,
    });
    m.defines = { WIN_DEPTH: (o.depth ?? 0.55).toFixed(3), WIN_BROKEN: o.broken ? 1 : 0 };
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWinUv;\nvarying vec3 vWinWPos;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvWinUv = uv;\nvWinWPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec2 vWinUv;
varying vec3 vWinWPos;
float winHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
vec3 winRoom(vec2 uv, vec3 rd, vec3 T, vec3 Bt, vec3 Nn, float id) {
  // ray in room space: x = u, y = v, z = depth into the wall (metres-ish)
  float a = dot(rd, T) / max(dot(T, T), 1e-6);
  float b = dot(rd, Bt) / max(dot(Bt, Bt), 1e-6);
  float c = -dot(rd, Nn);
  vec3 ro = vec3(uv, 0.0);
  vec3 dir = vec3(a, b, max(c, 1e-4));
  vec3 ad = max(abs(dir), vec3(1e-4));
  vec3 sd = vec3(dir.x < 0.0 ? -1.0 : 1.0, dir.y < 0.0 ? -1.0 : 1.0, 1.0);
  vec3 inv = sd / ad;
  vec3 t2 = (vec3(1.0, 1.0, WIN_DEPTH) - ro) * inv;
  vec3 t1 = (vec3(0.0, 0.0, 0.0) - ro) * inv;
  vec3 tm = max(t1, t2);
  float t = min(min(tm.x, tm.y), tm.z);
  vec3 hit = ro + dir * t;
  float depth01 = clamp(hit.z / float(WIN_DEPTH), 0.0, 1.0);

  // per-room palette
  float h1 = winHash(vec2(id, 3.7));
  float h2 = winHash(vec2(id * 1.7, 9.1));
  float h3 = winHash(vec2(id * 2.3, 17.3));
  vec3 wallCol = mix(vec3(0.052, 0.044, 0.036), vec3(0.070, 0.066, 0.062), h1);
  wallCol *= 0.55 + 0.9 * h2;

  vec3 col;
  if (t == tm.z) {           // back wall
    col = wallCol;
    // a doorway / far window letting a sliver of light through
    float dw = step(0.30 + 0.3 * h3, hit.x) * step(hit.x, 0.52 + 0.3 * h3) * step(hit.y, 0.55);
    col = mix(col, vec3(0.18, 0.15, 0.12) * (0.4 + h1), dw * 0.8);
  } else if (t == tm.x) {    // side wall
    col = wallCol * 0.7;
  } else if (hit.y < 0.5) {  // floor
    col = wallCol * 0.42;
  } else {                   // ceiling
    col = wallCol * 1.5;
  }
  // light falls off hard away from the opening
  col *= mix(1.0, 0.16, depth01);
  // some rooms are lit
  float lit = step(0.86, h3);
  col += lit * vec3(0.5, 0.36, 0.20) * (1.0 - depth01 * 0.55) * (0.4 + 0.6 * h2);
  // blinds / curtain hanging in front
  float blind = step(h1, 0.34);
  float bl = smoothstep(0.36 + 0.4 * h2, 0.30 + 0.4 * h2, uv.y);
  col = mix(col, vec3(0.10, 0.093, 0.082) * (0.5 + h2), blind * bl * 0.92);

  // ---- the joinery, drawn at the glass plane in front of the room.
  // Without a frame and mullions the pane is a featureless dark hole; these
  // few bars are most of what says "window" at 40 m.
  vec2 e = min(uv, 1.0 - uv);
  float edge = min(e.x, e.y);
  float mull = min(abs(uv.x - 0.5), abs(uv.y - (0.62 + 0.08 * h2)));
  float frame = 1.0 - smoothstep(0.030, 0.052, edge);
  float bars = 1.0 - smoothstep(0.012, 0.024, mull);
  float joinery = clamp(frame + bars, 0.0, 1.0);
  vec3 frameCol = mix(vec3(0.045, 0.042, 0.038), vec3(0.34, 0.33, 0.30), step(0.5, h2));
  col = mix(col, frameCol, joinery);

  // reveal shading: the head and the shaded jamb throw a soft gradient onto the
  // glass, which is what makes a flush pane read as set back into the wall
  float rv = mix(0.42, 1.0, smoothstep(1.0, 0.72, uv.y));   // head shadow, top of the pane
  rv *= mix(0.72, 1.0, smoothstep(0.0, 0.18, uv.x));        // shaded jamb down one side
  col *= rv;
  return col;
}`)
        .replace('#include <map_fragment>', `
{
  vec3 dpx = dFdx(vWinWPos), dpy = dFdy(vWinWPos);
  vec2 dux = dFdx(vWinUv), duy = dFdy(vWinUv);
  float det = dux.x * duy.y - duy.x * dux.y;
  vec3 T = (dpx * duy.y - dpy * dux.y) / (abs(det) < 1e-9 ? 1e-9 : det);
  vec3 Bt = (dpy * dux.x - dpx * duy.x) / (abs(det) < 1e-9 ? 1e-9 : det);
  vec3 Nn = normalize(cross(T, Bt));
  vec3 V = normalize(cameraPosition - vWinWPos);
  if (dot(Nn, V) < 0.0) Nn = -Nn;
  vec3 rd = -V;
  // the room must be constant across the pane, so key it off the window's
  // CENTRE (walk back along the uv basis), never off the fragment position
  vec3 ctr = vWinWPos - (vWinUv.x - 0.5) * T - (vWinUv.y - 0.5) * Bt;
  float id = floor(ctr.x * 2.0) + floor(ctr.y * 2.0) * 37.0 + floor(ctr.z * 2.0) * 91.0;
  vec3 room = winRoom(clamp(fract(vWinUv), 0.001, 0.999), rd, T, Bt, Nn, id);
  #if WIN_BROKEN == 1
    // shattered: mostly a hole, with jagged shards left in the frame
    float sh = winHash(floor(vWinUv * 9.0) + 0.5);
    room *= mix(0.35, 1.0, step(0.55, sh));
  #endif
  diffuseColor.rgb *= room;
}
`);
      // grazing angles must go mirror-flat or the glass never picks up the sky.
      // Hooked after normal_fragment_begin — `normal` does not exist before it.
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `
#include <normal_fragment_begin>
{
  vec3 Vv = normalize(vViewPosition);
  float f = 1.0 - abs(dot(normalize(normal), Vv));
  roughnessFactor = mix(roughnessFactor, 0.015, pow(f, 3.0));
}
`);
    };
    m.userData.noShadowRecv = true;
    m.customProgramCacheKey = () => 'win' + (o.depth ?? 0.55) + (o.broken ? 'b' : '') + (o.rough ?? 0.09);
    m.userData.tile = 0;  // authored UVs (uvRect 0..1 per window)
    return m;
  }

  // Baked contact occlusion: the dark, tight gradient in the crease where an
  // object meets the ground. Without it every prop reads as a sticker hovering
  // a centimetre above the tarmac, and screen-space AO cannot be relied on to
  // find it under thin geometry at grazing angles.
  //
  // Built on exactly the same footing as the dirt and grime decals — a lit
  // standard material with a radial alpha — because that is the decal path this
  // pipeline demonstrably renders. An unlit multiply-blended version looked
  // correct on paper and came out completely invisible: a multiply source has
  // to sit at 1.0 to be a no-op, and the scene's height fog rewrites
  // gl_FragColor toward a bright inscatter, which drags the source to white.
  // Being lit is also the more correct behaviour: occlusion should not make a
  // surface darker than its own shadow.
  decalAO() {
    const rnd = seeded('contactao');
    const s = 128;
    const ac = CV(s), g = ac.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#0b0a09'; g.fillRect(0, 0, s, s);
    fbm(g, s, rnd, { octaves: 3, cells: 3, amp: 0.22 });
    const al = CV(s), ag = al.getContext('2d', { willReadFrequently: true });
    ag.fillStyle = '#000'; ag.fillRect(0, 0, s, s);
    // tight core, long soft tail — the shape real contact occlusion has
    const grd = ag.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1.0)');
    grd.addColorStop(0.24, 'rgba(255,255,255,0.86)');
    grd.addColorStop(0.52, 'rgba(255,255,255,0.42)');
    grd.addColorStop(0.8, 'rgba(255,255,255,0.11)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ag.fillStyle = grd; ag.fillRect(0, 0, s, s);
    // break the perfect circle so it never reads as an airbrushed disc
    ag.save(); ag.globalAlpha = 0.2; fbm(ag, s, rnd, { octaves: 3, cells: 4, amp: 0.6, op: 'multiply' }); ag.restore();
    const m = new THREE.MeshStandardMaterial({
      map: texture(ac, true), alphaMap: texture(al, false), transparent: true,
      roughness: 1.0, metalness: 0, depthWrite: false, vertexColors: true,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    m.userData.tile = 0;
    return m;
  }

  // Grime that gathers where a wall meets the pavement, plus water staining
  // running down from sills. Alpha-faded upward so there is no hard line.
  decalGrime(kind = 'base') {
    const rnd = seeded('grime' + kind);
    const s = 256;
    const ac = CV(s), g = ac.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#211d17'; g.fillRect(0, 0, s, s);
    fbm(g, s, rnd, { octaves: 4, cells: 3, amp: 0.55 });
    blotch(g, s, rnd, { n: 14, r0: 0.05, r1: 0.3, colors: ['#141210', '#3b352b', '#2a2a26'], alpha: 0.4 });

    const al = CV(s), ag = al.getContext('2d', { willReadFrequently: true });
    ag.fillStyle = '#000'; ag.fillRect(0, 0, s, s);
    // canvas y=s is the bottom of the quad (textures flip Y). 'base' grime is
    // dense at the pavement and fades up; 'drip' runs down from a sill.
    const solidY = kind === 'drip' ? 0 : s;
    const grd = ag.createLinearGradient(0, solidY, 0, s - solidY);
    grd.addColorStop(0, kind === 'drip' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.92)');
    grd.addColorStop(0.22, 'rgba(255,255,255,0.45)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.14)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ag.fillStyle = grd; ag.fillRect(0, 0, s, s);
    // splash tongues licking up the wall / drip fingers running down it
    for (let i = 0; i < 46; i++) {
      const x = rnd() * s, w = 2 + rnd() * (kind === 'drip' ? 9 : 16), h = s * (0.1 + rnd() * 0.5);
      const y0 = kind === 'drip' ? 0 : s - h;
      const lg = ag.createLinearGradient(0, solidY, 0, kind === 'drip' ? h : s - h);
      lg.addColorStop(0, `rgba(255,255,255,${0.25 + rnd() * 0.5})`);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ag.fillStyle = lg; ag.fillRect(x, y0, w, h);
    }
    ag.save(); ag.globalAlpha = 0.6; fbm(ag, s, rnd, { octaves: 4, cells: 3, amp: 0.8, op: 'multiply' }); ag.restore();

    const m = new THREE.MeshStandardMaterial({
      map: texture(ac, true), alphaMap: texture(al, false), transparent: true,
      roughness: 0.98, metalness: 0, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, vertexColors: true,
    });
    m.userData.tile = 0;
    return m;
  }

  chainlink() {
    const s = 128;
    const ac = CV(s), g = ac.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#8a8f94'; g.fillRect(0, 0, s, s);
    const al = CV(s), ag = al.getContext('2d', { willReadFrequently: true });
    ag.fillStyle = '#000'; ag.fillRect(0, 0, s, s);
    ag.strokeStyle = '#fff'; ag.lineWidth = 4;
    for (let i = -1; i < 5; i++) {
      ag.beginPath();
      for (let y = 0; y <= s; y += s / 4) { ag.lineTo(i * s / 4 + (y / (s / 4) % 2 ? s / 4 : 0), y); }
      ag.stroke();
      ag.beginPath();
      for (let y = 0; y <= s; y += s / 4) { ag.lineTo(i * s / 4 + (y / (s / 4) % 2 ? 0 : s / 4), y); }
      ag.stroke();
    }
    const m = new THREE.MeshStandardMaterial({
      map: texture(ac, true), alphaMap: texture(al, false),
      transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
      roughness: 0.55, metalness: 0.8, vertexColors: true,
    });
    m.userData.tile = 1.2;
    return m;
  }

  // 2x2 atlas of road signs — world.js picks a quadrant per sign quad
  signs() {
    const s = 512, h = s / 2;
    const ac = CV(s), g = ac.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#6e7278'; g.fillRect(0, 0, s, s);
    const rnd = seeded('signs');
    // 0,0 red stop-ish octagon
    g.save(); g.translate(h * 0.5, h * 0.5);
    g.fillStyle = '#8d2018'; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = i / 8 * 7 + 0.39; g.lineTo(Math.cos(a) * h * 0.42, Math.sin(a) * h * 0.42); }
    g.closePath(); g.fill();
    g.strokeStyle = '#d8d4cc'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#e6e2da'; g.font = `bold ${h * 0.22}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('STOP', 0, 0); g.restore();
    // 1,0 yellow warning diamond
    g.save(); g.translate(h * 1.5, h * 0.5); g.rotate(Math.PI / 4);
    g.fillStyle = '#c9a41c'; g.fillRect(-h * 0.3, -h * 0.3, h * 0.6, h * 0.6);
    g.strokeStyle = '#20201c'; g.lineWidth = 5; g.strokeRect(-h * 0.3, -h * 0.3, h * 0.6, h * 0.6);
    g.rotate(-Math.PI / 4);
    g.fillStyle = '#20201c'; g.font = `bold ${h * 0.34}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('!', 0, 0); g.restore();
    // 0,1 blue street plate
    g.save(); g.translate(h * 0.5, h * 1.5);
    g.fillStyle = '#1e4270'; g.fillRect(-h * 0.46, -h * 0.16, h * 0.92, h * 0.32);
    g.strokeStyle = '#dcd8d0'; g.lineWidth = 4; g.strokeRect(-h * 0.44, -h * 0.14, h * 0.88, h * 0.28);
    g.fillStyle = '#e8e4dc'; g.font = `bold ${h * 0.15}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('AL MAZRAH', 0, 0); g.restore();
    // 1,1 no-entry
    g.save(); g.translate(h * 1.5, h * 1.5);
    g.fillStyle = '#8d2018'; g.beginPath(); g.arc(0, 0, h * 0.4, 0, 7); g.fill();
    g.fillStyle = '#e2ded6'; g.fillRect(-h * 0.28, -h * 0.07, h * 0.56, h * 0.14); g.restore();
    // universal wear
    const rndc = seeded('signwear');
    g.save(); g.globalAlpha = 0.35; fbm(g, s, rndc, { octaves: 3, cells: 4, amp: 0.4 }); g.restore();
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${60 + rnd() * 60},${40 + rnd() * 40},${30},${0.15 + rnd() * 0.3})`;
      g.beginPath(); g.arc(rnd() * s, rnd() * s, 2 + rnd() * 9, 0, 7); g.fill();
    }
    const m = new THREE.MeshStandardMaterial({
      map: texture(ac, true), roughness: 0.55, metalness: 0.25,
      side: THREE.DoubleSide, vertexColors: true,
    });
    m.userData.tile = 0;
    return m;
  }

  decalDirt() {
    const rnd = seeded('decal');
    const s = 256;
    const ac = CV(s), g = ac.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#2c261d'; g.fillRect(0, 0, s, s);
    fbm(g, s, rnd, { octaves: 4, cells: 3, amp: 0.5 });
    const al = CV(s), ag = al.getContext('2d', { willReadFrequently: true });
    const grd = ag.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.85)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    ag.fillStyle = grd; ag.fillRect(0, 0, s, s);
    ag.save(); ag.globalCompositeOperation = 'multiply'; fbm(ag, s, rnd, { octaves: 4, cells: 4, amp: 0.7, op: 'multiply' }); ag.restore();
    const m = new THREE.MeshStandardMaterial({
      map: texture(ac, true), alphaMap: texture(al, false), transparent: true,
      roughness: 0.95, metalness: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexColors: true,
    });
    m.userData.tile = 0;
    return m;
  }

  foliage() {
    const rnd = seeded('foliage');
    const s = 128;
    const ac = CV(s), g = ac.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#3f4a2a'; g.fillRect(0, 0, s, s);
    fbm(g, s, rnd, { octaves: 4, cells: 4, amp: 0.5 });
    const al = CV(s), ag = al.getContext('2d', { willReadFrequently: true });
    ag.fillStyle = '#000'; ag.fillRect(0, 0, s, s);
    ag.fillStyle = '#fff';
    for (let i = 0; i < 90; i++) {
      const x = rnd() * s, y = rnd() * s;
      ag.save(); ag.translate(x, y); ag.rotate(rnd() * 7);
      ag.beginPath(); ag.ellipse(0, 0, 3 + rnd() * 9, 1.5 + rnd() * 3, 0, 0, 7); ag.fill();
      ag.restore();
    }
    const m = new THREE.MeshStandardMaterial({
      map: texture(ac, true), alphaMap: texture(al, false), transparent: true, alphaTest: 0.45,
      side: THREE.DoubleSide, roughness: 0.9, metalness: 0, vertexColors: true,
    });
    m.userData.tile = 0;
    return m;
  }
}
