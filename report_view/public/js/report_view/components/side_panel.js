// Tool panels at the side of the grid (docs/architecture.md §11.1 #61-#65; design:
// reference/design/screens/sidecols.png, sidefilters.png): the vertical tabs "Columns" and
// "Filters" and their panels. Columns: show / hide with a type tag, the row-group zone, the
// value zone with its aggregate, and the pivot mode: its switch and the pivot columns zone
// (in pivot mode the row-group and value zones edit the pivot's rows and values). Filters: a
// section per column (contains, values with counts, from / to) and the quick filters.
// Everything is written to the view state through the host; values and counts come from
// temporary engine views the host deletes in `finally`.

import { icons } from "./icons.js";
import { SetList } from "./set_filter.js";
import { DRAG_COLUMN, DRAG_GROUP, DRAG_PIVOT, accepts, dragged } from "./group_panel.js";
import { esc, fmt_int } from "../util.js";

// A selector that finds a control of the panel again once the panel is drawn anew.
function focus_key(el) {
	for (const attr of ["data-col", "data-agg", "data-pagg", "data-add", "data-action"]) {
		if (el.hasAttribute?.(attr)) return `[${attr}="${CSS.escape(el.getAttribute(attr))}"]`;
	}
	return null;
}

// A filter typed in a section is applied after this much quiet (ms).
const TYPING_DEBOUNCE_MS = 350;
const AGGS = [
	["sum", "Sum"],
	["avg", "Average"],
	["count", "Count"],
	["min", "Minimum"],
	["max", "Maximum"],
];

export class SidePanel {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.body the .rv-body row (grid, panel, tabs)
	 * @param {object} o.host {side(), set_side(name|null), columns(), filters(), toggle_column(key, on),
	 *        set_group(by), groupable(key), set_agg(key, agg), clear_filters(), set_filter(key, filter|null),
	 *        load_values(key), toggle_quick(id)}
	 */
	constructor({ body, host }) {
		this.host = host;
		this.open_sections = new Map();
		this.col_query = "";
		const panel = document.createElement("aside");
		panel.className = "rv-panel";
		panel.hidden = true;
		const tabs = document.createElement("nav");
		tabs.className = "rv-sidetabs";
		tabs.setAttribute("aria-label", __("Tool panels"));
		tabs.innerHTML = `
			<button type="button" class="rv-sidetab" data-side="columns" aria-expanded="false">${icons.columns()}<span>${esc(__("Columns"))}</span></button>
			<button type="button" class="rv-sidetab" data-side="filters" aria-expanded="false">${icons.funnel(15)}<span>${esc(__("Filters", null, "Report View"))}</span><i class="rv-tabcount" hidden></i></button>`;
		body.append(panel, tabs);
		this.panel = panel;
		this.tabs = tabs;
		for (const b of tabs.querySelectorAll("[data-side]")) {
			b.addEventListener("click", () => host.set_side(host.side() === b.dataset.side ? null : b.dataset.side));
		}
	}

	/** Builds the open panel again from the view state (a focused text input is kept). */
	refresh() {
		const side = this.host.side();
		const filters = this.host.filters();
		// the tabs the report's settings keep (ADR-023); none: no side panel at all
		const f = this.host.features();
		this.tabs.hidden = !f.side_panel;
		this.tabs.querySelector('[data-side="columns"]').hidden = !f.columns_panel;
		this.tabs.querySelector('[data-side="filters"]').hidden = !f.filters_panel;
		for (const b of this.tabs.querySelectorAll("[data-side]")) {
			const on = b.dataset.side === side;
			b.classList.toggle("on", on);
			b.setAttribute("aria-expanded", on ? "true" : "false");
		}
		const count = this.tabs.querySelector(".rv-tabcount");
		count.hidden = !filters.active;
		count.textContent = filters.active ? fmt_int(filters.active) : "";
		this.panel.hidden = !side;
		if (!side) {
			this.panel.replaceChildren();
			this.shown = null;
			return;
		}
		const typing = this.panel.contains(document.activeElement) && document.activeElement.matches('input[type="text"]');
		if (typing && this.shown === side) {
			const badge = this.panel.querySelector(".rv-panel-hd .rv-count-badge");
			if (badge) {
				badge.hidden = !filters.active;
				badge.textContent = count.textContent;
			}
			return;
		}
		// drawn again for the same side (a column ticked, a group added): where the panel and
		// its lists stood, and the control in hand, stay
		const again = this.shown === side;
		const scrolls = again ? [...this.panel.querySelectorAll(".rv-panel-bd, .rv-collist")].map((el) => el.scrollTop) : [];
		const focus = again && this.panel.contains(document.activeElement) ? focus_key(document.activeElement) : null;
		this.shown = side;
		if (side === "columns") this.columns_panel();
		else this.filters_panel(filters);
		if (!again) return;
		[...this.panel.querySelectorAll(".rv-panel-bd, .rv-collist")].forEach((el, i) => {
			if (scrolls[i]) el.scrollTop = scrolls[i];
		});
		if (focus) this.panel.querySelector(focus)?.focus({ preventScroll: true });
	}

