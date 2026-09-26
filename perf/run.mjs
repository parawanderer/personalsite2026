// Performance benchmark runner. See perf/README.md.
//
// Builds the site at a git ref (or the working tree), serves it, drives it in real Chrome with vsync off and
// appends frame timing stats per scenario to perf/results.jsonl. Everything it measures is injected into the page,
// so it works on commits from before this tool existed.

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, appendFileSync, symlinkSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import puppeteer from 'puppeteer-core';

const PERF_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(PERF_DIR, '..');
const CACHE = path.join(PERF_DIR, '.cache');
const RESULTS = path.join(PERF_DIR, 'results.jsonl');

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORT = { width: 1920, height: 1080, deviceScaleFactor: 1 };
const RANDOM_SEED = 1;
const SETTLE_MS = 3000;

const { values: args } = parseArgs({
    options: {
        ref: { type: 'string' },          // git ref to benchmark; omit for the working tree
        label: { type: 'string' },        // name shown in the notebook, defaults to the ref / "working"
        runs: { type: 'string', default: '3' },
        duration: { type: 'string', default: '15' }, // seconds recorded per scenario
        scenarios: { type: 'string', default: 'home,about,flight' },
        headless: { type: 'boolean', default: false },
        cooldown: { type: 'string', default: '8' },
        out: { type: 'string' },   // results file, defaults to perf/results.jsonl; use another for throwaway comparisons   // seconds idle between scenarios and runs, lets the GPU cool down
    },
});

const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));


// ---------- source + build ----------

const prepareSource = () => {
    if (!args.ref) {
        const dirty = git('status', '--porcelain', '--', '.', ':!perf/results.jsonl') !== '';
        return { dir: REPO, sha: git('rev-parse', 'HEAD'), dirty, key: 'working' };
    }

    const sha = git('rev-parse', '--verify', `${args.ref}^{commit}`);
    const dir = path.join(CACHE, 'worktrees', sha);
    if (!existsSync(dir)) {
        mkdirSync(path.dirname(dir), { recursive: true });
        git('worktree', 'add', '--detach', dir, sha);
    }
    // reuse this checkout's dependencies, the old commits only need three/vite/gsap
    const modules = path.join(dir, 'node_modules');
    if (!existsSync(modules)) symlinkSync(path.join(REPO, 'node_modules'), modules, 'dir');
    return { dir, sha, dirty: false, key: sha };
};

const build = (source) => {
    const outDir = path.join(CACHE, 'builds', source.key);
    if (source.key !== 'working' && existsSync(outDir)) return outDir;
    execFileSync(path.join(REPO, 'node_modules/.bin/vite'), ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
        cwd: source.dir,
        stdio: 'inherit',
    });
    return outDir;
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

