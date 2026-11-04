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
// - the «›» at the end of a report row, which opens the row's details (the same button of the
//   label column, pressed for it).
// Every control calls what the standard page already does; nothing is computed here.

import { icons } from "../components/icons.js";
import { open_popover, close_popover, menu_content } from "../components/popover.js";
import { open_group_menu, open_density_menu, open_more_menu, open_export_menu } from "../components/head_menus.js";
import { ViewsTabs } from "../components/views_tabs.js";
import { esc, fmt_int } from "../util.js";
import { tree_index } from "../engine/tree_nodes.js";

export const LAYOUTS = ["a", "c"];

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
		// the «›» at the end of the rows (the grid tells when it drew)
		this.rail = document.createElement("div");
		this.rail.className = "rv-rd-rail";
		this.rail.setAttribute("aria-hidden", "true");
		this.rail.addEventListener("click", (e) => {
			const b = e.target.closest("[data-y]");
			if (!b) return;
			const y = Number(b.dataset.y);
			const rt = page.grid.rt;
			for (const th of rt?.querySelectorAll("tbody tr > th:first-child") || []) {
				if (rt.getMeta(th)?.y === y) th.querySelector(".rv-rd-btn")?.click();
			}
		});
		page.grid.after_style = () => this.paint_rail();
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
		if (!grid) page.root.classList.remove("rv-has-rail");
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

	refresh_statement() {
		const page = this.page;
		const s = page.state;
		const el = this.stmt;
		if (!s || !el) return;
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
		if (this.ran_at) parts.push(__("Last updated {0}", [this.ran_at]));
		this.tools.count.textContent = parts.join(" · ");
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

	/**
	 * The column of «›» at the end of the table (after each draw of the grid): a cell beside
	 * every row on screen, with the button where the row has details (the button of its
	 * label column is pressed for it). The table leaves the column its room (rv_layouts.css).
	 */
	paint_rail() {
		const grid = this.page.grid;
		const rt = grid.rt;
		const scroll = rt?.parentElement;
		if (!rt || !scroll) return;
		if (this.rail.parentElement !== scroll) scroll.append(this.rail);
		const box = scroll.getBoundingClientRect();
		const out = [];
		let any = false;
		const label = esc(__("Row details", null, "Report View"));
		const head = grid.header_height || 0;
		for (const tr of rt.querySelectorAll("tbody tr")) {
			if (tr.classList.contains("stale")) continue;
			const th = tr.firstElementChild;
			const r = tr.getBoundingClientRect();
			const top = Math.round(r.top - box.top);
			// under the headers the row is hidden (regular-table clips its first row)
			if (top + r.height <= head + 1) continue;
			const cls = ["rv-rd-cell", tr.classList.contains("group") && "group", tr.classList.contains("foot") && "foot", tr.classList.contains("rv-open") && "on"].filter(Boolean).join(" ");
			const y = th ? rt.getMeta(th)?.y : null;
			const button = th?.querySelector(".rv-rd-btn") ? `<button type="button" class="rv-rd-end" tabindex="-1" data-y="${y}" title="${label}">›</button>` : "";
			if (button) any = true;
			out.push(`<div class="${cls}" style="top:${Math.max(head, top)}px;height:${Math.round(r.height - Math.max(0, head - top))}px">${button}</div>`);
		}
		const html = any ? out.join("") : "";
		if (html !== this.rail_html) {
			this.rail.innerHTML = html;
			this.rail_html = html;
		}
		this.rail.style.setProperty("--rv-hh", `${head}px`);
		this.page.root.classList.toggle("rv-has-rail", any);
	}
}
