### Report View

Report View

### Installation

You can install this app using the [bench](https://github.com/frappe/bench) CLI:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO --branch version-16
bench install-app report_view
```

#### Chromium for PDFs

The server PDF agent prints with a pinned Chrome for Testing headless shell (about 260 MB,
Linux x86-64). It is not stored in the repository: `bench install-app` and every
`bench migrate` download it into `<bench>/chromium-rv` when it is missing (a failed download
never stops the install; PDFs then use Frappe's Chromium). To install or update it by hand:

```bash
bench report-view-install-chromium          # --force replaces another version
```

Its system libraries need root once (the installer prints the full `apt-get` line), e.g.:

```bash
sudo apt-get install -y libnss3 libatk-bridge2.0-0t64 libgbm1 libxkbcommon0 libasound2t64 fonts-noto-core
```

The state of the engine and an install button are in **Report View Global Settings → PDF engine**.

#### Chromium sandbox (Ubuntu 23.10+)

Ubuntu forbids the user namespaces Chromium's sandbox is made of
(`kernel.apparmor_restrict_unprivileged_userns = 1`) to programs without an AppArmor profile,
so the PDF agent runs Chromium with `--no-sandbox` there. The repository ships the profile
(`scripts/apparmor/report-view-chromium`, the one Ubuntu ships for Google Chrome); install it
once per server, as root, after the Chromium above:

```bash
sudo bash apps/report_view/scripts/install_apparmor.sh --bench "$PWD"   # from the bench folder
```

The PDF agent checks at runtime whether the sandbox starts and drops `--no-sandbox` when it
does (within ten minutes, or at the next restart). **PDF engine** in the settings shows
"Chromium sandbox: on/off" and, when off, this command with the bench's real paths. Run it
again after moving the bench or the Chromium (`--remove` deletes the profile).

### Per-report settings

**Report View Settings** (one record per report, System Manager; ⋯ menu of a Report View
page → *Report View settings*) controls what a report shows: grouping, subtotals, column
groups, pins, density, the search box, the column filters and value lists, the filters
panel, quick filters, the period field, the side panel and its tabs, the pivot, charts (and
which chart types), Pages and Excel; its default view; the row details; and the JSON parts of
its shipped file (`report_view/defaults/<report>.json`). The record wins over the shipped
file key by key; the shipped filter definitions can never be removed or changed (ADR-021,
ADR-023). Every tool is on by default, so a report without a record looks as before.

### Tests

```bash
# Python (from the bench folder)
bench --site <site> run-tests --app report_view

# JS unit tests (app folder; the runtime libraries once: npm ci)
node --test tests/js/*.test.mjs

# test tooling (Playwright) lives in tests/, installed once:
npm --prefix tests ci

# visual harness, no site needed (needs the bench's built Frappe assets)
npm --prefix tests run visual
# end-to-end tests against a running site (RV_BASE_URL=https://your.site)
npm --prefix tests run e2e
# scripted checks of print, letter heads and presets on a running site (tests/site/*.cjs):
# RV_SITE=https://your.site plus the test users' passwords (see tests/site/_password.cjs)
RV_SITE=https://your.site node tests/site/doc_print.cjs
```

Neither the site nor a password has a default in the repository: the scripts stop with a
message when `RV_SITE` / `RV_BASE_URL` or a password is not set. Keep them in a private env
file (`chmod 600`) and load it with `set -a; . <file>; set +a`.

Both Playwright configs run Chromium only unless `RV_BROWSERS` says otherwise
(`RV_BROWSERS=firefox`, `RV_BROWSERS=webkit`, or `RV_BROWSERS=chromium,firefox,webkit`):

```bash
RV_BROWSERS=firefox,webkit npm --prefix tests run visual
```

Firefox and WebKit (Safari's engine) need Playwright's browsers and their system libraries,
once per machine (the second line needs root):

```bash
cd apps/report_view/tests && npx playwright install firefox webkit
sudo npx playwright install-deps firefox webkit
```

### Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main` and `version-16`:
`lint` (ruff, ESLint), `js` (`node --test` on Node 20, 22 and 24), `visual` (the harness on
Chromium; Firefox and WebKit run as their own entries and do not fail the workflow until
they are green) and `server` (a fresh Frappe 16 + ERPNext bench and site, then
`bench --site test_site run-tests --app report_view`).

### Contributing

This app uses `pre-commit` for code formatting and linting. Please [install pre-commit](https://pre-commit.com/#installation) and enable it for this repository:

```bash
cd apps/report_view
pre-commit install
```

Pre-commit is configured to use the following tools for checking and formatting your code:

- ruff
- eslint
- prettier
- pyupgrade

### License

mit
