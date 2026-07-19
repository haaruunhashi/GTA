# Faceless City

A top-down, GTA-style open-world browser game where **every character is a faceless mannequin** —
smooth blank beige heads, no eyes, no mouth, nothing. You, the pedestrians, the cops, the
soldiers: nobody here has a face. But they're not all the same man — the streets are full of
different faceless men: suits, hoodies, hi-vis workers, tracksuits, joggers, all with different
builds and walks.

No installation, no build step, no dependencies. Open `index.html` in a browser and play.

## Three zones, one world

**The city (west)** — classic GTA free roam:
- Do what you like: carjack traffic, punch civilians, outrun a 5-star wanted level, lose the heat.
- Varied traffic — sedans, taxis, vans, pickups, muscle cars, sports coupes — each with its own
  speed and handling.
- **Regular GTA missions** from blue street markers: a timed *Courier Run*, a *Repo Man* car
  theft (steal a marked coupe and deliver it unscratched), and a *Getaway Driver* job with the
  law already on you.

**The Outfield (middle)** — tactical wave-based operations at fortified camps: rifle combat,
cover that actually blocks bullets, hostiles that flank between volleys. Three ops, rising pay.

**Sierra Negra (east)** — the mountain war. Ridges, pine forest, rock crags, winding trails —
and three guerrilla missions fought Afghan-style from the treeline:
- ***Stinger Ridge*** — lock the Stinger launcher onto orbiting gunships and bring all three down.
- ***Convoy Ambush*** — tanks with infantry escort. Rockets kill armor; rifles don't.
- ***Mountain Storm*** — gunships, armor and infantry all at once.

Tanks track you with independent turrets and main-gun shells; helicopters orbit and strafe;
the Stinger needs a held lock before it homes. Ammo crates at each site resupply rockets.

## Driving

Hold **Shift** for **nitro**: flames, speed streaks, camera pull-back, and a speedometer that
climbs past anything traffic can do. Handbrake (Space) lays skid marks through corners. Each
car class accelerates and grips differently — the sports coupe is the one you want.

## Controls

| Input | Action |
|---|---|
| WASD / Arrows | Move / drive |
| E | Enter, exit, or carjack a vehicle |
| Shift | Sprint (on foot) / **nitro** (driving) |
| Space | Punch / handbrake |
| Mouse | Aim + shoot (east of the city limits) |
| R | Reload |
| Q | Switch rifle ↔ Stinger (mountains) |

## Design notes

- Everyone is a faceless man — identical blank heads, different clothes, builds and jobs.
- **No music** — by design. All audio is procedural WebAudio sound effects: engines, sirens,
  gunfire, explosions, cash.
- No drugs, no vice content — the city's crimes are cars, fists and chases; the war is fought
  against armed soldiers, tanks and gunships.
- Everything is drawn procedurally on one `<canvas>`: dusk-lit streets with lit windows and
  fake-3D parallax buildings, crosswalks, headlight cones, body-sheen on cars, screen-shake
  explosions, and elevation-shaded mountains.
- The rifle stays holstered inside city limits — gunplay belongs to the war zones.

## Files

- `index.html` — shell + intro screen
- `game.js` — the whole engine (~2,000 lines: map gen, traffic AI, cops, ped variety,
  missions, squad AI, tanks, helicopters, missiles, ballistics, HUD)
