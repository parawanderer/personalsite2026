import { Color, PerspectiveCamera, Vector2, ShaderMaterial, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

import { GodRaySettings } from '../constants';

const WHITE = new Color(1, 1, 1);

const fragmentShader = /* glsl */ `
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float cameraNear;
uniform float cameraFar;
uniform mat4 projectionInverse;
uniform mat4 cameraWorld;
uniform vec3 eye;
uniform float waterLevel;
// towards the sun, bent as the light enters the water
uniform vec3 lightDir;
uniform vec3 lightColor;
uniform float time;
uniform vec2 flow;
uniform float maxDistance;
uniform float shaftScale;
uniform float sharpness;
uniform float depthFade;
uniform float viewDensity;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// the light let through by the surface at a point on it: bright patches where the waves focus it, drifting and changing
float surfaceLight(vec2 q) {
    q = (q - flow) * shaftScale;
    float n = 0.65 * noise(q + vec2(time * 0.21, time * 0.13)) + 0.35 * noise(q * 2.3 - vec2(time * 0.17, time * 0.29));
    // only the brightest patches: sparse, so the shafts stay apart instead of blending into a haze
    float cut = 1.0 - 0.5 / sharpness;
    return smoothstep(cut, cut + 0.12, n);
}

void main() {
    vec4 scene = texture2D(tDiffuse, vUv);
    float viewZ = perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, cameraNear, cameraFar);
    vec4 view = projectionInverse * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 viewDir = normalize(view.xyz / view.w);
    vec3 dir = normalize(mat3(cameraWorld) * viewDir);
    // along the view ray to the scene, or as far as rays are worth marching
    float sceneDistance = viewZ / viewDir.z;
    float end = min(sceneDistance, maxDistance);

    const int STEPS = 24;
    float stepLength = end / float(STEPS);
    // interleaved gradient noise, so the steps don't band
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float light = 0.0;
    for (int i = 0; i < STEPS; i++) {
        float t = (float(i) + jitter) * stepLength;
        vec3 p = eye + dir * t;
        float below = waterLevel - p.y;
        if (below <= 0.0) continue;
        // up along the light to where it came through the surface
        vec2 q = p.xz + lightDir.xz / max(lightDir.y, 0.2) * below;
        light += surfaceLight(q) * exp(-below * depthFade) * exp(-t * viewDensity);
    }
    light *= stepLength;
    gl_FragColor = vec4(scene.rgb + lightColor * light, scene.a);
}
`;

/**
 * Shafts of light in the water while the camera is under it: marched along each view ray, lit where the light of the
 * sun that's up comes down through the bright patches the surface's waves let through, fading with depth and distance.
 * Needs the scene's depth, so it runs straight after the scene is rendered. Off (skipped) above the water and at night.
 */
export class GodRaysPass extends Pass {
    private readonly material: ShaderMaterial;
    private readonly quad: FullScreenQuad;
    private readonly bent = new Vector3();

    constructor(private readonly camera: PerspectiveCamera, private readonly settings: GodRaySettings) {
        super();
        this.material = new ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                tDepth: { value: null },
                cameraNear: { value: 0.1 },
                cameraFar: { value: 1000 },
                projectionInverse: { value: camera.projectionMatrixInverse },
                cameraWorld: { value: camera.matrixWorld },
                eye: { value: camera.position },
                waterLevel: { value: 0 },
                lightDir: { value: new Vector3(0, 1, 0) },
                lightColor: { value: new Color() },
                time: { value: 0 },
                // the water's drift, shared once update() hands it over
                flow: { value: new Vector2() },
                maxDistance: { value: 12 },
                shaftScale: { value: 1 },
                sharpness: { value: 3 },
                depthFade: { value: 0.3 },
                viewDensity: { value: 0.2 },
            },
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader,
            depthTest: false,
            depthWrite: false,
        });
        this.quad = new FullScreenQuad(this.material);
        this.enabled = false;
    }

    /**
     * @param sun towards the brightest sun that's up, its colour times brightness (black when none is), and 0 to 1 for how
     *            far it's risen
     */
    public update(underwater: boolean, waterLevel: number, sun: { direction: Vector3, color: Color, up: number }, time: number, flow: Vector2, viewDensity: number): void {
        const s = this.settings;
        this.enabled = s.enabled && underwater && sun.up > 0.01;
        if (!this.enabled) return;
        const u = this.material.uniforms;
        // Snell's law: light entering the water bends towards straight down (index 1.33)
        const horizontal = Math.hypot(sun.direction.x, sun.direction.z);
        const sinWater = Math.min(horizontal, 1) / 1.33;
        const scale = horizontal > 1e-4 ? sinWater / horizontal : 0;
        this.bent.set(sun.direction.x * scale, Math.sqrt(1 - sinWater * sinWater), sun.direction.z * scale);
        u.lightDir.value.copy(this.bent);
        // mostly white: the water filters the sun's own tint out
        u.lightColor.value.copy(sun.color).lerp(WHITE, 0.6).multiplyScalar(s.strength * sun.up);
        u.waterLevel.value = waterLevel;
        u.time.value = time * s.speed;
        u.flow.value = flow;
        u.maxDistance.value = s.maxDistance;
        u.shaftScale.value = s.shaftScale;
        u.sharpness.value = s.sharpness;
        u.depthFade.value = s.depthFade;
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
    }

    public render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
        const u = this.material.uniforms;
        u.tDiffuse.value = readBuffer.texture;
        u.tDepth.value = readBuffer.depthTexture;
        u.cameraNear.value = this.camera.near;
        u.cameraFar.value = this.camera.far;
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        this.quad.render(renderer);
    }

    public dispose(): void {
        this.material.dispose();
        this.quad.dispose();
    }
}
