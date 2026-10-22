// The settings panel of the Pages view (views/pages_view.js): its sections as the tools of a
// toolbar, one tool's menu at a time (a sheet on a phone), the record fields (Frappe's
// Autocomplete), the thumbnails, and the binding of every control to update(). Methods of PagesView.

import { bind_font_picker, font_picker_html } from "../../components/font_picker.js";
import { icons } from "../../components/icons.js";
import { POP_MARGIN, place_near } from "../../components/popover.js";
import { PAGE_SIZES, preset_margins } from "../../engine/page_layout.js";
import { esc, fmt_int, session_lang } from "../../util.js";
import { BOX_MM, DROPDOWN_FLIP_UNDER, DROPDOWN_MAX_H, DROPDOWN_MIN_H, FOOT_SCOPES, MENU_GAP, MENU_GAP_BELOW, MENU_MIN_H, MENU_W, MOBILE_QUERY, NUMS, PAGE_SCOPES, PAGE_STYLES, RIBBON, SIDES, clamp } from "./settings.js";
import { can_write_letter_head } from "./support.js";

export class PagesPanel {
	/**
	 * The settings panel: sections that fold (paper, template, letter head, footer, page
	 * numbers, watermark, content, columns), each with a line that sums it up. Numbers are
	 * typed or stepped (mm, px, pt); the page follows a change at once.
	 */
	render_panel() {
		const s = this.settings;
		const o = this.options || { letter_heads: [], print_formats: [], languages: [] };
		const model = this.rows.model;
		if (!this.open_secs) this.open_secs = new Set();
		const mm = __("mm");
		const option = (value, label, on) => `<option value="${esc(value)}" ${on ? "selected" : ""}>${esc(label)}</option>`;
		const check = (key, label) =>
			`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-set="${key}" ${s[key] ? "checked" : ""}><span>${esc(label)}</span></span></label>`;
		const sw = (key, label) =>
			`<label class="rv-print-sw"><span>${esc(label)}</span><button type="button" class="rv-switch${s[key] ? " on" : ""}" role="switch" aria-checked="${s[key]}" data-sw="${key}" aria-label="${esc(label)}"></button></label>`;
		const seg = (key, label, opts) =>
			`<div class="rv-field"><span>${esc(label)}</span><div class="rv-seg rv-print-seg" role="group" aria-label="${esc(label)}">${opts
				.map(([v, l]) => `<button type="button" data-seg="${key}" data-value="${v}" class="${s[key] === v ? "on" : ""}" aria-pressed="${s[key] === v}">${esc(l)}</button>`)
				.join("")}</div></div>`;
		const num = (key, label, unit) => {
			const [min, max, step] = NUMS[key];
			return `<label class="rv-field rv-num-field"><span>${esc(label)}</span><span class="rv-num"><input type="number" class="rv-input" data-num="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"><i>${esc(unit)}</i></span></label>`;
		};
		const select = (key, label, opts) =>
			`<label class="rv-field"><span>${esc(label)}</span><select class="rv-input" data-set="${key}">${opts.map(([v, l]) => option(v, l, String(s[key]) === String(v))).join("")}</select></label>`;
		// the little page between the four fields draws them: wider margins, a smaller body
		const box_preview = (b) => SIDES.map((side) => `--m-${side}:${Math.min(38, Number(b[side]) * 1.6)}%`).join(";");
		// four margins as Word draws them: top and bottom, the two sides, a page between
		const box = (key, label) => {
			const v = s[key];
			const field = (side, title) =>
				`<label class="rv-box4-${side}" title="${esc(title)}"><input type="number" class="rv-input" data-box="${key}" data-side="${side}" min="${BOX_MM.min}" max="${BOX_MM.max}" step="0.5" value="${v[side]}" aria-label="${esc(`${label}: ${title}`)}"></label>`;
			return `<div class="rv-field"><span>${esc(label)} <i class="rv-unit">(${esc(mm)})</i><button type="button" class="rv-link" data-box-all="${key}" title="${esc(__("Use the top value on every side"))}">${esc(__("Same on all sides"))}</button></span>
				<div class="rv-box4" data-preview="${key}">${field("top", __("Top", null, "Report View"))}${field("start", __("Start", null, "Report View"))}<span class="rv-box4-page" aria-hidden="true" style="${box_preview(v)}"><i></i></span>${field("end", __("End", null, "Report View"))}${field("bottom", __("Bottom", null, "Report View"))}</div></div>`;
		};
		const rule = (key, label) =>
			`<div class="rv-field rv-rule-field"><span>${esc(label)}</span><div class="rv-rule-ctl">
				<span class="rv-num"><input type="number" class="rv-input" data-num="${key}_w" min="0" max="6" step="0.2" value="${s[`${key}_w`]}" aria-label="${esc(__("Thickness"))}"><i>px</i></span>
				<select class="rv-input" data-set="${key}_s" aria-label="${esc(__("Line style"))}">${[
					["solid", __("Solid")],
					["dashed", __("Dashed")],
					["dotted", __("Dotted")],
					["double", __("Double")],
				]
					.map(([v, l]) => option(v, l, s[`${key}_s`] === v))
					.join("")}</select>
				<input type="color" data-color="${key}_c" value="${this.color_of(s, `${key}_c`)}" aria-label="${esc(__("Colour"))}" title="${esc(__("Colour"))}"></div></div>`;
		const section = (id, icon, title, summary, body, extra = "") =>
			`<details class="rv-psec" data-sec="${id}" ${this.open_secs.has(id) ? "open" : ""}><summary><span class="ic">${icon}</span><span class="tx"><span class="tt">${esc(title)}</span>${summary ? `<span class="sm">${esc(summary)}</span>` : ""}</span>${extra}</summary><div class="rv-psec-bd">${body}</div></details>`;
		const align3 = [["start", __("Start", null, "Report View")], ["center", __("Centre")], ["end", __("End", null, "Report View")]];
		const pm = s.page_m;
		const columns = model ? [...model.pinned, ...model.data] : [];
		const hidden = new Set(s.hidden);
		const no_lh = `<p class="rv-zone-empty">${esc(__("Choose a letter head in «Template and language» to set its size, place and pages."))}</p>`;
		// the letter head builder (ADR-018), for those who may write letter heads (the
		// permission, not a role): a new design, or the chosen one opened in it; in a new tab,
		// this print stays as it is
		const lh_builder = can_write_letter_head()
			? `<a class="rv-btn sm ghost rv-print-lhb" target="_blank" rel="noopener" href="/desk/rv-letterhead${s.letter_head ? `/${encodeURIComponent(s.letter_head)}` : ""}"><span>${esc(s.letter_head ? __("Edit in the letter head builder") : __("Design a new letter head"))}</span></a>`
			: "";
		const pos_label = {
			"bottom-end": __("Bottom, at the end"),
			"bottom-center": __("Bottom, centred"),
			"bottom-start": __("Bottom, at the start"),
			"top-end": __("Top, at the end"),
			"top-center": __("Top, centred"),
			"top-start": __("Top, at the start"),
		};
		const ic = (d) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
		const I = {
			paper: ic('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>'),
			tpl: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>'),
			head: ic('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 8h16"/>'),
			heading: ic('<path d="M6 4v16M18 4v16M6 12h12"/>'),
			sign: ic('<path d="M3 17c3-1 4-8 6-8s1 7 3 7 2-4 4-4 1 3 5 3"/><path d="M3 21h18"/>'),
			foot: ic('<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 16h16"/>'),
			num: ic('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'),
			wm: ic('<path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/>'),
			border: ic('<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1" stroke-dasharray="2 2"/>'),
			content: ic('<path d="M4 6h16M4 12h16M4 18h10"/>'),
			cols: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>'),
		};
		const paper_sum = `${s.size} · ${s.orientation === "landscape" ? __("Landscape", null, "Report View") : __("Portrait", null, "Report View")} · ${[pm.top, pm.end, pm.bottom, pm.start].join("/")} ${mm}`;
		const tpl_sum = [s.template || PAGE_STYLES.find((x) => x.id === s.style)?.label(), s.font, s.lang ? o.languages.find((l) => l.name === s.lang)?.label : ""].filter(Boolean).join(" · ");
		const scope_label = { all: __("Every page"), first: __("First page"), rest: __("All but the first"), last: __("Last page") };
		// four choices do not fit one line: two by two
		const scopes = (key, list) => seg(key, __("Apply to"), list.map((v) => [v, scope_label[v]])).replace("rv-print-seg", `rv-print-seg${list.length > 3 ? " grid2" : ""}`);
		const lh_sum = s.letter_head ? `${s.letter_head} · ${scope_label[s.lh_pages]}` : __("None", null, "Report View");
		const sig_sum = s.signatures ? `${s.signature ? __(s.signature) : __("Standard boxes")} · ${scope_label[s.sig_pages]}` : __("None", null, "Report View");
		const hdg_sum = s.heading ? `${__(s.heading)} · ${scope_label[s.heading_pages]}` : __("None", null, "Report View");
		const headings = o.print_headings || [];
		// a record of the site: a Link field (Frappe's search, with the user's permissions)
		const link = (key, label) => `<div class="rv-field"><span>${esc(label)}</span><div class="rv-linkf" data-link="${key}" data-label="${esc(label)}"></div></div>`;
		// the letter head is known once loaded: one without a footer says so
		const no_footer = Boolean(s.letter_head && this.letterhead_name === s.letter_head && !this.letterhead?.footer);
		this.panel_no_footer = no_footer;
		const foot_sum = no_footer ? __("Not in this letter head") : !s.letter_head || !s.foot_height ? __("None", null, "Report View") : scope_label[s.foot_pages];
		const num_sum = s.page_numbers ? pos_label[s.number_pos] : __("Hidden");
		const pb_sum = s.pb_on ? `${s.pb_w} px · ${{ solid: __("Solid"), dashed: __("Dashed"), dotted: __("Dotted"), double: __("Double") }[s.pb_s]}` : __("None", null, "Report View");
		const wm_sum = s.wm_type === "text" ? s.wm_text || __("Text", null, "Report View") : s.wm_type === "image" ? __("Image", null, "Report View") : __("None", null, "Report View");

		this.bd.innerHTML = [
			section(
				"paper",
				I.paper,
				__("Paper and margins"),
				paper_sum,
				`<div class="rv-print-row rv-paper-row">${select("size", __("Paper size"), Object.keys(PAGE_SIZES).map((k) => [k, k]))}
					<div class="rv-field"><span>${esc(__("Orientation"))}</span><div class="rv-seg rv-print-seg rv-orient-seg" role="group" aria-label="${esc(__("Orientation"))}">
						<button type="button" data-orient="portrait" class="${s.orientation === "portrait" ? "on" : ""}" aria-pressed="${s.orientation === "portrait"}" title="${esc(__("Portrait", null, "Report View"))}"><i class="pg p"></i><span>${esc(__("Portrait", null, "Report View"))}</span></button>
						<button type="button" data-orient="landscape" class="${s.orientation === "landscape" ? "on" : ""}" aria-pressed="${s.orientation === "landscape"}" title="${esc(__("Landscape", null, "Report View"))}"><i class="pg l"></i><span>${esc(__("Landscape", null, "Report View"))}</span></button>
					</div></div></div>
				${seg("margins", __("Margins"), [["narrow", __("Narrow")], ["normal", __("Normal", null, "Report View")], ["wide", __("Wide")], ["custom", __("Custom", null, "Report View")]])}
				${box("page_m", __("Page margins"))}`
			),
			section(
				"tpl",
				I.tpl,
				__("Template and language"),
				tpl_sum,
				`${link("template", __("Print template"))}
				${select("style", __("Print style"), PAGE_STYLES.map((st) => [st.id, st.label()]))}
				<div class="rv-field"><span>${esc(__("Font"))}</span>${font_picker_html({ value: s.font, key: "font", label: __("Font"), empty: __("The template's font") })}</div>
				${link("letter_head", __("Letter Head", null, "Report View"))}
				${link("heading", __("Print Heading", null, "Report View"))}
				${link("lang", __("Language", null, "Report View"))}`
			),
			section(
				"head",
				I.head,
				__("Letter Head", null, "Report View"),
				lh_sum,
				s.letter_head
					? `${scopes("lh_pages", PAGE_SCOPES)}
					<div class="rv-print-row">${num("lh_height", __("Height", null, "Report View"), mm)}${seg("lh_fit", __("Shape"), [["contain", __("As designed")], ["wide", __("Page width")]])}</div>
					${seg("lh_align", __("Alignment"), align3)}
					${box("lh_m", __("Letter head margins"))}
					${rule("head_line", __("Rule under the letter head"))}
					${lh_builder}`
					: no_lh + lh_builder
			),
			section(
				"heading",
				I.heading,
				__("Print Heading", null, "Report View"),
				hdg_sum,
				s.heading
					? `${scopes("heading_pages", PAGE_SCOPES)}
					${sw("heading_replace", __("Instead of the report title"))}
					<div class="rv-print-row">${num("heading_size", __("Font size"), "pt")}</div>
					${seg("heading_align", __("Alignment"), align3)}
					${box("heading_m", __("Heading margins"))}
					${rule("heading_line", __("Rule under the heading"))}
					<p class="rv-zone-empty">${esc(__("The heading is rendered with the report's name and its filters (Jinja: {{ title }}, {{ filters.company.value }}, {{ doc.from_date }})."))}</p>`
					: `<p class="rv-zone-empty">${esc(
							headings.length ? __("Choose a print heading in «Template and language» to set its pages, size and place.") : __("No print heading yet: add one in Print Heading.")
					  )}</p>`
			),
			section(
				"foot",
				I.foot,
				__("Footer", null, "Report View"),
				foot_sum,
				s.letter_head
					? `${no_footer ? `<p class="rv-zone-empty warn">${esc(__("The letter head «{0}» has no footer. Write one in its Footer field (Letter Head), or choose another letter head.", [s.letter_head]))}</p>` : ""}${scopes("foot_pages", FOOT_SCOPES)}
					<div class="rv-print-row">${num("foot_height", __("Height", null, "Report View"), mm)}</div>
					${seg("foot_align", __("Alignment"), align3)}
					${box("foot_m", __("Footer margins"))}
					${rule("foot_line", __("Rule above the footer"))}`
					: no_lh
			),
			section(
				"num",
				I.num,
				__("Page numbers"),
				num_sum,
				`${sw("page_numbers", __("Show page numbers"))}
				${
					s.page_numbers
						? `${select("number_pos", __("Page number position"), Object.entries(pos_label))}
					<div class="rv-print-row">${select("number_format", __("Number format"), [["full", __("Page 1 of 3")], ["short", "1 / 3"], ["dash", "— 1 —"], ["number", "1"]])}${num("number_start", __("Start at"), "")}</div>
					<div class="rv-print-row">${num("number_size", __("Font size"), "pt")}<div class="rv-field rv-sw-field">${sw("number_caption", __("Report name beside it"))}</div></div>
					${box("num_m", __("Space around the number"))}
					${rule("num_line", __("Rule of the number band"))}`
						: ""
				}`
			),
			section(
				"sign",
				I.sign,
				__("Signatures"),
				sig_sum,
				`${sw("signatures", __("Print signatures"))}
				${
					s.signatures
						? `${link("signature", __("Signature", null, "Report View"))}
					${scopes("sig_pages", FOOT_SCOPES)}
					${
						s.sig_pages === "last"
							? seg("sig_pos", __("Place", null, "Report View"), [["after", __("After the table")], ["bottom", __("Bottom of the page")]])
							: `<p class="rv-zone-empty">${esc(__("On these pages the signature stands at the bottom, above the footer."))}</p>`
					}
					<div class="rv-print-row">${num("sig_size", __("Font size"), "pt")}</div>
					${box("sig_m", __("Signature margins"))}`
						: ""
				}`
			),
			section(
				"border",
				I.border,
				__("Page border"),
				pb_sum,
				`${sw("pb_on", __("Border round the page"))}
				${
					s.pb_on
						? `<div class="rv-print-row">${num("pb_w", __("Thickness"), "px")}<label class="rv-field"><span>${esc(__("Line style"))}</span><select class="rv-input" data-set="pb_s">${[
								["solid", __("Solid")],
								["dashed", __("Dashed")],
								["dotted", __("Dotted")],
								["double", __("Double")],
						  ]
								.map(([v, l]) => option(v, l, s.pb_s === v))
								.join("")}</select></label></div>
					<div class="rv-print-row">${num("pb_offset", __("From the edge of the paper"), mm)}${num("pb_radius", __("Rounded corners"), mm)}</div>
					<div class="rv-print-row"><label class="rv-field"><span>${esc(__("Colour"))}</span><input type="color" class="rv-color-wide" data-color="pb_c" value="${this.color_of(s, "pb_c")}"></label></div>
					${scopes("pb_pages", PAGE_SCOPES)}`
						: ""
				}`
			),
			section(
				"wm",
				I.wm,
				__("Watermark"),
				wm_sum,
				`${seg("wm_type", __("Watermark"), [["none", __("None", null, "Report View")], ["text", __("Text", null, "Report View")], ["image", __("Image", null, "Report View")]])}
				${
					s.wm_type === "text"
						? `<label class="rv-field"><span>${esc(__("Text", null, "Report View"))}</span><input type="text" class="rv-input" data-text="wm_text" maxlength="120" value="${esc(s.wm_text)}" placeholder="${esc(__("e.g. DRAFT, CONFIDENTIAL"))}"></label>
						<div class="rv-print-row">${num("wm_size", __("Font size"), "pt")}<label class="rv-field"><span>${esc(__("Colour"))}</span><input type="color" class="rv-color-wide" data-color="wm_color" value="${this.color_of(s, "wm_color")}"></label></div>`
						: ""
				}
				${
					s.wm_type === "image"
						? `<div class="rv-field"><span>${esc(__("Image", null, "Report View"))}</span><div class="rv-wm-img">${
								s.wm_image ? `<img src="${esc(s.wm_image)}" alt="">` : `<span class="rv-zone-empty">${esc(__("No image yet"))}</span>`
						  }<button type="button" class="rv-btn sm" data-action="wm-upload">${esc(__("Choose an image"))}</button></div>
						<input type="text" class="rv-input" data-text="wm_image" value="${esc(s.wm_image)}" placeholder="/files/logo.png" aria-label="${esc(__("Image address"))}"></div>
						${num("wm_scale", __("Width of the page"), "%")}`
						: ""
				}
				${
					s.wm_type !== "none"
						? `<div class="rv-print-row">${num("wm_opacity", __("Opacity"), "%")}${num("wm_angle", __("Angle"), "°")}</div>
						${scopes("wm_pages", PAGE_SCOPES)}`
						: ""
				}`
			),
			this.doc_mode
				? ""
				: section(
				"content",
				I.content,
				__("Content", null, "Report View"),
				"",
				`<div class="rv-setlist tall">${check("include_filters", __("Applied filters"))}${model?.hierarchical ? check("include_subtotals", __("Group subtotals")) : ""}${check(
					"include_total",
					__("Grand Total")
				)}${check("printed_on", __("Print date and user"))}</div>`
			),
			s.template || this.doc_mode
				? ""
				: section(
						"cols",
						I.cols,
						__("Printed columns"),
						hidden.size ? __("{0} hidden", [fmt_int(hidden.size)]) : "",
						`<div class="rv-setlist tall"><label class="rv-setitem"><span class="rv-check"><input type="checkbox" checked disabled><span>${esc(model?.label_title || "")}</span></span></label>${columns
							.map(
								(d) =>
									`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-col="${esc(d.column.key)}" ${hidden.has(d.column.key) ? "" : "checked"}><span>${esc(d.title)}</span></span></label>`
							)
							.join("")}</div>`
				  ),
			`<p class="rv-zone-empty">${esc(__("The pages show the table as it is: the same filters, grouping and folded groups."))}</p>`,
		].join("");
		this.ribbon_layout();
		this.bd.scrollLeft = this.ribbon_scroll || 0;
		const menu = this.bd.querySelector(".rv-print-pop");
		if (menu && this.menu_scroll && this.menu_scroll.id === [...this.open_secs].join()) menu.scrollTop = this.menu_scroll.top;
		this.bind_panel();
	}

