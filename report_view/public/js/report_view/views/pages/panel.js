// The settings column of the Pages view (views/pages_view.js), as Frappe's print view
// (printing/page/print/print.js setup_sidebar): four groups under plain headings, each folding
// in place, a sheet on a phone; the record fields (Frappe's Autocomplete) and the binding of
// every control to update(). Methods of PagesView.

import { bind_font_picker, font_picker_html } from "../../components/font_picker.js";
import { icons } from "../../components/icons.js";
import { place_near } from "../../components/popover.js";
import { PAGE_SIZES, preset_margins } from "../../engine/page_layout.js";
import { esc, fmt_int, session_lang } from "../../util.js";
import { to_number, values_for } from "../../print_variables.js";
import { BOX_MM, DEFAULT_OPEN_SECS, VARIABLE_TYPING_WAIT_MS, VARIABLE_WAIT_MS, DROPDOWN_FLIP_UNDER, DROPDOWN_MAX_H, DROPDOWN_MIN_H, FOOT_SCOPES, NUMS, PAGE_SCOPES, PAGE_STYLES, SIDE_GROUPS, clamp } from "./settings.js";
import { can_write_letter_head } from "./support.js";

// Frappe's select (form/controls/select.js): its own chevrons over a select without the
// browser's arrow
const sel_icon = () => `<span class="rv-sel-ic" aria-hidden="true">${frappe.utils?.icon ? frappe.utils.icon("chevrons-up-down", "sm") : ""}</span>`;

export class PagesPanel {
	/**
	 * The side column: its parts (paper, template, letter head, print heading, footer, page
	 * numbers, signatures, border, watermark, content, columns), each with a line that sums
	 * it up, in SIDE_GROUPS (side_panel). Numbers are typed or stepped (mm, px, pt); the
	 * pages follow a change at once. The whole column is drawn again on a change: it keeps
	 * its scroll and its open groups (side_panel), and a typed value does not draw it.
	 */
	render_panel() {
		if (!this.open_secs) this.open_secs = new Set(DEFAULT_OPEN_SECS);
		const c = this.panel_controls();
		const parts = [
			this.paper_section(c),
			this.template_section(c),
			this.variables_section(c.section),
			this.letter_head_section(c),
			this.print_heading_section(c),
			this.footer_section(c),
			this.page_numbers_section(c),
			this.signatures_section(c),
			this.page_border_section(c),
			this.watermark_section(c),
			this.content_section(c),
			this.columns_section(c),
		];
		// a document is not a table: no word about filters and groups under its column
		const note = this.doc_mode ? "" : __("The pages show the table as it is: the same filters, grouping and folded groups.");
		this.side_panel(parts, note);
	}

