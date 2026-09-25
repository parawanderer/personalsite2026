import { AdditiveBlending, Camera, Color, DirectionalLight, Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { degToRad, smoothstep } from 'three/src/math/MathUtils.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { CelestialBody } from '../constants';
import { skyGlowUniforms } from '../shaders/sky-glow.glsl';

// how far from the camera the discs are drawn: inside the sky dome, beyond everything else
const DISTANCE = 100;

const discMaterial = () => new ShaderMaterial({
    uniforms: {
        color: { value: new Color() },
        brightness: { value: 1 },
        haloScale: { value: 1 },
        haloStrength: { value: 0 },
        visibility: { value: 1 },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float brightness;
        uniform float haloScale;
        uniform float haloStrength;
        uniform float visibility;
        varying vec2 vUv;
        void main() {
            // 1 at the disc's edge; the quad also holds the halo around it
            float r = length(vUv) * haloScale;
            float disc = 1.0 - smoothstep(0.96, 1.0, r);
            float halo = haloStrength * exp(-max(r - 1.0, 0.0) * 3.0) * (1.0 - smoothstep(haloScale * 0.8, haloScale, r));
            gl_FragColor = vec4(color * brightness * (disc + halo * (1.0 - disc)) * visibility, 1.0);
        }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    fog: false,
});

/**
 * A sun or moon: a disc in the sky that follows an arc by the time of day, with a directional light while it's up.
 * Directions: azimuth 0 looks down the channel (-z), 90 is +x.
 */
export class Celestial implements AnimatedEntity {
    private readonly disc: Mesh<PlaneGeometry, ShaderMaterial>;
    private readonly light: DirectionalLight;
    /** unit direction from the camera, updated each frame */
    public readonly direction = new Vector3(0, 1, 0);
    /** 0 below the horizon, 1 well above it */
    public up = 0;

    /**
     * @param index which of the fog's sun slots (shaders/sky-glow.glsl.ts) this one fills
     */
    constructor(
        private readonly scene: Scene,
        private readonly camera: Camera,
        private readonly body: CelestialBody,
        private readonly hour: () => number,
        private readonly index: number,
    ) {
        this.disc = new Mesh(new PlaneGeometry(1, 1), discMaterial());
        // drawn after the sky dome, before the particles
        this.disc.renderOrder = -1;
        this.disc.frustumCulled = false;
        scene.add(this.disc);

        this.light = new DirectionalLight();
        scene.add(this.light);
        scene.add(this.light.target);
    }

    /** where along its arc it is: 0 at rising, 1 at setting, outside that below the horizon */
    private get phase(): number {
        const b = this.body;
        const sinceRise = (((this.hour() - b.riseHour) % b.periodHours) + b.periodHours) % b.periodHours;
        return sinceRise / b.hoursUp;
    }

    public update(): void {
        const b = this.body;
        const p = this.phase;
        const above = p >= 0 && p <= 1;

        const az = degToRad(b.azimuthRise + (b.azimuthSet - b.azimuthRise) * Math.min(Math.max(p, 0), 1));
        // an arc: rises from the horizon, peaks halfway, sets again
        const el = above ? degToRad(b.peakElevation) * Math.sin(Math.PI * p) : -0.2;
        this.direction.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
        this.up = smoothstep(Math.sin(el), -0.02, 0.12);

        const u = this.disc.material.uniforms;
        u.color.value.set(b.color);
        u.brightness.value = b.brightness;
        u.haloScale.value = b.haloScale;
        u.haloStrength.value = b.haloStrength;
        u.visibility.value = above ? smoothstep(Math.sin(el), -0.03, 0.02) : 0;
        this.disc.visible = u.visibility.value > 0;

        const size = 2 * Math.tan(degToRad(b.sizeDeg) / 2) * DISTANCE * b.haloScale;
        this.disc.scale.set(size, size, 1);
        this.disc.position.copy(this.camera.position).addScaledVector(this.direction, DISTANCE);
        this.disc.quaternion.copy(this.camera.quaternion);

        // the same sun, seen through the fog
        const g = skyGlowUniforms;
        g.glowSunDirection.value[this.index].copy(this.direction);
        g.glowSunRadiance.value[this.index].set(b.color).multiplyScalar(b.brightness * u.visibility.value);
        g.glowSunRadius.value[this.index] = degToRad(b.sizeDeg) / 2;
        g.glowSunHaloScale.value[this.index] = b.haloScale;
        g.glowSunHaloStrength.value[this.index] = b.haloStrength;

        this.light.color.set(b.color);
        this.light.intensity = b.lightIntensity * this.up;
        this.light.visible = this.light.intensity > 0;
        this.light.position.copy(this.camera.position).addScaledVector(this.direction, 50);
        this.light.target.position.copy(this.camera.position);
    }

    public bindTweaks(folder: GUI): void {
        const b = this.body;
        folder.addColor(b, 'color');
        folder.add(b, 'sizeDeg', 0.5, 30, 0.1);
        folder.add(b, 'brightness', 0, 5, 0.01);
        folder.add(b, 'haloScale', 1, 6, 0.05);
        folder.add(b, 'haloStrength', 0, 1, 0.01);
        folder.add(b, 'riseHour', 0, 24, 0.1);
        folder.add(b, 'hoursUp', 1, 24, 0.1);
        folder.add(b, 'periodHours', 1, 48, 0.1);
        folder.add(b, 'azimuthRise', -180, 180, 1);
        folder.add(b, 'azimuthSet', -180, 180, 1);
        folder.add(b, 'peakElevation', 1, 90, 1);
        folder.add(b, 'lightIntensity', 0, 5, 0.01);
    }
}
