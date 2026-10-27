// The layout of a letter head (ADR-018, «عقد التخطيط»): its defaults, its limits, the
// clamping that keeps any layout inside them, the geometry of the slots, snapping and the
// alignment guides, the history of the editor. Pure: nothing of the DOM or of Frappe, so the
// same rules are tested in node (tests/js/letterhead_model.test.mjs).
// The contract (limits, fields, element and band defaults) is report_view/letterhead_contract.json,
// the file core/letterhead.py validates with: the server checks the layout again before it
// generates any HTML; these rules only keep the editor honest.

import CONTRACT from "../../../../letterhead_contract.json";
import { DEFAULT_FONT, clean_font } from "../fonts.js";

const deep_freeze = (v) => {
	if (v && typeof v === "object") for (const k of Object.keys(v)) deep_freeze(v[k]);
	return Object.freeze(v);
};
const C = deep_freeze(JSON.parse(JSON.stringify(CONTRACT)));
export { C as CONTRACT };

export const VERSION = C.version;
// x and w are millimetres on a reference width of 180mm (A4 portrait less 15mm margins) and
// are written to the HTML as percentages; y and h are millimetres.
export const REF_W = C.ref_width;
export const PAGE = C.page;
// The fonts are the library's (report_view/fonts.json through ../fonts.js): the registry the
// server validates against too.
export { DEFAULT_FONT, font_names } from "../fonts.js";
export const BANDS = Object.freeze(Object.keys(C.bands));
// Physical order on the page, left to right, is left · center · right; the editor lists them
// in reading order of the paper: right (Arabic) · center · left (English).
export const SLOTS = C.slots;
export const TYPES = C.types;
export const TOKENS = C.tokens;
// Values written left to right inside <bdi dir="ltr">: numbers, mail, the site.
export const LTR_TOKENS = Object.freeze(new Set(C.ltr_tokens));
// Values whose line breaks print (the address, the registration details).
export const MULTILINE_TOKENS = Object.freeze(new Set(C.multiline_tokens));
export const COLOR_NAMES = C.color_names;
export const WEIGHTS = C.weights;
export const ALIGNS = C.aligns;
// Types drawn as a box of w × h (the rest flow as text, or as a rule for the line).
export const BOXED = Object.freeze(new Set(C.boxed));
// Types that carry text and its style (size, weight).
export const TEXTUAL = Object.freeze(new Set(C.textual));
export const CHOICES = C.choices;
const L = C.limits;
export const LIMITS = Object.freeze({
	header_h: C.bands.header.h,
	footer_h: C.bands.footer.h,
	pad_top: C.bands.header.pad_top,
	slot: L.slot,
	slots_sum: L.slots_sum,
	size: L.size,
	gap: L.gap,
	thick: L.thick,
	radius: L.radius,
	text: L.text,
	label: L.label,
	qr_text: L.qr_text,
	elements: L.elements,
	bytes: L.layout_bytes,
	// the editor's own floor for a free element (mm), so it can always be grabbed
	min_w: L.min_w,
	min_h: L.min_h,
	free_w: L.free_w,
	double_line_min: L.double_line_min,
});
// A public file or an asset, as the server accepts it (no quote, bracket or parent segment).
const SRC_RE = new RegExp(C.image_src);
export const is_image_src = (s) => typeof s === "string" && SRC_RE.test(s) && !s.includes("/../") && !s.includes(".__");

export const GRID_MM = 1;
const SNAP_MM = 1.5;
export const NUDGE_MM = 1;
export const NUDGE_BIG_MM = 5;

const ID_RE = /^[a-z0-9]{1,12}$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const DEFAULT_COLORS = C.default_colors;

