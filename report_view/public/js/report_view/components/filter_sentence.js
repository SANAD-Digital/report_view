// The report's filters written as one sentence (layout C, ADR-025; design: Sheet.dc.html of the
// approved canvas): «for [SND Accounting] from [28-09-2026] to [28-10-2026], [Account: 7
// selected] + condition». Every value is a dashed, underlined button that opens its filter's
// editor (filters/filter_summary.js); «+ condition» opens «More options». The buttons are
// kept and updated in place, so an open editor keeps its anchor.

import { filter_items, has_more, open_filter_editor } from "../filters/filter_summary.js";
import { esc } from "../util.js";

export class FilterSentence {
	/**
	 * @param {object} o
	 * @param {HTMLElement} o.root the .rv element (popovers)
	 * @param {HTMLElement} o.parent
	 */
	constructor({ root, parent }) {
		this.root = root;
		this.criteria = null;
		const el = document.createElement("p");
		el.className = "rv-sentence";
		parent.append(el);
		this.el = el;
		this.signature = "";
		el.addEventListener("click", (e) => {
			const b = e.target.closest("button[data-q]");
			if (!b || !this.criteria) return;
			if (b.dataset.q === "__more") {
				open_filter_editor({ root: this.root, criteria: this.criteria, item: null, anchor: b });
				return;
			}
			const item = filter_items(this.criteria).find((x) => x.key === b.dataset.q);
			if (item) open_filter_editor({ root: this.root, criteria: this.criteria, item, anchor: b });
		});
	}

	set_criteria(criteria) {
		this.criteria = criteria;
		this.signature = "";
		this.refresh();
	}

	/** The words between the values, and each value's button (data-q: the item's key). */
	refresh() {
		const items = filter_items(this.criteria);
		const q = (key, text, label, part = "") =>
			`<button type="button" class="rv-q${text ? "" : " unset"}" data-q="${esc(key)}"${part ? ` data-part="${part}"` : ""} aria-haspopup="dialog" aria-label="${esc(`${label}: ${text || __("Not set")}`)}"><bdi>${esc(text || __("Not set"))}</bdi></button>`;
		const words = (s) => `<span class="w">${esc(s)}</span>`;
		const parts = [];
		const company = items.find((it) => it.kind === "filter" && it.fieldname === this.criteria?.plan.keys.company_key);
		const period = items.find((it) => it.kind === "period");
		const rest = items.filter((it) => it !== company && it !== period);
		// «for <company>», «from <date> to <date>»; the translations keep the order of the words
		const fill = (pattern, values) =>
			pattern
				.split(/(\{\d\})/)
				.map((t) => (/^\{\d\}$/.test(t) ? values[Number(t.slice(1, -1))] : t ? words(t) : ""))
				.join("");
		if (company) parts.push(fill(__("for {0}", null, "Report View sentence"), [q(company.key, company.text, company.label)]));
		if (period) {
			parts.push(
				period.text
					? fill(__("from {0} to {1}", null, "Report View sentence"), [q(period.key, period.from, __("From Date"), "from"), q(period.key, period.to, __("To Date"), "to")])
					: q(period.key, "", period.label)
			);
		}
		for (const it of rest) parts.push(it.bare && it.text ? q(it.key, it.text, it.label) : `${words(`${it.label}`)} ${q(it.key, it.text, it.label)}`);
		const sep = `<span class="w">${esc(__(", "))}</span>`;
		const more = has_more(this.criteria) ? ` <button type="button" class="rv-q-more" data-q="__more" aria-haspopup="dialog">${esc(__("+ condition"))}</button>` : "";
		const html = parts.join(sep) + more;
		if (html === this.signature) return;
		// the button in hand (an open editor's anchor) is kept: only its text changes
		const open = this.el.querySelector('button[aria-expanded="true"]');
		if (open) {
			const tpl = document.createElement("p");
			tpl.innerHTML = html;
			const same = [...tpl.querySelectorAll("button[data-q]")].map((b) => `${b.dataset.q}|${b.dataset.part || ""}`);
			const now = [...this.el.querySelectorAll("button[data-q]")].map((b) => `${b.dataset.q}|${b.dataset.part || ""}`);
			if (same.join() === now.join()) {
				const fresh = [...tpl.querySelectorAll("button[data-q]")];
				[...this.el.querySelectorAll("button[data-q]")].forEach((b, i) => {
					b.innerHTML = fresh[i].innerHTML;
					b.className = fresh[i].className;
					b.setAttribute("aria-label", fresh[i].getAttribute("aria-label") || "");
				});
				this.signature = html;
				return;
			}
		}
		this.el.innerHTML = html;
		this.signature = html;
	}
}
