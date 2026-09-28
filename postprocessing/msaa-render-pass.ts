import { AlwaysDepth, Camera, DepthTexture, HalfFloatType, Scene, ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';

/**
 * Renders the scene multisampled (antialiased edges), then copies its colour and depth into the composer's plain
 * buffers, so only this render pays for the extra samples and not every pass after it (which read that depth).
 */
export class MsaaRenderPass extends Pass {
    private readonly target: WebGLRenderTarget;
    private readonly copy: ShaderMaterial;
    private readonly quad: FullScreenQuad;

    constructor(private readonly scene: Scene, private readonly camera: Camera, samples: number) {
        super();
        this.needsSwap = false;
        this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples });
        this.target.depthTexture = new DepthTexture(1, 1);
        this.copy = new ShaderMaterial({
            uniforms: { tColor: { value: this.target.texture }, tDepth: { value: this.target.depthTexture } },
            vertexShader: /* glsl */ `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform sampler2D tColor;
                uniform sampler2D tDepth;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = texture2D(tColor, vUv);
                    gl_FragDepth = texture2D(tDepth, vUv).x;
                }
            `,
            depthTest: true,
            depthWrite: true,
        });
        // always passes, so the copied depth lands whatever was there
        this.copy.depthFunc = AlwaysDepth;
        this.quad = new FullScreenQuad(this.copy);
    }

    public setSize(width: number, height: number): void {
        this.target.setSize(width, height);
    }

    public render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
        renderer.setRenderTarget(this.target);
        renderer.clear();
        renderer.render(this.scene, this.camera);
        // into the buffer the next pass reads, like three's RenderPass (which draws into readBuffer)
        renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
        renderer.clear();
        this.quad.render(renderer);
    }

    public dispose(): void {
        this.target.dispose();
        this.copy.dispose();
        this.quad.dispose();
    }
}
