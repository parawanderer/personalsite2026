import { AdditiveBlending, Color, HalfFloatType, PerspectiveCamera, Vector2, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

import { GodRaySettings } from '../constants';
import { shaftPars, shaftUniforms } from '../shaders/sun-shafts.glsl';

const WHITE = new Color(1, 1, 1);

// the rays are marched at this share of the screen's resolution (they're soft), then scaled up and added
const RESOLUTION = 0.5;

const compositeShader = /* glsl */ `
uniform sampler2D tRays;
uniform vec2 raysTexel;
varying vec2 vUv;
void main() {
    // a small blur while scaling up, which also smooths the march's jitter
    vec3 rays = 0.25 * (
        texture2D(tRays, vUv + raysTexel * vec2(-0.75, -0.75)).rgb + texture2D(tRays, vUv + raysTexel * vec2(0.75, -0.75)).rgb +
        texture2D(tRays, vUv + raysTexel * vec2(-0.75, 0.75)).rgb + texture2D(tRays, vUv + raysTexel * vec2(0.75, 0.75)).rgb
    );
    gl_FragColor = vec4(rays, 1.0);
}
`;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 projectionInverse;
uniform mat4 cameraWorld;
uniform vec3 eye;
uniform float waterLevel;
uniform float maxDistance;
uniform float viewDensity;
uniform float strength;
${shaftPars}
varying vec2 vUv;

void main() {
    float viewZ = perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, cameraNear, cameraFar);
    vec4 view = projectionInverse * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 viewDir = normalize(view.xyz / view.w);
    vec3 dir = normalize(mat3(cameraWorld) * viewDir);
    // along the view ray to the scene, or as far as rays are worth marching
    float end = min(viewZ / viewDir.z, maxDistance);

    const int STEPS = 16;
    float stepLength = end / float(STEPS);
    // interleaved gradient noise, so the steps don't band
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    vec3 light = vec3(0.0);
    for (int i = 0; i < STEPS; i++) {
        float t = (float(i) + jitter) * stepLength;
        vec3 p = eye + dir * t;
        float below = waterLevel - p.y;
        if (below <= 0.0) continue;
        light += shaftLight(p, below) * exp(-t * viewDensity);
    }
    gl_FragColor = vec4(light * stepLength * strength, 1.0);
}
`;

/**
 * Shafts of light in the water while the camera is under it: marched along each view ray, lit where the light of the
 * sun that's up comes down through the bright patches the surface's waves let through, fading with depth and distance.
 * Marched at half resolution (they're soft light), then scaled up and added. Needs the scene's depth, so it runs
 * straight after the scene is rendered. Off (skipped) above the water and at night.
 */
export class GodRaysPass extends Pass {
    private readonly material: ShaderMaterial;
    private readonly quad: FullScreenQuad;
    private readonly composite: ShaderMaterial;
    private readonly compositeQuad: FullScreenQuad;
    private readonly rays = new WebGLRenderTarget(1, 1, { type: HalfFloatType });

    constructor(private readonly camera: PerspectiveCamera, private readonly settings: GodRaySettings) {
        super();
        this.material = new ShaderMaterial({
            uniforms: {
                tDepth: { value: null },
                cameraNear: { value: 0.1 },
                cameraFar: { value: 1000 },
                projectionInverse: { value: camera.projectionMatrixInverse },
                cameraWorld: { value: camera.matrixWorld },
                eye: { value: camera.position },
                waterLevel: { value: 0 },
                maxDistance: { value: 12 },
                viewDensity: { value: 0.2 },
                strength: { value: 1 },
                ...shaftUniforms,
            },
            vertexShader: VERTEX,
            fragmentShader,
            depthTest: false,
            depthWrite: false,
        });
        this.quad = new FullScreenQuad(this.material);
        this.composite = new ShaderMaterial({
            uniforms: { tRays: { value: this.rays.texture }, raysTexel: { value: new Vector2() } },
            vertexShader: VERTEX,
            fragmentShader: compositeShader,
            depthTest: false,
            depthWrite: false,
            // added on top of the frame where it is (no buffer swap), so later passes still see the scene's depth
            transparent: true,
            blending: AdditiveBlending,
        });
        this.needsSwap = false;
        this.compositeQuad = new FullScreenQuad(this.composite);
        this.enabled = false;
    }

    /**
     * @param suns each sun: towards it, its colour times brightness, and 0 to 1 for how far it's risen; brightest first
     * @param flow how far the surface has drifted (shared with the water)
     */
    /**
     * @param daylight 1 by day, 0 at night: the world is drawn night-dark by the hour, so no shafts then even if a sun
     *                 is up (only possible with tweaked orbits)
     */
    public update(underwater: boolean, waterLevel: number, suns: { direction: Vector3, color: Color, up: number }[], time: number, flow: Vector2, viewDensity: number, walls: { left: number, right: number } | undefined, daylight: number): void {
        const s = this.settings;
        const u = this.material.uniforms;
        const dirs = shaftUniforms.shaftLightDir.value as Vector3[];
        const colors = shaftUniforms.shaftLightColor.value as Color[];
        const sunDirs = shaftUniforms.shaftSunDir.value as Vector3[];
        // the walls beside the camera, standing in for the whole canyon
        shaftUniforms.shaftWallHeight.value = walls ? s.wallHeight : 0;
        if (walls) {
            shaftUniforms.shaftWallLeft.value = walls.left;
            shaftUniforms.shaftWallRight.value = walls.right;
        }
        let any = false;
        suns.forEach((sun, k) => {
            if (k >= dirs.length) return;
            // the second sun only with 'bothSuns'
            const on = s.enabled && underwater && sun.up > 0.01 && (k === 0 || s.bothSuns);
            // Snell's law: light entering the water bends towards straight down (index 1.33)
            const horizontal = Math.hypot(sun.direction.x, sun.direction.z);
            const sinWater = Math.min(horizontal, 1) / 1.33;
            const scale = horizontal > 1e-4 ? sinWater / horizontal : 0;
            dirs[k].set(sun.direction.x * scale, Math.sqrt(1 - sinWater * sinWater), sun.direction.z * scale);
            sunDirs[k].copy(sun.direction);
            // a low sun's light mostly glances off the surface (and the canyon walls block it), so its shafts only come in
            // as it climbs: none below minElevationDeg, full strength 20 degrees above that
            const elevation = Math.asin(Math.min(Math.max(sun.direction.y, -1), 1)) * 180 / Math.PI;
            const high = Math.min(Math.max((elevation - s.minElevationDeg) / 20, 0), 1);
            // mostly white: the water filters the sun's own tint out
            colors[k].copy(sun.color).lerp(WHITE, 0.6).multiplyScalar(on ? sun.up * high * high * (3 - 2 * high) * daylight : 0);
            any ||= colors[k].r + colors[k].g + colors[k].b > 0;
        });
        this.enabled = any;
        shaftUniforms.shaftTime.value = time * s.speed;
        shaftUniforms.shaftFlow.value = flow;
        shaftUniforms.shaftScale.value = s.shaftScale;
        shaftUniforms.shaftSharpness.value = s.sharpness;
        shaftUniforms.shaftDepthFade.value = s.depthFade;
        shaftUniforms.shaftOnSurfaces.value = s.onSurfaces;
        u.strength.value = s.strength;
        u.waterLevel.value = waterLevel;
        u.maxDistance.value = s.maxDistance;
        u.viewDensity.value = viewDensity;
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'enabled');
        folder.add(s, 'strength', 0, 1, 0.005);
        folder.add(s, 'shaftScale', 0.1, 5, 0.05);
        folder.add(s, 'sharpness', 1, 10, 0.1);
        folder.add(s, 'depthFade', 0, 2, 0.01);
        folder.add(s, 'maxDistance', 2, 40, 0.5);
        folder.add(s, 'speed', 0, 3, 0.05);
        folder.add(s, 'bothSuns');
        folder.add(s, 'minElevationDeg', 0, 80, 1);
        folder.add(s, 'wallHeight', 0, 15, 0.1);
        folder.add(s, 'onSurfaces', 0, 3, 0.05);
    }

    public setSize(width: number, height: number): void {
        this.rays.setSize(Math.max(1, Math.round(width * RESOLUTION)), Math.max(1, Math.round(height * RESOLUTION)));
        this.composite.uniforms.raysTexel.value.set(1 / this.rays.width, 1 / this.rays.height);
    }

    public render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
        const u = this.material.uniforms;
        u.tDepth.value = readBuffer.depthTexture;
        u.cameraNear.value = this.camera.near;
        u.cameraFar.value = this.camera.far;
        // the rays, at the lower resolution
        renderer.setRenderTarget(this.rays);
        this.quad.render(renderer);
        // then added to the frame
        renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
        // without clearing it first
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        this.compositeQuad.render(renderer);
        renderer.autoClear = autoClear;
    }

    public dispose(): void {
        this.material.dispose();
        this.quad.dispose();
        this.composite.dispose();
        this.compositeQuad.dispose();
        this.rays.dispose();
    }
}
