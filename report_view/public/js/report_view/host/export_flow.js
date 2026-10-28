// The Excel export of the report page: the export model (docs/architecture.md §4.1), the
// request, and a large export's server job with its state next to the button.
// Methods of ReportViewPage (installed by index.js).

import { api } from "../api.js";
import { visible_columns } from "../engine/view_config.js";
import { wait_for_export, ExportJobError } from "../export_job.js";
import { esc, fmt_int, session_lang, download_blob } from "../util.js";
import { ERROR_TITLES } from "./error_titles.js";

export class ExportFlow {
	// Export model v1 (docs/architecture.md §4.1). Quick filters travel with their definitions
	// (ADR-013): the server applies the same expressions; an id with no definition is left
	// out, as the screen leaves it out (a QUICK_FILTER_UNKNOWN notice).
	export_model() {
		const cols = visible_columns(this.report, this.state);
		const defined = (this.config?.quick_filters || []).filter((q) => q && typeof q.id === "string" && typeof q.expression === "string");
		const known = new Set(defined.map((q) => q.id));
		return {
			version: 1,
			format: "xlsx",
			filters: this.last_filters,
			js_filters: this.filters.js_filters(),
			prepared_report_name: this.prepared_report_name,
			view_state: {
				...this.state,
				quick_filters: (this.state.quick_filters || []).filter((id) => known.has(id)),
				report_filters: this.last_filters,
			},
			quick_filters: defined.map((q) => ({ id: q.id, expression: q.expression })),
			scope: "all",
			selection: null,
			// Read from the view (§8أ.6): the facts that pass the filters and the total shown.
			expected: this.opened.expected,
			layout: {
				title: __(this.report_name),
				orientation: "landscape",
				page_size: "A4",
				include_filters: true,
				include_subtotals: true,
				include_signatures: false,
				columns: cols.map((c) => ({ key: c.key, width: this.state.columns.widths[c.key] || c.width || null })),
			},
			locale: { lang: session_lang(), rtl: this.rtl },
		};
	}

	async export_xlsx() {
		// The file is the table's: the server exports the grid view only.
		if (!this.opened || this.state.mode !== "grid" || this.export_job || !this.features.excel) return;
		this.header.set_exporting(true);
		try {
			let out = await api.export_xlsx(this.report_name, this.export_model());
			if (out.queued) out = await this.wait_export_job(out.queued);
			if (!out) return;
			this.save_file(out);
			frappe.show_alert({ message: __("Excel file downloaded"), indicator: "green" });
		} catch (e) {
			// HTTP 429 and the other refusals: the server's own message, once (no retry)
			const title = (ERROR_TITLES[e.exc_type] || (() => __("Export failed")))();
			frappe.msgprint({ title, message: esc(e.message), indicator: "red" });
		} finally {
			this.header.set_exporting(false);
		}
	}

	/**
	 * A large export runs on the server (export_jobs): its state is asked for until it is
	 * done, shown next to the button with a way to stop waiting, then the file is downloaded.
	 * @returns {Promise<{blob, filename}|null>} null when the user stopped waiting
	 */
	async wait_export_job(queued) {
		const job = { id: queued.job, stopped: false };
		this.export_job = job;
		const rows = Number(queued.row_count) || 0;
		// stop: the server is asked to cancel the job where it says it can (`cancellable`);
		// either way the page stops waiting for it
		const stop = () => {
			job.stopped = true;
			this.header.set_export_job(null);
			if (job.cancellable) api.export_xlsx_cancel(job.id).catch(() => frappe.show_alert?.({ message: __("The export could not be cancelled on the server; its file will not be downloaded"), indicator: "orange" }));
		};
		const show = (state) => {
			const running = state === "running" ? __("Building the Excel file") : __("The Excel file is queued");
			const text = rows ? __("{0} · {1} rows", [running, fmt_int(rows)]) : running;
			this.header.set_export_job({ text, on_stop: stop });
		};
		show("queued");
		try {
			await wait_for_export(job.id, {
				status: (id) => api.export_xlsx_status(id),
				cancelled: () => job.stopped || this.export_job !== job,
				on_state: (s) => {
					job.cancellable = s.cancellable === true;
					show(s.state);
				},
			});
			this.header.set_export_job({ text: __("Downloading the Excel file"), on_stop: stop });
			const file = await api.export_xlsx_download(job.id, this.report_name);
			return job.stopped ? null : file;
		} catch (e) {
			if (!(e instanceof ExportJobError)) throw e;
			if (e.reason === "cancelled") return null;
			const message =
				e.reason === "timeout" ? __("The Excel file is taking longer than expected. Try again in a few minutes.") : e.message || __("The Excel file could not be prepared.");
			throw Object.assign(new Error(message), { exc_type: null });
		} finally {
			if (this.export_job === job) this.export_job = null;
			this.header.set_export_job(null);
		}
	}

	save_file({ blob, filename }) {
		download_blob(blob, filename);
	}
}
