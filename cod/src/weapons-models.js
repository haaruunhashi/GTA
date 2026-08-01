// Procedural weapon viewmodels. Everything is built from primitives in "gun space":
//   origin = rear face of the receiver, on the bore axis
//   -Z = muzzle direction, +Y = up, +X = right (shooter's view)
// Static parts are merged per-material so a whole weapon is 3-6 draw calls; only the
// parts that actually animate (bolt, charging handle, magazine, pump) stay separate.
// Gloved arms are attached last, parented to the weapon root so they inherit every
// bit of viewmodel animation.
import * as THREE from 'three';
import { reticleTexture } from './weapons-materials.js';
import { Rig, box, tube, sph, ring, mesh, resetJitter } from './weapons-geo.js';
import { makeArm, aimFore, place } from './weapons-arms.js';

// ---- shared sub-assemblies --------------------------------------------------

// MIL-STD-1913 rail: base strip + cross ribs, so it catches light like the real thing.
function rail(r, mat, len, p, e, w = 0.021) {
  r.s(box(w, 0.005, len), mat, p, e);
  const n = Math.max(2, Math.floor(len / 0.0175));
  const step = len / n;
  const c = Math.cos(e ? e[2] : 0), s = Math.sin(e ? e[2] : 0);
  for (let i = 0; i < n; i++) {
    const dz = -len / 2 + step * (i + 0.5);
    // offset the rib outward along the rail's local up (rotated by roll e[2])
    const ox = -s * 0.0045, oy = c * 0.0045;
    r.s(box(w, 0.006, step * 0.5), mat, [p[0] + ox, p[1] + oy, p[2] + dz], e);
  }
}

function triggerGroup(r, mat, z, y) {
  r.s(ring(0.026, 0.0045, 14, Math.PI * 1.15), mat, [0, y - 0.014, z], [0, Math.PI / 2, -0.5]);
  r.s(box(0.007, 0.022, 0.006), mat, [0, y - 0.012, z + 0.004], [0.18, 0, 0]);
}

// A red-dot / holographic optic. Returns the anchor at the centre of the glass.
function redDot(r, mats, z, y, style = 'dot') {
  const opt = mats.get('optic'), al = mats.get('alu');
  // quick-detach mount
  r.s(box(0.030, 0.028, 0.052), opt, [0, y - 0.030, z]);
  r.s(box(0.040, 0.008, 0.020), opt, [0, y - 0.043, z], [0, 0, 0]);
  if (style === 'holo') {
    // squared holographic housing with a hooded window
    r.s(box(0.040, 0.030, 0.070), opt, [0, y, z]);
    r.s(box(0.046, 0.036, 0.006), opt, [0, y + 0.001, z + 0.035]);
    r.s(box(0.046, 0.036, 0.006), opt, [0, y + 0.001, z - 0.035]);
    r.s(box(0.008, 0.036, 0.062), opt, [0.022, y + 0.001, z]);
    r.s(box(0.008, 0.036, 0.062), opt, [-0.022, y + 0.001, z]);
    r.s(box(0.030, 0.006, 0.030), al, [0, y + 0.017, z + 0.010]);
  } else {
    // tube sight with a hood, turret caps and a battery cap
    r.s(tube(0.0225, 0.0225, 0.062, 18, true), opt, [0, y, z]);
    r.s(tube(0.0245, 0.0245, 0.008, 18), opt, [0, y, z + 0.030]);
    r.s(tube(0.0245, 0.0260, 0.014, 18), opt, [0, y, z - 0.033]);
    r.s(tube(0.008, 0.008, 0.014, 10), al, [0, y + 0.026, z + 0.006], [Math.PI / 2, 0, 0]);
    r.s(tube(0.008, 0.008, 0.014, 10), al, [0.026, y, z + 0.006], [0, Math.PI / 2, 0]);
    r.s(tube(0.011, 0.011, 0.010, 12), al, [-0.026, y, z - 0.008], [0, Math.PI / 2, 0]);
  }
  // glass
  const lensR = style === 'holo' ? 0.017 : 0.020;
  const gl = new THREE.Mesh(new THREE.CircleGeometry(lensR, 20), mats.get(style === 'holo' ? 'lensAmber' : 'lens'));
  gl.position.set(0, y, z + 0.026);
  gl.renderOrder = 13;
  r.root.add(gl);
  const gl2 = gl.clone();
  gl2.position.z = z - 0.030;
  gl2.rotation.y = Math.PI;
  r.root.add(gl2);

  const sight = r.anchor([0, y, z]);
  sight.userData.window = lensR;
  return sight;
}

