import { Box2, BufferGeometry, Camera, Clock, DataTexture, FloatType, IUniform, Line3, NearestFilter, RGBAFormat, Vector2, LoadingManager, Mesh, MeshPhysicalMaterial, Object3DEventMap, RepeatWrapping, Scene, SRGBColorSpace, Vector3 } from 'three';
import { degToRad, lerp, smoothstep } from 'three/src/math/MathUtils.js';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { CAMERA_HOME_POS, FOG_UPDATE_BY, FOG_UPDATE_EVERY_MS, PillarLayout, PillarShape, PILLARS_FOG_FAR_COLOR, PILLARS_FOG_NEAR_COLOR, PILLARS_FOG_NOISE_FREQ, PILLARS_FOG_NOISE_IMPACT, PILLARS_FOG_NOISE_SPEED, PILLARS_GEOGRAPHY_MAP, SCALE_FACTOR } from '../constants';
import { ImageLoader } from '../utils/image-utils';
import { TextureLoader, PLACEHOLDER } from '../utils/texture-utils';
import { customFogExtension, ShaderExtension } from './animated-fog';
import { fogFrag, fogParsFrag, fogParsVert, fogVert } from "../shaders/fogedits.glsl";
import { AnimatedEntity } from '../entity/animated-entity';
import { fbm2D, makeRng } from '../utils/random';
import { buildPillarMesh, PillarInstance } from './pillar-geometry';
import { applyPillarSurface } from '../shaders/pillar-surface.glsl';
import { WATER_LEVEL_Y } from './water';
import { skipChangedHighlight } from '../ui/tweaks';


const WATER = -1.0;
const LAND = 0.0;
const RADIUS = 0.1;
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

/**
 * Where each pillar crosses the water surface, one texel per pillar grid cell, for the water shader's pillar interaction.
 * A = (centre x, centre z, radius, 1 if there's a pillar crossing the surface here),
 * B = (lean direction x, z, stretch, closest any point in this cell gets to a pillar in the 5x5 cells around it):
 * a leaning pillar's cross-section is stretched along its lean by 1 / cos(tilt). The last one lets the water shader skip
 * open water without looking at any pillars.
 */
export interface PillarField {
    dataA: DataTexture;
    dataB: DataTexture;
    /** world position of cell (0, 0) */
    origin: Vector2;
    cellSize: number;
    /** cells in x and z */
    size: Vector2;
}

const makeFieldTexture = (width: number, height: number) => {
    const texture = new DataTexture(new Float32Array(width * height * 4), width, height, RGBAFormat, FloatType);
    texture.minFilter = texture.magFilter = NearestFilter;
    texture.needsUpdate = true;
    return texture;
};

const recordWaterline = (field: PillarField, i: number, j: number, pillar: PillarInstance, axis: Vector3) => {
    // where the axis meets the surface, if that's within the pillar
    const t = (WATER_LEVEL_Y - pillar.centre.y) / axis.y;
    if (Math.abs(t) > pillar.height / 2) return;

    const x = pillar.centre.x + axis.x * t;
    const z = pillar.centre.z + axis.z * t;
    const horizontal = Math.hypot(axis.x, axis.z);
    const k = (j * field.size.x + i) * 4;
    const a = field.dataA.image.data as Float32Array;
    const b = field.dataB.image.data as Float32Array;
    a.set([x, z, pillar.radius, 1], k);
    b.set(horizontal > 1e-4 ? [axis.x / horizontal, axis.z / horizontal] : [1, 0], k);
    b[k + 2] = 1 / axis.y;
};

// the water shader looks this many cells around a point for pillars
const FIELD_SEARCH = 2;
const NO_PILLAR_NEARBY = 1e3;

/**
 * Per cell, a lower bound on how close any point in it gets to the edge of a pillar the shader would look at
 */
