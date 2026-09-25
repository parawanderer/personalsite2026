# Performance tracking

`run.mjs` benchmarks the site at a git ref (or the working tree) in real Chrome and appends the results to
`results.jsonl`. `perf.ipynb` plots them per change.

## Recording a change

```bash
# the working tree (marked dirty if there are uncommitted changes)
npm run perf -- --label "water rework"

# any commit, including ones from before this tool existed
npm run perf -- --ref f54d197 --label "baseline (2025 site)"
```

Options: `--runs 3`, `--duration 15` (seconds per scenario), `--scenarios home,about,flight`, `--cooldown 8` (idle seconds
before each scenario), `--headless`, `--out file.jsonl` (write somewhere else, for throwaway comparisons). The scenario order rotates each run, so a slowdown partway through a benchmark
spreads over all scenarios instead of always hitting the same one.

Leave the Chrome window alone while it runs. It opens at 1920x1080 with vsync and background throttling off.

## What it measures

Everything is injected into the page, so the site itself has no benchmark code:

- `Math.random` is seeded, so the pillar layout and particles are the same on every run and commit.
- Frame time is the interval between animation frames. With vsync off, that reflects the actual cost of a frame.
- CPU time is the time spent inside animation frame callbacks, which is where three renders.
- GPU time comes from `EXT_disjoint_timer_query_webgl2` when Chrome exposes it. On macOS it goes through
  ANGLE/Metal, so treat it as indicative, not exact.
- Draw calls and vertices are counted by wrapping the WebGL draw functions.

The scenarios:

- `home`: the landing view.
- `about`: the About panel open.
- `flight`: free flight, holding W down the channel.

They only click element ids that exist in every version of the site.

Only compare rows from the same machine. The notebook filters on the GPU name.

## Viewing

```bash
cd perf
uv run --with-requirements requirements.txt jupyter lab perf.ipynb
```

Checked-out commits and their builds are cached in `perf/.cache/` (gitignored).
