// The side panels of the letter head builder (ADR-018): the library at the inline start
// (tabs «Styles» and «Elements»: the company's fields with their live values and the design
// elements, dragged onto the page or added with a click/tap) and the inspector at the inline
// end (the selected element, or the band when nothing is selected, then the layers).

import { TOKENS, SLOTS, BANDS, WEIGHTS, COLOR_NAMES, LIMITS, CONTRACT, REF_W, SLOT_PRESETS, BOXED, TEXTUAL, find, is_hex, slot_elements, move_to_slot, make_free, reorder, set_band_height, CORNERS, band_corners } from "./model.js";
import { PRESETS } from "./presets.js";
import { render_band, field_value, esc } from "./render.js";
import { token_label, type_label, slot_label, band_label, color_label, element_name } from "./labels.js";
import { icons } from "./icons.js";
import { font_picker_html, bind_font_picker } from "../components/font_picker.js";

const DESIGN = [
	{ type: "text", glyph: "t_text" },
	{ type: "image", glyph: "t_image" },
	{ type: "logo", glyph: "t_logo" },
	{ type: "line", glyph: "t_line" },
	{ type: "band", glyph: "t_band" },
	{ type: "qr", glyph: "t_qr" },
	{ type: "page", glyph: "t_page" },
];

/** A miniature of a style's header, drawn with the company's data (scaled by CSS --s). */
export function thumb_html(layout, ctx, band = "header") {
	return `<div class="rvlb-thumb" aria-hidden="true"><div class="rvlb-thumb-in">${render_band(layout, band, ctx, { comment: false, page: [1, 3] })}</div></div>`;
}

/** Scales every miniature inside `root` to the width of its frame (180mm = the band). */
export function fit_thumbs(root) {
	const ref = (180 * 96) / 25.4;
	for (const t of root.querySelectorAll(".rvlb-thumb")) {
		const w = t.clientWidth;
		if (!w) continue;
		const s = w / ref;
		t.style.setProperty("--s", String(s));
		t.style.height = `${Math.ceil(t.firstElementChild.offsetHeight * s)}px`;
	}
}

