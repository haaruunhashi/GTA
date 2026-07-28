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
