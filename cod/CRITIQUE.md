# Visual critique log

Harsh art-direction review of `cod/shots/*`, judged against real Call of Duty
(MW2019 / MWII) frames. Anything that would not survive a blind side-by-side is
a defect, not a preference.

---

## Round 1 — `shots/critic1/street.png`

Baseline: atmosphere + grade landed; world/weapons/player agents still in flight,
so the map is the placeholder blockout and the viewmodel is boxes. Those are
known and excluded from the verdict below.

**Verdict: fails a blind comparison badly.** A COD frame reads as a photograph of
a place. This reads as a tech demo of a fog shader.

### Atmosphere / render defects (owner: sky.js + render.js)

1. **Fog density is destroying the image.** A building ~40 m out is ~80 % washed.
   COD's aerial perspective is barely perceptible under ~80 m; it separates depth
   planes, it does not erase them. Cut `fog.density` roughly in half at golden
   hour and raise `falloff` so the gradient is vertical, not a flat wall of tan.
2. **The sun is a featureless white blob** covering ~15 % of the frame. Bloom
   threshold is too low and godray intensity too high, so the disc, the horizon
   line behind it and the cloud structure around it are all gone. A COD sunset
   keeps a readable disc with tight falloff plus anamorphic-ish streaking — not a
   radial smear.
3. **No true black and no true white.** The whole histogram sits in a narrow tan
   band. Shadow-side surfaces must reach near-black, and specular highlights must
   clip, or the image has no depth. The contrast/split-tone pass is not earning
   its cost.
4. **The shadow-side brick wall is dead.** It is nearly pure black with no bounce
   light and no visible albedo — the normal map detail is only readable in the
   top third. Real shadowed brick still shows colour from sky ambient. Raise
   `hemiInt` / `envInt` for the shadow half, or add a cheap bounce term.
5. **Chromatic aberration is firing mid-frame**, visible as red/cyan fringing on
   the wall edge at ~70 % screen width. CA must be radial and near-zero until the
   outer ~20 % of the frame.
6. **Nothing in the frame is sharp.** Between fog, bloom and CA there is no
   crisp edge anywhere for the eye to land on. Every COD frame has hard, sharp
   detail in the near field.

### Known, in flight (not counted against this round)

- Map is untextured grey slabs, no props, no silhouette variety — world agent running.
- Viewmodel is an unreadable dark sliver at bottom-right — weapons agent running.
- No AI, no killfeed, no scoreboard, no audio beyond a synth gunshot — wave 2 not started.

---

## Round 2 — `shots/critic2/street.png`, `shots/critic2/gunsight.png`

The map, the props and the viewmodel all landed. This is no longer a tech demo —
it reads as a place. Round 1's atmosphere defects are largely fixed: the sun is a
readable disc, the mid-ground survives, the near field is sharp, CA is at the edges.

**Verdict: still loses a blind side-by-side, and now the weapon is the worst
offender in frame.**

### Weapon — critical (owner: weapons.js)

1. **Scale and placement are badly wrong.** The rifle occupies the right third of
   the frame and its barrel runs off-screen. A COD carbine viewmodel sits low-right
   and reads at roughly a sixth of frame width. This looks like a prop held six
   inches from the eye.
2. **There are no arms or hands.** A floating rifle is the single loudest "this is
   not a real game" tell in both frames. Gloved forearms gripping the handguard and
   the pistol grip are mandatory.
3. **ADS is broken.** In `gunsight.png` the optic housing fills the centre of the
   screen, the sight is not aligned to the crosshair, the reticle is not visible,
   and the hip-fire crosshair is still drawn over the top of the optic. ADS must
   align the sight dead centre, hide the crosshair, and show a lit reticle.
4. **Materials are flat.** The receiver is untextured near-black with no wear, no
   edge highlights, no roughness variation. Real weapon models read as worn metal
   and polymer at a glance.

### World / materials

5. **Sandbags read as beige bread rolls.** Wrong silhouette (too round, too
   regular) and the fabric texture is tiling visibly at that scale.
