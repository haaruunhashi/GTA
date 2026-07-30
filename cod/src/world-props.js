// Reusable procedural prop factories for the map.
// Owner: world agent. Every factory builds in LOCAL space, centred on the origin,
// standing on y=0 and facing +Z, then the caller wraps it in B.push(x,y,z,rotY).
// Nothing here creates meshes — everything is fed to the batcher and merged, so
// the entire map ends up as a handful of draw calls.
import * as THREE from 'three';

/* --------------------------------------------------------------- openings */

// A window. Built as a real hole in a thick wall: a splayed masonry reveal on
// all four sides, a frame set well back inside it, glazing that reflects the
// sky with a parallax-mapped room behind it, a protruding sill that throws a
// shadow, and staining running down from that sill.
//
// Local +Z of this unit points at the INTERIOR (wall() pushes it with rotY=PI),
// so negative z is further out toward the street.
export function windowUnit(B, w, h, o = {}) {
  const t = o.wall ?? 0.42;
  const frameMat = o.frame || 'paint_white';
  const broken = !!o.broken, boarded = !!o.boarded;
  const rec = o.recess ?? 0.2;           // how far the frame sits back from the face
  const fz = -t * 0.5 + rec;
  const fw = 0.075;
  const out = -t * 0.5;                  // the exterior wall plane

  // ---- masonry reveal: the jambs, head and cill of the opening itself.
  // Slightly proud of the brick and a shade lighter, so the recess reads as
  // depth rather than as a dark sticker.
  const rd = rec + 0.04;                 // depth of the reveal lining
  const rj = 0.055;                      // how far it intrudes into the opening
  B.box('concrete', -w / 2 + rj / 2, 0, out + rd / 2, rj, h, rd, { dirt: false, tint: 0xb6b0a4 });
  B.box('concrete', w / 2 - rj / 2, 0, out + rd / 2, rj, h, rd, { dirt: false, tint: 0xa9a397 });
  B.box('concrete', 0, h / 2 - rj / 2, out + rd / 2, w, rj, rd, { dirt: false, tint: 0x8f8a80 });
  B.box('concrete', 0, -h / 2 + rj / 2, out + rd / 2, w, rj, rd, { dirt: false, tint: 0xc0bab0 });

  // frame perimeter, set back inside the reveal
  B.box(frameMat, 0, h / 2 - fw / 2 - rj, fz, w - rj * 2, fw, 0.1, { dirt: false });
  B.box(frameMat, 0, -h / 2 + fw / 2 + rj, fz, w - rj * 2, fw, 0.1, { dirt: false });
  B.box(frameMat, -w / 2 + fw / 2 + rj, 0, fz, fw, h - rj * 2, 0.1, { dirt: false });
  B.box(frameMat, w / 2 - fw / 2 - rj, 0, fz, fw, h - rj * 2, 0.1, { dirt: false });
  // mullion + transom
  B.box(frameMat, 0, 0, fz, 0.05, h - fw - rj * 2, 0.09, { dirt: false });
  if (h > 1.3) B.box(frameMat, 0, h * 0.18, fz, w - fw - rj * 2, 0.05, 0.09, { dirt: false });

  if (boarded) {
    // dark void behind the boards, so gaps read as a black interior
    B.quad('black', 0, 0, fz + 0.06, w - 0.1, h - 0.1, { rotY: Math.PI, dirt: false, shadow: false });
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.06;
      B.box('wood', 0, -h / 2 + 0.16 + i * (h - 0.3) / 3.2, fz + 0.02, w * 0.98, (h - 0.2) / 4.4, 0.05,
        { rotZ: a * 0.6, dirt: false });
    }
  } else {
    // faces OUT (rotY flips the plane back toward the street)
    B.quad(broken ? 'window_broken' : 'window', 0, 0, fz - 0.03, w - 0.14 - rj * 2, h - 0.14 - rj * 2,
      { rotY: Math.PI, uvRect: [0, 0, 1, 1], dirt: false, shadow: false });
    if (broken) {
      // a few shards still clinging to the frame
      for (let i = 0; i < 3; i++) {
        const s = 0.16 + i * 0.06;
        B.box('steel', (i - 1) * w * 0.28, h / 2 - rj - s * 0.5, fz - 0.03, s * 1.4, s, 0.015,
          { rotZ: (i - 1) * 0.5, dirt: false, tint: 0x7a8288 });
      }
    }
  }
  // cill: protrudes, drips, and casts a hard line across the brick below it
  B.box('concrete', 0, -h / 2 - 0.07, out - 0.05, w + 0.3, 0.1, t + 0.24, { dirt: false, tint: 0xa8a296 });
  B.box('concrete', 0, -h / 2 - 0.14, out - 0.01, w + 0.2, 0.05, t + 0.12, { dirt: false, tint: 0x7d786e });
  // lintel / head
  B.box('concrete', 0, h / 2 + 0.1, out + 0.02, w + 0.34, 0.16, t + 0.1, { dirt: false, tint: 0xb2ac9f });
  // rain staining washing off the cill onto the wall below
  B.quad('decal_drip', 0, -h / 2 - 0.9, out - 0.012, w + 0.34, 1.5,
    { rotY: Math.PI, uvRect: [0, 0, 1, 1], dirt: false, shadow: false });
}

