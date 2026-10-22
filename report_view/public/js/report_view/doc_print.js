// The document print page (ADR-017): /desk/rv-print/<doctype>/<name>. A document's print
// format, rendered by Frappe exactly as its print page renders it, laid out in the pages of
// Report View (views/pages_view.js, document mode): paper and margins, letter head, print
// heading, footer, numbering, signature, border, watermark, language; printed from here
// or sent to the server's PDF engine (the same sheets, ADR-016).
//
// The same page prints a Custom print format with the caller's data (ADR-019):
// /desk/rv-print/Custom/<token> (data staged by report_view.print) or
// /desk/rv-print/Custom/<format>?method=…&args=… (the data of a whitelisted method, called
// here from the browser, so its own checks apply). The template is a saved Custom format,
// or one sent with the data (html + css, staged with it: «Sent template»).

import { PagesView } from "./views/pages_view.js";
import { error_text } from "./api.js";
import { load_user_settings, settings_saver } from "./util.js";
import { CUSTOM, TOKEN, METHOD, OPTION_KEYS } from "./custom_print_rules.js";
const call = (method, args, type = "GET") => frappe.call({ method, args, type }).then((r) => r.message);

class DocPrintPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this.rtl = Boolean(frappe.utils.is_rtl?.());
		this.custom = new CustomPrintHost(this);
		// the user's print settings, saved after a burst of changes, flushed when the page is left
		this.saver = settings_saver();
		this.make_dom();
		this.fit_height = this.fit_height.bind(this);
		// the window's size is listened to while the page is shown
		this.listen(true);
		$(wrapper).on("hide", () => this.hide());
	}

	listen(on) {
		if (Boolean(this.listening) === on) return;
		this.listening = on;
		if (on) window.addEventListener("resize", this.fit_height);
		else window.removeEventListener("resize", this.fit_height);
	}

	/** Leaving the page: nothing listens, a change of the settings just made is saved now. */
	hide() {
		this.listen(false);
		return this.saver.flush();
	}

	make_dom() {
		const root = document.createElement("div");
		root.className = "rv rv-mode-pages rv-docprint";
		root.dir = this.rtl ? "rtl" : "ltr";
		this.page.main.get(0).replaceChildren(root);
		this.root = root;
		this.use_mode("document");
	}

	/** The pages of a document (this page is their host) or of a Custom print (ADR-019). */
	use_mode(kind) {
		if (this.kind === kind) return;
		this.kind = kind;
		this.doctype = this.name = this.custom_key = null;
		this.pages?.release();
		const parent = document.createElement("div");
		parent.className = "rv-pages";
		this.root.replaceChildren(parent);
		this.pages = new PagesView({ parent, root: this.root, rtl: this.rtl, host: kind === "custom" ? this.custom : this });
		this.page.clear_secondary_action();
		this.page.clear_menu();
		if (kind === "custom") {
			this.page.set_secondary_action(__("Back"), () => (window.history.length > 1 ? window.history.back() : frappe.set_route("")), "arrow-left");
			if (frappe.model.can_write("Print Format")) {
				this.page.add_menu_item(__("Edit the print format"), () => {
					const name = this.custom.current_format();
					if (name) frappe.set_route("Form", "Print Format", name);
					else frappe.msgprint(__("This print uses the template it was sent with; it is not a saved print format."));
				});
			}
			return;
		}
		this.page.set_secondary_action(__("Back to the document"), () => frappe.set_route("Form", this.doctype, this.name), "arrow-left");
		this.page.add_menu_item(__("Frappe's print page"), () => frappe.set_route("print", this.doctype, this.name));
		this.page.add_menu_item(__("Print Settings"), () => frappe.set_route("Form", "Print Settings"));
	}

	fit_height() {
		const top = this.root.getBoundingClientRect().top + window.scrollY;
		this.root.style.height = `${Math.max(420, window.innerHeight - top - 12)}px`;
	}

	/** Every part of the pages loaded before is dropped: another document, other data. */
	reset_pages() {
		this.pages.prefetched = null;
		this.pages.pending = null;
		this.pages.settings_report = null;
		this.pages.options_report = null;
		this.pages.formats.clear();
		this.pages.parts.clear();
		this.pages.letterheads.clear();
	}

	show() {
		this.listen(true);
		const route = frappe.get_route();
		if (route[1] === CUSTOM) return this.show_custom(route.slice(2).join("/"));
		const doctype = route[1];
		const name = route.slice(2).join("/");
		this.use_mode("document");
		if (!doctype || !name) {
			this.pages.note(__("Open a document, then «Advanced Print».", null, "Report View"), true);
			return;
		}
		this.fit_height();
		if (doctype === this.doctype && name === this.name) return;
		this.doctype = doctype;
		this.name = name;
		this.options = null;
		this.page.set_title(`${__(doctype)} ${name}`);
		this.reset_pages();
		this.pages.show_document().catch((e) => this.pages.note(error_text(e), true));
	}

	/** A Custom print: its token, or its format and the method of its data. */
	async show_custom(key) {
		// asked again by report_view.print (route options): the data is read again
		const asked = Boolean(frappe.route_options && Object.keys(frappe.route_options).length);
		const params = custom_params(key);
		const sig = JSON.stringify(params);
		this.use_mode("custom");
		this.fit_height();
		if (sig === this.custom_key && !asked) return;
		this.custom_key = sig;
		// the address says what is printed (and can be kept: a method's data is live)
		const url = custom_url(key, params);
		if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(window.history.state, "", url);
		this.reset_pages();
		this.page.set_title(__("Advanced Print"));
		this.pages.busy(__("Loading the data to print…"));
		try {
			await this.custom.load(params);
		} catch (e) {
			if (this.custom_key !== sig) return;
			this.pages.busy(null);
			this.pages.note(error_text(e) || __("The data to print could not be loaded"), true);
			return;
		}
		if (this.custom_key !== sig) return;
		this.page.set_title(this.custom.title);
		this.pages.show_document().catch((e) => this.pages.note(error_text(e), true));
	}

	// ------------------------------------------------------------ the host of the pages

	/** What the pages print around the format: the document, its company. */
	pages_context() {
		return {
			report_name: `${__(this.doctype)} ${this.name}`,
			company: this.options?.company || null,
			filters: {},
			defs: [],
			group_labels: [],
			doc: { doctype: this.doctype, name: this.name },
		};
	}

	async pages_options() {
		this.options = await call("report_view.api.document.get_doc_print_options", { doctype: this.doctype, name: this.name });
		return this.options;
	}

	pages_letterhead(name) {
		return call("report_view.api.document.render_doc_letterhead", { doctype: this.doctype, name: this.name, letterhead: name });
	}

	/** The document's print format ("" = the doctype's default), in the language of the pages. */
	pages_format(name, lang = null) {
		return call("report_view.api.document.render_doc_print", { doctype: this.doctype, name: this.name, print_format: name || null, ...(lang ? { _lang: lang } : {}) });
	}

	pages_part(kind, name, lang = null) {
		const args = { doctype: this.doctype, name: this.name, ...(lang ? { _lang: lang } : {}) };
		if (kind === "heading") return call("report_view.api.document.render_doc_heading", { ...args, heading: name }, "POST");
		return call("report_view.api.document.render_doc_signature", { ...args, signature: name }, "POST");
	}

	pages_translations(lang, messages) {
		return call("report_view.api.document.get_doc_translations", { doctype: this.doctype, name: this.name, lang, messages }, "POST");
	}

	pages_run_lang() {
		return Promise.resolve(null);
	}

	/** The PDF of the pages (ADR-016): the server's engine prints these very sheets. */
	pages_pdf_target() {
		return { method: "report_view.api.pdf.pages_pdf_document", args: { doctype: this.doctype, name: this.name } };
	}

	/** The print presets (ADR-020): those of this document type and of every one. */
	pages_preset_target() {
		return { context: "Document", target: this.doctype };
	}

	// settings: one set per user and doctype
	settings_key() {
		return `Report View Print:${this.doctype}`;
	}

	pages_settings_load() {
		return load_user_settings(this.settings_key(), "pages");
	}

	pages_settings_save(settings) {
		this.saver.save(this.settings_key(), "pages", settings);
	}
}

