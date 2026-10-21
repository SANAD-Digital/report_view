// The start of a new letter head (ADR-018, «ب — الأنماط»): six styles drawn with the selected
// company's real data, the company's fields beside them (an empty one is said to be empty,
// never filled with made-up text), and a larger preview of the chosen style.

import { PRESETS } from "./presets.js";
import { field_value, missing_tokens, esc } from "./render.js";
import { token_label } from "./labels.js";
import { thumb_html, fit_thumbs } from "./panels.js";
import { icons } from "./icons.js";

// what a letter head usually shows; the gallery says which of these the company lacks
const SHOWN = ["company_name_ar", "company_name", "address", "phone_no", "email", "website", "tax_id", "registration_details"];

export class Gallery {
	constructor({ parent, host }) {
		this.host = host;
		this.parent = parent;
		this.selected = "classic";
		parent.addEventListener("click", (e) => this.on_click(e));
		parent.addEventListener("dblclick", (e) => {
			const card = e.target.closest("[data-preset]");
			if (card) this.host.start_from(card.dataset.preset);
		});
		parent.addEventListener("change", (e) => {
			if (e.target.matches("[data-ref=company]")) this.host.set_company(e.target.value);
		});
		this.ro = new ResizeObserver(() => fit_thumbs(parent));
		this.ro.observe(parent);
	}

	render() {
		const h = this.host;
		const ctx = h.render_ctx();
		const has_logo = Boolean(ctx.logo);
		const missing = SHOWN.filter((t) => !field_value(ctx, t) && t !== "company_name_ar");
		const ar = field_value(ctx, "company_name_ar");
		const en = field_value(ctx, "company_name");
		const ar_is_name = !ar || ar === en;
		const row = (t) => {
			const v = field_value(ctx, t);
			return `<li><span>${esc(token_label(t))}</span><b class="${v ? "ltr" : "is-empty"}">${esc(v ? v.split("\n")[0] : __("Empty"))}</b></li>`;
		};
		const cards = PRESETS.map((p) => {
			const on = p.id === this.selected;
			return `<button type="button" class="rvlb-card${on ? " on" : ""}" data-preset="${p.id}" aria-pressed="${on}">
				${thumb_html(h.preset_layout(p.id), ctx)}
				<span class="rvlb-card-f"><strong>${esc(__(p.label))}</strong>${on ? `<span class="rvlb-card-on">${icons.check()}${esc(__("Selected"))}</span>` : ""}</span>
			</button>`;
		}).join("");
		const layout = h.preset_layout(this.selected);
		const hidden = missing_tokens(layout, ctx);
		const title = h.letter_head ? h.letter_head : __("New letter head");
		this.parent.innerHTML = `
			<header class="rvlb-bar">
				<div class="rvlb-title"><strong>${esc(title)}</strong></div>
				<ol class="rvlb-steps" aria-label="${esc(__("Steps"))}">
					<li class="on" aria-current="step">1 · ${esc(__("Choose a style"))}</li>
					<li>2 · ${esc(__("Fine-tune on the page"))}</li>
					<li>3 · ${esc(__("Save to the letter heads"))}</li>
				</ol>
				<span class="rvlb-flex"></span>
				<button type="button" class="rv-btn" data-act="blank">${esc(__("Blank page"))}</button>
				<button type="button" class="rv-btn primary" data-act="start">${esc(__("Start with this style"))}</button>
			</header>
			<div class="rvlb-gal">
				<aside class="rvlb-gal-side" aria-label="${esc(__("Company data"))}">
					<label class="rv-field">${esc(__("Company"))}
						<select class="rv-input" data-ref="company">${h.companies.map((c) => `<option value="${esc(c)}"${c === h.company ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
					</label>
					<div class="rvlb-gal-names">
						<span class="rvlb-h3">${esc(__("The name in two languages"))}</span>
						<div class="rvlb-name" dir="rtl">${esc(ar || en)}</div>
						<div class="rvlb-name ltr" dir="ltr">${esc(en)}</div>
						<p class="rvlb-note">${esc(ar_is_name ? __("No Arabic name yet: add a Translation of the company name and it shows on the right.") : __("The English name from the company record, the Arabic one from its Translation."))}</p>
					</div>
					<div>
						<span class="rvlb-h3">${esc(__("On the paper"))}</span>
						<ul class="rvlb-vals">
							<li><span>${esc(__("Logo"))}</span><b class="${has_logo ? "" : "is-empty"}">${esc(has_logo ? __("From the company record") : __("Empty"))}</b></li>
							${SHOWN.filter((t) => t !== "company_name_ar" && t !== "company_name").map(row).join("")}
						</ul>
					</div>
					${
						missing.length || !has_logo
							? `<div class="rvlb-warn" role="note">${icons.alert()}<span>${esc(__("Empty in the company record: {0}. Fill them there and they appear by themselves; until then they are left out, never made up.", [[...(has_logo ? [] : [__("Logo")]), ...missing.map(token_label)].join(__(", "))]))}</span>
								<a class="rv-link" href="/desk/company/${encodeURIComponent(h.company || "")}" target="_blank" rel="noopener">${esc(__("Open the company"))}</a></div>`
							: ""
					}
				</aside>
				<main class="rvlb-gal-main">
					${h.letter_head && !h.has_layout ? `<div class="rvlb-info" role="note">${icons.alert()}<span>${esc(__("«{0}» was not made with the builder. Start from a style: its current content stays until you save.", [h.letter_head]))}</span></div>` : ""}
					<div class="rvlb-gal-hd"><strong>${esc(__("Six styles drawn with your company's data"))}</strong><span>${esc(h.brand ? __("The colour comes from the logo; change it on the next step.") : __("Change the colours and the font on the next step."))}</span></div>
					<div class="rvlb-cards">${cards}</div>
					<section class="rvlb-gal-pv" aria-label="${esc(__("Preview of the selected style"))}">
						<div class="rvlb-gal-pvmain">
							<div class="rvlb-gal-pvhd"><span>${esc(__("Top of the first page"))}</span><span class="ltr">A4 · ${esc(__("header {0} mm", [layout.header.h]))}</span></div>
							<div class="rvlb-pvband">${thumb_html(layout, ctx, "header")}</div>
							${layout.footer.h ? `<div class="rvlb-pvband is-foot">${thumb_html(layout, ctx, "footer")}</div>` : ""}
							${hidden.length ? `<p class="rvlb-note">${esc(__("Left out because empty: {0}", [hidden.map(token_label).join(__(", "))]))}</p>` : ""}
						</div>
						<div class="rvlb-works">
							<span class="rvlb-h3">${esc(__("Works in"))}</span>
							${[__("Frappe's print and print formats"), __("PDF from the server"), __("Report View pages"), __("Each company with its own logo and data")].map((w) => `<div>${icons.check()}<span>${esc(w)}</span></div>`).join("")}
						</div>
					</section>
				</main>
			</div>`;
		requestAnimationFrame(() => fit_thumbs(this.parent));
	}

	on_click(e) {
		const card = e.target.closest("[data-preset]");
		if (card) {
			this.selected = card.dataset.preset;
			this.render();
			this.parent.querySelector(`[data-preset="${this.selected}"]`)?.focus({ preventScroll: true });
			return;
		}
		const act = e.target.closest("[data-act]")?.dataset.act;
		if (act === "start") this.host.start_from(this.selected);
		if (act === "blank") this.host.start_from(null);
	}
}

