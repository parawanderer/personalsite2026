import { BufferAttribute, BufferGeometry, Color, NormalBlending, Points, ShaderMaterial, Vector3 } from 'three';

import { ShootingStarSettings } from '../constants';

// enough for the count slider's maximum; the slider only changes how many are drawn
const MAX_PUFFS = 2000;

const mistMaterial = () => new ShaderMaterial({
    uniforms: {
        age: { value: 1e3 },
        height: { value: 1 },
        spread: { value: 1 },
        size: { value: 1 },
        seconds: { value: 1 },
        drag: { value: 1 },
        gravity: { value: 1 },
        opacity: { value: 1 },
        color: { value: new Color() },
        // how lit it is: a little on its own, much more while the impact's light is on it
        light: { value: 0 },
        // pixels per world unit at distance 1
        pixelScale: { value: 1 },
    },
    vertexShader: /* glsl */ `
        uniform float age;
        uniform float height;
        uniform float spread;
        uniform float size;
        uniform float seconds;
        uniform float drag;
        uniform float gravity;
        uniform float pixelScale;
        // x: angle around the impact, y: how far out, z: how far up (both as a fraction of spread and height),
        // w: which part of the splash it's in (0 column, 1 crown, 2 base)
        attribute vec4 throwDir;
        // x: delay before it's thrown, y: lifetime (fraction of seconds), z: size, w: brightness
        attribute vec4 puff;
        varying float vAlpha;
        varying float vBrightness;
        varying float vLocalY;
        varying float vRadius;
        varying vec2 vSeed;

        void main() {
            float t = age - puff.x;
            float life = seconds * puff.y;
            if (t <= 0.0 || t >= life) {
                gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                gl_PointSize = 0.0;
                return;
            }
            // thrown out against a strong drag, so it rises and spreads fast, then hangs and settles slowly:
            // with drag k it travels about v0 / k, so the speeds are set from how far it should get
            float k = max(drag, 0.05);
            float travelled = (1.0 - exp(-k * t)) / k;
            vec2 dir = vec2(cos(throwDir.x), sin(throwDir.x));
            vec3 v0 = vec3(dir * throwDir.y * spread * k, throwDir.z * height * k);
            vec3 p = vec3(v0.x * travelled, v0.z * travelled - gravity / k * (t - travelled), v0.y * travelled);
            // starts from a patch of the surface, not a single point
            p.xz += dir * 0.15 * spread * (throwDir.w == 2.0 ? 1.0 : 0.3);

            float x = t / life;
            // puffs swell as the mist thins out
            float worldSize = size * puff.z * (0.5 + 0.9 * sqrt(x));
            vAlpha = smoothstep(0.0, 0.06, x) * pow(1.0 - x, 1.3);
            // lit from above and outside: the low middle of the plume is in its own shadow
            float outside = smoothstep(0.0, spread * 0.6, length(p.xz));
            vBrightness = puff.w * (0.35 + 0.45 * smoothstep(0.0, height * 0.8, p.y) + 0.3 * outside);
            vLocalY = p.y;
            vRadius = worldSize * 0.5;
            vSeed = throwDir.xy * 17.0 + puff.zw * 31.0;

            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = worldSize * pixelScale / max(-mv.z, 0.1);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform float opacity;
        uniform vec3 color;
        uniform float light;
        varying float vAlpha;
        varying float vBrightness;
        varying float vLocalY;
        varying float vRadius;
        varying vec2 vSeed;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
            vec2 c = gl_PointCoord * 2.0 - 1.0;
            // the splash sits on the water: nothing of it below the surface
            float y = vLocalY - c.y * vRadius;
            if (y < 0.0) discard;
            float r2 = dot(c, c);
            if (r2 >= 1.0) discard;
            // a soft, lumpy puff, so stacked puffs build up into a billowing mass
            float lumps = 0.55 * noise(c * 3.0 + vSeed) + 0.3 * noise(c * 7.0 - vSeed) + 0.15 * noise(c * 15.0 + vSeed.yx);
            // cauliflower edges: the lumps eat into the soft outline, and the inside stays fairly solid
            float body = smoothstep(0.0, 0.35, (1.0 - r2) * 0.9 + (lumps - 0.5) * 0.9);
            float a = body * vAlpha * opacity;
            // lighter on top, where the light catches it
            float shade = vBrightness * (0.7 + 0.3 * -c.y) * (0.8 + 0.4 * lumps);
            gl_FragColor = vec4(color * light * shade, clamp(a, 0.0, 1.0));
        }
    `,
    transparent: true,
    blending: NormalBlending,
    depthWrite: false,
    fog: false,
});

/**
 * The bulk of a splashdown: hundreds of lumpy, overlapping puffs of spray that pile up into a white mass, thrown in
 * jets (a few tall ones in the middle, the rest outwards like a crown) over a low skirt of spray, then hang and thin out.
 * Their paths are worked out on the GPU from when they were thrown, so there's nothing to update per puff.
 */
