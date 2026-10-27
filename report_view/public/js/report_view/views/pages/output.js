// Print and PDF of the Pages view (ADR-014, ADR-016): every page filled, the sheets alone in
// the document with the paper's @page rule, the browser's dialog; or the same sheets sent to
// the server's engine as one document (its styles in use, private images inlined), a job
// followed until its file downloads. Methods of PagesView (views/pages_view.js).

import { error_text } from "../../api.js";
import { download_blob, esc, fmt_int } from "../../util.js";
import { AFTERPRINT_FALLBACK_MS, PDF_POLL_MS, PDF_QUEUE_LIMIT_MIN, PDF_WAIT_LIMIT_MIN } from "./settings.js";
import { CSS_KEPT, pdf_body, sample_signature } from "./support.js";

export class PagesOutput {
	/**
	 * Print or PDF refused: pages not laid out, or not drawn, would go out as empty sheets with
	 * only their number. Says so (the panel and a dialog); nothing is printed.
	 * @param {number} missing pages without their content (-1: the layout failed)
	 */
	refuse_print(missing, total) {
		const why = this.layout_error || this.fill_error;
		const message =
			missing < 0
				? __("The pages could not be laid out, so nothing was printed.")
				: __("{0} of {1} pages could not be drawn, so nothing was printed. Try again.", [fmt_int(missing), fmt_int(total)]);
		this.note(message, true);
		const detail = why ? error_text(why) : "";
		frappe.msgprint({ title: __("Nothing was printed"), message: esc(detail ? `${message} ${detail}` : message), indicator: "red" });
	}

	/** Prints the pages: every page is filled, the sheets stand alone in the document, the browser's dialog opens. */
	async print() {
		if (!this.pages.length || this.printing) return;
		if (this.pages.length > this.max_pages()) {
			frappe.msgprint({
				title: __("Too many pages to print"),
				message: esc(__("{0} pages are more than the browser prints at once ({1}). Narrow the filters, fold groups or export to Excel.", [fmt_int(this.pages.length), fmt_int(this.max_pages())])),
				indicator: "orange",
			});
			return;
		}
		const restore = await this.prepare_print();
		if (!restore) return;
		window.addEventListener("afterprint", restore);
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		window.print();
		// Browsers that return before the dialog closes fire afterprint; the others are done here.
		setTimeout(restore, AFTERPRINT_FALLBACK_MS);
	}

	/**
	 * Fills every page and moves the sheets to a root of their own in the document, with the
	 * @page rule of the paper, as the print needs them. Resolves with the function that puts
	 * them back (also run on afterprint); null when nothing is shown.
	 */
	async prepare_print() {
		if (!this.pages.length || this.printing) return null;
		this.printing = true;
		const button = this.el.querySelector('[data-action="print"]');
		button.disabled = true;
		const release = () => {
			this.printing = false;
			button.disabled = false;
		};
		// relayout never rejects: a layout that failed is kept in layout_error (-1)
		let missing = -1;
		try {
			await this.ready;
			if (!this.layout_error) {
				missing = await this.fill_all();
				if (!missing) {
					// the sheets leave the stage: its observer would take them for far pages and empty them
					if (this.observer) this.observer.disconnect();
					missing = await this.fill_all();
				}
			}
		} catch (e) {
			release();
			throw e;
		}
		if (missing) {
			if (this.observer) {
				this.observer.disconnect();
				this.observe_pages();
			}
			release();
			this.refuse_print(missing, Math.min(this.pages.length, this.page_sheets().length));
			return null;
		}
		const root = document.createElement("div");
		root.className = `rv rv-print-root ${this.root.classList.contains("compact") ? "compact" : ""}`;
		// the variables of the pages (rules, colours, heights, margins, watermark) live on the
		// page's root: the sheets printed apart keep them
		for (const name of this.root.style) if (name.startsWith("--")) root.style.setProperty(name, this.root.style.getPropertyValue(name));
		root.dir = this.sheets.dir;
		root.lang = this.sheets.lang;
		const style = document.createElement("style");
		style.textContent = this.print_css();
		const sheets = this.sheets;
		const fmt_css = this.fmt_css;
		// the format's styles (once for all the pages) before the sheets; the paper's rules
		// last in the document, after any style a format carries (core/pdf.py splits the
		// sheets at "</div><style>@page{")
		root.append(fmt_css, sheets, style);
		document.body.appendChild(root);
		this.print_root = root;
		const restore = () => {
			window.removeEventListener("afterprint", restore);
			if (root.isConnected) {
				this.stage.insertBefore(fmt_css, this.probe);
				this.stage.insertBefore(sheets, this.probe);
				root.remove();
			}
			// the pages are observed from their stage again
			if (this.observer) {
				this.observer.disconnect();
				this.observe_pages();
			}
			this.printing = false;
			button.disabled = false;
			// the far pages give their content back (a long print filled them all)
			if (this.box) this.trim_filled();
		};
		return restore;
	}

