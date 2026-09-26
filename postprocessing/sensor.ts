import { Camera, Color, Vector2, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { SensorSettings } from '../constants';

const SensorShader = {
    name: 'SensorShader',
    uniforms: {
        tDiffuse: { value: null },
        exposure: { value: 1 },
        // 0 to 1: how far the brightest parts are pushed flat white
        clip: { value: 0 },
        // where the flash is on screen (0 to 1), and how strong its smear is there
        smearAt: { value: new Vector2() },
        smear: { value: 0 },
        smearWidth: { value: 0.004 },
        smearColor: { value: new Color() },
        aspect: { value: 1 },
        chroma: { value: 0 },
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
        uniform float exposure;
        uniform float clip;
        uniform vec2 smearAt;
        uniform float smear;
        uniform float smearWidth;
        uniform vec3 smearColor;
        uniform float aspect;
        uniform float chroma;
        varying vec2 vUv;

        void main() {
            // the colour channels saturate at slightly different rates at the peak
            vec2 shift = vec2(chroma, 0.0);
            vec3 c = vec3(
                texture2D(tDiffuse, vUv + shift).r,
                texture2D(tDiffuse, vUv).g,
                texture2D(tDiffuse, vUv - shift).b
            );
            c *= exposure;

            // overloaded pixels lose their colour and detail: the brightest channel spreads to the others
            float peak = max(c.r, max(c.g, c.b));
            c = mix(c, vec3(peak), clip * smoothstep(0.35, 1.0, peak));

            // a CCD's overflow: the overloaded point bleeds into a thin vertical column through the whole frame,
            // strongest around the point itself
            if (smear > 0.0) {
                float dx = (vUv.x - smearAt.x) * aspect / smearWidth;
                float column = exp(-dx * dx) + 0.25 * exp(-dx * dx * 0.04);
                float along = 0.55 + 0.45 * exp(-abs(vUv.y - smearAt.y) * 4.0);
                c += smearColor * column * along * smear;
            }

            gl_FragColor = vec4(c, 1.0);
        }
    `,
};

/**
 * The camera as a sensor on another planet rather than an eye: a meteor's flash overexposes it (clipped highlights, a
 * vertical smear through the frame, a colour offset), its auto-exposure lags behind and overshoots into too dark as the
 * flash fades, and it recovers with its gain (grain) briefly raised. Skipped while there's no flash.
 */
export class SensorPass extends ShaderPass {
    /** how far the auto-exposure has adapted to the flash, 0 to 1 */
    private adapted = 0;
    private flash = 0;
    private lastTime = performance.now();
    private readonly screen = new Vector3();

    /**
     * @param setGrain sets the film grain's strength, raised while the sensor recovers
     */
    constructor(private readonly camera: Camera, private readonly settings: SensorSettings, private readonly setGrain: (boost: number) => void) {
        super(SensorShader);
        this.enabled = false;
    }

    /** the flash this frame: its brightness (0 to 1), colour, and where it is */
    public setFlash(amount: number, color: Color, at: Vector3): void {
        this.flash = amount;
        const u = this.uniforms;
        u.smearColor.value.copy(color);
        this.screen.copy(at).project(this.camera);
        // on screen and in front of the camera
        const visible = Math.abs(this.screen.x) <= 1.05 && Math.abs(this.screen.y) <= 1.05 && this.screen.z < 1;
        u.smearAt.value.set(this.screen.x * 0.5 + 0.5, this.screen.y * 0.5 + 0.5);
        this.smearVisible = visible;
    }

    private smearVisible = false;

    public update(aspect: number): void {
        const s = this.settings;
        const now = performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;

        // the auto-exposure chases the light it sees, with a lag
        this.adapted += (this.flash - this.adapted) * (1 - Math.exp(-dt / Math.max(s.adaptSeconds, 0.01)));
        const over = Math.max(this.flash - this.adapted, 0);
        const under = Math.max(this.adapted - this.flash, 0);

        const active = s.enabled && (this.flash > 0.001 || this.adapted > 0.001);
        this.enabled = active;
        this.setGrain(active ? s.grainBoost * Math.min(under * 2, 1) : 0);
        if (!active) return;

        const u = this.uniforms;
        u.exposure.value = (1 + s.overexposure * over) * (1 - s.undershoot * Math.min(under * 1.5, 1));
        u.clip.value = Math.min(over * s.clip * 2, 1);
        u.smear.value = this.smearVisible ? s.smear * Math.pow(over, 0.7) : 0;
        u.smearWidth.value = Math.max(s.smearWidth, 1e-4);
        u.aspect.value = aspect;
        u.chroma.value = s.chroma * over;
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'enabled');
        folder.add(s, 'overexposure', 0, 10, 0.1);
        folder.add(s, 'clip', 0, 1, 0.01);
        folder.add(s, 'smear', 0, 4, 0.05);
        folder.add(s, 'smearWidth', 0.0005, 0.03, 0.0005);
        folder.add(s, 'chroma', 0, 0.02, 0.0005);
        folder.add(s, 'adaptSeconds', 0.05, 3, 0.05);
        folder.add(s, 'undershoot', 0, 1, 0.01);
        folder.add(s, 'grainBoost', 0, 3, 0.05);
    }
}
