import { IUniform, WebGLProgramParametersWithUniforms } from "three";

import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

/**
 * snellOn: 1 while the camera is under the water, when what's above it is seen bent through the surface; and the
 * surface's height (both kept by main.ts)
 */
export const snellUniforms: { [name: string]: IUniform } = {
    snellOn: { value: 0 },
    snellWaterLevel: { value: 0 },
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
uniform float snellWaterLevel;

// where point p above the water is seen from the camera under it: its light crosses the surface where the two legs of
// its path obey Snell's law (found by halving the interval), and it's seen along the underwater leg, at its own
// distance so what's nearer still hides what's further
vec3 snellBend(vec3 p) {
    vec3 eye = cameraPosition;
    float depth = snellWaterLevel - eye.y;
    float height = p.y - snellWaterLevel;
    vec2 across = p.xz - eye.xz;
    float reach = length(across);
    if (depth <= 0.0 || height <= 0.0 || reach < 1e-4) return p;
    float lo = 0.0;
    float hi = reach;
    for (int i = 0; i < 16; i++) {
        float r = 0.5 * (lo + hi);
        float rest = reach - r;
        // sine in the water times the index, against the sine in the air
        if (1.33 * r / sqrt(r * r + depth * depth) > rest / sqrt(rest * rest + height * height)) hi = r; else lo = r;
    }
    float r = 0.5 * (lo + hi);
    vec3 seen = normalize(vec3(across.x / reach * r, depth, across.y / reach * r));
    return eye + seen * length(p - eye);
}
#endif
`;

/**
 * A material's vertices above the water drawn where they're seen from under it (snellBend), while the camera is there.
 * Only where they land on screen changes: lighting and fog still use where they really are. Geometry crossing the
 * surface needs a vertex at the waterline, or its part below would be dragged along.
 */
export const applySnellBend = (params: WebGLProgramParametersWithUniforms): void => {
    Object.assign(params.uniforms, snellUniforms);
    params.vertexShader = params.vertexShader
        .replace('#include <common>', `#include <common>\n${snellPars}`)
        .replace('#include <project_vertex>', `#include <project_vertex>
if (snellOn > 0.5) {
    vec4 snellWorld = modelMatrix * vec4(transformed, 1.0);
    if (snellWorld.y > snellWaterLevel) gl_Position = projectionMatrix * viewMatrix * vec4(snellBend(snellWorld.xyz), 1.0);
}`);
};
