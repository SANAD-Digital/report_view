// Print presets (ADR-020): the settings of the print pages saved under a name, private to
// their owner or public, and applied again from the head of the print toolbar.
// The control in the head shows the preset applied («Preset: <name>», or the standard
// settings) and a dot once the settings differ from it; its menu lists the user's presets
// and the public ones, and saves, copies, edits or deletes. Records: DocType Print Preset,
// read and written through report_view.api.print_presets with the user's permissions.
// The pure functions at the top (what a preset holds, what applying one gives, the default)
// are tested in tests/js/print_presets.test.mjs.

import { icons } from "../components/icons.js";
import { esc } from "../util.js";

const API = "report_view.api.print_presets";
// Settings of one print target (the columns of a report, a print format of one doctype or
// Custom format): a preset for every target neither saves nor applies them.
export const TARGET_KEYS = ["hidden", "template"];
// Settings of the view, not of the print.
const VIEW_KEYS = new Set(["zoom", "preset"]);

const clone = (v) => (v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v);

/** JSON with the keys of every object sorted: two equal settings give the same text. */
export function stable(v) {
	if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
	if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
	return JSON.stringify(v ?? null);
}

/**
 * What a preset saves of `settings`: the keys of `defaults` (DEFAULT_SETTINGS) but the
 * view's own, without the target's keys for a preset of every target, and only the keys
 * the server knows (`keys`, from the list) when given.
 */
export function preset_payload(settings, defaults, { specific = true, keys = null } = {}) {
	const known = keys ? new Set(keys) : null;
	const out = {};
	for (const k of Object.keys(defaults)) {
		if (VIEW_KEYS.has(k) || (!specific && TARGET_KEYS.includes(k)) || (known && !known.has(k))) continue;
		if (settings[k] !== undefined) out[k] = clone(settings[k]);
	}
	return out;
}

/**
 * The settings a preset gives, as Reset gives the defaults: its values checked
 * (`sanitize`, over the site's standard settings `base`). A preset of every target keeps
 * the target's own keys of `current` (its columns, its print format); the zoom stays.
 */
export function preset_settings(preset, current, { sanitize, base }) {
	const raw = { ...(preset?.settings || {}) };
	const general = !preset?.specific;
	if (general) for (const k of TARGET_KEYS) delete raw[k];
	const s = sanitize(raw, base);
	if (general) for (const k of TARGET_KEYS) if (current?.[k] !== undefined) s[k] = clone(current[k]);
	if (current?.zoom !== undefined) s.zoom = current.zoom;
	return s;
}

/**
 * The named choices of `s` the page cannot offer here fall back (a letter head, print
 * format, heading, signature or language of another target or not readable by this
 * user); with no letter head the company's is taken, as when the pages open.
 */
export function check_choices(s, options) {
	const o = options || {};
	if (s.letter_head && !(o.letter_heads || []).some((lh) => lh.name === s.letter_head)) s.letter_head = "";
	if (s.template && !(o.print_formats || []).includes(s.template)) s.template = "";
	if (s.lang && !(o.languages || []).some((l) => l.name === s.lang)) s.lang = "";
	if (s.heading && !(o.print_headings || []).includes(s.heading)) s.heading = "";
	if (s.signature && !(o.print_signatures || []).some((x) => x.name === s.signature)) s.signature = "";
	if (!s.letter_head && o.default_letter_head) s.letter_head = o.default_letter_head;
	return s;
}

/** Whether two settings print the same (the view's own keys aside). */
export function same_settings(a, b, defaults) {
	const keys = Object.keys(defaults).filter((k) => !VIEW_KEYS.has(k));
	return stable(keys.map((k) => a?.[k])) === stable(keys.map((k) => b?.[k]));
}

/**
 * The default preset of a list ({mine, public}): the user's own first, then the public
 * one; in each, the one of this target before the one of every target.
 */
export function default_preset(list) {
	const pick = (rows) => (rows || []).filter((r) => r.is_default).sort((x, y) => Number(y.specific) - Number(x.specific))[0];
	return pick(list?.mine) || pick(list?.public) || null;
}

export function find_preset(list, name) {
	if (!name || !list) return null;
	return [...(list.mine || []), ...(list.public || [])].find((r) => r.name === name) || null;
}

function call(method, args, type = "GET") {
	return new Promise((resolve, reject) =>
		frappe.call({ method: `${API}.${method}`, args, type, silent: type === "GET", callback: (r) => resolve(r?.message), error: reject })
	);
}

