// The layout of the letter head builder (ADR-018, letterhead/model.js): defaults, limits,
// edits, geometry, snapping and history; pure, nothing of the DOM.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	clamp_layout,
	clamp_element,
	default_layout,
	make_element,
	insert_in_slot,
	move_to_slot,
	make_free,
	duplicate,
	reorder,
	remove,
	find,
	slot_box,
	slot_at,
	insert_index,
	neighbour_slot,
	snap_move,
	resize_rect,
	guide_targets,
	margin_css,
	History,
	Store,
	REF_W,
	LIMITS,
	TOKENS,
} from "../../report_view/public/js/report_view/letterhead/model.js";

test("default layout is the ADR's example", () => {
	const l = default_layout();
	assert.equal(l.v, 1);
	assert.equal(l.font, "IBM Plex Sans Arabic");
	assert.deepEqual(l.colors, { primary: "#1E5C45", text: "#17211C", muted: "#5B6660" });
	assert.deepEqual(l.header, { h: 35, pad_top: 6, slots: { right: 34, center: 26, left: 34 }, elements: [] });
	assert.deepEqual(l.footer, { h: 15, pad_top: 3, slots: { right: 40, center: 20, left: 40 }, elements: [] });
	assert.deepEqual(clamp_layout(l), l);
});

test("clamp: heights, padding, slots, fonts and colours stay in their limits", () => {
	const l = clamp_layout({
		font: "Comic Sans",
		colors: { primary: "red", text: "#abcdef", muted: "#12345" },
		header: { h: 200, pad_top: -3, slots: { right: 90, center: 60, left: 50 } },
		footer: { h: -1, pad_top: 40 },
	});
	assert.equal(l.font, "IBM Plex Sans Arabic");
	assert.deepEqual(l.colors, { primary: "#1E5C45", text: "#ABCDEF", muted: "#5B6660" });
	assert.equal(l.header.h, 80);
	assert.equal(l.header.pad_top, 0);
	assert.equal(l.footer.h, 0);
	assert.equal(l.footer.pad_top, 20);
	const s = l.header.slots;
	assert.ok(s.right <= 70 && s.center <= 70 && s.left <= 70);
	assert.ok(s.right + s.center + s.left <= 100, JSON.stringify(s));
	assert.equal(clamp_layout({ header: { h: 5 } }).header.h, 10);
	assert.equal(clamp_layout(null).v, 1);
});

test("clamp: elements — types, ids, style, props, the 60 limit", () => {
	const els = [
		{ id: "e1", type: "field", slot: "right", style: { size: 99, weight: 450, color: "pink", align: "x", gap: 30 }, props: { token: "nope", label: "x".repeat(100) } },
		{ id: "e1", type: "text", slot: "left", props: { text: "y".repeat(900), dir: "up" } },
		{ id: "BAD ID", type: "image", slot: null, x: 500, y: 90, w: 0, props: { src: "/private/files/a.png" } },
		{ type: "script" },
		{ id: "q", type: "qr", slot: "middle", props: { source: "url" } },
		{ id: "l", type: "line", slot: "center", props: { thick: 9, style: "wavy" } },
		{ id: "b", type: "band", slot: null, x: 0, y: 0, w: 180, h: 9, props: { fill: "#00ff00", radius: 40 } },
		{ id: "p", type: "page", slot: "center", props: { format: "fr" } },
	];
	const l = clamp_layout({ header: { elements: els } });
	const e = l.header.elements;
	assert.equal(e.length, 7, "unknown type dropped");
	assert.equal(e[0].style.size, 40);
	assert.equal(e[0].style.weight, 400);
	assert.equal(e[0].style.color, "muted");
	assert.equal(e[0].style.align, "start");
	assert.equal(e[0].style.gap, 10);
	assert.equal(e[0].props.token, "company_name");
	assert.equal(e[0].props.label.length, LIMITS.label);
	assert.equal(e[0].props.hide_empty, true);
	assert.notEqual(e[1].id, "e1", "duplicate id renamed");
	assert.equal(e[1].props.text.length, LIMITS.text);
	assert.equal(e[1].props.dir, "auto");
	assert.match(e[2].id, /^[a-z0-9]{1,12}$/);
	assert.equal(e[2].props.src, "", "private file refused");
	assert.ok(e[2].x + e[2].w <= REF_W, "free element inside the band");
	assert.ok(e[2].y < l.header.h);
	assert.equal(e[3].slot, null, "unknown slot = free");
	assert.equal(e[3].props.source, "website");
	assert.equal(e[4].props.thick, 3);
	assert.equal(e[4].props.style, "solid");
	assert.equal(e[5].props.fill, "#00FF00");
	assert.equal(e[5].props.radius, 10);
	assert.equal(e[6].props.format, "both");
	assert.equal(new Set(e.map((x) => x.id)).size, e.length);
	const many = clamp_layout({ header: { elements: Array.from({ length: 80 }, (_, i) => ({ id: `t${i}`, type: "text", slot: "right" })) } });
	assert.equal(many.header.elements.length, LIMITS.elements);
	assert.equal(TOKENS.length, 13);
});

