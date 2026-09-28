import { CubeCamera, HalfFloatType, MeshPhysicalMaterial, PerspectiveCamera, PMREMGenerator, Scene, ShaderMaterial, Vector3, WebGLCubeRenderTarget, WebGLRenderer, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { PillarReflectionSettings } from '../constants';

// the blurred captures mixed, texel for texel (they share the blur's layout)
const blendMaterial = () => new ShaderMaterial({
    uniforms: { tFrom: { value: null }, tTo: { value: null }, amount: { value: 0 } },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tFrom;
        uniform sampler2D tTo;
        uniform float amount;
        varying vec2 vUv;
        void main() {
            gl_FragColor = mix(texture2D(tFrom, vUv), texture2D(tTo, vUv), amount);
        }
    `,
    depthTest: false,
    depthWrite: false,
});

/**
 * Something for the polished pillars to reflect: the scene around the camera captured into a small cube map now and
 * then (one face per frame, so no frame pays for all six), blurred by roughness (PMREM) and used as the pillars'
 * environment map. Without one they only mirror a few lights, so their normal map shows only where a highlight
 * happens to fall; with one, every tilt of it shifts what's reflected. The water is left out of the capture (it would
 * render its own mirror six more times), so below the horizon it's the dark seabed. Each new capture fades in over
 * the old one instead of switching at once. Not refreshed under the water.
 */
export class PillarReflections {
    private readonly cube: WebGLCubeRenderTarget;
    private readonly cubeCamera: CubeCamera;
    private readonly pmrem: PMREMGenerator;
    // what the pillars see, and the capture before the newest and the newest, which it fades between
    private readonly blurred: WebGLRenderTarget;
    private readonly previous: WebGLRenderTarget;
    private readonly next: WebGLRenderTarget;
    private readonly blend = new FullScreenQuad(blendMaterial());
    private fadeStart = -1e9;
    private face = 0;
    private lastDone = -1e9;
    private readonly at = new Vector3();

    constructor(renderer: WebGLRenderer, private readonly material: MeshPhysicalMaterial, private readonly settings: PillarReflectionSettings) {
        this.cube = new WebGLCubeRenderTarget(settings.resolution, { type: HalfFloatType });
        this.cubeCamera = new CubeCamera(0.1, 500, this.cube);
        this.pmrem = new PMREMGenerator(renderer);
        // always there (an empty one to start with), so turning it on or off is only its intensity, not a recompile
        this.blurred = this.pmrem.fromCubemap(this.cube.texture);
        this.previous = this.blurred.clone();
        this.next = this.blurred.clone();
        material.envMap = this.blurred.texture;
        this.apply();
    }

    private apply(): void {
        const s = this.settings;
        this.material.envMapIntensity = s.enabled ? s.intensity : 0;
        this.material.normalScale.set(s.normalScale, s.normalScale);
    }

    /**
     * @param prepare switches the scene to its look for the capture (true: the water hidden), and back (false)
     */
    public update(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, time: number, underwater: boolean, prepare: (capturing: boolean) => void): void {
        const s = this.settings;
        if (!s.enabled) return;
        this.fade(renderer, time);
        if (underwater) return;
        // a round of six faces, then a pause until the next refresh
        if (this.face === 0) {
            if (time - this.lastDone < s.refreshSeconds) return;
            this.at.copy(camera.position);
            if (this.cube.width !== s.resolution) this.cube.setSize(s.resolution, s.resolution);
        }
        this.cubeCamera.position.copy(this.at);
        this.cubeCamera.updateMatrixWorld();
        if (this.cubeCamera.coordinateSystem !== renderer.coordinateSystem) {
            this.cubeCamera.coordinateSystem = renderer.coordinateSystem;
            this.cubeCamera.updateCoordinateSystem();
        }
        prepare(true);
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(this.cube, this.face);
        renderer.render(scene, this.cubeCamera.children[this.face] as PerspectiveCamera);
        renderer.setRenderTarget(previous);
        prepare(false);
        this.face++;
        if (this.face === 6) {
            this.face = 0;
            this.lastDone = time;
            // the new one fades in from what's showing now (even mid-fade)
            this.draw(renderer, this.blurred, this.blurred, 0, this.previous);
            this.pmrem.fromCubemap(this.cube.texture, this.next);
            this.fadeStart = time;
        }
    }

    private fade(renderer: WebGLRenderer, time: number): void {
        const t = (time - this.fadeStart) / Math.max(this.settings.fadeSeconds, 1e-3);
        if (t < 0 || t > 1.2) return;
        this.draw(renderer, this.previous, this.next, Math.min(t, 1) ** 2 * (3 - 2 * Math.min(t, 1)), this.blurred);
    }

    private draw(renderer: WebGLRenderer, from: WebGLRenderTarget, to: WebGLRenderTarget, amount: number, into: WebGLRenderTarget): void {
        const u = (this.blend.material as ShaderMaterial).uniforms;
        u.tFrom.value = from.texture;
        u.tTo.value = to.texture;
        u.amount.value = amount;
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(into);
        this.blend.render(renderer);
        renderer.setRenderTarget(previous);
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        const apply = () => this.apply();
        folder.add(s, 'enabled').onChange(apply);
        folder.add(s, 'intensity', 0, 3, 0.01).onChange(apply);
        folder.add(s, 'normalScale', 0, 4, 0.05).onChange(apply);
        folder.add(s, 'resolution', [32, 64, 128, 256]);
        folder.add(s, 'refreshSeconds', 0.1, 10, 0.1);
        folder.add(s, 'fadeSeconds', 0, 5, 0.1);
    }
}
