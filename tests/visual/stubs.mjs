// Minimal stand-ins for the parts of Frappe the page uses, enough to render it without a
// server: __ (with the real .po translations), frappe.format (number/date formatting of a
// system with Float precision 3 and "#,###.##"), and frappe.ui.form.make_control producing
// the same DOM as Frappe's controls (so desk.bundle.css and rv_page.css style them as on
// the site). Test-only code: never bundled with the app.
import $ from "../../../frappe/node_modules/jquery/dist/jquery.js";

window.$ = window.jQuery = $;

const params = new URLSearchParams(window.location.search);
export const LANG = params.get("lang") || "ar";
const MESSAGES = LANG === "ar" ? window.RV_MESSAGES || {} : {};

// Same lookup as frappe._: "<text>:<context>" first, then the text alone.
window.__ = function (text, replace, context = null) {
	let out = (context && MESSAGES[`${text}:${context}`]) || MESSAGES[text] || String(text ?? "");
	if (replace) out = out.replace(/\{(\d+)\}/g, (m, i) => (replace[i] !== undefined ? replace[i] : m));
	return out;
};

const esc = (s) =>
	String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function number(value, precision) {
	const n = Number(value);
	if (!Number.isFinite(n)) return esc(value);
	const fixed = Math.abs(n).toFixed(precision);
	const [int, dec] = fixed.split(".");
	const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return (n < 0 ? "-" : "") + grouped + (dec ? `.${dec}` : "");
}

function date(value) {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value));
	if (!m) return esc(value);
	return `${m[3]}-${m[2]}-${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}`;
}

const SYS = { float_precision: "3", currency_precision: "", number_format: "#,###.##" };

function format(value, df = {}, options = {}) {
	if (value === null || value === undefined || value === "") return "";
	const ft = df.fieldtype;
	// frappe.form.formatters._right: numbers outside inline mode come in a right-aligned div.
	const right = (html) => (options.inline || options.only_value ? html : `<div style="text-align: right">${html}</div>`);
	if (ft === "Currency") return right(number(value, parseInt(df.precision, 10) || parseInt(SYS.currency_precision, 10) || 2));
	if (ft === "Float" || ft === "Percent") return right(number(value, parseInt(df.precision, 10) || parseInt(SYS.float_precision, 10) || 2));
	if (ft === "Int") return right(number(value, 0));
	if (ft === "Date") return date(value);
	if (ft === "Datetime") return date(value);
	if (ft === "Link" && df.link_onclick) {
		return `<a onclick="${esc(df.link_onclick)}; return false;" href="#">${esc(value)}</a>`;
	}
	if (ft === "Link" && df.options && !options.only_value) {
		return `<a href="/desk/${esc(String(df.options).toLowerCase().replace(/ /g, "-"))}/${encodeURIComponent(value)}">${esc(__(value))}</a>`;
	}
	if (ft === "Select") return esc(__(value));
	return esc(value);
}

// ---- controls (DOM of frappe/public/js/frappe/form/controls/*.js) ----
// frappe.ui.Dialog: a plain modal with the HTML field, the title and the two actions.
class Dialog {
	constructor({ title, fields, primary_action_label, primary_action, secondary_action_label, secondary_action }) {
		const el = document.createElement("div");
		el.className = "rv-test-dialog";
		el.style.cssText = "position:fixed;inset:40px 15%;z-index:100000;background:#fff;border:1px solid #ccc;border-radius:8px;padding:16px;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.2)";
		el.innerHTML = `<div class="modal-title" style="font-weight:600;margin-bottom:12px">${title}</div><div class="modal-body"></div>
			<div class="modal-footer" style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
				<button type="button" class="btn btn-secondary btn-modal-secondary">${secondary_action_label || ""}</button>
				<button type="button" class="btn btn-primary btn-modal-primary">${primary_action_label || ""}</button></div>`;
		this.$wrapper = $(el);
		this.fields_dict = {};
		const body = el.querySelector(".modal-body");
		for (const f of fields || []) {
			const w = document.createElement("div");
			body.appendChild(w);
			if (f.fieldtype === "HTML" || !f.fieldtype) {
				this.fields_dict[f.fieldname] = { $wrapper: $(w) };
				continue;
			}
			// a field of a form dialog (the print presets' dialogs): its label and Frappe's control
			if (f.fieldtype !== "Check") w.insertAdjacentHTML("beforeend", `<label class="control-label">${esc(f.label || "")}</label>`);
			const control = new Control({ df: f, parent: w });
			control.make_input();
			if (f.default !== undefined) control.set_input(f.default);
			this.fields_dict[f.fieldname] = control;
		}
		this.get_values = () => {
			const out = {};
			for (const [k, c] of Object.entries(this.fields_dict)) if (c.get_value) out[k] = c.get_value();
			return out;
		};
		el.querySelector(".btn-modal-primary").addEventListener("click", () => primary_action(this.get_values()));
		el.querySelector(".btn-modal-secondary").addEventListener("click", () => secondary_action());
	}
	show() {
		document.body.appendChild(this.$wrapper.get(0));
	}
	hide() {
		this.$wrapper.get(0).remove();
	}
}

