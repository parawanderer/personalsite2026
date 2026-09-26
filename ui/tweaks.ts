import GUI from 'three/addons/libs/lil-gui.module.min.js';

const STORAGE_PREFIX = 'tweaks:';
// which folders are collapsed, by folder title
const COLLAPSED_KEY = 'tweaks-ui:collapsed';

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

const loadCollapsed = (): Record<string, boolean> => {
    try {
        return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}');
    } catch {
        return {};
    }
};

/**
 * Restores a folder's collapsed state and keeps it saved. lil-gui has no open/close event, so this watches the
 * `closed` class it toggles, which covers clicks, keyboard and animated toggling alike.
 */
const rememberCollapsed = (gui: GUI, title: string) => {
    const collapsed = loadCollapsed();
    if (title in collapsed) gui.open(!collapsed[title]);

    new MutationObserver(() => {
        const state = loadCollapsed();
        state[title] = gui.domElement.classList.contains('closed');
        try {
            localStorage.setItem(COLLAPSED_KEY, JSON.stringify(state));
        } catch {
            // storage unavailable, the layout just won't persist
        }
    }).observe(gui.domElement, { attributes: true, attributeFilter: ['class'] });
};

/**
 * Hand-tweaking panel (three's bundled lil-gui). Enable with `?tweaks` in the URL or DEBUG.
 *
 * Values changed in the panel, and which folders are collapsed, persist in localStorage so they survive reloads.
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
        rememberCollapsed(this.gui, 'Tweaks');
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
        rememberCollapsed(folder, name);
        // onChange also covers values set from code (lil-gui's setValue doesn't fire onFinishChange)
        folder.onChange(() => save(name, params));

        return { params, folder };
    }

    /**
     * Saves a folder's values now, for controllers that live in another folder than their values
     */
    public persist(name: string): void {
        const params = this.folders.get(name);
        if (this.gui && params) save(name, params);
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
