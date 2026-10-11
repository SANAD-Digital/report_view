// Server calls (docs/architecture.md §2). Every call resolves with r.message or rejects
// with an RVError carrying exc_type (§2.0) and the server's message.

// exc_type codes of §2.0. A request-level handler for each keeps frappe from also
// opening a msgprint dialog: the page renders the error state itself.
const EXC_TYPES = [
	"PermissionError",
	"DoesNotExistError",
	"ValidationError",
	"RVUnsupportedReport",
	"RVNoExport",
	"RVNoPrint",
	"RVInvalidInput",
	"RVInvalidViewState",
	"RVEnrichNotAllowed",
	"RVLimitExceeded",
	"RVExportMismatch",
	"RVViewNotFound",
	"RVNotOwner",
	"RVReportError",
	"MandatoryError",
	"LinkValidationError",
];
const QUIET_HANDLERS = Object.fromEntries(EXC_TYPES.map((t) => [t, () => {}]));

export class RVError extends Error {
	constructor({ exc_type, message, http_status }) {
		super(message || exc_type || "Error");
		this.name = "RVError";
		this.exc_type = exc_type || null;
		this.http_status = http_status || null;
	}
}

function parse_server_messages(text) {
	try {
		return JSON.parse(text)
			.map((m) => {
				try {
					return JSON.parse(m).message;
				} catch {
					return m;
				}
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

function message_of(r) {
	if (!r || typeof r !== "object") return "";
	if (r._error_message) return r._error_message;
	if (r._server_messages) {
		const list = parse_server_messages(r._server_messages);
		if (list.length) return list.join("\n");
	}
	if (r.exception) return String(r.exception).split(":").slice(1).join(":").trim();
	return "";
}

function exc_type_of(r) {
	if (!r || typeof r !== "object") return null;
	if (r.exc_type) return r.exc_type;
	if (r.exception) return String(r.exception).split(":")[0].split(".").at(-1);
	return null;
}

export function to_error(r, http_status = null) {
	const text = message_of(r);
	return new RVError({
		exc_type: exc_type_of(r),
		message: text ? frappe.utils.html2text(text) : __("The server could not complete the request."),
		http_status,
	});
}

export function server_messages(r) {
	return r && r._server_messages ? parse_server_messages(r._server_messages) : [];
}

// Resolves with {message, server_messages}.
export function call(method, args, { type = "GET" } = {}) {
	return new Promise((resolve, reject) => {
		let last = null;
		frappe.call({
			method,
			args,
			type,
			silent: true,
			error_handlers: QUIET_HANDLERS,
			always: (r) => {
				last = r;
			},
			callback: (r) => resolve({ message: r.message, server_messages: server_messages(r) }),
			error: () => reject(to_error(last)),
		});
	});
}

const message = (p) => p.then((r) => r.message);

export const api = {
	get_meta: (report_name) => message(call("report_view.api.get_meta", { report_name })),

	// `lang`: the report runs in that language (frappe reads `_lang` from the request),
	// for the pages printed in a language other than the session's (ADR-014).
	run: (report_name, filters, js_filters, prepared_report_name = null, lang = null) =>
		call(
			"report_view.api.run",
			{ report_name, filters, js_filters, prepared_report_name, ...(lang ? { _lang: lang } : {}) },
			{ type: "POST" }
		),

	// Pages view (ADR-014): what a user who may print the report may choose from.
	get_print_options: (report_name, company = null) =>
		message(call("report_view.api.get_print_options", { report_name, company })),

	get_print_format: (report_name, name) => message(call("report_view.api.get_print_format", { report_name, name })),

	get_translations: (report_name, lang, messages) =>
		message(call("report_view.api.get_translations", { report_name, lang, messages }, { type: "POST" })),

	// Frappe's own: the letter head rendered with the report's filters as `doc`, as the
	// query-report page prints it.
	render_letterhead: (letterhead, doc) =>
		message(call("frappe.utils.print_format.render_letterhead_for_print", { letterhead, doc }, { type: "POST" })),

	enrich: (report_name, source_column, doctype, names, fields) =>
		message(
			call(
				"report_view.api.enrich",
				{ report_name, source_column, doctype, names, fields },
				{ type: "POST" }
			)
		),

	// Binary download. fetch is used instead of open_url_post so that a JSON error
	// (RVNoExport, RVExportMismatch, ...) can be shown instead of a blank tab.
	async export_xlsx(report_name, export_model) {
		const res = await fetch("/api/method/report_view.api.export_xlsx", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json, application/octet-stream",
				"X-Frappe-CSRF-Token": frappe.csrf_token,
			},
			body: JSON.stringify({ report_name, export_model }),
		});
		const ctype = res.headers.get("content-type") || "";
		if (!res.ok || ctype.includes("application/json")) {
			let body = null;
			try {
				body = await res.json();
			} catch {
				body = null;
			}
			if (res.ok && body?.message?.status === "queued") return { queued: body.message };
			throw to_error(body, res.status);
		}
		const blob = await res.blob();
		const disposition = res.headers.get("content-disposition") || "";
		const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
		const filename = match ? decodeURIComponent(match[1]) : `${report_name}.xlsx`;
		return { blob, filename };
	},
};
