// The canvas of the letter head builder (ADR-018): the whole A4 page at scale, the header
// band on top, the footer band at the bottom, the document's body faded between them. The
// bands are drawn by render.js (the very HTML that prints, with the company's values); over
// them an overlay draws the three slots, the selection with its handles, the alignment
// guides and the drop indicator.
// Pointer Events only (no library): a free element moves and resizes in mm on a 1mm grid,
// snapping to the edges and centres of the band, of the slots and of the other elements;
// dragging a slotted element out of its slot frees it, dropping one on a slot docks it at
// the indicated place. While dragging, only the moved element and the overlay change
// (pointer moves are read once per animation frame); the layout is committed on release.
// Keyboard: arrows move a free element 1mm (Shift: 5mm) or a slotted one within and across
// slots, Delete removes, Ctrl/Cmd+D duplicates, Escape clears the selection; the inner edge
// of a band is a slider for its height.

import { BANDS, PAGE, REF_W, LIMITS, GRID_MM, NUDGE_MM, NUDGE_BIG_MM, find, slot_box, slot_at, insert_index, snap_move, snap_grid, resize_rect, guide_targets, element_defaults, reorder, neighbour_slot, move_to_slot, make_free, remove, duplicate, clamp, BOXED, set_band_height } from "./model.js";
import { render_band, esc } from "./render.js";
import { element_aria, element_hint, band_label, slot_label } from "./labels.js";
import { icons } from "./icons.js";

const PX_MM = 96 / 25.4;
const DRAG_PX = 4;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const pct = (mm) => `${+((mm / REF_W) * 100).toFixed(3)}%`;
const fmt = (v) => String(+(+v).toFixed(1));

export class Canvas {
	constructor({ parent, host }) {
		this.host = host;
		this.store = host.store;
		this.scale = 1;
		this.fit = true;
		this.grid_on = true;
		this.guides_on = true;
		this.make_dom(parent);
		this.store.on((kind) => {
			if (kind === "layout") this.render();
			else if (kind === "select") this.update_selection();
		});
		this.ro = new ResizeObserver(() => this.fit && this.fit_page());
		this.ro.observe(this.stage);
	}

	make_dom(parent) {
		const zone = (b) => `
			<div class="rvlb-zone" data-band="${b}">
				<div class="rvlb-paper"></div>
				<div class="rvlb-over" aria-hidden="true"><div class="rvlb-slots"></div><div class="rvlb-guides"></div><div class="rvlb-drop" hidden></div><div class="rvlb-sel" hidden>${HANDLES.map((h) => `<span class="rvlb-h" data-h="${h}"></span>`).join("")}</div></div>
				<div class="rvlb-edge" role="slider" tabindex="0" aria-orientation="vertical" aria-label="${esc(__("Height of the {0} (mm)", [band_label(b)]))}"><span></span></div>
				<span class="rvlb-tag" dir="${this.host.rtl ? "rtl" : "ltr"}"></span>
			</div>`;
		parent.innerHTML = `
			<div class="rvlb-stage">
				<div class="rvlb-ruler" aria-hidden="true"></div>
				<div class="rvlb-sheetbox">
					<div class="rvlb-sheet" dir="ltr" role="group" aria-label="${esc(__("The page: header, body and footer"))}">
						${zone("header")}
						<div class="rvlb-body" aria-hidden="true">
							<i style="width:38%"></i><i></i><i></i><i style="width:76%"></i>
							<b></b><i></i><i style="width:64%"></i>
							<span dir="${this.host.rtl ? "rtl" : "ltr"}">${esc(__("The document's content is not edited here"))}</span>
						</div>
						${zone("footer")}
					</div>
				</div>
				<div class="rvlb-badge" hidden></div>
				<div class="rvlb-sr" aria-live="polite" aria-atomic="true"></div>
			</div>
			<div class="rvlb-float" role="toolbar" aria-label="${esc(__("Canvas"))}">
				<button type="button" class="rvlb-tog" data-act="grid" aria-pressed="true">${icons.grid()}<span>${esc(__("Grid 1 mm"))}</span></button>
				<button type="button" class="rvlb-tog" data-act="guides" aria-pressed="true">${icons.guides()}<span>${esc(__("Alignment guides"))}</span></button>
				<span class="rvlb-float-hint">${esc(__("Alt: no snapping"))}</span>
			</div>`;
		this.root = parent;
		this.stage = parent.querySelector(".rvlb-stage");
		this.ruler = parent.querySelector(".rvlb-ruler");
		this.box = parent.querySelector(".rvlb-sheetbox");
		this.sheet = parent.querySelector(".rvlb-sheet");
		this.body = parent.querySelector(".rvlb-body");
		this.badge = parent.querySelector(".rvlb-badge");
		this.live = parent.querySelector(".rvlb-sr");
		this.zones = {};
		for (const b of BANDS) {
			const z = parent.querySelector(`.rvlb-zone[data-band=${b}]`);
			this.zones[b] = { el: z, paper: z.querySelector(".rvlb-paper"), slots: z.querySelector(".rvlb-slots"), guides: z.querySelector(".rvlb-guides"), drop: z.querySelector(".rvlb-drop"), sel: z.querySelector(".rvlb-sel"), edge: z.querySelector(".rvlb-edge"), tag: z.querySelector(".rvlb-tag") };
		}
		this.sheet.addEventListener("pointerdown", (e) => this.on_pointerdown(e));
		this.sheet.addEventListener("keydown", (e) => this.on_keydown(e));
		this.sheet.addEventListener("dblclick", (e) => {
			const node = e.target.closest(".rvlb-el");
			if (node) this.host.focus_inspector?.();
		});
		parent.querySelector(".rvlb-float").addEventListener("click", (e) => {
			const b = e.target.closest("[data-act]");
			if (!b) return;
			if (b.dataset.act === "grid") this.grid_on = !this.grid_on;
			if (b.dataset.act === "guides") this.guides_on = !this.guides_on;
			b.setAttribute("aria-pressed", String(b.dataset.act === "grid" ? this.grid_on : this.guides_on));
			this.sheet.classList.toggle("no-grid", !this.grid_on);
		});
	}

