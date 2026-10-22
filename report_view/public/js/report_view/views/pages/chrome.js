// The furniture of a page of the Pages view (views/pages_view.js): the head (letter head,
// title block, print details, filters), the print heading, the foot (footer, number band,
// signature), the watermark and border, and the CSS variables they read. Methods of PagesView.

import { font_info, font_stack } from "../../fonts.js";
import { esc, fmt_int } from "../../util.js";
import { COLOR, COLOR_TOKENS, MIN_ROOM, PERIOD_KEYS, on_page } from "./settings.js";
import { page_spans } from "./support.js";

export class PagesChrome {
	/** The sizes, places and rules of the letter head, footer and number, as CSS variables of the pages. */
	apply_vars(s) {
		const set = (k, v) => this.root.style.setProperty(k, v);
		const block = (b) => `${b.top}mm ${b.bottom}mm`;
		const inline = (b) => `${b.start}mm ${b.end}mm`;
		const flex = { start: "flex-start", center: "center", end: "flex-end" };
		if (s.font && font_info(s.font)) set("--pp-font", font_stack(s.font));
		else this.root.style.removeProperty("--pp-font");
		set("--pp-lh-h", `${s.lh_height}mm`);
		set("--pp-lhf-h", `${s.foot_height}mm`);
		set("--pp-lh-align", flex[s.lh_align] || "center");
		set("--pp-lhf-align", flex[s.foot_align] || "center");
		for (const k of ["lh", "foot", "num"]) {
			set(`--pp-${k}-mb`, block(s[`${k}_m`]));
			set(`--pp-${k}-mi`, inline(s[`${k}_m`]));
		}
		set("--pp-num-fs", `${s.number_size}pt`);
		set("--pp-hdg-fs", `${s.heading_size}pt`);
		set("--pp-sig-fs", `${s.sig_size}pt`);
		set("--pp-sig-mb", block(s.sig_m));
		set("--pp-sig-mi", inline(s.sig_m));
		set("--pp-hdg-align", s.heading_align);
		set("--pp-hdg-mb", block(s.heading_m));
		set("--pp-hdg-mi", inline(s.heading_m));
		for (const k of ["head_line", "heading_line", "foot_line", "num_line"]) {
			const w = s[`${k}_w`];
			// a double rule needs three pixels to show its two lines
			const width = s[`${k}_s`] === "double" ? Math.max(3, w) : w;
			set(`--pp-${k.replace("_", "-")}`, w ? `${width}px ${s[`${k}_s`]} ${this.color_of(s, `${k}_c`)}` : "0 solid transparent");
		}
		set("--pp-wm-color", this.color_of(s, "wm_color"));
		set("--pp-wm-size", `${s.wm_size}pt`);
		set("--pp-wm-op", String(s.wm_opacity / 100));
		set("--pp-wm-angle", `${s.wm_angle}deg`);
		set("--pp-wm-w", `${s.wm_scale}%`);
		// a watermark follows its settings on the pages already drawn
		for (const page of this.sheets.querySelectorAll(".rv-page[data-page]")) {
			for (const el of page.querySelectorAll(":scope > .rv-page-wm, :scope > .rv-page-border")) el.remove();
			page.insertAdjacentHTML("beforeend", this.watermark_html(Number(page.dataset.page)));
		}
		set("--pp-pb", `${s.pb_s === "double" ? Math.max(3, s.pb_w) : s.pb_w}px ${s.pb_s} ${this.color_of(s, "pb_c")}`);
		set("--pp-pb-off", `${s.pb_offset}mm`);
		set("--pp-pb-r", `${s.pb_radius}mm`);
	}

	/**
	 * A colour setting as #rrggbb: the one chosen, else the paper's (COLOR_TOKENS, read from
	 * rv_tokens.css): the colour field shows it, and the printed sheets carry it as written.
	 */
	color_of(s, key) {
		return s[key] || this.token_color(COLOR_TOKENS[key]);
	}