	/**
	 * The sections as the tools of the toolbar, in RIBBON's groups; the open ones (one when
	 * a person opens a tool) show their settings in one menu under the tool, its title and
	 * summary at its head. The controls are the sections' own: bind_panel binds them as before.
	 */
	ribbon_layout() {
		const bd = this.bd;
		const take = (id) => bd.querySelector(`:scope > details[data-sec="${id}"]`);
		const frag = document.createDocumentFragment();
		let last = null;
		for (const g of RIBBON) {
			const secs = g.secs.map(take).filter(Boolean);
			if (!secs.length) continue;
			const wrap = document.createElement("div");
			wrap.className = "rv-rg";
			wrap.dataset.group = g.id;
			wrap.setAttribute("role", "group");
			wrap.setAttribute("aria-label", g.label());
			const tools = document.createElement("div");
			tools.className = "rv-rg-tools";
			tools.append(...secs);
			const name = document.createElement("span");
			name.className = "rv-rg-name";
			name.textContent = g.label();
			wrap.append(tools, name);
			frag.append(wrap);
			last = tools;
		}
		// a section no group names (a later one) joins the last group
		for (const d of bd.querySelectorAll(":scope > details[data-sec]")) last?.append(d);
		bd.replaceChildren(frag);
		for (const d of bd.querySelectorAll("details[data-sec]")) {
			const summary = d.querySelector(":scope > summary");
			const sm = summary.querySelector(".sm")?.textContent || "";
			summary.title = sm;
			summary.setAttribute("aria-haspopup", "dialog");
			summary.setAttribute("aria-expanded", String(d.open));
		}
		const open = [...bd.querySelectorAll("details[data-sec][open]")];
		this.menu_listeners(open.length > 0);
		if (!open.length) return;
		// on a phone the menu is a sheet over the pages: a scrim under it closes it
		const scrim = document.createElement("div");
		scrim.className = "rv-print-scrim";
		scrim.setAttribute("aria-hidden", "true");
		scrim.addEventListener("click", () => this.close_menu());
		const menu = document.createElement("div");
		menu.className = "rv-print-pop";
		menu.tabIndex = -1;
		menu.setAttribute("role", "dialog");
		menu.setAttribute("aria-label", open.map((d) => d.querySelector(".tt")?.textContent || "").join(" · "));
		for (const d of open) {
			const sec = document.createElement("section");
			sec.className = "rv-pop-sec";
			sec.dataset.sec = d.dataset.sec;
			const hd = document.createElement("div");
			hd.className = "rv-pop-hd";
			hd.innerHTML = `<strong>${esc(d.querySelector(".tt")?.textContent || "")}</strong><span>${esc(d.querySelector(".sm")?.textContent || "")}</span>`;
			sec.append(hd, d.querySelector(":scope > .rv-psec-bd"));
			menu.append(sec);
		}
		const close = document.createElement("button");
		close.type = "button";
		close.className = "rv-pop-x";
		close.setAttribute("aria-label", __("Close"));
		close.innerHTML = icons.close();
		close.addEventListener("click", () => this.close_menu());
		menu.querySelector(".rv-pop-hd")?.append(close);
		bd.append(scrim, menu);
		menu.addEventListener("scroll", () => (this.menu_scroll = { id: [...this.open_secs].join(), top: menu.scrollTop }), { passive: true });
		this.place_menu();
	}