// ---------------------------------------------------------------- a Custom print (ADR-019)

/**
 * What the address of a Custom print asks for: a staged print's token, or a format with
 * the method of its data, and the choices of the pages. Read from frappe.route_options when
 * report_view.print routed here, else from the address itself.
 */
function custom_params(key) {
	const ro = frappe.route_options || {};
	frappe.route_options = null;
	const query = new URLSearchParams(window.location.search);
	const get = (k) => {
		const v = ro[k] ?? query.get(k);
		return v === undefined || v === null || v === "" ? null : v;
	};
	const method = get("method");
	if (!method && TOKEN.test(key)) return { token: key };
	const options = {};
	for (const k of OPTION_KEYS) if (typeof get(k) === "string") options[k] = get(k);
	let args = get("args");
	if (args && typeof args !== "string") args = JSON.stringify(args);
	const title = typeof get("title") === "string" ? get("title") : null;
	return { format: key, method: typeof method === "string" ? method : null, args, title, options };
}

function custom_url(key, params) {
	const path = `/desk/rv-print/${CUSTOM}/${encodeURIComponent(key)}`;
	if (params.token) return path;
	const q = new URLSearchParams();
	if (params.method) q.set("method", params.method);
	if (params.args) q.set("args", params.args);
	if (params.title) q.set("title", params.title);
	for (const [k, v] of Object.entries(params.options || {})) q.set(k, v);
	const qs = q.toString();
	return qs ? `${path}?${qs}` : path;
}

