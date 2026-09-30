// Report filters built from the report's own script (docs/architecture.md §2.2, §11.1 #12-15).
// The script is evaluated with frappe.dom.eval exactly like query_report.js (QJ:425-454), and
// each filter is a Frappe control (frappe.ui.form.make_control), with the same behaviour as
// the original page: default, reqd, depends_on, on_change, get_query, get_data.

export class MissingFiltersError extends Error {
	constructor(labels) {
		super(__("Please set filters"));
		this.labels = labels;
	}
}

// Load frappe.query_reports[name] as the original page does.
export async function load_report_settings(report_name, script) {
	if (!frappe.query_reports[report_name]) {
		frappe.dom.eval(script?.script || "");
		// Scripts may start async requests (erpnext.utils.add_dimensions): wait for them.
		await new Promise((resolve) => frappe.after_ajax(resolve));
	}
	const key = script?.custom_report_name || report_name;
	const settings = frappe.query_reports[key] || frappe.query_reports[report_name] || {};
	if (script) {
		settings.html_format = script.html_format;
		settings.execution_time = script.execution_time || 0;
	}
	if (!settings.filters?.length && script?.filters?.length) settings.filters = script.filters;
	frappe.query_reports[report_name] = settings;
	return settings;
}

export class ReportFilters {
	/**
	 * @param {object} opts {parent: HTMLElement, host, defs: Array, on_change: () => void}
	 *        host is the page object; host.facade is passed to on_change like the original.
	 */
	constructor({ parent, host, defs, on_change }) {
		this.parent = parent;
		this.host = host;
		this.on_change = on_change;
		this.controls = [];
		this._no_refresh = false;
		this.build(defs || []);
	}

	build(defs) {
		this.parent.innerHTML = "";
		this.controls = defs
			.filter((d) => d && d.fieldtype !== "Break")
			.map((def) => this.make(def));
		this.refresh_dependency();
	}

	make(def) {
		const df = def;
		if (!df.placeholder) df.placeholder = df.label;
		df.input_class = "input-xs";
		const wrap = document.createElement("div");
		wrap.className = "rv-filter";
		wrap.dataset.fieldtype = df.fieldtype;
		this.parent.appendChild(wrap);
		const f = frappe.ui.form.make_control({
			df,
			parent: wrap,
			only_input: df.fieldtype !== "Check",
		});
		f.refresh();
		if (df.fieldtype !== "HTML") {
			if (!f.$input) f.make_input();
			f.$input.attr("placeholder", __(df.label, null, df.parent));
			$(f.wrapper).attr("title", __(df.label, null, df.parent));
		}
		if (df.default) f.set_input(df.default);
		if (df.get_query) f.get_query = df.get_query;
		if (df.on_change) f.on_change = df.on_change;

		df.onchange = () => {
			this.refresh_dependency();
			const current = JSON.stringify(this.get_values());
			if (this._previous === current) return;
			this._previous = current;
			if (f.on_change) f.on_change(this.host.facade);
			else if (!this._no_refresh) this.on_change();
		};
		return Object.assign(f, df);
	}

	// Unknown names return undefined, as query_report.get_filter does (without its console.warn,
	// since this page must keep the console clean).
	get_filter(fieldname) {
		return this.controls.find((c) => c.df.fieldname === fieldname);
	}

	get_filter_value(fieldname) {
		const f = this.get_filter(fieldname);
		return f ? f.get_value() : null;
	}

	// Same serialisation as query_report.get_filter_values (QJ:1474-1507).
	get_values(raise = false) {
		if (raise) {
			const missing = this.controls.filter((f) => (f.df.reqd || f.df.mandatory) && !f.get_value());
			if (missing.length) throw new MissingFiltersError(missing.map((f) => __(f.df.label)));
		}
		const out = {};
		for (const f of this.controls) {
			if (!f.get_value?.()) continue;
			let v = f.get_value();
			if (f.df.hidden) v = f.value;
			if (v === "%") v = null;
			if (f.df.wildcard_filter) v = `%${v}%`;
			out[f.df.fieldname] = v;
		}
		return out;
	}

	set_filter_value(fieldname, value) {
		const map = typeof fieldname === "string" ? { [fieldname]: value } : fieldname || {};
		const keys = Object.keys(map);
		this._no_refresh = true;
		const jobs = keys.map((k, i) => {
			if (i === keys.length - 1) this._no_refresh = false;
			const f = this.get_filter(k);
			return f ? f.set_value(map[k]) : null;
		});
		return Promise.all(jobs);
	}

	// Values coming from the URL / frappe.route_options (QJ:671-698).
	async set_route_values(options) {
		this._no_refresh = true;
		try {
			for (const f of this.controls) {
				if (!Object.hasOwn(options, f.df.fieldname)) continue;
				let value = options[f.df.fieldname];
				if (typeof value === "string" && value[0] === "[") {
					try {
						value = JSON.parse(value);
					} catch {
						// keep the raw string
					}
				}
				await f.set_value(value);
			}
		} finally {
			this._no_refresh = false;
		}
	}

	toggle_filter_display(fieldname, flag) {
		$(this.parent).find(`div[data-fieldname="${fieldname}"]`).toggleClass("hide-control", flag);
	}

	evaluate_depends_on(expression, label) {
		const doc = this.get_values();
		if (typeof expression === "boolean") return expression;
		if (String(expression).startsWith("eval:")) {
			try {
				return frappe.utils.eval(expression.slice(5), { doc });
			} catch {
				frappe.throw(__('Invalid "depends_on" expression set in filter {0}', [label]));
			}
		}
		const value = doc[expression];
		return Array.isArray(value) ? value.length > 0 : Boolean(value);
	}

	refresh_dependency() {
		for (const f of this.controls) {
			if (!f.df.depends_on) continue;
			const show = this.evaluate_depends_on(f.df.depends_on, f.df.label);
			if (show && f.df.hidden_due_to_dependency) {
				f.df.hidden_due_to_dependency = false;
				this.toggle_filter_display(f.df.fieldname, false);
			} else if (!show && !f.df.hidden_due_to_dependency) {
				f.df.hidden_due_to_dependency = true;
				this.toggle_filter_display(f.df.fieldname, true);
				f.set_value(f.df.default || null);
			}
		}
	}

	// Filter definitions sent with every run (§2.1): fieldname / fieldtype / options only.
	js_filters() {
		return this.controls.map((f) => ({
			fieldname: f.df.fieldname,
			fieldtype: f.df.fieldtype,
			options: typeof f.df.options === "string" ? f.df.options : null,
		}));
	}
}
