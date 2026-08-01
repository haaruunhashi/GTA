// Gloved first-person arms (weapons agent).
//
// A floating rifle is the loudest "this is not a real game" tell there is, so every
// viewmodel gets two procedurally built gloved hands and forearms. They are parented
// to the weapon root, which is how real FPS viewmodels are authored: the hands are
// baked into the weapon's animation, so recoil, reload, sprint and sway move gun and
// hands as one rigid assembly for free. The support hand keeps its own node so a
// reload can pull it off the handguard to the magwell.
//
// Canonical hand frame: fingers run +Y, the palm faces -Z (i.e. it grips something
// sitting at -Z), and the thumb sticks out along side*+X. side = +1 right, -1 left.
import * as THREE from 'three';
import { box, sph, limb, mesh } from './weapons-geo.js';

const _Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3();

function finger(mats, x, len, rad, curl, spread) {
  const gl = mats.get('glove');
  const g = new THREE.Group();
  g.position.set(x, 0.036, 0.002);
  g.rotation.z = spread;
  const segs = [0.44, 0.33, 0.23];
  const ang = [0.30 + curl * 1.00, 0.20 + curl * 1.25, 0.16 + curl * 0.95];
  let node = g;
  for (let i = 0; i < 3; i++) {
    const j = new THREE.Object3D();
    j.rotation.x = -ang[i];
    node.add(j);
    const L = len * segs[i];
    const r0 = rad * (1 - i * 0.10), r1 = rad * (1 - (i + 1) * 0.11);
    const m = mesh(limb(r0, r1, L, 7), gl, 0.35);
    m.rotation.x = -Math.PI / 2;                 // limb runs +Z -> point it along +Y
    j.add(m);
    if (i < 2) {
      const k = mesh(sph(r1 * 1.06, 7, 5), gl, 0.3);
      k.position.y = L;
      j.add(k);
    }
    const nx = new THREE.Object3D();
    nx.position.y = L;
    j.add(nx);
    node = nx;
  }
  return g;
}

const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();

/**
 * Position + orient a node with an intrinsic rotation sequence: the first entry
 * rotates in parent space, each later entry rotates about the already-rotated
 * local axis. Far easier to reason about than picking an Euler order.
 */
export function place(o, pos, seq) {
  o.position.set(pos[0], pos[1], pos[2]);
  _qa.identity();
  for (let i = 0; i < seq.length; i++) {
    _qb.setFromAxisAngle(AX[seq[i][0]], seq[i][1]);
    _qa.multiply(_qb);
  }
  o.quaternion.copy(_qa);
  return o;
}

function makeHand(mats, side, curl, thumbCurl, indexCurl) {
  const gl = mats.get('glove'), gp = mats.get('gloveGrip');
  const h = new THREE.Group();

  // palm + back-of-hand plate
  const palm = mesh(box(0.080, 0.074, 0.030), gl, 0.5);
  palm.position.set(0, 0.002, 0);
  h.add(palm);
  const heel = mesh(box(0.072, 0.030, 0.034), gl, 0.5);
  heel.position.set(0, -0.032, 0.001);
  h.add(heel);
  // knuckle armour: the one hard, bright element that makes a glove read as tactical
  const kn = mesh(box(0.082, 0.024, 0.036), gp, 0.9);
  kn.position.set(0, 0.032, 0.001);
  h.add(kn);
  // thenar pad, so the palm side is not a flat slab
  const th = mesh(box(0.026, 0.052, 0.034), gl, 0.4);
  th.position.set(side * 0.028, -0.004, -0.004);
  h.add(th);

  // four fingers, index nearest the thumb
  const F = [
    { x: 0.030, len: 0.074, r: 0.0106, s: 0.06 },
    { x: 0.010, len: 0.080, r: 0.0108, s: 0.02 },
    { x: -0.010, len: 0.075, r: 0.0102, s: -0.02 },
    { x: -0.030, len: 0.062, r: 0.0092, s: -0.07 },
  ];
  for (let i = 0; i < 4; i++) {
    const f = F[i];
    const c = i === 0 && indexCurl !== undefined ? indexCurl : curl + i * 0.03;
    h.add(finger(mats, side * f.x, f.len, f.r, c, side * f.s));
  }

  // thumb: two segments off the side of the palm
  const t0 = new THREE.Group();
  t0.position.set(side * 0.038, -0.008, 0.004);
  t0.rotation.z = -side * 0.72;
  t0.rotation.x = -0.30;
  h.add(t0);
  const tm = mesh(limb(0.0125, 0.0112, 0.038, 7), gl, 0.4);
  tm.rotation.x = -Math.PI / 2;
  t0.add(tm);
  const t1 = new THREE.Object3D();
  t1.position.y = 0.038;
  t1.rotation.x = -thumbCurl;
  t0.add(t1);
  const tm2 = mesh(limb(0.0110, 0.0092, 0.034, 7), gl, 0.4);
  tm2.rotation.x = -Math.PI / 2;
  t1.add(tm2);

  return h;
}

/**
 * One arm. Returns { root, hand, fore }.
 *  root  — place/rotate this to seat the hand on the weapon
 *  hand  — the gloved hand, in the canonical frame described above
 *  fore  — forearm + sleeve, aimed separately at the (off-screen) elbow
 */
export function makeArm(mats, side, opt = {}) {
  const gl = mats.get('glove'), sl = mats.get('sleeve');
  const root = new THREE.Group();
  const hand = makeHand(mats, side, opt.curl !== undefined ? opt.curl : 0.85,
    opt.thumb !== undefined ? opt.thumb : 0.55, opt.index);
  root.add(hand);

  const fore = new THREE.Group();
  fore.position.set(0, -0.044, 0.006);
  root.add(fore);
  // wrist ball hides the hand/forearm seam under any pose
  const w = mesh(sph(0.031, 10, 7), gl, 0.4);
  fore.add(w);
  // glove cuff, then the ripstop sleeve running off the bottom of the frame
  const cuff = mesh(limb(0.026, 0.030, 0.058, 10), gl, 0.7);
  fore.add(cuff);
  const cuffLip = mesh(limb(0.033, 0.031, 0.014, 10), sl, 0.8);
  cuffLip.position.z = 0.053;
  fore.add(cuffLip);
  // The sleeve deliberately overshoots the elbow and runs off the bottom of the
  // frame. A forearm that stops at a visible flat end cap reads as a floating pipe —
  // that is what the round-6 review called "the forearm does not connect". Real
  // viewmodel arms are always cropped by the frame edge, never terminated in view.
  const arm = mesh(limb(0.031, 0.052, 0.520, 12), sl, 0.5);
  arm.position.z = 0.064;
  fore.add(arm);

  return { root, hand, fore };
}

const _w = new THREE.Vector3(), _iq = new THREE.Quaternion();

/** Aim a forearm at an elbow position expressed in weapon space. */
export function aimFore(armRoot, fore, elbow) {
  // wrist position in weapon space
  _w.copy(fore.position).applyQuaternion(armRoot.quaternion).add(armRoot.position);
  _v.set(elbow[0], elbow[1], elbow[2]).sub(_w);
  _iq.copy(armRoot.quaternion).invert();
  _v.applyQuaternion(_iq).normalize();
  fore.quaternion.setFromUnitVectors(_Z, _v);
}
