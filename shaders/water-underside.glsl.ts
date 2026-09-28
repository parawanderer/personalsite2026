import { toFileName } from "./util";
import { shaftPars } from "./sun-shafts.glsl";
import { surfaceWavePars } from "./underwater.glsl";

const fileName = toFileName(import.meta.url);

/**
 * The water's surface seen from below, while the camera is under it. Looking up, the world above shows through a
 * rippled window (Snell's window: light from above only reaches the eye within about 49 degrees of straight up, the
 * whole sky squeezed into it); beyond it the surface is a dark mirror of the depths (total internal reflection). Each
 * pixel's view is bent out through the rippled surface and looks up the world above, captured into a cube map
 * (environment/snell-window.ts). Everything is faded by the water between the camera and the surface, like the rest of
 * the underwater view.
 */
export const undersideVertex = /* glsl */ `
// (edits) ${fileName}
${surfaceWavePars}
varying vec3 vWorld;
void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    // the rolling waves, seen from below
    world.y += surfaceWave(world.xz);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const undersideFragment = /* glsl */ `
// (edits) ${fileName}
${surfaceWavePars}
uniform sampler2D normalSampler;
uniform float time;
uniform float size;
uniform vec2 flowOffset;
uniform float rippleScale;
uniform float rippleAmp;
uniform vec3 underwaterColor;
uniform float underwaterViewDensity;
uniform vec3 depthAbsorption;
// how clearly the world above shows through the window, and how bright the mirror of the depths is around it
uniform float undersideClarity;
uniform float undersideMirror;
uniform float undersideRipple;
uniform float undersideRefraction;
uniform samplerCube undersideAbove;
varying vec3 vWorld;
${shaftPars}

// the water's own ripple texture, the same way the surface samples it (three's Water shader)
vec4 getNoise(vec2 uv) {
    vec2 uv0 = (uv / 103.0) + vec2(time / 17.0, time / 29.0);
    vec2 uv1 = uv / 107.0 - vec2(time / -19.0, time / 31.0);
    vec2 uv2 = uv / vec2(8907.0, 9803.0) + vec2(time / 101.0, time / 97.0);
    vec2 uv3 = uv / vec2(1091.0, 1027.0) - vec2(time / 109.0, time / -113.0);
    vec4 noise = texture2D(normalSampler, uv0) + texture2D(normalSampler, uv1) + texture2D(normalSampler, uv2) + texture2D(normalSampler, uv3);
    return noise * 0.5 - 1.0;
}

void main() {
    vec3 toSurface = vWorld - cameraPosition;
    vec3 view = normalize(toSurface);

    vec4 noise = getNoise((vWorld.xz - flowOffset) * size * rippleScale);
    vec3 up = normalize(noise.xzy * vec3(1.5 * rippleAmp * undersideRipple, 1.0, 1.5 * rippleAmp * undersideRipple));
    // tilted by the rolling waves too, so the window's edge and the mirror follow them
    float e = 0.05;
    vec2 slope = vec2(surfaceWave(vWorld.xz + vec2(e, 0.0)) - surfaceWave(vWorld.xz - vec2(e, 0.0)),
                      surfaceWave(vWorld.xz + vec2(0.0, e)) - surfaceWave(vWorld.xz - vec2(0.0, e))) / (2.0 * e);
    up = normalize(up - vec3(slope.x, 0.0, slope.y));

    // Snell's window: the view bent out into the air through this bit of the surface (Snell's law), looking up the
    // world above along it; past the critical angle nothing gets out and the surface mirrors the depths instead. Less
    // gets through towards the window's edge, where more is reflected (Fresnel, Schlick's approximation)
    // (through the waves and ripples only partly: at full strength they marble the world above beyond recognition)
    vec3 bending = normalize(mix(vec3(0.0, 1.0, 0.0), up, undersideRefraction));
    vec3 air = refract(view, -bending, 1.33);
    float through = 0.0;
    vec3 above = vec3(0.0);
    if (dot(air, air) > 0.0) {
        float cosAir = max(dot(air, bending), 0.0);
        through = (1.0 - (0.02 + 0.98 * pow(1.0 - cosAir, 5.0))) * undersideClarity;
        above = textureCube(undersideAbove, air).rgb;
    }

    // the water between the camera and this point of the surface
    float transmitted = exp(-underwaterViewDensity * length(toSurface));

    // the haze between here and the camera, lit like the water about one fog-length along the view (as everything else
    // under the water: shaders/underwater.glsl.ts)
    float hazeDepth = vWorld.y - (cameraPosition.y + view.y * min(length(toSurface), 1.0 / max(underwaterViewDensity, 0.05)));
    vec3 waterColor = underwaterColor * exp(-depthAbsorption * max(hazeDepth, 0.0));
    // the depths mirrored, a little lighter than the water itself
    vec3 mirror = waterColor * (1.0 + undersideMirror);
    vec3 color = mix(waterColor, mix(mirror, above, through), transmitted);
    // the sun glittering where its light comes in (shaders/sun-shafts.glsl.ts), on finer ripples than the window's
    // (many small facets each catching the sun), tilted by the same rolling waves
    vec4 fine = getNoise((vWorld.xz - flowOffset) * size * rippleScale * shaftGlitterScale);
    vec3 facets = normalize(normalize(fine.xzy * vec3(rippleAmp, 1.0, rippleAmp)) - vec3(slope.x, 0.0, slope.y));
    color += shaftGlitter(vWorld, view, facets) * transmitted;
    gl_FragColor = vec4(color, 1.0);
}
`;
