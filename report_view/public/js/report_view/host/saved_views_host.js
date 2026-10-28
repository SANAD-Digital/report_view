// Saved views on the report page (ADR-010): the «Views» menu of the head, the view a link or
// the user's default opens with, applying, saving, sharing, deleting, the user's default, and
// whether the page still shows the view applied (the dot, the link). Methods of ReportViewPage
// (installed by index.js). The pure parts are state/saved_views.js; the rules are the server's.
//
// A view applied is held as `this.applied_view`: what the server gave ({name, title,
// visibility, roles, is_owner}), its state as the page applies it (`base`: sanitized, held to
// the report's settings, its columns found again) and its filters (`filters`, or null for a
// view without them). The page "shows the view" while its own state and filters are the same.

import { api, error_text } from "../api.js";
import { ViewsMenu } from "../components/views_menu.js";
import { default_state, sanitize, reconcile } from "../state/view_state.js";
import {
	view_payload,
	snapshot,
	same_snapshot,
	stable,
	clean_filters,
	filters_to_apply,
	columns_payload,
	rebind,
	split_views,
	share_roles,
	view_to_open,
	VISIBILITIES,
} from "../state/saved_views.js";

const clone = (v) => JSON.parse(JSON.stringify(v));

function alert(message, indicator = "orange") {
	frappe.show_alert?.({ message, indicator });
}

export class SavedViewsHost {
	/** The menu, in the head's slot (header.js). */
	make_views_menu() {
		this.applied_view = null;
		this.views_list = null;
		this.views_menu = new ViewsMenu({
			parent: this.header.views_slot,
			rtl: this.rtl,
			on: {
				open: () => this.reload_views(),
				apply: (name) => this.apply_saved_view(name),
				save: () => this.save_view_over(),
				save_new: () => this.save_view_new(),
				edit: () => this.edit_view(),
				remove: () => this.delete_view(),
				star: (name) => this.toggle_default_view(name),
			},
		});
	}

	/** A new report: no view of the previous one, the menu once the report can open. */
	reset_views() {
		this.applied_view = null;
		this.views_list = null;
		this.views_menu.set_list(null);
		this.views_menu.set_applied(null);
		this.views_menu.show(false);
	}

	// ------------------------------------------------------------ opening the page

	/**
	 * The saved view the page opens with (load): the one in the link (`?view=`), else the
	 * user's default, else the report's (get_meta.defaults). A view that is not there for this
	 * user (deleted, private, not shared with them, of another report) is said once and the
	 * default opens instead. Returns the view's state (sanitized, held to the report's
	 * settings) when the page is to show it, or null; with `rv` in the link the state is the
	 * link's own and the view only the one it was made from (shown changed).
	 * @param {URLSearchParams} params
	 * @param {object|null} from_url the link's own state (rv), if any
	 */
	async open_linked_view(params, from_url) {
		this.views_menu.show(true);
		const want = view_to_open(params, this.meta?.defaults);
		if (!want.name) return null;
		let view = await this.fetch_view(want.name);
		if (!view && want.from === "link") {
			alert(__("The saved view of this link is not available to you: the report opens without it"));
			const fallback = this.meta?.defaults?.saved_view;
			if (!from_url && fallback && fallback !== want.name) view = await this.fetch_view(fallback);
		}
		if (!view) return null;
		const state = this.hold_view(view);
		if (from_url) {
			// the link's own state, made from the view: shown changed until it is the same
			return null;
		}
		return state;
	}

	async fetch_view(name) {
		try {
			return await api.views.get(this.report_name, name);
		} catch {
			return null;
		}
	}

