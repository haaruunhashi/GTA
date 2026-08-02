// Engine context: the single object every subsystem receives. Owned by main.js.
// Subsystems never import each other's internals — they talk through `ctx` and `ctx.bus`.
import * as THREE from 'three';

export class Bus {
  constructor() { this.map = new Map(); }
  on(k, fn) { (this.map.get(k) || this.map.set(k, []).get(k)).push(fn); return () => this.off(k, fn); }
  off(k, fn) { const a = this.map.get(k); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(k, payload) { const a = this.map.get(k); if (a) for (let i = 0; i < a.length; i++) a[i](payload); }
}

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, wheel: 0 };
    this.locked = false;
    this.enabled = true;
    this.dom = dom;
    this._bind(dom);
  }
  _bind(dom) {
    addEventListener('keydown', e => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
      this.dragging = true;
      // Pointer lock is unavailable in some embeds (sandboxed iframes). Ask for
      // it, but fall back to drag-to-look so the game is still playable there.
      if (!this.locked && dom.requestPointerLock) {
        const r = dom.requestPointerLock();
        if (r && typeof r.catch === 'function') r.catch(() => { this.lockDenied = true; });
      }
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      this.dragging = false;
    });
    dom.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.enabled) return;
      if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; return; }
      // unlocked: only look while the button is held, so the cursor still works
      if (this.dragging) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
    });
    addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === dom; });
  }
  down(code) { return this.enabled && this.keys.has(code); }
  pressed(code) { // edge-triggered; cleared in endFrame
    if (!this.enabled) return false;
    return this.keys.has(code) && !this._prev.has(code);
  }
  beginFrame() { if (!this._prev) this._prev = new Set(); }
  endFrame() { this._prev = new Set(this.keys); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; }
}

export function makeContext(config) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(config.fov, innerWidth / innerHeight, 0.02, 4000);
  return {
    THREE, scene, camera, config,
    bus: new Bus(),
    time: 0, dt: 0, frame: 0,
    rng: mulberry32(config.seed || 1337),
    systems: {},
    // filled by subsystems as they init
    render: null, materials: null, sky: null, world: null, physics: null,
    player: null, weapons: null, fx: null, ai: null, ui: null, audio: null,
  };
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
