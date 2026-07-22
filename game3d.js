/* FACELESS CITY 3D — Three.js renderer + input + HUD over the FCCore simulation. */
(() => {
'use strict';
const C = window.FCCore, S = C.S, U = C.utils;
const T3 = window.THREE;
const TAU = Math.PI * 2;
const clamp = U.clamp;

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new T3.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.toneMapping = T3.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T3.PCFShadowMap;
const scene = new T3.Scene();
const DUSK = 0x1d2438;
scene.fog = new T3.Fog(0x30344f, 200, 1600);
const camera = new T3.PerspectiveCamera(70, 1, 0.1, 3000);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// dusk sky dome with stars + horizon glow
{
  const skyC = document.createElement('canvas'); skyC.width = 1024; skyC.height = 512;
  const sg = skyC.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#0a0f20'); grad.addColorStop(0.45, '#1c2444');
  grad.addColorStop(0.72, '#39395c'); grad.addColorStop(0.85, '#6b5346'); grad.addColorStop(1, '#a5744c');
  sg.fillStyle = grad; sg.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 320; i++) {
    const y = Math.random() * 300;
    sg.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.8 * (1 - y / 320)) + ')';
    sg.fillRect(Math.random() * 1024, y, Math.random() < 0.1 ? 2 : 1, 1);
  }
  const skyTex = new T3.CanvasTexture(skyC);
  skyTex.colorSpace = T3.SRGBColorSpace;
  const sky = new T3.Mesh(new T3.SphereGeometry(2400, 24, 16),
    new T3.MeshBasicMaterial({ map: skyTex, side: T3.BackSide, fog: false, depthWrite: false }));
  sky.rotation.y = 1.2;
  window.__skyDome = sky;
  scene.add(sky);
}
scene.add(new T3.HemisphereLight(0x54689e, 0x38342c, 1.35));
scene.add(new T3.AmbientLight(0x4a5470, 0.85));
const moon = new T3.DirectionalLight(0x9fb2de, 1.15);
moon.position.set(-60, 140, 45);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.near = 10; moon.shadow.camera.far = 360;
moon.shadow.camera.left = -85; moon.shadow.camera.right = 85;
moon.shadow.camera.top = 85; moon.shadow.camera.bottom = -85;
moon.shadow.bias = -0.00015;
moon.shadow.normalBias = 0.6;
scene.add(moon); scene.add(moon.target);

// ---------- shared materials / textures ----------
function canvasTex(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  fn(c.getContext('2d'), w, h);
  const t = new T3.CanvasTexture(c);
  t.wrapS = t.wrapT = T3.RepeatWrapping;
  return t;
}
const winTex = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = '#353244'; g.fillRect(0, 0, w, h);
  for (let y = 8; y < h - 8; y += 18) for (let x = 8; x < w - 8; x += 16) {
    const lit = Math.random() < 0.32;
    g.fillStyle = lit ? (Math.random() < 0.5 ? '#ffd9a0' : '#c8d8f0') : '#141824';
    g.fillRect(x, y, 9, 11);
  }
});
const winTex2 = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = '#4a4438'; g.fillRect(0, 0, w, h);
  for (let y = 10; y < h - 8; y += 22) for (let x = 8; x < w - 8; x += 18) {
    g.fillStyle = Math.random() < 0.25 ? '#ffd9a0' : '#181c26';
    g.fillRect(x, y, 11, 13);
  }
});
const roadTex = canvasTex(64, 256, (g, w, h) => {
  g.fillStyle = '#23262e'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#b8a94a';
  for (let y = 0; y < h; y += 64) g.fillRect(w / 2 - 1.5, y, 3, 30);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(2, 0, 2, h); g.fillRect(w - 4, 0, 2, h);
});
const asphaltTex = canvasTex(256, 256, (g2, w, h) => {
  g2.fillStyle = '#26292f'; g2.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    g2.fillStyle = 'rgba(' + (30 + Math.random() * 40 | 0) + ',' + (30 + Math.random() * 40 | 0) + ',' + (36 + Math.random() * 40 | 0) + ',0.5)';
    g2.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
  }
});
asphaltTex.repeat.set(60, 60);
const walkTex = canvasTex(256, 256, (g2, w, h) => {
  g2.fillStyle = '#41454f'; g2.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) {
    g2.fillStyle = 'rgba(255,255,255,' + Math.random() * 0.05 + ')';
    g2.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g2.strokeStyle = 'rgba(0,0,0,0.35)'; g2.lineWidth = 2;
  for (let x = 0; x <= w; x += 64) { g2.beginPath(); g2.moveTo(x, 0); g2.lineTo(x, h); g2.stroke(); }
  for (let y = 0; y <= h; y += 64) { g2.beginPath(); g2.moveTo(0, y); g2.lineTo(w, y); g2.stroke(); }
});
walkTex.repeat.set(12, 12);
const M = {
  asphalt: new T3.MeshLambertMaterial({ map: asphaltTex, color: 0x4a4e58 }),
  sidewalk: new T3.MeshLambertMaterial({ map: walkTex, color: 0x8b90a0 }),
  grass: new T3.MeshLambertMaterial({ color: 0x33502f }),
  dirt: new T3.MeshLambertMaterial({ color: 0x4a4034 }),
  concrete: new T3.MeshLambertMaterial({ color: 0x515560 }),
  runway: new T3.MeshLambertMaterial({ color: 0x2b2e35 }),
  wall: new T3.MeshLambertMaterial({ color: 0x565048 }),
  roof: new T3.MeshLambertMaterial({ color: 0x2c2f3a }),
  skin: new T3.MeshLambertMaterial({ color: 0xd9c6ad }),
  dark: new T3.MeshLambertMaterial({ color: 0x1d2027 }),
  glassDark: new T3.MeshLambertMaterial({ color: 0x141a26 }),
  hazard: new T3.MeshLambertMaterial({ color: 0xb8a94a })
};

