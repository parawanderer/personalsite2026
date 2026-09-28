import { Color, IUniform, Vector3 } from "three";

/**
 * The night sky's faint glows (environment/night-glow.ts keeps these up to date): drawn on the sky, and picked up by
 * the far fog in their direction (shaders/sky-glow.glsl.ts), so distant walls fade into them instead of standing dark
 * against them.
 */
export const nightGlowUniforms: { [name: string]: IUniform } = {
    zodiacalBase: { value: new Vector3(0, 0, -1) },
    zodiacalAxis: { value: new Vector3(0, 1, 0) },
    zodiacalColor: { value: new Color(0, 0, 0) },
    zodiacalLength: { value: 0.5 },
    zodiacalWidth: { value: 0.2 },
    airglowColor: { value: new Color(0, 0, 0) },
    airglowPeak: { value: 0.15 },
    airglowWidth: { value: 0.1 },
};

export const nightGlowPars = /* glsl */ `
// (edits) shaders/night-glow.glsl.ts
uniform vec3 zodiacalBase;
uniform vec3 zodiacalAxis;
uniform vec3 zodiacalColor;
uniform float zodiacalLength;
uniform float zodiacalWidth;
uniform vec3 airglowColor;
uniform float airglowPeak;
uniform float airglowWidth;

// the zodiacal light: a faint, tilted cone rising from where the sun went down, along the plane its planets (and the
// dust between them) orbit in, brightest at its base and narrowing upwards
vec3 zodiacalLight(vec3 dir) {
    if (zodiacalColor.r + zodiacalColor.g + zodiacalColor.b <= 0.0 || dir.y <= 0.0) return vec3(0.0);
    vec3 normal = normalize(cross(zodiacalBase, zodiacalAxis));
    float across = asin(clamp(dot(dir, normal), -1.0, 1.0));
    vec3 inPlane = normalize(dir - dot(dir, normal) * normal);
    float along = atan(dot(inPlane, zodiacalAxis), dot(inPlane, zodiacalBase));
    if (along < 0.0) return vec3(0.0);
    float width = zodiacalWidth * (1.0 - 0.6 * clamp(along / (zodiacalLength * 2.5), 0.0, 1.0));
    return zodiacalColor * exp(-along / zodiacalLength) * exp(-pow(across / width, 2.0)) * smoothstep(0.0, 0.04, dir.y);
}

// airglow: the upper air glowing faintly by itself at night, seen edge-on as a soft band a little above the horizon
// all the way round, where the line of sight runs longest through the glowing layer
vec3 airglow(vec3 dir) {
    if (airglowColor.r + airglowColor.g + airglowColor.b <= 0.0) return vec3(0.0);
    float elevation = asin(clamp(dir.y, -1.0, 1.0));
    return airglowColor * exp(-pow((elevation - airglowPeak) / airglowWidth, 2.0)) * smoothstep(-0.02, 0.02, dir.y);
}

vec3 nightGlow(vec3 dir) {
    return zodiacalLight(dir) + airglow(dir);
}
`;