// Backup irons. `folded` draws them lying flat along the rail, which is how a rifle
// wearing a red dot actually carries them — left upright they stand between the eye
// and the optic and put a second, misaligned aperture ring directly under the dot in
// the ADS frame, which is what the round-2 review read as "the sight is not aligned".
function ironSights(r, mats, zFront, zRear, y, folded) {
  const st = mats.get('steelDark');
  if (folded) {
    r.s(box(0.026, 0.009, 0.040), st, [0, y + 0.004, zFront]);
    r.s(box(0.020, 0.007, 0.030), st, [0, y + 0.010, zFront - 0.004], [0.10, 0, 0]);
    r.s(box(0.026, 0.009, 0.038), st, [0, y + 0.004, zRear]);
    r.s(box(0.019, 0.007, 0.028), st, [0, y + 0.010, zRear + 0.004], [-0.10, 0, 0]);
    return r.anchor([0, y + 0.010, zRear]);
  }
  // front post in its wings
  r.s(box(0.004, 0.020, 0.006), st, [0, y + 0.014, zFront]);
  r.s(box(0.004, 0.024, 0.006), st, [0.010, y + 0.016, zFront]);
  r.s(box(0.004, 0.024, 0.006), st, [-0.010, y + 0.016, zFront]);
  r.s(box(0.028, 0.005, 0.008), st, [0, y + 0.004, zFront]);
  // rear aperture
  r.s(ring(0.008, 0.0035, 12), st, [0, y + 0.018, zRear], [0, 0, 0]);
  r.s(box(0.026, 0.006, 0.010), st, [0, y + 0.005, zRear]);
  r.s(box(0.005, 0.020, 0.008), st, [0.012, y + 0.014, zRear]);
  r.s(box(0.005, 0.020, 0.008), st, [-0.012, y + 0.014, zRear]);
  return r.anchor([0, y + 0.018, zRear]);
}

/**
 * Seat both gloved arms on a finished weapon root.
 * `spec.grip` is the firing hand, `spec.support` the front hand; each carries the
 * placement (`pos` + intrinsic rotation `seq`), the finger curl and the weapon-space
 * elbow the forearm aims at. Both arms are children of the weapon root, so they ride
 * every recoil / sway / reload offset the animation layer applies to the gun.
 */
function attachArms(root, mats, spec) {
  const out = {};
  for (const key of ['grip', 'support']) {
    const s = spec[key];
    if (!s) continue;
    const side = key === 'grip' ? 1 : -1;
    const a = makeArm(mats, side, { curl: s.curl, thumb: s.thumb, index: s.index });
    place(a.root, s.pos, s.seq);
    aimFore(a.root, a.fore, s.elbow);
    a.root.traverse(o => { o.castShadow = false; o.receiveShadow = false; if (o.isMesh) o.renderOrder = 11; });
    root.add(a.root);
    a.rest = { pos: a.root.position.clone(), quat: a.root.quaternion.clone() };
    a.restElbow = s.elbow;
    // extra keyframes the animation layer blends to during a magazine change
    for (const k of ['mag', 'charge']) {
      if (!s[k]) continue;
      const t = new THREE.Object3D();
      place(t, s[k].pos, s[k].seq);
      a[k + 'Pose'] = { pos: t.position.clone(), quat: t.quaternion.clone(), elbow: s[k].elbow };
    }
    out[key === 'grip' ? 'armR' : 'armL'] = a;
  }
  return out;
}