	get layout() {
		return this.store.layout;
	}

	// ------------------------------------------------------------------ scale

	set_scale(s, { fit = false } = {}) {
		this.fit = fit;
		this.scale = Math.min(2, Math.max(0.25, s));
		this.sheet.style.transform = `scale(${this.scale})`;
		this.sheet.style.setProperty("--inv", String(1 / this.scale));
		this.box.style.width = `${PAGE.w * PX_MM * this.scale}px`;
		this.box.style.height = `${PAGE.h * PX_MM * this.scale}px`;
		this.draw_ruler();
		this.draw_overlay();
		this.host.on_zoom?.(this.scale, fit);
	}

	fit_page() {
		const w = this.stage.clientWidth;
		const h = this.stage.clientHeight;
		if (!w || !h) return;
		const phone = window.matchMedia("(max-width: 900px)").matches;
		const by_w = (w - (phone ? 16 : 64)) / (PAGE.w * PX_MM);
		const by_h = (h - 74) / (PAGE.h * PX_MM);
		this.set_scale(phone ? by_w : Math.min(by_w, by_h), { fit: true });
	}

	zoom(step) {
		const steps = [0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2];
		const next = step > 0 ? steps.find((s) => s > this.scale + 0.01) : [...steps].reverse().find((s) => s < this.scale - 0.01);
		if (next) this.set_scale(next);
	}

	draw_ruler() {
		const k = PX_MM * this.scale;
		let html = "";
		for (let mm = 0; mm <= PAGE.w; mm += 5) {
			const cls = mm % 30 === 0 ? "l" : mm % 10 === 0 ? "m" : "s";
			html += `<i class="${cls}" style="left:${(mm * k).toFixed(1)}px"></i>`;
			if (mm % 30 === 0) html += `<span style="left:${(mm * k).toFixed(1)}px">${mm}</span>`;
		}
		html += `<span class="u" style="left:${(PAGE.w * k).toFixed(1)}px">${esc(__("mm"))}</span><b class="rvlb-ruler-sel" hidden></b>`;
		this.ruler.innerHTML = html;
		this.ruler.style.width = `${PAGE.w * k}px`;
		this.ruler_sel = this.ruler.querySelector(".rvlb-ruler-sel");
	}

	// ------------------------------------------------------------------ drawing

