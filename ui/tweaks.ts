import GUI from 'three/addons/libs/lil-gui.module.min.js';

const STORAGE_PREFIX = 'tweaks:';

const load = (name: string): object | null => {
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + name);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const save = (name: string, params: object) => {
    try {
        localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(params));
    } catch {
        // storage unavailable, tweaks just won't persist
    }
};

/**
 * Hand-tweaking panel (three's bundled lil-gui). Enable with `?tweaks` in the URL or DEBUG.
 *
 * Values changed in the panel persist in localStorage so they survive reloads.
 * "Copy values" puts the current values on the clipboard to paste back into constants.ts.
 * When disabled, every folder simply gets its defaults.
 */
export class Tweaks {
    private readonly gui?: GUI;
    private readonly folders = new Map<string, object>();

    constructor(enabled: boolean) {
        if (!enabled) return;

        this.gui = new GUI({ title: 'Tweaks' });
        this.gui.add({ copy: () => this.copyValues() }, 'copy').name('Copy values');
        this.gui.add({ reset: () => this.resetAll() }, 'reset').name('Reset all (reloads)');
    }

    /**
     * @returns the (possibly persisted) params and, when enabled, the folder to add controllers to.
     * Controllers added to the folder persist their value on change.
     */
    public addFolder<T extends object>(name: string, defaults: T): { params: T, folder?: GUI } {
        const params: T = { ...defaults };
        this.folders.set(name, params);

        if (!this.gui) return { params };

        Object.assign(params, load(name) ?? {});

        const folder = this.gui.addFolder(name);
        // onChange also covers values set from code (lil-gui's setValue doesn't fire onFinishChange)
        folder.onChange(() => save(name, params));

        return { params, folder };
    }

    private copyValues() {
        const values: Record<string, object> = {};
        this.folders.forEach((params, name) => values[name] = params);
        const json = JSON.stringify(values, null, 4);
        console.log(json);
        navigator.clipboard?.writeText(json).catch(() => {});
    }

    private resetAll() {
        for (const name of this.folders.keys()) {
            try {
                localStorage.removeItem(STORAGE_PREFIX + name);
            } catch {
                // nothing to clear
            }
        }
        location.reload();
    }
}