// ---- weapons ----------------------------------------------------------------

// M4/416-style carbine.
function buildAR(mats) {
  resetJitter();
  const r = new Rig();
  const pl = mats.get('polymer'), st = mats.get('steel'), sd = mats.get('steelDark'),
    al = mats.get('alu'), rb = mats.get('rubber');

  // upper receiver + brass deflector + forward assist
  r.s(box(0.050, 0.052, 0.290), al, [0, 0.006, -0.150]);
  r.s(box(0.052, 0.014, 0.120), al, [0, 0.030, -0.070]);
  r.s(box(0.016, 0.022, 0.030), al, [0.028, 0.010, -0.026], [0, 0, 0.35]);
  r.s(tube(0.009, 0.009, 0.020, 10), al, [0.028, -0.004, -0.052], [0, Math.PI / 2, 0]);
  // ejection port surround
  r.s(box(0.006, 0.026, 0.058), sd, [0.026, 0.008, -0.062]);
  // lower receiver + magwell
  r.s(box(0.046, 0.046, 0.185), al, [0, -0.043, -0.095]);
  r.s(box(0.050, 0.052, 0.062), al, [0, -0.052, -0.128]);
  // pistol grip
  r.s(box(0.030, 0.098, 0.046), pl, [0, -0.098, -0.010], [0.34, 0, 0]);
  r.s(box(0.033, 0.020, 0.040), pl, [0, -0.146, 0.008], [0.34, 0, 0]);
  triggerGroup(r, al, -0.058, -0.062);
  // safety selector + mag release
  r.s(tube(0.008, 0.008, 0.030, 10), sd, [0, -0.048, -0.030], [0, Math.PI / 2, 0]);
  r.s(box(0.010, 0.018, 0.006), sd, [-0.020, -0.048, -0.028], [0, 0, 0.4]);
  // buffer tube + collapsible stock
  r.s(tube(0.016, 0.016, 0.195, 14), al, [0, -0.004, 0.098]);
  r.s(box(0.042, 0.062, 0.120), pl, [0, -0.012, 0.110]);
  r.s(box(0.048, 0.030, 0.040), pl, [0, -0.036, 0.070]);
  r.s(box(0.046, 0.070, 0.016), rb, [0, -0.010, 0.176]);
  r.s(box(0.030, 0.014, 0.070), pl, [0, 0.024, 0.100]);   // cheek weld
  // handguard: octagonal M-LOK tube with a top rail and side slots
  r.s(tube(0.030, 0.028, 0.310, 8), al, [0, 0.002, -0.450], [0, Math.PI / 8, 0]);
  rail(r, al, 0.300, [0, 0.032, -0.450]);
  rail(r, al, 0.300, [0, 0.032, -0.150]);                 // upper rail (continuous sight line)
  for (let i = 0; i < 5; i++) {
    const z = -0.340 - i * 0.052;
    r.s(box(0.006, 0.010, 0.034), sd, [0.030, -0.004, z], [0, 0, 0]);
    r.s(box(0.006, 0.010, 0.034), sd, [-0.030, -0.004, z], [0, 0, 0]);
  }
  rail(r, al, 0.140, [0, -0.030, -0.400], [0, 0, Math.PI]);  // bottom rail
  // barrel, gas block, muzzle brake
  r.s(tube(0.0115, 0.0105, 0.420, 14), st, [0, 0, -0.500]);
  r.s(box(0.024, 0.030, 0.030), sd, [0, 0.008, -0.600]);
  r.s(tube(0.005, 0.005, 0.180, 8), sd, [0, 0.022, -0.520]);
  r.s(tube(0.018, 0.017, 0.058, 14), sd, [0, 0, -0.735]);
  for (let i = 0; i < 3; i++) r.s(box(0.040, 0.006, 0.008), sd, [0, 0, -0.720 - i * 0.014]);
  r.s(tube(0.0175, 0.0175, 0.006, 14), sd, [0, 0, -0.765]);
  // sling loops
  r.s(ring(0.011, 0.0025, 10), sd, [0.028, -0.014, -0.330], [0, Math.PI / 2, 0]);
  r.s(ring(0.011, 0.0025, 10), sd, [0.020, -0.024, 0.056], [0, Math.PI / 2, 0]);
  // folded backup irons on the rail (behind the optic)
  ironSights(r, mats, -0.320, -0.075, 0.036, true);

  const optic = redDot(r, mats, -0.185, 0.075, 'dot');

  // ---- animated parts ----
  const charging = r.d(box(0.052, 0.011, 0.030), sd, [0, 0.030, 0.012]);
  charging.add(mesh(box(0.014, 0.010, 0.048), sd).translateZ(-0.030));
  const bolt = r.d(box(0.005, 0.024, 0.052), sd, [0.027, 0.008, -0.062]);   // ejection port cover / bolt face
  const mag = r.d(box(0.026, 0.115, 0.070), pl, [0, -0.128, -0.128], [0.10, 0, 0]);
  mag.add(mesh(box(0.030, 0.010, 0.076), pl).translateY(-0.062));
  mag.add(mesh(box(0.024, 0.040, 0.066), mats.get('polymerTan')).translateY(0.03).translateZ(-0.004));

  const root = r.finish();
  const arms = attachArms(root, mats, {
    grip: {
      pos: [0.019, -0.086, 0.029], seq: [['x', 0.30], ['z', Math.PI / 2]],
      curl: 1.12, index: 0.78, thumb: 0.55, elbow: [0.10, -0.46, 0.13],
    },
    support: {
      pos: [-0.043, -0.010, -0.338], seq: [['z', -0.62], ['y', -Math.PI / 2], ['z', 0.30]],
      curl: 1.08, thumb: 0.15, elbow: [-0.17, -0.50, -0.03],
      mag: {
        pos: [0.000, -0.212, -0.118], seq: [['z', -0.15], ['y', -Math.PI / 2], ['z', 2.00]],
        elbow: [-0.20, -0.44, 0.16],
      },
      charge: {
        pos: [0.052, -0.016, 0.044], seq: [['z', 0.30], ['y', -Math.PI / 2], ['z', 2.55]],
        elbow: [0.02, -0.34, 0.30],
      },
    },
  });
  return {
    root, optic, irons: null, mag, bolt, charging, ...arms,
    muzzle: r.anchor([0, 0, -0.790]),
    eject: r.anchor([0.034, 0.010, -0.062]),
    boltThrow: 0.030,
  };
}

