// Geometry batcher for the map.
// Owner: world agent.
//
// Every prop factory in world-props.js draws into one of these. Primitives are
// generated from a small cache of base geometries, transformed by the current
// matrix stack, given WORLD-SCALE UVs derived from each material's
// `userData.tile` (metres per texture repeat) and appended to one big buffer per
// material. `finish()` turns each buffer into a single merged mesh, so the whole
// map costs a couple of dozen draw calls.
import * as THREE from 'three';

const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _col = new THREE.Color();

/* ------------------------------------------------------------ base shapes */

function nonIndexed(g) {
  const ng = g.index ? g.toNonIndexed() : g;
  const out = {
    pos: ng.attributes.position.array,
    nrm: ng.attributes.normal.array,
    uv: ng.attributes.uv ? ng.attributes.uv.array : new Float32Array((ng.attributes.position.count) * 2),
  };
  g.dispose();
  if (ng !== g) ng.dispose();
  return out;
}

const R3 = v => Math.round(v * 1000) / 1000;

/* ------------------------------------------------------------ sandbag mesh */
// A filled sack is not an ellipsoid: it is a slumped rectangular pillow with
// pinched ends, a flat bottom where it has settled onto whatever is below and a
// puckered seam ridge along one end. Built by deforming a low-res box so it
// still merges into the batch like every other primitive.
function bagGeometry(variant) {
  let seed = 1013904223 + variant * 2654435761;
  const rnd = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822519) + 0x9e3779b9) | 0;
    return ((seed >>> 8) & 0xffffff) / 0x1000000;
  };
  const g = new THREE.BoxGeometry(1, 1, 1, 7, 4, 5);
  const p = g.attributes.position;
  // a handful of lump centres so each variant slumps differently
  const lumps = [];
  for (let i = 0; i < 5; i++) lumps.push([(rnd() - 0.5) * 1.1, (rnd() - 0.5) * 0.8, (rnd() - 0.5) * 0.9, 0.5 + rnd() * 0.5]);
  const skew = (rnd() - 0.5) * 0.34;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // partial spherify -> rounded corners without losing the rectangular read
    const l = Math.hypot(x, y, z) || 1e-5;
    const k = 0.56;
    x = x * (1 - k) + (x / l) * 0.5 * k;
    y = y * (1 - k) + (y / l) * 0.5 * k;
    z = z * (1 - k) + (z / l) * 0.5 * k;
    // widest through the middle, flatter on top: the sand has settled
    const bulge = 1 + 0.22 * Math.cos(y * Math.PI);
    x *= bulge; z *= bulge;
    if (y > 0) y *= 0.82;
    // pinched, sewn ends
    const tp = 1 - 0.42 * Math.pow(Math.min(1, Math.abs(x) * 2), 3.0);
    z *= tp; y *= 0.72 + 0.28 * tp;
    // flat-ish bottom
    if (y < -0.22) y = -0.22 + (y + 0.22) * 0.55;
    // slump sideways along its length
    x += skew * (0.25 - y * y) * 1.6;
    // organic lumps
    for (const L of lumps) {
      const d = Math.hypot(x - L[0], (y - L[1]) * 1.6, z - L[2]);
      const w = Math.max(0, 1 - d / 0.62);
      const a = w * w * 0.075 * L[3];
      x += x * a; y += y * a * 0.7; z += z * a;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return nonIndexed(g);
}

/* ------------------------------------------------------------------ class */

export class Batcher {
  constructor(ctx, root) {
    this.ctx = ctx;
    this.M = ctx.materials;
    this.root = root;
    this.rng = ctx.rng;
    this.groups = new Map();
    this.colliders = [];
    this.collisionMeshes = [];
    this.meshes = [];
    this.stack = [new THREE.Matrix4()];
    this.cache = new Map();
    this.tag = null;              // non-null => geometry lands in its own mesh
    this.verts = 0;
  }

  get top() { return this.stack[this.stack.length - 1]; }

  /* ----------------------------------------------------------- transforms */

  push(x = 0, y = 0, z = 0, rotY = 0, rotX = 0, rotZ = 0) {
    _e.set(rotX, rotY, rotZ, 'YXZ');
    const m = new THREE.Matrix4().makeRotationFromEuler(_e);
    m.setPosition(x, y, z);
    this.stack.push(new THREE.Matrix4().multiplyMatrices(this.top, m));
    return this;
  }
  pop() { if (this.stack.length > 1) this.stack.pop(); return this; }

  /** Everything drawn until endTag() becomes its own mesh (optionally BVH-collided). */
  beginTag(name, collide = false) { this.tag = { name, collide }; return this; }
  endTag() { this.tag = null; return this; }

