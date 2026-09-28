import { Vector3 } from "three";
import { Color } from "./utils/color";

// show debug stuff
export const DEBUG = false;

// hand-tweaking panel, also available via ?tweaks in the URL
export const TWEAKS_ENABLED = DEBUG || new URLSearchParams(window.location.search).has('tweaks');

export const TITLE_HOME = "Home";
export const TITLE_LINKS = "Links";
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

export const CAMERA_LINKS_X = -0.8113;
export const CAMERA_LINKS_Y = -0.5845;
export const CAMERA_LINKS_Z = 3.5314;
export const CAMERA_LINKS_DIRECTION_X = -3;
export const CAMERA_LINKS_DIRECTION_Y = -2;
export const CAMERA_LINKS_DIRECTION_Z = 0;
export const CAMERA_LINKS_POS = new Vector3(CAMERA_LINKS_X, CAMERA_LINKS_Y, CAMERA_LINKS_Z);
export const CAMERA_LINKS_DIR = new Vector3(CAMERA_LINKS_DIRECTION_X, CAMERA_LINKS_DIRECTION_Y, CAMERA_LINKS_DIRECTION_Z-1);

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
    /** the blur fades in while a text panel (links, contact) is open, and out again on home and in free flight */
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
    /** share of the orange particles still around at night (the rest fade out one by one) */
    nightOrangeParticles: number;
    /** the rim of light where the water climbs the pillars, times its day strength */
    nightRimScale: number;
    /** the flat grey the water adds to its reflection (0.1 by day) */
    nightReflectionFloor: number;
    /** how much of the aurora shows at night (0 by day) */
    nightAurora: number;
    /** the water turns more mirror-like at night: its opacity looking straight down, how fast it turns reflective, and
     * how bright the reflections are (1 = as by day) */
    nightSurfaceOpacity: number;
    nightFresnelPower: number;
    nightReflectionStrength: number;
    /** the same for grey, colourless reflections (the dark sky, fog), so they don't turn into a grey sheen */
    nightReflectionGrey: number;
    /** fill colour of the menu buttons at night */
    nightMenuFill: string;
    /** how fast the coloured fog drifts at night, 1 = as by day, 0 = still */
    nightFogSpeed: number;
}

export const DAY_NIGHT: DayNightSettings = {
    hour: 12,
    nightSky: '#1a2023',
    nightFogNear: '#2b4e5f',
    nightFogFar: '#202631',
    nightSceneFog: '#1a2e2e',
    nightAmbientSky: '#94dfff',
    nightAmbientGround: '#00378f',
    nightAmbientScale: 0.52,
    nightSpotColor: '#60708a',
    nightSpotScale: 0.27,
    nightDiffuseColor: '#8a93a5',
    nightDiffuseScale: 0.3,
    nightExposureScale: 1,
    nightUnderwaterColor: '#0c1a1c',
    nightCausticColor: '#2d3a49',
    nightCausticStrength: 1.11,
    nightFlakeGlow: 1.74,
    nightOrangeParticles: 0,
    nightRimScale: 0.01,
    nightReflectionFloor: 0.01,
    nightAurora: 1,
    nightSurfaceOpacity: 0.9,
    nightFresnelPower: 1.88,
    nightReflectionStrength: 3.28,
    nightReflectionGrey: 0.3,
    nightMenuFill: '#1e2e39',
    nightFogSpeed: 0,
};

// the acid lake has bleached the pillars around the waterline (shaders/pillar-surface.glsl.ts)
export interface AcidBleachSettings {
    enabled: boolean;
    /** how pale it has turned them */
    strength: number;
    /** how far above the surface (metres, on average: the tide mark wanders) and below it */
    above: number;
    below: number;
    color: string;
    /** the thin crust along the tide mark */
    crust: number;
    crustColor: string;
}

export const ACID_BLEACH: AcidBleachSettings = {
    enabled: true,
    strength: 0.6,
    above: 0.2,
    below: 0.5,
    color: '#d8d0bc',
    crust: 0.3,
    crustColor: '#8f7f4a',
};

