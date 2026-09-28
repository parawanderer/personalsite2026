import { BufferGeometry, Camera, Clock, Color, DataTexture, DoubleSide, IUniform, LoadingManager, Material, Mesh, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, RepeatWrapping, Scene, Texture, TextureLoader, UniformsLib, UniformsUtils, Vector2, Vector3, WebGLProgramParametersWithUniforms } from "three";
import GUI from "three/addons/libs/lil-gui.module.min.js";
import { Water as ThreeWater } from "three/addons/objects/Water";

import {
    FOG_UPDATE_BY,
    FOG_UPDATE_EVERY_MS,
    PILLARS_FOG_FAR_COLOR,
    PILLARS_FOG_NEAR_COLOR,
    PILLARS_FOG_NOISE_FREQ,
    PILLARS_FOG_NOISE_IMPACT,
    PILLARS_FOG_NOISE_SPEED,
    ROW_LENGTH_X,
    WATER_COLOR,
    WATER_SUN_COLOR,
    WaterLook
} from "../constants";

import { AnimatedEntity } from "../entity/animated-entity";
import { customFogExtension, ShaderExtension } from "./animated-fog";
import { fogFrag, fogParsFrag, fogParsVert, fogVert } from "../shaders/water-fogedits.glsl";
import { applyUnderwater } from "../shaders/underwater.glsl";
import { displacedVertex, interactionMain, interactionPars, TOUCH_POINTS } from "../shaders/water-interaction.glsl";
import { shaftUniforms } from "../shaders/sun-shafts.glsl";
import { undersideFragment, undersideVertex } from "../shaders/water-underside.glsl";
import type { PillarField } from "./walls";

/** the entries of `uniforms` named in `names` (the ones it has) */
const pick = (uniforms: { [name: string]: IUniform }, names: string[]): { [name: string]: IUniform } => {
    const picked: { [name: string]: IUniform } = {};
    for (const n of names) if (n in uniforms) picked[n] = uniforms[n];
    return picked;
};

