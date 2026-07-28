// Procedural PBR material library — no external texture files.
// Owner: materials agent. Public API: get(name) -> THREE.Material (cached).
import * as THREE from 'three';

function canvasTex(size, draw, { repeat = 1, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(g, s, amount, scale) {
  const img = g.getImageData(0, 0, s, s), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

export class Materials {
  constructor(ctx) { this.ctx = ctx; this.cache = new Map(); }
  get(name) {
    if (!this.cache.has(name)) this.cache.set(name, this.build(name));
    return this.cache.get(name);
  }
  build(name) {
    switch (name) {
      case 'asphalt': return new THREE.MeshStandardMaterial({
        map: canvasTex(512, (g, s) => { g.fillStyle = '#2a2c30'; g.fillRect(0, 0, s, s); noise(g, s, 42); }, { repeat: 24 }),
        roughness: 0.92, metalness: 0.0, color: 0xffffff,
      });
      case 'concrete': return new THREE.MeshStandardMaterial({
        map: canvasTex(512, (g, s) => { g.fillStyle = '#8b8880'; g.fillRect(0, 0, s, s); noise(g, s, 26); }, { repeat: 6 }),
        roughness: 0.85, metalness: 0.0,
      });
      case 'brick': return new THREE.MeshStandardMaterial({
        map: canvasTex(512, (g, s) => {
          g.fillStyle = '#8e8479'; g.fillRect(0, 0, s, s);
          const bh = s / 16, bw = s / 8;
          for (let y = 0; y < 16; y++) for (let x = -1; x < 8; x++) {
            const ox = (y % 2) * bw / 2;
            g.fillStyle = `hsl(${16 + Math.random() * 10} ${28 + Math.random() * 12}% ${34 + Math.random() * 12}%)`;
            g.fillRect(x * bw + ox + 2, y * bh + 2, bw - 4, bh - 4);
          }
          noise(g, s, 18);
        }, { repeat: 4 }),
        roughness: 0.9, metalness: 0,
      });
      case 'metal': return new THREE.MeshStandardMaterial({ color: 0x6e737a, roughness: 0.42, metalness: 0.9 });
      case 'glass': return new THREE.MeshPhysicalMaterial({
        color: 0x223040, roughness: 0.08, metalness: 0, transmission: 0.0,
        transparent: true, opacity: 0.55, envMapIntensity: 1.4,
      });
      case 'wood': return new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.8, metalness: 0 });
      case 'sand': return new THREE.MeshStandardMaterial({
        map: canvasTex(512, (g, s) => { g.fillStyle = '#b09a72'; g.fillRect(0, 0, s, s); noise(g, s, 30); }, { repeat: 30 }),
        roughness: 1.0, metalness: 0,
      });
      default: return new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8 });
    }
  }
}
