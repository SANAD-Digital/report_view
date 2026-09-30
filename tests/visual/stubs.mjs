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

window.__ = function (text, replace) {
	let out = MESSAGES[text] ?? String(text ?? "");
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
	if (ft === "Currency") return number(value, parseInt(df.precision, 10) || parseInt(SYS.currency_precision, 10) || 2);
	if (ft === "Float" || ft === "Percent") return number(value, parseInt(df.precision, 10) || parseInt(SYS.float_precision, 10) || 2);
	if (ft === "Int") return number(value, 0);
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
			const opts = String(this.df.options || "").split("\n");
			this.$input = $(`<select class="${cls} ellipsis">${opts.map((o) => `<option value="${esc(o)}">${esc(__(o))}</option>`).join("")}</select>`).prependTo(this.input_area);
			this.$wrapper.append(`<div class="select-icon xs"><svg class="icon icon-xs" style=""><use href="#icon-select"></use></svg></div>`);
			this.$placeholder = $(`<div class="placeholder ellipsis text-extra-muted xs"><span>${esc(__(this.df.placeholder || ""))}</span></div>`).appendTo(this.$wrapper);
			this.$input.on("change", () => this.changed(this.$input.val()));
		} else if (ft === "Link") {
			const box = $(`<div class="link-field ui-front" style="position: relative;"><input type="text" class="${cls}"><span class="link-btn"></span></div>`).prependTo(this.input_area);
			this.$input = box.find("input");
			this.$input.on("change", () => this.changed(this.$input.val()));
		} else if (ft === "MultiSelectList") {
			this.$list = $(`<div class="multiselect-list dropdown"><div class="form-control cursor-pointer input-xs ${this.df.input_class || ""}" tabindex="0"><div class="status-text ellipsis"></div></div></div>`).prependTo(this.input_area);
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
	utils: {
		is_rtl: () => LANG === "ar",
		escape_html: esc,
		html2text: (s) => String(s ?? "").replace(/<[^>]*>/g, ""),
	},
	format,
	unscrub: (t) =>
		String(t || "")
			.replace(/-|_/g, " ")
			.split(" ")
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(" "),
	ui: { form: { make_control: (opts) => new Control(opts) } },
	dom: { eval() {}, remove_script_and_style: (s) => s },
	datetime: { now_datetime: () => "2026-10-01 10:42:00" },
	after_ajax: (fn) => fn(),
	query_reports: {},
	route_options: null,
	get_route: () => ["report-view", window.RV_REPORT],
	require: () => Promise.resolve(),
	show_alert() {},
	msgprint() {},
	breadcrumbs: { add() {} },
	csrf_token: "",
	provide(ns) {
		let o = window;
		for (const part of ns.split(".")) o = o[part] ||= {};
		return o;
	},
	call({ method, args, callback }) {
		Promise.resolve(window.RV_SERVER(method, args)).then((message) => callback({ message }));
	},
};
