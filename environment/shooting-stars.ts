import { AdditiveBlending, BoxGeometry, IUniform, MeshBasicMaterial, BufferAttribute, BufferGeometry, CanvasTexture, Clock, Color, DoubleSide, Mesh, PlaneGeometry, PointLight, Points, PointsMaterial, Scene, ShaderMaterial, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { ShootingStarSettings } from '../constants';
import { SplashMist } from './splash-mist';
import { Water, WATER_LEVEL_Y } from './water';

// the far end of the channel, where splashdowns land (x across the channel, z along it)
const SPLASH_X = [-2, 1];
const SPLASH_Z = [-14, -6];
// how long a meteor takes to burn out in the sky once it's done
const BURNOUT_SECONDS = 0.35;
// the splash: droplets thrown up at impact, how long they last, gravity on them
const DROPLETS = 140;
const SPLASH_SECONDS = 1.1;
const GRAVITY = 4;

/** a soft round dot for the droplets */
const dotTexture = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 32, 32);
    return new CanvasTexture(c);
};

const streakMaterial = () => new ShaderMaterial({
    uniforms: {
        head: { value: new Vector3() },
        tail: { value: new Vector3() },
        width: { value: 0.1 },
        color: { value: new Color() },
        intensity: { value: 0 },
        time: { value: 0 },
        // 0 while the meteor flies, rising to 1 as its train lingers and breaks up
        sparkle: { value: 0 },
        // nothing shows below the water line, so a splashdown's train always ends at the surface
        waterLevel: { value: WATER_LEVEL_Y },
    },
    vertexShader: /* glsl */ `
        uniform vec3 head;
        uniform vec3 tail;
        uniform float width;
        uniform float sparkle;
        varying vec2 vStreak;
        varying float vWorldY;
        void main() {
            // x runs from the tail (-0.5) to the head (0.5), y across the streak, which always faces the camera
            float along = position.x + 0.5;
            vec3 p = mix(tail, head, along);
            vec3 side = normalize(cross(head - tail, cameraPosition - p));
            // the lingering train spreads out as it fades, like smoke
            p += side * position.y * width * mix(0.3, 1.0, along) * (1.0 + sparkle * 1.5);
            vStreak = vec2(along, position.y * 2.0);
            vWorldY = p.y;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float intensity;
        uniform float time;
        uniform float sparkle;
        uniform float waterLevel;
        varying vec2 vStreak;
        varying float vWorldY;
        void main() {
            // a soft core that gets softer as the train spreads
            float core = 1.0 - smoothstep(0.0, mix(1.0, 1.6, sparkle), abs(vStreak.y));
            core *= core;
            // bright at the head while flying; the lingering train glows along its length instead
            float along = mix(pow(vStreak.x, 3.0), 0.35 + 0.65 * vStreak.x, sparkle);
            // the train fades unevenly: smooth, slowly drifting brightness along it, not segments
            float x = vStreak.x * 9.0 + time * 0.6;
            float i0 = floor(x);
            float f = fract(x);
            f = f * f * (3.0 - 2.0 * f);
            float h0 = fract(sin(i0 * 91.3) * 43758.5453);
            float h1 = fract(sin((i0 + 1.0) * 91.3) * 43758.5453);
            float unevenness = mix(1.0, 0.35 + 1.1 * mix(h0, h1, f), sparkle);
            // a few tiny points twinkling near where it burned out
            float cell = floor(vStreak.x * 140.0);
            float spark = step(0.93, fract(sin(cell * 12.9898 + floor(time * 10.0) * 78.233) * 43758.5453));
            float sparks = spark * smoothstep(0.55, 1.0, vStreak.x) * (1.0 - smoothstep(0.0, 0.35, abs(vStreak.y))) * sparkle * 1.5;
            // cut off at the surface, softly enough to hide the ripples moving it
            float aboveWater = smoothstep(waterLevel - 0.03, waterLevel + 0.03, vWorldY);
            gl_FragColor = vec4(color * (along * core * unevenness + sparks) * intensity * aboveWater, 1.0);
        }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
    // the shape is built in the shader, which can leave its triangles facing away from the camera
    side: DoubleSide,
});

interface Meteor {
    start: Vector3;
    direction: Vector3;
    speed: number;
    duration: number;
    startTime: number;
    splash: boolean;
}

/**
 * Now and then at night, a meteor streaks across the sky; sometimes one comes down into the far end of the channel and
 * lights up the water where it lands. Placed in the world (not around the camera), so the water reflects them properly.
 */
export class ShootingStars implements AnimatedEntity {
    private readonly streak: Mesh<PlaneGeometry, ShaderMaterial>;
    private readonly flash = new PointLight(0xffffff, 0, 30, 1.2);
    private readonly droplets: Points<BufferGeometry, PointsMaterial>;
    private readonly dropletVelocity = new Float32Array(DROPLETS * 3);
    private readonly impact = new Vector3();
    private lastSplashSince = 0;
    private readonly flashColor = new Color();
    /** the last meteor's streak, lingering and fading */
    private trainStart = -1e3;
    private trainIntensity = 0;
    /** whether the last meteor hit the water (lingering, sparking train) or burned out in the sky (clean fade) */
    private trainSplash = false;
    private readonly burnoutTail = new Vector3();
    private meteor?: Meteor;
    private nextAt = 0;
    private flashStart = -1;
    private nightAmount = 0;
    private hasCasters = false;
    private shadowsShown = false;
    /** told when the flash's shadows should start or stop showing, for the surfaces that receive them */
    public onShadows?: (shown: boolean) => void;
    /** told the flash's colour and brightness (0 to 1) every frame, for things that fake its light */
    public onFlash?: (color: Color, amount: number) => void;
    private readonly mist: SplashMist;
    private readonly casters: Mesh<BufferGeometry, MeshBasicMaterial>;

    /**
     * @param pixelScale pixels per world unit at distance 1, for sizing the plume's puffs
     */
    constructor(
        scene: Scene,
        private readonly settings: ShootingStarSettings,
        private readonly water: Water,
        private readonly pixelScale: () => number,
        fog: { fogNearColor: IUniform; fogFarColor: IUniform },
        /** the pillars that should cast the flash's shadows right now (null: none) */
        private readonly shadowCasters: (light: Vector3) => BufferGeometry | null,
    ) {
        this.streak = new Mesh(new PlaneGeometry(1, 1, 16, 1), streakMaterial());
        this.streak.frustumCulled = false;
        this.streak.visible = false;
        scene.add(this.streak);
        // the pillars throw long shadows away from the impact. Rendering them takes six passes, but neither the light nor
        // the pillars casting them move during a flash, so they're rendered once per splashdown, not every frame
        this.flash.shadow.camera.near = 0.1;
        this.flash.shadow.autoUpdate = false;
        scene.add(this.flash);
        // the pillars chosen to cast the flash's shadows: only drawn into its shadow map, nothing on screen
        this.casters = new Mesh(new BufferGeometry(), new MeshBasicMaterial({
            colorWrite: false,
            depthWrite: false,
            // for showShadowCasters: over the pillars themselves, without fighting them for depth
            color: 0xff00ff,
            opacity: 0.6,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -4,
            fog: false,
        }));
        this.casters.castShadow = true;
        this.casters.frustumCulled = false;
        this.casters.visible = false;
        scene.add(this.casters);

        const dropletGeometry = new BufferGeometry();
        dropletGeometry.setAttribute('position', new BufferAttribute(new Float32Array(DROPLETS * 3), 3));
        this.droplets = new Points(dropletGeometry, new PointsMaterial({
            map: dotTexture(),
            size: 0.08,
            transparent: true,
            blending: AdditiveBlending,
            depthWrite: false,
            fog: false,
        }));
        this.droplets.frustumCulled = false;
        this.droplets.visible = false;
        scene.add(this.droplets);

        this.mist = new SplashMist(settings, fog);
        scene.add(this.mist.points);
    }

    /**
     * Draws one frame (with `render`) with everything a splashdown shows: the shadow-casting pillars and the surfaces
     * receiving their shadows, the plume, the droplets and the streak, so their shaders are compiled now, behind the
     * loading screen, instead of stalling the first impact. The flash light and its shadows never switch off (that
     * would change the scene's light setup, and three.js would drop the compiled shaders and redo them all at the next
     * impact), so these stay compiled.
     */
    public warmUp(render: () => void): void {
        const flash = this.flash;
        flash.intensity = 0;
        flash.position.set(0, WATER_LEVEL_Y + 0.6, -10);
        flash.castShadow = true;
        flash.shadow.needsUpdate = true;
        this.casters.geometry.dispose();
        this.casters.geometry = this.shadowCasters(flash.position) ?? new BoxGeometry(0.1, 0.1, 0.1);
        this.casters.visible = true;
        this.mist.points.visible = true;
        this.droplets.visible = true;
        this.streak.visible = true;
        this.onShadows?.(true);
        this.water.warmUpSplash(true);

        render();

        this.water.warmUpSplash(false);
        this.onShadows?.(false);
        this.casters.visible = false;
        this.casters.geometry.dispose();
        this.casters.geometry = new BufferGeometry();
        this.hasCasters = false;
        this.mist.points.visible = false;
        this.droplets.visible = false;
        this.streak.visible = false;
    }

    public setNight(amount: number): void {
        this.nightAmount = amount;
    }

    private schedule(now: number): void {
        const s = this.settings;
        this.nextAt = now + s.minInterval + Math.random() * Math.max(s.maxInterval - s.minInterval, 0);
    }

    private launch(now: number): void {
        const s = this.settings;
        const splash = Math.random() < s.splashChance;
        let start: Vector3, direction: Vector3, speed: number, duration: number;

        if (splash) {
            // comes in steeply from high up, ending exactly on the water at the far end of the channel
            const impact = new Vector3(
                SPLASH_X[0] + Math.random() * (SPLASH_X[1] - SPLASH_X[0]),
                WATER_LEVEL_Y,
                SPLASH_Z[0] + Math.random() * (SPLASH_Z[1] - SPLASH_Z[0]),
            );
            const angle = Math.random() * Math.PI * 2;
            direction = new Vector3(Math.cos(angle) * 0.5, -1, Math.sin(angle) * 0.3).normalize();
            speed = s.speed * 0.6;
            duration = s.duration * 1.6;
            start = impact.clone().addScaledVector(direction, -speed * duration);
        } else {
            // across the sky ahead of the channel, low enough to show in the slice of sky between the walls, slanting down
            // (from the home view that's only a few degrees above the horizon, over the far end of the channel)
            start = new Vector3(-5 + Math.random() * 45, 11 + Math.random() * 8, -60 - Math.random() * 35);
            // mostly sideways with a shallow drop, so it crosses the low slice of sky instead of dropping straight out of it
            const angle = (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.6;
            direction = new Vector3(Math.cos(angle), -0.06 - Math.random() * 0.1, Math.sin(angle) * 0.3).normalize();
            speed = s.speed;
            duration = s.duration;
        }
        this.meteor = { start, direction, speed, duration, startTime: now, splash };
    }

    public update(clock: Clock): void {
        const s = this.settings;
        const now = clock.elapsedTime;
        const u = this.streak.material.uniforms;

        if (!this.meteor && this.nightAmount > 0.5 && now >= this.nextAt) {
            if (this.nextAt > 0) this.launch(now);
            this.schedule(now);
        }

        const m = this.meteor;
        u.time.value = now;
        if (m) {
            const t = now - m.startTime;
            if (t > m.duration) {
                // the streak stays where it ended and lingers as a fading, sparkling train
                this.trainStart = now;
                this.trainIntensity = u.intensity.value;
                this.trainSplash = m.splash;
                this.burnoutTail.copy(u.tail.value);
                if (m.splash) {
                    const impact = m.start.clone().addScaledVector(m.direction, m.speed * m.duration);
                    // the head goes on under the water, deep enough that its whole (spreading) end is below the surface
                    // and the train is cut by the water line, not by where the last frame happened to leave it
                    const under = (s.width * 2.5 + 0.2) / Math.max(Math.abs(m.direction.y), 0.3);
                    u.head.value.copy(impact).addScaledVector(m.direction, under);
                    u.tail.value.copy(impact).addScaledVector(m.direction, -s.length);
                    this.flash.position.set(impact.x, WATER_LEVEL_Y + 0.6, impact.z);
                    this.flashStart = now;
                    this.impact.set(impact.x, WATER_LEVEL_Y, impact.z);
                    this.throwDroplets();
                    const casters = this.shadowCasters(this.flash.position);
                    this.casters.geometry.dispose();
                    this.casters.geometry = casters ?? new BufferGeometry();
                    this.hasCasters = casters !== null;
                    this.flash.shadow.needsUpdate = true;
                    this.mist.splash(this.impact, now);
                    this.water.splash(impact.x, impact.z, this.flash.position);
                }
                this.meteor = undefined;
            } else {
                u.head.value.copy(m.start).addScaledVector(m.direction, m.speed * t);
                // the tail grows in at the start
                u.tail.value.copy(u.head.value).addScaledVector(m.direction, -s.length * Math.min(1, t / (m.duration * 0.25)));
                u.width.value = s.width;
                u.color.value.set(s.color);
                // splashdowns stay bright to the end; the rest burn out
                const fade = m.splash ? Math.min(1, t / (m.duration * 0.2)) : Math.sin(Math.PI * Math.min(t / m.duration, 0.85));
                u.intensity.value = s.brightness * fade * this.nightAmount;
                u.sparkle.value = 0;
                this.streak.visible = true;
            }
        }

        if (!this.meteor) {
            if (this.trainSplash) {
                // after an impact: the train lingers, spreading and breaking up
                const age = (now - this.trainStart) / Math.max(s.trainSeconds, 1e-3);
                this.streak.visible = age < 1;
                u.sparkle.value = Math.min(1, age * 4);
                u.intensity.value = this.trainIntensity * 0.6 * Math.pow(Math.max(1 - age, 0), 1.5);
            } else {
                // burning out in the sky: it dims while the tail catches up with the head
                const age = (now - this.trainStart) / BURNOUT_SECONDS;
                this.streak.visible = age < 1;
                u.sparkle.value = 0;
                u.tail.value.lerpVectors(this.burnoutTail, u.head.value, Math.min(age, 1));
                u.intensity.value = this.trainIntensity * Math.pow(Math.max(1 - age, 0), 2);
            }
        }

        // the impact: an instant, bright flash lighting the pillars and the water, dying away with the train
        const sinceFlash = now - this.flashStart;
        const flashAge = sinceFlash / Math.max(s.trainSeconds, 1e-3);
        const flash = this.flashStart >= 0 && flashAge < 1 ? Math.pow(1 - flashAge, 1.5) : 0;
        this.flashColor.set(s.color);
        this.flash.intensity = s.splashLight * flash;
        this.flash.distance = s.splashLightRange;
        // the light and its shadows stay on all the time (see warmUp): switching either changes the scene's light setup,
        // which recompiles every lit material's shader. Whether its shadows show is left to the surfaces receiving them
        this.flash.castShadow = s.splashShadows;
        const shadowsShown = s.splashShadows && this.hasCasters && flash > 0;
        this.casters.visible = shadowsShown;
        if (shadowsShown !== this.shadowsShown) {
            this.shadowsShown = shadowsShown;
            this.onShadows?.(shadowsShown);
        }
        // debugging: which pillars those are, drawn over them in magenta
        const debug = this.casters.material;
        if (debug.colorWrite !== s.showShadowCasters) {
            debug.colorWrite = s.showShadowCasters;
            debug.transparent = s.showShadowCasters;
            debug.needsUpdate = true;
        }
        this.flash.shadow.camera.far = s.splashLightRange;
        this.flash.shadow.bias = s.splashShadowBias;
        this.flash.shadow.normalBias = s.splashShadowNormalBias;
        if (this.flash.shadow.mapSize.x !== s.splashShadowSize) {
            this.flash.shadow.mapSize.set(s.splashShadowSize, s.splashShadowSize);
            this.flash.shadow.map?.dispose();
            this.flash.shadow.map = null;
            this.flash.shadow.needsUpdate = true;
        }
        this.flash.color.copy(this.flashColor);

        this.water.setSplashGlow(this.flashColor, s.splashWaterGlow * flash, flash);
        this.onFlash?.(this.flashColor, flash);

        this.updateSplash(sinceFlash);
        this.mist.update(now, this.nightAmount, this.pixelScale(), this.flash.position);
    }

    private throwDroplets(): void {
        const s = this.settings;
        const p = this.droplets.geometry.getAttribute('position') as BufferAttribute;
        for (let k = 0; k < DROPLETS; k++) {
            p.setXYZ(k, this.impact.x, this.impact.y, this.impact.z);
            // most form a crown thrown outwards at an angle; the rest a column going almost straight up, higher
            const angle = Math.random() * Math.PI * 2;
            const column = k < DROPLETS * 0.3;
            const out = column ? Math.random() * 0.15 * s.splashSpread : s.splashSpread * (0.6 + Math.random() * 0.5);
            const up = s.splashHeight * (column ? 0.8 + Math.random() * 0.5 : 0.25 + Math.random() * 0.3);
            this.dropletVelocity.set([Math.cos(angle) * out, Math.sqrt(2 * GRAVITY * up), Math.sin(angle) * out], k * 3);
        }
        this.lastSplashSince = 0;
        p.needsUpdate = true;
    }

    /** the droplets fly and fall, vanishing as they go under */
    private updateSplash(since: number): void {
        const s = this.settings;
        const active = this.flashStart >= 0 && since < SPLASH_SECONDS * 1.6;
        this.droplets.visible = active;
        if (!active) return;

        const p = this.droplets.geometry.getAttribute('position') as BufferAttribute;
        // real elapsed time, so the droplets fly the same at any frame rate (capped against long stalls)
        const dt = Math.min(Math.max(since - this.lastSplashSince, 0), 0.1);
        this.lastSplashSince = since;
        for (let k = 0; k < DROPLETS; k++) {
            const v = this.dropletVelocity;
            v[k * 3 + 1] -= GRAVITY * dt;
            const y = p.getY(k) + v[k * 3 + 1] * dt;
            // gone once it falls back in
            p.setXYZ(k, p.getX(k) + v[k * 3] * dt, y < this.impact.y ? -1e3 : y, p.getZ(k) + v[k * 3 + 2] * dt);
        }
        p.needsUpdate = true;
        this.droplets.material.color.set(s.color);
        this.droplets.material.opacity = Math.max(0, 1 - since / (SPLASH_SECONDS * 1.6)) * this.nightAmount;
        this.droplets.material.size = s.splashDropletSize;
    }

    public bindTweaks(folder: GUI, now: () => number): void {
        const s = this.settings;
        folder.addColor(s, 'color');
        folder.add(s, 'brightness', 0, 10, 0.1);
        folder.add(s, 'minInterval', 1, 120, 1);
        folder.add(s, 'maxInterval', 1, 240, 1);
        folder.add(s, 'speed', 5, 200, 1);
        folder.add(s, 'duration', 0.1, 3, 0.05);
        folder.add(s, 'length', 0.5, 40, 0.5);
        folder.add(s, 'width', 0.02, 1, 0.01);
        folder.add(s, 'splashChance', 0, 1, 0.01);
        folder.add(s, 'splashLight', 0, 5000, 5);
        folder.add(s, 'splashLightRange', 1, 80, 1);
        folder.add(s, 'splashWaterGlow', 0, 60, 0.5);
        folder.add(s, 'splashShadows');
        folder.add(s, 'splashShadowSize', [128, 256, 512, 1024, 2048]);
        folder.add(s, 'splashShadowBias', -0.02, 0.02, 0.0005);
        folder.add(s, 'splashShadowNormalBias', 0, 0.2, 0.005);
        folder.add(s, 'splashShadowOnPillars', 0, 1, 0.01);
        folder.add(s, 'shadowCasterWedgeDeg', 0, 89, 1);
        folder.add(s, 'shadowCasterPastImpact', 0, 20, 0.25);
        folder.add(s, 'shadowCasterWallMargin', -4, 10, 1);
        folder.add(s, 'shadowCanyonHeight', 0, 10, 0.1);
        folder.add(s, 'showShadowCasters').name('show shadow casters (debug)');
        folder.add(s, 'splashHeight', 0, 5, 0.05);
        folder.add(s, 'splashSpread', 0, 5, 0.05);
        folder.add(s, 'splashDropletSize', 0.01, 0.4, 0.005);
        folder.add(s, 'splashMistCount', 0, 2000, 10);
        folder.add(s, 'splashMistJets', 1, 60, 1);
        folder.add(s, 'splashMistSize', 0.05, 4, 0.05);
        folder.add(s, 'splashMistHeight', 0, 8, 0.05);
        folder.add(s, 'splashMistSpread', 0, 8, 0.05);
        folder.add(s, 'splashMistSeconds', 0.2, 10, 0.1);
        folder.add(s, 'splashMistOpacity', 0, 1, 0.01);
        folder.add(s, 'splashMistDrag', 0.1, 8, 0.05);
        folder.add(s, 'splashMistGravity', 0, 5, 0.05);
        folder.addColor(s, 'splashMistColor');
        folder.add(s, 'splashMistEnvironmentLight', 0, 2, 0.01);
        folder.add(s, 'splashMistFlashLight', 0, 1, 0.005);
        folder.add(s, 'splashMistFlashNear', 0.01, 10, 0.05);
        folder.add(s, 'splashMistTranslucency', 0, 2, 0.05);
        folder.add(s, 'trainSeconds', 0, 5, 0.05).name('trainSeconds (splash + light)');
        folder.add({ go: () => { this.meteor = undefined; this.launch(now()); } }, 'go').name('Launch one now');
    }
}
