import { Color, IUniform, Vector3 } from "three";

import { nightGlowPars, nightGlowUniforms } from "./night-glow.glsl";
import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

export const SUN_COUNT = 2;

/**
 * The suns as seen through the fog: heavily fogged surfaces (the far water, distant walls) show the same disc and halo
 * the sky has in that direction, so the suns shine through the haze instead of being cut off by it.
 * Shared by the fog shaders; environment/celestial.ts keeps the values up to date.
 */
export const skyGlowUniforms: { [name: string]: IUniform } = {
    glowSunDirection: { value: Array.from({ length: SUN_COUNT }, () => new Vector3(0, -1, 0)) },
    // colour times brightness times how far it's risen, 0 while it's down
    glowSunRadiance: { value: Array.from({ length: SUN_COUNT }, () => new Color(0, 0, 0)) },
    // angular radius of the disc, radians
    glowSunRadius: { value: Array.from({ length: SUN_COUNT }, () => 0.01) },
    glowSunHaloScale: { value: Array.from({ length: SUN_COUNT }, () => 1) },
    glowSunHaloStrength: { value: Array.from({ length: SUN_COUNT }, () => 0) },
    // how fogged a surface has to be before the suns show through it: below this it blocks them like any surface
    glowFogStart: { value: 0.9 },
    // the volcano's red glow low on one horizon at night (environment/volcanic-glow.ts): which way it lies, its colour
    // times how strongly the fog takes it on (black by day), and how wide and high it reaches (radians, direction's y)
    glowVolcanoDir: { value: new Vector3(0, 0, -1) },
    glowVolcanoColor: { value: new Color(0, 0, 0) },
    glowVolcanoWidth: { value: 0.4 },
    glowVolcanoHeight: { value: 0.1 },
    // the same for the warm glow around a setting or rising sun (environment/twilight.ts)
    glowTwilightDir: { value: new Vector3(0, 0, -1) },
    glowTwilightColor: { value: new Color(0, 0, 0) },
    glowTwilightWidth: { value: 0.5 },
    glowTwilightHeight: { value: 0.15 },
    // and the night sky's faint glows (shaders/night-glow.glsl.ts)
    ...nightGlowUniforms,
};

export const skyGlowPars = /* glsl */ `
${nightGlowPars}
// (edits) ${fileName}
uniform vec3 glowSunDirection[${SUN_COUNT}];
uniform vec3 glowSunRadiance[${SUN_COUNT}];
uniform float glowSunRadius[${SUN_COUNT}];
uniform float glowSunHaloScale[${SUN_COUNT}];
uniform float glowSunHaloStrength[${SUN_COUNT}];
uniform float glowFogStart;
uniform vec3 glowVolcanoDir;
uniform vec3 glowVolcanoColor;
uniform float glowVolcanoWidth;
uniform float glowVolcanoHeight;

uniform vec3 glowTwilightDir;
uniform vec3 glowTwilightColor;
uniform float glowTwilightWidth;
uniform float glowTwilightHeight;

// a glow low on the horizon in one direction, as the fog picks it up: widest and strongest towards it near the
// horizon, fading upwards and twice as fast downwards (the far water lies just below)
vec3 horizonFogGlow(vec3 viewDir, vec3 towards, vec3 color, float width, float height) {
    vec2 flatDir = normalize(viewDir.xz + vec2(1e-5));
    float across = acos(clamp(dot(flatDir, normalize(towards.xz + vec2(1e-5))), -1.0, 1.0));
    return color * exp(-pow(across / width, 2.0)) * exp(-max(viewDir.y, -2.0 * viewDir.y) / height);
}

// the volcano's glow as the fog picks it up: widest and strongest towards it near the horizon, fading upwards and
// twice as fast downwards (the far water lies just below)
vec3 volcanoFogGlow(vec3 viewDir) {
    vec2 flatDir = normalize(viewDir.xz + vec2(1e-5));
    float across = acos(clamp(dot(flatDir, normalize(glowVolcanoDir.xz)), -1.0, 1.0));
    return glowVolcanoColor * exp(-pow(across / glowVolcanoWidth, 2.0)) * exp(-max(viewDir.y, -2.0 * viewDir.y) / glowVolcanoHeight);
}

// same disc and halo as the sun sprites (environment/celestial.ts), by the angle from each sun
vec3 skyGlow(vec3 viewDir) {
    vec3 glow = vec3(0.0);
    for (int i = 0; i < ${SUN_COUNT}; i++) {
        float angle = acos(clamp(dot(viewDir, glowSunDirection[i]), -1.0, 1.0));
        float r = angle / glowSunRadius[i];
        float disc = 1.0 - smoothstep(0.96, 1.0, r);
        float halo = glowSunHaloStrength[i] * exp(-max(r - 1.0, 0.0) * 3.0) * (1.0 - smoothstep(glowSunHaloScale[i] * 0.8, glowSunHaloScale[i], r));
        glow += glowSunRadiance[i] * (disc + halo * (1.0 - disc));
    }
    return glow;
}
`;

/**
 * After the fog colour is mixed in; fogFactor and vFogWorldPosition come from the fog edits
 */
export const skyGlowFrag = /* glsl */ `
    // (edits) ${fileName}
    gl_FragColor.rgb += skyGlow(normalize(vFogWorldPosition - cameraPosition)) * smoothstep(glowFogStart, 1.0, fogFactor);
    // and the fog towards the volcano at night takes on its red, as thick as the fog is
    if (glowVolcanoColor.r + glowVolcanoColor.g + glowVolcanoColor.b > 0.0) gl_FragColor.rgb += volcanoFogGlow(normalize(vFogWorldPosition - cameraPosition)) * fogFactor;
    // and towards a setting or rising sun, its warm glow
    // the night sky's faint glows, which the fog fades into like the sky
    gl_FragColor.rgb += nightGlow(normalize(vFogWorldPosition - cameraPosition)) * fogFactor;
    if (glowTwilightColor.r + glowTwilightColor.g + glowTwilightColor.b > 0.0) gl_FragColor.rgb += horizonFogGlow(normalize(vFogWorldPosition - cameraPosition), glowTwilightDir, glowTwilightColor, glowTwilightWidth, glowTwilightHeight) * fogFactor;
`;
