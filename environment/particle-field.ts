import {
    BufferAttribute,
    BufferGeometry,
    Camera,
    Clock,
    Color,
    DoubleSide,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    IUniform,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    Scene,
    Texture,
    WebGLProgramParametersWithUniforms,
} from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { ParticleSettings } from '../constants';
import { makeRng } from '../utils/random';
import {
    dotBeginVertex,
    dotFrag,
    dotFragPars,
    dotPars,
    flakeBeginNormal,
    flakeBeginVertex,
    flakeRotationPars,
    particleFieldPars,
} from '../shaders/particle-field.glsl';
import { WATER_LEVEL_Y } from './water';

const FLAKE_POINTS = 7;

/**
 * An irregular, slightly curled flake: a fan of triangles around its centre, 1 unit across
 */
const makeFlakeGeometry = (seed: number): BufferGeometry => {
    const rng = makeRng(seed);
    const positions: number[] = [0, 0, 0];
    for (let k = 0; k < FLAKE_POINTS; k++) {
        const angle = (k / FLAKE_POINTS) * Math.PI * 2 + (rng() - 0.5) * 0.5;
        const r = 0.3 + rng() * 0.25;
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r * 0.75;
        // curl: the edges bend up
        positions.push(x, y, (x * x + y * y) * 0.9 + (rng() - 0.5) * 0.06);
    }
    const indices: number[] = [];
    for (let k = 0; k < FLAKE_POINTS; k++) indices.push(0, 1 + k, 1 + ((k + 1) % FLAKE_POINTS));

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
};

const replace = (source: string, search: string, replacement: string) => {
    if (!source.includes(search)) console.warn(`Particle shader no longer contains "${search}"; edit not applied.`);
    return source.replace(search, replacement);
};

interface FieldColour {
    texture: Texture;
    /** which of the settings' flake colours this set uses */
    colorKey: 'flakeColor1' | 'flakeColor2';
    /** share of the particles in this colour */
    share: number;
    seed: number;
}

/**
 * Ambient particles around the camera. Positions come from the GPU (shaders/particle-field.glsl.ts); up close they're
 * drawn as tumbling flakes, further away as the old dots, crossfading in between.
 */
export class ParticleField implements AnimatedEntity {
    private readonly meshes: Mesh[] = [];
    private readonly uniforms: { [name: string]: IUniform };
    private readonly flakeMaterials: MeshStandardMaterial[] = [];

    constructor(
        private readonly scene: Scene,
        private readonly camera: Camera,
        private readonly settings: ParticleSettings,
        private readonly colours: FieldColour[],
    ) {
        this.uniforms = {
            particleTime: { value: 0 },
            particleCamera: { value: camera.position },
            particleBoxSize: { value: 1 },
            particleFall: { value: 0 },
            particleSway: { value: 0 },
            particleWaterY: { value: WATER_LEVEL_Y },
            flakeNear: { value: 0 },
            flakeBand: { value: 1 },
            flakeSize: { value: 0 },
            flakeSpin: { value: 0 },
            dotSize: { value: 0 },
        };
        this.build();
    }

    private build(): void {
        for (const mesh of this.meshes) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
        }
        this.meshes.length = 0;
        this.flakeMaterials.length = 0;

        const flakeShape = makeFlakeGeometry(7);
        const dotShape = new PlaneGeometry(1, 1);