// a black hole in the night sky with its accretion disc (environment/black-hole.ts)
export interface BlackHoleSettings {
    enabled: boolean;
    /** how much of it shows by day (it fades in with the night) */
    byDay: number;
    /** where it hangs: 0 down the channel, 90 is +x, and degrees above the horizon */
    azimuthDeg: number;
    elevationDeg: number;
    /** how wide its black shadow looks (degrees), and how far round it the sky is bent (times that) */
    shadowDeg: number;
    regionScale: number;
    /** how the disc is seen: 90 edge-on, 0 face-on; and how it's rolled on the sky */
    inclinationDeg: number;
    rollDeg: number;
    /** the disc's inner and outer edge, in the hole's masses (its shadow is about 5.2 across) */
    discInner: number;
    discOuter: number;
    /** how fast it spins (-1 to 1: which way, and how much it drags the light round and pulls its shadow aside) */
    spin: number;
    /** how fast the disc's streaks turn, its brightness, and how much brighter its side coming towards us is */
    discSpeed: number;
    discBrightness: number;
    beaming: number;
    /** the disc's colours, from its hot inner edge out */
    hotColor: string;
    warmColor: string;
    coolColor: string;
}

export const BLACK_HOLE: BlackHoleSettings = {
    enabled: true,
    byDay: 0,
    // on the celestial pole (Stars), so it stays put while the stars turn around it: behind the home view, above the
    // volcano, for whoever turns around
    azimuthDeg: 165,
    elevationDeg: 25,
    shadowDeg: 4,
    regionScale: 5,
    inclinationDeg: 80,
    rollDeg: -20,
    discInner: 4,
    discOuter: 16,
    spin: 0.6,
    discSpeed: 0.3,
    discBrightness: 1.2,
    beaming: 3,
    hotColor: '#fff1d0',
    warmColor: '#ffa040',
    coolColor: '#a8301a',
};

// sunset and sunrise (environment/twilight.ts): while the large sun is low, the day/night blend's colours are pulled
// towards these, and a warm glow lies on the sky and the far fog around the sun
export interface TwilightSettings {
    enabled: boolean;
    /** how far at most the colours go towards the palette */
    strength: number;
    /** the sun's height (degrees) where it starts, is at its fullest, and has gone again below the horizon */
    startElevationDeg: number;
    peakElevationDeg: number;
    endElevationDeg: number;
    sky: string;
    fogNear: string;
    fogFar: string;
    sceneFog: string;
    /** the colour of the light down the channel, and of the ambient light from the sky */
    light: string;
    ambient: string;
    /** the glow around the sun on the horizon: colour, brightness on the sky and in the far fog, width and height */
    glowColor: string;
    glowStrength: number;
    fogGlowStrength: number;
    glowWidthDeg: number;
    glowHeight: number;
}

export const TWILIGHT: TwilightSettings = {
    enabled: true,
    strength: 0.8,
    startElevationDeg: 22,
    peakElevationDeg: 1,
    endElevationDeg: -18,
    sky: '#8a7894',
    fogNear: '#c07a5c',
    fogFar: '#8e7088',
    sceneFog: '#7d6a80',
    light: '#ffb088',
    ambient: '#ffc4a0',
    glowColor: '#ff8a4a',
    glowStrength: 0.6,
    fogGlowStrength: 0.4,
    glowWidthDeg: 40,
    glowHeight: 0.15,
};

// the two suns/moons (environment/celestial.ts); azimuth 0 looks down the channel (-z), 90 is +x
export interface CelestialBody {
    color: string;
    /** apparent diameter, degrees */
    sizeDeg: number;
    brightness: number;
    /** how far the glow reaches, times the disc's radius, and how bright it is */
    haloScale: number;
    haloStrength: number;
    riseHour: number;
    /** how long it's above the horizon each time */
    hoursUp: number;
    /** how often it comes round, hours: different periods make the two drift apart and together */
    periodHours: number;
    azimuthRise: number;
    azimuthSet: number;
    /** degrees above the horizon at the top of its arc */
    peakElevation: number;
    /** light it casts on the scene while it's up */
    lightIntensity: number;
}

/** how fogged a surface has to be (0-1) before the suns shine through it; below that it blocks them */
export const SUN_THROUGH_FOG = 0.9;

