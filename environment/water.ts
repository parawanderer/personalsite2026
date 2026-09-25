import { Camera, Clock, Color, DataTexture, IUniform, LoadingManager, Material, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, RepeatWrapping, Scene, TextureLoader, Vector2, Vector3, WebGLProgramParametersWithUniforms } from "three";
import GUI from "three/addons/libs/lil-gui.module.min.js";
import { Water as ThreeWater } from "three/addons/objects/Water";

import {
    CAMERA_INITIAL_Z,
    FOG_UPDATE_BY,
    FOG_UPDATE_EVERY_MS,
    PILLARS_FOG_FAR_COLOR,
    PILLARS_FOG_NEAR_COLOR,
    PILLARS_FOG_NOISE_FREQ,
    PILLARS_FOG_NOISE_IMPACT,
    PILLARS_FOG_NOISE_SPEED,
    ROW_LENGTH_X,
    ROW_LENGTH_Z,
    WALLS_OFFSET,
    WATER_COLOR,
    WATER_SUN_COLOR,
    WaterLook
} from "../constants";

import { AnimatedEntity } from "../entity/animated-entity";
import { customFogExtension, ShaderExtension } from "./animated-fog";
import { fogFrag, fogParsFrag, fogParsVert, fogVert } from "../shaders/water-fogedits.glsl";
import { applyUnderwater } from "../shaders/underwater.glsl";
import { displacedVertex, interactionMain, interactionPars } from "../shaders/water-interaction.glsl";
import type { PillarField } from "./walls";

export const WATER_LEVEL_Y = -1;

/**
 * Edits to three's Water shader:
 * - see-through when looking down into it and reflective towards grazing angles, so the submerged geometry
 *   (shaded by shaders/underwater.glsl.ts) shows through
 * - ripples that drift with the flow and can be made slower, longer and shallower (viscosity)
 * - the pillar interaction (shaders/water-interaction.glsl.ts), plus its rim light
 */
const WATER_EDITS: [string, string][] = [
    [
        "uniform float alpha;",
        `uniform float alpha;\nuniform float surfaceOpacity;\nuniform float fresnelPower;\n${interactionPars}`
    ],
    [
        "vec4 noise = getNoise( worldPosition.xz * size );",
        "vec4 noise = getNoise( ( worldPosition.xz - flowOffset ) * size * rippleScale );"
    ],
    [
        "vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );",
        `vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5 * rippleAmp, 1.0, 1.5 * rippleAmp ) );\n${interactionMain}`
    ],
    [
        "gl_FragColor = vec4( outgoingLight, alpha );",
        `gl_FragColor = vec4(
            outgoingLight + rimColor * rimStrength * pillarRim,
            clamp( mix( surfaceOpacity, 1.0, pow( 1.0 - theta, fresnelPower ) ) + pillarRim * rimStrength, 0.0, 1.0 )
        );`
    ],
];

/**
 * The vertex side: world position computed once, and lifted by the pillar height in the displaced patch
 */
const WATER_VERTEX_EDITS: [string, string][] = [
    ["uniform float time;", `uniform float time;\n${interactionPars}`],
    ["mirrorCoord = modelMatrix * vec4( position, 1.0 );", displacedVertex],
    ["worldPosition = mirrorCoord.xyzw;", ""],
    ["mirrorCoord = textureMatrix * mirrorCoord;", ""],
    ["vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );", ""],
];

const applyEdits = (source: string, edits: [string, string][]) => {
    for (const [search, replacement] of edits) {
        if (!source.includes(search)) {
            console.warn(`Water shader no longer contains "${search}"; edit not applied.`);
            continue;
        }
        source = source.replace(search, replacement);
    }
    return source;
};

const editWaterShader = (params: WebGLProgramParametersWithUniforms, uniforms: { [name: string]: IUniform }) => {
    params.vertexShader = applyEdits(params.vertexShader, WATER_VERTEX_EDITS);
    params.fragmentShader = applyEdits(params.fragmentShader, WATER_EDITS);
    Object.assign(params.uniforms, uniforms);
};

const UPDATE_WATER_EVERY_MS = 1000/60;

const SLOWNESS = 600;
const UPDATE_BY = 1/SLOWNESS;