// The words of a target, per context: the scope of a preset and its choice in the dialog.
const SCOPE = {
	Report: { one: () => __("This report"), all: () => __("All reports"), only: (t) => __("Only this report ({0})", [t]), every: () => __("Every report") },
	Document: { one: () => __("This document type"), all: () => __("All document types"), only: (t) => __("Only this document type ({0})", [t]), every: () => __("Every document type") },
	Custom: { one: () => __("This print format"), all: () => __("All Custom formats"), only: (t) => __("Only this print format ({0})", [t]), every: () => __("Every Custom print format") },
};

/**
 * The preset control of a PagesView: mounted in the head of the toolbar; the view gives
 * its settings, its options and its base (the site's standard settings) and saves.
 */
export class PresetControl {
	/**
	 * @param {object} view the PagesView
	 * @param {{sanitize: Function, defaults: object}} o sanitize_settings and DEFAULT_SETTINGS
	 */
	constructor(view, { sanitize, defaults }) {
		this.view = view;
		this.sanitize = sanitize;
		this.defaults = defaults;
		this.list = null;
		this.applied = null;
		this.target = null;
		this.is_open = false;
		this.make();
	}

	make() {
		const hd = this.view.el.querySelector(".rv-print-hd");
		const el = document.createElement("div");
		el.className = "rv-preset";
		el.hidden = true;
		el.innerHTML = `<button type="button" class="rv-preset-btn" aria-haspopup="dialog" aria-expanded="false"><span class="lbl">${esc(__("Preset:"))}</span><span class="nm"></span><i class="dot" aria-hidden="true" hidden></i>${icons.chevron_down(12)}</button>`;
		hd.insertBefore(el, hd.querySelector('[data-action="reset"]'));
		this.el = el;
		this.btn = el.querySelector(".rv-preset-btn");
		this.btn.addEventListener("click", () => (this.is_open ? this.close() : this.open()));
		this.on_outside = (e) => {
			if (!this.is_open || this.el.contains(e.target) || e.target.closest?.(".modal, .modal-backdrop, .rv-test-dialog, .awesomplete")) return;
			this.close(false);
		};
		this.on_key = (e) => {
			if (e.key === "Escape" && this.is_open && !document.querySelector(".modal.show, .rv-test-dialog")) {
				e.stopPropagation();
				this.close();
			}
		};
		this.on_resize = () => this.place();
	}

	// ------------------------------------------------------------ the list

	/** The presets of the host's target ({context, target}), or null where it has none. */
	load() {
		const t = this.view.host.pages_preset_target?.();
		// a sent template (Custom, no format) offers the presets of every Custom format
		this.target = t && t.context && (t.target || t.context === "Custom") ? t : null;
		if (!this.target) return Promise.resolve(null);
		return call("list_presets", { context: this.target.context, target: this.target.target }).catch(() => null);
	}

	/**
	 * The list once the pages open; `saved` the user's settings of this target (null:
	 * none). Remembers the preset they were saved with, and returns the default preset to
	 * apply when there are none.
	 */
	setup(saved, list) {
		this.list = list || null;
		this.el.hidden = !this.list;
		this.applied = find_preset(this.list, saved?.preset);
		const first = !saved && default_preset(this.list);
		if (first) this.applied = first;
		this.refresh();
		return first || null;
	}

	async reload() {
		const name = this.applied?.name;
		const list = await this.load();
		if (list) this.list = list;
		this.applied = find_preset(this.list, name);
		this.refresh();
		if (this.is_open) this.render();
	}

	/** The settings a preset gives here (as Reset gives the defaults). */
	settings_of(row) {
		const v = this.view;
		return check_choices(preset_settings(row, v.settings, { sanitize: this.sanitize, base: v.base }), v.options);
	}

	modified() {
		return Boolean(this.applied) && !same_settings(this.view.settings, this.settings_of(this.applied), this.defaults);
	}

	/** The head: the name of the preset applied and the dot of a change. */
	refresh() {
		if (!this.el || this.el.hidden) return;
		const name = this.applied ? this.applied.preset_name : __("Standard", null, "Print preset");
		const changed = this.modified();
		this.el.querySelector(".nm").textContent = name;
		this.el.querySelector(".dot").hidden = !changed;
		this.btn.title = changed ? __("Preset: {0} (changed since it was applied)", [name]) : __("Preset: {0}", [name]);
		this.btn.setAttribute("aria-label", this.btn.title);
		if (this.is_open) this.render_acts();
	}

