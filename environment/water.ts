import { Clock, Color, IUniform, LoadingManager, Material, Mesh, MeshStandardMaterial, PlaneGeometry, RepeatWrapping, Scene, TextureLoader, Vector3, WebGLProgramParametersWithUniforms } from "three";
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

export const WATER_LEVEL_Y = -1;

/**
 * Makes the surface see-through when looking down into it and reflective towards grazing angles, so the submerged
 * geometry (tinted by shaders/underwater.glsl.ts) shows through it
 */
const TRANSPARENCY_EDIT: [string, string] = [
    "gl_FragColor = vec4( outgoingLight, alpha );",
    "gl_FragColor = vec4( outgoingLight, mix( surfaceOpacity, 1.0, pow( 1.0 - theta, fresnelPower ) ) );"
];

const makeTransparent = (params: WebGLProgramParametersWithUniforms, uniforms: { [name: string]: IUniform }) => {
    const [search, replacement] = TRANSPARENCY_EDIT;
    if (!params.fragmentShader.includes(search)) {
        console.warn(`Water shader no longer contains "${search}"; transparency edit not applied.`);
        return;
    }
    params.fragmentShader = params.fragmentShader
        .replace("uniform float alpha;", "uniform float alpha;\nuniform float surfaceOpacity;\nuniform float fresnelPower;")
        .replace(search, replacement);
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

    constructor(
        private water: ThreeWater,
        private fogShader: ShaderExtension,
        private seabed: Mesh,
        private look: WaterLook,
        private surfaceUniforms: { [name: string]: IUniform },
        private underwaterUniforms: { [name: string]: IUniform }) {}

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

    public applyLook(): void {
        const l = this.look;
        this.surfaceUniforms.surfaceOpacity.value = l.surfaceOpacity;
        this.surfaceUniforms.fresnelPower.value = l.fresnelPower;
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
    }

    /**
     * Deals with higher than 60 FPS refresh rates... hopefully
     */
    public update(clock: Clock): void {
        if (clock.oldTime - this.lastWaterUpdate >= UPDATE_WATER_EVERY_MS) {
            this.water.material.uniforms['time'].value += UPDATE_BY;
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

    public makeWater(normalsPath: string, offsetZ: number, look: WaterLook): Water {
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

        const surfaceUniforms: { [name: string]: IUniform } = {
            surfaceOpacity: { value: 1 },
            fresnelPower: { value: 1 },
        };
        const underwaterUniforms: { [name: string]: IUniform } = {
            waterLevelY: { value: WATER_LEVEL_Y },
            underwaterColor: { value: new Color() },
            underwaterDensity: { value: 0 },
        };

        water.material.transparent = true;
        water.material.onBeforeCompile = (params, renderer) => {
            restoreLegacyReflectance(params);
            makeTransparent(params, surfaceUniforms);
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

        const result = new Water(water, fogShader, seabed, look, surfaceUniforms, underwaterUniforms);
        result.addUnderwaterTo(seabed.material);
        result.applyLook();
        return result;
    }
}