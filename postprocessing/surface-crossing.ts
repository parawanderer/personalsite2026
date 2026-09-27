import { Color, ShaderMaterial } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { SurfaceCrossingSettings } from '../constants';

const shader = {
    name: 'SurfaceCrossingShader',
    uniforms: {
        tDiffuse: { value: null },
        amount: { value: 0 },
        time: { value: 0 },
        tint: { value: new Color() },
        blur: { value: 0.01 },
        wobble: { value: 0.01 },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float amount;
        uniform float time;
        uniform vec3 tint;
        uniform float blur;
        uniform float wobble;
        varying vec2 vUv;
        void main() {
            // the frame seen through a sheet of moving fluid: rippled, smeared, tinted
            vec2 uv = vUv + amount * wobble * vec2(sin(vUv.y * 23.0 + time * 7.0), sin(vUv.x * 17.0 - time * 5.0));
            vec3 c = vec3(0.0);
            float r = blur * amount;
            // two rings of samples, the inner one turned half a step, so small bright things don't turn into rings
            for (int i = 0; i < 8; i++) {
                float a = float(i) * 0.785398;
                c += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * r).rgb;
                c += texture2D(tDiffuse, uv + vec2(cos(a + 0.3927), sin(a + 0.3927)) * r * 0.5).rgb;
            }
            c = mix(texture2D(tDiffuse, uv).rgb, c / 16.0, min(amount * 1.5, 1.0));
            c = mix(c, tint, amount * 0.5);
            gl_FragColor = vec4(c, 1.0);
        }
    `,
};

/**
 * Passing through the water's surface: the camera would otherwise see it edge-on as a flat band. While the camera is
 * within a few centimetres of the surface, and for a moment after it crosses, the frame blurs, ripples and tints
 * towards the side it's going into. Skipped the rest of the time.
 */
export class SurfaceCrossingPass extends ShaderPass {
    private wasUnder = false;
    private crossedAt = -1e3;

    constructor(private readonly settings: SurfaceCrossingSettings) {
        super(shader);
        this.enabled = false;
    }

    /**
     * @param height the camera's height above the water surface
     * @param waterColor the underwater colour (the tint going under), shared
     * @param airColor the fog colour above (the tint coming up), shared
     */
    public update(height: number, time: number, waterColor: Color, airColor: Color): void {
        const s = this.settings;
        const under = height < 0;
        if (under !== this.wasUnder) {
            this.wasUnder = under;
            this.crossedAt = time;
        }
        const near = 1 - Math.min(Math.abs(height) / Math.max(s.band, 1e-3), 1);
        const after = Math.max(1 - (time - this.crossedAt) / Math.max(s.seconds, 0.01), 0);
        const amount = s.enabled ? Math.max(near, after) : 0;
        this.enabled = amount > 0.001;
        if (!this.enabled) return;
        const u = (this.material as ShaderMaterial).uniforms;
        u.amount.value = amount;
        u.time.value = time;
        u.tint.value.copy(under ? waterColor : airColor);
        u.blur.value = s.blur;
        u.wobble.value = s.wobble;
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'enabled');
        folder.add(s, 'band', 0.01, 0.5, 0.005);
        folder.add(s, 'seconds', 0.05, 2, 0.05);
        folder.add(s, 'blur', 0, 0.05, 0.001);
        folder.add(s, 'wobble', 0, 0.05, 0.001);
    }
}