const computeClearance = (field: PillarField) => {
    const a = field.dataA.image.data as Float32Array;
    const b = field.dataB.image.data as Float32Array;
    const cols = field.size.x, rows = field.size.y;
    const halfDiagonal = field.cellSize * Math.SQRT1_2;

    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const cx = field.origin.x + i * field.cellSize;
            const cz = field.origin.y + j * field.cellSize;
            let best = NO_PILLAR_NEARBY;
            for (let dj = -FIELD_SEARCH; dj <= FIELD_SEARCH; dj++) {
                for (let di = -FIELD_SEARCH; di <= FIELD_SEARCH; di++) {
                    const ni = i + di, nj = j + dj;
                    if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
                    const k = (nj * cols + ni) * 4;
                    if (a[k + 3] < 0.5) continue;
                    // the stretched cross-section is at most radius * stretch from its centre
                    const reach = a[k + 2] * b[k + 2];
                    best = Math.min(best, Math.hypot(a[k] - cx, a[k + 1] - cz) - reach - halfDiagonal);
                }
            }
            b[(j * cols + i) * 4 + 3] = Math.max(best, 0);
        }
    }
};

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
    /** how fast the fog drifts, 1 = normal (the day/night cycle slows it at night) */
    private fogSpeed = 1;

    public setFogSpeed(speed: number): void {
        this.fogSpeed = speed;
    }

    constructor(
        private readonly mask: number[][],
        private readonly extraOffsetZ: number,
        private layout: PillarLayout,
        private shape: PillarShape,
        private titleZone: ScreenZone | undefined,
        private walls: Mesh<BufferGeometry, MeshPhysicalMaterial, Object3DEventMap>,
        private fog: ShaderExtension,
        private surfaceUniforms: { [name: string]: IUniform<number> }) {
        this.pillarField = createPillarField(mask, extraOffsetZ);
        this.rebuild();
    }

    /** fogNearColor, fogFarColor, ... of the pillars' coloured fog */
    public get fogUniforms() {
        return this.fog.extensionUniforms;
    }

    public get material(): MeshPhysicalMaterial {
        return this.walls.material;
    }

    public update(clock: Clock): void {
        const uniforms = this.fog.getUniforms();
        if (!uniforms) return;

        if (clock.oldTime - this.lastFogUpdate >= FOG_UPDATE_EVERY_MS) {
            uniforms['fogTime'].value += FOG_UPDATE_BY * this.fogSpeed;
            this.lastFogUpdate = clock.oldTime;
        }
    }

    public readonly pillarField: PillarField;

    public rebuild(): void {
        const old = this.walls.geometry;
        this.walls.geometry = buildPillarsGeometry(this.mask, this.layout, this.shape, this.extraOffsetZ, this.pillarField, this.titleZone);
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
        skipChangedHighlight(seed);
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
        folder.add(l, 'titleFillMinRow', 0, 10, 0.1).onFinishChange(rebuild);
        folder.add(l, 'titleFillMaxRow', 0, 100, 0.5).onFinishChange(rebuild);
        folder.add(l, 'titleFillShoulder', 0, 1.5, 0.01).onFinishChange(rebuild);
        folder.add(l, 'titleFillShoulderJitter', 0, 1, 0.01).onFinishChange(rebuild);
    }

    public bindShapeTweaks(folder: GUI): void {
        const rebuild = () => this.rebuild();
        const s = this.shape;

        const syncSurface = () => applySurfaceUniforms(this.surfaceUniforms, s);

        folder.add(s, 'textureScale', 0.2, 6, 0.05).onFinishChange(rebuild);
        folder.add(s, 'hexScale', 0.2, 4, 0.05).onChange(syncSurface);
        folder.add(s, 'hexContrast', 1, 16, 0.1).onChange(syncSurface);
        folder.add(s, 'macroStrength', 0, 1, 0.01).onChange(syncSurface);
        folder.add(s, 'macroScale', 0.02, 2, 0.01).onChange(syncSurface);
        folder.add(s, 'chamfer', 0, 0.45, 0.01).onFinishChange(rebuild);
        folder.add(s, 'damageChance', 0, 1, 0.01).onFinishChange(rebuild);
        folder.add(s, 'damageMaxPieces', 2, 6, 1).onFinishChange(rebuild);
        folder.add(s, 'damageGap', 0, 0.1, 0.001).onFinishChange(rebuild);
        folder.add(s, 'damageOffset', 0, 0.6, 0.01).onFinishChange(rebuild);
        folder.add(s, 'damageTiltDeg', 0, 15, 0.1).onFinishChange(rebuild);
        folder.add(s, 'damageBevel', 0, 0.05, 0.001).onFinishChange(rebuild);
    }
}


// how finely pillar growth is sampled when checking what ends up behind the title
const FILL_STEP = 0.25;

interface TitleCover {
    /** height at which the pillar's top clears the top of the title */
    height: number;
    /** how far beside the title the top passes, 0 when it passes behind it (normalised screen units) */
    outside: number;
}

/**
 * Grows a pillar from its own height and follows its top on screen. If the top passes behind the title or the shoulder
 * beside it, returns the height at which it clears the top of the text and how far beside the title it passed.
 * Otherwise the pillar never gets near the text and null is returned.
 */