export function doorFrame(B, w, h, o = {}) {
  const t = o.wall ?? 0.42, fz = -t * 0.5 + 0.12;
  const mat = o.frame || 'paint_blue';
  B.box(mat, -w / 2 + 0.06, h / 2, fz, 0.12, h, 0.14, { dirt: false });
  B.box(mat, w / 2 - 0.06, h / 2, fz, 0.12, h, 0.14, { dirt: false });
  B.box(mat, 0, h - 0.07, fz, w, 0.14, 0.14, { dirt: false });
  B.box('concrete', 0, 0.03, 0.02, w + 0.3, 0.06, t + 0.3, { dirt: false });
  if (o.leaf) { // door standing ajar
    const a = o.leaf;
    B.push(-w / 2 + 0.1, 0, fz, a);
    B.box('wood', (w - 0.24) / 2, h / 2, 0, w - 0.24, h - 0.1, 0.07, { dirt: false });
    B.cyl('steel', w - 0.34, h * 0.52, 0.07, 0.028, 0.028, 0.22, { rotX: Math.PI / 2, dirt: false });
    B.pop();
  }
}

// roller shutter over a shopfront, partly rolled up
export function shutter(B, w, h, o = {}) {
  B.box('corrugated', 0, h / 2, 0, w, h, 0.08, { rotX: 0, tint: o.tint ?? 0xbfc3c7 });
  B.box('steel', 0, h + 0.16, 0, w + 0.16, 0.3, 0.26, { dirt: false });
  B.box('steel', -w / 2 - 0.07, h / 2, 0, 0.14, h, 0.2, { dirt: false });
  B.box('steel', w / 2 + 0.07, h / 2, 0, 0.14, h, 0.2, { dirt: false });
}

/* ------------------------------------------------------------- contact AO */

// Baked contact occlusion under a prop. Screen-space AO cannot see the tight
// crease where a thin object meets the ground, and without it every prop in
// the map reads as a sticker hovering a centimetre above the tarmac. One
// multiply-blended quad, laid flat, slightly larger than the footprint.
export function contact(B, rx, rz = rx, o = {}) {
  B.quad('decal_ao', o.x ?? 0, o.y ?? 0.015, o.z ?? 0, rx * 2, rz * 2,
    { rotX: -Math.PI / 2, rotZ: o.rot ?? 0, dirt: false, shadow: false });
}

/* -------------------------------------------------------- street furniture */

export function lampPost(B, o = {}) {
  const h = o.h ?? 6.4;
  contact(B, 0.75);
  B.box('concrete', 0, 0.09, 0, 0.66, 0.18, 0.66, {});
  B.cyl('paint_green', 0, h / 2, 0, 0.075, 0.11, h, { solid: true, rc: 10 });
  // ribbed base collar
  B.cyl('paint_green', 0, 0.55, 0, 0.15, 0.16, 0.5, { rc: 10 });
  // curved arm
  const seg = 5, R = 1.05;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * (Math.PI / 2), a1 = ((i + 1) / seg) * (Math.PI / 2);
    const x0 = Math.sin(a0) * R, y0 = h - R + Math.cos(a0) * R;
    const x1 = Math.sin(a1) * R, y1 = h - R + Math.cos(a1) * R;
    const len = Math.hypot(x1 - x0, y1 - y0);
    B.cyl('paint_green', (x0 + x1) / 2, (y0 + y1) / 2, 0, 0.07, 0.07, len + 0.02,
      { rotZ: -Math.atan2(x1 - x0, y1 - y0), rc: 8 });
  }
  B.box('paint_green', R + 0.28, h - R - 0.02, 0, 0.86, 0.16, 0.42, { dirt: false });
  B.box('light_emissive', R + 0.28, h - R - 0.13, 0, 0.72, 0.07, 0.34, { dirt: false, shadow: false });
}

export function hydrant(B) {
  contact(B, 0.42);
  B.cyl('paint_red', 0, 0.06, 0, 0.24, 0.26, 0.12, { rc: 10 });
  B.cyl('paint_red', 0, 0.36, 0, 0.15, 0.17, 0.62, { rc: 10, solid: true });
  B.cyl('paint_red', 0, 0.7, 0, 0.16, 0.13, 0.1, { rc: 10 });
  B.cyl('paint_red', 0, 0.79, 0, 0.05, 0.11, 0.12, { rc: 8 });
  B.cyl('steel', 0.17, 0.5, 0, 0.07, 0.07, 0.12, { rotZ: Math.PI / 2, rc: 8 });
  B.cyl('steel', -0.17, 0.5, 0, 0.07, 0.07, 0.12, { rotZ: Math.PI / 2, rc: 8 });
  B.cyl('steel', 0, 0.5, 0.17, 0.06, 0.06, 0.14, { rotX: Math.PI / 2, rc: 8 });
}