	/** The listeners of the document and the window an open menu needs, on or off. */
	menu_listeners(on) {
		if (Boolean(this.listening) === on) return;
		this.listening = on;
		this.outside.set(on);
		if (on) window.addEventListener("resize", this.on_resize, { passive: true });
		else window.removeEventListener("resize", this.on_resize, { passive: true });
	}

	/** The menu of the open tool: under its tool, inside the window (a sheet on a phone, by CSS). */
	place_menu() {
		const menu = this.bd?.querySelector(".rv-print-pop");
		if (!menu) return;
		const id = this.open_secs.has(this.menu_anchor) ? this.menu_anchor : [...this.open_secs][0];
		const tool = this.bd.querySelector(`details[data-sec="${id}"] > summary`);
		if (!tool) return;
		const w = Math.min(MENU_W, window.innerWidth - 2 * POP_MARGIN);
		const p = place_near(tool.getBoundingClientRect(), { w, gap: MENU_GAP, rtl: this.rtl });
		Object.assign(menu.style, {
			top: `${Math.round(p.top)}px`,
			left: `${Math.round(p.left)}px`,
			width: `${w}px`,
			maxHeight: `${Math.max(MENU_MIN_H, Math.round(p.room - MENU_GAP_BELOW))}px`,
		});
	}

