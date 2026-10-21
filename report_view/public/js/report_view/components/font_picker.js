// The font picker of the letter head builder and of the Pages (the font library,
// report_view/fonts.json): a button that shows the chosen font in itself, and under it a list
// that opens in place — a search box, then the families grouped by script and category, each
// drawn in its own font. The list is built hidden, so no font file loads before it opens.
// Stateless HTML (`font_picker_html`) and one delegated binding per container
// (`bind_font_picker`), so the hosts can re-render their panels freely.

import { font_groups, font_stack, font_info } from "../fonts.js";
import { esc } from "../util.js";

const SAMPLE_AR = "أبجد هوز ١٢٣";
const SAMPLE_LATIN = "Aa Bb 123";

function category_label(c) {
	return { sans: __("Sans serif"), naskh: __("Naskh"), kufi: __("Kufi"), serif: __("Serif"), display: __("Display"), mono: __("Monospace") }[c] || c;
}

function sample(family) {
	return font_info(family)?.scripts?.includes("arabic") ? SAMPLE_AR : SAMPLE_LATIN;
}

/**
 * @param {object} o
 * @param {string} o.value the chosen family
 * @param {string} o.key what the host changes (data-font-key on the root)
 * @param {string} [o.label] accessible name of the list
 * @param {string} [o.empty] the label of a first choice "" (the host's own font), if any
 */
export function font_picker_html({ value, key, label = __("Font"), empty = "" }) {
	const none = empty
		? `<button type="button" role="option" class="rv-fontpick-opt is-none" data-font="" aria-selected="${!value}" tabindex="-1"><span class="n">${esc(empty)}</span></button>`
		: "";
	const shown = !value && empty ? { name: empty, style: "", sample: "" } : { name: value, style: ` style="font-family:${esc(font_stack(value))}"`, sample: sample(value) };
	const groups = font_groups()
		.map(
			(g, i) => `<div class="rv-fontpick-g" role="group" aria-labelledby="rv-fpg-${key}-${i}"><div class="rv-fontpick-gh" id="rv-fpg-${key}-${i}">${esc(g.script === "arabic" ? __("Arabic") : __("Latin"))} · ${esc(category_label(g.category))}</div>${g.fonts
				.map(
					(f) =>
						`<button type="button" role="option" class="rv-fontpick-opt" data-font="${esc(f.family)}" aria-selected="${f.family === value}" tabindex="-1" style="font-family:${esc(font_stack(f.family))}"><span class="n" dir="ltr">${esc(f.family)}</span><span class="s" dir="auto">${esc(sample(f.family))}</span></button>`,
				)
				.join("")}</div>`,
		)
		.join("");
	return `<div class="rv-fontpick" data-font-key="${esc(key)}">
		<button type="button" class="rv-fontpick-btn" aria-haspopup="listbox" aria-expanded="false"${shown.style}><span class="n" dir="auto">${esc(shown.name)}</span><span class="s" dir="auto">${esc(shown.sample)}</span><span class="cv" aria-hidden="true"></span></button>
		<div class="rv-fontpick-pop" hidden>
			<input type="search" class="rv-input sm rv-fontpick-q" placeholder="${esc(__("Search fonts"))}" aria-label="${esc(__("Search fonts"))}" autocomplete="off" spellcheck="false">
			<div class="rv-fontpick-list" role="listbox" aria-label="${esc(label)}">${none}${groups}<p class="rv-fontpick-none" hidden>${esc(__("No font matches"))}</p></div>
		</div>
	</div>`;
}

function toggle(root, open) {
	const btn = root.querySelector(".rv-fontpick-btn");
	const pop = root.querySelector(".rv-fontpick-pop");
	pop.hidden = !open;
	btn.setAttribute("aria-expanded", String(open));
	if (open) {
		const q = pop.querySelector(".rv-fontpick-q");
		q.focus({ preventScroll: true });
		pop.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
	}
}

function filter(root, query) {
	const q = query.trim().toLowerCase();
	let any = false;
	for (const g of root.querySelectorAll(".rv-fontpick-g")) {
		let shown = 0;
		for (const o of g.querySelectorAll(".rv-fontpick-opt")) {
			const hit = !q || o.dataset.font.toLowerCase().includes(q);
			o.hidden = !hit;
			shown += hit;
		}
		g.hidden = !shown;
		any ||= shown > 0;
	}
	const none = root.querySelector(".rv-fontpick-opt.is-none");
	if (none) none.hidden = Boolean(q);
	root.querySelector(".rv-fontpick-none").hidden = any;
}

const visible = (root) => [...root.querySelectorAll(".rv-fontpick-opt")].filter((o) => !o.hidden && !o.closest("[hidden]"));

/**
 * Wires every picker inside `container` (once per container).
 * @param {HTMLElement} container
 * @param {(key: string, family: string) => void} on_pick
 */
export function bind_font_picker(container, on_pick) {
	if (container.rv_font_picker) return;
	container.rv_font_picker = true;
	container.addEventListener("click", (e) => {
		const root = e.target.closest(".rv-fontpick");
		if (!root) return;
		if (e.target.closest(".rv-fontpick-btn")) return toggle(root, root.querySelector(".rv-fontpick-pop").hidden);
		const opt = e.target.closest(".rv-fontpick-opt");
		if (!opt) return;
		toggle(root, false);
		root.querySelector(".rv-fontpick-btn").focus({ preventScroll: true });
		on_pick(root.dataset.fontKey, opt.dataset.font);
	});
	container.addEventListener("input", (e) => {
		if (!e.target.matches(".rv-fontpick-q")) return;
		e.stopPropagation();
		filter(e.target.closest(".rv-fontpick"), e.target.value);
	});
	container.addEventListener("keydown", (e) => {
		const root = e.target.closest(".rv-fontpick");
		if (!root) return;
		if (e.key === "Escape" && !root.querySelector(".rv-fontpick-pop").hidden) {
			e.preventDefault();
			e.stopPropagation();
			toggle(root, false);
			root.querySelector(".rv-fontpick-btn").focus({ preventScroll: true });
			return;
		}
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || root.querySelector(".rv-fontpick-pop").hidden) return;
		const list = visible(root);
		if (!list.length) return;
		e.preventDefault();
		const at = list.indexOf(document.activeElement);
		const next = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? Math.min(list.length - 1, at + 1) : at <= 0 ? -1 : at - 1;
		if (next < 0) root.querySelector(".rv-fontpick-q").focus();
		else list[next].focus();
	});
	// a press outside closes an open list
	document.addEventListener("pointerdown", (e) => {
		for (const root of container.querySelectorAll(".rv-fontpick")) if (!root.contains(e.target) && !root.querySelector(".rv-fontpick-pop").hidden) toggle(root, false);
	});
}
