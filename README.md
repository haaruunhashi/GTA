# Faceless City

A top-down, GTA-style open-world browser game where **every character is a faceless mannequin** —
smooth blank beige heads, no eyes, no mouth, nothing. You, the pedestrians, the cops, the hostiles:
nobody here has a face.

It's GTA at heart — free-roam city, carjacking, wanted stars, police chases — with a
Call of Duty-style layer: head east past the city limits into **the Outfield**, a warzone
where you run tactical operations against faceless hostiles who fight with guerrilla tactics
(they take cover behind sandbags and wrecks, hold a ring around you, and flank between volleys).

No installation, no build step, no dependencies. Open `index.html` in a browser and play.

## The two modes

**Free mode (the city)** — classic GTA loop:
- Carjack traffic, outrun cops, build up a 5-star wanted level, lose the heat.
- Punch-only combat in the city — the rifle stays holstered inside city limits.
- Knocked-down peds drop cash; get busted and the faceless judge takes a cut.

**Operations (the Outfield)** — CoD-style urban-warfare skirmishes:
- Three unlockable ops at fortified camps: **First Contact** ($500), **Supply Raid** ($1,000),
  **Ghost Protocol** ($2,000, elite hostiles).
- Wave-based gunfights: mouse aim, 30-round mag, reloads, tracers, muzzle flashes.
- Cover is real — sandbags, crates, rocks and wrecks block bullets for both sides. Use it;
  the hostiles certainly do.
- The law doesn't follow you out there: crossing the city limit drops your wanted level.

## Controls

| Input | Action |
|---|---|
| WASD / Arrows | Move / drive |
| E | Enter, exit, or carjack a vehicle |
| Shift | Sprint |
| Space | Punch (on foot) / handbrake (driving) |
| Mouse | Aim + shoot (Outfield only) |
| R | Reload |

## Design notes

- Everyone is the same faceless male mannequin — identical blank heads, only the clothes differ.
- **No music** — by design. The only audio is minimal procedural sound effects
  (engine-of-war stuff: shots, sirens, impacts, cash), generated with WebAudio.
- No drugs, no bars, no vice content — the city's crimes are cars, fists and chases.
- Everything is procedurally drawn on a single `<canvas>`: the dusk-lit city with fake-3D
  parallax buildings and warm streetlamp glows matches the mood of the reference image the
  game was built from.

## Files

- `index.html` — shell + intro screen
- `game.js` — the whole engine (map gen, traffic AI, cops, peds, enemy squad AI, ballistics, HUD)
