# Birmingham, UK — Google Photorealistic 3D Tiles map

Replaces the generated/OSM city with **real photorealistic 3D geometry of Birmingham**
streamed from the Google Maps Platform *Photorealistic 3D Tiles* API, rendered in
Three.js by [`3d-tiles-renderer`](https://github.com/NASA-AMMOS/3DTilesRendererJS)
(Apache-2.0) using its `GoogleCloudAuthPlugin` — the equivalent of the Cesium plugin,
but for a Three.js game like this one.

Open `birmingham.html`. **It requires network + your own API key** (see below), so it
is a separate page from the offline single-file build.

## Files

| File | What it does |
|---|---|
| `map-google3d.js` | The map provider: tileset, georeferencing, physics colliders, attribution |
| `birmingham.html` | Runnable page: camera init, drivable car on the real streets, HUD |
| `map-config.js` | Reads the API key (safe to commit — contains no key) |
| `map-config.local.example.js` | Copy to `map-config.local.js` (git-ignored) and put your key there |

## 1. Where the map logic lives

- **Camera initialisation** — `birmingham.html`, the `PerspectiveCamera` block; it starts
  above the anchor looking at the origin, then a chase camera follows the car each frame.
- **Coordinate tracking** — `GoogleTilesMap.localToLatLon()` / `latLonToLocal()`. The HUD
  prints live lat/lon; use `latLonToLocal()` to place missions on real Birmingham addresses.
- **Map loading** — `GoogleTilesMap` constructor (tileset + plugin) and `map.update()`,
  called once per frame, which streams tiles based on the camera.

## 2. The tileset

Google's root endpoint (`https://tile.googleapis.com/v1/3dtiles/root.json`) is requested
through `GoogleCloudAuthPlugin`, which manages the **session token** and refreshes it
(`autoRefreshToken: true`) — Google expires a session after ~3 hours, so without this a
long play session would stop loading tiles.

## 3. Georeferencing to Birmingham

Anchor: **latitude 52.4862, longitude -1.8904**.

The East-North-Up frame at that point is built on the WGS84 ellipsoid and **inverted**
onto the tileset group, so the anchor sits at local `(0,0,0)`, **+Y is up, +Z is north,
and one world unit is one metre** — meaning existing gameplay code keeps working in metres.

Verified numerically: the anchor maps to `(0,0,0)`; a round-trip returns
`52.486200, -1.890400`; 1 km north = 999.6 m; the Bullring lands ~988 m from the origin.

## 4. Physics / collision

`physics: true` builds a **`MeshBVH` (three-mesh-bvh, MIT) for every tile mesh as it
streams in**, and disposes it when the tile unloads. That gives:

- `map.getGroundHeight(x, z)` — ground/road height so cars and characters **stand on the
  real geometry instead of falling through**
- `map.raycast(origin, dir, far)` — bullets, line-of-sight, camera collision
- `map.isSolidAt(x, y, z)` — cheap "am I inside a wall" test

**Streaming caveat:** tiles load progressively. `getGroundHeight()` returns `null` where
the city hasn't arrived yet — the demo *holds* the vehicle's height in that case instead of
letting it drop. Do the same in any code you wire up; never treat `null` as "ground = 0".

## 5. API key — placement, safety, attribution

**Never commit a key.** Put it in a git-ignored local file:

```bash
cp map-config.local.example.js map-config.local.js   # then paste your key
```

```html
<!-- load before the module script in birmingham.html -->
<script src="map-config.local.js"></script>
```

For a quick local test only, `birmingham.html?key=YOUR_KEY` also works.
For production, inject at build time from a git-ignored `.env`
(e.g. Vite's `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`) — never inline it in source.

A browser key is inherently public, so the real protection is server-side in the
**Google Cloud Console → Credentials → your key**:

- **Application restrictions → HTTP referrers** → only your domains (`https://yourgame.com/*`)
- **API restrictions** → restrict to the **Map Tiles API** only
- Set a **billing budget + alerts** — 3D tiles bill per session

**Attribution is mandatory.** Google requires a renderer that displays copyright
attribution and that the credits stay visible. `map-google3d.js` pulls the live
per-tile attributions from the plugin every frame into the always-visible
`#attribution` bar. **Do not hide, cover, or remove that element.**

### Before you ship
Review the [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms)
and the Map Tiles API policies for your specific use — commercial/game usage,
caching limits, and the July 2025 EEA content restrictions are your call to verify.

## Running it

```bash
npm install            # 3d-tiles-renderer, three, three-mesh-bvh
npx serve .            # any static server from the repo root (so /node_modules resolves)
# open http://localhost:3000/birmingham.html
```

Controls: **WASD** drive · **Shift** boost · **Space** brake · **R** reset.

## Status

Verified without a key: modules resolve, the render loop runs, georeferencing reports
`lat 52.48620 lon -1.89040`, and the correct Google root-tileset request is issued.
**The imagery itself is unverified here** — that needs your billed key.
