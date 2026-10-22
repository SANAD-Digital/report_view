// The settings of the Pages view (views/pages/settings.js): every value of a saved or sent
// setting checked, wrong ones falling back to the base; the pages a part prints on.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_json.mjs";

const { sanitize_settings, on_page, clamp, DEFAULT_SETTINGS, NUMS, PAGE_STYLES } = await import("../../report_view/public/js/report_view/views/pages/settings.js");

test("no saved settings: the defaults, as a copy", () => {
	const s = sanitize_settings(null);
	assert.deepEqual(s, { ...DEFAULT_SETTINGS, hidden: [] });
	assert.notEqual(s.page_m, DEFAULT_SETTINGS.page_m);
	s.hidden.push("x");
	assert.deepEqual(DEFAULT_SETTINGS.hidden, []);
});

test("wrong values fall back, right ones are kept; numbers clamped to their step", () => {
	const s = sanitize_settings({
		size: "A3",
		orientation: "sideways",
		style: "modern",
		number_pos: "middle",
		lh_height: 500,
		number_size: 7.3,
		head_line_c: "red",
		foot_line_c: "#2d5c93",
		wm_image: "javascript:alert(1)",
		wm_text: "x".repeat(300),
		hidden: ["a", 3, "b"],
		zoom: 9,
	});
	assert.equal(s.size, "A3");
	assert.equal(s.orientation, DEFAULT_SETTINGS.orientation);
	assert.equal(s.style, "modern");
	assert.equal(s.number_pos, DEFAULT_SETTINGS.number_pos);
	assert.equal(s.lh_height, NUMS.lh_height[1]);
	assert.equal(s.number_size, 7.5);
	assert.equal(s.head_line_c, "");
	assert.equal(s.foot_line_c, "#2d5c93");
	assert.equal(s.wm_image, "");
	assert.equal(s.wm_text.length, 120);
	assert.deepEqual(s.hidden, ["a", "b"]);
	assert.equal(s.zoom, "fit");
	assert.ok(PAGE_STYLES.some((x) => x.id === s.style));
});

test("margins: a preset writes the four, custom keeps the typed ones; boxes clamped", () => {
	assert.equal(sanitize_settings({ margins: "wide" }).page_m.top, 18);
	const typed = sanitize_settings({ margins: "custom", page_m: { top: 5, bottom: 99, start: "x", end: 7.26 } });
	assert.equal(typed.margins, "custom");
	assert.deepEqual(typed.page_m, { top: 5, bottom: 60, start: DEFAULT_SETTINGS.page_m.start, end: 7.5 });
});

test("the switches of earlier versions are read: letter head and footer on every page", () => {
	assert.equal(sanitize_settings({ lh_repeat: true }).lh_pages, "all");
	assert.equal(sanitize_settings({ letterhead_all: false }).lh_pages, "first");
	assert.equal(sanitize_settings({ foot_repeat: false }).foot_pages, "last");
	// the newer setting wins
	assert.equal(sanitize_settings({ lh_repeat: true, lh_pages: "rest" }).lh_pages, "rest");
});

test("a base (the site's standard settings) under the saved ones", () => {
	const base = sanitize_settings({ size: "Letter", style: "ledger" });
	const s = sanitize_settings({ style: "nope" }, base);
	assert.equal(s.size, "Letter");
	assert.equal(s.style, "ledger");
});

test("on_page: every page, the first, all but the first, the last", () => {
	assert.deepEqual([1, 2, 3].map((n) => on_page("all", n, 3)), [true, true, true]);
	assert.deepEqual([1, 2, 3].map((n) => on_page("first", n, 3)), [true, false, false]);
	assert.deepEqual([1, 2, 3].map((n) => on_page("rest", n, 3)), [false, true, true]);
	assert.deepEqual([1, 2, 3].map((n) => on_page("last", n, 3)), [false, false, true]);
	assert.equal(clamp("abc", [0, 1, 1]), null);
});