/**
 * three r175+ lowered the Water shader's base reflectance (rf0 0.3 -> 0.02) and changed the albedo mix,
 * which makes the water render much darker. This puts back the r174 lines the scene was tuned against.
 */
const LEGACY_REFLECTANCE_EDITS: [string, string][] = [
    [
        "float rf0 = 0.02;",
        "float rf0 = 0.3;"
    ],
    [
        "reflectionSample + specularLight, reflectance );",
        "( vec3( 0.1 ) + reflectionSample * 0.9 + reflectionSample * specularLight ), reflectance );"
    ],
];

const restoreLegacyReflectance = (params: WebGLProgramParametersWithUniforms) => {
    for (const [search, replacement] of LEGACY_REFLECTANCE_EDITS) {
        if (!params.fragmentShader.includes(search)) {
            console.warn(`Water shader no longer contains "${search}"; reflectance edit not applied.`);
            continue;
        }
        params.fragmentShader = params.fragmentShader.replace(search, replacement);
    }
};


export class Water implements AnimatedEntity {
    private lastWaterUpdate: number = 0;
    private lastFogUpdate: number = 0;

    /** how fast the surface drifts (world units per second, x and z), for things floating on it */
    public readonly flowVelocity = new Vector2();
    /** the raised lip near the pillars, for things floating on it (see shaders/water-interaction.glsl.ts) */
    public readonly lip = { height: 0, width: 1, patchRadius: 0 };

    private patch?: Mesh<PlaneGeometry, ShaderMaterial>;
    private patchGeometryKey = '';

    /**
     * The water renders its reflection by rendering the scene; the patch samples that reflection, so it has to stay
     * out of it (like the water plane itself) or it would read from the texture it's drawing into
     */
    private hidePatchFromReflection(): void {
        const renderReflection = this.water.onBeforeRender;
        this.water.onBeforeRender = (...args) => {
            const patch = this.patch;
            if (patch) patch.visible = false;
            renderReflection.apply(this.water, args);
            if (patch) patch.visible = true;
        };
    }

    constructor(
        private camera: Camera,
        private water: ThreeWater,
        private fogShader: ShaderExtension,
        private seabed: Mesh,
        private look: WaterLook,
        private surfaceUniforms: { [name: string]: IUniform },
        private underwaterUniforms: { [name: string]: IUniform }) {
        this.hidePatchFromReflection();
    }

    private onSeabedChange?: (depth: number) => void;

    /**
     * Called with the seabed depth now and whenever it changes, so the pillars can reach down to it
     */
    public setSeabedListener(listener: (depth: number) => void): void {
        this.onSeabedChange = listener;
        listener(this.look.seabedDepth);
    }

    /**
     * Shades the parts of a material that are below the surface as seen through the water.
     * Call before the material is first rendered.
     */
    public addUnderwaterTo(material: Material): void {
        const previous = material.onBeforeCompile;
        material.onBeforeCompile = (params, renderer) => {
            previous.call(material, params, renderer);
            applyUnderwater(params, this.underwaterUniforms);
        };
        material.needsUpdate = true;
    }

    /**
     * Where the pillars cross the surface, for the pillar interaction. The field's textures update in place when the pillars rebuild
     */
    public setPillarField(field: PillarField): void {
        const u = this.surfaceUniforms;
        u.pillarDataA.value = field.dataA;
        u.pillarDataB.value = field.dataB;
        u.pillarGridOrigin.value.copy(field.origin);
        u.pillarCellSize.value = field.cellSize;
        u.pillarGridSize.value.copy(field.size);
    }

    /** slows the ripples and the drift as the water gets thicker */
    private get timeScale(): number {
        return 1 - 0.8 * this.look.viscosity;
    }

