import { Matrix3, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { degToRad } from 'three/src/math/MathUtils.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { snellPars, snellUniforms } from '../shaders/snell-window.glsl';
import { StarSettings } from '../constants';

const pars = /* glsl */ `
// (edits) environment/stars.ts
varying vec3 vStarWorld;
uniform float starAmount;
uniform float starCells;
uniform float starShare;
uniform float starSize;
uniform float starTwinkle;
uniform float starTwinkleSpeed;
uniform float starTime;
uniform vec3 starBandNormal;
uniform float starBand;
uniform float starBandGlow;
uniform float starTint;
uniform float starHorizon;
// the sky's turn: stars (and their band) are placed in a frame that rotates around the celestial pole with the time of day
uniform mat3 starRotation;

float starHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

vec3 starHash3(vec3 p) {
    return vec3(starHash(p), starHash(p + 17.31), starHash(p + 41.97));
}

// a star field on the sky: at most one star per cell of a grid over directions, at a random spot inside it (kept off the
// cell's edges, so a pixel only has to look at its own cell), drawn as a soft dot a pixel or two wide whatever the
// resolution. Denser along a tilted band, with a faint glow along it, and fading towards the hazy horizon
vec3 stars(vec3 dir) {
    float horizon = smoothstep(0.0, starHorizon, dir.y);
    if (horizon <= 0.0) return vec3(0.0);
    dir = starRotation * dir;

    // how far apart neighbouring pixels look, as an angle
    float pixel = length(fwidth(dir));
    vec3 cell = floor(dir * starCells);
    vec3 r = starHash3(cell);

    // closer to the band: more of the cells have a star
    float bandCloseness = 1.0 - smoothstep(0.0, 0.35, abs(dot(dir, starBandNormal)));
    float share = starShare * (1.0 + starBand * 2.0 * bandCloseness);
    vec3 glow = vec3(0.55, 0.62, 0.8) * starBandGlow * bandCloseness * bandCloseness;

    if (r.x > share) return glow * horizon;
    vec3 centre = normalize((cell + 0.25 + 0.5 * starHash3(cell + 7.7)) / starCells);
    float d = length(dir - centre) / (pixel * starSize);
    float spot = exp(-d * d * 2.0);
    // mostly faint, a few bright
    float brightness = 0.06 + 1.8 * pow(r.y, 10.0);
    float twinkle = 1.0 - starTwinkle * (0.5 + 0.5 * sin(starTime * starTwinkleSpeed * (0.6 + r.z) + r.z * 40.0));
    vec3 tint = mix(vec3(1.0), mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.85, 0.7), r.z), starTint);
    return (tint * spot * brightness * twinkle + glow) * horizon;
}
`;

/**
 * Stars on the night sky, behind the aurora, drawn into the sky dome's own shader (so the water reflects them too)
 */
export class Stars implements AnimatedEntity {
    private readonly uniforms = {
        starAmount: { value: 0 },
        starCells: { value: 1 },
        starShare: { value: 0 },
        starSize: { value: 1 },
        starTwinkle: { value: 0 },
        starTwinkleSpeed: { value: 1 },
        starTime: { value: 0 },
        starBandNormal: { value: new Vector3(0, 1, 0) },
        starBand: { value: 0 },
        starBandGlow: { value: 0 },
        starTint: { value: 0 },
        starHorizon: { value: 0.2 },
        starRotation: { value: new Matrix3() },
    };
    private readonly rotation = new Matrix4();
    private readonly pole = new Vector3();
    private night = 0;

    /**
     * @param hour the time of day: the sky turns once around the pole every 24 hours
     */
    constructor(skyMaterial: MeshBasicMaterial, private readonly settings: StarSettings, private readonly hour: () => number) {
        const previous = skyMaterial.onBeforeCompile;
        skyMaterial.onBeforeCompile = (params, renderer) => {
            previous.call(skyMaterial, params, renderer);
            Object.assign(params.uniforms, this.uniforms, snellUniforms);
            params.vertexShader = params.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vStarWorld;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvStarWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            params.fragmentShader = params.fragmentShader
                .replace('#include <common>', `#include <common>\n${pars}\n${snellPars}`)
                // before the aurora is added on top: it's glowing gas in front of them
                .replace('#include <opaque_fragment>', '#include <opaque_fragment>\nif (starAmount > 0.0) gl_FragColor.rgb += stars(snellAirDir(normalize(vStarWorld - cameraPosition))) * starAmount * snellThrough(normalize(vStarWorld - cameraPosition));');
        };
        skyMaterial.needsUpdate = true;
    }

    /** how far into the night it is, 0 to 1 */
    public setNight(amount: number): void {
        this.night = amount;
    }

    public update(clock: { elapsedTime: number }): void {
        const s = this.settings;
        const u = this.uniforms;
        u.starAmount.value = s.brightness * this.night;
        u.starCells.value = s.density;
        u.starShare.value = s.share;
        u.starSize.value = s.size;
        u.starTwinkle.value = s.twinkle;
        u.starTwinkleSpeed.value = s.twinkleSpeed;
        u.starTime.value = clock.elapsedTime;
        u.starBand.value = s.band;
        u.starBandGlow.value = s.bandGlow;
        u.starTint.value = s.tint;
        u.starHorizon.value = Math.max(s.horizon, 1e-3);
        // the pole: up at poleElevationDeg above the horizon, towards poleAzimuthDeg (0 down the channel, 90 is +x)
        const el = degToRad(s.poleElevationDeg);
        const az = degToRad(s.poleAzimuthDeg);
        this.pole.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
        this.rotation.makeRotationAxis(this.pole, (this.hour() / 24) * Math.PI * 2 * s.turnsPerDay);
        u.starRotation.value.setFromMatrix4(this.rotation);

        // the band's great circle, tilted from the vertical and turned around it
        u.starBandNormal.value.set(1, 0, 0)
            .applyAxisAngle(new Vector3(0, 0, 1), degToRad(s.bandTiltDeg))
            .applyAxisAngle(new Vector3(0, 1, 0), degToRad(s.bandTurnDeg));
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'brightness', 0, 5, 0.05);
        folder.add(s, 'density', 20, 800, 1);
        folder.add(s, 'share', 0, 1, 0.01);
        folder.add(s, 'size', 0.3, 4, 0.05);
        folder.add(s, 'twinkle', 0, 1, 0.01);
        folder.add(s, 'twinkleSpeed', 0, 10, 0.1);
        folder.add(s, 'band', 0, 3, 0.05);
        folder.add(s, 'bandGlow', 0, 0.3, 0.005);
        folder.add(s, 'bandTiltDeg', -90, 90, 1);
        folder.add(s, 'bandTurnDeg', -180, 180, 1);
        folder.add(s, 'tint', 0, 1, 0.01);
        folder.add(s, 'horizon', 0.01, 1, 0.01);
        folder.add(s, 'poleElevationDeg', -90, 90, 1);
        folder.add(s, 'poleAzimuthDeg', -180, 180, 1);
        folder.add(s, 'turnsPerDay', -3, 3, 0.05);
    }
}
