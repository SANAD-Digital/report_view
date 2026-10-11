// Small helpers shared by every module of the page.

/** HTML-escape a value for innerHTML (null and undefined become ""). */
export function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}
