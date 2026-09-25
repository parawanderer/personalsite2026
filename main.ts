
import {
    Box2,
    DepthTexture,
    Clock,
    Color,
    FogExp2,
    PerspectiveCamera,
    Scene,
    SRGBColorSpace,
    Vector2,
    WebGLRenderer,
    CineonToneMapping
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
    CAMERA_INITIAL_Z,
    ROW_LENGTH_Z,
    WATER_TEXTURE,
    CAMERA_INITIAL_X,
    CAMERA_INITIAL_Y,
    FOG_COLOR,
    FOG_INTENSITY,
    TEXTURE_PARTICLE_CYAN,
    TEXTURE_PARTICLE_RED,
    CUBE_LIGHT_COLOR,
    DEBUG,
    CAMERA_ABOUT_ME_POS,
    CAMERA_ABOUT_ME_DIR,
    CAMERA_CONTACT_POS,
    CAMERA_CONTACT_DIR,
    CAMERA_HOME_POS,
    CAMERA_HOME_DIR,
    TWEAKS_ENABLED,
    PILLAR_LAYOUT,
    PILLAR_SHAPE,
    GRAIN_STYLE,
    FLIGHT_SETTINGS,
    WATER_LOOK,
    DISTANCE_BLUR,
    PARTICLES,
    DAY_NIGHT,
    PILLARS_FOG_NEAR_COLOR,
    PILLARS_FOG_FAR_COLOR,
    BACKGROUND_COLOR,
    SUN_LARGE,
    SUN_SMALL,
    SUN_THROUGH_FOG,
    AURORA,
    SHOOTING_STARS
} from './constants';
import { ScreenZone, WallsFactory } from './environment/walls';
import { getByIdOrThrow } from './utils/document';
import { GenericObjectFactory } from './environment/factory';
import { InteractionManager } from './interact';
import { WaterFactory } from './environment/water';
import { DustFactory } from './environment/dust-particles';
import { ParticleField } from './environment/particle-field';
import { DayNight } from './environment/day-night';
import { Celestial } from './environment/celestial';
import { Aurora } from './environment/aurora';
import { ShootingStars } from './environment/shooting-stars';
import { skyGlowUniforms } from './shaders/sky-glow.glsl';
import { TextureLoader } from './utils/texture-utils';
import { Scheduler } from './entity/animated-entity';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass';
import { DebugInfoDisplay } from './ui/debug-info';
import { ForegroundManager } from './ui/foreground-manager';
import { moveCameraTo } from './animate/camera';
import { FilmPass } from './postprocessing/filmpass';
import { DistanceBlurPass } from './postprocessing/distance-blur';
import { LoadingManager } from './ui/loading-manager';
import { Tweaks } from './ui/tweaks';
import { Grain } from './ui/grain';
import { CameraTweaks } from './ui/camera-tweaks';