	open_menu(id) {
		const only = this.open_secs.size === 1 && this.open_secs.has(id);
		this.ribbon_scroll = this.bd.scrollLeft;
		this.open_secs = only ? new Set() : new Set([id]);
		this.menu_anchor = id;
		this.menu_scroll = null;
		this.render_panel();
		if (only) return;
		// on a phone a focused field opens the keyboard and its list over the sheet: the
		// sheet itself takes the focus there
		const menu = this.bd.querySelector(".rv-print-pop");
		const sheet = window.matchMedia(MOBILE_QUERY).matches;
		(sheet ? menu : menu?.querySelector("input:not([type=hidden]), select, button:not(.rv-pop-x)"))?.focus({ preventScroll: true });
	}

	close_menu() {
		if (!this.open_secs?.size) return;
		const id = this.menu_anchor;
		this.ribbon_scroll = this.bd.scrollLeft;
		this.open_secs = new Set();
		this.render_panel();
		this.bd.querySelector(`details[data-sec="${id}"] > summary`)?.focus({ preventScroll: true });
	}

	/** The thumbnails of the pages (numbers on little sheets): one each, the current marked. */
	render_thumbs() {
		if (!this.thumbs) return;
		const num = fmt_int;
		const n = Math.min(this.pages.length, this.max_pages());
		let html = "";
		for (let i = 0; i < n; i++) html += `<button type="button" data-thumb="${i}" aria-label="${esc(__("Page {0}", [num(i + 1)]))}"><i aria-hidden="true"></i><span>${esc(num(i + 1))}</span></button>`;
		this.thumbs.innerHTML = html;
		this.thumbs.style.setProperty("--th-ratio", String(this.box ? this.box.h / this.box.w : 1.414));
	}

