import { Vector3 } from "three";
import { Color } from "./utils/color";

// show debug stuff
export const DEBUG = false;

// hand-tweaking panel, also available via ?tweaks in the URL
export const TWEAKS_ENABLED = DEBUG || new URLSearchParams(window.location.search).has('tweaks');

export const TITLE_HOME = "Home";
export const TITLE_ABOUT_ME = "About Me";
export const TITLE_CONTACT = "Contact";


export const WALLS_OFFSET = 10;

export const ROW_LENGTH_Z = 60;
export const ROW_LENGTH_X = 8;
export const SCALE_FACTOR = 0.25;

// camera
export const CAMERA_INITIAL_X = 0;
export const CAMERA_INITIAL_Y = -0.53;
export const CAMERA_INITIAL_Z = 5.24;

export interface FlightSettings {
    /** horizontal speed, units per second */
    moveSpeed: number;
    verticalSpeed: number;
    lookSensitivity: number;
    /** seconds to ease into/out of movement */
    smoothing: number;
}

export const FLIGHT_SETTINGS: FlightSettings = {
    moveSpeed: 2,
    verticalSpeed: 1.5,
    lookSensitivity: 1,
    smoothing: 0.15,
};


// camera:scene

// where the page loads and "Home" returns to; paste new values from the Camera folder of the tweak panel (?tweaks)
export const CAMERA_HOME_POS = new Vector3(-2.3892, -0.4283, 4.5683);
/** point the camera looks at */
export const CAMERA_HOME_DIR = new Vector3(-1.7774, -0.6989, 3.8250);

export const CAMERA_ABOUT_ME_X = -0.8113;
export const CAMERA_ABOUT_ME_Y = -0.5845;
export const CAMERA_ABOUT_ME_Z = 3.5314;
export const CAMERA_ABOUT_ME_DIRECTION_X = -3;
export const CAMERA_ABOUT_ME_DIRECTION_Y = -2;
export const CAMERA_ABOUT_ME_DIRECTION_Z = 0;
export const CAMERA_ABOUT_ME_POS = new Vector3(CAMERA_ABOUT_ME_X, CAMERA_ABOUT_ME_Y, CAMERA_ABOUT_ME_Z);
export const CAMERA_ABOUT_ME_DIR = new Vector3(CAMERA_ABOUT_ME_DIRECTION_X, CAMERA_ABOUT_ME_DIRECTION_Y, CAMERA_ABOUT_ME_DIRECTION_Z-1);

export const CAMERA_CONTACT_X = 0;
export const CAMERA_CONTACT_Y = 0;
export const CAMERA_CONTACT_Z = 10;
export const CAMERA_CONTACT_DIRECTION_X = 0;
export const CAMERA_CONTACT_DIRECTION_Y = 0;
export const CAMERA_CONTACT_DIRECTION_Z = 9;
export const CAMERA_CONTACT_POS = new Vector3(CAMERA_CONTACT_X, CAMERA_CONTACT_Y, CAMERA_CONTACT_Z);
export const CAMERA_CONTACT_DIR = new Vector3(CAMERA_CONTACT_DIRECTION_X, CAMERA_CONTACT_DIRECTION_Y, CAMERA_CONTACT_DIRECTION_Z);


// VISUALS
export const BACKGROUND_COLOR = Color.fromHex("#8dd1cd");

// UI grain (see ui/grain.ts)
export interface GrainStyle {
    fillColor: string;
    fillOpacity: number;
    fillOpacityHover: number;
    /** blur radius (px) the edge fades over */
    edgeSoftness: number;
    /** how hard the dithered edge is, higher = crisper grains */
    edgeContrast: number;
    /** how much the noise eats into the edge */
    edgeGrain: number;
    edgeGrainScale: number;
    /** grain across the whole fill */
    fineGrain: number;
    fineGrainScale: number;
    /** the hovered button pulls into focus: same knobs, crisper values */
    hoverEdgeSoftness: number;
    hoverEdgeGrain: number;
    hoverFineGrain: number;
    hoverTransitionMs: number;
    animate: boolean;
    animateFps: number;
}

