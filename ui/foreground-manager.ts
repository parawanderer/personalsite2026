import { InteractionManager } from "../interact";
import { getByIdOrThrow } from "../utils/document";

import { TITLE_HOME, TITLE_LINKS, TITLE_CONTACT } from '../constants';


const ANIMATE_APPEAR = 'animate-appear';

const SHOW = "show";
const FLIPPED = "flipped";
const HIDDEN = "hidden";
const NO_DISPLAY = "no-display";
const HINTS_FADE_MS = 1000; // matches the .show opacity transition in index.css

// pressing any of the keys the hints explain means they've been read
const HINT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight", "Escape"]);

// https://developer.mozilla.org/en-US/docs/Web/API/Window/matchMedia
const isPrimaryInputMethodTouch = (): boolean => {
    return window.matchMedia("(pointer: coarse)").matches;
};


export class ForegroundManager {
    private readonly homeButton: HTMLButtonElement;
    private onPressHomeButtonCallback?: () => void;
    private onFreeFlightCallback?: (isFreeFlight: boolean) => void;

    private readonly linksButton: HTMLButtonElement;
    private onPressLinksButtonCallback?: () => void;

    private readonly contactButton: HTMLButtonElement;
    private onPressContactButtonCallback?: () => void;

    private readonly hiddenPanel: HTMLElement;
    private readonly freeFlightButton: HTMLButtonElement;
    private readonly freeFlightUi: HTMLDivElement;
    private readonly freeFlightUiHints: HTMLDivElement;
    private readonly returnFromFreeFlightButton: HTMLButtonElement;

    private isMobile: boolean;
    /** once the controls hints have been used they stay hidden until the page reloads */
    private hintsDismissed: boolean = false;
    private isFreeFlight: boolean = false;
    private isUiSwitching: boolean = false;


    constructor(private interactionManager: InteractionManager) {
        this.isMobile = isPrimaryInputMethodTouch();

        getByIdOrThrow('logo-img').addEventListener("click", () => this.onPressHome());

        this.hiddenPanel = getByIdOrThrow('hiddenPanel');
        this.freeFlightButton = getByIdOrThrow("freeFlightButton");
        this.freeFlightUi = getByIdOrThrow("freeFlightUi");
        this.freeFlightUiHints = getByIdOrThrow("controlsHintsUi");
        this.returnFromFreeFlightButton = getByIdOrThrow("returnFromFreeFlight");

        this.homeButton = getByIdOrThrow('homeButton');
        this.linksButton = getByIdOrThrow('linksButton');
        this.contactButton = getByIdOrThrow('contactButton');

        this.homeButton.addEventListener("click", () => this.onPressHome());

        this.linksButton.addEventListener("click", () => this.onPressLinks());

        this.contactButton.addEventListener("click", () => this.onPressContact());

        this.freeFlightButton.addEventListener("click", () => this.handleFreeFlight());
        this.returnFromFreeFlightButton.addEventListener("click", () => this.handleFreeFlight());

        document.title = TITLE_HOME;


        getByIdOrThrow("copyrightYear").textContent = String(new Date().getFullYear());

        const controlsDesktopExplain = getByIdOrThrow("controlsDesktopExplain");
        const mobileWarning = getByIdOrThrow("controlsMobileExplain");
        if (this.isMobile) {
            controlsDesktopExplain.style.display = "none";
        } else {
            mobileWarning.style.display = "none";
        }

        document.addEventListener("keydown", (event) => {
            if (this.isFreeFlight && HINT_KEYS.has(event.code)) this.dismissHints();
        });
    }