6. **Windows are flat dark rectangles.** No glass, no reflection, no recess depth,
   no interior parallax. At this distance COD windows show reflected sky and a
   dark interior falloff. This is the biggest remaining building defect.
7. **Brick tiles visibly and every wall is the same saturated red-orange.** Needs
   per-building hue/wear variation and grime where wall meets pavement — right now
   the junction is a hard clean line.
8. **Rooflines are all flat extrusions.** No parapet variety, no roof clutter
   breaking the silhouette against the sky.
9. **Distant buildings are untextured grey slabs** with no detail at all — the end
   of the street falls off a cliff instead of fading.
10. **The asphalt normal map is too strong in the near field** — the road looks
    like gravel-textured rubber. Lane lines are pure white and uniformly crisp:
    no wear, no tyre scuffing, no breaks.

### Lighting

11. **Where are the shadows?** Golden-hour sun at this elevation should throw long
    building shadows down the street. The ground is almost uniformly lit — either
    the cascade is not covering the street or the shadow contribution is being
    washed out.
12. **The image is monochrome amber.** Everything from sky to brick to asphalt sits
    on the same hue. Shadows need to go cool to separate from the warm key.
13. **No contact AO** where props and walls meet the ground.

---

## Round 3 — `shots/critic3/street.png`

Captured mid-write: the weapons agent was cut off by a usage limit while
replacing its material set, so the rifle renders as untextured white. That is a
known transient, not a design decision — but everything else in the frame is a
real step forward.

**Fixed since round 2:**
- Long directional shadows now cross the street (defect 11 — the biggest one).
- The image is no longer monochrome: cool blue shadow, warm key, blue sky above
  the haze (defect 12).
- The backdrop reads — distant buildings have material, mass and rooflines that
  break the skyline (defects 8, 9).
- Sandbags have a believable slumped silhouette (defect 5).
- Road markings are weathered and the asphalt no longer looks like rubber (10).
- Compass and ammo HUD are in and legible.

**Still failing:**
1. **The weapon is untextured white** — mid-write regression, first thing to
   finish when the weapons agent resumes.
2. **Still no arms or hands**, and the viewmodel is still too large and sits too
   far into frame (defects 1, 2 unresolved).
3. **Shadow edges are hard and slightly banded** — needs a wider PCF kernel or a
   softer cascade blend; contact shadows should sharpen, distant ones soften.
4. **The road surface reads flat blue-grey in shadow** — the shadowed asphalt has
   lost its albedo and normal detail again, the same failure mode as round 2's
   brick wall, now moved to the ground plane.
5. **Windows are still flat dark rectangles** (defect 6 unresolved) — visible on
   the right-hand brick building.
6. **No AO contact darkening** where the sandbags, kerbs and lamp posts meet the
   ground (defect 13 unresolved). The sandbag row appears to float.

**Harness note:** the scene is now heavy enough that 60 warm-up frames exceeded
the capture timeout on the software rasteriser. Warm-up dropped to 40 frames and
the timeout raised to 7 minutes.

---

## Round 4 — `shots/critic4/street.png`

**Fixed since round 3:**
- Windows now have frames, glass and variation, with some lit interiors on the
  right-hand block (defect 6 — finally closed).
- Brick varies per building and the wall/pavement junction has grime (defect 7).
- Sandbags read as real stacked bags (defect 5 fully closed).
- Buildings carry surface detail at mid-distance; the skyline has silhouette.

**Still failing — weapon is still the worst thing in frame:**
1. **The viewmodel materials are now broken in a new way.** The suppressor/barrel
   shows a pastel blob pattern like foil wrapping, and the receiver is light grey
   with a chequerboard normal-map artifact. This is worse than the plain white of
   round 3. Another mid-write casualty; it must be finished and verified in a
   screenshot before anything else in that module is touched.
2. **Still no arms or hands, still oversized, still too far into frame** (defects
   1 and 2 have now survived three rounds — this is the oldest open defect).