	/**
	 * Keeps `view` as the one applied and returns the state the page shows for it: its state
	 * through sanitize and the report's settings (restrict_state), as a link's is. What the
	 * report turned off is left out, and said.
	 */
	hold_view(view) {
		const raw = view.state || {};
		const with_filters = Boolean(raw.report_filters && typeof raw.report_filters === "object");
		let base = sanitize(raw, this.config);
		if (base.__newer) {
			alert(__("The view «{0}» was saved by a newer version of Report View: the report opens without it", [view.title]));
			this.applied_view = null;
			this.views_menu.set_applied(null);
			return null;
		}
		const before = stable(view_payload(base));
		const saved = this.state;
		this.state = base;
		this.restrict();
		base = this.state;
		this.state = saved;
		if (stable(view_payload(base)) !== before) {
			alert(__("Parts of the view «{0}» are turned off for this report and were left out", [view.title]));
		}
		this.applied_view = {
			name: view.name,
			title: view.title,
			visibility: view.visibility,
			roles: view.roles || [],
			description: view.description || "",
			is_owner: Boolean(view.is_owner),
			columns_ref: view.columns_ref || null,
			base: view_payload(base),
			filters: with_filters ? clean_filters(raw.report_filters) : null,
			bound: false,
		};
		this.views_menu.set_applied(this.applied_view);
		return clone(base);
	}

	/** The filters a view gives every report filter (load, apply), or {} for none. */
	view_filter_values() {
		const f = this.applied_view?.filters;
		if (!f || !this.filters) return {};
		return filters_to_apply(
			f,
			this.filters.controls.map((c) => ({ fieldname: c.df.fieldname, fieldtype: c.df.fieldtype }))
		);
	}

	/**
	 * A new result (handle_response, before reconcile): the columns of the view applied are
	 * found again in the report's (§7.3), in the view's state and, when the page shows it, in
	 * the page's; the missing ones are said once.
	 */
	rebind_view(report) {
		const a = this.applied_view;
		if (!a || a.bound) return;
		a.bound = true;
		const translate = (s) => __(s);
		const own = same_snapshot(snapshot(this.state, null, false), snapshot(a.base, null, false));
		const { missing } = rebind(a.base, a.columns_ref, report.columns, translate);
		if (own) rebind(this.state, a.columns_ref, report.columns, translate);
		reconcile(a.base, report.columns);
		if (own && missing.length) {
			alert(__("The view «{0}» refers to columns the report no longer has: {1}", [a.title, missing.join(__(", "))]));
		}
	}

	/** Whether the page no longer shows the view applied as it was saved. */
	view_modified() {
		const a = this.applied_view;
		if (!a || !this.state) return false;
		const now = snapshot(this.state, this.last_filters, Boolean(a.filters));
		return !same_snapshot(now, { state: a.base, filters: a.filters });
	}

	/** For the URL (make_url_updater): the view applied and whether it changed; the dot follows. */
	url_view() {
		const a = this.applied_view;
		const modified = this.view_modified();
		this.views_menu?.set_modified(modified);
		return a ? { name: a.name, modified } : null;
	}

	// ------------------------------------------------------------ the menu's list

	async reload_views() {
		if (!this.report_name) return;
		try {
			const rows = await api.views.list(this.report_name);
			this.views_list = split_views(rows);
		} catch (e) {
			this.views_list = { mine: [], shared: [] };
			alert(__("The saved views could not be loaded: {0}", [error_text(e)]));
		}
		this.views_menu.set_list(this.views_list);
		this.views_menu.set_modified(this.view_modified());
	}

	/** The menu, after a change of the view applied or of the list. */
	paint_views() {
		this.views_menu.set_applied(this.applied_view, this.view_modified());
	}

	// ------------------------------------------------------------ applying