// New-Jersey concrete barrier — the tapered silhouette matters
export function jerseyBarrier(B, len = 2.4, o = {}) {
  const h = 0.92;
  contact(B, len * 0.62, 0.55);
  B.box('concrete', 0, 0.09, 0, len, 0.18, 0.62, {});
  B.box('concrete', 0, 0.3, 0, len, 0.26, 0.5, {});
  B.box('concrete', 0, 0.52, 0, len, 0.2, 0.34, {});
  B.box('concrete', 0, 0.78, 0, len, 0.32, 0.26, {});
  B.collider(-len / 2, len / 2, 0, h, -0.32, 0.32);
  if (o.stripe) {
    B.quad('paint_white', 0, 0.62, 0.14, len * 0.8, 0.16, { dirt: false, shadow: false });
  }
}

export function dumpster(B, o = {}) {
  const w = 2.15, h = 1.24, d = 1.15;
  contact(B, w * 0.66, d * 0.82);
  const mat = o.mat || 'paint_green';
  B.box(mat, 0, h / 2 + 0.16, 0, w, h, d, { solid: false });
  // ribs
  for (let i = -2; i <= 2; i++) B.box(mat, i * w * 0.19, h / 2 + 0.16, d / 2 + 0.02, 0.09, h * 0.9, 0.05, { dirt: false });
  // sloped lid, one half flipped open
  B.box(mat, 0, h + 0.22, -0.02, w + 0.1, 0.09, d * 0.55, { rotX: -0.06, dirt: false });
  B.push(0, h + 0.24, d / 2, 0);
  B.box(mat, 0, 0.26, -0.24, w + 0.1, 0.09, d * 0.55, { rotX: -1.25, dirt: false });
  B.pop();
  // wheels + lift pockets
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.cyl('rubber', sx * (w / 2 - 0.24), 0.14, sz * (d / 2 - 0.18), 0.14, 0.14, 0.09, { rotZ: Math.PI / 2, rc: 10 });
  }
  B.box('steel', 0, 0.4, d / 2 + 0.03, w * 0.7, 0.14, 0.08, { dirt: false });
  B.collider(-w / 2, w / 2, 0, h + 0.3, -d / 2, d / 2);
  if (o.trash) {
    const r = B.rng;
    for (let i = 0; i < 7; i++) {
      B.box(i % 2 ? 'tarp' : 'wood', (r() - 0.5) * w * 0.8, h + 0.34 + r() * 0.2, (r() - 0.5) * d * 0.6,
        0.2 + r() * 0.4, 0.1 + r() * 0.2, 0.2 + r() * 0.3, { rotY: r() * 3, rotZ: r() });
    }
  }
}

// A packing case: boards with visible gaps, corner posts and a lid rail.
// `plank` rather than `wood` — see the note on that material; a 2.2 m timber
// tile on a 700 mm box leaves it a featureless brown blob.
export function crate(B, s = 0.72, mat = 'plank') {
  const h = s * (0.72 + 0.12);            // cases are wider than they are tall
  B.box(mat, 0, h / 2, 0, s, h, s, { solid: false });
  const b = 0.06;
  for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    B.box(mat, ax * s / 2, h / 2, az * s / 2, ax ? b : s, h, az ? b : s, { dirt: false, tint: 0xcbbda6 });
  }
  // corner posts and lid rail: the edges are what give a crate its silhouette
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.box(mat, sx * (s / 2 - 0.02), h / 2, sz * (s / 2 - 0.02), 0.07, h, 0.07, { dirt: false, tint: 0xb0a48f });
  }
  B.box(mat, 0, h - 0.025, 0, s * 1.03, b, s * 1.03, { dirt: false, tint: 0xd0c2ab });
  B.collider(-s / 2, s / 2, 0, h, -s / 2, s / 2);
  return h;
}

// A dumped stack of cases. Deliberately WIDE rather than tall: the old version
// piled up to four 1.1 m crates into a 3.3 m brown column that read as a
// monolith in the middle of the street. Real stacks are chest height at most,
// spread sideways, with the top case knocked askew.
export function crateStack(B, rnd) {
  contact(B, 1.0, 0.9);
  const cols = rnd() < 0.55 ? 2 : 1;
  let maxH = 0, maxR = 0.45;
  for (let c = 0; c < cols; c++) {
    const ox = (c - (cols - 1) / 2) * 0.78 + (rnd() - 0.5) * 0.1;
    const oz = (rnd() - 0.5) * 0.22;
    const rows = 1 + ((rnd() * 2.4) | 0);              // 1..2, occasionally 3
    let y = 0;
    for (let i = 0; i < rows; i++) {
      const s = 0.6 + rnd() * 0.2;
      const lean = i === rows - 1 && rows > 1 ? (rnd() - 0.5) * 0.5 : (rnd() - 0.5) * 0.12;
      B.push(ox + (rnd() - 0.5) * 0.12, y, oz + (rnd() - 0.5) * 0.12, lean);
      const h = crate(B, s);
      B.pop();
      y += h - 0.02;
      maxR = Math.max(maxR, Math.abs(ox) + s * 0.75);
    }
    maxH = Math.max(maxH, y);
  }
  // a loose board or two leaning against the pile
  if (rnd() < 0.6) {
    B.box('plank', maxR * 0.9, 0.42, (rnd() - 0.5) * 0.4, 0.16, 0.9, 0.03,
      { rotZ: 0.34, rotY: rnd() * 2, dirt: false });
  }
  return maxH;
}

