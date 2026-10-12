// Page geometry and the cut of the rows into pages (engine/page_layout.js): pure arithmetic
// on measured heights, nothing of the DOM.
import { test } from "node:test";
import assert from "node:assert/strict";

import { page_box, fit_columns, paginate, preset_margins, MM, MIN_FONT_SCALE } from "../../report_view/public/js/report_view/engine/page_layout.js";

test("page box: A4 portrait and landscape in CSS px, margins inside", () => {
	const p = page_box({ size: "A4", orientation: "portrait", margins: "normal" });
	assert.equal(p.w, Math.round(210 * MM));
	assert.equal(p.h, Math.round(297 * MM));
	assert.equal(p.inner_w, p.w - 2 * p.margin);
	assert.equal(p.paper_w_mm, 210);
	const l = page_box({ size: "A4", orientation: "landscape", margins: "narrow" });
	assert.equal(l.w, Math.round(297 * MM));
	assert.equal(l.h, Math.round(210 * MM));
	assert.ok(l.margin < p.margin);
	assert.equal(l.paper_w_mm, 297);
	// unknown choices fall back to A4 portrait
	const u = page_box({ size: "B5", orientation: "sideways", margins: "huge" });
	assert.equal(u.size, "A4");
	assert.equal(u.orientation, "portrait");
	assert.equal(u.margin, p.margin);
});

test("page box: four margins of their own, in mm; the presets give the same on every side", () => {
	const p = page_box({ size: "A4", orientation: "portrait", page_m: { top: 20, bottom: 10, start: 15, end: 5 } });
	assert.equal(p.pad.top, Math.round(20 * MM));
	assert.equal(p.inner_h, p.h - Math.round(20 * MM) - Math.round(10 * MM));
	assert.equal(p.inner_w, p.w - Math.round(15 * MM) - Math.round(5 * MM));
	assert.equal(p.margin, Math.round(5 * MM));
	assert.deepEqual(preset_margins("wide"), { top: 18, bottom: 18, start: 18, end: 18 });
	assert.equal(page_box({ margins: "narrow" }).pad.start, Math.round(8 * MM));
});

test("fit columns: brought to the print font, narrower columns fill the page", () => {
	// without a text column the room is shared by all
	const fill = fit_columns([130, 130, 260], 800, 13);
	assert.deepEqual(fill.widths.map(Math.round), [200, 200, 400]);
	// with one, the text column takes it all: the numbers keep their width
	const text = fit_columns([{ width: 200, flex: true }, 100, 100], 800, 13);
	assert.deepEqual(text.widths.map(Math.round), [600, 100, 100]);
	assert.equal(fill.font, 13);
	assert.equal(fill.scale, 1);
	assert.equal(fill.overflow, false);
	// the grid's widths are for its 13px font: at a 12px print font they need 12/13 of it
	const half = fit_columns([1300], 1300, 6.5);
	assert.equal(Math.round(half.widths[0]), 1300);
});

test("fit columns: text columns give their room first, numbers keep their width", () => {
	// 400 text + 400 number into 640: the text column narrows to 240, the number stays
	const out = fit_columns([{ width: 400, flex: true }, { width: 400 }], 640, 13);
	assert.deepEqual(out.widths.map(Math.round), [240, 400]);
	assert.equal(out.scale, 1);
	assert.equal(out.font, 13);
});

test("fit columns: a heavier text column takes more of the narrowing, a light one (the label) less", () => {
	const out = fit_columns([{ width: 300, flex: true, weight: 0.5 }, { width: 300, flex: true, weight: 1 }, { width: 200 }], 650, 13);
	// 150 to give: twice as much from the second column as from the label
	assert.deepEqual(out.widths.map(Math.round), [250, 200, 200]);
});

test("fit columns: past the text room every column shrinks with the font, down to a floor", () => {
	const shrink = fit_columns([{ width: 200, flex: true }, { width: 400 }, { width: 400 }], 800, 13);
	// text 200 -> 90 (45%); 890 left for 800: scale 0.9
	assert.equal(Math.round(shrink.scale * 100), 90);
	assert.equal(Math.round(shrink.widths.reduce((a, b) => a + b, 0)), 800);
	assert.equal(shrink.font.toFixed(1), (13 * 0.9).toFixed(1));
	assert.equal(shrink.overflow, false);
	const cut = fit_columns([1000, 1000], 500, 10);
	assert.equal(cut.font, 10 * MIN_FONT_SCALE);
	assert.equal(cut.overflow, true);
	assert.equal(Math.round(cut.widths[0] + cut.widths[1]), 500);
});

const spans = (pages) => pages.map((p) => `${p.start}-${p.end}${p.last ? "L" : ""}`).join(" ");

test("paginate: rows fill every page, the first page carries the filters and the last the tail", () => {
	// 10 rows per page; the first page loses 2 rows to the filters block, the last needs the tail
	const pages = paginate({ count: 25, row_h: 10, body_h: 100, first_h: 20, tail_h: 30 });
	assert.equal(spans(pages), "0-8 8-18 18-25L");
	assert.ok(pages[0].first && !pages[1].first);
});

test("paginate: the tail never stands alone while a row can go with it", () => {
	// 20 rows, 10 per page, tail of 3 rows: the second page keeps 7 rows and the tail
	const a = paginate({ count: 20, row_h: 10, body_h: 100, tail_h: 30 });
	assert.equal(spans(a), "0-10 10-17 17-20L");
	// exactly one page of rows and no room for the tail: the last row moves with it
	const b = paginate({ count: 10, row_h: 10, body_h: 100, tail_h: 10 });
	assert.equal(spans(b), "0-9 9-10L");
	// no rows: one page with the tail
	assert.equal(spans(paginate({ count: 0, row_h: 10, body_h: 100, tail_h: 30 })), "0-0L");
});

test("paginate: a head taller than the first page pushes the rows to the next one; nothing loops", () => {
	const pages = paginate({ count: 3, row_h: 10, body_h: 50, first_h: 60, tail_h: 0 });
	assert.equal(spans(pages), "0-0 0-3L");
	const tiny = paginate({ count: 3, row_h: 10, body_h: 5, tail_h: 0 });
	assert.ok(tiny.length >= 3 && tiny[tiny.length - 1].end === 3);
});