	/**
	 * The PDF of these pages (ADR-016): the sheets as printed (prepare_print), in a document
	 * of their own with the page's styles and the images inlined, are sent to the server's
	 * engine (Chromium), which prints them as this browser would: the same pages.
	 */
	async pdf() {
		if (!this.pages.length || this.printing) return;
		if (this.pages.length > this.max_pages()) return this.print();
		const target = this.host.pages_pdf_target();
		const button = this.el.querySelector('[data-action="pdf"]');
		const title = `${this.ctx.report_name}`.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
		button.disabled = true;
		try {
			// every failure of the PDF, from filling the pages to the file, is said in its dialog
			const restore = await this.prepare_print();
			if (!restore) return;
			this.busy(__("Making the PDF…"));
			let html;
			try {
				html = await this.print_document(this.print_root);
			} finally {
				restore();
			}
			const body = await pdf_body({ ...target.args, title }, html);
			// the document is not kept while a job is followed (it may be tens of MB)
			html = null;
			const r = await fetch(`/api/method/${target.method}`, {
				method: "POST",
				headers: { "X-Frappe-CSRF-Token": frappe.csrf_token, Accept: "application/pdf, application/json" },
				body,
			});
			if ((r.headers.get("Content-Type") || "").includes("pdf") && r.ok) return this.save_pdf(await r.blob(), title);
			const j = await r.json().catch(() => ({}));
			// many pages: a background job prints them; its progress, then the file
			if (r.ok && j.message?.job) return await this.wait_pdf_job(j.message.job, j.message.total, title);
			this.pdf_error(j);
		} catch (e) {
			this.pdf_error(e);
		} finally {
			button.disabled = false;
			this.busy(null);
		}
	}

