import { Camera, Raycaster, Vector2, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { smoothstep } from 'three/src/math/MathUtils.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { WaterTouchSettings } from '../constants';
import { TOUCH_POINTS } from '../shaders/water-interaction.glsl';
import { Walls } from './walls';
import { Water, WATER_LEVEL_Y } from './water';

// a soft ring for the cursor over the water, so it's discoverable without any hint text
const RING_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="7" fill="none" stroke="white" stroke-opacity="0.8" stroke-width="1.5"/></svg>',
)}") 12 12, pointer`;

// how far away the water can still be pressed
const MAX_DISTANCE = 60;

interface TouchPoint {
    x: number;
    z: number;
    /** when it was made, and when it was last held (it refills from then on) */
    created: number;
    held: number;
}

/**
 * Pressing on the water with the cursor: holding the button down dents the surface where it points, with a little
 * raised lip around it like the water has against the pillars, and dragging leaves a trough that slowly refills. Pressing
 * down sends out a small ring. Only the water responds: pointing at a pillar (or past one), or at the UI, does nothing.
 */
export class WaterTouch implements AnimatedEntity {
    private readonly raycaster = new Raycaster();
    private readonly pointer = new Vector2();
    /** the element the pointer was last over, to tell the scene from the UI */
    private target: EventTarget | null = null;
    private dirty = false;
    private pressing = false;
    private readonly trail: TouchPoint[] = [];
    private ringStart = -1e3;

    /**
     * @param enabled whether it responds right now (not in free flight, where clicking looks around)
     */
    constructor(
        private readonly camera: Camera,
        private readonly canvas: HTMLCanvasElement,
        private readonly water: Water,
        private readonly walls: Walls,
        private readonly settings: WaterTouchSettings,
        private readonly enabled: () => boolean,
    ) {
        document.addEventListener('pointermove', (e) => this.track(e));
        document.addEventListener('pointerdown', (e) => {
            this.track(e);
            if (e.button !== 0 || !this.active()) return;
            const hit = this.pick();
            if (!hit) return;
            this.pressing = true;
            this.press(hit, true);
            this.ringStart = this.now();
            this.water.touchUniforms.ringCenter.set(hit.x, hit.z);
        });
        const release = () => {
            this.pressing = false;
            this.canvas.style.cursor = '';
        };
        document.addEventListener('pointerup', release);
        document.addEventListener('pointercancel', release);
        window.addEventListener('blur', release);
    }

    private now(): number {
        return performance.now() / 1000;
    }

    private track(e: PointerEvent): void {
        // the scene fills the window (its camera's aspect comes from the window, not the canvas element's box)
        this.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
        this.target = e.target;
        this.dirty = true;
    }

    /** on and pointing at the scene, not the UI */
    private active(): boolean {
        if (!this.settings.enabled || !this.enabled()) return false;
        const t = this.target as Element | null;
        return t === this.canvas || !!t?.closest?.('.window-outline');
    }

    /** where on the water the pointer is, unless a pillar is in the way */
    private pick(): Vector3 | null {
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const { origin, direction } = this.raycaster.ray;
        if (direction.y >= -1e-4) return null;
        const t = (WATER_LEVEL_Y - origin.y) / direction.y;
        if (t > MAX_DISTANCE) return null;
        const hit = origin.clone().addScaledVector(direction, t);
        return this.walls.blocksLine(origin, hit) ? null : hit;
    }

    /** holds the dent at `at`, starting a new trail point once it's moved far enough from the last */
    private press(at: Vector3, fresh: boolean): void {
        const now = this.now();
        const head = this.trail[this.trail.length - 1];
        if (fresh || !head || Math.hypot(at.x - head.x, at.z - head.z) >= this.settings.trailSpacing) {
            this.trail.push({ x: at.x, z: at.z, created: now, held: now });
            if (this.trail.length > TOUCH_POINTS) this.trail.shift();
        } else {
            head.x = at.x;
            head.z = at.z;
            head.held = now;
        }
    }

    public update(): void {
        const s = this.settings;
        const now = this.now();

        if (this.dirty) {
            this.dirty = false;
            const hit = this.active() ? this.pick() : null;
            if (this.pressing && hit) this.press(hit, false);
            this.canvas.style.cursor = hit ? RING_CURSOR : '';
        } else if (this.pressing) {
            // held still: keep the dent where it is
            const head = this.trail[this.trail.length - 1];
            if (head) head.held = now;
        }

        const u = this.water.touchUniforms;
        u.radius.value = s.radius;
        u.depth.value = s.depth;
        u.lip.value = s.lip;
        u.ringHeight.value = s.ringHeight;
        u.ringAge.value = now - this.ringStart;
        for (let k = 0; k < TOUCH_POINTS; k++) {
            const p = this.trail[k];
            if (!p) {
                u.points[k].set(0, 0, 0);
                continue;
            }
            // presses in quickly, and refills slowly once let go (or left behind)
            const pressIn = Math.min((now - p.created) / Math.max(s.pressSeconds, 1e-3), 1);
            const refill = smoothstep(now - p.held, 0, Math.max(s.refillSeconds, 1e-3));
            u.points[k].set(p.x, p.z, pressIn * (1 - refill));
        }
        // forget points that have refilled
        while (this.trail.length && now - this.trail[0].held > s.refillSeconds && !(this.pressing && this.trail.length === 1)) {
            this.trail.shift();
        }
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        folder.add(s, 'enabled');
        folder.add(s, 'radius', 0.02, 1, 0.005);
        folder.add(s, 'depth', 0, 0.3, 0.002);
        folder.add(s, 'lip', 0, 1, 0.01);
        folder.add(s, 'pressSeconds', 0.01, 2, 0.01);
        folder.add(s, 'refillSeconds', 0.1, 15, 0.1);
        folder.add(s, 'trailSpacing', 0.01, 1, 0.005);
        folder.add(s, 'ringHeight', 0, 0.1, 0.001);
        folder.add(s, 'particlePushRadius', 0.02, 2, 0.01);
        folder.add(s, 'particlePush', 0, 1.1, 0.01);
    }
}