export const GRAIN_STYLE: GrainStyle = {
    fillColor: '#687875',
    fillOpacity: 0.45,
    fillOpacityHover: 0.9,
    edgeSoftness: 5,
    edgeContrast: 9,
    edgeGrain: 0.8,
    edgeGrainScale: 0.8,
    fineGrain: 0.5,
    fineGrainScale: 1.4,
    hoverEdgeSoftness: 1,
    hoverEdgeGrain: 0.2,
    hoverFineGrain: 0.15,
    hoverTransitionMs: 400,
    animate: true,
    animateFps: 12,
};

// distance blur (postprocessing/distance-blur.ts)
export interface DistanceBlurSettings {
    enabled: boolean;
    /** the blur fades in while a text panel (about, contact) is open, and out again on home and in free flight */
    transitionSeconds: number;
    /** show the blur all the time, for tuning it */
    alwaysOn: boolean;
    /** no blur closer than this, world units */
    focusDistance: number;
    /** distance over which the blur ramps up to its maximum */
    blurRange: number;
    /** blur radius at full strength, pixels */
    maxBlur: number;
}

export const DISTANCE_BLUR: DistanceBlurSettings = {
    enabled: true,
    transitionSeconds: 1.5,
    alwaysOn: false,
    focusDistance: 2.5,
    blurRange: 8,
    maxBlur: 7,
};

// day/night (environment/day-night.ts): the day values are the scene's own, these are the night ones
export interface DayNightSettings {
    /** 0-24, 12 is midday; will follow the visitor's clock later */
    hour: number;
    nightSky: string;
    nightFogNear: string;
    nightFogFar: string;
    /** the plain fog that particles and the seabed use */
    nightSceneFog: string;
    nightAmbientSky: string;
    nightAmbientGround: string;
    /** times the day brightness */
    nightAmbientScale: number;
    nightSpotColor: string;
    nightSpotScale: number;
    nightDiffuseColor: string;
    nightDiffuseScale: number;
    nightExposureScale: number;
    nightUnderwaterColor: string;
    nightCausticColor: string;
    nightCausticStrength: number;
    nightFlakeGlow: number;
}

export const DAY_NIGHT: DayNightSettings = {
    hour: 12,
    nightSky: '#0b1b24',
    nightFogNear: '#3a1c12',
    nightFogFar: '#0f2a30',
    nightSceneFog: '#050909',
    nightAmbientSky: '#0a1822',
    nightAmbientGround: '#1b2b33',
    nightAmbientScale: 0.35,
    nightSpotColor: '#7d9bbd',
    nightSpotScale: 0.25,
    nightDiffuseColor: '#203844',
    nightDiffuseScale: 0.3,
    nightExposureScale: 1,
    nightUnderwaterColor: '#0c1a1c',
    nightCausticColor: '#2ebdb6',
    nightCausticStrength: 0.6,
    nightFlakeGlow: 1.5,
};

// fog
export const FOG_COLOR = Color.fromHex('#1c1c1c');
export const FOG_INTENSITY = 0.08;

export const FOG_UPDATE_EVERY_MS = 1000/60;
const FOG_SLOWNESS = 4800;
export const FOG_UPDATE_BY = 1/FOG_SLOWNESS;

// sky
export const AMBIENT_LIGHT_SKY_COLOR = Color.fromHex('#1d2f3a');
export const AMBIENT_LIGHT_GROUND_COLOR = Color.fromHex('#ffffff');
export const AMBIENT_LIGHT_INTENSITY = 10;
export const SKY_TEXTURE = 'nightsky_edit.jpg';

export const SPOTLIGHT_SKY_COLOR = Color.fromHex('#ffffff');
export const SPOTLIGHT_SKY_INTENSITY = 600;