const serve = (root) => new Promise((resolve) => {
    const server = createServer((req, res) => {
        let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
        if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
        if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
        if (!existsSync(file)) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
});


// ---------- in-page recorder (serialised into the page, no closures) ----------

function injectRecorder(seed) {
    // deterministic Math.random so pillar layout / particles match between runs and commits (mulberry32)
    let a = seed >>> 0;
    Math.random = () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const bench = {
        recording: false,
        gl: null,
        timer: null,
        pendingQueries: [],
        frames: [],
        gpu: [],
        longTasks: 0,
        current: null,
        lastTs: null,
        glRenderer: null,
    };
    window.__bench = bench;

    // find the WebGL context, count draw calls, grab the GPU timer extension if the browser exposes it
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        const ctx = origGetContext.call(this, type, ...rest);
        if (ctx && (type === 'webgl2' || type === 'webgl') && !bench.gl) {
            bench.gl = ctx;
            bench.timer = ctx.getExtension('EXT_disjoint_timer_query_webgl2');
            const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
            bench.glRenderer = dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
            const count = (name, vertsOf) => {
                const orig = ctx[name];
                if (!orig) return;
                ctx[name] = function (...fnArgs) {
                    if (bench.current) {
                        bench.current.draws++;
                        bench.current.verts += vertsOf(fnArgs);
                    }
                    return orig.apply(this, fnArgs);
                };
            };
            count('drawArrays', (x) => x[2]);
            count('drawElements', (x) => x[1]);
            count('drawArraysInstanced', (x) => x[2] * x[3]);
            count('drawElementsInstanced', (x) => x[1] * x[4]);
        }
        return ctx;
    };

    const pollQueries = () => {
        const gl = bench.gl, ext = bench.timer;
        if (!gl || !ext) return;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        bench.pendingQueries = bench.pendingQueries.filter((q) => {
            if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
            if (!disjoint) bench.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(q);
            return false;
        });
    };

    // time every animation frame callback (three's render loop runs in one)
    const origRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => origRaf((ts) => {
        if (bench.recording && ts !== bench.lastTs) {
            if (bench.current) bench.frames.push(bench.current);
            bench.current = { dt: bench.lastTs === null ? null : ts - bench.lastTs, cpu: 0, draws: 0, verts: 0 };
            bench.lastTs = ts;
            pollQueries();
        }
        const gl = bench.gl, ext = bench.timer;
        const query = bench.recording && gl && ext ? gl.createQuery() : null;
        if (query) gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        const t0 = performance.now();
        try {
            cb(ts);
        } finally {
            if (bench.current) bench.current.cpu += performance.now() - t0;
            if (query) {
                gl.endQuery(ext.TIME_ELAPSED_EXT);
                bench.pendingQueries.push(query);
            }
        }
    });

    new PerformanceObserver((list) => {
        if (bench.recording) bench.longTasks += list.getEntries().length;
    }).observe({ type: 'longtask', buffered: false });

    bench.start = () => {
        Object.assign(bench, { recording: true, frames: [], gpu: [], longTasks: 0, current: null, lastTs: null });
    };
    bench.stop = () => {
        bench.recording = false;
        return {
            frames: bench.frames.filter((f) => f.dt !== null),
            gpu: bench.gpu,
            gpuTimerAvailable: !!bench.timer,
            longTasks: bench.longTasks,
            heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
            glRenderer: bench.glRenderer,
        };
    };
}


// ---------- scenarios: only use DOM ids that exist in every version of the site ----------

const SCENARIOS = {
    home: {
        async before() {},
        async after() {},
    },
    // the first panel: About until it became Links (the name stays, so results compare across the change)
    about: {
        async before(page) {
            await page.click('#linksButton, #aboutMeButton');
            await sleep(SETTLE_MS);
        },
        async after() {},
    },
    flight: {
        async before(page) {
            await page.click('#freeFlightButton');
            await sleep(SETTLE_MS);
            await page.keyboard.down('KeyW'); // fly straight down the channel
        },
        async after(page) {
            await page.keyboard.up('KeyW');
        },
    },
};


// ---------- stats ----------

const quantile = (xs, q) => {
    if (xs.length === 0) return null;
    const s = [...xs].sort((x, y) => x - y);
    const i = (s.length - 1) * q;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
};
const round = (x, d = 3) => x === null ? null : Math.round(x * 10 ** d) / 10 ** d;

const summarise = (raw, seconds) => {
    const dt = raw.frames.map((f) => f.dt);
    const cpu = raw.frames.map((f) => f.cpu);
    return {
        frames: raw.frames.length,
        fps: round(raw.frames.length / seconds, 1),
        frameMs: { p50: round(quantile(dt, 0.5)), p95: round(quantile(dt, 0.95)), p99: round(quantile(dt, 0.99)), max: round(Math.max(...dt)) },
        cpuMs: { p50: round(quantile(cpu, 0.5)), p95: round(quantile(cpu, 0.95)) },
        gpuMs: raw.gpuTimerAvailable ? { p50: round(quantile(raw.gpu, 0.5)), p95: round(quantile(raw.gpu, 0.95)) } : null,
        drawCalls: round(quantile(raw.frames.map((f) => f.draws), 0.5), 0),
        vertices: round(quantile(raw.frames.map((f) => f.verts), 0.5), 0),
        longTasks: raw.longTasks,
        heapMB: round(raw.heapMB, 1),
    };
};


// ---------- main ----------

const main = async () => {
    const scenarios = args.scenarios.split(',').map((s) => s.trim());
    for (const s of scenarios) if (!SCENARIOS[s]) throw new Error(`Unknown scenario '${s}', known: ${Object.keys(SCENARIOS).join(', ')}`);
    const seconds = Number(args.duration);
    const runs = Number(args.runs);

    const source = prepareSource();
    const label = args.label ?? args.ref ?? 'working';
    console.log(`Benchmarking '${label}' (${source.sha.slice(0, 7)}${source.dirty ? ', dirty' : ''})`);

    const server = await serve(build(source));
    const url = `http://127.0.0.1:${server.address().port}/`;

    const browser = await puppeteer.launch({
        executablePath: CHROME,
        headless: args.headless,
        defaultViewport: VIEWPORT,
        args: [
            `--window-size=${VIEWPORT.width},${VIEWPORT.height + 120}`,
            // uncap the frame rate so frame times reflect actual cost instead of the display refresh
            '--disable-gpu-vsync',
            '--disable-frame-rate-limit',
            // don't throttle when the window is in the background
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
        ],
    });

    const machine = {
        platform: `${os.platform()} ${os.release()}`,
        cpu: os.cpus()[0]?.model,
        chrome: await browser.version(),
    };

    try {
        for (let run = 1; run <= runs; run++) {
            // rotate the order each run so a slowdown partway through doesn't always hit the same scenario
            const order = scenarios.map((_, k) => scenarios[(k + run - 1) % scenarios.length]);
            for (const name of order) {
                await sleep(Number(args.cooldown) * 1000);

                // fresh page per scenario, so each starts from the home view whatever ran before it
                const page = await browser.newPage();
                await page.evaluateOnNewDocument(injectRecorder, RANDOM_SEED);
                await page.goto(url, { waitUntil: 'load' });
                await page.waitForSelector('#loadingOverlay.hidden', { timeout: 60000 });
                await sleep(SETTLE_MS);

                const scenario = SCENARIOS[name];
                await scenario.before(page);
                await page.evaluate(() => window.__bench.start());
                await sleep(seconds * 1000);
                const raw = await page.evaluate(() => window.__bench.stop());
                await scenario.after(page);

                const stats = summarise(raw, seconds);
                const row = {
                    timestamp: new Date().toISOString(),
                    label,
                    ref: args.ref ?? null,
                    sha: source.sha,
                    dirty: source.dirty,
                    scenario: name,
                    run,
                    seconds,
                    viewport: `${VIEWPORT.width}x${VIEWPORT.height}@${VIEWPORT.deviceScaleFactor}`,
                    machine: { ...machine, gpu: raw.glRenderer },
                    ...stats,
                };
                appendFileSync(args.out ? path.resolve(args.out) : RESULTS, JSON.stringify(row) + '\n');
                console.log(`run ${run} ${name.padEnd(7)} ${String(stats.fps).padStart(6)} fps  frame p50 ${stats.frameMs.p50}ms p95 ${stats.frameMs.p95}ms  gpu p50 ${stats.gpuMs?.p50 ?? 'n/a'}ms  draws ${stats.drawCalls}`);
                await page.close();
            }
        }
    } finally {
        await browser.close();
        server.close();
    }
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
