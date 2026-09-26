import { IUniform, ShaderChunk, WebGLProgramParametersWithUniforms } from "three";

import { toFileName } from "./util";

const fileName = toFileName(import.meta.url);

/**
 * Hex tiling for the pillars' colour and normal maps: splits texture space into hexagons that each read the texture at a random offset and blend into their
 * neighbours, so a repeating texture never shows its grid. Offsets only (no rotation), so normal maps stay valid.
 *
 * Based on Mikkelsen, "Practical Real-Time Hex-Tiling" (JCGT 2022) https://jcgt.org/published/0011/03/05/
 */
const hexTilingPars = /* glsl */ `
// (edits) ${fileName}
uniform float hexScale;
uniform float hexContrast;
uniform float macroStrength;
uniform float macroScale;
// cameras below this are the water's mirror camera, which only needs the plain texture
uniform float reflectionBelowY;

bool isReflectionPass() {
    return cameraPosition.y < reflectionBelowY;
}

float macroHash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

// value noise in [-1, 1], much cheaper than the fog's Perlin noise and plenty for slow brightness variation
float macroNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n = mix(
        mix(mix(macroHash(i), macroHash(i + vec3(1, 0, 0)), f.x), mix(macroHash(i + vec3(0, 1, 0)), macroHash(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(macroHash(i + vec3(0, 0, 1)), macroHash(i + vec3(1, 0, 1)), f.x), mix(macroHash(i + vec3(0, 1, 1)), macroHash(i + vec3(1, 1, 1)), f.x), f.y),
        f.z);
    return n * 2.0 - 1.0;
}

vec2 hexHash(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

vec4 textureHex(sampler2D tex, vec2 uv) {
    if (isReflectionPass()) return texture2D(tex, uv);

    // barycentric weights and the three hex centres around this point, on a skewed triangle grid
    vec2 st = uv * hexScale * 3.4641016;
    vec2 skewed = vec2(st.x, -0.57735027 * st.x + 1.15470054 * st.y);
    vec2 baseId = floor(skewed);
    vec3 temp = vec3(fract(skewed), 0.0);
    temp.z = 1.0 - temp.x - temp.y;
    float s = step(0.0, -temp.z);
    float s2 = 2.0 * s - 1.0;
    vec3 w = vec3(-temp.z * s2, s - temp.y * s2, s - temp.x * s2);

    // keep the mip level of the unshifted uv, the random offsets would otherwise cause seams
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    vec4 c1 = textureGrad(tex, uv + hexHash(baseId + vec2(s, s)), dx, dy);
    vec4 c2 = textureGrad(tex, uv + hexHash(baseId + vec2(s, 1.0 - s)), dx, dy);
    vec4 c3 = textureGrad(tex, uv + hexHash(baseId + vec2(1.0 - s, s)), dx, dy);

    // sharpen the blend so the mix keeps the texture's contrast instead of averaging it out
    w = pow(max(w, 1e-5), vec3(hexContrast));
    return (c1 * w.x + c2 * w.y + c3 * w.z) / (w.x + w.y + w.z);
}
`;

/**
 * Slow world space variation on top of the texture so walls don't look uniform from a distance.
 * Uses the fog edits' world position (fogedits.glsl.ts), which is there whenever fog is on.
 */
const macroVariation = /* glsl */ `
// (edits) ${fileName}
#ifdef USE_FOG
    if (!isReflectionPass()) diffuseColor.rgb *= 1.0 + macroStrength * macroNoise(vFogWorldPosition * macroScale);
#endif
`;

/**
 * While a meteor's flash is on, pillar faces it doesn't reach (in a shadow from it, or turned away from it) look darker
 * next to its brightness: their other light is dimmed too, fading out with distance from the flash. Faked, since a
 * shadow only takes away the flash's own light, and the moons and sky would otherwise keep those faces as bright as ever.
 * The flash is the only light casting shadows, so it's the first point light, and the shadow mask is its shadow.
 */
const flashShadowPars = /* glsl */ `
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
// (edits) ${fileName}
uniform float pillarFlashShadow;
`;

const flashShadowFrag = /* glsl */ `
// (edits) ${fileName}
#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
    if (pillarFlashShadow > 0.0 && !isReflectionPass()) {
        vec3 toFlash = pointLights[0].position - geometryPosition;
        float reach = 1.0 - smoothstep(0.0, pointLights[0].distance, length(toFlash));
        float facing = smoothstep(-0.05, 0.25, dot(geometryNormal, normalize(toFlash)));
        outgoingLight *= 1.0 - pillarFlashShadow * reach * (1.0 - getShadowMask() * facing);
    }
#endif
#include <opaque_fragment>
`;

const hexSampled = (chunk: string, sampler: string, uv: string) => {
    const search = `texture2D( ${sampler}, ${uv} )`;
    if (!chunk.includes(search)) console.warn(`Shader chunk no longer contains "${search}"; hex tiling not applied to ${sampler}.`);
    return chunk.split(search).join(`textureHex( ${sampler}, ${uv} )`);
};

export const applyPillarSurface = (params: WebGLProgramParametersWithUniforms, uniforms: { [name: string]: IUniform<number> }) => {
    // chunks are still #includes at this point, so swap in edited copies
    params.fragmentShader = params.fragmentShader
        .replace('#include <common>', `#include <common>\n${hexTilingPars}`)
        .replace('#include <map_fragment>', `${hexSampled(ShaderChunk.map_fragment, 'map', 'vMapUv')}\n${macroVariation}`)
        .replace('#include <normal_fragment_maps>', hexSampled(ShaderChunk.normal_fragment_maps, 'normalMap', 'vNormalMapUv'))
        .replace('#include <shadowmap_pars_fragment>', flashShadowPars)
        .replace('#include <opaque_fragment>', flashShadowFrag);
    // AO and specular are low contrast, their repetition doesn't show, so they keep the plain (cheaper) lookup

    Object.assign(params.uniforms, uniforms);
};
