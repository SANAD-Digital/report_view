// The font library (report_view/fonts.json, public/js/report_view/fonts.js): every file the
// registry names exists, the stacks and @font-face rules, the picker's groups, and the layout
// of the letter head kept to the registry's families.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_json.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { set_font_registry, font_names, font_info, clean_font, font_stack, font_face_css, font_groups, print_weights, DEFAULT_FONT } = await import("../../report_view/public/js/report_view/fonts.js");
const { clamp_layout } = await import("../../report_view/public/js/report_view/letterhead/model.js");
const { render_band } = await import("../../report_view/public/js/report_view/letterhead/render.js");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, "..", "..", "report_view");
const REGISTRY = JSON.parse(fs.readFileSync(path.join(PKG, "fonts.json"), "utf8"));
set_font_registry(REGISTRY);

test("registry: unique families, every file it names exists, a licence in every folder", () => {
	const names = REGISTRY.map((e) => e.family);
	assert.equal(new Set(names).size, names.length);
	assert.ok(names.length >= 40, `only ${names.length} families`);
	assert.ok(names.includes(DEFAULT_FONT));
	for (const e of REGISTRY) {
		if (e.system) continue;
		const dir = path.join(PKG, "public", "fonts", e.slug);
		assert.ok(["OFL.txt", "COPYING", "LICENSE"].some((n) => fs.existsSync(path.join(dir, n))), `${e.family}: no licence`);
		for (const files of [...Object.values(e.weights), ...Object.values(e.italic || {})]) {
			assert.ok(files.ttf, `${e.family}: a TrueType file for wkhtmltopdf`);
			for (const rel of Object.values(files)) assert.ok(fs.statSync(path.join(PKG, "public", "fonts", rel)).size > 1000, rel);
		}
	}
});

test("the generated stylesheet has a face for every file of the registry", () => {
	const css = fs.readFileSync(path.join(PKG, "public", "css", "rv_fonts.css"), "utf8");
	for (const e of REGISTRY) for (const files of Object.values(e.weights)) for (const rel of Object.values(files)) assert.ok(css.includes(`/assets/report_view/fonts/${rel}`), rel);
});

test("stacks by category; unknown families fall back to the default", () => {
	assert.equal(font_stack("Cairo"), "'Cairo',sans-serif");
	assert.equal(font_stack("Amiri"), "'Amiri',serif");
	assert.equal(font_stack("FreeFarsi Monospace"), "'FreeFarsi Monospace',monospace");
	assert.equal(clean_font("Cairo"), "Cairo");
	assert.equal(clean_font("Comic Sans"), DEFAULT_FONT);
	assert.equal(clean_font(null), DEFAULT_FONT);
	assert.deepEqual(font_names(), REGISTRY.map((e) => e.family));
});

test("@font-face: woff2 then truetype, under the base given; TrueType only for a font that may not change", () => {
	const css = font_face_css("Cairo", "https://x.test/assets/report_view/fonts/");
	assert.equal((css.match(/@font-face/g) || []).length, Object.keys(font_info("Cairo").weights).length);
	assert.match(css, /font-family:'Cairo';font-style:normal;font-weight:700;font-display:swap;src:url\('https:\/\/x\.test\/assets\/report_view\/fonts\/cairo\/cairo-700\.woff2'\) format\('woff2'\),url\('https:\/\/x\.test\/assets\/report_view\/fonts\/cairo\/cairo-700\.ttf'\) format\('truetype'\)/);
	const roya = font_face_css("Roya");
	assert.doesNotMatch(roya, /woff2/);
	assert.match(roya, /url\('\/assets\/report_view\/fonts\/roya\/roya-700\.ttf'\) format\('truetype'\)/);
	assert.equal(font_face_css("DejaVu Sans"), "");
	assert.equal(font_face_css("Nope"), "");
});

test("picker groups: Arabic families first by category, then Latin; search narrows", () => {
	const groups = font_groups();
	assert.equal(groups[0].script, "arabic");
	assert.ok(groups.some((g) => g.script === "latin" && g.fonts.some((f) => f.family === "Inter")));
	const seen = groups.flatMap((g) => g.fonts.map((f) => f.family));
	assert.equal(seen.length, REGISTRY.length);
	const q = font_groups("kuf").flatMap((g) => g.fonts.map((f) => f.family));
	assert.deepEqual(q.sort(), ["Kufam", "Noto Kufi Arabic", "Reem Kufi"]);
});

test("letter head layout: a registry font is kept, another is refused; the band carries only its font's faces", () => {
	assert.equal(clamp_layout({ font: "Amiri" }).font, "Amiri");
	assert.equal(clamp_layout({ font: "B Nazanin" }).font, DEFAULT_FONT);
	const layout = clamp_layout({ font: "Cairo" });
	const html = render_band(layout, "header", { values: {} }, { font_base: "https://x.test/assets/report_view/fonts/" });
	assert.match(html, /font-family:'Cairo',sans-serif/);
	const faces = html.match(/@font-face\{font-family:'([^']+)'/g) || [];
	assert.ok(faces.length === 1 && faces.every((f) => f.includes("'Cairo'")));
	// the weights the layout uses; never 500 beside 400 (wkhtmltopdf)
	assert.deepEqual([...html.matchAll(/font-weight:(\d+);font-display/g)].map((m) => m[1]), ["400"]);
	assert.match(html, /<style>@font-face[^<]*\.rvlh\[data-rv-lh\] \*\{font-family:inherit\}<\/style>/);
	assert.doesNotMatch(render_band(layout, "header", { values: {} }), /<style>/);
	assert.deepEqual(print_weights("Cairo", [400, 500, 700]), [400, 700]);
	assert.deepEqual(print_weights("Amiri", [600]), [700]);
	assert.deepEqual(print_weights("Titr", [400]), [700]);
	assert.deepEqual(print_weights("DejaVu Sans", [400]), []);
});
