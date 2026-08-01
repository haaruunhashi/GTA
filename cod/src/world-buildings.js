// Building assembly helpers: walls with real openings, cornices, parapets,
// floor slabs with stairwells, stair flights, and the cheap perimeter blocks
// that close the skyline off.
// Owner: world agent. Everything draws into a Batcher (see world-batch.js) in
// LOCAL space; walls run along local X with their EXTERIOR facing local +Z.
import { windowUnit, doorFrame, shutter, pipeRun } from './world-props.js';

/* ------------------------------------------------------------------- wall */
// o = { len, h, t, mat, y0, openings:[{x,w,y0,y1,kind,...}], collide }
export function wall(B, o) {
  const len = o.len, h = o.h, t = o.t ?? 0.42, mat = o.mat || 'brick_red', y0 = o.y0 ?? 0;
  const inner = o.inner || null;                 // optional inner skin material
  const ops = (o.openings || []).slice().sort((a, b) => a.x - b.x);
  const collide = o.collide !== false;

  const seg = (x0, x1, ya, yb) => {
    if (x1 - x0 < 0.015 || yb - ya < 0.015) return;
    B.box(mat, (x0 + x1) / 2, (ya + yb) / 2, 0, x1 - x0, yb - ya, t, { tint: o.tint });
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

  // Where the wall meets the pavement there is never a clean line: splash-back,
  // road grit, moss and a plinth of darker, wetter masonry.
  if (o.grime) {
    B.box('concrete', 0, y0 + 0.28, 0.02, len, 0.56, t + 0.1, { tint: 0x8a857a });
    B.box('concrete', 0, y0 + 0.6, t / 2 + 0.03, len, 0.09, 0.13, { dirt: false, tint: 0xa39d90 });
    B.quad('decal_grime', 0, y0 + 1.0, t / 2 + 0.06, len, 2.0,
      { uvRect: [0, 0, Math.max(1, len / 5), 1], dirt: false, shadow: false });
    // Contact darkening on the PAVEMENT at the foot of the wall. The vertex
    // term in the batcher darkens the wall's own base but cannot touch the
    // ground beside it, and without this the wall still meets the paving in a
    // clean line. Laid in overlapping segments so it reads continuous.
    if (y0 < 0.1) {
      // A broad wash out across the paving, and a tight core whose peak sits ON
      // the wall face — so the black centre of the gradient is hidden by the
      // masonry and only the falloff lands on the pavement. Peaking it out in
      // the open leaves a painted-looking dark stripe along every building.
      B.quad('decal_ao_soft', 0, 0.018, t / 2 + 0.55, len + 1.0, 2.6,
        { rotX: -Math.PI / 2, dirt: false, shadow: false });
      const seg = Math.max(1, Math.round(len / 2.2));
      for (let i = 0; i < seg; i++) {
        B.quad('decal_ao', -len / 2 + (i + 0.5) * (len / seg), 0.02, t / 2 + 0.02, len / seg + 1.3, 0.9,
          { rotX: -Math.PI / 2, dirt: false, shadow: false });
      }
    }
  }

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
    B.box(mat, x, y + h / 2, z, w, h, d, { tint: o.tint });
    B.box(cap, x, y + h + 0.05, z, w + 0.14, 0.12, d + 0.14, { dirt: false, tint: o.capTint });
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

// Roof furniture for a block of w x d at height y. Pure silhouette work: this
// is what stops a skyline reading as a row of extruded rectangles.
export function roofSilhouette(B, w, d, y, rnd, o = {}) {
  const scale = o.scale ?? 1;
  const n = o.n ?? 3;
  B.push(0, y, 0, 0);
  // stair / lift bulkhead — the tallest thing up there and the most readable
  if (rnd() < 0.85) {
    const bw = (2.4 + rnd() * 2.2) * scale, bd = (2.0 + rnd() * 1.8) * scale, bh = (2.2 + rnd() * 1.4) * scale;
    const bx = (rnd() - 0.5) * (w - bw - 1.5), bz = (rnd() - 0.5) * (d - bd - 1.5);
    B.box(o.mat || 'plaster', bx, bh / 2, bz, bw, bh, bd, { tint: 0xbab3a4 });
    B.box('concrete', bx, bh + 0.1, bz, bw + 0.4, 0.2, bd + 0.4, { dirt: false, tint: 0xa9a294 });
    B.box('rust', bx + bw * 0.2, bh + 0.5, bz, 0.7, 0.6, 0.5, { dirt: false });
  }
  // water tanks on frames
  for (let i = 0; i < (rnd() < 0.6 ? 2 : 1); i++) {
    const tx = (rnd() - 0.5) * (w - 3), tz = (rnd() - 0.5) * (d - 3);
    const r = (0.5 + rnd() * 0.35) * scale, th = (1.1 + rnd() * 0.8) * scale, leg = (0.8 + rnd() * 1.4) * scale;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      B.cyl('rust', tx + sx * r * 0.75, leg / 2, tz + sz * r * 0.75, 0.05, 0.05, leg, { rc: 5 });
    }
    B.box('rust', tx, leg, tz, r * 2.1, 0.09, r * 2.1, { dirt: false });
    B.cyl('corrugated', tx, leg + th / 2, tz, r, r, th, { rc: 12 });
    B.cyl('rust', tx, leg + th + 0.07, tz, r * 1.02, r * 0.8, 0.14, { rc: 12 });
  }
  // vent stacks and chimney pots
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * (w - 1.4), z = (rnd() - 0.5) * (d - 1.4);
    if (rnd() < 0.45) {
      const ch = (1.2 + rnd() * 1.8) * scale;
      B.box('brick_red', x, ch / 2, z, 0.9 * scale, ch, 0.8 * scale, { tint: 0xb9a99a });
      B.box('concrete', x, ch + 0.08, z, 1.1 * scale, 0.16, 1.0 * scale, { dirt: false });
      for (let k = 0; k < 2; k++) B.cyl('rust', x + (k - 0.5) * 0.34 * scale, ch + 0.4, z, 0.11, 0.13, 0.6, { rc: 7 });
    } else {
      B.cyl('steel', x, 0.45 * scale, z, 0.12, 0.14, 0.9 * scale, { rc: 7 });
      B.cyl('steel', x, 0.95 * scale, z, 0.2, 0.15, 0.16, { rc: 7, dirt: false });
    }
  }
  // aerials, masts and a dish or two
  if (rnd() < 0.8) {
    const ax = (rnd() - 0.5) * (w - 1), az = (rnd() - 0.5) * (d - 1);
    const mh = (2.5 + rnd() * 4) * scale;
    B.cyl('steel', ax, mh / 2, az, 0.03, 0.05, mh, { rc: 5 });
    for (let i = 0; i < 4; i++) {
      B.box('steel', ax, mh * (0.45 + i * 0.14), az, (0.7 - i * 0.1) * scale, 0.025, 0.025,
        { rotY: i * 0.7, dirt: false });
    }
    if (rnd() < 0.6) {
      B.cyl('paint_white', ax + 0.5, mh * 0.55, az, 0.35 * scale, 0.35 * scale, 0.08,
        { rotX: 1.1, rotY: rnd() * 3, rc: 10, dirt: false });
    }
  }
  B.pop();
}

