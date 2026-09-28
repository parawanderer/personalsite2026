import { IUniform } from "three";

import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

/** 1 while the camera is under the water, when what's above it is seen bent through the surface (main.ts) */
export const snellUniforms: { [name: string]: IUniform } = {
    snellOn: { value: 0 },
};

/**
 * Looking up from under the water, the whole sky shows in a disc overhead (Snell's window): light from the air bends
 * steeper as it enters the water (index 1.33), so light from the horizon arrives about 49 degrees from straight up.
 * snellAirDir takes a direction looked along under the water to the one in the air the light came from, for anything
 * drawn by direction (the stars, aurora, volcano glow on the sky); snellThrough is 0 past the window's edge, where
 * nothing from the sky comes through. Guarded, so several edits of one shader can include it.
 */
export const snellPars = /* glsl */ `
#ifndef SNELL_PARS
#define SNELL_PARS
// (edits) ${fileName}
uniform float snellOn;
vec3 snellAirDir(vec3 seen) {
    if (snellOn < 0.5 || seen.y <= 0.0) return seen;
    float across = length(seen.xz);
    float sinAir = min(across * 1.33, 1.0);
    vec2 level = across > 1e-5 ? seen.xz / across * sinAir : vec2(0.0);
    return vec3(level.x, sqrt(1.0 - sinAir * sinAir), level.y);
}

// 1 where light from the sky comes through, 0 past the window's edge (under the water)
float snellThrough(vec3 seen) {
    return snellOn < 0.5 || seen.y > 0.0 && length(seen.xz) * 1.33 < 1.0 ? 1.0 : 0.0;
}
#endif
`;
