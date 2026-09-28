import { Vector2 } from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// a B-spline bicubic lookup from four bilinear ones: smooth where plain bilinear scaling of a small texture shows its
// texels as soft squares
const bicubic = /* glsl */ `
vec4 bloomCubic(float v) {
    vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
    vec4 s = n * n * n;
    float x = s.x;
    float y = s.y - 4.0 * s.x;
    float z = s.z - 4.0 * s.y + 6.0 * s.x;
    return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}

vec3 bloomBicubic(sampler2D tex, vec2 uv) {
    vec2 size = vec2(textureSize(tex, 0));
    uv = uv * size - 0.5;
    vec2 f = fract(uv);
    uv -= f;
    vec4 xc = bloomCubic(f.x);
    vec4 yc = bloomCubic(f.y);
    vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
    vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
    vec4 offset = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
    vec3 s0 = texture2D(tex, offset.xz).rgb;
    vec3 s1 = texture2D(tex, offset.yz).rgb;
    vec3 s2 = texture2D(tex, offset.xw).rgb;
    vec3 s3 = texture2D(tex, offset.yw).rgb;
    float sx = s.x / (s.x + s.y);
    float sy = s.z / (s.z + s.w);
    return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
`;

/**
 * three's bloom, but its blurred levels (down to 1/32 of the screen) are scaled back up smoothly: plain bilinear
 * scaling showed the smallest ones as a grid of soft squares over smooth gradients like the sun's halo. And with a
 * soft threshold (knee).
 */
export class SmoothBloomPass extends UnrealBloomPass {
    constructor(resolution: Vector2, strength: number, radius: number, threshold: number) {
        super(resolution, strength, radius, threshold);
        const material = this.compositeMaterial;
        let shader = material.fragmentShader.replace('void main() {', `${bicubic}\nvoid main() {`);
        for (let i = 1; i <= 5; i++) shader = shader.replace(`texture2D( blurTexture${i}, vUv ).rgb`, `bloomBicubic( blurTexture${i}, vUv )`);
        if (shader.includes('texture2D( blurTexture')) console.warn('SmoothBloomPass: the bloom composite shader changed, some levels are still scaled bilinearly');
        material.fragmentShader = shader;
        material.needsUpdate = true;
    }

    /**
     * how gradually things start to bloom above the threshold (in brightness): three's default of 0.01 is almost a
     * hard cut, which turns the part of a smooth glow (like the sun's halo) above it into a flat disc with an edge
     */
    public set knee(width: number) {
        (this.highPassUniforms as { smoothWidth: { value: number } }).smoothWidth.value = Math.max(width, 0.001);
    }
}
