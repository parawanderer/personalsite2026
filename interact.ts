import { Camera, Vector3 } from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import GUI from "three/addons/libs/lil-gui.module.min.js";

import { FlightSettings } from "./constants";


const UP = new Vector3(0, 1, 0);

/**
 * Free flight: Minecraft style mouse look (pointer lock) with WASD to move horizontally and Space/Shift to rise/sink
 */
export class InteractionManager {
    private readonly look: PointerLockControls;
    private readonly pressed = new Set<string>();
    private readonly velocity = new Vector3();
    private movementEnabled = false;

    constructor(private readonly camera: Camera, domElement: HTMLElement, private readonly settings: FlightSettings) {
        this.look = new PointerLockControls(camera, domElement);

        // browsers only grant pointer lock from a click, Esc releases it
        domElement.addEventListener("click", () => {
            if (this.movementEnabled && !this.look.isLocked) this.look.lock();
        });

        document.addEventListener("keydown", (event) => {
            if (!this.movementEnabled || InteractionManager.isTyping(event)) return;
            this.pressed.add(event.code);
            if (event.code === "Space") event.preventDefault(); // don't scroll/press the focused button
        });
        document.addEventListener("keyup", (event) => this.pressed.delete(event.code));
        window.addEventListener("blur", () => this.pressed.clear());
    }

    public update(delta: number): void {
        const s = this.settings;
        this.look.pointerSpeed = s.lookSensitivity;

        const target = new Vector3();
        if (this.movementEnabled) {
            const forward = this.camera.getWorldDirection(new Vector3()).setY(0).normalize();
            const right = new Vector3().crossVectors(forward, UP).normalize();

            target.addScaledVector(forward, this.axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]));
            target.addScaledVector(right, this.axis(["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]));
            if (target.lengthSq() > 0) target.normalize().multiplyScalar(s.moveSpeed);
            target.y = this.axis(["Space"], ["ShiftLeft", "ShiftRight"]) * s.verticalSpeed;
        }

        // ease towards the target velocity, independent of frame rate
        const k = 1 - Math.exp(-delta / Math.max(s.smoothing, 0.001));
        this.velocity.lerp(target, k);
        this.camera.position.addScaledVector(this.velocity, delta);
    }

    public setMovementEnabled(isEnabled: boolean) {
        this.movementEnabled = isEnabled;
        if (!isEnabled) {
            this.pressed.clear();
            this.velocity.set(0, 0, 0);
            if (this.look.isLocked) this.look.unlock();
        }
    }

    public bindTweaks(folder: GUI): void {
        folder.add(this.settings, "moveSpeed", 0.1, 10, 0.1);
        folder.add(this.settings, "verticalSpeed", 0.1, 10, 0.1);
        folder.add(this.settings, "lookSensitivity", 0.1, 3, 0.05);
        folder.add(this.settings, "smoothing", 0, 1, 0.01);
    }

    private axis(positive: string[], negative: string[]): number {
        const down = (codes: string[]) => codes.some((c) => this.pressed.has(c)) ? 1 : 0;
        return down(positive) - down(negative);
    }

    private static isTyping(event: KeyboardEvent): boolean {
        const target = event.target as HTMLElement | null;
        return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    }
}
