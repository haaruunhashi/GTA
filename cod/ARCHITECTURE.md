# CLAUDE OF DUTY — architecture & agent contracts

A browser first-person shooter in Three.js, built to look and feel like a modern
Call of Duty. Everything is generated in code: no external textures, models,
or audio files. Only dependency: `three` (from `node_modules`, bundled by esbuild).

## Build & run

```bash
node cod/build.mjs            # bundle -> cod/build/bundle.js
node cod/build.mjs --watch
node cod/tools/shot.mjs       # build + headless screenshots -> cod/shots/*.png
node cod/tools/shot.mjs street --out wave2   # single pose into cod/shots/wave2/
```

`cod/index.html` is the entry point; open it over any static server.

## The context object

`src/engine.js` builds a single `ctx` passed to every subsystem. Subsystems
**never import each other** — they read `ctx.<system>` and talk over `ctx.bus`.

| field | what |
|---|---|
| `ctx.THREE`, `ctx.scene`, `ctx.camera`, `ctx.renderer`, `ctx.canvas` | three basics |
| `ctx.config` | `src/config.js`, query-string overridable |
| `ctx.bus` | event bus: `on(k,fn)`, `emit(k,payload)` |
| `ctx.rng()` | seeded deterministic random — use this, not `Math.random()`, for anything world-shaped |
| `ctx.input` | keys + mouse (disabled in capture mode) |
| `ctx.render / materials / sky / world / physics / player / weapons / fx / ai / ui / audio` | the subsystems |

### Bus events

`shot`, `reload`, `hitmarker {head}`, `kill {head}`, `playerHit {dmg}`,
`explosion {pos,radius}`, `wave {n}`.

## Module ownership (one agent per file — do not edit files you don't own)

| file | owns |
|---|---|
| `src/render.js` | renderer, HDR pipeline, shadows, post stack (bloom, AO, AA, motion blur, grade) |
| `src/materials.js` | every procedural PBR material + texture generator |
| `src/sky.js` | sky, sun/moon, IBL environment, fog, volumetrics, time of day, weather |
| `src/world.js` | map layout, buildings, interiors, props, cover, spawns, nav data, `POSES` |
| `src/physics.js` | collision, capsule movement, raycasts, rigid bodies, ragdolls |
| `src/player.js` | FPS controller, stances, slide/mantle, camera feel |
| `src/weapons.js` | weapon defs, viewmodels, animation, ADS, recoil, ballistics |
| `src/fx.js` | tracers, flashes, impacts, decals, blood, smoke, explosions, particles |
| `src/ai.js` | enemy soldiers: perception, navigation, cover, combat, death |
| `src/ui.js` | HUD, crosshair, killfeed, menus, scoreboard, hit feedback |
| `src/audio.js` | all procedural sound |
| `src/main.js`, `src/engine.js`, `src/config.js` | the coordinator only |

Adding a helper file is fine — put it next to the module that owns it and
name it `<module>-<thing>.js` (e.g. `world-props.js`).

## Required public API per module

Each module is a class constructed with `(ctx)` and, where it has per-frame
work, exposes `update(dt)`. Beyond that:

- `Render`: `render(dt)`, `resize()`
- `Materials`: `get(name)` → cached `THREE.Material`
- `Sky`: `setTimeOfDay(t01)`, `sunDir`
- `World`: `build()` → this; `colliders: THREE.Box3[]`, `spawnPoints`, `navPoints`; exports `POSES`
- `Physics`: `moveCapsule(pos, vel, r, h, dt)`, `raycast(origin, dir, maxDist)`
- `Player`: `position`, `velocity`, `yaw`, `pitch`, `ads`, `hp`, `state`
- `Weapons`: `fire()`, `reload()`, `equip(id)`, `ammo`, `reserve`, `def`
- `FX`: `tracer(a,b)`, `muzzleFlash(p)`, `impact(p,n)`, `explosion(p,r)`
- `AI`: `spawnWave(n)`, `hitscan(origin, dir, range, dmg, wallDist)`
- `UI`, `Audio`: driven entirely by bus events + `update(dt)`

## Capture mode (how visual review works)

`index.html?shot=<pose>&frames=60` disables input, places the camera at a named
pose from `POSES` in `src/world.js`, steps a **fixed** 1/60 clock so a software
rasteriser produces the same frame a GPU would, and sets `window.__ready = true`
when the warm-up frames are done. `tools/shot.mjs` drives that and writes PNGs.

Any new pose must be added to `POSES` and will be picked up by the harness.

## Non-negotiables

1. **No external asset files.** Textures, meshes, animation and audio are code.
2. **60 fps budget on a real GPU.** Merge geometry, share materials, instance props.
3. **Never leave the build broken** — `node cod/build.mjs` must succeed and
   `node cod/tools/shot.mjs <pose>` must produce a non-black frame with no console errors.
4. Deterministic world generation via `ctx.rng()`.
