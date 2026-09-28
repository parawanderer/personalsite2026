import { Color, DirectionalLight, MeshBasicMaterial, Scene, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { degToRad } from 'three/src/math/MathUtils.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { VolcanicGlowSettings } from '../constants';
import { skyGlowUniforms } from '../shaders/sky-glow.glsl';

const pars = /* glsl */ `
// (edits) environment/volcanic-glow.ts
varying vec3 vGlowWorld;
uniform vec3 volcanoDir;
uniform vec3 volcanoColor;
uniform float volcanoWidth;
uniform float volcanoHeight;
uniform float volcanoFlicker;
uniform float volcanoTime;

float volcanoHash(float x) { return fract(sin(x * 91.7) * 43758.5453); }
float volcanoNoise(float x) {
    float i = floor(x);
    float f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(volcanoHash(i), volcanoHash(i + 1.0), f);
}

// a smouldering glow low on the horizon towards the volcano: widest and brightest at the horizon, fading upwards, uneven
// along it (a few brighter vents), slowly flickering
vec3 volcanoGlow(vec3 dir) {
    vec2 flatDir = normalize(dir.xz + vec2(1e-5));
    float across = acos(clamp(dot(flatDir, normalize(volcanoDir.xz)), -1.0, 1.0));
    float horizontal = exp(-pow(across / volcanoWidth, 2.0));
    float up = max(dir.y, -0.02);
    float vertical = exp(-max(up, 0.0) / volcanoHeight) * smoothstep(-0.03, 0.0, up);
    float angle = atan(flatDir.x, flatDir.y);
    float vents = 0.6 + 0.8 * volcanoNoise(angle * 18.0 + 3.0) * volcanoNoise(angle * 7.0 - 1.0);
    float flicker = 1.0 - volcanoFlicker * volcanoNoise(volcanoTime * 0.7 + angle * 3.0);
    return volcanoColor * horizontal * vertical * vents * flicker;
}
`;

/**
 * At night, a volcano somewhere past the canyon's walls: a red glow low on one horizon, and the dim red light it throws
 * across the pillars from that side (their red at night). Fades in with the night.
 */
export class VolcanicGlow implements AnimatedEntity {
    private readonly light = new DirectionalLight();
    private readonly uniforms = {
        volcanoDir: { value: new Vector3(0, 0, -1) },
        volcanoColor: { value: new Color() },
        volcanoWidth: { value: 0.4 },
        volcanoHeight: { value: 0.1 },
        volcanoFlicker: { value: 0 },
        volcanoTime: { value: 0 },
    };
    private night = 0;
    private readonly direction = new Vector3();
    private readonly toLight = new Vector3();
    private readonly waterColor = new Color();
    /** told the light's direction (towards it) and the colour the water scatters back, every frame */
    public onWaterLight?: (direction: Vector3, color: Color) => void;

    constructor(scene: Scene, skyMaterial: MeshBasicMaterial, private readonly settings: VolcanicGlowSettings) {
        // always in the scene (zero intensity by day): adding or removing a light recompiles every lit material
        scene.add(this.light);
        scene.add(this.light.target);

        const previous = skyMaterial.onBeforeCompile;
        skyMaterial.onBeforeCompile = (params, renderer) => {
            previous.call(skyMaterial, params, renderer);
            Object.assign(params.uniforms, this.uniforms);
            params.vertexShader = params.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vGlowWorld;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            params.fragmentShader = params.fragmentShader
                .replace('#include <common>', `#include <common>\n${pars}`)
                .replace('#include <opaque_fragment>', '#include <opaque_fragment>\nif (volcanoColor.r + volcanoColor.g + volcanoColor.b > 0.0) gl_FragColor.rgb += volcanoGlow(normalize(vGlowWorld - cameraPosition));');
        };
        skyMaterial.needsUpdate = true;
    }

    /** how far into the night it is, 0 to 1 */
    public setNight(amount: number): void {
        this.night = amount;
    }

    public update(clock: { elapsedTime: number }): void {
        const s = this.settings;
        const az = degToRad(s.azimuthDeg);
        this.direction.set(Math.sin(az), 0, -Math.cos(az));
        const flicker = 1 - s.flicker * 0.5 * (1 + Math.sin(clock.elapsedTime * 0.9) * Math.sin(clock.elapsedTime * 0.37 + 1.3));

        const u = this.uniforms;
        u.volcanoDir.value.copy(this.direction);
        u.volcanoColor.value.set(s.color).multiplyScalar(s.skyStrength * this.night);
        u.volcanoWidth.value = degToRad(Math.max(s.widthDeg, 1));
        u.volcanoHeight.value = Math.max(s.height, 0.005);
        u.volcanoFlicker.value = s.flicker;
        u.volcanoTime.value = clock.elapsedTime;
        // the fog towards it takes on its glow too (shaders/sky-glow.glsl.ts)
        const g = skyGlowUniforms;
        (g.glowVolcanoDir.value as Vector3).copy(this.direction);
        (g.glowVolcanoColor.value as Color).set(s.color).multiplyScalar(s.fogStrength * this.night * flicker);
        g.glowVolcanoWidth.value = u.volcanoWidth.value;
        g.glowVolcanoHeight.value = u.volcanoHeight.value;
        g.glowVolcanoByHeight.value = s.fogByHeight ? 1 : 0;

        // its light comes in low, from just above the horizon
        const el = degToRad(s.lightElevationDeg);
        this.light.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(50);
        this.light.target.position.set(0, 0, 0);
        this.light.color.set(s.color);
        this.light.intensity = s.lightStrength * this.night * flicker;
        this.toLight.copy(this.light.position).normalize();
        this.waterColor.set(s.color).multiplyScalar(s.waterScatter * this.night * flicker);
        this.onWaterLight?.(this.toLight, this.waterColor);
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.addColor(s, 'color');
        folder.add(s, 'azimuthDeg', -180, 180, 1);
        folder.add(s, 'widthDeg', 5, 120, 1);
        folder.add(s, 'height', 0.01, 0.5, 0.005);
        folder.add(s, 'skyStrength', 0, 2, 0.01);
        folder.add(s, 'lightStrength', 0, 5, 0.05);
        folder.add(s, 'lightElevationDeg', 0, 45, 0.5);
        folder.add(s, 'flicker', 0, 1, 0.01);
        folder.add(s, 'waterScatter', 0, 1, 0.005);
        folder.add(s, 'fogStrength', 0, 2, 0.01);
        folder.add(s, 'fogByHeight');
    }
}
