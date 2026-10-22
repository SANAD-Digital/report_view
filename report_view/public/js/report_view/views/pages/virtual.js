// The sheets of the Pages view and their content (views/pages_view.js): the pages are mounted
// as empty boxes of their size; only those near the viewport are filled (IntersectionObserver)
// and far ones give their content back; printing fills them all, in runs read at once.
// Methods of PagesView.

import { error_text } from "../../api.js";
import { esc, fmt_int } from "../../util.js";
import { FILL_PARALLEL, KEEP_FILLED, NEAR_PAGES, PRINT_PARALLEL, PRINT_RUN } from "./settings.js";

export class PagesVirtual {
	/**
	 * The sheets of the pages, empty until near the viewport. Pages past the print limit are
	 * never printed: they are not mounted, a card at the end says how many there are.
	 */
	mount_pages(box, dir) {
		if (this.observer) this.observer.disconnect();
		this.filled.clear();
		this.filling.clear();
		this.queue = [];
		const n = this.pages.length;
		const max = this.max_pages();
		const shown = Math.min(n, max);
		const num = fmt_int;
		let html = "";
		for (let i = 0; i < shown; i++) html += this.page_shell(i, box, dir, `<span class="rv-page-ph">${esc(num(i + 1))}</span>`);
		if (n > shown) {
			html += `<div class="rv-print-more" role="note">${esc(
				__("{0} more pages are not shown: no more than {1} pages print at once. Narrow the filters, fold groups or export to Excel.", [num(n - shown), num(max)])
			)}</div>`;
		}
		this.sheets.innerHTML = html;
		this.count_el.textContent = __("{0} pages", [num(n)]);
		this.render_thumbs();
		this.el.classList.toggle("many", n > max);
		this.observer = new IntersectionObserver((entries) => this.on_intersect(entries), {
			root: this.stage,
			rootMargin: `${Math.round(box.h * NEAR_PAGES)}px 0px`,
			threshold: 0,
		});
		this.observe_pages();
	}

	/** The mounted sheets of the pages (the card of the pages not shown aside). */
	page_sheets() {
		return this.sheets.querySelectorAll(":scope > .rv-page[data-page]");
	}

	observe_pages() {
		for (const el of this.page_sheets()) this.observer.observe(el);
	}

	on_intersect(entries) {
		for (const e of entries) {
			const i = Number(e.target.dataset.page);
			if (e.isIntersecting) this.request_fill(i);
		}
		this.trim_filled();
	}

	request_fill(i) {
		if (this.filled.has(i) || this.filling.has(i) || this.queue.includes(i)) return;
		this.queue.push(i);
		this.pump();
	}

	pump() {
		while (this.filling.size < FILL_PARALLEL && this.queue.length) {
			const i = this.queue.shift();
			this.filling.add(i);
			const done = this.fill(i)
				.catch((e) => this.note(__("A page could not be drawn: {0}", [error_text(e)]), true))
				.finally(() => {
					this.filling.delete(i);
					this.inflight.delete(done);
					this.pump();
				});
			this.inflight.add(done);
		}
	}

	// Far pages give their content back, so a long report keeps a bounded DOM.
	trim_filled() {
		// never while printing: the sheets leave the stage, and every one of them must print
		if (this.printing || this.filled.size <= KEEP_FILLED) return;
		const top = this.stage.scrollTop;
		const h = this.box.h + this.sheet_metrics().gap;
		const z = this.zoom_value();
		const at = Math.floor(top / (h * z));
		const far = [...this.filled.keys()].filter((i) => Math.abs(i - at) > NEAR_PAGES + 2).sort((a, b) => Math.abs(b - at) - Math.abs(a - at));
		for (const i of far.slice(0, this.filled.size - KEEP_FILLED)) {
			const el = this.sheets.children[i];
			if (el) el.innerHTML = `<span class="rv-page-ph">${esc(fmt_int(i + 1))}</span>${this.watermark_html(i)}`;
			this.filled.delete(i);
		}
	}

	async fill(i) {
		const token = this.token;
		const cur = this.current;
		const page = this.pages[i];
		const el = this.sheets.children[i];
		if (!page || !el || !cur) return;
		let html;
		if (this.format) {
			html = this.custom_page_html(i);
		} else {
			const plan = this.rows.plan(this.layout, page.start, page.end - page.start);
			const [recs, values] = await Promise.all([
				this.rows.read_records(cur, plan, this.layout),
				this.rows.read_values(cur, plan, 0, this.rows.model.data.length),
			]);
			if (token !== this.token || this.current !== cur) return;
			html = this.standard_page_html(i, page, plan, recs, values);
		}
		if (token !== this.token) return;
		this.paint(i, el, html);
	}

	paint(i, el, html) {
		// the watermark goes with the content of the page
		el.innerHTML = html + this.watermark_html(i);
		this.filled.set(i, true);
	}

	/**
	 * Fills a run of neighbouring pages (printing): their rows are read from the view at once,
	 * then each page is drawn from what was read.
	 * @param {number[]} run indices of pages, in order, none filled
	 */
	async fill_run(run) {
		const token = this.token;
		const cur = this.current;
		for (const i of run) this.filling.add(i);
		try {
			if (this.format) {
				for (const i of run) {
					const el = this.sheets.children[i];
					if (el && this.pages[i]) this.paint(i, el, this.custom_page_html(i));
				}
				return;
			}
			const first = this.pages[run[0]];
			const last = this.pages[run[run.length - 1]];
			if (!first || !last || !cur) return;
			const plan = this.rows.plan(this.layout, first.start, last.end - first.start);
			const [recs, values] = await Promise.all([
				this.rows.read_records(cur, plan, this.layout),
				this.rows.read_values(cur, plan, 0, this.rows.model.data.length),
			]);
			if (token !== this.token || this.current !== cur) return;
			for (const i of run) {
				const el = this.sheets.children[i];
				if (el && !this.filled.has(i)) this.paint(i, el, this.standard_page_html(i, this.pages[i], plan, recs, values));
			}
		} finally {
			for (const i of run) this.filling.delete(i);
		}
	}

	/**
	 * Fills every mounted page: the pages not filled in runs (PRINT_RUN pages read at once,
	 * PRINT_PARALLEL runs side by side); resolves once the fills under way are done too, with
	 * the number of mounted pages still without their content (a read that failed: such a
	 * page shows only its number and must not print).
	 */
	async fill_all() {
		// the pages waiting for the viewport are filled here, with the others
		this.queue = [];
		const n = Math.min(this.pages.length, this.page_sheets().length);
		const runs = [];
		let run = null;
		for (let i = 0; i < n; i++) {
			if (this.filled.has(i) || this.filling.has(i)) {
				run = null;
				continue;
			}
			if (!run || run.length >= PRINT_RUN) runs.push((run = []));
			run.push(i);
		}
		let next = 0;
		let error = null;
		const worker = async () => {
			while (next < runs.length) {
				await this.fill_run(runs[next++]).catch((e) => {
					error ||= e;
				});
			}
		};
		await Promise.all(Array.from({ length: Math.min(PRINT_PARALLEL, runs.length) }, worker));
		await Promise.all([...this.inflight]);
		let missing = 0;
		for (let i = 0; i < n; i++) if (!this.filled.has(i)) missing += 1;
		this.fill_error = missing ? error : null;
		return missing;
	}
}
