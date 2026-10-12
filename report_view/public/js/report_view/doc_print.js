// The document print page (ADR-017): /desk/rv-print/<doctype>/<name>. A document's print
// format, rendered by Frappe exactly as its print page renders it, laid out in the pages of
// Report View (views/pages_view.js, document mode): paper and margins, letter head, print
// heading, footer, numbering, signature, border, watermark, language; printed from here
// or sent to the server's PDF engine (the same sheets, ADR-016).

import { PagesView } from "./views/pages_view.js";
import { esc } from "./util.js";

const SAVE_MS = 800;
const call = (method, args, type = "GET") => frappe.call({ method, args, type }).then((r) => r.message);

class DocPrintPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this.rtl = Boolean(frappe.utils.is_rtl?.());
		this.make_dom();
		this.fit_height = this.fit_height.bind(this);
		window.addEventListener("resize", this.fit_height);
	}

	make_dom() {
		const root = document.createElement("div");
		root.className = "rv rv-mode-pages rv-docprint";
		root.dir = this.rtl ? "rtl" : "ltr";
		root.innerHTML = `<div class="rv-pages"></div>`;
		this.page.main.get(0).replaceChildren(root);
		this.root = root;
		this.pages = new PagesView({ parent: root.querySelector(".rv-pages"), root, rtl: this.rtl, host: this });
		this.page.set_secondary_action(__("Back to the document"), () => frappe.set_route("Form", this.doctype, this.name), "arrow-left");
		this.page.add_menu_item(__("Frappe's print page"), () => frappe.set_route("print", this.doctype, this.name));
		this.page.add_menu_item(__("Print Settings"), () => frappe.set_route("Form", "Print Settings"));
	}

	fit_height() {
		const top = this.root.getBoundingClientRect().top + window.scrollY;
		this.root.style.height = `${Math.max(420, window.innerHeight - top - 12)}px`;
	}

	show() {
		const route = frappe.get_route();
		const doctype = route[1];
		const name = route.slice(2).join("/");
		if (!doctype || !name) {
			this.root.querySelector(".rv-pages").innerHTML = `<p class="rv-zone-empty">${esc(__("Open a document, then «Advanced Print».", null, "Report View"))}</p>`;
			return;
		}
		this.fit_height();
		if (doctype === this.doctype && name === this.name) return;
		this.doctype = doctype;
		this.name = name;
		this.options = null;
		this.page.set_title(`${__(doctype)} ${name}`);
		this.pages.prefetched = null;
		this.pages.pending = null;
		this.pages.settings_report = null;
		this.pages.options_report = null;
		this.pages.formats.clear();
		this.pages.parts.clear();
		this.pages.letterheads.clear();
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

	// settings: one set per user and doctype
	settings_key() {
		return `Report View Print:${this.doctype}`;
	}

	async pages_settings_load() {
		if (!frappe.model?.user_settings?.get) return null;
		try {
			return (await frappe.model.user_settings.get(this.settings_key()))?.pages || null;
		} catch {
			return null;
		}
	}

	pages_settings_save(settings) {
		if (!frappe.model?.user_settings?.save) return;
		clearTimeout(this._save);
		const key = this.settings_key();
		this._save = setTimeout(() => frappe.model.user_settings.save(key, "pages", settings), SAVE_MS);
	}
}

frappe.provide("report_view");
Object.assign(window.report_view, { DocPrintPage });