export function pallet(B, rnd) {
  contact(B, 0.75, 0.7);
  for (let i = 0; i < 6; i++) B.box('plank', 0, 0.11, -0.5 + i * 0.2, 1.2, 0.03, 0.11, { dirt: false });
  for (let i = 0; i < 3; i++) B.box('plank', -0.45 + i * 0.45, 0.05, 0, 0.12, 0.1, 1.15, { dirt: false });
}

export function barrel(B, mat = 'rust') {
  contact(B, 0.42);
  B.cyl(mat, 0, 0.44, 0, 0.29, 0.29, 0.88, { rc: 14, solid: false });
  B.cyl(mat, 0, 0.24, 0, 0.31, 0.31, 0.06, { rc: 14, dirt: false });
  B.cyl(mat, 0, 0.62, 0, 0.31, 0.31, 0.06, { rc: 14, dirt: false });
  B.collider(-0.3, 0.3, 0, 0.9, -0.3, 0.3);
}

export function tyreStack(B, n, rnd) {
  contact(B, 0.58);
  for (let i = 0; i < n; i++) {
    B.torus('rubber', 0, 0.11 + i * 0.19, 0, 0.34, 0.11, { rotX: Math.PI / 2, rotY: rnd() * 3, seg: [10, 14] });
  }
  B.collider(-0.46, 0.46, 0, n * 0.19 + 0.05, -0.46, 0.46);
}

// Sandbag emplacement. Bags are laid as a real one would be: stretchers along
// the run with the odd header turned across it, each course offset by half a
// bag, everything sagging under the course above, the top course ragged and
// incomplete. Cloth colour varies bag to bag (different batches, different
// amounts of sun and mud) and the UV origin is jittered per bag so the hessian
// never lines up from one to the next.
const BAG_TINT = [0xffffff, 0xe6ddc8, 0xcdc7ae, 0xd7cdb0, 0xc2c0a4, 0xefe3c6, 0xb9b099, 0xdad2bd];

export function sandbagWall(B, len, rows, rnd, o = {}) {
  const BL = 0.5;                         // bag length
  const pitch = BL * 0.92;                // along-run spacing (bags overlap)
  const py = 0.175;                       // course height
  const depth = o.depth ?? 1;
  const dz = 0.29;
  const cols = Math.max(1, Math.round(len / pitch));

  for (let r = 0; r < rows; r++) {
    const top = r === rows - 1;
    const off = (r % 2) * pitch * 0.5;
    const cn = cols - (r % 2 ? 1 : 0);
    const shrink = o.taper ? r * 0.16 : 0;
    // each course sags a little more than the one below it
    const sag = r * 0.012;
    // the wall thins as it rises, as a real one does
    const rowDepth = top && depth > 1 ? depth - 1 : depth;
    for (let c = 0; c < cn; c++) {
      for (let d = 0; d < rowDepth; d++) {
        const x = -len / 2 + off + (c + 0.5) * pitch + (rnd() - 0.5) * 0.05;
        const z = (d - (depth - 1) / 2) * dz + (rnd() - 0.5) * 0.05;
        if (o.taper && Math.abs(x) > len / 2 - shrink) continue;
        // ragged, half-finished top course
        if (top && rnd() < 0.28) continue;
        const y = py * 0.55 + r * py - sag + (rnd() - 0.5) * 0.022;
        // one bag in six is turned across the wall as a header
        const header = rnd() < 0.17;
        const bw = BL * (0.9 + rnd() * 0.2);
        const bd = 0.27 * (0.88 + rnd() * 0.26);
        const bh = 0.2 * (0.85 + rnd() * 0.3) * (top ? 0.94 : 1);
        const ry = (header ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.34;
        const opt = {
          v: (rnd() * 6) | 0,
          rotY: ry,
          rotZ: (rnd() - 0.5) * 0.2,
          rotX: (rnd() - 0.5) * 0.13,
          tint: BAG_TINT[(rnd() * BAG_TINT.length) | 0],
          uvOff: [rnd() * 4, rnd() * 4],
        };
        B.bag('sandbag', x, y, z, header ? bd * 1.5 : bw, bh, header ? bw : bd, opt);
        // sewn end: the folded, stitched closure catches light as a hard ridge
        if (d === rowDepth - 1 && rnd() < 0.7) {
          const sx = rnd() < 0.5 ? -1 : 1;
          const c1 = Math.cos(ry), s1 = Math.sin(ry);
          const ex = sx * (header ? bd * 0.66 : bw * 0.42);
          B.box('sandbag', x + ex * c1, y + bh * 0.16, z - ex * s1,
            header ? 0.07 : 0.09, 0.055, header ? bw * 0.5 : bd * 0.52,
            { rotY: ry, rotZ: (rnd() - 0.5) * 0.3, dirt: false, tint: opt.tint, uvOff: opt.uvOff });
        }
      }
    }
  }
  // Spilled sand around the base, and the tight contact crease under the
  // bottom course. The dirt alone left the row looking laid on top of the road.
  B.quad('decal_dirt', 0, 0.014, 0, len + 0.9, dz * depth + 1.1,
    { rotX: -Math.PI / 2, dirt: false, shadow: false, tint: 0xbfae8c });
  const seg = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i < seg; i++) {
    contact(B, 0.7, dz * depth * 0.5 + 0.42, { x: -len / 2 + (i + 0.5) * (len / seg), y: 0.018 });
  }
  B.collider(-len / 2, len / 2, 0, rows * py + 0.05, -dz * depth * 0.5 - 0.14, dz * depth * 0.5 + 0.14);
}