// Compact PDW: MP7 / Vector flavour — mag through the grip, folding stock, holo sight.
function buildSMG(mats) {
  resetJitter();
  const r = new Rig();
  const pl = mats.get('polymer'), st = mats.get('steel'), sd = mats.get('steelDark'),
    al = mats.get('alu'), rb = mats.get('rubber');

  r.s(box(0.046, 0.062, 0.230), pl, [0, 0.000, -0.115]);
  r.s(box(0.050, 0.016, 0.230), pl, [0, 0.030, -0.115]);
  rail(r, al, 0.225, [0, 0.040, -0.115], null, 0.019);
  r.s(box(0.006, 0.026, 0.050), sd, [0.024, 0.010, -0.045]);   // ejection port
  // grip + magwell in one (mag feeds through the grip)
  r.s(box(0.038, 0.100, 0.055), pl, [0, -0.082, -0.055], [0.16, 0, 0]);
  triggerGroup(r, pl, -0.088, -0.036);
  r.s(box(0.010, 0.016, 0.006), sd, [-0.022, -0.020, -0.028]);
  // folding stock: side struts + a thin butt plate
  r.s(box(0.006, 0.010, 0.150), al, [0.020, 0.012, 0.086]);
  r.s(box(0.006, 0.010, 0.150), al, [-0.020, 0.012, 0.086]);
  r.s(box(0.048, 0.052, 0.012), rb, [0, 0.006, 0.164]);
  r.s(box(0.026, 0.010, 0.060), pl, [0, 0.032, 0.070]);
  // handguard + vertical foregrip
  r.s(box(0.042, 0.046, 0.150), pl, [0, -0.006, -0.300]);
  rail(r, al, 0.140, [0, 0.020, -0.300], null, 0.019);
  r.s(box(0.030, 0.070, 0.034), rb, [0, -0.058, -0.300], [-0.12, 0, 0]);
  r.s(box(0.034, 0.012, 0.040), pl, [0, -0.092, -0.304], [-0.12, 0, 0]);
  // stubby barrel + flash hider
  r.s(tube(0.0105, 0.0100, 0.150, 12), st, [0, -0.004, -0.330]);
  r.s(tube(0.0155, 0.0145, 0.044, 12), sd, [0, -0.004, -0.418]);
  for (let i = 0; i < 4; i++) r.s(box(0.034, 0.005, 0.007), sd, [0, -0.004, -0.406 - i * 0.011], [0, 0, i * 0.4]);
  r.s(ring(0.010, 0.0022, 10), sd, [0.022, -0.026, -0.240], [0, Math.PI / 2, 0]);

  const optic = redDot(r, mats, -0.130, 0.076, 'holo');

  const charging = r.d(box(0.044, 0.010, 0.026), sd, [0, 0.030, 0.006]);
  const bolt = r.d(box(0.005, 0.024, 0.046), sd, [0.025, 0.010, -0.045]);
  const mag = r.d(box(0.026, 0.130, 0.048), pl, [0, -0.128, -0.052], [0.16, 0, 0]);
  mag.add(mesh(box(0.030, 0.010, 0.054), pl).translateY(-0.070));

  const root = r.finish();
  const arms = attachArms(root, mats, {
    grip: {
      pos: [0.019, -0.070, -0.030], seq: [['x', 0.16], ['z', Math.PI / 2]],
      curl: 1.12, index: 0.78, thumb: 0.55, elbow: [0.10, -0.44, 0.11],
    },
    support: {
      pos: [-0.012, -0.102, -0.294], seq: [['z', -0.10], ['y', -Math.PI / 2], ['z', 1.35]],
      curl: 1.05, thumb: 0.55, elbow: [-0.16, -0.48, -0.10],
      mag: {
        pos: [0.000, -0.206, -0.052], seq: [['z', -0.15], ['y', -Math.PI / 2], ['z', 2.00]],
        elbow: [-0.20, -0.42, 0.16],
      },
      charge: {
        pos: [0.048, -0.014, 0.030], seq: [['z', 0.30], ['y', -Math.PI / 2], ['z', 2.55]],
        elbow: [0.02, -0.32, 0.28],
      },
    },
  });
  return {
    root, optic, mag, bolt, charging, ...arms,
    muzzle: r.anchor([0, -0.004, -0.444]),
    eject: r.anchor([0.032, 0.012, -0.045]),
    boltThrow: 0.026,
  };
}

