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
uniform vec3 underwaterColor;
uniform float underwaterDensity;
`;

/**
 * Before <premultiplied_alpha_fragment>, so after the regular fog: submerged surfaces are absorbed whatever the
 * above-water fog did to them, and in output colours, so things fade into exactly the colour picked (like fog colours)
 */
const frag = /* glsl */ `
// (edits) ${fileName}
// skip for cameras under the water, which includes the water's own mirror camera
if (vUnderwaterWorldPos.y < waterLevelY && cameraPosition.y > waterLevelY) {
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
    params.fragmentShader = insertBefore(params.fragmentShader, '#include <premultiplied_alpha_fragment>', frag);
    Object.assign(params.uniforms, uniforms);
};
