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

const CHANGED_CLASS = 'tweak-changed';
const CHANGED_STYLE = `
.lil-gui .controller.${CHANGED_CLASS} > .name { color: #ffd84a; }
.lil-gui .controller .tweak-reset {
    display: none;
    margin-right: 4px;
    padding: 0 3px;
    border: none;
    border-radius: 2px;
    background: none;
    color: inherit;
    font: inherit;
    line-height: 1;
    cursor: pointer;
}
.lil-gui .controller.${CHANGED_CLASS} .tweak-reset { display: inline-block; }
.lil-gui .controller .tweak-reset:hover { background: rgba(255, 216, 74, 0.2); }
`;

type Controller = ReturnType<GUI['controllersRecursive']>[number];

/** for values picked at runtime (like a random seed), which would otherwise always show as changed */
export const skipChangedHighlight = (controller: { domElement: HTMLElement }): void => {
    controller.domElement.dataset.noDefault = '';
};

const sameValue = (a: unknown, b: unknown): boolean => {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
    return a === b;
};

/**
 * Hand-tweaking panel (three's bundled lil-gui). Enable with `?tweaks` in the URL or DEBUG.
 *
 * Values changed in the panel, and which folders are collapsed, persist in localStorage so they survive reloads.
 * The names of controls whose value differs from its default in constants.ts show in yellow.
 * "Copy values" puts the current values on the clipboard to paste back into constants.ts.
 * When disabled, every folder simply gets its defaults.
 */
export class Tweaks {
    private readonly gui?: GUI;
    private readonly folders = new Map<string, object>();
    /** each folder's defaults, by its params object, so any control on those params can be compared */
    private readonly defaults = new WeakMap<object, object>();

    constructor(enabled: boolean) {
        if (!enabled) return;

        this.gui = new GUI({ title: 'Tweaks' });
        this.gui.add({ copy: () => this.copyValues() }, 'copy').name('Copy values');
        this.gui.add({ reset: () => this.resetAll() }, 'reset').name('Reset all (reloads)');
        rememberCollapsed(this.gui, 'Tweaks');

        const style = document.createElement('style');
        style.textContent = CHANGED_STYLE;
        document.head.appendChild(style);
        this.gui.onChange(({ controller }) => this.markChanged(controller));
        // controls are added over time (some folders only once their scene part has loaded)
        let queued = false;
        new MutationObserver(() => {
            if (queued) return;
            queued = true;
            queueMicrotask(() => {
                queued = false;
                this.gui?.controllersRecursive().forEach((c) => this.markChanged(c));
            });
        }).observe(this.gui.domElement, { childList: true, subtree: true });
    }

    private markChanged(controller: Controller): void {
        const defaults = this.defaults.get(controller.object) as Record<string, unknown> | undefined;
        if (!defaults || !(controller.property in defaults) || 'noDefault' in controller.domElement.dataset) return;
        const changed = !sameValue(controller.getValue(), defaults[controller.property]);
        controller.domElement.classList.toggle(CHANGED_CLASS, changed);
        if (changed) this.addResetButton(controller, defaults[controller.property]);
    }

    /** a small button before the name that puts the default back, in place */
    private addResetButton(controller: Controller, value: unknown): void {
        if (controller.domElement.querySelector('.tweak-reset')) return;
        const button = document.createElement('button');
        button.className = 'tweak-reset';
        button.textContent = '↺';
        button.title = 'Reset to default';
        button.addEventListener('click', (e) => {
            // checkboxes are labels: don't let the click toggle them as well
            e.preventDefault();
            e.stopPropagation();
            controller.setValue(value);
            // setValue only fires onChange; some controls apply on finishing a change instead (like rebuilding the
            // pillars), and lil-gui keeps that call private
            (controller as unknown as { _callOnFinishChange?: () => void })._callOnFinishChange?.();
        });
        controller.$name.prepend(button);
    }

    /**
     * @returns the (possibly persisted) params and, when enabled, the folder to add controllers to.
     * Controllers added to the folder persist their value on change.
     */
    public addFolder<T extends object>(name: string, defaults: T): { params: T, folder?: GUI } {
        const params: T = { ...defaults };
        this.folders.set(name, params);
        this.defaults.set(params, { ...defaults });

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
