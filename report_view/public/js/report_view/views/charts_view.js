// Charts dashboard (docs/architecture.md §11.1 #69-73; design: reference/design/screens/charts.png).
// A grid of cards, each one chart drawn by ECharts from its own Perspective view
// (ReportSession.read_card: deleted in `finally` once read). Above them the slicers of the
// dashboard (values of a column, a date range) and the cross-filter (a category clicked in
// one card filters the others). Every number is the engine's; nothing is computed here.
// A card is read only when it is on screen (IntersectionObserver) and again only when what
// it shows changed; redraws are batched to one per frame.
// Loaded on demand in report_view_charts.bundle.js; the modules it shares with the page come
// from the page's bundle (views/charts_shared.js).

import { chart_config, dashboard_state, popover, set_filter, icons_module } from "./charts_shared.js";
import { esc } from "../util.js";
import { ChartCard, PALETTE, TYPE_ICONS, MORE_ICON, forget_sessions } from "./chart_card.js";

const { chart_dimensions, chart_measures, slicer_dimensions, resolve_dashboard, date_text, level_of } = chart_config;
const { LIMIT_CARDS, LIMIT_SLICERS, new_card_id, sanitize_dashboard } = dashboard_state;
const { open_popover, close_popover, menu_content } = popover;
const { open_set_filter } = set_filter;
const { icons } = icons_module;

const REFRESH_MS = 40;

const PLUS_ICON =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>';