// The slot widths offered by the band inspector (percent of the band, right · center · left).
export const SLOT_PRESETS = Object.freeze({
	three: Object.freeze({ right: 34, center: 26, left: 34 }),
	two: Object.freeze({ right: 50, center: 0, left: 50 }),
	logo_right: Object.freeze({ right: 22, center: 0, left: 70 }),
	center_only: Object.freeze({ right: 0, center: 70, left: 0 }),
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(+v) ? +v : d);
/** The rounded corners of a colour band, as the server keeps them: "all" or some of tl, tr, br, bl. */
export const CORNERS = C.corners;
export function band_corners(v) {
	const parts = typeof v === "string" && v !== "all" ? v.split(",") : CORNERS;
	const picked = CORNERS.filter((c) => parts.includes(c));
	return !picked.length || picked.length === 4 ? "all" : picked.join(",");
}

/** A number for CSS as the server writes it (core/letterhead.py `_n`): 4 decimals, no trailing zeros. */
export const css_num = (v) => String(+(+v).toFixed(4));

/** The CSS border-radius of a colour band: its radius on its rounded corners only. */
export function band_radius(props) {
	const r = `${css_num(+props.radius || 0)}mm`;
	if (!props.corners || props.corners === "all") return r;
	const on = props.corners.split(",");
	return CORNERS.map((c) => (on.includes(c) ? r : "0")).join(" ");
}

/** A number within [lo, hi], rounded to a tenth of a millimetre (or to `step`). */
export function clamp(v, lo, hi, d = lo, step = 0.1) {
	const n = Math.min(hi, Math.max(lo, num(v, d)));
	return +(Math.round(n / step) * step).toFixed(2);
}
const str = (v, max) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const one_of = (v, list, d) => (list.includes(v) ? v : d);
export const is_hex = (v) => typeof v === "string" && HEX_RE.test(v);
const color = (v, d) => (COLOR_NAMES.includes(v) ? v : is_hex(v) ? v.toUpperCase() : d);

export function default_band(name) {
	return { ...clone(C.bands[name].default), elements: [] };
}

export function default_layout() {
	return { v: VERSION, font: DEFAULT_FONT, colors: { ...DEFAULT_COLORS }, header: default_band("header"), footer: default_band("footer") };
}

/** What a new element of a type starts with (style and props), before its place is set. */
export function element_defaults(type) {
	const d = C.element_defaults[type];
	return d ? clone(d) : null;
}

// ------------------------------------------------------------------ clamping

function clamp_props(type, p = {}) {
	switch (type) {
		case "text":
			return { text: str(p.text, LIMITS.text), dir: one_of(p.dir, CHOICES["text.dir"], "auto") };
		case "field":
			return { token: one_of(p.token, TOKENS, "company_name"), label: str(p.label, LIMITS.label), hide_empty: p.hide_empty !== false && p.hide_empty !== 0 };
		case "logo":
			return {};
		case "image":
			return { src: is_image_src(p.src) ? p.src : "", fit: one_of(p.fit, CHOICES["image.fit"], "contain") };
		case "line":
			return { thick: clamp(p.thick, ...LIMITS.thick, C.element_defaults.line.props.thick), style: one_of(p.style, CHOICES["line.style"], "solid") };
		case "band":
			return { fill: color(p.fill, "primary"), radius: clamp(p.radius, ...LIMITS.radius, 0), corners: band_corners(p.corners) };
		case "qr":
			return { source: one_of(p.source, CHOICES["qr.source"], "website"), text: str(p.text, LIMITS.qr_text) };
		case "page":
			return { format: one_of(p.format, CHOICES["page.format"], "both") };
		default:
			return {};
	}
}

/** One element inside the limits of its band (height `band_h`); null when it cannot be kept. */
export function clamp_element(raw, band_h = L.y[1]) {
	if (!raw || typeof raw !== "object" || !TYPES.includes(raw.type)) return null;
	const d = element_defaults(raw.type);
	const slot = SLOTS.includes(raw.slot) ? raw.slot : null;
	const s = raw.style || {};
	const el = {
		id: typeof raw.id === "string" && ID_RE.test(raw.id) ? raw.id : "",
		type: raw.type,
		slot,
		x: 0,
		y: 0,
		w: clamp(raw.w, ...L.w, d.w),
		h: clamp(raw.h, ...L.h, d.h),
		style: {
			size: clamp(s.size, ...LIMITS.size, d.style.size, 0.5),
			weight: WEIGHTS.includes(+s.weight) ? +s.weight : d.style.weight,
			color: color(s.color, d.style.color),
			align: one_of(s.align, ALIGNS, d.style.align),
			gap: clamp(s.gap, ...LIMITS.gap, d.style.gap),
		},
		props: clamp_props(raw.type, raw.props),
	};
	// boxes (logo, image, QR, colour band) always have a size
	if (BOXED.has(el.type)) {
		if (!el.w) el.w = d.w;
		if (!el.h) el.h = d.h;
	}
	if (slot === null) {
		// a free element: always grabbable, never wholly outside its band
		el.w = clamp(el.w || d.w || LIMITS.free_w, LIMITS.min_w, REF_W);
		el.x = clamp(raw.x, 0, REF_W - el.w, 0);
		el.y = clamp(raw.y, 0, Math.max(0, band_h - LIMITS.min_h), 0);
		if (el.h) el.h = clamp(el.h, LIMITS.min_h, L.h[1]);
	}
	return el;
}

function clamp_slots(raw = {}, d) {
	const out = {};
	for (const s of SLOTS) out[s] = clamp(raw[s], ...LIMITS.slot, d[s], 1);
	const sum = SLOTS.reduce((n, s) => n + out[s], 0);
	if (sum > LIMITS.slots_sum) {
		const k = LIMITS.slots_sum / sum;
		for (const s of SLOTS) out[s] = Math.floor(out[s] * k);
	}
	return out;
}

function clamp_band(name, raw = {}, ids) {
	const d = default_band(name);
	const [lo, hi] = name === "header" ? LIMITS.header_h : LIMITS.footer_h;
	const band = {
		h: clamp(raw.h, lo, hi, d.h, 0.5),
		pad_top: clamp(raw.pad_top, ...LIMITS.pad_top, d.pad_top, 0.5),
		slots: clamp_slots(raw.slots, d.slots),
		elements: [],
	};
	for (const r of Array.isArray(raw.elements) ? raw.elements : []) {
		if (band.elements.length >= LIMITS.elements) break;
		const el = clamp_element(r, band.h);
		if (!el) continue;
		if (!el.id || ids.has(el.id)) el.id = "";
		if (el.id) ids.add(el.id);
		band.elements.push(el);
	}
	return band;
}

/** Any layout (stored, from a preset, hand-made) as a valid v1 layout: a new object. */
export function clamp_layout(raw) {
	const r = raw && typeof raw === "object" ? raw : {};
	const ids = new Set();
	const c = r.colors || {};
	const layout = {
		v: VERSION,
		font: clean_font(r.font),
		colors: { primary: is_hex(c.primary) ? c.primary.toUpperCase() : DEFAULT_COLORS.primary, text: is_hex(c.text) ? c.text.toUpperCase() : DEFAULT_COLORS.text, muted: is_hex(c.muted) ? c.muted.toUpperCase() : DEFAULT_COLORS.muted },
		header: clamp_band("header", r.header, ids),
		footer: clamp_band("footer", r.footer, ids),
	};
	// elements that came without a usable id get the next free one
	for (const b of BANDS) for (const el of layout[b].elements) if (!el.id) ids.add((el.id = next_id(ids)));
	return layout;
}

function next_id(ids) {
	let n = ids.size + 1;
	while (ids.has(`e${n}`)) n++;
	return `e${n}`;
}

function all_ids(layout) {
	return new Set(BANDS.flatMap((b) => layout[b].elements.map((e) => e.id)));
}

// ------------------------------------------------------------------ lookups and edits

/** {band, el, index} of an element, or null. */
export function find(layout, id) {
	for (const band of BANDS) {
		const index = layout[band].elements.findIndex((e) => e.id === id);
		if (index >= 0) return { band, el: layout[band].elements[index], index };
	}
	return null;
}

export function slot_elements(layout, band, slot) {
	return layout[band].elements.filter((e) => e.slot === slot);
}

/** A new element of `type` with `patch` (place, props, style), its id given. */
export function make_element(layout, type, patch = {}) {
	const d = element_defaults(type);
	if (!d) return null;
	return { id: next_id(all_ids(layout)), type, slot: null, x: 0, y: 0, ...d, ...patch, style: { ...d.style, ...(patch.style || {}) }, props: { ...d.props, ...(patch.props || {}) } };
}

/** Puts `el` (already out of any band) into `band`/`slot` at `index` among that slot's elements. */
export function insert_in_slot(layout, el, band, slot, index = Infinity) {
	const list = layout[band].elements;
	el.slot = slot;
	el.x = 0;
	el.y = 0;
	const mates = list.filter((e) => e.slot === slot);
	if (index >= mates.length) {
		const last = mates.at(-1);
		list.splice(last ? list.indexOf(last) + 1 : list.length, 0, el);
	} else {
		list.splice(list.indexOf(mates[Math.max(0, index)]), 0, el);
	}
	return el;
}

/** Takes an element out of its band; returns it, or null. */
export function remove(layout, id) {
	const f = find(layout, id);
	if (!f) return null;
	layout[f.band].elements.splice(f.index, 1);
	return f.el;
}

/** Moves an element into a slot (of any band) at an index of that slot. */
export function move_to_slot(layout, id, band, slot, index = Infinity) {
	const f = find(layout, id);
	if (!f) return null;
	// the index is counted without the element itself when it stays in the same slot
	const el = remove(layout, id);
	return insert_in_slot(layout, el, band, slot, index);
}

/** Makes an element free in `band` at a rectangle (mm); keeps its size when none is given. */
export function make_free(layout, id, band, rect = {}) {
	const el = remove(layout, id);
	if (!el) return null;
	const d = element_defaults(el.type);
	el.slot = null;
	el.w = clamp(rect.w ?? (el.w || d.w || LIMITS.free_w), LIMITS.min_w, REF_W);
	el.h = rect.h ?? el.h;
	el.x = clamp(rect.x ?? 0, 0, REF_W - el.w);
	el.y = clamp(rect.y ?? 0, 0, Math.max(0, layout[band].h - LIMITS.min_h));
	layout[band].elements.push(el);
	return el;
}

/** A band's new height: its free elements move up so none is left below its bottom edge. */
export function set_band_height(layout, band, h) {
	const b = layout[band];
	const [lo, hi] = band === "header" ? LIMITS.header_h : LIMITS.footer_h;
	b.h = clamp(h, lo, hi, b.h, 0.5);
	for (const el of b.elements) {
		if (el.slot !== null) continue;
		const tall = el.type === "line" ? el.props.thick || 0 : el.h || LIMITS.min_h;
		el.y = Math.max(0, Math.min(el.y, +(b.h - tall).toFixed(1)));
	}
}

/** A copy of an element next to it: after it in its slot, or 3mm lower and to the side when free. */
export function duplicate(layout, id) {
	const f = find(layout, id);
	if (!f) return null;
	const copy = { ...clone(f.el), id: next_id(all_ids(layout)) };
	if (copy.slot === null) {
		copy.x = clamp(copy.x + 3, 0, REF_W - copy.w);
		copy.y = clamp(copy.y + 3, 0, Math.max(0, layout[f.band].h - LIMITS.min_h));
	}
	layout[f.band].elements.splice(f.index + 1, 0, copy);
	return copy;
}

/** One step up (-1) or down (+1): in its slot for a slotted element, in the drawing order when free. */
export function reorder(layout, id, step) {
	const f = find(layout, id);
	if (!f) return false;
	const list = layout[f.band].elements;
	const mates = list.filter((e) => e.slot === f.el.slot);
	const i = mates.indexOf(f.el);
	const other = mates[i + step];
	if (!other) return false;
	const j = list.indexOf(other);
	list[f.index] = other;
	list[j] = f.el;
	return true;
}

/** The slot beside `slot` on the paper, toward the left (-1) or the right (+1), skipping closed ones. */
export function neighbour_slot(band_obj, slot, dir) {
	const physical = ["left", "center", "right"];
	let i = physical.indexOf(slot) + dir;
	while (i >= 0 && i < physical.length) {
		if (band_obj.slots[physical[i]] > 0) return physical[i];
		i += dir;
	}
	return null;
}

// ------------------------------------------------------------------ geometry (mm)

/** The horizontal box of a slot on the band (mm from the left of the 180mm band). */
export function slot_box(band_obj, slot) {
	const w = (band_obj.slots[slot] / 100) * REF_W;
	const x = slot === "left" ? 0 : slot === "right" ? REF_W - w : (REF_W - w) / 2;
	return { x: +x.toFixed(2), w: +w.toFixed(2) };
}

/** Which open slot holds the point x (mm), or null (a gap between the slots). */
export function slot_at(band_obj, x) {
	for (const s of SLOTS) {
		if (!band_obj.slots[s]) continue;
		const b = slot_box(band_obj, s);
		if (x >= b.x && x <= b.x + b.w) return s;
	}
	return null;
}

/** Where an element lands among the stacked ones: the index of the first whose middle is below y. */
export function insert_index(mids, y) {
	const i = mids.findIndex((m) => y < m);
	return i < 0 ? mids.length : i;
}

export const snap_grid = (v, step = GRID_MM) => +(Math.round(v / step) * step).toFixed(2);

/**
 * The alignment of a moving rectangle with the lines of the band and of the other elements.
 * `targets` = {v: [x…], h: [y…]} (mm); the rectangle snaps by its edges and centre to the
 * nearest line within `threshold`, else to the grid when `grid` is set.
 * @returns {{x:number, y:number, guides:{v:number[], h:number[]}}}
 */
export function snap_move(rect, targets, { threshold = SNAP_MM, grid = GRID_MM, guides = true } = {}) {
	const axis = (pos, size, lines) => {
		if (guides) {
			let best = null;
			for (const off of [0, size / 2, size]) {
				for (const line of lines) {
					const d = line - (pos + off);
					if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line };
				}
			}
			if (best) {
				const p = +(pos + best.d).toFixed(2);
				const hit = lines.filter((l) => [0, size / 2, size].some((o) => Math.abs(l - (p + o)) < 0.05));
				return { p, lines: [...new Set(hit)] };
			}
		}
		return { p: grid ? snap_grid(pos, grid) : pos, lines: [] };
	};
	const ax = axis(rect.x, rect.w, targets.v || []);
	const ay = axis(rect.y, rect.h, targets.h || []);
	return { x: ax.p, y: ay.p, guides: { v: ax.lines, h: ay.lines } };
}

