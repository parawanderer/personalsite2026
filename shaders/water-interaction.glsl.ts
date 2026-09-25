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

// returns the gradient of the surface height (x, z); damp is 0 against a pillar and 1 in open water, rim 1 on the rim
vec2 pillarInteraction(vec2 p, out float damp, out float rim) {
    vec2 grad = vec2(0.0);
    float dMin = 1e3;
    rim = 0.0;

    vec2 cell = floor((p - pillarGridOrigin) / pillarCellSize + 0.5);
    // pillars can sit up to about a cell off their grid position (jitter plus lean), so look two cells around
    for (int dx = -2; dx <= 2; dx++) {
        for (int dz = -2; dz <= 2; dz++) {
            vec2 c = cell + vec2(float(dx), float(dz));
            if (c.x < 0.0 || c.y < 0.0 || c.x >= pillarGridSize.x || c.y >= pillarGridSize.y) continue;
            vec4 a = texelFetch(pillarDataA, ivec2(c), 0);
            if (a.w < 0.5) continue;
            vec4 b = texelFetch(pillarDataB, ivec2(c), 0);

            // distance to the (stretched) cross-section, as an ellipse
            vec2 rel = p - a.xy;
            vec2 u = b.xy;
            vec2 v = vec2(-u.y, u.x);
            float along = dot(rel, u) / b.z;
            float across = dot(rel, v);
            float len = max(length(vec2(along, across)), 1e-4);
            float d = max(len - a.z, 0.0);
            vec2 n = normalize(u * (along / b.z) + v * across);
            dMin = min(dMin, d);

            // meniscus, h = A exp(-d / w): rises towards the rock
            float em = exp(-d / meniscusWidth);
            grad -= meniscusHeight / meniscusWidth * em * n;
            rim = max(rim, em);

            // cushion in front, dip behind: h = -B (n . flow) exp(-d / sigma), with the dip stretched downstream
            float nv = dot(n, flowDir);
            float sigma = cushionWidth * mix(1.0, wakeStretch, max(nv, 0.0));
            float ec = exp(-d / sigma);
            vec2 dnv = (flowDir - nv * n) / len;
            grad -= cushionStrength * (dnv * ec - nv * ec / sigma * n);
        }
    }

    damp = smoothstep(0.0, rippleDampRadius, dMin);
    return grad;
}
`;

/**
 * Right after the water computes its surface normal
 */
export const interactionMain = /* glsl */ `
// (edits) ${fileName}
float pillarRim = 0.0;
float interactionFade = 1.0 - smoothstep(interactionDistance * 0.7, interactionDistance, length(eye - worldPosition.xyz));
if (interactionFade > 0.0) {
    float damp;
    float rim;
    vec2 grad = pillarInteraction(worldPosition.xz, damp, rim);
    surfaceNormal = normalize(mix(vec3(0.0, 1.0, 0.0), surfaceNormal, mix(1.0, damp, interactionFade)));
    surfaceNormal = normalize(surfaceNormal - vec3(grad.x, 0.0, grad.y) * interactionFade);
    pillarRim = rim * interactionFade;
}
`;
