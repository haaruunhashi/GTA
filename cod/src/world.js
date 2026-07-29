// The map: a hand-designed three-lane Call of Duty style block.
// Owner: world agent. Public API: build(), colliders (THREE.Box3[]),
// collisionMeshes, collidersVersion, spawnPoints, navPoints, POSES.
//
//                       z-  (north — barricade / collapsed block)
//        west alley |  COURTYARD  |            | north block
//        -42..-33   |   -33..-13  |  STREET    | 12..26 SHOP ROW | east alley
//                   |  HQ (2 storey, enterable)|  PARKING LOT    | 36..
//                       z+  (south — barricade)
//
// Lane 1: the west alley behind the HQ. Lane 2: the street. Lane 3: the
// parking lot / east alley. The HQ and the shop row are the two ways to cross
// between lanes above ground level.
import * as THREE from 'three';
import { Batcher } from './world-batch.js';
import { wall, cornice, parapet, slab, stairs, fillerBlock } from './world-buildings.js';
import {
  lampPost, hydrant, jerseyBarrier, dumpster, crate, crateStack, pallet, barrel,
  tyreStack, sandbagWall, roadSign, trafficCone, bollard, acUnit, pipeRun,
  fireEscape, awning, balcony, roofClutter, wire, rubblePile, debrisScatter,
  wreckedCar, shoppingTrolley,
} from './world-props.js';

// ---------------------------------------------------------------- geometry
const ROAD_HW = 9;          // half width of the asphalt
const WALK = 3.6;           // sidewalk depth
const Z0 = -70, Z1 = 70;    // street extent

// HQ (the enterable two-storey building), west side
const HQ = { x: -23, z: -4, hw: 10, hd: 13, s1: 3.7, s2: 3.6 };
const HQ_ROOF = HQ.s1 + HQ.s2;   // 7.3

// shop row, east side
const SH = { x: 19, z: -22, hw: 7, hd: 13, h: 5.4 };