export function roadSign(B, quad = 0, o = {}) {
  const h = o.h ?? 2.5;
  contact(B, 0.3);
  B.cyl('steel', 0, h / 2, 0, 0.045, 0.05, h, { rc: 8, solid: false });
  B.box('concrete', 0, 0.05, 0, 0.34, 0.1, 0.34, { dirt: false });
  const s = o.size ?? 0.72;
  const u = (quad % 2) * 0.5, v = 0.5 - ((quad / 2) | 0) * 0.5;
  B.quad('signs', 0, h - s * 0.6, 0.045, s, s, { uvRect: [u, v, 0.5, 0.5], dirt: false });
  B.collider(-0.08, 0.08, 0, h, -0.08, 0.08);
}

export function trafficCone(B) {
  contact(B, 0.36);
  B.box('paint_red', 0, 0.025, 0, 0.42, 0.05, 0.42, { dirt: false });
  B.cone('paint_red', 0, 0.34, 0, 0.16, 0.62, { rc: 10 });
  B.cone('paint_white', 0, 0.42, 0, 0.107, 0.14, { rc: 10, dirt: false });
}

export function bollard(B) {
  contact(B, 0.26);
  B.cyl('steel', 0, 0.5, 0, 0.08, 0.09, 1.0, { rc: 10 });
  B.cyl('paint_white', 0, 0.86, 0, 0.085, 0.085, 0.1, { rc: 10, dirt: false });
}

/* ------------------------------------------------------------ architecture */

export function acUnit(B, o = {}) {
  const w = o.w ?? 1.1, h = o.h ?? 0.85, d = o.d ?? 1.0;
  contact(B, w * 0.72, d * 0.72);
  B.box('steel', 0, 0.06, 0, w + 0.2, 0.12, d + 0.2, { dirt: false });
  B.box('paint_white', 0, 0.1 + h / 2, 0, w, h, d, { tint: 0xd8d6cf });
  // louvre fins
  for (let i = 0; i < 6; i++) B.box('steel', 0, 0.25 + i * (h - 0.3) / 6, d / 2 + 0.01, w * 0.86, 0.04, 0.05, { dirt: false });
  // fan grille on top
  B.torus('steel', 0, 0.14 + h, 0, w * 0.3, 0.03, { rotX: Math.PI / 2, seg: [8, 14] });
  for (let i = 0; i < 4; i++) B.box('steel', 0, 0.13 + h, 0, w * 0.6, 0.02, 0.06, { rotY: i * 0.78, dirt: false });
  B.cyl('rust', w * 0.35, 0.4, -d / 2 - 0.06, 0.05, 0.05, 0.7, { rc: 8 });
  B.collider(-w / 2, w / 2, 0, h + 0.2, -d / 2, d / 2);
}

export function pipeRun(B, h, o = {}) {
  const r = o.r ?? 0.075, mat = o.mat || 'rust';
  B.cyl(mat, 0, h / 2, 0, r, r, h, { rc: 8 });
  for (let y = 0.7; y < h; y += 2.1) {
    B.box('steel', 0, y, -r - 0.05, r * 3, 0.05, 0.14, { dirt: false });
  }
  // elbow + drain shoe at the bottom
  B.cyl(mat, 0, 0.14, 0.16, r, r, 0.42, { rotX: Math.PI / 2.2, rc: 8 });
  B.cyl(mat, 0, h - 0.02, 0.14, r * 1.15, r * 1.15, 0.4, { rotX: Math.PI / 2, rc: 8 });
}

