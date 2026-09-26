import { ClassicPerlin3DNoise } from "./noise.glsl";
import { toFileName } from "./util";
import { skyGlowFrag, skyGlowPars } from "./sky-glow.glsl";

const fileName = toFileName(import.meta.url);

// WATER for some reason has a very specific setup...

/**
 * Tracks: https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/fog_pars_vertex.glsl.js
 */
export const fogParsVert = /* glsl */ `
#ifdef USE_FOG

	varying float vFogDepth;

    // new! (edits) ${fileName}
    varying vec3 vFogWorldPosition;
    // END new

#endif
`;

/**
 * Tracks: https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/fog_vertex.glsl.js
 */
export const fogVert = /* glsl */ `
#ifdef USE_FOG

	vFogDepth = -mvPosition.z;

    // new! (edits) ${fileName}
    vFogWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
    // END new

#endif
`;


/**
 * Tracks: https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/fog_pars_fragment.glsl.js
 */
export const fogParsFrag = /* glsl */ `
#ifdef USE_FOG

    ${ClassicPerlin3DNoise}
    ${skyGlowPars}

	uniform vec3 fogColor;
    varying float vFogDepth;

    // new! (edits) ${fileName}
    uniform vec3 fogNearColor;
    uniform vec3 fogFarColor;
    varying vec3 vFogWorldPosition;
    uniform float fogNoiseFreq;
    uniform float fogNoiseImpact;
    uniform float fogNoiseSpeed;
    uniform float fogTime;
    // 1 above the water, 0 while the camera is under it: then only the stretch of each view ray above the water surface
    // (fogWaterLevel) is in air and gets this fog; the water's own fog covers the rest
    uniform float fogAmount;
    uniform float fogWaterLevel;
    // END new

	#ifdef FOG_EXP2

		uniform float fogDensity;

	#else

		uniform float fogNear;
		uniform float fogFar;

	#endif

#endif
`;

/**
 * Tracks: https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/fog_fragment.glsl.js
 */
export const fogFrag = /* glsl */ `
#ifdef USE_FOG

    // new! (edits) ${fileName}
    vec3 windDir = vec3(0.0, 0.0, fogTime);
    vec3 scrollingPos = vFogWorldPosition.xyz + fogNoiseSpeed * windDir;

    float noise = cnoise(fogNoiseFreq * scrollingPos.xyz);
    float vEditedFogDepth = vFogDepth - fogNoiseImpact * noise * vFogDepth;
    // END new

	#ifdef FOG_EXP2

		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vEditedFogDepth * vEditedFogDepth );

	#else

		float fogFactor = smoothstep( fogNear, fogFar, vEditedFogDepth );

	#endif

	if (fogAmount < 0.5) {
		float rise = vFogWorldPosition.y - cameraPosition.y;
		float inAir = vFogWorldPosition.y > fogWaterLevel && rise > 1e-4 ? (vFogWorldPosition.y - fogWaterLevel) / rise : 0.0;
		float airDepth = vEditedFogDepth * inAir;
		#ifdef FOG_EXP2
			fogFactor = 1.0 - exp( - fogDensity * fogDensity * airDepth * airDepth );
		#else
			fogFactor = smoothstep( fogNear, fogFar, airDepth );
		#endif
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, mix(fogNearColor, fogFarColor, fogFactor), fogFactor );
${skyGlowFrag}

#endif
`;