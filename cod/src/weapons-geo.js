// Shared geometry helpers for the viewmodels (weapons agent).
//
// Two bakes happen to every piece of gun/arm geometry:
//
//  * UVs. Primitive UVs are 0..1 per face, so a 29 cm receiver and a 6 mm rib get
//    the same number of texels and everything reads as flat colour. We rebake UVs
//    from position in metres (triplanar for boxes, cylindrical for tubes) so texel
//    density is constant across the whole weapon.
//  * Edge wear, as vertex colour. Vertices that sit on a convex edge or corner of
//    their own part get brightened; that is where anodising rubs through first, and
//    it is what gives a hard-surface model its readable silhouette highlights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TEX_METRES } from './weapons-materials.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();
const UVS = 1 / TEX_METRES;

// deterministic per-part jitter
let _seed = 0x9e3779b9;
function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
export function resetJitter() { _seed = 0x9e3779b9; }

/* ------------------------------------------------------------- primitives */

const GC = new Map();
// NOTE: 2 segments per side is deliberate. Every vertex of a 1-segment box sits on a
// corner, so a corner/edge-driven wear bake would brighten the whole part uniformly
// instead of just its edges. The extra ring of face-centre vertices is what lets the
// wear fall off into the middle of each face.
export function box(w, h, d) {
  const k = `b${w},${h},${d}`;
  if (!GC.has(k)) GC.set(k, new THREE.BoxGeometry(w, h, d, 2, 2, 2));
  return GC.get(k);
}
// cylinder whose axis lies along Z (so it points at the muzzle)
export function tube(r1, r2, len, seg = 16, open = false) {
  const k = `t${r1},${r2},${len},${seg},${open}`;
  if (!GC.has(k)) {
    const g = new THREE.CylinderGeometry(r1, r2, len, seg, 2, open);
    g.rotateX(Math.PI / 2);
    g.userData.cylR = (r1 + r2) * 0.5;
    GC.set(k, g);
  }
  return GC.get(k);
}
export function sph(r, a = 10, b = 8) {
  const k = `s${r},${a},${b}`;
  if (!GC.has(k)) GC.set(k, new THREE.SphereGeometry(r, a, b));
  return GC.get(k);
}
export function ring(r, t, seg = 16, arc = Math.PI * 2) {
  const k = `r${r},${t},${seg},${arc}`;
  if (!GC.has(k)) GC.set(k, new THREE.TorusGeometry(r, t, 6, seg, arc));
  return GC.get(k);
}
// capsule-ish tapered limb segment along +Z, used for fingers and forearms
export function limb(r1, r2, len, seg = 8) {
  const k = `l${r1},${r2},${len},${seg}`;
  if (!GC.has(k)) {
    const g = new THREE.CylinderGeometry(r1, r2, len, seg, 1, false);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, len / 2);
    g.userData.cylR = (r1 + r2) * 0.5;
    GC.set(k, g);
  }
  return GC.get(k);
}

/* ------------------------------------------------------------------ bakes */

// Cylindrical UV in the geometry's own frame (axis = Z): u wraps, v runs along Z.
function uvCyl(g, r, off) {
  const p = g.attributes.position, n = p.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    uv[i * 2] = (z + off) * UVS;
    uv[i * 2 + 1] = Math.atan2(y, x) * r * UVS;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Triplanar UV: U always follows the bore axis (Z) where the face allows it, so the
// brushed-metal streak in the roughness map runs along the barrel like real tooling.
function uvTri(g) {
  const p = g.attributes.position, nr = g.attributes.normal, n = p.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ax = Math.abs(nr.getX(i)), ay = Math.abs(nr.getY(i)), az = Math.abs(nr.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = z; v = x; }
    else if (ax >= az) { u = z; v = y; }
    else { u = x; v = y; }
    uv[i * 2] = u * UVS; uv[i * 2 + 1] = v * UVS;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Edge wear + per-part tone jitter, written to the colour attribute.
function bakeWear(g, amt) {
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const cx = (bb.min.x + bb.max.x) * 0.5, cy = (bb.min.y + bb.max.y) * 0.5, cz = (bb.min.z + bb.max.z) * 0.5;
  const hx = Math.max(1e-5, (bb.max.x - bb.min.x) * 0.5);
  const hy = Math.max(1e-5, (bb.max.y - bb.min.y) * 0.5);
  const hz = Math.max(1e-5, (bb.max.z - bb.min.z) * 0.5);
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3);
  const tone = 0.94 + rnd() * 0.12;           // no two parts are the exact same tone
  const wear = amt * (0.60 + rnd() * 0.65);
  for (let i = 0; i < n; i++) {
    let a = Math.abs(p.getX(i) - cx) / hx;
    let b = Math.abs(p.getY(i) - cy) / hy;
    let c = Math.abs(p.getZ(i) - cz) / hz;
    // second-largest axis extent -> on an edge; third -> on a corner
    let t;
    if (a > b) { t = a; a = b; b = t; }
    if (b > c) { t = b; b = c; c = t; }
    if (a > b) { t = a; a = b; b = t; }
    // now a<=b<=c ; b is the second largest
    const edge = Math.max(0, Math.min(1, (b - 0.60) / 0.40));
    const corner = Math.max(0, Math.min(1, (a - 0.70) / 0.30));
    const w = 1 + wear * (edge * 0.30 + corner * 0.24);
    // slight downward-facing darkening so the underside reads as occluded
    const v = tone * w;
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/** Prepare a *local-space* geometry clone: UVs + wear. */
export function prep(geo, { wear = 1, uvOff = 0 } = {}) {
  const g = geo.clone();
  if (geo.userData && geo.userData.cylR) uvCyl(g, geo.userData.cylR, uvOff);
  else uvTri(g);
  bakeWear(g, wear);
  return g;
}

/* ------------------------------------------------------------------- rig */

export class Rig {
  constructor() { this.buckets = new Map(); this.root = new THREE.Group(); }

  // static geometry: baked into a per-material merged mesh
  s(geo, mat, p, e, opt) {
    const g = prep(geo, { wear: opt && opt.wear !== undefined ? opt.wear : 1, uvOff: p[2] });
    _p.set(p[0], p[1], p[2]);
    _e.set(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0);
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    let bk = this.buckets.get(mat);
    if (!bk) this.buckets.set(mat, bk = []);
    bk.push(g);
    return this;
  }

  // dynamic mesh, parented to `parent` (defaults to root) and returned so we can animate it
  d(geo, mat, p, e, parent) {
    const m = new THREE.Mesh(prep(geo), mat);
    m.position.set(p[0], p[1], p[2]);
    if (e) m.rotation.set(e[0], e[1], e[2]);
    (parent || this.root).add(m);
    return m;
  }

  anchor(p, e, parent) {
    const o = new THREE.Object3D();
    o.position.set(p[0], p[1], p[2]);
    if (e) o.rotation.set(e[0], e[1], e[2]);
    (parent || this.root).add(o);
    return o;
  }

  finish() {
    for (const [mat, list] of this.buckets) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list, false);
      const m = new THREE.Mesh(g, mat);
      m.frustumCulled = false;
      this.root.add(m);
    }
    this.buckets.clear();
    this.root.traverse(o => { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 12; });
    return this.root;
  }
}

/** Standalone prepped mesh (for hand/arm parts built outside a Rig). */
export function mesh(geo, mat, wear = 0.6) {
  const m = new THREE.Mesh(prep(geo, { wear }), mat);
  m.frustumCulled = false;
  m.castShadow = false; m.receiveShadow = false;
  m.renderOrder = 12;
  return m;
}
