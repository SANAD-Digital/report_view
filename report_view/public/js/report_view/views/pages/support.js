// Small helpers of the Pages view (views/pages_view.js): a bounded cache, the turn of the
// browser between long work, images waited for, scripts taken out of server HTML, the page
// numbers of a letter head's footer, the body of a PDF request, what the CSS of a PDF depends on.

import { esc, fmt_int } from "../../util.js";
import { IMAGE_WAIT_MS } from "./settings.js";

/** Whether the user may write or create Letter Heads (Frappe's permissions; false where they are not known). */
export function can_write_letter_head() {
	return Boolean(frappe.model?.can_write?.("Letter Head") || frappe.model?.can_create?.("Letter Head"));
}

export function format_msg(text, args) {
	return String(text).replace(/\{(\d+)\}/g, (m, i) => (args && args[i] !== undefined ? args[i] : m));
}

export function strip_scripts(html) {
	if (!html) return "";
	const tpl = document.createElement("template");
	tpl.innerHTML = html;
	for (const s of tpl.content.querySelectorAll("script")) s.remove();
	return tpl.innerHTML;
}

/**
 * The body of a PDF request (ADR-016): the pages gzipped as a file (``html_gz``), about a
 * tenth of their size; as a plain field where the browser cannot compress.
 */