// ---------- ground ----------
{
  const g = new T3.PlaneGeometry(C.WORLD.W, C.WORLD.D);
  const base = new T3.Mesh(g, M.dirt);
  base.receiveShadow = true;
  base.rotation.x = -Math.PI / 2;
  base.position.set(C.WORLD.W / 2, -0.25, C.WORLD.D / 2);
  scene.add(base);
  const cw = C.WORLD.CITY;
  const cityData = (typeof window !== 'undefined' && window.FC_CITYDATA) || null;
  if (C.ROADS && C.ROADS.on && cityData && cityData.roadways) {
    // real city: light pavement base + real OpenStreetMap streets as asphalt ribbons
    const cbase = new T3.Mesh(new T3.PlaneGeometry(cw.x1 - cw.x0 + 80, cw.z1 - cw.z0 + 80), M.sidewalk);
    cbase.receiveShadow = true; cbase.rotation.x = -Math.PI / 2;
    cbase.position.set((cw.x0 + cw.x1) / 2, -0.03, (cw.z0 + cw.z1) / 2);
    scene.add(cbase);
    const nodes = C.ROADS.nodes, HW = 6.5; // half road width
    const pos = [], dashPts = [];
    for (const way of cityData.roadways) {
      for (let k = 0; k + 1 < way.length; k++) {
        const a = nodes[way[k]], b = nodes[way[k + 1]];
        if (!a || !b) continue;
        let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz); if (L < 0.2) continue; dx /= L; dz /= L;
        const px = dz * HW, pz = -dx * HW;
        const aLx = a[0] - px, aLz = a[1] - pz, aRx = a[0] + px, aRz = a[1] + pz;
        const bLx = b[0] - px, bLz = b[1] - pz, bRx = b[0] + px, bRz = b[1] + pz;
        pos.push(aLx, 0, aLz, aRx, 0, aRz, bRx, 0, bRz, aLx, 0, aLz, bRx, 0, bRz, bLx, 0, bLz);
        for (let d = 3.5; d < L - 1; d += 8) dashPts.push([a[0] + dx * d, a[1] + dz * d, Math.atan2(dz, dx)]);
      }
    }
    const rgeo = new T3.BufferGeometry();
    rgeo.setAttribute('position', new T3.Float32BufferAttribute(pos, 3));
    rgeo.computeVertexNormals();
    const roadMesh = new T3.Mesh(rgeo, new T3.MeshLambertMaterial({ color: 0x34373e, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    roadMesh.position.y = 0.02; roadMesh.receiveShadow = true; scene.add(roadMesh);
    const dashMat = new T3.MeshBasicMaterial({ color: 0xc9b45a, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const dashGeo = new T3.PlaneGeometry(2.6, 0.32); dashGeo.rotateX(-Math.PI / 2);
    const dim = new T3.InstancedMesh(dashGeo, dashMat, dashPts.length);
    const m4 = new T3.Matrix4();
    dashPts.forEach(([x, z, ang], i) => { m4.makeRotationY(-ang); m4.setPosition(x, 0.05, z); dim.setMatrixAt(i, m4); });
    dim.instanceMatrix.needsUpdate = true; dim.frustumCulled = false; scene.add(dim);
  } else {
    // procedural fallback: dark asphalt slab + grid sidewalks + grid dashes
    const cbase = new T3.Mesh(new T3.PlaneGeometry(cw.x1 - cw.x0 + 60, cw.z1 - cw.z0 + 60), M.asphalt);
    cbase.receiveShadow = true; cbase.rotation.x = -Math.PI / 2;
    cbase.position.set((cw.x0 + cw.x1) / 2, -0.02, (cw.z0 + cw.z1) / 2);
    scene.add(cbase);
    const blockGeo = new T3.BoxGeometry(C.WORLD.P - C.WORLD.RW, 0.3, C.WORLD.P - C.WORLD.RW);
    for (let x = cw.x0 + C.WORLD.RW; x + (C.WORLD.P - C.WORLD.RW) <= cw.x1; x += C.WORLD.P)
      for (let z = cw.z0 + C.WORLD.RW; z + (C.WORLD.P - C.WORLD.RW) <= cw.z1; z += C.WORLD.P) {
        const isPark = C.parks.some(p => Math.abs(p.x0 - x) < 2 && Math.abs(p.z0 - z) < 2);
        const m = new T3.Mesh(blockGeo, isPark ? M.grass : M.sidewalk);
        m.receiveShadow = true;
        m.position.set(x + (C.WORLD.P - C.WORLD.RW) / 2, 0.15, z + (C.WORLD.P - C.WORLD.RW) / 2);
        scene.add(m);
      }
    const dashMat = new T3.MeshBasicMaterial({ color: 0x9c8c46, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const dashGeo = new T3.PlaneGeometry(0.22, 2.4), dashGeoH = new T3.PlaneGeometry(2.4, 0.22);
    const dashesV = [], dashesH = [];
    for (let x = cw.x0 + C.WORLD.RW / 2; x <= cw.x1; x += C.WORLD.P)
      for (let z = cw.z0 + 6; z < cw.z1; z += 13) dashesV.push([x, z]);
    for (let z = cw.z0 + C.WORLD.RW / 2; z <= cw.z1; z += C.WORLD.P)
      for (let x = cw.x0 + 6; x < cw.x1; x += 13) dashesH.push([x, z]);
    const mkDashes = (arr, geo) => {
      const im = new T3.InstancedMesh(geo, dashMat, arr.length);
      const m4 = new T3.Matrix4();
      arr.forEach(([x, z], i) => { m4.makeRotationX(-Math.PI / 2); m4.setPosition(x, 0.02, z); im.setMatrixAt(i, m4); });
      im.instanceMatrix.needsUpdate = true; scene.add(im);
    };
    mkDashes(dashesV, dashGeo); mkDashes(dashesH, dashGeoH);
  }
  // fort + airport pads
  const f = C.WORLD.FORT;
  const fpad = new T3.Mesh(new T3.PlaneGeometry(f.x1 - f.x0, f.z1 - f.z0), M.concrete);
  fpad.rotation.x = -Math.PI / 2; fpad.position.set((f.x0 + f.x1) / 2, -0.05, (f.z0 + f.z1) / 2);
  scene.add(fpad);
  const a = C.WORLD.AIRPORT;
  const apad = new T3.Mesh(new T3.PlaneGeometry(a.x1 - a.x0, a.z1 - a.z0), M.concrete);
  apad.rotation.x = -Math.PI / 2; apad.position.set((a.x0 + a.x1) / 2, -0.06, (a.z0 + a.z1) / 2);
  scene.add(apad);
  const rw = new T3.Mesh(new T3.PlaneGeometry(1500, 40), M.runway);
  rw.rotation.x = -Math.PI / 2; rw.position.set(2050, -0.03, 3550);
  scene.add(rw);
  for (let i = 0; i < 14; i++) {
    const stripe = new T3.Mesh(new T3.PlaneGeometry(30, 2), new T3.MeshBasicMaterial({ color: 0xcfd4dd, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    stripe.rotation.x = -Math.PI / 2; stripe.position.set(1400 + i * 100, 0.05, 3550);
    scene.add(stripe);
  }
  // Sierra heightfield
  const seg = 110;
  const tg = new T3.PlaneGeometry(2000, C.WORLD.D, seg, seg);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  const cols = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + 5100, z = pos.getZ(i) + C.WORLD.D / 2;
    const h = Math.max(0, C.groundY(clamp(x, 4105, 5995), clamp(z, 5, 3995)));
    pos.setY(i, h - 0.3);
    const c = new T3.Color();
    if (h > 150) c.setHex(0xb2b7bf);
    else if (h > 90) c.setHex(0x767a80);
    else if (h > 35) c.setHex(0x565e4e);
    else c.setHex(0x4a5244);
    cols.push(c.r, c.g, c.b);
  }
  tg.setAttribute('color', new T3.Float32BufferAttribute(cols, 3));
  tg.computeVertexNormals();
  const terr = new T3.Mesh(tg, new T3.MeshLambertMaterial({ vertexColors: true }));
  terr.receiveShadow = true;
  terr.position.set(5100, 0, C.WORLD.D / 2);
  scene.add(terr);
  // tunnels: trench + roof + portals
  for (const t of C.TUNNELS) {
    const len = t.x1 - t.x0;
    const roof = new T3.Mesh(new T3.BoxGeometry(len, 1.6, t.w + 6), M.asphalt);
    roof.position.set((t.x0 + t.x1) / 2, -0.8, t.z);
    scene.add(roof);
    const floor = new T3.Mesh(new T3.BoxGeometry(len + 2 * t.ramp, 1, t.w), M.asphalt);
    floor.position.set((t.x0 + t.x1) / 2, t.depth - 0.5, t.z);
    scene.add(floor);
    for (const s of [-1, 1]) {
      const wallM = new T3.Mesh(new T3.BoxGeometry(len + 2 * t.ramp, 10, 1), M.wall);
      wallM.position.set((t.x0 + t.x1) / 2, t.depth + 5, t.z + s * (t.w / 2 + 0.5));
      scene.add(wallM);
    }
    for (let x = t.x0 + 20; x < t.x1; x += 40) {
      const lamp = new T3.Mesh(new T3.BoxGeometry(1.5, 0.3, 0.6), new T3.MeshBasicMaterial({ color: 0xffd9a0 }));
      lamp.position.set(x, -1.8, t.z);
      scene.add(lamp);
    }
    for (const end of [t.x0 - t.ramp, t.x1 + t.ramp]) {
      const portal = new T3.Mesh(new T3.BoxGeometry(3, 3, t.w + 8), M.hazard);
      portal.position.set(end, 1.2, t.z);
      scene.add(portal);
    }
  }
}

// ---------- buildings (instanced, windowed) ----------
{
  const geo = new T3.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mats = {
    tower: new T3.MeshLambertMaterial({ map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.55 }),
    block: new T3.MeshLambertMaterial({ map: winTex2, emissive: 0xffffff, emissiveMap: winTex2, emissiveIntensity: 0.45 }),
    wall: M.wall, hangar: new T3.MeshLambertMaterial({ color: 0x44503e }),
    tower2: new T3.MeshLambertMaterial({ color: 0x5c5e63 }),
    terminal: new T3.MeshLambertMaterial({ map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.6 })
  };
  window.__bmats = mats;
  const groups = {};
  C.buildings.forEach((b, i) => {
    b.__idx = i;
    const k = b.kind === 'tower' && b.h < 30 ? 'block' : (mats[b.kind] ? b.kind : 'block');
    (groups[k] = groups[k] || []).push(b);
  });
  window.__blockIM = { ims: [] };
  const m4 = new T3.Matrix4();
  for (const k in groups) {
    const list = groups[k];
    const im = new T3.InstancedMesh(geo, mats[k] || mats.block, list.length);
    list.forEach((b, i) => {
      m4.makeScale(b.x1 - b.x0, b.h, b.z1 - b.z0);
      m4.setPosition((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    scene.add(im);
    // flat roofs
    const rim = new T3.InstancedMesh(new T3.BoxGeometry(1, 0.5, 1), M.roof, list.length);
    list.forEach((b, i) => {
      m4.makeScale(b.x1 - b.x0 + 0.6, 1, b.z1 - b.z0 + 0.6);
      m4.setPosition((b.x0 + b.x1) / 2, b.h + 0.2, (b.z0 + b.z1) / 2);
      rim.setMatrixAt(i, m4);
    });
    rim.instanceMatrix.needsUpdate = true;
    scene.add(rim);
    window.__blockIM.ims.push({ im, roof: rim, list });
  }
}

// ---------- props (instanced by type) ----------
{
  const defs = {
    pine: { geo: new T3.ConeGeometry(2.6, 9, 6), mat: new T3.MeshLambertMaterial({ color: 0x24402a }), y: p => p.y + 4.5 },
    tree: { geo: new T3.SphereGeometry(2.6, 6, 5), mat: new T3.MeshLambertMaterial({ color: 0x2e5236 }), y: p => p.y + 5 },
    rock: { geo: new T3.IcosahedronGeometry(1.6, 0), mat: new T3.MeshLambertMaterial({ color: 0x555251 }), y: p => p.y + 1 },
    boulder: { geo: new T3.IcosahedronGeometry(2.6, 0), mat: new T3.MeshLambertMaterial({ color: 0x5d6066 }), y: p => p.y + 1.6 },
    sandbag: { geo: new T3.BoxGeometry(4.4, 1.2, 1.6), mat: new T3.MeshLambertMaterial({ color: 0x6b5f42 }), y: p => p.y + 0.6 },
    crate: { geo: new T3.BoxGeometry(2.4, 2, 2.4), mat: new T3.MeshLambertMaterial({ color: 0x5c5346 }), y: p => p.y + 1 },
    tent: { geo: new T3.CylinderGeometry(0, 5, 3.6, 4), mat: new T3.MeshLambertMaterial({ color: 0x41472f }), y: p => p.y + 1.8 },
    wreck: { geo: new T3.BoxGeometry(4.6, 1.6, 2.2), mat: new T3.MeshLambertMaterial({ color: 0x3a3532 }), y: p => p.y + 0.8 }
  };
  const trunkGeo = new T3.CylinderGeometry(0.35, 0.45, 3, 5);
  const trunkMat = new T3.MeshLambertMaterial({ color: 0x4a3b28 });
  const byType = {};
  for (const p of C.props) (byType[p.type] = byType[p.type] || []).push(p);
  const m4 = new T3.Matrix4();
  for (const k in byType) {
    const d = defs[k]; if (!d) continue;
    const list = byType[k];
    const im = new T3.InstancedMesh(d.geo, d.mat, list.length);
    list.forEach((p, i) => {
      m4.makeRotationY(p.a || 0);
      m4.setPosition(p.x, d.y(p), p.z);
      im.setMatrixAt(i, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    scene.add(im);
    if (k === 'pine' || k === 'tree') {
      const tim = new T3.InstancedMesh(trunkGeo, trunkMat, list.length);
      list.forEach((p, i) => { m4.identity(); m4.setPosition(p.x, p.y + 1.2, p.z); tim.setMatrixAt(i, m4); });
      tim.instanceMatrix.needsUpdate = true;
      scene.add(tim);
    }
  }
  // street lamps
  const poleGeo = new T3.CylinderGeometry(0.12, 0.16, 6, 5);
  const poleMat = new T3.MeshLambertMaterial({ color: 0x2a2d34 });
  const bulbGeo = new T3.SphereGeometry(0.4, 6, 5);
  const bulbMat = new T3.MeshBasicMaterial({ color: 0xffd9a0 });
  const pim = new T3.InstancedMesh(poleGeo, poleMat, C.lamps.length);
  const bim = new T3.InstancedMesh(bulbGeo, bulbMat, C.lamps.length);
  C.lamps.forEach((l, i) => {
    m4.identity(); m4.setPosition(l.x, 3, l.z); pim.setMatrixAt(i, m4);
    m4.identity(); m4.setPosition(l.x, 6, l.z); bim.setMatrixAt(i, m4);
  });
  pim.instanceMatrix.needsUpdate = true; bim.instanceMatrix.needsUpdate = true;
  scene.add(pim); scene.add(bim);
}

// ---------- shop / house / mission markers ----------
const markerMeshes = [];
function addMarker(x, z, color, label) {
  const g = new T3.CylinderGeometry(3.4, 3.4, 0.5, 20, 1, true);
  const m = new T3.Mesh(g, new T3.MeshBasicMaterial({ color, transparent: true, opacity: 0.65, side: T3.DoubleSide }));
  m.position.set(x, C.groundY(x, z) + 0.6, z);
  scene.add(m);
  markerMeshes.push({ mesh: m, base: C.groundY(x, z) + 0.6 });
  return m;
}
for (const s of C.SHOPS) addMarker(s.x, s.z, 0x79d98c);
for (const h of C.HOUSES) addMarker(h.x, h.z, 0xd0b25a);
const missionMarkerRefs = {};
for (const id in C.MISSIONS) {
  const def = C.MISSIONS[id];
  const col = /^m\d+$/.test(id) ? 0xe8c84a : id.startsWith('cop') ? 0x4d8dff : id === 'contract' ? 0xff4a4a : id.startsWith('war') ? 0xff785a : id.startsWith('op') ? 0xffd23f : id === 'heist' ? 0xc05aE8 : 0x5ad0e8;
  missionMarkerRefs[id] = addMarker(def.marker.x, def.marker.z, col);
}
// stash crates (small glints)
const stashMeshes = C.stashes.map(st => {
  const m = new T3.Mesh(new T3.BoxGeometry(0.9, 0.9, 0.9), new T3.MeshBasicMaterial({ color: 0x79d98c }));
  m.position.set(st.x, C.groundY(st.x, st.z) + 0.5, st.z);
  scene.add(m);
  return m;
});

// ---------- faceless man model ----------
const OUTFIT_BY_ID = {};
for (const o of C.OUTFITS) OUTFIT_BY_ID[o.id] = o;
function buildMan(bodyColor, legColor, opts) {
  opts = opts || {};
  const g = new T3.Group();
  const mat = new T3.MeshLambertMaterial({ color: bodyColor });
  const legMat = new T3.MeshLambertMaterial({ color: legColor });
  const torso = new T3.Mesh(new T3.BoxGeometry(0.62, 0.72, 0.4), mat);
  torso.position.y = 1.06; g.add(torso);
  const legL = new T3.Mesh(new T3.BoxGeometry(0.24, 0.7, 0.28), legMat);
  legL.position.set(0, 0.35, -0.15); g.add(legL);
  const legR = legL.clone(); legR.position.z = 0.15; g.add(legR);
  const armL = new T3.Mesh(new T3.BoxGeometry(0.18, 0.66, 0.2), mat);
  armL.position.set(0, 1.05, -0.42); g.add(armL);
  const armR = armL.clone(); armR.position.z = 0.42; g.add(armR);
  // the head: a smooth blank sphere. no eyes. no mouth. nothing.
  const head = new T3.Mesh(new T3.SphereGeometry(0.26, 12, 10), M.skin);
  head.scale.set(0.92, 1.12, 0.92);
  head.position.y = 1.72; g.add(head);
  if (opts.vest) {
    const v = new T3.Mesh(new T3.BoxGeometry(0.68, 0.5, 0.46), new T3.MeshLambertMaterial({ color: opts.vest }));
    v.position.y = 1.1; g.add(v);
  }
  if (opts.hat) {
    const hcap = new T3.Mesh(new T3.SphereGeometry(0.27, 10, 6, 0, TAU, 0, 1.2), new T3.MeshLambertMaterial({ color: opts.hat }));
    hcap.position.y = 1.78; g.add(hcap);
  }
  const gun = new T3.Mesh(new T3.BoxGeometry(0.9, 0.09, 0.09), M.dark);
  gun.position.set(0.5, 1.15, 0.12); gun.visible = false; g.add(gun);
  const tube = new T3.Mesh(new T3.CylinderGeometry(0.09, 0.09, 1.3, 8), new T3.MeshLambertMaterial({ color: 0x6f7a62 }));
  tube.rotation.z = Math.PI / 2; tube.position.set(0.3, 1.5, 0.1); tube.visible = false; g.add(tube);
  g.userData = { legL, legR, armL, armR, gun, tube, head };
  return g;
}
function actionFor(u, name) {
  if (u.actions[name]) return u.actions[name];
  const clip = (u.clips || []).find(c2 => c2.name === name);
  if (!clip) return null;
  const a = u.mixer.clipAction(clip);
  u.actions[name] = a;
  return a;
}
// The AI-generated 'idle' pose is contorted; synthesize a clean stand by freezing the
// walk clip at its 'passing' frame (feet closest together, a natural neutral).
function neutralTime(mesh, u) {
  if (u.neutralT !== undefined) return u.neutralT;
  const walk = actionFor(u, 'walk');
  if (!walk) { u.neutralT = 0; return 0; }
  let lf = null, rf = null;
  mesh.traverse(o => { if (o.isBone && o.name === 'LeftFoot') lf = o; if (o.isBone && o.name === 'RightFoot') rf = o; });
  if (!lf || !rf) { u.neutralT = walk.getClip().duration * 0.5; return u.neutralT; }
  const dur = walk.getClip().duration;
  const wasIdle = {};
  for (const k in u.actions) { wasIdle[k] = u.actions[k].enabled; u.actions[k].enabled = false; }
  walk.enabled = true; walk.setEffectiveWeight(1); walk.play();
  let best = 0, bestD = 1e9;
  const a = new T3.Vector3(), b = new T3.Vector3();
  for (let s = 0; s <= 40; s++) {
    const tt = (s / 40) * dur;
    walk.time = tt; u.mixer.update(0); mesh.updateMatrixWorld(true);
    lf.getWorldPosition(a); rf.getWorldPosition(b);
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d < bestD) { bestD = d; best = tt; }
  }
  for (const k in u.actions) u.actions[k].enabled = wasIdle[k];
  u.neutralT = best;
  return best;
}
function animMan(g, phase, moving, aiming, rate) {
  const u = g.userData;
  if (u.mixer) {
    const speed = rate || 1;
    let target;
    if (moving) target = (speed > 1.9 ? (actionFor(u, 'run') || u.actions.walk) : (u.actions.walk || actionFor(u, 'idle')));
    else target = (u.actions.idle || actionFor(u, 'idle') || u.actions.walk);
    if (!target) return;
    if (u.current !== target) {
      if (u.current) u.current.fadeOut(0.2);
      target.reset().fadeIn(0.2).play();
      u.current = target;
    }
    target.paused = false; target.enabled = true;
    if (target === u.actions.run) target.timeScale = clamp(speed / 1.9, 0.85, 1.7);
    else if (target === u.actions.walk) target.timeScale = clamp(speed, 0.8, 1.6);
    else target.timeScale = 1; // idle plays at its natural rate
    return;
  }
  if (!u.legL) return;
  const s = moving ? Math.sin(phase) * 0.55 : 0;
  u.legL.rotation.z = s; u.legR.rotation.z = -s;
  if (!aiming) { u.armL.rotation.z = -s * 0.8; u.armR.rotation.z = s * 0.8; }
  else { u.armR.rotation.z = 1.2; u.armL.rotation.z = 1.0; }
}

// ---------- vehicle models ----------
const CAR_COLORS = [0x7d3b3b, 0x3b5a7d, 0x6e6a52, 0x42425a, 0x7a6a3f, 0x513f5e, 0x3f5e51, 0x8a8578];
const SUPER_COLORS = [0xd11f2a, 0xf0a000, 0x1560d0, 0x18a558, 0xe8e8ea, 0x1a1c22];
function buildCar(cls, colorSeed) {
  const g = new T3.Group();
  const dims = { sedan: [4.4, 1.15, 2], taxi: [4.4, 1.15, 2], van: [5, 1.9, 2.2], pickup: [4.8, 1.2, 2.1], muscle: [4.7, 1.1, 2.05], sports: [4.4, 0.92, 2], super: [4.7, 0.78, 2.06], cop: [4.5, 1.15, 2], apc: [5.4, 1.8, 2.6] }[cls] || [4.4, 1.15, 2];
  const col = cls === 'cop' ? 0xe8e8ea : cls === 'taxi' ? 0xd8b23a : cls === 'super' ? SUPER_COLORS[(colorSeed * SUPER_COLORS.length) | 0] : CAR_COLORS[(colorSeed * CAR_COLORS.length) | 0];
  const bodyMat = new T3.MeshLambertMaterial({ color: col });
  const body = new T3.Mesh(new T3.BoxGeometry(dims[0], dims[1], dims[2]), bodyMat);
  body.position.y = 0.75; g.add(body);
  const cabin = new T3.Mesh(new T3.BoxGeometry(dims[0] * 0.5, 0.72, dims[2] * 0.86), M.glassDark);
  cabin.position.set(-dims[0] * 0.06, 0.75 + dims[1] / 2 + 0.3, 0); g.add(cabin);
  const wg = new T3.CylinderGeometry(0.42, 0.42, 0.3, 10);
  wg.rotateX(Math.PI / 2);
  const wm = new T3.MeshLambertMaterial({ color: 0x14161c });
  for (const [wx, wz] of [[dims[0] * 0.33, dims[2] / 2], [dims[0] * 0.33, -dims[2] / 2], [-dims[0] * 0.33, dims[2] / 2], [-dims[0] * 0.33, -dims[2] / 2]]) {
    const w = new T3.Mesh(wg, wm); w.position.set(wx, 0.42, wz); g.add(w);
  }
  const hl = new T3.Mesh(new T3.BoxGeometry(0.1, 0.16, 0.4), new T3.MeshBasicMaterial({ color: 0xffe9a3 }));
  hl.position.set(dims[0] / 2, 0.8, dims[2] * 0.3); g.add(hl);
  const hl2 = hl.clone(); hl2.position.z = -dims[2] * 0.3; g.add(hl2);
  const tl = new T3.Mesh(new T3.BoxGeometry(0.1, 0.16, 0.4), new T3.MeshBasicMaterial({ color: 0xc03030 }));
  tl.position.set(-dims[0] / 2, 0.8, dims[2] * 0.3); g.add(tl);
  const tl2 = tl.clone(); tl2.position.z = -dims[2] * 0.3; g.add(tl2);
  if (cls === 'cop') {
    const bar = new T3.Mesh(new T3.BoxGeometry(0.5, 0.22, 1.4), new T3.MeshBasicMaterial({ color: 0xff4a4a }));
    bar.position.set(-0.2, 1.75, 0); g.add(bar);
    g.userData.lightbar = bar;
  }
  if (cls === 'taxi') {
    const sign = new T3.Mesh(new T3.BoxGeometry(0.7, 0.3, 0.5), new T3.MeshBasicMaterial({ color: 0xf2ede2 }));
    sign.position.set(-0.2, 1.75, 0); g.add(sign);
  }
  if (cls === 'sports') {
    const sp = new T3.Mesh(new T3.BoxGeometry(0.2, 0.3, 1.8), bodyMat);
    sp.position.set(-dims[0] / 2 + 0.2, 1.35, 0); g.add(sp);
  }
  if (cls === 'super') {
    // flatten the cabin and drop it forward for a mid-engine wedge look
    cabin.scale.set(1.15, 0.72, 0.94); cabin.position.set(dims[0] * 0.06, 0.75 + dims[1] / 2 + 0.2, 0);
    // wide rear wing on two struts
    const wingMat = new T3.MeshLambertMaterial({ color: 0x14161c });
    const wing = new T3.Mesh(new T3.BoxGeometry(0.6, 0.08, dims[2] + 0.3), wingMat);
    wing.position.set(-dims[0] / 2 + 0.15, 1.28, 0); g.add(wing);
    for (const s of [-1, 1]) {
      const strut = new T3.Mesh(new T3.BoxGeometry(0.16, 0.4, 0.1), wingMat);
      strut.position.set(-dims[0] / 2 + 0.15, 1.05, s * dims[2] * 0.35); g.add(strut);
    }
    // front splitter + rocker skirts
    const splitter = new T3.Mesh(new T3.BoxGeometry(0.4, 0.08, dims[2] + 0.16), wingMat);
    splitter.position.set(dims[0] / 2 - 0.1, 0.4, 0); g.add(splitter);
    for (const s of [-1, 1]) {
      const skirt = new T3.Mesh(new T3.BoxGeometry(dims[0] * 0.6, 0.16, 0.1), wingMat);
      skirt.position.set(0, 0.5, s * (dims[2] / 2 + 0.02)); g.add(skirt);
    }
    body.position.y = 0.68; // sit lower
  }
  g.userData.tl = [tl, tl2];
  return g;
}
function buildTank() {
  const g = new T3.Group();
  const hull = new T3.Mesh(new T3.BoxGeometry(7, 1.6, 3.6), new T3.MeshLambertMaterial({ color: 0x4a5140 }));
  hull.position.y = 1.1; g.add(hull);
  for (const s of [-1, 1]) {
    const tr = new T3.Mesh(new T3.BoxGeometry(7.4, 1.1, 0.9), new T3.MeshLambertMaterial({ color: 0x33382c }));
    tr.position.set(0, 0.55, s * 1.9); g.add(tr);
  }
  const tur = new T3.Group();
  const dome = new T3.Mesh(new T3.CylinderGeometry(1.5, 1.7, 1, 10), new T3.MeshLambertMaterial({ color: 0x3d4436 }));
  dome.position.y = 0.5; tur.add(dome);
  const barrel = new T3.Mesh(new T3.CylinderGeometry(0.14, 0.17, 5.6, 8), M.dark);
  barrel.rotation.z = Math.PI / 2; barrel.position.set(3.2, 0.55, 0); tur.add(barrel);
  tur.position.y = 2; g.add(tur);
  g.userData.turret = tur;
  return g;
}
function buildHeli(cls) {
  const g = new T3.Group();
  const mil = cls === 'hind';
  const body = new T3.Mesh(new T3.SphereGeometry(1.7, 10, 8), new T3.MeshLambertMaterial({ color: mil ? 0x3c4234 : 0x3c424c }));
  body.scale.set(1.7, 0.85, 0.9); body.position.y = 1.6; g.add(body);
  const canopy = new T3.Mesh(new T3.SphereGeometry(0.9, 8, 6), M.glassDark);
  canopy.scale.set(1, 0.8, 0.85); canopy.position.set(1.7, 1.8, 0); g.add(canopy);
  const tail = new T3.Mesh(new T3.BoxGeometry(4.6, 0.4, 0.4), new T3.MeshLambertMaterial({ color: mil ? 0x2c3126 : 0x232833 }));
  tail.position.set(-3.6, 1.9, 0); g.add(tail);
  const fin = new T3.Mesh(new T3.BoxGeometry(0.3, 1.2, 0.2), tail.material);
  fin.position.set(-5.6, 2.5, 0); g.add(fin);
  for (const s of [-1, 1]) {
    const skid = new T3.Mesh(new T3.BoxGeometry(3.4, 0.12, 0.16), M.dark);
    skid.position.set(0.3, 0.25, s * 1); g.add(skid);
  }
  const rotor = new T3.Group();
  for (let i = 0; i < 2; i++) {
    const bl = new T3.Mesh(new T3.BoxGeometry(9, 0.06, 0.34), M.dark);
    bl.rotation.y = i * Math.PI / 2; rotor.add(bl);
  }
  rotor.position.set(0.3, 2.75, 0); g.add(rotor);
  g.userData.rotor = rotor;
  return g;
}
function buildPlane(cls) {
  const g = new T3.Group();
  if (cls === 'jet') {
    // sleek dark fighter: pointed nose, swept wings, twin tail, canopy, wingtip missiles
    const skin = new T3.MeshLambertMaterial({ color: 0x3b4048 });
    const fus = new T3.Mesh(new T3.CylinderGeometry(0.55, 0.32, 8.4, 12), skin);
    fus.rotation.z = Math.PI / 2; fus.position.y = 1.9; g.add(fus);
    const nose = new T3.Mesh(new T3.ConeGeometry(0.32, 1.8, 12), skin);
    nose.rotation.z = -Math.PI / 2; nose.position.set(5, 1.9, 0); g.add(nose);
    const canopy = new T3.Mesh(new T3.SphereGeometry(0.5, 10, 8), M.glassDark);
    canopy.scale.set(1.7, 0.7, 0.8); canopy.position.set(1.6, 2.35, 0); g.add(canopy);
    // swept delta wings
    for (const s of [-1, 1]) {
      const wing = new T3.Mesh(new T3.BoxGeometry(3.4, 0.12, 2.4), skin);
      wing.position.set(-0.6, 1.85, s * 2.1); wing.rotation.y = s * -0.5; g.add(wing);
      const missile = new T3.Mesh(new T3.CylinderGeometry(0.12, 0.12, 1.6, 8), new T3.MeshLambertMaterial({ color: 0xb5b8bf }));
      missile.rotation.z = Math.PI / 2; missile.position.set(-0.4, 1.72, s * 3.4); g.add(missile);
    }
    // twin canted tail fins
    for (const s of [-1, 1]) {
      const fin = new T3.Mesh(new T3.BoxGeometry(1.3, 1.3, 0.1), skin);
      fin.position.set(-3.3, 2.5, s * 0.7); fin.rotation.x = s * 0.35; g.add(fin);
    }
    const exhaust = new T3.Mesh(new T3.CylinderGeometry(0.36, 0.36, 0.4, 12), new T3.MeshBasicMaterial({ color: 0xff7a3a }));
    exhaust.rotation.z = Math.PI / 2; exhaust.position.set(-4.3, 1.9, 0); g.add(exhaust);
    g.userData.rotor = new T3.Group(); // no prop; keep the field the syncer expects
    return g;
  }
  const fus = new T3.Mesh(new T3.CylinderGeometry(0.8, 0.6, 7, 10), new T3.MeshLambertMaterial({ color: 0x8a4444 }));
  fus.rotation.z = Math.PI / 2; fus.position.y = 1.6; g.add(fus);
  const wing = new T3.Mesh(new T3.BoxGeometry(1.6, 0.14, 11), new T3.MeshLambertMaterial({ color: 0xa0a4ad }));
  wing.position.set(0.4, 2.1, 0); g.add(wing);
  const tailw = new T3.Mesh(new T3.BoxGeometry(0.9, 0.12, 3.4), wing.material);
  tailw.position.set(-3.1, 1.9, 0); g.add(tailw);
  const fin = new T3.Mesh(new T3.BoxGeometry(0.9, 1.4, 0.14), wing.material);
  fin.position.set(-3.2, 2.5, 0); g.add(fin);
  const prop = new T3.Mesh(new T3.BoxGeometry(0.08, 2.6, 0.3), M.dark);
  prop.position.set(3.6, 1.6, 0); g.add(prop);
  for (const s of [-1, 1]) {
    const gear = new T3.Mesh(new T3.CylinderGeometry(0.3, 0.3, 0.2, 8), M.dark);
    gear.rotation.x = Math.PI / 2; gear.position.set(0.8, 0.3, s * 1.2); g.add(gear);
  }
  g.userData.rotor = prop;
  return g;
}


// ---------- AI-generated GLB assets (via Higgsfield / Meshy) ----------
const MODELS = {};
const MODEL_CFG = {
  sports: { length: 4.4, rotY: Math.PI }, sedan: { length: 4.5, rotY: Math.PI }, heli: { length: 9.5, rotY: Math.PI },
  tank: { length: 7.2, rotY: Math.PI }, man: { height: 1.8 }
};
function normalizeModel(root, cfg) {
  // transforms live on wrapper groups the animation mixer can never overwrite
  const wrap = new T3.Group();
  const inner = new T3.Group();
  inner.add(root); wrap.add(inner);
  let box = new T3.Box3().setFromObject(root);
  let size = box.getSize(new T3.Vector3());
  const s = cfg.height ? cfg.height / size.y : cfg.length / Math.max(size.x, size.z, 0.01);
  wrap.scale.setScalar(s);
  if (!cfg.height && size.z > size.x) inner.rotation.y = Math.PI / 2;
  if (cfg.rotY) inner.rotation.y += cfg.rotY;
  inner.updateMatrixWorld(true);
  box = new T3.Box3().setFromObject(inner);
  const c = box.getCenter(new T3.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  // skinned rigs: units of armature and mesh can disagree — calibrate from real bone span
  let sm = null;
  wrap.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; });
  if (sm && cfg.height) {
    wrap.updateMatrixWorld(true);
    const v = new T3.Vector3();
    let minY = 1e9, maxY = -1e9;
    for (const b of sm.skeleton.bones) { b.getWorldPosition(v); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
    const span = maxY - minY;
    if (span > 0.01) {
      wrap.scale.multiplyScalar((cfg.height * 0.94) / span);
      wrap.updateMatrixWorld(true);
      minY = 1e9;
      for (const b of sm.skeleton.bones) { b.getWorldPosition(v); minY = Math.min(minY, v.y); }
      inner.position.y += (0.1 - minY) / wrap.scale.x;
    }
  }
  wrap.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      const old2 = o.material;
      if (old2) {
        const map = old2.map || null;
        if (map) map.colorSpace = T3.SRGBColorSpace;
        const nm = new T3.MeshLambertMaterial({ map, color: 0xffffff });
        if (map) { nm.emissive = new T3.Color(0xffffff); nm.emissiveMap = map; nm.emissiveIntensity = cfg.height ? 0.14 : 0.3; }
        o.material = nm;
      }
    }
  });
  return wrap;
}
function registerModel(key, gltf, cfg) {
  // strip root-motion X/Z from clips (keep the vertical bob) so walkers stay put
  for (const clip of gltf.animations || []) {
    for (const tr of clip.tracks) {
      if (tr.name.endsWith('.position')) {
        const vals = tr.values;
        for (let i = 3; i < vals.length; i += 3) { vals[i] = vals[0]; vals[i + 2] = vals[2]; }
      }
    }
  }
  // only synthesize a name when a single unnamed clip is present (AI models); Xbot already names idle/walk/run
  if (key === 'man' && gltf.animations && gltf.animations.length === 1 && gltf.animations[0]) gltf.animations[0].name = 'walk';
  MODELS[key] = { tpl: normalizeModel(gltf.scene, cfg), clips: gltf.animations || [] };
  for (const [e2, m2] of meshMap) scene.remove(m2);
  meshMap.clear();
  rebuildPlayerMesh();
}
function cloneModel(key, tint) {
  const rec = MODELS[key];
  if (!rec) return null;
  const c = (key === 'man' && window.SkeletonUtils) ? window.SkeletonUtils.clone(rec.tpl) : rec.tpl.clone(true);
  if (tint && tint !== 0xffffff) c.traverse(o => {
    if (o.isMesh && o.material) { o.material = o.material.clone(); o.material.color = new T3.Color(tint); }
  });
  const holder = new T3.Group();  // unscaled: safe to attach extras (rotors, lightbars)
  holder.add(c);
  if (key === 'man' && rec.clips.length) {
    const mixer = new T3.AnimationMixer(c);
    holder.userData.mixer = mixer;
    holder.userData.clips = rec.clips;
    holder.userData.actions = {};
    const byName = n => rec.clips.find(k => k.name === n);
    const setup = (n) => { const cl = byName(n); if (cl) { const act = mixer.clipAction(cl); holder.userData.actions[n] = act; return act; } return null; };
    const idle = setup('idle') || (function () { const act = mixer.clipAction(rec.clips[0]); holder.userData.actions.idle = act; return act; })();
    setup('walk'); setup('run');
    idle.play();
    holder.userData.current = idle;
    // attach a held weapon to the right-hand bone so it's carried naturally
    let hand = null;
    c.traverse(o => { if (o.isBone && !hand && /RightHand$/.test(o.name)) hand = o; });
    if (hand) {
      const gun = new T3.Group();
      const body = new T3.Mesh(new T3.BoxGeometry(0.06, 0.11, 0.55), M.dark);
      body.position.set(0, 0, 0.2); gun.add(body);
      const mag = new T3.Mesh(new T3.BoxGeometry(0.05, 0.16, 0.08), M.dark);
      mag.position.set(0, -0.11, 0.12); gun.add(mag);
      const tube = new T3.Mesh(new T3.CylinderGeometry(0.05, 0.05, 0.85, 8), new T3.MeshLambertMaterial({ color: 0x6f7a62 }));
      tube.rotation.x = Math.PI / 2; tube.position.set(0, 0, 0.25);
      gun.scale.setScalar(100);            // hand bone space is in cm (Mixamo) — scale up
      gun.position.set(0, 0, 0);
      gun.visible = false; hand.add(gun);
      const tubeHolder = new T3.Group(); tubeHolder.scale.setScalar(100); tubeHolder.add(tube); tubeHolder.visible = false; hand.add(tubeHolder);
      holder.userData.gun = gun; holder.userData.tube = tubeHolder; holder.userData.handBone = hand;
    }
  }
  holder.userData.glb = true;
  return holder;
}
function loadAssets() {
  if (!window.GLTFLoader) return;
  const loader = new window.GLTFLoader();
  for (const k of Object.keys(MODEL_CFG)) {
    const done = gl => { try { registerModel(k, gl, MODEL_CFG[k]); } catch (err) { console.warn('model ' + k, err); } };
    if (window.FC_ASSETS && window.FC_ASSETS[k]) {
      const bin = Uint8Array.from(atob(window.FC_ASSETS[k]), ch => ch.charCodeAt(0)).buffer;
      loader.parse(bin, '', done, err => console.warn('parse ' + k, err));
    } else {
      fetch('assets/' + k + '.glb').then(r => r.ok ? r.arrayBuffer() : Promise.reject(0))
        .then(b => loader.parse(b, '', done, err => console.warn('parse ' + k, err)))
        .catch(() => {});
    }
  }
}
loadAssets();

// ---------- entity mesh syncing ----------
const meshMap = new Map();
const PED_STYLES = [
  { body: 0x4a4f38, legs: 0x2c2c31 }, { body: 0x5a4632, legs: 0x3d3d4d }, { body: 0x2e3138, legs: 0x26282e },
  { body: 0xb7bd3c, legs: 0x39465a, hat: 0xe0c832 }, { body: 0x31465e, legs: 0x31465e }, { body: 0x5e3a3a, legs: 0x2c2c31 }
];
function meshFor(e) {
  let m = meshMap.get(e);
  if (m) return m;
  const CAR_TINTS = [0xffffff, 0xd0a0a0, 0xa0b8d0, 0xb0d0a8, 0xc8c0a0, 0xb8a8c8];
  if (e.kind === 'ped') {
    m = cloneModel('man', [0xffffff, 0xd8c8c8, 0xc8d0e0, 0xd0d8c0, 0xe0d8c8][(Math.random() * 5) | 0]);
    if (!m) {
      const st = PED_STYLES[(Math.random() * PED_STYLES.length) | 0];
      m = buildMan(st.body, st.legs, { hat: st.hat });
    }
    m.scale.multiplyScalar(e.size || 1);
  } else if (e.kind === 'hostile' || e.kind === 'soldier') {
    m = cloneModel('man', e.kind === 'soldier' ? 0x9aa890 : 0x98a098);
    if (!m) { m = buildMan(e.kind === 'soldier' ? 0x44503e : 0x3a4036, 0x33382c, { vest: e.elite ? 0x454b58 : 0x2e332c }); m.userData.gun.visible = true; }
  } else if (e.kind === 'footcop') {
    m = cloneModel('man', 0x90a0c8);
    if (!m) { m = buildMan(0x2e3a5e, 0x1d2027, { hat: 0x1d2440 }); m.userData.gun.visible = true; }
  } else if (e.kind === 'car' && e.cls === 'super') {
    m = buildCar('super', e.colorSeed); // the wedge supercar is procedural, not a GLB
  } else if (e.kind === 'car') {
    const key = (e.cls === 'sports' || e.cls === 'muscle') ? 'sports' : 'sedan';
    const tint = e.type === 'cop' ? 0xffffff : e.cls === 'taxi' ? 0xe8c84a : CAR_TINTS[(e.colorSeed * CAR_TINTS.length) | 0];
    m = cloneModel(key, tint);
    if (m && e.type === 'cop') {
      const bar = new T3.Mesh(new T3.BoxGeometry(0.5, 0.22, 1.4), new T3.MeshBasicMaterial({ color: 0xff4a4a }));
      bar.position.set(-0.2, 1.9, 0); m.add(bar);
      m.userData.lightbar = bar;
    }
    if (!m) m = buildCar(e.cls, e.colorSeed);
  } else if (e.kind === 'tank') { m = cloneModel('tank') || buildTank(); if (!m.userData.turret) m.userData.turret = new T3.Group(); }
  else if (e.kind === 'heli') { m = cloneModel('heli'); if (m) { const r = buildHeli(e.cls).userData.rotor; r.position.set(0, MODELS.heli ? 3.1 : 2.75, 0); m.add(r); m.userData.rotor = r; } else m = buildHeli(e.cls); }
  else if (e.kind === 'plane') m = buildPlane(e.cls);
  else m = cloneModel('man') || buildMan(0x4a5138, 0x2c2c31);
  scene.add(m);
  meshMap.set(e, m);
  return m;
}
function syncEntity(e, yawOff) {
  const m = meshFor(e);
  m.position.set(e.x, e.y, e.z);
  m.rotation.y = -(e.yaw || 0) + (yawOff || 0) + (m.userData.glb && (e.kind === 'ped' || e.kind === 'soldier' || e.kind === 'hostile' || e.kind === 'footcop') ? Math.PI / 2 : 0);
  return m;
}
function gcMeshes(liveSet) {
  for (const [e, m] of meshMap) {
    if (!liveSet.has(e)) { scene.remove(m); meshMap.delete(e); }
  }
}

// player mesh
let playerMesh = buildMan(0x4a5138, 0x2c2c31);
scene.add(playerMesh);
// The GLB "man" model has no weapon geometry; give the player a held gun/tube so
// the equipped weapon is visible. Procedural buildMan already carries userData.gun.
function attachPlayerWeapon(mesh) {
  if (mesh.userData.gun) return;
  const gun = new T3.Mesh(new T3.BoxGeometry(0.1, 0.13, 0.98), M.dark); // long axis +Z (world-forward for the GLB player)
  gun.position.set(0.16, 1.12, 0.42);
  const tube = new T3.Mesh(new T3.CylinderGeometry(0.09, 0.09, 1.3, 8), new T3.MeshLambertMaterial({ color: 0x6f7a62 }));
  tube.rotation.x = Math.PI / 2; tube.position.set(0.12, 1.42, 0.4);
  gun.visible = false; tube.visible = false;
  mesh.add(gun); mesh.add(tube);
  mesh.userData.gun = gun; mesh.userData.tube = tube;
}
function rebuildPlayerMesh() {
  scene.remove(playerMesh);
  const o = OUTFIT_BY_ID[S.player.outfit] || C.OUTFITS[0];
  playerMesh = cloneModel('man') || buildMan(o.body, o.legs);
  if (playerMesh.userData.glb && S.player.outfit !== 'olive') {
    const t = new T3.Color(o.body).lerp(new T3.Color(0xffffff), 0.55);
    playerMesh.traverse(ob => { if (ob.isMesh && ob.material) { ob.material = ob.material.clone(); ob.material.color = t; } });
  }
  attachPlayerWeapon(playerMesh);
  scene.add(playerMesh);
}
let lastOutfit = S.player.outfit;

// ---------- effects ----------
const smokeTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, 'rgba(200,200,205,0.8)'); gr.addColorStop(1, 'rgba(200,200,205,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
let sparkTex = null;
{
  const applySpark = url => new T3.TextureLoader().load(url, t => { t.colorSpace = T3.SRGBColorSpace; sparkTex = t; }, undefined, () => {});
  if (window.FC_ASSETS && window.FC_ASSETS.tex_spark) applySpark('data:image/png;base64,' + window.FC_ASSETS.tex_spark);
  else applySpark('assets/tex/spark.png');
}
const fireTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,240,190,0.95)'); gr.addColorStop(0.5, 'rgba(255,140,50,0.8)'); gr.addColorStop(1, 'rgba(80,40,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
const sprites = [];
function spawnSprite(x, y, z, tex, size, life, rise, color) {
  const mat = new T3.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  if (color) mat.color.setHex(color);
  const sp = new T3.Sprite(mat);
  sp.position.set(x, y, z); sp.scale.setScalar(size);
  scene.add(sp);
  sprites.push({ sp, t: life, life, rise: rise || 0, grow: size });
}
const tracers = [];
const tracerMat = new T3.MeshBasicMaterial({ color: 0xffe8a0 });
const tracerMatE = new T3.MeshBasicMaterial({ color: 0xff9680 });
const bombMeshes = [];
const bombMat = new T3.MeshLambertMaterial({ color: 0x2a2c30 });
const bombGeo = new T3.SphereGeometry(0.4, 8, 6);
function updateEffects(dt) {
  for (const s of sprites) {
    s.t -= dt;
    s.sp.position.y += s.rise * dt;
    s.sp.scale.setScalar(s.grow * (1 + (1 - s.t / s.life)));
    s.sp.material.opacity = Math.max(0, s.t / s.life);
    if (s.t <= 0) scene.remove(s.sp);
  }
  sprites.splice(0, sprites.length, ...sprites.filter(s => s.t > 0));
  // tracers reflect live bullets
  while (tracers.length < S.bullets.length + S.shellsList.length) {
    const m = new T3.Mesh(new T3.BoxGeometry(1.6, 0.06, 0.06), tracerMat);
    scene.add(m); tracers.push(m);
  }
  let ti = 0;
  for (const b of S.bullets) {
    const m = tracers[ti++];
    m.visible = true;
    m.material = b.friendly ? tracerMat : tracerMatE;
    m.position.set(b.x, b.y, b.z);
    m.rotation.y = -Math.atan2(b.dz, b.dx);
  }
  for (const s of S.shellsList) {
    const m = tracers[ti++];
    m.visible = true; m.material = tracerMat;
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = -Math.atan2(s.dz, s.dx);
  }
  for (; ti < tracers.length; ti++) tracers[ti].visible = false;
  // rockets
  for (const r of S.rockets) spawnSprite(r.x, r.y, r.z, smokeTex, 1.2, 0.4, 2);
  // falling bombs
  while (bombMeshes.length < S.bombs.length) { const m = new T3.Mesh(bombGeo, bombMat); m.scale.set(0.8, 1.5, 0.8); scene.add(m); bombMeshes.push(m); }
  let bi = 0;
  for (const b of S.bombs) { const m = bombMeshes[bi++]; m.visible = true; m.position.set(b.x, b.y, b.z); }
  for (; bi < bombMeshes.length; bi++) bombMeshes[bi].visible = false;
}

// ---------- audio (SFX only — no music by design) ----------
let AC = null, engOsc = null, engGain = null, sirenOsc = null, sirenGain = null;
function audioInit() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    engOsc = AC.createOscillator(); engGain = AC.createGain();
    engOsc.type = 'sawtooth'; engGain.gain.value = 0;
    engOsc.connect(engGain); engGain.connect(AC.destination); engOsc.start();
    sirenOsc = AC.createOscillator(); sirenGain = AC.createGain();
    sirenGain.gain.value = 0; sirenOsc.connect(sirenGain); sirenGain.connect(AC.destination); sirenOsc.start();
  } catch (e) { AC = null; }
}
function sfx(kind) {
  if (!AC) return;
  try {
    const t0 = AC.currentTime, o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    const P2 = {
      punch: ['square', 95, 0.12, 0.09], cash: ['sine', 950, 0.09, 0.16], crash: ['sawtooth', 70, 0.14, 0.2],
      door: ['triangle', 240, 0.08, 0.1], shot: ['square', 1500, 0.1, 0.08], eshot: ['square', 1000, 0.05, 0.09],
      reload: ['triangle', 480, 0.07, 0.2], win: ['sine', 700, 0.09, 0.5], boom: ['sawtooth', 46, 0.22, 0.5],
      lock: ['sine', 1250, 0.07, 0.12], missile: ['sawtooth', 220, 0.08, 0.35]
    }[kind];
    if (!P2) return;
    o.type = P2[0]; o.frequency.setValueAtTime(P2[1], t0);
    if (kind === 'shot' || kind === 'eshot') o.frequency.exponentialRampToValueAtTime(110, t0 + P2[3]);
    if (kind === 'boom') o.frequency.exponentialRampToValueAtTime(24, t0 + P2[3]);
    if (kind === 'missile') o.frequency.exponentialRampToValueAtTime(900, t0 + P2[3]);
    if (kind === 'win') { o.frequency.setValueAtTime(880, t0 + 0.12); o.frequency.setValueAtTime(1180, t0 + 0.24); }
    g.gain.setValueAtTime(P2[2], t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + P2[3]);
    o.start(t0); o.stop(t0 + P2[3] + 0.01);
  } catch (e) { /* ignore */ }
}

// ---------- input ----------
const keys = {};
let pendingEnter = false;
let camYaw = 0, camPitch = -0.18, mouseDown = false, locked = false;
let baseYaw = 0, mouseNorm = { x: 0, y: 0 }, lastMouseT = 0;
// pointer lock is unavailable in sandboxed iframes (e.g. the published artifact);
// when we detect that, the cursor aims and left-click fires directly instead.
let canLock = true;
// touch / mobile
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
if (isTouch) canLock = false;
let lastTouchLookT = 0;
const touch = { on: false, mx: 0, my: 0, fire: false, run: false, up: false, down: false, reload: false };
window.addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  audioInit();
  if (e.code === 'KeyE') pendingEnter = true;
  if (e.code === 'KeyF') tryInteract();
  if (e.code === 'Escape') closeMenu();
  const num = parseInt(e.code.replace('Digit', ''), 10);
  if (num >= 1 && num <= 9) {
    const ids = Object.keys(S.player.weapons);
    if (ids[num - 1]) C.equip(ids[num - 1]);
  }
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('click', () => {
  if (!locked && !menuOpen && started && canLock) {
    let req;
    try { req = canvas.requestPointerLock && canvas.requestPointerLock(); } catch (e) { canLock = false; }
    if (req && req.catch) req.catch(() => { canLock = false; });
    // if the lock never engages (sandboxed iframe), fall back to click-to-fire
    setTimeout(() => { if (!locked) canLock = false; }, 350);
  }
});
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; if (locked) canLock = true; });
document.addEventListener('pointerlockerror', () => { locked = false; canLock = false; });
window.addEventListener('mousemove', e => {
  if (locked) {
    camYaw += e.movementX * 0.0024;
    camPitch = clamp(camPitch - e.movementY * 0.0022, -1.1, 0.7);
    lastMouseT = performance.now();
  } else {
    // sandboxed pages (no pointer lock): the cursor position steers the view
    mouseNorm.x = e.clientX / window.innerWidth - 0.5;
    mouseNorm.y = e.clientY / window.innerHeight - 0.5;
  }
});
window.addEventListener('mousedown', e => { if (e.button === 0) mouseDown = true; audioInit(); });
window.addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
window.addEventListener('wheel', e => { if (locked || !canLock) C.switchWeapon(e.deltaY > 0 ? 1 : -1); });

function buildInput() {
  if (window.__cutsceneOpen) return { camYaw, camPitch };
  const dz = 0.30;
  const tOn = touch.on;
  const tf = tOn && touch.my > dz, tb = tOn && touch.my < -dz;
  const tl = tOn && touch.mx < -dz, tr = tOn && touch.mx > dz;
  return {
    fwd: keys.KeyW || keys.ArrowUp || tf, back: keys.KeyS || keys.ArrowDown || tb,
    left: keys.KeyA || keys.ArrowLeft || tl, right: keys.KeyD || keys.ArrowRight || tr,
    run: keys.ShiftLeft || keys.ShiftRight || touch.run, nitro: keys.ShiftLeft || keys.ShiftRight || touch.run,
    fire: ((mouseDown && (locked || !canLock)) || touch.fire) && !menuOpen, enter: pendingEnter ? (pendingEnter = false, true) : false,
    handbrake: keys.Space || touch.up, up: keys.Space || touch.up, down: keys.ControlLeft || keys.KeyC || touch.down,
    reload: keys.KeyR || touch.reload, bomb: keys.KeyB || touch.reload, camYaw, camPitch
  };
}

// ---------- touch controls (mobile) ----------
if (isTouch) {
  document.body.classList.add('touch');
  const ctrls = document.querySelector('#intro .controls');
  if (ctrls) ctrls.innerHTML =
    '<b>Left stick</b> move / drive · <b>Drag the screen</b> to look &amp; aim · <b>RUN</b> sprint or nitro<br>' +
    '<b>FIRE</b> shoot / aircraft guns · <b>PUNCH</b> melee · <b>E</b> enter vehicle · <b>F</b> shops · <b>RLD</b> reload / drop bombs<br>' +
    '<b>▲ / ▼</b> handbrake &amp; heli up / down · <b>WPN</b> weapon wheel — you start with the whole arsenal<br>' +
    'hit the striped <b>STUNT RAMPS</b> at speed for cash · tunnels hide you from the law · Fort Kubra is a very bad idea';
}
function wireTouch() {
  const stick = document.getElementById('stick');
  const nub = document.getElementById('stickNub');
  if (!stick) return;
  const R = 46; // max nub travel px
  let stickId = null;
  const setNub = (dx, dy) => { nub.style.transform = 'translate(' + dx + 'px,' + dy + 'px)'; };
  const onStickMove = (cx, cy, rect) => {
    let dx = cx - (rect.left + rect.width / 2);
    let dy = cy - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    if (len > R) { dx = dx / len * R; dy = dy / len * R; }
    setNub(dx, dy);
    touch.mx = dx / R; touch.my = -dy / R; touch.on = true;
  };
  stick.addEventListener('touchstart', e => {
    e.preventDefault(); audioInit();
    const t = e.changedTouches[0]; stickId = t.identifier;
    onStickMove(t.clientX, t.clientY, stick.getBoundingClientRect());
  }, { passive: false });
  stick.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickId) onStickMove(t.clientX, t.clientY, stick.getBoundingClientRect());
  }, { passive: false });
  const endStick = e => {
    for (const t of e.changedTouches) if (t.identifier === stickId) { stickId = null; touch.on = false; touch.mx = touch.my = 0; setNub(0, 0); }
  };
  stick.addEventListener('touchend', endStick);
  stick.addEventListener('touchcancel', endStick);

  // right-side drag = look around (camera)
  let lookId = null, lx = 0, ly = 0;
  window.addEventListener('touchstart', e => {
    if (!started || menuOpen || window.__cutsceneOpen) return;
    for (const t of e.changedTouches) {
      if (lookId !== null) continue;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && (el.closest('#touch .tbtn') || el.closest('#stick') || el.closest('#menu') || el.closest('#wheel'))) continue;
      lookId = t.identifier; lx = t.clientX; ly = t.clientY;
    }
  }, { passive: true });
  window.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) if (t.identifier === lookId) {
      camYaw += (t.clientX - lx) * 0.005;
      camPitch = clamp(camPitch - (t.clientY - ly) * 0.005, -1.1, 0.7);
      lx = t.clientX; ly = t.clientY; lastTouchLookT = performance.now();
    }
  }, { passive: true });
  const endLook = e => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
  window.addEventListener('touchend', endLook);
  window.addEventListener('touchcancel', endLook);

  // action buttons
  const hold = (id, on, off) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', e => { e.preventDefault(); audioInit(); el.classList.add('on'); on(); }, { passive: false });
    const up = e => { if (e) e.preventDefault(); el.classList.remove('on'); if (off) off(); };
    el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
  };
  const tap = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', e => { e.preventDefault(); audioInit(); el.classList.add('on'); fn(); }, { passive: false });
    const up = e => { if (e) e.preventDefault(); el.classList.remove('on'); };
    el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
  };
  hold('btnFire', () => touch.fire = true, () => touch.fire = false);
  hold('btnAB', () => touch.fire = true, () => touch.fire = false);
  hold('btnUp', () => touch.up = true, () => touch.up = false);
  hold('btnDown', () => touch.down = true, () => touch.down = false);
  hold('btnReload', () => touch.reload = true, () => touch.reload = false);
  tap('btnEnter', () => pendingEnter = true);
  tap('btnInteract', () => tryInteract());
  tap('btnRun', () => touch.run = !touch.run);
  tap('btnWpn', () => { if (window.__toggleWheel) window.__toggleWheel(); });
  // keep RUN button visibly reflecting its toggle state
  const runBtn = document.getElementById('btnRun');
  if (runBtn) setInterval(() => runBtn.classList.toggle('on', touch.run), 200);
}
wireTouch();