	/**
	 * The record fields of the panel (print format, letter head, print heading, signature,
	 * language): Frappe's Autocomplete over the lists the server read with the user's
	 * permissions (frappe.get_list, in get_print_options / get_doc_print_options). The list
	 * opens at once and filters as one types, with no request; a value not in it is dropped,
	 * and the server checks every choice again when it renders it. Empty is the standard choice.
	 */
	link_defs() {
		const o = this.options || {};
		const items = (names, label = (n) => n) => (names || []).map((n) => ({ value: n, label: label(n) }));
		return {
			template: {
				placeholder: this.doc_mode ? o.default_print_format || __("Standard") : __("Report View (standard)"),
				items: items(o.print_formats),
			},
			letter_head: { placeholder: __("No letter head"), items: items((o.letter_heads || []).map((lh) => lh.name)) },
			heading: { placeholder: __("No print heading"), items: items(o.print_headings, (n) => __(n)) },
			signature: {
				placeholder: __("Report View (standard)"),
				items: (o.print_signatures || []).map((x) => ({ value: x.name, label: __(x.name), description: __(x.content_type) })),
			},
			lang: {
				placeholder: __("Session language ({0})", [o.lang || session_lang()]),
				items: (o.languages || []).map((l) => ({ value: l.name, label: l.label, description: l.name })),
			},
		};
	}

