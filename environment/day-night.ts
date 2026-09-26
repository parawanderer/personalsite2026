import { Color, ColorRepresentation } from 'three';
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { smoothstep } from 'three/src/math/MathUtils.js';

import { AnimatedEntity } from '../entity/animated-entity';
import { DayNightSettings } from '../constants';

type ColorKey = { [K in keyof DayNightSettings]: DayNightSettings[K] extends string ? K : never }[keyof DayNightSettings];
type NumberKey = { [K in keyof DayNightSettings]: DayNightSettings[K] extends number ? K : never }[keyof DayNightSettings];

interface ColorTarget {
    target: Color;
    day: () => ColorRepresentation;
    night: ColorKey;
}

interface NumberTarget {
    set: (value: number) => void;
    day: () => number;
    night: NumberKey;
}

const DAY = new Color();
const NIGHT = new Color();

/**
 * Blends the scene between day and night by the time of day. The day values are whatever the scene is set to (its
 * constants and tweak folders), the night values live in this folder, so there's one place to tune each.
 * Updated every frame, after everything else has set its day values.
 */
export class DayNight implements AnimatedEntity {
    private readonly colors: ColorTarget[] = [];
    private readonly numbers: NumberTarget[] = [];

    constructor(private readonly settings: DayNightSettings) {}

    /** 0 in full day, 1 in full night, easing through dawn (5-8h) and dusk (17-20h) */
    public get nightAmount(): number {
        const h = this.settings.hour;
        return 1 - (smoothstep(h, 5, 8) - smoothstep(h, 17, 20));
    }

    public color(target: Color, day: () => ColorRepresentation, night: ColorKey): this {
        this.colors.push({ target, day, night });
        return this;
    }

    public number(set: (value: number) => void, day: () => number, night: NumberKey): this {
        this.numbers.push({ set, day, night });
        return this;
    }

    public update(): void {
        const n = this.nightAmount;
        for (const c of this.colors) {
            DAY.set(c.day());
            NIGHT.set(this.settings[c.night]);
            // blended in linear space, like light
            c.target.copy(DAY).lerp(NIGHT, n);
        }
        for (const v of this.numbers) {
            const day = v.day();
            v.set(day + (this.settings[v.night] - day) * n);
        }
    }

    /** the time of day slider, in a folder of its own choosing */
    public bindHourTweak(folder: GUI, onChange: () => void): { updateDisplay(): unknown } {
        return folder.add(this.settings, 'hour', 0, 24, 0.05).name('time of day (h)').onChange(onChange);
    }

    /** the visitor's own time of day, in hours */
    public static localHour(): number {
        const d = new Date();
        return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    }

    /** moves the time of day on, wrapping around midnight */
    public advance(hours: number): void {
        this.settings.hour = (((this.settings.hour + hours) % 24) + 24) % 24;
    }

    public bindTweaks(folder: GUI): void {
        const s = this.settings;
        for (const key of Object.keys(s) as (keyof DayNightSettings)[]) {
            if (key === 'hour') continue;
            if (typeof s[key] === 'string') folder.addColor(s, key);
            else folder.add(s as unknown as Record<string, number>, key, 0, key.endsWith('Scale') ? 2 : key.endsWith('Floor') ? 0.2 : key.endsWith('Power') ? 10 : key.endsWith('Strength') ? 6 : key.endsWith('Grey') ? 3 : key.endsWith('Speed') ? 2 : 3, key.endsWith('Floor') ? 0.001 : 0.01);
        }
    }
}
