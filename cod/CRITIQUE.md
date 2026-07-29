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
