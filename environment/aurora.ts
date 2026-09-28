import { Clock, Color, DirectionalLight, IUniform, MeshBasicMaterial, Scene, WebGLProgramParametersWithUniforms } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { AuroraSettings } from '../constants';

const smooth = (t: number) => t * t * (3 - 2 * t);

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

// curtains of light: thin ribbons that wander over a plane high above, stacked at a few heights, fading down to the horizon.
// sharpness narrows the ribbons; the water uses a low one for a soft, blurred version
// jitter offsets the stack of heights (0-1)
vec3 auroraLight(vec3 dir, float sharpness, const int layers, float jitter) {
    if (dir.y <= 0.0) return vec3(0.0);
    vec3 light = vec3(0.0);
    for (int i = 0; i < layers; i++) {
        float layer = (float(i) + jitter) / float(layers);
        // the same ribbon at rising heights (the planes are closer together than the ribbon moves), so it reads as one curtain
        vec2 p = dir.xz / dir.y * (auroraHeight * (1.0 + layer * 0.5)) * auroraScale;
        float t = auroraTime;
        // where the ribbon runs: a wavy line, bent by slow noise
        vec2 q = dir.xz / dir.y * auroraHeight * auroraScale;
        float bend = auroraNoise(q * 0.35 + vec2(t * 0.05, 0.0)) * 6.0 + sin(q.x * 0.4 + t * 0.2) * 1.2;
        float ribbon = pow(1.0 - abs(sin((p.y + bend) * 0.5)), sharpness);
        // vertical streaks along it, flickering slowly, and fading towards the top of the curtain
        float streaks = 0.55 + 0.45 * auroraNoise(vec2(q.x * 3.0 + t * 0.4, 0.0));
        light += mix(auroraLow, auroraHigh, layer) * ribbon * streaks * (1.0 - layer * 0.8);
    }
    float horizon = smoothstep(0.0, auroraHorizon, dir.y);
    return light / float(layers) * 2.5 * horizon * auroraAmount;
}

