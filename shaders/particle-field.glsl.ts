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
uniform float flakeNear;
uniform float flakeBand;

// world position of this particle, and how visible it is (fades at the box edges and under the water)
vec3 particleWorld(out float visible) {
    vec4 s = particleSeed;
    float t = particleTime;
    vec3 p = s.xyz * particleBoxSize;
    p.y -= particleFall * (0.5 + s.w) * t;
    p.x += sin(t * (0.3 + s.w * 0.4) + s.y * 6.2831) * particleSway;
    p.z += cos(t * (0.25 + s.x * 0.4) + s.z * 6.2831) * particleSway;

    // wrap into the box around the camera
    float halfBox = particleBoxSize * 0.5;
    vec3 rel = mod(p - particleCamera + halfBox, particleBoxSize) - halfBox;
    vec3 world = particleCamera + rel;

    vec3 a = abs(rel) / halfBox;
    visible = 1.0 - smoothstep(0.8, 1.0, max(a.x, max(a.y, a.z)));
    visible *= smoothstep(particleWaterY - 0.01, particleWaterY + 0.03, world.y);
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

mat3 flakeRotation() {
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
`;

export const flakeBeginNormal = /* glsl */ `
// (edits) ${fileName}
vec3 objectNormal = flakeRotation() * normal;
#ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
#endif
`;

export const flakeBeginVertex = /* glsl */ `
// (edits) ${fileName}
float flakeVisible;
vec3 flakeCentre = particleWorld(flakeVisible);
float flakeScale = flakeSize * (0.6 + 0.8 * particleSeed.y) * flakeVisible * flakeWeight(flakeCentre);
vec3 transformed = flakeCentre + flakeRotation() * position * flakeScale;
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
vec3 dotCentre = particleWorld(dotVisible);
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
