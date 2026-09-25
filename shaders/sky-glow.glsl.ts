import { Color, IUniform, Vector3 } from "three";

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
};

export const skyGlowPars = /* glsl */ `
// (edits) ${fileName}
uniform vec3 glowSunDirection[${SUN_COUNT}];
uniform vec3 glowSunRadiance[${SUN_COUNT}];
uniform float glowSunRadius[${SUN_COUNT}];
uniform float glowSunHaloScale[${SUN_COUNT}];
uniform float glowSunHaloStrength[${SUN_COUNT}];

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
    gl_FragColor.rgb += skyGlow(normalize(vFogWorldPosition - cameraPosition)) * fogFactor;
`;