// Pump 12-gauge with wood furniture and a ghost-ring sight.
function buildShotgun(mats) {
  resetJitter();
  const r = new Rig();
  const wd = mats.get('wood'), st = mats.get('steel'), sd = mats.get('steelDark'), al = mats.get('alu'), rb = mats.get('rubber');

  // receiver
  r.s(box(0.050, 0.062, 0.230), sd, [0, 0.000, -0.115]);
  r.s(box(0.052, 0.016, 0.120), sd, [0, 0.032, -0.070]);
  r.s(box(0.007, 0.030, 0.070), st, [0.026, 0.002, -0.060]);      // loading/eject port
  triggerGroup(r, sd, -0.052, -0.060);
  // wood stock with a pistol wrist
  r.s(box(0.044, 0.090, 0.130), wd, [0, -0.052, 0.070], [0.30, 0, 0]);
  r.s(box(0.048, 0.104, 0.120), wd, [0, -0.012, 0.170], [0.10, 0, 0]);
  r.s(box(0.050, 0.110, 0.016), rb, [0, -0.006, 0.228], [0.10, 0, 0]);
  r.s(box(0.030, 0.016, 0.120), wd, [0, 0.036, 0.120], [0.10, 0, 0]);
  // barrel + magazine tube + heat shield
  r.s(tube(0.0165, 0.0160, 0.470, 16), st, [0, 0.006, -0.350]);
  r.s(tube(0.0145, 0.0145, 0.380, 14), sd, [0, -0.026, -0.300]);
  for (let i = 0; i < 7; i++) r.s(box(0.036, 0.004, 0.016), sd, [0, 0.024, -0.200 - i * 0.048]);
  r.s(box(0.006, 0.032, 0.300), sd, [0.022, 0.020, -0.300], [0, 0, 0]);
  r.s(box(0.006, 0.032, 0.300), sd, [-0.022, 0.020, -0.300], [0, 0, 0]);
  r.s(tube(0.0185, 0.0185, 0.030, 16), sd, [0, 0.006, -0.596]);   // choke
  r.s(tube(0.0125, 0.0125, 0.014, 12), sd, [0, -0.026, -0.482]);  // mag cap
  // ghost ring rear + bead front
  r.s(ring(0.009, 0.0035, 12), sd, [0, 0.048, -0.060]);
  r.s(box(0.024, 0.008, 0.012), sd, [0, 0.040, -0.060]);
  r.s(box(0.004, 0.014, 0.005), sd, [0, 0.030, -0.560]);
  const bead = mesh(sph(0.0035, 8, 6), mats.get('tritium'));
  bead.position.set(0, 0.038, -0.560);
  r.root.add(bead);
  r.s(ring(0.010, 0.0022, 10), sd, [0.020, -0.024, 0.100], [0, Math.PI / 2, 0]);

  const irons = r.anchor([0, 0.048, -0.060]);

  // pump (animated) and shell lifter
  const pump = r.d(box(0.052, 0.048, 0.160), wd, [0, -0.026, -0.300]);
  for (let i = 0; i < 6; i++) pump.add(mesh(box(0.054, 0.006, 0.008), wd).translateY(0.026).translateZ(-0.06 + i * 0.024));
  const bolt = r.d(box(0.005, 0.026, 0.060), st, [0.026, 0.002, -0.060]);

  const root = r.finish();
  const arms = attachArms(root, mats, {
    grip: {
      pos: [0.019, -0.074, 0.012], seq: [['x', 0.28], ['z', Math.PI / 2]],
      curl: 1.12, index: 0.78, thumb: 0.55, elbow: [0.10, -0.46, 0.12],
    },
    support: null,
  });
  const armL = makeArm(mats, -1, { curl: 1.05, thumb: 0.25 });
  place(armL.root, [-0.046, -0.030, -0.300], [['z', -0.60], ['y', -Math.PI / 2], ['z', 0.20]]);
  aimFore(armL.root, armL.fore, [-0.22, -0.46, -0.14]);
  armL.root.traverse(o => { if (o.isMesh) o.renderOrder = 11; });
  pump.add(armL.root);
  armL.rest = { pos: armL.root.position.clone(), quat: armL.root.quaternion.clone() };
  return {
    root, optic: null, irons, mag: null, bolt, charging: null, pump,
    armR: arms.armR, armL,
    muzzle: r.anchor([0, 0.006, -0.618]),
    eject: r.anchor([0.034, 0.004, -0.060]),
    pumpThrow: 0.075, boltThrow: 0.0,
  };
}