	/**
	 * The controls of the column as markup, each bound to a setting by its data attribute
	 * (bind_panel), and the words the parts share.
	 */
	panel_controls() {
		const s = this.settings;
		const mm = __("mm");
		const option = (value, label, on) => `<option value="${esc(value)}" ${on ? "selected" : ""}>${esc(label)}</option>`;
		const seg = (key, label, opts) =>
			`<div class="rv-field"><span>${esc(label)}</span><div class="rv-seg rv-print-seg" role="group" aria-label="${esc(label)}">${opts
				.map(([v, l]) => `<button type="button" data-seg="${key}" data-value="${v}" class="${s[key] === v ? "on" : ""}" aria-pressed="${s[key] === v}" title="${esc(l)}">${esc(l)}</button>`)
				.join("")}</div></div>`;
		const select_html = (attrs, opts, value) =>
			`<span class="rv-selbox"><select class="rv-input" ${attrs}>${opts.map(([v, l]) => option(v, l, String(value) === String(v))).join("")}</select>${sel_icon()}</span>`;
		const line_styles = [
			["solid", __("Solid")],
			["dashed", __("Dashed")],
			["dotted", __("Dotted")],
			["double", __("Double")],
		];
		const scope_label = { all: __("Every page"), first: __("First page"), rest: __("All but the first"), last: __("Last page") };
		const c = {
			s,
			o: this.options || { letter_heads: [], print_formats: [], languages: [] },
			mm,
			scope_label,
			line_styles,
			select_html,
			seg,
			align3: [["start", __("Start", null, "Report View")], ["center", __("Centre")], ["end", __("End", null, "Report View")]],
			none: __("None", null, "Report View"),
			note: (text, warn = false) => `<p class="rv-zone-empty${warn ? " warn" : ""}">${esc(text)}</p>`,
			check: (key, label) =>
				`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-set="${key}" ${s[key] ? "checked" : ""}><span>${esc(label)}</span></span></label>`,
			sw: (key, label) =>
				`<label class="rv-print-sw"><span>${esc(label)}</span><button type="button" class="rv-switch${s[key] ? " on" : ""}" role="switch" aria-checked="${s[key]}" data-sw="${key}" aria-label="${esc(label)}"></button></label>`,
			num: (key, label, unit) => {
				const [min, max, step] = NUMS[key];
				return `<label class="rv-field rv-num-field"><span>${esc(label)}</span><span class="rv-num"><input type="number" class="rv-input" data-num="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"><i>${esc(unit)}</i></span></label>`;
			},
			select: (key, label, opts) => `<label class="rv-field"><span>${esc(label)}</span>${select_html(`data-set="${key}"`, opts, s[key])}</label>`,
			// four margins: top, start, end, bottom
			box: (key, label) => {
				const v = s[key];
				const field = (side, title) =>
					`<label class="rv-box4-${side}" title="${esc(title)}"><input type="number" class="rv-input" data-box="${key}" data-side="${side}" min="${BOX_MM.min}" max="${BOX_MM.max}" step="0.5" value="${v[side]}" aria-label="${esc(`${label}: ${title}`)}"></label>`;
				return `<div class="rv-field"><span>${esc(label)} <i class="rv-unit">(${esc(mm)})</i><button type="button" class="rv-link" data-box-all="${key}" title="${esc(__("Use the top value on every side"))}">${esc(__("Same on all sides"))}</button></span>
				<div class="rv-box4">${field("top", __("Top", null, "Report View"))}${field("start", __("Start", null, "Report View"))}${field("end", __("End", null, "Report View"))}${field("bottom", __("Bottom", null, "Report View"))}</div></div>`;
			},
			// a rule: its thickness, its style, its colour on one line
			rule: (key, label) =>
				`<div class="rv-field rv-rule-field"><span>${esc(label)}</span><div class="rv-rule-ctl">
				<span class="rv-num"><input type="number" class="rv-input" data-num="${key}_w" min="0" max="6" step="0.2" value="${s[`${key}_w`]}" aria-label="${esc(__("Thickness"))}"><i>px</i></span>
				${select_html(`data-set="${key}_s" aria-label="${esc(__("Line style"))}"`, line_styles, s[`${key}_s`])}
				<input type="color" data-color="${key}_c" value="${this.color_of(s, `${key}_c`)}" aria-label="${esc(__("Colour"))}" title="${esc(__("Colour"))}"></div></div>`,
			// a record of the site: a Link field (Frappe's search, with the user's permissions)
			link: (key, label) => `<div class="rv-field"><span>${esc(label)}</span><div class="rv-linkf" data-link="${key}" data-label="${esc(label)}"></div></div>`,
			// a part of a group (side_panel folds the groups): its small title, its controls
			section: (id, title, summary, body) =>
				`<div class="rv-psub" data-sec="${id}" data-title="${esc(title)}" data-sm="${esc(summary || "")}"><div class="rv-psub-t">${esc(title)}</div><div class="rv-psec-bd">${body}</div></div>`,
			// on which pages: four choices do not fit one line, two by two
			scopes: (key, list) => seg(key, __("Apply to"), list.map((v) => [v, scope_label[v]])).replace("rv-print-seg", `rv-print-seg${list.length > 3 ? " grid2" : ""}`),
		};
		c.no_letter_head = c.note(__("Choose a letter head in «Template and language» to set its size, place and pages."));
		return c;
	}