	token_color(name) {
		if (!this._tokens) this._tokens = new Map();
		if (!this._tokens.has(name)) {
			let value = getComputedStyle(this.root).getPropertyValue(name).trim();
			if (value && !COLOR.test(value)) {
				// a token written another way (rgb(), a short #rgb): as the browser computes it
				const probe = document.createElement("i");
				probe.style.color = `var(${name})`;
				this.root.appendChild(probe);
				const rgb = getComputedStyle(probe).color.match(/\d+(\.\d+)?/g) || [];
				probe.remove();
				value = rgb.length >= 3 ? `#${rgb.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("")}` : "";
			}
			// not kept before the tokens are there (the stylesheet still loading)
			if (!value) return "";
			this._tokens.set(name, value);
		}
		return this._tokens.get(name);
	}

	/** The watermark of a page: a text or an image over the page, never in the way of a click. */
	watermark_html(i) {
		const s = this.settings;
		const total = this.pages.length || 1;
		const border = s.pb_on && on_page(s.pb_pages, i + 1, total) ? '<div class="rv-page-border" aria-hidden="true"></div>' : "";
		return border + this.mark_html(i);
	}

	mark_html(i) {
		const s = this.settings;
		if (s.wm_type === "none" || !on_page(s.wm_pages, i + 1, this.pages.length || 1)) return "";
		if (s.wm_type === "text" && s.wm_text.trim()) return `<div class="rv-page-wm" aria-hidden="true"><span>${esc(s.wm_text)}</span></div>`;
		if (s.wm_type === "image" && s.wm_image) return `<div class="rv-page-wm" aria-hidden="true"><img src="${esc(s.wm_image)}" alt=""></div>`;
		return "";
	}

	/**
	 * Head of a page. The first page: the letter head, the title block (company, report,
	 * period), a line of print details, the applied filters. The others: the letter head
	 * only when asked for every page, else one slim line naming the report.
	 */
	head_html(first, letterhead, n = 1, total = 1) {
		const s = this.settings;
		const t = (m, a) => this.t(m, a);
		const ctx = this.ctx;
		const company = ctx.company || "";
		const title = t(ctx.report_name);
		const period = this.period_text();
		const lh = this.top_number(n, total) + (letterhead?.header && on_page(s.lh_pages, n, total) ? `<div class="rv-page-lh fit-${s.lh_fit}">${letterhead.header}</div>` : "");
		// the print heading under the letter head; "instead of the title" drops the title
		// block of the first page and the slim line of the others
		const heading = this.heading_html(n, total);
		const replace = heading && s.heading_replace;
		if (!first) {
			const parts = [`<b>${esc(title)}</b>`, company ? esc(company) : "", period].filter(Boolean);
			return `${lh}${heading}${replace ? "" : `<div class="rv-page-cont">${parts.join('<span class="sep">·</span>')}</div>`}`;
		}
		const details = [];
		if (s.printed_on) {
			details.push(esc(t("Printed on {0}", [frappe.datetime.str_to_user(frappe.datetime.now_datetime())])));
			if (frappe.session?.user_fullname) details.push(esc(t("Printed by {0}", [frappe.session.user_fullname])));
		}
		const facts = [];
		if (ctx.group_labels?.length) facts.push(esc(t("Grouped by {0}", [ctx.group_labels.map((l) => this.in_lang(l)).join(" › ")])));
		facts.push(esc(t("{0} rows", [fmt_int(this.current.counts.shown)])));
		const title_block = replace
			? ""
			: `<div class="rv-page-hd">${company && !letterhead?.header ? `<div class="co">${esc(company)}</div>` : ""}<div class="ti">${esc(title)}</div>${period ? `<div class="pe">${period}</div>` : ""}</div>`;
		let out = `${lh}${heading}${title_block}<div class="rv-page-meta"><span>${details.join('<span class="sep">·</span>')}</span><span>${facts.join('<span class="sep">·</span>')}</span></div>`;
		if (s.include_filters) {
			const text = this.filters_html();
			if (text) out += `<div class="rv-page-filt"><b>${esc(t("Applied filters"))}:</b> ${text}</div>`;
		}
		return out;
	}

