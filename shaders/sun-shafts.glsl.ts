import { Color, DataTexture, IUniform, Matrix4, Vector2, Vector3 } from "three";

import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

/** how many cells back from the channel's edge the walls' height profile reaches (environment/walls.ts) */
export const WALL_PROFILE_CELLS = 16;

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
    // the canyon's walls, from the real pillars: per row along the channel, the x of its left and right edge and the
    // height of the tallest pillar top at each cell back from them (Walls.wallProfile)
    shaftWallProfile: { value: new DataTexture(new Float32Array(4), 1, 1) },
    shaftWallOriginZ: { value: 0 },
    shaftWallCell: { value: 1 },
    shaftWallRows: { value: 0 },
    // 1: the walls block the light as they stand, 0: not at all
    shaftWallBlocking: { value: 1 },
    // per sun, a map from its (bent) light of which channel pillar piece is where near the camera (plus one, 0: none),
    // and world to that map; the pieces' table, and their outline's chamfer (environment/shaft-shadows.ts);
    // shaftShadowOn 0 while there are none
    shaftShadowMap0: { value: null },
    shaftShadowMap1: { value: null },
    shaftShadowMatrix: { value: Array.from({ length: SHAFT_LIGHTS }, () => new Matrix4()) },
    shaftShadowOn: { value: 0 },
    shaftPillarPieces: { value: null },
    shaftPillarChamfer: { value: 0 },
    // the walls' blocking, worked out once per frame over the channel's surface (per sun in r and g) by
    // environment/shaft-shadows.ts from shaftPastWallsTraced, and looked up from there: x, z of its corner and its size
    shaftWallMask: { value: null },
    shaftWallMaskCorner: { value: new Vector2() },
    shaftWallMaskSize: { value: new Vector2(1, 1) },
    shaftWallMaskOn: { value: 0 },
    // the sun glittering on the surface seen from below: brightness, how far from the sun's place the glints reach
    // (1 - cosine of the angle)
    shaftGlitterStrength: { value: 1 },
    shaftGlitterSpread: { value: 0.02 },
    // how much more the ripples tilt the glints than the view through the window
    shaftGlitterRipple: { value: 1 },
    // how much finer the ripples that make the glints are than those that bend the view (shaders/water-underside.glsl.ts)
    shaftGlitterScale: { value: 1 },
    // looking towards a sun in the water: how much brighter its shafts get, the haze around it, and how far from its
    // direction that reaches (1 - cosine of the angle)
    shaftForwardShafts: { value: 0 },
    shaftForwardHaze: { value: 0 },
    shaftForwardSpread: { value: 0.1 },
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
uniform sampler2D shaftWallProfile;
uniform float shaftWallOriginZ;
uniform float shaftWallCell;
uniform float shaftWallRows;
uniform float shaftWallBlocking;
uniform sampler2D shaftShadowMap0;
uniform sampler2D shaftShadowMap1;
uniform mat4 shaftShadowMatrix[${SHAFT_LIGHTS}];
uniform float shaftShadowOn;
uniform sampler2D shaftPillarPieces;
uniform float shaftPillarChamfer;
uniform sampler2D shaftWallMask;
uniform vec2 shaftWallMaskCorner;
uniform vec2 shaftWallMaskSize;
uniform float shaftWallMaskOn;
uniform float shaftGlitterStrength;
uniform float shaftGlitterSpread;
uniform float shaftGlitterRipple;
uniform float shaftGlitterScale;
uniform float shaftForwardShafts;
uniform float shaftForwardHaze;
uniform float shaftForwardSpread;