// interleaved gradient noise (Jimenez 2014): an even, fine per-pixel pattern, much less grainy than white noise
float auroraIgn(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 aurora(vec3 dir) {
    // offset the stack per pixel, so the separate heights blend into a fine pattern instead of showing as stripes
    return auroraLight(dir, auroraSharpness, ${LAYERS}, auroraIgn(gl_FragCoord.xy));
}
`;

/**
 * For the water: a blurred aurora in the direction the surface reflects, stretched out along the surface like a
 * reflection smeared by ripples. Uses its own uniform names' values (the same object), shared with the sky
 */
const waterGlowPars = /* glsl */ `
${auroraPars.replace('varying vec3 vAuroraWorld;', '')}
uniform float auroraWaterStrength;
uniform float auroraWaterSoftness;
uniform float auroraWaterStretch;
// how much of the ripples the glow follows (0 = a smooth mirror)
uniform float auroraWaterRipple;
// radius of the blur around the reflected aurora, radians
uniform float auroraWaterBlur;
// 0 = smooth fixed sampling, 1 = fully random per pixel (grainier, but no visible sample copies)
uniform float auroraWaterNoise;

vec3 auroraWaterGlow(vec3 reflected) {
    if (auroraAmount <= 0.0 || auroraWaterStrength <= 0.0) return vec3(0.0);
    // flatten the reflected direction towards the horizon: the glow reaches further down the water, like a long streak
    vec3 dir = normalize(vec3(reflected.x, max(reflected.y, 0.0) / auroraWaterStretch + 0.02, reflected.z));
    float sharpness = max(auroraSharpness * auroraWaterSoftness, 1.0);
    // per-pixel randomness: hides the separate samples, at the cost of visible grain (auroraWaterNoise sets how much)
    float noise = auroraHash(gl_FragCoord.yx);
    float jitter = mix(0.5, noise, auroraWaterNoise);
    if (auroraWaterBlur <= 0.001) return auroraLight(dir, sharpness, 4, jitter) * auroraWaterStrength;

    // a gaussian blur around the direction: the centre plus two rings of 4 (at half and full radius, the outer one
    // turned by 45 degrees), rotated per pixel by the noise
    vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 up = cross(side, dir);
    float spin = noise * 6.2831853 * auroraWaterNoise;
    vec3 sum = auroraLight(dir, sharpness, 2, jitter);
    float total = 1.0;
    for (int i = 0; i < 8; i++) {
        bool outer = i >= 4;
        float r = auroraWaterBlur * (outer ? 1.0 : 0.5);
        // sigma = radius / 2
        float w = outer ? 0.135 : 0.607;
        float a = spin + float(i) * 1.5707963 + (outer ? 0.785398 : 0.0);
        vec3 d = normalize(dir + (side * cos(a) + up * sin(a)) * tan(r));
        sum += auroraLight(d, sharpness, 2, jitter) * w;
        total += w;
    }
    return sum / total * auroraWaterStrength;
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

    constructor(scene: Scene, skyMaterial: MeshBasicMaterial, private readonly settings: AuroraSettings, private readonly hour: () => number) {
        this.uniforms = {
            auroraAmount: { value: 0 },
            auroraTime: { value: 0 },
            auroraLow: { value: new Color() },
            auroraHigh: { value: new Color() },
            auroraHeight: { value: 1 },
            auroraScale: { value: 1 },
            auroraSharpness: { value: 1 },
            auroraHorizon: { value: 0.1 },
            auroraWaterStrength: { value: 0 },
            auroraWaterSoftness: { value: 0.2 },
            auroraWaterStretch: { value: 2 },
            auroraWaterRipple: { value: 0.3 },
            auroraWaterBlur: { value: 0 },
            auroraWaterNoise: { value: 1 },
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

    /**
     * Adds the blurred aurora glow to the water's colour (see waterGlowPars). Call once the water material exists
     */
    public addToWater(extend: (edit: (params: WebGLProgramParametersWithUniforms) => void) => void): void {
        extend((params) => {
            params.fragmentShader = params.fragmentShader
                .replace('uniform float alpha;', `uniform float alpha;\n${waterGlowPars}`)
                .replace('vec3 outgoingLight = albedo;', 'vec3 outgoingLight = albedo + auroraWaterGlow( reflect( -eyeDirection, normalize( mix( vec3( 0.0, 1.0, 0.0 ), surfaceNormal, auroraWaterRipple ) ) ) );');
            if (!params.fragmentShader.includes('auroraWaterGlow( reflect')) console.warn('Water shader changed; aurora glow not applied.');
            Object.assign(params.uniforms, this.uniforms);
        });
    }

    /** 0 by day, 1 at night, from the day/night cycle */
    public setNight(amount: number): void {
        this.nightAmount = amount;
    }

    /** 0-1, how far it has come out by this hour; the night wraps round midnight */
    private get presence(): number {
        const s = this.settings;
        // hours since the fade-in started, 0-24
        const since = (h: number) => ((this.hour() - h) % 24 + 24) % 24;
        const inLength = ((s.fadeInEnd - s.fadeInStart) % 24 + 24) % 24 || 1e-3;
        const outLength = ((s.fadeOutEnd - s.fadeOutStart) % 24 + 24) % 24 || 1e-3;
        const untilOut = ((s.fadeOutStart - s.fadeInStart) % 24 + 24) % 24;
        const t = since(s.fadeInStart);
        if (t < inLength) return smooth(t / inLength);
        if (t < untilOut) return 1;
        if (t < untilOut + outLength) return 1 - smooth((t - untilOut) / outLength);
        return 0;
    }

    /** 0-1, how much it's out right now (the night times its hours) */
    public get amount(): number {
        return this.nightAmount * this.presence;
    }

    public update(clock: Clock): void {
        const s = this.settings;
        const u = this.uniforms;
        const amount = this.amount;
        u.auroraAmount.value = s.brightness * amount;
        u.auroraTime.value = clock.elapsedTime * s.speed;
        u.auroraLow.value.set(s.colorLow);
        u.auroraHigh.value.set(s.colorHigh);
        u.auroraHeight.value = s.height;
        u.auroraScale.value = s.scale;
        u.auroraSharpness.value = s.sharpness;
        u.auroraHorizon.value = Math.max(s.horizonFade, 1e-3);
        u.auroraWaterStrength.value = s.waterGlow;
        u.auroraWaterSoftness.value = s.waterSoftness;
        u.auroraWaterStretch.value = Math.max(s.waterStretch, 0.1);
        u.auroraWaterRipple.value = s.waterRipple;
        u.auroraWaterBlur.value = s.waterBlur * Math.PI / 180;
        u.auroraWaterNoise.value = s.waterBlurNoise;

        this.light.color.set(s.colorLow).lerp(new Color(s.colorHigh), 0.35);
        this.light.intensity = s.lightIntensity * amount;
        // stays in the scene at zero intensity rather than being hidden: adding or removing a light recompiles every
        // lit material's shader, a stall
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
        folder.add(s, 'waterGlow', 0, 3, 0.01);
        folder.add(s, 'waterSoftness', 0.02, 1, 0.01);
        folder.add(s, 'waterStretch', 0.5, 10, 0.1);
        folder.add(s, 'waterRipple', 0, 1, 0.01);
        folder.add(s, 'waterBlur', 0, 45, 0.5).name('waterBlur (deg)');
        folder.add(s, 'waterBlurNoise', 0, 1, 0.01);
        folder.add(s, 'fadeInStart', 0, 24, 0.1);
        folder.add(s, 'fadeInEnd', 0, 24, 0.1);
        folder.add(s, 'fadeOutStart', 0, 24, 0.1);
        folder.add(s, 'fadeOutEnd', 0, 24, 0.1);
    }
}
