// Header cells of the grid (docs/architecture.md §11.1 #36-#43; design: .rv-h and .rv-fcell
// in reference/design/rv.css): the column title with its sort and filter marks and the
// column-menu button, and the floating filter under it: "contains" for the label column,
// "All ▾" (the set filter) for other text columns, from / to for numbers and dates.
// regular-table takes these as HTMLElements and keeps an element it was given again
// untouched, so an input keeps its focus while the grid draws the result of what is typed.
// Elements are cached per column; their content follows the view state on refresh().

import { icons } from "./icons.js";
import { DRAG_COLUMN } from "./group_panel.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

const DEBOUNCE_MS = 350;

/** A number typed with the system number format ("1,234.5"), or null. */
export function parse_number(text) {
	let t = String(text ?? "").trim();
	if (!t) return null;
	let group = ",";
	let decimal = ".";
	if (typeof window !== "undefined" && typeof window.get_number_format_info === "function" && typeof window.get_number_format === "function") {
		const info = window.get_number_format_info(window.get_number_format());
		group = info.group_sep ?? group;
		decimal = info.decimal_str || decimal;
	}
	if (group) t = t.split(group).join("");
	if (decimal !== ".") t = t.split(decimal).join(".");
	t = t.replace(/\s/g, "");
	const n = Number(t);
	return t && Number.isFinite(n) ? n : null;
}

/** A date typed in the user's format, as "YYYY-MM-DD", or null. */
export function parse_date(text) {
	const value = String(text ?? "").trim();
	if (!value) return null;
	try {
		const out = frappe.datetime.user_to_str(value);
		return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
	} catch {
		return null;
	}
}

export class HeaderCells {
	/**
	 * @param {object} host
	 *   kind(key) -> "text" | "set" | "range" | "date" | null (floating filter of the column)
	 *   sort_of(key) -> "asc" | "desc" | null
	 *   filter_of(key) -> the browser filter of the column or null
	 *   set_label(key) -> text of the set button ("All", one value, "N values")
	 *   draggable(key) -> may be dropped on the group panel
	 *   on_sort(key), on_menu(key, anchor), on_filter(key, filter|null), on_set(key, anchor)
	 */
	constructor(host) {
		this.host = host;
		this.leaves = new Map();
		this.filters = new Map();
		this.menu_key = null;
	}

	clear() {
		this.leaves.clear();
		this.filters.clear();
	}

	/** Title cell of a column. */
	leaf(key, title, numeric) {
		let el = this.leaves.get(key);
		if (!el) {
			el = document.createElement("div");
			el.className = `rv-hcell${numeric ? " num" : ""}`;
			el.dataset.col = key;
			const label = esc(__("Column menu"));
			// The title is the sort control: a click, or Enter / Space when it has the focus.
			el.innerHTML = `<span class="rv-hlabel" role="button" tabindex="0"></span><span class="rv-hico" data-sort hidden></span>` +
				`<span class="rv-hico" data-filtered hidden title="${esc(__("Active filter"))}">${icons.funnel_solid()}</span>` +
				`<button type="button" class="rv-hmenu" aria-label="${label}" title="${label}">${icons.menu()}</button>`;
			el.addEventListener("click", (e) => {
				if (e.target.closest(".rv-hmenu")) return;
				this.host.on_sort(key);
			});
			el.querySelector(".rv-hlabel").addEventListener("keydown", (e) => {
				if (e.key !== "Enter" && e.key !== " ") return;
				e.preventDefault();
				// the grid draws the sorted view again: the focus comes back to this title
				this.refocus = key;
				this.host.on_sort(key);
			});
			el.querySelector(".rv-hmenu").addEventListener("click", (e) => {
				e.stopPropagation();
				this.host.on_menu(key, e.currentTarget);
			});
			if (this.host.draggable(key)) {
				el.draggable = true;
				el.addEventListener("dragstart", (e) => {
					e.dataTransfer.setData(DRAG_COLUMN, key);
					e.dataTransfer.effectAllowed = "copyMove";
					el.classList.add("dragging");
				});
				el.addEventListener("dragend", () => el.classList.remove("dragging"));
			}
			this.leaves.set(key, el);
		}
		const lbl = el.querySelector(".rv-hlabel");
		if (lbl.textContent !== title) lbl.textContent = title;
		this.paint_leaf(key, el);
		return el;
	}

	paint_leaf(key, el) {
		const sort = this.host.sort_of(key);
		const label = el.querySelector(".rv-hlabel");
		const hint = sort === "asc" ? __("Sorted ascending") : sort === "desc" ? __("Sorted descending") : __("Not sorted");
		if (label.getAttribute("aria-description") !== hint) label.setAttribute("aria-description", hint);
		const s = el.querySelector("[data-sort]");
		s.hidden = !sort;
		const want = sort === "desc" ? "desc" : sort === "asc" ? "asc" : "";
		if (s.dataset.dir !== want) {
			s.dataset.dir = want;
			s.innerHTML = want === "desc" ? icons.sort_desc() : want === "asc" ? icons.sort_asc() : "";
		}
		el.querySelector("[data-filtered]").hidden = !this.host.filter_of(key);
		el.querySelector(".rv-hmenu").classList.toggle("on", this.menu_key === key);
	}

