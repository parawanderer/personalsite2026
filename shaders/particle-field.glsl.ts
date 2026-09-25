import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

/**
 * Where a particle is right now, computed from its seed and the time only (no per-particle state on the CPU).
 * Particles live in a box around the camera that wraps, so wherever the camera goes there are particles around it.
 * Shared by the flakes (near) and the dots (far), so both always agree on where each particle is.
 */
export const particleFieldPars = /* glsl */ `
// (edits) ${fileName}
attribute vec4 particleSeed;

uniform float particleTime;
uniform vec3 particleCamera;
uniform float particleBoxSize;
uniform float particleFall;
uniform float particleSway;
uniform float particleWaterY;
uniform vec2 particleFlow;
uniform float particleFloatTime;
uniform float particleSinkSpeed;
uniform float particleSinkDepth;
uniform float flakeNear;
uniform float flakeBand;

// the pillar field (environment/walls.ts): where each pillar crosses the water, one texel per pillar grid cell
uniform sampler2D particlePillarsA;
uniform sampler2D particlePillarsB;
uniform vec2 particlePillarOrigin;
uniform float particlePillarCell;
uniform vec2 particlePillarGrid;
uniform float particlePillarMargin;
// the water's raised lip around the pillars near the camera (shaders/water-interaction.glsl.ts), which floating
// particles ride on: height at the rock, how fast it falls off, and the size of the displaced patch around the camera
uniform float particleLiftHeight;
uniform float particleLiftWidth;
uniform float particlePatchRadius;

// radius around a pillar's waterline centre that floating particles stay out of (the stretched cross-section's
// longest radius, plus a margin), or 0 if there's no pillar in this cell
float pillarClearance(ivec2 cell, out vec2 centre) {
    if (cell.x < 0 || cell.y < 0 || float(cell.x) >= particlePillarGrid.x || float(cell.y) >= particlePillarGrid.y) return 0.0;
    vec4 a = texelFetch(particlePillarsA, cell, 0);
    if (a.w < 0.5) return 0.0;
    centre = a.xy;
    return a.z * texelFetch(particlePillarsB, cell, 0).z;
}

bool insidePillar(vec2 p) {
    ivec2 cell = ivec2(floor((p - particlePillarOrigin) / particlePillarCell + 0.5));
    for (int dx = -2; dx <= 2; dx++) {
        for (int dz = -2; dz <= 2; dz++) {
            vec2 centre;
            float r = pillarClearance(cell + ivec2(dx, dz), centre);
            if (r > 0.0 && distance(p, centre) < r * 0.9) return true;
        }
    }
    return false;
}

// bends a floating particle's straight path around the pillars: its sideways offset from each pillar's centre line
// (relative to the flow) is constant along the path, so widening it near the pillar gives smooth streamlines that go
// around it, always on the same side. lift returns how far the water's lip raises the surface where it ends up
vec2 flowAroundPillars(vec2 p, vec2 flow, out float lift) {
    lift = 0.0;
    float speed = length(flow);
    vec2 dir = speed < 1e-6 ? vec2(1.0, 0.0) : flow / speed;
    vec2 perp = vec2(-dir.y, dir.x);
    ivec2 cell = ivec2(floor((p - particlePillarOrigin) / particlePillarCell + 0.5));
    for (int dx = -2; dx <= 2; dx++) {
        for (int dz = -2; dz <= 2; dz++) {
            vec2 centre;
            float rock = pillarClearance(cell + ivec2(dx, dz), centre);
            if (rock <= 0.0) continue;
            float r = rock + particlePillarMargin;
            vec2 rel = p - centre;
            float along = dot(rel, dir);
            float across = dot(rel, perp);
            float around = 1.0 - smoothstep(r, r * 3.0, abs(along));
            float side = across >= 0.0 ? 1.0 : -1.0;
            if (speed >= 1e-6) p += perp * (side * sqrt(across * across + r * r * around) - across);
            lift += particleLiftHeight * exp(-max(distance(p, centre) - rock, 0.0) / particleLiftWidth);
        }
    }
    // the lip is only really raised in the patch around the camera, easing out towards its edge like the water
    vec2 off = abs(p - particleCamera.xz) / max(particlePatchRadius, 1e-4);
    lift *= particlePatchRadius > 0.0 ? 1.0 - smoothstep(0.7, 1.0, max(off.x, off.y)) : 0.0;
    return p;
}

// world position of this particle, and how visible it is (fades at the box edges and as it sinks).
// Particles that reach the water float on it for a while, drifting with the flow, then sink and fade. The time since
// landing follows from how far the particle would have fallen past the surface, so none of this needs state.
// landed is 0 in the air and 1 on or under the water
vec3 particleWorld(out float visible, out float landed) {
    vec4 s = particleSeed;
    float t = particleTime;
    float fall = particleFall * (0.5 + s.w);
    vec3 p = s.xyz * particleBoxSize;
    p.y -= fall * t;
    p.x += sin(t * (0.3 + s.w * 0.4) + s.y * 6.2831) * particleSway;
    p.z += cos(t * (0.25 + s.x * 0.4) + s.z * 6.2831) * particleSway;

    // wrap into the box around the camera
    float halfBox = particleBoxSize * 0.5;
    vec3 rel = mod(p - particleCamera + halfBox, particleBoxSize) - halfBox;
    vec3 world = particleCamera + rel;

    vec3 a = abs(rel) / halfBox;
    visible = 1.0 - smoothstep(0.8, 1.0, max(a.x, max(a.y, a.z)));
    landed = 0.0;

    if (world.y < particleWaterY) {
        float sinceLanding = (particleWaterY - world.y) / max(fall, 1e-4);
        // landed on rock rather than water
        if (insidePillar(world.xz)) visible = 0.0;
        // carried by the flow, around the pillars
        float lift;
        world.xz = flowAroundPillars(world.xz + particleFlow * sinceLanding, particleFlow, lift);
        float sinking = max(sinceLanding - particleFloatTime, 0.0) * particleSinkSpeed;
        world.y = particleWaterY + lift - sinking;
        visible *= 1.0 - smoothstep(0.0, particleSinkDepth, sinking);
        landed = 1.0;
    }
    return world;
}

// 1 for particles close enough to be drawn as flakes, 0 beyond, easing over the band in between
float flakeWeight(vec3 world) {
    float d = distance(world, cameraPosition);
    return 1.0 - smoothstep(flakeNear, flakeNear + flakeBand, d);
}
`;