	paper_section({ s, mm, select, seg, box, section }) {
		const pm = s.page_m;
		const portrait = __("Portrait", null, "Report View");
		const landscape = __("Landscape", null, "Report View");
		const orient = (v, label, cls) =>
			`<button type="button" data-orient="${v}" class="${s.orientation === v ? "on" : ""}" aria-pressed="${s.orientation === v}" title="${esc(label)}"><i class="pg ${cls}"></i><span>${esc(label)}</span></button>`;
		const sum = `${s.size} · ${s.orientation === "landscape" ? landscape : portrait} · ${[pm.top, pm.end, pm.bottom, pm.start].join("/")} ${mm}`;
		return section(
			"paper",
			__("Paper and margins"),
			sum,
			`<div class="rv-print-row rv-paper-row">${select("size", __("Paper size"), Object.keys(PAGE_SIZES).map((k) => [k, k]))}
				<div class="rv-field"><span>${esc(__("Orientation"))}</span><div class="rv-seg rv-print-seg rv-orient-seg" role="group" aria-label="${esc(__("Orientation"))}">${orient("portrait", portrait, "p")}${orient("landscape", landscape, "l")}</div></div></div>
			${seg("margins", __("Margins"), [["narrow", __("Narrow")], ["normal", __("Normal", null, "Report View")], ["wide", __("Wide")], ["custom", __("Custom", null, "Report View")]])}
			${box("page_m", __("Page margins"))}`
		);
	}

	template_section({ s, o, select, link, section }) {
		const style = this.doc_mode ? this.frappe_style() && __(this.frappe_style()) : PAGE_STYLES.find((x) => x.id === s.style)?.label();
		const sum = [s.template || style, s.font, s.lang ? o.languages.find((l) => l.name === s.lang)?.label : ""].filter(Boolean).join(" · ");
		return section(
			"tpl",
			__("Template and language"),
			sum,
			`${link("template", __("Print template"))}
			${this.doc_mode ? this.frappe_styles_html() : select("style", __("Print style"), PAGE_STYLES.map((st) => [st.id, st.label()]))}
			${this.doc_settings_html()}
			<div class="rv-field"><span>${esc(__("Font"))}</span>${font_picker_html({ value: s.font, key: "font", label: __("Font"), empty: __("The template's font") })}</div>
			${link("letter_head", __("Letter Head", null, "Report View"))}
			${link("heading", __("Print Heading", null, "Report View"))}
			${link("lang", __("Language", null, "Report View"))}`
		);
	}

	letter_head_section({ s, mm, num, seg, box, rule, scopes, section, align3, scope_label, none, no_letter_head }) {
		// the letter head builder (ADR-018), for those who may write letter heads (the
		// permission, not a role): a new design, or the chosen one opened in it; in a new tab,
		// this print stays as it is
		const builder = can_write_letter_head()
			? `<a class="rv-btn sm ghost rv-print-lhb" target="_blank" rel="noopener" href="/desk/rv-letterhead${s.letter_head ? `/${encodeURIComponent(s.letter_head)}` : ""}"><span>${esc(s.letter_head ? __("Edit in the letter head builder") : __("Design a new letter head"))}</span></a>`
			: "";
		const sum = s.letter_head ? `${s.letter_head} · ${scope_label[s.lh_pages]}` : none;
		return section(
			"head",
			__("Letter Head", null, "Report View"),
			sum,
			s.letter_head
				? `${scopes("lh_pages", PAGE_SCOPES)}
				<div class="rv-print-row">${num("lh_height", __("Height", null, "Report View"), mm)}${seg("lh_fit", __("Shape"), [["contain", __("As designed")], ["wide", __("Page width")]])}</div>
				${seg("lh_align", __("Alignment"), align3)}
				${box("lh_m", __("Letter head margins"))}
				${rule("head_line", __("Rule under the letter head"))}
				${builder}`
				: no_letter_head + builder
		);
	}

	print_heading_section({ s, o, num, seg, sw, box, rule, scopes, section, align3, scope_label, none, note }) {
		const sum = s.heading ? `${__(s.heading)} · ${scope_label[s.heading_pages]}` : none;
		const body = s.heading
			? `${scopes("heading_pages", PAGE_SCOPES)}
			${sw("heading_replace", __("Instead of the report title"))}
			<div class="rv-print-row">${num("heading_size", __("Font size"), "pt")}</div>
			${seg("heading_align", __("Alignment"), align3)}
			${box("heading_m", __("Heading margins"))}
			${rule("heading_line", __("Rule under the heading"))}
			${note(__("The heading is rendered with the report's name and its filters (Jinja: {{ title }}, {{ filters.company.value }}, {{ doc.from_date }})."))}`
			: note((o.print_headings || []).length ? __("Choose a print heading in «Template and language» to set its pages, size and place.") : __("No print heading yet: add one in Print Heading."));
		return section("heading", __("Print Heading", null, "Report View"), sum, body);
	}

