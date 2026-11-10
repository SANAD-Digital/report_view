// The start of a new letter head (ADR-018, «ب — الأنماط»): six styles drawn with the selected
// company's real data, the company's fields beside them (an empty one is said to be empty,
// never filled with made-up text), and a larger preview of the chosen style.

import { PRESETS, FAMILIES } from "./presets.js";
import { field_value, missing_tokens, esc } from "./render.js";
import { token_label } from "./labels.js";
import { thumb_html, fit_thumbs } from "./panels.js";
import { icons } from "./icons.js";
import { frame_resize_observer } from "../util.js";

// what a letter head usually shows; the gallery says which of these the company lacks
const SHOWN = ["company_name_ar", "company_name", "address", "address_ar", "phone_no", "email", "website", "tax_id", "cr_no", "unified_no", "po_box", "iban"];

export class Gallery {
	constructor({ parent, host }) {
		this.host = host;
		this.parent = parent;
		this.selected = "classic";
		// the family the cards are filtered by ("all": every style of the library)
		this.family = "all";
		parent.addEventListener("click", (e) => this.on_click(e));
		parent.addEventListener("dblclick", (e) => {
			const card = e.target.closest("[data-preset]");
			if (card) this.host.start_from(card.dataset.preset);
		});
		parent.addEventListener("change", (e) => {
			if (e.target.matches("[data-ref=company]")) this.host.set_company(e.target.value);
		});
		this.ro = frame_resize_observer(() => fit_thumbs(parent));
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
		const shown = PRESETS.filter((p) => this.family === "all" || p.family === this.family);
		const fam = (id, label, n) => `<button type="button" role="tab" data-family="${id}" aria-selected="${this.family === id}">${esc(label)} <span class="n">${n}</span></button>`;
		const families = `<div class="rvlb-tabs rvlb-families" role="tablist" aria-label="${esc(__("Families of styles"))}">${fam("all", __("All"), PRESETS.length)}${FAMILIES.map((f) => fam(f.id, __(f.label), PRESETS.filter((p) => p.family === f.id).length)).join("")}</div>`;
		const cards = shown.map((p) => {
			const on = p.id === this.selected;
			return `<button type="button" class="rvlb-card${on ? " on" : ""}" data-preset="${p.id}" aria-pressed="${on}">
				${thumb_html(h.preset_layout(p.id), ctx)}
				<span class="rvlb-card-f"><strong>${esc(__(p.label))}</strong>${on ? `<span class="rvlb-card-on">${icons.check()}${esc(__("Selected"))}</span>` : ""}</span>
			</button>`;
		}).join("");
		const layout = h.preset_layout(this.selected);
		const hidden = missing_tokens(layout, ctx);
		this.parent.innerHTML = `
			<div class="rvlb-gal">
				<aside class="rvlb-gal-side" aria-label="${esc(__("Company data"))}">
					<label class="rv-field">${esc(__("Company"))}
						<select class="rv-input" data-ref="company">${h.companies.map((c) => `<option value="${esc(c)}"${c === h.company ? " selected" : ""}>${esc(c)}</option>`).join("")}</select>
					</label>
					<div class="rvlb-gal-names">
						<span class="rvlb-h3">${esc(__("The name in two languages"))}</span>
						<div class="rvlb-name${ar_is_name ? " is-empty" : ""}" dir="rtl">${esc(ar_is_name ? __("No Arabic name yet") : ar)}</div>
						<div class="rvlb-name ltr" dir="ltr">${esc(en)}</div>
						<p class="rvlb-note">${esc(ar_is_name ? __("Without it the styles print the name once, in English. Add it with «Edit the company's paper data».") : __("The English name from the company record, the Arabic one from its paper data."))}</p>
					</div>
					<div>
						<span class="rvlb-h3">${esc(__("On the paper"))}</span>
						<ul class="rvlb-vals">
							<li><span>${esc(__("Logo"))}</span><b class="${has_logo ? "" : "is-empty"}">${esc(has_logo ? __("From the company record") : __("Empty"))}</b></li>
							${SHOWN.filter((t) => t !== "company_name_ar" && t !== "company_name").map(row).join("")}
						</ul>
						<button type="button" class="btn btn-default btn-sm rvlb-paper-btn" data-act="company-paper">${esc(__("Edit the company's paper data"))}</button>
					</div>
					${
						missing.length || !has_logo
							? `<div class="rvlb-warn" role="note">${icons.alert()}<span>${esc(__("Empty in the company record: {0}. Fill them there and they appear by themselves; until then they are left out, never made up.", [[...(has_logo ? [] : [__("Logo")]), ...missing.map(token_label)].join(__(", "))]))}</span>
								<a class="rv-link" href="/desk/company/${encodeURIComponent(h.company || "")}" target="_blank" rel="noopener">${esc(__("Open the company"))}</a></div>`
							: ""
					}
				</aside>
				<main class="rvlb-gal-main">
					${h.letter_head && !h.has_layout && (h.current?.header || h.current?.footer) ? this.current_html(h) : ""}
					<div class="rvlb-gal-hd"><strong>${esc(__("{0} styles drawn with your company's data", [PRESETS.length]))}</strong><span>${esc(h.brand ? __("The colour comes from the logo; change it on the next step.") : __("Change the colours and the font on the next step."))}</span></div>
					${families}
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

	/**
	 * The letter head as it prints now (a letter head the builder did not make), first: in a
	 * frame that runs nothing, with «Start from it» when its image can be carried over.
	 */
	current_html(h) {
		const cur = h.current || {};
		const doc = `<!doctype html><html dir="${h.rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><style>html,body{margin:0;background:white;color:black;font-family:system-ui,sans-serif}body{padding:16px 24px}img{max-width:100%;height:auto}.rv-sep{border:0;border-top:1px dashed;opacity:.25;margin:16px 0}</style></head><body>${cur.header || ""}${cur.footer ? `<hr class="rv-sep">${cur.footer}` : ""}</body></html>`;
		const can = Boolean(cur.header_image || cur.footer_image);
		return `<section class="rvlb-current" aria-label="${esc(__("The letter head as it prints now"))}">
			<div class="rvlb-gal-hd"><strong>${esc(__("«{0}» as it prints now", [h.letter_head]))}</strong><span>${esc(can ? __("Start from it to edit it in the builder, or choose a style below: nothing changes until you save.") : __("It was written by hand and has no image to carry over: choose a style below; nothing changes until you save."))}</span></div>
			<iframe class="rvlb-current-frame" sandbox="" title="${esc(h.letter_head)}" srcdoc="${esc(doc)}"></iframe>
			${can ? `<div class="rvlb-current-acts"><button type="button" class="btn btn-default btn-sm" data-act="from-current">${esc(__("Start from it"))}</button></div>` : ""}
		</section>`;
	}

	on_click(e) {
		const family = e.target.closest("[data-family]");
		if (family) {
			this.family = family.dataset.family;
			return this.render();
		}
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
		if (act === "company-paper") this.host.edit_company_paper();
		if (act === "from-current") this.host.start_from_current();
	}
}