	render() {
		const active = document.activeElement;
		const focus_id = active && this.sheet.contains(active) ? active.dataset?.el || (active.classList.contains("rvlb-edge") ? `edge:${active.closest(".rvlb-zone").dataset.band}` : null) : null;
		const L = this.layout;
		const ctx = this.host.render_ctx();
		const opts = { editor: true, selected: this.store.selected, label: element_aria, hint: element_hint, page: [1, 1], comment: false };
		for (const b of BANDS) {
			const z = this.zones[b];
			const band = L[b];
			z.el.style.height = `${band.h}mm`;
			z.el.classList.toggle("is-empty", band.h === 0);
			z.paper.innerHTML = render_band(L, b, ctx, opts);
			const [lo, hi] = b === "header" ? LIMITS.header_h : LIMITS.footer_h;
			z.edge.setAttribute("aria-valuemin", lo);
			z.edge.setAttribute("aria-valuemax", hi);
			z.edge.setAttribute("aria-valuenow", band.h);
			z.edge.setAttribute("aria-valuetext", __("{0} mm", [fmt(band.h)]));
			z.tag.textContent = band.h ? `${band_label(b)} · ${__("{0} mm", [fmt(band.h)])}` : __("No footer: drag up to add one");
			z.slots.innerHTML = ["right", "center", "left"]
				.filter((s) => band.slots[s] > 0)
				.map((s) => {
					const box = slot_box(band, s);
					return `<div class="rvlb-slot" data-slot="${s}" style="left:${pct(box.x)};width:${pct(box.w)};top:${Math.max(0, band.pad_top - 1)}mm;bottom:0"><span dir="${this.host.rtl ? "rtl" : "ltr"}">${esc(slot_label(s))}</span></div>`;
				})
				.join("");
		}
		this.position_body();
		this.draw_overlay();
		if (focus_id) {
			const node = focus_id.startsWith("edge:") ? this.zones[focus_id.slice(5)]?.edge : this.sheet.querySelector(`[data-el="${focus_id}"]`);
			node?.focus({ preventScroll: true });
		}
		this.host.after_render?.();
	}

	position_body(hh = this.layout.header.h, fh = this.layout.footer.h) {
		this.body.style.top = `${PAGE.top + hh + 6}mm`;
		this.body.style.bottom = `${PAGE.bottom + fh + 6}mm`;
	}

	update_selection() {
		const id = this.store.selected;
		for (const n of this.sheet.querySelectorAll(".rvlb-el")) {
			const on = n.dataset.el === id;
			n.classList.toggle("is-selected", on);
			n.setAttribute("aria-pressed", String(on));
		}
		this.draw_overlay();
	}

	node(id) {
		return id ? this.sheet.querySelector(`[data-el="${id}"]`) : null;
	}

	/** A node's box in mm inside its band. */
	measure(node, zone_el) {
		const zr = zone_el.getBoundingClientRect();
		const r = node.getBoundingClientRect();
		const k = zr.width / REF_W || 1;
		return { x: (r.left - zr.left) / k, y: (r.top - zr.top) / k, w: r.width / k, h: r.height / k };
	}

	draw_overlay() {
		for (const b of BANDS) this.zones[b].sel.hidden = true;
		this.badge.hidden = true;
		if (this.ruler_sel) this.ruler_sel.hidden = true;
		const id = this.store.selected;
		const f = id && find(this.layout, id);
		const node = this.node(id);
		if (!f || !node) return;
		const z = this.zones[f.band];
		const r = this.measure(node, z.el);
		this.place_sel(f.band, r, f.el);
	}

	/** The selection frame (and its handles for a free element), the badge and the ruler mark. */
	place_sel(band, r, el) {
		const z = this.zones[band];
		const sel = z.sel;
		sel.hidden = false;
		sel.style.left = `${r.x}mm`;
		sel.style.top = `${r.y}mm`;
		sel.style.width = `${r.w}mm`;
		sel.style.height = `${Math.max(r.h, 0.6)}mm`;
		sel.classList.toggle("is-free", el.slot === null);
		sel.classList.toggle("is-line", el.type === "line");
		const k = PX_MM * this.scale;
		if (this.ruler_sel) {
			this.ruler_sel.hidden = false;
			this.ruler_sel.style.left = `${(PAGE.side + r.x) * k}px`;
			this.ruler_sel.style.width = `${r.w * k}px`;
		}
		// the badge sits above the frame, in screen pixels (it is not scaled)
		const sr = this.stage.getBoundingClientRect();
		const fr = sel.getBoundingClientRect();
		// on a small box the middle handles would cover it: the box itself must stay grabbable
		sel.classList.toggle("is-short", fr.height < 26);
		sel.classList.toggle("is-narrow", fr.width < 26);
		this.badge.hidden = false;
		this.badge.textContent = el.slot === null ? `X ${fmt(r.x)} · Y ${fmt(r.y)} · ${fmt(r.w)}×${fmt(el.h || r.h)} ${__("mm")}` : `${slot_label(el.slot)} · ${band_label(band)}`;
		this.badge.style.left = `${fr.left - sr.left + this.stage.scrollLeft}px`;
		this.badge.style.top = `${fr.top - sr.top + this.stage.scrollTop - 22}px`;
	}

