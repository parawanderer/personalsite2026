import { Color, IUniform, Vector2, Vector3 } from "three";

import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

/** how many suns can shine down into the water */
export const SHAFT_LIGHTS = 2;

/**
 * The sunlight that reaches under the water: bright patches let through by the surface's waves, carried straight down
 * along each sun's light (bent steeper by the water). Shared by the shafts seen in the water (postprocessing/god-rays.ts)
 * and the light they cast on what they hit (shaders/underwater.glsl.ts), so the two always line up. Kept up to date by
 * the god rays pass; a light's colour is black while it's off.
 */
export const shaftUniforms: { [name: string]: IUniform } = {
    shaftLightDir: { value: Array.from({ length: SHAFT_LIGHTS }, () => new Vector3(0, 1, 0)) },
    // towards each sun in the air (unbent), for the walls blocking it
    shaftSunDir: { value: Array.from({ length: SHAFT_LIGHTS }, () => new Vector3(0, 1, 0)) },
    shaftLightColor: { value: Array.from({ length: SHAFT_LIGHTS }, () => new Color(0, 0, 0)) },
    shaftTime: { value: 0 },
    shaftFlow: { value: new Vector2() },
    shaftScale: { value: 1 },
    shaftSharpness: { value: 2.5 },
    shaftDepthFade: { value: 0.3 },
    // how brightly they light the surfaces they fall on
    shaftOnSurfaces: { value: 1 },
    // the canyon's walls as two long upright planes: x of the left and right one, and how high above the water they
    // block the light (0: not at all)
    shaftWallLeft: { value: -10 },
    shaftWallRight: { value: 10 },
    shaftWallHeight: { value: 0 },
};

export const shaftPars = /* glsl */ `
// (edits) ${fileName}
uniform vec3 shaftLightDir[${SHAFT_LIGHTS}];
uniform vec3 shaftLightColor[${SHAFT_LIGHTS}];
uniform vec3 shaftSunDir[${SHAFT_LIGHTS}];
uniform float shaftTime;
uniform vec2 shaftFlow;
uniform float shaftScale;
uniform float shaftSharpness;
uniform float shaftDepthFade;
uniform float shaftOnSurfaces;
uniform float shaftWallLeft;
uniform float shaftWallRight;
uniform float shaftWallHeight;

// whether sunlight coming in at q (on the surface) got past the walls: followed back towards the sun, it crosses the
// wall on that side at some height above the water, and gets through only above the wall's top (soft, since the real
// walls' tops are ragged). The walls are solid from their inner face outwards, so light coming in beyond that face
// (under the wall's pillars) never gets through
float shaftPastWalls(vec2 q, vec3 toSun) {
    if (shaftWallHeight <= 0.0 || abs(toSun.x) < 1e-4) return 1.0;
    float across = toSun.x > 0.0 ? shaftWallRight - q.x : q.x - shaftWallLeft;
    // at or past the wall on the sun's side: the light would come in under its rock, which blocks it all the way up
    if (across <= 0.0) return 0.0;
    float heightAtWall = across / abs(toSun.x) * toSun.y;
    return smoothstep(shaftWallHeight - 0.5, shaftWallHeight + 0.5, heightAtWall);
}

float shaftHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float shaftNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(shaftHash(i), shaftHash(i + vec2(1.0, 0.0)), f.x), mix(shaftHash(i + vec2(0.0, 1.0)), shaftHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// the light the surface lets through at a point on it: only the brightest patches, so the shafts stay apart instead of
// blending into a haze. Each sun gets its own pattern, so their shafts don't line up
float shaftSurfaceLight(vec2 q, int k) {
    q = (q - shaftFlow) * shaftScale + float(k) * 37.0;
    float t = shaftTime;
    float n = 0.65 * shaftNoise(q + vec2(t * 0.21, t * 0.13)) + 0.35 * shaftNoise(q * 2.3 - vec2(t * 0.17, t * 0.29));
    float cut = 1.0 - 0.5 / shaftSharpness;
    return smoothstep(cut, cut + 0.12, n);
}

// all the suns' light reaching point p, which is 'below' under the surface; each weighted by 'facing' (1 for the
// light in the water itself, how directly a surface faces that sun for the light on it)
vec3 shaftLightWeighted(vec3 p, float below, vec3 normal, bool onSurface) {
    vec3 light = vec3(0.0);
    for (int k = 0; k < ${SHAFT_LIGHTS}; k++) {
        if (shaftLightColor[k].r + shaftLightColor[k].g + shaftLightColor[k].b <= 0.0) continue;
        float facing = onSurface ? max(dot(normal, shaftLightDir[k]), 0.0) : 1.0;
        if (facing <= 0.0) continue;
        // up along the light to where it came through the surface
        vec2 q = p.xz + shaftLightDir[k].xz / max(shaftLightDir[k].y, 0.2) * below;
        light += shaftLightColor[k] * shaftSurfaceLight(q, k) * facing * shaftPastWalls(q, shaftSunDir[k]);
    }
    return light * exp(-below * shaftDepthFade);
}

vec3 shaftLight(vec3 p, float below) {
    return shaftLightWeighted(p, below, vec3(0.0, 1.0, 0.0), false);
}

vec3 shaftLightOn(vec3 p, float below, vec3 normal) {
    return shaftLightWeighted(p, below, normal, true);
}
`;
