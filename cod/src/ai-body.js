// Procedural enemy soldier: geometry, walk cycle, weapon, death topple.
// Built from primitives so there are no asset files. One shared material set
// across all bots — per-soldier variation comes from colour tints on instanced
// clones, not from new materials, so a full squad stays cheap.
import * as THREE from 'three';

const _v = new THREE.Vector3();

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const mk = (color, rough, metal = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  SHARED = {
    fatigue: mk(0x4a4f3a, 0.92),      // uniform
    vest: mk(0x33362c, 0.78),         // plate carrier
    skin: mk(0x9a7355, 0.72),
    helmet: mk(0x3b3f33, 0.62),
    boot: mk(0x241f1a, 0.85),
    gun: mk(0x22242a, 0.45, 0.75),
    strap: mk(0x2a2b26, 0.9),
    geo: {
      torso: new THREE.CapsuleGeometry(0.20, 0.34, 4, 10),
      vest: new THREE.BoxGeometry(0.44, 0.44, 0.28),
      pouch: new THREE.BoxGeometry(0.10, 0.09, 0.06),
      head: new THREE.SphereGeometry(0.115, 12, 10),
      helmet: new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      limb: new THREE.CapsuleGeometry(0.062, 0.24, 3, 8),
      thigh: new THREE.CapsuleGeometry(0.082, 0.26, 3, 8),
      boot: new THREE.BoxGeometry(0.12, 0.08, 0.24),
      body: new THREE.BoxGeometry(0.055, 0.07, 0.42),
      mag: new THREE.BoxGeometry(0.035, 0.13, 0.06),
      barrel: new THREE.CylinderGeometry(0.011, 0.011, 0.30, 8),
    },
  };
  return SHARED;
}