export const WATER_LEVEL_Y = -1;
// the surface seen from above and the flat seabed under it: squares this wide that follow the camera, reaching past
// the camera's far plane, so the water never ends
const SURFACE_SIZE = 2000;
// divided into cells this many to a side, and moved only in steps of one cell: a plane of two huge triangles sliding
// with the camera made the reflection jitter (the reflection's coordinates interpolated across triangles kilometres
// wide, clipped at the camera's near plane, lose precision). Its look depends only on world position, so the steps
// don't show
const SURFACE_SEGMENTS = 40;
// the ceiling seen from under the water: its size around the camera, and how finely it's divided (its waves are about
// a metre long)
const UNDERSIDE_SIZE = 40;
const UNDERSIDE_SEGMENTS = 200;
// how far past the impact (and the camera) the splash mesh reaches, so its edges sit where the waves have faded
const SPLASH_AREA_MARGIN = 4;

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
        // the shadow is looked up once and reused below: each lookup is several texture reads, on every water pixel
        // only the start of the line: the reflectance edit below rewrites its end
        "vec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * getShadowMask(),",
        "float waterShadow = getShadowMask();\nvec3 albedo = mix( ( sunColor * diffuseLight * 0.3 + scatter ) * waterShadow,"
    ],
    [
        "gl_FragColor = vec4( outgoingLight, alpha );",
        `gl_FragColor = vec4(
            // while a meteor's flash is on, the rest of the water looks darker next to it, and the pillars' shadows
            // darken its reflections too (they wouldn't really, but on the shiny far water they'd vanish otherwise)
            (outgoingLight + rimColor * rimStrength * pillarRim) * (1.0 - splashDarken) * mix(1.0, waterShadow, splashShadowReflection)
                + (splashLight(length(worldPosition.xz - splashCenter)) * splashReliefLight(worldPosition.xyz, surfaceNormal)
                    + splashGlint(worldPosition.xyz, surfaceNormal, eye)) * waterShadow
                + volcanoWaterLight(surfaceNormal),
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
        "( vec3( reflectionFloor ) + reflectionSample * 0.9 * reflectionBoost( reflectionSample ) + reflectionSample * specularLight ), reflectance );"
    ],
];

/**
 * The r174 mix adds a flat grey to every reflection (0.1 by day); the day/night cycle lowers it at night, where it
 * otherwise turns the water into the brightest thing on screen
 */
const restoreLegacyReflectance = (params: WebGLProgramParametersWithUniforms) => {
    params.fragmentShader = params.fragmentShader.replace("uniform float alpha;", "uniform float alpha;\nuniform float reflectionFloor;\nuniform float reflectionStrength;\nuniform float reflectionGrey;\n" +
        "// colourful reflections (aurora, glowing things) get reflectionStrength, grey ones (dark sky, fog) reflectionGrey\n" +
        "float reflectionBoost( vec3 c ) {\n" +
        "    float chroma = max( c.r, max( c.g, c.b ) ) - min( c.r, min( c.g, c.b ) );\n" +
        "    return mix( reflectionGrey, reflectionStrength, smoothstep( 0.015, 0.1, chroma ) );\n" +
        "}");
    for (const [search, replacement] of LEGACY_REFLECTANCE_EDITS) {
        if (!params.fragmentShader.includes(search)) {
            console.warn(`Water shader no longer contains "${search}"; reflectance edit not applied.`);
            continue;
        }
        params.fragmentShader = params.fragmentShader.replace(search, replacement);
    }
};


export class Water implements AnimatedEntity {
    private lastFogUpdate: number = 0;
    /** how fast the fog drifts, 1 = normal (the day/night cycle slows it at night) */
    private fogSpeed = 1;

    public setFogSpeed(speed: number): void {
        this.fogSpeed = speed;
    }

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
            const splash = this.splashMesh;
            const splashShown = splash?.visible ?? false;
            if (patch) patch.visible = false;
            if (splash) splash.visible = false;
            for (const hook of this.reflectionHooks) hook.before();
            renderReflection.apply(this.water, args);
            for (const hook of this.reflectionHooks) hook.after();
            if (patch) patch.visible = true;
            if (splash) splash.visible = splashShown;
        };
    }

    private readonly reflectionHooks: { before: () => void, after: () => void }[] = [];

    /**
     * Runs `before` and `after` around the render of the water's reflection (the whole scene, a second time), to leave
     * out what the blurred, rippled reflection doesn't need
     */
    public aroundReflection(before: () => void, after: () => void): void {
        this.reflectionHooks.push({ before, after });
    }

    constructor(
        private camera: Camera,
        private water: ThreeWater,
        private fogShader: ShaderExtension,
        private seabed: Mesh,
        private look: WaterLook,
        private surfaceUniforms: { [name: string]: IUniform },
        private underwaterUniforms: { [name: string]: IUniform },
        private underside: Mesh<BufferGeometry, ShaderMaterial>) {
        this.hidePatchFromReflection();
    }

    /** the volcano's light on the water: towards it, and its colour times how much the fluid scatters back */
    public setVolcanoLight(direction: Vector3, color: Color): void {
        (this.surfaceUniforms.volcanoLightDir.value as Vector3).copy(direction);
        (this.surfaceUniforms.volcanoLightColor.value as Color).copy(color);
    }

    /** how far the surface's ripples have drifted with the flow (shared, updated in place) */
    public get flowOffset(): Vector2 {
        return this.surfaceUniforms.flowOffset.value as Vector2;
    }

    /** whether the camera is under the water right now */
    public get cameraUnderwater(): boolean {
        return this.camera.position.y < WATER_LEVEL_Y;
    }

    /**
     * Swaps between the view from above (the surface with its reflection, patch and splash mesh) and from below (the
     * underside, and the underwater fog over everything submerged). Nothing recompiles: the fog is a uniform
     */
    private setUnderwaterView(under: boolean): void {
        this.underwaterUniforms.viewUnderwater.value = under ? 1 : 0;
        this.underside.visible = under;
        // the flat seabed is only for the view from above; from below, the columns' seabed (environment/walls.ts) is it
        this.seabed.visible = !under;
        // the surface and everything drawn with it (patch, splash mesh) are children of the same parent, hidden with it
        this.water.visible = !under;
        if (this.patch) this.patch.visible = !under;
        if (this.splashMesh) this.splashMesh.visible = !under && this.splashMeshShown;
    }

    private splashMeshShown = false;
    private viewingUnderwater = false;

    /** the seabed's height, which the camera stays above */
    public get seabedY(): number {
        return WATER_LEVEL_Y - this.look.seabedDepth;
    }

    /**
     * While the camera is under the water, the sky is the water: it's only ever seen through the surface, which shows
     * it captured from above (environment/snell-window.ts)
     */
    public addUnderwaterToSky(skyMaterial: Material): void {
        const previous = skyMaterial.onBeforeCompile;
        skyMaterial.onBeforeCompile = (params, renderer) => {
            previous.call(skyMaterial, params, renderer);
            params.uniforms.viewUnderwater = this.underwaterUniforms.viewUnderwater;
            params.uniforms.skyUnderwaterColor = this.underwaterUniforms.underwaterColor;
            params.uniforms.skyDepthAbsorption = this.underwaterUniforms.depthAbsorption;
            params.uniforms.skyWaterLevel = this.underwaterUniforms.waterLevelY;
            params.uniforms.skyViewDensity = this.underwaterUniforms.underwaterViewDensity;
            params.vertexShader = params.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vSkyUnderWorld;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvSkyUnderWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            params.fragmentShader = params.fragmentShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vSkyUnderWorld;\nuniform float viewUnderwater;\nuniform vec3 skyUnderwaterColor;\nuniform vec3 skyDepthAbsorption;\nuniform float skyWaterLevel;\nuniform float skyViewDensity;')
                .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (viewUnderwater > 0.5) gl_FragColor.rgb = mix(linearToOutputTexel(vec4(skyUnderwaterColor * exp(-skyDepthAbsorption * max(skyWaterLevel - cameraPosition.y - normalize(vSkyUnderWorld - cameraPosition).y / max(skyViewDensity, 0.05), 0.0)), 1.0)).rgb, gl_FragColor.rgb, 0.0);');
        };
        skyMaterial.needsUpdate = true;
    }

    /**
     * For capturing the world above the water from under it (environment/snell-window.ts): its look from above, without
     * the water itself (true), and back to the view the camera has (false)
     */
    public captureAbove(capturing: boolean): void {
        if (!capturing) {
            this.setUnderwaterView(this.viewingUnderwater);
            return;
        }
        this.setUnderwaterView(false);
        this.seabed.visible = false;
        this.water.visible = false;
        if (this.patch) this.patch.visible = false;
        if (this.splashMesh) this.splashMesh.visible = false;
    }

    /** the world above the water as captured from under it, which the underside looks through */
    public setAboveView(texture: Texture): void {
        this.underside.material.uniforms.undersideAbove.value = texture;
    }

    /**
     * Shows the view from below (or goes back), so its shader can be compiled behind the loading screen
     */
    public warmUpUnderwater(show: boolean): void {
        this.setUnderwaterView(show);
    }

    /** fogNearColor, fogFarColor, ... of the water's coloured fog */
    public get fogUniforms() {
        return this.fogShader.extensionUniforms;
    }

    /** underwaterColor, causticColor, causticStrength, ... */
    public get underwater() {
        return this.underwaterUniforms;
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
        this.patch = new Mesh(new PlaneGeometry(size, size, segments, segments), this.surfaceMaterial('WATER_PATCH'));
        this.patch.rotation.copy(this.water.rotation);
        this.patch.position.y = WATER_LEVEL_Y;
        // it moves with the camera, keep three from culling it by its (stale) bounds
        this.patch.frustumCulled = false;
        // the pillars' shadows from a meteor's flash, cut out of its glow on the water
        this.patch.receiveShadow = true;
        this.water.parent?.add(this.patch);
        this.surfaceUniforms.patchHalfSize.value = l.displacementRadius;
    }

    /**
     * Another surface drawn with the water's material, with a define picking what displaces it
     */
    private surfaceMaterial(define: string): ShaderMaterial {
        const source = this.water.material;
        const material = new ShaderMaterial({
            vertexShader: source.vertexShader,
            fragmentShader: source.fragmentShader,
            // the water's own uniforms are shared, so every setting reaches both. Not three's light and shadow ones,
            // though: three flags those per draw for re-upload, and sharing the flags leaves one of the two with stale
            // shadow maps (and no shadows)
            uniforms: { ...source.uniforms, ...UniformsUtils.clone(pick(source.uniforms, Object.keys(UniformsLib.lights))) },
            defines: { [define]: '' },
            lights: source.lights,
            fog: source.fog,
            side: source.side,
            transparent: source.transparent,
        });
        material.onBeforeCompile = source.onBeforeCompile;
        return material;
    }

    private splashMesh?: Mesh<PlaneGeometry, ShaderMaterial>;

    /**
     * A meteor's waves displace the water for real from the impact to the camera: a coarser mesh (the waves are broad)
     * laid over that stretch while they last, which the flat plane leaves out. Placed once per splashdown
     */
    private placeSplashMesh(impactX: number, impactZ: number): void {
        const l = this.look;
        const cam = this.camera.position;
        const margin = SPLASH_AREA_MARGIN;
        const width = Math.abs(impactX - cam.x) + margin * 2;
        const depth = Math.abs(impactZ - cam.z) + margin * 2;
        const spacing = Math.max(l.splashMeshSpacing, 0.02);
        const geometry = new PlaneGeometry(width, depth, Math.min(600, Math.ceil(width / spacing)), Math.min(600, Math.ceil(depth / spacing)));
        if (!this.splashMesh) {
            this.splashMesh = new Mesh(geometry, this.surfaceMaterial('WATER_SPLASH'));
            this.splashMesh.rotation.copy(this.water.rotation);
            this.splashMesh.frustumCulled = false;
            this.splashMesh.receiveShadow = this.water.receiveShadow;
            this.water.parent?.add(this.splashMesh);
        } else {
            this.splashMesh.geometry.dispose();
            this.splashMesh.geometry = geometry;
        }
        const centreX = (impactX + cam.x) / 2;
        const centreZ = (impactZ + cam.z) / 2;
        this.splashMesh.position.set(centreX, WATER_LEVEL_Y, centreZ);
        this.splashMeshShown = true;
        this.splashMesh.visible = !this.viewingUnderwater;
        (this.surfaceUniforms.splashAreaCentre.value as Vector2).set(centreX, centreZ);
        (this.surfaceUniforms.splashAreaHalf.value as Vector2).set(width / 2, depth / 2);
    }

    /** how long a splashdown's waves last: the swell until it has mostly faded, the rings, the crater's swings */
    private get splashSeconds(): number {
        const l = this.look;
        const swell = (l.splashSwellFade * 3) / Math.max(l.splashSwellSpeed, 0.05);
        return Math.max(l.splashRippleSeconds, l.splashCraterSeconds * 4, swell);
    }

    private hideSplashMesh(): void {
        this.splashMeshShown = false;
        if (this.splashMesh) this.splashMesh.visible = false;
        (this.surfaceUniforms.splashAreaHalf.value as Vector2).set(0, 0);
    }

    /**
     * Shows the splash mesh (or hides it again) so its shader can be compiled before the first splashdown needs it
     */
    public warmUpSplash(show: boolean): void {
        if (show) this.placeSplashMesh(this.camera.position.x, this.camera.position.z - 10);
        else this.hideSplashMesh();
    }

    /** snapped to the vertex spacing so the displaced surface doesn't swim as the camera moves */
    private followCamera(): void {
        // the whole surface and the seabed go wherever the camera goes, a cell at a time (see SURFACE_SEGMENTS)
        const cell = SURFACE_SIZE / SURFACE_SEGMENTS;
        this.water.position.x = this.seabed.position.x = Math.round(this.camera.position.x / cell) * cell;
        this.water.position.z = this.seabed.position.z = Math.round(this.camera.position.z / cell) * cell;
        if (!this.patch) return;
        const step = (this.look.displacementRadius * 2) / this.patch.geometry.parameters.widthSegments;
        const x = Math.round(this.camera.position.x / step) * step;
        const z = Math.round(this.camera.position.z / step) * step;
        this.patch.position.x = x;
        this.patch.position.z = z;
        (this.surfaceUniforms.patchCentre.value as Vector2).set(x, z);
    }

    private splashStart = -1e3;

    /** a meteor hit the water here: rings of ripples spread out from it */
    /**
     * @param light where the impact's light is, for its highlights on the water
     */
    public splash(x: number, z: number, light: Vector3): void {
        (this.surfaceUniforms.splashCenter.value as Vector2).set(x, z);
        this.placeSplashMesh(x, z);
        (this.surfaceUniforms.splashLightPosition.value as Vector3).copy(light);
        this.splashStart = this.lastElapsed;
    }

    /** light from the impact on the water around it (point lights don't reach the water shader) */
    /**
     * @param flash how bright the flash is right now, 0 to 1: the rest of the water darkens by as much, relatively
     */
    /** whether the water shows the meteor flash's shadows (off while there's no flash: a uniform, not a recompile) */
    public set receivesShadows(receive: boolean) {
        this.water.receiveShadow = receive;
        if (this.patch) this.patch.receiveShadow = receive;
        if (this.splashMesh) this.splashMesh.receiveShadow = receive;
    }

    /** the uniforms for the cursor pressing on the water, which environment/water-touch.ts keeps up to date */
    public get touchUniforms() {
        const u = this.surfaceUniforms;
        return {
            points: u.touchPoints.value as Vector3[],
            radius: u.touchRadius,
            depth: u.touchDepth,
            lip: u.touchLip,
            ringCenter: u.touchRingCenter.value as Vector2,
            ringAge: u.touchRingAge,
            ringHeight: u.touchRingHeight,
        };
    }

    public setSplashGlow(color: Color, intensity: number, flash: number): void {
        (this.surfaceUniforms.splashGlow.value as Color).copy(color).multiplyScalar(intensity);
        this.surfaceUniforms.splashDarken.value = this.splashDarkenScale * flash;
        this.surfaceUniforms.splashShadowReflection.value = this.splashShadowReflectionScale * Math.min(flash * 3, 1);
    }

    private splashDarkenScale = 0;
    private splashShadowReflectionScale = 0;

    /**
     * Adds a shader edit to the water surface (plane and displaced patch), applied after the water's own edits
     */
    public extendShader(edit: (params: WebGLProgramParametersWithUniforms) => void): void {
        for (const material of [this.water.material, this.patch?.material]) {
            if (!material) continue;
            const previous = material.onBeforeCompile;
            material.onBeforeCompile = (params, renderer) => {
                previous.call(material, params, renderer);
                edit(params);
            };
            material.needsUpdate = true;
        }
    }

    /** the water's surface uniforms, for the day/night cycle */
    public get surface() {
        return this.surfaceUniforms;
    }

    /** the flat grey in every reflection, set by the day/night cycle */
    public setReflectionFloor(floor: number): void {
        this.surfaceUniforms.reflectionFloor.value = floor;
    }

    private rimNightScale = 1;

    /** the day/night cycle dims the rim of light where the water climbs the pillars */
    public setRimNight(scale: number): void {
        this.rimNightScale = scale;
        this.surfaceUniforms.rimStrength.value = this.look.rimStrength * scale;
    }

    public applyLook(): void {
        const l = this.look;
        const u = this.surfaceUniforms;
        u.displacementScale.value = l.displacementScale;
        u.splashRippleHeight.value = l.splashRippleHeight;
        u.splashRippleSpeed.value = l.splashRippleSpeed;
        u.splashWavelength.value = Math.max(l.splashWavelength, 1e-3);
        u.splashRippleSeconds.value = Math.max(l.splashRippleSeconds, 1e-3);
        u.splashGlowRadius.value = Math.max(l.splashGlowRadius, 1e-3);
        u.splashWaterReach.value = l.splashWaterReach;
        u.splashHighlight.value = l.splashHighlight;
        u.splashShininess.value = Math.max(l.splashShininess, 1);
        u.splashRelief.value = l.splashRelief;
        this.splashDarkenScale = l.splashWaterDarken;
        this.splashShadowReflectionScale = l.splashShadowOnReflection;
        u.splashCraterDepth.value = l.splashCraterDepth;
        u.splashCraterRadius.value = Math.max(l.splashCraterRadius, 1e-3);
        u.splashCraterSeconds.value = Math.max(l.splashCraterSeconds, 1e-3);
        u.splashSwellHeight.value = l.splashSwellHeight;
        u.splashSwellSpeed.value = l.splashSwellSpeed;
        u.splashSwellWidth.value = Math.max(l.splashSwellWidth, 1e-3);
        u.splashSwellFade.value = Math.max(l.splashSwellFade, 1e-3);
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
        u.meniscusLag.value = l.meniscusLag;
        u.cushionStrength.value = l.cushionStrength;
        u.cushionWidth.value = Math.max(l.cushionWidth, 1e-4);
        u.wakeStretch.value = l.wakeStretch;
        u.rippleDampRadius.value = l.rippleDampRadius;
        // where the meniscus, the cushion (and its stretched wake) and the ripple damping have all faded out
        u.interactionReach.value = Math.max(l.meniscusWidth * 5, l.cushionWidth * Math.max(l.wakeStretch, 1) * 4, l.rippleDampRadius);
        u.rimColor.value.set(l.rimColor);
        u.rimStrength.value = l.rimStrength * this.rimNightScale;
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
        this.underwaterUniforms.underwaterViewDensity.value = l.underwaterViewDensity;
        // the fluid absorbs each colour the faster, the less of it there is in its deep colour, so the light that's left
        // tends towards that colour as it goes down (Earth's water has blue there; this fluid needn't)
        const deep = new Color(l.depthColor);
        const strongest = Math.max(deep.r, deep.g, deep.b, 1e-3);
        const rate = (c: number) => l.depthDarkening * (1 - Math.log(Math.max(c / strongest, 0.02)));
        (this.underwaterUniforms.depthAbsorption.value as Vector3).set(rate(deep.r), rate(deep.g), rate(deep.b));
        this.underwaterUniforms.surfaceWaveHeight.value = l.surfaceWaveHeight;
        const under = this.underside.material.uniforms;
        under.undersideClarity.value = l.undersideClarity;
        under.undersideMirror.value = l.undersideMirror;
        under.undersideRipple.value = l.undersideRipple;
        under.undersideRefraction.value = l.undersideRefraction;
        this.underwaterUniforms.underwaterDensity.value = l.underwaterDensity;
        this.seabed.position.y = WATER_LEVEL_Y - l.seabedDepth;
    }

    public bindTweaks(folder: GUI): void {
        const apply = () => this.applyLook();
        folder.add(this.look, 'surfaceOpacity', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'fresnelPower', 0.5, 10, 0.1).onChange(apply);
        folder.addColor(this.look, 'underwaterColor').onChange(apply);
        folder.add(this.look, 'underwaterDensity', 0, 10, 0.05).onChange(apply);
        folder.add(this.look, 'underwaterViewDensity', 0, 2, 0.01).onChange(apply);
        folder.add(this.look, 'depthDarkening', 0, 1, 0.01).onChange(apply);
        folder.addColor(this.look, 'depthColor').onChange(apply);
        folder.add(this.look, 'surfaceWaveHeight', 0, 0.4, 0.005).onChange(apply);
        folder.add(this.look, 'surfaceWaveSpeed', 0, 5, 0.05);
        folder.add(this.look, 'undersideClarity', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'undersideMirror', 0, 3, 0.05).onChange(apply);
        folder.add(this.look, 'undersideRipple', 0, 4, 0.05).onChange(apply);
        folder.add(this.look, 'undersideRefraction', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'seabedDepth', 0.1, 5, 0.05).onChange(apply).onFinishChange(() => this.onSeabedChange?.(this.look.seabedDepth));
        folder.add(this.look, 'viscosity', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'flowAngleDeg', 0, 360, 1).onChange(apply);
        folder.add(this.look, 'flowSpeed', 0, 0.5, 0.005).onChange(apply);
        folder.add(this.look, 'meniscusHeight', 0, 0.03, 0.0005).onChange(apply);
        folder.add(this.look, 'meniscusWidth', 0.005, 0.2, 0.005).onChange(apply);
        folder.add(this.look, 'meniscusLag', 0, 40, 0.5).onChange(apply);
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
        folder.add(this.look, 'splashRippleHeight', 0, 0.1, 0.001).onChange(apply);
        folder.add(this.look, 'splashRippleSpeed', 0.1, 5, 0.05).onChange(apply);
        folder.add(this.look, 'splashWavelength', 0.02, 1, 0.01).onChange(apply);
        folder.add(this.look, 'splashRippleSeconds', 0.5, 15, 0.1).onChange(apply);
        folder.add(this.look, 'splashCraterDepth', 0, 1.5, 0.01).onChange(apply);
        folder.add(this.look, 'splashCraterRadius', 0.05, 4, 0.05).onChange(apply);
        folder.add(this.look, 'splashCraterSeconds', 0.1, 5, 0.05).onChange(apply);
        folder.add(this.look, 'splashSwellHeight', 0, 2, 0.01).onChange(apply);
        folder.add(this.look, 'splashSwellSpeed', 0.1, 6, 0.05).onChange(apply);
        folder.add(this.look, 'splashSwellWidth', 0.05, 3, 0.05).onChange(apply);
        folder.add(this.look, 'splashSwellFade', 0.5, 60, 0.25).onChange(apply);
        folder.add(this.look, 'splashMeshSpacing', 0.03, 0.5, 0.01).name('splashMeshSpacing (next splash)');
        folder.add(this.look, 'splashGlowRadius', 0.1, 6, 0.05).onChange(apply);
        folder.add(this.look, 'splashWaterReach', 0, 3, 0.01).onChange(apply);
        folder.add(this.look, 'splashHighlight', 0, 20, 0.1).onChange(apply);
        folder.add(this.look, 'splashShininess', 1, 500, 1).onChange(apply);
        folder.add(this.look, 'splashRelief', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'splashWaterDarken', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'splashShadowOnReflection', 0, 1, 0.01).onChange(apply);
        folder.add(this.look, 'wetBandHeight', 0, 0.3, 0.005).onChange(apply);
        folder.add(this.look, 'wetBandDarkness', 0, 1, 0.01).onChange(apply);
    }

    /**
     * Deals with higher than 60 FPS refresh rates... hopefully
     */
    private lastElapsed = 0;
    private lastWaterElapsed = 0;

    public update(clock: Clock): void {
        this.followCamera();
        this.lastElapsed = clock.elapsedTime;
        this.surfaceUniforms.splashAge.value = clock.elapsedTime - this.splashStart;
        if (this.splashMeshShown && clock.elapsedTime - this.splashStart > this.splashSeconds) this.hideSplashMesh();
        if (this.cameraUnderwater !== this.viewingUnderwater) {
            this.viewingUnderwater = this.cameraUnderwater;
            this.setUnderwaterView(this.viewingUnderwater);
        }
        // advanced by the time that really passed (capped against long stalls), at the speeds tuned at a steady 60 fps.
        // It used to step a fixed 1/60 s at most once per frame, which ran slow whenever frames came in late, and then
        // the floating particles (on real time) drifted faster than the ripples carrying them
        const dt = Math.min(Math.max(clock.elapsedTime - this.lastWaterElapsed, 0), 0.1);
        this.lastWaterElapsed = clock.elapsedTime;
        this.water.material.uniforms['time'].value += UPDATE_BY * this.timeScale * dt * 1000 / UPDATE_WATER_EVERY_MS;
        this.underwaterUniforms.causticTime.value += this.look.causticSpeed * this.timeScale * dt;
        this.underwaterUniforms.surfaceWaveTime.value += this.look.surfaceWaveSpeed * this.timeScale * dt;
        if (this.viewingUnderwater) {
            // snapped to its vertex spacing so the displaced surface doesn't swim as the camera moves
            const step = UNDERSIDE_SIZE / UNDERSIDE_SEGMENTS;
            this.underside.position.x = Math.round(this.camera.position.x / step) * step;
            this.underside.position.z = Math.round(this.camera.position.z / step) * step;
        }
        const flow = this.surfaceUniforms.flowDir.value as Vector2;
        (this.surfaceUniforms.flowOffset.value as Vector2).addScaledVector(flow, this.look.flowSpeed * this.timeScale * dt);

        const uniforms = this.fogShader.getUniforms();
        if (uniforms && clock.oldTime - this.lastFogUpdate >= FOG_UPDATE_EVERY_MS) {
            uniforms['fogTime'].value += FOG_UPDATE_BY * this.fogSpeed;
            this.lastFogUpdate = clock.oldTime;
        }
    }
}

export class WaterFactory {
    constructor(private loadingMgr: LoadingManager, private scene: Scene) {}

    public makeWater(normalsPath: string, offsetZ: number, look: WaterLook, camera: Camera): Water {
        const geometry = new PlaneGeometry(SURFACE_SIZE, SURFACE_SIZE, SURFACE_SEGMENTS, SURFACE_SEGMENTS);

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
            reflectionFloor: { value: 0.1 },
            reflectionStrength: { value: 1 },
            reflectionGrey: { value: 1 },
            splashCenter: { value: new Vector2() },
            // seconds since the last splash, large while there's none
            splashAge: { value: 1e3 },
            splashRippleHeight: { value: 0 },
            splashRippleSpeed: { value: 1 },
            splashWavelength: { value: 1 },
            splashRippleSeconds: { value: 1 },
            splashGlow: { value: new Color(0, 0, 0) },
            splashGlowRadius: { value: 1 },
            // the cursor pressing on the water (environment/water-touch.ts)
            touchPoints: { value: Array.from({ length: TOUCH_POINTS }, () => new Vector3()) },
            touchRadius: { value: 1 },
            touchDepth: { value: 0 },
            touchLip: { value: 0 },
            touchRingCenter: { value: new Vector2() },
            touchRingAge: { value: 1e3 },
            touchRingHeight: { value: 0 },
            splashWaterReach: { value: 0 },
            splashLightPosition: { value: new Vector3() },
            splashHighlight: { value: 0 },
            splashShininess: { value: 1 },
            splashRelief: { value: 0 },
            volcanoLightDir: { value: new Vector3(0, 1, 0) },
            volcanoLightColor: { value: new Color(0, 0, 0) },
            // how much darker the water is right now, next to a meteor's flash
            splashDarken: { value: 0 },
            // how much the flash's shadows darken the water's reflections right now
            splashShadowReflection: { value: 0 },
            splashCraterDepth: { value: 0 },
            splashCraterRadius: { value: 1 },
            splashCraterSeconds: { value: 1 },
            splashSwellHeight: { value: 0 },
            splashSwellSpeed: { value: 1 },
            splashSwellWidth: { value: 1 },
            splashSwellFade: { value: 1 },
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
            meniscusLag: { value: 0 },
            cushionStrength: { value: 0 },
            cushionWidth: { value: 1 },
            wakeStretch: { value: 1 },
            rippleDampRadius: { value: 0 },
            rimColor: { value: new Color() },
            rimStrength: { value: 0 },
            interactionDistance: { value: 0 },
            patchCentre: { value: new Vector2() },
            splashAreaCentre: { value: new Vector2() },
            splashAreaHalf: { value: new Vector2() },
            patchHalfSize: { value: 0 },
            displacementScale: { value: 1 },
            interactionReach: { value: 0 },
        };
        const underwaterUniforms: { [name: string]: IUniform } = {
            waterLevelY: { value: WATER_LEVEL_Y },
            viewUnderwater: { value: 0 },
            // the surface's rolling waves from below (shaders/underwater.glsl.ts)
            surfaceWaveHeight: { value: 0 },
            surfaceWaveTime: { value: 0 },
            surfaceWaveFlow: surfaceUniforms.flowOffset,
            underwaterViewDensity: { value: 0.4 },
            depthAbsorption: { value: new Vector3() },
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


        water.receiveShadow = true;

        const waterUniforms = water.material.uniforms;
        waterUniforms['size'].value = 10;

        this.scene.add(water);

        // the floor seen through the water between the pillars, fully shaded by the underwater absorption
        const seabed = new Mesh(geometry.clone(), new MeshStandardMaterial({ color: 0x1a1a1a, roughness: 1 }));
        seabed.rotation.copy(water.rotation);
        seabed.position.set(water.position.x, WATER_LEVEL_Y, water.position.z);
        this.scene.add(seabed);

        // the surface seen from below, while the camera is under it
        // a finely divided square that follows the camera (the murk hides anything further), so its waves can move it
        const undersideGeometry = new PlaneGeometry(UNDERSIDE_SIZE, UNDERSIDE_SIZE, UNDERSIDE_SEGMENTS, UNDERSIDE_SEGMENTS);
        const underside = new Mesh(undersideGeometry, new ShaderMaterial({
            vertexShader: undersideVertex,
            fragmentShader: undersideFragment,
            uniforms: {
                normalSampler: waterUniforms['normalSampler'],
                time: waterUniforms['time'],
                size: waterUniforms['size'],
                flowOffset: surfaceUniforms.flowOffset,
                rippleScale: surfaceUniforms.rippleScale,
                rippleAmp: surfaceUniforms.rippleAmp,
                underwaterColor: underwaterUniforms.underwaterColor,
                underwaterViewDensity: underwaterUniforms.underwaterViewDensity,
                depthAbsorption: underwaterUniforms.depthAbsorption,
                undersideClarity: { value: 1 },
                undersideMirror: { value: 0 },
                undersideRipple: { value: 1 },
                undersideRefraction: { value: 0.35 },
                // the world above, captured from under the water (environment/snell-window.ts)
                undersideAbove: { value: null },
                surfaceWaveHeight: underwaterUniforms.surfaceWaveHeight,
                surfaceWaveTime: underwaterUniforms.surfaceWaveTime,
                surfaceWaveFlow: underwaterUniforms.surfaceWaveFlow,
                // the sunlight coming in, for its glitter on the surface
                ...shaftUniforms,
            },
            transparent: true,
            // writes depth, and is drawn before the other see-through things: what's above the surface (the particles
            // in the air, the splash's spray) is then hidden behind it, while what's below it still shows in front
            depthWrite: true,
            side: DoubleSide,
        }));
        underside.renderOrder = -1;
        underside.rotation.copy(water.rotation);
        underside.position.y = WATER_LEVEL_Y;
        underside.frustumCulled = false;
        underside.visible = false;
        this.scene.add(underside);

        const result = new Water(camera, water, fogShader, seabed, look, surfaceUniforms, underwaterUniforms, underside);
        result.addUnderwaterTo(seabed.material);
        result.applyLook();
        return result;
    }
}