    /**
     * A finely subdivided square of water around the camera, displaced around the pillars. Shares the water's material
     * (uniforms, reflection) apart from the WATER_PATCH define
     */
    private updatePatch(): void {
        const l = this.look;
        const key = `${l.displacementRadius}/${l.displacementSpacing}`;
        if (key === this.patchGeometryKey) return;
        this.patchGeometryKey = key;

        if (this.patch) {
            this.patch.removeFromParent();
            this.patch.geometry.dispose();
            this.patch = undefined;
        }
        this.surfaceUniforms.patchHalfSize.value = 0;
        if (l.displacementRadius <= 0) return;

        const size = l.displacementRadius * 2;
        const segments = Math.min(1024, Math.ceil(size / Math.max(l.displacementSpacing, 0.002)));
        const source = this.water.material;
        const material = new ShaderMaterial({
            vertexShader: source.vertexShader,
            fragmentShader: source.fragmentShader,
            uniforms: source.uniforms,
            defines: { WATER_PATCH: '' },
            lights: source.lights,
            fog: source.fog,
            side: source.side,
            transparent: source.transparent,
        });
        material.onBeforeCompile = source.onBeforeCompile;

        this.patch = new Mesh(new PlaneGeometry(size, size, segments, segments), material);
        this.patch.rotation.copy(this.water.rotation);
        this.patch.position.y = WATER_LEVEL_Y;
        // it moves with the camera, keep three from culling it by its (stale) bounds
        this.patch.frustumCulled = false;
        this.water.parent?.add(this.patch);
        this.surfaceUniforms.patchHalfSize.value = l.displacementRadius;
    }

    /** snapped to the vertex spacing so the displaced surface doesn't swim as the camera moves */
    private followCamera(): void {
        if (!this.patch) return;
        const step = (this.look.displacementRadius * 2) / this.patch.geometry.parameters.widthSegments;
        const x = Math.round(this.camera.position.x / step) * step;
        const z = Math.round(this.camera.position.z / step) * step;
        this.patch.position.x = x;
        this.patch.position.z = z;
        (this.surfaceUniforms.patchCentre.value as Vector2).set(x, z);
    }

    public applyLook(): void {
        const l = this.look;
        const u = this.surfaceUniforms;
        u.displacementScale.value = l.displacementScale;
        this.updatePatch();
        u.surfaceOpacity.value = l.surfaceOpacity;
        u.fresnelPower.value = l.fresnelPower;
        u.rippleScale.value = 1 - 0.55 * l.viscosity;
        u.rippleAmp.value = 1 - 0.5 * l.viscosity;
        u.flowDir.value.set(Math.cos(l.flowAngleDeg * Math.PI / 180), Math.sin(l.flowAngleDeg * Math.PI / 180));
        this.flowVelocity.copy(u.flowDir.value).multiplyScalar(l.flowSpeed * this.timeScale);
        this.lip.height = l.meniscusHeight * l.displacementScale;
        this.lip.width = Math.max(l.meniscusWidth, 1e-4);
        this.lip.patchRadius = l.displacementRadius;
        u.meniscusHeight.value = l.meniscusHeight;
        u.meniscusWidth.value = Math.max(l.meniscusWidth, 1e-4);
        u.cushionStrength.value = l.cushionStrength;
        u.cushionWidth.value = Math.max(l.cushionWidth, 1e-4);
        u.wakeStretch.value = l.wakeStretch;
        u.rippleDampRadius.value = l.rippleDampRadius;
        // where the meniscus, the cushion (and its stretched wake) and the ripple damping have all faded out
        u.interactionReach.value = Math.max(l.meniscusWidth * 5, l.cushionWidth * Math.max(l.wakeStretch, 1) * 4, l.rippleDampRadius);
        u.rimColor.value.set(l.rimColor);
        u.rimStrength.value = l.rimStrength;
        u.interactionDistance.value = l.interactionDistance;
        this.underwaterUniforms.wetBandHeight.value = Math.max(l.wetBandHeight, 1e-4);
        this.underwaterUniforms.wetBandDarkness.value = l.wetBandDarkness;
        const uw = this.underwaterUniforms;
        uw.causticColor.value.set(l.causticColor);
        uw.causticStrength.value = l.causticStrength;
        uw.causticAbove.value = Math.max(l.causticAbove, 1e-4);
        uw.causticBelow.value = Math.max(l.causticBelow, 1e-4);
        uw.causticScale.value = l.causticScale;
        uw.causticSharpness.value = l.causticSharpness;
        this.underwaterUniforms.underwaterColor.value.set(l.underwaterColor);
        this.underwaterUniforms.underwaterDensity.value = l.underwaterDensity;
        this.seabed.position.y = WATER_LEVEL_Y - l.seabedDepth;
    }

