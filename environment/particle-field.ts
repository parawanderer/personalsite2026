import {
    BufferAttribute,
    BufferGeometry,
    Camera,
    Clock,
    Color,
    DataTexture,
    DoubleSide,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    IUniform,
    Material,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    PlaneGeometry,
    ShaderMaterial,
    Scene,
    Texture,
    Vector2,
    Vector3,
    WebGLProgramParametersWithUniforms,
} from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { ParticleSettings } from '../constants';
import { makeRng } from '../utils/random';
import { TOUCH_POINTS } from '../shaders/water-interaction.glsl';
import {
    dimpleBeginVertex,
    dimpleFrag,
    dimpleFragPars,
    dimplePars,
    dotBeginVertex,
    dotFrag,
    dotFragPars,
    flashTintFrag,
    flashTintPars,
    dotPars,
    flakeBeginNormal,
    flakeBeginVertex,
    flakeRotationPars,
    particleFieldPars,
    steamBeginVertex,
    steamFrag,
    steamFragPars,
    steamPars,
} from '../shaders/particle-field.glsl';
import { WATER_LEVEL_Y } from './water';
import type { PillarField } from './walls';

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
    /** per particle set, how far its far-away dots are turned towards white */
    private readonly dotWhiten = new Map<string, IUniform<number>>();
    private readonly steamMaterials: MeshBasicMaterial[] = [];
    /** per particle set, the share of it that's shown */
    private readonly shown = new Map<string, IUniform<number>>();

    /**
     * @param flow the water's surface flow (world units per second), which carries particles floating on it
     * @param lip the water's raised lip near the pillars, which floating particles ride on
     */
    constructor(
        private readonly scene: Scene,
        private readonly camera: Camera,
        private readonly settings: ParticleSettings,
        private readonly colours: FieldColour[],
        flow: Vector2,
        private readonly lip: { height: number, width: number, patchRadius: number },
    ) {
        this.uniforms = {
            particleTime: { value: 0 },
            particleCamera: { value: camera.position },
            particleBoxSize: { value: 1 },
            particleFall: { value: 0 },
            particleSway: { value: 0 },
            particleWaterY: { value: WATER_LEVEL_Y },
            particleFlow: { value: flow },
            particleFloatTime: { value: 0 },
            particleSinkSpeed: { value: 0 },
            particleSinkDepth: { value: 1 },
            particlePillarsA: { value: new DataTexture(new Float32Array(4), 1, 1) },
            particlePillarsB: { value: new DataTexture(new Float32Array(4), 1, 1) },
            particlePillarOrigin: { value: new Vector2() },
            particlePillarCell: { value: 1 },
            // no pillars until setPillarField
            particlePillarGrid: { value: new Vector2() },
            particlePillarMargin: { value: 0 },
            particleLiftHeight: { value: 0 },
            particleLiftWidth: { value: 1 },
            particlePatchRadius: { value: 0 },
            flakeNear: { value: 0 },
            flakeBand: { value: 1 },
            flakeSize: { value: 0 },
            dimpleSize: { value: 1 },
            dimpleDarkness: { value: 0 },
            dimpleRim: { value: 0 },
            dimpleRimColor: { value: new Color() },
            flakeSpin: { value: 0 },
            dotSize: { value: 0 },
            particleFlashColor: { value: new Color() },
            // the cursor's dents in the water, shared with the water (see setTouch)
            particleTouchPoints: { value: Array.from({ length: TOUCH_POINTS }, () => new Vector3()) },
            particleTouchRadius: { value: 1 },
            particleTouchPush: { value: 0 },
            particleBlastCentre: { value: new Vector3() },
            particleBlastAge: { value: 1e5 },
            particleBlastTime: { value: -1e5 },
            particleBlastStrength: { value: 0 },
            particleBlastReach: { value: 1 },
            particleBlastSpeed: { value: 1 },
            particleBlastSettle: { value: 1 },
            particleBlastSpinAmount: { value: 0 },
            particleGustStrength: { value: 0 },
            particleGustReach: { value: 1 },
            particleGustSpeed: { value: 1 },
            particleGustSettle: { value: 1 },
            particleGustSpin: { value: 0 },
            particleFlash: { value: 0 },
            particleCoolSeconds: { value: 1.5 },
            steamSeconds: { value: 1 },
            steamSize: { value: 0.05 },
            steamRise: { value: 0.1 },
            steamOpacity: { value: 0.5 },
            particleMurkColor: { value: new Color() },
            particleSinkMurk: { value: 0 },
        };
        this.build();
    }

    private materialHook?: (material: Material) => void;

    /**
     * Runs `hook` on the flakes' and dots' materials, now and whenever they're rebuilt (e.g. to add the underwater fade)
     */
    public extendMaterials(hook: (material: Material) => void): void {
        this.materialHook = hook;
        this.build();
    }

    private build(): void {
        for (const mesh of this.meshes) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
        }
        this.meshes.length = 0;
        this.flakeMaterials.length = 0;
        this.steamMaterials.length = 0;

        const flakeShape = makeFlakeGeometry(7);
        const dotShape = new PlaneGeometry(1, 1);

        for (const colour of this.colours) {
            const shown = this.shown.get(colour.colorKey) ?? { value: 1 };
            this.shown.set(colour.colorKey, shown);
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
            // the orange set are embers: they cool once they land, and hiss
            const cools = { value: colour.colorKey === 'flakeColor2' ? 1 : 0 };
            flakeMaterial.onBeforeCompile = (params) => this.editFlake(params, shown, cools);
            this.materialHook?.(flakeMaterial);
            this.flakeMaterials.push(flakeMaterial);
            this.add(new Mesh(flakes, flakeMaterial));

            if (cools.value > 0) {
                // steam off the embers as they land, drawn after the water like the dimples
                const steamMaterial = new MeshBasicMaterial({ color: this.settings.steamColor, transparent: true, depthWrite: false });
                this.steamMaterials.push(steamMaterial);
                steamMaterial.onBeforeCompile = (params) => this.editSteam(params, shown);
                // split into strips up its height, so the wisp can bend back along the ember's path
                const steam = new Mesh(this.instanced(new PlaneGeometry(1, 1, 1, 12), seedAttribute, count), steamMaterial);
                steam.renderOrder = 2;
                this.add(steam);
            }

            // drawn after the water (also transparent), just above its surface
            const dimples = new Mesh(this.instanced(dotShape, seedAttribute, count), this.dimpleMaterial(shown));
            dimples.renderOrder = 1;
            this.add(dimples);

            const dots = this.instanced(dotShape, seedAttribute, count);
            const dotMaterial = new MeshBasicMaterial({ map: colour.texture, transparent: true, depthWrite: false });
            const whiten = { value: 0 };
            this.dotWhiten.set(colour.colorKey, whiten);
            dotMaterial.onBeforeCompile = (params) => this.editDot(params, shown, whiten, cools);
            this.materialHook?.(dotMaterial);
            this.add(new Mesh(dots, dotMaterial));
        }
        this.apply();
    }

    private dimpleMaterial(shown: IUniform<number>): ShaderMaterial {
        return new ShaderMaterial({
            uniforms: { ...this.uniforms, particleShown: shown },
            vertexShader: /* glsl */ `
                ${particleFieldPars}
                ${dimplePars}
                void main() {
                    ${dimpleBeginVertex}
                    gl_Position = projectionMatrix * viewMatrix * vec4(transformed, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                ${dimpleFragPars}
                void main() {
                    ${dimpleFrag}
                    #include <colorspace_fragment>
                }
            `,
            transparent: true,
            depthWrite: false,
        });
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

    private editFlake(params: WebGLProgramParametersWithUniforms, shown: IUniform<number>, cools: IUniform<number>): void {
        params.vertexShader = replace(params.vertexShader, '#include <common>', `#include <common>\n${particleFieldPars}\n${flakeRotationPars}`);
        params.vertexShader = replace(params.vertexShader, '#include <beginnormal_vertex>', flakeBeginNormal);
        params.vertexShader = replace(params.vertexShader, '#include <begin_vertex>', flakeBeginVertex);
        params.fragmentShader = replace(params.fragmentShader, '#include <common>', `#include <common>\n${flashTintPars}`);
        params.fragmentShader = replace(params.fragmentShader, '#include <opaque_fragment>', flashTintFrag);
        Object.assign(params.uniforms, this.uniforms, { particleShown: shown, particleCools: cools });
    }

    private editSteam(params: WebGLProgramParametersWithUniforms, shown: IUniform<number>): void {
        params.vertexShader = replace(params.vertexShader, '#include <common>', `#include <common>\n${particleFieldPars}\n${steamPars}`);
        params.vertexShader = replace(params.vertexShader, '#include <begin_vertex>', steamBeginVertex);
        params.fragmentShader = replace(params.fragmentShader, '#include <common>', `#include <common>\n${steamFragPars}`);
        params.fragmentShader = replace(params.fragmentShader, '#include <dithering_fragment>', `#include <dithering_fragment>\n${steamFrag}`);
        Object.assign(params.uniforms, this.uniforms, { particleShown: shown });
    }

    private editDot(params: WebGLProgramParametersWithUniforms, shown: IUniform<number>, whiten: IUniform<number>, cools: IUniform<number>): void {
        params.vertexShader = replace(params.vertexShader, '#include <common>', `#include <common>\n${particleFieldPars}\n${dotPars}`);
        params.vertexShader = replace(params.vertexShader, '#include <begin_vertex>', dotBeginVertex);
        params.fragmentShader = replace(params.fragmentShader, '#include <common>', `#include <common>\n${dotFragPars}\n${flashTintPars}`);
        params.fragmentShader = replace(params.fragmentShader, '#include <opaque_fragment>', flashTintFrag);
        params.fragmentShader = replace(params.fragmentShader, '#include <dithering_fragment>', `#include <dithering_fragment>\n${dotFrag}`);
        Object.assign(params.uniforms, this.uniforms, { particleShown: shown, dotWhiten: whiten, particleCools: cools });
    }

    /**
     * Where the pillars cross the water, so floating particles flow around them. The textures update in place when the
     * pillars rebuild
     */
    public setPillarField(field: PillarField): void {
        const u = this.uniforms;
        u.particlePillarsA.value = field.dataA;
        u.particlePillarsB.value = field.dataB;
        u.particlePillarOrigin.value.copy(field.origin);
        u.particlePillarCell.value = field.cellSize;
        u.particlePillarGrid.value.copy(field.size);
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
        u.particleFloatTime.value = s.floatSeconds;
        u.particleSinkMurk.value = s.sinkMurk;
        u.particleCoolSeconds.value = Math.max(s.emberCoolSeconds, 0.05);
        u.steamSeconds.value = Math.max(s.steamSeconds, 0.05);
        u.steamSize.value = s.steamSize;
        u.steamRise.value = s.steamRise;
        u.steamOpacity.value = s.steamOpacity;
        for (const m of this.steamMaterials) m.color.set(s.steamColor);
        u.particleBlastStrength.value = s.blastStrength;
        u.particleBlastReach.value = Math.max(s.blastReach, 0.1);
        u.particleBlastSpeed.value = Math.max(s.blastSpeed, 0.1);
        u.particleBlastSettle.value = Math.max(s.blastSettleSeconds, 0.1);
        u.particleBlastSpinAmount.value = s.blastSpin;
        u.particleGustStrength.value = s.gustStrength;
        u.particleGustReach.value = Math.max(s.gustReach, 0.1);
        u.particleGustSpeed.value = Math.max(s.gustSpeed, 1);
        u.particleGustSettle.value = Math.max(s.gustSettleSeconds, 0.05);
        u.particleGustSpin.value = s.gustSpin;
        this.dotWhiten.get('flakeColor1')!.value = s.dotWhiten1;
        this.dotWhiten.get('flakeColor2')!.value = s.dotWhiten2;
        u.particleSinkSpeed.value = s.sinkSpeed;
        u.particleSinkDepth.value = Math.max(s.sinkDepth, 1e-3);
        u.particlePillarMargin.value = s.pillarMargin;
        u.dimpleSize.value = s.dimpleSize;
        u.dimpleDarkness.value = s.dimpleDarkness;
        u.dimpleRim.value = s.dimpleRim;
        u.dimpleRimColor.value.set(s.dimpleRimColor);
        this.flakeMaterials.forEach((m, k) => {
            m.color.set(s[this.colours[k].colorKey]);
            m.emissive.set(s[this.colours[k].colorKey]);
            m.emissiveIntensity = s.flakeGlow;
        });
    }

    /**
     * Overrides the flakes' glow (the day/night cycle raises it at night)
     */
    public setShown(colorKey: string, share: number): void {
        const shown = this.shown.get(colorKey);
        if (shown) shown.value = share;
    }

    /**
     * The cursor's dents in the water, which push floating particles aside
     * @param points the water's own touch points (x, z, strength), shared so both always agree
     * @param radius how far around each dent particles are pushed
     * @param push how strongly, as a share of that radius (up to about 1, beyond it particles pass each other)
     */
    public setTouch(points: Vector3[], radius: number, push: number): void {
        this.uniforms.particleTouchPoints.value = points;
        this.uniforms.particleTouchRadius.value = Math.max(radius, 1e-3);
        this.uniforms.particleTouchPush.value = push;
    }

    /**
     * A meteor's flash: while it's on, the particles take on its colour
     * @param amount how bright the flash is right now, 0 to 1
     */
    public setFlash(color: Color, amount: number): void {
        this.uniforms.particleFlashColor.value.copy(color);
        this.uniforms.particleFlash.value = Math.min(Math.max(amount, 0), 1) * this.settings.flashTint;
    }

    /** the water's underwater colour, shared (not copied), so sinking particles follow it through the day */
    public setMurkColor(color: Color): void {
        this.uniforms.particleMurkColor.value = color;
    }

    private blastStart = -1e3;

    /** a meteor hit the water at `at`: its blast pushes the particles around it away */
    public blast(at: Vector3): void {
        this.uniforms.particleBlastCentre.value.copy(at);
        this.blastStart = this.uniforms.particleTime.value;
        this.uniforms.particleBlastTime.value = this.blastStart;
    }

    public setGlow(glow: number): void {
        for (const m of this.flakeMaterials) m.emissiveIntensity = glow;
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
        folder.add(this.settings, 'floatSeconds', 0, 60, 0.5).onChange(apply);
        folder.add(this.settings, 'sinkSpeed', 0.001, 0.2, 0.001).onChange(apply);
        folder.add(this.settings, 'sinkDepth', 0.01, 2, 0.01).onChange(apply);
        folder.add(this.settings, 'pillarMargin', 0, 0.2, 0.005).onChange(apply);
        folder.add(this.settings, 'dimpleSize', 0, 6, 0.05).onChange(apply);
        folder.add(this.settings, 'dimpleDarkness', 0, 1, 0.01).onChange(apply);
        folder.add(this.settings, 'dimpleRim', 0, 1, 0.01).onChange(apply);
        folder.addColor(this.settings, 'dimpleRimColor').onChange(apply);
        folder.addColor(this.settings, 'flakeColor1').onChange(apply);
        folder.addColor(this.settings, 'flakeColor2').onChange(apply);
        folder.add(this.settings, 'flashTint', 0, 1, 0.01);
        folder.add(this.settings, 'dotWhiten1', 0, 1, 0.01).name('dotWhiten1 (cyan, far)').onChange(apply);
        folder.add(this.settings, 'dotWhiten2', 0, 1, 0.01).name('dotWhiten2 (orange, far)').onChange(apply);
        folder.add(this.settings, 'sinkMurk', 0, 100, 0.5).onChange(apply);
        folder.add(this.settings, 'emberCoolSeconds', 0.05, 10, 0.05).onChange(apply);
        folder.add(this.settings, 'steamSeconds', 0.1, 5, 0.05).onChange(apply);
        folder.add(this.settings, 'steamSize', 0, 0.3, 0.005).onChange(apply);
        folder.add(this.settings, 'steamRise', 0, 0.5, 0.005).onChange(apply);
        folder.add(this.settings, 'steamOpacity', 0, 1, 0.01).onChange(apply);
        folder.addColor(this.settings, 'steamColor').onChange(apply);
        folder.add(this.settings, 'blastStrength', 0, 3, 0.05).onChange(apply);
        folder.add(this.settings, 'blastReach', 0.5, 15, 0.1).onChange(apply);
        folder.add(this.settings, 'blastSpeed', 1, 60, 0.5).onChange(apply);
        folder.add(this.settings, 'blastSettleSeconds', 0.2, 10, 0.1).onChange(apply);
        folder.add(this.settings, 'blastSpin', 0, 20, 0.1).onChange(apply);
        folder.add(this.settings, 'gustStrength', 0, 2, 0.01).onChange(apply);
        folder.add(this.settings, 'gustReach', 1, 60, 0.5).onChange(apply);
        folder.add(this.settings, 'gustSpeed', 5, 300, 1).onChange(apply);
        folder.add(this.settings, 'gustSettleSeconds', 0.1, 5, 0.05).onChange(apply);
        folder.add(this.settings, 'gustSpin', 0, 20, 0.1).onChange(apply);
    }

    public update(clock: Clock): void {
        this.uniforms.particleTime.value = clock.elapsedTime;
        this.uniforms.particleBlastAge.value = clock.elapsedTime - this.blastStart;
        this.uniforms.particleLiftHeight.value = this.lip.height;
        this.uniforms.particleLiftWidth.value = this.lip.width;
        this.uniforms.particlePatchRadius.value = this.lip.patchRadius;
    }
}