	draw_guides(band, guides) {
		const z = this.zones[band];
		const h = this.layout[band].h;
		z.guides.innerHTML = [...guides.v.map((x) => `<i class="v" style="left:${pct(x)};top:-2mm;height:${h + 4}mm"></i>`), ...guides.h.map((y) => `<i class="h" style="top:${y}mm"></i>`)].join("");
	}

	clear_transient() {
		for (const b of BANDS) {
			const z = this.zones[b];
			z.guides.innerHTML = "";
			z.drop.hidden = true;
			z.drop.className = "rvlb-drop";
			for (const s of z.slots.children) s.classList.remove("is-target");
		}
	}

	/** Shows where a drop would land: a line in a slot, or a box where it becomes free. */
	show_drop(t, size) {
		this.clear_transient();
		if (!t) return;
		const z = this.zones[t.band];
		const band = this.layout[t.band];
		z.drop.hidden = false;
		if (t.kind === "slot") {
			const box = slot_box(band, t.slot);
			z.drop.className = "rvlb-drop is-line";
			Object.assign(z.drop.style, { left: pct(box.x), width: pct(box.w), top: `${t.line_y}mm`, height: "" });
			z.slots.querySelector(`[data-slot=${t.slot}]`)?.classList.add("is-target");
		} else if (t.rect) {
			z.drop.className = "rvlb-drop is-box";
			Object.assign(z.drop.style, { left: pct(t.rect.x), width: pct(t.rect.w), top: `${t.rect.y}mm`, height: `${Math.max(size?.h || 6, 2)}mm` });
		}
	}

	// ------------------------------------------------------------------ hit testing

	/**
	 * What lies under the pointer: a slot of a band (with the insert index and the line of the
	 * indicator) when the pointer is over the slot's stack, else the band itself (free).
	 */
	target_at(ev, exclude = null) {
		for (const b of BANDS) {
			const z = this.zones[b].el;
			const zr = z.getBoundingClientRect();
			const band = this.layout[b];
			const pad = 10;
			if (ev.clientX < zr.left - pad || ev.clientX > zr.right + pad || ev.clientY < zr.top - pad || ev.clientY > zr.bottom + pad) continue;
			const k = zr.width / REF_W;
			const x = (ev.clientX - zr.left) / k;
			const y = (ev.clientY - zr.top) / k;
			const slot = band.h ? slot_at(band, x) : null;
			if (slot) {
				const sd = z.querySelector(`.rvlb-paper [data-slot=${slot}]`);
				const kids = sd ? [...sd.children].filter((n) => n.dataset.el && n.dataset.el !== exclude) : [];
				const top_of = (n) => (n.getBoundingClientRect().top - zr.top) / k;
				const bottom_of = (n) => (n.getBoundingClientRect().bottom - zr.top) / k;
				const bottom = kids.length ? bottom_of(kids.at(-1)) : band.pad_top;
				const stack_end = Math.min(band.h + 2, Math.max(bottom + 6, band.pad_top + 8));
				if (y >= band.pad_top - 3 && y <= stack_end) {
					const mids = kids.map((n) => (top_of(n) + bottom_of(n)) / 2);
					const index = insert_index(mids, y);
					const line_y = index < kids.length ? Math.max(0, top_of(kids[index]) - 0.4) : bottom + 0.2;
					return { band: b, kind: "slot", slot, index, line_y, x, y };
				}
			}
			return { band: b, kind: "free", x: Math.min(REF_W, Math.max(0, x)), y: Math.min(band.h, Math.max(0, y)) };
		}
		return null;
	}

	// ------------------------------------------------------------------ pointer sessions

