import { Box2, BufferGeometry, Camera, Clock, CylinderGeometry, Line3, LoadingManager, Mesh, MeshPhysicalMaterial, Object3DEventMap, RepeatWrapping, Scene, SRGBColorSpace, Vector3 } from 'three';
import { degToRad, lerp } from 'three/src/math/MathUtils.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { CAMERA_HOME_POS, FOG_UPDATE_BY, FOG_UPDATE_EVERY_MS, PillarLayout, PILLARS_FOG_FAR_COLOR, PILLARS_FOG_NEAR_COLOR, PILLARS_FOG_NOISE_FREQ, PILLARS_FOG_NOISE_IMPACT, PILLARS_FOG_NOISE_SPEED, PILLARS_GEOGRAPHY_MAP, SCALE_FACTOR } from '../constants';
import { ImageLoader } from '../utils/image-utils';
import { TextureLoader, PLACEHOLDER } from '../utils/texture-utils';
import { customFogExtension, ShaderExtension } from './animated-fog';
import { fogFrag, fogParsFrag, fogParsVert, fogVert } from "../shaders/fogedits.glsl";
import { AnimatedEntity } from '../entity/animated-entity';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm2D, makeRng } from '../utils/random';


const WATER = -1.0;
const LAND = 0.0;
const RADIUS = 0.1;
const CYLINDER_RADIAL_SEGMENTS_HEXAGON = 6;
// per-band height roll, same odds as the old randInt(0, 20)
const HEIGHT_ROLL_SIDES = 21;


const randomSeed = () => Math.floor(Math.random() * 10000);

// u1 picks the height class, u2 picks the height within it
const getHeightDistanceOne = (u1: number, u2: number) => {
    if (Math.floor(u1 * HEIGHT_ROLL_SIDES) < 20) {
        return lerp(0.1, 0.5, u2);
    }
    return lerp(1, 1.5, u2);
};


const getHeightDistanceTwo = (u1: number, u2: number) => {
    const r = Math.floor(u1 * HEIGHT_ROLL_SIDES);
    if (r <= 1) {
        return lerp(0.5, 0.75, u2);
    }

    if (r < 20) {
        return lerp(0.75, 1.0, u2);
    }

    return lerp(1.5, 3, u2);
};


const getHeightDistanceThree = (u1: number, u2: number) => {
    const r = Math.floor(u1 * HEIGHT_ROLL_SIDES);
    if (r <= 4) {
        return lerp(0.75, 1.0, u2);
    }

    return lerp(1.5, 3, u2);
}


const getHeightDistanceX = (_u1: number, u2: number) => {
    return lerp(3, 8, u2);
}


const getHeightForDistance = (distance: number, u1: number, u2: number): number => {
    if (distance <= 1) {
        return getHeightDistanceOne(u1, u2);
    }
    if (distance <= 2) {
        return getHeightDistanceTwo(u1, u2);
    }
    if (distance <= 3) {
        return getHeightDistanceThree(u1, u2);
    }
    return getHeightDistanceX(u1, u2);
};

/**
 * Water cells that touch land. Distances to the water only need to be measured against these.
 */
const getShoreCells = (mask: number[][]): [number, number][] => {
    const res: [number, number][] = [];
    for (let i = 0; i < mask.length; ++i) {
        for (let j = 0; j < mask[0].length; ++j) {
            if (mask[i][j] !== WATER) continue;
            const touchesLand =
                (i > 0 && mask[i - 1][j] !== WATER) ||
                (i < mask.length - 1 && mask[i + 1][j] !== WATER) ||
                (j > 0 && mask[i][j - 1] !== WATER) ||
                (j < mask[0].length - 1 && mask[i][j + 1] !== WATER);
            if (touchesLand) res.push([i, j]);
        }
    }
    return res;
};

/**
 * Euclidean distance (in cells) to the nearest water cell, offset so that land directly next to the water is 0
 * (matches the old BFS step distance)
 */
