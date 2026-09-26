import GUI from 'three/addons/libs/lil-gui.module.min.js';

import { GrainStyle } from '../constants';
import { getByIdOrThrow } from '../utils/document';


interface EdgeLook {
    softness: number;
    edgeGrain: number;
    fineGrain: number;
}

/**
 * The tweakable primitives of one grain filter in index.html
 */
class GrainFilter {
    private readonly soft: SVGFEGaussianBlurElement;
    private readonly colorBlur: SVGFEGaussianBlurElement;
    private readonly mask: SVGFECompositeElement;
    private readonly texture: SVGFECompositeElement;
    public readonly edgeNoise: SVGFETurbulenceElement;
    public readonly fineNoise: SVGFETurbulenceElement;

    constructor(id: string) {
        const filter = getByIdOrThrow<SVGFilterElement>(id);
        const role = <T extends Element>(name: string): T => {
            const el = filter.querySelector<T>(`[data-role="${name}"]`);
            if (el === null) throw new Error(`Filter '${id}' has no '${name}' primitive`);
            return el;
        };
        this.soft = role('soft');
        this.colorBlur = role('color-blur');
        this.mask = role('mask');
        this.texture = role('texture');
        this.edgeNoise = role('edge-noise');
        this.fineNoise = role('fine-noise');
    }

    public apply(look: EdgeLook, style: GrainStyle): void {
        this.soft.setAttribute('stdDeviation', String(look.softness));
        this.colorBlur.setAttribute('stdDeviation', String(look.softness));

        // alpha = slope * (soft - edgeGrain * noise) centred so soft = noise = 0.5 lands on 0.5
        const slope = style.edgeContrast;
        this.mask.setAttribute('k2', String(slope));
        this.mask.setAttribute('k3', String(-slope * look.edgeGrain));
        this.mask.setAttribute('k4', String(0.5 - slope * 0.5 + slope * look.edgeGrain * 0.5));

        this.edgeNoise.setAttribute('baseFrequency', String(style.edgeGrainScale));
        this.fineNoise.setAttribute('baseFrequency', String(style.fineGrainScale));
        this.texture.setAttribute('k1', String(-look.fineGrain));
    }
}


/**
 * Drives the grain SVG filters (index.html) and the CSS variables used by .grain-button
 */
export class Grain {
    private readonly idle = new GrainFilter('grain-edge');
    private readonly crisp = new GrainFilter('grain-edge-crisp');

    private animationTimer?: number;
    private seed = 1;

    constructor(private readonly style: GrainStyle) {
        this.apply();
    }

    private fillOverride?: string;

    /**
     * Overrides the fill colour (the day/night cycle shifts it); only touches the page when the colour changes
     */
    public setFillColor(hex: string): void {
        if (hex === this.fillOverride) return;
        this.fillOverride = hex;
        document.documentElement.style.setProperty('--grain-fill-color', hex);
    }

    public apply(): void {
        const s = this.style;
        const root = document.documentElement.style;
        root.setProperty('--grain-fill-color', this.fillOverride ?? s.fillColor);
        root.setProperty('--grain-fill-opacity', String(s.fillOpacity));
        root.setProperty('--grain-fill-opacity-hover', String(s.fillOpacityHover));
        root.setProperty('--grain-hover-transition', `${s.hoverTransitionMs}ms`);

        this.idle.apply({ softness: s.edgeSoftness, edgeGrain: s.edgeGrain, fineGrain: s.fineGrain }, s);
        this.crisp.apply({ softness: s.hoverEdgeSoftness, edgeGrain: s.hoverEdgeGrain, fineGrain: s.hoverFineGrain }, s);

        this.updateAnimation();
    }

    public bindTweaks(folder: GUI): void {
        const apply = () => this.apply();
        const s = this.style;

        folder.addColor(s, 'fillColor').onChange(apply);
        folder.add(s, 'fillOpacity', 0, 1, 0.01).onChange(apply);
        folder.add(s, 'fillOpacityHover', 0, 1, 0.01).onChange(apply);
        folder.add(s, 'edgeSoftness', 0, 20, 0.5).onChange(apply);
        folder.add(s, 'edgeContrast', 1, 12, 0.1).onChange(apply);
        folder.add(s, 'edgeGrain', 0, 1, 0.01).onChange(apply);
        folder.add(s, 'edgeGrainScale', 0.05, 3, 0.05).onChange(apply);
        folder.add(s, 'fineGrain', 0, 1, 0.01).onChange(apply);
        folder.add(s, 'fineGrainScale', 0.05, 3, 0.05).onChange(apply);
        folder.add(s, 'hoverEdgeSoftness', 0, 20, 0.5).onChange(apply);
        folder.add(s, 'hoverEdgeGrain', 0, 1, 0.01).onChange(apply);
        folder.add(s, 'hoverFineGrain', 0, 1, 0.01).onChange(apply);
        folder.add(s, 'hoverTransitionMs', 0, 2000, 10).onChange(apply);
        folder.add(s, 'animate').onChange(apply);
        folder.add(s, 'animateFps', 1, 30, 1).onChange(apply);
    }

    private updateAnimation(): void {
        window.clearInterval(this.animationTimer);
        this.animationTimer = undefined;
        if (!this.style.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        this.animationTimer = window.setInterval(() => {
            this.seed = (this.seed % 1000) + 1;
            for (const filter of [this.idle, this.crisp]) {
                filter.edgeNoise.setAttribute('seed', String(this.seed));
                filter.fineNoise.setAttribute('seed', String(this.seed + 1000));
            }
        }, 1000 / this.style.animateFps);
    }
}