    public bindTweaks(folder: GUI): void {
        const apply = () => this.applyLook();
        folder.add(this.look, 'surfaceOpacity', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'fresnelPower', 0.5, 10, 0.1).onChange(apply);
        folder.addColor(this.look, 'underwaterColor').onChange(apply);
        folder.add(this.look, 'underwaterDensity', 0, 10, 0.05).onChange(apply);
        folder.add(this.look, 'seabedDepth', 0.1, 5, 0.05).onChange(apply).onFinishChange(() => this.onSeabedChange?.(this.look.seabedDepth));
        folder.add(this.look, 'viscosity', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'flowAngleDeg', 0, 360, 1).onChange(apply);
        folder.add(this.look, 'flowSpeed', 0, 0.5, 0.005).onChange(apply);
        folder.add(this.look, 'meniscusHeight', 0, 0.03, 0.0005).onChange(apply);
        folder.add(this.look, 'meniscusWidth', 0.005, 0.2, 0.005).onChange(apply);
        folder.add(this.look, 'cushionStrength', 0, 0.05, 0.0005).onChange(apply);
        folder.add(this.look, 'cushionWidth', 0.01, 0.5, 0.005).onChange(apply);
        folder.add(this.look, 'wakeStretch', 1, 10, 0.1).onChange(apply);
        folder.add(this.look, 'rippleDampRadius', 0, 0.5, 0.005).onChange(apply);
        folder.addColor(this.look, 'rimColor').onChange(apply);
        folder.add(this.look, 'rimStrength', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'interactionDistance', 0, 30, 0.5).onChange(apply);
        folder.add(this.look, 'displacementScale', 0, 20, 0.1).onChange(apply);
        folder.add(this.look, 'displacementRadius', 0, 6, 0.1).onFinishChange(apply);
        folder.add(this.look, 'displacementSpacing', 0.004, 0.05, 0.001).onFinishChange(apply);
        folder.addColor(this.look, 'causticColor').onChange(apply);
        folder.add(this.look, 'causticStrength', 0, 2, 0.01).onChange(apply);
        folder.add(this.look, 'causticAbove', 0, 1.5, 0.01).onChange(apply);
        folder.add(this.look, 'causticBelow', 0, 2, 0.01).onChange(apply);
        folder.add(this.look, 'causticScale', 0.5, 30, 0.1).onChange(apply);
        folder.add(this.look, 'causticSpeed', 0, 2, 0.01).onChange(apply);
        folder.add(this.look, 'causticSharpness', 1, 12, 0.1).onChange(apply);
        folder.add(this.look, 'wetBandHeight', 0, 0.3, 0.005).onChange(apply);
        folder.add(this.look, 'wetBandDarkness', 0, 1, 0.01).onChange(apply);
    }

    /**
     * Deals with higher than 60 FPS refresh rates... hopefully
     */
    public update(clock: Clock): void {
        this.followCamera();
        if (clock.oldTime - this.lastWaterUpdate >= UPDATE_WATER_EVERY_MS) {
            this.water.material.uniforms['time'].value += UPDATE_BY * this.timeScale;
            this.underwaterUniforms.causticTime.value += this.look.causticSpeed * this.timeScale * UPDATE_WATER_EVERY_MS / 1000;
            const flow = this.surfaceUniforms.flowDir.value as Vector2;
            (this.surfaceUniforms.flowOffset.value as Vector2).addScaledVector(flow, this.look.flowSpeed * this.timeScale * UPDATE_WATER_EVERY_MS / 1000);
            this.lastWaterUpdate = clock.oldTime;
        }

        const uniforms = this.fogShader.getUniforms();
        if (uniforms && clock.oldTime - this.lastFogUpdate >= FOG_UPDATE_EVERY_MS) {
            uniforms['fogTime'].value += FOG_UPDATE_BY;
            this.lastFogUpdate = clock.oldTime;
        }
    }
}

export class WaterFactory {
    constructor(private loadingMgr: LoadingManager, private scene: Scene) {}