const distanceToWater = (x: number, z: number, shore: [number, number][]): number => {
    let best = Infinity;
    for (const [i, j] of shore) {
        const dx = x - i;
        const dz = z - j;
        best = Math.min(best, dx * dx + dz * dz);
    }
    return Math.sqrt(best) - 1;
};


/**
 * A screen area (normalised device coordinates) as seen from a camera, used to keep the wall solid behind the title
 */
export interface ScreenZone {
    camera: Camera;
    ndc: Box2;
}

// pillars at least this far from the water (in cells) count as back rows
const BACK_ROW_DISTANCE = 3;

const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/**
 * Closest distance between a point and a pillar's centre line
 */
const distanceToPillar = (point: Vector3, centre: Vector3, axis: Vector3, height: number): number => {
    const half = axis.clone().multiplyScalar(height / 2);
    const segment = new Line3(centre.clone().sub(half), centre.clone().add(half));
    return segment.closestPointToPoint(point, true, new Vector3()).distanceTo(point);
};


export class Walls implements AnimatedEntity {
    private lastFogUpdate: number = 0;

    constructor(
        private readonly mask: number[][],
        private readonly extraOffsetZ: number,
        private layout: PillarLayout,
        private titleZone: ScreenZone | undefined,
        private walls: Mesh<BufferGeometry, MeshPhysicalMaterial, Object3DEventMap>,
        private fog: ShaderExtension) {}

    public update(clock: Clock): void {
        const uniforms = this.fog.getUniforms();
        if (!uniforms) return;

        if (clock.oldTime - this.lastFogUpdate >= FOG_UPDATE_EVERY_MS) {
            uniforms['fogTime'].value += FOG_UPDATE_BY;
            this.lastFogUpdate = clock.oldTime;
        }
    }

    public rebuild(): void {
        const old = this.walls.geometry;
        this.walls.geometry = buildPillarsGeometry(this.mask, this.layout, this.extraOffsetZ, this.titleZone);
        old.dispose();
    }

    public setTitleZone(zone: ScreenZone | undefined): void {
        this.titleZone = zone;
        this.rebuild();
    }

    public bindTweaks(folder: GUI): void {
        const rebuild = () => this.rebuild();
        const l = this.layout;

        folder.add(l, 'randomSeed').name('random seed per load');
        const seed = folder.add(l, 'seed', 0, 9999, 1).onFinishChange(rebuild);
        // setValue only fires onChange, so rebuild explicitly
        folder.add({ reroll: () => { seed.setValue(randomSeed()); rebuild(); } }, 'reroll').name('Reroll seed');
        folder.add(l, 'jitter', 0, 0.5, 0.01).onFinishChange(rebuild);
        folder.add(l, 'skipChance', 0, 0.5, 0.01).onFinishChange(rebuild);
        folder.add(l, 'distanceNoise', 0, 4, 0.05).onFinishChange(rebuild);
        folder.add(l, 'noiseScale', 0.01, 0.5, 0.01).onFinishChange(rebuild);
        folder.add(l, 'clumpiness', 0, 1, 0.01).onFinishChange(rebuild);
        folder.add(l, 'baseYVariance', 0, 0.5, 0.01).onFinishChange(rebuild);
        folder.add(l, 'radiusMin', 0.03, 0.2, 0.005).onFinishChange(rebuild);
        folder.add(l, 'radiusMax', 0.03, 0.2, 0.005).onFinishChange(rebuild);
        folder.add(l, 'leanDeg', 0, 60, 0.5).onFinishChange(rebuild);
        folder.add(l, 'leanVarianceDeg', 0, 30, 0.5).onFinishChange(rebuild);
        folder.add(l, 'yawVarianceDeg', 0, 45, 0.5).onFinishChange(rebuild);
        folder.add(l, 'rollVarianceDeg', 0, 10, 0.1).onFinishChange(rebuild);
        folder.add(l, 'selfRotateDeg', 0, 60, 0.5).onFinishChange(rebuild);
        folder.add(l, 'cameraClearRadius', 0, 5, 0.05).onFinishChange(rebuild);
        folder.add(l, 'cameraClearMaxHeight', 0.1, 3, 0.05).onFinishChange(rebuild);
        folder.add(l, 'titleFillMaxHeight', 0, 24, 0.25).onFinishChange(rebuild);
        folder.add(l, 'titleFillMargin', 0, 0.5, 0.01).onFinishChange(rebuild);
        folder.add(l, 'titleFillExtra', 0, 1, 0.01).onFinishChange(rebuild);
        folder.add(l, 'titleFillRadiusScale', 1, 2.5, 0.05).onFinishChange(rebuild);
    }
}


