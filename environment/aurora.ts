import { Clock, Color, DirectionalLight, IUniform, MeshBasicMaterial, Scene, WebGLProgramParametersWithUniforms } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { AuroraSettings } from '../constants';

// each ribbon is drawn at a stack of close heights, fading upwards, which makes it hang like a curtain
const LAYERS = 12;

const auroraPars = /* glsl */ `
// (edits) aurora.ts
varying vec3 vAuroraWorld;
uniform float auroraAmount;
uniform float auroraTime;
uniform vec3 auroraLow;
uniform vec3 auroraHigh;
uniform float auroraHeight;
uniform float auroraScale;
uniform float auroraSharpness;
uniform float auroraHorizon;

float auroraHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float auroraNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(auroraHash(i), auroraHash(i + vec2(1, 0)), f.x), mix(auroraHash(i + vec2(0, 1)), auroraHash(i + vec2(1, 1)), f.x), f.y);
}

// curtains of light: thin ribbons that wander over a plane high above, stacked at a few heights, fading down to the horizon
vec3 aurora(vec3 dir) {
    if (dir.y <= 0.0) return vec3(0.0);
    vec3 light = vec3(0.0);
    // offset the stack per pixel, so the separate heights blend into grain instead of showing as stripes
    float jitter = auroraHash(gl_FragCoord.xy);
    for (int i = 0; i < ${LAYERS}; i++) {
        float layer = (float(i) + jitter) / float(${LAYERS});
        // the same ribbon at rising heights (the planes are closer together than the ribbon moves), so it reads as one curtain
        vec2 p = dir.xz / dir.y * (auroraHeight * (1.0 + layer * 0.5)) * auroraScale;
        float t = auroraTime;
        // where the ribbon runs: a wavy line, bent by slow noise
        vec2 q = dir.xz / dir.y * auroraHeight * auroraScale;
        float bend = auroraNoise(q * 0.35 + vec2(t * 0.05, 0.0)) * 6.0 + sin(q.x * 0.4 + t * 0.2) * 1.2;
        float ribbon = pow(1.0 - abs(sin((p.y + bend) * 0.5)), auroraSharpness);
        // vertical streaks along it, flickering slowly, and fading towards the top of the curtain
        float streaks = 0.55 + 0.45 * auroraNoise(vec2(q.x * 3.0 + t * 0.4, 0.0));
        light += mix(auroraLow, auroraHigh, layer) * ribbon * streaks * (1.0 - layer * 0.8);
    }
    float horizon = smoothstep(0.0, auroraHorizon, dir.y);
    return light / float(${LAYERS}) * 2.5 * horizon * auroraAmount;
}
`;

/**
 * An aurora on the sky dome that fades in at night. It reflects in the water on its own, since the water's mirror
 * renders the dome, and casts a faint coloured light from above so the foreground isn't just silhouettes.
 */
export class Aurora implements AnimatedEntity {
    private readonly uniforms: { [name: string]: IUniform };
    private readonly light = new DirectionalLight();
    private nightAmount = 0;

    constructor(scene: Scene, skyMaterial: MeshBasicMaterial, private readonly settings: AuroraSettings) {
        this.uniforms = {
            auroraAmount: { value: 0 },
            auroraTime: { value: 0 },
            auroraLow: { value: new Color() },
            auroraHigh: { value: new Color() },
            auroraHeight: { value: 1 },
            auroraScale: { value: 1 },
            auroraSharpness: { value: 1 },
            auroraHorizon: { value: 0.1 },
        };

        const previous = skyMaterial.onBeforeCompile;
        skyMaterial.onBeforeCompile = (params, renderer) => {
            previous.call(skyMaterial, params, renderer);
            this.editSky(params);
        };
        skyMaterial.needsUpdate = true;

        this.light.position.set(0, 10, -4);
        scene.add(this.light);
    }

    private editSky(params: WebGLProgramParametersWithUniforms): void {
        params.vertexShader = params.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vAuroraWorld;')
            .replace('#include <fog_vertex>', '#include <fog_vertex>\nvAuroraWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        params.fragmentShader = params.fragmentShader
            .replace('#include <common>', `#include <common>\n${auroraPars}`)
            .replace('#include <opaque_fragment>', '#include <opaque_fragment>\nif (auroraAmount > 0.0) gl_FragColor.rgb += aurora(normalize(vAuroraWorld - cameraPosition));');
        Object.assign(params.uniforms, this.uniforms);
    }

    /** 0 by day, 1 at night, from the day/night cycle */
    public setNight(amount: number): void {
        this.nightAmount = amount;
    }

    public update(clock: Clock): void {
        const s = this.settings;
        const u = this.uniforms;
        u.auroraAmount.value = s.brightness * this.nightAmount;
        u.auroraTime.value = clock.elapsedTime * s.speed;
        u.auroraLow.value.set(s.colorLow);
        u.auroraHigh.value.set(s.colorHigh);
        u.auroraHeight.value = s.height;
        u.auroraScale.value = s.scale;
        u.auroraSharpness.value = s.sharpness;
        u.auroraHorizon.value = Math.max(s.horizonFade, 1e-3);

        this.light.color.set(s.colorLow).lerp(new Color(s.colorHigh), 0.35);
        this.light.intensity = s.lightIntensity * this.nightAmount;
        this.light.visible = this.light.intensity > 0;
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.addColor(s, 'colorLow');
        folder.addColor(s, 'colorHigh');
        folder.add(s, 'brightness', 0, 3, 0.01);
        folder.add(s, 'height', 0.1, 5, 0.05);
        folder.add(s, 'scale', 0.05, 3, 0.01);
        folder.add(s, 'sharpness', 1, 60, 0.5);
        folder.add(s, 'speed', 0, 3, 0.01);
        folder.add(s, 'horizonFade', 0.01, 0.6, 0.01);
        folder.add(s, 'lightIntensity', 0, 3, 0.01);
    }
}
