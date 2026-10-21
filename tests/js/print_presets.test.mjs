// Print presets (ADR-020): what a preset saves, what applying one gives on the same or
// another target, the default preset, and the server's list of keys against the page's.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.__ = (s, args) => String(s).replace(/\{(\d+)\}/g, (m, i) => (args && args[i] !== undefined ? args[i] : m));
const { preset_payload, preset_settings, check_choices, same_settings, default_preset, find_preset, stable, TARGET_KEYS } = await import(
	"../../report_view/public/js/report_view/views/print_presets.js"
);

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "../..");
const DEFAULTS = { size: "A4", orientation: "portrait", page_m: { top: 12, bottom: 12, start: 12, end: 12 }, template: "", letter_head: "", hidden: [], zoom: "fit" };
// a stand-in of sanitize_settings: the known keys of raw over base
const sanitize = (raw, base) => {
	const out = JSON.parse(JSON.stringify(base));
	for (const k of Object.keys(base)) if (raw && raw[k] !== undefined) out[k] = JSON.parse(JSON.stringify(raw[k]));
	return out;
};

test("a preset saves the print settings, not the zoom; one for every target leaves the target's keys out", () => {
	const s = { ...DEFAULTS, orientation: "landscape", hidden: ["debit"], template: "TB Format", zoom: 1.25, preset: "x" };
	const own = preset_payload(s, DEFAULTS, { specific: true });
	assert.equal(own.zoom, undefined);
	assert.equal(own.preset, undefined);
	assert.deepEqual(own.hidden, ["debit"]);
	assert.equal(own.template, "TB Format");
	const general = preset_payload(s, DEFAULTS, { specific: false });
	for (const k of TARGET_KEYS) assert.equal(general[k], undefined);
	assert.equal(general.orientation, "landscape");
	// a key the server does not know (yet) is not sent
	const known = preset_payload(s, DEFAULTS, { keys: ["size", "orientation"] });
	assert.deepEqual(Object.keys(known).sort(), ["orientation", "size"]);
	// a copy: changing the settings later does not change the payload
	s.hidden.push("credit");
	assert.deepEqual(own.hidden, ["debit"]);
});

test("applying a preset of every target keeps this target's columns and format; its own preset brings them", () => {
	const current = { ...DEFAULTS, hidden: ["account_type"], template: "Mine", zoom: 0.8 };
	const general = { specific: false, settings: { orientation: "landscape", hidden: ["debit"], template: "Other report's" } };
	const g = preset_settings(general, current, { sanitize, base: DEFAULTS });
	assert.equal(g.orientation, "landscape");
	assert.deepEqual(g.hidden, ["account_type"]);
	assert.equal(g.template, "Mine");
	assert.equal(g.zoom, 0.8);
	const own = { specific: true, settings: { size: "A3", hidden: ["debit"], template: "TB Format" } };
	const o = preset_settings(own, current, { sanitize, base: DEFAULTS });
	assert.deepEqual(o.hidden, ["debit"]);
	assert.equal(o.template, "TB Format");
	// what the preset does not say comes from the site's standard settings, as Reset
	assert.equal(o.orientation, "portrait");
});

test("choices this page cannot offer fall back; no letter head takes the company's", () => {
	const options = { letter_heads: [{ name: "SND" }], default_letter_head: "SND", print_formats: ["TB Format"], languages: [{ name: "ar" }], print_headings: ["H"], print_signatures: [{ name: "S" }] };
	const s = check_choices({ letter_head: "Gone", template: "Other", lang: "xx", heading: "Nope", signature: "None" }, options);
	assert.deepEqual(s, { letter_head: "SND", template: "", lang: "", heading: "", signature: "" });
	const kept = check_choices({ letter_head: "SND", template: "TB Format", lang: "ar", heading: "H", signature: "S" }, options);
	assert.deepEqual(kept, { letter_head: "SND", template: "TB Format", lang: "ar", heading: "H", signature: "S" });
});

test("the changed dot: the order of keys and the zoom do not count", () => {
	const a = { ...DEFAULTS, page_m: { top: 1, bottom: 2, start: 3, end: 4 } };
	const b = { ...DEFAULTS, zoom: 1.5, page_m: { end: 4, start: 3, bottom: 2, top: 1 } };
	assert.ok(same_settings(a, b, DEFAULTS));
	assert.ok(!same_settings(a, { ...b, size: "A3" }, DEFAULTS));
	assert.equal(stable({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});

test("the default preset: the user's own first (this target's before every target's), then the public one", () => {
	const row = (name, o) => ({ name, specific: false, is_default: false, ...o });
	const list = {
		mine: [row("m-all", { is_default: true }), row("m-tb", { is_default: true, specific: true })],
		public: [row("p-tb", { is_default: true, specific: true })],
	};
	assert.equal(default_preset(list).name, "m-tb");
	assert.equal(default_preset({ mine: [row("m")], public: list.public }).name, "p-tb");
	assert.equal(default_preset({ mine: [], public: [row("p")] }), null);
	assert.equal(default_preset(null), null);
	assert.equal(find_preset(list, "p-tb").name, "p-tb");
	assert.equal(find_preset(list, "gone"), null);
});

test("the server's keys of a preset are the page's settings without the zoom", () => {
	const js = fs.readFileSync(path.join(app, "report_view/public/js/report_view/views/pages_view.js"), "utf8");
	const block = js.slice(js.indexOf("export const DEFAULT_SETTINGS = Object.freeze({"), js.indexOf("\n});", js.indexOf("export const DEFAULT_SETTINGS")));
	const page_keys = [...block.matchAll(/^\t(\w+):/gm)].map((m) => m[1]).filter((k) => k !== "zoom");
	const py = fs.readFileSync(path.join(app, "report_view/core/print_presets.py"), "utf8");
	const set = py.slice(py.indexOf("SETTINGS_KEYS = frozenset("), py.indexOf("\n)", py.indexOf("SETTINGS_KEYS = frozenset(")));
	const server_keys = [...set.matchAll(/"(\w+)"/g)].map((m) => m[1]);
	assert.ok(page_keys.length > 50);
	assert.deepEqual([...server_keys].sort(), [...page_keys].sort());
});