export const POINTLIGHT_SKY_COLOR = Color.fromHex('#6f7477');

// water
export const WATER_TEXTURE = 'waternormals.jpg';
export const WATER_SUN_COLOR = Color.fromHex('#000000');
export const WATER_COLOR = Color.fromHex('#000000');

export interface WaterLook {
    /** opacity of the surface when looking straight down, it goes towards fully reflective at grazing angles */
    surfaceOpacity: number;
    /** how quickly it turns reflective towards grazing angles, higher = see-through for longer */
    fresnelPower: number;
    /** colour things fade into under water */
    underwaterColor: string;
    /** absorption per world unit travelled under water */
    underwaterDensity: number;
    /** depth of the seabed below the surface */
    seabedDepth: number;
    /** 0 = the old water, 1 = thick: slower, longer and shallower ripples */
    viscosity: number;
    /** direction the water drifts in, degrees around the vertical (0 = +x, 90 = +z, towards the start view) */
    flowAngleDeg: number;
    /** drift speed, world units per second (before viscosity slows it) */
    flowSpeed: number;
    /** how high the surface climbs the rock (as a slope scale) and over what width, world units */
    meniscusHeight: number;
    meniscusWidth: number;
    /** how much the flow piles up in front of a pillar and dips behind it, and over what width */
    cushionStrength: number;
    cushionWidth: number;
    /** how much longer the dip behind a pillar is than the cushion in front */
    wakeStretch: number;
    /** ripples fade out within this distance of the rock */
    rippleDampRadius: number;
    /** light on the meniscus rim */
    rimColor: string;
    rimStrength: number;
    /** the pillar interaction is only computed for water closer to the camera than this */
    interactionDistance: number;
    /** close to the camera the water is really displaced around the pillars, with the height exaggerated by this */
    displacementScale: number;
    /** half the size of the displaced patch around the camera, 0 turns it off */
    displacementRadius: number;
    /** vertex spacing of the displaced patch, world units */
    displacementSpacing: number;
    /** light patterns from the surface on the pillars, in a band around the waterline */
    causticColor: string;
    causticStrength: number;
    /** how far above and below the surface the band reaches */
    causticAbove: number;
    causticBelow: number;
    /** pattern size (higher = smaller cells) and speed */
    causticScale: number;
    causticSpeed: number;
    /** higher = thinner, brighter lines; lower = soft glow */
    causticSharpness: number;
    /** darker, wet band on the pillars just above the surface */
    wetBandHeight: number;
    wetBandDarkness: number;
}

export const WATER_LOOK: WaterLook = {
    surfaceOpacity: 0.03,
    fresnelPower: 1.9,
    underwaterColor: '#3f4b4a',
    underwaterDensity: 1.75,
    seabedDepth: 3.05,
    viscosity: 0.64,
    flowAngleDeg: 280,
    flowSpeed: 0.215,
    meniscusHeight: 0.007,
    meniscusWidth: 0.025,
    cushionStrength: 0.0045,
    cushionWidth: 0.085,
    wakeStretch: 2.4,
    rippleDampRadius: 0.195,
    rimColor: '#a2857c',
    rimStrength: 0.29,
    interactionDistance: 7,
    displacementScale: 5,
    displacementRadius: 2.5,
    displacementSpacing: 0.0125,
    causticColor: '#6f807b',
    causticStrength: 0.27,
    causticAbove: 0,
    causticBelow: 0.55,
    causticScale: 7.5,
    causticSpeed: 0.17,
    causticSharpness: 8,
    wetBandHeight: 0.09,
    wetBandDarkness: 0,
};


