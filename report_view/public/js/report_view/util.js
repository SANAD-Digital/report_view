// Small helpers shared by every module of the page.

/** HTML-escape a value for innerHTML (null and undefined become ""). */
export function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

/** A whole number as the system settings write it (grouping, the language's digits). */
export function fmt_int(n) {
	return frappe.format(n, { fieldtype: "Int" }, { inline: true });
}

/** A number with decimals as the system settings write it (`precision`: the site's when left out). */
export function fmt_float(n, precision = null) {
	return frappe.format(n, { fieldtype: "Float", ...(precision === null ? {} : { precision }) }, { inline: true });
}

/** The language of the session: Frappe's boot, else the document's, else English. */
export function session_lang() {
	return globalThis.frappe?.boot?.lang || globalThis.document?.documentElement?.lang || "en";
}

// A downloaded file's object URL is given back after this long: the browser has read it by then.
export const BLOB_REVOKE_MS = 30000;

/** Saves a file the page made (a blob) under `name`, through a link the browser follows. */
export function download_blob(blob, name) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), BLOB_REVOKE_MS);
}

// User settings are saved after a burst of changes (typing a margin, ticking values).
export const SETTINGS_SAVE_MS = 800;

/** One field of Frappe's user settings under `key` (null when there is none, or no user settings). */
export async function load_user_settings(key, field) {
	if (!globalThis.frappe?.model?.user_settings?.get) return null;
	try {
		return (await frappe.model.user_settings.get(key))?.[field] ?? null;
	} catch {
		return null;
	}
}

/**
 * Saves of Frappe's user settings after a burst of changes: `save` keeps the latest value and
 * writes it after `delay` ms of quiet; `flush` writes what is pending now (leaving the page,
 * switching report: nothing changed is lost). A save to another key or field writes the
 * pending one first. A failed save says so (an alert), never as an unhandled rejection.
 */
export function settings_saver({ delay = SETTINGS_SAVE_MS } = {}) {
	let timer = null;
	let pending = null;
	const write = () => {
		clearTimeout(timer);
		timer = null;
		const p = pending;
		pending = null;
		if (!p || !globalThis.frappe?.model?.user_settings?.save) return Promise.resolve();
		let request;
		try {
			request = Promise.resolve(frappe.model.user_settings.save(p.key, p.field, p.value));
		} catch (e) {
			request = Promise.reject(e);
		}
		return request.then(
			() => undefined,
			() => frappe.show_alert?.({ message: __("Your settings could not be saved"), indicator: "orange" })
		);
	};
	return {
		save(key, field, value) {
			if (pending && (pending.key !== key || pending.field !== field)) write();
			pending = { key, field, value };
			clearTimeout(timer);
			timer = setTimeout(write, delay);
		},
		/** Writes the pending value now; resolves once the server has it. */
		flush: write,
		get pending() {
			return Boolean(pending);
		},
	};
}