export class ChartsView {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.parent where the view goes (it replaces this element)
	 * @param {HTMLElement} opts.root the .rv element: colours and sizes are its CSS tokens
	 * @param {boolean} opts.rtl
	 * @param {(dashboard: object|null) => void} opts.on_change the user changed the dashboard
	 *   (null: back to the report's default)
	 */
	constructor({ parent, root, rtl, on_change }) {
		this.root = root;
		this.rtl = rtl;
		this.on_change = on_change;
		this.ctx = null;
		this.dash = null;
		this.cards = new Map();
		this.token = 0;
		const el = document.createElement("div");
		el.className = "rv-dash rv-chartsv";
		el.innerHTML = `
			<div class="rv-slicers" role="toolbar" aria-label="${esc(__("Chart filters"))}">
				<span class="rv-slicers-lbl">${icons.funnel(13)}<span>${esc(__("Chart filters"))}</span></span>
				<div class="rv-slicer-list"></div>
				<button type="button" class="rv-btn sm ghost rv-slicer-add" data-action="add-slicer" aria-haspopup="menu">${PLUS_ICON}<span>${esc(__("Add filter"))}</span></button>
				<span class="rv-slicers-sp"></span>
				<button type="button" class="rv-btn sm rv-card-add" data-action="add-card">${PLUS_ICON}<span>${esc(__("Add chart"))}</span></button>
				<button type="button" class="rv-btn sm icon ghost" data-action="dash-menu" aria-haspopup="menu" aria-label="${esc(__("Dashboard options"))}" title="${esc(
					__("Dashboard options")
				)}">${MORE_ICON}</button>
			</div>
			<div class="rv-charts rv-dash-grid"></div>
			<div class="rv-card wide rv-dash-empty" hidden>
				<div class="rv-state">
					<div class="rv-state-ico">${TYPE_ICONS.bar}</div>
					<h3></h3>
					<p></p>
				</div>
			</div>`;
		parent.replaceWith(el);
		this.el = el;
		this.q = (sel) => el.querySelector(sel);
		this.grid_el = this.q(".rv-dash-grid");
		this.q('[data-action="add-slicer"]').addEventListener("click", (e) => this.open_add_slicer(e.currentTarget));
		this.q('[data-action="add-card"]').addEventListener("click", () => this.add_card());
		this.q('[data-action="dash-menu"]').addEventListener("click", (e) => this.open_dash_menu(e.currentTarget));

		// Cards are read when they come into view (and a little before).
		this.visibility = new IntersectionObserver((entries) => this.on_visible(entries), { rootMargin: "240px 0px" });
		// Desk's theme and the density of the page: drawn again, in place.
		// Observed while the dashboard is shown (show), not after close.
		this.theme_root = root;
		this.theme_observer = new MutationObserver(() => {
			this._theme = null;
			for (const card of this.cards.values()) card.schedule_draw();
		});
	}

	// ------------------------------------------------------------ state

	/**
	 * Shows the dashboard of the view state of the page.
	 * @param {object} ctx {session, report, state, config, controls}
	 */
	async show(ctx) {
		this.ctx = ctx;
		// the theme may have changed while the dashboard was closed
		this._theme = null;
		this.theme_observer.observe(this.theme_root, { attributes: true, attributeFilter: ["class"] });
		// Desk's theme (ADR-022): the tokens are Frappe's variables, which follow <html data-theme>
		this.theme_observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
		this.refresh_now();
	}

	/** The dashboard of the view state changed: cards are read again where needed (batched). */
	async refresh() {
		clearTimeout(this._refresh_timer);
		this._refresh_timer = setTimeout(() => this.refresh_now(), REFRESH_MS);
	}

	refresh_now() {
		clearTimeout(this._refresh_timer);
		const ctx = this.ctx;
		if (!ctx) return;
		const { report, state, config, controls } = ctx;
		this.dash = resolve_dashboard(state, report, config, controls.label_key());
		this.render_slicers();
		this.sync_cards();
		// What waited for the new dashboard: an open editor shows it, a new card or slicer opens.
		for (const card of this.cards.values()) if (card.editor && !card.editor.handle.closed) card.editor.render();
		const pending = this._pending;
		this._pending = null;
		if (pending?.card) {
			const card = this.cards.get(pending.card);
			if (card) {
				card.el.scrollIntoView({ block: "nearest" });
				card.open_editor();
			}
		} else if (pending?.slicer) {
			const btn = this.q(`.rv-slicer-list [data-slicer="${CSS.escape(pending.slicer)}"]`);
			if (btn) this.open_slicer(pending.slicer, btn);
		}
	}

	/**
	 * The dashboard as the view state keeps it, resolved from the page's state now (a change
	 * made a moment ago is already there, even before the batched refresh drew it).
	 */
	current() {
		const ctx = this.ctx;
		const d = ctx ? resolve_dashboard(ctx.state, ctx.report, ctx.config, ctx.controls.label_key()) : { cards: [], slicers: [], cross: null };
		return { cards: d.cards.map((c) => ({ ...c })), slicers: d.slicers.map((s) => ({ ...s })), cross: d.cross ? { ...d.cross } : null };
	}

	/** A change of the user: the new dashboard goes to the page (state, URL, user settings). */
	change(fn) {
		if (!this.ctx) return;
		const next = this.current();
		fn(next);
		if (next.cross && !next.cards.some((c) => c.id === next.cross.card)) next.cross = null;
		this.on_change(sanitize_dashboard(next));
	}

	// ------------------------------------------------------------ cards

	sync_cards() {
		const ctx = this.ctx;
		const wanted = new Set(this.dash.cards.map((c) => c.id));
		for (const [id, card] of this.cards) {
			if (wanted.has(id)) continue;
			this.visibility.unobserve(card.el);
			card.destroy();
			this.cards.delete(id);
		}
		let before = null;
		for (const def of this.dash.cards) {
			let card = this.cards.get(def.id);
			if (!card) {
				card = new ChartCard(this, def.id);
				this.cards.set(def.id, card);
				this.visibility.observe(card.el);
			}
			// Cards in the order of the dashboard.
			const at = before ? before.nextSibling : this.grid_el.firstChild;
			if (card.el !== at) this.grid_el.insertBefore(card.el, at);
			before = card.el;
			card.set(def, ctx);
		}
		const none = !this.dash.cards.length;
		const empty = this.q(".rv-dash-empty");
		empty.hidden = !none;
		if (none) {
			const measures = chart_measures(ctx.report, ctx.state);
			empty.querySelector("h3").textContent = measures.length ? __("No charts yet") : __("Nothing to chart");
			empty.querySelector("p").textContent = measures.length
				? __("Add a chart to see the report's numbers by any of its columns.")
				: __("This report has no numeric column the engine can add up.");
		}
		this.q('[data-action="add-card"]').disabled = this.dash.cards.length >= LIMIT_CARDS || !chart_measures(ctx.report, ctx.state).length;
	}

	on_visible(entries) {
		for (const entry of entries) {
			const card = [...this.cards.values()].find((c) => c.el === entry.target);
			if (!card) continue;
			card.visible = entry.isIntersecting;
			if (card.visible) card.load_if_stale();
		}
	}

	add_card() {
		const ctx = this.ctx;
		if (!ctx) return;
		const dims = chart_dimensions(ctx.report);
		const measures = chart_measures(ctx.report, ctx.state);
		if (!measures.length) return;
		const used = new Set(this.dash.cards.map((c) => c.x));
		const x = (dims.find((d) => !used.has(d.key)) || dims[0])?.key ?? null;
		this.change((d) => {
			const id = new_card_id(d.cards);
			// the first type the report's settings allow (ADR-023)
			const type = ctx.config?.features?.chart_types?.[0] || "bar";
			d.cards.push({ id, type, x: type === "kpi" ? null : x, series: measures.slice(0, 2), size: "half" });
			// The new card opens its editor once it is on the page.
			this._pending = { card: id };
		});
	}

	update_card(id, patch) {
		this.change((d) => {
			const card = d.cards.find((c) => c.id === id);
			if (card) Object.assign(card, patch);
			// The cross-filter of a card follows its dimension.
			if (d.cross?.card === id && patch.x !== undefined && patch.x !== d.cross.key) d.cross = null;
		});
	}

	duplicate_card(id) {
		this.change((d) => {
			const at = d.cards.findIndex((c) => c.id === id);
			if (at < 0 || d.cards.length >= LIMIT_CARDS) return;
			d.cards.splice(at + 1, 0, { ...d.cards[at], id: new_card_id(d.cards), title: d.cards[at].title });
		});
	}

	remove_card(id) {
		this.change((d) => {
			d.cards = d.cards.filter((c) => c.id !== id);
		});
	}

	/** A category clicked in a card: the other cards are filtered by it; clicked again, cleared. */
	cross_filter(card, value) {
		const def = card.def;
		if (!def?.x) return;
		const v = typeof value === "number" && level_of(def.x) === null && this.is_date(def.x) ? date_text(value) : value;
		this.change((d) => {
			const same = d.cross && d.cross.card === def.id && String(d.cross.value) === String(v) && (d.cross.value === null) === (v === null);
			d.cross = same ? null : { card: def.id, key: def.x, value: v ?? null };
		});
	}

	is_date(key) {
		const c = this.ctx?.controls.column(key);
		return Boolean(c && ["Date", "Datetime"].includes(c.fieldtype));
	}

	open_dash_menu(anchor) {
		const own = Boolean(this.dash?.own);
		open_popover({
			root: this.root,
			anchor,
			role: "menu",
			width: 240,
			align: "end",
			label: __("Dashboard options"),
			content: menu_content([
				{ key: "reset", label: __("Report default dashboard"), icon: icons.reset(), disabled: !own, act: () => (close_popover(), this.on_change(null)) },
			]),
		});
	}

	// ------------------------------------------------------------ slicers

	dimension_title(key) {
		const d = chart_dimensions(this.ctx.report).find((x) => x.key === key);
		if (d?.level) return d.level === 1 ? __("Top-level groups") : __("Level {0}", [d.level]);
		return this.ctx.controls.title(key);
	}

	value_text(key, value) {
		if (value === null || value === undefined || value === "") return __("Not Set");
		if (level_of(key) !== null) return this.tree_name(value);
		return this.ctx.controls.value_text(key, value) || String(value);
	}

	// The name of a tree node (its row's name column), else its label.
	tree_name(value) {
		const report = this.ctx.report;
		const parts = this.ctx.config.tree || {};
		const label = report.tree?.label_key;
		if (!this._names || this._names.report !== report) {
			const map = new Map();
			if (label) for (const r of report.rows) if (r[label] !== null && r[label] !== undefined) map.set(String(r[label]), r);
			this._names = { report, map };
		}
		const row = this._names.map.get(String(value));
		return (row && parts.name_key && row[parts.name_key]) || String(value);
	}

	slicer_text(s) {
		if (s.type === "date") {
			const d = (v) => frappe.datetime.str_to_user(v);
			if (s.from && s.to) return `${d(s.from)} – ${d(s.to)}`;
			if (s.from) return `≥ ${d(s.from)}`;
			if (s.to) return `≤ ${d(s.to)}`;
			return __("All");
		}
		if (!Array.isArray(s.values)) return __("All");
		if (!s.values.length) return __("None");
		if (s.values.length === 1) return this.value_text(s.key, s.values[0]);
		return __("{0} values", [s.values.length]);
	}

	render_slicers() {
		const list = this.q(".rv-slicer-list");
		const { slicers, cross } = this.dash;
		const chips = slicers.map((s) => {
			const on = s.type === "date" ? Boolean(s.from || s.to) : Array.isArray(s.values);
			return `<span class="rv-slicer${on ? " on" : ""}" data-key="${esc(s.key)}">
				<button type="button" class="rv-slicer-btn" data-slicer="${esc(s.key)}" aria-haspopup="dialog">
					${s.type === "date" ? icons.calendar(13) : ""}<span class="k">${esc(this.dimension_title(s.key))}</span><span class="v">${esc(this.slicer_text(s))}</span>${icons.chevron_down(12)}
				</button>
				<button type="button" class="rv-chip-x" data-remove="${esc(s.key)}" aria-label="${esc(__("Remove filter {0}", [this.dimension_title(s.key)]))}">${icons.x_sm(11)}</button>
			</span>`;
		});
		if (cross) {
			chips.push(`<span class="rv-slicer cross" data-cross="1">
				<span class="rv-slicer-btn"><span class="k">${esc(__("Filtered by"))}</span><span class="v">${esc(this.value_text(cross.key, cross.value))}</span></span>
				<button type="button" class="rv-chip-x" data-clear-cross="1" aria-label="${esc(__("Clear the chart filter"))}">${icons.x_sm(11)}</button>
			</span>`);
		}
		const html = chips.join("");
		// While a slicer's list is open, its chip stays the same element: only its text changes.
		const same = list.children.length === chips.length && [...list.children].every((c, i) => c.dataset.key === (slicers[i]?.key ?? undefined));
		if (same && !cross) {
			slicers.forEach((s, i) => {
				const chip = list.children[i];
				chip.classList.toggle("on", s.type === "date" ? Boolean(s.from || s.to) : Array.isArray(s.values));
				chip.querySelector(".v").textContent = this.slicer_text(s);
			});
		} else {
			list.innerHTML = html;
			for (const b of list.querySelectorAll("[data-slicer]")) b.addEventListener("click", () => this.open_slicer(b.dataset.slicer, b));
			for (const b of list.querySelectorAll("[data-remove]")) {
				b.addEventListener("click", () => {
					close_popover();
					this.change((d) => {
						d.slicers = d.slicers.filter((s) => s.key !== b.dataset.remove);
					});
				});
			}
			list.querySelector("[data-clear-cross]")?.addEventListener("click", () =>
				this.change((d) => {
					d.cross = null;
				})
			);
		}
		this.el.classList.toggle("has-slicers", Boolean(chips.length));
		this.q('[data-action="add-slicer"]').disabled = slicers.length >= LIMIT_SLICERS;
	}

	open_add_slicer(anchor) {
		const used = new Set(this.dash.slicers.map((s) => s.key));
		const dims = slicer_dimensions(this.ctx.report).filter((d) => !used.has(d.key));
		const items = dims.map((d) => ({
			key: d.key,
			label: this.dimension_title(d.key),
			icon: d.kind === "date" ? icons.calendar(14) : icons.funnel(13),
			act: () => {
				close_popover();
				this._pending = { slicer: d.key };
				this.change((dash) => {
					dash.slicers.push(d.kind === "date" ? { key: d.key, type: "date", from: null, to: null } : { key: d.key, type: "set", values: null });
				});
			},
		}));
		open_popover({
			root: this.root,
			anchor,
			role: "menu",
			width: 240,
			label: __("Add filter"),
			content: menu_content(items.length ? items : [{ label: __("No more columns"), disabled: true, act() {} }], __("Filter the charts by")),
		});
	}

	open_slicer(key, anchor) {
		const s = this.dash.slicers.find((x) => x.key === key);
		if (!s) return;
		if (s.type === "date") return this.open_date_slicer(s, anchor);
		const ctx = this.ctx;
		open_set_filter({
			root: this.root,
			anchor,
			title: this.dimension_title(key),
			selected: Array.isArray(s.values) ? [...s.values] : null,
			load: async (search) => {
				if (!this.ctx || this.ctx.session !== ctx.session) return { values: [] };
				const out = await ctx.session.slicer_values(ctx.state, key, this.dash, search ? { search } : {});
				return {
					values: out.values.map((v) => ({
						value: v.value,
						count: v.count,
						label_html: level_of(key) !== null ? esc(this.value_text(key, v.value)) : ctx.controls.value_html(key, v.value),
					})),
					truncated: out.truncated,
				};
			},
			on_change: (selected) =>
				this.change((d) => {
					const slicer = d.slicers.find((x) => x.key === key);
					if (slicer) slicer.values = selected;
				}),
		});
	}

	open_date_slicer(s, anchor) {
		const box = document.createElement("div");
		box.className = "rv-dslicer";
		box.innerHTML = `
			<div class="rv-pop-hd"><span>${esc(this.dimension_title(s.key))}</span><button type="button" class="rv-link" data-action="clear">${esc(__("Clear", null, "Report View"))}</button></div>
			<div class="rv-pop-sec rv-dslicer-fields">
				<label class="rv-dslicer-f"><span>${esc(__("From"))}</span><div data-f="from"></div></label>
				<label class="rv-dslicer-f"><span>${esc(__("To"))}</span><div data-f="to"></div></label>
			</div>`;
		const values = { from: s.from, to: s.to };
		const apply = () =>
			this.change((d) => {
				const slicer = d.slicers.find((x) => x.key === s.key);
				if (slicer) Object.assign(slicer, values);
			});
		const controls = {};
		for (const part of ["from", "to"]) {
			const f = frappe.ui.form.make_control({
				df: {
					fieldtype: "Date",
					fieldname: `rv_slicer_${part}`,
					label: part === "from" ? __("From") : __("To"),
					onchange: () => {
						// A Date control gives YYYY-MM-DD; a typed date in the user's format is read too.
						let v = f.get_value() || null;
						if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = frappe.datetime.user_to_str(v);
						if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) v = null;
						if (v === values[part]) return;
						values[part] = v;
						apply();
					},
				},
				parent: box.querySelector(`[data-f="${part}"]`),
				only_input: true,
			});
			f.refresh();
			if (!f.$input) f.make_input();
			f.$input.attr("aria-label", part === "from" ? __("From") : __("To"));
			if (values[part]) f.set_input(values[part]);
			controls[part] = f;
		}
		box.querySelector('[data-action="clear"]').addEventListener("click", () => {
			values.from = null;
			values.to = null;
			for (const f of Object.values(controls)) f.set_input(null);
			apply();
		});
		open_popover({ root: this.root, anchor, content: box, cls: "rv-dslicer-pop", width: 260, label: this.dimension_title(s.key) });
	}