/**
 * The host of the pages for a Custom print format: the data comes from the caller (staged
 * under a token) or from a whitelisted method the browser calls; the server renders the
 * format with it (report_view.api.custom_print).
 */
class CustomPrintHost {
	constructor(page) {
		this.page = page;
	}

	/** The data of the print, staged once: every render then reads it by its token. */
	async load({ token, format, method, args, title, options }) {
		this.token = this.format = this.company = this.options = null;
		this.inline = false;
		this.choices = {};
		if (token) {
			const r = await call("report_view.api.custom_print.staged", { token });
			this.token = token;
			// a sent template (r.inline) has no format: "" of the picker is it
			this.format = r.print_format || null;
			this.inline = Boolean(r.inline);
			this.title = r.title || (this.format ? __(this.format) : __("Sent template"));
			this.choices = r.options || {};
			this.company = company_of(r.data);
			return;
		}
		if (!format) throw new Error(__("Name the print format to print with."));
		let data = {};
		if (method) {
			if (!METHOD.test(method)) throw new Error(__("Invalid data method"));
			let parsed;
			try {
				parsed = args ? JSON.parse(args) : {};
			} catch {
				throw new Error(__("The arguments of the data method are not valid JSON"));
			}
			// GET: Frappe commits nothing for it, and a method that changes data refuses it
			data = (await call(method, parsed, "GET")) ?? {};
		}
		const r = await call("report_view.api.custom_print.stage", { print_format: format, data: JSON.stringify(data), title, ...options }, "POST");
		this.token = r.token;
		this.format = format;
		this.title = title || __(format);
		this.choices = options || {};
		this.company = company_of(data);
	}

	/** The format chosen on the panel, else the caller's (null: the sent template). */
	current_format() {
		return this.page.pages?.settings?.template || this.format;
	}

	/** What the server renders with: a saved format, and the staged print's token. */
	source(name = this.current_format()) {
		return { ...(name ? { print_format: name } : {}), token: this.token };
	}

	pages_context() {
		return {
			report_name: this.title,
			company: this.company || this.options?.company || null,
			filters: {},
			defs: [],
			group_labels: [],
			doc: { doctype: CUSTOM, name: this.token },
		};
	}

	async pages_options(company) {
		this.options = await call("report_view.api.custom_print.get_options", { ...this.source(this.format), ...(company ? { company } : {}) });
		return this.options;
	}

	pages_letterhead(name) {
		const company = this.company || this.options?.company;
		return call("report_view.api.custom_print.render_letterhead", { ...this.source(this.format), letterhead: name, ...(company ? { company } : {}) });
	}

	/** The format ("" = the caller's, or the sent template) rendered with the data, in the language of the pages. */
	pages_format(name, lang = null) {
		return call("report_view.api.custom_print.render", { ...this.source(name || this.format), title: this.title, ...(lang ? { lang } : {}) }, "POST");
	}

	pages_part(kind, name, lang = null) {
		const args = { ...this.source(), title: this.title, ...(lang ? { lang } : {}) };
		if (kind === "heading") return call("report_view.api.custom_print.render_heading", { ...args, heading: name }, "POST");
		return call("report_view.api.custom_print.render_signature", { ...args, signature: name }, "POST");
	}

	pages_translations(lang, messages) {
		return call("report_view.api.custom_print.get_translations", { ...this.source(this.format), lang, messages }, "POST");
	}

	pages_run_lang() {
		return Promise.resolve(null);
	}

	pages_pdf_target() {
		// a sent template: its token (its user's only) is the PDF's guard
		const name = this.current_format();
		return { method: "report_view.api.pdf.pages_pdf_custom", args: name ? { print_format: name } : { token: this.token } };
	}

	/** The print presets (ADR-020): those of the caller's Custom format and of every one
	 * (a sent template: an empty target, the general presets). */
	pages_preset_target() {
		return { context: "Custom", target: this.format || "" };
	}

	// settings: one set per user and Custom format; the caller's format and choices first
	settings_key() {
		return `Report View Print:${CUSTOM}:${this.format || "Sent template"}`;
	}

	async pages_settings_load() {
		const saved = await load_user_settings(this.settings_key(), "pages");
		const choices = this.choices || {};
		if (!saved && !Object.keys(choices).length) return null;
		const out = { ...(saved || {}), ...choices };
		delete out.template;
		if (choices.signature) out.signatures = true;
		return out;
	}

	pages_settings_save(settings) {
		this.page.saver.save(this.settings_key(), "pages", settings);
	}
}

function company_of(data) {
	return data && typeof data === "object" && !Array.isArray(data) && typeof data.company === "string" && data.company ? data.company : null;
}

frappe.provide("report_view");
Object.assign(window.report_view, { DocPrintPage, CustomPrintHost });
