import { Color, IUniform, ShaderChunk, WebGLProgramParametersWithUniforms } from "three";

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
// 1 while the water renders its reflection, which only needs the plain texture. Set around that render
// (Walls.setReflectionPass), not guessed from the camera's height: the camera itself can be under the water
uniform float reflectionPass;

bool isReflectionPass() {
    return reflectionPass > 0.5;
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
 * Dust on the pillars' tops: the volcano's ash and glass flakes settle on whatever faces up, in drifts broken up by
 * noise. Where it lies the rock loses its polish (rougher, no iridescent film, a soft velvet sheen at grazing angles
 * instead) and takes on the dust's colour only slightly, so the tops stay dark shapes. Kept up to date by
 * main.ts; dustAmount 0 turns it off.
 */
export const dustUniforms: { [name: string]: IUniform } = {
    dustAmount: { value: 0 },
    dustCoverage: { value: 0.5 },
    dustScale: { value: 2 },
    dustRoughness: { value: 0.9 },
    dustColor: { value: new Color() },
    dustTint: { value: 0.15 },
    dustSheen: { value: new Color() },
    // grains: cells per metre (one grain at most in each), and the share of cells that have one
    dustGrainCells: { value: 60 },
    dustGrainShare: { value: 0.4 },
};

const dustPars = /* glsl */ `
// (edits) ${fileName}
uniform float dustAmount;
uniform float dustCoverage;
uniform float dustScale;
uniform float dustRoughness;
uniform vec3 dustColor;
uniform float dustTint;
uniform vec3 dustSheen;
uniform float dustGrainCells;
uniform float dustGrainShare;
`;

// after the normals: how much dust lies here, and the rock's polish taken off under it
const dustFrag = /* glsl */ `
// (edits) ${fileName}
float pillarDust = 0.0;
#ifdef USE_FOG
    if (dustAmount > 0.0 && !isReflectionPass()) {
        vec3 dustUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
        float facing = dot(normalize(nonPerturbedNormal), dustUp);
        // how many pixels a grain cell spans (worked out before any branching: derivatives aren't reliable inside it)
        float grainPixels = 1.0 / max(length(fwidth(vFogWorldPosition.xz)) * dustGrainCells, 1e-4);
        // only on what faces up: the sides skip the rest
        if (facing > 0.55) {
        vec3 dp = vFogWorldPosition * dustScale;
        float drifts = 0.5 + 0.5 * (0.65 * macroNoise(dp) + 0.35 * macroNoise(dp * 4.3));
        // settles on what faces up, thinning towards the edges of the drifts
        pillarDust = smoothstep(0.55, 0.85, facing) * smoothstep(1.0 - dustCoverage, 1.15 - dustCoverage, drifts) * dustAmount;
        roughnessFactor = mix(roughnessFactor, dustRoughness, pillarDust);
        diffuseColor.rgb = mix(diffuseColor.rgb, dustColor, pillarDust * dustTint);
        // up close it's grains, not a haze: many fine specks and a few bigger flakes, each an irregular shard at its
        // own strength, pale ash and now and then a dark glassy one that glints. In world units on the flat (it lies on
        // what faces up); a layer fades out once its grains get smaller than a couple of pixels, where they'd only
        // flicker, leaving the tone above
        // and the grains only where there's dust, near enough for them to show
        if (pillarDust > 0.0 && grainPixels > 2.0) for (int layer = 0; layer < 2; layer++) {
            float cells = layer == 0 ? dustGrainCells * 2.5 : dustGrainCells;
            float share = layer == 0 ? dustGrainShare : dustGrainShare * 0.3;
            vec2 gp = vFogWorldPosition.xz * cells + float(layer) * 17.0;
            vec2 gcell = floor(gp);
            float gr = macroHash(vec3(gcell, 3.7));
            if (gr > share) continue;
            vec2 gat = vec2(macroHash(vec3(gcell, 1.3)), macroHash(vec3(gcell, 8.9))) * 0.6 + 0.2;
            // a shard: stretched and turned its own way, its outline notched
            float turn = macroHash(vec3(gcell, 2.9)) * 6.2831853;
            vec2 d = fract(gp) - gat;
            d = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * d * vec2(1.0, 1.4 + 1.6 * macroHash(vec3(gcell, 6.3)));
            float notch = 0.8 + 0.2 * sin(atan(d.y, d.x) * 5.0 + gr * 30.0);
            float gsize = 0.08 + 0.18 * macroHash(vec3(gcell, 5.1));
            float grain = 1.0 - smoothstep(gsize * notch * 0.7, gsize * notch, length(d));
            float cellPixels = grainPixels * (layer == 0 ? 0.4 : 1.0);
            grain *= smoothstep(2.0, 5.0, cellPixels) * pillarDust * (0.35 + 0.5 * macroHash(vec3(gcell, 9.7)));
            bool glassy = macroHash(vec3(gcell, 11.3)) < 0.2;
            diffuseColor.rgb = mix(diffuseColor.rgb, glassy ? diffuseColor.rgb * 0.4 : dustColor, grain);
            if (glassy) roughnessFactor = mix(roughnessFactor, 0.15, grain);
        }
        }
    }
#endif
`;

// after the physical material is set up: dust has no iridescent film, and scatters light back softly at grazing angles
const dustLights = /* glsl */ `
// (edits) ${fileName}
#ifdef USE_IRIDESCENCE
    material.iridescence *= 1.0 - pillarDust;
#endif
#ifdef USE_SHEEN
    material.sheenColor = mix(material.sheenColor, dustSheen, pillarDust);
    material.sheenRoughness = mix(material.sheenRoughness, 0.8, pillarDust);
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
        .replace('#include <common>', `#include <common>\n${hexTilingPars}\n${dustPars}`)
        .replace('#include <map_fragment>', `${hexSampled(ShaderChunk.map_fragment, 'map', 'vMapUv')}\n${macroVariation}`)
        .replace('#include <normal_fragment_maps>', `${hexSampled(ShaderChunk.normal_fragment_maps, 'normalMap', 'vNormalMapUv')}\n${dustFrag}`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${dustLights}`)
        .replace('#include <shadowmap_pars_fragment>', flashShadowPars)
        .replace('#include <opaque_fragment>', flashShadowFrag);
    // AO and specular are low contrast, their repetition doesn't show, so they keep the plain (cheaper) lookup

    Object.assign(params.uniforms, uniforms, dustUniforms);
};