	/** The preset to save with the user's settings (its name), or "". */
	name() {
		return this.applied?.name || "";
	}

	clear() {
		this.applied = null;
	}

	apply(row) {
		const v = this.view;
		if (!row) {
			v.reset();
			this.close();
			return;
		}
		v.settings = this.settings_of(row);
		this.applied = row;
		v.update({});
		this.close();
		frappe.show_alert?.({ message: __("Preset «{0}» applied", [row.preset_name]), indicator: "green" });
	}

	// ------------------------------------------------------------ the menu

	open() {
		if (!this.list) return;
		this.view.close_menu?.();
		this.is_open = true;
		this.btn.setAttribute("aria-expanded", "true");
		this.render();
		document.addEventListener("pointerdown", this.on_outside, true);
		document.addEventListener("keydown", this.on_key, true);
		window.addEventListener("resize", this.on_resize, { passive: true });
		const sheet = window.matchMedia("(max-width: 900px), (pointer: coarse)").matches;
		const menu = this.el.querySelector(".rv-preset-pop");
		(sheet ? menu : menu?.querySelector("[aria-current='true'], .rv-preset-row"))?.focus({ preventScroll: true });
	}

	close(focus = true) {
		if (!this.is_open) return;
		this.is_open = false;
		this.btn.setAttribute("aria-expanded", "false");
		for (const n of this.el.querySelectorAll(".rv-preset-pop, .rv-print-scrim")) n.remove();
		document.removeEventListener("pointerdown", this.on_outside, true);
		document.removeEventListener("keydown", this.on_key, true);
		window.removeEventListener("resize", this.on_resize, { passive: true });
		if (focus) this.btn.focus({ preventScroll: true });
	}

	scope_words() {
		return SCOPE[this.target?.context] || SCOPE.Report;
	}

	row_html(r) {
		const on = this.applied?.name === r.name;
		const sw = this.scope_words();
		const meta = [r.specific ? sw.one() : sw.all(), r.description].filter(Boolean).join(" · ");
		const star_label = r.is_default ? __("The default: applied when the pages open with no settings of your own") : __("Make it the default");
		const star = r.can_edit
			? `<button type="button" class="rv-preset-star${r.is_default ? " on" : ""}" data-star="${esc(r.name)}" aria-pressed="${r.is_default}" aria-label="${esc(star_label)}" title="${esc(star_label)}">${icons.star()}</button>`
			: r.is_default
				? `<span class="rv-preset-star on" title="${esc(star_label)}" role="img" aria-label="${esc(star_label)}">${icons.star()}</span>`
				: `<span class="rv-preset-star"></span>`;
		return `<li class="rv-preset-item${on ? " on" : ""}">
			<button type="button" class="rv-preset-row" data-apply="${esc(r.name)}" ${on ? 'aria-current="true"' : ""}>
				<span class="ck" aria-hidden="true">${on ? icons.check_sm() : ""}</span>
				<span class="tx"><span class="nm">${esc(r.preset_name)}</span><span class="meta">${esc(meta)}</span></span>
				<span class="rv-preset-badge ${r.public ? "pub" : "priv"}">${esc(r.public ? __("Public", null, "Print preset") : __("Private", null, "Print preset"))}</span>
			</button>${star}</li>`;
	}