    private handleFreeFlight(): void {
        if (this.isUiSwitching) return;
        this.isUiSwitching = true;

        this.isFreeFlight = !this.isFreeFlight;
        this.onFreeFlightCallback?.(this.isFreeFlight);

        const toBeEdited = document.querySelectorAll(".hideable-ui");
        if (this.isFreeFlight) {
            for (const element of toBeEdited) {
                element.classList.add(HIDDEN);
            }

            setTimeout(() => {
                for (const element of toBeEdited) {
                    element.classList.add(NO_DISPLAY);
                }
                this.freeFlightUi.classList.remove(NO_DISPLAY);
                if (!this.hintsDismissed) this.freeFlightUiHints.classList.remove(NO_DISPLAY);

                this.interactionManager.setMovementEnabled(true);

                // add to end of event queue
                setTimeout(() => {
                    this.freeFlightUi.classList.add(SHOW);
                    if (!this.hintsDismissed) this.freeFlightUiHints.classList.add(SHOW);
                    this.isUiSwitching = false;
                }, 10);
            }, 2000);

        } else {
            for (const element of toBeEdited) {
                element.classList.remove(NO_DISPLAY);
            }
            this.freeFlightUi.classList.remove(SHOW);
            this.freeFlightUiHints.classList.remove(SHOW);

            this.interactionManager.setMovementEnabled(false);

            setTimeout(() => {
                for (const element of toBeEdited) {
                    element.classList.remove(HIDDEN);
                }

                setTimeout(() => {
                    this.freeFlightUi.classList.add(NO_DISPLAY);
                    this.freeFlightUiHints.classList.add(NO_DISPLAY);
                    this.isUiSwitching = false;
                }, 2000);

            }, 2000);
        }
    }

    private onPressHome() {
        console.log("Clicked home button!");

        this.hiddenPanel.classList.remove(SHOW);
        this.setCurrent(this.homeButton);

        document.title = TITLE_HOME;

        if (!this.onPressHomeButtonCallback) return;
        this.onPressHomeButtonCallback();
    }

    private onPressLinks() {
        console.log("Clicked links button!");

        this.hiddenPanel.classList.add(SHOW);
        this.hiddenPanel.classList.remove(FLIPPED);
        this.setCurrent(this.linksButton);

        document.title = TITLE_LINKS;

        if (!this.onPressLinksButtonCallback) return;
        this.onPressLinksButtonCallback();
    }

    private onPressContact() {
        console.log("Clicked contact button!");

        this.hiddenPanel.classList.add(SHOW);
        this.hiddenPanel.classList.add(FLIPPED);
        this.setCurrent(this.contactButton);

        document.title = TITLE_CONTACT;

        if (!this.onPressContactButtonCallback) return;
        this.onPressContactButtonCallback();
    }


    public init() {
        ForegroundManager.handleAnimateIn();
    }

    private setCurrent(current: HTMLElement) {
        for (const button of [this.homeButton, this.linksButton, this.contactButton]) {
            if (button === current) {
                button.setAttribute('aria-current', 'page');
            } else {
                button.removeAttribute('aria-current');
            }
        }
    }

    public setLinksCallback(callback: () => void) {
        this.onPressLinksButtonCallback = callback;
    }

    private dismissHints(): void {
        if (this.hintsDismissed) return;
        this.hintsDismissed = true;
        this.freeFlightUiHints.classList.remove(SHOW);
        setTimeout(() => this.freeFlightUiHints.classList.add(NO_DISPLAY), HINTS_FADE_MS);
    }

    public setFreeFlightCallback(callback: (isFreeFlight: boolean) => void) {
        this.onFreeFlightCallback = callback;
    }

    public setHomeCallback(callback: () => void) {
        this.onPressHomeButtonCallback = callback;
    }

    public setContactCallback(callback: () => void) {
        this.onPressContactButtonCallback = callback;
    }

    private static handleAnimateIn() {
        setTimeout(() => {
            for (const item of document.querySelectorAll(".logo-primary.animate-appear")) {
                item.classList.remove(ANIMATE_APPEAR);
            }
        }, 1000);

        setTimeout(() => {
            for (const item of document.querySelectorAll(".name-title.animate-appear")) {
                item.classList.remove(ANIMATE_APPEAR);
            }
        }, 1500);

        setTimeout(() => {
            for (const item of document.querySelectorAll(".nav .animate-appear")) {
                item.classList.remove(ANIMATE_APPEAR);
            }
        }, 1750);
    }
}
