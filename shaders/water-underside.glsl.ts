import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

/**
 * The water's surface seen from below, while the camera is under it. Looking up, the world above shows through a
 * rippled window (Snell's window: light from above only reaches the eye within about 49 degrees of straight up); beyond
 * it the surface is a dark mirror of the depths (total internal reflection). Everything is faded by the water between
 * the camera and the surface, like the rest of the underwater view.
 */
export const undersideVertex = /* glsl */ `
// (edits) ${fileName}
varying vec3 vWorld;
void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const undersideFragment = /* glsl */ `
// (edits) ${fileName}
uniform sampler2D normalSampler;
uniform float time;
uniform float size;
uniform vec2 flowOffset;
uniform float rippleScale;
uniform float rippleAmp;
uniform vec3 underwaterColor;
uniform float underwaterViewDensity;
// how clearly the world above shows through the window, and how bright the mirror of the depths is around it
uniform float undersideClarity;
uniform float undersideMirror;
uniform float undersideRipple;
varying vec3 vWorld;

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

    // Snell's window: within the critical angle (cos 0.66 for water) the world above shows through, rippled at its edge
    float cosine = dot(view, up);
    float window = smoothstep(0.6, 0.72, cosine);
    // brightest towards its rim, where the light from low in the sky is bent in
    float rim = smoothstep(0.6, 0.66, cosine) * (1.0 - smoothstep(0.66, 0.8, cosine));

    // the water between the camera and this point of the surface
    float transmitted = exp(-underwaterViewDensity * length(toSurface));
    float see = window * transmitted * undersideClarity;

    // outside the window: the depths mirrored, a little lighter than the water itself
    vec3 mirror = underwaterColor * (1.0 + undersideMirror * (1.0 - window));
    vec3 color = mix(underwaterColor, mirror, transmitted) + underwaterColor * rim * transmitted * 0.8;
    gl_FragColor = vec4(color, 1.0 - see);
}
`;
