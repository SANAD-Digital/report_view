// Popovers of the page (docs/architecture.md §11.1 #79): one at a time, placed under their
// anchor with the inline-start edges aligned (the right edges in RTL), kept inside the page
// frame, flipped above the anchor when there is no room below. Escape and a press outside
// close it; the focus goes back to the anchor when it was inside the popover.

let current = null;

/** Closes the open popover, if any. */
export function close_popover() {
	if (current) current.close();
}

/** The popover that is open now (or null). */
export function open_popover_handle() {
	return current;
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
		if (width) el.style.width = `${Math.min(width, rr.width - 16)}px`;
		const a = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : anchor.getBoundingClientRect();
		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const start_edge = rtl === (align === "start") ? a.right - w : a.left;
		const left = Math.max(rr.left + 8, Math.min(start_edge, rr.right - 8 - w));
		let top = a.bottom + 4;
		if (top + h > window.innerHeight - 8 && a.top - h - 4 > 8) top = a.top - h - 4;
		el.style.left = `${Math.round(left - rr.left)}px`;
		el.style.top = `${Math.round(top - rr.top)}px`;
	};
	place();

	const on_press = (e) => {
		if (el.contains(e.target) || anchor?.contains(e.target)) return;
		// A Frappe dropdown (awesomplete of a Link control) opened from inside the popover.
		if (e.target.closest?.(".awesomplete, .dropdown-menu, .datepicker")) return;
		handle.close();
	};
	// On the document: content that re-renders may drop the focus to the body.
	const on_key = (e) => {
		if (e.key !== "Escape") return;
		const active = document.activeElement;
		const inside = el.contains(active) || !active || active === document.body;
		if (!inside && !anchor?.contains(active)) return;
		e.stopPropagation();
		handle.close();
		if (inside) anchor?.focus?.();
	};
	const on_resize = () => handle.close();
	document.addEventListener("pointerdown", on_press, true);
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
			document.removeEventListener("pointerdown", on_press, true);
			document.removeEventListener("keydown", on_key, true);
			window.removeEventListener("resize", on_resize);
			anchor?.setAttribute("aria-expanded", "false");
			el.remove();
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
