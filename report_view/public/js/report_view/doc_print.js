// The document print page (ADR-017): /desk/rv-print/<doctype>/<name>. A document's print
// format, rendered by Frappe exactly as its print page renders it, laid out in the pages of
// Report View (views/pages_view.js, document mode): paper and margins, letter head, print
// heading, footer, numbering, signature, border, watermark, language; printed from here
// or sent to the server's PDF engine (the same sheets, ADR-016).
//
// The same page prints a Custom print format with the caller's data (ADR-019):
// /desk/rv-print/Custom/<token> (data staged by report_view.print) or
// /desk/rv-print/Custom/<format>?method=…&args=… (the data of a whitelisted method, called
// here from the browser, so its own checks apply).

import { PagesView } from "./views/pages_view.js";

const SAVE_MS = 800;
const CUSTOM = "Custom";
const TOKEN = /^[a-f0-9]{24}$/;
const METHOD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;
const OPTION_KEYS = ["letter_head", "lang", "heading", "signature"];
const call = (method, args, type = "GET") => frappe.call({ method, args, type }).then((r) => r.message);

class DocPrintPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this.rtl = Boolean(frappe.utils.is_rtl?.());
		this.custom = new CustomPrintHost(this);
		this.make_dom();
		this.fit_height = this.fit_height.bind(this);
		window.addEventListener("resize", this.fit_height);
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
		this.pages?.destroy();
		const parent = document.createElement("div");
		parent.className = "rv-pages";
		this.root.replaceChildren(parent);
		this.pages = new PagesView({ parent, root: this.root, rtl: this.rtl, host: kind === "custom" ? this.custom : this });
		this.page.clear_secondary_action();
		this.page.clear_menu();
		if (kind === "custom") {
			this.page.set_secondary_action(__("Back"), () => (window.history.length > 1 ? window.history.back() : frappe.set_route("")), "arrow-left");
			if (frappe.model.can_write("Print Format")) {
				this.page.add_menu_item(__("Edit the print format"), () => this.custom.format && frappe.set_route("Form", "Print Format", this.custom.current_format()));
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
		this.pages.show_document().catch((e) => this.pages.note(e.message || String(e), true));
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
		this.pages.show_document().catch((e) => this.pages.note(e.message || String(e), true));
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
		return load_settings(this.settings_key());
	}

	pages_settings_save(settings) {
		save_settings(this, this.settings_key(), settings);
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
		this.choices = {};
		if (token) {
			const r = await call("report_view.api.custom_print.staged", { token });
			this.token = token;
			this.format = r.print_format;
			this.title = r.title || __(r.print_format);
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

	/** The format chosen on the panel, else the caller's. */
	current_format() {
		return this.page.pages?.settings?.template || this.format;
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
		this.options = await call("report_view.api.custom_print.get_options", { print_format: this.format, ...(company ? { company } : {}) });
		return this.options;
	}

	pages_letterhead(name) {
		const company = this.company || this.options?.company;
		return call("report_view.api.custom_print.render_letterhead", { print_format: this.format, letterhead: name, ...(company ? { company } : {}) });
	}

	/** The format ("" = the caller's) rendered with the data, in the language of the pages. */
	pages_format(name, lang = null) {
		return call("report_view.api.custom_print.render", { print_format: name || this.format, token: this.token, title: this.title, ...(lang ? { lang } : {}) }, "POST");
	}

	pages_part(kind, name, lang = null) {
		const args = { print_format: this.current_format(), token: this.token, title: this.title, ...(lang ? { lang } : {}) };
		if (kind === "heading") return call("report_view.api.custom_print.render_heading", { ...args, heading: name }, "POST");
		return call("report_view.api.custom_print.render_signature", { ...args, signature: name }, "POST");
	}

	pages_translations(lang, messages) {
		return call("report_view.api.custom_print.get_translations", { print_format: this.format, lang, messages }, "POST");
	}

	pages_run_lang() {
		return Promise.resolve(null);
	}

	pages_pdf_target() {
		return { method: "report_view.api.pdf.pages_pdf_custom", args: { print_format: this.current_format() } };
	}

	/** The print presets (ADR-020): those of the caller's Custom format and of every one. */
	pages_preset_target() {
		return { context: "Custom", target: this.format };
	}

	// settings: one set per user and Custom format; the caller's format and choices first
	settings_key() {
		return `Report View Print:${CUSTOM}:${this.format}`;
	}

	async pages_settings_load() {
		const saved = await load_settings(this.settings_key());
		const choices = this.choices || {};
		if (!saved && !Object.keys(choices).length) return null;
		const out = { ...(saved || {}), ...choices };
		delete out.template;
		if (choices.signature) out.signatures = true;
		return out;
	}

	pages_settings_save(settings) {
		save_settings(this, this.settings_key(), settings);
	}
}

/** The server's message of a failed call (Frappe shows it in its dialog too), or the error's. */
function error_text(e) {
	let text = e instanceof Error ? e.message : "";
	try {
		const msgs = JSON.parse(e?.responseJSON?._server_messages || e?._server_messages || "[]");
		text = msgs.map((m) => JSON.parse(m).message).join(" ") || text;
	} catch {
		// not a server's answer
	}
	// text only: an inert document reads it (no image or handler of it runs)
	return text ? new DOMParser().parseFromString(text, "text/html").body.textContent.trim() : "";
}

function company_of(data) {
	return data && typeof data === "object" && !Array.isArray(data) && typeof data.company === "string" && data.company ? data.company : null;
}

async function load_settings(key) {
	if (!frappe.model?.user_settings?.get) return null;
	try {
		return (await frappe.model.user_settings.get(key))?.pages || null;
	} catch {
		return null;
	}
}

function save_settings(owner, key, settings) {
	if (!frappe.model?.user_settings?.save) return;
	clearTimeout(owner._save);
	owner._save = setTimeout(() => frappe.model.user_settings.save(key, "pages", settings), SAVE_MS);
}

frappe.provide("report_view");
Object.assign(window.report_view, { DocPrintPage, CustomPrintHost });