export function fireEscape(B, o = {}) {
  const w = o.w ?? 2.6, d = o.d ?? 1.25, levels = o.levels ?? 2, gap = o.gap ?? 3.6, y0 = o.y0 ?? 3.4;
  for (let l = 0; l < levels; l++) {
    const y = y0 + l * gap;
    // grated platform + stringers
    B.box('rust', 0, y, 0, w, 0.07, d, { dirt: false });
    B.box('rust', 0, y - 0.12, d / 2 - 0.05, w, 0.16, 0.08, { dirt: false });
    // railing
    for (let i = 0; i <= 6; i++) B.cyl('rust', -w / 2 + i * w / 6, y + 0.55, d / 2 - 0.05, 0.022, 0.022, 1.05, { rc: 6 });
    B.cyl('rust', 0, y + 1.06, d / 2 - 0.05, 0.03, 0.03, w, { rotZ: Math.PI / 2, rc: 6 });
    B.cyl('rust', 0, y + 0.6, d / 2 - 0.05, 0.024, 0.024, w, { rotZ: Math.PI / 2, rc: 6 });
    for (const sx of [-1, 1]) {
      for (let i = 0; i <= 3; i++) B.cyl('rust', sx * (w / 2 - 0.04), y + 0.55, d / 2 - 0.05 - i * (d - 0.1) / 3, 0.022, 0.022, 1.05, { rc: 6 });
      B.cyl('rust', sx * (w / 2 - 0.04), y + 1.06, 0.06, 0.03, 0.03, d, { rotX: Math.PI / 2, rc: 6 });
      // diagonal brace back to the wall
      B.box('rust', sx * (w / 2 - 0.2), y - 0.5, 0.1, 0.07, 1.35, 0.07, { rotX: -0.72, dirt: false });
    }
    // stair flight down to the next level
    if (l > 0 || o.ladder) {
      const steps = 8, sh = gap / steps, sd = 0.26;
      for (let i = 0; i < steps; i++) {
        B.box('rust', w / 2 - 0.55, y - 0.1 - i * sh, d / 2 - 0.2 - i * sd, 0.85, 0.05, sd * 0.8, { dirt: false });
      }
      B.box('rust', w / 2 - 0.55, y - 0.1 - gap / 2, d / 2 - 0.2 - steps * sd / 2, 0.9, 0.09, Math.hypot(gap, steps * sd),
        { rotX: -Math.atan2(gap, steps * sd), dirt: false });
    }
    B.collider(-w / 2, w / 2, y - 0.1, y + 0.02, -d / 2, d / 2);
  }
  // drop ladder
  for (const sx of [-1, 1]) B.cyl('rust', sx * 0.35, y0 / 2, d / 2 - 0.25, 0.028, 0.028, y0, { rc: 6 });
  for (let i = 1; i * 0.32 < y0; i++) B.cyl('rust', 0, i * 0.32, d / 2 - 0.25, 0.02, 0.02, 0.7, { rotZ: Math.PI / 2, rc: 5 });
}

export function awning(B, w, o = {}) {
  const d = o.d ?? 1.5, y = o.y ?? 2.9;
  B.box(o.mat || 'tarp', 0, y + 0.28, d / 2 - 0.1, w, 0.07, d * 1.08, { rotX: 0.28, tint: o.tint, dirt: false });
  // scalloped valance
  for (let i = 0; i < Math.round(w / 0.35); i++) {
    B.box(o.mat || 'tarp', -w / 2 + 0.175 + i * 0.35, y + 0.02, d - 0.02, 0.3, 0.26, 0.04, { tint: o.tint, dirt: false });
  }
  B.cyl('steel', -w / 2 + 0.05, y + 0.35, d / 2, 0.03, 0.03, d + 0.1, { rotX: Math.PI / 2 - 0.28, rc: 6 });
  B.cyl('steel', w / 2 - 0.05, y + 0.35, d / 2, 0.03, 0.03, d + 0.1, { rotX: Math.PI / 2 - 0.28, rc: 6 });
  B.cyl('steel', 0, y + 0.62, 0.02, 0.035, 0.035, w, { rotZ: Math.PI / 2, rc: 6 });
}

export function balcony(B, w, o = {}) {
  const d = o.d ?? 1.3, y = o.y ?? 4.4;
  B.box('concrete', 0, y, d / 2 - 0.1, w, 0.18, d, {});
  B.box('concrete', 0, y - 0.16, d - 0.16, w, 0.14, 0.16, { dirt: false });
  for (const sx of [-1, 1]) B.box('rust', sx * (w / 2 - 0.03), y + 0.55, d / 2, 0.06, 0.95, d - 0.05, { dirt: false });
  const n = Math.round(w / 0.22);
  for (let i = 0; i <= n; i++) B.cyl('rust', -w / 2 + i * w / n, y + 0.55, d - 0.12, 0.018, 0.018, 0.95, { rc: 5 });
  B.cyl('rust', 0, y + 1.05, d - 0.12, 0.03, 0.03, w, { rotZ: Math.PI / 2, rc: 6 });
  // clutter
  if (o.clutter) { B.push(w * 0.3, y + 0.09, d * 0.55, 0.4); barrel(B, 'paint_blue'); B.pop(); }
}