export const SUN_LARGE: CelestialBody = {
    color: '#ffe2c4',
    sizeDeg: 9,
    brightness: 1.4,
    haloScale: 2.5,
    haloStrength: 0.25,
    riseHour: 6,
    hoursUp: 13,
    periodHours: 24,
    azimuthRise: 150,
    // sets down the far end of the channel, as seen from the home view (which looks slightly right of straight down it)
    azimuthSet: 10,
    peakElevation: 55,
    lightIntensity: 0.6,
};

export const SUN_SMALL: CelestialBody = {
    color: '#ba8282',
    sizeDeg: 4.5,
    brightness: 1.6,
    haloScale: 3,
    haloStrength: 0.2,
    // up during the day only, like the large one (the sky is night-dark by the hour), but a shorter, quicker arc
    riseHour: 8,
    hoursUp: 10,
    periodHours: 24,
    azimuthRise: -120,
    azimuthSet: 60,
    peakElevation: 40,
    lightIntensity: 0.3,
};

// aurora on the night sky (environment/aurora.ts)
export interface AuroraSettings {
    /** colour of the lowest and highest curtains */
    colorLow: string;
    colorHigh: string;
    /** at full night */
    brightness: number;
    /** how high the curtains hang, relative units */
    height: number;
    /** pattern size, higher = more, narrower curtains */
    scale: number;
    /** higher = thinner ribbons */
    sharpness: number;
    speed: number;
    /** how far above the horizon it fades in (as the sine of the angle) */
    horizonFade: number;
    /** faint coloured light it casts from above at night */
    lightIntensity: number;
    /** a blurred glow of the aurora on the water: strength, how soft (times the sky's sharpness), how far it stretches */
    waterGlow: number;
    waterSoftness: number;
    waterStretch: number;
    /** how much of the ripples the glow follows, 0 = smooth */
    waterRipple: number;
    /** how far the glow spreads out around the reflected aurora (gaussian blur radius), degrees; 0 = off */
    waterBlur: number;
    /** 0 = smooth, fixed sampling (large blurs may show faint copies), 1 = random per pixel (hides them, but grainy) */
    waterBlurNoise: number;
    /** it only comes out once the night has settled: fades in between these hours, and out again before dawn */
    fadeInStart: number;
    fadeInEnd: number;
    fadeOutStart: number;
    fadeOutEnd: number;
}

export const AURORA: AuroraSettings = {
    colorLow: '#38f0ed',
    colorHigh: '#2f51f9',
    brightness: 0.56,
    height: 1.15,
    scale: 0.6,
    sharpness: 10,
    speed: 0.25,
    horizonFade: 0.14,
    lightIntensity: 1.24,
    waterGlow: 0.18,
    waterSoftness: 0.1,
    waterStretch: 2.3,
    waterRipple: 0.47,
    waterBlur: 13.5,
    waterBlurNoise: 0.35,
    fadeInStart: 21,
    fadeInEnd: 22.5,
    fadeOutStart: 3,
    fadeOutEnd: 4.5,
};

