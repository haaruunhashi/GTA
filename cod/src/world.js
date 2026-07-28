// The map: geometry, buildings, props, cover, spawns, navigation hints.
// Owner: world agent. Public API: build(), colliders (array of THREE.Box3 / meshes),
// spawnPoints, navPoints, poses (named camera setups for the screenshot harness).
import * as THREE from 'three';

export class World {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.colliders = [];      // THREE.Box3 in world space (physics consumes these)
    this.spawnPoints = [];    // {x,y,z,yaw}
    this.navPoints = [];      // {x,y,z} cover / patrol nodes for AI
    ctx.scene.add(this.root);
  }
  build() {
    const M = this.ctx.materials;
    // ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), M.get('asphalt'));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.root.add(ground);

    // a simple street of blocks — placeholder layout the world agent replaces
    const rng = this.ctx.rng;
    for (let i = 0; i < 26; i++) {
      const w = 8 + rng() * 14, d = 8 + rng() * 14, h = 6 + rng() * 20;
      const side = i % 2 ? 1 : -1;
      const x = side * (16 + rng() * 40), z = -110 + i * 9 + rng() * 6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.get(rng() > 0.5 ? 'brick' : 'concrete'));
      b.position.set(x, h / 2, z);
      b.castShadow = b.receiveShadow = true;
      this.root.add(b);
      this.addBox(b);
    }
    // low cover along the street
    for (let i = 0; i < 22; i++) {
      const x = (rng() - 0.5) * 24, z = -100 + rng() * 200;
      const c = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.1, 1.1), this.ctx.materials.get('concrete'));
      c.position.set(x, 0.55, z);
      c.castShadow = c.receiveShadow = true;
      this.root.add(c);
      this.addBox(c);
      this.navPoints.push({ x, y: 0, z });
    }
    for (let i = 0; i < 12; i++) {
      this.spawnPoints.push({ x: (rng() - 0.5) * 20, y: 0, z: -90 + rng() * 180, yaw: rng() * Math.PI * 2 });
    }
    return this;
  }
  addBox(mesh) {
    mesh.updateMatrixWorld();
    this.colliders.push(new THREE.Box3().setFromObject(mesh));
  }
}

// Named deterministic camera setups used by tools/shot.mjs for visual review.
export const POSES = {
  street: { pos: [0, 1.7, 60], look: [0, 3, -40] },
  alley: { pos: [-18, 1.7, 10], look: [10, 2, -20] },
  rooftop: { pos: [30, 22, 30], look: [0, 2, -20] },
  gunsight: { pos: [0, 1.65, 20], look: [0, 1.65, -30], ads: true },
};