test("clamp_element: a box always has a size; a free text keeps auto height", () => {
	const logo = clamp_element({ id: "a", type: "logo", slot: "center", w: 0, h: 0 });
	assert.ok(logo.w > 0 && logo.h > 0);
	const t = clamp_element({ id: "t", type: "text", slot: null, x: 10, y: 5, w: 50, h: 0 });
	assert.equal(t.h, 0);
	assert.equal(t.x, 10);
});

test("slots: geometry, hit test, neighbours", () => {
	const b = default_layout().header;
	assert.deepEqual(slot_box(b, "left"), { x: 0, w: 61.2 });
	assert.deepEqual(slot_box(b, "right"), { x: 118.8, w: 61.2 });
	assert.deepEqual(slot_box(b, "center"), { x: 66.6, w: 46.8 });
	assert.equal(slot_at(b, 5), "left");
	assert.equal(slot_at(b, 90), "center");
	assert.equal(slot_at(b, 175), "right");
	assert.equal(slot_at(b, 64), null, "the gap between slots");
	assert.equal(neighbour_slot(b, "right", -1), "center");
	assert.equal(neighbour_slot(b, "left", -1), null);
	const two = { ...b, slots: { right: 50, center: 0, left: 50 } };
	assert.equal(neighbour_slot(two, "right", -1), "left", "a closed slot is skipped");
	assert.equal(insert_index([2, 6, 10], 1), 0);
	assert.equal(insert_index([2, 6, 10], 7), 2);
	assert.equal(insert_index([2, 6, 10], 12), 3);
});

test("edits: insert, move between slots and bands, free, dock, duplicate, reorder, remove", () => {
	const l = default_layout();
	const a = insert_in_slot(l, make_element(l, "field", { props: { token: "company_name_ar" } }), "header", "right");
	const b = insert_in_slot(l, make_element(l, "field", { props: { token: "address" } }), "header", "right");
	const c = insert_in_slot(l, make_element(l, "logo"), "header", "center");
	assert.deepEqual(l.header.elements.map((e) => e.id), [a.id, b.id, c.id]);
	// b goes first in its slot
	move_to_slot(l, b.id, "header", "right", 0);
	assert.deepEqual(l.header.elements.filter((e) => e.slot === "right").map((e) => e.id), [b.id, a.id]);
	// the logo into the footer's left slot
	move_to_slot(l, c.id, "footer", "left", 0);
	assert.equal(find(l, c.id).band, "footer");
	assert.equal(find(l, c.id).el.slot, "left");
	// free, then docked again
	const f = make_free(l, a.id, "header", { x: 170, y: 4, w: 40 });
	assert.equal(f.slot, null);
	assert.equal(f.x, REF_W - 40, "kept inside the band");
	move_to_slot(l, a.id, "header", "center", 0);
	assert.equal(find(l, a.id).el.slot, "center");
	assert.equal(find(l, a.id).el.x, 0);
	// duplicate a free element: beside it, a new id
	make_free(l, a.id, "header", { x: 10, y: 4, w: 40 });
	const d = duplicate(l, a.id);
	assert.notEqual(d.id, a.id);
	assert.equal(d.x, 13);
	assert.equal(d.y, 7);
	// reorder: the drawing order of the free ones
	const before = l.header.elements.map((e) => e.id);
	assert.equal(reorder(l, d.id, -1), true);
	assert.notDeepEqual(l.header.elements.map((e) => e.id), before);
	assert.equal(reorder(l, b.id, -1), false, "first of its slot");
	assert.ok(remove(l, d.id));
	assert.equal(find(l, d.id), null);
	assert.equal(clamp_layout(l).header.elements.length, l.header.elements.length);
});

test("snap: grid, then the guides of edges and centres win within 1.5mm", () => {
	const t = guide_targets({ h: 35, pad_top: 6, slots: { right: 34, center: 26, left: 34 } }, [{ x: 20, y: 10, w: 30, h: 8 }]);
	assert.ok(t.v.includes(90) && t.v.includes(20) && t.v.includes(35) && t.v.includes(50));
	assert.ok(t.h.includes(35) && t.h.includes(17.5) && t.h.includes(6));
	// near nothing: the grid
	let s = snap_move({ x: 103.4, y: 23.6, w: 10, h: 4 }, { v: [], h: [] });
	assert.deepEqual([s.x, s.y], [103, 24]);
	assert.deepEqual(s.guides, { v: [], h: [] });
	// the centre of a 20mm box near the band's centre
	s = snap_move({ x: 79.2, y: 0.8, w: 20, h: 4 }, t);
	assert.equal(s.x, 80);
	assert.ok(s.guides.v.includes(90));
	assert.equal(s.y, 0);
	// no guides when turned off
	s = snap_move({ x: 79.2, y: 13.3, w: 20, h: 4 }, t, { guides: false });
	assert.equal(s.x, 79);
});