3. **Street shadows read as flat blue painted polygons**, not shadows. Hard
   straight edges, uniformly desaturated fill, no gradient, no penumbra growth
   with distance. Worse: shadowed asphalt still loses its albedo and normal
   detail, so the shadow looks like a decal laid over the road.
4. **Still no contact AO** at kerb bases, lamp post bases and prop feet
   (defect 13 — also three rounds open).
5. The cloud layer reads as blurry haze rather than cloud form; the horizon band
   is washing to near-white.
6. The tall central building at the end of the street is a dark, near-detail-free
   slab — the one part of the backdrop that did not get the round-3 treatment.

**Harness note:** the page load itself now exceeds playwright's default 30s
budget (texture generation), which crashed the capture run. Load timeout raised
to 5 minutes with a soft failure that still captures a frame.

---

## Round 5 — `shots/critic5/squad.png` (first frame containing the AI)

Verified structurally with the new `tools/statecheck.mjs` rather than by eye
alone: 12/12 subsystems live, 8 bots in scene at 20 meshes each, all in-frustum
and unoccluded, 430 colliders, 50 nav points, 14 spawn points, match state
running, **zero console errors**. The soldiers were rendering all along — the
first `squad` capture just looked empty because they are small at 16-30 m and the
frame was busy.

**New defects found by zooming into the soldiers:**
1. **Soldiers read as pale mannequins.** Mid-green fatigues wash out under the
   golden-hour key plus sky fill. FIXED this round: uniforms taken much darker
   and lower-chroma, plate carrier to near-black.
2. **No readable weapon at range** — the rifle hid inside the body silhouette.
   FIXED: larger rifle held across the chest and angled out, plus a helmet brim
   so facing is readable at distance.
3. **A large rust-textured mass sits bottom-right of frame at the map centre**,
   plus a tall brown cylinder mid-left. Both look like props at wrong scale or
   wrong material — WORLD AGENT, not yet assigned.
4. The weapon viewmodel is still oversized, still armless, still pale grey —
   defects 1-4 of round 2, now five rounds open. The bisection strategy
   (pose → arms → strip textures → re-add one map at a time) is in progress.

**Harness note:** the screenshot step itself was timing out at playwright's 30 s
default under three concurrent agents. All page timeouts now 10 minutes.

---

## Round 6 — `shots/critic6/street.png`

**Fixed since round 5:**
- The oversized rust prop that dominated the round-5 foreground is GONE, and the
  misplaced cylinder with it.
- The backdrop is fully detailed now — the tall central building that was a dark
  featureless slab has windows, mass and a roofline, and the whole skyline reads.
- Sandbags, kerbs, road markings, wires and street furniture all hold up.
- Sky and grade are the strongest they have been: readable sun, cloud form,
  warm key against cool shade, blue overhead.

**Verified this round (not by eye — by test):**
- `tools/movetest.mjs`: **23/23 checks pass.** Never falls through the world over
  30 s of random input, no teleport-sized frame steps (max 0.146 m), steps a
  0.3 m ledge without jumping, cannot pass a wall at 30 m/s, sprint 6.5 m/s,
  slide boosts to 7.8 then decays to walk within 0.75 s, mantles 1.2 m but
  refuses 2.6 m, jump apex 0.88 m with land event, crouch in 0.2 s, cannot stand
  under a low ceiling, backpedal/strafe/ADS penalties correct, death and respawn
  restore at a spawn point, regen waits then heals, no inside-corner jitter,
  view bob bounded, double-tap tactical sprint 8.4 m/s, sprint blocks firing with
  a sprint-out delay, slide-cancel keeps momentum, zero console errors.
- `tools/audiotest.mjs`: 91/91 assertions pass.

**Still failing — the weapon, now six rounds open:**
1. The viewmodel is still oversized and still nearly end-on, so it reads as a
   foreshortened slab rather than a rifle.
2. The hands are a dark unreadable blob; the forearm does not connect.
3. Materials are flat pale grey — no gunmetal, no polymer distinction, no wear.

Everything else in the frame is now at or near the standard. The weapon is the
single thing keeping this from passing a blind side-by-side.