export function roofClutter(B, w, d, rnd) {
  // parapet is built by the caller; this is what sits behind it
  B.push(-w * 0.22, 0, -d * 0.2, 0.2); acUnit(B, { w: 1.5, h: 1.1, d: 1.2 }); B.pop();
  B.push(w * 0.18, 0, d * 0.1, -0.5); acUnit(B, { w: 1.0, h: 0.8, d: 0.9 }); B.pop();
  // water tank on a steel frame
  B.push(w * 0.28, 0, -d * 0.26, 0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl('rust', sx * 0.6, 0.6, sz * 0.6, 0.05, 0.05, 1.2, { rc: 6 });
  B.box('rust', 0, 1.2, 0, 1.5, 0.09, 1.5, { dirt: false });
  B.cyl('corrugated', 0, 1.85, 0, 0.62, 0.62, 1.2, { rc: 14 });
  B.cyl('rust', 0, 2.48, 0, 0.64, 0.5, 0.14, { rc: 14 });
  B.pop();
  // vent stacks
  for (let i = 0; i < 4; i++) {
    const x = (rnd() - 0.5) * w * 0.7, z = (rnd() - 0.5) * d * 0.7;
    B.cyl('steel', x, 0.4, z, 0.11, 0.13, 0.8, { rc: 8 });
    B.cyl('steel', x, 0.86, z, 0.18, 0.14, 0.14, { rc: 8, dirt: false });
  }
  // antenna mast + dish
  B.cyl('steel', -w * 0.34, 1.6, d * 0.3, 0.035, 0.045, 3.2, { rc: 6 });
  for (let i = 0; i < 3; i++) B.box('steel', -w * 0.34, 1.0 + i * 0.8, d * 0.3, 0.5, 0.03, 0.03, { rotY: i * 0.9, dirt: false });
  B.push(-w * 0.34 + 0.3, 2.4, d * 0.3, 0.8);
  B.cyl('paint_white', 0, 0, 0, 0.42, 0.42, 0.09, { rotX: 1.1, rc: 12, dirt: false });
  B.pop();
  // gravel-tarred patches + rubbish
  for (let i = 0; i < 5; i++) {
    B.box('wood', (rnd() - 0.5) * w * 0.8, 0.05, (rnd() - 0.5) * d * 0.8, 0.9 + rnd(), 0.08, 0.18, { rotY: rnd() * 3, dirt: false });
  }
}

// sagging catenary cable between two points
export function wire(B, a, b, sag = 1.2, r = 0.025) {
  const seg = 8;
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const p0 = catenary(a, b, t0, sag), p1 = catenary(a, b, t1, sag);
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
    B.cylBetween('black', p0, p1, r, 5);
  }
}
function catenary(a, b, t, sag) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag, a[2] + (b[2] - a[2]) * t];
}

/* ------------------------------------------------------------------ debris */

export function rubblePile(B, r, rnd, o = {}) {
  const n = o.n ?? 26;
  for (let i = 0; i < n; i++) {
    const a = rnd() * 7, rr = Math.pow(rnd(), 0.6) * r;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const h = (1 - rr / r) * (o.h ?? 0.8) * (0.4 + rnd());
    const s = 0.14 + rnd() * 0.42;
    B.box(rnd() < 0.6 ? 'concrete' : (rnd() < 0.5 ? 'brick_red' : 'brick_grey'),
      x, Math.max(0.05, h * rnd()) + s * 0.2, z, s, s * (0.4 + rnd() * 0.6), s * (0.6 + rnd() * 0.8),
      { rotY: rnd() * 3, rotX: (rnd() - 0.5) * 0.7, rotZ: (rnd() - 0.5) * 0.7, tint: 0xcfcac0 });
  }
  // rebar
  for (let i = 0; i < (o.rebar ?? 4); i++) {
    const a = rnd() * 7, rr = rnd() * r * 0.7;
    B.cyl('rust', Math.cos(a) * rr, 0.3 + rnd() * 0.4, Math.sin(a) * rr, 0.018, 0.018, 0.9 + rnd(),
      { rotX: (rnd() - 0.5) * 2, rotZ: (rnd() - 0.5) * 2, rc: 5 });
  }
  // dust decal underneath
  B.quad('decal_dirt', 0, 0.012, 0, r * 2.6, r * 2.6, { rotX: -Math.PI / 2, dirt: false, shadow: false });
}

export function debrisScatter(B, w, d, n, rnd) {
  for (let i = 0; i < n; i++) {
    const x = (rnd() - 0.5) * w, z = (rnd() - 0.5) * d, k = rnd();
    if (k < 0.35) B.box('brick_red', x, 0.035, z, 0.22, 0.07, 0.1, { rotY: rnd() * 3, tint: 0xd8d2c6 });
    else if (k < 0.6) B.box('concrete', x, 0.04, z, 0.1 + rnd() * 0.3, 0.06, 0.1 + rnd() * 0.2, { rotY: rnd() * 3, rotX: 0.05 });
    else if (k < 0.8) B.box('wood', x, 0.03, z, 0.5 + rnd() * 0.9, 0.04, 0.12, { rotY: rnd() * 3 });
    else B.quad('decal_dirt', x, 0.011 + rnd() * 0.002, z, 1 + rnd() * 2.5, 1 + rnd() * 2.5, { rotX: -Math.PI / 2, rotZ: rnd() * 3, dirt: false, shadow: false });
  }
}

/* ----------------------------------------------------------------- vehicle */