// ---------- HUD (DOM) ----------
const $ = id => document.getElementById(id);
const hud = {
  hp: $('hp'), armor: $('armor'), nitro: $('nitrobar'), nitroWrap: $('nitrowrap'),
  money: $('money'), stars: $('stars'), weapon: $('weapon'), ammo: $('ammo'),
  speed: $('speed'), banner: $('banner'), toast: $('toast'), zone: $('zone'),
  fail: $('fail'), crosshair: $('crosshair'), prompt: $('prompt'), mm: $('minimap'),
  pops: $('pops'), lock: $('lockstate')
};
const mmCtx = hud.mm.getContext('2d');
// prerender world minimap
const mmWorld = document.createElement('canvas');
mmWorld.width = 300; mmWorld.height = 200;
{
  const g = mmWorld.getContext('2d');
  const sx = 300 / C.WORLD.W, sz = 200 / C.WORLD.D;
  g.fillStyle = '#3d3830'; g.fillRect(0, 0, 300, 200);
  g.fillStyle = '#31363f';
  const cw = C.WORLD.CITY;
  g.fillRect(cw.x0 * sx, cw.z0 * sz, (cw.x1 - cw.x0) * sx, (cw.z1 - cw.z0) * sz);
  const mmData = (typeof window !== 'undefined' && window.FC_CITYDATA) || null;
  if (C.ROADS && C.ROADS.on && mmData && mmData.roadways) {
    // real road network on the minimap
    g.strokeStyle = '#565c66'; g.lineWidth = 0.5;
    const nodes = C.ROADS.nodes;
    g.beginPath();
    for (const way of mmData.roadways) {
      for (let k = 0; k < way.length; k++) {
        const n = nodes[way[k]]; if (!n) continue;
        const X = n[0] * sx, Z = n[1] * sz;
        if (k === 0) g.moveTo(X, Z); else g.lineTo(X, Z);
      }
    }
    g.stroke();
  } else {
    g.fillStyle = '#20242c';
    for (let x = cw.x0; x <= cw.x1; x += C.WORLD.P) g.fillRect(x * sx, cw.z0 * sz, 1.2, (cw.z1 - cw.z0) * sz);
    for (let z = cw.z0; z <= cw.z1; z += C.WORLD.P) g.fillRect(cw.x0 * sx, z * sz, (cw.x1 - cw.x0) * sx, 1.2);
  }
  g.fillStyle = '#3a4136';
  g.fillRect(C.WORLD.SIERRA_X0 * sx, 0, 300 - C.WORLD.SIERRA_X0 * sx, 200);
  g.fillStyle = '#44503e';
  const f = C.WORLD.FORT; g.fillRect(f.x0 * sx, f.z0 * sz, (f.x1 - f.x0) * sx, (f.z1 - f.z0) * sz);
  g.fillStyle = '#515560';
  const a = C.WORLD.AIRPORT; g.fillRect(a.x0 * sx, a.z0 * sz, (a.x1 - a.x0) * sx, (a.z1 - a.z0) * sz);
  g.fillStyle = '#4a4034';
  g.fillRect(C.WORLD.OUTF_X0 * sx, 0, (C.WORLD.SIERRA_X0 - C.WORLD.OUTF_X0) * sx, 200);
}
let toastT = 0, zoneT = 0;
function drawHUD(dt) {
  const p = S.player;
  hud.hp.style.width = clamp(p.hp, 0, 100) + '%';
  hud.armor.style.width = clamp(p.armor, 0, 100) + '%';
  hud.money.textContent = '$' + Math.floor(p.money);
  let stars = '';
  for (let i = 0; i < 5; i++) stars += i < S.wanted ? '★' : '☆';
  hud.stars.textContent = stars;
  hud.stars.style.color = S.wanted ? '#ffd23f' : 'rgba(255,255,255,0.25)';
  const w = C.WEAPONS[p.cur];
  hud.weapon.textContent = w.name + (w.nation ? ' [' + w.nation + ']' : '');
  if (p.cur === 'fists') hud.ammo.textContent = '';
  else if (w.cls === 'rocket' || w.cls === 'aa') hud.ammo.textContent = '× ' + p.ammo[w.cls];
  else hud.ammo.textContent = p.weapons[p.cur].mag + ' / ' + p.ammo[w.cls];
  if (p.veh && p.veh.kind === 'car') {
    hud.speed.textContent = Math.round(Math.abs(p.veh.spd) * 2.237) + ' mph';
    hud.nitroWrap.style.display = 'block';
    hud.nitro.style.width = p.nitro + '%';
  } else if (p.veh) {
    hud.speed.textContent = 'ALT ' + Math.round(p.veh.y - C.groundY(p.veh.x, p.veh.z)) + 'm';
    hud.nitroWrap.style.display = 'none';
  } else { hud.speed.textContent = ''; hud.nitroWrap.style.display = 'none'; }
  hud.crosshair.style.display = (!p.veh || p.veh.kind === 'tank' || p.veh.kind === 'heli') && (locked || isTouch || !canLock) ? 'block' : 'none';
  hud.lock.textContent = p.lockTgt ? (p.lockT >= 1 ? 'LOCKED' : 'locking…') : '';
  hud.lock.style.color = p.lockT >= 1 ? '#ff5a5a' : '#ffd23f';
  // mission banner
  const m = S.mission;
  if (m) {
    let txt = m.def.name;
    if (m.id === 'courier' || m.id === 'taxi') txt += ' — ' + Math.ceil(m.t) + 's';
    if (m.id === 'race') txt += ' — CP ' + (m.i + 1) + '/6 — ' + Math.max(0, 95 - m.t).toFixed(0) + 's';
    if (m.id === 'airrace') txt += ' — RING ' + (m.i + 1) + '/5 — ' + Math.ceil(m.t) + 's';
    if (m.id.startsWith('op')) txt += ' — HOSTILES ' + m.kills + '/' + m.need;
    if (m.id.startsWith('war')) txt += ' — TARGETS LEFT: ' + m.left;
    if (m.id === 'heist') txt += m.phase === 0 ? ' — STEAL THE T-80' : ' — DELIVER TO STINGER RIDGE';
    if (m.def.banner) txt = m.def.name + ' — ' + m.def.banner(m);
    hud.banner.textContent = txt;
    hud.banner.style.display = 'block';
  } else hud.banner.style.display = 'none';
  // interact prompt
  const shop = C.shopAt(), house = C.houseAt();
  if (!p.veh && (shop || house) && !menuOpen) {
    hud.prompt.textContent = shop ? '[F] ' + shop.name : '[F] ' + houseLabel(house);
    hud.prompt.style.display = 'block';
  } else hud.prompt.style.display = 'none';
  toastT -= dt; if (toastT <= 0) hud.toast.style.display = 'none';
  if (passT > 0) { passT -= dt; if (passT <= 0) passEl.style.display = 'none'; }
  zoneT -= dt; if (zoneT <= 0) hud.zone.style.opacity = 0;
  // fail overlay
  if (S.state === 'busted' || S.state === 'wasted') {
    hud.fail.textContent = S.state.toUpperCase();
    hud.fail.style.color = S.state === 'busted' ? '#6f9fe8' : '#c0504d';
    hud.fail.style.display = 'block';
  } else hud.fail.style.display = 'none';
  // minimap
  const g = mmCtx, MW = hud.mm.width, MH = hud.mm.height;
  g.clearRect(0, 0, MW, MH);
  g.drawImage(mmWorld, 0, 0, MW, MH);
  const sx = MW / C.WORLD.W, sz = MH / C.WORLD.D;
  const dot = (x, z, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(x * sx, z * sz, r || 2, 0, TAU); g.fill(); };
  for (const id in C.MISSIONS) {
    if (S.done[id] && !C.MISSIONS[id].repeatable) continue;
    if (!C.unlocked(id)) continue;
    const d = C.MISSIONS[id].marker;
    dot(d.x, d.z, /^m\d+$/.test(id) ? '#e8c84a' : id.startsWith('cop') ? '#4d8dff' : id === 'contract' ? '#ff4a4a' : id.startsWith('war') ? '#ff785a' : id.startsWith('op') ? '#ffd23f' : id === 'heist' ? '#c05ae8' : '#5ad0e8', 2.4);
  }
  for (const s of C.SHOPS) dot(s.x, s.z, '#79d98c', 1.6);
  for (const h of C.HOUSES) dot(h.x, h.z, '#d0b25a', 1.6);
  for (const c of S.cops) dot(c.x, c.z, '#4d8dff', 2);
  for (const t of S.tanks) if (!t.dead && t.hostile) dot(t.x, t.z, '#a0e858', 2.4);
  for (const h of S.helis) if (!h.dead && h.hostile) dot(h.x, h.z, '#ff3a3a', 2.4);
  if (m && m.target) dot(m.target.x, m.target.z, '#ffffff', 2.6);
  if (m && m.id === 'race' && m.cps[m.i]) dot(m.cps[m.i].x, m.cps[m.i].z, '#ffffff', 2.6);
  if (m && m.id === 'airrace' && m.rings[m.i]) dot(m.rings[m.i].x, m.rings[m.i].z, '#ffffff', 2.6);
  dot(p.x, p.z, '#f2ede2', 2.6);
  g.strokeStyle = '#f2ede2'; g.lineWidth = 1;
  g.beginPath();
  g.moveTo(p.x * sx, p.z * sz);
  g.lineTo(p.x * sx + Math.cos(camYaw) * 7, p.z * sz + Math.sin(camYaw) * 7);
  g.stroke();
}
function houseLabel(h) {
  const owned = S.player.owned.houses.includes(h.id);
  return owned ? h.name + ' (yours — heal & save)' : h.name + ' — BUY $' + h.price;
}

