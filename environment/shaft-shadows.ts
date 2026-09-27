import { BufferGeometry, Color, FloatType, Mesh, OrthographicCamera, RGBAFormat, Scene, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';

import { SHAFT_LIGHTS, shaftUniforms } from '../shaders/sun-shafts.glsl';
import { Walls } from './walls';

// the area around the camera the maps cover (half its width), their resolution, and how far the camera moves before
// the set of pillars in them is picked again
const HALF_SIZE = 12;
const RESOLUTION = 1024;
const REPICK_DISTANCE = 4;

const depthMaterial = () => new ShaderMaterial({
    vertexShader: /* glsl */ `
        void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        void main() {
            gl_FragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
        }
    `,
});

/**
 * Shadows of the free-standing pillars in the channel on the underwater sun shafts: per sun, a depth map seen along its
 * (bent) light, of the channel pillars around the camera, which the shafts and the light they cast check against
 * (shaders/sun-shafts.glsl.ts). Rendered each frame, only while the shafts are on.
 */
export class ShaftShadows {
    private readonly scene = new Scene();
    private readonly camera = new OrthographicCamera(-HALF_SIZE, HALF_SIZE, HALF_SIZE, -HALF_SIZE, 0.1, 200);
    private readonly mesh = new Mesh(new BufferGeometry(), depthMaterial());
    private readonly targets = Array.from({ length: SHAFT_LIGHTS }, () => new WebGLRenderTarget(RESOLUTION, RESOLUTION, { type: FloatType, format: RGBAFormat }));
    private readonly pickedAt = new Vector3(1e9, 0, 0);
    private readonly centre = new Vector3();
    private readonly white = new Color(1, 1, 1);

    constructor(private readonly walls: Walls) {
        this.mesh.frustumCulled = false;
        this.scene.add(this.mesh);
        shaftUniforms.shaftShadowMap0.value = this.targets[0].texture;
        shaftUniforms.shaftShadowMap1.value = this.targets[1].texture;
    }

    /** the pillars were rebuilt: pick them again */
    public invalidate(): void {
        this.pickedAt.set(1e9, 0, 0);
    }

    /**
     * @param on whether the underwater shafts are showing
     * @param waterLevel where the surface is, which the maps are centred on
     */
    public update(renderer: WebGLRenderer, on: boolean, viewer: Vector3, waterLevel: number): void {
        shaftUniforms.shaftShadowOn.value = 0;
        if (!on) return;
        if (this.pickedAt.distanceTo(viewer) > REPICK_DISTANCE) {
            this.pickedAt.copy(viewer);
            this.mesh.geometry.dispose();
            this.mesh.geometry = this.walls.channelPillars(viewer, HALF_SIZE * 1.5) ?? new BufferGeometry();
        }
        if (!this.mesh.geometry.getAttribute('position')) return;

        const dirs = shaftUniforms.shaftLightDir.value as Vector3[];
        const colors = shaftUniforms.shaftLightColor.value as Color[];
        const matrices = shaftUniforms.shaftShadowMatrix.value;
        this.centre.set(viewer.x, waterLevel, viewer.z);
        const previousTarget = renderer.getRenderTarget();
        const previousClear = renderer.getClearColor(new Color());
        const previousAlpha = renderer.getClearAlpha();
        renderer.setClearColor(this.white, 1);
        for (let k = 0; k < SHAFT_LIGHTS; k++) {
            if (colors[k].r + colors[k].g + colors[k].b <= 0) continue;
            // looking down along the light, from the sun's side
            this.camera.up.set(0, 0, -1);
            if (Math.abs(dirs[k].z) > 0.9) this.camera.up.set(1, 0, 0);
            this.camera.position.copy(this.centre).addScaledVector(dirs[k], 100);
            this.camera.lookAt(this.centre);
            this.camera.updateMatrixWorld();
            matrices[k].multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
            renderer.setRenderTarget(this.targets[k]);
            renderer.clear();
            renderer.render(this.scene, this.camera);
        }
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(previousClear, previousAlpha);
        shaftUniforms.shaftShadowOn.value = 1;
    }
}