/**
 * A rectangle resized from a handle (n, s, e, w and the corners; e = toward the right of the
 * paper) by dx/dy mm, snapped to the grid, never under the minimum size nor out of the band.
 */
export function resize_rect(start, handle, dx, dy, { band_h = 80, grid = GRID_MM, min_w = LIMITS.min_w, min_h = LIMITS.min_h } = {}) {
	let { x, y, w, h } = start;
	const g = (v) => (grid ? snap_grid(v, grid) : v);
	if (handle.includes("e")) w = Math.min(REF_W - x, Math.max(min_w, g(x + w + dx) - x));
	if (handle.includes("w")) {
		const right = x + w;
		x = Math.max(0, Math.min(right - min_w, g(x + dx)));
		w = right - x;
	}
	if (handle.includes("s")) h = Math.max(min_h, g(y + h + dy) - y);
	if (handle.includes("n")) {
		const bottom = y + h;
		y = Math.max(0, Math.min(bottom - min_h, g(y + dy)));
		h = bottom - y;
	}
	h = Math.min(h, Math.max(min_h, band_h - y + 40));
	const r = (v) => +v.toFixed(2);
	return { x: r(x), y: r(y), w: r(w), h: r(h) };
}

/** The lines a moving element aligns with: band edges and centre, slot edges, other boxes. */
export function guide_targets(band_obj, others = []) {
	const v = [0, REF_W / 2, REF_W];
	const h = [0, band_obj.h / 2, band_obj.h, band_obj.pad_top];
	for (const s of SLOTS) {
		if (!band_obj.slots[s]) continue;
		const b = slot_box(band_obj, s);
		v.push(b.x, b.x + b.w);
	}
	for (const o of others) {
		v.push(o.x, o.x + o.w / 2, o.x + o.w);
		h.push(o.y, o.y + o.h / 2, o.y + o.h);
	}
	const uniq = (a) => [...new Set(a.map((n) => +n.toFixed(2)))];
	return { v: uniq(v), h: uniq(h) };
}