// whether the light's path from p towards the sun (along d) passes through pillar piece i, taken as a cylinder (its
// hexagon's shadow is within about a centimetre of a round one's, and a cylinder is cheaper to test): the path clipped
// between its ends, then to within its radius of its axis
bool shaftHitsPiece(vec3 p, vec3 d, int i) {
    vec4 centre = texelFetch(shaftPillarPieces, ivec2(0, i), 0);
    // its axis, and half its length
    vec4 axis = texelFetch(shaftPillarPieces, ivec2(1, i), 0);
    vec3 o = p - centre.xyz;
    float s = dot(o, axis.xyz);
    float v = dot(d, axis.xyz);
    // from a little past p, so a pillar's face doesn't shadow itself
    float near = 0.01;
    float far = 1e4;
    if (abs(v) < 1e-6) {
        if (abs(s) > axis.w) return false;
    } else {
        float t1 = (-axis.w - s) / v;
        float t2 = (axis.w - s) / v;
        near = max(near, min(t1, t2));
        far = min(far, max(t1, t2));
    }
    // between the hexagon's inner and outer radius
    float radius = centre.w * mix(0.8660254, 1.0 - shaftPillarChamfer * 0.5, 0.5);
    vec3 oAcross = o - s * axis.xyz;
    vec3 dAcross = d - v * axis.xyz;
    float a = dot(dAcross, dAcross);
    float b = dot(oAcross, dAcross);
    float c = dot(oAcross, oAcross) - radius * radius;
    // starting inside it: p is on this pillar's own surface (the round shape bulges past its flat faces), which doesn't
    // shadow itself
    if (c <= 0.0 && abs(s) <= axis.w) return false;
    if (a < 1e-8) return false;
    float disc = b * b - a * c;
    if (disc < 0.0) return false;
    float root = sqrt(disc);
    near = max(near, (-b - root) / a);
    far = min(far, (-b + root) / a);
    return near <= far;
}

// the piece (plus one; negative near an edge) and its depth at a texel of sun k's map
vec2 shaftPieceAt(ivec2 texel, int k) {
    return k == 0 ? texelFetch(shaftShadowMap0, texel, 0).rg : texelFetch(shaftShadowMap1, texel, 0).rg;
}

// a texel's piece plus one (0: none), whether it's marked as near an edge or not
float shaftPieceOf(float r) {
    return r >= 0.0 ? r : -r - 1.0;
}

// whether a channel pillar stands between p and sun k (on its light's path through the water). Away from a shadow's
// edge, the map's nearest texel says which piece is there, and comparing depths is enough. Near one, the pieces of the
// four texels nearest are each tested as they're shaped, so the edge is sharp and straight however coarse the map
float shaftPastPillars(vec3 p, int k) {
    if (shaftShadowOn < 0.5) return 1.0;
    vec4 c = shaftShadowMatrix[k] * vec4(p, 1.0);
    vec2 uv = c.xy * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
    ivec2 size = k == 0 ? textureSize(shaftShadowMap0, 0) : textureSize(shaftShadowMap1, 0);
    vec2 texel = uv * vec2(size);
    vec2 nearest = shaftPieceAt(min(ivec2(texel), size - 1), k);
    if (nearest.x >= 0.0) return nearest.x == 0.0 || c.z * 0.5 + 0.5 - 0.0004 <= nearest.y ? 1.0 : 0.0;
    ivec2 base = clamp(ivec2(floor(texel - 0.5)), ivec2(0), size - 2);
    float a = shaftPieceOf(shaftPieceAt(base, k).x);
    float b = shaftPieceOf(shaftPieceAt(base + ivec2(1, 0), k).x);
    float e = shaftPieceOf(shaftPieceAt(base + ivec2(0, 1), k).x);
    float f = shaftPieceOf(shaftPieceAt(base + ivec2(1, 1), k).x);
    vec3 d = shaftLightDir[k];
    if (a > 0.0 && shaftHitsPiece(p, d, int(a) - 1)) return 0.0;
    if (b > 0.0 && b != a && shaftHitsPiece(p, d, int(b) - 1)) return 0.0;
    if (e > 0.0 && e != a && e != b && shaftHitsPiece(p, d, int(e) - 1)) return 0.0;
    if (f > 0.0 && f != a && f != b && f != e && shaftHitsPiece(p, d, int(f) - 1)) return 0.0;
    return 1.0;
}

vec4 shaftWallRow(float z) {
    float row = floor((z - shaftWallOriginZ) / shaftWallCell + 0.5);
    if (row < 0.0 || row >= shaftWallRows) return vec4(-1e4, 1e4, 0.0, 0.0);
    return texelFetch(shaftWallProfile, ivec2(0, int(row)), 0);
}

