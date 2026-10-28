// The host interface of the Pages view (ADR-014) on the report page: what the pages print
// around the table, the report's print formats, headings and signatures, the PDF and preset
// targets, another language and the user's page settings. The other hosts are DocPrintPage
// and CustomPrintHost (doc_print.js). Methods of ReportViewPage (installed by index.js).

import { api } from "../api.js";
import { normalize_async } from "../adapter/normalize.js";
import { load_user_settings } from "../util.js";

export class PagesHost {
	/** What the pages print around the table: the report, its criteria and the company. */
	pages_context() {
		const host = this;
		const company = this.last_filters?.company || frappe.defaults?.get_default?.("company") || null;
		return {
			report_name: this.report_name,
			company: company ? String(company) : null,
			filters: this.last_filters || {},
			defs: this.report_settings?.filters || [],
			group_labels: (this.state?.group?.by || []).map((k) => this.controls.title(k)),
			// read by a report print format only (query_report.raw_data): rebuilt then
			get raw() {
				return host.raw_data();
			},
			report_settings: this.report_settings,
		};
	}

	pages_options(company) {
		return api.get_print_options(this.report_name, company);
	}

	pages_letterhead(name) {
		const ctx = this.pages_context();
		return api.render_letterhead(name, { ...ctx.filters, company: ctx.filters.company || ctx.company });
	}

	/** A report print format: a JS template as it is, a Jinja one rendered by the server (with
	 * the values of its variables, ADR-024). */
	async pages_format(name, lang = null, type = null, view_columns = null, variables = null) {
		// a Jinja format known from the options is rendered at once (one request, not two)
		const format = type === "Jinja" ? { type } : await api.get_print_format(this.report_name, name);
		if (format.type !== "Jinja") return format;
		const meta = (this.report_settings?.filters || []).map((df) => ({ fieldname: df.fieldname, label: __(df.label || ""), fieldtype: df.fieldtype }));
		return api.render_print_format(this.report_name, name, this.last_filters, this.filters.js_filters(), meta, this.prepared_report_name, lang, view_columns, variables);
	}

	/** A print heading or signature (ADR-015), rendered by the server with the filters on screen. */
	pages_part(kind, name, lang = null, view_columns = null) {
		const meta = (this.report_settings?.filters || []).map((df) => ({ fieldname: df.fieldname, label: __(df.label || ""), fieldtype: df.fieldtype }));
		const render = kind === "heading" ? api.render_print_heading : api.render_print_signature;
		return render(this.report_name, name, this.last_filters, meta, lang, view_columns);
	}

	/** The PDF of the pages (ADR-016): the server's engine prints the very sheets. */
	pages_pdf_target() {
		return { method: "report_view.api.pdf.pages_pdf_report", args: { report_name: this.report_name } };
	}

	/** The print presets of the pages (ADR-020): those of this report and of every report. */
	pages_preset_target() {
		return { context: "Report", target: this.report_name };
	}

	pages_translations(lang, messages) {
		return api.get_translations(this.report_name, lang, messages);
	}

	/**
	 * The report run again in another language (its labels and captions translated by the
	 * server), normalised like the one on screen with the captions of that language. Null
	 * when it cannot stand for the rows shown (a different result).
	 * @param {Promise<object>} pack_p the translation pack of the language
	 */
	async pages_run_lang(lang, pack_p) {
		const shown = this.report;
		const [res, pack] = await Promise.all([
			api.run(this.report_name, this.last_filters, this.filters.js_filters(), this.prepared_report_name, lang),
			pack_p,
		]);
		if (res.message?.status !== "ok" || this.report !== shown) return null;
		const report = await normalize_async(
			{
				raw: res.message.raw,
				filters: this.last_filters,
				report_settings: this.report_settings,
				register: this.config,
				server_messages: res.server_messages,
			},
			{ translate: (s) => pack?.[s] || s }
		);
		if (this.report !== shown || report.rows.length !== shown.rows.length) return null;
		for (let i = 0; i < report.rows.length; i++) if (report.rows[i].__kind !== shown.rows[i].__kind) return null;
		return report;
	}

	async pages_settings_load() {
		return (await load_user_settings(this.user_settings_key(), "pages")) || null;
	}

	pages_settings_save(settings) {
		this.pages_saver.save(this.user_settings_key(), "pages", settings);
	}
}