	/** Floating filter cell of a column. */
	filter(key, title) {
		let el = this.filters.get(key);
		const kind = this.host.kind(key);
		if (el && el.dataset.kind !== (kind || "")) el = null;
		if (!el) {
			el = this.make_filter(key, kind, title);
			this.filters.set(key, el);
		}
		this.paint_filter(key, el);
		return el;
	}

	make_filter(key, kind, title) {
		const el = document.createElement("div");
		el.className = "rv-fcell-in";
		el.dataset.kind = kind || "";
		el.dataset.col = key;
		const later = (fn) => {
			let t = null;
			const run = () => {
				clearTimeout(t);
				fn();
			};
			return { soon: () => (clearTimeout(t), (t = setTimeout(fn, DEBOUNCE_MS))), now: run };
		};
		if (kind === "text") {
			el.innerHTML = `<input type="text" class="rv-ff-input" aria-label="${esc(__("Search in {0}", [title]))}" placeholder="${esc(__("Contains…"))}">`;
			const input = el.querySelector("input");
			const apply = later(() => {
				const v = input.value.trim();
				this.host.on_filter(key, v ? { key, type: "text", op: "contains", value: v } : null);
			});
			input.addEventListener("input", apply.soon);
			input.addEventListener("keydown", (e) => e.key === "Enter" && apply.now());
		} else if (kind === "set") {
			el.innerHTML = `<button type="button" class="rv-ff-set" aria-haspopup="dialog" aria-label="${esc(__("Value filter · {0}", [title]))}"><span></span>${icons.chevron_down(12)}</button>`;
			el.querySelector("button").addEventListener("click", (e) => this.host.on_set(key, e.currentTarget));
		} else if (kind === "range" || kind === "date") {
			const date = kind === "date";
			const from = date ? __("From") : `≥ ${__("From")}`;
			const to = date ? __("To") : `≤ ${__("To")}`;
			el.innerHTML =
				`<input type="text" inputmode="${date ? "numeric" : "decimal"}" class="rv-ff-input num" data-edge="min" aria-label="${esc(__("{0}: from", [title]))}" placeholder="${esc(from)}">` +
				`<input type="text" inputmode="${date ? "numeric" : "decimal"}" class="rv-ff-input num" data-edge="max" aria-label="${esc(__("{0}: to", [title]))}" placeholder="${esc(to)}">`;
			const [a, b] = el.querySelectorAll("input");
			const parse = date ? parse_date : parse_number;
			const apply = later(() => {
				const lo = parse(a.value);
				const hi = parse(b.value);
				a.classList.toggle("bad", Boolean(a.value.trim()) && lo === null);
				b.classList.toggle("bad", Boolean(b.value.trim()) && hi === null);
				let f = null;
				if (date && (lo || hi)) f = { key, type: "date", from: lo, to: hi };
				if (!date && (lo !== null || hi !== null)) f = { key, type: "range", min: lo, max: hi };
				this.host.on_filter(key, f);
			});
			for (const input of [a, b]) {
				input.addEventListener("input", apply.soon);
				input.addEventListener("keydown", (e) => e.key === "Enter" && apply.now());
			}
		}
		return el;
	}

	// Inputs follow the view state unless the user is typing in them.
	paint_filter(key, el) {
		const f = this.host.filter_of(key);
		const kind = el.dataset.kind;
		const typing = (input) => document.activeElement === input;
		if (kind === "text") {
			const input = el.querySelector("input");
			const v = f?.type === "text" ? f.value || "" : "";
			if (!typing(input) && input.value !== v) input.value = v;
			input.classList.toggle("on", Boolean(v));
		} else if (kind === "set") {
			const b = el.querySelector("button");
			b.classList.toggle("on", Boolean(f));
			const text = this.host.set_label(key);
			const span = b.querySelector("span");
			if (span.textContent !== text) span.textContent = text;
		} else if (kind === "range" || kind === "date") {
			const [a, b] = el.querySelectorAll("input");
			const show = (v) => {
				if (v === null || v === undefined || v === "") return "";
				return kind === "date" ? frappe.datetime.str_to_user(v) : String(v);
			};
			const lo = kind === "date" ? f?.from : f?.min;
			const hi = kind === "date" ? f?.to : f?.max;
			if (!typing(a) && !a.classList.contains("bad")) a.value = show(lo);
			if (!typing(b) && !b.classList.contains("bad")) b.value = show(hi);
			a.classList.toggle("on", lo !== null && lo !== undefined && lo !== "");
			b.classList.toggle("on", hi !== null && hi !== undefined && hi !== "");
		}
	}

	/** aria-sort of the header cell of a column: "ascending", "descending" or null. */
	aria_sort(key) {
		const sort = this.host.sort_of(key);
		return sort === "asc" ? "ascending" : sort === "desc" ? "descending" : null;
	}

	/** After a sort from the keyboard, the focus goes back to the title of its column. */
	restore_focus() {
		const key = this.refocus;
		this.refocus = null;
		const label = key ? this.leaves.get(key)?.querySelector(".rv-hlabel") : null;
		if (label && label.isConnected && document.activeElement !== label) label.focus();
	}

	/** Every cached cell follows the view state again. */
	refresh() {
		for (const [key, el] of this.leaves) this.paint_leaf(key, el);
		for (const [key, el] of this.filters) this.paint_filter(key, el);
	}

	set_menu(key) {
		this.menu_key = key;
		this.refresh();
	}
}
