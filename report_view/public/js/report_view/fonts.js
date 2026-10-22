// The font library of Report View (report_view/fonts.json, core/fonts.py): its families,
// their CSS stacks and @font-face rules, grouped for a font picker. Pure: the registry is
// handed in (fonts_registry.js imports the JSON into the bundles; node tests read the file),
// so the same rules are tested in node (tests/js/fonts.test.mjs, with tests/js/_json.mjs).

import CONTRACT from "../../../letterhead_contract.json";

// the library's constants: report_view/letterhead_contract.json ("fonts"), as core/fonts.py reads them
export const DEFAULT_FONT = CONTRACT.fonts.default;
export const ASSET_BASE = CONTRACT.fonts.asset_base;
export const CATEGORIES = Object.freeze([...CONTRACT.fonts.categories]);
const GENERIC = Object.freeze({ ...CONTRACT.fonts.generic });
const FORMATS = [
	["woff2", "woff2"],
	["ttf", "truetype"],
];

let registry = [];
let by_family = new Map();

/** Hand the registry in (the array of report_view/fonts.json). */
export function set_font_registry(list) {
	registry = Array.isArray(list) ? list.filter((e) => e && typeof e.family === "string") : [];
	by_family = new Map(registry.map((e) => [e.family, e]));
}

/** Every family, in the registry's order; the default alone before the registry is loaded. */
export function font_names() {
	return registry.length ? registry.map((e) => e.family) : [DEFAULT_FONT];
}

export function font_info(family) {
	return by_family.get(family) || null;
}

/** A registry family, else `fallback` (the default font). */
export function clean_font(family, fallback = DEFAULT_FONT) {
	return typeof family === "string" && (by_family.has(family) || (!registry.length && family === DEFAULT_FONT)) ? family : fallback;
}

/** The CSS font-family value of a family: itself, then the generic family of its category. */
export function font_stack(family) {
	return `'${family}',${GENERIC[font_info(family)?.category] || "sans-serif"}`;
}

/** The face CSS font matching picks for `wanted` among `available` weights (core/fonts.py). */
export function nearest_weight(available, wanted) {
	const list = [...available].map(Number).sort((a, b) => a - b);
	if (list.includes(wanted)) return wanted;
	if ((wanted === 400 || wanted === 500) && list.includes(900 - wanted)) return 900 - wanted;
	const lighter = list.filter((w) => w < wanted);
	const heavier = list.filter((w) => w > wanted);
	if (wanted <= 500) return lighter.length ? lighter.at(-1) : heavier[0];
	return heavier.length ? heavier[0] : lighter.at(-1);
}

/**
 * The upright faces a page printing `family` at the `used` weights needs (core/fonts.py
 * print_weights): wkhtmltopdf cannot tell 400 from 500, so 500 is left out beside 400.
 */
export function print_weights(family, used) {
	const available = Object.keys(font_info(family)?.weights || {}).map(Number);
	if (!available.length) return [];
	const out = new Set([...used].map((w) => nearest_weight(available, Number(w))));
	if (out.has(400)) out.delete(500);
	return [...out].sort((a, b) => a - b);
}

/**
 * The @font-face rules of a family, its urls under `base` (ending in "/"); `weights`: only
 * those upright faces. Empty for a system font.
 */
export function font_face_css(family, base = ASSET_BASE, weights = null) {
	const e = font_info(family);
	if (!e) return "";
	let css = "";
	for (const [style, key] of [
		["normal", "weights"],
		["italic", "italic"],
	]) {
		for (const [weight, files] of Object.entries(e[key] || {})) {
			if (weights && (style !== "normal" || !weights.includes(Number(weight)))) continue;
			const src = FORMATS.filter(([k]) => files[k])
				.map(([k, fmt]) => `url('${base}${files[k]}') format('${fmt}')`)
				.join(",");
			css += `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:${src}}`;
		}
	}
	return css;
}

/**
 * The families grouped for a picker: Arabic first (by category), then Latin only.
 * @returns {{script:"arabic"|"latin", category:string, fonts:object[]}[]}
 */
export function font_groups(query = "") {
	const q = String(query || "").trim().toLowerCase();
	const out = [];
	for (const script of ["arabic", "latin"]) {
		for (const category of CATEGORIES) {
			const fonts = registry.filter(
				(e) => e.category === category && (script === "arabic" ? e.scripts.includes("arabic") : !e.scripts.includes("arabic")) && (!q || e.family.toLowerCase().includes(q))
			);
			if (fonts.length) out.push({ script, category, fonts });
		}
	}
	return out;
}
