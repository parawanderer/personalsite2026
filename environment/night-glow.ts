import { Color, IUniform, MeshBasicMaterial, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { degToRad, smoothstep } from 'three/src/math/MathUtils.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { CelestialBody, NightGlowSettings } from '../constants';
import { nightGlowPars, nightGlowUniforms } from '../shaders/night-glow.glsl';


/**
 * Two faint lights of a real night sky, so it isn't a flat black backdrop: the zodiacal light, a tilted cone of
 * sunlight scattered by dust in the planets' plane, rising after dusk from where the large sun set (before dawn where
 * it will rise), and airglow, the upper air's own faint glow, a soft band above the horizon all night.
 */
export class NightGlow implements AnimatedEntity {
    private readonly uniforms = nightGlowUniforms as {
        zodiacalBase: IUniform<Vector3>, zodiacalAxis: IUniform<Vector3>, zodiacalColor: IUniform<Color>, zodiacalLength: IUniform<number>,
        zodiacalWidth: IUniform<number>, airglowColor: IUniform<Color>, airglowPeak: IUniform<number>, airglowWidth: IUniform<number>,
    };
    private night = 0;

    /**
     * @param sun the large sun, whose setting and rising place the zodiacal light
     */
    constructor(skyMaterial: MeshBasicMaterial, private readonly sun: CelestialBody, private readonly hour: () => number, private readonly settings: NightGlowSettings) {
        const previous = skyMaterial.onBeforeCompile;
        skyMaterial.onBeforeCompile = (params, renderer) => {
            previous.call(skyMaterial, params, renderer);
            Object.assign(params.uniforms, this.uniforms);
            params.vertexShader = params.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vNightGlowWorld;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvNightGlowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            params.fragmentShader = params.fragmentShader
                .replace('#include <common>', `#include <common>\nvarying vec3 vNightGlowWorld;\n${nightGlowPars}`)
                .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb += nightGlow(normalize(vNightGlowWorld - cameraPosition));');
        };
        skyMaterial.needsUpdate = true;
    }

    /** how far into the night it is, 0 to 1 */
    public setNight(amount: number): void {
        this.night = amount;
    }

    public update(): void {
        const s = this.settings;
        const u = this.uniforms;
        const b = this.sun;

        // after dusk it rises where the sun set, before dawn where it will rise: strongest once twilight is over,
        // fading as the sun sinks further (evening) or before the sky starts to brighten (morning)
        const h = this.hour();
        const sinceSet = (((h - (b.riseHour + b.hoursUp)) % 24) + 24) % 24;
        const untilRise = (((b.riseHour - h) % 24) + 24) % 24;
        const evening = smoothstep(sinceSet, 0.6, 1.4) * (1 - smoothstep(sinceSet, 2.5, 4));
        const morning = smoothstep(untilRise, 0.6, 1.4) * (1 - smoothstep(untilRise, 2.5, 4));
        const az = degToRad(evening >= morning ? b.azimuthSet : b.azimuthRise);
        u.zodiacalBase.value.set(Math.sin(az), 0, -Math.cos(az));
        // tilted sideways from straight up, the way the sun's path meets the horizon (mirrored at dawn)
        const tilt = degToRad(s.zodiacalTiltDeg) * (evening >= morning ? 1 : -1);
        const side = new Vector3(Math.cos(az), 0, Math.sin(az));
        u.zodiacalAxis.value.set(0, Math.cos(tilt), 0).addScaledVector(side, Math.sin(tilt)).normalize();
        u.zodiacalColor.value.set(s.zodiacalColor).multiplyScalar(s.zodiacal ? s.zodiacalStrength * Math.max(evening, morning) * this.night : 0);
        u.zodiacalLength.value = degToRad(Math.max(s.zodiacalLengthDeg, 1));
        u.zodiacalWidth.value = degToRad(Math.max(s.zodiacalWidthDeg, 1));

        u.airglowColor.value.set(s.airglowColor).multiplyScalar(s.airglow ? s.airglowStrength * this.night : 0);
        u.airglowPeak.value = degToRad(s.airglowPeakDeg);
        u.airglowWidth.value = degToRad(Math.max(s.airglowWidthDeg, 0.5));
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'zodiacal');
        folder.add(s, 'zodiacalStrength', 0, 1, 0.005);
        folder.addColor(s, 'zodiacalColor');
        folder.add(s, 'zodiacalLengthDeg', 5, 90, 1);
        folder.add(s, 'zodiacalWidthDeg', 2, 40, 0.5);
        folder.add(s, 'zodiacalTiltDeg', -60, 60, 1);
        folder.add(s, 'airglow');
        folder.add(s, 'airglowStrength', 0, 0.5, 0.005);
        folder.addColor(s, 'airglowColor');
        folder.add(s, 'airglowPeakDeg', 0, 40, 0.5);
        folder.add(s, 'airglowWidthDeg', 1, 30, 0.5);
    }
}