	footer_section({ s, mm, num, seg, box, rule, scopes, section, align3, scope_label, none, note, no_letter_head }) {
		// the letter head is known once loaded: one without a footer says so
		const no_footer = Boolean(s.letter_head && this.letterhead_name === s.letter_head && !this.letterhead?.footer);
		this.panel_no_footer = no_footer;
		const sum = no_footer ? __("Not in this letter head") : !s.letter_head || !s.foot_height ? none : scope_label[s.foot_pages];
		const body = s.letter_head
			? `${no_footer ? note(__("The letter head «{0}» has no footer. Write one in its Footer field (Letter Head), or choose another letter head.", [s.letter_head]), true) : ""}${scopes("foot_pages", FOOT_SCOPES)}
			<div class="rv-print-row">${num("foot_height", __("Height", null, "Report View"), mm)}</div>
			${seg("foot_align", __("Alignment"), align3)}
			${box("foot_m", __("Footer margins"))}
			${rule("foot_line", __("Rule above the footer"))}`
			: no_letter_head;
		return section("foot", __("Footer", null, "Report View"), sum, body);
	}

	page_numbers_section({ s, num, sw, select, box, rule, section }) {
		const pos_label = {
			"bottom-end": __("Bottom, at the end"),
			"bottom-center": __("Bottom, centred"),
			"bottom-start": __("Bottom, at the start"),
			"top-end": __("Top, at the end"),
			"top-center": __("Top, centred"),
			"top-start": __("Top, at the start"),
		};
		const sum = s.page_numbers ? pos_label[s.number_pos] : __("Hidden");
		const formats = [["full", __("Page 1 of 3")], ["short", "1 / 3"], ["dash", "— 1 —"], ["number", "1"]];
		const body = `${sw("page_numbers", __("Show page numbers"))}
			${
				s.page_numbers
					? `${select("number_pos", __("Page number position"), Object.entries(pos_label))}
				<div class="rv-print-row">${select("number_format", __("Number format"), formats)}${num("number_start", __("Start at"), "")}</div>
				<div class="rv-print-row">${num("number_size", __("Font size"), "pt")}<div class="rv-field rv-sw-field">${sw("number_caption", __("Report name beside it"))}</div></div>
				${box("num_m", __("Space around the number"))}
				${rule("num_line", __("Rule of the number band"))}`
					: ""
			}`;
		return section("num", __("Page numbers"), sum, body);
	}

	signatures_section({ s, num, seg, sw, box, link, scopes, section, scope_label, none, note }) {
		const sum = s.signatures ? `${s.signature ? __(s.signature) : __("Standard boxes")} · ${scope_label[s.sig_pages]}` : none;
		const place =
			s.sig_pages === "last"
				? seg("sig_pos", __("Place", null, "Report View"), [["after", __("After the table")], ["bottom", __("Bottom of the page")]])
				: note(__("On these pages the signature stands at the bottom, above the footer."));
		const body = `${sw("signatures", __("Print signatures"))}
			${
				s.signatures
					? `${link("signature", __("Signature", null, "Report View"))}
				${scopes("sig_pages", FOOT_SCOPES)}
				${place}
				<div class="rv-print-row">${num("sig_size", __("Font size"), "pt")}</div>
				${box("sig_m", __("Signature margins"))}`
					: ""
			}`;
		return section("sign", __("Signatures"), sum, body);
	}