	/** Applies a saved view (`name`), or the report as it opens without one (null). */
	async apply_saved_view(name) {
		if (!this.state || !this.report_name) return;
		if (!name) {
			this.applied_view = null;
			this.state = sanitize(default_state(this.config), this.config);
			this.state.ui.density = this.density;
			this.restrict();
			this.paint_views();
			this.refresh_controls();
			await this.render();
			return;
		}
		let view;
		try {
			view = await api.views.get(this.report_name, name);
		} catch (e) {
			alert(error_text(e), "red");
			await this.reload_views();
			return;
		}
		const state = this.hold_view(view);
		if (!state) return;
		state.ui = { ...(this.state.ui || {}), density: this.density };
		this.state = state;
		if (this.report) {
			// the result on screen: its columns now
			this.applied_view.bound = false;
			this.rebind_view(this.report);
			reconcile(this.state, this.report.columns);
		}
		this.paint_views();
		alert(__("View «{0}» applied", [view.title]), "green");
		if (this.applied_view.filters && this.filters) {
			await this.filters.set_route_values(this.view_filter_values());
			this.criteria?.refresh();
			this.refresh_controls();
			await this.run();
			return;
		}
		this.refresh_controls();
		await this.render();
	}

	// ------------------------------------------------------------ saving

	save_args(with_filters) {
		return {
			state: JSON.stringify(view_payload(this.state, with_filters ? this.last_filters || {} : null)),
			columns: JSON.stringify(columns_payload(this.report?.columns)),
		};
	}

	/** After a save: the list again, the view applied as the page shows it now. */
	async after_save(out, fields) {
		const with_filters = fields.with_filters;
		this.applied_view = {
			...(this.applied_view || {}),
			name: out.name,
			title: out.title,
			visibility: fields.visibility,
			roles: fields.roles || [],
			description: fields.description || "",
			is_owner: true,
			columns_ref: null,
			base: view_payload(this.state),
			filters: with_filters ? clean_filters(this.last_filters) : null,
			bound: true,
		};
		this.paint_views();
		this.update_url(this.last_filters, this.state, default_state(this.config));
		await this.reload_views();
	}

	async save_view_over() {
		const a = this.applied_view;
		if (!a?.is_owner) return;
		this.views_menu.busy = true;
		try {
			const out = await api.views.save(this.report_name, { name: a.name, ...this.save_args(Boolean(a.filters)) });
			await this.after_save(out, { visibility: a.visibility, roles: a.roles, description: a.description, with_filters: Boolean(a.filters) });
			alert(__("View «{0}» saved", [out.title]), "green");
		} catch (e) {
			alert(error_text(e), "red");
		} finally {
			this.views_menu.busy = false;
		}
	}

	/** The fields of the dialogs: the name, who sees it (and the roles), the description. */
	view_fields({ title = "", visibility = "Private", roles = [], description = "", with_filters = null } = {}) {
		const own_roles = share_roles(frappe.user_roles);
		const options = [
			{ value: "Private", label: __("Only me") },
			{ value: "Roles", label: __("Users of some of my roles") },
			{ value: "Public", label: __("Everyone who can open the report") },
		];
		const fields = [
			{ fieldname: "title", fieldtype: "Data", label: __("Name", null, "Report View"), reqd: 1, default: title },
			{ fieldname: "visibility", fieldtype: "Select", label: __("Who sees it"), options, default: VISIBILITIES.includes(visibility) ? visibility : "Private" },
			{
				fieldname: "roles",
				fieldtype: "MultiSelectList",
				label: __("Roles"),
				depends_on: "eval:doc.visibility==='Roles'",
				get_data: (txt) =>
					own_roles.filter((r) => !txt || r.toLowerCase().includes(String(txt).toLowerCase()) || __(r).includes(txt)).map((r) => ({ value: r, description: "", label: __(r) })),
				default: roles,
				description: __("A user who has one of them and may open the report sees the view"),
			},
		];
		if (with_filters !== null) {
			fields.push({
				fieldname: "with_filters",
				fieldtype: "Check",
				label: __("Keep the report's filters (company, dates…) with the view"),
				default: with_filters ? 1 : 0,
			});
		}
		fields.push({ fieldname: "description", fieldtype: "Small Text", label: __("Description"), default: description });
		return fields;
	}