// ---------- shop menus (DOM) ----------
const menuEl = $('menu');
let menuOpen = false;
function closeMenu() { menuOpen = false; menuEl.style.display = 'none'; }
function money() { return Math.floor(S.player.money); }
function tryInteract() {
  if (menuOpen) { closeMenu(); return; }
  const p = S.player;
  if (p.veh) return;
  const shop = C.shopAt();
  const house = C.houseAt();
  if (!shop && !house) return;
  if (document.pointerLockElement) document.exitPointerLock();
  menuOpen = true;
  menuEl.style.display = 'block';
  let html = '';
  const btn = (label, fn) => { const id = 'b' + (btnId++); btnFns[id] = fn; return '<button id="' + id + '">' + label + '</button>'; };
  if (house) {
    const owned = p.owned.houses.includes(house.id);
    html = '<h2>' + house.name + '</h2>';
    if (owned) {
      html += '<p>Your place. Rest here to heal. Rent $' + house.rent + ' pays out as you play.</p>';
      html += btn('Rest (heal to full)', () => { p.hp = 100; toast2('Rested.'); closeMenu(); });
    } else {
      html += '<p>Price: $' + house.price + ' · Rent income: $' + house.rent + '/min · Respawn point</p>';
      html += btn('Buy property — $' + house.price, () => { const e2 = C.buyHouse(house.id); toast2(e2 || 'Property yours.'); if (!e2) refreshMenu(); });
    }
  } else if (shop.type === 'guns') {
    html = '<h2>' + shop.name + '</h2><p>Cash: $' + money() + ' · Rep tier ' + C.repTier(p.rep) + '</p>';
    for (const id in C.WEAPONS) {
      const w = C.WEAPONS[id];
      if (!w.price || w.nation !== shop.nation) continue;
      const ownedW = !!p.weapons[id];
      const lockedW = C.repTier(p.rep) < w.tier;
      html += '<div class="row"><b>' + w.name + '</b> <i>' + w.cls + ' · pairs with ' + C.WEAPONS[w.pair].name + '</i>' +
        (ownedW ? '<span class="own">OWNED</span>' : lockedW ? '<span class="lock">REP TIER ' + w.tier + '</span>'
          : btn('$' + w.price, () => { const e2 = C.buyWeapon(id); toast2(e2 || w.name + ' acquired.'); if (!e2) refreshMenu(); })) + '</div>';
    }
    html += '<h3>Ammunition</h3>';
    for (const cls in C.AMMO_PRICE) {
      html += '<div class="row"><b>' + cls + '</b> <i>' + C.AMMO_PACK[cls] + ' rounds</i>' +
        btn('$' + C.AMMO_PRICE[cls], () => { const e2 = C.buyAmmo(cls); toast2(e2 || 'Ammo stocked.'); if (!e2) refreshMenu(); }) + '</div>';
    }
  } else if (shop.type === 'market') {
    html = '<h2>' + shop.name + '</h2><p>Cash: $' + money() + '</p>' +
      '<div class="row"><b>Snack</b> <i>+35 health</i>' + btn('$15', () => { toast2(C.buySnack() || 'Ate well.'); refreshMenu(); }) + '</div>' +
      '<div class="row"><b>Body Armor</b> <i>full vest</i>' + btn('$400', () => { toast2(C.buyArmor() || 'Armored up.'); refreshMenu(); }) + '</div>';
  } else if (shop.type === 'clothes') {
    html = '<h2>' + shop.name + '</h2><p>Cash: $' + money() + ' — every cut fits the same blank head.</p>';
    for (const o of C.OUTFITS) {
      const has = p.outfit === o.id;
      html += '<div class="row"><b>' + o.name + '</b>' +
        (has ? '<span class="own">WEARING</span>' : btn(o.price ? '$' + o.price : 'FREE', () => { const e2 = C.buyOutfit(o.id); toast2(e2 || 'Changed.'); if (!e2) { refreshMenu(); } })) + '</div>';
    }
  } else if (shop.type === 'cars') {
    html = '<h2>' + shop.name + '</h2><p>Cash: $' + money() + ' · Owned vehicles respawn with you.</p>';
    for (const cls of ['sedan', 'taxi', 'pickup', 'van', 'muscle', 'sports', 'super']) {
      const v = C.VEH[cls];
      const has = p.owned.vehicles.includes(cls);
      html += '<div class="row"><b>' + v.name + '</b> <i>' + Math.round(v.top * 2.237) + ' mph</i>' +
        (has ? '<span class="own">OWNED</span>' : btn('$' + v.price, () => { const e2 = C.buyVehicle(cls); toast2(e2 || v.name + ' delivered outside.'); if (!e2) refreshMenu(); })) + '</div>';
    }
  } else if (shop.type === 'aircraft') {
    html = '<h2>' + shop.name + '</h2><p>Cash: $' + money() + ' · Your own piece of the sky.</p>';
    for (const cls of ['heli', 'plane', 'jet']) {
      const v = C.VEH[cls];
      const has = p.owned.vehicles.includes(cls);
      const blurb = cls === 'heli' ? 'vertical take-off, door gun + bombs' : cls === 'jet' ? 'cannons + bombs, needs the runway' : 'needs the runway, fast';
      html += '<div class="row"><b>' + v.name + '</b> <i>' + blurb + '</i>' +
        (has ? '<span class="own">OWNED</span>' : btn('$' + v.price, () => { const e2 = C.buyVehicle(cls); toast2(e2 || v.name + ' is yours.'); if (!e2) refreshMenu(); })) + '</div>';
    }
  }
  html += '<p class="hint">[F] or [Esc] to close</p>';
  menuEl.innerHTML = html;
  wireButtons();
}
let btnId = 0, btnFns = {};
function wireButtons() {
  for (const id in btnFns) {
    const el = $(id);
    if (el) el.onclick = btnFns[id];
  }
  btnFns = {};
}
function refreshMenu() { closeMenu(); tryInteract(); }
function toast2(msg) { hud.toast.textContent = msg; hud.toast.style.display = 'block'; toastT = 3; }