	/** Pointer moves handled once per frame until release (or Escape, which cancels). */
	session(on_move, on_end) {
		let raf = 0;
		let last = null;
		const move = (ev) => {
			last = ev;
			if (!raf)
				raf = requestAnimationFrame(() => {
					raf = 0;
					on_move(last);
				});
		};
		const finish = (ev, cancelled) => {
			cancelAnimationFrame(raf);
			raf = 0;
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", cancel);
			window.removeEventListener("keydown", esc, true);
			this.stage.classList.remove("is-dragging");
			if (!cancelled && last) on_move(last);
			on_end(ev, cancelled);
		};
		const up = (ev) => finish(ev, false);
		const cancel = (ev) => finish(ev, true);
		const esc = (ev) => {
			if (ev.key !== "Escape") return;
			ev.preventDefault();
			ev.stopPropagation();
			finish(ev, true);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", cancel);
		window.addEventListener("keydown", esc, true);
	}

	on_pointerdown(e) {
		if (e.button !== 0) return;
		const handle = e.target.closest(".rvlb-h");
		if (handle) {
			e.preventDefault();
			return this.begin_resize(e, handle.dataset.h);
		}
		const edge = e.target.closest(".rvlb-edge");
		if (edge) {
			e.preventDefault();
			edge.focus({ preventScroll: true });
			return this.begin_edge(e, edge.closest(".rvlb-zone").dataset.band);
		}
		const node = e.target.closest(".rvlb-el");
		if (node) {
			e.preventDefault();
			const id = node.dataset.el;
			this.store.select(id);
			node.focus({ preventScroll: true });
			const f = find(this.layout, id);
			if (!f) return;
			if (f.el.slot === null) this.begin_move(e, f, node);
			else this.begin_ghost(e, { label: node.getAttribute("aria-label"), exclude: id, size: this.free_size(f.el, node), source: node, drop: (t) => this.drop_existing(id, t) });
			return;
		}
		this.store.select(null);
	}

	free_size(el, node) {
		const d = element_defaults(el.type);
		const w = el.w || d.w || 60;
		let h = el.h || d.h;
		if (!h && node) h = this.measure(node, node.closest(".rvlb-zone")).h;
		return { w: Math.min(REF_W, w), h: h || 6 };
	}

	begin_move(e, f, node) {
		const id = f.el.id;
		const z = this.zones[f.band];
		const zr = z.el.getBoundingClientRect();
		const k = zr.width / REF_W;
		const band = this.layout[f.band];
		const measured = this.measure(node, z.el);
		const start = { x: f.el.x, y: f.el.y, w: f.el.w, h: f.el.h || measured.h };
		const others = [...z.paper.querySelectorAll(".rvlb-el")].filter((n) => n !== node).map((n) => this.measure(n, z.el));
		const targets = guide_targets(band, others);
		const p0 = { x: e.clientX, y: e.clientY };
		const cur = { ...start };
		let moved = false;
		let dock = null;
		this.session(
			(ev) => {
				if (!moved && Math.hypot(ev.clientX - p0.x, ev.clientY - p0.y) < DRAG_PX) return;
				if (!moved) {
					moved = true;
					node.classList.add("is-moving");
					this.stage.classList.add("is-dragging");
				}
				const r = { x: start.x + (ev.clientX - p0.x) / k, y: start.y + (ev.clientY - p0.y) / k, w: start.w, h: start.h };
				const s = ev.altKey ? { x: r.x, y: r.y, guides: { v: [], h: [] } } : snap_move(r, targets, { guides: this.guides_on, grid: this.grid_on ? GRID_MM : 0 });
				cur.x = clamp(s.x, 0, REF_W - start.w);
				cur.y = clamp(s.y, 0, Math.max(0, band.h - LIMITS.min_h));
				node.style.left = pct(cur.x);
				node.style.top = `${cur.y}mm`;
				dock = f.el.type !== "band" && !ev.altKey ? this.target_at(ev, id) : null;
				if (dock?.kind !== "slot") dock = null;
				this.show_drop(dock);
				this.draw_guides(f.band, s.guides);
				this.place_sel(f.band, { ...cur, h: measured.h }, f.el);
			},
			(ev, cancelled) => {
				node.classList.remove("is-moving");
				this.clear_transient();
				if (!moved) return;
				if (cancelled) return this.render();
				if (dock) this.store.commit((l) => move_to_slot(l, id, dock.band, dock.slot, dock.index), { select: id });
				else
					this.store.commit((l) => {
						const g = find(l, id).el;
						g.x = cur.x;
						g.y = cur.y;
					});
			},
		);
	}

	/**
	 * Dragging something that has no free position yet: a slotted element or a new one from
	 * the library. A ghost follows the pointer; the drop lands in a slot or frees it in a band.
	 * @returns {void}
	 */
	begin_ghost(e, { label, exclude = null, size, source = null, drop, on_start = null }) {
		const p0 = { x: e.clientX, y: e.clientY };
		let ghost = null;
		let target = null;
		this.session(
			(ev) => {
				if (!ghost && Math.hypot(ev.clientX - p0.x, ev.clientY - p0.y) < DRAG_PX) return;
				if (!ghost) {
					ghost = document.createElement("div");
					ghost.className = "rv rvlb-ghost";
					ghost.dir = this.host.rtl ? "rtl" : "ltr";
					ghost.innerHTML = `${icons.grip()}<span></span>`;
					ghost.querySelector("span").textContent = label;
					document.body.append(ghost);
					this.stage.classList.add("is-dragging");
					source?.classList.add("is-dragged");
					on_start?.();
				}
				ghost.style.left = `${ev.clientX + 12}px`;
				ghost.style.top = `${ev.clientY + 10}px`;
				target = this.target_at(ev, exclude);
				if (target?.kind === "free") {
					const band = this.layout[target.band];
					const w = size.w;
					const x = clamp(this.grid_on ? snap_grid(target.x - w / 2) : target.x - w / 2, 0, REF_W - w);
					const y = clamp(this.grid_on ? snap_grid(target.y - size.h / 2) : target.y - size.h / 2, 0, Math.max(0, band.h - LIMITS.min_h));
					target.rect = { x, y, w, h: size.h };
					if (!band.h) target = null;
				}
				this.show_drop(target, size);
			},
			(ev, cancelled) => {
				ghost?.remove();
				source?.classList.remove("is-dragged");
				this.clear_transient();
				if (ghost && !cancelled && target) drop(target);
			},
		);
	}

	drop_existing(id, t) {
		if (t.kind === "slot") this.store.commit((l) => move_to_slot(l, id, t.band, t.slot, t.index), { select: id });
		else {
			const f = find(this.layout, id);
			const h = BOXED.has(f.el.type) ? f.el.h : 0;
			this.store.commit((l) => make_free(l, id, t.band, { x: t.rect.x, y: t.rect.y, w: t.rect.w, h }), { select: id });
		}
	}

	/** A drag from the library: the host creates the element where it is dropped. */
	begin_new(e, spec, on_start) {
		const d = element_defaults(spec.type);
		const size = { w: spec.patch?.w || d.w || 60, h: spec.patch?.h || d.h || 6 };
		this.begin_ghost(e, { label: spec.label, size, drop: (t) => this.host.add_at(spec, t), on_start });
	}

	begin_resize(e, handle) {
		const id = this.store.selected;
		const f = id && find(this.layout, id);
		const node = this.node(id);
		if (!f || !node || f.el.slot !== null) return;
		const z = this.zones[f.band];
		const zr = z.el.getBoundingClientRect();
		const k = zr.width / REF_W;
		const measured = this.measure(node, z.el);
		const start = { x: f.el.x, y: f.el.y, w: f.el.w, h: f.el.h || measured.h };
		const p0 = { x: e.clientX, y: e.clientY };
		const vertical = handle.includes("n") || handle.includes("s");
		let cur = { ...start };
		let moved = false;
		this.stage.classList.add("is-dragging");
		this.session(
			(ev) => {
				moved = true;
				cur = resize_rect(start, handle, (ev.clientX - p0.x) / k, (ev.clientY - p0.y) / k, { band_h: this.layout[f.band].h, grid: this.grid_on && !ev.altKey ? GRID_MM : 0 });
				node.style.left = pct(cur.x);
				node.style.width = pct(cur.w);
				node.style.top = `${cur.y}mm`;
				if (vertical || f.el.h) node.style.height = `${cur.h}mm`;
				this.place_sel(f.band, cur, { ...f.el, h: cur.h });
			},
			(ev, cancelled) => {
				if (!moved) return;
				if (cancelled) return this.render();
				this.store.commit((l) => {
					const g = find(l, id).el;
					Object.assign(g, { x: cur.x, y: cur.y, w: cur.w });
					if (g.type !== "line" && (vertical || g.h)) g.h = cur.h;
				});
			},
		);
	}

	begin_edge(e, b) {
		const z = this.zones[b];
		const zr = z.el.getBoundingClientRect();
		const k = zr.width / REF_W;
		const start = this.layout[b].h;
		const [lo, hi] = b === "header" ? LIMITS.header_h : LIMITS.footer_h;
		const p0 = e.clientY;
		let h = start;
		this.stage.classList.add("is-dragging");
		this.session(
			(ev) => {
				const dy = (ev.clientY - p0) / k;
				h = Math.min(hi, Math.max(lo, snap_grid(b === "header" ? start + dy : start - dy)));
				z.el.style.height = `${h}mm`;
				const root = z.paper.querySelector(".rvlh");
				if (root) root.style.height = `${h}mm`;
				z.tag.textContent = `${band_label(b)} · ${__("{0} mm", [fmt(h)])}`;
				if (b === "header") this.position_body(h);
				else this.position_body(undefined, h);
			},
			(ev, cancelled) => {
				if (cancelled || h === start) return this.render();
				this.store.commit((l) => set_band_height(l, b, h));
			},
		);
	}

	// ------------------------------------------------------------------ keyboard

	on_keydown(e) {
		const edge = e.target.closest(".rvlb-edge");
		if (edge) {
			const b = edge.closest(".rvlb-zone").dataset.band;
			const step = (e.shiftKey ? NUDGE_BIG_MM : NUDGE_MM) * (b === "header" ? 1 : -1);
			const d = { ArrowDown: step, ArrowUp: -step, PageDown: step * 5, PageUp: -step * 5 }[e.key];
			if (d === undefined) return;
			e.preventDefault();
			this.store.commit((l) => set_band_height(l, b, l[b].h + d), { merge: `edge:${b}` });
			return;
		}
		const node = e.target.closest(".rvlb-el");
		if (!node) return;
		const id = node.dataset.el;
		const f = find(this.layout, id);
		if (!f) return;
		const mod = e.ctrlKey || e.metaKey;
		const step = e.shiftKey ? NUDGE_BIG_MM : NUDGE_MM;
		const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
		if (arrows[e.key] && !mod) {
			e.preventDefault();
			this.store.select(id);
			const [dx, dy] = arrows[e.key];
			if (f.el.slot === null) {
				this.store.commit((l) => {
					const g = find(l, id).el;
					g.x += dx * step;
					g.y += dy * step;
				}, { merge: `nudge:${id}` });
			} else if (dy) {
				this.store.commit((l) => reorder(l, id, dy));
			} else {
				const next = neighbour_slot(this.layout[f.band], f.el.slot, dx);
				if (next) this.store.commit((l) => move_to_slot(l, id, f.band, next));
			}
			this.announce_place(id);
			return;
		}
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			this.store.select(id);
			return;
		}
		if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			this.remove(id);
			return;
		}
		if (mod && (e.key === "d" || e.key === "D")) {
			e.preventDefault();
			this.duplicate(id);
			return;
		}
		if (e.key === "Escape") {
			e.preventDefault();
			this.store.select(null);
		}
	}

	announce_place(id) {
		const f = find(this.layout, id);
		const node = this.node(id);
		if (!f) return;
		const text = element_aria(f.el);
		if (node) node.setAttribute("aria-label", text);
		// the new place is said, not only kept in the label of the focused element
		if (this.live) this.live.textContent = text;
	}

	remove(id) {
		const f = find(this.layout, id);
		if (!f) return;
		const mates = this.layout[f.band].elements;
		const next = mates[f.index + 1] || mates[f.index - 1];
		this.store.commit((l) => remove(l, id), { select: next ? next.id : null });
		const n = this.node(next?.id);
		if (n) n.focus({ preventScroll: true });
		else this.zones[f.band].edge.focus({ preventScroll: true });
	}

	duplicate(id) {
		const c = this.store.commit((l) => duplicate(l, id), { select: (c) => c?.id ?? id });
		this.node(c?.id)?.focus({ preventScroll: true });
	}

	focus_selected() {
		this.node(this.store.selected)?.focus({ preventScroll: false });
	}
}