export class World {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'world';
    this.colliders = [];
    this.collisionMeshes = [];
    this.collidersVersion = 0;
    this.spawnPoints = [];
    this.navPoints = [];
    ctx.scene.add(this.root);
  }

  build() {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const B = new Batcher(this.ctx, this.root);
    this.B = B;
    const rng = this.ctx.rng;

    this.ground(B, rng);
    this.hq(B, rng);
    this.shopRow(B, rng);
    this.parking(B, rng);
    this.courtyard(B, rng);
    this.alleys(B, rng);
    this.street(B, rng);
    this.perimeter(B, rng);
    this.endcaps(B, rng);
    this.spawns();

    B.finish();
    this.colliders = B.colliders;
    this.collisionMeshes = B.collisionMeshes;
    this.collidersVersion++;

    const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    if (this.ctx.config && this.ctx.config.debug) {
      console.log(`[world] ${B.meshes.length} draw meshes, ${(B.verts / 1000) | 0}k verts, ` +
        `${this.colliders.length} colliders, ${ms.toFixed(0)} ms`);
    }
    return this;
  }

  cover(x, z) { this.navPoints.push({ x, y: 0, z }); }

  /* ------------------------------------------------------------- surfaces */

  ground(B, rng) {
    // dirt bed under everything
    B.quad('dirt', 0, -0.05, 0, 460, 460, { rotX: -Math.PI / 2 });

    // road
    B.quad('road', 0, 0, 0, ROAD_HW * 2, Z1 - Z0, { rotX: -Math.PI / 2, dirt: false });
    // patched tarmac / oil staining
    for (let i = 0; i < 26; i++) {
      B.quad('decal_dirt', (rng() - 0.5) * 17, 0.013, Z0 + rng() * (Z1 - Z0), 2 + rng() * 6, 2 + rng() * 7,
        { rotX: -Math.PI / 2, rotZ: rng() * 3, dirt: false, shadow: false });
    }
    // centre dashes + edge lines
    for (let z = Z0 + 2; z < Z1; z += 6.5) {
      B.quad('roadline', 0, 0.014, z, 0.18, 3.2, { rotX: -Math.PI / 2, dirt: false, shadow: false });
    }
    for (const sx of [-1, 1]) {
      for (let z = Z0; z < Z1; z += 20) {
        B.quad('roadline', sx * (ROAD_HW - 0.8), 0.014, z + 10, 0.14, 19.4, { rotX: -Math.PI / 2, dirt: false, shadow: false });
      }
    }
    // crossing at the centre of the map
    for (let i = 0; i < 7; i++) {
      B.quad('roadline', -6.2 + i * 2.05, 0.015, 2, 0.9, 4.2, { rotX: -Math.PI / 2, dirt: false, shadow: false });
    }

    // sidewalks: kerb face + paved top, in segments so the broadphase stays sane
    for (const sx of [-1, 1]) {
      for (let z = Z0; z < Z1; z += 10) {
        const cz = z + 5;
        B.box('curb', sx * (ROAD_HW + WALK / 2), 0.08, cz, WALK, 0.16, 10, {});
        B.box('concrete', sx * (ROAD_HW + 0.07), 0.085, cz, 0.16, 0.19, 10, { dirt: false, tint: 0xd0cabb });
        B.collider(sx * (ROAD_HW) - 0.1, sx * (ROAD_HW + WALK) + 0.1 * sx, 0, 0.16, cz - 5, cz + 5);
      }
    }
    // drains
    for (const sx of [-1, 1]) for (let z = -50; z <= 50; z += 25) {
      B.box('steel', sx * (ROAD_HW - 0.5), 0.02, z, 0.7, 0.05, 0.5, { dirt: false });
    }
  }

  /* ---------------------------------------------- the enterable two-storey */

  hq(B, rng) {
    const { x: bx, z: bz, hw, hd, s1, s2 } = HQ;
    const t = 0.45;
    const mat = 'brick_tan';
    const inner = 'plaster';
    B.push(bx, 0, bz, 0);

    // ---- ground floor shell ----------------------------------------------
    // east wall (faces the street). local +X -> world -Z
    B.push(hw, 0, 0, Math.PI / 2);
    wall(B, {
      len: hd * 2, h: s1, t, mat, inner, openings: [
        { x: 4.0, w: 1.7, y0: 0.02, y1: 2.55, kind: 'door', opts: { leaf: 0.9, frame: 'paint_blue' } },
        { x: -3.0, w: 2.4, y0: 0.95, y1: 2.75 },
        { x: -8.5, w: 2.4, y0: 0.95, y1: 2.75, opts: { broken: true } },
        { x: 9.5, w: 2.0, y0: 0.95, y1: 2.75, opts: { boarded: true } },
      ],
    });
    cornice(B, hd * 2 + 0.5, s1 + 0.12, { t, proj: 0.22, h: 0.3, mat: 'concrete' });
    B.pop();
    // north wall (faces the courtyard)
    B.push(0, 0, -hd, Math.PI);
    wall(B, {
      len: hw * 2, h: s1, t, mat, inner, openings: [
        { x: 0, w: 1.8, y0: 0.02, y1: 2.6, kind: 'door', opts: { leaf: -1.5, frame: 'paint_green' } },
        { x: -6.4, w: 2.2, y0: 1.0, y1: 2.7 },
        { x: 6.4, w: 2.2, y0: 1.0, y1: 2.7, opts: { broken: true } },
      ],
    });
    cornice(B, hw * 2 + 0.5, s1 + 0.12, { t, proj: 0.22, h: 0.3 });
    B.pop();
    // west wall (alley)
    B.push(-hw, 0, 0, -Math.PI / 2);
    wall(B, {
      len: hd * 2, h: s1, t, mat, inner, openings: [
        { x: -6, w: 1.9, y0: 1.2, y1: 2.7, opts: { boarded: true } },
        { x: 5, w: 1.9, y0: 1.2, y1: 2.7, opts: { broken: true } },
        { x: 11.2, w: 1.6, y0: 0.02, y1: 2.4, kind: 'door', opts: { leaf: 0.4, frame: 'paint_red' } },
      ],
    });
    cornice(B, hd * 2 + 0.5, s1 + 0.12, { t, proj: 0.22, h: 0.3 });
    B.pop();
    // south wall
    B.push(0, 0, hd, 0);
    wall(B, {
      len: hw * 2, h: s1, t, mat, inner, openings: [
        { x: -4.5, w: 2.6, y0: 0.02, y1: 2.7, kind: 'hole' },
        { x: 4.0, w: 2.2, y0: 1.0, y1: 2.7, opts: { boarded: true } },
      ],
    });
    cornice(B, hw * 2 + 0.5, s1 + 0.12, { t, proj: 0.22, h: 0.3 });
    B.pop();

    // ---- interior, ground -------------------------------------------------
    B.quad('concrete_floor', 0, 0.02, 0, hw * 2 - 0.6, hd * 2 - 0.6, { rotX: -Math.PI / 2 });
    // partition splitting the ground floor into two rooms, doorway at x=+3
    B.push(0, 0, 1.5, 0);
    wall(B, {
      len: hw * 2 - 0.8, h: s1, t: 0.25, mat: 'plaster', collide: true, openings: [
        { x: 3.0, w: 1.8, y0: 0.02, y1: 2.4, kind: 'door' },
        { x: -5.5, w: 1.6, y0: 1.1, y1: 2.3, kind: 'hole' },
      ],
    });
    B.pop();
    // stair flight up the north-west corner, climbing +Z
    B.beginTag('stairs', true);
    B.push(-hw + 1.4, 0, -hd + 3.6, 0);
    stairs(B, 1.7, 0, s1, 5.0, { steps: 19, mat: 'concrete', railSide: 1 });
    B.pop();
    B.endTag();
    // ---- first floor slab (hole for the stairwell) ------------------------
    slab(B, hw - 0.05, hd - 0.05, s1, {
      th: 0.3, mat: 'concrete_floor',
      hole: { x0: -hw + 0.4, x1: -hw + 2.5, z0: -hd + 0.4, z1: -hd + 6.0 },
    });
    // exposed joists round the stairwell
    for (let i = 0; i < 5; i++) {
      B.box('wood', -hw + 1.45, s1 - 0.36, -hd + 0.9 + i * 1.2, 2.2, 0.14, 0.12, { dirt: false });
    }

    // ---- first floor shell ------------------------------------------------
    B.push(hw, 0, 0, Math.PI / 2);
    wall(B, {
      len: hd * 2, h: s2, t, mat, inner, y0: s1, openings: [
        { x: -8.0, w: 2.2, y0: 0.9, y1: 2.6 },
        { x: -2.6, w: 2.2, y0: 0.9, y1: 2.6, opts: { broken: true } },
        { x: 3.2, w: 2.6, y0: 0.05, y1: 2.6, kind: 'door', opts: { frame: 'paint_blue' } },
        { x: 9.0, w: 2.2, y0: 0.9, y1: 2.6, opts: { boarded: true } },
      ],
    });
    B.pop();
    B.push(0, 0, -hd, Math.PI);
    wall(B, {
      len: hw * 2, h: s2, t, mat, inner, y0: s1, openings: [
        { x: -5.5, w: 2.2, y0: 0.9, y1: 2.6, opts: { broken: true } },
        { x: 0.5, w: 2.2, y0: 0.9, y1: 2.6 },
        { x: 6.5, w: 2.2, y0: 0.9, y1: 2.6 },
      ],
    });
    B.pop();
    B.push(-hw, 0, 0, -Math.PI / 2);
    wall(B, {
      len: hd * 2, h: s2, t, mat, inner, y0: s1, openings: [
        { x: -4.0, w: 2.0, y0: 0.1, y1: 2.5, kind: 'door', opts: { frame: 'rust' } },
        { x: 6.0, w: 2.0, y0: 1.0, y1: 2.6, opts: { broken: true } },
      ],
    });
    B.pop();
    B.push(0, 0, hd, 0);
    wall(B, {
      len: hw * 2, h: s2, t, mat, inner, y0: s1, openings: [
        { x: -4.0, w: 2.2, y0: 1.0, y1: 2.6, opts: { boarded: true } },
        { x: 4.5, w: 2.2, y0: 1.0, y1: 2.6 },
      ],
    });
    B.pop();
    // upstairs partition with a doorway — an interior angle for the top of the stairs
    B.push(-2.5, 0, 0, Math.PI / 2);
    wall(B, {
      len: hd * 2 - 1.0, h: s2, t: 0.22, mat: 'plaster', y0: s1, openings: [
        { x: -6.0, w: 1.8, y0: 0.02, y1: 2.35, kind: 'door' },
        { x: 6.5, w: 2.4, y0: 0.02, y1: 2.35, kind: 'hole' },
      ],
    });
    B.pop();

    // balcony over the street door + a second one on the courtyard side
    B.push(hw, 0, -4.0, Math.PI / 2);
    balcony(B, 3.4, { d: 1.4, y: s1 + 0.02, clutter: true });
    B.pop();
    B.push(-1.0, 0, -hd, Math.PI);
    balcony(B, 3.0, { d: 1.2, y: s1 + 0.02 });
    B.pop();

    // ---- roof --------------------------------------------------------------
    slab(B, hw - 0.05, hd - 0.05, HQ_ROOF, { th: 0.32, mat: 'concrete', under: 'wood' });
    parapet(B, hw, hd, HQ_ROOF, { h: 1.0, t: 0.36, mat });
    B.push(0, HQ_ROOF, 0, 0.0);
    roofClutter(B, hw * 1.5, hd * 1.5, rng);
    B.pop();
    // roof hatch above the stairwell
    B.box('steel', -hw + 1.5, HQ_ROOF + 0.12, -hd + 3.0, 1.6, 0.16, 1.6, { dirt: false, tint: 0x8f8b80 });
    B.box('rust', -hw + 1.5, HQ_ROOF + 0.5, -hd + 3.9, 1.7, 0.75, 0.1, { rotX: -0.5, dirt: false });

    // fire escape down the alley wall + drainpipes
    B.push(-hw - 0.7, 0, 2.0, -Math.PI / 2);
    fireEscape(B, { w: 2.8, d: 1.35, levels: 2, gap: 3.7, y0: s1 + 0.15, ladder: true });
    B.pop();
    B.push(-hw - 0.14, 0, -hd + 1.2, 0); pipeRun(B, HQ_ROOF + 0.6, { r: 0.08 }); B.pop();
    B.push(hw + 0.14, 0, hd - 1.4, 0); pipeRun(B, HQ_ROOF + 0.6, { r: 0.07 }); B.pop();
    // AC boxes bolted to the street facade
    B.push(hw + 0.55, 0, -8.6, Math.PI / 2);
    B.box('paint_white', 0, s1 + 1.4, 0, 0.9, 0.75, 0.7, { tint: 0xcfccc3 });
    B.box('steel', 0, s1 + 1.0, 0, 1.0, 0.1, 0.8, { dirt: false });
    B.pop();
    // shop sign band over the street door
    B.box('paint_red', hw + 0.16, s1 - 0.55, -4.0, 0.12, 0.7, 6.0, { dirt: false });

    B.pop(); // HQ

    // interior clutter (world space)
    const iy = 0;
    this.propAt(B, HQ.x - 6, iy, HQ.z + 6, 0.4, () => crateStack(B, rng));
    this.propAt(B, HQ.x + 5.5, iy, HQ.z + 7.5, -0.3, () => { pallet(B, rng); crate(B, 0.85); });
    this.propAt(B, HQ.x - 2.5, iy, HQ.z - 9.0, 1.2, () => barrel(B, 'paint_blue'));
    this.propAt(B, HQ.x - 1.0, iy, HQ.z - 10.0, 0.2, () => barrel(B, 'rust'));
    this.propAt(B, HQ.x + 6.0, iy, HQ.z - 6.0, 0.0, () => sandbagWall(B, 3.0, 3, rng, { depth: 2 }));
    this.cover(HQ.x + 6.0, HQ.z - 6.0);
    this.propAt(B, HQ.x + 4.0, HQ.s1, HQ.z - 10.5, 0.0, () => sandbagWall(B, 3.4, 3, rng, { depth: 2 }));
    this.cover(HQ.x + 4.0, HQ.z - 10.5);
    this.propAt(B, HQ.x - 6.5, HQ.s1, HQ.z + 4.0, 0.7, () => crateStack(B, rng));
    this.cover(HQ.x - 6.5, HQ.z + 4.0);
    this.propAt(B, HQ.x + 6.5, HQ.s1, HQ.z + 9.0, -0.5, () => { crate(B, 0.9); });
    // rubble where the south wall is blown open
    this.propAt(B, HQ.x - 4.5, 0, HQ.z + 12.0, 0.3, () => rubblePile(B, 2.2, rng, { n: 30, h: 0.7 }));
    B.push(HQ.x, 0, HQ.z, 0); debrisScatter(B, hw * 1.6, hd * 1.6, 26, rng); B.pop();
    // roof cover
    this.propAt(B, HQ.x + 5.0, HQ_ROOF, HQ.z + 6.0, 0.2, () => sandbagWall(B, 3.6, 4, rng, { depth: 2 }));
    this.cover(HQ.x + 5.0, HQ.z + 6.0);
  }

  propAt(B, x, y, z, rotY, fn) { B.push(x, y, z, rotY); fn(); B.pop(); }

  /* -------------------------------------------------------- east shop row */

  shopRow(B, rng) {
    const { x: bx, z: bz, hw, hd, h } = SH;
    const t = 0.4, mat = 'brick_red';
    B.push(bx, 0, bz, 0);
    // west wall = shopfronts onto the street
    B.push(-hw, 0, 0, -Math.PI / 2);
    wall(B, {
      len: hd * 2, h, t, mat, inner: 'plaster', openings: [
        { x: -8.5, w: 3.2, y0: 0.35, y1: 3.0, kind: 'shutter', opts: { tint: 0x9fa6a0 }, openAmt: 0.8 },
        { x: -2.0, w: 1.8, y0: 0.02, y1: 2.5, kind: 'door', opts: { leaf: -1.1, frame: 'paint_yellow' } },
        { x: 3.5, w: 3.4, y0: 0.6, y1: 2.9, opts: { broken: true } },
        { x: 9.5, w: 3.0, y0: 0.6, y1: 2.9, opts: { boarded: true } },
      ],
    });
    cornice(B, hd * 2 + 0.4, h - 0.55, { t, proj: 0.3, h: 0.34, under: true });
    B.box('paint_green', 0, h - 1.35, t / 2 + 0.05, hd * 2 - 1.2, 1.1, 0.12, { dirt: false });
    B.pop();
    // north wall (towards the collapsed end of the street)
    B.push(0, 0, -hd, Math.PI);
    wall(B, {
      len: hw * 2, h, t, mat, inner: 'plaster', openings: [
        { x: -4.0, w: 2.4, y0: 1.1, y1: 2.9, opts: { boarded: true } },
        { x: 3.5, w: 2.6, y0: 0.02, y1: 2.7, kind: 'hole' },
      ],
    });
    cornice(B, hw * 2 + 0.4, h - 0.55, { t, proj: 0.3, h: 0.34 });
    B.pop();
    // south wall — opens onto the parking lot
    B.push(0, 0, hd, 0);
    wall(B, {
      len: hw * 2, h, t, mat, inner: 'plaster', openings: [
        { x: -3.5, w: 1.8, y0: 0.02, y1: 2.5, kind: 'door', opts: { leaf: 1.2, frame: 'rust' } },
        { x: 3.8, w: 2.6, y0: 1.0, y1: 2.9, opts: { broken: true } },
      ],
    });
    cornice(B, hw * 2 + 0.4, h - 0.55, { t, proj: 0.3, h: 0.34 });
    B.pop();
    // east wall (alley)
    B.push(hw, 0, 0, Math.PI / 2);
    wall(B, {
      len: hd * 2, h, t, mat, inner: 'plaster', openings: [
        { x: -6.0, w: 1.9, y0: 1.3, y1: 3.0, opts: { boarded: true } },
        { x: 2.0, w: 1.6, y0: 0.02, y1: 2.4, kind: 'door', opts: { frame: 'paint_blue' } },
        { x: 8.0, w: 1.9, y0: 1.3, y1: 3.0, opts: { broken: true } },
      ],
    });
    cornice(B, hd * 2 + 0.4, h - 0.55, { t, proj: 0.3, h: 0.34 });
    B.pop();

    // interior floor + a couple of internal partitions (one big arcade)
    B.quad('concrete_floor', 0, 0.02, 0, hw * 2 - 0.5, hd * 2 - 0.5, { rotX: -Math.PI / 2 });
    B.push(0, 0, -4.5, 0);
    wall(B, { len: hw * 2 - 0.6, h, t: 0.22, mat: 'plaster', openings: [{ x: -2.5, w: 2.0, y0: 0.02, y1: 2.5, kind: 'door' }] });
    B.pop();
    B.push(0, 0, 5.5, 0);
    wall(B, { len: hw * 2 - 0.6, h, t: 0.22, mat: 'plaster', openings: [{ x: 2.5, w: 2.2, y0: 0.02, y1: 2.5, kind: 'hole' }] });
    B.pop();
    // shelving / counters
    for (const z of [-9, -1, 8]) {
      B.box('wood', -3.4, 0.5, z, 5.0, 1.0, 0.7, { dirt: false });
      B.collider(-5.9, -0.9, 0, 1.0, z - 0.35, z + 0.35);
      this.cover(bx - 3.4, bz + z);
    }
    // roof
    slab(B, hw - 0.03, hd - 0.03, h, { th: 0.3, mat: 'concrete', under: 'wood' });
    parapet(B, hw, hd, h, { h: 0.9, t: 0.32, mat });
    B.push(0, h, 0, 0);
    B.push(-2.0, 0, -6.0, 0.3); acUnit(B, { w: 1.4, h: 1.05, d: 1.1 }); B.pop();
    B.push(3.0, 0, 2.0, -0.6); acUnit(B, {}); B.pop();
    B.push(2.0, 0, 9.0, 0.2); acUnit(B, { w: 1.2, h: 0.9, d: 1.0 }); B.pop();
    for (let i = 0; i < 3; i++) {
      B.cyl('steel', -4 + i * 3.5, 0.45, -10 + i * 2, 0.12, 0.14, 0.9, { rc: 8 });
      B.cyl('steel', -4 + i * 3.5, 0.95, -10 + i * 2, 0.19, 0.15, 0.16, { rc: 8, dirt: false });
    }
    B.pop();
    B.pop(); // shop row local frame

    // rooftop cover (world space)
    this.propAt(B, bx - 3.5, h, bz + 4.0, 0.0, () => sandbagWall(B, 3.6, 4, rng, { depth: 2 }));
    this.cover(bx - 3.5, bz + 4.0);
    this.propAt(B, bx + 3.0, h, bz - 2.0, 0.6, () => crateStack(B, rng));

    // fire escape on the alley face -> the roof is a real lane
    B.push(SH.x + SH.hw + 0.7, 0, SH.z + 4.0, Math.PI / 2);
    fireEscape(B, { w: 2.6, d: 1.25, levels: 1, gap: 3.6, y0: SH.h - 1.5, ladder: true });
    B.pop();

    // awnings + street furniture on the shopfront
    for (const z of [-30.5, -18.5, -12.5]) {
      B.push(SH.x - SH.hw - 0.1, 0, z, -Math.PI / 2);
      awning(B, 3.6, { d: 1.7, y: 2.95, tint: z < -25 ? 0x8f3a30 : 0x2f5a86 });
      B.pop();
    }
    B.push(SH.x - SH.hw - 1.2, 0, -26.0, -Math.PI / 2); crateStack(B, rng); B.pop();
    this.cover(SH.x - SH.hw - 1.2, -26.0);
  }

  /* ------------------------------------------------------------- car park */

  parking(B, rng) {
    const x0 = 12.6, x1 = 36.5, z0 = -2, z1 = 38;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    B.quad('road', cx, 0.01, cz, x1 - x0, z1 - z0, { rotX: -Math.PI / 2, dirt: false });
    // bay markings, two ranks back to back
    for (let i = 0; i < 8; i++) {
      const x = x0 + 3 + i * 2.9;
      B.quad('roadline', x, 0.016, z0 + 7.5, 0.12, 5.0, { rotX: -Math.PI / 2, dirt: false, shadow: false });
      B.quad('roadline', x, 0.016, z1 - 7.5, 0.12, 5.0, { rotX: -Math.PI / 2, dirt: false, shadow: false });
    }
    B.quad('roadline', cx, 0.016, z0 + 10.1, x1 - x0 - 5, 0.12, { rotX: -Math.PI / 2, dirt: false, shadow: false });
    B.quad('roadline', cx, 0.016, z1 - 10.1, x1 - x0 - 5, 0.12, { rotX: -Math.PI / 2, dirt: false, shadow: false });

    // chainlink fence along the east and south edges, with posts
    const fence = (ax, az, bx2, bz2) => {
      const dx = bx2 - ax, dz = bz2 - az, len = Math.hypot(dx, dz);
      const rot = Math.atan2(dx, dz);
      const n = Math.round(len / 3);
      B.push((ax + bx2) / 2, 0, (az + bz2) / 2, rot);
      B.quad('chainlink', 0, 1.1, 0, len, 2.2, { rotY: Math.PI / 2, dirt: false, shadow: false });
      B.cyl('steel', 0, 2.24, 0, 0.04, 0.04, len, { rotX: Math.PI / 2, rc: 6 });
      for (let i = 0; i <= n; i++) {
        B.cyl('steel', 0, 1.15, -len / 2 + i * len / n, 0.05, 0.055, 2.35, { rc: 8 });
      }
      B.collider(-0.12, 0.12, 0, 2.2, -len / 2, len / 2);
      B.pop();
    };
    fence(x1, z0 + 1, x1, z1);
    fence(x1, z1, 20, z1);

    // entrance from the street: bollards, barriers, a booth
    B.push(14.0, 0, 5.0, 0.1); jerseyBarrier(B, 2.6, { stripe: true }); B.pop(); this.cover(14, 5);
    B.push(14.0, 0, 8.2, -0.06); jerseyBarrier(B, 2.6, { stripe: true }); B.pop();
    B.push(17.5, 0, 3.0, 0); bollard(B); B.pop();
    B.push(19.5, 0, 3.0, 0); bollard(B); B.pop();
    // attendant booth
    B.push(21.5, 0, 6.0, 0.2);
    B.box('plaster', 0, 1.4, 0, 2.4, 2.8, 2.2, {});
    B.collider(-1.2, 1.2, 0, 2.8, -1.1, 1.1);
    B.quad('glass', 0, 1.7, 1.12, 1.8, 1.1, { dirt: false, shadow: false });
    B.box('paint_yellow', 0, 2.95, 0, 2.9, 0.22, 2.7, { dirt: false });
    B.box('corrugated', 0, 3.12, 0, 2.7, 0.1, 2.5, { dirt: false });
    B.pop();
    this.cover(21.5, 6.0);

    // parked / wrecked vehicles
    B.push(17.5, 0, 12.0, Math.PI / 2 + 0.05); wreckedCar(B, rng, { burnt: false, mat: 'paint_blue' }); B.pop();
    this.cover(17.5, 12.0);
    B.push(24.5, 0, 12.4, Math.PI / 2 - 0.03); wreckedCar(B, rng, { burnt: true, crushed: true, missing: 1 }); B.pop();
    this.cover(24.5, 12.4);
    B.push(31.0, 0, 26.0, -Math.PI / 2 + 0.08); wreckedCar(B, rng, { burnt: false, mat: 'paint_red' }); B.pop();
    this.cover(31.0, 26.0);
    B.push(20.0, 0, 27.0, -Math.PI / 2); wreckedCar(B, rng, { burnt: true, missing: 3 }); B.pop();
    this.cover(20.0, 27.0);

    // clutter
    B.push(34.4, 0, 8.0, 0.4); dumpster(B, { trash: true }); B.pop(); this.cover(34.4, 8);
    B.push(34.2, 0, 20.0, -0.2); tyreStack(B, 5, rng); B.pop();
    B.push(33.0, 0, 21.4, 0.6); tyreStack(B, 3, rng); B.pop();
    B.push(28.0, 0, 34.0, 0.3); crateStack(B, rng); B.pop(); this.cover(28, 34);
    B.push(30.5, 0, 33.0, -0.5); barrel(B, 'rust'); B.pop();
    B.push(15.0, 0, 33.0, 0.1); sandbagWall(B, 4.5, 4, rng, { depth: 2 }); B.pop(); this.cover(15, 33);
    B.push(26.0, 0, 4.0, 0.0); shoppingTrolley(B); B.pop();
    for (let i = 0; i < 5; i++) { B.push(13.5 + i * 0.9, 0, 20 + i * 1.6, 0); trafficCone(B); B.pop(); }
    // lighting masts
    for (const p of [[16, 20], [33.5, 4], [33.5, 32]]) {
      B.push(p[0], 0, p[1], p[0] > 25 ? Math.PI : 0); lampPost(B, { h: 7.2 }); B.pop();
    }
    B.push(30, 0, 2, 0); roadSign(B, 2, { h: 2.6 }); B.pop();
    B.push(cx, 0, cz, 0); debrisScatter(B, 24, 32, 30, rng); B.pop();
  }

  /* ------------------------------------------------------------ courtyard */

  courtyard(B, rng) {
    const x0 = -34, x1 = -13, z0 = -40, z1 = -18;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    B.quad('dirt', cx, 0.012, cz, x1 - x0, z1 - z0, { rotX: -Math.PI / 2 });
    for (let i = 0; i < 14; i++) {
      B.quad('decal_dirt', x0 + rng() * (x1 - x0), 0.02, z0 + rng() * (z1 - z0), 3 + rng() * 5, 3 + rng() * 5,
        { rotX: -Math.PI / 2, rotZ: rng() * 3, dirt: false, shadow: false });
    }
    // perimeter wall with a gate onto the street and a gap to the alley
    const lowWall = (ax, az, bx2, bz2, gaps) => {
      const dx = bx2 - ax, dz = bz2 - az, len = Math.hypot(dx, dz);
      // local +X follows the run, local +Z is the outward face
      B.push((ax + bx2) / 2, 0, (az + bz2) / 2, Math.atan2(-dz, dx));
      wall(B, { len, h: 2.5, t: 0.35, mat: 'plaster', openings: gaps || [] });
      B.box('concrete', 0, 2.62, 0, len + 0.1, 0.16, 0.55, { dirt: false });
      B.pop();
    };
    lowWall(x0, z0 + 0.2, x0, z1, [{ x: 8, w: 3.0, y0: 0.02, y1: 2.5, kind: 'hole' }]);
    lowWall(x1 - 4, z0, x0, z0, [{ x: 6, w: 2.2, y0: 1.2, y1: 2.1, kind: 'hole' }]);
    lowWall(x1 - 0.2, z1 - 1, x1 - 0.2, z0 + 4, [{ x: 7, w: 4.0, y0: 0.02, y1: 2.5, kind: 'hole' }]);

    // planters and a dead tree ring
    for (const p of [[-30, -34], [-17, -35]]) {
      B.push(p[0], 0, p[1], 0.2);
      B.box('concrete', 0, 0.42, 0, 2.6, 0.84, 2.6, { solid: true });
      B.box('dirt', 0, 0.86, 0, 2.2, 0.12, 2.2, {});
      B.cyl('wood', 0, 1.6, 0, 0.11, 0.19, 1.5, { rc: 8 });
      for (let i = 0; i < 5; i++) {
        B.cyl('wood', Math.cos(i * 1.3) * 0.4, 2.4 + i * 0.1, Math.sin(i * 1.3) * 0.4, 0.03, 0.06, 1.3,
          { rotX: Math.cos(i) * 0.6, rotZ: Math.sin(i) * 0.6, rc: 5 });
      }
      B.pop();
      this.cover(p[0], p[1]);
    }
    // sandbag fighting positions
    B.push(-27.0, 0, -25.0, 0.0); sandbagWall(B, 4.2, 4, rng, { depth: 2 }); B.pop(); this.cover(-27, -25);
    B.push(-20.0, 0, -30.0, 1.35); sandbagWall(B, 3.4, 3, rng, { depth: 2 }); B.pop(); this.cover(-20, -30);
    B.push(-31.5, 0, -22.0, 0.2); crateStack(B, rng); B.pop(); this.cover(-31.5, -22);
    B.push(-24.0, 0, -21.0, -0.4); pallet(B, rng); B.pop();
    B.push(-24.6, 0, -20.6, 0.3); barrel(B, 'paint_blue'); B.pop();
    B.push(-16.0, 0, -24.0, 0.6); dumpster(B, { trash: true, mat: 'paint_blue' }); B.pop(); this.cover(-16, -24);
    B.push(-23.0, 0, -36.0, -Math.PI / 2 + 0.2); wreckedCar(B, rng, { burnt: true, crushed: true, missing: 2 }); B.pop();
    this.cover(-23, -36);
    B.push(-32.0, 0, -38.0, 0.4); rubblePile(B, 3.0, rng, { n: 34, h: 1.0 }); B.pop();
    B.push(-14.5, 0, -19.5, 0); lampPost(B, { h: 6.0 }); B.pop();
    B.push(cx, 0, cz, 0); debrisScatter(B, 20, 20, 26, rng); B.pop();
    // shed against the north wall
    B.push(-29.0, 0, -37.5, 0.05);
    B.box('corrugated', 0, 1.35, 0, 4.2, 2.7, 3.0, { tint: 0xa8a49a });
    B.collider(-2.1, 2.1, 0, 2.7, -1.5, 1.5);
    B.box('corrugated', 0, 2.82, 0.1, 4.6, 0.14, 3.4, { rotX: -0.12, dirt: false });
    B.box('rust', 0, 1.15, 1.52, 1.6, 2.2, 0.08, { dirt: false });
    B.pop();
  }

  /* --------------------------------------------------------------- alleys */

  alleys(B, rng) {
    // west alley: between the HQ block and the west perimeter
    for (let z = -30; z <= 40; z += 14) {
      B.push(-38 + (rng() - 0.5) * 1.5, 0, z + (rng() - 0.5) * 3, rng() * 0.5);
      dumpster(B, { trash: rng() > 0.5, mat: rng() > 0.5 ? 'paint_green' : 'rust' });
      B.pop();
      this.cover(-38, z);
    }
    B.push(-36.5, 0, -12, 0.4); crateStack(B, rng); B.pop(); this.cover(-36.5, -12);
    B.push(-38.8, 0, 6, -0.3); tyreStack(B, 4, rng); B.pop();
    B.push(-37.0, 0, 22, 0.2); barrel(B, 'rust'); B.pop();
    B.push(-37.6, 0, 22.8, 0.9); barrel(B, 'paint_blue'); B.pop();
    B.push(-38.6, 0, -24, 0.1); pallet(B, rng); B.pop();
    B.push(-35.5, 0, 34, 0.3); rubblePile(B, 2.4, rng, { n: 24 }); B.pop();
    // washing lines / power drops across the alley
    for (let i = 0; i < 4; i++) {
      const z = -26 + i * 17;
      wire(B, [-33.2, 5.6 + rng(), z], [-40.2, 6.4 + rng(), z + 2], 1.1);
    }
    // east alley behind the shops
    for (let z = -34; z <= -8; z += 9) {
      B.push(29.5 + (rng() - 0.5) * 1.5, 0, z, rng() * 0.6);
      if (rng() > 0.5) dumpster(B, { trash: true }); else crateStack(B, rng);
      B.pop();
      this.cover(29.5, z);
    }
    B.push(32.0, 0, -20, 0.5); tyreStack(B, 6, rng); B.pop();
    B.push(27.5, 0, -28, 0); barrel(B, 'rust'); B.pop();
    for (let i = 0; i < 3; i++) wire(B, [26.4, 5.2, -32 + i * 11], [36.8, 6.6, -30 + i * 11], 1.0);
    // pipes on the alley faces
    for (const p of [[-33.2, 10, -Math.PI / 2], [26.3, -30, Math.PI / 2], [26.3, -14, Math.PI / 2]]) {
      B.push(p[0], 0, p[1], p[2]); pipeRun(B, 5.0, { r: 0.07 }); B.pop();
    }
  }

  /* --------------------------------------------------------------- street */

  street(B, rng) {
    // lamp posts down both kerbs, arms out over the road
    for (let z = -54; z <= 54; z += 18) {
      B.push(-(ROAD_HW + 1.2), 0, z, 0); lampPost(B, { h: 6.8 }); B.pop();
      B.push(ROAD_HW + 1.2, 0, z + 9, Math.PI); lampPost(B, { h: 6.8 }); B.pop();
    }
    // hydrants, signs, bins
    B.push(-(ROAD_HW + 0.9), 0, 14, 0); hydrant(B); B.pop();
    B.push(ROAD_HW + 0.9, 0, -18, Math.PI); hydrant(B); B.pop();
    B.push(-(ROAD_HW + 1.0), 0, -34, 0.2); hydrant(B); B.pop();
    B.push(-(ROAD_HW + 1.6), 0, 2, Math.PI * 0.5); roadSign(B, 0); B.pop();
    B.push(ROAD_HW + 1.6, 0, -2, -Math.PI * 0.5); roadSign(B, 3); B.pop();
    B.push(-(ROAD_HW + 1.6), 0, -44, Math.PI * 0.5); roadSign(B, 1, { h: 2.8 }); B.pop();
    B.push(ROAD_HW + 1.6, 0, 30, -Math.PI * 0.5); roadSign(B, 2, { h: 3.0 }); B.pop();

    // mid-street cover: this is what makes the lane playable
    B.push(-3.5, 0, -12, 0.06); jerseyBarrier(B, 3.0, { stripe: true }); B.pop(); this.cover(-3.5, -12);
    B.push(-0.4, 0, -12.4, -0.04); jerseyBarrier(B, 3.0, { stripe: true }); B.pop();
    B.push(4.2, 0, -13.5, 0.5); jerseyBarrier(B, 3.0, {}); B.pop(); this.cover(4.2, -13.5);
    B.push(2.0, 0, 16.0, Math.PI / 2 + 0.1); wreckedCar(B, rng, { burnt: true, crushed: true, missing: 2 }); B.pop();
    this.cover(2.0, 16.0);
    B.push(-5.0, 0, 24.0, Math.PI / 2 - 0.25); wreckedCar(B, rng, { burnt: false, mat: 'paint_green' }); B.pop();
    this.cover(-5.0, 24.0);
    B.push(5.5, 0, -32.0, 0.0); sandbagWall(B, 4.0, 3, rng, { depth: 2 }); B.pop(); this.cover(5.5, -32);
    B.push(-6.0, 0, -40.0, 0.2); sandbagWall(B, 3.6, 3, rng, { depth: 2 }); B.pop(); this.cover(-6, -40);
    B.push(0.5, 0, 40.0, 0.0); sandbagWall(B, 4.4, 4, rng, { depth: 2 }); B.pop(); this.cover(0.5, 40);
    B.push(-6.5, 0, -4.0, 0.3); crateStack(B, rng); B.pop(); this.cover(-6.5, -4);
    B.push(7.0, 0, 6.0, -0.2); crateStack(B, rng); B.pop(); this.cover(7.0, 6.0);
    for (let i = 0; i < 6; i++) { B.push(-7.5 + i * 0.4, 0, -20 + i * 1.5, 0); trafficCone(B); B.pop(); }
    B.push(8.0, 0, 44, 0.4); dumpster(B, { trash: true }); B.pop(); this.cover(8, 44);

    // overhead cabling across the street
    for (let i = 0; i < 6; i++) {
      const z = -50 + i * 20;
      wire(B, [-12.6, 7.4, z], [12.6, 7.9, z + 3], 1.6);
      wire(B, [-12.6, 6.9, z + 0.6], [12.6, 7.4, z + 3.6], 1.9);
    }

    // scatter across the whole road
    B.push(0, 0, 0, 0); debrisScatter(B, ROAD_HW * 2, 110, 60, rng); B.pop();
  }

  /* ------------------------------------------------------------ perimeter */

  endcaps(B, rng) {
    // north: the street is blocked by a collapsed building and a barricade
    B.push(-2.0, 0, -56.0, 0.0);
    sandbagWall(B, 7.0, 4, rng, { depth: 2, taper: true });
    B.pop();
    this.cover(-2.0, -56.0);
    B.push(5.5, 0, -55.0, 0.1); jerseyBarrier(B, 3.0, { stripe: true }); B.pop();
    B.push(8.5, 0, -55.4, -0.1); jerseyBarrier(B, 3.0, { stripe: true }); B.pop();
    B.push(-8.0, 0, -54.0, 0.35); wreckedCar(B, rng, { burnt: true, crushed: true, missing: 0 }); B.pop();
    B.push(0, 0, -62, 0); rubblePile(B, 7.5, rng, { n: 70, h: 2.4, rebar: 12 }); B.pop();
    B.push(-12, 0, -60, 0.4); rubblePile(B, 4.5, rng, { n: 40, h: 1.6, rebar: 6 }); B.pop();
    for (let i = 0; i < 4; i++) { B.push(-6 + i * 3, 0, -50, 0); trafficCone(B); B.pop(); }

    // south: checkpoint
    B.push(1.0, 0, 54.0, 0.0); sandbagWall(B, 6.0, 4, rng, { depth: 2, taper: true }); B.pop();
    this.cover(1.0, 54.0);
    B.push(-6.0, 0, 53.0, 0.08); jerseyBarrier(B, 3.0, { stripe: true }); B.pop();
    B.push(-9.0, 0, 53.4, -0.12); jerseyBarrier(B, 3.0, { stripe: true }); B.pop();
    B.push(7.5, 0, 52.0, -0.3); wreckedCar(B, rng, { burnt: false, mat: 'paint_yellow' }); B.pop();
    B.push(-3.0, 0, 58.0, 0.2); crateStack(B, rng); B.pop();
    B.push(4.0, 0, 58.5, -0.3); barrel(B, 'rust'); B.pop();
    B.push(0, 0, 47, 0); roadSign(B, 3, { h: 3.2 }); B.pop();
  }

  perimeter(B, rng) {
    const blocks = [
      // west side
      { x: -24, z: -50, w: 22, d: 14, h: 14, faces: 'se', mat: 'brick_grey' },
      { x: -21, z: 26, w: 16, d: 18, h: 8.5, faces: 'nse', mat: 'brick_red' },
      { x: -22, z: 48, w: 18, d: 16, h: 12, faces: 'ne', mat: 'brick_tan' },
      { x: -48, z: -30, w: 16, d: 30, h: 17, faces: 'e', mat: 'brick_grey' },
      { x: -48, z: 4, w: 16, d: 34, h: 20, faces: 'e', mat: 'brick_tan' },
      { x: -48, z: 40, w: 16, d: 30, h: 15, faces: 'e', mat: 'brick_red' },
      // east side
      { x: 24, z: -50, w: 26, d: 14, h: 16, faces: 'sw', mat: 'brick_tan' },
      { x: 46, z: -24, w: 18, d: 30, h: 18, faces: 'w', mat: 'brick_grey' },
      { x: 46, z: 12, w: 18, d: 30, h: 22, faces: 'w', mat: 'brick_red' },
      { x: 21, z: 48, w: 20, d: 16, h: 11, faces: 'nw', mat: 'brick_grey' },
      { x: 44, z: 46, w: 20, d: 20, h: 14, faces: 'nw', mat: 'brick_tan' },
      // far backdrops, mostly silhouette through the fog
      { x: -14, z: -76, w: 46, d: 18, h: 26, faces: 's', mat: 'brick_grey' },
      { x: 34, z: -78, w: 40, d: 18, h: 21, faces: 's', mat: 'brick_tan' },
      { x: -8, z: 76, w: 44, d: 18, h: 24, faces: 'n', mat: 'brick_tan' },
      { x: 38, z: 78, w: 34, d: 18, h: 19, faces: 'n', mat: 'brick_grey' },
      { x: -74, z: 0, w: 20, d: 80, h: 30, faces: 'e', mat: 'brick_grey' },
      { x: 74, z: 0, w: 20, d: 80, h: 28, faces: 'w', mat: 'brick_tan' },
    ];
    for (const b of blocks) {
      B.push(b.x, 0, b.z, 0);
      fillerBlock(B, { w: b.w, d: b.d, h: b.h, mat: b.mat, faces: b.faces, rnd: rng });
      B.pop();
    }
    // ground-level shopfront detail on the two blocks that face the street
    B.push(-21, 0, 26 - 9 - 0.05, Math.PI);
    B.box('paint_red', 0, 3.4, 0.28, 15, 1.0, 0.2, { dirt: false });
    B.pop();
  }

  /* --------------------------------------------------------------- spawns */

  spawns() {
    const list = [
      [0, 50, Math.PI], [-5, 52, Math.PI], [5, 52, Math.PI],
      [-20, 44, Math.PI], [22, 40, Math.PI + 0.4], [30, 30, Math.PI + 0.6],
      [0, -46, 0], [-6, -48, 0], [6, -48, 0],
      [-26, -30, 0.5], [-38, -20, 0.2], [24, -30, -0.4],
      [-20, -4, Math.PI / 2], [18, -20, -Math.PI / 2],
    ];
    for (const s of list) this.spawnPoints.push({ x: s[0], y: 0, z: s[1], yaw: s[2] });
    // a few nav nodes on the upper floors so the AI uses them
    this.navPoints.push({ x: HQ.x + 6, y: HQ.s1, z: HQ.z - 10 });
    this.navPoints.push({ x: HQ.x - 6, y: HQ.s1, z: HQ.z + 4 });
    this.navPoints.push({ x: SH.x - 3.5, y: SH.h, z: SH.z + 4 });
  }
}

// Named deterministic camera setups used by tools/shot.mjs for visual review.
export const POSES = {
  street: { pos: [2.5, 1.7, 44], look: [-2, 4, -26] },
  alley: { pos: [-37.5, 1.7, 34], look: [-36.5, 2.4, -22] },
  rooftop: { pos: [-23, 9.2, 4], look: [10, 0.5, -28] },
  gunsight: { pos: [3, 1.62, 22], look: [-1, 1.9, -34], ads: true },
  interior: { pos: [-30, 1.68, -6], look: [-14, 1.6, -9] },
  courtyard: { pos: [-30, 1.7, -35], look: [-15, 3.5, -18] },
  parking: { pos: [33, 1.7, 30], look: [13, 3, 2] },
};