export function wreckedCar(B, rnd, o = {}) {
  const burnt = o.burnt !== false;
  // A torched car is soot-black steel, not orange rust. `rust` on a 4 m body
  // made the whole prop read as one corroded mass at the wrong scale.
  const body = burnt ? 'charred' : (o.mat || 'paint_blue');
  const L = 4.3, W = 1.82;
  contact(B, L * 0.58, W * 0.85);
  // chassis / sills
  B.box(body, 0, 0.55, 0, L, 0.52, W, {});
  B.box('black', 0, 0.3, 0, L - 0.5, 0.28, W - 0.12, { dirt: false });
  // bonnet & boot — each panel a shade off its neighbour so the form reads
  B.box(body, L * 0.3, 0.86, 0, L * 0.36, 0.16, W - 0.16, { rotZ: 0.03, tint: burnt ? 0xb6b2ae : undefined });
  B.box(body, -L * 0.34, 0.88, 0, L * 0.3, 0.18, W - 0.16, { rotZ: -0.02, tint: burnt ? 0xd2ccc4 : undefined });
  // cabin: A/C/B pillars + roof, roof crushed
  B.box(body, -0.1, 1.32, 0, L * 0.42, 0.1, W - 0.2,
    { rotZ: o.crushed ? -0.08 : 0, rotX: 0.02, tint: burnt ? 0xc8c2ba : undefined });
  for (const sz of [-1, 1]) {
    B.box(body, L * 0.16, 1.1, sz * (W / 2 - 0.06), 0.12, 0.5, 0.1, { rotZ: 0.42 });
    B.box(body, -0.32, 1.1, sz * (W / 2 - 0.06), 0.1, 0.52, 0.1, {});
    B.box(body, -L * 0.28, 1.12, sz * (W / 2 - 0.06), 0.12, 0.48, 0.1, { rotZ: -0.35 });
    B.box(body, 0, 0.95, sz * (W / 2 - 0.02), L * 0.44, 0.28, 0.08, {}); // door tops
  }
  if (burnt) {
    // gutted interior: seat frames and a bare wheel are what say "burnt out"
    // rather than "brown box". They sit below the door line, in shadow.
    B.box('black', 0, 0.82, 0, L * 0.4, 0.06, W - 0.3, { dirt: false });
    for (const sz of [-1, 1]) {
      B.box('rust', 0.25, 1.0, sz * 0.42, 0.5, 0.06, 0.42, { dirt: false });
      B.box('rust', -0.02, 1.16, sz * 0.42, 0.06, 0.42, 0.4, { rotZ: -0.22, dirt: false });
    }
    B.cyl('rust', L * 0.2, 1.0, 0, 0.16, 0.16, 0.03, { rotX: 1.2, rc: 10, dirt: false });
  }
  // glass (mostly gone)
  B.quad('glass_broken', L * 0.17, 1.12, 0, 0.72, 1.5, { rotY: Math.PI / 2, rotZ: 0.42, dirt: false, shadow: false });
  if (!burnt) for (const sz of [-1, 1]) B.quad('glass', -0.1, 1.15, sz * (W / 2 - 0.03), 1.5, 0.42, { dirt: false, shadow: false });
  // bumpers, lights, grille
  B.box('steel', L / 2 - 0.04, 0.62, 0, 0.14, 0.3, W - 0.1, { dirt: false });
  B.box('steel', -L / 2 + 0.04, 0.62, 0, 0.14, 0.3, W - 0.1, { dirt: false });
  B.box('black', L / 2 - 0.1, 0.86, 0, 0.08, 0.16, W * 0.5, { dirt: false });
  // wheels — one missing, sitting on the rim
  const wx = L * 0.32, wz = W / 2 - 0.1;
  const corners = [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]];
  corners.forEach((c, i) => {
    if (o.missing && i === o.missing % 4) {
      B.cyl('steel', c[0], 0.2, c[1], 0.2, 0.2, 0.1, { rotZ: Math.PI / 2, rc: 10 });
      return;
    }
    B.torus('rubber', c[0], 0.34, c[1], 0.25, 0.11, { rotY: Math.PI / 2, seg: [8, 12] });
    B.cyl('rubber', c[0], 0.34, c[1], 0.32, 0.32, 0.2, { rotZ: Math.PI / 2, rc: 14 });
    B.cyl('steel', c[0], 0.34, c[1] * 1.05, 0.19, 0.19, 0.12, { rotZ: Math.PI / 2, rc: 10, dirt: false });
  });
  // burn scarring / debris around it
  if (burnt) {
    B.quad('decal_dirt', 0, 0.012, 0, L * 1.6, W * 2.6, { rotX: -Math.PI / 2, dirt: false, shadow: false });
    B.box('charred', -L * 0.5 - 0.6, 0.06, W * 0.4, 1.0, 0.08, 0.5, { rotY: 0.7, rotZ: 0.06 }); // torn-off door
  }
  B.collider(-L / 2, L / 2, 0, 1.45, -W / 2, W / 2);
}

export function shoppingTrolley(B) {
  contact(B, 0.42, 0.55);
  B.box('chainlink', 0, 0.6, 0, 0.55, 0.5, 0.8, { dirt: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.cyl('steel', sx * 0.22, 0.06, sz * 0.3, 0.05, 0.05, 0.03, { rotZ: Math.PI / 2, rc: 6 });
  B.cyl('steel', 0, 0.9, -0.4, 0.02, 0.02, 0.55, { rotZ: Math.PI / 2, rc: 5 });
}