	mount_links() {
		if (!frappe.ui?.form?.make_control) return;
		const defs = this.link_defs();
		for (const el of this.bd.querySelectorAll("[data-link]")) {
			const key = el.dataset.link;
			const def = defs[key];
			const f = frappe.ui.form.make_control({
				df: {
					fieldtype: "Autocomplete",
					fieldname: `rv_print_${key}`,
					options: def.items,
					placeholder: def.placeholder,
					onchange: () => {
						const v = f.get_value() || "";
						if (v !== (this.settings[key] || "")) this.update({ [key]: v });
					},
				},
				parent: el,
				only_input: true,
			});
			f.refresh();
			if (!f.$input) f.make_input();
			f.$input.attr("aria-label", el.dataset.label);
			f.$input.on("awesomplete-open input focus", () => requestAnimationFrame(() => this.place_dropdown(f.$input.get(0))));
			f.$input.attr("placeholder", def.placeholder);
			f.set_input(this.settings[key] || "");
		}
	}

	/**
	 * The list of a Link field stands over the page (fixed), under the field or above it
	 * when the room below is short: the panel and its sections would cut it.
	 */
	place_dropdown(input) {
		const ul = input?.parentElement?.querySelector(":scope > ul");
		if (!ul || ul.hidden) return;
		const r = input.getBoundingClientRect();
		const p = place_near(r, { w: r.width, flip_under: DROPDOWN_FLIP_UNDER });
		Object.assign(ul.style, {
			position: "fixed",
			left: `${p.left}px`,
			width: `${r.width}px`,
			// Frappe gives the list min-width:100%, which, fixed, is the whole window
			minWidth: "0",
			right: "auto",
			top: p.up ? "auto" : `${p.top}px`,
			bottom: p.up ? `${p.bottom}px` : "auto",
			maxHeight: `${Math.max(DROPDOWN_MIN_H, Math.min(DROPDOWN_MAX_H, p.room))}px`,
			overflowY: "auto",
			// above the menu of the tool (rv_tokens.css)
			zIndex: "var(--z-dropdown)",
			margin: "0",
		});
	}