// how finely pillar growth is sampled when checking what ends up behind the title
const FILL_STEP = 0.25;

/**
 * Grows a pillar from its own height and follows its top on screen. If the top passes behind the title, returns the height
 * at which it clears the top of the text; otherwise the pillar never covers the text and null is returned.
 */
const heightToCoverTitle = (centre: Vector3, axis: Vector3, height: number, zone: ScreenZone, layout: PillarLayout): number | null => {
    const m = layout.titleFillMargin;
    const minX = zone.ndc.min.x - m, maxX = zone.ndc.max.x + m;
    const minY = zone.ndc.min.y - m, maxY = zone.ndc.max.y + m;

    let crossesTitle = false;
    for (let h = height; h <= layout.titleFillMaxHeight; h += FILL_STEP) {
        const top = centre.clone().addScaledVector(axis, h / 2).project(zone.camera);
        if (top.z >= 1) return null; // behind the camera
        if (top.x >= minX && top.x <= maxX && top.y >= minY && top.y <= maxY) crossesTitle = true;
        if (top.y > maxY) return crossesTitle ? h : null;
    }
    return crossesTitle ? layout.titleFillMaxHeight : null;
};

const buildPillarsGeometry = (mask: number[][], layout: PillarLayout, extraOffsetZ: number, titleZone?: ScreenZone): BufferGeometry => {
    const geometry = new CylinderGeometry(RADIUS, RADIUS, 1, CYLINDER_RADIAL_SEGMENTS_HEXAGON);
    const rng = makeRng(layout.seed);
    const shore = getShoreCells(mask);

    const plannedWidth = mask.length*SCALE_FACTOR;
    const plannedDepth = mask[0].length*SCALE_FACTOR;

    const offsetX = -plannedWidth/2;
    const offsetZ = extraOffsetZ - plannedDepth;

    const f = layout.noiseScale;
    const geometries: CylinderGeometry[] = [];

    for (let i = 0; i < mask.length; ++i) {
        for (let j = 0; j < mask[0].length; ++j) {
            if (mask[i][j] === WATER) continue;

            // always draw the same amount of numbers per cell so changing one setting doesn't reshuffle the rest
            const [jx, jz, skip, h1, h2, rad, lean, yaw, roll, self, baseY, fillExtraRoll] = Array.from({ length: 12 }, rng);

            const x = i + (jx * 2 - 1) * layout.jitter;
            const z = j + (jz * 2 - 1) * layout.jitter;

            const distance = distanceToWater(x, z, shore) + fbm2D(x * f, z * f, layout.seed) * layout.distanceNoise;
            let height = getHeightForDistance(distance, h1, h2);

            // blend per-pillar randomness with a shared noise field so neighbours lean/turn together
            const leanT = lerp(lean, fbm2D(x * f, z * f, layout.seed + 1) * 0.5 + 0.5, layout.clumpiness);
            const yawT = lerp(yaw * 2 - 1, fbm2D(x * f, z * f, layout.seed + 2), layout.clumpiness);
            let radiusScale = lerp(layout.radiusMin, layout.radiusMax, rad) / RADIUS;
            const leanRad = degToRad(layout.leanDeg + leanT * layout.leanVarianceDeg);
            const rollRad = degToRad((roll * 2 - 1) * layout.rollVarianceDeg);

            const centre = new Vector3(
                (x*SCALE_FACTOR) + offsetX,
                -1 + (baseY * 2 - 1) * layout.baseYVariance,
                (z*SCALE_FACTOR) + offsetZ
            );

            const axis = new Vector3(0, 1, 0).applyAxisAngle(X_AXIS, leanRad).applyAxisAngle(Z_AXIS, rollRad);

            // back rows that pass behind the title are raised just past the top of the text (and thickened) so there's no sky
            // behind it. Everything else keeps its height, so the wall keeps the same variety as elsewhere
            const cover = titleZone && distance > BACK_ROW_DISTANCE ? heightToCoverTitle(centre, axis, height, titleZone, layout) : null;
            if (cover !== null) {
                height = Math.min(cover * (1 + fillExtraRoll * layout.titleFillExtra), layout.titleFillMaxHeight);
                radiusScale *= layout.titleFillRadiusScale;
            } else if (skip < layout.skipChance) {
                continue;
            }

            // keep big pillars out of the landing view, the stubs can stay
            if (height > layout.cameraClearMaxHeight && distanceToPillar(CAMERA_HOME_POS, centre, axis, height) < layout.cameraClearRadius) {
                height = layout.cameraClearMaxHeight;
            }

            const instanceGeo = geometry.clone();

            instanceGeo.rotateY(degToRad(self * layout.selfRotateDeg));

            instanceGeo.scale(radiusScale, height, radiusScale);

            instanceGeo.rotateY(degToRad(yawT * layout.yawVarianceDeg));
            instanceGeo.rotateX(leanRad);
            instanceGeo.rotateZ(rollRad);

            instanceGeo.translate(centre.x, centre.y, centre.z);

            geometries.push(instanceGeo);
        }
    }

    const merged = mergeGeometries(geometries);
    geometry.dispose();
    for (const g of geometries) g.dispose();
    return merged;
};