    public makeWater(normalsPath: string, offsetZ: number, look: WaterLook, camera: Camera): Water {
        const width = 2*ROW_LENGTH_X + 2*WALLS_OFFSET;
        const depth = CAMERA_INITIAL_Z + ROW_LENGTH_Z*2;

        const geometry = new PlaneGeometry(width, depth);

        const water = new ThreeWater(geometry, {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals: new TextureLoader(this.loadingMgr).load(normalsPath, (texture) => {
                texture.wrapS = texture.wrapT = RepeatWrapping;
            }),
            sunDirection: new Vector3(0, 10, -10),
            sunColor: WATER_SUN_COLOR,
            waterColor: WATER_COLOR,
            distortionScale: 0.25,
            fog: true,
        });

        const fogShader: ShaderExtension = customFogExtension({
            fogNearColor: PILLARS_FOG_NEAR_COLOR,
            fogFarColor: PILLARS_FOG_FAR_COLOR,
            fogNoiseFreq: PILLARS_FOG_NOISE_FREQ,
            fogNoiseImpact: PILLARS_FOG_NOISE_IMPACT,
            fogTime: 0,
            fogNoiseSpeed: PILLARS_FOG_NOISE_SPEED,
            fogFrag,
            fogParsFrag,
            fogParsVert,
            fogVert
        });

        water.receiveShadow = true;

        // values are set by Water.applyLook, the pillar field by Water.setPillarField
        const emptyField = new DataTexture(new Float32Array(4), 1, 1);
        const surfaceUniforms: { [name: string]: IUniform } = {
            surfaceOpacity: { value: 1 },
            fresnelPower: { value: 1 },
            pillarDataA: { value: emptyField },
            pillarDataB: { value: emptyField },
            pillarGridOrigin: { value: new Vector2() },
            pillarCellSize: { value: 1 },
            pillarGridSize: { value: new Vector2() },
            flowDir: { value: new Vector2(0, 1) },
            flowOffset: { value: new Vector2() },
            rippleScale: { value: 1 },
            rippleAmp: { value: 1 },
            meniscusHeight: { value: 0 },
            meniscusWidth: { value: 1 },
            cushionStrength: { value: 0 },
            cushionWidth: { value: 1 },
            wakeStretch: { value: 1 },
            rippleDampRadius: { value: 0 },
            rimColor: { value: new Color() },
            rimStrength: { value: 0 },
            interactionDistance: { value: 0 },
            patchCentre: { value: new Vector2() },
            patchHalfSize: { value: 0 },
            displacementScale: { value: 1 },
            interactionReach: { value: 0 },
        };
        const underwaterUniforms: { [name: string]: IUniform } = {
            waterLevelY: { value: WATER_LEVEL_Y },
            underwaterColor: { value: new Color() },
            underwaterDensity: { value: 0 },
            wetBandHeight: { value: 1 },
            wetBandDarkness: { value: 0 },
            causticColor: { value: new Color() },
            causticStrength: { value: 0 },
            causticAbove: { value: 1 },
            causticBelow: { value: 1 },
            causticScale: { value: 1 },
            causticTime: { value: 0 },
            causticSharpness: { value: 1 },
            // the same vector as the ripples' flowOffset, so both drift together
            causticFlow: surfaceUniforms.flowOffset,
        };

        water.material.transparent = true;
        water.material.onBeforeCompile = (params, renderer) => {
            restoreLegacyReflectance(params);
            editWaterShader(params, surfaceUniforms);
            fogShader.handle(params, renderer);
        };

        water.position.x = 0;
        water.position.z = offsetZ + (-2*ROW_LENGTH_X)+3;
        water.position.y = WATER_LEVEL_Y;
        water.rotation.x = - Math.PI / 2;


        const waterUniforms = water.material.uniforms;
        waterUniforms['size'].value = 10;

        this.scene.add(water);

        // the floor seen through the water between the pillars, fully shaded by the underwater absorption
        const seabed = new Mesh(geometry.clone(), new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 }));
        seabed.rotation.copy(water.rotation);
        seabed.position.set(water.position.x, WATER_LEVEL_Y, water.position.z);
        this.scene.add(seabed);

        const result = new Water(camera, water, fogShader, seabed, look, surfaceUniforms, underwaterUniforms);
        result.addUnderwaterTo(seabed.material);
        result.applyLook();
        return result;
    }
}