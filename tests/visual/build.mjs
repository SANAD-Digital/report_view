// Builds the visual harness (tests/visual/dist, git-ignored):
// - dist/harness.js: the real page modules (index.js, grid_view.js, ...) + stubs of frappe;
// - dist/harness_built.js: the stubs only, for the bundle written by `bench build` (?built=1);
// - dist/app.css: the app's CSS files, in the bundle's order;
// - dist/desk-ltr.css / desk-rtl.css: Frappe's built desk CSS, so Frappe controls look real;
// - dist/messages-ar.js: Arabic translations of frappe, erpnext and report_view (.po files);
// - dist/fonts.css + dist/fonts/: IBM Plex Sans Arabic (the design font) for the screenshots.
// Usage: node tests/visual/build.mjs
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "../..");
const bench = path.resolve(app, "../..");
const dist = path.join(here, "dist");
const esbuild = path.join(bench, "apps/frappe/node_modules/.bin/esbuild");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "fonts"), { recursive: true });

// 1. JS bundle, with Frappe's own target (es2017): what does not build here does not build
//    in `bench build` either. @finos/perspective resolves to its browser build (JS only);
//    its WASM files and worker are served by serve.mjs from node_modules, as on the site.
for (const entry of ["harness", "harness_built"]) {
	execFileSync(
		esbuild,
		[
			path.join(here, `${entry}.mjs`),
			"--bundle",
			"--format=iife",
			"--target=es2017",
			`--outfile=${path.join(dist, `${entry}.js`)}`,
			"--log-level=warning",
		],
		{ stdio: "inherit" }
	);
}

// 2. App CSS, same order as report_view.bundle.scss.
const css_dir = path.join(app, "report_view/public/css");
const app_css = ["rv_tokens.css", "rv_components.css", "rv_table.css", "rv_page.css", "rv_charts.css", "rv_pivot.css"]
	.map((f) => fs.readFileSync(path.join(css_dir, f), "utf8"))
	.join("\n");
fs.writeFileSync(path.join(dist, "app.css"), app_css);

// 3. Frappe desk CSS (latest build of this bench).
const pick = (dir) => {
	const f = fs.readdirSync(dir).find((n) => /^desk\.bundle\.[A-Z0-9]+\.css$/.test(n));
	if (!f) throw new Error(`desk.bundle css not found in ${dir}`);
	return path.join(dir, f);
};
const assets = path.join(bench, "sites/assets/frappe/dist");
fs.copyFileSync(pick(path.join(assets, "css")), path.join(dist, "desk-ltr.css"));
fs.copyFileSync(pick(path.join(assets, "css-rtl")), path.join(dist, "desk-rtl.css"));

// 4. Arabic messages.
function parse_po(file) {
	const out = {};
	if (!fs.existsSync(file)) return out;
	const text = fs.readFileSync(file, "utf8");
	const unq = (s) => JSON.parse(s);
	const entry = /(?:^msgctxt\s+(".*")\n)?^msgid\s+((?:".*"\n?)+)^msgstr\s+((?:".*"\n?)+)/gm;
	let m;
	while ((m = entry.exec(text))) {
		const join = (block) =>
			block
				.trim()
				.split("\n")
				.map((l) => unq(l.trim()))
				.join("");
		const id = join(m[2]);
		const str = join(m[3]);
		// Frappe keys a translation with a context as "<msgid>:<msgctxt>" (gettext/translate.py).
		if (id && str) out[m[1] ? `${id}:${unq(m[1])}` : id] = str;
	}
	return out;
}
const messages = {
	...parse_po(path.join(bench, "apps/frappe/frappe/locale/ar.po")),
	...parse_po(path.join(bench, "apps/erpnext/erpnext/locale/ar.po")),
	...parse_po(path.join(app, "report_view/locale/ar.po")),
};
fs.writeFileSync(path.join(dist, "messages-ar.js"), `window.RV_MESSAGES = ${JSON.stringify(messages)};\n`);

// 5. Design font, from the woff2 files already on this bench (test only, not shipped).
const font_src = path.join(bench, "apps/payroll_entry_tool/payroll_entry_tool/public/css/_payroll_entry_tool_fonts.scss");
const font_dir = path.join(bench, "apps/payroll_entry_tool/payroll_entry_tool/public/fonts/payroll_entry_tool");
let fonts = "";
if (fs.existsSync(font_src)) {
	fonts = fs
		.readFileSync(font_src, "utf8")
		.replace(/"PET IBM Plex Sans Arabic"/g, '"IBM Plex Sans Arabic"')
		.replace(/url\("\/assets\/payroll_entry_tool\/fonts\/payroll_entry_tool\/([^"]+)"\)/g, (m, f) => {
			fs.copyFileSync(path.join(font_dir, f), path.join(dist, "fonts", f));
			return `url("fonts/${f}")`;
		});
}
fs.writeFileSync(path.join(dist, "fonts.css"), fonts);

// 6. Fixtures used by the harness.
for (const f of [
	"trial_balance_fy2026.json",
	"accounts_receivable_frappe_total.json",
	"accounts_receivable_group_by_party.json",
	"general_ledger_consolidated.json",
	"general_ledger_by_account.json",
]) {
	fs.copyFileSync(path.join(app, "report_view/tests/fixtures/normalize", f), path.join(dist, f));
}
