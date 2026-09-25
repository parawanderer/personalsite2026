import { Camera, Vector3 } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';


const DIGITS = 4;
const fmt = (v: Vector3) => `${v.x.toFixed(DIGITS)}, ${v.y.toFixed(DIGITS)}, ${v.z.toFixed(DIGITS)}`;

/**
 * Shows the live camera position/direction and copies the current view as CAMERA_HOME_POS/CAMERA_HOME_DIR for constants.ts
 */
export class CameraTweaks {
    constructor(private readonly camera: Camera, private readonly goHome: () => void) {}

    public bind(folder: GUI): void {
        const camera = this.camera;
        const live = {
            get position() { return fmt(camera.position); },
            get direction() { return fmt(camera.getWorldDirection(new Vector3())); },
        };

        folder.add(live, 'position').listen().disable();
        folder.add(live, 'direction').listen().disable();
        folder.add({ copy: () => this.copyHomeView() }, 'copy').name('Copy as home view');
        folder.add({ home: () => this.goHome() }, 'home').name('Fly to current home');
    }

    private copyHomeView(): void {
        const pos = this.camera.position;
        // constants.ts stores the point the camera looks at, one unit ahead
        const target = this.camera.getWorldDirection(new Vector3()).add(pos);
        const v = (x: Vector3) => `new Vector3(${x.x.toFixed(DIGITS)}, ${x.y.toFixed(DIGITS)}, ${x.z.toFixed(DIGITS)})`;
        const code = `export const CAMERA_HOME_POS = ${v(pos)};\nexport const CAMERA_HOME_DIR = ${v(target)};`;

        console.log(code);
        navigator.clipboard?.writeText(code).catch(() => {});
    }
}
