import Stats from 'three/addons/libs/stats.module.js';
import { CoordsDisplay } from './coords-display';
import { Camera } from 'three';

/**
 * Debugging overlays: the frame rate (three's stats panel, click it to switch to frame time or memory), and with
 * `showCoords` the camera's coordinates
 */
export class DebugInfoDisplay {
    private stats?: Stats;
    private coords?: CoordsDisplay;

    constructor(enabled: boolean, camera: Camera, showCoords: boolean) {
        if (enabled) {
            this.stats = new Stats();
            this.stats.dom.id = 'fpsCounter';
            document.body.appendChild(this.stats.dom);
        }
        if (showCoords) this.coords = new CoordsDisplay(camera);
    }

    public update() {
        this.stats?.update();
        this.coords?.update();
    }
}