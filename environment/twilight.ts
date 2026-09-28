import { Color, MeshBasicMaterial, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { degToRad, smoothstep } from 'three/src/math/MathUtils.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { TwilightSettings } from '../constants';
import { skyGlowUniforms } from '../shaders/sky-glow.glsl';

const pars = /* glsl */ `
// (edits) environment/twilight.ts
varying vec3 vTwilightWorld;
uniform vec3 twilightDir;
uniform vec3 twilightColor;
uniform float twilightWidth;
uniform float twilightHeight;

// the warm glow on the sky around where the sun is going down (or coming up): widest and brightest at the horizon,
// fading upwards and away from the sun along it
vec3 twilightGlow(vec3 dir) {
    vec2 flatDir = normalize(dir.xz + vec2(1e-5));
    float across = acos(clamp(dot(flatDir, normalize(twilightDir.xz + vec2(1e-5))), -1.0, 1.0));
    return twilightColor * exp(-pow(across / twilightWidth, 2.0)) * exp(-max(dir.y, 0.0) / twilightHeight);
}
`;

interface Tinted {
    target: Color;
    color: () => string;
}

/**
 * Sunset and sunrise: while the large sun is low, the scene's colours (as the day/night blend left them) are pulled
 * towards a twilight palette, and a warm glow lies on the sky and the far fog around where the sun is. How much, by
 * the sun's height: rising as it comes down, strongest around the horizon, gone once it's well below.
 * Updated after the day/night blend, every frame.
 */
export class Twilight implements AnimatedEntity {
    private readonly tinted: Tinted[] = [];
    private readonly uniforms = {
        twilightDir: { value: new Vector3(0, 0, -1) },
        twilightColor: { value: new Color(0, 0, 0) },
        twilightWidth: { value: 0.5 },
        twilightHeight: { value: 0.15 },
    };
    private readonly tint = new Color();
    /** 0 to 1, how deep into twilight it is right now */
    public amount = 0;

    /**
     * @param sunDirection towards the large sun, kept up to date (environment/celestial.ts)
     */
    constructor(skyMaterial: MeshBasicMaterial, private readonly sunDirection: Vector3, private readonly settings: TwilightSettings) {
        const previous = skyMaterial.onBeforeCompile;
        skyMaterial.onBeforeCompile = (params, renderer) => {
            previous.call(skyMaterial, params, renderer);
            Object.assign(params.uniforms, this.uniforms);
            params.vertexShader = params.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vTwilightWorld;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvTwilightWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            params.fragmentShader = params.fragmentShader
                .replace('#include <common>', `#include <common>\n${pars}`)
                .replace('#include <opaque_fragment>', '#include <opaque_fragment>\nif (twilightColor.r + twilightColor.g + twilightColor.b > 0.0) gl_FragColor.rgb += twilightGlow(normalize(vTwilightWorld - cameraPosition));');
        };
        skyMaterial.needsUpdate = true;
    }

    /** a colour pulled towards one of the twilight palette's */
    public add(target: Color, color: () => string): this {
        this.tinted.push({ target, color });
        return this;
    }

    public update(): void {
        const s = this.settings;
        const elevation = Math.asin(Math.min(Math.max(this.sunDirection.y, -1), 1)) * 180 / Math.PI;
        // coming in as the sun comes down to the horizon, and going as slowly again as it sinks below (at dawn, the
        // same the other way round)
        const amount = s.enabled
            ? (1 - smoothstep(elevation, s.peakElevationDeg, s.startElevationDeg)) * smoothstep(elevation, s.endElevationDeg, s.peakElevationDeg) * s.strength
            : 0;
        this.amount = amount;
        for (const t of this.tinted) t.target.lerp(this.tint.set(t.color()), amount);

        const u = this.uniforms;
        u.twilightDir.value.copy(this.sunDirection);
        u.twilightColor.value.set(s.glowColor).multiplyScalar(s.glowStrength * amount);
        u.twilightWidth.value = degToRad(Math.max(s.glowWidthDeg, 1));
        u.twilightHeight.value = Math.max(s.glowHeight, 0.005);
        // the far fog picks it up too (shaders/sky-glow.glsl.ts)
        const g = skyGlowUniforms;
        (g.glowTwilightDir.value as Vector3).copy(this.sunDirection);
        (g.glowTwilightColor.value as Color).set(s.glowColor).multiplyScalar(s.fogGlowStrength * amount);
        g.glowTwilightWidth.value = u.twilightWidth.value;
        g.glowTwilightHeight.value = u.twilightHeight.value;
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'enabled');
        folder.add(s, 'strength', 0, 1, 0.01);
        folder.add(s, 'startElevationDeg', 0, 45, 0.5);
        folder.add(s, 'peakElevationDeg', -5, 15, 0.5);
        folder.add(s, 'endElevationDeg', -20, 0, 0.5);
        for (const key of ['sky', 'fogNear', 'fogFar', 'sceneFog', 'light', 'ambient', 'glowColor'] as const) folder.addColor(s, key);
        folder.add(s, 'glowStrength', 0, 3, 0.01);
        folder.add(s, 'fogGlowStrength', 0, 3, 0.01);
        folder.add(s, 'glowWidthDeg', 5, 120, 1);
        folder.add(s, 'glowHeight', 0.01, 0.6, 0.005);
    }
}