const heightToCoverTitle = (centre: Vector3, axis: Vector3, height: number, zone: ScreenZone, layout: PillarLayout): TitleCover | null => {
    const m = layout.titleFillMargin;
    const minX = zone.ndc.min.x - m, maxX = zone.ndc.max.x + m;
    const minY = zone.ndc.min.y - m, maxY = zone.ndc.max.y + m;
    const shoulder = layout.titleFillShoulder;

    let outside = Infinity;
    for (let h = height; h <= layout.titleFillMaxHeight; h += FILL_STEP) {
        const top = centre.clone().addScaledVector(axis, h / 2).project(zone.camera);
        if (top.z >= 1) return null; // behind the camera
        if (top.y >= minY && top.y <= maxY) {
            outside = Math.min(outside, Math.max(minX - top.x, top.x - maxX, 0));
        }
        if (top.y > maxY) return outside <= shoulder ? { height: h, outside } : null;
    }
    return outside <= shoulder ? { height: layout.titleFillMaxHeight, outside } : null;
};

const applySurfaceUniforms = (uniforms: { [name: string]: IUniform<number> }, shape: PillarShape) => {
    uniforms.hexScale.value = shape.hexScale;
    uniforms.hexContrast.value = shape.hexContrast;
    uniforms.macroStrength.value = shape.macroStrength;
    uniforms.macroScale.value = shape.macroScale;
};

/**
 * Lengthens a pillar downwards along its own axis until its bottom is `depth` below the water, keeping its top in place
 */
const extendBelowWater = (pillar: PillarInstance, axis: Vector3, depth: number): PillarInstance => {
    const top = pillar.centre.clone().addScaledVector(axis, pillar.height / 2);
    const length = (top.y - (WATER_LEVEL_Y - depth)) / axis.y;
    if (length <= pillar.height) return pillar;
    return { ...pillar, height: length, centre: top.addScaledVector(axis, -length / 2) };
};

// pillars shorter than this are never broken, the stubs stay sharp
const DAMAGE_MIN_HEIGHT = 0.8;
// shortest piece a broken pillar is cut into, as a fraction of its height
const DAMAGE_MIN_PIECE = 0.2;

/**
 * Breaks a pillar into stacked pieces with a gap between them. Each piece above the first shifts sideways and tilts a little
 * on top of the one below, and the pieces get chipped (bevelled) ends.
 */
const breakPillar = (pillar: PillarInstance, axis: Vector3, shape: PillarShape, rng: () => number): PillarInstance[] => {
    const count = 2 + Math.floor(rng() * (shape.damageMaxPieces - 1));

    // random cut points, spaced so no piece gets too short
    const cuts: number[] = [];
    for (let k = 1; k < count; k++) cuts.push(k / count + (rng() * 2 - 1) * (0.5 / count - DAMAGE_MIN_PIECE / 2));
    const bounds = [0, ...cuts, 1];

    const side = new Vector3().crossVectors(axis, new Vector3(0, 0, 1)).normalize();
    const forward = new Vector3().crossVectors(axis, side).normalize();
    const base = pillar.centre.clone().addScaledVector(axis, -pillar.height / 2);
    const shift = new Vector3();
    const tilt = degToRad(shape.damageTiltDeg);
    let lean = pillar.leanRad, roll = pillar.rollRad, spin = pillar.spinRad;

    const pieces: PillarInstance[] = [];
    for (let k = 0; k < count; k++) {
        const start = bounds[k] * pillar.height + (k > 0 ? shape.damageGap / 2 : 0);
        const end = bounds[k + 1] * pillar.height - (k < count - 1 ? shape.damageGap / 2 : 0);
        if (k > 0) {
            const angle = rng() * Math.PI * 2;
            const amount = rng() * shape.damageOffset * pillar.radius;
            shift.addScaledVector(side, Math.cos(angle) * amount).addScaledVector(forward, Math.sin(angle) * amount);
            lean += (rng() * 2 - 1) * tilt;
            roll += (rng() * 2 - 1) * tilt;
            spin += (rng() * 2 - 1) * 0.3;
        }
        pieces.push({
            ...pillar,
            centre: base.clone().addScaledVector(axis, (start + end) / 2).add(shift),
            height: end - start,
            leanRad: lean,
            rollRad: roll,
            spinRad: spin,
            bevel: shape.damageBevel,
        });
    }
    return pieces;
};

const createPillarField = (mask: number[][], extraOffsetZ: number): PillarField => ({
    dataA: makeFieldTexture(mask.length, mask[0].length),
    dataB: makeFieldTexture(mask.length, mask[0].length),
    origin: new Vector2(-mask.length * SCALE_FACTOR / 2, extraOffsetZ - mask[0].length * SCALE_FACTOR),
    cellSize: SCALE_FACTOR,
    size: new Vector2(mask.length, mask[0].length),
});

