// Shadow filtering. Owner: render agent.
//
// three's built-in filters are both wrong for this look:
//   PCFSoftShadowMap ignores `light.shadow.radius` entirely — it is a fixed
//     one-texel bilinear kernel, so every shadow edge in the frame is exactly
//     one shadow texel wide: hard, and stair-stepped along the texel grid.
//   PCFShadowMap does honour `radius`, but it is a regular 4x4 grid of taps, so
//     widening it turns the stair-step into visible concentric banding.
//
// This patches the PCF branch of the shadow chunk with a 16-tap Vogel disk
// rotated per pixel by interleaved-gradient noise. The taps are evenly spread
// over a disk of `radius` texels, and the per-pixel rotation turns the residual
// structure into fine noise that the AA + grain passes absorb. Cost is slightly
// *below* the PCF_SOFT path it replaces (16 compares vs 17), and the penumbra
// width is now a per-light knob: a tight radius on the near cascade keeps
// contact shadows crisp, a wide one on the far cascade softens distance.
import * as THREE from 'three';

let patched = false;

export function installSoftShadows() {
  if (patched) return;
  const src = THREE.ShaderChunk.shadowmap_pars_fragment;
  const a = src.indexOf('#if defined( SHADOWMAP_TYPE_PCF )');
  const b = src.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
  // If three's chunk ever changes shape, leave it alone rather than break the build.
  if (a < 0 || b < 0 || b < a) return;

  const block = /* glsl */`#if defined( SHADOWMAP_TYPE_PCF )

		vec2 texelSize = vec2( 1.0 ) / shadowMapSize;

		// interleaved gradient noise -> a different disk rotation per pixel
		float ign = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
		float ang = 6.283185307 * ign;
		float ca = cos( ang ), sa = sin( ang );

		float sum = 0.0;
		for ( int i = 0; i < 16; i ++ ) {

			float fi = float( i ) + 0.5;
			float rr = sqrt( fi * 0.0625 );              // uniform disk sampling
			float th = fi * 2.399963229728653;           // golden angle
			vec2 d = vec2( cos( th ), sin( th ) ) * rr * shadowRadius;
			d = vec2( d.x * ca - d.y * sa, d.x * sa + d.y * ca );
			sum += texture2DCompare( shadowMap, shadowCoord.xy + d * texelSize, shadowCoord.z );

		}

		shadow = sum * 0.0625;

	`;

  THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, a) + block + src.slice(b);
  patched = true;
}
