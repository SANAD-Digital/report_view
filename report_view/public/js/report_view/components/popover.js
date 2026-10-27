// Popovers of the page (docs/architecture.md §11.1 #79): one at a time, placed under their
// anchor with the inline-start edges aligned (the right edges in RTL), kept inside the page
// frame and the window: flipped above the anchor when there is no room below, moved up over
// it when there is no room either way. Escape and a press outside close it; whenever a
// popover closes while the focus was inside it, the focus goes back to its anchor.

let current = null;

// Frappe's own overlays a popover or a menu may open (the list of a Link field, a dialog,
// a menu, the date picker, the colour picker): a press inside them is not "outside".
const FRAPPE_OVERLAYS = ".awesomplete, .modal, .dropdown-menu, .datepicker, .pcr-app";
// The room kept between a popover and the edges it is kept inside (px).
export const POP_MARGIN = 8;

/**
 * Where a box of width `w` goes next to its anchor (window coordinates): its inline-start
 * edge on the anchor's (the end edges with align "end"; mirrored in RTL), kept `margin`
 * inside [min_x, max_x]; under the anchor, or above it when the room under it is less than
 * `flip_under` and the room above is larger. `room` is the height left on that side.
 * @param {DOMRect|{left:number,right:number,top:number,bottom:number}} a the anchor's box
 * @returns {{left: number, top: number, bottom: number, up: boolean, room: number}}
 */
export function place_near(a, { w, gap = 4, margin = POP_MARGIN, align = "start", rtl = false, min_x = 0, max_x = window.innerWidth, flip_under = 0 }) {
	const start = rtl === (align === "start") ? a.right - w : a.left;
	const left = Math.max(min_x + margin, Math.min(start, max_x - margin - w));
	const below = window.innerHeight - a.bottom - margin;
	const above = a.top - margin;
	const up = below < flip_under && above > below;
	return { left, top: a.bottom + gap, bottom: window.innerHeight - a.top + gap, up, room: (up ? above : below) - gap };
}

/**
 * A press of the document outside what `inside(target)` claims (and outside Frappe's
 * overlays) calls `on_outside`; listened to only while `set(true)`.
 * @returns {{set: (on: boolean) => void, readonly on: boolean}}
 */
export function outside_press(inside, on_outside) {
	let on = false;
	const handler = (e) => {
		const t = e.target;
		if (inside(t) || t?.closest?.(FRAPPE_OVERLAYS)) return;
		on_outside(e);
	};
	return {
		set(value) {
			if (value === on) return;
			on = value;
			if (on) document.addEventListener("pointerdown", handler, true);
			else document.removeEventListener("pointerdown", handler, true);
		},
		get on() {
			return on;
		},
	};
}

/** Closes the open popover, if any. */
export function close_popover() {
	if (current) current.close();
}

/**
 * @param {object} o
 * @param {HTMLElement} o.root the .rv element (positioned); the popover is placed in it
 * @param {HTMLElement} o.anchor what the popover belongs to
 * @param {HTMLElement} o.content its content
 * @param {string} [o.cls] classes added to .rv-pop
 * @param {number} [o.width] design width in px (capped by the page width)
 * @param {"start"|"end"} [o.align] which edges of the anchor and the popover line up
 * @param {() => void} [o.on_close]
 * @param {string} [o.label] accessible name
 * @param {string} [o.role] "dialog" (default) or "menu"
 * @param {{x: number, y: number}} [o.at] a point instead of the anchor box
 * @returns {{el: HTMLElement, close: () => void, place: () => void, anchor: HTMLElement}}
 */