const buildPillarsGeometry = (mask: number[][], layout: PillarLayout, shape: PillarShape, extraOffsetZ: number, field: PillarField, titleZone?: ScreenZone): BufferGeometry => {
    (field.dataA.image.data as Float32Array).fill(0);
    (field.dataB.image.data as Float32Array).fill(0);

    const rng = makeRng(layout.seed);
    const shore = getShoreCells(mask);

    const plannedWidth = mask.length*SCALE_FACTOR;
    const plannedDepth = mask[0].length*SCALE_FACTOR;

    const offsetX = -plannedWidth/2;
    const offsetZ = extraOffsetZ - plannedDepth;

    const f = layout.noiseScale;
    const instances: PillarInstance[] = [];

    for (let i = 0; i < mask.length; ++i) {
        for (let j = 0; j < mask[0].length; ++j) {
            if (mask[i][j] === WATER) continue;

            // always draw the same amount of numbers per cell so changing one setting doesn't reshuffle the rest
            const [jx, jz, skip, h1, h2, rad, lean, yaw, roll, self, baseY, fillExtraRoll, uvU, uvV, damageRoll, damageSeed, shoulderRoll] = Array.from({ length: 17 }, rng);

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

            // pillars (within the fill rows) that pass behind the title are raised just past the top of the text (and thickened) so there's no sky
            // behind it. Everything else keeps its height, so the wall keeps the same variety as elsewhere
            // beside the title (the shoulder) pillars are only partly raised, each by a random share, so the wall steps down
            // instead of dropping off
            const inFillRows = distance >= layout.titleFillMinRow && distance <= layout.titleFillMaxRow;
            const cover = titleZone && inFillRows ? heightToCoverTitle(centre, axis, height, titleZone, layout) : null;
            if (cover !== null) {
                const full = Math.min(cover.height * (1 + fillExtraRoll * layout.titleFillExtra), layout.titleFillMaxHeight);
                const falloff = cover.outside === 0 ? 1 : 1 - smoothstep(cover.outside, 0, layout.titleFillShoulder);
                const share = cover.outside === 0 ? 1 : falloff * (1 - layout.titleFillShoulderJitter * shoulderRoll);
                height = lerp(height, Math.max(height, full), share);
                radiusScale *= lerp(1, layout.titleFillRadiusScale, share);
            } else if (skip < layout.skipChance) {
                continue;
            }

            // keep big pillars out of the landing view, the stubs can stay
            if (height > layout.cameraClearMaxHeight && distanceToPillar(CAMERA_HOME_POS, centre, axis, height) < layout.cameraClearRadius) {
                height = layout.cameraClearMaxHeight;
            }

            const pillar: PillarInstance = {
                centre,
                height,
                radius: radiusScale * RADIUS,
                spinRad: degToRad(self * layout.selfRotateDeg + yawT * layout.yawVarianceDeg),
                leanRad,
                rollRad,
                uvOffsetU: uvU * 100,
                uvOffsetV: uvV * 100,
                bevel: 0,
            };

            if (height >= DAMAGE_MIN_HEIGHT && damageRoll < shape.damageChance) {
                // own random stream, since the number of pieces varies. Only the bottom piece (unshifted, same axis) reaches down
                const pieces = breakPillar(pillar, axis, shape, makeRng(Math.floor(damageSeed * 4294967296)));
                pieces[0] = extendBelowWater(pieces[0], axis, layout.depthBelowWater);
                recordWaterline(field, i, j, pieces[0], axis);
                instances.push(...pieces);
            } else {
                const extended = extendBelowWater(pillar, axis, layout.depthBelowWater);
                recordWaterline(field, i, j, extended, axis);
                instances.push(extended);
            }
        }
    }

    computeClearance(field);
    field.dataA.needsUpdate = true;
    field.dataB.needsUpdate = true;
    return buildPillarMesh(instances, shape);
};

export class WallsFactory {
    constructor(private loadingMgr: LoadingManager, private scene: Scene) {}

    public async makeWalls(extraOffsetZ: number, layout: PillarLayout, shape: PillarShape, titleZone?: ScreenZone): Promise<Walls> {
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

        const surfaceUniforms: { [name: string]: IUniform<number> } = {
            hexScale: { value: 0 },
            hexContrast: { value: 0 },
            macroStrength: { value: 0 },
            macroScale: { value: 0 },
            reflectionBelowY: { value: WATER_LEVEL_Y },
        };
        applySurfaceUniforms(surfaceUniforms, shape);

        material.onBeforeCompile = (params, renderer) => {
            fogShader.handle(params, renderer);
            applyPillarSurface(params, surfaceUniforms);
        };

        const mask = await this.parseMapTemplate(PILLARS_GEOGRAPHY_MAP);

        // the geometry is built by Walls, which also owns the pillar field
        const mesh = new Mesh(new BufferGeometry(), material);
        // only the meteor's impact flash casts shadows, so this costs nothing the rest of the time
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        return new Walls(
            mask,
            extraOffsetZ,
            layout,
            shape,
            titleZone,
            mesh,
            fogShader,
            surfaceUniforms
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
