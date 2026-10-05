// Summary cards (docs/architecture.md §11.1 #23-#24; design: the three balance cards of
// reference/design/screens/main.png): for every pair of register.summary (kind
// "balance_pairs"), debit = credit of the grand total shown, the "Balanced" badge, the
// difference and the number of rows. Display only: the page passes the totals it read from
// the engine's view (or the report's own reference row, ADR-008) and the difference of the
// two totals; nothing is summed here.

import { icons } from "./icons.js";

function esc(s) {
	return frappe.utils.escape_html(String(s ?? ""));
}

export class Summary {
	constructor({ parent }) {
		const el = document.createElement("section");
		el.className = "rv-summary";
		el.setAttribute("aria-label", __("Balance summary"));
		el.hidden = true;
		parent.appendChild(el);
		this.el = el;
	}

	hide() {
		this.el.hidden = true;
		this.el.replaceChildren();
	}

	/**
	 * @param {object} s
	 * @param {"loading"|"error"|"empty"|"ready"} s.status
	 * @param {Array<{label: string, debit_html?: string, credit_html?: string, balanced?: boolean, diff_text?: string}>} s.cards
	 * @param {boolean} [s.filtered] browser filters narrow the rows
	 * @param {number} [s.shown] rows that pass the filters
	 * @param {number} [s.total] rows of the report
	 */
	show({ status, cards, filtered = false, shown = 0, total = 0 }) {
		this.el.innerHTML = cards
			.map((c) => {
				let pill = "neu";
				let icon = "";
				let pill_text = "";
				let note = "";
				// The pill says the state; the note line only carries a difference, so a card
				// keeps one height while it loads and when it is balanced (no page jump).
				if (status === "loading") {
					pill_text = __("Calculating…");
				} else if (status === "error") {
					pill_text = __("Not available");
				} else if (status === "empty") {
					icon = icons.funnel(12);
					pill_text = __("No rows");
				} else if (c.balanced) {
					pill = "ok";
					icon = icons.check_xs();
					pill_text = filtered
						? __("Balanced within {0} of {1}", [frappe.format(shown, { fieldtype: "Int" }, { inline: true }), frappe.format(total, { fieldtype: "Int" }, { inline: true })])
						: __("Balanced");
				} else if (filtered) {
					icon = icons.funnel(12);
					pill_text = __("Difference from the filters");
					note = __("Difference {0} — from the rows the filters left out, not an error in the entries", [`<bdi class="ltr">${esc(c.diff_text)}</bdi>`]);
				} else {
					pill = "err";
					icon = icons.alert_xs();
					pill_text = __("Not balanced");
					note = __("Difference {0} — check the entries that are not balanced", [`<bdi class="ltr">${esc(c.diff_text)}</bdi>`]);
				}
				const loading = status === "loading";
				const side = (cls, label, html) => `
					<div class="rv-sum-side ${cls}"><small>${esc(label)}</small>
						${loading ? '<span class="rv-skel rv-sum-skel"></span>' : `<b>${status === "ready" ? html : "—"}</b>`}
					</div>`;
				return `
					<div class="rv-sum">
						<div class="rv-sum-hd">
							<span class="rv-sum-t">${esc(c.label)}</span>
							<span class="rv-pill ${pill}">${icon}${esc(pill_text)}</span>
						</div>
						<div class="rv-sum-eq">
							${side("dr", __("Debit"), c.debit_html)}
							<span class="rv-sum-op" aria-hidden="true">=</span>
							${side("cr", __("Credit"), c.credit_html)}
						</div>
						${note ? `<div class="rv-sum-foot">${note}</div>` : ""}
					</div>`;
			})
			.join("");
		this.el.hidden = !cards.length;
	}
}
