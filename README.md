# Blank City 3D

A third-person **3D open-world GTA-style game** (Three.js/WebGL) where **every character is a
faceless mannequin** — smooth blank heads, no eyes, no mouth, nothing. Built as a full
sandbox with PS3-era depth: free roam, missions, property, shops, a military base, an
airport, underground tunnels, and a mountain guerrilla war. **Progress saves automatically**
(localStorage): money, weapons, houses, vehicles, and mission history survive between sessions.

Open `index.html` in a browser. The original top-down 2D version is kept at `classic.html`.

## The world (6 km × 4 km)

| Region | What's there |
|---|---|
| **Blank City** | A **real city built from OpenStreetMap** — ~2,000 actual Lower-Manhattan building footprints with real heights, the real street network with traffic that follows the real roads, varied pedestrians, six shops, three buyable houses, mission givers |
| **Fort Kubra** | Walled military base. Restricted: trespass draws an armed garrison; the heist mission sends you in to steal a T-80 |
| **International Airport** | 1.5 km runway, terminal, hangars, and Skyline Aviation — buy your own helicopter or plane |
| **The Outfield** | No-man's-land of camps and craters — wave-based tactical ops |
| **Sierra Negra** | Real-elevation mountains (140 m+ peaks), pine forest, winding trails — the guerrilla war: gunships, tanks, Stinger lock-ons |
| **Tunnels** | Two underground road tunnels. The law can't see you down there — wanted stars burn off fast |

## The arsenal — every US weapon has its Soviet counterpart

| Class | US | Soviet |
|---|---|---|
| Pistol | M1911 | Makarov PM |
| Shotgun | SPAS-12 | Saiga-12 |
| Rifle | M4A1 | AK-47 |
| Sniper | M24 SWS | Dragunov SVD |
| MG | M60 | PKM |
| Rocket | M72 LAW | RPG-7 |
| Anti-air | FIM-92 Stinger | 9K32 Strela-2 |

The pairs trade off honestly (AK hits harder, M4 shoots straighter; SVD is faster, M24 hits
harder). US arms sell at **Liberty Arms** in the city; Soviet arms at the **Sierra Black
Market**. Higher tiers unlock as your reputation grows.

## THE TAILOR — the story (8 missions, letterboxed cutscenes, MISSION PASSED screens)

The one man in Blank City who can tell everyone apart — by their clothes. Gold markers at
Threads & Co. Each mission is a different verb:

