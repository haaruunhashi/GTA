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
export const AOApplyShader = {
  uniforms: {
    tDiffuse: { value: null },
    tAO: { value: null },
    uStrength: { value: 1.0 },   // occlusion applied in fully ambient-lit pixels
    uLitFalloff: { value: 0.30 }, // ...scaled to this in fully sun-lit pixels
    uLitLo: { value: 0.35 },      // HDR luminance where the roll-off starts
    uLitHi: { value: 2.20 },      // ...and ends
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
    uniform float uStrength, uLitFalloff, uLitLo, uLitHi;
    uniform vec3 uOccColor;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D( tDiffuse, vUv );
      float ao = texture2D( tAO, vUv ).r;
      float occ = clamp( 1.0 - ao, 0.0, 1.0 );

      float L = dot( src.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
      float lit = smoothstep( uLitLo, uLitHi, L );
      float k = clamp( occ * uStrength * mix( 1.0, uLitFalloff, lit ), 0.0, 1.0 );

      gl_FragColor = vec4( src.rgb * mix( vec3( 1.0 ), uOccColor, k ), src.a );
    }`,
};