/**
 * Flakes: small curled shapes that tumble; replaces <beginnormal_vertex> and <begin_vertex>
 */
export const flakeRotationPars = /* glsl */ `
// (edits) ${fileName}
uniform float flakeSize;
uniform float flakeSpin;

// lying flat on the water: the flake's curl faces up, turning slowly
mat3 flakeFlat() {
    float angle = particleTime * 0.1 + particleSeed.w * 6.2831;
    float c = cos(angle), si = sin(angle);
    mat3 turn = mat3(c, 0.0, -si, 0.0, 1.0, 0.0, si, 0.0, c);
    mat3 faceUp = mat3(1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 1.0, 0.0);
    return turn * faceUp;
}

mat3 flakeTumble() {
    vec4 s = particleSeed;
    vec3 axis = normalize(vec3(s.y - 0.5, s.z - 0.5, s.w - 0.5) + 1e-3);
    float angle = particleTime * flakeSpin * (0.5 + s.x) + s.w * 6.2831;
    float c = cos(angle), si = sin(angle), ic = 1.0 - c;
    return mat3(
        c + axis.x * axis.x * ic, axis.y * axis.x * ic + axis.z * si, axis.z * axis.x * ic - axis.y * si,
        axis.x * axis.y * ic - axis.z * si, c + axis.y * axis.y * ic, axis.z * axis.y * ic + axis.x * si,
        axis.x * axis.z * ic + axis.y * si, axis.y * axis.z * ic - axis.x * si, c + axis.z * axis.z * ic
    );
}

mat3 flakeRotation(float landed) {
    return landed > 0.5 ? flakeFlat() : flakeTumble();
}
`;

export const flakeBeginNormal = /* glsl */ `
// (edits) ${fileName}
float flakeNormalVisible;
float flakeNormalLanded;
particleWorld(flakeNormalVisible, flakeNormalLanded);
vec3 objectNormal = flakeRotation(flakeNormalLanded) * normal;
#ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

export const flakeBeginVertex = /* glsl */ `
// (edits) ${fileName}
float flakeVisible;
float flakeLanded;
vec3 flakeCentre = particleWorld(flakeVisible, flakeLanded);
float flakeScale = flakeSize * (0.6 + 0.8 * particleSeed.y) * flakeVisible * flakeWeight(flakeCentre);
vec3 transformed = flakeCentre + flakeRotation(flakeLanded) * position * flakeScale;
`;

/**
 * Dots: camera-facing quads with the particle texture; replaces <begin_vertex>
 */
export const dotPars = /* glsl */ `
// (edits) ${fileName}
uniform float dotSize;
varying float dotOpacity;
`;

export const dotBeginVertex = /* glsl */ `
// (edits) ${fileName}
float dotVisible;
float dotLanded;
vec3 dotCentre = particleWorld(dotVisible, dotLanded);
dotOpacity = dotVisible * (1.0 - flakeWeight(dotCentre));
vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 transformed = dotCentre + (camRight * position.x + camUp * position.y) * dotSize * (0.7 + 0.6 * particleSeed.z);
`;

export const dotFragPars = /* glsl */ `
// (edits) ${fileName}
varying float dotOpacity;
`;

export const dotFrag = /* glsl */ `
// (edits) ${fileName}
gl_FragColor.a *= dotOpacity;
`;
