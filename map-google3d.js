/* Photorealistic 3D map provider — Google Maps Platform "Photorealistic 3D Tiles"
   rendered in Three.js via the 3d-tiles-renderer (Apache-2.0) Google auth plugin.

   Georeferenced to BIRMINGHAM, UK. The tileset is transformed so that the game's
   local origin (0,0,0) sits at the Birmingham anchor with +Y up and +X east,
   which means all existing gameplay coordinates stay in metres.

   REQUIREMENTS (this cannot run offline):
     - a Google Maps Platform API key with the "Map Tiles API" enabled + billing
     - network access to https://tile.googleapis.com
     - on-screen copyright attribution (mandatory under Google's terms)
*/
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/plugins';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer/three';
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

// let three raycasts use the BVH when one is present
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ---- 3. georeferencing origin: Birmingham, UK -------------------------------
export const BIRMINGHAM = { lat: 52.4862, lon: -1.8904, height: 0 };

// Google's root tileset. The auth plugin appends the key + session token itself,
// so the key never has to be pasted into a URL by hand.
export const GOOGLE_ROOT_TILESET = 'https://tile.googleapis.com/v1/3dtiles/root.json';

/**
 * @param {object} opts
 * @param {string} opts.apiToken       Google Maps Platform API key (see README for safe storage)
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Camera} opts.camera
 * @param {THREE.WebGLRenderer} opts.renderer
 * @param {{lat:number,lon:number,height:number}} [opts.origin]  defaults to Birmingham
 * @param {HTMLElement} [opts.attributionEl]  element that displays the mandatory credits
 * @param {number} [opts.errorTarget]  screen-space error; lower = sharper + heavier
 */
export class GoogleTilesMap {
  constructor(opts) {
    if (!opts || !opts.apiToken) {
      throw new Error('GoogleTilesMap: apiToken is required — set GOOGLE_MAPS_API_KEY (see README-birmingham.md).');
    }
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.renderer = opts.renderer;
    this.origin = opts.origin || BIRMINGHAM;
    this.attributionEl = opts.attributionEl || null;
    this.collidersEnabled = opts.physics !== false;

    // --- 2. the tileset: Google's root endpoint via the auth plugin ---------
    const tiles = new TilesRenderer(GOOGLE_ROOT_TILESET);
    this.authPlugin = new GoogleCloudAuthPlugin({
      apiToken: opts.apiToken,
      autoRefreshToken: true,      // sessions expire (~3h); refresh instead of dying mid-game
      useRecommendedSettings: true
    });
    tiles.registerPlugin(this.authPlugin);
    tiles.setCamera(this.camera);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);
    tiles.errorTarget = opts.errorTarget !== undefined ? opts.errorTarget : 12;
    this.tiles = tiles;

    // --- 3. place Birmingham at the local origin, Y-up ----------------------
    // Build the East-North-Up frame at the anchor and invert it: world-space
    // ECEF tiles then land in local metres centred on Birmingham.
    this.enuFrame = new THREE.Matrix4();
    WGS84_ELLIPSOID.getObjectFrame(
      this.origin.lat * THREE.MathUtils.DEG2RAD,
      this.origin.lon * THREE.MathUtils.DEG2RAD,
      this.origin.height, 0, 0, 0, this.enuFrame
    );
    this.enuFrameInverse = this.enuFrame.clone().invert();
    tiles.group.matrix.copy(this.enuFrameInverse);
    tiles.group.matrixAutoUpdate = false;
    tiles.group.updateMatrixWorld(true);
    this.scene.add(tiles.group);

    // --- 4. physics: build collision geometry as tiles stream in ------------
    this.colliders = new Set();
    this._raycaster = new THREE.Raycaster();
    this._raycaster.firstHitOnly = true;   // BVH fast path
    tiles.addEventListener('load-model', ({ scene: tileScene }) => this._addColliders(tileScene));
    tiles.addEventListener('dispose-model', ({ scene: tileScene }) => this._removeColliders(tileScene));

    this._attrTarget = [];
    this._lastAttr = '';
  }

  /** Build a BVH for each mesh in a freshly-loaded tile so raycasts/collision are fast. */
  _addColliders(tileScene) {
    if (!this.collidersEnabled) return;
    tileScene.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      try {
        if (!o.geometry.boundsTree) o.geometry.boundsTree = new MeshBVH(o.geometry, { maxLeafTris: 8 });
        o.updateMatrixWorld(true);
        this.colliders.add(o);
      } catch (e) { /* a malformed tile must never kill the frame */ }
    });
  }

  _removeColliders(tileScene) {
    tileScene.traverse(o => {
      if (o.isMesh) {
        this.colliders.delete(o);
        if (o.geometry && o.geometry.boundsTree) { o.geometry.disposeBoundsTree?.(); o.geometry.boundsTree = null; }
      }
    });
  }

  /**
   * Ground height (local Y, metres) under a local X/Z — cast from high above.
   * Returns null when that patch of city has not streamed in yet; callers should
   * hold the player in place (or keep the last known height) rather than fall.
   */
  getGroundHeight(x, z, fromY = 1500) {
    if (!this.colliders.size) return null;
    this._raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    this._raycaster.far = fromY + 2000;
    const hits = this._raycaster.intersectObjects([...this.colliders], false);
    return hits.length ? hits[0].point.y : null;
  }

  /** General raycast against the streamed city (bullets, line-of-sight, camera collision). */
  raycast(origin, direction, far = 500) {
    if (!this.colliders.size) return null;
    this._raycaster.set(origin, direction.clone().normalize());
    this._raycaster.far = far;
    const hits = this._raycaster.intersectObjects([...this.colliders], false);
    return hits.length ? hits[0] : null;
  }

  /** True when a point is inside/below the city surface — cheap "am I in a wall" test. */
  isSolidAt(x, y, z) {
    const g = this.getGroundHeight(x, z);
    return g !== null && y < g - 0.05;
  }

  /** Local metres -> lat/lon, e.g. to show the player's real Birmingham street. */
  localToLatLon(x, y, z) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(this.enuFrame);
    const out = {};
    WGS84_ELLIPSOID.getPositionToCartographic(p, out);
    return { lat: out.lat * THREE.MathUtils.RAD2DEG, lon: out.lon * THREE.MathUtils.RAD2DEG, height: out.height };
  }

  /** lat/lon -> local metres (drop a mission marker on a real Birmingham address). */
  latLonToLocal(lat, lon, height = 0) {
    const p = new THREE.Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(lat * THREE.MathUtils.DEG2RAD, lon * THREE.MathUtils.DEG2RAD, height, p);
    return p.applyMatrix4(this.enuFrameInverse);
  }

  /** --- 5. mandatory Google attribution, refreshed as tiles change --------- */
  updateAttribution() {
    if (!this.attributionEl) return;
    this._attrTarget.length = 0;
    this.authPlugin.getAttributions(this._attrTarget);
    const text = this._attrTarget.map(a => a.value).filter(Boolean).join(' · ');
    const full = text ? 'Google · ' + text : 'Google';
    if (full !== this._lastAttr) { this.attributionEl.textContent = full; this._lastAttr = full; }
  }

  /** Call once per frame, after the camera has moved. */
  update() {
    this.camera.updateMatrixWorld();
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.update();
    this.updateAttribution();
  }

  dispose() {
    this.tiles.dispose();
    this.scene.remove(this.tiles.group);
    this.colliders.clear();
  }
}