class Control {
	constructor({ df, parent, only_input }) {
		this.df = df;
		this.parent = parent;
		this.only_input = only_input;
		this.value = null;
		this.make();
	}
	make() {
		const ft = this.df.fieldtype;
		if (ft === "Check") {
			this.$wrapper = $(`<div class="form-group frappe-control" data-fieldtype="Check" data-fieldname="${esc(this.df.fieldname)}">
				<div class="checkbox"><label><span class="input-area"></span><span class="disp-area"></span>
				<span class="label-area">${esc(__(this.df.label))}</span><span class="ml-1 help"></span></label>
				<p class="help-box small text-extra-muted"></p></div></div>`).appendTo(this.parent);
			this.input_area = this.$wrapper.find(".input-area").get(0);
		} else {
			this.$wrapper = $(`<div class="form-group frappe-control input-max-width" data-fieldtype="${esc(ft)}" data-fieldname="${esc(this.df.fieldname)}"></div>`).appendTo(this.parent);
			this.input_area = this.$wrapper.get(0);
		}
		this.wrapper = this.$wrapper.get(0);
	}
	refresh() {
		if (!this.$input) this.make_input();
	}
	make_input() {
		const ft = this.df.fieldtype;
		const cls = `input-with-feedback form-control ${this.df.input_class || ""}`;
		if (ft === "Check") {
			this.$input = $('<input type="checkbox" autocomplete="off" class="input-with-feedback">').prependTo(this.input_area);
			this.$input.on("change", () => this.changed(this.$input.prop("checked") ? 1 : 0));
		} else if (ft === "Select") {
			const opts = Array.isArray(this.df.options) ? this.df.options : String(this.df.options || "").split("\n").map((o) => ({ value: o, label: __(o) }));
			this.$input = $(`<select class="${cls} ellipsis">${opts.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("")}</select>`).prependTo(this.input_area);
			this.$wrapper.append(`<div class="select-icon xs"><svg class="icon icon-xs" style=""><use href="#icon-select"></use></svg></div>`);
			this.$placeholder = $(`<div class="placeholder ellipsis text-extra-muted xs"><span>${esc(__(this.df.placeholder || ""))}</span></div>`).appendTo(this.$wrapper);
			this.$input.on("change", () => this.changed(this.$input.val()));
		} else if (ft === "Link") {
			const box = $(`<div class="link-field ui-front" style="position: relative;"><input type="text" class="${cls}"><span class="link-btn"></span></div>`).prependTo(this.input_area);
			this.$input = box.find("input");
			this.$input.on("change", () => this.changed(this.$input.val()));
		} else if (ft === "MultiSelectList") {
			// As on the site (Frappe 16): input_class lands on the list's wrapper, not its box.
			this.$list = $(`<div class="multiselect-list dropdown ${this.df.input_class || ""}"><div class="form-control cursor-pointer input-xs" tabindex="0"><div class="status-text ellipsis"></div></div></div>`).prependTo(this.input_area);
			this.$input = $("<input>");
			this.value = [];
			this.update_status();
		} else {
			this.$input = $(`<input type="text" autocomplete="off" class="${cls}">`).prependTo(this.input_area);
			this.$input.on("change", () => this.changed(this.$input.val()));
		}
		this.input = this.$input.get(0);
	}
	update_status() {
		const labels = (this.value || []).map((v) => (this.df.get_data?.() || []).find((o) => o.value === v)?.label || v);
		this.$list.find(".status-text").html(labels.length ? esc(labels.join(", ")) : `<span class="text-extra-muted">${this.df.placeholder || ""}</span>`);
	}
	changed(v) {
		this.value = v;
		this.toggle_placeholder();
		this.df.onchange && this.df.onchange();
	}
	toggle_placeholder() {
		if (this.$placeholder) this.$placeholder.toggle(!this.value);
	}
	display(v) {
		const ft = this.df.fieldtype;
		if (ft === "Check") this.$input.prop("checked", Boolean(v));
		else if (ft === "MultiSelectList") this.update_status();
		else if (ft === "Date") this.$input.val(v ? date(v) : "");
		else this.$input.val(v ?? "");
		this.toggle_placeholder();
	}
	set_input(v) {
		this.value = v;
		this.display(v);
	}
	set_value(v) {
		this.value = v;
		this.display(v);
		this.df.onchange && this.df.onchange();
		return Promise.resolve();
	}
	get_value() {
		return this.value;
	}
}

