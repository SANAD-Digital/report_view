// The letter head builder (ADR-018): the Desk page /desk/rv-letterhead[/<letter head>].
// A new letter head starts in the gallery of styles (gallery.js); a letter head made by the
// builder opens in the editor: the library (panels.js), the page (editor.js), the inspector
// (panels.js), over one store (model.js). The server alone turns the layout into the HTML
// that is saved (report_view.api.letterhead); the browser draws the same structure for the
// live preview (render.js), and «Real preview» shows what the server renders.

import "../fonts_registry.js";
import { Store, DEFAULT_COLORS, BOXED, REF_W, find, make_element, element_defaults, insert_in_slot, slot_elements, layout_bytes, LIMITS, clamp } from "./model.js";
import { build_preset, blank_layout, brand_from_rgb, PRESETS } from "./presets.js";
import { qr_texts, esc } from "./render.js";
import { Canvas } from "./editor.js";
import { Library, Inspector } from "./panels.js";
import { Gallery } from "./gallery.js";
import { icons } from "./icons.js";

const API = "report_view.api.letterhead";
const call = (method, args, type = "GET") => frappe.call({ method: `${API}.${method}`, args, type }).then((r) => r?.message);

// QR codes drawn by the server (qr_svg): fetched once the text rests, at most this many kept
const QR_WAIT_MS = 400;
const QR_KEEP = 24;

/** The company part of builder_context / company_data: {name, values: {token: text}, logo (public only)}. */
function company_of(c) {
	if (!c) return { name: null, values: {}, logo: "" };
	return { name: c.name, values: c.values || {}, logo: c.logo_public ? c.logo || "" : "" };
}

/** builder_context as the page uses it: the company, the companies, the saved layout. */
function context_of(r = {}) {
	const lh = r.letter_head || null;
	return {
		company: company_of(r.company_data),
		companies: (r.companies || []).map((c) => c.name),
		can_write: Boolean(r.can_write),
		can_set_default: Boolean(r.can_set_default),
		layout: lh?.layout || null,
		template: lh?.template || null,
		fixed_company: lh?.company || null,
		hand_edited: Boolean(lh?.hand_edited),
		exists: Boolean(lh),
	};
}

class LetterheadBuilderPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this.rtl = Boolean(frappe.utils.is_rtl?.());
		this.store = new Store();
		this.companies = [];
		this.company = null;
		this.data = new Map();
		// QR SVGs by text (a small LRU: Map in use order), the texts asked, the texts that failed
		this.qr = new Map();
		this.qr_pending = new Set();
		this.qr_failed = new Set();
		this.qr_timer = null;
		this.brands = new Map();
		this.presets = new Map();
		this.letter_head = null;
		this.has_layout = false;
		this.view = null;
		this.mq = window.matchMedia("(max-width: 900px)");
		this.mq.addEventListener("change", () => this.on_phone_change());
		this.make_dom();
		this.fit_height = this.fit_height.bind(this);
		window.addEventListener("resize", this.fit_height);
		window.addEventListener("beforeunload", (e) => {
			if (this.view === "editor" && this.store.dirty) {
				e.preventDefault();
				e.returnValue = "";
			}
		});
		this.store.on((kind) => this.on_store(kind));
	}

	get phone() {
		return this.mq.matches;
	}

	make_dom() {
		this.page.set_title(__("Letter Head Builder"));
		const root = document.createElement("div");
		root.className = "rv rvlb";
		root.dir = this.rtl ? "rtl" : "ltr";
		root.innerHTML = `
			<div class="rvlb-loading" data-view="loading"><span class="rv-xspin"></span><span>${esc(__("Loading the company's data…"))}</span></div>
			<div class="rvlb-error" data-view="error" hidden></div>
			<div class="rvlb-gallery" data-view="gallery" hidden></div>
			<div class="rvlb-editor" data-view="editor" hidden>
				<header class="rvlb-bar">
					<div class="rvlb-title"><strong data-ref="name"></strong><span class="rvlb-status" data-ref="status" role="status"></span></div>
					<span class="rvlb-flex"></span>
					<label class="rvlb-company"><span>${esc(__("Preview with the data of"))}</span><select class="rv-input sm" data-ref="company" aria-label="${esc(__("Preview with the data of"))}"></select></label>
					<div class="rvlb-group" role="group" aria-label="${esc(__("History"))}">
						<button type="button" class="rv-btn icon ghost" data-act="undo" aria-label="${esc(__("Undo"))}" title="${esc(__("Undo"))} (Ctrl+Z)"><span class="rvlb-flip">${icons.undo()}</span></button>
						<button type="button" class="rv-btn icon ghost" data-act="redo" aria-label="${esc(__("Redo"))}" title="${esc(__("Redo"))} (Ctrl+Y)"><span class="rvlb-flip">${icons.redo()}</span></button>
					</div>
					<div class="rvlb-group rvlb-zoom" role="group" aria-label="${esc(__("Zoom"))}">
						<button type="button" class="rv-btn icon sm ghost" data-act="zoom-out" aria-label="${esc(__("Zoom out"))}">${icons.minus()}</button>
						<button type="button" class="rv-btn sm ghost" data-act="zoom-fit" data-ref="zoom" title="${esc(__("Fit the page"))}">100%</button>
						<button type="button" class="rv-btn icon sm ghost" data-act="zoom-in" aria-label="${esc(__("Zoom in"))}">${icons.plus()}</button>
					</div>
					<button type="button" class="rv-btn" data-act="preview">${icons.eye()}<span>${esc(__("Real preview"))}</span></button>
					<button type="button" class="rv-btn primary" data-act="save">${icons.save()}<span>${esc(__("Save to the letter heads"))}</span></button>
				</header>
				<div class="rvlb-work">
					<aside class="rvlb-lib rvlb-sheetpanel" data-pane="lib" aria-label="${esc(__("Library"))}"></aside>
					<main class="rvlb-center" data-pane="page" aria-label="${esc(__("Page", null, "Report View"))}"></main>
					<aside class="rvlb-insp rvlb-sheetpanel" data-pane="insp" aria-label="${esc(__("Properties"))}"></aside>
				</div>
				<nav class="rvlb-phonetabs" aria-label="${esc(__("Panels"))}">
					<button type="button" data-pane-btn="lib" aria-pressed="false">${icons.elements()}<span>${esc(__("Elements"))}</span></button>
					<button type="button" data-pane-btn="page" aria-pressed="true">${icons.page()}<span>${esc(__("Page", null, "Report View"))}</span></button>
					<button type="button" data-pane-btn="insp" aria-pressed="false">${icons.sliders()}<span>${esc(__("Properties"))}</span></button>
				</nav>
			</div>`;
		this.page.main.get(0).replaceChildren(root);
		this.root = root;
		this.refs = Object.fromEntries([...root.querySelectorAll("[data-ref]")].map((n) => [n.dataset.ref, n]));
		root.addEventListener("click", (e) => this.on_click(e));
		root.addEventListener("keydown", (e) => this.on_keydown(e));
		this.refs.company.addEventListener("change", (e) => this.set_company(e.target.value));
		this.gallery = new Gallery({ parent: root.querySelector(".rvlb-gallery"), host: this });
	}

	fit_height() {
		const top = this.root.getBoundingClientRect().top + window.scrollY;
		this.root.style.height = `${Math.max(480, window.innerHeight - top - (this.phone ? 0 : 12))}px`;
	}

	set_view(view) {
		this.view = view;
		for (const n of this.root.querySelectorAll(":scope > [data-view]")) n.hidden = n.dataset.view !== view;
	}

	// ------------------------------------------------------------------ loading

	show() {
		const route = frappe.get_route();
		const name = route.slice(1).join("/") || null;
		this.fit_height();
		if (this.view && this.view !== "error" && name === this.letter_head && this.loaded) return;
		this.load(name);
	}

	async load(name) {
		this.loaded = false;
		this.set_view("loading");
		let ctx;
		try {
			ctx = context_of(await call("builder_context", { letter_head: name || undefined }));
		} catch (e) {
			return this.fail(e);
		}
		if (name && !ctx.exists) return this.fail(__("There is no letter head «{0}».", [name]));
		this.loaded = true;
		this.letter_head = name;
		this.can_write = ctx.can_write;
		this.can_set_default = ctx.can_set_default;
		this.companies = ctx.companies.length ? ctx.companies : [ctx.company.name].filter(Boolean);
		this.company = ctx.fixed_company || ctx.company.name || this.companies[0] || null;
		if (ctx.company.name) this.data.set(ctx.company.name, { ...ctx.company, can_set_default: ctx.can_set_default });
		if (this.company && !this.data.has(this.company)) await this.fetch_company(this.company);
		this.fixed_company = ctx.fixed_company;
		this.hand_edited = ctx.hand_edited;
		this.template = ctx.template;
		this.has_layout = Boolean(ctx.layout);
		this.detect_brand(this.company);
		if (ctx.layout) {
			this.store.replace(ctx.layout, { fresh: true });
			this.store.select(null);
			this.open_editor();
		} else {
			this.set_view("gallery");
			this.gallery.render();
		}
	}

	fail(e) {
		this.set_view("error");
		const box = this.root.querySelector(".rvlb-error");
		const msg = e?.message || (typeof e === "string" ? e : __("The builder could not load the company's data."));
		box.innerHTML = `<div class="rv-state"><div class="rv-state-ico err">!</div><strong>${esc(__("Could not open the builder"))}</strong><p class="rvlb-note">${esc(msg)}</p><button type="button" class="rv-btn" data-act="retry">${esc(__("Try again"))}</button></div>`;
	}

	async fetch_company(name) {
		if (this.data.has(name)) return this.data.get(name);
		const r = await call("company_data", { company: name });
		const c = { ...company_of(r?.company_data), can_set_default: Boolean(r?.can_set_default) };
		this.data.set(name, c);
		return c;
	}

	async set_company(name) {
		if (!name || name === this.company) return;
		let c;
		try {
			c = await this.fetch_company(name);
		} catch {
			// the select goes back to the company the page still draws with
			this.refs.company.value = this.company;
			frappe.show_alert({ message: __("The data of {0} could not be loaded.", [name]), indicator: "orange" });
			return;
		}
		if (c.can_set_default !== undefined) this.can_set_default = c.can_set_default;
		this.company = name;
		this.detect_brand(name);
		this.refresh_company();
	}

	refresh_company() {
		if (this.refs.company.value !== this.company) this.refs.company.value = this.company;
		if (this.view === "gallery") return this.gallery.render();
		if (this.view !== "editor") return;
		this.canvas.render();
		this.library.render();
		this.inspector.render();
	}

	/** The brand colour of a company's logo (the most saturated colour in it), for the styles. */
	detect_brand(name) {
		const c = this.data.get(name);
		if (!c?.logo || this.brands.has(name)) return;
		this.brands.set(name, null);
		const img = new Image();
		img.onload = () => {
			try {
				const cv = document.createElement("canvas");
				cv.width = cv.height = 48;
				const g = cv.getContext("2d", { willReadFrequently: true });
				g.drawImage(img, 0, 0, 48, 48);
				const px = g.getImageData(0, 0, 48, 48).data;
				const buckets = new Map();
				for (let i = 0; i < px.length; i += 4) {
					const [r, gg, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
					const max = Math.max(r, gg, b);
					const min = Math.min(r, gg, b);
					if (a < 200 || max - min < 50 || max > 245 || max < 40) continue;
					const key = `${r >> 5},${gg >> 5},${b >> 5}`;
					const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
					e.n++;
					e.r += r;
					e.g += gg;
					e.b += b;
					buckets.set(key, e);
				}
				const top = [...buckets.values()].sort((x, y) => y.n - x.n)[0];
				const brand = top && top.n > 20 ? brand_from_rgb(top.r / top.n, top.g / top.n, top.b / top.n) : null;
				this.brands.set(name, brand);
				this.presets.clear();
				if (brand && name === this.company && this.view === "gallery") this.gallery.render();
				if (brand && name === this.company && this.view === "editor") this.library.render();
			} catch {
				/* a logo the canvas cannot read keeps the default colours */
			}
		};
		img.src = c.logo;
	}

	get brand() {
		return this.brands.get(this.company) || null;
	}

	/** What render.js draws with: the preview company's values, its logo, the QR codes. */
	render_ctx() {
		const c = this.data.get(this.company) || { values: {}, logo: "" };
		return { values: c.values, logo: c.logo, qr: Object.fromEntries(this.qr) };
	}

	preset_layout(id) {
		const key = `${id}:${this.brand || ""}`;
		if (!this.presets.has(key)) this.presets.set(key, build_preset(id, { colors: { primary: this.brand || DEFAULT_COLORS.primary } }));
		return this.presets.get(key);
	}

	// ------------------------------------------------------------------ editor

	start_from(preset) {
		const layout = preset ? this.preset_layout(preset) : blank_layout({ colors: { primary: this.brand || DEFAULT_COLORS.primary } });
		this.template = preset;
		this.store.replace(layout, { fresh: !this.letter_head });
		if (!this.letter_head) this.store.saved = null;
		this.store.select(null);
		this.open_editor();
	}

	open_editor() {
		this.set_view("editor");
		if (!this.canvas) {
			this.canvas = new Canvas({ parent: this.root.querySelector(".rvlb-center"), host: this });
			this.library = new Library({ parent: this.root.querySelector(".rvlb-lib"), host: this });
			this.inspector = new Inspector({ parent: this.root.querySelector(".rvlb-insp"), host: this });
		}
		this.refs.company.innerHTML = this.companies.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
		this.refs.company.value = this.company;
		this.library.render();
		this.inspector.render();
		this.canvas.render();
		this.set_pane("page");
		requestAnimationFrame(() => {
			this.fit_height();
			this.canvas.fit_page();
		});
		this.update_bar();
	}

	on_store(kind) {
		if (this.view !== "editor") return;
		this.update_bar();
		if (kind === "select" && this.phone && this.store.selected && this.pane === "lib") this.set_pane("page");
	}

	update_bar() {
		const h = this.store.history;
		this.root.querySelector("[data-act=undo]").disabled = !h.can_undo;
		this.root.querySelector("[data-act=redo]").disabled = !h.can_redo;
		this.refs.name.textContent = this.letter_head || __("New letter head");
		this.refs.status.textContent = !this.letter_head ? __("Not saved yet") : this.store.dirty ? __("Unsaved changes") : __("Saved");
		this.refs.status.classList.toggle("is-dirty", !this.letter_head || this.store.dirty);
		const save = this.root.querySelector("[data-act=save]");
		save.disabled = !this.can_write;
		save.title = this.can_write ? "" : __("You may not write letter heads.");
	}

	on_zoom(scale, fit) {
		this.refs.zoom.textContent = `${Math.round(scale * 100)}%`;
		this.refs.zoom.setAttribute("aria-label", fit ? __("Zoom {0}%, fitted to the page", [Math.round(scale * 100)]) : __("Zoom {0}%: fit the page", [Math.round(scale * 100)]));
	}

	/** After each drawing: the QR codes the layout needs, fetched once their text rests (not per keystroke). */
	after_render() {
		const missing = qr_texts(this.store.layout, this.render_ctx()).filter((t) => !this.qr.has(t) && !this.qr_pending.has(t) && !this.qr_failed.has(t));
		if (!missing.length) return;
		clearTimeout(this.qr_timer);
		this.qr_timer = setTimeout(() => this.fetch_qr(), QR_WAIT_MS);
	}

	fetch_qr() {
		const wanted = qr_texts(this.store.layout, this.render_ctx());
		for (const t of wanted) {
			if (this.qr.has(t) || this.qr_pending.has(t) || this.qr_failed.has(t)) continue;
			this.qr_pending.add(t);
			call("qr_svg", { text: t })
				.then((r) => {
					const svg = r?.svg;
					if (!svg || !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)) throw new Error("not an svg");
					this.qr.set(t, svg.replace(/^\s*<\?xml[^>]*>/, "").replace(/<svg/i, '<svg style="width:100%;height:100%;display:block"'));
					while (this.qr.size > QR_KEEP) this.qr.delete(this.qr.keys().next().value);
					// a text typed over meanwhile is not drawn any more: no need to draw again
					if (qr_texts(this.store.layout, this.render_ctx()).includes(t)) this.canvas.render();
				})
				.catch(() => {
					this.qr_failed.add(t);
					frappe.show_alert({ message: __("The QR code could not be drawn now; it is drawn when the letter head is saved."), indicator: "orange" });
				})
				.finally(() => this.qr_pending.delete(t));
		}
		// what is drawn stays last in use order, so the LRU drops older texts first
		for (const t of wanted) {
			const svg = this.qr.get(t);
			if (svg) {
				this.qr.delete(t);
				this.qr.set(t, svg);
			}
		}
	}

	focus_inspector() {
		if (this.phone) this.set_pane("insp");
		this.inspector.focus_first();
	}

	/** Tap-to-add (and click): next to the selected element, else in the slot that suits it. */
	add(spec) {
		const L = this.store.layout;
		const sel = this.store.selected && find(L, this.store.selected);
		let place = null;
		if (sel && sel.el.slot) place = { kind: "slot", band: sel.band, slot: sel.el.slot, index: slot_elements(L, sel.band, sel.el.slot).indexOf(sel.el) + 1 };
		else if (spec.type === "band") place = { kind: "free", band: "header", rect: { x: 0, y: 0, w: REF_W, h: element_defaults("band").h } };
		else if (spec.type === "line") place = { kind: "free", band: "header", rect: { x: 0, y: Math.max(0, L.header.h - 3), w: REF_W, h: 0 } };
		else {
			const band = spec.type === "page" && L.footer.h ? "footer" : "header";
			const token = spec.patch?.props?.token;
			const want = spec.type === "page" || spec.type === "logo" || spec.type === "qr" ? "center" : token === "company_name" || token === "email" || token === "website" ? "left" : "right";
			const slot = [want, "right", "center", "left"].find((s) => L[band].slots[s] > 0);
			place = slot ? { kind: "slot", band, slot, index: Infinity } : { kind: "free", band, rect: { x: 60, y: 4, w: 60, h: 8 } };
		}
		this.add_at(spec, place);
		if (this.phone) this.set_pane("page");
	}

	/** Creates the element of a library spec where it was dropped. */
	add_at(spec, t) {
		if (this.store.layout[t.band].elements.length >= LIMITS.elements) {
			frappe.show_alert({ message: __("A band holds at most {0} elements.", [LIMITS.elements]), indicator: "orange" });
			return;
		}
		const el = this.store.commit(
			(l) => {
				const e = make_element(l, spec.type, spec.patch);
				if (t.kind === "slot") return insert_in_slot(l, e, t.band, t.slot, t.index);
				Object.assign(e, { slot: null, x: t.rect.x, y: t.rect.y, w: clamp(t.rect.w, LIMITS.min_w, REF_W) });
				if (BOXED.has(e.type)) e.h = t.rect.h;
				l[t.band].elements.push(e);
				return e;
			},
			{ select: (e) => e.id },
		);
		this.canvas.node(el.id)?.focus({ preventScroll: true });
		if (spec.type === "image") this.pick_image(el.id);
	}

	apply_preset(id) {
		const p = PRESETS.find((x) => x.id === id);
		frappe.confirm(esc(__("Replace the current design with the style «{0}»? You can undo it.", [__(p.label)])), () => {
			const keep = this.store.layout;
			this.store.replace(build_preset(id, { colors: keep.colors, font: keep.font }));
			this.template = id;
			this.store.select(null);
			frappe.show_alert({ message: __("Style applied"), indicator: "green" });
		});
	}

	pick_image(id) {
		new frappe.ui.FileUploader({
			allow_multiple: false,
			make_attachments_public: true,
			allow_toggle_private: false,
			restrictions: { allowed_file_types: ["image/*"] },
			on_success: (file) => {
				const url = file?.file_url || "";
				if (!url.startsWith("/files/")) {
					frappe.msgprint(__("Choose a public file: a private file does not show in the PDF."));
					return;
				}
				if (!find(this.store.layout, id)) return;
				this.store.commit((l) => {
					find(l, id).el.props.src = url;
				});
			},
		});
	}

	// ------------------------------------------------------------------ phone

	set_pane(pane) {
		this.pane = pane;
		for (const b of this.root.querySelectorAll("[data-pane-btn]")) b.setAttribute("aria-pressed", String(b.dataset.paneBtn === pane));
		for (const p of this.root.querySelectorAll(".rvlb-sheetpanel")) p.classList.toggle("is-open", p.dataset.pane === pane);
	}

	on_phone_change() {
		if (this.view !== "editor") return;
		this.set_pane("page");
		this.library.render();
		this.fit_height();
		this.canvas.fit_page();
	}

	// ------------------------------------------------------------------ actions

	on_click(e) {
		const pane = e.target.closest("[data-pane-btn]");
		if (pane) return this.set_pane(this.pane === pane.dataset.paneBtn && pane.dataset.paneBtn !== "page" ? "page" : pane.dataset.paneBtn);
		const act = e.target.closest("[data-act]")?.dataset.act;
		if (!act || e.target.closest("[data-act]").closest(".rvlb-insp,.rvlb-lib,.rvlb-gallery")) return;
		if (act === "undo") this.store.undo();
		if (act === "redo") this.store.redo();
		if (act === "zoom-in") this.canvas.zoom(1);
		if (act === "zoom-out") this.canvas.zoom(-1);
		if (act === "zoom-fit") this.canvas.fit_page();
		if (act === "preview") this.preview();
		if (act === "save") this.save();
		if (act === "retry") this.load(this.letter_head);
	}

	on_keydown(e) {
		if (this.view !== "editor" || e.defaultPrevented) return;
		const t = e.target;
		if (t.closest("input, textarea, select, [contenteditable]") || t.closest(".modal")) return;
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key.toLowerCase();
		if (mod && k === "z" && !e.shiftKey) {
			e.preventDefault();
			this.store.undo();
		} else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
			e.preventDefault();
			this.store.redo();
		} else if (mod && k === "d" && this.store.selected) {
			e.preventDefault();
			this.canvas.duplicate(this.store.selected);
		} else if (e.key === "Escape" && this.store.selected) {
			this.store.select(null);
		}
	}

	/** «Real preview»: the server's HTML of the layout, in an A4 frame, with the PDF margin note. */
	async preview() {
		const layout = this.store.layout;
		const d = new frappe.ui.Dialog({ title: __("Real preview"), size: "extra-large" });
		const body = d.$body.get(0);
		body.innerHTML = `<div class="rv rvlb-pvdlg" dir="${this.rtl ? "rtl" : "ltr"}"><div class="rvlb-loading"><span class="rv-xspin"></span><span>${esc(__("The server is rendering the letter head…"))}</span></div></div>`;
		d.show();
		let r;
		try {
			r = await call("preview", { layout: JSON.stringify(layout), company: this.company }, "POST");
		} catch (e) {
			body.firstElementChild.innerHTML = `<p class="rvlb-note is-warn">${esc(__("The server could not render the preview."))}</p>`;
			return;
		}
		const warnings = r?.warnings || [];
		const css = r?.print_format_css || "";
		body.firstElementChild.innerHTML = `
			<div class="rvlb-pv-wrap">
				<div class="rvlb-pv-a4" aria-label="${esc(__("A4 page"))}">
					<div class="rvlb-pv-sheet" dir="ltr">
						<div class="rvlb-pv-head">${r?.header || ""}</div>
						<div class="rvlb-pv-body" aria-hidden="true"><i style="width:38%"></i><i></i><i></i><i style="width:76%"></i><b></b><i></i><i style="width:64%"></i></div>
						<div class="rvlb-pv-foot">${r?.footer || ""}</div>
					</div>
				</div>
				<aside class="rvlb-pv-side">
					<span class="rvlb-h3">${esc(__("Rendered by the server"))}</span>
					<p class="rvlb-note">${esc(__("This is the HTML saved in the letter head, rendered for {0}, as Frappe's print, the PDF and the Report View pages show it.", [this.company || ""]))}</p>
					${warnings.length ? `<div class="rvlb-warn" role="note">${icons.alert()}<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
					<span class="rvlb-h3">${esc(__("PDF with wkhtmltopdf"))}</span>
					<p class="rvlb-note">${esc(__("With «Repeat header and footer», the page margins this letter head needs are added by themselves. Only a print format that sets its own .print-format margin keeps it; such a format needs this line instead:"))}</p>
					<div class="rvlb-code"><code class="ltr" dir="ltr">${esc(css)}</code><button type="button" class="rv-btn sm" data-copy>${icons.copy()}<span>${esc(__("Copy"))}</span></button></div>
				</aside>
			</div>`;
		body.querySelector("[data-copy]").addEventListener("click", () => frappe.utils.copy_to_clipboard(css));
		const sheet = body.querySelector(".rvlb-pv-sheet");
		const fit = () => {
			const w = body.querySelector(".rvlb-pv-a4").clientWidth;
			sheet.style.transform = `scale(${w / ((210 * 96) / 25.4)})`;
			body.querySelector(".rvlb-pv-a4").style.height = `${(w * 297) / 210}px`;
		};
		requestAnimationFrame(fit);
		d.$wrapper.on("shown.bs.modal", fit);
	}

	/** «Save to the letter heads»: a new letter head asks its name; a hand-edited one asks before overwriting. */
	save() {
		if (!this.can_write) return;
		const layout = this.store.layout;
		if (layout_bytes(layout) > LIMITS.bytes) {
			frappe.msgprint(__("The design is too large to save (over 64 KB). Remove some elements."));
			return;
		}
		if (this.letter_head) return this.send({ letter_head: this.letter_head });
		const d = new frappe.ui.Dialog({
			title: __("Save to the letter heads"),
			fields: [
				{ fieldname: "name", fieldtype: "Data", label: __("Letter head name"), reqd: 1, default: this.company || "" },
				{ fieldname: "make_default", fieldtype: "Check", hidden: this.can_set_default ? 0 : 1, label: __("Make it the company's default"), description: this.company ? __("The default letter head of {0}", [this.company]) : "" },
			],
			primary_action_label: __("Save"),
			primary_action: (v) => {
				d.hide();
				this.send({ name: v.name.trim(), make_default: v.make_default ? 1 : 0 });
			},
		});
		d.show();
	}

	async send(args, overwrite = 0) {
		// the layout is fixed to a company only when it was so before; the preview company is
		// the one a "make default" applies to
		const payload = { layout: JSON.stringify(this.store.layout), template: this.template || undefined, company: this.fixed_company || undefined, preview_company: this.company || undefined, make_default: 0, ...args, overwrite };
		const btn = this.root.querySelector("[data-act=save]");
		btn.disabled = true;
		let edited = false;
		let r;
		try {
			r = await frappe
				.call({
					method: `${API}.save`,
					args: payload,
					type: "POST",
					freeze: true,
					freeze_message: __("Saving the letter head…"),
					// a hand-edited letter head is answered with a question, not an error dialog
					error_handlers: {
						RVLetterHeadEdited: () => {
							edited = true;
						},
					},
				})
				.then((x) => x?.message);
		} catch {
			r = null;
		}
		btn.disabled = false;
		if (edited && !overwrite) return this.ask_overwrite(args);
		if (!r) return;
		const name = r.letter_head || args.letter_head || args.name;
		this.store.mark_saved();
		this.has_layout = true;
		this.hand_edited = false;
		const warn = (r.warnings || []).length ? ` · ${__("{0} warning(s): see «Real preview»", [r.warnings.length])}` : "";
		frappe.show_alert({ message: __("Saved in the letter head «{0}»", [name]) + warn, indicator: r.warnings?.length ? "orange" : "green" });
		if (name !== this.letter_head) {
			this.letter_head = name;
			this.loaded = true;
			frappe.set_route("rv-letterhead", name);
		}
		this.update_bar();
	}

	ask_overwrite(args) {
		frappe.confirm(esc(__("The content of «{0}» was edited by hand after the builder made it. Overwrite it with this design?", [args.letter_head || args.name])), () => this.send(args, 1));
	}
}

frappe.provide("report_view");
Object.assign(window.report_view, { LetterheadBuilderPage });