export async function pdf_body(args, html) {
	const form = new FormData();
	for (const [k, v] of Object.entries(args)) if (v != null) form.append(k, v);
	if (typeof CompressionStream === "undefined") {
		form.append("html", html);
		return form;
	}
	const gz = await new Response(new Blob([html]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
	form.append("html_gz", gz, "pages.html.gz");
	return form;
}

// The room a page's foot takes: its box and the top margin of its first part (a signature's
// space above it), which falls outside the box.
export function foot_height(foot) {
	if (!foot) return 0;
	const first = foot.firstElementChild;
	return foot.getBoundingClientRect().height + (first ? Math.max(0, parseFloat(getComputedStyle(first).marginTop) || 0) : 0);
}

// A letter head's footer numbers its pages the way Frappe's PDF does: empty `.page` and
// `.topage` spans (the letter head builder writes them, ADR-018), filled for each page.
export function page_spans(html, n, total) {
	if (!html.includes('class="page"') && !html.includes('class="topage"')) return html;
	const num = (v) => esc(fmt_int(v));
	return html.replace(/<span class="page"><\/span>/g, `<span class="page">${num(n)}</span>`).replace(/<span class="topage"><\/span>/g, `<span class="topage">${num(total)}</span>`);
}

// A turn of the browser between two pieces of long work: the window stays responsive, a
// newer change of the settings can take over.
export const breathe = () => new Promise((r) => setTimeout(r, 0));

export function wait_images(el, timeout = IMAGE_WAIT_MS) {
	const imgs = [...el.querySelectorAll("img")].filter((img) => !img.complete);
	if (!imgs.length) return Promise.resolve();
	return Promise.all(
		imgs.map(
			(img) =>
				new Promise((resolve) => {
					const done = () => resolve();
					img.addEventListener("load", done, { once: true });
					img.addEventListener("error", done, { once: true });
					setTimeout(done, timeout);
				})
		)
	);
}

/** A Map that keeps its `max` most recently used entries. */
export class Lru extends Map {
	constructor(max) {
		super();
		this.max = max;
	}

	get(key) {
		if (!super.has(key)) return undefined;
		const value = super.get(key);
		super.delete(key);
		super.set(key, value);
		return value;
	}

	/** The value without making it the most recent. */
	peek(key) {
		return super.get(key);
	}

	set(key, value) {
		super.delete(key);
		super.set(key, value);
		while (this.size > this.max) super.delete(this.keys().next().value);
		return this;
	}
}

// The style rules kept for a PDF of a site stylesheet (by its address): Desk's sheets do not
// change while the page is open, so the rules the pages use are tested once per kind of pages.
export const CSS_KEPT = new Map();

/**
 * What decides which rules match a sample of the printed sheets: the element names, classes
 * and attribute names found in it, a few attribute values the styles test, and the
 * attributes of <html>, <body> and the print root.
 */
export function sample_signature(nodes, root) {
	const VALUES = new Set(["dir", "lang", "type", "role", "rowspan", "colspan"]);
	const tokens = new Set();
	for (const top of nodes) {
		for (const el of [top, ...top.querySelectorAll("*")]) {
			tokens.add(el.localName);
			for (const c of el.classList) tokens.add(`.${c}`);
			for (const a of el.attributes) if (a.name !== "class" && a.name !== "style") tokens.add(VALUES.has(a.name) ? `[${a.name}=${a.value}]` : `[${a.name}]`);
		}
	}
	const attrs = (el) => [...el.attributes].map((a) => `${a.name}=${a.value}`).join(" ");
	return `${attrs(document.documentElement)}|${attrs(document.body)}|${root.className}|${[...tokens].sort().join(" ")}`;
}

// where the rules of a print format's <style> hold: the sheets, and the probe that measures them
export const FORMAT_SCOPE = ":is(.rv-print-sheets, .rv-print-probe)";

/**
 * A selector of a print format held inside the sheets: `html`, `:root` and `body` stand for
 * the sheets themselves, every other selector is looked for inside them.
 */
export function scope_selector(selector, scope = FORMAT_SCOPE) {
	const s = selector.trim();
	if (!s) return s;
	const own = s.match(/^(?:html|:root)?\s*(?:body)?(?=$|[\s.#[:>+~])/i);
	if (own && own[0].trim()) {
		const rest = s.slice(own[0].length);
		return `${scope}${rest}`;
	}
	return `${scope} ${s}`;
}

// what a format's rule on `html` or `body` keeps: its lettering, which the sheets pass down;
// its sizes, margins, paddings, shadows and display describe a page of its own (the new print
// format builder sizes `body` to the paper and lays it out as a column), not ours
const PAGE_ROOT = /^\s*(?:html|:root|body|html\s+body|:root\s+body)\s*$/i;
const LETTERING = new Set(["font", "font-family", "font-size", "font-weight", "font-style", "line-height", "color", "letter-spacing", "word-spacing", "direction", "-webkit-print-color-adjust", "print-color-adjust"]);

function lettering(style) {
	let out = "";
	for (let i = 0; i < style.length; i++) {
		const name = style[i];
		if (LETTERING.has(name)) out += `${name}:${style.getPropertyValue(name)}${style.getPropertyPriority(name) ? " !important" : ""};`;
	}
	return out;
}

function scope_rules(rules, scope) {
	let out = "";
	for (const rule of rules) {
		if (rule.selectorText !== undefined && rule.style) {
			// a style rule: each of its selectors held to the scope (nested rules as written);
			// the page's own root (html, body) keeps only its lettering
			const parts = rule.selectorText.split(",");
			const roots = parts.filter((x) => PAGE_ROOT.test(x));
			const rest = parts.filter((x) => !PAGE_ROOT.test(x));
			if (roots.length) {
				const kept = lettering(rule.style);
				if (kept) out += `${scope}{${kept}}\n`;
			}
			if (!rest.length) continue;
			const sel = rest.map((x) => scope_selector(x, scope)).join(", ");
			out += `${sel}{${rule.style.cssText}${rule.cssRules?.length ? scope_rules(rule.cssRules, "&") : ""}}\n`;
		} else if (rule.cssRules && rule.conditionText !== undefined) {
			// @media, @supports, @container: their rules held the same way
			const kind = rule.constructor?.name === "CSSSupportsRule" ? "supports" : rule.constructor?.name === "CSSContainerRule" ? "container" : "media";
			out += `@${kind} ${rule.conditionText}{${scope_rules(rule.cssRules, scope)}}\n`;
		} else if (rule.cssRules && rule.name !== undefined && rule.constructor?.name === "CSSLayerBlockRule") {
			out += `@layer ${rule.name}{${scope_rules(rule.cssRules, scope)}}\n`;
		} else {
			// @font-face, @page, @keyframes, @import, @layer statements: as written
			out += `${rule.cssText}\n`;
		}
	}
	return out;
}

/**
 * The <style> blocks of a print format held to the sheets (the owner's print page, 2026-11-10:
 * «Sales Invoice Classic» sets `body { display: flex; flex-direction: column }`, which turned
 * Desk itself upside down). Read by the browser's own CSS parser; a block it cannot read is
 * dropped rather than let loose on the page.
 */
export function scope_format_css(html, scope = FORMAT_SCOPE) {
	if (!html || typeof CSSStyleSheet !== "function") return html || "";
	const box = document.createElement("div");
	box.innerHTML = html;
	for (const style of box.querySelectorAll("style")) {
		try {
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(style.textContent || "");
			style.textContent = scope_rules(sheet.cssRules, scope);
		} catch {
			style.remove();
		}
	}
	return box.innerHTML;
}