	/** The print heading of page `n`, or "" (none chosen, or not on this page). */
	heading_html(n, total) {
		const h = this.heading;
		if (!h || !this.settings.heading || !on_page(this.settings.heading_pages, n, total)) return "";
		return `<div class="rv-page-heading">${h.title ? `<div class="ht">${esc(h.title)}</div>` : ""}${h.html ? `<div class="hd">${h.html}</div>` : ""}</div>`;
	}

	period_text() {
		const f = this.ctx.filters || {};
		const t = (m, a) => this.t(m, a);
		const d = (v) => `<bdi class="rv-pnum">${esc(frappe.datetime.str_to_user(v))}</bdi>`;
		if (f.from_date && f.to_date) return t("For the period from {0} to {1}", [d(f.from_date), d(f.to_date)]);
		if (f.period_start_date && f.period_end_date) return t("For the period from {0} to {1}", [d(f.period_start_date), d(f.period_end_date)]);
		const single = f.report_date || f.as_on_date || f.date || f.posting_date || f.to_date;
		if (single) return t("As on {0}", [d(single)]);
		if (f.fiscal_year) return t("Fiscal Year {0}", [esc(f.fiscal_year)]);
		return "";
	}

	filters_html() {
		const f = this.ctx.filters || {};
		const defs = new Map((this.ctx.defs || []).map((df) => [df.fieldname, df]));
		const parts = [];
		for (const [key, value] of Object.entries(f)) {
			if (key === "company" || PERIOD_KEYS.has(key)) continue;
			if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) continue;
			const df = defs.get(key);
			if (df?.fieldtype === "Check" && !Number(value)) continue;
			const label = df?.label ? this.in_lang(df.label) : frappe.unscrub(key);
			let text;
			if (df?.fieldtype === "Check") text = this.t("Yes");
			else if (Array.isArray(value)) text = value.map(String).join(", ");
			else if (df?.fieldtype === "Date") text = frappe.datetime.str_to_user(value);
			else text = String(value);
			parts.push(`<span class="rv-page-filter"><span>${esc(label)}:</span> <b>${esc(text)}</b></span>`);
		}
		return parts.join(" · ");
	}

	/** The page number as the settings write it, or "" when hidden. */
	number_html(n, total) {
		const s = this.settings;
		if (!s.page_numbers) return "";
		const num = fmt_int;
		const at = n + s.number_start - 1;
		const last = total + s.number_start - 1;
		const text =
			s.number_format === "number"
				? num(at)
				: s.number_format === "short"
				? `${num(at)} / ${num(last)}`
				: s.number_format === "dash"
				? `— ${num(at)} —`
				: this.t("Page {0} of {1}", [num(at), num(last)]);
		return `<span class="rv-pnum">${esc(text)}</span>`;
	}

	/**
	 * The foot of a page: the letter head's footer and the number band, in the order chosen
	 * (the number under the footer, or above it). The footer prints on every page or the
	 * last; the band carries the number and, beside it, the report's name.
	 */
	foot_html(n, total, letterhead, measure = false) {
		const s = this.settings;
		const ctx = this.ctx;
		const t = (m, a) => this.t(m, a);
		const [where, side] = s.number_pos.split("-");
		// `measure`: the probe page takes the footer wherever it may print (the tallest foot)
		const lhf = letterhead?.footer && s.foot_height && (measure || on_page(s.foot_pages, n, total)) ? `<div class="rv-page-lhf">${page_spans(letterhead.footer, n, total)}</div>` : "";
		// a letter head footer that numbers its pages (the builder's, ADR-018) is the number of
		// this page: the band does not repeat it (the probe keeps both, the tallest foot)
		const lh_numbers = Boolean(lhf) && !measure && /class="(?:page|topage)"/.test(letterhead.footer);
		const number = where === "bottom" && !lh_numbers ? this.number_html(n, total) : "";
		const name = s.number_caption ? `<span class="nm">${[esc(t(ctx.report_name)), ctx.company ? esc(ctx.company) : ""].filter(Boolean).join(" · ")}</span>` : "";
		const slots = { start: "", center: "", end: "" };
		if (number) slots[side] = number;
		if (name) {
			if (!slots.start) slots.start = name;
			else if (!slots.end) slots.end = name;
		}
		const band = number || name ? `<div class="rv-page-foot-line${number ? " has-num" : ""}"><span class="st">${slots.start}</span><span class="ce">${slots.center}</span><span class="en">${slots.end}</span></div>` : "";
		// a signature on pages other than the last only: above the footer
		const sig = s.signatures && !this.sig_in_tail() && (measure || on_page(this.sig_pages(), n, total)) ? this.signatures_html() : "";
		// the number closes the page: under the footer (whose rule stands above it)
		return sig + lhf + band;
	}

	/** The page number at the top: a band of its own above the head (or nothing). */
	top_number(n, total) {
		const s = this.settings;
		const [where, side] = s.number_pos.split("-");
		return where === "top" && s.page_numbers ? `<div class="rv-page-topnum ${side}">${this.number_html(n, total)}</div>` : "";
	}

	/**
	 * The signature block: a Print Signature (its HTML, its CSS nested in .rv-signature,
	 * rendered by the server) or Report View's standard boxes. On the last page only it
	 * closes the content (after the table, or pushed to the bottom of the page); on other
	 * pages it stands in the foot, above the footer (foot_html).
	 */
	signatures_html(bottom = false) {
		if (!this.settings.signatures) return "";
		const own = this.settings.signature && this.signature;
		let inner;
		if (own) inner = `<div class="rv-signature">${own.css ? `<style>${own.css.replace(/<\/style/gi, "")}</style>` : ""}${own.html}</div>`;
		else {
			const t = (m, a) => this.t(m, a);
			const dots = "................................";
			const labels = this.signature_labels();
			inner = `<div class="rv-page-sign" style="grid-template-columns:repeat(${labels.length},minmax(0,1fr))">${labels
				.map((l) => `<div>${esc(this.in_lang(l))}<span>${esc(t("Name", null, "Report View"))}: ${dots}</span><span>${esc(t("Signature", null, "Report View"))}: ${dots}</span></div>`)
				.join("")}</div>`;
		}
		return `<div class="rv-page-sig${bottom ? " at-bottom" : ""}">${inner}</div>`;
	}

	/** Whether the signature closes the content of the last page (else it is in the foot). */
	sig_in_tail() {
		return this.settings.signatures && this.sig_pages() === "last";
	}

	/** The pages of the signature: as chosen, or the last only when repeating it left no room. */
	sig_pages() {
		return this.sig_fallback ? "last" : this.settings.sig_pages;
	}

	/**
	 * A signature repeated in the foot of the pages that leaves less than MIN_ROOM of the page
	 * to the content: it moves to the last page (and the panel says why), rather than a page
	 * for every row with nothing else on it. True when the pages are to be laid out again.
	 */
	sig_leaves_no_room(body_h, box) {
		if (this.sig_fallback || !this.settings.signatures || this.sig_in_tail() || body_h >= box.inner_h * MIN_ROOM) return false;
		this.sig_fallback = true;
		return true;
	}

	page_shell(i, box, dir, inner) {
		const look = `ps-${this.settings.style}${this.settings.template ? " ps-format" : ""}`;
		const p = box.pad;
		return `<section class="rv-page ${look}" dir="${dir}" data-page="${i}" style="width:${box.w}px;height:${box.h}px;padding-block:${p.top}px ${p.bottom}px;padding-inline:${p.start}px ${p.end}px;--pp-m:${box.margin}px">${inner}${this.watermark_html(i)}</section>`;
	}
}