	/** A dialog whose primary action waits for `done(values)`; the server's refusal keeps it open. */
	view_dialog({ title, primary, fields, done }) {
		const d = new frappe.ui.Dialog({
			title,
			fields,
			primary_action_label: primary,
			primary_action: async (v) => {
				const vals = v || d.get_values();
				if (!vals || !String(vals.title || "").trim()) return;
				if (vals.visibility === "Roles" && !(vals.roles || []).length) {
					frappe.msgprint?.(__("Choose the roles the view is shared with"));
					return;
				}
				d.disable_primary_action?.();
				try {
					await done(vals);
					d.hide();
				} catch (e) {
					frappe.msgprint?.({ message: frappe.utils.escape_html(error_text(e)), indicator: "red", title: __("The view was not saved") });
				} finally {
					d.enable_primary_action?.();
				}
			},
		});
		d.show();
		return d;
	}

	save_view_new() {
		const a = this.applied_view;
		this.views_menu.close(false);
		this.view_dialog({
			title: __("Save the view as a new one"),
			primary: __("Save", null, "Saved view"),
			fields: this.view_fields({ title: a ? __("{0} (copy)", [a.title]) : "", with_filters: true }),
			done: async (v) => {
				const fields = { visibility: v.visibility || "Private", roles: v.visibility === "Roles" ? v.roles || [] : [], description: v.description || "", with_filters: Boolean(v.with_filters) };
				const out = await api.views.save(this.report_name, {
					title: v.title.trim(),
					visibility: fields.visibility,
					roles: JSON.stringify(fields.roles),
					description: fields.description,
					...this.save_args(fields.with_filters),
				});
				await this.after_save(out, fields);
				alert(__("View «{0}» saved", [out.title]), "green");
			},
		});
	}

	edit_view() {
		const a = this.applied_view;
		if (!a?.is_owner) return;
		this.views_menu.close(false);
		this.view_dialog({
			title: __("Edit the view «{0}»", [a.title]),
			primary: __("Save", null, "Saved view"),
			fields: this.view_fields({ title: a.title, visibility: a.visibility, roles: a.roles, description: a.description }),
			done: async (v) => {
				const visibility = v.visibility || a.visibility;
				const roles = visibility === "Roles" ? v.roles || [] : [];
				const out = await api.views.save(this.report_name, {
					name: a.name,
					title: v.title.trim(),
					visibility,
					roles: JSON.stringify(roles),
					description: v.description || "",
				});
				Object.assign(this.applied_view, { title: out.title, visibility, roles, description: v.description || "" });
				this.paint_views();
				await this.reload_views();
				alert(__("View «{0}» saved", [out.title]), "green");
			},
		});
	}

	delete_view() {
		const a = this.applied_view;
		if (!a?.is_owner) return;
		const message =
			a.visibility === "Private"
				? __("Delete the view «{0}»?", [a.title])
				: __("Delete the view «{0}»? The users it is shared with lose it too.", [a.title]);
		frappe.confirm(frappe.utils.escape_html(message), async () => {
			try {
				await api.views.remove(this.report_name, a.name);
			} catch (e) {
				alert(error_text(e), "red");
				return;
			}
			// what the page shows stays; it is no longer a saved view
			this.applied_view = null;
			this.paint_views();
			this.update_url(this.last_filters, this.state, default_state(this.config));
			await this.reload_views();
			alert(__("View «{0}» deleted", [a.title]), "green");
		});
	}

	/** The star of a row: the user's own default view of the report (or none). */
	async toggle_default_view(name) {
		const row = [...(this.views_list?.mine || []), ...(this.views_list?.shared || [])].find((r) => r.name === name);
		if (!row) return;
		try {
			await api.views.set_default(this.report_name, row.is_user_default ? null : name);
			alert(row.is_user_default ? __("The report opens without a default view of yours") : __("The report opens with «{0}» from now on", [row.title]), "green");
		} catch (e) {
			alert(error_text(e), "red");
		}
		await this.reload_views();
	}
}
