// Criteria bar of the report (design: one line, reference/design/screens/main.png): the
// company, the "Period" field, and the other filters of the report behind "More options".
// Every filter stays a Frappe control built from the report's own script (report_filters.js)
// and is sent to frappe.desk.query_report.run unchanged; this module only decides where each
// control stands. The date and fiscal-year filters the period field covers are kept, hidden.

import { ReportFilters } from "./report_filters.js";
import { PeriodPicker } from "./period_picker.js";
import { icons } from "../components/icons.js";
import { open_popover, close_popover } from "../components/popover.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

const DEFAULT_KEYS = { from_key: "from_date", to_key: "to_date", fiscal_year_key: "fiscal_year", company_key: "company" };

/**
 * Which filter goes where.
 * @param {Array} defs filter definitions of the report script
 * @param {object} period register.period ({from_key, to_key, fiscal_year_key, company_key})
 * @returns {{keys: object, has_period: boolean, place: Map<string, "main"|"period"|"more">}}
 */
export function plan_criteria(defs, period = {}) {
	const keys = { ...DEFAULT_KEYS, ...(period || {}) };
	const names = new Set(defs.map((d) => d.fieldname));
	const has_period = names.has(keys.from_key) && names.has(keys.to_key);
	const place = new Map();
	for (const d of defs) {
		if (!d || d.fieldtype === "Break") continue;
		const name = d.fieldname;
		let where = "more";
		if (has_period && [keys.from_key, keys.to_key, keys.fiscal_year_key].includes(name)) where = "period";
		else if (name === keys.company_key) where = "main";
		// Without a period field, the dates of the report stay on the bar ("as on" a date).
		else if (!has_period && (d.fieldtype === "Date" || d.fieldtype === "DateRange")) where = "main";
		// A required filter the period field does not cover is never hidden.
		else if (d.reqd) where = "main";
		place.set(name, where);
	}
	return { keys, has_period, place };
}

export class CriteriaBar {
	/**
	 * @param {object} o {root, parent (.rv-filters), host, defs, period, on_change}
	 */
	constructor({ root, parent, host, defs, period, on_change }) {
		this.root = root;
		this.host = host;
		this.on_change = on_change;
		const plan = plan_criteria(defs || [], period);
		this.plan = plan;
		parent.replaceChildren();
		this.main = document.createElement("div");
		this.main.className = "rv-criteria-main";
		this.hidden = document.createElement("div");
		this.hidden.hidden = true;
		this.more = document.createElement("div");
		this.more.className = "rv-more-filters";
		this.more_home = document.createElement("div");
		this.more_home.hidden = true;
		this.more_home.appendChild(this.more);
		parent.append(this.main, this.hidden, this.more_home);

		const company_slot = document.createElement("div");
		const containers = { main: this.main, period: this.hidden, more: this.more };
		this.filters = new ReportFilters({
			parent: this.hidden,
			host,
			defs,
			on_change: () => {
				this.refresh();
				on_change();
			},
			place: (df) => {
				const where = plan.place.get(df.fieldname) || "more";
				return df.fieldname === plan.keys.company_key ? company_slot : containers[where];
			},
		});
		this.main.prepend(...company_slot.childNodes);

		if (plan.has_period) {
			this.period = new PeriodPicker({
				root,
				parent: this.main,
				get: () => this.period_values(),
				on_apply: (p) => this.apply_period(p),
			});
		}
		const more_count = [...plan.place.values()].filter((w) => w === "more").length;
		this.more_button = document.createElement("button");
		this.more_button.type = "button";
		this.more_button.className = "rv-btn rv-more";
		this.more_button.setAttribute("aria-haspopup", "dialog");
		this.more_button.hidden = !more_count;
		this.more_button.innerHTML = `${icons.funnel()}<span>${esc(__("More options"))}</span><span class="rv-count-badge" hidden></span>${icons.chevron_down()}`;
		this.main.appendChild(this.more_button);
		this.more_button.addEventListener("click", () => this.toggle_more(this.more_button));
		this.refresh();
	}

	period_values() {
		const k = this.plan.keys;
		return {
			from: this.filters.get_filter_value(k.from_key) || null,
			to: this.filters.get_filter_value(k.to_key) || null,
			fiscal_year: this.filters.get_filter_value(k.fiscal_year_key) || null,
		};
	}

	/**
	 * Writes the period into the report's filters. A fiscal year that changes first: the
	 * report's own on_change of that filter may set the dates to the whole year (Trial
	 * Balance does, after a request), so the dates are written once it settled.
	 */
	async apply_period({ from, to, fiscal_year }) {
		const k = this.plan.keys;
		const f = this.filters;
		if (fiscal_year && f.get_filter(k.fiscal_year_key) && f.get_filter_value(k.fiscal_year_key) !== fiscal_year) {
			await f.set_filter_value(k.fiscal_year_key, fiscal_year);
			await new Promise((resolve) => frappe.after_ajax(() => setTimeout(resolve, 0)));
		}
		await f.set_filter_value({ [k.from_key]: from, [k.to_key]: to });
		this.refresh();
	}

	// The "More options" popover shows the filters' own container (its controls stay alive).
	toggle_more(button) {
		if (this.more_popover) {
			close_popover();
			return;
		}
		this.more_popover = open_popover({
			root: this.root,
			anchor: button,
			content: this.more,
			cls: "rv-more-pop",
			width: 460,
			label: __("More options"),
			on_close: () => {
				this.more_popover = null;
				this.more_home.appendChild(this.more);
			},
		});
		this.more.querySelector("input, select, .form-control")?.focus();
	}

	// Filters behind "More options" whose value is not the report's default.
	changed_count() {
		let n = 0;
		for (const c of this.filters.controls) {
			if (this.plan.place.get(c.df.fieldname) !== "more") continue;
			const v = c.get_value();
			const d = c.df.default ?? null;
			const empty = (x) => x === null || x === undefined || x === "" || (Array.isArray(x) && !x.length);
			if (empty(v) && empty(d)) continue;
			if (JSON.stringify(v) !== JSON.stringify(d) && String(v) !== String(d)) n += 1;
		}
		return n;
	}

	refresh() {
		this.period?.refresh();
		const badge = this.more_button?.querySelector(".rv-count-badge");
		if (!badge) return;
		const n = this.changed_count();
		badge.hidden = !n;
		badge.textContent = n ? frappe.format(n, { fieldtype: "Int" }, { inline: true }) : "";
	}
}