// whether sunlight coming in at q (x, z on the surface) got past the walls: followed back towards the sun, across the
// wall on that side, cell by cell, it has to stay above the tallest pillar top there (in the row it's crossing, since
// the path runs along the channel too). Soft, since the tops are ragged. Light coming in beyond the wall's inner face
// (under its pillars) never gets through
float shaftPastWallsTraced(vec2 q, vec3 toSun) {
    if (shaftWallBlocking <= 0.0 || shaftWallRows <= 0.0 || abs(toSun.x) < 1e-4) return 1.0;
    vec4 edges = shaftWallRow(q.y);
    bool right = toSun.x > 0.0;
    float across = right ? edges.y - q.x : q.x - edges.x;
    if (across <= 0.0) return 0.0;
    float perX = 1.0 / abs(toSun.x);
    float lit = 1.0;
    for (int k = 0; k < ${WALL_PROFILE_CELLS}; k++) {
        float s = across + (float(k) + 0.5) * shaftWallCell;
        float row = floor((q.y + toSun.z * perX * s - shaftWallOriginZ) / shaftWallCell + 0.5);
        if (row < 0.0 || row >= shaftWallRows) continue;
        vec4 heights = texelFetch(shaftWallProfile, ivec2(k + 1, int(row)), 0);
        float wall = (right ? heights.g : heights.r) * shaftWallBlocking;
        lit = min(lit, smoothstep(wall - 0.3, wall + 0.3, s * toSun.y * perX));
        if (lit <= 0.0) break;
    }
    return lit;
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
// the walls' blocking at q, from the map worked out this frame
float shaftPastWalls(vec2 q, int k) {
    if (shaftWallMaskOn < 0.5) return 1.0;
    vec2 uv = (q - shaftWallMaskCorner) / shaftWallMaskSize;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
    vec4 m = texture2D(shaftWallMask, uv);
    return k == 0 ? m.r : m.g;
}

// 'view' (the direction looked along, for the light in the water; zero for a surface) adds the forward scattering: the
// water's specks bend light only a little, so looking towards a sun, along its shafts, they're brighter, in a haze
// that also stands for all the shafts too thin to show.
vec3 shaftLightWeighted(vec3 p, float below, vec3 normal, bool onSurface, vec3 view) {
    vec3 light = vec3(0.0);
    for (int k = 0; k < ${SHAFT_LIGHTS}; k++) {
        if (shaftLightColor[k].r + shaftLightColor[k].g + shaftLightColor[k].b <= 0.0) continue;
        float facing = onSurface ? max(dot(normal, shaftLightDir[k]), 0.0) : 1.0;
        if (facing <= 0.0) continue;
        float forward = onSurface ? 0.0 : exp(-(1.0 - dot(view, shaftLightDir[k])) / shaftForwardSpread);
        // up along the light to where it came through the surface
        vec2 q = p.xz + shaftLightDir[k].xz / max(shaftLightDir[k].y, 0.2) * below;
        float patches = shaftSurfaceLight(q, k) * (1.0 + shaftForwardShafts * forward) + shaftForwardHaze * forward;
        light += shaftLightColor[k] * patches * facing * shaftPastWalls(q, k) * shaftPastPillars(p, k);
    }
    return light * exp(-below * shaftDepthFade);
}

vec3 shaftLight(vec3 p, float below, vec3 view) {
    return shaftLightWeighted(p, below, vec3(0.0, 1.0, 0.0), false, view);
}

vec3 shaftLightOn(vec3 p, float below, vec3 normal) {
    return shaftLightWeighted(p, below, normal, true, vec3(0.0));
}

// the sun glittering on the surface seen from below, at point p where its (rippled) normal is 'normal', looked at along
// 'view': a wave facet flashes where it bends a sun's light straight at the eye, so the glints crowd around where the
// sun shows through the window and follow the ripples. Brightest on the patches that let the shafts through (they start
// there), fainter between them, and not where the walls or pillars keep the sun off the surface
vec3 shaftGlitter(vec3 p, vec3 view, vec3 normal) {
    vec3 light = vec3(0.0);
    if (shaftGlitterStrength <= 0.0) return light;
    // the ripples tilted further than they show: bent through the surface, their small tilts would barely move the glints
    vec3 facet = normalize(vec3(normal.x * shaftGlitterRipple, normal.y, normal.z * shaftGlitterRipple));
    for (int k = 0; k < ${SHAFT_LIGHTS}; k++) {
        if (shaftLightColor[k].r + shaftLightColor[k].g + shaftLightColor[k].b <= 0.0) continue;
        // the sun's light as this facet bends it into the water, and how close that comes to straight at the eye
        vec3 bent = refract(-shaftSunDir[k], facet, 1.0 / 1.33);
        float lobe = exp(-(1.0 - max(dot(view, -bent), 0.0)) / shaftGlitterSpread);
        if (lobe < 0.002) continue;
        float patches = mix(0.3, 1.0, shaftSurfaceLight(p.xz, k));
        light += shaftLightColor[k] * lobe * patches * shaftPastWalls(p.xz, k) * shaftPastPillars(p, k);
    }
    return light * shaftGlitterStrength;
}
`;
