// Building assembly helpers: walls with real openings, cornices, parapets,
// floor slabs with stairwells, stair flights, and the cheap perimeter blocks
// that close the skyline off.
// Owner: world agent. Everything draws into a Batcher (see world-batch.js) in
// LOCAL space; walls run along local X with their EXTERIOR facing local +Z.
import { windowUnit, doorFrame, shutter } from './world-props.js';

/* ------------------------------------------------------------------- wall */
// o = { len, h, t, mat, y0, openings:[{x,w,y0,y1,kind,...}], collide }
export function wall(B, o) {
  const len = o.len, h = o.h, t = o.t ?? 0.42, mat = o.mat || 'brick_red', y0 = o.y0 ?? 0;
  const inner = o.inner || null;                 // optional inner skin material
  const ops = (o.openings || []).slice().sort((a, b) => a.x - b.x);
  const collide = o.collide !== false;

  const seg = (x0, x1, ya, yb) => {
    if (x1 - x0 < 0.015 || yb - ya < 0.015) return;
    B.box(mat, (x0 + x1) / 2, (ya + yb) / 2, 0, x1 - x0, yb - ya, t, {});
    if (inner) B.box(inner, (x0 + x1) / 2, (ya + yb) / 2, -t / 2 - 0.02, x1 - x0, yb - ya, 0.05, { dirt: false });
    if (collide) B.collider(x0, x1, ya, yb, -t / 2, t / 2);
  };

  let cx = -len / 2;
  for (const op of ops) {
    const a = op.x - op.w / 2, b = op.x + op.w / 2;
    seg(cx, a, y0, y0 + h);
    seg(a, b, y0, y0 + op.y0);
    seg(a, b, y0 + op.y1, y0 + h);
    cx = b;
  }
  seg(cx, len / 2, y0, y0 + h);

  // furniture in the holes — pushed with rotY=PI because the prop factories
  // recess their glass toward local -Z.
  for (const op of ops) {
    const oh = op.y1 - op.y0;
    if (op.kind === 'door') {
      B.push(op.x, y0 + op.y0, 0, Math.PI);
      doorFrame(B, op.w, oh, Object.assign({ wall: t }, op.opts || {}));
      B.pop();
    } else if (op.kind === 'hole') {
      // arch / blown-out opening: just a rough concrete reveal
      B.box('concrete', op.x, y0 + op.y1 + 0.09, 0, op.w + 0.5, 0.18, t + 0.12, { dirt: false });
    } else if (op.kind === 'shutter') {
      B.push(op.x, y0 + op.y0, t / 2 - 0.06, 0);
      shutter(B, op.w, oh * (op.openAmt ?? 0.75), op.opts || {});
      B.pop();
      B.box('black', op.x, y0 + op.y0 + oh / 2, -t / 2 + 0.05, op.w, oh, 0.06, { dirt: false });
    } else {
      B.push(op.x, y0 + (op.y0 + op.y1) / 2, 0, Math.PI);
      windowUnit(B, op.w, oh, Object.assign({ wall: t }, op.opts || {}));
      B.pop();
    }
  }
}

/* ------------------------------------------------------------ trim pieces */

// horizontal band running along local X on the exterior (+Z) face
export function cornice(B, len, y, o = {}) {
  const t = o.t ?? 0.42, mat = o.mat || 'concrete';
  const proj = o.proj ?? 0.16, h = o.h ?? 0.26;
  B.box(mat, 0, y, t / 2 + proj / 2 - 0.02, len, h, proj + 0.06, { dirt: false, tint: o.tint });
  if (o.under) B.box(mat, 0, y - h / 2 - 0.06, t / 2 + proj * 0.3, len, 0.12, proj * 0.7, { dirt: false, tint: o.tint });
}

// rectangular roof parapet around a footprint of hw x hd (half extents)
export function parapet(B, hw, hd, y, o = {}) {
  const h = o.h ?? 0.95, t = o.t ?? 0.34, mat = o.mat || 'brick_red', cap = o.cap || 'concrete';
  const put = (x, z, w, d) => {
    B.box(mat, x, y + h / 2, z, w, h, d, {});
    B.box(cap, x, y + h + 0.05, z, w + 0.14, 0.12, d + 0.14, { dirt: false });
    B.collider(x - w / 2, x + w / 2, y, y + h + 0.1, z - d / 2, z + d / 2);
  };
  put(0, hd - t / 2, hw * 2, t);
  put(0, -hd + t / 2, hw * 2, t);
  put(hw - t / 2, 0, t, hd * 2 - t * 2);
  put(-hw + t / 2, 0, t, hd * 2 - t * 2);
}

/* --------------------------------------------------------- floors & stairs */

