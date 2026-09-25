import { Clock, WebGLRenderer, WebGLRenderTarget } from 'three';
import { FilmPass as ThreeFilmPass } from 'three/addons/postprocessing/FilmPass.js';

const UPDATE_GRAIN_EVERY_MS = 1000/60;
const SLOWNESS = 600;
const UPDATE_BY = 1/SLOWNESS;

/**
 * Compatibility with high refresh rate monitors...
 */
export class FilmPass extends ThreeFilmPass {
    private lastUpdateTime: number = 0;

    constructor(private clock: Clock, intensity: number = 0.5, grayscale: boolean = false) {
        super(intensity, grayscale);
    }


    /**
     * Tracks: https://github.com/mrdoob/three.js/blob/b3cb0cd0d6066f7054a76b90904486e40031c2ce/examples/jsm/postprocessing/FilmPass.js#L17
     */
    public render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
        // always render: the composer swaps its buffers after this pass either way, so skipping a frame (above 60 fps)
        // would hand the next pass a buffer nobody wrote. Only the grain's time advances at 60 steps per second
        let advance = 0;
        if (this.clock.oldTime - this.lastUpdateTime >= UPDATE_GRAIN_EVERY_MS) {
            advance = UPDATE_BY;
            this.lastUpdateTime = this.clock.oldTime;
        }
        super.render(renderer, writeBuffer, readBuffer, advance, maskActive);
    }
}