export class WallsFactory {
    constructor(private loadingMgr: LoadingManager, private scene: Scene) {}

    public async makeWalls(extraOffsetZ: number, layout: PillarLayout, titleZone?: ScreenZone): Promise<Walls> {
        if (layout.randomSeed) {
            layout.seed = randomSeed();
        }

        const materialTextures = new TextureLoader(this.loadingMgr).getPBRMaterialTextures(
            `storm_marble_2-1K/1K_storm___honed___marble_2_${PLACEHOLDER}.png`,
            {
                wrapS: RepeatWrapping,
                wrapT: RepeatWrapping,
                colorSpace: SRGBColorSpace
            }
        );

        const material: MeshPhysicalMaterial = new MeshPhysicalMaterial({
            ...materialTextures,
            //clearcoat: 0.07,
            displacementScale: 0.001,
            iridescence: 0.2,
            specularIntensity: 1.0,
            metalness: 0.3,
            flatShading: true // force appearance to not get rounded to get proper hexagons
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

        material.onBeforeCompile = fogShader.handle;

        const mask = await this.parseMapTemplate(PILLARS_GEOGRAPHY_MAP);

        const mesh = new Mesh(buildPillarsGeometry(mask, layout, extraOffsetZ, titleZone), material);
        this.scene.add(mesh);

        return new Walls(
            mask,
            extraOffsetZ,
            layout,
            titleZone,
            mesh,
            fogShader
        );
    }

    /**
     * Converts png image to a water (transparent pixels) / land mask
     */
    private async parseMapTemplate(path: string): Promise<number[][]> {
        const image = await new ImageLoader(this.loadingMgr).loadImage(path);

        const canvas: HTMLCanvasElement = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx === null) throw new Error("Failed to create 2D context!");

        canvas.width = image.width;
        canvas.height = image.height;

        ctx.drawImage(image, 0, 0);

        const imageData: ImageData = ctx.getImageData(0, 0, image.width, image.height);

        const grid: number[][] = new Array(image.width);
        for (let i = 0; i < image.width; ++i) {
            grid[i] = new Array(image.height).fill(LAND);
            for (let j = 0; j < image.height; ++j) {

                const index = ImageLoader.pixelPosOffsetPNG(image.width, j, i);
                const a = imageData.data[index + 3];

                grid[i][j] = a === 0 ? WATER : LAND;
            }
        }

        return grid;
    }
}
