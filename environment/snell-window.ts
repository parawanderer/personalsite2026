import { CubeCamera, HalfFloatType, PerspectiveCamera, Scene, Vector3, WebGLCubeRenderTarget, WebGLRenderer } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { degToRad } from 'three/src/math/MathUtils.js';

import { SnellWindowSettings } from '../constants';

// how far from straight up light from the air reaches the eye under the water (Snell's window, index 1.33), and how much
// further the ripples and waves can open it
const WINDOW_DEG = 48.6;
const RIPPLE_MARGIN_DEG = 15;
// the cube's faces worth capturing (its order: +x, -x, +y, -y, +z, -z): all but the one looking straight down, since
// light from below the horizon never gets in
const FACES = [2, 0, 4, 1, 5];

/**
 * The world above the water as seen from under it. Looking up from below, everything above the surface shows squeezed
 * into a disc overhead (Snell's window), bent by the rippling surface. While the camera is under the water and that
 * disc can be on screen, the world above is rendered into a cube map from just above the surface over the camera, in
 * its look from above (no water in the way); the underside of the surface (shaders/water-underside.glsl.ts) then looks
 * up, for each pixel, the direction its light came from through the rippled surface.
 */
export class SnellWindow {
    private readonly target: WebGLCubeRenderTarget;
    private readonly cubeCamera: CubeCamera;
    private readonly forward = new Vector3();
    // the next face to refresh
    private nextFace = 0;
    // whether the cube holds the view from the current dive (it's rendered on the first frame the window can show)
    private fresh = false;

    constructor(private readonly settings: SnellWindowSettings) {
        this.target = new WebGLCubeRenderTarget(settings.resolution, { type: HalfFloatType });
        this.cubeCamera = new CubeCamera(0.05, 1000, this.target);
    }

    public get texture() {
        return this.target.texture;
    }

    /**
     * @param prepare switches the scene to its look from above for the capture (true), and back (false)
     */
    public update(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, underwater: boolean, waterLevel: number, prepare: (capturing: boolean) => void): void {
        const s = this.settings;
        if (!s.enabled || !underwater) {
            this.fresh = false;
            return;
        }
        // skipped while the view can't reach the window: its axis (straight up) too far from where the camera looks
        camera.getWorldDirection(this.forward);
        const halfDiagonal = Math.atan(Math.tan(degToRad(camera.fov / 2)) * Math.hypot(1, camera.aspect));
        const fromUp = Math.acos(Math.min(Math.max(this.forward.y, -1), 1));
        if (fromUp - halfDiagonal > degToRad(WINDOW_DEG + RIPPLE_MARGIN_DEG)) {
            this.fresh = false;
            return;
        }
        // all its faces at once when the window first shows; after that a few per frame, in turn, which spreads the
        // cost (the view from under the water changes slowly)
        const faces = this.fresh ? Math.min(Math.max(Math.round(s.facesPerFrame), 1), FACES.length) : FACES.length;
        this.fresh = true;

        if (this.target.width !== s.resolution) this.target.setSize(s.resolution, s.resolution);
        this.cubeCamera.position.set(camera.position.x, waterLevel + 0.02, camera.position.z);
        this.cubeCamera.updateMatrixWorld();
        if (this.cubeCamera.coordinateSystem !== renderer.coordinateSystem) {
            this.cubeCamera.coordinateSystem = renderer.coordinateSystem;
            this.cubeCamera.updateCoordinateSystem();
        }

        prepare(true);
        // the shadow maps drawn for this frame's view serve the capture too
        const shadows = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false;
        const previous = renderer.getRenderTarget();
        const previousFace = renderer.getActiveCubeFace();
        const previousLevel = renderer.getActiveMipmapLevel();
        for (let k = 0; k < faces; k++) {
            const i = FACES[this.nextFace];
            this.nextFace = (this.nextFace + 1) % FACES.length;
            renderer.setRenderTarget(this.target, i);
            renderer.render(scene, this.cubeCamera.children[i] as PerspectiveCamera);
        }
        renderer.setRenderTarget(previous, previousFace, previousLevel);
        renderer.shadowMap.autoUpdate = shadows;
        prepare(false);
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'enabled');
        folder.add(s, 'resolution', [64, 128, 256, 512, 1024]);
        folder.add(s, 'facesPerFrame', 1, 5, 1);
    }

    public dispose(): void {
        this.target.dispose();
    }
}