1. **MEASURED** — tail a courier's sedan (not too close, not too far), then fight off the ambush
2. **ALTERATIONS** — plant a tracker clean, then chase and ram the target off the road and subdue the driver
3. **DRY CLEANING** — three dirty packages, 170 seconds, permanent police heat, hand-off underground
4. **THE FITTING** — hold the shop against twelve hitmen; if they reach the door, it's over
5. **LOOSE THREADS** — sniper overwatch on a walking informant while six assassins converge
6. **OFF THE RACK** — break a police escort and hijack an armored APC mid-route (it's yours after)
7. **BESPOKE** — raid the airport hangars, take the ledger, escape by air to the Sierra
8. **FINAL CUT** — Herringbone flees in a gunship; lock, shoot it down, and finish his crew at the crash site.
   Reward: $10,000 and **The Tailor's Cut**, a story-exclusive outfit

## THE CAPTAIN — crooked cop chain (4 missions)

A dirty precinct captain uses you to bury his own case, then turns on you:

1. **PROFESSIONAL COURTESY** — intercept and destroy an evidence cruiser, then lose the heat
2. **WITNESS PROTECTION** — scare a witness out of town without killing him (herd, don't shoot)
3. **COLLECTION DAY** — timed protection-money run across four businesses
4. **INTERNAL AFFAIRS** — the setup: five-star heat and a police chopper, reach the safehouse alive

## CONTRACTS — repeatable assassination board (the Sierra black market)

A randomized mark somewhere in the city, guarded. A **silent kill (no wanted level) pays
double**; go loud and it still counts. Fees scale each contract — endgame income that never
runs out.

## Side missions (rep + cash, chains unlock)

- **City chain**: Courier Run → Repo Man → Getaway Driver → unlocks **Taxi Fares**
  (repeatable) and the **Street GP** checkpoint race (repeatable, beat 95s)
- **Outfield ops**: First Contact → Supply Raid → Ghost Protocol (wave combat, cover matters)
- **Sierra war**: Stinger Ridge (down 3 gunships with locked AA) → Convoy Ambush (rockets
  kill armor, rifles don't) → Mountain Storm (everything at once)
- **The Kubra Job**: steal a T-80 from the base under maximum army response and deliver it
  to the rebels — the tank becomes yours permanently
- **Canyon Run**: aerial ring race over the mountains (aircraft required, repeatable)
- **30 hidden cash stashes** scattered across the world (+rep each)

## Economy & property

Supermarket snacks and body armor; five outfits (same blank head, different cut); seven car
classes at Prestige Motors — from the Sedan up to the wedge-bodied **Supercar** (156 mph) —
aircraft at the airport; three houses (Eastside Apartment, Downtown Penthouse, Sierra Cabin)
that heal you, act as respawn points, and pay rent while you play. Owned vehicles respawn with you.

**You start loaded for bear.** A new game spawns you with the entire arsenal already in your
inventory — every US/Soviet pair, magazines full, healthy ammo reserves, M4A1 in hand — a
**Supercar** at the curb, and a **combat helicopter** and **fighter jet** parked and ready.
Both aircraft are armed: **machine guns** (LMB) and a **bomb payload** (B on desktop, RLD on
touch) that free-falls and detonates on impact. No grind before the fun starts.

## Controls

Click to capture the mouse (aim). **WASD** move/drive · **E** vehicles · **F** shops/houses ·
**Shift** sprint/nitro · **Space** handbrake / heli up · **Ctrl** heli down · **LMB** fire ·
**R** reload · **1-9 / wheel** weapons · hold aim on armor/gunships to lock AA rockets.
In the helicopter or fighter jet, **LMB** fires the guns and **B** drops bombs.

**On mobile / touch** the game auto-switches to an on-screen layout: a left virtual **stick**
to move and drive, **drag anywhere on the screen** to look around and aim, and touch buttons —
**FIRE**, **PUNCH**, **E** (enter), **F** (shops), **RLD**, **RUN** (toggle sprint/nitro),
**▲/▼** (handbrake & heli up/down), and **WPN** (weapon wheel). The minimap moves to the
bottom-right so it stays clear of your thumbs.

## Design constraints

No music (procedural SFX only), no female characters (every inhabitant is the same blank-faced
man in different clothes and builds), no drugs or vice content. Fights are against armed
combatants — soldiers, tanks, gunships — plus classic GTA chaos.

## Architecture

- `core.js` — the entire simulation, dependency-free: world gen, physics, AI, ballistics,
  missions, economy, saves. Runs in Node for testing: `node tests/test-core.js`
  (63 behavior assertions: heli flight, tunnel evasion, AA locks, the tank heist, save
  round-trips, weapon pairing…).
- `game3d.js` — Three.js renderer, camera, input, HUD, shop menus.
- `assets/citydata.js` — the city itself: ~2,000 real building footprints + the drivable
  road graph, baked offline from **OpenStreetMap** (Lower Manhattan). Map data ©
  OpenStreetMap contributors, licensed **ODbL**. Regenerate with the OSM pipeline
  (Overpass fetch → `convert-osm.mjs`). If this file is absent, the game falls back to the
  original procedural block grid, so it always runs.
- `vendor/three.min.js` — Three.js r160, vendored.
- `classic.html` + `game.js` — the original 2D top-down version, kept playable.
- `assets/*.glb` — AI-generated models (Higgsfield/Meshy). `assets/kenney/*.glb` — CC0 city
  models from [Kenney](https://kenney.nl)'s Starter Kit City Builder (thanks, Kenney!).

## Flavor systems

- **Stunt ramps** — eight hazard-striped ramps (airport, Outfield, city, Sierra). Hit them
  fast: airtime over ~0.9s pays an INSANE STUNT bonus scaled by hang time and speed.
- **Neon city** — glowing shop signs and roadside billboards for the city's in-world brands
  (MONO MART: *everything tastes the same*; MANNEQUIN MOTEL: *sleep like you're not
  there*), with the Sierra black market flickering in Russian.
- **Weapon wheel** — Tab opens a wheel of everything you own with live ammo counts.
- **Kenney storefronts** — low-rise blocks use real CC0 building models; parks get fountains
  and tree clusters, all merged into a handful of draw calls.
- **Vehicle handling feel** — cars lean into turns (suspension roll), dive on braking and squat
  under acceleration, bob over the road, and the camera FOV widens with speed. On-foot movement
  accelerates and decelerates smoothly instead of snapping.
- **Visible loot** — downed enemies drop spinning gold coins (CC0 Kenney); muzzle flashes use a
  real spark sprite.