test("resize: each handle, grid, minimum, band", () => {
	const r = { x: 10, y: 5, w: 40, h: 10 };
	assert.deepEqual(resize_rect(r, "e", 5.4, 0), { x: 10, y: 5, w: 45, h: 10 });
	assert.deepEqual(resize_rect(r, "w", -3.2, 0), { x: 7, y: 5, w: 43, h: 10 });
	assert.deepEqual(resize_rect(r, "s", 0, 2.6), { x: 10, y: 5, w: 40, h: 13 });
	assert.deepEqual(resize_rect(r, "nw", 2, 2), { x: 12, y: 7, w: 38, h: 8 });
	assert.deepEqual(resize_rect(r, "se", -100, -100), { x: 10, y: 5, w: 2, h: 1 }, "never under the minimum");
	assert.equal(resize_rect(r, "e", 500, 0).w, REF_W - 10, "never out of the band");
	assert.equal(resize_rect(r, "w", -50, 0).x, 0);
});

test("margin line for wkhtmltopdf uses the header and footer heights (as the server's)", () => {
	const l = default_layout();
	assert.equal(margin_css(l), ".print-format{margin-top: 50mm; margin-bottom: 25mm;}");
	l.footer.h = 0;
	assert.equal(margin_css(l), ".print-format{margin-top: 50mm;}");
});

test("history: undo, redo, merge of quick nudges", () => {
	const h = new History();
	h.reset({ n: 0 });
	h.push({ n: 1 });
	h.push({ n: 2 }, "nudge", 1000);
	h.push({ n: 3 }, "nudge", 1500);
	assert.deepEqual(h.undo(), { n: 1 }, "two nudges are one step");
	assert.deepEqual(h.undo(), { n: 0 });
	assert.equal(h.undo(), null);
	assert.deepEqual(h.redo(), { n: 1 });
	h.push({ n: 9 });
	assert.equal(h.can_redo, false, "a new change drops the future");
	assert.equal(h.push({ n: 9 }), false, "nothing changed, nothing recorded");
});

test("store: commit, select, dirty, undo/redo, replace", () => {
	const s = new Store();
	const seen = [];
	s.on((k) => seen.push(k));
	assert.equal(s.dirty, false);
	const el = s.commit((l) => insert_in_slot(l, make_element(l, "text", { props: { text: "Hi" } }), "header", "left"), { select: (e) => e.id });
	assert.equal(s.selected, el.id);
	assert.equal(s.dirty, true);
	assert.equal(s.layout.header.elements.length, 1);
	s.undo();
	assert.equal(s.layout.header.elements.length, 0);
	assert.equal(s.selected, null, "selection of a removed element is dropped");
	s.redo();
	assert.equal(s.layout.header.elements.length, 1);
	s.mark_saved();
	assert.equal(s.dirty, false);
	s.replace(default_layout(), { fresh: true });
	assert.equal(s.history.can_undo, false);
	assert.ok(seen.includes("layout") && seen.includes("saved"));
});

test("a band made lower keeps its free elements inside it; slotted ones are not moved", async () => {
	const { clamp_layout, set_band_height } = await import("../../report_view/public/js/report_view/letterhead/model.js");
	const l = clamp_layout({ v: 1, header: { h: 40, elements: [
		{ id: "a", type: "line", slot: null, x: 0, y: 36, w: 180, props: { thick: 0.8 } },
		{ id: "b", type: "band", slot: null, x: 0, y: 30, w: 50, h: 8, props: { fill: "primary" } },
		{ id: "c", type: "text", slot: "right", props: { text: "x" } },
	] } });
	set_band_height(l, "header", 30);
	assert.equal(l.header.h, 30);
	assert.equal(l.header.elements[0].y, 29.2);
	assert.equal(l.header.elements[1].y, 22);
	assert.equal(l.header.elements[2].y, 0);
});

test("colour band corners: kept as the server keeps them, drawn on the chosen corners only", async () => {
	const { band_corners, band_radius, clamp_layout } = await import("../../report_view/public/js/report_view/letterhead/model.js");
	assert.equal(band_corners(undefined), "all");
	assert.equal(band_corners("br,tl"), "tl,br");
	assert.equal(band_corners("tl,tr,br,bl"), "all");
	assert.equal(band_corners("xx"), "all");
	assert.equal(band_radius({ radius: 10, corners: "br" }), "0 0 10mm 0");
	assert.equal(band_radius({ radius: 3, corners: "all" }), "3mm");
	const l = clamp_layout({ v: 1, header: { h: 30, elements: [{ id: "b", type: "band", slot: null, x: 0, y: 0, w: 50, h: 20, props: { fill: "primary", radius: 10, corners: "br" } }] } });
	assert.equal(l.header.elements[0].props.corners, "br");
});
