// Overlay states of the grid (docs/architecture.md §11.1 #58-60, ADR-009), basic phase-3 form.

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

function button(label, cls = "") {
	const b = document.createElement("button");
	b.type = "button";
	b.className = `rv-btn ${cls}`.trim();
	b.textContent = label;
	return b;
}

export class StateOverlay {
	constructor(parent) {
		this.el = document.createElement("div");
		this.el.className = "rv-stateov";
		this.el.hidden = true;
		this.el.setAttribute("role", "status");
		parent.appendChild(this.el);
	}

	hide() {
		this.el.hidden = true;
		this.el.replaceChildren();
		this.kind = null;
	}

	/**
	 * @param {object} s {kind, icon, tone, title, text, code, actions: [{label, primary, href, action}]}
	 */
	show(s) {
		this.kind = s.kind;
		const box = document.createElement("div");
		box.className = "rv-state";
		box.dataset.state = s.kind;
		box.innerHTML = `
			<div class="rv-state-ico ${s.tone || ""}">${esc(s.icon || "i")}</div>
			<h3>${esc(s.title)}</h3>
			${s.text ? `<p>${esc(s.text)}</p>` : ""}
			${s.code ? `<code>${esc(s.code)}</code>` : ""}
			${s.skeleton ? `<span class="rv-skel"></span><span class="rv-skel"></span>` : ""}`;
		if (s.actions?.length) {
			const bar = document.createElement("div");
			bar.className = "rv-state-actions";
			for (const a of s.actions) {
				let el;
				if (a.href) {
					el = document.createElement("a");
					el.className = `rv-btn ${a.primary ? "primary" : ""}`.trim();
					el.href = a.href;
					el.textContent = a.label;
				} else {
					el = button(a.label, a.primary ? "primary" : "");
					el.addEventListener("click", a.action);
				}
				bar.appendChild(el);
			}
			box.appendChild(bar);
		}
		this.el.replaceChildren(box);
		this.el.hidden = false;
	}

	/** @param {string} [text] what is being waited for (the first load of the engine) */
	loading(text = "") {
		this.show({ kind: "loading", icon: "…", title: __("Loading report…"), text, skeleton: true });
	}
}
