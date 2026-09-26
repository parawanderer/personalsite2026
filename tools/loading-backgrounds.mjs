// Loading backgrounds: renders the home view at a few times of day and turns each into the loading screen's placeholders.
//
//   node tools/loading-backgrounds.mjs [http://localhost:5199]      (with the dev server running)
//
// For each time of day it writes public/loading/<name>.webp, a small, blurred capture of the scene without particles,
// meteors or UI (the second placeholder, while the page's assets load), and CSS gradients sampled from that capture
// (the first placeholder, since they come with the page source itself). Both go into index.html between the
// loading-backgrounds markers, with a tiny script that picks the time of day nearest the scene's.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.argv[2] ?? 'http://localhost:5199';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TIMES = [
    { name: 'dawn', hour: 6.5 },
    { name: 'day', hour: 12 },
    { name: 'dusk', hour: 18.5 },
    { name: 'night', hour: 23 },
];
// the capture is stored this small: blurred, it loses nothing, and it's only a few KB
const WIDTH = 192;
const HEIGHT = 108;
// the gradients: a soft blob of colour per cell of this grid over the capture, so they roughly follow the picture
const COLUMNS = 5;
const ROWS = 4;

const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    args: ['--window-size=1280,840', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});

const results = [];
for (const time of TIMES) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((hour) => {
        localStorage.clear();
        localStorage.setItem('tweaks:Day / night', JSON.stringify({ hour }));
        localStorage.setItem('tweaks:Particles', JSON.stringify({ count: 0 }));
        localStorage.setItem('tweaks:Shooting stars', JSON.stringify({ minInterval: 9999, maxInterval: 9999 }));
    }, time.hour);
    await page.goto(`${URL}/?tweaks`, { waitUntil: 'load' });
    await page.addStyleTag({ content: '.lil-gui.root, .hud, .window-outline, #controlsHintsUi, #freeFlightUi { display: none !important; }' });
    await page.waitForFunction(() => document.getElementById('loadingOverlay').classList.contains('hidden'), { timeout: 120000 });
    await new Promise(r => setTimeout(r, 5000));
    const shot = await page.screenshot({ encoding: 'base64' });

    // blur and shrink in the page's own canvas, then sample the colours for the gradients
    const { webp, rows, cells } = await page.evaluate(async (shot, w, h, columns, rowCount) => {
        const img = new Image();
        img.src = `data:image/png;base64,${shot}`;
        await img.decode();
        const big = document.createElement('canvas');
        big.width = img.width;
        big.height = img.height;
        const bg = big.getContext('2d');
        bg.filter = 'blur(10px)';
        bg.drawImage(img, 0, 0);
        const small = document.createElement('canvas');
        small.width = w;
        small.height = h;
        const sg = small.getContext('2d');
        sg.imageSmoothingQuality = 'high';
        sg.drawImage(big, 0, 0, w, h);
        const data = sg.getImageData(0, 0, w, h).data;
        const average = (x0, x1, y0, y1) => {
            const sum = [0, 0, 0];
            let n = 0;
            for (let y = Math.floor(y0 * h); y < Math.max(Math.floor(y1 * h), Math.floor(y0 * h) + 1); y++) {
                for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x++) {
                    const i = (y * w + x) * 4;
                    sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2];
                    n++;
                }
            }
            return sum.map((v) => Math.round(v / n));
        };
        const cells = [];
        for (let r = 0; r < rowCount; r++) {
            for (let c = 0; c < columns; c++) {
                cells.push({ x: (c + 0.5) / columns, y: (r + 0.5) / rowCount, color: average(c / columns, (c + 1) / columns, r / rowCount, (r + 1) / rowCount) });
            }
        }
        // a base under the blobs: the average of each row, top to bottom
        const rows = Array.from({ length: rowCount }, (_, r) => [(r + 0.5) / rowCount, average(0, 1, r / rowCount, (r + 1) / rowCount)]);
        return { webp: small.toDataURL('image/webp', 0.8).split(',')[1], rows, cells };
    }, shot, WIDTH, HEIGHT, COLUMNS, ROWS);

    mkdirSync(path.join(REPO, 'public/loading'), { recursive: true });
    writeFileSync(path.join(REPO, `public/loading/${time.name}.webp`), Buffer.from(webp, 'base64'));
    results.push({ ...time, rows, cells });
    console.log(`${time.name}: public/loading/${time.name}.webp (${Buffer.from(webp, 'base64').length} bytes)`);
    await page.close();
}
await browser.close();

const rgb = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const percent = (v) => `${Math.round(v * 100)}%`;
const blob = (cell) => `radial-gradient(${percent(1.15 / COLUMNS)} ${percent(1.15 / ROWS)} at ${percent(cell.x)} ${percent(cell.y)}, ${rgb(cell.color)}, ${rgb(cell.color, 0)})`;
const styles = results.map((r) => `        .loading-overlay[data-time="${r.name}"]::before {
            background-image:
                url(/loading/${r.name}.webp),
                ${r.cells.map(blob).join(',\n                ')},
                linear-gradient(${r.rows.map(([y, c]) => `${rgb(c)} ${percent(y)}`).join(', ')});
        }`).join('\n');

const html = path.join(REPO, 'index.html');
let source = readFileSync(html, 'utf8');
const replaceBetween = (name, content) => {
    const start = `<!-- ${name}:start (generated by tools/loading-backgrounds.mjs) -->`;
    const end = `<!-- ${name}:end -->`;
    const pattern = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end}`);
    if (!pattern.test(source)) throw new Error(`index.html has no ${name} markers`);
    source = source.replace(pattern, `${start}\n${content}\n    ${end}`);
};
replaceBetween('loading-backgrounds', `    <style>\n${styles}\n    </style>`);
replaceBetween('loading-time', `    <script>
        // the placeholder nearest the scene's time of day (the saved tweak with ?tweaks, otherwise the default)
        (() => {
            let hour = ${readDefaultHour()};
            try {
                if (new URLSearchParams(location.search).has('tweaks')) hour = JSON.parse(localStorage.getItem('tweaks:Day / night') ?? '{}').hour ?? hour;
            } catch { }
            const times = ${JSON.stringify(results.map((r) => [r.name, r.hour]))};
            const gap = (h) => Math.min(Math.abs(h - hour), 24 - Math.abs(h - hour));
            document.getElementById('loadingOverlay').dataset.time = times.reduce((a, b) => (gap(b[1]) < gap(a[1]) ? b : a))[0];
        })();
    </script>`);
writeFileSync(html, source);
console.log('index.html updated');

function readDefaultHour() {
    const constants = readFileSync(path.join(REPO, 'constants.ts'), 'utf8');
    const match = constants.match(/export const DAY_NIGHT[\s\S]*?\bhour:\s*([\d.]+)/);
    return match ? Number(match[1]) : 12;
}
