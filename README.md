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
