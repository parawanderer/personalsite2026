import { AdditiveBlending, Clock, Color, DoubleSide, Mesh, PlaneGeometry, PointLight, Scene, ShaderMaterial, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { ShootingStarSettings } from '../constants';
import { WATER_LEVEL_Y } from './water';

// the far end of the channel, where splashdowns land (x across the channel, z along it)
const SPLASH_X = [-2, 1];
const SPLASH_Z = [-14, -6];

const streakMaterial = () => new ShaderMaterial({
    uniforms: {
        head: { value: new Vector3() },
        tail: { value: new Vector3() },
        width: { value: 0.1 },
        color: { value: new Color() },
        intensity: { value: 0 },
    },
    vertexShader: /* glsl */ `
        uniform vec3 head;
        uniform vec3 tail;
        uniform float width;
        varying vec2 vStreak;
        void main() {
            // x runs from the tail (-0.5) to the head (0.5), y across the streak, which always faces the camera
            float along = position.x + 0.5;
            vec3 p = mix(tail, head, along);
            vec3 side = normalize(cross(head - tail, cameraPosition - p));
            p += side * position.y * width * mix(0.3, 1.0, along);
            vStreak = vec2(along, position.y * 2.0);
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float intensity;
        varying vec2 vStreak;
        void main() {
            float core = 1.0 - smoothstep(0.0, 1.0, abs(vStreak.y));
            float glow = pow(vStreak.x, 3.0) * core * core;
            gl_FragColor = vec4(color * glow * intensity, 1.0);
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
    private readonly flash = new PointLight(0xffffff, 0, 12, 1.5);
    private meteor?: Meteor;
    private nextAt = 0;
    private flashStart = -1;
    private nightAmount = 0;

    constructor(scene: Scene, private readonly settings: ShootingStarSettings) {
        this.streak = new Mesh(new PlaneGeometry(1, 1, 16, 1), streakMaterial());
        this.streak.frustumCulled = false;
        this.streak.visible = false;
        scene.add(this.streak);
        scene.add(this.flash);
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
        if (m) {
            const t = now - m.startTime;
            if (t > m.duration) {
                if (m.splash) {
                    this.flash.position.copy(m.start).addScaledVector(m.direction, m.speed * m.duration);
                    this.flash.position.y = WATER_LEVEL_Y + 0.3;
                    this.flashStart = now;
                }
                this.meteor = undefined;
                this.streak.visible = false;
            } else {
                u.head.value.copy(m.start).addScaledVector(m.direction, m.speed * t);
                // the tail grows in at the start
                u.tail.value.copy(u.head.value).addScaledVector(m.direction, -s.length * Math.min(1, t / (m.duration * 0.25)));
                u.width.value = s.width;
                u.color.value.set(s.color);
                // splashdowns stay bright to the end; the rest burn out
                const fade = m.splash ? Math.min(1, t / (m.duration * 0.2)) : Math.sin(Math.PI * t / m.duration);
                u.intensity.value = s.brightness * fade * this.nightAmount;
                this.streak.visible = true;
            }
        }

        const sinceFlash = now - this.flashStart;
        this.flash.intensity = this.flashStart >= 0 && sinceFlash < s.splashSeconds
            ? s.splashLight * Math.pow(1 - sinceFlash / s.splashSeconds, 2)
            : 0;
        this.flash.color.set(s.color);
        this.flash.visible = this.flash.intensity > 0;
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
        folder.add(s, 'splashLight', 0, 50, 0.5);
        folder.add(s, 'splashSeconds', 0.1, 5, 0.1);
        folder.add({ go: () => { this.meteor = undefined; this.launch(now()); } }, 'go').name('Launch one now');
    }
}
