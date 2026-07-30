// Shadow filtering. Owner: render agent.
//
// three's built-in filters are both wrong for this look:
//   PCFSoftShadowMap ignores `light.shadow.radius` entirely — it is a fixed
//     one-texel bilinear kernel, so every shadow edge in the frame is exactly
//     one shadow texel wide: hard, and stair-stepped along the texel grid.
//   PCFShadowMap does honour `radius`, but it is a regular 4x4 grid of taps, so
//     widening it turns the stair-step into visible concentric banding.
//
// Both also give a *constant* penumbra everywhere, which is what made the street
// shadows read as flat painted polygons: a real shadow is razor sharp where the
// object touches the ground and metres-wide soft where the occluder is a rooftop
// twenty metres up. So this replaces the PCF branch with PCSS:
//
//   0. receiver-plane depth bias — see below, this is load-bearing;
//   1. blocker search — 8 taps over a disk of `shadowRadius` texels, averaging
//      the depth of whatever is genuinely closer to the light than the receiver;
//   2. penumbra estimate — width grows linearly with (receiver - blocker) depth,
//      i.e. with how far the occluder is above the surface it shadows;
//   3. 16-tap Vogel-disk PCF at that width, rotated per pixel by interleaved
//      gradient noise so the residual structure is fine noise the AA + grain
//      passes absorb rather than concentric rings.
//
// Step 0 is not optional at golden hour. With an 11-degree sun the road is
// almost parallel to the light rays: one metre horizontally toward the sun is
// only ~0.19 m across the shadow map but ~0.98 m of depth, so the depth stored a
// few texels up-sun differs from the receiver by *metres*. A constant bias
// cannot absorb that, and any wide filter therefore reads half its own taps as
// occluders and self-shadows flat sunlit ground into a ~50 % mush that erases
// the albedo and normal detail. The fix is to predict the receiver's own depth
// at each tap from its screen-space derivatives (Isidoro 2006) and compare
// against that plane instead of a single value.
//
// `growth` is penumbra texels per unit of normalised shadow-camera depth. It
// depends on the cascade's depth range and world texel size, so sky.js — which
// owns the cascade — computes it and re-installs the chunk (see _setupShadow).
import * as THREE from 'three';

let orig = null;
let lastKey = '';

export function installSoftShadows(opts = {}) {
  const growth = opts.growth === undefined ? 400 : opts.growth;
  const base = opts.base === undefined ? 1.1 : opts.base;   // contact penumbra, texels
  const key = growth.toFixed(2) + '|' + base.toFixed(2);
  if (key === lastKey) return;

  if (orig === null) orig = THREE.ShaderChunk.shadowmap_pars_fragment;
  const src = orig;
  const a = src.indexOf('#if defined( SHADOWMAP_TYPE_PCF )');
  const b = src.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
  // If three's chunk ever changes shape, leave it alone rather than break the build.
  if (a < 0 || b < 0 || b < a) return;
  lastKey = key;

  const block = /* glsl */`#if defined( SHADOWMAP_TYPE_PCF )

		vec2 texelSize = vec2( 1.0 ) / shadowMapSize;

		// interleaved gradient noise -> a different disk rotation per pixel
		float ign = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
		float ang = 6.283185307 * ign;
		float ca = cos( ang ), sa = sin( ang );

		// --- 0. receiver-plane depth gradient, d(depth)/d(uv)
		vec3 sdx = vec3( dFdx( shadowCoord.xy ), dFdx( shadowCoord.z ) );
		vec3 sdy = vec3( dFdy( shadowCoord.xy ), dFdy( shadowCoord.z ) );
		float sdet = sdx.x * sdy.y - sdx.y * sdy.x;
		vec2 dzduv = vec2( 0.0 );
		if ( abs( sdet ) > 1e-14 ) {
			dzduv = vec2( sdy.y * sdx.z - sdx.y * sdy.z,
			              sdx.x * sdy.z - sdy.x * sdx.z ) / sdet;
		}
		// A silhouette pixel straddles two triangles and its derivatives are
		// meaningless, so cap how far the plane is allowed to run.
		const float RPDB_CAP = 0.02;
		const float RPDB_EPS = 0.00035;

		// --- 1. blocker search over the widest penumbra we are willing to draw
		float searchR = max( shadowRadius, 1.0 );
		float bSum = 0.0, bCount = 0.0;
		for ( int i = 0; i < 8; i ++ ) {

			float fi = float( i ) + 0.5;
			float rr = sqrt( fi * 0.125 );
			float th = fi * 2.399963229728653;
			vec2 d = vec2( cos( th ), sin( th ) ) * rr * searchR;
			d = vec2( d.x * ca - d.y * sa, d.x * sa + d.y * ca ) * texelSize;
			float zRef = shadowCoord.z + clamp( dot( dzduv, d ), - RPDB_CAP, RPDB_CAP );
			float z = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + d ) );
			// "closer to the light" is a larger depth value on a reversed buffer
			#ifdef USE_REVERSED_DEPTH_BUFFER
				if ( z > zRef + RPDB_EPS ) { bSum += z - zRef; bCount += 1.0; }
			#else
				if ( z < zRef - RPDB_EPS ) { bSum += zRef - z; bCount += 1.0; }
			#endif

		}

		// fully lit: no occluder anywhere in the search disk, skip the filter
		if ( bCount < 0.5 ) return 1.0;

		// --- 2. penumbra width from occluder height above the receiver
		float dz = max( bSum / bCount, 0.0 );
		float pen = clamp( ${base.toFixed(3)} + dz * ${growth.toFixed(2)}, ${base.toFixed(3)}, searchR );

		// --- 3. Vogel-disk PCF at that width, against the receiver plane
		float sum = 0.0;
		for ( int i = 0; i < 16; i ++ ) {

			float fi = float( i ) + 0.5;
			float rr = sqrt( fi * 0.0625 );              // uniform disk sampling
			float th = fi * 2.399963229728653;           // golden angle
			vec2 d = vec2( cos( th ), sin( th ) ) * rr * pen;
			d = vec2( d.x * ca - d.y * sa, d.x * sa + d.y * ca ) * texelSize;
			float zRef = shadowCoord.z + clamp( dot( dzduv, d ), - RPDB_CAP, RPDB_CAP );
			sum += texture2DCompare( shadowMap, shadowCoord.xy + d, zRef );

		}

		shadow = sum * 0.0625;

	`;

  THREE.ShaderChunk.shadowmap_pars_fragment = src.slice(0, a) + block + src.slice(b);
}