export function makeSoldier(ctx, seed = Math.random()) {
  const S = shared();
  const g = new THREE.Group();
  const scale = 0.96 + seed * 0.1;

  // slight per-soldier uniform variation without new materials
  const tint = new THREE.Color().setHSL(0.18 + seed * 0.06, 0.16, 0.22 + seed * 0.05);

  const M = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // --- torso -------------------------------------------------------------
  const hips = new THREE.Group();
  hips.position.y = 0.86;
  g.add(hips);

  const torso = M(S.geo.torso, S.fatigue, 0, 0.16, 0);
  torso.material = S.fatigue.clone();
  torso.material.color.copy(tint);
  hips.add(torso);

  const vest = M(S.geo.vest, S.vest, 0, 0.20, 0.01);
  hips.add(vest);
  for (let i = 0; i < 3; i++) hips.add(M(S.geo.pouch, S.strap, -0.12 + i * 0.12, 0.05, 0.16));

  // --- head --------------------------------------------------------------
  const neck = new THREE.Group();
  neck.position.y = 0.44;
  hips.add(neck);
  neck.add(M(S.geo.head, S.skin, 0, 0.06, 0));
  const helmet = M(S.geo.helmet, S.helmet, 0, 0.075, 0);
  helmet.rotation.x = -0.12;
  neck.add(helmet);

  // --- arms: shoulder groups so the walk cycle and recoil can drive them --
  const armL = new THREE.Group(); armL.position.set(-0.235, 0.34, 0);
  const armR = new THREE.Group(); armR.position.set(0.235, 0.34, 0);
  hips.add(armL, armR);
  for (const [arm, side] of [[armL, -1], [armR, 1]]) {
    const upper = M(S.geo.limb, S.fatigue, 0, -0.14, 0);
    upper.material = torso.material;
    arm.add(upper);
    const fore = new THREE.Group();
    fore.position.y = -0.29;
    arm.add(fore);
    fore.add(M(S.geo.limb, S.skin, 0, -0.13, 0));
    arm.userData.fore = fore;
    arm.userData.side = side;
  }

  // --- legs --------------------------------------------------------------
  const legL = new THREE.Group(); legL.position.set(-0.105, 0, 0);
  const legR = new THREE.Group(); legR.position.set(0.105, 0, 0);
  hips.add(legL, legR);
  for (const leg of [legL, legR]) {
    const thigh = M(S.geo.thigh, S.fatigue, 0, -0.19, 0);
    thigh.material = torso.material;
    leg.add(thigh);
    const shin = new THREE.Group();
    shin.position.y = -0.40;
    leg.add(shin);
    shin.add(M(S.geo.thigh, S.fatigue, 0, -0.17, 0));
    shin.add(M(S.geo.boot, S.boot, 0, -0.36, 0.04));
    leg.userData.shin = shin;
  }

  // --- rifle, held in both hands ----------------------------------------
  const gun = new THREE.Group();
  gun.position.set(0.16, 0.30, 0.22);
  gun.rotation.set(0, -0.12, 0);
  hips.add(gun);
  gun.add(M(S.geo.body, S.gun, 0, 0, 0));
  gun.add(M(S.geo.mag, S.gun, 0, -0.09, 0.02));
  const barrel = M(S.geo.barrel, S.gun, 0, 0.005, -0.34);
  barrel.rotation.x = Math.PI / 2;
  gun.add(barrel);

  g.scale.setScalar(scale);

  const state = {
    group: g, hips, neck, gun,
    phase: seed * Math.PI * 2,
    recoilT: 0,
    dying: 0,
    _dead: false,
  };

  state.recoil = () => { state.recoilT = 1; };

  state.die = (dir, physics) => {
    state._dead = true;
    state.dying = 0;
    // topple away from the shot; physics.ragdoll if that module offers it
    if (physics && physics.ragdoll) {
      try {
        state.ragdoll = physics.ragdoll({ root: g, hips, impulse: dir });
      } catch (e) { state.ragdoll = null; }
    }
    state.fallDir = dir ? Math.atan2(dir.x, dir.z) : 0;
  };

  state.update = (dt, speed, dead) => {
    if (dead || state._dead) {
      // 0.5s collapse: fold at the hips, topple, settle to the ground
      state.dying = Math.min(1, state.dying + dt * 2.2);
      const k = state.dying;
      const ease = 1 - Math.pow(1 - k, 3);
      g.rotation.x = ease * (Math.PI / 2) * 0.92;
      hips.position.y = 0.86 - ease * 0.62;
      neck.rotation.x = ease * 0.5;
      armL.rotation.x = -ease * 0.9; armR.rotation.x = -ease * 0.7;
      legL.rotation.x = ease * 0.35; legR.rotation.x = ease * 0.15;
      return;
    }

    // walk cycle: hips bob, limbs swing, all scaled by ground speed
    const stride = Math.min(1, speed / 3.4);
    state.phase += dt * (2.2 + speed * 1.5);
    const s = Math.sin(state.phase), c = Math.cos(state.phase);

    hips.position.y = 0.86 + Math.abs(c) * 0.022 * stride;
    hips.rotation.y = s * 0.06 * stride;

    legL.rotation.x = s * 0.62 * stride;
    legR.rotation.x = -s * 0.62 * stride;
    legL.userData.shin.rotation.x = Math.max(0, -s) * 0.7 * stride;
    legR.userData.shin.rotation.x = Math.max(0, s) * 0.7 * stride;

    // arms stay on the weapon; only a little counter-sway
    const r = state.recoilT;
    armL.rotation.set(-1.15 - r * 0.12, 0.30, 0.35);
    armR.rotation.set(-1.05 - r * 0.18, -0.22, -0.30);
    armL.userData.fore.rotation.x = -0.85;
    armR.userData.fore.rotation.x = -1.05;
    gun.position.z = 0.22 - r * 0.05;
    gun.rotation.x = r * 0.14;
    neck.rotation.y = -s * 0.05 * stride;

    if (state.recoilT > 0) state.recoilT = Math.max(0, state.recoilT - dt * 9);
  };

  state.dispose = () => {
    g.traverse(o => {
      if (o.isMesh && o.material && o.material !== S.fatigue && o.material.dispose) {
        if (o.material.userData.__shared !== true) o.material.dispose();
      }
    });
  };

  return state;
}