export function layout_bytes(layout) {
	return new TextEncoder().encode(JSON.stringify(layout)).length;
}

// ------------------------------------------------------------------ history and store

/** Undo/redo of whole layouts (JSON snapshots); consecutive edits with one `merge` key make one step. */
export class History {
	constructor(limit = 100) {
		this.limit = limit;
		this.past = [];
		this.future = [];
		this.merge_key = null;
		this.merge_at = 0;
	}
	reset(state) {
		this.past = [JSON.stringify(state)];
		this.future = [];
		this.merge_key = null;
	}
	push(state, merge = null, now = Date.now()) {
		const s = JSON.stringify(state);
		if (s === this.past.at(-1)) return false;
		if (merge && merge === this.merge_key && now - this.merge_at < 1000 && this.past.length > 1) this.past[this.past.length - 1] = s;
		else this.past.push(s);
		this.merge_key = merge;
		this.merge_at = now;
		if (this.past.length > this.limit) this.past.shift();
		this.future = [];
		return true;
	}
	get can_undo() {
		return this.past.length > 1;
	}
	get can_redo() {
		return this.future.length > 0;
	}
	undo() {
		if (!this.can_undo) return null;
		this.future.push(this.past.pop());
		this.merge_key = null;
		return JSON.parse(this.past.at(-1));
	}
	redo() {
		if (!this.can_redo) return null;
		const s = this.future.pop();
		this.past.push(s);
		this.merge_key = null;
		return JSON.parse(s);
	}
}

