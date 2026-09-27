import { toFileName } from "./util";
import { TOUCH_POINTS } from "./water-interaction.glsl";

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
// share of this particle set that's shown; the rest fade out one by one (e.g. the orange ones at night)
uniform float particleShown;
uniform float particleSinkSpeed;
uniform float particleSinkDepth;
// how deep under the surface this particle is (0 above it), for the murk that swallows it as it sinks
varying float vParticleSunk;
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
// the cursor's dents in the water (environment/water-touch.ts), the same points the water uses: (x, z, strength)
uniform vec3 particleTouchPoints[${TOUCH_POINTS}];
uniform float particleTouchRadius;
uniform float particleTouchPush;

// floating particles pushed aside by the cursor's dents, drifting back as they refill. The push fades out with distance
// gently enough (for push strengths up to about 1) that particles never pass each other, they only squeeze aside
// a meteor's impact: the blast of air rolls out from it, shoving particles away as it reaches them (and setting flakes
// spinning), then lets them drift slowly back. Stateless: worked out from the time since the impact
uniform vec3 particleBlastCentre;
uniform float particleBlastAge;
uniform float particleBlastTime;
uniform float particleBlastStrength;
uniform float particleBlastReach;
uniform float particleBlastSpeed;
uniform float particleBlastSettle;
uniform float particleBlastSpinAmount;
// the air blast's gust, which reaches much further and much sooner than anything in the fluid
uniform float particleGustStrength;
uniform float particleGustReach;
uniform float particleGustSpeed;
uniform float particleGustSettle;
uniform float particleGustSpin;
// the extra spin the blast gave this particle, for flakeTumble
float particleBlastSpin = 0.0;

// a push moves a particle to a new place and drag stops it there: it eases out to its final offset over 'settle' seconds
// and keeps it. Only for the particle that was there at the impact: once it has fallen out of the box and come round
// again at the top, it's a fresh one (and the next impact doesn't yank older particles back to their old paths)
vec3 blastOffset(vec3 p) {
    if (particleBlastAge < 0.0 || particleBlastAge > 1e4) return vec3(0.0);
    float fall = particleFall * (0.5 + particleSeed.w);
    float lifeThen = floor((particleSeed.y * particleBoxSize - fall * particleBlastTime) / particleBoxSize);
    float lifeNow = floor((particleSeed.y * particleBoxSize - fall * particleTime) / particleBoxSize);
    if (lifeThen != lifeNow) return vec3(0.0);
    vec3 d = p - particleBlastCentre;
    float r = max(length(d), 1e-3);
    vec3 away = d / r;
    vec3 offset = vec3(0.0);

    // close to the impact: a strong shove, mostly outwards, a little lifted
    float reached = smoothstep(r, r + 1.0, particleBlastAge * particleBlastSpeed);
    float sinceBlast = max(particleBlastAge - r / particleBlastSpeed, 0.0);
    float amount = particleBlastStrength * exp(-r / particleBlastReach) * reached * (1.0 - exp(-sinceBlast / particleBlastSettle));
    offset += (away + vec3(0.0, 0.3, 0.0)) * amount;
    particleBlastSpin = amount * particleBlastSpinAmount;

    // the gust: arrives fast, fades slowly with distance, a turbulent lurch away from the impact
    float sinceGust = particleBlastAge - r / particleGustSpeed;
    if (particleGustStrength > 0.0 && sinceGust > 0.0) {
        float gust = particleGustStrength / (1.0 + r / particleGustReach) * (1.0 - exp(-sinceGust / particleGustSettle));
        vec3 jitter = (particleSeed.yzw - 0.5) * 0.8;
        offset += normalize(vec3(away.x, 0.15, away.z) + jitter) * gust * (0.6 + 0.8 * particleSeed.x);
        particleBlastSpin += gust * particleGustSpin;
    }
    return offset;
}