	/**
	 * Follows a PDF job of the server (ADR-016) until its file is ready, then downloads it.
	 * Waiting in the queue and printing are told apart; the person may cancel; the wait ends
	 * when the job fails or is cancelled, when the server does not start it in
	 * PDF_QUEUE_LIMIT_MIN or finish it in PDF_WAIT_LIMIT_MIN, or when the pages are left.
	 */
	async wait_pdf_job(job, total, title) {
		const num = fmt_int;
		const run = { job, stop: false, reason: null };
		this.pdf_job = run;
		const cancel = this.busy_el.querySelector('[data-action="pdf-cancel"]');
		const started = Date.now();
		let running = false;
		let misses = 0;
		// the server says whether the job can still be cancelled (`cancellable`)
		let cancel_ok = true;
		const say = (text) => {
			this.busy(text);
			cancel.hidden = !cancel_ok;
		};
		say(__("Waiting for the server to start the PDF…"));
		try {
			for (;;) {
				await new Promise((r) => setTimeout(r, PDF_POLL_MS));
				if (run.stop) return this.pdf_stopped(run);
				const waited = (Date.now() - started) / 60000;
				if (!running && waited > PDF_QUEUE_LIMIT_MIN) {
					this.stop_pdf_job(run, "limit");
					return this.pdf_error({ exception: __("The server did not start the PDF within {0} minutes. Try again later or print fewer pages.", [fmt_int(PDF_QUEUE_LIMIT_MIN)]) });
				}
				if (waited > PDF_WAIT_LIMIT_MIN) {
					this.stop_pdf_job(run, "limit");
					return this.pdf_error({ exception: __("The PDF took longer than {0} minutes and was stopped. Print fewer pages.", [fmt_int(PDF_WAIT_LIMIT_MIN)]) });
				}
				let st;
				try {
					const r = await fetch(`/api/method/report_view.api.pdf.pages_pdf_status?${new URLSearchParams({ job })}`, {
						headers: { "X-Frappe-CSRF-Token": frappe.csrf_token, Accept: "application/json" },
					});
					const j = await r.json().catch(() => ({}));
					// the server answered no (the job is gone, not this user's): nothing to wait for
					if (!r.ok) return this.pdf_error(j);
					st = j.message || {};
					misses = 0;
				} catch (e) {
					// the network: a few misses in a row are borne
					if (++misses >= 3) return this.pdf_error({ exception: __("The server could not be reached: {0}", [error_text(e)]) });
					continue;
				}
				if (run.stop) return this.pdf_stopped(run);
				// `stage` (queued, waiting, rendering, done, failed, cancelled) where the server
				// gives it, else `state` (queued, running, done, failed)
				const stage = st.stage || st.state;
				cancel_ok = st.cancellable !== false;
				if (stage === "cancelled" || st.error_code === "cancelled") {
					run.reason = run.reason || "cancel";
					return this.pdf_stopped(run);
				}
				if (stage === "failed" || st.state === "failed") return this.pdf_error({ exception: st.error });
				if (stage === "done" || st.state === "done") break;
				if (stage === "queued" || stage === "waiting") {
					say(__("Waiting for the server to start the PDF…"));
					continue;
				}
				running = true;
				say(__("Making the PDF: {0} of {1} pages…", [num(st.done || 0), num(st.total || total)]));
			}
			const r = await fetch(`/api/method/report_view.api.pdf.pages_pdf_download?${new URLSearchParams({ job })}`, {
				headers: { "X-Frappe-CSRF-Token": frappe.csrf_token },
			});
			if (!r.ok) return this.pdf_error(await r.json().catch(() => ({})));
			const blob = await r.blob();
			if (!run.stop) this.save_pdf(blob, title);
		} finally {
			cancel.hidden = true;
			if (this.pdf_job === run) this.pdf_job = null;
		}
	}

	/**
	 * Stops following a PDF job and asks the server to drop it (pages_pdf_cancel; its answer
	 * is not waited for: the job is no longer followed either way).
	 * @param {"cancel"|"limit"|"leave"} reason
	 */
	stop_pdf_job(run, reason) {
		if (run.stop) return;
		run.stop = true;
		run.reason = reason;
		const form = new FormData();
		form.append("job", run.job);
		fetch("/api/method/report_view.api.pdf.pages_pdf_cancel", {
			method: "POST",
			headers: { "X-Frappe-CSRF-Token": frappe.csrf_token, Accept: "application/json" },
			body: form,
		}).catch(() => {});
	}

	pdf_stopped(run) {
		if (run.reason === "cancel") frappe.show_alert?.({ message: __("The PDF was cancelled"), indicator: "orange" });
	}

	save_pdf(blob, title) {
		download_blob(blob, `${title}.pdf`);
	}

	/**
	 * The dialog of a PDF that failed: the server's words (or the error's) as text, escaped;
	 * the general message when the answer says nothing.
	 */
	pdf_error(e) {
		const says = e && (typeof e !== "object" || e instanceof Error || e._server_messages || e._error_message || e.exception || e.responseJSON);
		const text = says ? error_text(e) : __("The PDF could not be made");
		frappe.msgprint({ title: __("PDF"), message: esc(text).replace(/\n/g, "<br>"), indicator: "red" });
	}