/**
 * The state of the editor: the layout, the selected element, the history. Every change goes
 * through `commit(fn)` (fn edits a draft; the result is clamped, recorded, then announced).
 */
export class Store {
	constructor(layout = default_layout()) {
		this.listeners = new Set();
		this.history = new History();
		this.layout = clamp_layout(layout);
		this.selected = null;
		this.saved = JSON.stringify(this.layout);
		this.history.reset(this.layout);
	}
	on(fn) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}
	emit(kind) {
		for (const fn of this.listeners) fn(kind, this);
	}
	get dirty() {
		return JSON.stringify(this.layout) !== this.saved;
	}
	mark_saved() {
		this.saved = JSON.stringify(this.layout);
		this.emit("saved");
	}
	/** Replaces the whole layout (a preset, a loaded one); `fresh` also clears the history. */
	replace(layout, { fresh = false } = {}) {
		this.layout = clamp_layout(layout);
		if (this.selected && !find(this.layout, this.selected)) this.selected = null;
		if (fresh) {
			this.history.reset(this.layout);
			this.saved = JSON.stringify(this.layout);
		} else this.history.push(this.layout);
		this.emit("layout");
	}
	commit(fn, { merge = null, select } = {}) {
		const draft = clone(this.layout);
		const out = fn(draft);
		const next = clamp_layout(draft);
		const changed = JSON.stringify(next) !== JSON.stringify(this.layout);
		this.layout = next;
		if (select !== undefined) this.selected = typeof select === "function" ? select(out) : select;
		if (this.selected && !find(this.layout, this.selected)) this.selected = null;
		if (changed) this.history.push(this.layout, merge);
		this.emit("layout");
		return out;
	}
	select(id) {
		if (id === this.selected) return;
		this.selected = id && find(this.layout, id) ? id : null;
		this.emit("select");
	}
	undo() {
		const s = this.history.undo();
		if (s) this.replace_silent(s);
	}
	redo() {
		const s = this.history.redo();
		if (s) this.replace_silent(s);
	}
	replace_silent(layout) {
		this.layout = clamp_layout(layout);
		if (this.selected && !find(this.layout, this.selected)) this.selected = null;
		this.emit("layout");
	}
}
