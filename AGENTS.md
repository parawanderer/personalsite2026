# Notes for coding agents

A personal index page: a three.js scene (leaning basalt pillars along a channel of thick, alien water, a day/night
cycle, meteors) behind a small HUD with two text panels, Links and Contact. The look is a film poster, not a web app
or a game: keep that in mind for anything user-facing.

## Running and checking

```bash
npx vite --port 5199        # dev server
npx tsc --noEmit -p .       # type check (there are no tests)
```

`?tweaks` in the URL opens the tweak panel (lil-gui, `ui/tweaks.ts`). Every hand-tunable value lives there, in a folder
per system, with its default in `constants.ts`. Values changed in the panel are saved in localStorage as
`tweaks:<Folder name>` and only load with `?tweaks`; names shown in yellow differ from the default, and their ↺ resets
them. Without `?tweaks` everything runs on the defaults.

## Tools

- **`tools/shot.mjs`**: screenshots of the running site in its own Chrome, with preset tweaks, a seeded `Math.random`,
  clicks, hover, clip and viewport. The way to look at a change. Options are documented at the top of the file, e.g.
  ```bash
  node tools/shot.mjs /tmp/night.png '{"tweaks":{"Day / night":{"hour":23}},"seed":1,"click":["#linksButton"]}'
  ```
  For a meteor splash: Shooting stars `splashChance: 1`, short `minInterval`/`maxInterval`, and a long `trainSeconds`
  so the flash is still on at the screenshot. `"hideUi": true` for the scene alone.
- **`tools/loading-backgrounds.mjs`** (`npm run loading-backgrounds`, dev server running): renders the home view at
  dawn, day, dusk and night and writes the loading screen's placeholders: `public/loading/<time>.webp` (small blurred
  captures) and CSS gradients sampled from them, inlined in `index.html` between the `loading-backgrounds` and
  `loading-time` markers. Rerun it when the scene's look changes.
- **`tools/loading-preview.html`**: open `/tools/loading-preview.html` on the dev server to see those placeholders side
  by side.
- **`perf/run.mjs`** (`npm run perf`) and **`perf/perf.ipynb`**: frame time benchmarks per commit, and their plots. See
  `perf/README.md`. Record one for changes that could cost frame time.

## Working rules

- One reviewable visual change at a time, each in its own commit, and look at it (`tools/shot.mjs`) before calling it
  done. Say plainly when something could only be compile-checked.
- Anything worth tuning by hand goes into the tweak panel, with its default in `constants.ts`.
- Performance is judged on a MacBook Air at 60 Hz, not a fast desktop.
- The owner tunes values in `constants.ts` while you work. Never revert or overwrite their uncommitted changes; it's
  fine for them to land in your commits. Commits end with a `Co-Authored-By` line for the agent.
- Comments explain why, in plain sentences, the way the surrounding code does.
- The pillars' fog (`shaders/fogedits.glsl.ts`) is deliberately not physical: it paints surfaces along an orange-to-teal
  ramp by distance, ending in the sky's colour, which simplifies the background into flat colour shapes like a painted
  backdrop. Don't make it realistic; that makes the scene busy and plain. Physical accuracy is welcome elsewhere only
  where it looks better.

## Traps (all hit before)

- **Edits that land in stages break the open page.** Vite hot-reloads each saved file, and if a file uses something
  another file doesn't export yet, the owner's open tab can keep the broken module and go white. Make multi-file changes
  together, and if a tab went white after a fix, a reload is enough. A tab stuck erroring every frame can flood the dev
  server; restart it (`npx vite --port 5199`), which also reloads open tabs.
- **The chrome-devtools MCP browser can crawl at ~1 fps** (GPU contention) and time out on screenshots. Use
  `tools/shot.mjs` instead.
- **Materials that share a uniforms object share three's light and shadow uniforms too**, which three flags per draw;
  one of them ends up with stale shadow maps. The camera-following water patch copies three's light uniforms for that
  reason (`environment/water.ts`).
- **Never switch lights (or their `castShadow`) on and off.** Changing the scene's light setup makes three.js recompile
  every lit material's shader, a stall of 100+ ms, and it drops the old versions, so switching back recompiles again.
  Lights stay in the scene at zero intensity; shadows are shown or not with objects' `receiveShadow`, a plain uniform.
  `ShootingStars.warmUp` draws one frame with everything a splashdown shows before the page appears, so those shaders
  are compiled up front. Anything new that appears only now and then needs the same.
- **Shader edits are string replacements that can collide**: two edits of the same line (like the water's albedo line)
  only work if each matches a part the other leaves alone. `applyEdits` warns in the console when a search misses.
- **three's Water shader already declares** `sunDirection`, a local `distance` and friends; name your additions apart
  (`glowSun...`) and use `length(a - b)`. `half` is reserved in GLSL.
- **Shadow bias hides shadows under grazing light**: the meteor flash sits 0.6 m above the water, so its shadows use
  no bias.
- **The pointer's screen position comes from the window, not the canvas's box**, which doesn't match it.
- **A global `* { font-family: Montserrat }`** overrides inherited fonts on inner elements; the panel text resets it.
- **`lil-gui`'s `setValue` only fires `onChange`**, not `onFinishChange`: call the rebuild yourself when setting values
  from code.

## Where things are

- `main.ts` wires everything; `environment/` holds the scene's parts (walls/pillars, water, particles, day/night, suns,
  aurora, shooting stars, splash mist, water touch); `shaders/` the GLSL edits patched into three's materials through
  `onBeforeCompile`; `ui/` the HUD, tweak panel and loading screen; `postprocessing/` the passes after the scene.
- Type: the title and panel headings are Computer Modern capitals, spaced wide; the nav and labels thin spaced
  Montserrat; the panels' text Computer Modern (`public/fonts/cmu/`, SIL OFL).
