// The saved views of the visual harness (ADR-010): report_view.api.views as the server answers
// it, with its privacy (a private view of another user is "not found", a shared view is never
// written by anyone but its owner) and the user's own default. Test-only code.
// URL parameters: views=<JSON> ([{name?, title, visibility, owner?, roles?, state, description?,
// columns_ref?}]; owner defaults to the session user), vdefault=<name> (the user's default),
// gdefault=<name> (the report's default, Report View Settings).

const params = new URLSearchParams(window.location.search);
const me = () => frappe.session.user;
// the session user's roles (Desk's frappe.user_roles)
frappe.user_roles ||= ["Accounts User", "Accounts Manager", "System Manager", "All", "Desk User"];

const not_found = () => Object.assign(new Error("This saved view does not exist or is not shared with you"), { exc_type: "RVViewNotFound" });
const not_owner = () => Object.assign(new Error("Only the owner of a saved view can change or delete it"), { exc_type: "RVNotOwner" });

window.RV_VIEWS = JSON.parse(params.get("views") || "[]").map((v, i) => ({
	name: `sv-${i}`,
	owner: me(),
	visibility: "Private",
	roles: [],
	description: "",
	columns_ref: null,
	modified: "2026-10-28 10:00:00",
	...v,
}));
window.RV_VIEW_DEFAULT = params.get("vdefault") || null;
const global_default = params.get("gdefault") || null;
let seq = window.RV_VIEWS.length;

function visible(v) {
	if (v.owner === me()) return true;
	if (v.visibility === "Public") return true;
	return v.visibility === "Roles" && v.roles.some((r) => frappe.user_roles.includes(r));
}

function find(report_name, name) {
	const v = window.RV_VIEWS.find((x) => x.name === name);
	if (!v || (v.report !== undefined && v.report !== report_name)) throw not_found();
	if (!visible(v)) throw not_found();
	return v;
}

const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

/** get_meta.defaults: the user's default, else the report's, each while visible. */
export function views_defaults() {
	const pick = (name, shared) => {
		const v = name && window.RV_VIEWS.find((x) => x.name === name);
		return v && visible(v) && (!shared || v.visibility !== "Private") ? v : null;
	};
	const user = pick(window.RV_VIEW_DEFAULT, false);
	if (user) return { saved_view: user.name, source: "user", title: user.title };
	const glob = pick(global_default, true);
	if (glob) return { saved_view: glob.name, source: "global", title: glob.title };
	return { saved_view: null, source: null, title: null };
}

export function views_server(fn, a) {
	window.RV_VIEW_CALLS = [...(window.RV_VIEW_CALLS || []), { fn, args: JSON.parse(JSON.stringify(a || {})) }];
	if (fn === "list_views") {
		return window.RV_VIEWS.filter(visible).map((v) => ({
			name: v.name,
			title: v.title,
			visibility: v.visibility,
			owner: v.owner,
			owner_name: v.owner === me() ? "RV Admin" : v.owner.split("@")[0],
			is_owner: v.owner === me(),
			is_global_default: v.name === global_default && v.visibility !== "Private",
			is_user_default: v.name === window.RV_VIEW_DEFAULT,
			description: v.description || "",
			modified: v.modified,
		}));
	}
	if (fn === "get_view") {
		const v = find(a.report_name, a.name);
		const state = JSON.parse(JSON.stringify(v.state || {}));
		delete state.ui;
		return { name: v.name, title: v.title, visibility: v.visibility, roles: v.visibility === "Roles" ? [...v.roles] : [], description: v.description, state, columns_ref: v.columns_ref, owner: v.owner, is_owner: v.owner === me(), modified: v.modified };
	}
	if (fn === "save_view") {
		let v;
		if (a.name) {
			v = find(a.report_name, a.name);
			if (v.owner !== me()) throw not_owner();
		} else {
			v = { name: `sv-${seq++}`, owner: me(), visibility: "Private", roles: [], description: "", columns_ref: null };
			window.RV_VIEWS.push(v);
		}
		if (a.title !== undefined) v.title = String(a.title).trim();
		if (a.state !== undefined) {
			const state = parse(a.state);
			delete state.ui;
			v.state = state;
		}
		if (a.visibility !== undefined) v.visibility = a.visibility;
		if (a.roles !== undefined || a.visibility !== undefined) v.roles = v.visibility === "Roles" ? parse(a.roles || "[]") : [];
		if (a.description !== undefined) v.description = a.description;
		if (a.columns !== undefined) {
			const keys = new Set(JSON.stringify(v.state).match(/"[a-z_0-9]+"/g)?.map((s) => s.slice(1, -1)));
			v.columns_ref = Object.fromEntries(parse(a.columns).filter((c) => keys.has(c.key)).map((c) => [c.key, { label: c.label, fieldtype: c.fieldtype, source_index: c.source_index }]));
		}
		v.modified = "2026-10-28 11:00:00";
		return { name: v.name, title: v.title, modified: v.modified };
	}
	if (fn === "delete_view") {
		const v = find(a.report_name, a.name);
		if (v.owner !== me()) throw not_owner();
		window.RV_VIEWS.splice(window.RV_VIEWS.indexOf(v), 1);
		if (window.RV_VIEW_DEFAULT === a.name) window.RV_VIEW_DEFAULT = null;
		return { ok: true };
	}
	if (fn === "set_default") {
		if (a.name) find(a.report_name, a.name);
		window.RV_VIEW_DEFAULT = a.name || null;
		return { ok: true };
	}
	throw new Error(`harness: no saved views stub for ${fn}`);
}
