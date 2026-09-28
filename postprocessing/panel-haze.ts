import { Color, HalfFloatType, ShaderMaterial, Vector2, Vector4, WebGLRenderer, WebGLRenderTarget } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

import { PanelHazeSettings } from '../constants';

// the blur is taken at this share of the screen's resolution (it's soft anyway)
const RESOLUTION = 0.5;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// one direction of a gaussian blur, 13 taps (linear filtering adds the ones between)
const blurShader = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 step;
varying vec2 vUv;
void main() {
    vec3 sum = texture2D(tInput, vUv).rgb * 0.1964825501511404;
    sum += (texture2D(tInput, vUv + step * 1.411764705882353).rgb + texture2D(tInput, vUv - step * 1.411764705882353).rgb) * 0.2969069646728344;
    sum += (texture2D(tInput, vUv + step * 3.2941176470588234).rgb + texture2D(tInput, vUv - step * 3.2941176470588234).rgb) * 0.09447039785044732;
    sum += (texture2D(tInput, vUv + step * 5.176470588235294).rgb + texture2D(tInput, vUv - step * 5.176470588235294).rgb) * 0.010381362401148057;
    gl_FragColor = vec4(sum, 1.0);
}
`;

const compositeShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tBlurred;
// the panel's box on screen (0 to 1: left, bottom, right, top), in pixels too for the edge's width
uniform vec4 box;
uniform vec2 screen;
uniform float amount;
uniform vec3 hazeColor;
uniform float density;
uniform float edge;
uniform float fray;
uniform float time;
varying vec2 vUv;

float hazeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hazeNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hazeHash(i), hazeHash(i + vec2(1.0, 0.0)), f.x), mix(hazeHash(i + vec2(0.0, 1.0)), hazeHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
    vec3 scene = texture2D(tDiffuse, vUv).rgb;
    // how far outside the box this pixel is, in pixels (negative inside), by a rounded box's distance
    vec2 px = vUv * screen;
    vec2 centre = 0.5 * (box.xy + box.zw) * screen;
    vec2 halfSize = 0.5 * (box.zw - box.xy) * screen;
    vec2 q = abs(px - centre) - halfSize + edge;
    float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - edge;
    // its edge frays, drifting like the fog (noise on the scale of the edge, and finer)
    vec2 n = px / max(edge, 1.0);
    float wisps = 0.65 * hazeNoise(n * 0.6 + vec2(time * 0.05, time * 0.02)) + 0.35 * hazeNoise(n * 1.7 - vec2(time * 0.03, time * 0.06));
    outside += (wisps - 0.5) * fray * edge * 2.0;
    // dense inside the box, thinning out over the edge's width past it
    float haze = 1.0 - smoothstep(-edge * 0.25, edge, outside);
    haze *= amount;
    if (haze <= 0.0) {
        gl_FragColor = vec4(scene, 1.0);
        return;
    }
    // the scene blurred behind it, then drowned in the haze
    vec3 behind = mix(scene, texture2D(tBlurred, vUv).rgb, smoothstep(0.0, 0.5, haze));
    gl_FragColor = vec4(mix(behind, hazeColor, haze * density), 1.0);
}
`;

/**
 * The text panels' backing: not a box but a bank of the scene's own haze. Behind the open panel (its box read from the
 * page each frame, and its opacity, so the haze fades and moves with the text), the frame is blurred and drowned in
 * the fog's colour, darkened so white text reads on it; its edges fray with drifting noise. Skipped while no panel shows.
 */
export class PanelHazePass extends Pass {
    private readonly blurA = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
    private readonly blurB = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
    private readonly blur: ShaderMaterial;
    private readonly blurQuad: FullScreenQuad;
    private readonly composite: ShaderMaterial;
    private readonly compositeQuad: FullScreenQuad;
    private readonly box = new Vector4();