  _xform(x, y, z, o) {
    _e.set((o && o.rotX) || 0, (o && o.rotY) || 0, (o && o.rotZ) || 0, 'YXZ');
    _m.makeRotationFromEuler(_e);
    _m.setPosition(x, y, z);
    if (o && o.scale) _m.scale(_v.set(o.scale[0], o.scale[1], o.scale[2]));
    return new THREE.Matrix4().multiplyMatrices(this.top, _m);
  }

  /* ------------------------------------------------------------ colliders */

  /** Axis-aligned box in LOCAL space -> world-space Box3 collider. */
  collider(x0, x1, y0, y1, z0, z1) {
    const m = this.top;
    const b = new THREE.Box3();
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0).applyMatrix4(m);
      b.expandByPoint(_v);
    }
    this.colliders.push(b);
    return b;
  }

  /* ----------------------------------------------------------- primitives */

  box(mat, x, y, z, w, h, d, o) {
    const g = this._base('box', () => nonIndexed(new THREE.BoxGeometry(1, 1, 1)));
    const m = this._xform(x, y, z, o);
    m.scale(_v.set(w, h, d));
    this._emit(mat, g, m, o);
    if (o && o.solid) this.collider(x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2);
  }

  /** Plane in the local XY plane facing +Z. */
  quad(mat, x, y, z, w, h, o) {
    const g = this._base('quad', () => nonIndexed(new THREE.PlaneGeometry(1, 1)));
    const m = this._xform(x, y, z, o);
    m.scale(_v.set(w, h, 1));
    this._emit(mat, g, m, o);
  }

  cyl(mat, x, y, z, rt, rb, h, o) {
    const rc = (o && o.rc) || 12;
    const key = `cyl:${R3(rt)}:${R3(rb)}:${rc}:${o && o.open ? 1 : 0}`;
    const g = this._base(key, () => nonIndexed(new THREE.CylinderGeometry(rt, rb, 1, rc, 1, !!(o && o.open))));
    const m = this._xform(x, y, z, o);
    m.scale(_v.set(1, h, 1));
    this._emit(mat, g, m, o);
    if (o && o.solid) {
      const r = Math.max(rt, rb);
      this.collider(x - r, x + r, y - h / 2, y + h / 2, z - r, z + r);
    }
  }

  /** Slumped sandbag of size w x h x d. `o.v` picks one of 6 deformations. */
  bag(mat, x, y, z, w, h, d, o) {
    const v = ((o && o.v) | 0) % 6;
    const g = this._base(`bag:${v}`, () => bagGeometry(v));
    const m = this._xform(x, y, z, o);
    m.scale(_v.set(w, h, d));
    this._emit(mat, g, m, o);
  }

  cone(mat, x, y, z, r, h, o) {
    const rc = (o && o.rc) || 12;
    const g = this._base(`cone:${R3(r)}:${rc}`, () => nonIndexed(new THREE.ConeGeometry(r, 1, rc)));
    const m = this._xform(x, y, z, o);
    m.scale(_v.set(1, h, 1));
    this._emit(mat, g, m, o);
  }

  sphere(mat, x, y, z, r, o) {
    const s = (o && o.seg) || [10, 7];
    const g = this._base(`sph:${s[0]}:${s[1]}`, () => nonIndexed(new THREE.SphereGeometry(1, s[0], s[1])));
    const m = this._xform(x, y, z, o);
    m.scale(_v.set(r, r, r));
    this._emit(mat, g, m, o);
  }

  torus(mat, x, y, z, R, tube, o) {
    const s = (o && o.seg) || [8, 14];
    const key = `tor:${R3(R)}:${R3(tube)}:${s[0]}:${s[1]}`;
    const g = this._base(key, () => nonIndexed(new THREE.TorusGeometry(R, tube, s[0], s[1])));
    this._emit(mat, g, this._xform(x, y, z, o), o);
  }

  /** Capsule-less rod between two LOCAL points. */
  cylBetween(mat, a, b, r, rc = 6, o) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1e-4;
    const g = this._base(`cyl:${R3(r)}:${R3(r)}:${rc}:0`, () => nonIndexed(new THREE.CylinderGeometry(r, r, 1, rc)));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    m.makeRotationFromQuaternion(q);
    m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    m.scale(_v.set(1, len, 1));
    this._emit(mat, g, new THREE.Matrix4().multiplyMatrices(this.top, m), o);
  }

  _base(key, make) {
    let g = this.cache.get(key);
    if (!g) { g = make(); this.cache.set(key, g); }
    return g;
  }

  /* ------------------------------------------------------------- emitting */

  _group(mat, shadow) {
    const key = `${mat}|${shadow ? 1 : 0}|${this.tag ? this.tag.name : ''}`;
    let g = this.groups.get(key);
    if (!g) {
      const material = this.M.get(mat);
      g = {
        mat: material, shadow, pos: [], nrm: [], uv: [], col: [],
        tile: material.userData.tile === undefined ? 2 : material.userData.tile,
        collide: !!(this.tag && this.tag.collide), name: key,
      };
      this.groups.set(key, g);
    }
    return g;
  }

  _emit(mat, base, m, o) {
    const shadow = !(o && o.shadow === false);
    const g = this._group(mat, shadow);
    const P = base.pos, N = base.nrm, U = base.uv;
    const n = P.length / 3;
    const e = m.elements;
    // normal matrix (inverse-transpose, ignoring translation)
    const nm = new THREE.Matrix3().getNormalMatrix(m).elements;

    const tile = g.tile;
    const rect = o && o.uvRect;
    const keepUV = tile === 0 || !!rect;
    const _uo = (o && o.uvOff) || 0;
    const uo = Array.isArray(_uo) ? _uo[0] : _uo;
    const vo = Array.isArray(_uo) ? _uo[1] : 0;

    // colour: sRGB tint -> linear, plus ground grime and a touch of tonal noise
    let cr = 1, cg = 1, cb = 1;
    if (o && o.tint !== undefined) { _col.setHex(o.tint); cr = _col.r; cg = _col.g; cb = _col.b; }
    const dirt = !(o && o.dirt === false);
    // deterministic per-primitive tonal jitter from its world position
    const hx = Math.sin(e[12] * 12.9898 + e[13] * 78.233 + e[14] * 37.719) * 43758.5453;
    const jit = 1 + ((hx - Math.floor(hx)) - 0.5) * 0.11;
    cr *= jit; cg *= jit; cb *= jit;

    const start = g.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      const wx = e[0] * px + e[4] * py + e[8] * pz + e[12];
      const wy = e[1] * px + e[5] * py + e[9] * pz + e[13];
      const wz = e[2] * px + e[6] * py + e[10] * pz + e[14];
      g.pos.push(wx, wy, wz);
      const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      let ax = nm[0] * nx + nm[3] * ny + nm[6] * nz;
      let ay = nm[1] * nx + nm[4] * ny + nm[7] * nz;
      let az = nm[2] * nx + nm[5] * ny + nm[8] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      g.nrm.push(ax / l, ay / l, az / l);
      if (keepUV) {
        const u = U[i * 2], v = U[i * 2 + 1];
        if (rect) g.uv.push(rect[0] + u * rect[2], rect[1] + v * rect[3]);
        else g.uv.push(u, v);
      } else {
        g.uv.push(0, 0); // filled per face below
      }
      let d = 1;
      if (dirt) {
        const yy = Math.max(0, wy);
        d = 1 - 0.26 * Math.exp(-yy / 1.1);
      }
      g.col.push(cr * d, cg * d, cb * d);
    }

    if (!keepUV) {
      // per-face dominant-axis projection so nothing stretches or micro-tiles
      const inv = 1 / tile;
      for (let f = start; f < start + n; f += 3) {
        const i0 = f * 3, i1 = (f + 1) * 3, i2 = (f + 2) * 3;
        const ax = g.pos[i1] - g.pos[i0], ay = g.pos[i1 + 1] - g.pos[i0 + 1], az = g.pos[i1 + 2] - g.pos[i0 + 2];
        const bx = g.pos[i2] - g.pos[i0], by = g.pos[i2 + 1] - g.pos[i0 + 1], bz = g.pos[i2 + 2] - g.pos[i0 + 2];
        let fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
        fx = Math.abs(fx); fy = Math.abs(fy); fz = Math.abs(fz);
        for (let k = 0; k < 3; k++) {
          const p = (f + k) * 3, q = (f + k) * 2;
          if (fy >= fx && fy >= fz) { g.uv[q] = g.pos[p] * inv + uo; g.uv[q + 1] = g.pos[p + 2] * inv; }
          else if (fx >= fz) { g.uv[q] = g.pos[p + 2] * inv + uo; g.uv[q + 1] = g.pos[p + 1] * inv; }
          else { g.uv[q] = g.pos[p] * inv + uo; g.uv[q + 1] = g.pos[p + 1] * inv; }
        }
      }
    }
    this.verts += n;
  }

  /* --------------------------------------------------------------- output */

  finish() {
    for (const g of this.groups.values()) {
      if (!g.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.nrm), 3));
      const uv = new THREE.BufferAttribute(new Float32Array(g.uv), 2);
      geo.setAttribute('uv', uv);
      geo.setAttribute('uv1', uv);          // aoMap channel
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.col), 3));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, g.mat);
      const transparent = g.mat.transparent === true;
      mesh.castShadow = g.shadow && !transparent;
      mesh.receiveShadow = !transparent;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrixWorld();
      if (g.collide) { mesh.userData.collide = true; this.collisionMeshes.push(mesh); }
      mesh.name = 'batch:' + g.name;
      this.root.add(mesh);
      this.meshes.push(mesh);
      g.pos = g.nrm = g.uv = g.col = null;
    }
    for (const g of this.cache.values()) { /* base arrays are plain typed arrays */ }
    this.cache.clear();
    return this.meshes;
  }
}