vec2 pushedByTouch(vec2 p) {
    vec2 offset = vec2(0.0);
    float r2Push = particleTouchRadius * particleTouchRadius;
    for (int i = 0; i < ${TOUCH_POINTS}; i++) {
        float w = particleTouchPoints[i].z;
        if (w <= 0.0) continue;
        vec2 d = p - particleTouchPoints[i].xy;
        float r2 = dot(d, d);
        if (r2 > 9.0 * r2Push || r2 < 1e-8) continue;
        offset += d * inversesqrt(r2) * particleTouchPush * w * particleTouchRadius * exp(-r2 / r2Push);
    }
    return p + offset;
}

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
// (relative to the flow) is constant along the straight path, so widening it near the pillar gives smooth streamlines
// that go around it, always on the same side. Every push is worked out from the straight path (not from a position
// another pillar already moved, which could flip the side) and fades to zero within 2 radii, inside the cells
// searched, so nothing switches on or off suddenly. lift returns how far the water's lip raises the surface there
vec2 flowAroundPillars(vec2 straight, vec2 flow, out float lift) {
    lift = 0.0;
    float speed = length(flow);
    vec2 dir = speed < 1e-6 ? vec2(1.0, 0.0) : flow / speed;
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 offset = vec2(0.0);
    ivec2 cell = ivec2(floor((straight - particlePillarOrigin) / particlePillarCell + 0.5));
    // 3 cells covers the push of even the thickest, most leaning pillars (2 radii, stretched by the lean)
    for (int dx = -3; dx <= 3; dx++) {
        for (int dz = -3; dz <= 3; dz++) {
            vec2 centre;
            float rock = pillarClearance(cell + ivec2(dx, dz), centre);
            if (rock <= 0.0 || speed < 1e-6) continue;
            float r = rock + particlePillarMargin;
            vec2 rel = straight - centre;
            float along = dot(rel, dir);
            float across = dot(rel, perp);
            float around = (1.0 - smoothstep(r, 2.0 * r, abs(along))) * (1.0 - smoothstep(1.2 * r, 2.0 * r, abs(across)));
            float side = across >= 0.0 ? 1.0 : -1.0;
            offset += perp * (side * sqrt(across * across + r * r * around) - across);
        }
    }
    vec2 p = straight + offset;

    // the raised lip is at the rock, a few centimetres wide
    for (int dx = -1; dx <= 1; dx++) {
        for (int dz = -1; dz <= 1; dz++) {
            vec2 centre;
            float rock = pillarClearance(ivec2(floor((p - particlePillarOrigin) / particlePillarCell + 0.5)) + ivec2(dx, dz), centre);
            if (rock > 0.0) lift += particleLiftHeight * exp(-max(distance(p, centre) - rock, 0.0) / particleLiftWidth);
        }
    }
    // the lip is only really raised in the patch around the camera, easing out towards its edge like the water
    vec2 off = abs(p - particleCamera.xz) / max(particlePatchRadius, 1e-4);
    lift *= particlePatchRadius > 0.0 ? 1.0 - smoothstep(0.7, 1.0, max(off.x, off.y)) : 0.0;
    return p;
}

