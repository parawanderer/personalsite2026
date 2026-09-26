// Screenshots of the running site, for checking visual changes.
//
//   node tools/shot.mjs <out.png> ['<options as JSON>']
//
// Needs the dev server (npx vite --port 5199). Launches its own Chrome, which renders at full speed even when another
// browser is hogging the GPU (the chrome-devtools MCP browser can drop to ~1 fps then). Options, all optional:
//
//   url        the site, default http://localhost:5199
//   tweaks     tweak values to start with, by folder: { "Day / night": { "hour": 23 }, "Particles": { "count": 0 } }
//              (loaded through ?tweaks, which is added to the URL; folders not given start at their defaults)
//   seed       seeds Math.random, so the pillar layout, meteors and splashes land the same on every run
//   viewport   { "width": 1280, "height": 720, "scale": 1 }
//   hideUi     hide the HUD, the frame and the hints, for pictures of the scene alone
//   click      selectors to click in turn after loading, e.g. ["#contactButton"], each followed by 3 s to settle
//   hover      a selector to hover before the screenshot
//   wait       seconds to wait after the page has loaded (and after any clicks), default 5
//   clip       { "x", "y", "width", "height" }, a part of the page only
//
// Prints the frame rate it ran at and any warnings or errors from the page.

import puppeteer from 'puppeteer-core';

const [out, json] = process.argv.slice(2);
if (!out) {
    console.error('usage: node tools/shot.mjs <out.png> [options JSON]');
    process.exit(1);
}
const o = JSON.parse(json ?? '{}');
const viewport = { width: 1280, height: 720, scale: 1, ...o.viewport };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false,
    defaultViewport: { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale },
    args: [
        `--window-size=${viewport.width},${viewport.height + 120}`,
        // keep rendering at full speed while the window is in the background
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
    ],
});
try {
    const page = await browser.newPage();
    page.on('console', (m) => {
        if (['warn', 'error'].includes(m.type()) && !/THREE\.Clock/.test(m.text())) console.log(`page ${m.type()}: ${m.text().slice(0, 300)}`);
    });
    page.on('pageerror', (e) => console.log(`page error: ${e.message}`));

    await page.evaluateOnNewDocument((tweaks, seed) => {
        if (seed !== undefined) {
            let s = seed >>> 0;
            Math.random = () => {
                s = (s * 1664525 + 1013904223) >>> 0;
                return s / 4294967296;
            };
        }
        localStorage.clear();
        for (const [folder, values] of Object.entries(tweaks)) localStorage.setItem(`tweaks:${folder}`, JSON.stringify(values));
    }, o.tweaks ?? {}, o.seed);

    await page.goto(`${o.url ?? 'http://localhost:5199'}/?tweaks`, { waitUntil: 'load' });
    await page.addStyleTag({
        content: `.lil-gui.root, #fpsCounter { display: none !important; }${o.hideUi ? ' .hud, .window-outline, #controlsHintsUi, #freeFlightUi { display: none !important; }' : ''}`,
    });
    await page.waitForFunction(() => document.getElementById('loadingOverlay')?.classList.contains('hidden'), { timeout: 120000 });

    for (const selector of o.click ?? []) {
        await page.click(selector);
        await sleep(3000);
    }
    if (o.hover) await page.hover(o.hover);
    await sleep((o.wait ?? 5) * 1000);

    const fps = await page.evaluate(async () => {
        let frames = 0;
        const start = performance.now();
        await new Promise((resolve) => {
            const count = () => (++frames, performance.now() - start < 1000 ? requestAnimationFrame(count) : resolve());
            requestAnimationFrame(count);
        });
        return frames;
    });
    console.log(`${fps} fps`);

    await page.screenshot({ path: out, ...(o.clip ? { clip: o.clip } : {}) });
    console.log(`saved ${out}`);
} finally {
    await browser.close();
}