	header(title, extra = "") {
		return `<div class="rv-panel-hd"><strong>${esc(title)}</strong>${extra}<span class="sp"></span>
			<button type="button" class="rv-btn icon sm ghost" data-action="close" aria-label="${esc(__("Close the panel"))}" title="${esc(__("Close the panel"))}">${icons.x_md()}</button></div>`;
	}

	bind_close() {
		this.panel.querySelector('[data-action="close"]').addEventListener("click", () => this.host.set_side(null));
	}

	// ------------------------------------------------------------ columns

	columns_panel() {
		const data = this.host.columns();
		const q = this.col_query.toLowerCase();
		const list = data.items
			.filter((it) => !q || it.label.toLowerCase().includes(q))
			.map(
				(it) => `<div class="rv-colitem" draggable="true" data-key="${esc(it.key)}">
					<span class="rv-grip">${icons.grip()}</span>
					<label class="rv-check"><input type="checkbox" data-col="${esc(it.key)}" ${it.on ? "checked" : ""} ${it.locked ? "disabled" : ""}><span>${esc(it.label)}</span></label>
					<span class="rv-coltag${it.tag === "dim" ? " dim" : ""}">${esc(it.tag === "num" ? "123" : it.tag === "dim" ? __("Dim.") : "Aa")}</span>
				</div>`
			)
			.join("");
		const remove = esc(__("Remove", null, "Report View"));
		const pivot = this.host.mode() === "pivot" ? this.host.pivot() : null;
		const chip = (g, i, attr, drag) =>
			`<div class="rv-zchip"${drag ? ` draggable="true" data-drag="${drag}" data-index="${i}"` : ""}><span class="rv-grip">${icons.grip()}</span><span class="lbl">${esc(g.label)}</span>
				<button type="button" class="rv-chip-x" ${attr}="${i}" aria-label="${remove}" title="${remove}">${icons.close()}</button></div>`;
		const agg_select = (attr, id, agg) =>
			`<select ${attr}="${esc(id)}" aria-label="${esc(__("Aggregate function"))}">${AGGS.map(
				([a, label]) => `<option value="${a}" ${agg === a ? "selected" : ""}>${esc(__(label, null, "Report View"))}</option>`
			).join("")}</select>`;
		const adder = (zone, items) =>
			items.length
				? `<select class="rv-zone-add" data-add="${zone}" aria-label="${esc(__("Add"))}"><option value="">${esc(__("+ Add…"))}</option>${items
						.map((it) => `<option value="${esc(it.key)}">${esc(it.label)}</option>`)
						.join("")}</select>`
				: "";
		let groups;
		let values;
		if (pivot) {
			groups = pivot.rows.map((g, i) => chip(g, i, "data-unrow", "row")).join("");
			values = pivot.values
				.map(
					(v, i) => `<div class="rv-zchip"><span class="lbl">${esc(v.label)}</span>${agg_select("data-pagg", i, v.agg)}
					<button type="button" class="rv-chip-x" data-unvalue="${i}" aria-label="${remove}" title="${remove}">${icons.close()}</button></div>`
				)
				.join("");
		} else {
			groups = data.groups.map((g, i) => chip(g, i, "data-ungroup", null)).join("");
			values = data.values
				.map(
					(v) => `<div class="rv-zchip"><span class="lbl">${esc(v.label)}</span>${agg_select("data-agg", v.key, v.agg)}
					<button type="button" class="rv-chip-x" data-hide="${esc(v.key)}" aria-label="${remove}" title="${remove}">${icons.close()}</button></div>`
				)
				.join("");
		}
		const pcols = pivot ? pivot.cols.map((g, i) => chip(g, i, "data-uncol", "col")).join("") : "";
		const on = Boolean(pivot);
		// Report View Settings (ADR-023): no pivot switch and zone without the pivot, no
		// row-group zone without grouping (in pivot mode the zone is the pivot's rows)
		const f = this.host.features();
		const hide = (show) => (show ? "" : " hidden");
		const sw_label = esc(__("Pivot mode"));
		this.panel.innerHTML = `${this.header(__("Columns"))}
			<div class="rv-panel-bd">
				<div class="rv-switch-row"${hide(f.pivot)}>
					<div>${esc(__("Pivot mode"))}<small>${esc(__("Turn the values of a dimension into columns"))}</small></div>
					<button type="button" class="rv-switch${on ? " on" : ""}" role="switch" data-action="pivot-mode" aria-checked="${on}" aria-label="${sw_label}" title="${sw_label}"></button>
				</div>
				<input type="text" class="rv-input sm" data-action="col-search" aria-label="${esc(__("Search the columns"))}" placeholder="${esc(__("Search the columns…"))}" value="${esc(this.col_query)}">
				<div class="rv-collist">${list}</div>
				<div class="rv-zone" data-zone="groups"${hide(pivot || f.grouping)}>
					<div class="rv-zone-hd">${icons.group()}${esc(pivot ? __("Pivot rows") : __("Row groups"))}</div>
					${groups ? `<div class="rv-zone-chips">${groups}</div>` : `<div class="rv-zone-empty">${esc(__("Drag columns here to group the rows"))}</div>`}
					${pivot ? adder("rows", pivot.dims) : ""}
				</div>
				<div class="rv-zone" data-zone="values">
					<div class="rv-zone-hd">${icons.sigma()}${esc(__("Values"))}</div>
					${values ? `<div class="rv-zone-chips">${values}</div>` : `<div class="rv-zone-empty">${esc(__("Drag a numeric column here"))}</div>`}
					${pivot ? adder("values", pivot.measures) : ""}
				</div>
				<div class="rv-zone${on ? "" : " off"}" data-zone="pivot"${hide(f.pivot)}>
					<div class="rv-zone-hd">${icons.pivot_cols()}${esc(__("Pivot columns"))}</div>
					${
						!on
							? `<div class="rv-zone-empty">${esc(__("Turn on pivot mode, or drag a dimension here to turn it on"))}</div>`
							: pcols
							? `<div class="rv-zone-chips">${pcols}</div>`
							: `<div class="rv-zone-empty">${esc(__("Drag a column here to turn its values into columns"))}</div>`
					}
					${pivot ? adder("cols", pivot.dims) : ""}
				</div>
			</div>`;
		this.bind_close();
		const search = this.panel.querySelector('[data-action="col-search"]');
		search.addEventListener("input", () => {
			this.col_query = search.value;
			this.columns_panel();
			const again = this.panel.querySelector('[data-action="col-search"]');
			again.focus();
			again.setSelectionRange(again.value.length, again.value.length);
		});
		for (const item of this.panel.querySelectorAll(".rv-colitem")) {
			item.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData(DRAG_COLUMN, item.dataset.key);
				e.dataTransfer.effectAllowed = "copyMove";
			});
		}
		for (const box of this.panel.querySelectorAll("[data-col]")) {
			box.addEventListener("change", () => this.host.toggle_column(box.dataset.col, box.checked));
		}
		this.panel.querySelector('[data-action="pivot-mode"]').addEventListener("click", () => this.host.set_mode(on ? "grid" : "pivot"));
		if (pivot) this.bind_pivot(pivot);
		for (const b of this.panel.querySelectorAll("[data-ungroup]")) {
			b.addEventListener("click", () => this.host.set_group(data.groups.filter((_, i) => i !== Number(b.dataset.ungroup)).map((g) => g.key)));
		}
		for (const sel of this.panel.querySelectorAll("[data-agg]")) {
			sel.addEventListener("change", () => this.host.set_agg(sel.dataset.agg, sel.value));
		}
		for (const b of this.panel.querySelectorAll("[data-hide]")) {
			b.addEventListener("click", () => this.host.toggle_column(b.dataset.hide, false));
		}
		const zone = (name, drop) => {
			const z = this.panel.querySelector(`[data-zone="${name}"]`);
			z.addEventListener("dragover", (e) => {
				if (!accepts(e)) return;
				e.preventDefault();
				z.classList.add("drop");
			});
			z.addEventListener("dragleave", (e) => {
				if (!z.contains(e.relatedTarget)) z.classList.remove("drop");
			});
			z.addEventListener("drop", (e) => {
				z.classList.remove("drop");
				const d = dragged(e);
				if (!d) return;
				e.preventDefault();
				// chips of the pivot zones: rows travel as "group", pivot columns as "pivot"
				drop(d.type === "group" ? { ...d, type: "pivot-row" } : d.type === "pivot" ? { ...d, type: "pivot-col" } : d);
			});
		};
		zone("groups", (d) => {
			if (pivot) {
				if (d.type === "pivot-col") this.host.pivot_rows([...pivot.rows.map((g) => g.key), pivot.cols[d.index].key]);
				else if (d.type === "column" && this.host.pivotable(d.key) && !pivot.rows.some((g) => g.key === d.key)) {
					this.host.pivot_rows([...pivot.rows.map((g) => g.key), d.key]);
				}
				return;
			}
			if (d.type !== "column" || !f.grouping) return;
			const by = data.groups.map((g) => g.key);
			if (!by.includes(d.key) && this.host.groupable(d.key)) this.host.set_group([...by, d.key]);
		});
		zone("values", (d) => {
			if (d.type !== "column") return;
			if (pivot) {
				if (pivot.measures.some((m) => m.key === d.key)) this.host.pivot_add_value(d.key);
				return;
			}
			const it = data.items.find((i) => i.key === d.key);
			if (it && it.tag === "num" && !it.on) this.host.toggle_column(d.key, true);
		});
		zone("pivot", (d) => {
			// A dimension dropped here turns the pivot mode on with it as a pivot column (design).
			if (!f.pivot) return;
			const key = d.type === "column" ? d.key : d.type === "pivot-row" && pivot ? pivot.rows[d.index]?.key : null;
			if (!key || !this.host.pivotable(key)) return;
			const cols = pivot ? pivot.cols.map((g) => g.key).filter((k) => k !== key) : [];
			this.host.pivot_cols([...cols, key]);
		});
	}

	// Chips of the pivot zones (reorder by drag, × to remove) and the "+ Add" lists.
	bind_pivot(pivot) {
		const rows = pivot.rows.map((g) => g.key);
		const cols = pivot.cols.map((g) => g.key);
		for (const b of this.panel.querySelectorAll("[data-unrow]")) {
			b.addEventListener("click", () => this.host.pivot_rows(rows.filter((_, i) => i !== Number(b.dataset.unrow))));
		}
		for (const b of this.panel.querySelectorAll("[data-uncol]")) {
			b.addEventListener("click", () => this.host.pivot_cols(cols.filter((_, i) => i !== Number(b.dataset.uncol))));
		}
		for (const b of this.panel.querySelectorAll("[data-unvalue]")) {
			b.addEventListener("click", () => this.host.pivot_remove_value(Number(b.dataset.unvalue)));
		}
		for (const sel of this.panel.querySelectorAll("[data-pagg]")) {
			sel.addEventListener("change", () => this.host.pivot_agg(Number(sel.dataset.pagg), sel.value));
		}
		for (const sel of this.panel.querySelectorAll("[data-add]")) {
			sel.addEventListener("change", () => {
				const key = sel.value;
				if (!key) return;
				if (sel.dataset.add === "rows") this.host.pivot_rows([...rows, key]);
				else if (sel.dataset.add === "cols") this.host.pivot_cols([...cols, key]);
				else this.host.pivot_add_value(key);
			});
		}
		for (const c of this.panel.querySelectorAll("[data-drag]")) {
			c.addEventListener("dragstart", (e) => {
				e.dataTransfer.setData(c.dataset.drag === "row" ? DRAG_GROUP : DRAG_PIVOT, c.dataset.index);
				e.dataTransfer.effectAllowed = "move";
			});
		}
		// a chip dropped on a chip of its own zone: reorder
		for (const [attr, list, set] of [
			["row", rows, (l) => this.host.pivot_rows(l)],
			["col", cols, (l) => this.host.pivot_cols(l)],
		]) {
			this.panel.querySelectorAll(`[data-drag="${attr}"]`).forEach((c, at) => {
				c.addEventListener("dragover", (e) => {
					if (accepts(e)) e.preventDefault();
				});
				c.addEventListener("drop", (e) => {
					const d = dragged(e);
					const own = attr === "row" ? "group" : "pivot";
					if (!d || d.type !== own || !list[d.index]) return;
					e.preventDefault();
					e.stopPropagation();
					const next = [...list];
					const [moved] = next.splice(d.index, 1);
					next.splice(at, 0, moved);
					set(next);
				});
			});
		}
	}

	// ------------------------------------------------------------ filters

	filters_panel(filters) {
		const sections = filters.sections;
		const badge = `<span class="rv-count-badge"${filters.active ? "" : " hidden"}>${esc(filters.active ? fmt_int(filters.active) : "")}</span>`;
		this.panel.innerHTML = `${this.header(__("Filters", null, "Report View"), badge)}<div class="rv-panel-bd"></div>`;
		const clear = document.createElement("button");
		clear.type = "button";
		clear.className = "rv-link";
		clear.textContent = __("Clear all");
		clear.addEventListener("click", () => this.host.clear_filters());
		this.panel.querySelector(".rv-panel-hd .sp").after(clear);
		this.bind_close();
		const bd = this.panel.querySelector(".rv-panel-bd");
		sections.forEach((s, i) => {
			const open = this.open_sections.has(s.id) ? this.open_sections.get(s.id) : s.active || s.open_default;
			const sec = document.createElement("div");
			sec.className = "rv-fsec";
			sec.innerHTML = `<button type="button" class="rv-fsec-hd" aria-expanded="${open}">
					<span class="${open ? "open" : ""}">${icons.chevron_end(14)}</span>
					<span class="lbl">${esc(s.label)}</span>${s.active ? `<span class="rv-dot" title="${esc(__("Active filter"))}"></span>` : ""}
				</button>`;
			sec.querySelector(".rv-fsec-hd").addEventListener("click", () => {
				this.open_sections.set(s.id, !open);
				this.filters_panel(this.host.filters());
			});
			if (open) {
				const body = document.createElement("div");
				body.className = "rv-fsec-bd";
				sec.appendChild(body);
				this.section_body(s, body);
			}
			bd.appendChild(sec);
			if (i === 0) sec.dataset.first = "1";
		});
	}

	section_body(s, body) {
		const debounce = (fn) => {
			let t = null;
			return (...a) => {
				clearTimeout(t);
				t = setTimeout(() => fn(...a), TYPING_DEBOUNCE_MS);
			};
		};
		if (s.kind === "text") {
			body.innerHTML = `<input type="text" class="rv-input sm" aria-label="${esc(s.label)}" placeholder="${esc(__("Contains…"))}" value="${esc(s.value || "")}">`;
			const input = body.querySelector("input");
			const apply = debounce(() => this.host.set_filter(s.key, input.value.trim() ? { key: s.key, type: "text", op: "contains", value: input.value.trim() } : null));
			input.addEventListener("input", apply);
		} else if (s.kind === "range" || s.kind === "date") {
			const ph = s.kind === "date" ? frappe.datetime.get_user_date_fmt?.() || "" : "";
			body.innerHTML = `<div class="rv-range">
				<input type="text" inputmode="${s.kind === "date" ? "numeric" : "decimal"}" class="rv-input sm num" data-edge="min" aria-label="${esc(__("From"))}" placeholder="${esc(ph || __("From"))}" value="${esc(s.min ?? "")}">
				<span>${esc(__("to"))}</span>
				<input type="text" inputmode="${s.kind === "date" ? "numeric" : "decimal"}" class="rv-input sm num" data-edge="max" aria-label="${esc(__("To"))}" placeholder="${esc(ph || __("To"))}" value="${esc(s.max ?? "")}">
			</div>`;
			const [a, b] = body.querySelectorAll("input");
			const apply = debounce(() => this.host.set_range(s.key, s.kind, a.value, b.value));
			a.addEventListener("input", apply);
			b.addEventListener("input", apply);
		} else if (s.kind === "quick") {
			body.innerHTML = s.items
				.map(
					(it, i) =>
						`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-q="${i}" ${it.on ? "checked" : ""}><span>${esc(it.label)}</span></span></label>`
				)
				.join("");
			for (const box of body.querySelectorAll("[data-q]")) {
				box.addEventListener("change", () => s.items[Number(box.dataset.q)].toggle());
			}
		} else if (s.kind === "set") {
			body.innerHTML = `<div class="rv-zone-empty">${esc(__("Loading…"))}</div>`;
			const wrap = document.createElement("div");
			const list = new SetList({
				parent: wrap,
				on_change: (selected) => this.host.set_filter(s.key, selected ? { key: s.key, type: "set", values: selected, exclude: false } : null),
			});
			list.el.classList.add("short");
			this.host
				.load_values(s.key)
				.then((out) => {
					list.set({ values: out.values, all: out.values.map((v) => v.value), selected: s.selected });
					body.replaceChildren(wrap);
				})
				.catch(() => {
					body.innerHTML = `<div class="rv-zone-empty">${esc(__("The values could not be read"))}</div>`;
				});
		}
	}
}
