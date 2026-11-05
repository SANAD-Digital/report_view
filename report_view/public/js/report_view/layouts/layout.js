// The trial layouts of the report page (ADR-025): /desk/report-view-a/<report> (A, «a head of
// two rows and a table with its own toolbar») and /desk/report-view-c/<report> (C, «a dense
// workspace with the saved views as tabs»), next to the standard page /desk/report-view/<report>
// that stays as it is. Same reports, same engine, same features: only the shell differs.
//
// The page (index.js) builds every part as on the standard page, with the head of the layout
// (components/header_a.js or header_c.js) in place of components/header.js; this module then
// places the parts the layout keeps and adds its own controls:
// - the table's tools (Group by ▾, Columns, Subtotals, the row count, the density) in the
//   card's toolbar (A) or in the dense toolbar (C), and the search box beside them;
// - the side panel (columns and column filters) opened as a drawer from «Columns» and ⋯,
//   without its vertical tabs; the row-groups bar only in the Table and Pivot views;
// - the status bar under the table with «Last updated» (A), or the bottom bar with the saved
//   views as tabs, the rows and the selection (C);
// - in the first column of a report row: its details button, then its number.
// Every control calls what the standard page already does; nothing is computed here.

import { icons } from "../components/icons.js";
import { open_popover, close_popover, menu_content } from "../components/popover.js";
import { open_group_menu, open_density_menu, open_more_menu, open_export_menu } from "../components/head_menus.js";
import { ViewsTabs } from "../components/views_tabs.js";
import { esc, fmt_int } from "../util.js";
import { tree_index } from "../engine/tree_nodes.js";

export const LAYOUTS = ["a", "c"];
// the rows a Statement draws at their full height; beyond them its body scrolls
const STATEMENT_MAX_ROWS = 1500;

