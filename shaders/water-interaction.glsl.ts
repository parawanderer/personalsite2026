import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

/**
 * How the (thick, viscous) water meets the pillars, as surface normals on the flat water plane:
 * - a meniscus: the surface climbs the rock in a narrow lip, which gives a rim of light around each pillar
 * - a cushion: the flow piles up in front of a pillar and leaves a longer, shallow dip behind it
 * - ripples die down close to the rock, so the water is glassy against it
 *
 * Pillars come from the pillar field (environment/walls.ts), one texel per pillar grid cell. Only evaluated for water
 * closer than interactionDistance, since it can't be seen further away.
 *
 * Close to the camera a finely subdivided patch of water (WATER_PATCH) is actually displaced by the same height, scaled
 * up by displacementScale, and the flat water plane leaves a hole where the patch is.
 */
export const interactionPars = /* glsl */ `
// (edits) ${fileName}
uniform sampler2D pillarDataA;
uniform sampler2D pillarDataB;
uniform vec2 pillarGridOrigin;
uniform float pillarCellSize;
uniform vec2 pillarGridSize;
uniform vec2 flowDir;
uniform vec2 flowOffset;
uniform float rippleScale;
uniform float rippleAmp;
uniform float meniscusHeight;
uniform float meniscusWidth;
uniform float cushionStrength;
uniform float cushionWidth;
uniform float wakeStretch;
uniform float rippleDampRadius;
uniform vec3 rimColor;
uniform float rimStrength;
uniform float interactionDistance;
uniform vec2 patchCentre;
uniform float patchHalfSize;
uniform float displacementScale;
// beyond this distance from a pillar none of the effects are visible
uniform float interactionReach;

// returns (surface height, its gradient x, z); damp is 0 against a pillar and 1 in open water, rim 1 on the rim.
// lift is how much the height gets exaggerated where the surface is displaced: the raised lip meets the leaning pillar
// higher up, where its cross-section has moved along the lean, so distances are measured to the cross-section there
vec3 pillarSurface(vec2 p, float lift, out float damp, out float rim) {
    float h = 0.0;
    vec2 grad = vec2(0.0);
    float dMin = 1e3;
    rim = 0.0;

    damp = 1.0;
    vec2 cell = floor((p - pillarGridOrigin) / pillarCellSize + 0.5);
    // open water: skip the search when no pillar in reach
    if (cell.x >= 0.0 && cell.y >= 0.0 && cell.x < pillarGridSize.x && cell.y < pillarGridSize.y
            && texelFetch(pillarDataB, ivec2(cell), 0).w > interactionReach) {
        return vec3(0.0);
    }

    // pillars can sit up to about a cell off their grid position (jitter plus lean), so look two cells around
    for (int dx = -2; dx <= 2; dx++) {
        for (int dz = -2; dz <= 2; dz++) {
            vec2 c = cell + vec2(float(dx), float(dz));
            if (c.x < 0.0 || c.y < 0.0 || c.x >= pillarGridSize.x || c.y >= pillarGridSize.y) continue;
            vec4 a = texelFetch(pillarDataA, ivec2(c), 0);
            if (a.w < 0.5) continue;
            vec4 b = texelFetch(pillarDataB, ivec2(c), 0);

            // distance to the (stretched) cross-section, as an ellipse
            vec2 u = b.xy;
            vec2 v = vec2(-u.y, u.x);
            vec2 rel = p - a.xy;
            float along = dot(rel, u) / b.z;
            float across = dot(rel, v);
            float len = max(length(vec2(along, across)), 1e-4);
            float d = max(len - a.z, 0.0);

            // follow the pillar up to where the raised lip meets it: the cross-section there has moved along the lean
            // by tan(tilt) per unit of height (b.z = 1 / cos(tilt))
            float lipHeight = lift * meniscusHeight * exp(-d / meniscusWidth);
            rel -= u * sqrt(max(b.z * b.z - 1.0, 0.0)) * lipHeight;
            along = dot(rel, u) / b.z;
            across = dot(rel, v);
            len = max(length(vec2(along, across)), 1e-4);
            d = max(len - a.z, 0.0);
            vec2 n = normalize(u * (along / b.z) + v * across);
            dMin = min(dMin, d);

            // meniscus, h = A exp(-d / w): rises towards the rock
            float em = exp(-d / meniscusWidth);
            h += meniscusHeight * em;
            grad -= meniscusHeight / meniscusWidth * em * n;
            rim = max(rim, em);

            // cushion in front, dip behind: h = -B (n . flow) exp(-d / sigma), with the dip stretched downstream.
            // n flips across the pillar's centre, so fade it out inside the footprint (hidden in the rock, except where a
            // leaning pillar overhangs), which would otherwise jump between bulge and dip there
            float nv = dot(n, flowDir);
            float sigma = cushionWidth * mix(1.0, wakeStretch, max(nv, 0.0));
            float ec = exp(-d / sigma) * smoothstep(0.3 * a.z, a.z, len);
            vec2 dnv = (flowDir - nv * n) / len;
            h -= cushionStrength * nv * ec;
            grad -= cushionStrength * (dnv * ec - nv * ec / sigma * n);
        }
    }

    damp = smoothstep(0.0, rippleDampRadius, dMin);
    return vec3(h, grad);
}

uniform vec2 splashCenter;
uniform float splashAge;
uniform float splashRippleHeight;
uniform float splashRippleSpeed;
uniform float splashWavelength;
uniform float splashRippleSeconds;
uniform float splashCraterDepth;
uniform float splashCraterRadius;
uniform float splashCraterSeconds;
uniform vec3 splashGlow;
uniform float splashGlowRadius;

// rings spreading from a meteor impact: a wave packet travelling outwards, fading with time and distance,
// and the crater where it landed, which sinks, rebounds into a mound and settles over a few swings, only near the impact.
// Returns (height, gradient x, z)
vec3 splashRipple(vec2 p) {
    if (splashAge >= splashRippleSeconds) return vec3(0.0);
    vec2 d = p - splashCenter;
    float r = length(d);
    float x = r - splashAge * splashRippleSpeed;
    float packetWidth = splashWavelength * 1.5;
    float packet = exp(-x * x / (packetWidth * packetWidth));
    float fade = (1.0 - splashAge / splashRippleSeconds) / (1.0 + r * 1.5);
    float k = 6.2831853 / splashWavelength;
    float h = splashRippleHeight * packet * fade * cos(k * x);
    float dhdr = -splashRippleHeight * packet * fade * k * sin(k * x);

    float swing = splashAge / splashCraterSeconds;
    if (swing < 4.0) {
        float r2 = splashCraterRadius * splashCraterRadius;
        float bowl = exp(-r * r / r2);
        float c = splashCraterDepth * cos(6.2831853 * swing) * exp(-swing * 1.2) * smoothstep(4.0, 3.0, swing);
        h -= c * bowl;
        dhdr += c * bowl * 2.0 * r / r2;
    }

    vec2 g = r > 1e-4 ? d / r * dhdr : vec2(0.0);
    return vec3(h, g);
}

// 1 in the middle of the displaced patch, easing to 0 at its edges so it meets the flat plane seamlessly
float patchFade(vec2 p) {
    if (patchHalfSize <= 0.0) return 0.0;
    vec2 off = abs(p - patchCentre) / patchHalfSize;
    return 1.0 - smoothstep(0.7, 1.0, max(off.x, off.y));
}

bool insidePatch(vec2 p) {
    vec2 off = abs(p - patchCentre);
    return patchHalfSize > 0.0 && max(off.x, off.y) < patchHalfSize;
}
`;