    /**
     * @param panel the element whose box the haze fills
     * @param fogColor the colour of the far fog (it changes with the time of day), shared
     */
    constructor(private readonly panel: HTMLElement, private readonly fogColor: Color, private readonly settings: PanelHazeSettings) {
        super();
        this.blur = new ShaderMaterial({
            uniforms: { tInput: { value: null }, step: { value: new Vector2() } },
            vertexShader: VERTEX,
            fragmentShader: blurShader,
            depthTest: false,
            depthWrite: false,
        });
        this.blurQuad = new FullScreenQuad(this.blur);
        this.composite = new ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                tBlurred: { value: this.blurB.texture },
                box: { value: new Vector4() },
                screen: { value: new Vector2(1, 1) },
                amount: { value: 0 },
                hazeColor: { value: new Color() },
                density: { value: 0.8 },
                edge: { value: 60 },
                fray: { value: 0.5 },
                time: { value: 0 },
            },
            vertexShader: VERTEX,
            fragmentShader: compositeShader,
            depthTest: false,
            depthWrite: false,
        });
        this.compositeQuad = new FullScreenQuad(this.composite);
        this.enabled = false;
    }

    /** reads the panel's place and opacity; off while it's hidden */
    public update(time: number): void {
        const s = this.settings;
        const opacity = parseFloat(getComputedStyle(this.panel).opacity) || 0;
        this.enabled = s.enabled && opacity > 0.001;
        if (!this.enabled) return;
        const r = this.panel.getBoundingClientRect();
        // the canvas fills the window
        const w = window.innerWidth, h = window.innerHeight;
        this.box.set(r.left / w, 1 - r.bottom / h, r.right / w, 1 - r.top / h);
        const u = this.composite.uniforms;
        (u.box.value as Vector4).copy(this.box);
        u.amount.value = opacity;
        (u.hazeColor.value as Color).copy(this.fogColor).multiplyScalar(s.brightness);
        u.density.value = s.density;
        // the edge's width in the screen's pixels, from CSS pixels
        u.edge.value = s.edgePx * ((u.screen.value as Vector2).x / Math.max(w, 1));
        u.fray.value = s.fray;
        u.time.value = time;
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'enabled');
        folder.add(s, 'density', 0, 1, 0.01);
        folder.add(s, 'brightness', 0, 2, 0.01);
        folder.add(s, 'blurPx', 0, 16, 0.5);
        folder.add(s, 'edgePx', 0, 200, 1);
        folder.add(s, 'fray', 0, 1.5, 0.01);
    }

    public setSize(width: number, height: number): void {
        const w = Math.max(1, Math.round(width * RESOLUTION)), h = Math.max(1, Math.round(height * RESOLUTION));
        this.blurA.setSize(w, h);
        this.blurB.setSize(w, h);
        (this.composite.uniforms.screen.value as Vector2).set(width, height);
    }

    public render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
        // the whole frame blurred, across then down, twice over (at the lower resolution, its steps in its own texels):
        // one wide pass leaves its taps far enough apart to ghost bright things into steps
        const spread = this.settings.blurPx * RESOLUTION / Math.SQRT2;
        const u = this.blur.uniforms;
        let input = readBuffer.texture;
        for (let i = 0; i < 2; i++) {
            u.tInput.value = input;
            (u.step.value as Vector2).set(spread / this.blurA.width, 0);
            renderer.setRenderTarget(this.blurA);
            this.blurQuad.render(renderer);
            u.tInput.value = this.blurA.texture;
            (u.step.value as Vector2).set(0, spread / this.blurA.height);
            renderer.setRenderTarget(this.blurB);
            this.blurQuad.render(renderer);
            input = this.blurB.texture;
        }

        this.composite.uniforms.tDiffuse.value = readBuffer.texture;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.compositeQuad.render(renderer);
    }

    public dispose(): void {
        this.blurA.dispose();
        this.blurB.dispose();
        this.blur.dispose();
        this.blurQuad.dispose();
        this.composite.dispose();
        this.compositeQuad.dispose();
    }
}