export class TrialLayout {
	/** @param {object} page the ReportViewPage, its parts built (make_dom) */
	constructor(page) {
		this.page = page;
		this.kind = page.layout;
		const root = page.root;
		const wrap = page.$(".rv-gridwrap");
		// Desk's own page head (title, actions, ⋯) gives way to the layout's head
		page.wrapper.classList.add("rv-trial-page", `rv-trial-${this.kind}`);
		// the classic toolbar row: its search box moves, the row goes
		page.toolbar.el.hidden = true;
		// the summary cards of a balance report become one slim line under the head
		page.summary.el.classList.add("rv-sumline");
		this.tools = this.make_tools();
		if (this.kind === "a") {
			const bar = document.createElement("div");
			bar.className = "rv-ta";
			bar.setAttribute("role", "toolbar");
			bar.setAttribute("aria-label", __("Table tools"));
			bar.append(page.toolbar.search.el, this.tools.group, this.tools.columns, this.tools.subtotals, this.tools.frow, this.tools.sp, this.tools.count, this.tools.density);
			wrap.prepend(bar);
			this.bar = bar;
		} else {
			const h = page.header;
			h.tools_slot.append(this.tools.group, this.tools.subtotals, this.tools.columns, this.tools.frow, this.tools.density);
			h.search_slot.append(page.toolbar.search.el);
			// the bottom bar: the views as tabs, the views menu, then the rows and the selection
			const foot = document.createElement("footer");
			foot.className = "rv-cfoot";
			this.tabs = new ViewsTabs({
				parent: foot,
				on: {
					apply: (name) => (page.view_job = page.apply_saved_view(name)),
					save_new: () => page.save_view_new(),
				},
			});
			foot.append(h.views_slot, page.status.el);
			// under the table's frame, so the tabs stay with the charts too
			wrap.after(foot);
			this.foot = foot;
		}
		// the Statement (ADR-026): the table drawn as a statement, with its own head
		this.stmt = this.make_statement_head();
		wrap.prepend(this.stmt);
		// the Pages tab warms its settings up, as the classic toolbar's does
		const warm = (e) => {
			if (e.target.closest?.('[data-mode="pages"]') && page.report && page.meta?.perms?.can_print) {
				Promise.resolve(page.pages.prefetch()).catch(() => {});
			}
		};
		for (const el of [page.header.el, page.header.bar].filter(Boolean)) {
			el.addEventListener("pointerover", warm);
			el.addEventListener("focusin", warm);
		}
		// the first column: the row's details, then its number (views/grid_view.js details_lead)
		page.grid.row_numbers = true;
		// on the Statement the table stands at its full height in the page: the wheel scrolls the
		// page (Desk's .main-section), not the table, which would keep it for itself
		page.$(".rv-grid").addEventListener(
			"wheel",
			(e) => {
				if (page.state?.mode !== "statement" || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
				if ((page.grid.body_rows || 0) > STATEMENT_MAX_ROWS) return;
				// the table's scroll does not chain to the page (overscroll-behavior): the page's
				// scroller is moved here
				const scroller = page.root.closest(".main-section") || document.scrollingElement;
				e.stopPropagation();
				e.preventDefault();
				const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? scroller.clientHeight : 1;
				scroller.scrollBy({ top: e.deltaY * unit, left: 0 });
			},
			{ capture: true, passive: false }
		);
		// on the Statement, a click on a report row opens its details (the drawer or dialog)
		page.$(".rv-grid").addEventListener("click", (e) => {
			if (page.state?.mode !== "statement") return;
			if (e.target.closest("button, a, input, .rv-caret")) return;
			const tr = e.target.closest("regular-table tbody tr");
			tr?.querySelector("th .rv-rd-btn")?.click();
		});
		page.grid.after_style = () => {
			this.fit_statement();
			this.fit_rows();
		};
		this.more_items = this.kind === "c";
		// the row of filters under the column titles (not in the mockup): off until asked for
		this.filter_row = false;
		void root;
	}

	/** The table's tools: Group by ▾, Columns, Subtotals, the row count, the density. */
	make_tools() {
		const page = this.page;
		const b = (cls, html, label = "") => {
			const el = document.createElement("button");
			el.type = "button";
			el.className = cls;
			el.innerHTML = html;
			if (label) {
				el.setAttribute("aria-label", label);
				el.title = label;
			}
			return el;
		};
		const c = this.kind === "c";
		// Frappe's own buttons (A) or the bar's flat ones (C)
		const btn = c ? "rv-tb" : "btn btn-default btn-sm";
		const group = b(btn, `${c ? icons.group() : ""}<span class="lbl"></span>${icons.chevron_down(12)}`);
		group.dataset.action = "group-menu";
		group.setAttribute("aria-haspopup", "menu");
		group.addEventListener("click", () => open_group_menu(page, group));
		const columns = b(btn, `${icons.columns()}<span>${esc(__("Columns"))}</span>`);
		columns.dataset.action = "columns";
		columns.setAttribute("aria-expanded", "false");
		columns.addEventListener("click", () => {
			const side = page.controls.side_host();
			side.set_side(side.side() === "columns" ? null : "columns");
			this.refresh();
		});
		const subtotals = b(btn, `${icons.sigma()}<span>${esc(__("Subtotals"))}</span>`);
		subtotals.dataset.action = "subtotals";
		subtotals.setAttribute("aria-pressed", "false");
		subtotals.addEventListener("click", () => {
			page.set_subtotals(page.state?.group.subtotals === false);
			this.refresh();
		});
		const frow = b(btn, `${icons.funnel(14)}<span>${esc(__("Column filters"))}</span>`);
		frow.dataset.action = "filter-row";
		frow.setAttribute("aria-pressed", "false");
		frow.title = __("The row of filters under the column titles");
		frow.addEventListener("click", () => this.set_filter_row(!this.filter_row));
		const sp = document.createElement("span");
		sp.className = "rv-ta-sp";
		const count = document.createElement("span");
		count.className = "rv-ta-count";
		let density;
		if (c) {
			density = b(btn, `<span>${esc(__("Density"))}</span>${icons.chevron_down(12)}`);
			density.dataset.action = "density-menu";
			density.setAttribute("aria-haspopup", "menu");
			density.addEventListener("click", () => open_density_menu(page, density));
		} else {
			density = document.createElement("div");
			density.className = "rv-seg rv-ta-density";
			density.setAttribute("role", "group");
			density.setAttribute("aria-label", __("Density"));
			density.innerHTML = `<button type="button" data-density="comfortable">${esc(__("Comfortable"))}</button><button type="button" data-density="compact">${esc(__("Compact"))}</button>`;
			for (const d of density.querySelectorAll("[data-density]")) d.addEventListener("click", () => page.set_density(d.dataset.density));
		}
		return { group, columns, subtotals, frow, sp, count, density };
	}

	/** The row of filters under the column titles, shown or not; the table is drawn again. */
	set_filter_row(on) {
		const page = this.page;
		this.filter_row = Boolean(on);
		page.cells.floating = this.filter_row && page.features.column_filters !== false;
		// the header's rows change: a new table (grid_view.js mounts on a new signature)
		page.grid.signature = null;
		this.refresh();
		page.render();
	}

	/** A new report: its title, its criteria, its saved views (the tabs of C read the list now). */
	set_report() {
		const page = this.page;
		page.header.set_title(__(page.report_name), page.meta?.report?.module);
		if (this.kind === "c") page.reload_views();
	}

	/** The criteria bar of the report was built (load): the chips or the sentence read it. */
	set_criteria(criteria) {
		(this.kind === "a" ? this.page.header.chips : this.page.header.sentence).set_criteria(criteria);
	}

	refresh_filters() {
		(this.kind === "a" ? this.page.header.chips : this.page.header.sentence).refresh();
	}

	/** The density switch or menu shows the density (header.set_density). */
	paint_density(density) {
		const d = this.tools?.density;
		if (!d) return;
		for (const b of d.querySelectorAll?.("[data-density]") || []) {
			const on = b.dataset.density === density;
			b.classList.toggle("on", on);
			b.setAttribute("aria-pressed", on ? "true" : "false");
		}
		d.hidden = this.page.features.density === false;
	}

	/** The tools follow the view state (refresh_controls). */
	refresh() {
		const page = this.page;
		const s = page.state;
		if (!s) return;
		const f = page.features;
		const mode = s.mode || "grid";
		// the Statement is the table: its tools stay (the CSS hides those it does not show)
		const grid = mode === "grid" || mode === "statement";
		this.refresh_statement();
		const t = this.tools;
		const by = s.group.by || [];
		t.group.querySelector(".lbl").innerHTML = by.length
			? `${esc(__("Group by"))}: <b>${esc(by.map((k) => page.controls.title(k)).join(__(", ")))}</b>`
			: esc(__("Group by"));
		t.group.hidden = !grid || !f.grouping;
		const hierarchical = Boolean(page.result && page.result.mode !== "flat");
		t.subtotals.hidden = !grid || !hierarchical || !f.subtotals;
		const on = s.group.subtotals !== false;
		t.subtotals.setAttribute("aria-pressed", on ? "true" : "false");
		t.subtotals.classList.toggle("on", on);
		t.columns.hidden = !(grid || mode === "pivot") || !f.side_panel || !f.columns_panel;
		t.frow.hidden = !grid || f.column_filters === false;
		t.frow.setAttribute("aria-pressed", this.filter_row ? "true" : "false");
		t.frow.classList.toggle("on", this.filter_row);
		// the row groups bar: while grouping, and in the pivot (its rows); Group by ▾ otherwise
		page.root.classList.toggle("rv-grouping", (grid && by.length > 0) || mode === "pivot");
		const side = s.ui.side_panel;
		t.columns.setAttribute("aria-expanded", side === "columns" ? "true" : "false");
		t.columns.classList.toggle("on", side === "columns");
		page.root.classList.toggle("rv-side-open", Boolean(side));
		if (this.kind === "c") {
			const tools = grid || mode === "pivot";
			page.header.tools_slot.hidden = !tools;
			page.header.bar.querySelector('[data-sep="tools"]').hidden = !tools;
		}
	}

	/**
	 * The head of the Statement: the report, its company and period, and the level of detail
	 * of a report tree (Roots / Groups / All accounts = the depth the tree opens to).
	 */
	make_statement_head() {
		const el = document.createElement("div");
		el.className = "rv-stmt-head";
		el.innerHTML = `
			<div class="rv-stmt-title"><div class="t"></div><div class="s"></div></div>
			<div class="rv-stmt-levels" role="group" aria-label="${esc(__("Level of detail"))}">
				<button type="button" data-level="roots">${esc(__("Roots"))}</button>
				<button type="button" data-level="groups">${esc(__("Groups"))}</button>
				<button type="button" data-level="all">${esc(__("All accounts"))}</button>
			</div>`;
		for (const b of el.querySelectorAll("[data-level]")) {
			b.addEventListener("click", () => this.set_level(b.dataset.level));
		}
		return el;
	}

	/** The depth of the report tree for a level of detail, or null without a tree. */
	level_depth(level) {
		const report = this.page.report;
		if (!report?.tree?.enabled) return null;
		const max = tree_index(report).max_depth;
		return { roots: 0, groups: Math.max(0, max - 1), all: max }[level];
	}

	set_level(level) {
		const page = this.page;
		const depth = this.level_depth(level);
		if (depth == null || !page.state) return;
		page.state.tree = { depth, expanded: null };
		page.render();
	}

	/**
	 * The totals follow the last row (Grid.dc.html), not the bottom of the frame: the body of a
	 * short table is as tall as its rows; a long one keeps the frame's height and scrolls.
	 */
	fit_rows() {
		const grid = this.page.grid;
		const scroll = grid.rt?.parentElement;
		if (!scroll?.classList.contains("rv-rt-scroll")) return;
		if (this.page.state?.mode === "statement") {
			scroll.style.maxHeight = "";
			return;
		}
		const rh = grid.row_height || 30;
		// the body holds a spacer row for each pinned opening row: body_rows counts them already
		const needed = (grid.header_height || 0) + (grid.body_rows || 0) * rh + 2;
		const px = `${Math.ceil(needed)}px`;
		if (scroll.style.maxHeight !== px) scroll.style.maxHeight = px;
	}

	/**
	 * The Statement is a sheet, not the frame of the table: as wide as its columns and, for a
	 * short report, as tall as its rows (the frame's height stays the most it may take).
	 */
	fit_statement() {
		const page = this.page;
		const root = page.root;
		if (page.state?.mode !== "statement") {
			root.classList.remove("rv-stmt-sized");
			return;
		}
		const grid = page.grid;
		const widths = grid.model ? grid.size_widths() : [];
		if (!widths.length) return;
		// the widths of the model, or what the table drew when its cells made a column wider
		const drawn = grid.rt ? grid.rt.scrollWidth : 0;
		const width = Math.max(widths.reduce((a, w) => a + (Number(w) || 0), 0), drawn);
		const was = parseFloat(root.style.getPropertyValue("--rv-stmt-w")) || 0;
		if (Math.abs(was - width) > 1) {
			root.style.setProperty("--rv-stmt-w", `${Math.ceil(width) + 2}px`);
			// shown when the width holds (the next draw), or soon whatever happens
			clearTimeout(this.stmt_timer);
			this.stmt_timer = setTimeout(() => root.classList.add("rv-stmt-sized"), 400);
		} else {
			root.classList.add("rv-stmt-sized");
		}
		const rows = grid.body_rows || 0;
		const foot = grid.rt?.querySelectorAll?.(".rv-rt-bottom .rv-row").length || 0;
		// every row on the sheet, the totals after them, no scroll bar of its own; a very long
		// report keeps its own scroll (the table draws only the rows on screen)
		const rh = grid.row_height || 28;
		const shown = Math.min(rows, STATEMENT_MAX_ROWS);
		const head = Math.max(grid.header_height || 0, 2 * rh);
		// two rows of room: the table's own measure of a row is a pixel or two above --rh
		const needed = head + (Math.max(shown, 3) + foot + (page.grid.top_el?.childElementCount || 0) + 2) * rh + 8;
		root.style.setProperty("--rv-stmt-h", `${Math.ceil(needed)}px`);
	}

	refresh_statement() {
		const page = this.page;
		const s = page.state;
		const el = this.stmt;
		if (!s || !el) return;
		if (s.mode !== "statement") page.root.classList.remove("rv-stmt-sized");
		el.querySelector(".t").textContent = __(page.report_name || "");
		const f = page.last_filters || {};
		const date = (v) => (v ? frappe.datetime.str_to_user(v) : "");
		const from = f.from_date || f.period_start_date;
		const to = f.to_date || f.period_end_date;
		const parts = [f.company, from && to ? __("From {0} to {1}", [date(from), date(to)]) : "", f.presentation_currency || ""].filter(Boolean);
		el.querySelector(".s").textContent = parts.join(" · ");
		const levels = el.querySelector(".rv-stmt-levels");
		const tree = Boolean(page.report?.tree?.enabled);
		levels.hidden = !tree;
		if (tree) {
			const depth = s.tree?.expanded ? null : s.tree?.depth ?? page.report.tree.initial_depth ?? 2;
			for (const b of levels.querySelectorAll("[data-level]")) {
				const on = depth != null && this.level_depth(b.dataset.level) === depth;
				b.classList.toggle("on", on);
				b.setAttribute("aria-pressed", on ? "true" : "false");
			}
		}
	}

	/** The rows the view shows (update_status): in the card's toolbar (A) or the bottom bar (C). */
	set_counts(counts) {
		const page = this.page;
		const noun = page.config?.rows_label || __("Rows");
		const parts = [__("{0} {1} of {2}", [noun, fmt_int(counts.shown), fmt_int(counts.total)])];
		if (counts.groups) parts.push(__("Groups {0}", [fmt_int(counts.groups)]));
		const n = page.controls.active_count();
		if (n) parts.push(__("Filtered ({0})", [n]));
		// A: «Last updated» stands at the end of the card's bottom bar (Main.dc.html)
		if (this.ran_at && this.kind !== "a") parts.push(__("Last updated {0}", [this.ran_at]));
		this.tools.count.textContent = parts.join(" · ");
		if (this.kind === "a") this.paint_updated();
	}

	/** A: the bottom bar of the card, always there: the selection's numbers, then «Last updated». */
	paint_updated() {
		const bar = this.page.status?.el;
		if (!bar) return;
		let el = bar.querySelector(".rv-status-upd");
		if (!el) {
			el = document.createElement("span");
			el.className = "rv-status-upd";
			bar.append(el);
		}
		el.textContent = this.ran_at ? __("Last updated {0}", [this.ran_at]) : "";
		bar.hidden = false;
	}

	/** A new result of the report arrived (handle_response): «Last updated» says when. */
	ran() {
		let t = "";
		try {
			t = String(frappe.datetime.now_time()).slice(0, 5);
		} catch {
			const d = new Date();
			t = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}
		this.ran_at = t;
		if (this.kind === "a") this.paint_updated();
	}

	/** The room the layout keeps under the table's frame (the bottom bar of C), for fit_height. */
	below_grid() {
		return this.foot ? this.foot.offsetHeight : 0;
	}

	/** The saved views changed (views_menu): the tabs follow. */
	views_changed() {
		if (!this.tabs) return;
		const page = this.page;
		this.tabs.set_list(page.views_list);
		this.tabs.set_applied(page.applied_view, page.views_menu?.modified);
	}

	/** ⋯ on a phone (C): the table tools the bar folded away, then the usual items. */
	open_phone_more(anchor) {
		const page = this.page;
		const s = page.state;
		const mode = s?.mode || "grid";
		const items = [];
		const t = this.tools;
		if (!t.group.hidden) items.push({ key: "group", label: __("Group by…"), icon: icons.group(), act: () => open_group_menu(page, anchor) });
		if (!t.subtotals.hidden) {
			items.push({ key: "subtotals", label: __("Subtotals"), icon: icons.sigma(), check: s.group.subtotals !== false ? icons.check_sm() : "", act: () => (page.set_subtotals(s.group.subtotals === false), this.refresh()) });
		}
		if (!t.columns.hidden) items.push({ key: "columns", label: __("Columns"), icon: icons.columns(), act: () => page.controls.side_host().set_side("columns") });
		if (!t.density.hidden) items.push({ key: "density", label: __("Density…"), act: () => open_density_menu(page, anchor) });
		if (page.header.export_button && !page.header.export_button.hidden) items.push({ key: "export", label: __("Export…"), icon: icons.download(), act: () => open_export_menu(page, anchor) });
		void mode;
		if (!items.length) {
			open_more_menu(page, anchor, { print: true });
			return;
		}
		items.push({ sep: true }, { key: "more", label: __("More…"), icon: icons.more(), act: () => open_more_menu(page, anchor, { print: true }) });
		const wrapped = items.map((it) => (it.sep || it.disabled ? it : { ...it, act: () => (close_popover(), it.act()) }));
		const content = menu_content(wrapped, "");
		open_popover({ root: page.root, anchor, content, width: 240, role: "menu", label: __("More"), align: "end" });
		content.querySelector(".rv-mi:not(:disabled)")?.focus();
	}
}