	page_border_section({ s, mm, num, sw, scopes, section, select_html, line_styles, none }) {
		const style_label = Object.fromEntries(line_styles);
		const sum = s.pb_on ? `${s.pb_w} px · ${style_label[s.pb_s]}` : none;
		const body = `${sw("pb_on", __("Border round the page"))}
			${
				s.pb_on
					? `<div class="rv-print-row">${num("pb_w", __("Thickness"), "px")}<label class="rv-field"><span>${esc(__("Line style"))}</span>${select_html('data-set="pb_s"', line_styles, s.pb_s)}</label></div>
				<div class="rv-print-row">${num("pb_offset", __("From the edge of the paper"), mm)}${num("pb_radius", __("Rounded corners"), mm)}</div>
				<div class="rv-print-row"><label class="rv-field"><span>${esc(__("Colour"))}</span><input type="color" class="rv-color-wide" data-color="pb_c" value="${this.color_of(s, "pb_c")}"></label></div>
				${scopes("pb_pages", PAGE_SCOPES)}`
					: ""
			}`;
		return section("border", __("Page border"), sum, body);
	}

	watermark_section({ s, num, seg, scopes, section, none }) {
		const text = __("Text", null, "Report View");
		const image = __("Image", null, "Report View");
		const sum = s.wm_type === "text" ? s.wm_text || text : s.wm_type === "image" ? image : none;
		const as_text =
			s.wm_type === "text"
				? `<label class="rv-field"><span>${esc(text)}</span><input type="text" class="rv-input" data-text="wm_text" maxlength="120" value="${esc(s.wm_text)}" placeholder="${esc(__("e.g. DRAFT, CONFIDENTIAL"))}"></label>
				<div class="rv-print-row">${num("wm_size", __("Font size"), "pt")}<label class="rv-field"><span>${esc(__("Colour"))}</span><input type="color" class="rv-color-wide" data-color="wm_color" value="${this.color_of(s, "wm_color")}"></label></div>`
				: "";
		const as_image =
			s.wm_type === "image"
				? `<div class="rv-field"><span>${esc(image)}</span><div class="rv-wm-img">${
						s.wm_image ? `<img src="${esc(s.wm_image)}" alt="">` : `<span class="rv-zone-empty">${esc(__("No image yet"))}</span>`
				  }<button type="button" class="rv-btn sm" data-action="wm-upload">${esc(__("Choose an image"))}</button></div>
				<input type="text" class="rv-input" data-text="wm_image" value="${esc(s.wm_image)}" placeholder="/files/logo.png" aria-label="${esc(__("Image address"))}"></div>
				${num("wm_scale", __("Width of the page"), "%")}`
				: "";
		const shared =
			s.wm_type !== "none"
				? `<div class="rv-print-row">${num("wm_opacity", __("Opacity"), "%")}${num("wm_angle", __("Angle"), "°")}</div>
				${scopes("wm_pages", PAGE_SCOPES)}`
				: "";
		return section("wm", __("Watermark"), sum, `${seg("wm_type", __("Watermark"), [["none", none], ["text", text], ["image", image]])}${as_text}${as_image}${shared}`);
	}

	/** What a report's pages carry besides its rows; a document has none of it. */
	content_section({ check, section }) {
		if (this.doc_mode) return "";
		const model = this.rows.model;
		const checks = [
			check("include_filters", __("Applied filters")),
			model?.hierarchical ? check("include_subtotals", __("Group subtotals")) : "",
			check("include_total", __("Grand Total")),
			check("printed_on", __("Print date and user")),
		];
		return section("content", __("Content", null, "Report View"), "", `<div class="rv-setlist tall">${checks.join("")}</div>`);
	}

	/** The columns of a report's own template; a print format and a document choose theirs. */
	columns_section({ s, section }) {
		if (s.template || this.doc_mode) return "";
		const model = this.rows.model;
		const columns = model ? [...model.pinned, ...model.data] : [];
		const hidden = new Set(s.hidden);
		const item = (d) =>
			`<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-col="${esc(d.column.key)}" ${hidden.has(d.column.key) ? "" : "checked"}><span>${esc(d.title)}</span></span></label>`;
		const label_column = `<label class="rv-setitem"><span class="rv-check"><input type="checkbox" checked disabled><span>${esc(model?.label_title || "")}</span></span></label>`;
		return section("cols", __("Printed columns"), hidden.size ? __("{0} hidden", [fmt_int(hidden.size)]) : "", `<div class="rv-setlist tall">${label_column}${columns.map(item).join("")}</div>`);
	}