/**
 * Replaces the start of the water's vertex shader main(): lifts the patch's vertices by the pillar height
 */
export const displacedVertex = /* glsl */ `
// (edits) ${fileName}
vec4 displaced = modelMatrix * vec4( position, 1.0 );
#ifdef WATER_PATCH
    float unusedDamp;
    float unusedRim;
    float lift = displacementScale * patchFade(displaced.xz);
    displaced.y += pillarSurface(displaced.xz, lift, unusedDamp, unusedRim).x * lift;
    displaced.y += splashRipple(displaced.xz).x * patchFade(displaced.xz);
#endif
mirrorCoord = displaced;
worldPosition = displaced;
mirrorCoord = textureMatrix * mirrorCoord;
vec4 mvPosition = viewMatrix * displaced;
`;

/**
 * Right after the water computes its surface normal
 */
export const interactionMain = /* glsl */ `
// (edits) ${fileName}
#ifdef WATER_PATCH
    float heightScale = mix(1.0, displacementScale, patchFade(worldPosition.xz));
#else
    if (insidePatch(worldPosition.xz)) discard;
    float heightScale = 1.0;
#endif

// meteor ripples, near or far
vec3 splashWaves = splashRipple(worldPosition.xz);
surfaceNormal = normalize(surfaceNormal - vec3(splashWaves.y, 0.0, splashWaves.z));

float pillarRim = 0.0;
float interactionFade = 1.0 - smoothstep(interactionDistance * 0.7, interactionDistance, length(eye - worldPosition.xyz));
if (interactionFade > 0.0) {
    float damp;
    float rim;
    vec2 grad = pillarSurface(worldPosition.xz, heightScale, damp, rim).yz * heightScale;
    surfaceNormal = normalize(mix(vec3(0.0, 1.0, 0.0), surfaceNormal, mix(1.0, damp, interactionFade)));
    surfaceNormal = normalize(surfaceNormal - vec3(grad.x, 0.0, grad.y) * interactionFade);
    pillarRim = rim * interactionFade;
}
`;
