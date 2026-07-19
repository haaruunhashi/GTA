# Faceless City 3D

A third-person **3D open-world GTA-style game** (Three.js/WebGL) where **every character is a
faceless mannequin** — smooth blank heads, no eyes, no mouth, nothing. Built as a full
sandbox with PS3-era depth: free roam, missions, property, shops, a military base, an
airport, underground tunnels, and a mountain guerrilla war. **Progress saves automatically**
(localStorage): money, weapons, houses, vehicles, and mission history survive between sessions.

Open `index.html` in a browser. The original top-down 2D version is kept at `classic.html`.

## The world (6 km × 4 km)

| Region | What's there |
|---|---|
| **Faceless City** | Downtown towers with lit windows, a grid of streets with traffic and varied faceless pedestrians, six shops, three buyable houses, mission givers |
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

## Missions (rep + cash, chains unlock)

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

Supermarket snacks and body armor; five outfits (same blank head, different cut); six car
classes at Prestige Motors; aircraft at the airport; three houses (Eastside Apartment,
Downtown Penthouse, Sierra Cabin) that heal you, act as respawn points, and pay rent while
you play. Owned vehicles respawn with you.

## Controls

Click to capture the mouse (aim). **WASD** move/drive · **E** vehicles · **F** shops/houses ·
**Shift** sprint/nitro · **Space** handbrake / heli up · **Ctrl** heli down · **LMB** fire ·
**R** reload · **1-9 / wheel** weapons · hold aim on armor/gunships to lock AA rockets.

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
- `vendor/three.min.js` — Three.js r160, vendored.
- `classic.html` + `game.js` — the original 2D top-down version, kept playable.