	// ------------------------------------------------------------ drawing

	/** Colours and sizes of the page, read from its CSS tokens (they change with the theme). */
	theme() {
		if (this._theme) return this._theme;
		const css = getComputedStyle(this.root);
		const v = (name) => css.getPropertyValue(name).trim();
		this._theme = {
			palette: PALETTE.map(v),
			text: v("--tx"),
			text_2: v("--tx-2"),
			text_3: v("--tx-3"),
			line: v("--line"),
			line_2: v("--line-2"),
			line_3: v("--line-3"),
			surface: v("--surface"),
			hover: v("--hover"),
			shadow: v("--sh-pop"),
			radius: v("--r"),
			font: css.fontFamily,
			font_size: parseFloat(v("--fs-chart")) || parseFloat(v("--fs-xs")) || 11,
		};
		return this._theme;
	}

	format(column, value, currency) {
		if (value === null || value === undefined) return "—";
		if (!column) return String(value);
		const ck = column.currency?.kind === "row" ? column.currency.key : null;
		const row = ck ? { [ck]: currency || null } : {};
		const df = { ...column.original, fieldtype: column.fieldtype };
		return frappe.utils.html2text(String(frappe.format(value, df, { inline: true, always_show_decimals: true }, row))).trim();
	}

	axis_text(value) {
		if (value === 0) return "0";
		const shorten = frappe.utils.shorten_number;
		if (typeof shorten === "function") return shorten.call(frappe.utils, value, frappe.sys_defaults?.country, 3);
		return frappe.utils.html2text(String(frappe.format(value, { fieldtype: "Float", precision: 0 }, { inline: true }))).trim();
	}

	pct_text(value) {
		if (value === null || value === undefined) return "";
		return `${frappe.utils.html2text(String(frappe.format(value, { fieldtype: "Float", precision: 1 }, { inline: true }))).trim()}%`;
	}

	// ------------------------------------------------------------ lifecycle

	/** Leaves the Charts view: every ECharts instance is disposed; no view is left open. */
	async close() {
		this.token += 1;
		clearTimeout(this._refresh_timer);
		this.ctx = null;
		for (const card of this.cards.values()) {
			this.visibility.unobserve(card.el);
			card.destroy();
		}
		this.cards.clear();
		this.grid_el.replaceChildren();
		this.q(".rv-slicer-list").replaceChildren();
		this._theme = null;
		this.theme_observer.disconnect();
		forget_sessions();
	}

	/** ECharts instances alive (the lifecycle tests require none after close). */
	debug_instances() {
		return [...this.cards.values()].filter((c) => c.chart).length;
	}

	// Raw data of every card, for the tests.
	debug_cards() {
		return (this.dash?.cards || []).map((d) => this.cards.get(d.id)).filter(Boolean).map((c) => c.debug());
	}
}
