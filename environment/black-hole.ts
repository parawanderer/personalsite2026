import { Color, DirectionalLight, MeshBasicMaterial, Scene, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { degToRad } from 'three/src/math/MathUtils.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { BlackHoleSettings } from '../constants';

const STEPS = 160;

const pars = /* glsl */ `
// (edits) environment/black-hole.ts
varying vec3 vHoleWorld;
uniform float holeAmount;
uniform vec3 holeForward;
uniform vec3 holeRight;
uniform vec3 holeUp;
// radians of sky per radian as seen from the simulated camera: how big it looks
uniform float holeScale;
uniform float holeRegion;
uniform vec3 holeDiscNormal;
uniform float holeDiscInner;
uniform float holeDiscOuter;
uniform float holeSpin;
uniform float holeTime;
uniform float holeDiscBrightness;
uniform float holeBeaming;
uniform vec3 holeHot;
uniform vec3 holeWarm;
uniform vec3 holeCool;

float holeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// value noise that wraps every 'period' along y (the way round the disc)
float holeNoise(vec2 p, float period) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float y0 = mod(i.y, period), y1 = mod(i.y + 1.0, period);
    return mix(mix(holeHash(vec2(i.x, y0)), holeHash(vec2(i.x + 1.0, y0)), f.x), mix(holeHash(vec2(i.x, y1)), holeHash(vec2(i.x + 1.0, y1)), f.x), f.y);
}

// the disc's light where a ray crosses it at p (units of the hole's mass, M = 1), coming from direction 'along'
// (the way the ray was traced, the light's is the opposite): hot and white inside, cooling to deep red outwards,
// streaked along its orbits (turning faster inside), brighter where it moves towards us (Doppler beaming) and dimmer
// deep in the well (gravitational redshift). Returns the light and how opaque the disc is there
vec4 holeDiscLight(vec3 p, vec3 along) {
    float r = length(p);
    float t = clamp((r - holeDiscInner) / (holeDiscOuter - holeDiscInner), 0.0, 1.0);
    // orbits: speed sqrt(M / r), turning with the hole
    vec3 orbit = normalize(cross(holeDiscNormal, p)) * sign(holeSpin + 1e-4);
    float beta = sqrt(1.0 / r);
    float gamma = 1.0 / sqrt(1.0 - beta * beta);
    float doppler = 1.0 / (gamma * (1.0 - beta * dot(orbit, -normalize(along))));
    float redshift = sqrt(max(1.0 - 2.0 / r, 0.0));
    float boost = pow(doppler * redshift, holeBeaming);
    // streaks: noise stretched along the orbits, each ring turning at its own speed (Kepler: faster inside)
    vec3 a = normalize(p - dot(p, holeDiscNormal) * holeDiscNormal);
    vec3 b = cross(holeDiscNormal, a);
    float phi = atan(dot(a, normalize(cross(holeDiscNormal, holeRight + holeUp * 0.37))), dot(a, normalize(holeRight + holeUp * 0.37)));
    phi -= holeTime * pow(r, -1.5) * 6.0 * sign(holeSpin + 1e-4);
    float around = phi / 6.2831853 * 24.0;
    float streaks = 0.35 + 0.65 * holeNoise(vec2(r * 3.0, around), 24.0) * (0.6 + 0.4 * holeNoise(vec2(r * 9.0, around * 3.0), 72.0));
    // hotter-looking where it's boosted
    float heat = clamp(t / max(doppler, 0.3), 0.0, 1.0);
    vec3 color = heat < 0.3 ? mix(holeHot, holeWarm, heat / 0.3) : mix(holeWarm, holeCool, (heat - 0.3) / 0.7);
    // fading in at its inner edge and out at its outer one
    float edges = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.7, 1.0, t));
    float density = edges * streaks;
    return vec4(color * boost * holeDiscBrightness * density, clamp(density * 0.9, 0.0, 1.0));
}

// the sky seen towards 'dir' with the hole in front of it: the view ray followed in the hole's own units from far
// off, bent by its gravity (Schwarzschild, with a sideways pull standing in for a spinning hole's frame dragging),
// picking up the disc's light each time it crosses the disc; the sky behind is where it ends up heading, unless it
// fell in. 'sky' is the sky as drawn there without it. Returns the colour and how much it replaces that (0 outside
// the hole's region)
vec4 holeSky(vec3 dir, vec3 sky) {
    float x = dot(dir, holeRight), y = dot(dir, holeUp), z = dot(dir, holeForward);
    float side = length(vec2(x, y));
    float angle = atan(side, z);
    if (angle > holeRegion) return vec4(0.0);
    // the ray from the simulated camera, 60 masses away along -z, at the angle this pixel is at scaled down
    float local = angle / holeScale;
    vec2 across = side > 1e-6 ? vec2(x, y) / side : vec2(0.0);
    vec3 v = vec3(across * sin(local), cos(local));
    vec3 p = vec3(0.0, 0.0, -60.0);
    vec3 h = cross(p, v);
    float h2 = dot(h, h);
    vec3 spinAxis = holeDiscNormal;
    vec3 light = vec3(0.0);
    float covered = 0.0;
    bool fell = false;
    for (int i = 0; i < ${STEPS}; i++) {
        float r = length(p);
        if (r < 1.9) { fell = true; break; }
        if (r > 80.0 && dot(p, v) > 0.0) break;
        float dt = clamp(0.06 * r, 0.04, 3.0);
        vec3 accel = -1.5 * h2 * p / pow(r, 5.0) + holeSpin * 2.0 * cross(spinAxis, v) / (r * r * r);
        vec3 next = p + v * dt;
        v = normalize(v + accel * dt);
        // crossing the disc's plane
        float s0 = dot(p, holeDiscNormal), s1 = dot(next, holeDiscNormal);
        if (s0 * s1 < 0.0) {
            vec3 at = mix(p, next, s0 / (s0 - s1));
            float ra = length(at);
            if (ra > holeDiscInner && ra < holeDiscOuter) {
                vec4 disc = holeDiscLight(at, v);
                light += (1.0 - covered) * disc.rgb * disc.a;
                covered += (1.0 - covered) * disc.a;
                if (covered > 0.98) break;
            }
        }
        p = next;
    }
    vec3 behind = vec3(0.0);
    if (!fell) {
        // where it ends up heading, scaled back up to the sky's angles
        float outAngle = acos(clamp(v.z, -1.0, 1.0)) * holeScale;
        vec2 outAcross = length(v.xy) > 1e-6 ? normalize(v.xy) : vec2(0.0);
        vec3 outDir = normalize(holeForward * cos(outAngle) + (holeRight * outAcross.x + holeUp * outAcross.y) * sin(outAngle));
        // the sky as it was, with its stars swapped for the ones the light really comes from (the aurora and glows
        // in front of it aren't bent)
        behind = sky + (stars(outDir) - stars(dir)) * starAmount;
    }
    // fading into the untouched sky at its region's edge (where the bending has become slight)
    float fade = 1.0 - smoothstep(holeRegion * 0.7, holeRegion, angle);
    return vec4(light + (1.0 - covered) * behind, fade);
}
`;

/**
 * A black hole in the night sky, with its accretion disc (the look of the renders from the film Interstellar): drawn
 * on the sky by following each view ray near it as gravity bends it, so the black shadow, the disc's far side lifted
 * over and under it, the thin bright ring round the edge and the stars smeared around it all come out of the maths
 * rather than being painted. It spins: the disc turns, brighter on the side coming towards us, and the shadow is
 * pulled a little to one side. Its disc lights the scene faintly from its direction. Fades in with the night.
 */
export class BlackHole implements AnimatedEntity {
    private readonly uniforms = {
        holeAmount: { value: 0 },
        holeForward: { value: new Vector3(0, 0, -1) },
        holeRight: { value: new Vector3(1, 0, 0) },
        holeUp: { value: new Vector3(0, 1, 0) },
        holeScale: { value: 1 },
        holeRegion: { value: 0.3 },
        holeDiscNormal: { value: new Vector3(0, 1, 0) },
        holeDiscInner: { value: 4 },
        holeDiscOuter: { value: 16 },
        holeSpin: { value: 0.5 },
        holeTime: { value: 0 },
        holeDiscBrightness: { value: 1 },
        holeBeaming: { value: 3 },
        holeHot: { value: new Color() },
        holeWarm: { value: new Color() },
        holeCool: { value: new Color() },
    };
    private night = 0;
    // its disc's light on the scene: always there (zero at day), adding or removing a light recompiles every lit material
    private readonly light = new DirectionalLight();
    private readonly waterColor = new Color();
    /** told the light's direction (towards it) and the colour the water scatters back, every frame */
    public onWaterLight?: (direction: Vector3, color: Color) => void;

    constructor(scene: Scene, skyMaterial: MeshBasicMaterial, private readonly settings: BlackHoleSettings) {
        scene.add(this.light, this.light.target);
        const previous = skyMaterial.onBeforeCompile;
        skyMaterial.onBeforeCompile = (params, renderer) => {
            previous.call(skyMaterial, params, renderer);
            Object.assign(params.uniforms, this.uniforms);
            params.vertexShader = params.vertexShader
                .replace('#include <common>', '#include <common>\nvarying vec3 vHoleWorld;')
                .replace('#include <fog_vertex>', '#include <fog_vertex>\nvHoleWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            // after everything else on the sky (it covers the stars behind it with their bent image)
            params.fragmentShader = params.fragmentShader
                // after the other edits' definitions (it uses the stars')
                .replace('void main() {', `${pars}\nvoid main() {`)
                .replace('#include <tonemapping_fragment>', `if (holeAmount > 0.0) {
    vec3 holeDir = normalize(vHoleWorld - cameraPosition);
    // what glows in the planet's own air (the aurora, the volcano's glow) is in front of it: taken out of the sky
    // behind, and put back over it
    vec3 inAir = vec3(0.0);
    if (auroraAmount > 0.0) inAir += aurora(holeDir);
    if (volcanoColor.r + volcanoColor.g + volcanoColor.b > 0.0) inAir += volcanoGlow(holeDir);
    vec4 hole = holeSky(holeDir, gl_FragColor.rgb - inAir);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, hole.rgb + inAir, hole.a * holeAmount);
}
#include <tonemapping_fragment>`);
        };
        skyMaterial.needsUpdate = true;
    }

    /** how far into the night it is, 0 to 1 */
    public setNight(amount: number): void {
        this.night = amount;
    }

    public update(clock: { elapsedTime: number }): void {
        const s = this.settings;
        const u = this.uniforms;
        u.holeAmount.value = s.enabled ? Math.max(this.night, s.byDay) : 0;
        const az = degToRad(s.azimuthDeg), el = degToRad(s.elevationDeg);
        u.holeForward.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
        u.holeRight.value.crossVectors(u.holeForward.value, new Vector3(0, 1, 0)).normalize();
        u.holeUp.value.crossVectors(u.holeRight.value, u.holeForward.value).normalize();
        // the shadow's edge is about 5.2 masses across from 60 away, about 5 degrees there
        u.holeScale.value = degToRad(s.shadowDeg) / Math.atan(5.2 / 60);
        u.holeRegion.value = degToRad(s.shadowDeg * s.regionScale);
        // the disc seen close to edge-on, tipped towards us by the inclination and rolled on the sky
        const incl = degToRad(s.inclinationDeg), roll = degToRad(s.rollDeg);
        u.holeDiscNormal.value.set(-Math.sin(roll) * Math.sin(incl), Math.cos(roll) * Math.sin(incl), -Math.cos(incl)).normalize();
        u.holeDiscInner.value = s.discInner;
        u.holeDiscOuter.value = s.discOuter;
        u.holeSpin.value = s.spin;
        u.holeTime.value = clock.elapsedTime * s.discSpeed;
        u.holeDiscBrightness.value = s.discBrightness;
        u.holeBeaming.value = s.beaming;
        u.holeHot.value.set(s.hotColor);
        u.holeWarm.value.set(s.warmColor);
        u.holeCool.value.set(s.coolColor);

        // the disc lights the scene faintly from its direction, in its warm middle colour
        const shown = u.holeAmount.value;
        this.light.position.copy(u.holeForward.value).multiplyScalar(50);
        this.light.target.position.set(0, 0, 0);
        this.light.color.set(s.warmColor).lerp(u.holeHot.value, 0.4);
        this.light.intensity = s.lightStrength * shown;
        this.waterColor.copy(this.light.color).multiplyScalar(s.waterScatter * shown);
        this.onWaterLight?.(u.holeForward.value, this.waterColor);
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'enabled');
        folder.add(s, 'byDay', 0, 1, 0.01);
        folder.add(s, 'azimuthDeg', -180, 180, 1);
        folder.add(s, 'elevationDeg', 0, 89, 0.5);
        folder.add(s, 'shadowDeg', 0.5, 20, 0.1);
        folder.add(s, 'regionScale', 2, 10, 0.1);
        folder.add(s, 'inclinationDeg', 0, 90, 0.5);
        folder.add(s, 'rollDeg', -90, 90, 0.5);
        folder.add(s, 'discInner', 2.5, 10, 0.1);
        folder.add(s, 'discOuter', 6, 40, 0.5);
        folder.add(s, 'spin', -1, 1, 0.01);
        folder.add(s, 'discSpeed', 0, 2, 0.01);
        folder.add(s, 'discBrightness', 0, 5, 0.01);
        folder.add(s, 'beaming', 0, 4, 0.05);
        folder.add(s, 'lightStrength', 0, 3, 0.01);
        folder.add(s, 'waterScatter', 0, 2, 0.01);
        folder.addColor(s, 'hotColor');
        folder.addColor(s, 'warmColor');
        folder.addColor(s, 'coolColor');
    }
}
