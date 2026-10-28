// A drawer or a dialog of the page (the shell of the row details panel, components/row_details.js,
// with its classes and tokens: .rv-rd, .rv-rd-drawer / .rv-rd-dialog, .rv-rd-hd, .rv-rd-body,
// .rv-rd-ft): a title and a subtitle, a body the caller fills, verbs in the footer, Esc and the
// close button, the focus kept inside and given back to what opened it. Used by the drill
// (host/drill_host.js), the document of a link (link_open "Drawer") and the range chart.

import { esc } from "../util.js";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';
const CLOSE =
	'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"></path></svg>';
let seq = 0;

export class Drawer {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.root the .rv element (tokens and direction)
	 * @param {string} o.title
	 * @param {string} [o.subtitle]
	 * @param {"drawer"|"dialog"} [o.container]
	 * @param {"narrow"|"medium"|"wide"} [o.width]
	 * @param {string} [o.cls] classes added to the panel
	 * @param {string} [o.hint] a hint in the footer
	 * @param {() => void} [o.on_close] after the panel is gone
	 */
	constructor({ root, title, subtitle = "", container = "drawer", width = "wide", cls = "", hint = "", on_close = null }) {
		this.root = root;
		this.on_close = on_close;
		this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const id = `rv-dw-title-${++seq}`;
		const scrim = document.createElement("div");
		scrim.className = "rv-rd-scrim";
		scrim.addEventListener("click", () => this.close());
		const el = document.createElement("section");
		el.className = `rv-rd ${container === "dialog" ? "rv-rd-dialog" : "rv-rd-drawer"} w-${width} ${cls}`.trim();
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-labelledby", id);
		el.tabIndex = -1;
		el.innerHTML = `
			<header class="rv-rd-hd">
				<div class="rv-rd-hgroup">
					<div class="rv-rd-sub"></div>
					<div class="rv-rd-heading"><h2 class="rv-rd-title" id="${id}"></h2></div>
				</div>
				<button type="button" class="rv-rd-icon ghost rv-rd-close" aria-label="${esc(__("Close"))}" title="${esc(__("Close"))}">${CLOSE}</button>
			</header>
			<div class="rv-rd-body" tabindex="-1"></div>
			<footer class="rv-rd-ft">
				<div class="rv-rd-actions"></div>
				${hint ? `<span class="rv-rd-hint">${esc(hint)}</span>` : ""}
			</footer>`;
		el.querySelector(".rv-rd-close").addEventListener("click", () => this.close());
		this.on_key = (e) => this.key(e);
		el.addEventListener("keydown", this.on_key);
		root.append(scrim, el);
		this.el = el;
		this.scrim = scrim;
		this.body = el.querySelector(".rv-rd-body");
		this.set_title(title, subtitle);
		el.focus({ preventScroll: true });
	}

	get is_open() {
		return Boolean(this.el);
	}

	set_title(title, subtitle = "") {
		if (!this.el) return;
		this.el.querySelector(".rv-rd-title").textContent = title || "";
		const sub = this.el.querySelector(".rv-rd-sub");
		sub.textContent = subtitle || "";
		sub.hidden = !subtitle;
	}

	/** The footer's verbs: [{label, href?, primary?, act?, key?}] (a link opens as it says). */
	set_actions(items) {
		if (!this.el) return;
		const box = this.el.querySelector(".rv-rd-actions");
		box.replaceChildren(
			...items.map((it) => {
				const b = document.createElement(it.href ? "a" : "button");
				b.className = `rv-rd-act${it.primary ? " pri" : ""}`;
				if (it.href) {
					b.href = it.href;
					if (it.target) {
						b.target = it.target;
						b.rel = "noopener";
					}
				} else b.type = "button";
				if (it.key) b.dataset.act = it.key;
				b.textContent = it.label;
				if (it.act) b.addEventListener("click", (e) => it.act(e));
				return b;
			})
		);
	}

	/** A state of the body (loading, an error, nothing found). */
	state(title, text = "", tone = "") {
		if (!this.el) return;
		this.body.innerHTML = `<div class="rv-rd-state${tone ? ` ${tone}` : ""}" role="status"><div class="rv-rd-state-t">${esc(title)}</div>${text ? `<div class="rv-rd-state-s">${esc(text)}</div>` : ""}</div>`;
	}

	close() {
		if (!this.el) return;
		this.el.remove();
		this.scrim.remove();
		this.el = null;
		this.scrim = null;
		const opener = this.opener;
		this.opener = null;
		if (opener?.isConnected) opener.focus({ preventScroll: true });
		if (this.on_close) this.on_close();
	}

	key(e) {
		if (!this.el) return;
		if (e.key === "Escape") {
			// a control inside took it (a range of the drill's grid cleared)
			if (e.defaultPrevented) return;
			e.preventDefault();
			e.stopPropagation();
			this.close();
			return;
		}
		if (e.key === "Tab") this.trap(e);
	}

	// Tab and Shift+Tab go round the panel's controls.
	trap(e) {
		const items = [...this.el.querySelectorAll(FOCUSABLE)].filter((n) => !n.hidden && n.getClientRects().length);
		if (!items.length) {
			e.preventDefault();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || active === this.el || !this.el.contains(active))) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (active === last || !this.el.contains(active))) {
			e.preventDefault();
			first.focus();
		}
	}
}