// pillars
export const PILLARS_GEOGRAPHY_MAP = 'fill_map.png';
// light is kind of inspired by this: https://www.dreamstime.com/abstract-digital-painting-beautiful-basalt-columns-fantasy-landscape-background-columnar-basalt-abstract-fantasy-image256455717
export const PILLARS_FOG_NEAR_COLOR = Color.fromHex("#ff6a00");
export const PILLARS_FOG_FAR_COLOR = Color.fromHex("#8dd1cd");
export const PILLARS_FOG_NOISE_FREQ = 0.26;
export const PILLARS_FOG_NOISE_IMPACT = 0.3;
export const PILLARS_FOG_NOISE_SPEED = 100;

export interface PillarLayout {
    /** when set, a new seed is rolled on every page load */
    randomSeed: boolean;
    seed: number;
    /** random offset from the grid cell centre, as a fraction of the cell size */
    jitter: number;
    skipChance: number;
    /** perturbs the distance to the water (in cells) so height bands don't follow the grid */
    distanceNoise: number;
    /** frequency of the noise fields, per cell */
    noiseScale: number;
    /** 0 = every pillar varies independently, 1 = neighbours lean/turn together */
    clumpiness: number;
    baseYVariance: number;
    radiusMin: number;
    radiusMax: number;
    leanDeg: number;
    leanVarianceDeg: number;
    yawVarianceDeg: number;
    rollVarianceDeg: number;
    selfRotateDeg: number;
    /** pillars passing within this distance of the home camera are cut down, so none fill the landing view */
    /** every pillar reaches at least this far below the water surface; set from the water's seabedDepth */
    depthBelowWater: number;
    cameraClearRadius: number;
    cameraClearMaxHeight: number;
    /** back-row pillars that pass behind the title in the home view are raised just enough to clear the top of the text, up to this */
    titleFillMaxHeight: number;
    /** extra room around the title, in normalised screen units (2 = full screen) */
    titleFillMargin: number;
    /** raised pillars get up to this fraction of extra height on top, so the skyline above the text stays ragged */
    titleFillExtra: number;
    /** raised pillars are thickened by this to close the gaps between them */
    titleFillRadiusScale: number;
    /** raising only applies to pillars between these distances from the water (in cells), front rows to back rows */
    titleFillMinRow: number;
    titleFillMaxRow: number;
    /** width of the band beside the title where pillars are partly raised so the wall steps down, normalised screen units */
    titleFillShoulder: number;
    /** 0 = pillars in the shoulder follow the falloff exactly, 1 = each gets a random share of it (ragged steps) */
    titleFillShoulderJitter: number;
}

export interface PillarShape {
    /** texture repeats per world unit */
    textureScale: number;
    /** hex tiling cells per texture repeat, hides the repeating pattern */
    hexScale: number;
    /** how hard neighbouring cells blend, higher keeps more of the texture's contrast */
    hexContrast: number;
    /** large scale brightness variation across the walls */
    macroStrength: number;
    /** frequency of that variation, per world unit */
    macroScale: number;
    /** how much of each hexagon corner is cut off, fraction of an edge */
    chamfer: number;
    /** chance a pillar is broken into stacked pieces */
    damageChance: number;
    damageMaxPieces: number;
    /** gap between broken pieces, world units */
    damageGap: number;
    /** how far pieces shift sideways, fraction of the radius */
    damageOffset: number;
    damageTiltDeg: number;
    /** chipped edge on the ends of broken pieces, world units */
    damageBevel: number;
}

export const PILLAR_SHAPE: PillarShape = {
    textureScale: 1.6,
    hexScale: 0.2,
    hexContrast: 6,
    macroStrength: 0.25,
    macroScale: 0.35,
    chamfer: 0.12,
    damageChance: 0.15,
    damageMaxPieces: 3,
    damageGap: 0.012,
    damageOffset: 0.12,
    damageTiltDeg: 2,
    damageBevel: 0.012,
};