// Slab spanning [-hw,hw] x [-hd,hd] at height y, with an optional rectangular
// hole (stairwell). Built as up to four boxes so the hole is real.
export function slab(B, hw, hd, y, o = {}) {
  const th = o.th ?? 0.28, mat = o.mat || 'concrete_floor', under = o.under || 'concrete';
  const hole = o.hole;                     // {x0,x1,z0,z1}
  const piece = (x0, x1, z0, z1) => {
    if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
    B.box(mat, (x0 + x1) / 2, y - th / 2, (z0 + z1) / 2, x1 - x0, th, z1 - z0, {});
    if (under) B.box(under, (x0 + x1) / 2, y - th - 0.03, (z0 + z1) / 2, x1 - x0, 0.06, z1 - z0, { dirt: false });
    B.collider(x0, x1, y - th, y, z0, z1);
  };
  if (!hole) { piece(-hw, hw, -hd, hd); return; }
  piece(-hw, hole.x0, -hd, hd);
  piece(hole.x1, hw, -hd, hd);
  piece(hole.x0, hole.x1, -hd, hole.z0);
  piece(hole.x0, hole.x1, hole.z1, hd);
}

// Straight flight climbing +Z from (0,y0) to (0,y0+rise), width w.
export function stairs(B, w, y0, rise, run, o = {}) {
  const n = o.steps ?? Math.max(6, Math.round(rise / 0.19));
  const sh = rise / n, sd = run / n;
  const mat = o.mat || 'concrete';
  for (let i = 0; i < n; i++) {
    const y = y0 + (i + 1) * sh, z = -run / 2 + (i + 0.5) * sd;
    B.box(mat, 0, y - sh / 2, z, w, sh, sd, { dirt: i < 3 });
    B.box('wood', 0, y + 0.008, z + sd / 2 - 0.02, w, 0.02, 0.05, { dirt: false, tint: 0x8a7f6c });
    B.collider(-w / 2, w / 2, y - sh, y, z - sd / 2, z + sd / 2);
  }
  // stringer walls
  if (o.wallSide) {
    for (const sx of [].concat(o.wallSide)) {
      B.box(mat, sx * (w / 2 + 0.09), y0 + rise / 2 - 0.1, 0, 0.18, rise + 0.5, run, { rotX: 0, dirt: false });
    }
  }
  // handrail
  if (o.rail !== false) {
    const sx = o.railSide ?? 1;
    const len = Math.hypot(rise, run);
    B.cyl('rust', sx * (w / 2 - 0.06), y0 + rise / 2 + 0.95, 0, 0.03, 0.03, len,
      { rotX: Math.atan2(run, rise) + Math.PI / 2, rc: 6 });
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      B.cyl('rust', sx * (w / 2 - 0.06), y0 + t * rise + 0.5, -run / 2 + t * run, 0.02, 0.02, 1.0, { rc: 5 });
    }
  }
}

/* ------------------------------------------------------- perimeter filler */

// Cheap but detailed skyline block: window grid, storey bands, cornice, parapet.
// `faces` is a subset of 'nesw' — only those get windows (the rest are hidden).
export function fillerBlock(B, o) {
  const w = o.w, d = o.d, h = o.h, mat = o.mat || 'brick_tan';
  const rnd = o.rnd || B.rng;
  const storeys = Math.max(1, Math.floor(h / 3.4));
  const sh = h / storeys;
  const faces = o.faces || 'nesw';

  // core mass
  B.box(mat, 0, h / 2, 0, w, h, d, {});
  B.collider(-w / 2, w / 2, 0, h, -d / 2, d / 2);

  const decorate = (len, half, rotY) => {
    B.push(0, 0, 0, rotY);
    // storey bands + cornice
    for (let s = 1; s < storeys; s++) {
      B.box('concrete', 0, s * sh - 0.1, half + 0.06, len - 0.4, 0.2, 0.14, { dirt: false, tint: 0xbdb6a8 });
    }
    B.box('concrete', 0, h - 0.28, half + 0.12, len + 0.3, 0.34, 0.3, { dirt: false, tint: 0xc4bdaf });
    B.box('concrete', 0, h - 0.62, half + 0.07, len + 0.1, 0.14, 0.2, { dirt: false, tint: 0xc4bdaf });
    // window grid
    const cols = Math.max(1, Math.floor((len - 1.6) / 3.0));
    const ww = 1.15, wh = 1.7;
    for (let s = 0; s < storeys; s++) {
      for (let c = 0; c < cols; c++) {
        const x = (c - (cols - 1) / 2) * ((len - 2.2) / Math.max(1, cols - 1 || 1));
        const y = s * sh + sh * 0.52;
        if (y + wh / 2 > h - 0.9) continue;
        // recess
        B.box('concrete', x, y, half - 0.12, ww + 0.34, wh + 0.34, 0.3, { dirt: false, tint: 0x9d968a });
        B.quad(rnd() < 0.22 ? 'glass_broken' : 'glass', x, y, half - 0.16, ww, wh, { dirt: false, shadow: false });
        B.box('concrete', x, y - wh / 2 - 0.1, half - 0.02, ww + 0.5, 0.14, 0.34, { dirt: false });
        B.box('concrete', x, y + wh / 2 + 0.12, half - 0.04, ww + 0.5, 0.16, 0.28, { dirt: false, tint: 0xc0b9ab });
      }
    }
    B.pop();
  };
  if (faces.includes('s')) decorate(w, d / 2, 0);
  if (faces.includes('n')) decorate(w, d / 2, Math.PI);
  if (faces.includes('e')) decorate(d, w / 2, Math.PI / 2);
  if (faces.includes('w')) decorate(d, w / 2, -Math.PI / 2);

  parapet(B, w / 2, d / 2, h, { h: 0.85, t: 0.3, mat });
}