// Cheap but detailed skyline block: window grid, storey bands, cornice, parapet.
// `faces` is a subset of 'nesw' — only those get windows (the rest are hidden).
export function fillerBlock(B, o) {
  const w = o.w, d = o.d, h = o.h, mat = o.mat || 'brick_tan';
  const rnd = o.rnd || B.rng;
  const storeys = Math.max(1, Math.floor(h / 3.4));
  const sh = h / storeys;
  const faces = o.faces || 'nesw';
  const tint = o.tint;
  const trim = o.trim ?? 0xc4bdaf;
  const far = !!o.far;                   // backdrop: skip the fiddly bits

  // core mass
  B.box(mat, 0, h / 2, 0, w, h, d, { tint });
  B.collider(-w / 2, w / 2, 0, h, -d / 2, d / 2);

  const decorate = (len, half, rotY) => {
    B.push(0, 0, 0, rotY);
    // The window grid is laid out first: the pilasters, patches and drainpipes
    // all have to land in the piers BETWEEN columns, never across a pane.
    const cols = Math.max(1, Math.floor((len - 1.6) / 3.5));
    const colStep = (len - 2.2) / Math.max(1, cols - 1 || 1);
    const colX = (c) => (c - (cols - 1) / 2) * colStep;
    // midpoint of the pier between column c and c+1 (or the ends)
    const pierX = (i, n) => {
      if (cols < 2) return (i / n - 0.5) * (len - 1.4);
      const c = Math.round((i / n) * (cols - 1) - 0.5);
      if (i === 0) return colX(0) - colStep * 0.5 - 0.35;
      if (i === n) return colX(cols - 1) + colStep * 0.5 + 0.35;
      return colX(Math.min(cols - 2, Math.max(0, c))) + colStep * 0.5;
    };

    // storey bands + cornice
    for (let s = 1; s < storeys; s++) {
      B.box('concrete', 0, s * sh - 0.1, half + 0.06, len - 0.4, 0.2, 0.14, { dirt: false, tint: trim });
    }
    B.box('concrete', 0, h - 0.28, half + 0.12, len + 0.3, 0.34, 0.3, { dirt: false, tint: trim });
    B.box('concrete', 0, h - 0.62, half + 0.07, len + 0.1, 0.14, 0.2, { dirt: false, tint: trim });
    // Vertical bays. A wide facade needs its mass broken up across the
    // horizontal or no amount of surface detail saves it: full-height pilasters
    // between the window columns, each capped, plus a slightly proud centre
    // bay. This is what turns a 46 m slab into a building.
    if (o.bays) {
      const n = o.bays;
      for (let i = 0; i <= n; i++) {
        const px = pierX(i, n);
        const end = i === 0 || i === n;
        const pw = end ? 1.4 : 0.95;
        B.box(mat, px, h * 0.5, half + 0.14, pw, h, 0.28, { tint });
        // capital and a base block — the shadow under the cap is what reads
        B.box('concrete', px, h + 0.02, half + 0.22, pw + 0.36, 0.34, 0.46, { dirt: false, tint: trim });
        B.box('concrete', px, h - 0.5, half + 0.2, pw + 0.24, 0.18, 0.4, { dirt: false, tint: trim });
        B.box('concrete', px, 2.5, half + 0.22, pw + 0.28, 0.24, 0.44, { dirt: false, tint: trim });
      }
    }

    // Ground-floor plinth. It must read DARKER than the brick above it — a
    // pale band at the base of a sunlit wall reads as fresh render, which is
    // the opposite of the intent.
    B.box('concrete', 0, 1.05, half + 0.05, len + 0.06, 2.1, 0.1, { tint: 0x585349 });
    B.box('concrete', 0, 2.18, half + 0.12, len + 0.16, 0.14, 0.24, { dirt: false, tint: 0x8e887c });
    // Grime where the wall meets the pavement, in two passes: a tall soft wash
    // and a dense band right at the junction, so there is no clean line.
    B.quad('decal_grime', 0, 1.25, half + 0.15, len, 2.5, { uvRect: [0, 0, Math.max(1, len / 6), 1], dirt: false, shadow: false });
    B.quad('decal_grime', 0, 0.42, half + 0.16, len, 0.85, { uvRect: [0.37, 0, Math.max(1, len / 3), 1], dirt: false, shadow: false });
    // and the contact darkening on the pavement itself, at the foot of the wall
    B.quad('decal_ao', 0, 0.02, half + 0.42, len, 0.9, { rotX: -Math.PI / 2, dirt: false, shadow: false });

    // Patched render, painted-over signage and drainpipes. A 4 m brick tile
    // repeating over a 30 m wall is obvious the moment nothing interrupts it;
    // these are the interruptions.
    // They live in the vertical gaps BETWEEN window columns so nothing ever
    // renders across a pane.
    const gapAt = () => (cols < 2
      ? (rnd() < 0.5 ? -1 : 1) * len * 0.34
      : colX((rnd() * (cols - 1)) | 0) + colStep * 0.5);
    if (!far) {
      for (let i = 0; i < 3; i++) {
        const gx = gapAt();
        const ph2 = 1.6 + rnd() * Math.max(1.2, h * 0.45);
        B.box(rnd() < 0.5 ? 'plaster' : 'concrete', gx, 2.6 + rnd() * Math.max(0.2, h - 4.2 - ph2), half + 0.04,
          1.0 + rnd() * 0.5, ph2, 0.08, { tint: [0x6d675c, 0x827a6c, 0x5e5d58][(rnd() * 3) | 0] });
      }
      // a faded painted sign band above the shopfront plinth
      if (rnd() < 0.5) {
        B.box('paint_white', (rnd() - 0.5) * len * 0.2, 2.62, half + 0.13, len * (0.35 + rnd() * 0.4), 0.9 + rnd() * 0.4, 0.06,
          { dirt: false, tint: [0x9c7a5c, 0x7d8a92, 0x8e8474][(rnd() * 3) | 0] });
      }
      for (let i = 0; i < 2; i++) {
        B.push(gapAt() + (rnd() - 0.5) * 0.3, 0, half + 0.12, 0);
        pipeRun(B, h - 0.6, { r: 0.06 + rnd() * 0.03 });
        B.pop();
      }
    }

    // ---- windows.
    // A perimeter block is a solid mass, not a wall with holes, so a quad set
    // back into it is simply buried and invisible — which is exactly what the
    // round-2 windows were. The pane therefore sits ON the face and the recess
    // is done two ways: a proud architrave (head, cill, jambs) that throws a
    // real shadow across the glass, and the parallax room inside the shader,
    // which gives the pane genuine depth that slides with the camera.
    const ww = 1.34, wh = 2.0;
    for (let s = 0; s < storeys; s++) {
      for (let c = 0; c < cols; c++) {
        const x = colX(c);
        const y = s * sh + sh * 0.5;
        if (y + wh / 2 > h - 0.9) continue;
        const k = rnd();
        // head: projects furthest, so its shadow rakes down over the glass
        B.box('concrete', x, y + wh / 2 + 0.13, half + 0.09, ww + 0.66, 0.26, 0.24, { dirt: false, tint: 0x9a9488 });
        // cill: projects further still and is lit from above, a hard bright line
        B.box('concrete', x, y - wh / 2 - 0.11, half + 0.12, ww + 0.76, 0.15, 0.3, { dirt: false, tint: trim });
        B.box('concrete', x, y - wh / 2 - 0.2, half + 0.05, ww + 0.6, 0.09, 0.16, { dirt: false, tint: 0x7a746a });
        if (!far) {
          for (const sx of [-1, 1]) {
            B.box('concrete', x + sx * (ww / 2 + 0.11), y, half + 0.05, 0.22, wh + 0.2, 0.16,
              { dirt: false, tint: sx > 0 ? 0x8d8880 : 0xa9a396 });
          }
        }
        if (k < 0.09) {
          // boarded up: a black void with planks nailed across it
          B.quad('black', x, y, half + 0.012, ww, wh, { dirt: false, shadow: false });
          for (let i = 0; i < 3; i++) {
            B.box('wood', x, y - wh / 2 + 0.32 + i * wh * 0.3, half + 0.06, ww, wh * 0.26, 0.05,
              { rotZ: (i - 1) * 0.05, dirt: false });
          }
        } else {
          B.quad(k < 0.2 ? 'window_broken' : 'window', x, y, half + 0.012, ww, wh,
            { uvRect: [0, 0, 1, 1], dirt: false, shadow: false });
        }
      }
    }
    B.pop();
  };
  if (faces.includes('s')) decorate(w, d / 2, 0);
  if (faces.includes('n')) decorate(w, d / 2, Math.PI);
  if (faces.includes('e')) decorate(d, w / 2, Math.PI / 2);
  if (faces.includes('w')) decorate(d, w / 2, -Math.PI / 2);

  // ---- roofline. A row of identical flat extrusions is the single fastest way
  // to look like a blockout, so every block gets a different top.
  const style = o.roof ?? ((rnd() * 3) | 0);
  const ph = 0.6 + rnd() * 0.9;
  if (style === 0) {
    parapet(B, w / 2, d / 2, h, { h: ph, t: 0.3, mat, tint });
  } else if (style === 1) {
    // stepped parapet with corner piers and a raised centre bay
    parapet(B, w / 2, d / 2, h, { h: ph * 0.75, t: 0.3, mat, tint });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      B.box(mat, sx * (w / 2 - 0.35), h + ph * 0.95, sz * (d / 2 - 0.35), 0.9, ph * 1.5, 0.9, { tint });
      B.box('concrete', sx * (w / 2 - 0.35), h + ph * 1.75, sz * (d / 2 - 0.35), 1.1, 0.16, 1.1, { dirt: false, tint: trim });
    }
    const cw = w * (0.3 + rnd() * 0.2);
    for (const sz of [-1, 1]) {
      B.box(mat, 0, h + ph * 0.95, sz * (d / 2 - 0.15), cw, ph * 1.4, 0.3, { tint });
      B.box('concrete', 0, h + ph * 1.68, sz * (d / 2 - 0.15), cw + 0.24, 0.16, 0.5, { dirt: false, tint: trim });
    }
  } else {
    // heavy overhanging cornice, low parapet behind it
    for (const sz of [-1, 1]) {
      B.box('concrete', 0, h + 0.24, sz * (d / 2 + 0.14), w + 0.9, 0.48, 0.6, { dirt: false, tint: trim });
      B.box('concrete', 0, h - 0.12, sz * (d / 2 + 0.08), w + 0.4, 0.22, 0.36, { dirt: false, tint: trim });
    }
    for (const sx of [-1, 1]) {
      B.box('concrete', sx * (w / 2 + 0.14), h + 0.24, 0, 0.6, 0.48, d + 0.9, { dirt: false, tint: trim });
      B.box('concrete', sx * (w / 2 + 0.08), h - 0.12, 0, 0.36, 0.22, d + 0.4, { dirt: false, tint: trim });
    }
    parapet(B, w / 2 - 0.2, d / 2 - 0.2, h + 0.48, { h: ph * 0.6, t: 0.26, mat, tint });
  }
  roofSilhouette(B, w, d, h + 0.3, rnd, { n: far ? 2 : 3, scale: o.roofScale ?? 1, shadow: false });
}