	/**
	 * The HTML document of the printed sheets for the server's engine (ADR-016). What the
	 * engine reads from the site's public files itself (/assets, /files: from disk) goes as a
	 * link, in the order of the page: the stylesheets, the public images, the fonts. Only
	 * what it may not read is inlined: the page's own <style> blocks and private images (as
	 * data: URIs, once each). The attributes of <html> and <body> go as they are.
	 */
	async print_document(root) {
		const PUBLIC = /^\/(assets|files)\//;
		const used = this.css_in_use(root);
		const head = [];
		const seen = new Set();
		for (const sheet of document.styleSheets) {
			// the styles inside the printed root (a format's, a signature's, the paper's) go
			// with the sheets themselves
			if (sheet.ownerNode && root.contains(sheet.ownerNode)) continue;
			let rules;
			try {
				rules = sheet.cssRules;
			} catch {
				continue;
			}
			if (!rules) continue;
			const base = sheet.href || location.href;
			// a stylesheet of the site is tested once per kind of pages (CSS_KEPT)
			let text;
			if (sheet.href) {
				const key = `${rules.length}|${used.signature()}`;
				const kept = CSS_KEPT.get(sheet.href);
				if (kept?.key === key) text = kept.text;
				else {
					text = used(rules);
					CSS_KEPT.set(sheet.href, { key, text });
				}
			} else text = used(rules);
			if (!text || seen.has(text)) continue;
			seen.add(text);
			// url() of a stylesheet resolve against its own address
			const fixed = text.replace(/url\((['"]?)(?!data:|https?:|\/)([^'")]+)\1\)/g, (m, q, u) => `url(${q}${new URL(u, base).pathname}${q})`);
			head.push(`<style>${fixed.replace(/<\/style/gi, "<\\/style")}</style>`);
		}
		const clone = root.cloneNode(true);
		const cache = new Map();
		const inline = async (src) => {
			if (!src || src.startsWith("data:")) return src;
			const url = new URL(src, location.href);
			if (url.origin !== location.origin) return src;
			if (PUBLIC.test(url.pathname)) return url.pathname + url.search;
			if (!cache.has(url.href)) {
				cache.set(
					url.href,
					fetch(url.href, { credentials: "same-origin" })
						.then((r) => (r.ok ? r.blob() : Promise.reject()))
						.then(
							(b) =>
								new Promise((resolve) => {
									const fr = new FileReader();
									fr.onload = () => resolve(fr.result);
									fr.onerror = () => resolve(src);
									fr.readAsDataURL(b);
								})
						)
						.catch(() => src)
				);
			}
			return cache.get(url.href);
		};
		// a private image repeated on every page (a letter head) is inlined once, as a CSS
		// variable the pages' images read
		const images = [...clone.querySelectorAll("img")];
		const sources = await Promise.all(images.map((img) => inline(img.getAttribute("src"))));
		const ids = new Map();
		images.forEach((img, i) => {
			const src = sources[i];
			if (!src?.startsWith("data:")) return img.setAttribute("src", src || "");
			if (!ids.has(src)) ids.set(src, `--rv-img-${ids.size}`);
			img.setAttribute("src", "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==");
			img.style.setProperty("content", `var(${ids.get(src)})`);
		});
		if (ids.size) head.push(`<style>:root{${[...ids].map(([src, id]) => `${id}:url("${src}")`).join(";")}}</style>`);
		for (const el of clone.querySelectorAll("script")) el.remove();
		const attrs = (el) => [...el.attributes].map((x) => `${x.name}="${esc(x.value)}"`).join(" ");
		return `<!doctype html><html ${attrs(document.documentElement)}><head><meta charset="utf-8"><base href="${esc(location.origin)}/"><title>${esc(this.ctx.report_name)}</title>${head.join("")}</head><body ${attrs(document.body)}>${clone.outerHTML}</body></html>`;
	}

	/**
	 * The style rules the printed sheets use, as CSS text: a rule is kept when its selector
	 * matches an element of a sample of the sheets (the first, the last and some between),
	 * <html> or <body>; @font-face and anything that cannot be tested are kept, @media and
	 * the like keep what they hold that is used. Desk carries some twelve thousand rules the
	 * pages never use: sent with them, they slow the server's engine down.
	 * The sample is built on the first test; `signature()` names what the tests depend on.
	 * @returns {((rules: CSSRuleList) => string) & {signature: () => string}}
	 */
	css_in_use(root) {
		const sheets = [...root.querySelectorAll(".rv-page")];
		const pick = new Set([0, 1, sheets.length - 1]);
		for (let k = 1; k < 6; k++) pick.add(Math.floor((sheets.length * k) / 6));
		const picked = [...pick].filter((i) => sheets[i]).map((i) => sheets[i]);
		let sample = null;
		const make_sample = () => {
			sample = document.createElement("div");
			sample.className = root.className;
			const wrap = document.createElement("div");
			wrap.className = "rv-print-sheets";
			for (const el of picked) wrap.appendChild(el.cloneNode(true));
			sample.appendChild(wrap);
		};
		const html = document.documentElement;
		const body = document.body;
		// what never matches in a static page, and pseudo-elements (their element is tested)
		const PSEUDO = /::?(before|after|first-letter|first-line|marker|placeholder|selection|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+|-ms-[\w-]+)(\([^)]*\))?/gi;
		const DYNAMIC = /:(hover|focus|focus-visible|focus-within|active|visited|target)\b/i;
		const matches = (selector) => {
			if (DYNAMIC.test(selector)) return false;
			if (!sample) make_sample();
			const sel = selector.replace(PSEUDO, "").trim() || "*";
			try {
				return Boolean(html.matches(sel) || body.matches(sel) || sample.matches(sel) || sample.querySelector(sel));
			} catch {
				// a selector the browser cannot test here: kept
				return true;
			}
		};
		const keep = (rules) => {
			let out = "";
			for (const rule of rules) {
				if (rule instanceof CSSStyleRule) {
					if (rule.selectorText.split(",").some((part) => matches(part))) out += rule.cssText + "\n";
				} else if (rule instanceof CSSMediaRule || (window.CSSSupportsRule && rule instanceof CSSSupportsRule) || (window.CSSContainerRule && rule instanceof CSSContainerRule) || (window.CSSLayerBlockRule && rule instanceof CSSLayerBlockRule)) {
					const inner = keep(rule.cssRules);
					if (inner) out += `${rule.cssText.slice(0, rule.cssText.indexOf("{"))}{\n${inner}}\n`;
				} else if (window.CSSKeyframesRule && rule instanceof CSSKeyframesRule) {
					// animations do not print
				} else {
					out += rule.cssText + "\n";
				}
			}
			return out;
		};
		let signature = null;
		keep.signature = () => (signature ??= sample_signature(picked, root));
		return keep;
	}

	// The paper's size and colour, the only rules of print that depend on the pages; the
	// others are static, in rv_pages.css (`@media print`, .rv-print-root).
	print_css() {
		const b = this.box;
		// the paper's colour (rv_tokens.css) under the sheets: <html> and <body> are not in .rv
		const paper = getComputedStyle(this.root).getPropertyValue("--pp-bg").trim();
		return `@page{size:${b.paper_w_mm}mm ${b.paper_h_mm}mm;margin:0}
@media print{html,body{width:${b.paper_w_mm}mm!important;min-width:0!important;height:auto!important;margin:0!important;padding:0!important;${paper ? `background:${paper}!important;` : ""}overflow:visible!important}}`;
	}
}