	bind_panel() {
		const bd = this.bd;
		// once per panel element (the picker keeps its own binding): its unbind for release()
		this.unbind_fonts = bind_font_picker(bd, (key, family) => this.update({ [key]: family }));
		this.mount_links();
		for (const summary of bd.querySelectorAll("details[data-sec] > summary")) {
			summary.addEventListener("click", (e) => {
				if (e.target !== summary && e.target.closest("button, input, select, a")) return;
				e.preventDefault();
				this.open_menu(summary.parentElement.dataset.sec);
			});
		}
		for (const sel of bd.querySelectorAll("select[data-set]")) {
			sel.addEventListener("change", () => this.update({ [sel.dataset.set]: sel.value }));
		}
		for (const b of bd.querySelectorAll("[data-orient]")) b.addEventListener("click", () => this.update({ orientation: b.dataset.orient }));
		for (const b of bd.querySelectorAll("[data-sw]")) b.addEventListener("click", () => this.update({ [b.dataset.sw]: !this.settings[b.dataset.sw] }));
		for (const b of bd.querySelectorAll("[data-seg]")) {
			b.addEventListener("click", () => {
				const key = b.dataset.seg;
				const value = b.dataset.value;
				// a margin preset writes the four page margins
				if (key === "margins" && value !== "custom") this.update({ margins: value, page_m: preset_margins(value) });
				else this.update({ [key]: value });
			});
		}
		for (const c of bd.querySelectorAll("input[data-set]")) c.addEventListener("change", () => this.update({ [c.dataset.set]: c.checked }));
		for (const c of bd.querySelectorAll("input[data-col]")) {
			c.addEventListener("change", () => {
				const key = c.dataset.col;
				const next = this.settings.hidden.filter((k) => k !== key);
				if (!c.checked) next.push(key);
				this.update({ hidden: next });
			});
		}
		// typed values: the page follows while typing (no new panel, the focus stays)
		const typed = (patch) => this.update(patch, { panel: false, wait: 350 });
		for (const i of bd.querySelectorAll("input[data-num]")) {
			i.addEventListener("input", () => {
				const v = clamp(i.value, NUMS[i.dataset.num]);
				if (v !== null && i.value !== "") typed({ [i.dataset.num]: v });
			});
			i.addEventListener("change", () => {
				const v = clamp(i.value, NUMS[i.dataset.num]) ?? this.settings[i.dataset.num];
				i.value = v;
				this.update({ [i.dataset.num]: v });
			});
		}
		for (const i of bd.querySelectorAll("input[data-box]")) {
			const key = i.dataset.box;
			i.addEventListener("input", () => {
				const v = clamp(i.value, [BOX_MM.min, BOX_MM.max, 0.5]);
				if (v === null || i.value === "") return;
				typed({ [key]: { ...this.settings[key], [i.dataset.side]: v }, ...(key === "page_m" ? { margins: "custom" } : {}) });
				const page = bd.querySelector(`[data-preview="${key}"] .rv-box4-page`);
				if (page) page.style.setProperty(`--m-${i.dataset.side}`, `${Math.min(38, v * 1.6)}%`);
			});
			i.addEventListener("change", () => {
				const v = clamp(i.value, [BOX_MM.min, BOX_MM.max, 0.5]) ?? this.settings[key][i.dataset.side];
				i.value = v;
				this.update({ [key]: { ...this.settings[key], [i.dataset.side]: v }, ...(key === "page_m" ? { margins: "custom" } : {}) });
			});
		}
		for (const b of bd.querySelectorAll("[data-box-all]")) {
			b.addEventListener("click", () => {
				const key = b.dataset.boxAll;
				const v = this.settings[key].top;
				this.update({ [key]: { top: v, bottom: v, start: v, end: v }, ...(key === "page_m" ? { margins: "custom" } : {}) });
			});
		}
		for (const i of bd.querySelectorAll("input[data-text]")) {
			i.addEventListener("input", () => {
				const key = i.dataset.text;
				if (key === "wm_image" && i.value && !/^(\/|https?:\/\/)/.test(i.value)) return;
				typed({ [key]: i.value });
			});
		}
		for (const c of bd.querySelectorAll("input[data-color]")) {
			const key = c.dataset.color;
			c.addEventListener("input", () => this.apply_vars({ ...this.settings, [key]: c.value }));
			c.addEventListener("change", () => this.update({ [key]: c.value }));
		}
		bd.querySelector('[data-action="wm-upload"]')?.addEventListener("click", () => this.guard(() => this.pick_watermark()));
	}

	// An image for the watermark: Frappe's file uploader (an image of the site's files).
	pick_watermark() {
		if (!frappe.ui?.FileUploader) return;
		new frappe.ui.FileUploader({
			allow_multiple: false,
			restrictions: { allowed_file_types: ["image/*"] },
			on_success: (file) => {
				if (file?.file_url) this.update({ wm_image: file.file_url });
			},
		});
	}
}