// height of the water surface under the particle, set by particleWorld while it's on or in the water
float particleSurfaceY = 0.0;
// seconds since this particle landed on the water (negative while it's still falling), for the embers cooling
varying float vParticleSinceLanding;

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
    visible *= clamp((particleShown - fract(s.x * 7.31 + s.z * 3.17)) * 8.0 + 0.5, 0.0, 1.0);
    landed = 0.0;

    if (world.y < particleWaterY) {
        float sinceLanding = (particleWaterY - world.y) / max(fall, 1e-4);
        vParticleSinceLanding = sinceLanding;
        // landed on rock rather than water
        if (insidePillar(world.xz)) visible = 0.0;
        // carried by the flow, around the pillars
        float lift;
        world.xz = flowAroundPillars(world.xz + particleFlow * sinceLanding, particleFlow, lift);
        world.xz = pushedByTouch(world.xz);
        // floating ones are shoved across the surface
        world.xz += blastOffset(world).xz;
        float sinking = max(sinceLanding - particleFloatTime, 0.0) * particleSinkSpeed;
        world.y = particleWaterY + lift - sinking;
        particleSurfaceY = particleWaterY + lift;
        visible *= 1.0 - smoothstep(0.0, particleSinkDepth, sinking);
        landed = 1.0;
    }
    // in the air: blown outwards and up
    if (landed < 0.5) world += blastOffset(world);
    if (landed < 0.5) vParticleSinceLanding = -1.0;
    vParticleSunk = max(particleWaterY - world.y, 0.0);
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
    float angle = particleTime * flakeSpin * (0.5 + s.x) + s.w * 6.2831 + particleBlastSpin * (0.5 + s.y);
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
// how far this set's dot texture is turned towards white (its own colour is baked into the texture)
uniform float dotWhiten;
`;

export const flashTintPars = /* glsl */ `
// (edits) ${fileName}
varying float vParticleSinceLanding;
// 1 for embers, which cool to near black once they land in the fluid; over how many seconds
uniform float particleCools;
uniform float particleCoolSeconds;
varying float vParticleSunk;
// the water's underwater colour, and how fast a sinking particle disappears into it (per metre of depth)
uniform vec3 particleMurkColor;
uniform float particleSinkMurk;
uniform float particleWaterY;
uniform vec3 particleFlashColor;
uniform float particleFlash;
`;

/**
 * After the colour is worked out, before the fog: particles turn the colour of a meteor's flash while it's on
 */
export const flashTintFrag = /* glsl */ `
#include <opaque_fragment>
// (edits) ${fileName}
// an ember that has landed in the fluid cools: its glow dies and it goes near black
if (particleCools > 0.5 && vParticleSinceLanding >= 0.0) {
    float cooled = smoothstep(0.0, particleCoolSeconds, vParticleSinceLanding);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.012, 0.010, 0.010), cooled);
}
gl_FragColor.rgb = mix(gl_FragColor.rgb, particleFlashColor, particleFlash);
// sinking, seen from above: through the thick water it's quickly swallowed by its colour, so it clearly goes under (in
// output colours, like the rest of the underwater shading). From under the water it's right there with the camera,
// and fades by its distance like everything else instead
if (cameraPosition.y > particleWaterY) {
    gl_FragColor.rgb = mix(gl_FragColor.rgb, linearToOutputTexel(vec4(particleMurkColor, 1.0)).rgb, 1.0 - exp(-particleSinkMurk * vParticleSunk));
}
`;

export const dotFrag = /* glsl */ `
// (edits) ${fileName}
gl_FragColor.a *= dotOpacity;
// towards white, keeping the texture's own shading (its brightest channel as the white's brightness)
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b))), dotWhiten);
`;

/**
 * Dimples: a patch on the water under each floating flake, where the thick surface dips under it and curves up around
 * it: a dark dimple with a bright rim. Replaces <begin_vertex>
 */
export const dimplePars = /* glsl */ `
// (edits) ${fileName}
uniform float flakeSize;
uniform float dimpleSize;
varying vec2 dimpleUv;
varying float dimpleFade;
`;

export const dimpleBeginVertex = /* glsl */ `
// (edits) ${fileName}
float dimpleVisible;
float dimpleLanded;
vec3 dimpleCentre = particleWorld(dimpleVisible, dimpleLanded);
// the same size as its flake (which shrinks as it turns into a dot further away), and fades as the flake sinks
float dimpleDepth = particleSurfaceY - dimpleCentre.y;
dimpleFade = dimpleLanded * (1.0 - smoothstep(0.0, 0.02, dimpleDepth));
// part of the surface itself, so not in the water's reflection (rendered from a mirror camera below the surface)
if (cameraPosition.y < particleWaterY) dimpleFade = 0.0;
float dimpleScale = flakeSize * (0.6 + 0.8 * particleSeed.y) * dimpleVisible * flakeWeight(dimpleCentre) * dimpleSize * step(0.001, dimpleFade);
dimpleUv = position.xy * 2.0;
// the quad's y becomes -z, so its front faces up (three only draws front faces)
vec3 transformed = vec3(dimpleCentre.x + position.x * dimpleScale, particleSurfaceY + 0.002, dimpleCentre.z - position.y * dimpleScale);
`;

export const dimpleFragPars = /* glsl */ `
// (edits) ${fileName}
uniform float dimpleDarkness;
uniform float dimpleRim;
uniform vec3 dimpleRimColor;
varying vec2 dimpleUv;
varying float dimpleFade;
`;

/**
 * Replaces the whole fragment output: dark in the middle, a thin bright ring towards the edge
 */
export const dimpleFrag = /* glsl */ `
// (edits) ${fileName}
float r = length(dimpleUv);
float dimple = dimpleDarkness * (1.0 - smoothstep(0.2, 0.75, r));
float rim = dimpleRim * smoothstep(0.55, 0.75, r) * (1.0 - smoothstep(0.75, 1.0, r));
float alpha = max(dimple, rim) * dimpleFade;
if (alpha < 0.002) discard;
gl_FragColor = vec4(dimpleRimColor * (rim / max(max(dimple, rim), 1e-4)), alpha);
`;

/**
 * Steam: a thin wisp curling up off each ember as it lands in the fluid (the hiss). A tall quad per particle, upright
 * and turned to the camera, hidden the rest of the time; the wisp itself is drawn in the fragment shader, from noise
 * drifting up a swaying column, so every one has its own ragged shape. Replaces <begin_vertex>
 */
export const steamPars = /* glsl */ `
// (edits) ${fileName}
uniform float steamSeconds;
uniform float steamSize;
uniform float steamRise;
varying vec2 steamUv;
varying float steamFade;
varying float steamAgeV;
varying float steamSeed;
`;

export const steamBeginVertex = /* glsl */ `
// (edits) ${fileName}
float steamVisible;
float steamLanded;
vec3 steamCentre = particleWorld(steamVisible, steamLanded);
float steamAge = vParticleSinceLanding / steamSeconds;
float steamOn = steamLanded * step(0.0, steamAge) * step(steamAge, 1.0) * steamVisible * flakeWeight(steamCentre);
steamFade = steamOn * smoothstep(0.0, 0.08, steamAge) * (1.0 - smoothstep(0.5, 1.0, steamAge));
steamAgeV = steamAge;
steamSeed = particleSeed.x * 17.0 + particleSeed.z * 5.0;
// x across (-1..1), y up the wisp (0 at the surface, 1 at the top)
steamUv = vec2(position.x * 2.0, position.y + 0.5);
vec3 camRight = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]) + vec3(1e-4, 0.0, 0.0));
float steamWidth = steamSize * (0.7 + 0.6 * particleSeed.z) * step(0.0001, steamFade);
float steamHeight = steamRise * (0.8 + 0.5 * particleSeed.y) * step(0.0001, steamFade);
vec3 transformed = vec3(steamCentre.x, particleSurfaceY, steamCentre.z)
    + camRight * position.x * steamWidth + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * steamHeight;