// shooting stars at night (environment/shooting-stars.ts)
export interface ShootingStarSettings {
    color: string;
    brightness: number;
    /** seconds between meteors, picked at random in this range */
    minInterval: number;
    maxInterval: number;
    /** world units per second, and how long one lasts */
    speed: number;
    duration: number;
    length: number;
    width: number;
    /** chance one comes down into the far end of the channel instead */
    splashChance: number;
    /** the light where it hits the water and how far it reaches; it dies away with the train (trainSeconds) */
    splashLight: number;
    splashLightRange: number;
    /** brightness of the glow on the water itself around the impact */
    splashWaterGlow: number;
    /** whether the flash throws the pillars' shadows, and how sharp they are (shadow map size per side) */
    splashShadows: boolean;
    splashShadowSize: number;
    /** shadow map offsets: too little shows speckles on lit surfaces, too much detaches shadows from what casts them */
    splashShadowBias: number;
    splashShadowNormalBias: number;
    /** how much darker pillar faces the flash doesn't reach (shadowed, or turned away) look next to it (faked) */
    splashShadowOnPillars: number;
    /**
     * which pillars cast those shadows: the ones in the channel (between its walls, give or take this many cells) from
     * the camera to this far past the impact, in a wedge widening from the camera at this half-angle; and only while the
     * camera is down in the channel (between its walls, lower than this above the water)
     */
    shadowCasterWallMargin: number;
    shadowCasterPastImpact: number;
    shadowCasterWedgeDeg: number;
    shadowCanyonHeight: number;
    /** debugging: draws the pillars casting the flash's shadows in magenta while it's on */
    showShadowCasters: boolean;
    /** how high the splash's column of droplets goes, how far out its crown flies, and the droplets' size */
    splashHeight: number;
    splashSpread: number;
    splashDropletSize: number;
    /** the spray plume: how many puffs, their size, how high and wide it goes, how long it hangs */
    splashMistCount: number;
    /** how many jets of spray the plume breaks up into */
    splashMistJets: number;
    splashMistSize: number;
    splashMistHeight: number;
    splashMistSpread: number;
    splashMistSeconds: number;
    splashMistOpacity: number;
    /** higher: thrown out faster and stopped sooner, so it billows out and hangs; gravity pulls it back down */
    splashMistDrag: number;
    splashMistGravity: number;
    /** the spray's own colour; the scene's lights and the impact's flash light it */
    splashMistColor: string;
    /** how strongly the scene's own lights, and the flash, light it (the pale mist needs less than the dark rock) */
    splashMistEnvironmentLight: number;
    splashMistFlashLight: number;
    /** puffs closer than this to the flash are lit as if this far away, so they dim along with the rest of the scene */
    splashMistFlashNear: number;
    /** how far light wraps around a puff to its far side, as mist scatters it */
    splashMistTranslucency: number;
    /** how long the glowing train of a splashdown (and the impact's light) lingers, breaking up (sky meteors just burn out) */
    trainSeconds: number;
}

