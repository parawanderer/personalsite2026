import { ClassicPerlin3DNoise } from "./noise.glsl";
import { toFileName } from "./util";
import { skyGlowFrag, skyGlowPars } from "./sky-glow.glsl";

const fileName = toFileName(import.meta.url);

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
    vFogWorldPosition = (modelMatrix * vec4(position.xyz, 1.0)).xyz;
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

    float fogNoise = cnoise(fogNoiseFreq * scrollingPos.xyz);
    float vEditedFogDepth = vFogDepth - fogNoiseImpact * fogNoise * vFogDepth;
    // END new

    #ifdef FOG_EXP2

        float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vEditedFogDepth * vEditedFogDepth );

    #else

        float fogFactor = smoothstep( fogNear, fogFar, vEditedFogDepth );

    #endif

    gl_FragColor.rgb = mix( gl_FragColor.rgb, mix(fogNearColor, fogFarColor, fogFactor), fogFactor );
    // new! (edits) ${fileName}
    // and as opaque as the fog is thick: the surface is see-through (the seabed shows where it's clear), and without
    // this the far water let the dark seabed through its ripples instead of fading into the haze like the pillars do
    gl_FragColor.a = mix(gl_FragColor.a, 1.0, fogFactor);
    // END new
${skyGlowFrag}

#endif
`;