	/**
	 * The side column (ADR-025): the sections in SIDE_GROUPS, each group one folding section
	 * with one heading (its parts under small titles), a rule between two groups.
	 * @param {string[]} secs the sections' markup, each a <details data-sec> (or "")
	 */
	side_panel(secs, note) {
		const by_id = new Map();
		for (const html of secs) {
			const id = /data-sec="([^"]+)"/.exec(html)?.[1];
			if (id) by_id.set(id, html);
		}
		const named = new Set(SIDE_GROUPS.flatMap((g) => g.secs));
		const tmp = document.createElement("div");
		const groups = SIDE_GROUPS.map((g, i) => {
			// a section no group names (a later one) joins the last group
			const ids = [...g.secs, ...(i === SIDE_GROUPS.length - 1 ? [...by_id.keys()].filter((id) => !named.has(id)) : [])].filter((id) => by_id.has(id));
			if (!ids.length) return "";
			tmp.innerHTML = ids.map((id) => by_id.get(id)).join("");
			const parts = [...tmp.querySelectorAll(":scope > .rv-psub")];
			// one heading per group: a group of one part has no title of its own for it
			if (parts.length === 1) parts[0].querySelector(".rv-psub-t").remove();
			const sum = parts.length === 1 ? parts[0].dataset.sm : parts.map((x) => x.dataset.title).join(" · ");
			const open = this.open_secs.has(g.id) ? "open" : "";
			return `<details class="rv-pgrp" data-group="${g.id}" ${open}><summary><span class="tx"><span class="tt">${esc(g.label())}</span><span class="sm">${esc(sum)}</span></span><span class="chev">${icons.chevron_down(12)}</span></summary>${tmp.innerHTML}</details>`;
		});
		const top = this.bd.scrollTop;
		this.bd.innerHTML = `${groups.join("")}${note ? `<p class="rv-zone-empty rv-print-side-note">${esc(note)}</p>` : ""}`;
		this.bind_panel();
		// the column stays where the person was in it
		this.bd.scrollTop = top;
		// the sheet of a phone keeps the focus when the control that had it was drawn again (Escape closes it)
		if (this.sheet_open() && !this.side.contains(document.activeElement)) this.side.focus({ preventScroll: true });
	}

	/** Whether the side column is the sheet of a phone, open over the pages. */
	sheet_open() {
		return this.el.classList.contains("rv-sheet-open");
	}

	/**
	 * On a phone the side column is a sheet from the bottom (rv_pages.css): the button of the
	 * head opens it over a scrim; the scrim, its close button and Escape close it. The sheet
	 * itself takes the focus, so that no field opens the keyboard and its list over it.
	 */
	open_sheet() {
		if (this.sheet_open()) return;
		const scrim = document.createElement("div");
		scrim.className = "rv-print-scrim";
		scrim.setAttribute("aria-hidden", "true");
		scrim.addEventListener("click", () => this.close_sheet());
		this.side.before(scrim);
		this.el.classList.add("rv-sheet-open");
		this.side.setAttribute("role", "dialog");
		this.side.setAttribute("aria-modal", "true");
		this.opts_btn.setAttribute("aria-expanded", "true");
		this.side.focus({ preventScroll: true });
	}

	close_sheet(focus = true) {
		if (!this.sheet_open()) return;
		this.el.classList.remove("rv-sheet-open");
		for (const n of this.el.querySelectorAll(":scope > .rv-print-body > .rv-print-scrim")) n.remove();
		this.side.removeAttribute("role");
		this.side.removeAttribute("aria-modal");
		this.opts_btn.setAttribute("aria-expanded", "false");
		if (focus) this.opts_btn.focus({ preventScroll: true });
	}

	// ------------------------------------------------------------ variables (ADR-024)

	/** The print format whose variables the pages show: the one chosen, else the document's (or the Custom caller's) own. */
	variable_format() {
		return this.settings.template || (this.doc_mode ? this.options?.default_print_format || "" : "");
	}

	/** The variables of that format, as the server listed them ([] when it has none). */
	variable_defs(name = this.variable_format()) {
		const defs = name ? this.options?.print_format_variables?.[name] : null;
		return Array.isArray(defs) ? defs : [];
	}

	/** The values the format renders with: the user's saved ones still valid, else the defaults; null without variables. */
	variable_values(name = this.variable_format()) {
		const defs = this.variable_defs(name);
		return defs.length ? values_for(defs, this.settings.variables?.[name]) : null;
	}

	/** One value changed: saved under its format, the format rendered again after a moment of quiet. */
	set_variable(key, value, wait = VARIABLE_WAIT_MS) {
		const name = this.variable_format();
		const all = this.settings.variables || {};
		this.update({ variables: { ...all, [name]: { ...(all[name] || {}), [key]: value } } }, { panel: false, wait });
	}

	/** The section «Variables»: one control per variable of the format, or nothing when it has none. */
	variables_section(section) {
		const defs = this.variable_defs();
		if (!defs.length) return "";
		const values = this.variable_values();
		const hint = (d) => (d.description ? `<small class="rv-var-desc">${esc(__(d.description))}</small>` : "");
		const body = defs
			.map((d) => {
				const v = values[d.fieldname];
				const label = __(d.label);
				const key = esc(d.fieldname);
				if (d.fieldtype === "Check") {
					return `<div class="rv-var"><label class="rv-print-sw"><span>${esc(label)}</span><button type="button" class="rv-switch${v ? " on" : ""}" role="switch" aria-checked="${Boolean(v)}" data-var-sw="${key}" aria-label="${esc(label)}"></button></label>${hint(d)}</div>`;
				}
				if (d.fieldtype === "Select") {
					const opts = String(d.options || "")
						.split("\n")
						.filter(Boolean)
						.map((o) => `<option value="${esc(o)}" ${o === v ? "selected" : ""}>${esc(__(o))}</option>`)
						.join("");
					return `<label class="rv-field rv-var"><span>${esc(label)}</span><span class="rv-selbox"><select class="rv-input" data-var="${key}">${opts}</select>${sel_icon()}</span>${hint(d)}</label>`;
				}
				if (d.fieldtype === "Link") {
					return `<div class="rv-field rv-var"><span>${esc(label)}</span><div class="rv-linkf" data-var-link="${key}" data-doctype="${esc(d.options)}" data-label="${esc(label)}"></div>${hint(d)}</div>`;
				}
				const step = d.fieldtype === "Int" ? "1" : "any";
				return `<label class="rv-field rv-num-field rv-var"><span>${esc(label)}</span><span class="rv-num"><input type="number" class="rv-input" data-var-num="${key}" data-type="${d.fieldtype}" step="${step}" value="${esc(String(v))}"></span>${hint(d)}</label>`;
			})
			.join("");
		const sum = defs.length === 1 ? __(defs[0].label) : __("{0} variables", [fmt_int(defs.length)]);
		return section("vars", __("Variables", null, "Print Format"), sum, `<div class="rv-vars">${body}</div>`);
	}

	/** The record fields of «Variables»: Frappe's Link control (its search, with the user's permissions). */
	mount_variable_links() {
		if (!frappe.ui?.form?.make_control) return;
		const values = this.variable_values() || {};
		for (const el of this.bd.querySelectorAll("[data-var-link]")) {
			const key = el.dataset.varLink;
			const f = frappe.ui.form.make_control({
				df: {
					fieldtype: "Link",
					fieldname: `rv_var_${key}`,
					options: el.dataset.doctype,
					placeholder: __(el.dataset.doctype),
					onchange: () => {
						const v = f.get_value() || "";
						if (v !== (this.variable_values()?.[key] ?? "")) this.set_variable(key, v, 0);
					},
				},
				parent: el,
				only_input: true,
			});
			f.refresh();
			if (!f.$input) f.make_input();
			f.$input.attr("aria-label", el.dataset.label);
			f.$input.on("awesomplete-open input focus", () => requestAnimationFrame(() => this.place_dropdown(f.$input.get(0))));
			f.set_input(values[key] || "");
		}
	}

	/** The controls of «Variables»: a value changed renders the format again (debounced), the panel stays. */
	bind_variables() {
		const bd = this.bd;
		this.mount_variable_links();
		for (const b of bd.querySelectorAll("[data-var-sw]")) {
			b.addEventListener("click", () => {
				const on = !b.classList.contains("on");
				b.classList.toggle("on", on);
				b.setAttribute("aria-checked", String(on));
				this.set_variable(b.dataset.varSw, on ? 1 : 0);
			});
		}
		for (const sel of bd.querySelectorAll("select[data-var]")) sel.addEventListener("change", () => this.set_variable(sel.dataset.var, sel.value));
		for (const i of bd.querySelectorAll("input[data-var-num]")) {
			i.addEventListener("input", () => {
				const n = to_number(i.dataset.type, i.value);
				if (n !== null) this.set_variable(i.dataset.varNum, n, VARIABLE_TYPING_WAIT_MS);
			});
			i.addEventListener("change", () => {
				if (to_number(i.dataset.type, i.value) === null) i.value = String(this.variable_values()?.[i.dataset.varNum] ?? 0);
			});
		}
	}

	/**
	 * A document's Standard format in Frappe's Print Styles: the picker of Frappe's print page
	 * (printing/page/print/print.js render_style_options), its markup and classes, so it looks
	 * as Frappe draws it. Another format carries its own look: nothing.
	 */
	frappe_styles_html() {
		const styles = this.options?.print_styles || [];
		if (!this.is_frappe_standard() || !styles.length) return "";
		const active = this.frappe_style();
		const scrub = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, "-");
		const tiles = styles
			.map((name) => {
				const on = name === active;
				return `<button type="button" class="print-style-option${on ? " active" : ""}" data-print-style="${esc(name)}" aria-pressed="${on}">
					<span class="print-style-thumb print-style-thumb--${esc(scrub(name))}"><span class="thumb-label"></span><span class="thumb-fields"><i></i><i></i></span><span class="thumb-table"><i></i><i></i><i></i></span></span>
					<span class="print-style-name">${esc(__(name))}</span>
				</button>`;
			})
			.join("");
		return `<div class="rv-field print-style-picker rv-frappe-styles"><span>${esc(__("Style"))}</span><div class="print-style-options">${tiles}</div></div>`;
	}

	/**
	 * A document's own print settings (Sales Invoice: group same items, the unit after the
	 * quantity, taxes of nought): Frappe's print page shows them under the page's settings,
	 * each at the site's value (Print Settings); a change holds for this print only.
	 */
	doc_settings_html() {
		const fields = this.doc_mode ? this.options?.doc_settings || [] : [];
		if (!fields.length) return "";
		const own = this.doc_settings || {};
		return `<div class="rv-setlist rv-doc-settings">${fields
			.map((f) => {
				const on = f.fieldname in own ? own[f.fieldname] : f.default;
				return `<label class="rv-setitem"><span class="rv-check"><input type="checkbox" data-doc-setting="${esc(f.fieldname)}" ${on ? "checked" : ""}><span>${esc(f.label)}</span></span></label>`;
			})
			.join("")}</div>`;
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
		// a group folds in place, remembered for the next panel, nothing drawn again
		for (const d of bd.querySelectorAll("details[data-group]")) {
			d.addEventListener("toggle", () => {
				if (d.open) this.open_secs.add(d.dataset.group);
				else this.open_secs.delete(d.dataset.group);
			});
		}
		for (const sel of bd.querySelectorAll("select[data-set]")) {
			sel.addEventListener("change", () => this.update({ [sel.dataset.set]: sel.value }));
		}
		for (const b of bd.querySelectorAll("[data-orient]")) b.addEventListener("click", () => this.update({ orientation: b.dataset.orient }));
		for (const b of bd.querySelectorAll("[data-print-style]")) b.addEventListener("click", () => this.update({ print_style: b.dataset.printStyle }));
		// the document's own print settings: this print only, never saved (Frappe's print page)
		for (const c of bd.querySelectorAll("[data-doc-setting]")) {
			c.addEventListener("change", () => {
				this.doc_settings = { ...(this.doc_settings || {}), [c.dataset.docSetting]: c.checked ? 1 : 0 };
				this.update({});
			});
		}
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
		this.bind_variables();
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