export const SHOOTING_STARS: ShootingStarSettings = {
    color: '#bff8ff',
    brightness: 3,
    minInterval: 20,
    maxInterval: 60,
    speed: 40,
    duration: 0.7,
    length: 10,
    width: 0.25,
    splashChance: 0.25,
    splashLight: 2000,
    splashLightRange: 30,
    splashWaterGlow: 6.5,
    splashShadows: true,
    splashShadowSize: 1024,
    splashShadowBias: 0,
    splashShadowNormalBias: 0,
    splashShadowOnPillars: 0.7,
    shadowCasterWallMargin: 0,
    shadowCasterPastImpact: 2,
    shadowCasterWedgeDeg: 45,
    shadowCanyonHeight: 3,
    showShadowCasters: false,
    splashHeight: 3.0,
    splashSpread: 2.35,
    splashDropletSize: 0.05,
    splashMistCount: 900,
    splashMistJets: 14,
    splashMistSize: 0.45,
    splashMistHeight: 2.5,
    splashMistSpread: 2,
    splashMistSeconds: 3,
    splashMistOpacity: 0.5,
    splashMistDrag: 2,
    splashMistGravity: 3,
    splashMistColor: '#e4eced',
    splashMistEnvironmentLight: 0.05,
    splashMistFlashLight: 0.17,
    splashMistFlashNear: 2.5,
    splashMistTranslucency: 2.0,
    trainSeconds: 1.0,
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

// the light down the channel from the sky (environment/factory.ts), as a spot light (its cone reaches only the near
// part of the channel) or a directional light along the same direction (the whole channel lit alike)
export interface SkySpotSettings {
    /** the directional light instead of the spot light */
    directional: boolean;
    /** the directional light's brightness (the spot light's falls off with distance, so the two can't share one) */
    directionalIntensity: number;
    /** the spot light's cone, 60 degrees each way from its aim, and the share of that angle over which its edge fades out (0: a hard edge, which cuts a sharp line across the walls) */
    angleDeg: number;
    penumbra: number;
}

export const SKY_SPOT: SkySpotSettings = {
    directional: true,
    directionalIntensity: 5.8,
    angleDeg: 60,
    penumbra: 0.3,
};

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
    /** how much the lip lags the waves (per m/s the surface rises or falls): flattens into a dip as a wave raises the surface, clings on as it drops */
    meniscusLag: number;
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
    /** ripples from a meteor landing in the water: height, how fast and far apart the rings are, how long they last */
    splashRippleHeight: number;
    splashRippleSpeed: number;
    splashWavelength: number;
    splashRippleSeconds: number;
    /** the crater where it lands: how deep, how wide, and how long one sink-and-rebound takes (it settles over a few) */
    splashCraterDepth: number;
    splashCraterRadius: number;
    splashCraterSeconds: number;
    /**
     * the swell a big impact pushes out: height at the impact, speed (slow, thick fluid), width of its crest, and the
     * distance over which it loses most of its height
     */
    splashSwellHeight: number;
    splashSwellSpeed: number;
    splashSwellWidth: number;
    splashSwellFade: number;
    /** vertex spacing of the mesh the splash waves displace between the impact and the camera (finer: smoother, costlier) */
    splashMeshSpacing: number;
    /**
     * the surface seen from below: how clearly the world above shows through its window, how bright the mirror of the
     * depths around it is, and how strongly its ripples bend the window's edge
     */
    undersideClarity: number;
    undersideMirror: number;
    /** how thick the water looks from inside it (clearer than from above, where it hides the depths quickly) */
    underwaterViewDensity: number;
    /**
     * sunlight lost per metre of depth (what's deeper is darker, and so is the water), and the colour it tends towards as
     * it goes down: whichever colours the fluid lets through best (for Earth's water, blue)
     */
    depthDarkening: number;
    depthColor: string;
    /** the rolling waves of the surface seen from under the water: their height and speed */
    surfaceWaveHeight: number;
    surfaceWaveSpeed: number;
    undersideRipple: number;
    /** how much the waves and ripples bend the view out through the window (1: as they tilt the surface) */
    undersideRefraction: number;
    /** how far the impact's light spreads over the water */
    splashGlowRadius: number;
    /** the flash's fainter light reaching far across the water (falling off like a light does), where the pillars' long shadows show */
    splashWaterReach: number;
    /** the flash's highlight on the water by its tilt (raised lips around the pillars, ripples): brightness, and sharpness (higher: thinner glints) */
    splashHighlight: number;
    splashShininess: number;
    /** how much the flash's light on the water follows its tilt: slopes facing it (rings, ripples, lips) brighter, facing away darker */
    splashRelief: number;
    /** how much darker the rest of the water gets at the flash's peak, next to its brightness */
    splashWaterDarken: number;
    /** how much the flash's shadows darken the water's reflections as well (fake, but they'd vanish on the shiny far water otherwise) */
    splashShadowOnReflection: number;
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
    meniscusHeight: 0.005,
    meniscusWidth: 0.025,
    meniscusLag: 12,
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
    splashRippleHeight: 0.05,
    splashRippleSpeed: 1.5,
    splashWavelength: 0.35,
    splashRippleSeconds: 6,
    splashCraterDepth: 0.35,
    splashCraterRadius: 0.8,
    splashCraterSeconds: 1.4,
    splashSwellHeight: 0.3,
    splashSwellSpeed: 1.6,
    splashSwellWidth: 0.45,
    splashSwellFade: 11.25,
    splashMeshSpacing: 0.1,
    undersideClarity: 0.85,
    underwaterViewDensity: 0.4,
    depthDarkening: 0.18,
    depthColor: '#4a4630',
    surfaceWaveHeight: 0.06,
    surfaceWaveSpeed: 1,
    undersideMirror: 0.6,
    undersideRipple: 1.5,
    undersideRefraction: 0.35,
    splashGlowRadius: 3.5,
    splashWaterReach: 0.5,
    splashHighlight: 4,
    splashShininess: 80,
    splashRelief: 0.85,
    splashWaterDarken: 0.5,
    splashShadowOnReflection: 0.8,
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
    /** the seabed's columns lean like the pillars, varying by this share of the pillars' variation */
    seabedVariation: number;
    /** how deep the seabed's columns lie in the middle of the channel (seen from under the water) */
    seabedDepthBelow: number;
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
    seabedVariation: 0.9,
    seabedDepthBelow: 5.5,
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
    /** how far the particles turn the colour of a meteor's flash while it's on (faked, not lit by it) */
    flashTint: number;
    /** how far each set's far-away dots (a fixed-colour texture) are turned towards white */
    dotWhiten1: number;
    dotWhiten2: number;
    /** once on the water: how long particles float, then how fast they sink and over what depth they fade */
    floatSeconds: number;
    sinkSpeed: number;
    sinkDepth: number;
    /** how quickly a sinking particle disappears into the water's colour, per metre it's gone under */
    sinkMurk: number;
    /** the orange flakes are embers: how long they take to cool to black once they land in the fluid */
    emberCoolSeconds: number;
    /** the puff of steam off each landing ember: how long it lasts, its size, how high it rises, how opaque it is */
    steamSeconds: number;
    steamSize: number;
    steamRise: number;
    steamOpacity: number;
    steamColor: string;
    /**
     * a meteor impact's blast: how far it shoves particles (metres, at the impact), over what distance that fades, how
     * fast it rolls out, how long they take to come to rest in their new place, and how much it sets flakes spinning
     */
    blastStrength: number;
    blastReach: number;
    blastSpeed: number;
    blastSettleSeconds: number;
    blastSpin: number;
    /**
     * the air blast's gust, reaching the whole area around the camera well before the fluid's swell: how far it shoves
     * particles, the distance over which it halves, how fast it travels, how long they take to come to rest in their new
     * place, and the spin it gives
     */
    gustStrength: number;
    gustReach: number;
    gustSpeed: number;
    gustSettleSeconds: number;
    gustSpin: number;
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
    count: 1000,
    boxSize: 9,
    fallSpeed: 0.04,
    sway: 0.0,
    dotSize: 0.012,
    flakeSize: 0.03,
    flakeNear: 1.2,
    flakeBand: 2.1,
    flakeSpin: 0.35,
    flakeGlow: 0,
    flashTint: 0.85,
    dotWhiten1: 0.7,
    dotWhiten2: 0,
    floatSeconds: 12,
    sinkSpeed: 0.01,
    sinkDepth: 0.25,
    sinkMurk: 20,
    emberCoolSeconds: 1.5,
    steamSeconds: 1.2,
    steamSize: 0.16,
    steamRise: 0.2,
    steamOpacity: 0.05,
    steamColor: '#dfe6e4',
    blastStrength: 0.8,
    blastReach: 4,
    blastSpeed: 15,
    blastSettleSeconds: 0.4,
    blastSpin: 6,
    gustStrength: 2.0,
    gustReach: 34.5,
    gustSpeed: 229,
    gustSettleSeconds: 0.5,
    gustSpin: 5,
    pillarMargin: 0.02,
    dimpleSize: 2.1,
    dimpleDarkness: 0.12,
    dimpleRim: 0,
    dimpleRimColor: '#a1c4bf',
    flakeColor1: '#699694',
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
// pressing on the water with the cursor (environment/water-touch.ts)
export interface WaterTouchSettings {
    enabled: boolean;
    /** size of the dent, how deep it goes, and how high its lip rises (as a share of the depth) */
    radius: number;
    depth: number;
    lip: number;
    /** how quickly it presses in, and how slowly the dent and the trail behind it refill */
    pressSeconds: number;
    refillSeconds: number;
    /** how far apart the points along a dragged trail are */
    trailSpacing: number;
    /** the small ring sent out when pressing down */
    ringHeight: number;
    /** floating particles pushed aside by the dents: how far around them, and how strongly (share of that distance, up to about 1) */
    particlePushRadius: number;
    particlePush: number;
}

export const WATER_TOUCH: WaterTouchSettings = {
    enabled: true,
    radius: 0.12,
    depth: 0.05,
    lip: 0.35,
    pressSeconds: 0.15,
    refillSeconds: 3,
    trailSpacing: 0.08,
    ringHeight: 0.012,
    particlePushRadius: 0.3,
    particlePush: 0.9,
};

// stars on the night sky (environment/stars.ts)
export interface StarSettings {
    brightness: number;
    /** grid cells per unit of direction (finer: smaller gaps between stars), and the share of cells with a star */
    density: number;
    share: number;
    /** size of each star, in pixels */
    size: number;
    /** how much they flicker, and how fast */
    twinkle: number;
    twinkleSpeed: number;
    /** a tilted band where they're denser (how much denser, and its faint glow), and where it runs across the sky */
    band: number;
    bandGlow: number;
    bandTiltDeg: number;
    bandTurnDeg: number;
    /** how far their colours vary, from bluish to warm */
    tint: number;
    /** how high above the horizon they've fully come through the haze (sine of the angle) */
    horizon: number;
    /** where the sky turns around (elevation above the horizon, direction), and how many turns it makes per day */
    poleElevationDeg: number;
    poleAzimuthDeg: number;
    turnsPerDay: number;
}

export const STARS: StarSettings = {
    brightness: 0.5,
    density: 76,
    share: 0.03,
    size: 1.1,
    twinkle: 0.9,
    twinkleSpeed: 1.0,
    band: 1.2,
    bandGlow: 0.035,
    bandTiltDeg: 35,
    bandTurnDeg: 20,
    tint: 0.6,
    horizon: 0.15,
    // behind the home view, just above the volcano; the black hole sits on it, the stars turning around it
    poleElevationDeg: 25,
    poleAzimuthDeg: 165,
    turnsPerDay: 1,
};

// the camera as a sensor, overexposed by a meteor's flash (postprocessing/sensor.ts)
export interface SensorSettings {
    enabled: boolean;
    /** how far the flash overexposes it, and how much of the overloaded brightness goes flat white */
    overexposure: number;
    clip: number;
    /** the vertical smear through the flash (strength, and width as a share of the screen), and the colour offset */
    smear: number;
    smearWidth: number;
    chroma: number;
    /** how quickly its auto-exposure catches up, how far it overshoots into too dark, and the grain while it recovers */
    adaptSeconds: number;
    undershoot: number;
    grainBoost: number;
}

export const SENSOR: SensorSettings = {
    enabled: true,
    overexposure: 10,
    clip: 0.6,
    smear: 0.8,
    smearWidth: 0.004,
    chroma: 0.004,
    adaptSeconds: 0.35,
    undershoot: 0.82,
    grainBoost: 1.0,
};

// shafts of sunlight in the water, seen from under it (postprocessing/god-rays.ts)
export interface GodRaySettings {
    enabled: boolean;
    strength: number;
    /** how big the bright patches the surface lets through are (higher: smaller, more shafts), and how sharply defined */
    shaftScale: number;
    sharpness: number;
    /** how quickly they fade with depth, how far along the view they're gathered, and how fast they shift */
    depthFade: number;
    maxDistance: number;
    speed: number;
    /** whether the second sun casts its own shafts too (costs about twice as much), and how brightly they light what they hit */
    bothSuns: boolean;
    onSurfaces: number;
    /** how high a sun has to be before its light makes shafts (lower, it glances off the surface and the walls block it) */
    minElevationDeg: number;
    /** how much the canyon's walls block the light: 1 as their pillars stand, 0 not at all */
    wallBlocking: number;
    /**
     * the sun glittering on the surface seen from below, where its light comes in (and the shafts start): brightness, and
     * how far around the sun's place in the window the glints reach
     */
    glitter: number;
    glitterSpreadDeg: number;
    /** how much more the ripples tilt the glints than they bend the view through the window (more: livelier glitter) */
    glitterRipple: number;
    /** how much finer the ripples that glint are than the ones that bend the view through the window */
    glitterScale: number;
    /**
     * looking towards a sun under the water, along its shafts: the water scatters light mostly onward, so the shafts get
     * brighter (times 1 + forwardShafts) and a haze glows around the sun (forwardHaze), within about forwardSpreadDeg
     */
    forwardShafts: number;
    forwardHaze: number;
    forwardSpreadDeg: number;
    /** for tuning: the pillars picked to shadow the underwater light (those in the channel around the camera), highlighted */
    showShadowCasters: boolean;
}

export const GOD_RAYS: GodRaySettings = {
    enabled: true,
    strength: 0.35,
    shaftScale: 0.9,
    sharpness: 2.5,
    depthFade: 0.3,
    maxDistance: 9,
    speed: 1,
    bothSuns: true,
    onSurfaces: 0.8,
    minElevationDeg: 15,
    wallBlocking: 1,
    glitter: 6,
    glitterSpreadDeg: 3,
    glitterRipple: 3,
    glitterScale: 16,
    forwardShafts: 5,
    forwardHaze: 0.8,
    forwardSpreadDeg: 20,
    showShadowCasters: false,
};

// the world above the water seen from under it, through the surface (environment/snell-window.ts)
export interface SnellWindowSettings {
    enabled: boolean;
    /** of each face of the cube the world above is captured into (the murk softens it anyway) */
    resolution: number;
    /** how many of the cube's five faces are captured again each frame, in turn (all of them when the window first shows) */
    facesPerFrame: number;
}

export const SNELL_WINDOW: SnellWindowSettings = {
    enabled: true,
    resolution: 512,
    facesPerFrame: 1,
};

// the text panels' backing: a bank of the scene's haze behind them (postprocessing/panel-haze.ts)
export interface PanelHazeSettings {
    enabled: boolean;
    /** how much of the scene behind drowns in it, and its brightness (times the fog's colour: below 1 is darker) */
    density: number;
    brightness: number;
    /** how far the scene behind it is blurred (10: about 22 screen pixels either way) */
    blurPx: number;
    /** how far past the panel's box it thins out, and how ragged that edge is */
    edgePx: number;
    fray: number;
    /** where its colour comes from: 0 the far fog's, 1 the scene's own big colours around the panel, as slow blobs */
    fromScene: number;
    /** how fast those blobs flow */
    drift: number;
}

export const PANEL_HAZE: PanelHazeSettings = {
    enabled: true,
    density: 0.55,
    brightness: 0.88,
    blurPx: 10.5,
    edgePx: 220,
    fray: 0.87,
    fromScene: 1,
    drift: 0.03,
};

// light spilling around whatever is brighter than white (the suns, glints, the meteor's flash), like in a lens
// (UnrealBloomPass, main.ts)
export interface BloomSettings {
    enabled: boolean;
    /** how much spills, and how far (0 to 1) */
    strength: number;
    radius: number;
    /** how bright something has to be (before tone mapping) to spill */
    threshold: number;
    /** over how much brightness above that the spill fades in (small: a hard cut, which rings smooth glows) */
    knee: number;
}

export const BLOOM: BloomSettings = {
    enabled: true,
    strength: 0.1,
    radius: 0.5,
    threshold: 1,
    knee: 1,
};

// at night, a volcano past the canyon's walls: a red glow on one horizon, and its light on the pillars
// (environment/volcanic-glow.ts)
export interface VolcanicGlowSettings {
    color: string;
    /** which way it lies (0 down the channel, 90 is +x), how wide its glow is along the horizon, and how high it reaches */
    azimuthDeg: number;
    widthDeg: number;
    height: number;
    /** how bright the glow in the sky is, and the light it throws on the pillars (and how low that comes in) */
    skyStrength: number;
    lightStrength: number;
    lightElevationDeg: number;
    /** how much it flickers */
    flicker: number;
    /** how much of its light the murky fluid scatters back (a dull red on the ripples facing it) */
    waterScatter: number;
    /** how strongly the fog towards it takes on its glow */
    fogStrength: number;
}

export const VOLCANIC_GLOW: VolcanicGlowSettings = {
    color: '#ff4a1c',
    azimuthDeg: 160,
    widthDeg: 40,
    height: 0.1,
    skyStrength: 0.18,
    lightStrength: 4.5,
    lightElevationDeg: 14,
    flicker: 0.25,
    waterScatter: 0.04,
    fogStrength: 0.09,
};

// streaks of sunlight between the walls' tops, above the water (postprocessing/sun-shafts.ts)
export interface SunShaftSettings {
    enabled: boolean;
    strength: number;
    /** how far around a sun the open sky feeds the streaks (share of the screen's height) */
    glowRadius: number;
    /** how far the streaks reach out from the sun (share of the way to the sun), and how quickly they fade along it */
    reach: number;
    decay: number;
}

export const SUN_SHAFTS: SunShaftSettings = {
    enabled: true,
    strength: 0.9,
    glowRadius: 0.12,
    reach: 0.85,
    decay: 0.975,
};

// passing through the water's surface (postprocessing/surface-crossing.ts)
export interface SurfaceCrossingSettings {
    enabled: boolean;
    /** how close to the surface the camera has to be for it to show, and how long it lasts after crossing */
    band: number;
    seconds: number;
    /** how much the frame smears and ripples at its strongest */
    blur: number;
    wobble: number;
}

export const SURFACE_CROSSING: SurfaceCrossingSettings = {
    enabled: true,
    band: 0.12,
    seconds: 0.5,
    blur: 0.012,
    wobble: 0.005,
};