export function open_popover({ root, anchor, content, cls = "", width = null, align = "start", on_close, label = "", role = "dialog", at = null }) {
	close_popover();
	const el = document.createElement("div");
	el.className = `rv-pop ${cls}`.trim();
	el.setAttribute("role", role);
	if (label) el.setAttribute("aria-label", label);
	el.appendChild(content);
	root.appendChild(el);
	anchor?.setAttribute("aria-expanded", "true");

	const rtl = root.getAttribute("dir") === "rtl";
	const place = () => {
		const rr = root.getBoundingClientRect();
		if (width) el.style.width = `${Math.min(width, rr.width - 2 * POP_MARGIN)}px`;
		const a = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : anchor.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const p = place_near(a, { w, align, rtl, min_x: rr.left, max_x: rr.right });
		// under the anchor; above it when its height does not fit under, else over it
		let top = p.top;
		if (top + h > window.innerHeight - POP_MARGIN) {
			if (a.top - h - 4 > POP_MARGIN) top = a.top - h - 4;
			else top = Math.max(POP_MARGIN, window.innerHeight - POP_MARGIN - h);
		}
		const left = p.left;
		el.style.left = `${Math.round(left - rr.left)}px`;
		el.style.top = `${Math.round(top - rr.top)}px`;
	};
	place();

	// A Frappe dropdown (awesomplete of a Link control) opened from inside the popover is not outside.
	const outside = outside_press((t) => el.contains(t) || Boolean(anchor?.contains(t)), () => handle.close());
	// On the document: content that re-renders may drop the focus to the body. A Frappe
	// dropdown open inside the popover (awesomplete of a Link control, the date picker of a
	// Date control) takes the first Escape itself.
	const on_key = (e) => {
		if (e.key !== "Escape") return;
		const t = e.target;
		if (t?.closest?.(".awesomplete")?.querySelector("ul:not([hidden])") || document.querySelector(".datepicker.active")) return;
		e.stopPropagation();
		handle.close();
	};
	const on_resize = () => handle.close();
	outside.set(true);
	document.addEventListener("keydown", on_key, true);
	window.addEventListener("resize", on_resize);

	const handle = {
		el,
		anchor,
		place,
		closed: false,
		close() {
			if (handle.closed) return;
			handle.closed = true;
			outside.set(false);
			document.removeEventListener("keydown", on_key, true);
			window.removeEventListener("resize", on_resize);
			anchor?.setAttribute("aria-expanded", "false");
			const active = document.activeElement;
			const inside = el.contains(active) || !active || active === document.body;
			el.remove();
			if (inside && anchor?.isConnected) anchor.focus?.({ preventScroll: true });
			if (current === handle) current = null;
			if (on_close) on_close();
		},
	};
	current = handle;
	return handle;
}

/**
 * A menu of the design (.rv-mi items, .rv-msep separators, .rv-pop-hd title).
 * @param {Array} items [{label, icon, check, hint, disabled, title, act} | {sep: true}]
 * @param {string} [title]
 * @returns {HTMLElement}
 */
export function menu_content(items, title = "") {
	const box = document.createElement("div");
	if (title) {
		const hd = document.createElement("div");
		hd.className = "rv-pop-hd";
		hd.textContent = title;
		box.appendChild(hd);
	}
	for (const it of items) {
		if (it.sep) {
			const sep = document.createElement("div");
			sep.className = "rv-msep";
			box.appendChild(sep);
			continue;
		}
		const b = document.createElement("button");
		b.type = "button";
		b.className = "rv-mi";
		b.setAttribute("role", "menuitem");
		if (it.disabled) b.disabled = true;
		if (it.title) b.title = it.title;
		if (it.key) b.dataset.item = it.key;
		const ic = document.createElement("span");
		ic.className = "rv-mi-ic";
		ic.innerHTML = it.check ? `<span class="rv-mi-check">${it.check}</span>` : it.icon || "";
		const lbl = document.createElement("span");
		lbl.className = "rv-mi-lbl";
		lbl.textContent = it.label;
		const hint = document.createElement("span");
		hint.className = "rv-mi-hint";
		hint.textContent = it.hint || "";
		b.append(ic, lbl, hint);
		if (!it.disabled) b.addEventListener("click", () => it.act());
		box.appendChild(b);
	}
	// Arrow keys move between the items, as in a menu.
	box.addEventListener("keydown", (e) => {
		if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
		const list = [...box.querySelectorAll(".rv-mi:not(:disabled)")];
		if (!list.length) return;
		e.preventDefault();
		const i = list.indexOf(document.activeElement);
		const next = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
		list[next].focus();
	});
	return box;
}