// Bolt-action .338 with a variable scope, bipod and fluted barrel.
function buildSniper(mats) {
  resetJitter();
  const r = new Rig();
  const pl = mats.get('polymer'), st = mats.get('steel'), sd = mats.get('steelDark'),
    al = mats.get('alu'), rb = mats.get('rubber'), opt = mats.get('optic');

  // chassis
  r.s(box(0.048, 0.060, 0.300), al, [0, 0.000, -0.150]);
  r.s(box(0.054, 0.016, 0.300), al, [0, 0.032, -0.150]);
  rail(r, al, 0.290, [0, 0.042, -0.150], null, 0.022);
  r.s(box(0.052, 0.070, 0.090), pl, [0, -0.056, -0.150]);          // magwell
  r.s(box(0.034, 0.100, 0.048), pl, [0, -0.096, -0.024], [0.30, 0, 0]);
  r.s(box(0.038, 0.022, 0.044), pl, [0, -0.146, -0.006], [0.30, 0, 0]);
  triggerGroup(r, al, -0.070, -0.058);
  // skeleton stock with cheek riser and adjustable pad
  r.s(box(0.044, 0.070, 0.230), pl, [0, -0.012, 0.150]);
  r.s(box(0.046, 0.040, 0.060), pl, [0, 0.036, 0.090]);
  r.s(box(0.030, 0.026, 0.140), rb, [0, 0.046, 0.150]);            // cheek riser
  r.s(box(0.052, 0.110, 0.018), rb, [0, -0.004, 0.272]);
  r.s(box(0.030, 0.016, 0.070), al, [0, -0.052, 0.190]);           // monopod rail
  r.s(box(0.036, 0.044, 0.020), pl, [0, -0.058, 0.246]);
  // heavy fluted barrel + brake
  r.s(tube(0.0175, 0.0140, 0.560, 16), st, [0, 0.000, -0.520]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    r.s(box(0.006, 0.006, 0.300), sd, [Math.cos(a) * 0.0155, Math.sin(a) * 0.0155, -0.430], [0, 0, a]);
  }
  r.s(tube(0.022, 0.021, 0.075, 14), sd, [0, 0, -0.830]);
  for (let i = 0; i < 4; i++) {
    r.s(box(0.048, 0.006, 0.010), sd, [0, 0, -0.808 - i * 0.017]);
    r.s(box(0.006, 0.048, 0.010), sd, [0, 0, -0.808 - i * 0.017]);
  }
  r.s(tube(0.0215, 0.0215, 0.006, 14), sd, [0, 0, -0.870]);
  // handguard + bipod
  r.s(tube(0.031, 0.029, 0.300, 8), al, [0, -0.002, -0.420], [0, Math.PI / 8, 0]);
  rail(r, al, 0.180, [0, -0.032, -0.440], [0, 0, Math.PI]);
  for (const sgn of [1, -1]) {
    r.s(box(0.008, 0.008, 0.120), sd, [sgn * 0.030, -0.090, -0.520], [0.5, 0, sgn * 0.45]);
    r.s(box(0.020, 0.006, 0.014), sd, [sgn * 0.052, -0.140, -0.548]);
  }
  r.s(ring(0.011, 0.0025, 10), sd, [0.028, -0.020, -0.330], [0, Math.PI / 2, 0]);

  // ---- scope ----
  const sy = 0.098, sz = -0.200;
  r.s(tube(0.020, 0.020, 0.150, 18), opt, [0, sy, sz - 0.070]);         // objective bell tube
  r.s(tube(0.030, 0.026, 0.070, 18), opt, [0, sy, sz - 0.180]);         // objective bell
  r.s(tube(0.031, 0.031, 0.010, 18), opt, [0, sy, sz - 0.212]);
  r.s(tube(0.017, 0.017, 0.130, 18), opt, [0, sy, sz + 0.062]);         // main tube
  r.s(tube(0.024, 0.024, 0.045, 18), opt, [0, sy, sz + 0.140]);         // ocular
  r.s(tube(0.026, 0.026, 0.010, 18), opt, [0, sy, sz + 0.160]);
  r.s(tube(0.026, 0.022, 0.030, 18), opt, [0, sy, sz + 0.020]);         // magnification ring
  for (let i = 0; i < 10; i++) r.s(box(0.004, 0.004, 0.026), sd, [Math.cos(i * 0.628) * 0.025, sy + Math.sin(i * 0.628) * 0.025, sz + 0.020]);
  r.s(tube(0.013, 0.013, 0.022, 12), al, [0, sy + 0.028, sz - 0.010], [Math.PI / 2, 0, 0]);   // elevation turret
  r.s(tube(0.013, 0.013, 0.022, 12), al, [0.028, sy, sz - 0.010], [0, Math.PI / 2, 0]);       // windage turret
  r.s(tube(0.011, 0.011, 0.016, 12), al, [-0.026, sy, sz - 0.010], [0, Math.PI / 2, 0]);      // parallax
  // rings
  for (const rz of [sz - 0.055, sz + 0.070]) {
    r.s(tube(0.024, 0.024, 0.020, 16), al, [0, sy, rz]);
    r.s(box(0.020, 0.040, 0.020), al, [0, sy - 0.030, rz]);
  }
  // eyepiece cup
  r.s(tube(0.027, 0.030, 0.016, 18, true), rb, [0, sy, sz + 0.170]);

  const optic = r.anchor([0, sy, sz + 0.166]);
  optic.userData.window = 0.021;
  optic.userData.scoped = true;

  // ---- animated parts ----
  const boltGrp = new THREE.Group();
  boltGrp.position.set(0, 0.012, -0.050);
  r.root.add(boltGrp);
  boltGrp.add(mesh(tube(0.0115, 0.0115, 0.130, 12), st).translateZ(-0.02));
  const handle = mesh(box(0.008, 0.008, 0.052), st);
  handle.position.set(0.030, -0.004, 0.030);
  handle.rotation.z = -0.35;
  boltGrp.add(handle);
  const knob = mesh(sph(0.011, 10, 8), st);
  knob.position.set(0.052, -0.014, 0.030);
  boltGrp.add(knob);

  const mag = r.d(box(0.030, 0.060, 0.082), pl, [0, -0.116, -0.150]);

  const root = r.finish();
  const arms = attachArms(root, mats, {
    grip: {
      pos: [0.019, -0.084, -0.016], seq: [['x', 0.26], ['z', Math.PI / 2]],
      curl: 1.12, index: 0.78, thumb: 0.55, elbow: [0.10, -0.46, 0.12],
    },
    support: {
      pos: [-0.045, -0.014, -0.352], seq: [['z', -0.60], ['y', -Math.PI / 2], ['z', 0.28]],
      curl: 1.08, thumb: 0.15, elbow: [-0.17, -0.50, -0.03],
      mag: {
        pos: [0.000, -0.208, -0.150], seq: [['z', -0.15], ['y', -Math.PI / 2], ['z', 2.00]],
        elbow: [-0.20, -0.44, 0.14],
      },
    },
  });
  return {
    root, optic, mag, bolt: boltGrp, boltHandle: handle, charging: null, ...arms,
    muzzle: r.anchor([0, 0, -0.885]),
    eject: r.anchor([0.036, 0.014, -0.050]),
    boltThrow: 0.070, boltLift: 1.15,
  };
}

export const BUILDERS = { ar: buildAR, smg: buildSMG, shotgun: buildShotgun, sniper: buildSniper };

// A collimated red-dot: a small additive quad the Weapons module keeps aligned with
// the optic axis so the dot behaves like a virtual image at infinity.
export function makeReticle(style = 'dot', color = 0xff2a18, size = 0.055) {
  const mat = new THREE.MeshBasicMaterial({
    map: reticleTexture(style), color, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.scale.setScalar(size);
  m.userData.size = size;
  m.renderOrder = 40;
  m.frustumCulled = false;
  m.visible = false;
  return m;
}
