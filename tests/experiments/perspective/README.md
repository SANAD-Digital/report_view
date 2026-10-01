# Perspective experiments (phase 1, axis F)

Experiment code only. Nothing here is imported by the app bundle.
Results: `docs/research/perspective-experiments.md`. Evidence: `docs/research/artifacts/perspective/`.

## Layout

| Path | Purpose |
|---|---|
| `serve.mjs` | Dependency-free static server that mirrors the site URL layout (`/assets/report_view/...`) and serves `.wasm` as `application/wasm`. Optional `Content-Security-Policy` header. |
| `run_page.mjs` | Opens an experiment page in Playwright, waits for `window.__result`, prints/saves it. |
| `pages/` | The experiment pages. During the experiments this folder was exposed on the site through a temporary symlink `report_view/public/experiments` (removed afterwards). |
| `pages/lib/load.js` | Loads the engine in four ways (`esm`, `cdn`, `inline`, Frappe-built `bundle`) with a Blob worker or a same-origin URL worker. |
| `data/` | Fixtures. Served only by `serve.mjs`, never by the site. `tb_net*.json` are produced by `exp6_run_tb.py`. |
| `exp1a_probe_esm.bundle.js.txt` | Copy of the temporary Frappe bundle used for experiment 1a. |

## Commands (from the app root)

```bash
# 1 / 4 / 5: loading, sizes, CSP
node tests/experiments/perspective/exp1_load.mjs --base https://acc.dev.sanad.digital [--bundle /assets/report_view/dist/js/<probe>.js] [--throttle 10,40] [--browser firefox]
node tests/experiments/perspective/exp1_frappe_page.mjs
node tests/experiments/perspective/exp4_csp.mjs
node tests/experiments/perspective/exp5_sizes.mjs

# 2: RTL screenshots and probes
node tests/experiments/perspective/exp2_rtl.mjs

# 3: performance
node tests/experiments/perspective/run_page.mjs "run.html?exp=exp3&n=100000" --timeout 1500000
node tests/experiments/perspective/run_page.mjs "run.html?exp=exp3_chunks&n=500000&chunk=50000"
node tests/experiments/perspective/exp3_rows_crash.mjs 500000

# 6: totals (first produce the report responses, read-only)
(cd ../../sites && ../env/bin/python ../apps/report_view/tests/experiments/perspective/exp6_run_tb.py)
node tests/experiments/perspective/run_page.mjs "run.html?exp=exp6"

# 7: engine functions
node tests/experiments/perspective/run_page.mjs "run.html?exp=exp7"
node tests/experiments/perspective/run_page.mjs "run.html?exp=exp7b"
node tests/experiments/perspective/run_page.mjs "run.html?exp=exp7c"
node tests/experiments/perspective/run_page.mjs "run.html?exp=snippet"
```

The site-origin runs of experiment 1 need the pages to be reachable under
`/assets/report_view/experiments/` (temporary symlink) and, for `--bundle`, a temporary
`report_view/public/js/rv_perspective_probe.bundle.js` built with `bench build --app report_view`.
Both were removed at the end of the experiments.