	render() {
		for (const n of this.el.querySelectorAll(".rv-preset-pop, .rv-print-scrim")) n.remove();
		const l = this.list || { mine: [], public: [] };
		const std_on = !this.applied;
		const group = (title, rows, empty) =>
			`<h5 class="rv-preset-grp">${esc(title)}</h5>${rows.length ? `<ul class="rv-preset-ul">${rows.map((r) => this.row_html(r)).join("")}</ul>` : `<p class="rv-preset-empty">${esc(empty)}</p>`}`;
		const scrim = document.createElement("div");
		scrim.className = "rv-print-scrim";
		scrim.setAttribute("aria-hidden", "true");
		scrim.addEventListener("click", () => this.close());
		const menu = document.createElement("div");
		menu.className = "rv-print-pop rv-preset-pop";
		menu.tabIndex = -1;
		menu.setAttribute("role", "dialog");
		menu.setAttribute("aria-label", __("Print presets"));
		menu.innerHTML = `
			<div class="rv-pop-hd"><strong>${esc(__("Print presets"))}</strong><span>${esc(__("Settings saved under a name, applied in one click"))}</span>
				<button type="button" class="rv-pop-x" aria-label="${esc(__("Close"))}">${icons.close()}</button></div>
			<div class="rv-preset-body">
				<ul class="rv-preset-ul"><li class="rv-preset-item${std_on ? " on" : ""}"><button type="button" class="rv-preset-row" data-apply="" ${std_on ? 'aria-current="true"' : ""}>
					<span class="ck" aria-hidden="true">${std_on ? icons.check_sm() : ""}</span>
					<span class="tx"><span class="nm">${esc(__("Standard", null, "Print preset"))}</span><span class="meta">${esc(__("The site's standard print settings"))}</span></span></button><span class="rv-preset-star"></span></li></ul>
				${group(__("My presets"), l.mine || [], __("None yet: «Save as new» keeps the current settings under a name."))}
				${group(__("Public presets"), l.public || [], __("No public presets yet."))}
			</div>
			<div class="rv-preset-acts"></div>`;
		menu.querySelector(".rv-pop-x").addEventListener("click", () => this.close());
		menu.addEventListener("click", (e) => {
			const star = e.target.closest("button[data-star]");
			if (star) return this.toggle_default(star.dataset.star);
			const row = e.target.closest("[data-apply]");
			if (row) this.apply(find_preset(this.list, row.dataset.apply));
		});
		this.el.append(scrim, menu);
		this.render_acts();
		this.place();
	}

	render_acts() {
		const acts = this.el.querySelector(".rv-preset-acts");
		if (!acts) return;
		const a = this.applied;
		const editable = Boolean(a?.can_edit);
		const changed = this.modified();
		const save_title = !a ? __("Choose a preset of your own first, or save these settings as a new one") : !editable ? __("Only its owner, or a System Manager or Report Manager for a public preset, can change it") : changed ? __("Save the current settings into «{0}»", [a.preset_name]) : __("No change to save");
		acts.innerHTML = `
			<button type="button" class="rv-btn sm primary" data-act="save" ${editable && changed ? "" : "disabled"} title="${esc(save_title)}">${esc(__("Save", null, "Print preset"))}</button>
			<button type="button" class="rv-btn sm" data-act="save-new">${esc(__("Save as new…"))}</button>
			<span class="sp"></span>
			<button type="button" class="rv-btn sm ghost" data-act="edit" ${editable ? "" : "disabled"}>${esc(__("Edit…", null, "Print preset"))}</button>
			<button type="button" class="rv-btn sm ghost rv-preset-del" data-act="delete" ${editable ? "" : "disabled"}>${esc(__("Delete"))}</button>`;
		for (const b of acts.querySelectorAll("[data-act]")) {
			b.addEventListener("click", () => {
				const act = b.dataset.act;
				if (act === "save") this.save_over();
				else if (act === "save-new") this.save_new();
				else if (act === "edit") this.edit();
				else this.remove();
			});
		}
	}

	/** The menu under its button, inside the window (a sheet on a phone, by CSS). */
	place() {
		const menu = this.el.querySelector(".rv-preset-pop");
		if (!menu) return;
		const r = this.btn.getBoundingClientRect();
		const w = Math.min(380, window.innerWidth - 16);
		const start = this.view.rtl ? r.right - w : r.left;
		Object.assign(menu.style, {
			top: `${Math.round(r.bottom + 6)}px`,
			left: `${Math.round(Math.max(8, Math.min(start, window.innerWidth - w - 8)))}px`,
			width: `${w}px`,
			maxHeight: `${Math.max(240, Math.round(window.innerHeight - r.bottom - 18))}px`,
		});
	}

	// ------------------------------------------------------------ saving

	payload(specific) {
		return JSON.stringify(preset_payload(this.view.settings, this.defaults, { specific, keys: this.list?.keys }));
	}

	base_args() {
		return { context: this.target.context, target: this.target.target };
	}

	/** After a save: the list again, the preset applied, the user's settings saved with it. */
	async saved(row, message) {
		this.applied = row;
		await this.reload();
		this.applied = find_preset(this.list, row.name) || row;
		this.view.save_settings();
		if (this.is_open) this.render();
		frappe.show_alert?.({ message, indicator: "green" });
	}

	async save_over() {
		const a = this.applied;
		if (!a?.can_edit) return;
		const row = await call("save", { ...this.base_args(), name: a.name, settings: this.payload(a.specific) }, "POST");
		if (row) await this.saved(row, __("Preset «{0}» saved", [row.preset_name]));
	}

