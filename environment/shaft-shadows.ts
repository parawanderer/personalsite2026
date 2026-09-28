import { BufferGeometry, Color, DataTexture, FloatType, HalfFloatType, LinearFilter, Matrix4, Mesh, OrthographicCamera, RGBAFormat, RGFormat, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

import { SHAFT_LIGHTS, shaftPars, shaftUniforms } from '../shaders/sun-shafts.glsl';
import { PillarInstance } from './pillar-geometry';
import { Walls } from './walls';

// the area around the camera the maps cover (half its width), their resolution, and how far the camera moves before
// the set of pillars in them is picked again
const HALF_SIZE = 12;
const RESOLUTION = 1024;
const REPICK_DISTANCE = 4;

// the walls' blocking map: samples per pillar-grid cell
const WALL_MASK_PER_CELL = 2;

const wallMaskMaterial = () => new ShaderMaterial({
    uniforms: { ...shaftUniforms },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        ${shaftPars}
        varying vec2 vUv;
        void main() {
            vec2 q = shaftWallMaskCorner + vUv * shaftWallMaskSize;
            gl_FragColor = vec4(shaftPastWallsTraced(q, shaftSunDir[0]), shaftPastWallsTraced(q, shaftSunDir[1]), 0.0, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false,
});

// which piece of pillar is nearest the sun at each point of the map, plus one (0: none), and its depth there
const pieceMaterial = () => new ShaderMaterial({
    vertexShader: /* glsl */ `
        attribute float pieceIndex;
        varying float vPiece;
        void main() {
            vPiece = pieceIndex;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        varying float vPiece;
        void main() {
            gl_FragColor = vec4(floor(vPiece + 0.5) + 1.0, gl_FragCoord.z, 0.0, 1.0);
        }
    `,
});

// the map as the shafts read it: each texel's piece marked negative where a neighbour holds a different one (near a
// shadow's edge, where the exact shapes are tested), its depth unchanged
const edgeMaterial = () => new ShaderMaterial({
    uniforms: { tPieces: { value: null } },
    vertexShader: /* glsl */ `
        void main() {
            gl_Position = vec4(position.xy, 0.0, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tPieces;
        void main() {
            ivec2 t = ivec2(gl_FragCoord.xy);
            ivec2 size = textureSize(tPieces, 0);
            vec2 here = texelFetch(tPieces, t, 0).rg;
            bool edge = false;
            for (int y = -1; y <= 1; y++) {
                for (int x = -1; x <= 1; x++) {
                    edge = edge || texelFetch(tPieces, clamp(t + ivec2(x, y), ivec2(0), size - 1), 0).r != here.x;
                }
            }
            gl_FragColor = vec4(edge ? -here.x - 1.0 : here.x, here.y, 0.0, 1.0);
        }
    `,
    depthTest: false,
    depthWrite: false,
});

// per piece, two texels: its centre and radius, then its axis in the world and half its length
const PIECE_TEXELS = 2;
const pieceTable = (pieces: PillarInstance[]): DataTexture => {
    const data = new Float32Array(Math.max(pieces.length, 1) * PIECE_TEXELS * 4);
    const m = new Matrix4(), rot = new Matrix4();
    const axis = new Vector3();
    pieces.forEach((piece, i) => {
        // as the pillar's geometry is built (environment/pillar-geometry.ts): its own y axis, leaned and rolled
        m.makeRotationZ(piece.rollRad).multiply(rot.makeRotationX(piece.leanRad)).multiply(rot.makeRotationY(piece.spinRad));
        axis.set(0, 1, 0).applyMatrix4(m);
        data.set([piece.centre.x, piece.centre.y, piece.centre.z, piece.radius, axis.x, axis.y, axis.z, piece.height / 2], i * PIECE_TEXELS * 4);
    });
    const texture = new DataTexture(data, PIECE_TEXELS, Math.max(pieces.length, 1), RGBAFormat, FloatType);
    texture.needsUpdate = true;
    return texture;
};

/**
 * Shadows of the free-standing pillars in the channel on the underwater sun shafts: per sun, a map seen along its (bent)
 * light of which pillar piece is where, around the camera, and a table of those pieces. The shafts and the light they
 * cast look up the few pieces near a point in the map and test their shape (shaders/sun-shafts.glsl.ts), so the
 * shadows' edges are sharp and straight however coarse the map. Rendered each frame, only while the shafts are on.
 */
export class ShaftShadows {
    private readonly scene = new Scene();
    private readonly camera = new OrthographicCamera(-HALF_SIZE, HALF_SIZE, HALF_SIZE, -HALF_SIZE, 0.1, 200);
    private readonly mesh = new Mesh(new BufferGeometry(), pieceMaterial());
    // the pieces as drawn (shared by the suns), then per sun with its edges marked
    private readonly drawn = new WebGLRenderTarget(RESOLUTION, RESOLUTION, { type: FloatType, format: RGFormat });
    private readonly targets = Array.from({ length: SHAFT_LIGHTS }, () => new WebGLRenderTarget(RESOLUTION, RESOLUTION, { type: FloatType, format: RGFormat, depthBuffer: false }));
    private readonly edgeQuad = new FullScreenQuad(edgeMaterial());
    private readonly pickedAt = new Vector3(1e9, 0, 0);
    private readonly centre = new Vector3();
    private readonly none = new Color(0, 0, 0);

    private readonly wallMask: WebGLRenderTarget;
    private readonly wallMaskQuad = new FullScreenQuad(wallMaskMaterial());

    constructor(private readonly walls: Walls) {
        // the walls' blocking map covers the pillar grid, which the channel lies in
        const f = walls.pillarField;
        this.wallMask = new WebGLRenderTarget(f.size.x * WALL_MASK_PER_CELL, f.size.y * WALL_MASK_PER_CELL, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter });
        shaftUniforms.shaftWallMask.value = this.wallMask.texture;
        (shaftUniforms.shaftWallMaskCorner.value as Vector2).set(f.origin.x - f.cellSize / 2, f.origin.y - f.cellSize / 2);
        (shaftUniforms.shaftWallMaskSize.value as Vector2).set(f.size.x * f.cellSize, f.size.y * f.cellSize);
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
        shaftUniforms.shaftWallMaskOn.value = 0;
        if (!on) return;

        // the walls' blocking over the channel's surface, for this frame's sun directions
        const before = renderer.getRenderTarget();
        renderer.setRenderTarget(this.wallMask);
        this.wallMaskQuad.render(renderer);
        renderer.setRenderTarget(before);
        shaftUniforms.shaftWallMaskOn.value = 1;

        if (this.pickedAt.distanceTo(viewer) > REPICK_DISTANCE) {
            this.pickedAt.copy(viewer);
            this.mesh.geometry.dispose();
            const picked = this.walls.channelPillars(viewer, HALF_SIZE * 1.5);
            this.mesh.geometry = picked?.geometry ?? new BufferGeometry();
            (shaftUniforms.shaftPillarPieces.value as DataTexture | null)?.dispose();
            shaftUniforms.shaftPillarPieces.value = pieceTable(picked?.pieces ?? []);
            shaftUniforms.shaftPillarChamfer.value = this.walls.chamfer;
        }
        if (!this.mesh.geometry.getAttribute('position')) return;

        const dirs = shaftUniforms.shaftLightDir.value as Vector3[];
        const colors = shaftUniforms.shaftLightColor.value as Color[];
        const matrices = shaftUniforms.shaftShadowMatrix.value;
        this.centre.set(viewer.x, waterLevel, viewer.z);
        const previousTarget = renderer.getRenderTarget();
        const previousClear = renderer.getClearColor(new Color());
        const previousAlpha = renderer.getClearAlpha();
        renderer.setClearColor(this.none, 1);
        for (let k = 0; k < SHAFT_LIGHTS; k++) {
            if (colors[k].r + colors[k].g + colors[k].b <= 0) continue;
            // looking down along the light, from the sun's side
            this.camera.up.set(0, 0, -1);
            if (Math.abs(dirs[k].z) > 0.9) this.camera.up.set(1, 0, 0);
            this.camera.position.copy(this.centre).addScaledVector(dirs[k], 100);
            this.camera.lookAt(this.centre);
            this.camera.updateMatrixWorld();
            matrices[k].multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
            renderer.setRenderTarget(this.drawn);
            renderer.clear();
            renderer.render(this.scene, this.camera);
            (this.edgeQuad.material as ShaderMaterial).uniforms.tPieces.value = this.drawn.texture;
            renderer.setRenderTarget(this.targets[k]);
            this.edgeQuad.render(renderer);
        }
        renderer.setRenderTarget(previousTarget);
        renderer.setClearColor(previousClear, previousAlpha);
        shaftUniforms.shaftShadowOn.value = 1;
    }
}