export class SplashMist {
    public readonly points: Points<BufferGeometry, ShaderMaterial>;
    private start = -1e3;

    private readonly throwDir = new BufferAttribute(new Float32Array(MAX_PUFFS * 4), 4);
    private readonly puff = new BufferAttribute(new Float32Array(MAX_PUFFS * 4), 4);

    constructor(private readonly settings: ShootingStarSettings) {
        const geometry = new BufferGeometry();
        // the positions are worked out in the shader; this only gives three.js a vertex count
        geometry.setAttribute('position', new BufferAttribute(new Float32Array(MAX_PUFFS * 3), 3));
        geometry.setAttribute('throwDir', this.throwDir);
        geometry.setAttribute('puff', this.puff);

        this.points = new Points(geometry, mistMaterial());
        this.points.frustumCulled = false;
        this.points.visible = false;
        // over the water, which would otherwise draw over the parts of it that are in front of the surface behind
        this.points.renderOrder = 2;
    }

    public splash(at: Vector3, now: number): void {
        this.points.position.copy(at);
        this.start = now;
        this.throwPuffs();
    }

    /**
     * Spray comes out in jets, not evenly: each puff belongs to one of a handful of jets, thrown along roughly the
     * same path but at different speeds, so the plume breaks up into streaks and clumps with gaps between them.
     * Picked again for every splash, so no two look alike.
     */
    private throwPuffs(): void {
        const jets = Math.max(1, Math.round(this.settings.splashMistJets));
        // x: angle, y: out, z: up, w: part
        const jet: number[][] = [];
        for (let j = 0; j < jets; j++) {
            const column = j < Math.max(1, Math.round(jets * 0.3));
            jet.push(column
                ? [Math.random() * Math.PI * 2, Math.random() * 0.15, 0.7 + Math.random() * 0.3, 0]
                : [Math.random() * Math.PI * 2, 0.4 + Math.random() * 0.5, 0.25 + Math.random() * 0.45, 1]);
        }
        const throwDir = this.throwDir.array as Float32Array;
        const puff = this.puff.array as Float32Array;
        for (let k = 0; k < MAX_PUFFS; k++) {
            const size = 0.6 + Math.random() * 0.6;
            const brightness = 0.6 + Math.random() * 0.4;
            if (Math.random() < 0.12) {
                // base: a low skirt of spray over the water right around the impact, the last to go
                throwDir.set([Math.random() * Math.PI * 2, 0.3 + Math.random() * 0.5, 0.02 + Math.random() * 0.1, 2], k * 4);
                puff.set([0.05 + Math.random() * 0.3, 0.7 + Math.random() * 0.3, size * 1.3, brightness * 0.8], k * 4);
                continue;
            }
            const [angle, out, up, part] = jet[Math.floor(Math.random() * jets)];
            // spread along the jet: the slower ones trail behind and below the leading edge, making a streak
            const along = 0.35 + Math.pow(Math.random(), 0.6) * 0.65;
            throwDir.set([
                angle + (Math.random() - 0.5) * 0.35,
                (out + (Math.random() - 0.5) * 0.12) * along,
                up * along * (0.9 + Math.random() * 0.2),
                part,
            ], k * 4);
            // the leading, fastest puffs are the brightest
            puff.set([Math.random() * 0.1, 0.5 + Math.random() * 0.45, size, brightness * (0.7 + 0.3 * along)], k * 4);
        }
        this.throwDir.needsUpdate = true;
        this.puff.needsUpdate = true;
    }

    /**
     * @param light how strongly the impact's light is on it right now, 0 to 1
     * @param pixelScale pixels per world unit at distance 1 (drawing buffer height times the projection's y scale / 2)
     */
    public update(now: number, light: number, night: number, pixelScale: number): void {
        const s = this.settings;
        const age = now - this.start;
        const u = this.points.material.uniforms;
        // the longest-lived puffs are thrown late and live the full time
        this.points.visible = age < s.splashMistSeconds * 1.5 && s.splashMistCount > 0;
        if (!this.points.visible) return;
        this.points.geometry.setDrawRange(0, Math.min(Math.round(s.splashMistCount), MAX_PUFFS));
        u.age.value = age;
        u.height.value = s.splashMistHeight;
        u.spread.value = s.splashMistSpread;
        u.size.value = s.splashMistSize;
        u.seconds.value = s.splashMistSeconds;
        u.drag.value = s.splashMistDrag;
        u.gravity.value = s.splashMistGravity;
        u.opacity.value = s.splashMistOpacity * night;
        u.color.value.set(s.color);
        u.light.value = s.splashMistAmbient + s.splashMistFlashLit * light;
        u.pixelScale.value = pixelScale;
    }
}