	visibility_field(value) {
		if (!this.list?.can_publish) return [];
		return [
			{
				fieldname: "visibility",
				fieldtype: "Select",
				label: __("Who sees it"),
				options: [
					{ value: "private", label: __("Private: only me") },
					{ value: "public", label: __("Public: every user") },
				],
				default: value,
			},
		];
	}

	dialog({ title, fields, primary, values }) {
		const d = new frappe.ui.Dialog({
			title,
			fields,
			primary_action_label: primary,
			primary_action: async (v) => {
				const vals = v || d.get_values();
				if (!vals || !String(vals.preset_name || "").trim()) return;
				d.disable_primary_action?.();
				try {
					await values(vals);
					d.hide();
				} catch {
					// the server said why (frappe.call shows its message); the dialog stays
				} finally {
					d.enable_primary_action?.();
				}
			},
		});
		d.show();
		return d;
	}

	save_new() {
		const sw = this.scope_words();
		const a = this.applied;
		const target_label = __(this.target.target);
		this.dialog({
			title: __("Save the print settings as a new preset"),
			primary: __("Save", null, "Print preset"),
			fields: [
				{ fieldname: "preset_name", fieldtype: "Data", label: __("Name", null, "Report View"), reqd: 1, default: a ? __("{0} (copy)", [a.preset_name]) : "" },
				...this.visibility_field("private"),
				{
					fieldname: "scope",
					fieldtype: "Select",
					label: __("Offered for"),
					// a sent template has no target of its own: its presets are for every format
					hidden: this.target.target ? 0 : 1,
					options: [
						{ value: "target", label: sw.only(target_label) },
						{ value: "all", label: sw.every() },
					],
					default: !this.target.target || (a && !a.specific) ? "all" : "target",
					description: __("A preset for every target keeps the columns and the print format of each one as they are."),
				},
				{ fieldname: "description", fieldtype: "Small Text", label: __("Description") },
				{ fieldname: "is_default", fieldtype: "Check", label: __("Use as the default"), description: __("Applied when the pages open with no settings of the user's own") },
			],
			values: async (v) => {
				const specific = v.scope !== "all";
				const row = await call(
					"save",
					{
						...this.base_args(),
						preset_name: v.preset_name.trim(),
						settings: this.payload(specific),
						public: v.visibility === "public" ? 1 : 0,
						for_all: specific ? 0 : 1,
						description: v.description || "",
						is_default: v.is_default ? 1 : 0,
					},
					"POST"
				);
				if (row) await this.saved(row, __("Preset «{0}» saved", [row.preset_name]));
			},
		});
	}

	edit() {
		const a = this.applied;
		if (!a?.can_edit) return;
		this.dialog({
			title: __("Edit the preset «{0}»", [a.preset_name]),
			primary: __("Save", null, "Print preset"),
			fields: [
				{ fieldname: "preset_name", fieldtype: "Data", label: __("Name", null, "Report View"), reqd: 1, default: a.preset_name },
				...this.visibility_field(a.public ? "public" : "private"),
				{ fieldname: "description", fieldtype: "Small Text", label: __("Description"), default: a.description || "" },
				{ fieldname: "is_default", fieldtype: "Check", label: __("Use as the default"), default: a.is_default ? 1 : 0 },
			],
			values: async (v) => {
				const args = { ...this.base_args(), name: a.name, preset_name: v.preset_name.trim(), description: v.description || "", is_default: v.is_default ? 1 : 0 };
				if (v.visibility) args.public = v.visibility === "public" ? 1 : 0;
				const row = await call("save", args, "POST");
				if (row) await this.saved(row, __("Preset «{0}» saved", [row.preset_name]));
			},
		});
	}

	remove() {
		const a = this.applied;
		if (!a?.can_edit) return;
		const message = a.public ? __("Delete the public preset «{0}»? Every user loses it.", [a.preset_name]) : __("Delete the preset «{0}»?", [a.preset_name]);
		frappe.confirm(esc(message), async () => {
			await call("delete", { name: a.name }, "POST");
			this.applied = null;
			await this.reload();
			this.view.save_settings();
			frappe.show_alert?.({ message: __("Preset «{0}» deleted", [a.preset_name]), indicator: "green" });
		});
	}

	async toggle_default(name) {
		const r = find_preset(this.list, name);
		if (!r?.can_edit) return;
		await call("set_default", { name, value: r.is_default ? 0 : 1 }, "POST");
		await this.reload();
	}

	destroy() {
		this.close(false);
	}
}
