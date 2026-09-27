import { AdditiveBlending, Camera, Color, HalfFloatType, PerspectiveCamera, ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

import { SunShaftSettings } from '../constants';

const SUNS = 2;
// the shafts are gathered at this share of the screen's resolution (they're soft), then scaled up and added
const RESOLUTION = 0.5;
const SAMPLES = 48;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const shaftShader = /* glsl */ `
uniform sampler2D tDepth;
// each sun on screen (0 to 1), and its colour times how strongly it casts shafts right now (black: none)
uniform vec2 sunScreen[${SUNS}];
uniform vec3 sunColor[${SUNS}];
uniform float aspect;
uniform float glowRadius;
uniform float reach;
uniform float decay;
varying vec2 vUv;

// open sky there (nothing drawn in front of it: the sky and the suns don't write depth), glowing near the sun
float sunLightAt(vec2 uv, vec2 sun) {
    if (texture2D(tDepth, uv).x < 0.9999) return 0.0;
    vec2 d = (uv - sun) * vec2(aspect, 1.0);
    return exp(-length(d) / glowRadius);
}

void main() {
    vec3 light = vec3(0.0);
    for (int k = 0; k < ${SUNS}; k++) {
        if (sunColor[k].r + sunColor[k].g + sunColor[k].b <= 0.0) continue;
        // step from this pixel towards the sun, gathering the light of the open sky it passes: where pillars stand
        // in the way, less gets through, which leaves the dark bands between the shafts
        vec2 step = (vUv - sunScreen[k]) * reach / float(${SAMPLES});
        vec2 uv = vUv;
        float weight = 1.0;
        float sum = 0.0;
        // interleaved gradient noise, so the steps don't band
        uv -= step * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        for (int i = 0; i < ${SAMPLES}; i++) {
            uv -= step;
            sum += sunLightAt(uv, sunScreen[k]) * weight;
            weight *= decay;
        }
        light += sunColor[k] * sum / float(${SAMPLES});
    }
    gl_FragColor = vec4(light, 1.0);
}
`;

const compositeShader = /* glsl */ `
uniform sampler2D tShafts;
uniform vec2 texel;
varying vec2 vUv;
void main() {
    // a small blur while scaling up, which also smooths the march's jitter
    vec3 shafts = 0.25 * (
        texture2D(tShafts, vUv + texel * vec2(-0.75, -0.75)).rgb + texture2D(tShafts, vUv + texel * vec2(0.75, -0.75)).rgb +
        texture2D(tShafts, vUv + texel * vec2(-0.75, 0.75)).rgb + texture2D(tShafts, vUv + texel * vec2(0.75, 0.75)).rgb
    );
    gl_FragColor = vec4(shafts, 1.0);
}
`;

/**
 * Crepuscular rays above the water: when a sun sits behind the jagged tops of the walls, its light streams out between
 * them. The open sky around the sun (from the scene's depth) is smeared outwards from the sun's place on screen; the
 * pillars in front block it, leaving the dark bands. Only while a sun is up and near the screen, and not under the
 * water. Adds its light straight into the frame (no buffer swap), so later passes still see the scene's depth.
 */
export class SunShaftsPass extends Pass {
    private readonly material: ShaderMaterial;
    private readonly quad: FullScreenQuad;
    private readonly composite: ShaderMaterial;
    private readonly compositeQuad: FullScreenQuad;
    private readonly shafts = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
    private readonly projected = new Vector3();

    constructor(private readonly camera: PerspectiveCamera, private readonly settings: SunShaftSettings) {
        super();
        this.needsSwap = false;
        this.material = new ShaderMaterial({
            uniforms: {
                tDepth: { value: null },
                sunScreen: { value: Array.from({ length: SUNS }, () => new Vector2()) },
                sunColor: { value: Array.from({ length: SUNS }, () => new Color(0, 0, 0)) },
                aspect: { value: 1 },
                glowRadius: { value: 0.1 },
                reach: { value: 0.8 },
                decay: { value: 0.97 },
            },
            vertexShader: VERTEX,
            fragmentShader: shaftShader,
            depthTest: false,
            depthWrite: false,
        });
        this.quad = new FullScreenQuad(this.material);
        this.composite = new ShaderMaterial({
            uniforms: { tShafts: { value: this.shafts.texture }, texel: { value: new Vector2() } },
            vertexShader: VERTEX,
            fragmentShader: compositeShader,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            blending: AdditiveBlending,
        });
        this.compositeQuad = new FullScreenQuad(this.composite);
        this.enabled = false;
    }

    /**
     * @param suns each sun: towards it, its colour times brightness, and 0 to 1 for how far it's risen
     * @param daylight 1 by day, 0 at night
     */
    public update(underwater: boolean, suns: { direction: Vector3, color: Color, up: number }[], daylight: number, camera: Camera): void {
        const s = this.settings;
        const u = this.material.uniforms;
        let any = false;
        suns.forEach((sun, k) => {
            if (k >= SUNS) return;
            const color = u.sunColor.value[k] as Color;
            this.projected.copy(camera.position).addScaledVector(sun.direction, 100).project(camera);
            const inFront = this.projected.z < 1;
            // fades out as the sun leaves the screen
            const off = Math.max(Math.abs(this.projected.x), Math.abs(this.projected.y));
            const onScreen = inFront ? 1 - Math.min(Math.max((off - 1) / 0.6, 0), 1) : 0;
            const strength = s.enabled && !underwater ? s.strength * sun.up * onScreen * daylight : 0;
            color.copy(sun.color).multiplyScalar(strength);
            (u.sunScreen.value[k] as Vector2).set(this.projected.x * 0.5 + 0.5, this.projected.y * 0.5 + 0.5);
            any ||= strength > 0.001;
        });
        this.enabled = any;
        u.aspect.value = this.camera.aspect;
        u.glowRadius.value = Math.max(s.glowRadius, 0.005);
        u.reach.value = s.reach;
        u.decay.value = s.decay;
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'enabled');
        folder.add(s, 'strength', 0, 3, 0.01);
        folder.add(s, 'glowRadius', 0.01, 0.6, 0.005);
        folder.add(s, 'reach', 0.1, 1, 0.01);
        folder.add(s, 'decay', 0.9, 1, 0.001);
    }

    public setSize(width: number, height: number): void {
        this.shafts.setSize(Math.max(1, Math.round(width * RESOLUTION)), Math.max(1, Math.round(height * RESOLUTION)));
        this.composite.uniforms.texel.value.set(1 / this.shafts.width, 1 / this.shafts.height);
    }

    public render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
        this.material.uniforms.tDepth.value = readBuffer.depthTexture;
        renderer.setRenderTarget(this.shafts);
        this.quad.render(renderer);
        // added on top of the frame where it is
        renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
        // without clearing it first
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        this.compositeQuad.render(renderer);
        renderer.autoClear = autoClear;
    }

    public dispose(): void {
        this.material.dispose();
        this.quad.dispose();
        this.composite.dispose();
        this.compositeQuad.dispose();
        this.shafts.dispose();
    }
}