// ---------- cutscenes & mission-passed presentation ----------
const csEl = document.createElement('div');
csEl.style.cssText = 'position:fixed;inset:0;display:none;z-index:25;pointer-events:auto;cursor:pointer;';
csEl.innerHTML =
  '<div style="position:absolute;top:0;left:0;right:0;height:13%;background:#000"></div>' +
  '<div style="position:absolute;bottom:0;left:0;right:0;height:24%;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 12%">' +
  '<div id="csSpeaker" style="font:800 15px monospace;color:#e8c84a;letter-spacing:2px;margin-bottom:8px"></div>' +
  '<div id="csLine" style="font:400 19px Georgia,serif;color:#e8e4d8;text-align:center;line-height:1.5;font-style:italic"></div>' +
  '<div style="font:700 11px monospace;color:#78808f;margin-top:10px">click to continue</div></div>';
document.body.appendChild(csEl);
let csLines = null, csIdx = 0;
window.__cutsceneOpen = false;
function showCutscene(lines) {
  csLines = lines; csIdx = 0;
  window.__cutsceneOpen = true;
  csEl.style.display = 'block';
  if (document.pointerLockElement) document.exitPointerLock();
  renderCsLine();
}
function renderCsLine() {
  const l = csLines[csIdx];
  document.getElementById('csSpeaker').textContent = l[0];
  document.getElementById('csLine').textContent = '\u201C' + l[1] + '\u201D';
}
function advanceCutscene() {
  csIdx++;
  if (csLines && csIdx < csLines.length) renderCsLine();
  else { window.__cutsceneOpen = false; csEl.style.display = 'none'; csLines = null; }
}
csEl.addEventListener('click', advanceCutscene);
window.addEventListener('keydown', e => {
  if (window.__cutsceneOpen && (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space')) { e.preventDefault(); advanceCutscene(); }
});
const passEl = document.createElement('div');
passEl.style.cssText = 'position:fixed;inset:0;display:none;z-index:24;pointer-events:none;background:radial-gradient(ellipse at center,rgba(0,0,0,0.15),rgba(0,0,0,0.7));';
passEl.innerHTML = '<div style="position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);text-align:center">' +
  '<div style="font:900 52px \'Arial Black\',Arial;font-style:italic;color:#e8c84a;text-shadow:3px 3px 0 #000;letter-spacing:3px">MISSION PASSED</div>' +
  '<div id="passName" style="font:800 22px monospace;color:#e8e4d8;margin-top:10px;text-shadow:2px 2px 0 #000"></div>' +
  '<div id="passReward" style="font:900 30px \'Arial Black\',Arial;color:#7fd98a;margin-top:8px;text-shadow:2px 2px 0 #000"></div></div>';
document.body.appendChild(passEl);
let passT = 0;
function showPassed(name, reward, rep) {
  document.getElementById('passName').textContent = name;
  document.getElementById('passReward').textContent = '+$' + reward + '   ·   +' + rep + ' REP';
  passEl.style.display = 'block';
  passT = 4.5;
}

// ---------- events from core ----------
function handleEvents() {
  for (const e of C.drainEvents()) {
    if (e.t === 'sfx') sfx(e.k);
    else if (e.t === 'toast') { hud.toast.textContent = e.msg; hud.toast.style.display = 'block'; toastT = e.secs || 3; }
    else if (e.t === 'zone') { hud.zone.textContent = e.name; hud.zone.style.opacity = 1; zoneT = 3; }
    else if (e.t === 'boom') {
      sfx('boom');
      spawnSprite(e.x, e.y + 2, e.z, fireTex, e.r * 1.3, 0.55, 6);
      for (let i = 0; i < 6; i++) spawnSprite(e.x + (Math.random() - 0.5) * e.r, e.y + 2 + Math.random() * 3, e.z + (Math.random() - 0.5) * e.r, smokeTex, e.r * 0.6, 1.4, 8);
      shake = Math.min(1.4, shake + e.r / 30);
    }
    else if (e.t === 'flash') spawnSprite(e.x, e.y, e.z, sparkTex || fireTex, sparkTex ? 2.2 : 1.4, 0.07, 0, sparkTex ? 0xffe6a0 : undefined);
    else if (e.t === 'smoke') spawnSprite(e.x, e.y, e.z, smokeTex, 2, 0.7, 4);
    else if (e.t === 'popup') { const d = document.createElement('div'); d.className = 'pop'; d.textContent = e.msg; hud.pops.appendChild(d); setTimeout(() => d.remove(), 1400); }
    else if (e.t === 'shake') shake = Math.min(1.4, shake + e.n / 12);
    else if (e.t === 'nitro') { if (S.player.veh) spawnSprite(S.player.veh.x - Math.cos(S.player.veh.yaw) * 2.6, S.player.veh.y + 0.7, S.player.veh.z - Math.sin(S.player.veh.yaw) * 2.6, fireTex, 0.9, 0.11, 0, 0x7fb0ff); }
    else if (e.t === 'respawn') camYaw = 0;
    else if (e.t === 'cutscene') showCutscene(e.lines);
    else if (e.t === 'passed') showPassed(e.name, e.reward, e.rep);
  }
}

// ---------- camera ----------
let shake = 0;
function updateCamera(dt) {
  const p = S.player;
  moon.position.set(p.x - 60, p.y + 140, p.z + 45);
  moon.target.position.set(p.x, p.y, p.z);
  if (window.__skyDome) window.__skyDome.position.set(p.x, 0, p.z);
  const inVeh = !!p.veh;
  const dist = inVeh ? (p.veh.kind === 'tank' ? 16 : p.veh.kind === 'heli' || p.veh.kind === 'plane' ? 22 : 11) : 6.5;
  const h = inVeh ? (p.veh.kind === 'heli' || p.veh.kind === 'plane' ? 7 : 4.2) : 2.4;
  const cp = Math.cos(camPitch), spv = Math.sin(camPitch);
  const tx = p.x - Math.cos(camYaw) * cp * dist;
  const tz = p.z - Math.sin(camYaw) * cp * dist;
  let ty = p.y + h - spv * dist;
  const gy = C.groundY(tx, tz);
  if (ty < gy + 1.2) ty = gy + 1.2;
  const target = new T3.Vector3(tx, ty, tz);
  if (camera.position.distanceTo(target) > 120) camera.position.copy(target); // teleport/respawn snap
  else camera.position.lerp(target, clamp(dt * 7, 0, 1));
  if (shake > 0.01) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake -= shake * 4 * dt;
  }
  const look = new T3.Vector3(p.x + Math.cos(camYaw) * 8 * cp, p.y + 1.6 + Math.sin(camPitch) * 8, p.z + Math.sin(camYaw) * 8 * cp);
  camera.lookAt(look);
  // speed-based FOV: the world rushes past faster the quicker you go
  const spd = (p.veh && (p.veh.kind === 'car' || p.veh.kind === 'plane')) ? Math.abs(p.veh.spd) : 0;
  const targetFov = 70 + clamp(spd - 20, 0, 45) * 0.5 + (p.veh && (keys.ShiftLeft || keys.ShiftRight) && spd > 20 ? 6 : 0);
  camera.fov += (targetFov - camera.fov) * clamp(4 * dt, 0, 1);
  camera.updateProjectionMatrix();
}

// tilt the car body into turns / dive on brakes / bob over the road
function applyBodyDynamics(mesh, c) {
  if (c.kind !== 'car') return;
  // preserve the model-orientation offset (rotY) child; roll/pitch go on the wrapper
  mesh.rotation.z = c.roll || 0;
  mesh.rotation.x = c.pitch || 0;
  mesh.position.y = c.y + (c.bob || 0);
}

// ---------- sync all meshes ----------
function syncScene(dt, t) {
  const p = S.player;
  const live = new Set();
  for (const c of S.cars) {
    live.add(c); const m = syncEntity(c);
    if (m.userData.tl) m.userData.tl.forEach(x => x.material.color.setHex(c.braking ? 0xff2222 : 0xc03030));
    applyBodyDynamics(m, c);
  }
  for (const c of S.cops) {
    live.add(c); const m = syncEntity(c);
    if (m.userData.lightbar) m.userData.lightbar.material.color.setHex(((t * 6 | 0) % 2) ? 0xff4a4a : 0x3f7dff);
  }
  for (const tk of S.tanks) { if (tk.dead) continue; live.add(tk); const m = syncEntity(tk); m.userData.turret.rotation.y = -(tk.ta - tk.yaw); }
  for (const h of S.helis) { if (h.dead) continue; live.add(h); const m = syncEntity(h); m.userData.rotor.rotation.y = h.rotor * 2; }
  for (const pd of S.peds) {
    if (pd.dead) continue; live.add(pd);
    const m = syncEntity(pd);
    if (pd.state === 'down') { m.rotation.x = Math.PI / 2; m.position.y = pd.y + 0.4; }
    else { m.rotation.x = 0; animMan(m, pd.phase, pd.state !== 'down', false, pd.state === 'flee' ? 2.4 : clamp(pd.spd / 1.3, 0.7, 2.4)); }
  }
  for (const e of S.enemies.concat(S.soldiers, S.footCops)) {
    if (e.dead) continue; live.add(e);
    const m = syncEntity(e);
    if (e.state === 'down') { m.rotation.x = Math.PI / 2; m.position.y = e.y + 0.4; }
    else { m.rotation.x = 0; animMan(m, e.phase, true, true, 1.9); }
  }
  gcMeshes(live);
  // player
  if (S.player.outfit !== lastOutfit) { lastOutfit = S.player.outfit; rebuildPlayerMesh(); }
  playerMesh.visible = !p.veh;
  if (!p.veh) {
    playerMesh.position.set(p.x, p.y, p.z);
    playerMesh.rotation.y = -p.yaw + (playerMesh.userData.glb ? Math.PI / 2 : 0);
    const armed2 = p.cur !== 'fists';
    if (playerMesh.userData.gun) {
      playerMesh.userData.gun.visible = armed2 && C.WEAPONS[p.cur].cls !== 'rocket' && C.WEAPONS[p.cur].cls !== 'aa';
      playerMesh.userData.tube.visible = armed2 && !playerMesh.userData.gun.visible;
    }
    animMan(playerMesh, p.phase, p.moving, armed2, (keys.ShiftLeft || keys.ShiftRight) ? 2.3 : 1.5);
  }
  // skeletal walk animations
  for (const [, mm2] of meshMap) if (mm2.userData.mixer) mm2.userData.mixer.update(dt);
  if (playerMesh.userData.mixer) playerMesh.userData.mixer.update(dt);
  // markers pulse
  for (const mk of markerMeshes) mk.mesh.position.y = mk.base + Math.sin(t * 3) * 0.3 + 0.3;
  for (const id in missionMarkerRefs) {
    const vis = (!S.done[id] || C.MISSIONS[id].repeatable) && C.unlocked(id) && (!S.mission || S.mission.id !== id);
    missionMarkerRefs[id].visible = vis;
  }
  C.stashes.forEach((st, i) => { stashMeshes[i].visible = !st.found; stashMeshes[i].rotation.y = t * 2; });
  if (window.__syncCoins) window.__syncCoins(t);
  // engine + siren audio
  if (AC) {
    if (p.veh && (p.veh.kind === 'car' || p.veh.kind === 'tank')) {
      engGain.gain.value = 0.014;
      engOsc.frequency.value = 50 + Math.abs(p.veh.spd) * 3.4;
    } else if (p.veh) {
      engGain.gain.value = 0.012;
      engOsc.frequency.value = 90 + Math.abs(p.veh.spd) * 1.2;
    } else engGain.gain.value = 0;
    const copNear = S.cops.some(c => U.d2(c.x, c.z, p.x, p.z) < 150);
    sirenGain.gain.value = S.wanted > 0 && copNear ? 0.02 : 0;
    if (S.wanted > 0 && copNear) sirenOsc.frequency.value = 620 + (Math.sin(t * 7) > 0 ? 260 : 0);
  }
}

// ---------- save / load ----------
const SAVE_KEY = 'facelesscity3d.save';
function save() { try { localStorage.setItem(SAVE_KEY, C.serialize()); } catch (e) {} }
function load() { try { const s = localStorage.getItem(SAVE_KEY); if (s && C.deserialize(s)) { C.reset(true); return true; } } catch (e) {} return false; }
setInterval(save, 5000);

// ---------- main loop ----------
let started = false, last = performance.now(), elapsed = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now; elapsed += dt;
  if (!started) return;
  {
    const p2 = S.player;
    if (isTouch) {
      // touch: drag steers directly; when idle in a vehicle, settle behind it
      if (p2.veh && performance.now() - lastTouchLookT > 1400) camYaw = U.angLerp(camYaw, p2.veh.yaw, clamp(2.0 * dt, 0, 1));
    } else if (!locked) {
      // follow what you're doing; mouse offset looks around
      if (p2.veh) baseYaw = U.angLerp(baseYaw, p2.veh.yaw, clamp(2.6 * dt, 0, 1));
      else if (p2.moving) baseYaw = U.angLerp(baseYaw, p2.yaw, clamp(1.6 * dt, 0, 1));
      camYaw = baseYaw + mouseNorm.x * 3.6;
      camPitch = clamp(-0.16 - mouseNorm.y * 1.5, -1.1, 0.7);
    } else if (p2.veh && performance.now() - lastMouseT > 1200) {
      camYaw = U.angLerp(camYaw, p2.veh.yaw, clamp(2.2 * dt, 0, 1)); // chase cam settles behind the car
    }
  }
  C.step(dt, buildInput());
  handleEvents();
  syncScene(dt, elapsed);
  updateEffects(dt);
  updateCamera(dt);
  drawHUD(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

$('playbtn').addEventListener('click', () => {
  audioInit();
  const had = load();
  if (had) toast2('Save loaded — welcome back to Blank City.');
  $('intro').style.display = 'none';
  started = true;
  canvas.requestPointerLock && canvas.requestPointerLock();
});
$('newbtn').addEventListener('click', () => {
  audioInit();
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  C.reset(false);
  $('intro').style.display = 'none';
  started = true;
  canvas.requestPointerLock && canvas.requestPointerLock();
});

// intro portrait — the faceless one, in 3D spirit
(function portrait() {
  const c = document.getElementById('face'); if (!c) return;
  const g = c.getContext('2d');
  const W2 = c.width, H2 = c.height, cx = W2 / 2;
  g.fillStyle = '#242b3d'; g.fillRect(0, 0, W2, H2);
  g.fillStyle = '#4a5138';
  g.beginPath();
  g.moveTo(cx - 58, H2); g.quadraticCurveTo(cx - 60, H2 - 62, cx - 30, H2 - 74);
  g.quadraticCurveTo(cx, H2 - 84, cx + 30, H2 - 74);
  g.quadraticCurveTo(cx + 60, H2 - 62, cx + 58, H2); g.closePath(); g.fill();
  g.fillStyle = '#c2ad92'; g.fillRect(cx - 10, H2 - 92, 20, 22);
  const grad = g.createRadialGradient(cx - 12, H2 - 130, 8, cx, H2 - 122, 46);
  grad.addColorStop(0, '#e6d5bc'); grad.addColorStop(0.7, '#d9c6ad'); grad.addColorStop(1, '#b39d80');
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(cx, H2 - 122, 32, 40, 0, 0, TAU); g.fill();
})();

window.__FC3D = { scene, camera, renderer, get started() { return started; }, get playerMesh() { return playerMesh; } };

// ================= FLAVOR PASS: CC0 Kenney kit, stunts, neon, weapon wheel =================
(function flavor() {
  // ---------- merged-geometry baking ----------
  function bakeMerged(parts) {
    const byMat = new Map();
    const v = new T3.Vector3();
    for (const p of parts) {
      const key = p.material.uuid;
      if (!byMat.has(key)) byMat.set(key, { material: p.material, pos: [], norm: [], uv: [], col: [], idx: [], base: 0 });
      const acc = byMat.get(key);
      const g = p.geo;
      const pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, ca = g.attributes.color;
      const nm = new T3.Matrix3().getNormalMatrix(p.matrix);
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(p.matrix);
        acc.pos.push(v.x, v.y, v.z);
        if (na) { v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); acc.norm.push(v.x, v.y, v.z); }
        if (ua) acc.uv.push(ua.getX(i), ua.getY(i));
        if (ca) acc.col.push(ca.getX(i), ca.getY(i), ca.getZ(i));
        else if (acc.col.length) acc.col.push(1, 1, 1);
      }
      const idx = g.index;
      if (idx) for (let i = 0; i < idx.count; i++) acc.idx.push(idx.getX(i) + acc.base);
      else for (let i = 0; i < pa.count; i++) acc.idx.push(i + acc.base);
      acc.base += pa.count;
    }
    const meshes = [];
    for (const acc of byMat.values()) {
      const g = new T3.BufferGeometry();
      g.setAttribute('position', new T3.Float32BufferAttribute(acc.pos, 3));
      if (acc.norm.length) g.setAttribute('normal', new T3.Float32BufferAttribute(acc.norm, 3));
      if (acc.uv.length) g.setAttribute('uv', new T3.Float32BufferAttribute(acc.uv, 2));
      if (acc.col.length) { g.setAttribute('color', new T3.Float32BufferAttribute(acc.col, 3)); acc.material.vertexColors = true; }
      g.setIndex(acc.idx);
      if (!acc.norm.length) g.computeVertexNormals();
      const mesh = new T3.Mesh(g, acc.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      meshes.push(mesh);
    }
    return meshes;
  }
  function partsOf(sceneRoot, matrix) {
    const parts = [];
    sceneRoot.updateMatrixWorld(true);
    sceneRoot.traverse(o => {
      if (o.isMesh && o.geometry && o.geometry.attributes.position) {
        const m = new T3.Matrix4().multiplyMatrices(matrix, o.matrixWorld);
        let mat = o.material;
        const conv = new T3.MeshLambertMaterial({
          map: mat.map || null, vertexColors: !!mat.vertexColors,
          color: mat.color ? mat.color.clone() : new T3.Color(0xffffff)
        });
        if (conv.map) conv.map.colorSpace = T3.SRGBColorSpace;
        conv.uuid = 'conv_' + (mat.map ? mat.map.uuid : mat.uuid); // share merged buckets
        parts.push({ geo: o.geometry, matrix: m, material: conv });
      }
    });
    return parts;
  }

  // ---------- Kenney CC0 city kit ----------
  const KEN_FILES = ['building-small-a', 'building-small-b', 'building-small-c', 'building-small-d',
    'building-garage', 'grass-trees', 'grass-trees-tall', 'pavement-fountain'];
  const KEN = {};
  function kenReady() {
    // pick which low-rise city boxes become real storefront buildings
    const replaced = new Set();
    const parts = [];
    const kinds = ['building-small-a', 'building-small-b', 'building-small-c', 'building-small-d'];
    const nat = {};
    for (const k of KEN_FILES) {
      if (!KEN[k]) continue;
      const b = new T3.Box3().setFromObject(KEN[k]);
      nat[k] = { size: b.getSize(new T3.Vector3()), min: b.min.clone() };
    }
    C.buildings.forEach((b, i) => {
      if (b.kind !== 'block') return;
      const w = b.x1 - b.x0, d = b.z1 - b.z0, h = b.h;
      if (h > 24 || w > 60 || d > 60) return;
      const k = kinds[(i * 7 + 3) % kinds.length];
      if (!KEN[k] || !nat[k]) return;
      replaced.add(i);
      const n = nat[k];
      const sx = w / n.size.x, sy = h / n.size.y, sz = d / n.size.z;
      const rot = ((i * 13) % 4) * Math.PI / 2;
      const m = new T3.Matrix4()
        .makeTranslation((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2)
        .multiply(new T3.Matrix4().makeRotationY(rot))
        .multiply(new T3.Matrix4().makeScale(rot % Math.PI ? sz : sx, sy, rot % Math.PI ? sx : sz))
        .multiply(new T3.Matrix4().makeTranslation(0, -n.min.y, 0));
      parts.push(...partsOf(KEN[k], m));
    });
    // parks: fountains + tree clusters
    C.parks.forEach((p, i) => {
      const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
      if (KEN['pavement-fountain'] && i % 2 === 0) {
        const n = nat['pavement-fountain'];
        const s = 16 / Math.max(n.size.x, n.size.z);
        const m = new T3.Matrix4().makeTranslation(cx, 0.05, cz)
          .multiply(new T3.Matrix4().makeScale(s, s, s))
          .multiply(new T3.Matrix4().makeTranslation(0, -n.min.y, 0));
        parts.push(...partsOf(KEN['pavement-fountain'], m));
      }
      const tk = i % 2 ? 'grass-trees' : 'grass-trees-tall';
      if (KEN[tk]) {
        const n = nat[tk];
        const s = 12 / Math.max(n.size.x, n.size.z);
        for (const [ox, oz] of [[-24, -24], [24, 20], [-20, 26]]) {
          const m = new T3.Matrix4().makeTranslation(cx + ox, 0.05, cz + oz)
            .multiply(new T3.Matrix4().makeScale(s, s, s))
            .multiply(new T3.Matrix4().makeTranslation(0, -n.min.y, 0));
          parts.push(...partsOf(KEN[tk], m));
        }
      }
    });
    for (const mesh of bakeMerged(parts)) scene.add(mesh);
    // rebuild the low-rise instanced boxes without the replaced ones
    if (replaced.size && window.__blockIM) {
      // hide replaced instances by collapsing them
      const m4b = new T3.Matrix4();
      window.__blockIM.ims.forEach(entry => {
        entry.list.forEach((b, j) => {
          if (replaced.has(b.__idx)) {
            m4b.makeScale(0.0001, 0.0001, 0.0001);
            m4b.setPosition(0, -50, 0);
            entry.im.setMatrixAt(j, m4b);
            if (entry.roof) entry.roof.setMatrixAt(j, m4b);
          }
        });
        entry.im.instanceMatrix.needsUpdate = true;
        if (entry.roof) entry.roof.instanceMatrix.needsUpdate = true;
      });
    }
  }
  if (window.GLTFLoader) {
    const kenMgr = new T3.LoadingManager();
    kenMgr.setURLModifier(url => {
      if (url.includes('colormap')) {
        if (window.FC_ASSETS && window.FC_ASSETS.ken_colormap) return 'data:image/png;base64,' + window.FC_ASSETS.ken_colormap;
        return 'assets/kenney/Textures/colormap.png';
      }
      return url;
    });
    const loader = new window.GLTFLoader(kenMgr);
    let left = KEN_FILES.length;
    const done = () => { if (--left === 0) { try { kenReady(); } catch (e) { console.warn('kenney', e); } } };
    for (const k of KEN_FILES) {
      const fin = gl => { KEN[k] = gl.scene; done(); };
      if (window.FC_ASSETS && window.FC_ASSETS['ken_' + k]) {
        const bin = Uint8Array.from(atob(window.FC_ASSETS['ken_' + k]), ch => ch.charCodeAt(0)).buffer;
        loader.parse(bin, '', fin, () => done());
      } else {
        fetch('assets/kenney/' + k + '.glb').then(r => r.ok ? r.arrayBuffer() : Promise.reject(0))
          .then(b => loader.parse(b, '', fin, () => done()))
          .catch(() => done());
      }
    }
  }

  // ---------- stunt ramps ----------
  const stripeTex = canvasTex(64, 64, (g2) => {
    g2.fillStyle = '#c9a52c'; g2.fillRect(0, 0, 64, 64);
    g2.fillStyle = '#1c1c20';
    for (let i = -2; i < 6; i++) { g2.save(); g2.translate(i * 16, 0); g2.rotate(Math.PI / 4); g2.fillRect(0, -40, 8, 120); g2.restore(); }
  });
  for (const r of C.RAMPS) {
    const w2 = r.w / 2, gy = C.groundY(r.x, r.z);
    const geo = new T3.BufferGeometry();
    const verts = [
      0, 0, -w2, 0, 0, w2, r.len, 0, w2, r.len, 0, -w2,
      r.len, r.h, -w2, r.len, r.h, w2
    ];
    geo.setAttribute('position', new T3.Float32BufferAttribute(verts, 3));
    geo.setIndex([0, 1, 5, 0, 5, 4, /* slope */ 3, 4, 5, 3, 5, 2, /* back */ 0, 4, 3, /* side */ 1, 2, 5]);
    geo.computeVertexNormals();
    const mesh = new T3.Mesh(geo, new T3.MeshLambertMaterial({ map: stripeTex, side: T3.DoubleSide }));
    mesh.position.set(r.x, gy + 0.02, r.z);
    mesh.rotation.y = -r.yaw;
    mesh.castShadow = true;
    scene.add(mesh);
  }

  // ---------- neon signs & billboards ----------
  const signMats = [];
  function signTex(text, color, sub) {
    return canvasTex(512, 160, (g2, w, h) => {
      g2.fillStyle = '#101018'; g2.fillRect(0, 0, w, h);
      g2.strokeStyle = color; g2.lineWidth = 5; g2.strokeRect(8, 8, w - 16, h - 16);
      g2.font = '900 ' + (sub ? 44 : 58) + 'px Arial Black, Arial';
      g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.shadowColor = color; g2.shadowBlur = 26;
      g2.fillStyle = color;
      g2.fillText(text, w / 2, sub ? h / 2 - 24 : h / 2);
      if (sub) { g2.font = '700 26px Arial'; g2.shadowBlur = 12; g2.fillText(sub, w / 2, h / 2 + 38); }
    });
  }
  function addSign(x, y, z, yaw, tex, sw, sh, flicker) {
    const mat = new T3.MeshBasicMaterial({ map: tex, transparent: true, side: T3.DoubleSide });
    const m = new T3.Mesh(new T3.PlaneGeometry(sw || 10, sh || 3.2), mat);
    m.position.set(x, y, z); m.rotation.y = yaw;
    scene.add(m);
    if (flicker) signMats.push(mat);
    return m;
  }
  const SIGN_DEFS = {
    armory: ['LIBERTY ARMS', '#8fd0ff', 'US MILITARY SURPLUS'],
    blackmarket: ['SIERRA SUPPLY', '#ff785a', 'НЕ ЗАДАВАЙ ВОПРОСОВ'],
    market: ['MONO MART', '#79d98c', 'EVERYTHING TASTES THE SAME'],
    clothes: ['THREADS & CO', '#e8c84a', 'SAME HEAD. BETTER CUT.'],
    dealer: ['PRESTIGE MOTORS', '#c05ae8', 'NITRO INCLUDED'],
    airdealer: ['SKYLINE AVIATION', '#5ad0e8', 'OWN A PIECE OF THE SKY']
  };
  for (const s of C.SHOPS) {
    const d = SIGN_DEFS[s.id];
    if (!d) continue;
    addSign(s.x, 7.5, s.z, ((s.x * 7 + s.z) | 0) % 2 ? 0 : Math.PI / 2, signTex(d[0], d[1], d[2]), 12, 3.8, s.id === 'blackmarket');
  }
  const ADS = [
    ['MANNEQUIN MOTEL', '#e8c84a', 'SLEEP LIKE YOU ARE NOT THERE'],
    ['SMILE! (OPTIONAL)', '#79d98c', 'BLANK CITY TOURISM BOARD'],
    ['STUNT RAMPS AHEAD', '#ff785a', 'INSURANCE NOT INCLUDED'],
    ['THE JUDGE ISN\'T LOOKING', '#8fd0ff', 'DRIVE ACCORDINGLY'],
    ['VISIT SIERRA NEGRA', '#c05ae8', 'BRING ROCKETS'],
    ['FORT KUBRA', '#ff5a5a', 'ABSOLUTELY DO NOT VISIT']
  ];
  const BB_SPOTS = [[500, 1010], [1230, 2980], [2400, 1010], [2880, 2200], [3100, 1600], [1700, 3300]];
  BB_SPOTS.forEach(([x, z], i) => {
    const gy = C.groundY(x, z);
    const pole = new T3.Mesh(new T3.CylinderGeometry(0.35, 0.4, 11, 8), M.dark);
    pole.position.set(x, gy + 5.5, z);
    scene.add(pole);
    const ad = ADS[i % ADS.length];
    addSign(x, gy + 12.5, z, (i * 1.1) % Math.PI, signTex(ad[0], ad[1], ad[2]), 16, 5, i === 2);
  });
  // flicker loop hooks into the sprite updater
  setInterval(() => {
    for (const mt of signMats) mt.opacity = Math.random() < 0.12 ? 0.25 : 1;
  }, 120);

  // ---------- weapon wheel (Tab) ----------
  const wheel = document.createElement('div');
  wheel.id = 'wheel';
  wheel.style.cssText = 'position:fixed;inset:0;display:none;background:rgba(8,10,16,0.72);z-index:20;pointer-events:auto;';
  wheel.innerHTML = '<div id="wheelgrid" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;grid-template-columns:repeat(4,150px);gap:10px;"></div>' +
    '<div style="position:absolute;left:50%;bottom:12%;transform:translateX(-50%);color:#9aa3b5;font:700 13px monospace">' +
    (isTouch ? 'tap a weapon to equip · tap outside to close' : '[TAB] close · click to equip') + '</div>';
  document.body.appendChild(wheel);
  let wheelOpen = false;
  function renderWheel() {
    const grid = document.getElementById('wheelgrid');
    const p = S.player;
    grid.innerHTML = '';
    for (const id in p.weapons) {
      const w = C.WEAPONS[id];
      const cell = document.createElement('div');
      const cur = p.cur === id;
      cell.style.cssText = 'background:' + (cur ? 'rgba(230,213,188,0.25)' : 'rgba(20,24,34,0.9)') +
        ';border:2px solid ' + (cur ? '#e6d5bc' : 'rgba(255,255,255,0.2)') + ';border-radius:10px;padding:12px;cursor:pointer;color:#e8e4d8;font:700 13px monospace;text-align:center';
      const ammo = id === 'fists' ? '' : (w.cls === 'rocket' || w.cls === 'aa') ? '× ' + p.ammo[w.cls] : p.weapons[id].mag + ' / ' + p.ammo[w.cls];
      cell.innerHTML = '<div style="font-size:15px">' + w.name + '</div>' +
        '<div style="color:#9aa3b5;margin-top:4px">' + (w.nation ? '[' + w.nation + '] ' : '') + (w.cls || '') + '</div>' +
        '<div style="color:#8fd0ff;margin-top:4px">' + ammo + '</div>';
      cell.onclick = () => { C.equip(id); toggleWheel(false); };
      grid.appendChild(cell);
    }
  }
  function toggleWheel(open) {
    wheelOpen = open === undefined ? !wheelOpen : open;
    wheel.style.display = wheelOpen ? 'block' : 'none';
    if (wheelOpen) { renderWheel(); if (document.pointerLockElement) document.exitPointerLock(); }
  }
  window.__toggleWheel = toggleWheel;
  wheel.addEventListener('click', e => { if (e.target === wheel) toggleWheel(false); });
  window.addEventListener('keydown', e => {
    if (e.code === 'Tab') { e.preventDefault(); if (started) toggleWheel(); }
  });

  // ---------- day-2 AI assets: extra character clips + facade/sky textures ----------
  function stripRootMotion(clip) {
    for (const tr of clip.tracks) {
      if (tr.name.endsWith('.position')) {
        const vals = tr.values;
        for (let i = 3; i < vals.length; i += 3) { vals[i] = vals[0]; vals[i + 2] = vals[2]; }
      }
    }
  }
  function loadClip(assetKey, clipName) {
    if (!window.GLTFLoader) return;
    const loader = new window.GLTFLoader();
    const done = gl => {
      if (!gl.animations || !gl.animations[0]) return;
      const clip = gl.animations[0];
      clip.name = clipName;
      stripRootMotion(clip);
      const tryAdd = () => {
        if (MODELS.man) MODELS.man.clips.push(clip);
        else setTimeout(tryAdd, 1000);
      };
      tryAdd();
    };
    if (window.FC_ASSETS && window.FC_ASSETS[assetKey]) {
      const bin = Uint8Array.from(atob(window.FC_ASSETS[assetKey]), ch => ch.charCodeAt(0)).buffer;
      loader.parse(bin, '', done, () => {});
    } else {
      fetch('assets/' + assetKey.replace('_', '-') + '.glb').then(r => r.ok ? r.arrayBuffer() : Promise.reject(0))
        .then(b => loader.parse(b, '', done, () => {}))
        .catch(() => {});
    }
  }
  // Xbot ships authored idle/walk/run clips, so the AI stand-in clips are no longer loaded.
  // (loadClip stays available for the procedural fallback model.)
  void loadClip;
  // CC0 coin (Kenney) for visible cash pickups
  let coinTpl = null;
  if (window.GLTFLoader) {
    const cmgr = new T3.LoadingManager();
    cmgr.setURLModifier(u => u.includes('colormap') ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' : u);
    const cl = new window.GLTFLoader(cmgr);
    const gold = new T3.MeshStandardMaterial({ color: 0xffcf3a, emissive: 0x6a5210, metalness: 0.7, roughness: 0.35 });
    const fin = gl => {
      const c = gl.scene;
      const box = new T3.Box3().setFromObject(c);
      const s = 1.6 / Math.max(box.getSize(new T3.Vector3()).y, 0.01);
      c.scale.setScalar(s);
      c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material = gold; } });
      coinTpl = c;
    };
    if (window.FC_ASSETS && window.FC_ASSETS.ken_coin) { const bin = Uint8Array.from(atob(window.FC_ASSETS.ken_coin), ch => ch.charCodeAt(0)).buffer; cl.parse(bin, '', fin, () => {}); }
    else fetch('assets/kenney/coin.glb').then(r => r.ok ? r.arrayBuffer() : Promise.reject(0)).then(b => cl.parse(b, '', fin, () => {})).catch(() => {});
  }
  const coinMeshes = new Map();
  window.__syncCoins = (t2) => {
    if (!coinTpl) return;
    const live = new Set();
    for (const g2 of S.pickups) {
      if (g2.kind !== 'cash') continue;
      live.add(g2);
      let cm = coinMeshes.get(g2);
      if (!cm) { cm = coinTpl.clone(true); scene.add(cm); coinMeshes.set(g2, cm); }
      cm.position.set(g2.x, C.groundY(g2.x, g2.z) + 0.9 + Math.sin(t2 * 3 + g2.x) * 0.15, g2.z);
      cm.rotation.y = t2 * 3;
    }
    for (const [g2, cm] of coinMeshes) if (!live.has(g2)) { scene.remove(cm); coinMeshes.delete(g2); }
  };
  function loadTex(name, cb) {
    const use = url => new T3.TextureLoader().load(url, tt => {
      tt.colorSpace = T3.SRGBColorSpace; tt.wrapS = tt.wrapT = T3.RepeatWrapping; cb(tt);
    });
    if (window.FC_ASSETS && window.FC_ASSETS['tex_' + name]) use('data:image/jpeg;base64,' + window.FC_ASSETS['tex_' + name]);
    else fetch('assets/tex/' + name + '.jpg').then(r => r.ok ? r.blob() : Promise.reject(0))
      .then(b => use(URL.createObjectURL(b))).catch(() => {});
  }
  loadTex('facade-tower', t => {
    t.repeat.set(3, 5);
    const m = window.__bmats && window.__bmats.tower;
    if (m) { m.map = t; m.emissiveMap = t; m.emissiveIntensity = 1.0; m.needsUpdate = true; }
    const tm = window.__bmats && window.__bmats.terminal;
    if (tm) { tm.map = t; tm.emissiveMap = t; tm.emissiveIntensity = 1.0; tm.needsUpdate = true; }
  });
  loadTex('facade-brick', t => {
    t.repeat.set(3, 3);
    const m = window.__bmats && window.__bmats.block;
    if (m) { m.map = t; m.emissiveMap = t; m.emissiveIntensity = 0.9; m.needsUpdate = true; }
  });
  loadTex('skypano', t => {
    if (window.__skyDome) { window.__skyDome.material.map = t; window.__skyDome.material.needsUpdate = true; }
  });
})();

})();
