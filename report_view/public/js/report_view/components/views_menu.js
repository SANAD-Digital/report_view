// The «Views» menu of the report's head (ADR-010): the saved views of the report, the user's
// own and the ones shared with them, applied in one click; save, save as new (who sees it:
// private, roles or everyone), edit (name, who sees it), delete, and the user's own default
// (the star). The button names the view applied and shows a dot once the page no longer
// shows it as saved. A phone gets the menu as a sheet from the bottom, as the print presets'
// (the same .rv-print-pop rules). The records and their rules are the server's
// (report_view.api.views, core/saved_views.py); this component only draws and asks
// (host/saved_views_host.js).
// Titles and owners' names are typed by users and seen by others: always escaped.

import { icons } from "./icons.js";
import { esc } from "../util.js";

const bookmark = () =>
	'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"></path></svg>';

const SHEET_QUERY = "(max-width: 900px), (pointer: coarse)";

/** The words of a visibility, for its badge. */
export function visibility_label(v) {
	if (v === "Public") return __("Public", null, "Saved view");
	if (v === "Roles") return __("Roles", null, "Saved view");
	return __("Private", null, "Saved view");
}

export class ViewsMenu {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.parent where the control goes (the head's slot)
	 * @param {boolean} o.rtl
	 * @param {object} o.on {open(), apply(name|null), save(), save_new(), edit(), remove(), star(name)}
	 */
	constructor({ parent, rtl, on }) {
		this.rtl = rtl;
		this.on = on;
		this.list = null;
		this.applied = null;
		this.modified = false;
		this.busy = false;
		this.is_open = false;
		const el = document.createElement("div");
		el.className = "rv-views";
		el.hidden = true;
		el.innerHTML = `<button type="button" class="rv-btn ghost rv-views-btn" aria-haspopup="dialog" aria-expanded="false">${bookmark()}<span class="nm"></span><i class="dot" aria-hidden="true" hidden></i><span class="chev">${icons.chevron_down(12)}</span></button>`;
		parent.append(el);
		this.el = el;
		this.btn = el.querySelector(".rv-views-btn");
		this.btn.addEventListener("click", () => (this.is_open ? this.close() : this.open()));
		this.on_outside = (e) => {
			if (!this.is_open || this.el.contains(e.target) || e.target.closest?.(".modal, .modal-backdrop, .rv-test-dialog, .awesomplete, .dropdown-menu")) return;
			this.close(false);
		};
		this.on_key = (e) => {
			if (e.key === "Escape" && this.is_open && !document.querySelector(".modal.show, .rv-test-dialog")) {
				e.stopPropagation();
				this.close();
			}
		};
		this.on_resize = () => this.place();
		this.paint();
	}

	/** Shown once the report is known (hidden while it loads or when it cannot open). */
	show(on) {
		this.el.hidden = !on;
		if (!on) this.close(false);
	}

	/** @param {{mine: Array, shared: Array}|null} list */
	set_list(list) {
		this.list = list;
		// the rows only: the actions stay the same elements (a press on them is never lost)
		if (this.is_open) this.render_body();
	}

	/** @param {object|null} applied the view applied ({name, title, visibility, is_owner}) */
	set_applied(applied, modified = false) {
		this.applied = applied;
		this.modified = Boolean(applied) && modified;
		this.paint();
		if (this.is_open) {
			this.render_body();
			this.render_acts();
		}
	}

	set_modified(modified) {
		const m = Boolean(this.applied) && modified;
		if (m === this.modified) return;
		this.modified = m;
		this.paint();
		if (this.is_open) this.render_acts();
	}

	/** The button: the view applied (or «Views»), and the dot of a change. */
	paint() {
		const a = this.applied;
		const name = a ? a.title : __("Views", null, "Saved views");
		this.el.querySelector(".nm").textContent = name;
		this.el.querySelector(".dot").hidden = !this.modified;
		this.btn.classList.toggle("on", Boolean(a));
		const title = !a
			? __("Saved views")
			: this.modified
				? __("View: {0} (changed since it was applied)", [a.title])
				: __("View: {0}", [a.title]);
		this.btn.title = title;
		this.btn.setAttribute("aria-label", title);
	}

	// ------------------------------------------------------------ the menu

	open() {
		this.is_open = true;
		this.btn.setAttribute("aria-expanded", "true");
		this.render();
		document.addEventListener("pointerdown", this.on_outside, true);
		document.addEventListener("keydown", this.on_key, true);
		window.addEventListener("resize", this.on_resize, { passive: true });
		this.on.open?.();
		const sheet = window.matchMedia(SHEET_QUERY).matches;
		const menu = this.el.querySelector(".rv-views-pop");
		(sheet ? menu : menu?.querySelector("[aria-current='true'], .rv-preset-row"))?.focus({ preventScroll: true });
	}

	close(focus = true) {
		if (!this.is_open) return;
		this.is_open = false;
		this.btn.setAttribute("aria-expanded", "false");
		for (const n of this.el.querySelectorAll(".rv-views-pop, .rv-print-scrim")) n.remove();
		document.removeEventListener("pointerdown", this.on_outside, true);
		document.removeEventListener("keydown", this.on_key, true);
		window.removeEventListener("resize", this.on_resize, { passive: true });
		if (focus) this.btn.focus({ preventScroll: true });
	}

	row_html(r) {
		const on = this.applied?.name === r.name;
		const meta = [
			r.is_owner ? (r.visibility === "Roles" ? __("Shared with roles") : r.visibility === "Public" ? __("Shared with everyone") : __("Only you")) : __("By {0}", [r.owner_name || r.owner]),
			r.is_global_default ? __("The report's default") : "",
			r.description,
		]
			.filter(Boolean)
			.join(" · ");
		const star_label = r.is_user_default ? __("Your default: opened with the report. Press to stop") : __("Open the report with this view");
		return `<li class="rv-preset-item${on ? " on" : ""}">
			<button type="button" class="rv-preset-row" data-apply="${esc(r.name)}" ${on ? 'aria-current="true"' : ""}>
				<span class="ck" aria-hidden="true">${on ? icons.check_sm() : ""}</span>
				<span class="tx"><span class="nm">${esc(r.title)}</span><span class="meta">${esc(meta)}</span></span>
				<span class="rv-preset-badge ${r.visibility === "Private" ? "priv" : "pub"}">${esc(visibility_label(r.visibility))}</span>
			</button><button type="button" class="rv-preset-star${r.is_user_default ? " on" : ""}" data-star="${esc(r.name)}" aria-pressed="${r.is_user_default ? "true" : "false"}" aria-label="${esc(star_label)}" title="${esc(star_label)}">${icons.star()}</button></li>`;
	}

	/** The rows: the standard view, the user's own views, the ones shared with them. */
	body_html() {
		const l = this.list;
		const std_on = !this.applied;
		const group = (title, rows, empty) =>
			`<h5 class="rv-preset-grp">${esc(title)}</h5>${rows.length ? `<ul class="rv-preset-ul">${rows.map((r) => this.row_html(r)).join("")}</ul>` : `<p class="rv-preset-empty">${esc(empty)}</p>`}`;
		const lists = !l
			? `<p class="rv-preset-empty rv-views-loading" role="status">${esc(__("Loading…"))}</p>`
			: `${group(__("My views"), l.mine || [], __("None yet: «Save as new» keeps what the report shows now under a name."))}
				${group(__("Shared with me"), l.shared || [], __("No views are shared with you for this report."))}`;
		return `<ul class="rv-preset-ul"><li class="rv-preset-item${std_on ? " on" : ""}"><button type="button" class="rv-preset-row" data-apply="" ${std_on ? 'aria-current="true"' : ""}>
					<span class="ck" aria-hidden="true">${std_on ? icons.check_sm() : ""}</span>
					<span class="tx"><span class="nm">${esc(__("Standard", null, "Saved view"))}</span><span class="meta">${esc(__("The report as it opens without a saved view"))}</span></span></button><span class="rv-preset-star"></span></li></ul>
				${lists}`;
	}

	render_body() {
		const body = this.el.querySelector(".rv-views-pop .rv-preset-body");
		if (!body) return;
		const focused = document.activeElement?.closest?.(".rv-views-pop [data-apply], .rv-views-pop [data-star]");
		const again = focused ? (focused.dataset.star !== undefined ? `[data-star="${focused.dataset.star}"]` : `[data-apply="${focused.dataset.apply}"]`) : null;
		body.innerHTML = this.body_html();
		// the focus stays on the row it was on
		if (again) body.querySelector(again)?.focus({ preventScroll: true });
	}

	render() {
		for (const n of this.el.querySelectorAll(".rv-views-pop, .rv-print-scrim")) n.remove();
		const scrim = document.createElement("div");
		scrim.className = "rv-print-scrim";
		scrim.setAttribute("aria-hidden", "true");
		scrim.addEventListener("click", () => this.close());
		const menu = document.createElement("div");
		menu.className = "rv-print-pop rv-preset-pop rv-views-pop";
		menu.tabIndex = -1;
		menu.setAttribute("role", "dialog");
		menu.setAttribute("aria-label", __("Saved views"));
		menu.innerHTML = `
			<div class="rv-pop-hd"><strong>${esc(__("Saved views"))}</strong><span>${esc(__("Layouts of this report saved under a name, applied in one click"))}</span>
				<button type="button" class="rv-pop-x" aria-label="${esc(__("Close"))}">${icons.close()}</button></div>
			<div class="rv-preset-body">${this.body_html()}</div>
			<div class="rv-preset-acts"></div>`;
		menu.querySelector(".rv-pop-x").addEventListener("click", () => this.close());
		menu.addEventListener("click", (e) => {
			if (this.busy) return;
			const star = e.target.closest("button[data-star]");
			if (star) return this.on.star(star.dataset.star);
			const row = e.target.closest("[data-apply]");
			if (row) {
				this.close();
				this.on.apply(row.dataset.apply || null);
			}
		});
		this.el.append(scrim, menu);
		this.render_acts();
		this.place();
	}

	render_acts() {
		const acts = this.el.querySelector(".rv-views-pop .rv-preset-acts");
		if (!acts) return;
		const a = this.applied;
		const own = Boolean(a?.is_owner);
		const save_title = !a
			? __("Apply a view of your own first, or save what the report shows as a new one")
			: !own
				? __("Only its owner can change this view: «Save as new» keeps a copy of your own")
				: this.modified
					? __("Save what the report shows now into «{0}»", [a.title])
					: __("No change to save");
		acts.innerHTML = `
			<button type="button" class="rv-btn sm primary" data-act="save" ${own && this.modified ? "" : "disabled"} title="${esc(save_title)}">${esc(__("Save", null, "Saved view"))}</button>
			<button type="button" class="rv-btn sm" data-act="save-new">${esc(__("Save as new…"))}</button>
			<span class="sp"></span>
			<button type="button" class="rv-btn sm ghost" data-act="edit" ${own ? "" : "disabled"}>${esc(__("Edit…", null, "Saved view"))}</button>
			<button type="button" class="rv-btn sm ghost rv-preset-del" data-act="delete" ${own ? "" : "disabled"}>${esc(__("Delete"))}</button>`;
		for (const b of acts.querySelectorAll("[data-act]")) {
			b.addEventListener("click", () => {
				if (this.busy) return;
				const act = b.dataset.act;
				if (act === "save") this.on.save();
				else if (act === "save-new") this.on.save_new();
				else if (act === "edit") this.on.edit();
				else this.on.remove();
			});
		}
	}

	/** The menu under its button, inside the window (a sheet on a phone, by CSS). */
	place() {
		const menu = this.el.querySelector(".rv-views-pop");
		if (!menu) return;
		const r = this.btn.getBoundingClientRect();
		const w = Math.min(380, window.innerWidth - 16);
		// the inline-end edges of the button and the menu line up (the head's actions are at
		// the inline end of the page)
		const start = this.rtl ? r.left : r.right - w;
		Object.assign(menu.style, {
			top: `${Math.round(r.bottom + 6)}px`,
			left: `${Math.round(Math.max(8, Math.min(start, window.innerWidth - w - 8)))}px`,
			width: `${w}px`,
			maxHeight: `${Math.max(240, Math.round(window.innerHeight - r.bottom - 18))}px`,
		});
	}

	destroy() {
		this.close(false);
		this.el.remove();
	}
}
