// The "Custom" print source (ADR-019), on every Desk page: any page prints its data with a
// Custom print format in the pages of Report View (/desk/rv-print/Custom/…).
//
//   report_view.print({ print_format, data, title })            the data as it is
//   report_view.print({ print_format, method, args, title })    the data of a whitelisted method
//   report_view.print({ html, css, data | method, title })      a template sent with the data
//   report_view.print_table({ title, columns, rows, totals })    any table, no template needed
//   report_view.open_print(url)                                  the address a server method returned
//
// Options of both: letter_head, lang, heading, signature (names; the pages' defaults
// otherwise) and open_in ("same" | "tab", the site's default otherwise). Inline data is staged on the server for an
// hour, for this user only; a method is called by the print page itself (with GET), so its
// own whitelist and permission checks apply and the address can be kept.
//
// The template is EITHER a saved Custom format (print_format) OR html + css sent with the
// print. A sent template is staged with its data (its method is called here, by this page),
// and is rendered in a sandbox: it reads only the data sent (no database); for lookups,
// save it as a Custom format.

const ROUTE = "rv-print";
const CUSTOM = "Custom";
const TABLE_FORMAT = "Report View Table";
const OPTION_KEYS = ["letter_head", "lang", "heading", "signature"];
const METHOD = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;

function choices(opts) {
	const out = {};
	for (const k of OPTION_KEYS) if (typeof opts[k] === "string" && opts[k]) out[k] = opts[k];
	return out;
}

function query_of(opts) {
	const q = { method: opts.method };
	if (opts.args !== undefined && opts.args !== null) q.args = typeof opts.args === "string" ? opts.args : JSON.stringify(opts.args);
	if (opts.title) q.title = String(opts.title);
	return { ...q, ...choices(opts) };
}

/** Either a saved format or a sent template: one of the two. */
function check_source({ print_format, html }) {
	if (Boolean(print_format) === Boolean(html)) throw new Error(__("Give either a print format or an HTML template, not both"));
}

/** The address of a Custom print by a method (bookmarkable): /desk/rv-print/Custom/<format>?method=… */
function print_url({ print_format, method, html, ...opts }) {
	if (html) throw new Error(__("An HTML template is sent with its data: an address with a method cannot carry it"));
	if (!print_format || !METHOD.test(method || "")) throw new Error(__("Give the print format and the method that returns the data"));
	const q = new URLSearchParams(query_of({ method, ...opts }));
	return `/desk/${ROUTE}/${CUSTOM}/${encodeURIComponent(print_format)}?${q}`;
}

/**
 * Opens the print page with a Custom print format, or with a template sent with the data.
 * @param {object} opts
 * @param {string} [opts.print_format] a saved Custom print format, or:
 * @param {string} [opts.html] the template: HTML with Jinja for the data (at most 200 KB)
 * @param {string} [opts.css] its styles (at most 100 KB), kept to the printed content
 * @param {object|Array} [opts.data] the data (an object or a list, at most 5 MB as JSON)
 * @param {string} [opts.method] or a whitelisted method that returns it (called with GET)
 * @param {object} [opts.args] the method's arguments
 * @param {string} [opts.title] the title of the print (the format's name otherwise)
 * @param {"same"|"tab"} [opts.open_in] where the print opens: this tab or a tab of its own
 *   (the site's default otherwise, Report View Global Settings); `new_window: true` = "tab"
 * @returns {Promise<string>} the address of the print page
 */
async function print(opts = {}) {
	const { print_format, html, css, method } = opts;
	const new_window = in_new_tab(opts);
	check_source(opts);
	if (method && !METHOD.test(method)) throw new Error(__("Invalid data method"));
	// a tab is opened at the click (a browser blocks one opened after a request)
	const tab = new_window ? window.open("", "_blank") : null;
	try {
		let data = opts.data;
		// a sent template travels with its data: the method is called here (GET, its own checks)
		if (method && html) data = (await frappe.call({ method, args: typeof opts.args === "string" ? JSON.parse(opts.args) : opts.args || {}, type: "GET" })).message;
		else if (method) {
			const url = print_url(opts);
			if (tab) tab.location.href = url;
			else {
				frappe.route_options = query_of(opts);
				frappe.set_route(ROUTE, CUSTOM, print_format);
			}
			return url;
		}
		const r = await frappe.call({
			method: "report_view.api.custom_print.stage",
			type: "POST",
			args: {
				...(print_format ? { print_format } : { html: String(html), ...(css ? { css: String(css) } : {}) }),
				data: JSON.stringify(data ?? {}),
				...(opts.title ? { title: String(opts.title) } : {}),
				...choices(opts),
			},
			freeze: !tab,
		});
		const { token, route } = r.message;
		if (tab) tab.location.href = route;
		else frappe.set_route(ROUTE, CUSTOM, token);
		return route;
	} catch (e) {
		tab?.close();
		throw e;
	}
}

/** Whether a print opens in a tab of its own: the call's `open_in` (or `new_window`), else the site's default. */
function in_new_tab(opts = {}) {
	if (opts.open_in === "tab" || opts.open_in === "same") return opts.open_in === "tab";
	if (typeof opts.new_window === "boolean") return opts.new_window;
	return frappe.boot?.report_view?.custom_print_open_in === "tab";
}

/**
 * Opens the address a server method returned (report_view.core.custom_print.print_url):
 * in this tab through Desk's router, or in a tab of its own.
 */
function open_print(url, opts = {}) {
	const u = new URL(url, window.location.origin);
	if (in_new_tab(opts) || u.origin !== window.location.origin) return window.open(u.href, "_blank");
	const parts = u.pathname.replace(/^\/desk\//, "").split("/").map(decodeURIComponent);
	const query = Object.fromEntries(u.searchParams.entries());
	if (Object.keys(query).length) frappe.route_options = query;
	return frappe.set_route(...parts);
}

/**
 * Prints a table with the shipped format «Report View Table» (or another Custom format
 * that reads the same data): columns {label, fieldname, fieldtype, options, width} and
 * rows as objects (by fieldname) or as lists (in the columns' order). `totals`: true sums
 * the Int, Float and Currency columns; an object gives the totals as they are.
 */
function print_table({ title, columns, rows, totals, subtitle, note, print_format, ...opts } = {}) {
	if (!Array.isArray(columns) || !columns.length) throw new Error(__("Give the columns of the table"));
	const cols = columns.map((c) => {
		const col = typeof c === "string" ? { label: c, fieldname: c } : { ...c };
		col.fieldname = col.fieldname || frappe.scrub(col.label || "");
		col.fieldtype = col.fieldtype || "Data";
		return { label: col.label || col.fieldname, fieldname: col.fieldname, fieldtype: col.fieldtype, options: col.options || null, width: col.width || null };
	});
	const data = { columns: cols, rows: rows || [] };
	if (totals) data.totals = totals;
	if (subtitle) data.subtitle = subtitle;
	if (note) data.note = note;
	// the shipped table format, unless a template of the caller's reads the same data
	return print({ ...opts, ...(opts.html ? {} : { print_format: print_format || TABLE_FORMAT }), data, title });
}

frappe.provide("report_view");
Object.assign(window.report_view, { print, print_table, print_url, open_print });