(async () => { // <- stupid hack to allow using "await" in this body

let width = window.innerWidth;
let height = window.innerHeight;

// clock: drives all scene animation and can be paused from the tweak panel; flying uses its own clock so the camera
// still moves while time stands still
const clock = new Clock(false);
clock.start();
const flightClock = new Clock();

// hand-tweaking panel (?tweaks)
const tweaks = new Tweaks(TWEAKS_ENABLED);
const timeTweaks = tweaks.addFolder('Time', { paused: false });
timeTweaks.params.paused = false; // never start paused after a reload
timeTweaks.folder?.add(timeTweaks.params, 'paused').name('pause time').onChange((paused: boolean) => {
    if (paused) {
        clock.stop();
    } else {
        // resume from where it stopped instead of jumping ahead by the paused time
        const elapsed = clock.elapsedTime;
        clock.start();
        clock.elapsedTime = elapsed;
    }
});

// scene
const scene: Scene = new Scene();
scene.background = new Color(FOG_COLOR);
scene.fog = new FogExp2(FOG_COLOR, FOG_INTENSITY);

// asset loading crap
const loadingMgr = new LoadingManager();

// camera
const camera = new PerspectiveCamera(75, width / height, 0.1, 1000);
camera.position.copy(CAMERA_HOME_POS);
camera.lookAt(CAMERA_HOME_DIR);


// renderer
const renderer = new WebGLRenderer();
renderer.setSize(width, height);
renderer.toneMapping = CineonToneMapping;
renderer.toneMappingExposure = 0.8;
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = SRGBColorSpace;
document.body.appendChild(renderer.domElement);


// controls
const flightTweaks = tweaks.addFolder('Flight', FLIGHT_SETTINGS);
const interactionMgr = new InteractionManager(camera, renderer.domElement, flightTweaks.params);
if (flightTweaks.folder) interactionMgr.bindTweaks(flightTweaks.folder);

const scheduler = new Scheduler();
const factory = new GenericObjectFactory(loadingMgr, scene);
const dustFactory = new DustFactory(loadingMgr, scene, camera);

// background pane: removed for now, its transmission can't see the (transparent) water. To be replaced by a custom pane
// cube light
const cubeLight = factory.makeObjectLight(0, 0, 0, 20, CUBE_LIGHT_COLOR);

// background light
const ambientLight = factory.makeAmbientLight();

// skySpot (directional)
const skySpot = factory.makeSkySpotLight();

// light sources
const skyDiffuseLight1 = factory.makeSkyDiffuseLight(0, 10, -8, 400);
const skyDiffuseLight2 = factory.makeSkyDiffuseLight(0, 8, 0, 800);


// skybox
const sky = factory.makeSkybox();

// water
const waterTweaks = tweaks.addFolder('Water', WATER_LOOK);
const water = new WaterFactory(loadingMgr, scene).makeWater(WATER_TEXTURE, -ROW_LENGTH_Z/2, waterTweaks.params, camera);
if (waterTweaks.folder) water.bindTweaks(waterTweaks.folder);
scheduler.add(water);

// particles
const particleTweaks = tweaks.addFolder('Particles', PARTICLES);
const textures = new TextureLoader(loadingMgr);
const particles = new ParticleField(scene, camera, particleTweaks.params, [
    { texture: textures.getTexture(TEXTURE_PARTICLE_CYAN), colorKey: 'flakeColor1', share: 3 / 7, seed: 11 },
    { texture: textures.getTexture(TEXTURE_PARTICLE_RED), colorKey: 'flakeColor2', share: 4 / 7, seed: 23 },
], water.flowVelocity, water.lip);
if (particleTweaks.folder) particles.bindTweaks(particleTweaks.folder);
scheduler.add(particles);

// the swirl of particles in the middle of the scene belonged to the glass pane, off until the pane has a new place
// const rotatingParticles1 = dustFactory.makeRotatingDust(TEXTURE_PARTICLE_CYAN, ROTATING_DUST_CENTER.clone(), 0.5, DUST_AMOUNT_CYAN, DUST_SIZE_CYAN);
// scheduler.add(rotatingParticles1);
// const rotatingParticles2 = dustFactory.makeRotatingDust(TEXTURE_PARTICLE_RED, ROTATING_DUST_CENTER.clone(), 0.5, DUST_AMOUNT_RED, DUST_SIZE_RED);
// scheduler.add(rotatingParticles2);

// walls
const pillarTweaks = tweaks.addFolder('Pillars', PILLAR_LAYOUT);
// where the title sits on screen, seen from the home view, so the pillars behind it can be kept solid
const getTitleZone = (): ScreenZone => {
    const homeCamera = new PerspectiveCamera(camera.fov, width / height, camera.near, camera.far);
    homeCamera.position.copy(CAMERA_HOME_POS);
    homeCamera.lookAt(CAMERA_HOME_DIR);
    homeCamera.updateMatrixWorld();

    const r = getByIdOrThrow('logo').getBoundingClientRect();
    const ndc = new Box2(
        new Vector2(r.left / width * 2 - 1, 1 - r.bottom / height * 2),
        new Vector2(r.right / width * 2 - 1, 1 - r.top / height * 2)
    );
    return { camera: homeCamera, ndc };
};
const pillarShapeTweaks = tweaks.addFolder('Pillar surface', PILLAR_SHAPE);
const walls = await new WallsFactory(loadingMgr, scene).makeWalls(CAMERA_INITIAL_Z, pillarTweaks.params, pillarShapeTweaks.params, getTitleZone());
if (pillarTweaks.folder) walls.bindTweaks(pillarTweaks.folder);
if (pillarShapeTweaks.folder) walls.bindShapeTweaks(pillarShapeTweaks.folder);
water.addUnderwaterTo(walls.material);
water.setPillarField(walls.pillarField);
particles.setPillarField(walls.pillarField);
// pillars reach a little past the seabed
water.setSeabedListener((depth) => {
    pillarTweaks.params.depthBelowWater = depth + 0.2;
    walls.rebuild();
});
scheduler.add(walls);

// day/night: blends everything above from its own (day) values to the night palette by the time of day; last in the
// schedule so it applies after the others have set their day values
const dayNightTweaks = tweaks.addFolder('Day / night', DAY_NIGHT);
const dayNight = new DayNight(dayNightTweaks.params);
if (dayNightTweaks.folder) dayNight.bindTweaks(dayNightTweaks.folder);
{
    const light = (l: { color: Color, intensity: number }) => ({ color: l.color.clone(), intensity: l.intensity });
    const hemi = { ...light(ambientLight), ground: ambientLight.groundColor.clone() };
    const spot = light(skySpot);
    const diffuse = [light(skyDiffuseLight1), light(skyDiffuseLight2)];
    const exposure = renderer.toneMappingExposure;
    const w = waterTweaks.params;

    dayNight
        .color(sky.material.color, () => BACKGROUND_COLOR, 'nightSky')
        .color(walls.fogUniforms.fogNearColor.value, () => PILLARS_FOG_NEAR_COLOR, 'nightFogNear')
        .color(walls.fogUniforms.fogFarColor.value, () => PILLARS_FOG_FAR_COLOR, 'nightFogFar')
        .color(water.fogUniforms.fogNearColor.value, () => PILLARS_FOG_NEAR_COLOR, 'nightFogNear')
        .color(water.fogUniforms.fogFarColor.value, () => PILLARS_FOG_FAR_COLOR, 'nightFogFar')
        .color((scene.fog as FogExp2).color, () => FOG_COLOR, 'nightSceneFog')
        .color(scene.background as Color, () => FOG_COLOR, 'nightSceneFog')
        .color(ambientLight.color, () => hemi.color, 'nightAmbientSky')
        .color(ambientLight.groundColor, () => hemi.ground, 'nightAmbientGround')
        .color(skySpot.color, () => spot.color, 'nightSpotColor')
        .color(skyDiffuseLight1.color, () => diffuse[0].color, 'nightDiffuseColor')
        .color(skyDiffuseLight2.color, () => diffuse[1].color, 'nightDiffuseColor')
        .color(water.underwater.underwaterColor.value, () => w.underwaterColor, 'nightUnderwaterColor')
        .color(water.underwater.causticColor.value, () => w.causticColor, 'nightCausticColor')
        .number((v) => water.underwater.causticStrength.value = v, () => w.causticStrength, 'nightCausticStrength')
        .number((v) => particles.setGlow(v), () => particleTweaks.params.flakeGlow, 'nightFlakeGlow')
        .number((v) => particles.setShown('flakeColor2', v), () => 1, 'nightOrangeParticles')
        .number((v) => water.setRimNight(v), () => 1, 'nightRimScale')
        .number((v) => water.setReflectionFloor(v), () => 0.1, 'nightReflectionFloor')
        .number((v) => water.surface.surfaceOpacity.value = v, () => w.surfaceOpacity, 'nightSurfaceOpacity')
        .number((v) => water.surface.fresnelPower.value = v, () => w.fresnelPower, 'nightFresnelPower')
        .number((v) => water.surface.reflectionStrength.value = v, () => 1, 'nightReflectionStrength')
        // the night values of these are scales of the day ones
        .number((v) => ambientLight.intensity = hemi.intensity * v, () => 1, 'nightAmbientScale')
        .number((v) => skySpot.intensity = spot.intensity * v, () => 1, 'nightSpotScale')
        .number((v) => { skyDiffuseLight1.intensity = diffuse[0].intensity * v; skyDiffuseLight2.intensity = diffuse[1].intensity * v; }, () => 1, 'nightDiffuseScale')
        .number((v) => renderer.toneMappingExposure = exposure * v, () => 1, 'nightExposureScale');
}
scheduler.add(dayNight);

// aurora on the night sky
const auroraTweaks = tweaks.addFolder('Aurora', AURORA);
const aurora = new Aurora(scene, sky.material, auroraTweaks.params);
if (auroraTweaks.folder) aurora.bindTweaks(auroraTweaks.folder);
dayNight.number((v) => aurora.setNight(v), () => 0, 'nightAurora');
scheduler.add(aurora);

// shooting stars at night, now and then one coming down into the channel
const starTweaks = tweaks.addFolder('Shooting stars', SHOOTING_STARS);
const shootingStars = new ShootingStars(scene, starTweaks.params, water);
if (starTweaks.folder) shootingStars.bindTweaks(starTweaks.folder, () => clock.elapsedTime);
dayNight.number((v) => shootingStars.setNight(v), () => 0, 'nightAurora');
scheduler.add(shootingStars);

// two suns/moons, following the time of day
const fogGlowTweaks = tweaks.addFolder('Suns through fog', { fogStart: SUN_THROUGH_FOG });
skyGlowUniforms.glowFogStart.value = fogGlowTweaks.params.fogStart;
fogGlowTweaks.folder?.add(fogGlowTweaks.params, 'fogStart', 0, 1, 0.01).onChange((v: number) => skyGlowUniforms.glowFogStart.value = v);
([['Sun (large)', SUN_LARGE], ['Sun (small)', SUN_SMALL]] as const).forEach(([name, body], index) => {
    const sunTweaks = tweaks.addFolder(name, body);
    const sun = new Celestial(scene, camera, sunTweaks.params, () => dayNightTweaks.params.hour, index);
    if (sunTweaks.folder) sun.bindTweaks(sunTweaks.folder);
    scheduler.add(sun);
});


// debug-related UI elements
const debugInfoUI = new DebugInfoDisplay(DEBUG, camera);


// effects
const composer = new EffectComposer(renderer);
// the distance blur reads the scene's depth, which the render pass leaves in the composer's targets
composer.renderTarget1.depthTexture = new DepthTexture(width, height);
composer.renderTarget2.depthTexture = new DepthTexture(width, height);
composer.addPass(new RenderPass(scene, camera));
const blurTweaks = tweaks.addFolder('Distance blur', DISTANCE_BLUR);
const distanceBlur = new DistanceBlurPass(camera, blurTweaks.params);
if (blurTweaks.folder) distanceBlur.bindTweaks(blurTweaks.folder);
composer.addPass(distanceBlur);
composer.addPass(new FilmPass(clock, 0.4));
//composer.addPass(new SMAAPass()); // <- (doesn't look good)
const fxaaPass = new ShaderPass(FXAAShader); // <- surprisingly it looks better
fxaaPass.uniforms['resolution'].value.set(1 / width, 1 / height);
composer.addPass(fxaaPass);
composer.addPass(new OutputPass());


const onWindowResize = () => {
    width = window.innerWidth;
    height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
    composer.setSize(width, height);

    fxaaPass.uniforms['resolution'].value.set(1 / width, 1 / height);

    // the title moves relative to the scene when the window changes shape
    window.clearTimeout(titleZoneTimer);
    titleZoneTimer = window.setTimeout(() => walls.setTitleZone(getTitleZone()), 300);
}
let titleZoneTimer: number | undefined;
window.addEventListener('resize', onWindowResize);


const animate = () => {
    // render loop
    clock.getDelta(); // advances the scene clock unless paused

    interactionMgr.update(flightClock.getDelta());

    debugInfoUI.update();
    scheduler.doUpdates(clock);

    composer.render();
}
renderer.setAnimationLoop(animate);


const fgMngr = new ForegroundManager(interactionMgr);
fgMngr.init();

const grainTweaks = tweaks.addFolder('UI grain', GRAIN_STYLE);
const grain = new Grain(grainTweaks.params);
if (grainTweaks.folder) grain.bindTweaks(grainTweaks.folder);

// some positions that look nice
const goHome = () => moveCameraTo(camera, CAMERA_HOME_POS.clone(), CAMERA_HOME_DIR.clone());

// the distance blur focuses the view while a text panel is open, the home view and free flight show everything sharp
let panelOpen = false;
let freeFlight = false;
const updateBlur = () => distanceBlur.fadeTo(panelOpen && !freeFlight ? 1 : 0);

fgMngr.setHomeCallback(() => {
    goHome();
    panelOpen = false;
    updateBlur();
});
fgMngr.setAboutMeCallback(() => {
    moveCameraTo(camera, CAMERA_ABOUT_ME_POS.clone(), CAMERA_ABOUT_ME_DIR.clone());
    panelOpen = true;
    updateBlur();
});
fgMngr.setContactCallback(() => {
    moveCameraTo(camera, CAMERA_CONTACT_POS.clone(), CAMERA_CONTACT_DIR.clone());
    panelOpen = true;
    updateBlur();
});
fgMngr.setFreeFlightCallback((isFreeFlight) => {
    freeFlight = isFreeFlight;
    updateBlur();
});

const cameraTweaks = tweaks.addFolder('Camera', {});
if (cameraTweaks.folder) new CameraTweaks(camera, goHome).bind(cameraTweaks.folder);


})();