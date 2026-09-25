import gsap from 'gsap';
import { PerspectiveCamera, ShaderMaterial, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { DistanceBlurSettings } from '../constants';

/**
 * Blurs the frame by distance from the camera, using the depth of the rendered scene (the composer's render targets need
 * a depth texture). Samples a golden-angle disc whose radius grows with distance; samples that are much closer than the
 * pixel are left out so near objects don't bleed into a blurred background.
 */
const shader = {
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        #include <packing>

        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 resolution;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform float focusDistance;
        uniform float blurRange;
        uniform float maxBlur;
        varying vec2 vUv;

        const int SAMPLES = 16;
        const float GOLDEN_ANGLE = 2.39996323;

        float distanceAt(vec2 uv) {
            return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar);
        }

        // blur radius in pixels for something this far away
        float blurAt(float dist) {
            return smoothstep(focusDistance, focusDistance + blurRange, dist) * maxBlur;
        }

        void main() {
            vec4 centre = texture2D(tDiffuse, vUv);
            float dist = distanceAt(vUv);
            float radius = blurAt(dist);
            if (radius < 0.5) {
                gl_FragColor = centre;
                return;
            }

            // rotate the pattern randomly per pixel, so large blurs turn into fine noise instead of rings of samples
            float spin = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;

            vec4 sum = centre;
            float total = 1.0;
            for (int i = 1; i < SAMPLES; i++) {
                float r = sqrt(float(i) / float(SAMPLES)) * radius;
                float a = float(i) * GOLDEN_ANGLE + spin;
                vec2 uv = vUv + vec2(cos(a), sin(a)) * r / resolution;
                // leave out samples in front of this pixel that aren't blurred as much themselves
                float w = step(r, blurAt(distanceAt(uv)) + 0.5);
                sum += texture2D(tDiffuse, uv) * w;
                total += w;
            }
            gl_FragColor = sum / total;
        }
    `,
};

export class DistanceBlurPass extends Pass {
    private readonly material: ShaderMaterial;
    private readonly quad: FullScreenQuad;
    /** 0 = no blur, 1 = full blur; animated by fadeTo */
    private strength = 0;
    private target = 0;

    constructor(private readonly camera: PerspectiveCamera, private readonly settings: DistanceBlurSettings) {
        super();
        this.material = new ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                tDepth: { value: null },
                resolution: { value: new Vector2(1, 1) },
                cameraNear: { value: 0.1 },
                cameraFar: { value: 1000 },
                focusDistance: { value: 0 },
                blurRange: { value: 1 },
                maxBlur: { value: 0 },
            },
            vertexShader: shader.vertexShader,
            fragmentShader: shader.fragmentShader,
            depthTest: false,
            depthWrite: false,
        });
        this.quad = new FullScreenQuad(this.material);
        this.apply();
    }

    /**
     * Fades the blur in (1) or out (0)
     */
    public fadeTo(target: number): void {
        this.target = target;
        gsap.to(this, {
            strength: this.settings.alwaysOn ? 1 : target,
            duration: this.settings.transitionSeconds,
            ease: 'power2.inOut',
            overwrite: true,
            onUpdate: () => this.apply(),
        });
    }

    public apply(): void {
        const u = this.material.uniforms;
        const blur = this.settings.maxBlur * (this.settings.alwaysOn ? 1 : this.strength);
        // skipped entirely while there's nothing to blur
        this.enabled = this.settings.enabled && blur > 0.01;
        u.focusDistance.value = this.settings.focusDistance;
        u.blurRange.value = Math.max(this.settings.blurRange, 1e-3);
        u.maxBlur.value = blur;
    }

    public bindTweaks(folder: GUI): void {
        const apply = () => this.apply();
        folder.add(this.settings, 'enabled').onChange(apply);
        folder.add(this.settings, 'alwaysOn').name('always on (for tuning)').onChange(() => this.fadeTo(this.target));
        folder.add(this.settings, 'transitionSeconds', 0, 5, 0.1);
        folder.add(this.settings, 'focusDistance', 0, 60, 0.1).onChange(apply);
        folder.add(this.settings, 'blurRange', 0.1, 100, 0.1).onChange(apply);
        folder.add(this.settings, 'maxBlur', 0, 16, 0.1).onChange(apply);
    }

    public setSize(width: number, height: number): void {
        this.material.uniforms.resolution.value.set(width, height);
    }

    public render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
        const u = this.material.uniforms;
        u.tDiffuse.value = readBuffer.texture;
        u.tDepth.value = readBuffer.depthTexture;
        u.cameraNear.value = this.camera.near;
        u.cameraFar.value = this.camera.far;

        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    public dispose(): void {
        this.material.dispose();
        this.quad.dispose();
    }
}
