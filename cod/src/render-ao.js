// Ambient-occlusion application. Owner: render agent.
//
// Why this is not just `GTAOPass.OUTPUT.Default`:
//
// three's default blend is a flat `beauty *= ao` over the whole frame. At golden
// hour that is the wrong operator twice over.
//   * Sunlit ground is dominated by the *direct* term, which no amount of
//     hemispherical occlusion should attenuate. Multiplying it anyway means the
//     only strength you can pick without visibly greying the sunlit road is one
//     so low that the shaded side gets nothing either — which is exactly why
//     three rounds of "AO is enabled" produced three rounds of "no contact AO".
//   * Occlusion does not remove light evenly across the spectrum. What a kerb
//     base, a sandbag foot or a wall/pavement junction loses is *skylight* —
//     the cool half of a two-colour golden-hour image. So occlusion has to warm
//     as it darkens. That also breaks up the "uniformly desaturated blue fill"
//     the critique kept seeing in the street shadows: inside a building shadow,
//     ambient is all there is, so this term becomes the entire tonal structure
//     of the shadow instead of a decoration on top of it.
//
// So: strength is weighted down where the pixel is already bright (a cheap,
// robust stand-in for "this pixel is direct-lit"), and the occluded colour is a
// warm dark rather than neutral grey.
//
// ROUND 5 — why "AO is enabled" still produced "no contact AO", measured this
// time instead of guessed. On shots/lightdbg7 the denoised GTAO buffer over the
// road reads 0.987 mean in sunlight and 0.809 in shade. Feeding that through the
// old blend gave a 1.3 % darkening on sunlit ground and 12 % in shade — i.e. the
// pass was working exactly as written and the write-up was simply asking for an
// effect two orders of magnitude below the noise floor. Two changes:
//
//   * strength up ~3x, so the broad term is actually a tone, and
//   * a separate CONTACT term. The broad term cannot be pushed far enough to
//     seat a prop on the ground without greying the whole open road, because
//     both are the same 0.8-1.0 slice of the buffer. The contact term instead
//     high-passes the buffer: it compares this pixel's occlusion against the
//     least-occluded of a ring of neighbours, so flat ground (locally uniform,
//     however occluded) contributes nothing at all, while the few pixels at a
//     kerb base or a sandbag foot — where occlusion falls off sharply within a
//     few pixels — get a hard, local, dark line. Being a local difference it is
//     also safe to leave mostly un-suppressed in sunlight, which is the one
//     place the critique keeps looking.
export const AOApplyShader = {
  uniforms: {
    tDiffuse: { value: null },
    tAO: { value: null },
    uTexel: { value: [1 / 1600, 1 / 900] },
    uStrength: { value: 3.1 },   // occlusion applied in fully ambient-lit pixels
    uLitFalloff: { value: 0.34 }, // ...scaled to this in fully sun-lit pixels
    uLitLo: { value: 0.35 },      // HDR luminance where the roll-off starts
    uLitHi: { value: 2.20 },      // ...and ends
    uContact: { value: 3.4 },     // gain on the high-passed (local) occlusion
    uContactLit: { value: 0.72 }, // contact term survives this much in sunlight
    uContactR: { value: 5.0 },    // high-pass ring radius, pixels
    // colour multiplier at full occlusion: darkens, and takes the blue down
    // hardest because it is the sky contribution that is being blocked
    uOccColor: { value: [0.34, 0.28, 0.24] },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tAO;
    uniform vec2 uTexel;
    uniform float uStrength, uLitFalloff, uLitLo, uLitHi;
    uniform float uContact, uContactLit, uContactR;
    uniform vec3 uOccColor;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D( tDiffuse, vUv );
      float ao = texture2D( tAO, vUv ).r;
      float occ = clamp( 1.0 - ao, 0.0, 1.0 );

      // local high pass: the brightest (least occluded) neighbour on a ring
      float open = ao;
      for ( int i = 0; i < 8; i ++ ) {
        float th = float( i ) * 0.7853981634;
        vec2 d = vec2( cos( th ), sin( th ) ) * uContactR * uTexel;
        open = max( open, texture2D( tAO, vUv + d ).r );
      }
      float contact = clamp( ( open - ao ) * uContact, 0.0, 1.0 );

      float L = dot( src.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      float lit = smoothstep( uLitLo, uLitHi, L );
      float broad = occ * uStrength * mix( 1.0, uLitFalloff, lit );
      float loc   = contact * mix( 1.0, uContactLit, lit );
      // union rather than sum: a pixel already fully shaded by the broad term
      // must not go negative-black just because it is also a contact pixel
      float k = clamp( 1.0 - ( 1.0 - clamp( broad, 0.0, 1.0 ) ) * ( 1.0 - loc ), 0.0, 1.0 );

      gl_FragColor = vec4( src.rgb * mix( vec3( 1.0 ), uOccColor, k ), src.a );
    }`,
};