`;

export const steamFragPars = /* glsl */ `
// (edits) ${fileName}
uniform float steamOpacity;
varying vec2 steamUv;
varying float steamFade;
varying float steamAgeV;
varying float steamSeed;

float steamHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float steamNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(steamHash(i), steamHash(i + vec2(1.0, 0.0)), f.x), mix(steamHash(i + vec2(0.0, 1.0)), steamHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

export const steamFrag = /* glsl */ `
// (edits) ${fileName}
float sy = steamUv.y;
float sa = steamAgeV;
// the column sways and curls more the higher it gets
float sway = (steamNoise(vec2(sy * 2.5 - sa * 1.5, steamSeed)) - 0.5) * 1.1 * sy
    + sin(sy * 5.0 + steamSeed + sa * 4.0) * 0.18 * sy;
float sx = steamUv.x - sway;
// thin at the surface, spreading as it rises
float halfWidth = mix(0.3, 0.95, sy);
float column = 1.0 - smoothstep(halfWidth * 0.2, halfWidth, abs(sx));
// torn up by noise drifting upwards
float torn = 0.6 * steamNoise(vec2(sx * 4.0, sy * 7.0 - sa * 5.0) + steamSeed * 3.1)
    + 0.4 * steamNoise(vec2(sx * 9.0, sy * 15.0 - sa * 8.0) + steamSeed * 7.3);
float density = column * smoothstep(0.45, 0.85, torn + column * 0.15) * 0.8;
// only as high as it has risen so far, thinning out towards the top
float risen = 1.0 - smoothstep(sa * 1.6, sa * 1.6 + 0.15, sy);
float ends = smoothstep(0.0, 0.08, sy) * (1.0 - smoothstep(0.55, 1.0, sy));
float steamA = density * risen * ends * steamFade * steamOpacity;
if (steamA < 0.003) discard;
gl_FragColor.a = steamA;
`;
