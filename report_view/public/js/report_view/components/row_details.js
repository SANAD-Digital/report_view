// Row details (ADR-023; design: the canvas "Report tables and row details", Drawer.dc.html and
// Dialog.dc.html): one row of the report in a drawer from the inline end, or in a dialog, as
// the report's settings say (state/row_details.js row_details_config). Its content is the row's
// fields (labelled, formatted with frappe.format, its key measures as tiles), or the report's
// HTML template or Custom print format rendered on the server (report_view.api
// .render_row_details) and shown in a sandboxed frame. ↑/↓ and the two arrow buttons move to the
// previous and next row of the table, Esc closes; the focus stays inside the panel and goes back
// to the button that opened it. On a phone (≤ 900px) the drawer is a bottom sheet.
//
// The panel draws; the page (index.js) supplies the row and its neighbours (`source`).

import { esc } from "../util.js";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';
const svg = (body, size = 16) =>
	`<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const CHEVRON_RIGHT = svg('<path d="M6 4l4 4-4 4"></path>');
const CHEVRON_LEFT = svg('<path d="M10 4L6 8l4 4"></path>');
const CLOSE = svg('<path d="M4 4l8 8M12 4l-8 8"></path>');
/** The icon of the row details button (an arrow out of a box). */
export const DETAILS_ICON = svg('<path d="M9 3h4v4M13 3l-5 5M7 4H4.5A1.5 1.5 0 0 0 3 5.5v6A1.5 1.5 0 0 0 4.5 13h6a1.5 1.5 0 0 0 1.5-1.5V9"></path>', 14);

/** The button of a row in the first column: faint, strong on the row's hover and focus (rv_table.css). */
export function details_button_html() {
	const label = esc(__("Row details", null, "Report View"));
	return `<button type="button" class="rv-rd-btn" aria-label="${label}" title="${label}" aria-haspopup="dialog">${DETAILS_ICON}</button>`;
}

const in_field = (el) => Boolean(el?.closest?.("input,textarea,select,[contenteditable=''],[contenteditable=true]"));

/**
 * @typedef {object} RowDetailsSource
 * @property {() => object} conf row_details_config() of the report
 * @property {(row: object) => {title: string, code: string, subtitle: string, tiles: Array, fields: Array, document: {doctype: string, name: string}|null}} describe
 *   what the panel shows of a row: tiles and fields are {label, html, sign}
 * @property {(y: number, dir: 1|-1) => Promise<{y: number, row: object}|null>} step the previous or next row of the table
 * @property {(y: number|null) => void} mark the row the panel shows, marked in the table
 * @property {(y: number) => boolean} focus_row the focus to the button of a row, when it is on screen
 * @property {(row: object) => Promise<{html: string, css: string}>} render the server's template of a row
 * @property {(row: object) => Array<{label: string, act: () => void}>} [extra] more verbs of a row
 *   (the configured drill, phase 5d), after the document's
 */

export class RowDetails {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.root the .rv element (tokens and direction)
	 * @param {boolean} o.rtl
	 * @param {RowDetailsSource} o.source
	 */
	constructor({ root, rtl, source }) {
		this.root = root;
		this.rtl = rtl;
		this.source = source;
		this.el = null;
		this.scrim = null;
		this.y = null;
		this.row = null;
		this.opener = null;
		this.token = 0;
		this.on_key = (e) => this.key(e);
	}

	get is_open() {
		return Boolean(this.el);
	}

	/**
	 * @param {{y: number, row: object, opener?: HTMLElement}} at
	 */
	open({ y, row, opener = null }) {
		const conf = this.source.conf();
		if (!this.el) this.mount(conf);
		this.opener = opener || this.opener;
		this.show(y, row);
	}

	mount(conf) {
		this.conf = conf;
		const dialog = conf.container === "dialog";
		const scrim = document.createElement("div");
		scrim.className = "rv-rd-scrim";
		scrim.addEventListener("click", () => this.close());
		const el = document.createElement("section");
		el.className = `rv-rd ${dialog ? "rv-rd-dialog" : "rv-rd-drawer"} w-${conf.width}`;
		el.setAttribute("role", "dialog");
		el.setAttribute("aria-modal", "true");
		el.setAttribute("aria-labelledby", "rv-rd-title");
		el.tabIndex = -1;
		const [prev_icon, next_icon] = this.rtl ? [CHEVRON_RIGHT, CHEVRON_LEFT] : [CHEVRON_LEFT, CHEVRON_RIGHT];
		el.innerHTML = `
			<header class="rv-rd-hd">
				<div class="rv-rd-hgroup">
					<div class="rv-rd-sub"></div>
					<div class="rv-rd-heading"><bdi class="rv-rd-code"></bdi><h2 class="rv-rd-title" id="rv-rd-title"></h2></div>
				</div>
				<button type="button" class="rv-rd-icon rv-rd-prev" data-step="-1" aria-label="${esc(__("Previous row"))}" title="${esc(__("Previous row"))}">${prev_icon}</button>
				<button type="button" class="rv-rd-icon rv-rd-next" data-step="1" aria-label="${esc(__("Next row"))}" title="${esc(__("Next row"))}">${next_icon}</button>
				<button type="button" class="rv-rd-icon ghost rv-rd-close" aria-label="${esc(__("Close"))}" title="${esc(__("Close"))}">${CLOSE}</button>
			</header>
			<div class="rv-rd-body" tabindex="-1"></div>
			<footer class="rv-rd-ft">
				<div class="rv-rd-actions"></div>
				<span class="rv-rd-hint">${esc(__("↑ ↓ to move between rows"))}</span>
			</footer>`;
		el.addEventListener("click", (e) => {
			const step = e.target.closest?.("[data-step]");
			if (step) this.step(Number(step.dataset.step));
			else if (e.target.closest?.(".rv-rd-close")) this.close();
			else if (e.target.closest?.("[data-act=print-doc]")) this.print_document();
			else if (e.target.closest?.("[data-act=print-frame]")) this.print_frame();
			else if (e.target.closest?.("[data-extra]")) this.extra[Number(e.target.closest("[data-extra]").dataset.extra)]?.act();
		});
		el.addEventListener("keydown", this.on_key);
		this.root.append(scrim, el);
		this.el = el;
		this.scrim = scrim;
		el.focus({ preventScroll: true });
	}

	close() {
		if (!this.el) return;
		const y = this.y;
		this.token += 1;
		this.el.remove();
		this.scrim.remove();
		this.el = null;
		this.scrim = null;
		this.source.mark(null);
		// back to the button that opened the panel, or the one of the row shown last
		const opener = this.opener;
		this.opener = null;
		this.y = null;
		this.row = null;
		if (y !== null && this.source.focus_row(y)) return;
		if (opener?.isConnected) opener.focus({ preventScroll: true });
	}

	/** The table's rows changed (a new run, another view): the panel closes. */
	reset() {
		if (this.el) this.close();
	}

	async step(dir) {
		if (this.y === null || this.busy) return;
		this.busy = true;
		try {
			const next = await this.source.step(this.y, dir);
			if (next && this.el) this.show(next.y, next.row);
		} finally {
			this.busy = false;
		}
	}

	show(y, row) {
		const token = ++this.token;
		this.y = y;
		this.row = row;
		this.source.mark(y);
		const d = this.source.describe(row);
		const el = this.el;
		el.querySelector(".rv-rd-sub").textContent = d.subtitle || "";
		const code = el.querySelector(".rv-rd-code");
		code.textContent = d.code || "";
		code.hidden = !d.code;
		el.querySelector(".rv-rd-title").textContent = d.title;
		el.dataset.y = String(y);
		const body = el.querySelector(".rv-rd-body");
		const conf = this.conf;
		this.document = d.document;
		if (conf.content === "fields") {
			body.innerHTML = this.fields_html(d);
			this.actions(d.document, false);
		} else {
			this.actions(d.document, false);
			this.frame(body, row, token);
		}
		body.scrollTop = 0;
	}

	fields_html(d) {
		const tile = (t) =>
			`<div class="rv-rd-tile"><div class="rv-rd-tile-k">${esc(t.label)}</div><div class="rv-rd-tile-v${t.sign ? ` ${t.sign}` : ""}">${t.html}</div></div>`;
		const field = (f) => `<dt>${esc(f.label)}</dt><dd class="${[f.numeric && "num", f.sign].filter(Boolean).join(" ")}">${f.html || '<span class="rv-rd-empty">—</span>'}</dd>`;
		const tiles = d.tiles.length ? `<div class="rv-rd-tiles">${d.tiles.map(tile).join("")}</div>` : "";
		return `${tiles}<section class="rv-rd-sec"><h3>${esc(__("All fields of the row"))}</h3><dl class="rv-rd-fields">${d.fields.map(field).join("")}</dl></section>`;
	}

	// The footer's verbs: the row's document (open, print), the printed content.
	actions(doc, printable) {
		const out = [];
		if (doc) {
			const href = frappe.utils.get_form_link ? frappe.utils.get_form_link(doc.doctype, doc.name) : `/app/${encodeURIComponent(doc.doctype)}/${encodeURIComponent(doc.name)}`;
			out.push(`<a class="rv-rd-act pri" href="${esc(href)}">${esc(__("Open {0}", [__(doc.doctype)]))}</a>`);
			if (frappe.model?.can_print?.(doc.doctype)) out.push(`<button type="button" class="rv-rd-act" data-act="print-doc">${esc(__("Print"))}</button>`);
		}
		if (printable) out.push(`<button type="button" class="rv-rd-act" data-act="print-frame">${esc(__("Print"))}</button>`);
		this.extra = (this.row && this.source.extra?.(this.row)) || [];
		this.extra.forEach((x, i) => out.push(`<button type="button" class="rv-rd-act" data-extra="${i}">${esc(x.label)}</button>`));
		this.el.querySelector(".rv-rd-actions").innerHTML = out.join("");
	}

	print_document() {
		if (this.document) frappe.utils.print(this.document.doctype, this.document.name);
	}

	print_frame() {
		this.el?.querySelector(".rv-rd-frame")?.contentWindow?.print();
	}

	// The server's template of the row, in a frame without scripts.
	async frame(body, row, token) {
		const conf = this.conf;
		if (conf.content === "print_format" && !conf.print_format) {
			body.innerHTML = this.state_html(__("No print format is set for this report's row details"), __("Choose one in Report View Settings."));
			return;
		}
		body.innerHTML = `<div class="rv-rd-state" role="status">${esc(__("Loading…"))}</div>`;
		let out;
		try {
			out = await this.source.render(row);
		} catch (e) {
			if (token !== this.token || !this.el) return;
			body.innerHTML = this.state_html(__("The row details could not be shown"), e?.message || "");
			return;
		}
		if (token !== this.token || !this.el) return;
		if (!out || typeof out.html !== "string") {
			body.innerHTML = this.state_html(__("Row details are not configured for this report"), "");
			return;
		}
		// The frame gets its document before it is in the page, and is shown once it is loaded:
		// a layout of the panel while the frame loaded made Firefox warn of a layout forced
		// before the frame's page was loaded.
		const paper_el = document.createElement("div");
		paper_el.className = "rv-rd-paper";
		const frame = document.createElement("iframe");
		frame.className = "rv-rd-frame";
		frame.setAttribute("sandbox", "allow-same-origin allow-modals");
		frame.title = __("Row details", null, "Report View");
		frame.hidden = true;
		const dir = this.rtl ? "rtl" : "ltr";
		const lang = esc(document.documentElement.lang || "");
		// the paper's colours (rv_tokens.css --pp-*: a printed page never turns dark)
		const cs = getComputedStyle(this.root);
		const paper = (name) => cs.getPropertyValue(name).replace(/[<>;{}]/g, "").trim();
		frame.srcdoc = `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><style>html,body{margin:0;background:${paper("--pp-bg")};color:${paper("--pp-tx")};font-family:${cs.fontFamily.replace(/[<>;{}]/g, "")}}body{padding:24px}${String(out.css || "").replace(/<\/style/gi, "")}</style></head><body>${out.html}</body></html>`;
		frame.addEventListener("load", () => {
			if (token !== this.token) return;
			const doc = frame.contentDocument;
			if (!doc) return;
			// its keys move and close as the panel's do; the frame as tall as its page, read
			// on the next frame, once it is shown
			doc.addEventListener("keydown", this.on_key);
			frame.hidden = false;
			requestAnimationFrame(() => {
				if (token === this.token && frame.isConnected) frame.style.height = `${Math.max(240, doc.documentElement.scrollHeight)}px`;
			});
			this.actions(this.document, true);
		});
		paper_el.append(frame);
		body.replaceChildren(paper_el);
	}

	state_html(title, text) {
		return `<div class="rv-rd-state" role="status"><div class="rv-rd-state-t">${esc(title)}</div>${text ? `<div class="rv-rd-state-s">${esc(text)}</div>` : ""}</div>`;
	}

	key(e) {
		if (!this.el) return;
		if (e.key === "Escape") {
			e.preventDefault();
			e.stopPropagation();
			this.close();
			return;
		}
		if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !in_field(e.target) && !e.altKey && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			this.step(e.key === "ArrowUp" ? -1 : 1);
			return;
		}
		if (e.key === "Tab" && e.target.ownerDocument === document) this.trap(e);
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