export class Library {
	constructor({ parent, host }) {
		this.host = host;
		this.parent = parent;
		this.tab = "elements";
		this.query = "";
		this.suppress = false;
		parent.addEventListener("click", (e) => this.on_click(e));
		parent.addEventListener("pointerdown", (e) => this.on_pointerdown(e));
		parent.addEventListener("input", (e) => {
			if (e.target.matches(".rvlb-q")) {
				this.query = e.target.value.trim().toLowerCase();
				this.filter();
			}
		});
		parent.addEventListener("keydown", (e) => {
			const tab = e.target.closest("[role=tab]");
			if (!tab || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
			e.preventDefault();
			this.set_tab(this.tab === "elements" ? "presets" : "elements", true);
		});
		this.ro = new ResizeObserver(() => fit_thumbs(parent));
		this.ro.observe(parent);
		host.store.on((kind) => kind === "layout" && this.mark_used());
	}

	render() {
		const ctx = this.host.render_ctx();
		const field = (t) => {
			const v = field_value(ctx, t);
			const name = token_label(t);
			return `<button type="button" class="rvlb-item" data-add="field" data-token="${t}" data-q="${esc(`${name} ${v}`.toLowerCase())}" aria-label="${esc(__("Add {0}: {1}", [name, v || __("empty")]))}">
				<span class="rvlb-grip">${icons.grip()}</span>
				<span class="rvlb-item-n">${esc(name)}</span>
				<span class="rvlb-item-v${v ? " ltr" : " is-empty"}">${esc(v ? v.split("\n")[0] : __("Empty"))}</span>
				<span class="rvlb-used" title="${esc(__("On the page"))}">${icons.check()}</span>
			</button>`;
		};
		const design = (d) => `<button type="button" class="rvlb-tile" data-add="${d.type}" data-q="${esc(type_label(d.type).toLowerCase())}" aria-label="${esc(__("Add {0}", [type_label(d.type)]))}">${icons[d.glyph]()}<span>${esc(type_label(d.type))}</span></button>`;
		const presets = PRESETS.map((p) => `<button type="button" class="rvlb-pcard" data-preset="${p.id}">${thumb_html(this.host.preset_layout(p.id), ctx)}<span>${esc(__(p.label))}</span></button>`).join("");
		this.parent.innerHTML = `
			<div class="rvlb-tabs" role="tablist" aria-label="${esc(__("Library"))}">
				<button type="button" role="tab" id="rvlb-tab-presets" aria-controls="rvlb-panel-presets" data-tab="presets">${esc(__("Styles"))}</button>
				<button type="button" role="tab" id="rvlb-tab-elements" aria-controls="rvlb-panel-elements" data-tab="elements">${esc(__("Elements"))}</button>
			</div>
			<div class="rvlb-tabpanel" role="tabpanel" id="rvlb-panel-elements" aria-labelledby="rvlb-tab-elements" data-panel="elements">
				<label class="rvlb-search">${icons.search()}<input type="search" class="rvlb-q" placeholder="${esc(__("Find a field or an element"))}" aria-label="${esc(__("Find a field or an element"))}" value="${esc(this.query)}"></label>
				<h3 class="rvlb-h3">${esc(__("From the company's data"))}</h3>
				<div class="rvlb-fields">${TOKENS.map(field).join("")}</div>
				<h3 class="rvlb-h3">${esc(__("Design elements"))}</h3>
				<div class="rvlb-tiles">${DESIGN.map(design).join("")}</div>
				<p class="rvlb-tip">${esc(this.host.phone ? __("Tap to add to the page.") : __("Drag onto a slot or anywhere on a band, or click to add."))}</p>
			</div>
			<div class="rvlb-tabpanel" role="tabpanel" id="rvlb-panel-presets" aria-labelledby="rvlb-tab-presets" data-panel="presets">
				<p class="rvlb-tip">${esc(__("Applying a style replaces the current design (you can undo)."))}</p>
				<div class="rvlb-pcards">${presets}</div>
			</div>`;
		this.set_tab(this.tab);
		this.filter();
		this.mark_used();
		requestAnimationFrame(() => fit_thumbs(this.parent));
	}

	set_tab(tab, focus = false) {
		this.tab = tab;
		for (const b of this.parent.querySelectorAll("[role=tab]")) {
			const on = b.dataset.tab === tab;
			b.setAttribute("aria-selected", String(on));
			b.tabIndex = on ? 0 : -1;
			if (on && focus) b.focus();
		}
		for (const p of this.parent.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== tab;
		if (tab === "presets") requestAnimationFrame(() => fit_thumbs(this.parent));
	}

	filter() {
		for (const b of this.parent.querySelectorAll("[data-q]")) b.hidden = Boolean(this.query) && !b.dataset.q.includes(this.query);
	}

	mark_used() {
		const L = this.host.store.layout;
		const used = new Set(BANDS.flatMap((b) => L[b].elements.filter((e) => e.type === "field").map((e) => e.props.token)));
		for (const b of this.parent.querySelectorAll("[data-token]")) b.classList.toggle("is-used", used.has(b.dataset.token));
	}

	spec_of(btn) {
		const type = btn.dataset.add;
		if (type === "field") {
			const token = btn.dataset.token;
			return { type, label: token_label(token), patch: { props: { token, label: "", hide_empty: true } } };
		}
		return { type, label: type_label(type), patch: {} };
	}

	on_pointerdown(e) {
		const btn = e.target.closest("[data-add]");
		if (!btn || e.button !== 0 || e.pointerType === "touch" || this.host.phone) return;
		this.host.canvas.begin_new(e, this.spec_of(btn), () => {
			this.suppress = true;
		});
	}

	on_click(e) {
		const tab = e.target.closest("[data-tab]");
		if (tab) return this.set_tab(tab.dataset.tab);
		const preset = e.target.closest("[data-preset]");
		if (preset) return this.host.apply_preset(preset.dataset.preset);
		const btn = e.target.closest("[data-add]");
		if (!btn) return;
		if (this.suppress) {
			this.suppress = false;
			return;
		}
		this.host.add(this.spec_of(btn));
	}
}

// ---------------------------------------------------------------------- inspector

const num_input = (k, value, { label, min, max, step = 0.5, unit = "", placeholder = "" }) =>
	`<label class="rvlb-num"><span>${esc(label)}</span><span class="rvlb-num-in"><input type="number" inputmode="decimal" class="rv-input sm" data-k="${k}" value="${value ?? ""}" min="${min}" max="${max}" step="${step}" placeholder="${esc(placeholder)}">${unit ? `<i>${esc(unit)}</i>` : ""}</span></label>`;

const seg = (k, value, options, { label, disabled = () => false } = {}) =>
	`<div class="rv-seg rvlb-seg" role="group" aria-label="${esc(label)}">${options
		.map(([v, text]) => `<button type="button" data-k="${k}" data-v="${esc(v)}" class="${String(v) === String(value) ? "on" : ""}" aria-pressed="${String(v) === String(value)}"${disabled(v) ? " disabled" : ""}>${esc(text)}</button>`)
		.join("")}</div>`;

// the rounded corners of a colour band, laid out as on the paper (left stays left in Arabic)
const CORNER_LABELS = { tl: () => __("Top left corner"), tr: () => __("Top right corner"), bl: () => __("Bottom left corner"), br: () => __("Bottom right corner") };
function corners_html(p) {
	const on = p.corners === "all" ? CORNERS : p.corners.split(",");
	const btn = (c) => `<button type="button" class="rvlb-corner rvlb-corner-${c}" data-corner="${c}" aria-pressed="${on.includes(c)}" aria-label="${esc(CORNER_LABELS[c]())}" title="${esc(CORNER_LABELS[c]())}"></button>`;
	return `<div class="rvlb-lbl">${esc(__("Corners to round"))}</div><div class="rvlb-corners" dir="ltr" role="group" aria-label="${esc(__("Corners to round"))}">${["tl", "tr", "bl", "br"].map(btn).join("")}</div>`;
}

const section = (title, body) => `<section class="rvlb-sec"><h3 class="rvlb-h3">${esc(title)}</h3>${body}</section>`;

export class Inspector {
	constructor({ parent, host }) {
		this.host = host;
		this.parent = parent;
		this.band = "header";
		this.own = false;
		host.store.on((kind) => {
			if (kind === "select") return this.render();
			if (kind !== "layout") return;
			if (this.own) {
				this.own = false;
				this.render_layers();
			} else this.render();
		});
		parent.addEventListener("input", (e) => this.on_input(e));
		parent.addEventListener("change", (e) => this.on_change(e));
		parent.addEventListener("click", (e) => this.on_click(e));
		bind_font_picker(parent, (key, family) => this.set(key, family, false));
	}

	get L() {
		return this.host.store.layout;
	}

	render() {
		const a = document.activeElement;
		const keep = a && this.parent.contains(a) ? (a.dataset.k ? `[data-k="${a.dataset.k}"]${a.dataset.v !== undefined ? `[data-v="${a.dataset.v}"]` : ""}` : a.dataset.act ? `[data-act="${a.dataset.act}"]` : null) : null;
		const f = this.host.store.selected && find(this.L, this.host.store.selected);
		this.parent.innerHTML = `<div class="rvlb-insp-main">${f ? this.element_html(f) : this.band_html()}</div><section class="rvlb-sec rvlb-layers-sec"><h3 class="rvlb-h3">${esc(__("Layers"))}</h3><div class="rvlb-layers"></div></section>`;
		this.render_layers();
		if (keep) this.parent.querySelector(keep)?.focus({ preventScroll: true });
	}

	colors_html(k, value, label) {
		const L = this.L;
		const custom = is_hex(value) ? value : "";
		return `<div class="rvlb-colors" role="group" aria-label="${esc(label)}">${COLOR_NAMES.map((c) => `<button type="button" class="rvlb-sw" data-k="${k}" data-v="${c}" style="background:${L.colors[c]}" aria-label="${esc(color_label(c))}" aria-pressed="${value === c}" title="${esc(color_label(c))}"></button>`).join("")}
			<button type="button" class="rvlb-sw is-white" data-k="${k}" data-v="#FFFFFF" aria-label="${esc(__("White"))}" aria-pressed="${value === "#FFFFFF"}" title="${esc(__("White"))}"></button>
			<label class="rvlb-custom${custom && custom !== "#FFFFFF" ? " on" : ""}" title="${esc(__("Another colour"))}"><input type="color" data-k="${k}" value="${custom || L.colors.primary}" aria-label="${esc(__("Another colour"))}"><span>${esc(custom && custom !== "#FFFFFF" ? custom : __("Other"))}</span></label></div>`;
	}

	element_html({ band, el }) {
		const L = this.L;
		const b = L[band];
		const k = (p) => `el.${p}`;
		const head = `<div class="rvlb-insp-head">
			<div><small>${esc(__("Selected element"))}</small><strong>${esc(element_name(el))}</strong><small>${esc(type_label(el.type))}</small></div>
			<div class="rvlb-insp-acts">
				<button type="button" class="rv-btn icon sm ghost" data-act="duplicate" aria-label="${esc(__("Duplicate", null, "Report View"))}" title="${esc(__("Duplicate", null, "Report View"))} (Ctrl+D)">${icons.copy()}</button>
				<button type="button" class="rv-btn icon sm ghost rvlb-danger" data-act="delete" aria-label="${esc(__("Delete"))}" title="${esc(__("Delete"))} (Delete)">${icons.trash()}</button>
				<button type="button" class="rv-btn icon sm ghost" data-act="deselect" aria-label="${esc(__("Close"))}" title="${esc(__("Close"))} (Esc)">${icons.close()}</button>
			</div></div>`;
		const place = section(
			__("Place"),
			`${seg("place", el.slot || "free", [...SLOTS.map((s) => [s, slot_label(s)]), ["free", __("Free (element)")]], { label: __("Place"), disabled: (v) => v !== "free" && !b.slots[v] })}
			${seg("band", band, BANDS.map((x) => [x, band_label(x)]), { label: __("Band"), disabled: (v) => !L[v].h })}`,
		);
		let size = "";
		if (el.slot === null) {
			size = section(
				__("Position and size (mm)"),
				`<div class="rvlb-grid4">${num_input(k("x"), el.x, { label: __("From left"), min: 0, max: REF_W })}${num_input(k("y"), el.y, { label: __("From top"), min: 0, max: b.h })}${num_input(k("w"), el.w, { label: __("Width"), min: LIMITS.min_w, max: REF_W })}${el.type === "line" ? "" : num_input(k("h"), el.h || "", { label: __("Height"), min: 0, max: CONTRACT.limits.h[1], placeholder: __("auto") })}</div>`,
			);
		} else if (BOXED.has(el.type)) {
			size = section(__("Size (mm)"), `<div class="rvlb-grid4 two">${num_input(k("w"), el.w, { label: __("Width"), min: 1, max: REF_W })}${num_input(k("h"), el.h, { label: __("Height"), min: 1, max: CONTRACT.limits.h[1] })}</div>`);
		}
		const content = this.content_html(el);
		let style = "";
		if (TEXTUAL.has(el.type)) {
			style = section(
				__("Text", null, "Report View"),
				`<div class="rvlb-row">${num_input(k("style.size"), el.style.size, { label: __("Size"), min: LIMITS.size[0], max: LIMITS.size[1], step: 0.5, unit: "pt" })}
				<label class="rvlb-num"><span>${esc(__("Weight"))}</span><select class="rv-input sm" data-k="${k("style.weight")}">${WEIGHTS.map((w) => `<option value="${w}"${w === el.style.weight ? " selected" : ""}>${esc({ 400: __("Regular"), 500: __("Medium"), 600: __("Semibold"), 700: __("Bold") }[w])}</option>`).join("")}</select></label></div>
				<div class="rvlb-lbl">${esc(__("Colour"))}</div>${this.colors_html(k("style.color"), el.style.color, __("Colour"))}
				${el.slot === null ? `<div class="rvlb-lbl">${esc(__("Alignment"))}</div>${seg(k("style.align"), el.style.align, [["start", __("Align start")], ["center", __("Align centre")], ["end", __("Align end")]], { label: __("Alignment") })}` : `<p class="rvlb-note">${esc(__("In a slot the text follows the slot: right is right-aligned, left is left-aligned."))}</p>`}`,
			);
		} else if (el.type === "line") {
			style = section(__("Colour"), this.colors_html(k("style.color"), el.style.color, __("Colour")));
		}
		const gap = el.slot ? section(__("Space after it"), `<div class="rvlb-row">${num_input(k("style.gap"), el.style.gap, { label: __("Gap"), min: LIMITS.gap[0], max: LIMITS.gap[1], step: 0.2, unit: __("mm") })}</div>`) : "";
		return head + place + size + content + style + gap;
	}

	content_html(el) {
		const k = (p) => `el.props.${p}`;
		const p = el.props;
		const ctx = this.host.render_ctx();
		switch (el.type) {
			case "text":
				return section(
					__("Content", null, "Report View"),
					`<textarea class="rv-input rvlb-ta" rows="3" data-k="${k("text")}" maxlength="${LIMITS.text}" dir="${p.dir}" aria-label="${esc(__("Text", null, "Report View"))}" placeholder="${esc(__("Write a text"))}">${esc(p.text)}</textarea>
					<div class="rvlb-lbl">${esc(__("Direction"))}</div>${seg(k("dir"), p.dir, [["auto", __("Automatic", null, "Report View")], ["rtl", __("Right to left")], ["ltr", __("Left to right")]], { label: __("Direction") })}`,
				);
			case "field": {
				const v = field_value(ctx, p.token);
				return section(
					__("Company field"),
					`<label class="rvlb-num wide"><span>${esc(__("Field"))}</span><select class="rv-input sm" data-k="${k("token")}">${TOKENS.map((t) => `<option value="${t}"${t === p.token ? " selected" : ""}>${esc(token_label(t))}</option>`).join("")}</select></label>
					<div class="rvlb-live${v ? "" : " is-empty"}"><span>${esc(v ? __("Live value") : __("Empty in the company"))}</span><b class="${v ? "ltr" : ""}">${esc(v || __("hidden in print"))}</b></div>
					${v ? "" : `<a class="rv-link" href="/desk/company/${encodeURIComponent(this.host.company || "")}" target="_blank" rel="noopener">${esc(__("Fill it in the company record"))}</a>`}
					<label class="rvlb-num wide"><span>${esc(__("Label before the value"))}</span><input type="text" class="rv-input sm" data-k="${k("label")}" maxlength="${LIMITS.label}" value="${esc(p.label)}" placeholder="${esc(__("e.g. Tel:"))}"></label>
					<label class="rv-check sm"><input type="checkbox" data-k="${k("hide_empty")}"${p.hide_empty ? " checked" : ""}><span>${esc(__("Hide the line when the value is empty"))}</span></label>`,
				);
			}
			case "logo":
				return section(__("Logo"), `<p class="rvlb-note">${esc(ctx.logo ? __("The logo of the company record, kept within the size above.") : __("The company has no logo: add one in the company record."))}</p>`);
			case "image":
				return section(
					__("Image", null, "Report View"),
					`${p.src ? `<div class="rvlb-imgpv"><img src="${esc(p.src)}" alt=""></div>` : ""}
					<button type="button" class="rv-btn sm" data-act="pick-image">${icons.upload()}<span>${esc(p.src ? __("Replace the image") : __("Choose an image"))}</span></button>
					<p class="rvlb-note">${esc(__("Public files only: a private file does not show in the PDF."))}</p>
					<div class="rvlb-lbl">${esc(__("Fit", null, "Report View"))}</div>${seg(k("fit"), p.fit, [["contain", __("Whole image")], ["cover", __("Fill the box")]], { label: __("Fit", null, "Report View") })}`,
				);
			case "line":
				return section(
					__("Line"),
					`<div class="rvlb-row">${num_input(k("thick"), p.thick, { label: __("Thickness"), min: LIMITS.thick[0], max: LIMITS.thick[1], step: 0.1, unit: __("mm") })}${el.slot ? num_input("el.w", el.w || "", { label: __("Length"), min: 0, max: REF_W, placeholder: __("slot") }) : ""}</div>
					${seg(k("style"), p.style, [["solid", __("Solid")], ["dashed", __("Dashed")], ["double", __("Double")]], { label: __("Line style") })}`,
				);
			case "band":
				return section(__("Colour band"), `<div class="rvlb-lbl">${esc(__("Fill"))}</div>${this.colors_html(k("fill"), p.fill, __("Fill"))}<div class="rvlb-row">${num_input(k("radius"), p.radius, { label: __("Corner radius"), min: LIMITS.radius[0], max: LIMITS.radius[1], step: 0.5, unit: __("mm") })}</div>${corners_html(p)}`);
			case "qr":
				return section(
					__("QR code"),
					`${seg(k("source"), p.source, [["website", __("The company's website")], ["text", __("A text")]], { label: __("Content", null, "Report View") })}
					${p.source === "text" ? `<textarea class="rv-input rvlb-ta" rows="2" dir="ltr" data-k="${k("text")}" maxlength="${LIMITS.qr_text}" aria-label="${esc(__("QR text"))}">${esc(p.text)}</textarea>` : `<p class="rvlb-note ltr">${esc(field_value(ctx, "website") || __("The company has no website"))}</p>`}`,
				);
			case "page":
				return section(__("Page number"), seg(k("format"), p.format, [["ar", "صفحة ١ من ٣"], ["en", "Page 1 of 3"], ["both", __("Both")]], { label: __("Format") }));
			default:
				return "";
		}
	}

	band_html() {
		const L = this.L;
		const b = L[this.band];
		const k = (p) => `band.${p}`;
		const [lo, hi] = this.band === "header" ? LIMITS.header_h : LIMITS.footer_h;
		const sum = SLOTS.reduce((n, s) => n + b.slots[s], 0);
		const closed = b.elements.filter((e) => e.slot && !b.slots[e.slot]).length;
		const preset = Object.entries(SLOT_PRESETS).find(([, v]) => SLOTS.every((s) => v[s] === b.slots[s]))?.[0];
		const names = { three: __("Three slots"), two: __("Two slots"), logo_right: __("Logo right"), center_only: __("Centre only") };
		return `<div class="rvlb-insp-head"><div><small>${esc(__("Nothing selected"))}</small><strong>${esc(__("Paper settings"))}</strong><small>${esc(__("Select an element on the page to edit it."))}</small></div></div>
			${section(__("Band"), seg("ui.band", this.band, BANDS.map((x) => [x, band_label(x)]), { label: __("Band") }))}
			${section(
				__("Size (mm)"),
				`<div class="rvlb-grid4 two">${num_input(k("h"), b.h, { label: __("Height"), min: lo, max: hi, step: 1 })}${num_input(k("pad_top"), b.pad_top, { label: __("Top padding"), min: LIMITS.pad_top[0], max: LIMITS.pad_top[1] })}</div>
				${this.band === "footer" ? `<p class="rvlb-note">${esc(__("Height 0 = no footer."))}</p>` : ""}`,
			)}
			${section(
				__("Slots (% of the width)"),
				`<div class="rvlb-pills" role="group" aria-label="${esc(__("Slot layout"))}">${Object.keys(SLOT_PRESETS).map((p) => `<button type="button" data-k="ui.slots" data-v="${p}" class="rvlb-pill${p === preset ? " on" : ""}" aria-pressed="${p === preset}">${esc(names[p])}</button>`).join("")}</div>
				<div class="rvlb-grid4 three">${SLOTS.map((s) => num_input(k(`slots.${s}`), b.slots[s], { label: slot_label(s), min: LIMITS.slot[0], max: LIMITS.slot[1], step: 1, unit: "%" })).join("")}</div>
				<p class="rvlb-note${sum > 100 ? " is-warn" : ""}">${esc(__("Together {0}% of 100%; 0 closes a slot.", [sum]))}</p>
				${closed ? `<p class="rvlb-note is-warn">${esc(__("{0} element(s) sit in a closed slot and are not printed.", [closed]))}</p>` : ""}`,
			)}
			${section(
				__("Font and colours"),
				`<div class="rvlb-num wide"><span>${esc(__("Font"))}</span>${font_picker_html({ value: L.font, key: "layout.font", label: __("Font") })}</div>
				<div class="rvlb-tricolor">${COLOR_NAMES.map((c) => `<label class="rvlb-cpick"><input type="color" data-k="layout.colors.${c}" value="${L.colors[c]}" aria-label="${esc(color_label(c))}"><span><b>${esc(color_label(c))}</b><i class="ltr">${L.colors[c]}</i></span></label>`).join("")}</div>`,
			)}`;
	}

	render_layers() {
		const box = this.parent.querySelector(".rvlb-layers");
		if (!box) return;
		const L = this.L;
		const sel = this.host.store.selected;
		box.innerHTML = BANDS.map((b) => {
			const els = L[b].elements;
			const rows = [...SLOTS.flatMap((s) => slot_elements(L, b, s)), ...els.filter((e) => e.slot === null)]
				.map(
					(e) => `<div class="rvlb-layer${e.id === sel ? " on" : ""}">
					<button type="button" class="rvlb-layer-n" data-select="${e.id}" aria-pressed="${e.id === sel}"><span>${esc(element_name(e))}</span><small>${esc(slot_label(e.slot))}</small></button>
					<button type="button" class="rv-btn icon sm ghost" data-up="${e.id}" aria-label="${esc(__("Move {0} up", [element_name(e)]))}">${icons.up()}</button>
					<button type="button" class="rv-btn icon sm ghost" data-down="${e.id}" aria-label="${esc(__("Move {0} down", [element_name(e)]))}">${icons.down()}</button>
				</div>`,
				)
				.join("");
			return `<div class="rvlb-layer-g"><div class="rvlb-layer-t">${esc(band_label(b))} <small>${els.length}</small></div>${rows || `<p class="rvlb-note">${esc(__("Empty"))}</p>`}</div>`;
		}).join("");
	}

	// ------------------------------------------------------------------ edits

	set(path, value, merge = true) {
		const id = this.host.store.selected;
		const band = this.band;
		this.host.store.commit(
			(l) => {
				// a band's height also keeps its free elements inside it
				if (path === "band.h") return set_band_height(l, band, value);
				const parts = path.split(".");
				let obj = parts[0] === "el" ? find(l, id)?.el : parts[0] === "band" ? l[band] : l;
				if (!obj) return;
				for (const p of parts.slice(1, -1)) obj = obj[p];
				obj[parts.at(-1)] = value;
			},
			{ merge: merge ? `insp:${id}:${path}` : null },
		);
	}

	value_of(input) {
		if (input.type === "checkbox") return input.checked;
		if (input.type === "number") {
			if (input.value === "") return input.dataset.k === "el.h" || input.dataset.k === "el.w" ? 0 : undefined;
			const n = parseFloat(input.value);
			return Number.isFinite(n) ? n : undefined;
		}
		if (input.dataset.k === "el.style.weight") return parseInt(input.value, 10);
		if (input.type === "color") return input.value.toUpperCase();
		return input.value;
	}

	on_input(e) {
		const input = e.target;
		const k = input.dataset.k;
		if (!k || input.tagName === "SELECT" || input.type === "checkbox") return;
		const v = this.value_of(input);
		if (v === undefined) return;
		this.own = true;
		this.set(k, v);
		const hex = input.type === "color" && input.closest(".rvlb-cpick")?.querySelector("i");
		if (hex) hex.textContent = v;
	}

	on_change(e) {
		const input = e.target;
		const k = input.dataset.k;
		if (!k) return;
		if (input.tagName === "SELECT" || input.type === "checkbox") {
			this.set(k, this.value_of(input), false);
			return;
		}
		// a typed number the layout clamped: show what was kept
		if (input.type === "number" || input.type === "color") this.render();
	}

	on_click(e) {
		const store = this.host.store;
		const id = store.selected;
		const sel = e.target.closest("[data-select]");
		if (sel) {
			store.select(sel.dataset.select);
			this.host.canvas.focus_selected();
			return;
		}
		const up = e.target.closest("[data-up],[data-down]");
		if (up) {
			const eid = up.dataset.up || up.dataset.down;
			store.commit((l) => reorder(l, eid, up.dataset.up ? -1 : 1));
			return;
		}
		const act = e.target.closest("[data-act]")?.dataset.act;
		if (act === "delete") return this.host.canvas.remove(id);
		if (act === "duplicate") return this.host.canvas.duplicate(id);
		if (act === "deselect") return store.select(null);
		if (act === "pick-image") return this.host.pick_image(id);
		const corner = e.target.closest("button[data-corner]");
		if (corner) {
			// a corner on or off; all four off is "all" again with a radius of its own
			const f = find(store.layout, id);
			const on = new Set(f.el.props.corners === "all" ? CORNERS : f.el.props.corners.split(","));
			on.has(corner.dataset.corner) ? on.delete(corner.dataset.corner) : on.add(corner.dataset.corner);
			this.set("el.props.corners", band_corners([...on].join(",")), false);
			return this.render();
		}
		const b = e.target.closest("button[data-k]");
		if (!b || b.disabled) return;
		const k = b.dataset.k;
		const v = b.dataset.v;
		if (k === "ui.band") {
			this.band = v;
			return this.render();
		}
		if (k === "ui.slots") {
			const preset = SLOT_PRESETS[v];
			store.commit((l) => {
				l[this.band].slots = { ...preset };
			});
			return;
		}
		if (k === "place") {
			const f = find(store.layout, id);
			if (v === "free") {
				const node = this.host.canvas.node(id);
				const r = node ? this.host.canvas.measure(node, node.closest(".rvlb-zone")) : { x: 0, y: 0 };
				store.commit((l) => make_free(l, id, f.band, { x: Math.round(r.x), y: Math.round(r.y), w: f.el.w || Math.round(r.w) || 60, h: BOXED.has(f.el.type) ? f.el.h : 0 }), { select: id });
			} else store.commit((l) => move_to_slot(l, id, f.band, v), { select: id });
			return;
		}
		if (k === "band") {
			const f = find(store.layout, id);
			if (v === f.band) return;
			if (f.el.slot && store.layout[v].slots[f.el.slot]) store.commit((l) => move_to_slot(l, id, v, f.el.slot), { select: id });
			else store.commit((l) => make_free(l, id, v, { x: f.el.x, y: 0, w: f.el.w || 60, h: f.el.h }), { select: id });
			return;
		}
		const cur = k.split(".").reduce((o, p) => (o ? o[p] : undefined), { el: find(store.layout, id)?.el });
		this.set(k, typeof cur === "number" ? +v : v, false);
	}

	focus_first() {
		this.parent.querySelector("textarea, input[type=text], input, select")?.focus();
	}
}