window.frappe = {
	boot: { lang: LANG, sysdefaults: SYS, developer_mode: 0 },
	// the session's translations (the pages look up the msgid of a translated label there)
	_messages: MESSAGES,
	session: { user: "rv_admin@rv.test", user_fullname: "RV Admin" },
	defaults: { get_default: () => null },
	utils: {
		is_rtl: () => LANG === "ar",
		escape_html: esc,
		html2text: (s) => String(s ?? "").replace(/<[^>]*>/g, ""),
		// frappe.utils.shorten_number with the default number system (axis ticks of charts).
		shorten_number(number, country, min_length = 4, max_no_of_decimals = 2) {
			if (!number || isNaN(number)) return "";
			if ((String(number).match(/\d/g)?.length || 0) < min_length) return number.toString();
			const x = Math.abs(Math.round(number));
			if (x.toString().length < min_length) return x.toString();
			for (const [divisor, symbol] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
				if (x < divisor) continue;
				const r = number / divisor;
				const decimals = Math.floor(r) === r ? 0 : String(r).split(".")[1].length;
				return `${decimals > max_no_of_decimals ? r.toFixed(max_no_of_decimals) : r} ${__(symbol, null, "Number system")}`;
			}
			return number.toFixed(max_no_of_decimals);
		},
	},
	sys_defaults: { country: "Saudi Arabia" },
	format,
	unscrub: (t) =>
		String(t || "")
			.replace(/-|_/g, " ")
			.split(" ")
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(" "),
	ui: { form: { make_control: (opts) => new Control(opts) }, Dialog },
	// Frappe user settings kept in memory for the page's life.
	model: {
		user_settings: {
			store: {},
			get(doctype) {
				return Promise.resolve(this.store[doctype] || {});
			},
			save(doctype, key, value) {
				this.store[doctype] = { ...(this.store[doctype] || {}), [key]: value };
				return Promise.resolve(this.store[doctype]);
			},
		},
	},
	dom: { eval() {}, remove_script_and_style: (s) => s },
	datetime: {
		now_datetime: () => "2026-10-01 10:42:00",
		get_today: () => "2026-10-01",
		get_user_date_fmt: () => "dd-mm-yyyy",
		get_first_day_of_the_week_index: () => 0,
		str_to_user: (v) => (v ? date(v) : ""),
		user_to_str: (v) => {
			const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$/.exec(String(v || ""));
			return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "Invalid date";
		},
	},
	// Fiscal years a user may read (frappe.client.get_list on the site).
	db: {
		get_list: (doctype) =>
			Promise.resolve(
				doctype === "Fiscal Year"
					? ["2024", "2025", "2026", "2027"].map((y) => ({ name: y, year_start_date: `${y}-01-01`, year_end_date: `${y}-12-31` }))
					: []
			),
	},
	after_ajax: (fn) => fn(),
	query_reports: {},
	route_options: null,
	get_route: () => ["report-view", window.RV_REPORT],
	// ?built=1: a bundle the page asks for is loaded from what `bench build` wrote; from the
	// sources every bundle is already part of the harness.
	require(name) {
		if (!window.rv_built || typeof name !== "string") return Promise.resolve();
		return fetch("/assets/assets.json")
			.then((r) => r.json())
			.then(
				(assets) =>
					new Promise((resolve, reject) => {
						const el = document.createElement("script");
						el.src = assets[name];
						el.onload = resolve;
						el.onerror = reject;
						document.body.appendChild(el);
					})
			);
	},
	show_alert() {},
	// frappe.confirm: the harness answers yes at once
	confirm(message, yes) {
		window.rv_confirmed = message;
		yes && yes();
	},
	msgprint() {},
	breadcrumbs: { add() {} },
	csrf_token: "",
	provide(ns) {
		let o = window;
		for (const part of ns.split(".")) o = o[part] ||= {};
		return o;
	},
	// The answer comes in a task of its own, as a response from the server does: the page's
	// work on it is not merged with the harness's own setup in one long task.
	call({ method, args, callback }) {
		setTimeout(() => Promise.resolve(window.RV_SERVER(method, args)).then((message) => callback({ message })), 0);
	},
};
