import { IUniform, WebGLProgramParametersWithUniforms } from "three";

import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

/**
 * Exponential fog for anything below the water surface: the further the view ray travels under water, the more it
 * fades into the underwater colour. The seabed sits deep enough to fade into it completely, so fog and floor match.
 * Needs no extra render pass since the submerged geometry is drawn anyway; the (partly transparent) water surface is
 * blended over it afterwards.
 */
const parsVert = /* glsl */ `
// (edits) ${fileName}
varying vec3 vUnderwaterWorldPos;
`;

const vert = /* glsl */ `
// (edits) ${fileName}
vUnderwaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const parsFrag = /* glsl */ `
// (edits) ${fileName}
varying vec3 vUnderwaterWorldPos;
uniform float waterLevelY;
// 1 while the camera is under the water (set from the camera, since the water's mirror camera is under it too)
uniform float viewUnderwater;
uniform vec3 underwaterColor;
uniform float underwaterDensity;
// how thick the water is from inside it: clearer than seen from above, where it has to hide the depths quickly
uniform float underwaterViewDensity;
uniform float wetBandHeight;
uniform float wetBandDarkness;
uniform vec3 causticColor;
uniform float causticStrength;
uniform float causticAbove;
uniform float causticBelow;
uniform float causticScale;
uniform float causticTime;
uniform float causticSharpness;
uniform vec2 causticFlow;

// based on "Tileable Water Caustic" (joltz0r / Dave Hoskins, shadertoy MdlXz8)
float causticPattern(vec2 uv, float t) {
    // the original's domain: tiles every 2 pi, offset far from 0 where the formula blows up
    vec2 p = mod(uv, 6.2831853) - 250.0;
    vec2 i = p;
    float c = 1.0;
    const float inten = 0.005;
    for (int n = 0; n < 4; n++) {
        float tt = t * (1.0 - 3.5 / float(n + 1));
        i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), causticSharpness), 0.0, 1.0);
}
`;

/**
 * After <opaque_fragment> (lit colour, before fog): light focused by the surface, playing on the rock in a band around
 * the waterline. On the mostly vertical pillar faces the pattern runs along the face and up it, drifting with the flow
 */
const caustics = /* glsl */ `
// (edits) ${fileName}
{
    float fromSurface = vUnderwaterWorldPos.y - waterLevelY;
    if (causticStrength > 0.0 && fromSurface < causticAbove && fromSurface > -causticBelow) {
        float band = fromSurface > 0.0
            ? 1.0 - smoothstep(0.0, causticAbove, fromSurface)
            : 1.0 - smoothstep(0.0, causticBelow, -fromSurface);
        vec2 drift = vUnderwaterWorldPos.xz - causticFlow;
        vec2 cp = vec2(drift.x + drift.y * 0.6, vUnderwaterWorldPos.y * 1.5 + drift.y * 0.3) * causticScale;
        gl_FragColor.rgb += causticColor * causticStrength * band * causticPattern(cp, causticTime);
    }
}
`;

/**
 * After <color_fragment>: surfaces just above the water are darker where it climbs and wets them
 */
const wetBand = /* glsl */ `
// (edits) ${fileName}
float aboveWater = vUnderwaterWorldPos.y - waterLevelY;
if (aboveWater > 0.0) {
    diffuseColor.rgb *= 1.0 - wetBandDarkness * (1.0 - smoothstep(0.0, wetBandHeight, aboveWater));
}
`;

/**
 * Before <premultiplied_alpha_fragment>, so after the regular fog: submerged surfaces are absorbed whatever the
 * above-water fog did to them, and in output colours, so things fade into exactly the colour picked (like fog colours)
 */
const frag = /* glsl */ `
// (edits) ${fileName}
if (viewUnderwater > 0.5) {
    // the camera is under the water: things fade by the water their light crosses to reach it. Below the surface
    // that's their whole distance; above it, only the stretch up to the surface (the rest is air, which the pillars'
    // own fog covers: shaders/fogedits.glsl.ts), so the walls above keep their colour, as from above
    vec3 fromCamera = vUnderwaterWorldPos - cameraPosition;
    float inWater = vUnderwaterWorldPos.y > waterLevelY
        ? (waterLevelY - cameraPosition.y) / max(fromCamera.y, 1e-4)
        : 1.0;
    float transmitted = exp(-underwaterViewDensity * length(fromCamera) * clamp(inWater, 0.0, 1.0));
    gl_FragColor.rgb = mix(linearToOutputTexel(vec4(underwaterColor, 1.0)).rgb, gl_FragColor.rgb, transmitted);
} else if (vUnderwaterWorldPos.y < waterLevelY && cameraPosition.y > waterLevelY) {
    // (cameras under the water here are the water's own mirror camera, which skips this)
    vec3 toCamera = cameraPosition - vUnderwaterWorldPos;
    float submergedFraction = (waterLevelY - vUnderwaterWorldPos.y) / toCamera.y;
    float pathInWater = length(toCamera) * submergedFraction;
    float transmitted = exp(-underwaterDensity * pathInWater);
    gl_FragColor.rgb = mix(linearToOutputTexel(vec4(underwaterColor, 1.0)).rgb, gl_FragColor.rgb, transmitted);
}
`;

const insertAfter = (source: string, anchor: string, content: string) => {
    if (!source.includes(anchor)) console.warn(`Shader no longer contains "${anchor}"; underwater shading not applied.`);
    return source.replace(anchor, `${anchor}\n${content}`);
};

const insertBefore = (source: string, anchor: string, content: string) => {
    if (!source.includes(anchor)) console.warn(`Shader no longer contains "${anchor}"; underwater shading not applied.`);
    return source.replace(anchor, `${content}\n${anchor}`);
};

export const applyUnderwater = (params: WebGLProgramParametersWithUniforms, uniforms: { [name: string]: IUniform }) => {
    params.vertexShader = insertAfter(params.vertexShader, '#include <common>', parsVert);
    params.vertexShader = insertAfter(params.vertexShader, '#include <begin_vertex>', vert);
    params.fragmentShader = insertAfter(params.fragmentShader, '#include <common>', parsFrag);
    params.fragmentShader = insertAfter(params.fragmentShader, '#include <color_fragment>', wetBand);
    params.fragmentShader = insertAfter(params.fragmentShader, '#include <opaque_fragment>', caustics);
    params.fragmentShader = insertBefore(params.fragmentShader, '#include <premultiplied_alpha_fragment>', frag);
    Object.assign(params.uniforms, uniforms);
};