export const PILLAR_LAYOUT: PillarLayout = {
    randomSeed: true,
    seed: 1,
    jitter: 0.35,
    skipChance: 0.03,
    distanceNoise: 1.0,
    noiseScale: 0.15,
    clumpiness: 0.6,
    baseYVariance: 0.1,
    radiusMin: 0.085,
    radiusMax: 0.115,
    leanDeg: 35,
    leanVarianceDeg: 10,
    yawVarianceDeg: 15,
    rollVarianceDeg: 1,
    selfRotateDeg: 10,
    depthBelowWater: 1.4,
    cameraClearRadius: 1.5,
    cameraClearMaxHeight: 0.5,
    titleFillMaxHeight: 16,
    titleFillMargin: 0.05,
    titleFillExtra: 0.3,
    titleFillRadiusScale: 1.3,
    titleFillMinRow: 6.3,
    titleFillMaxRow: 100,
    titleFillShoulder: 0.45,
    titleFillShoulderJitter: 0.64,
};


// cube
export const CUBE_COLOR = Color.fromHex("#00ffdd");
export const CUBE_LIGHT_COLOR = Color.fromHex("#4bffe7");


// rings
export const RING_ONE_COLOR = Color.fromHex("#ffffff");
export const RING_TWO_COLOR = Color.fromHex("#fffbb5");

// ambient particles (environment/particle-field.ts)
export interface ParticleSettings {
    /** particles in the box around the camera, all colours together */
    count: number;
    /** size of the box around the camera particles live in (it wraps as the camera moves) */
    boxSize: number;
    fallSpeed: number;
    sway: number;
    dotSize: number;
    flakeSize: number;
    /** particles closer than this are flakes, further away dots, crossfading over the band */
    flakeNear: number;
    flakeBand: number;
    flakeSpin: number;
    /** how much the flakes glow in their own colour; meant to come up as the day turns into night */
    flakeGlow: number;
    /** once on the water: how long particles float, then how fast they sink and over what depth they fade */
    floatSeconds: number;
    sinkSpeed: number;
    sinkDepth: number;
    /** the dip in the water under floating flakes: size (times the flake's), darkness, rim brightness and colour */
    dimpleSize: number;
    dimpleDarkness: number;
    dimpleRim: number;
    dimpleRimColor: string;
    /** how far floating particles stay clear of the pillars */
    pillarMargin: number;
    /** colours of the two particle sets' flakes (their dots use the particle textures) */
    flakeColor1: string;
    flakeColor2: string;
}

export const PARTICLES: ParticleSettings = {
    count: 1600,
    boxSize: 9,
    fallSpeed: 0.04,
    sway: 0.05,
    dotSize: 0.012,
    flakeSize: 0.03,
    flakeNear: 1.2,
    flakeBand: 2.1,
    flakeSpin: 0.8,
    flakeGlow: 0,
    floatSeconds: 12,
    sinkSpeed: 0.02,
    sinkDepth: 0.25,
    pillarMargin: 0.02,
    dimpleSize: 2.1,
    dimpleDarkness: 0.12,
    dimpleRim: 0,
    dimpleRimColor: '#a1c4bf',
    flakeColor1: '#2ebdb6',
    flakeColor2: '#e1602d',
};

// particles
export const DUST_CAMERA_OFFSET_FRONT = -2;
export const DUST_RADIUS = 2;
export const DUST_SPAWN_INITIALLY = 1000;

export const TEXTURE_PARTICLE_CYAN = 'particle_small_cyan.png';
export const DUST_AMOUNT_CYAN = 300;
export const DUST_SIZE_CYAN = 0.01;

export const TEXTURE_PARTICLE_RED = 'particle_small_redish.png';
export const DUST_AMOUNT_RED = 400;
export const DUST_SIZE_RED = 0.005;

export const DUST_CENTER = new Vector3(0, 1, CAMERA_INITIAL_Z + DUST_CAMERA_OFFSET_FRONT);
export const ROTATING_DUST_CENTER = new Vector3(CAMERA_INITIAL_X, CAMERA_INITIAL_Y, CAMERA_INITIAL_Z-1.5);