        for (const colour of this.colours) {
            const count = Math.round(this.settings.count * colour.share);
            const rng = makeRng(colour.seed);
            const seeds = new Float32Array(count * 4);
            for (let k = 0; k < seeds.length; k++) seeds[k] = rng();
            const seedAttribute = new InstancedBufferAttribute(seeds, 4);

            const flakes = this.instanced(flakeShape, seedAttribute, count);
            const flakeMaterial = new MeshStandardMaterial({
                color: new Color(),
                emissive: new Color(),
                roughness: 0.6,
                metalness: 0.1,
                side: DoubleSide,
            });
            flakeMaterial.onBeforeCompile = (params) => this.editFlake(params);
            this.flakeMaterials.push(flakeMaterial);
            this.add(new Mesh(flakes, flakeMaterial));

            const dots = this.instanced(dotShape, seedAttribute, count);
            const dotMaterial = new MeshBasicMaterial({ map: colour.texture, transparent: true, depthWrite: false });
            dotMaterial.onBeforeCompile = (params) => this.editDot(params);
            this.add(new Mesh(dots, dotMaterial));
        }
        this.apply();
    }

    private instanced(shape: BufferGeometry, seeds: InstancedBufferAttribute, count: number): InstancedBufferGeometry {
        const geometry = new InstancedBufferGeometry();
        geometry.index = shape.index;
        for (const name of Object.keys(shape.attributes)) geometry.setAttribute(name, shape.getAttribute(name));
        geometry.setAttribute('particleSeed', seeds);
        geometry.instanceCount = count;
        return geometry;
    }

    private add(mesh: Mesh): void {
        // positions only exist on the GPU, so three can't cull by bounds
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.meshes.push(mesh);
    }

    private editFlake(params: WebGLProgramParametersWithUniforms): void {
        params.vertexShader = replace(params.vertexShader, '#include <common>', `#include <common>\n${particleFieldPars}\n${flakeRotationPars}`);
        params.vertexShader = replace(params.vertexShader, '#include <beginnormal_vertex>', flakeBeginNormal);
        params.vertexShader = replace(params.vertexShader, '#include <begin_vertex>', flakeBeginVertex);
        Object.assign(params.uniforms, this.uniforms);
    }

    private editDot(params: WebGLProgramParametersWithUniforms): void {
        params.vertexShader = replace(params.vertexShader, '#include <common>', `#include <common>\n${particleFieldPars}\n${dotPars}`);
        params.vertexShader = replace(params.vertexShader, '#include <begin_vertex>', dotBeginVertex);
        params.fragmentShader = replace(params.fragmentShader, '#include <common>', `#include <common>\n${dotFragPars}`);
        params.fragmentShader = replace(params.fragmentShader, '#include <dithering_fragment>', `#include <dithering_fragment>\n${dotFrag}`);
        Object.assign(params.uniforms, this.uniforms);
    }

    public apply(): void {
        const s = this.settings;
        const u = this.uniforms;
        u.particleBoxSize.value = s.boxSize;
        u.particleFall.value = s.fallSpeed;
        u.particleSway.value = s.sway;
        u.flakeNear.value = s.flakeNear;
        u.flakeBand.value = Math.max(s.flakeBand, 1e-3);
        u.flakeSize.value = s.flakeSize;
        u.flakeSpin.value = s.flakeSpin;
        u.dotSize.value = s.dotSize;
        this.flakeMaterials.forEach((m, k) => {
            m.color.set(s[this.colours[k].colorKey]);
            m.emissive.set(s[this.colours[k].colorKey]);
            m.emissiveIntensity = s.flakeGlow;
        });
    }

    public bindTweaks(folder: GUI): void {
        const apply = () => this.apply();
        folder.add(this.settings, 'count', 0, 20000, 100).onFinishChange(() => this.build());
        folder.add(this.settings, 'boxSize', 1, 30, 0.5).onChange(apply);
        folder.add(this.settings, 'fallSpeed', 0, 0.5, 0.005).onChange(apply);
        folder.add(this.settings, 'sway', 0, 1, 0.01).onChange(apply);
        folder.add(this.settings, 'dotSize', 0.001, 0.05, 0.001).onChange(apply);
        folder.add(this.settings, 'flakeSize', 0.005, 0.15, 0.001).onChange(apply);
        folder.add(this.settings, 'flakeNear', 0, 5, 0.05).onChange(apply);
        folder.add(this.settings, 'flakeBand', 0.05, 3, 0.05).onChange(apply);
        folder.add(this.settings, 'flakeSpin', 0, 5, 0.05).onChange(apply);
        folder.add(this.settings, 'flakeGlow', 0, 3, 0.01).onChange(apply);
        folder.addColor(this.settings, 'flakeColor1').onChange(apply);
        folder.addColor(this.settings, 'flakeColor2').onChange(apply);
    }

    public update(clock: Clock): void {
        this.uniforms.particleTime.value = clock.elapsedTime;
    }
}
