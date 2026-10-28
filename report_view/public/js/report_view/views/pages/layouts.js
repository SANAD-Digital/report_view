// The two layouts of the Pages view (views/pages_view.js): Report View's standard template (the
// view's rows cut by measured heights, engine/page_layout.js) and a report print format (its
// flow measured block by block and packed into pages, checked in a probe). Methods of PagesView.

import { error_text } from "../../api.js";
import { PAGE_FONT, fit_columns, paginate } from "../../engine/page_layout.js";
import { build_layout } from "../../engine/row_layout.js";
import { ordered_columns } from "../../engine/view_config.js";
import { esc } from "../../util.js";
import { FIT_GUARD, FIT_RUN, SAFETY_PX, UNORDERED, on_page } from "./settings.js";
import { breathe, foot_height, strip_scripts, wait_images } from "./support.js";

export class PagesLayouts {
	base_font() {
		return PAGE_FONT[this.state?.ui?.density === "compact" ? "compact" : "comfortable"];
	}

	/**
	 * Widths for fit_columns. A number column is as wide as its widest value needs (the grand
	 * total's, or its title's longest word), not the grid's width; text columns may narrow, the
	 * label less than the others and it takes the spare room.
	 */
	fit_input() {
		const cur = this.current;
		const total = cur ? this.rows.total_row(cur, cur.counts) : null;
		const chars = (html) => frappe.utils.html2text(String(html || "")).trim().length;
		return this.print_columns().map((d) => {
			if (d.label) return { width: d.width, flex: true, weight: 0.5 };
			if (!d.numeric) return { width: d.width, flex: true, weight: 1 };
			const longest = Math.max(10, chars(total?.cell(d).html), ...String(this.title_of(d)).split(/\s+/).map((w) => w.length));
			// tabular digits are about 0.6em; the padding of a cell is 1.1em (rv_pages.css)
			return { width: Math.min(d.width, Math.ceil((longest * 0.6 + 1.6) * 13)), flex: false };
		});
	}

	/** The columns printed: the label, then the pinned and data columns not hidden for print. */
	print_columns() {
		const m = this.rows.model;
		const hidden = new Set(this.settings.hidden);
		const label = { column: m.label, title: m.label_title, numeric: false, side: null, band: null, totalled: false, width: m.label_width, label: true };
		return [label, ...m.pinned.filter((d) => !hidden.has(d.column.key)), ...m.data.filter((d) => !hidden.has(d.column.key))];
	}

	/** The block margins of an element (a measured height leaves them out). */
	outer_margins(el) {
		const cs = getComputedStyle(el);
		return (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
	}

	table_head(cols, widths, font) {
		const m = this.rows.model;
		const colgroup = `<colgroup>${widths.map((w) => `<col style="width:${w.toFixed(2)}px">`).join("")}</colgroup>`;
		let bands = "";
		if (m.levels === 2) {
			const cells = [];
			for (let i = 0; i < cols.length; ) {
				const d = cols[i];
				if (!d.band) {
					cells.push(`<th class="rv-pt-nb ${d.numeric ? "num" : ""} be" rowspan="2">${esc(this.title_of(d))}</th>`);
					i += 1;
					continue;
				}
				let span = 1;
				while (i + span < cols.length && cols[i + span].band === d.band) span += 1;
				cells.push(`<th class="rv-pt-band be" colspan="${span}">${esc(this.band_title(d.band))}</th>`);
				i += span;
			}
			bands = `<tr>${cells.join("")}</tr>`;
		}
		const titles = cols
			.map((d) => (m.levels === 2 && !d.band ? "" : `<th class="${[d.numeric ? "num" : "", d.band_end || m.levels === 1 ? "be" : ""].filter(Boolean).join(" ")}">${esc(this.title_of(d))}</th>`))
			.join("");
		return `${colgroup}<thead>${bands}<tr>${titles}</tr></thead>`;
	}

	body_row(rec, cols, values, plan) {
		const rows = this.rows;
		const kind = rows.row_kind(rec);
		if (kind === "spacer") return "";
		const t = (m, a) => this.t(m, a);
		const cells = cols.map((d, i) => {
			if (i === 0) {
				let label;
				if (rec.type === "foot") label = rows.label_html(rec, { foot_label: (text) => `<span class="rv-glabel">${esc(t("Total {0}", [text]))}</span>` });
				else if (rows.is_summary(rec)) label = `<div class="rv-lc" style="--lv:${Number(rec.depth) || 0}"><span class="rv-glabel">${rows.caption_of(this.lang_row(rec.row)).html}</span></div>`;
				else label = rows.label_html(rec);
				return `<th class="lc">${label}</th>`;
			}
			const value = rec.type === "spacer" ? null : rows.value_of(values, plan, rec.view_row ?? -1, d.column.key);
			const out = rows.cell(rec, d, value);
			const cls = [d.numeric ? "num" : "", d.band_end ? "be" : "", out.sign].filter(Boolean).join(" ");
			return `<td class="${cls}">${out.html}</td>`;
		});
		return `<tr class="${kind}">${cells.join("")}</tr>`;
	}

	report_row(cls, row, cols) {
		const rows = this.rows;
		const shown = this.lang_row(row);
		const cells = cols.map((d, i) => {
			if (i === 0) return `<th class="lc"><div class="rv-lc"><span class="rv-glabel">${rows.caption_of(shown).html}</span></div></th>`;
			const out = rows.summary_cell(d, shown);
			const cls2 = [d.numeric ? "num" : "", d.band_end ? "be" : "", out.sign].filter(Boolean).join(" ");
			return `<td class="${cls2}">${out.html}</td>`;
		});
		return `<tr class="${cls}">${cells.join("")}</tr>`;
	}

	total_rows_html(cols) {
		const rows = this.rows;
		const cur = this.current;
		const t = (m, a) => this.t(m, a);
		const bottom = rows.report_rows(cur).bottom.map((row) => this.report_row("foot closing", row, cols)).join("");
		if (!this.settings.include_total) return bottom;
		const total = rows.total_row(cur, cur.counts);
		const cells = cols.map((d, i) => {
			if (i === 0) return `<th class="lc"><div class="rv-lc"><span class="rv-glabel">${esc(t("Grand Total"))}</span></div></th>`;
			const out = total.cell(d);
			const cls = [d.numeric ? "num" : "", d.band_end ? "be" : "", out.sign].filter(Boolean).join(" ");
			return `<td class="${cls}">${out.html}</td>`;
		});
		return `${bottom}<tr class="total">${cells.join("")}</tr>`;
	}

	async layout_standard(token, box, dir) {
		const m = this.rows.model;
		const cur = this.current;
		const s = this.settings;
		const cols = this.print_columns();
		const fit = fit_columns(this.fit_input(), box.inner_w, this.base_font());
		this.fit = fit;
		this.cols = cols;
		this.root.style.setProperty("--pp-fs", `${fit.font.toFixed(2)}px`);
		if (fit.overflow) this.note(__("The columns are wider than the page: try landscape, or hide some columns."), true);

		// Rows of the body: the view's, with a subtotal row after every open group when
		// asked; the report's own opening rows stand first, its closing rows and the grand
		// total last (not spacers: the pages have nothing pinned).
		const depths = cur.depths || new Uint8Array(cur.body_rows);
		this.layout = build_layout(depths, { subtotals: s.include_subtotals && m.subtotals, top: 0 });
		const report_rows = this.rows.report_rows(cur);
		const table_head = this.table_head(cols, fit.widths, fit.font);
		this.table_head_html = table_head;

		// Measure: the head of the first page and of the others, the column titles, a body
		// row, the tail (closing rows, grand total, signatures) and the foot.
		const probe_rows = report_rows.top.map((row) => this.report_row("opening", row, cols)).join("") + `<tr><th class="lc"><div class="rv-lc">x</div></th>${cols.slice(1).map(() => "<td>0</td>").join("")}</tr>`;
		this.probe.innerHTML = this.page_shell(
			1,
			box,
			dir,
			`<header class="rv-page-top rv-page-top-next">${this.head_html(false, this.letterhead, 2, 3)}</header>`
		) + this.page_shell(
			0,
			box,
			dir,
			`<header class="rv-page-top rv-page-top-first">${this.head_html(true, this.letterhead)}</header>
			<table class="rv-pt" style="width:${box.inner_w}px">${table_head}<tbody>${probe_rows}</tbody></table>
			<div class="rv-page-tail"><table class="rv-pt" style="width:${box.inner_w}px">${table_head.replace(/<thead>.*<\/thead>/s, "")}<tbody>${this.total_rows_html(cols)}</tbody></table>${this.sig_in_tail() ? this.signatures_html() : ""}</div>
			<footer class="rv-page-foot">${this.foot_html(1, 1, this.letterhead, true)}</footer>`
		);
		await wait_images(this.probe);
		if (token !== this.token) return;
		const q = (sel) => this.probe.querySelector(sel);
		const h = (el) => (el ? el.getBoundingClientRect().height : 0);
		const head_h = h(q(".rv-page-top-first"));
		const next_h = h(q(".rv-page-top-next"));
		const thead_h = h(q(".rv-pt thead"));
		const row_h = h(q(".rv-pt tbody tr:last-child")) || fit.font * 2;
		const top_h = report_rows.top.length * row_h;
		const tail_h = h(q(".rv-page-tail"));
		const foot_h = foot_height(q(".rv-page-foot"));
		// the body of a continuation page; the first page gives up the difference of its head
		const body_h = box.inner_h - next_h - thead_h - foot_h - SAFETY_PX;
		if (this.sig_leaves_no_room(body_h, box)) return this.layout_standard(token, box, dir);
		const filt_h = Math.max(0, head_h - next_h);
		this.measure = { head_h, next_h, filt_h, thead_h, row_h, top_h, tail_h, foot_h, body_h };
		this.probe.replaceChildren();
		if (body_h < row_h * 2) {
			this.note(__("The letter head and the margins leave no room for rows on this paper."), true);
		}
		this.pages = paginate({ count: this.layout.size, row_h, body_h: Math.max(body_h, row_h), first_h: filt_h + top_h, tail_h });
		this.set_format_css("");
		this.mount_pages(box, dir);
	}

	standard_page_html(i, page, plan, recs, values) {
		const cols = this.cols;
		const box = this.box;
		const n = this.pages.length;
		let body = "";
		if (page.first) body += this.rows.report_rows(this.current).top.map((row) => this.report_row("opening", row, cols)).join("");
		for (let y = page.start; y < page.end; y++) {
			const rec = recs.get(y);
			if (rec) body += this.body_row(rec, cols, values, plan);
		}
		let tail = "";
		if (page.last) {
			tail = `<div class="rv-page-tail"><table class="rv-pt" style="width:${box.inner_w}px">${this.table_head_html.replace(/<thead>.*<\/thead>/s, "")}<tbody>${this.total_rows_html(cols)}</tbody></table></div>`;
			if (this.sig_in_tail()) tail += this.signatures_html(this.settings.sig_pos === "bottom");
		}
		return `<header class="rv-page-top">${this.head_html(page.first, this.letterhead, i + 1, n)}</header>
			<div class="rv-page-body"><table class="rv-pt" style="width:${box.inner_w}px">${this.table_head_html}<tbody>${body}</tbody></table>${tail}</div>
			<footer class="rv-page-foot">${this.foot_html(i + 1, n, this.letterhead)}</footer>`;
	}

	/**
	 * A report print format (JS, as the query-report dialog offers them) renders the
	 * whole report as one flow with query-report's context; the flow is cut into pages by
	 * measuring its blocks (a table by its rows, its header repeated).
	 */
	async layout_custom(token, box, dir, remeasure = false) {
		if (remeasure) this.flow_cache = null;
		const ctx = this.ctx;
		let html = "";
		try {
			// a Jinja format (and a document's) comes rendered by the server; a JS one reads
			// query-report's context
			if (this.format.type === "Jinja") html = `<style>${this.format.css || ""}</style>${this.format.html}`;
			else {
				const { columns, data, report } = this.query_report_facade();
				html = frappe.render_template(`<style>${this.format.css || ""}</style>${this.format.html}`, {
				title: this.t(ctx.report_name),
				subtitle: this.settings.include_filters ? this.filters_html() : null,
				filters: ctx.filters || {},
				data,
				original_data: data,
				columns,
				report,
				print_settings: { letter_head: this.letterhead, orientation: this.settings.orientation, include_filters: this.settings.include_filters },
				can_use_smaller_font: 1,
				// the values of the format's variables (ADR-024): {%= variables.show_details %}
				variables: this.variable_values(this.settings.template) || {},
				});
			}
		} catch (e) {
			this.note(__("The print format could not be rendered: {0}", [error_text(e)]), true);
			html = "";
		}
		// The format's own @page rules (paper and margins of a whole-document print) would
		// fight the pages' paper: the pages are the paper here.
		html = strip_scripts(html).replace(/@page\s*\{[^}]*\}/g, "");
		// the signature closes the format's flow, as it closes the standard template
		if (this.sig_in_tail()) html += this.signatures_html();
		// Flow the HTML at the width of the page body and measure its blocks: once for a format,
		// width, language and look. A change of the head, the foot, the signature in the foot or
		// the margins above and below keeps the blocks measured, only the room changes.
		this.custom_styles = "";
		const flow_key = `${box.inner_w}|${dir}|${this.settings.style}|${this.settings.font}|${html}`;
		const known = this.flow_cache?.key === flow_key ? this.flow_cache : null;
		// The pages carry the letter head as the standard template does: in full on the first
		// page, a slim line naming the report on the others (or the letter head on every page).
		this.probe.innerHTML =
			this.page_shell(1, box, dir, `<header class="rv-page-top rv-page-top-next">${this.custom_head(false, 2, 3)}</header>`) +
			this.page_shell(
				0,
				box,
				dir,
				`<header class="rv-page-top rv-page-top-first">${this.custom_head(true)}</header><div class="rv-page-flow">${known ? "" : html}</div><footer class="rv-page-foot">${this.foot_html(1, 1, this.letterhead, true)}</footer>`
			);
		await wait_images(this.probe);
		if (token !== this.token) return;
		const q = (sel) => this.probe.querySelector(sel);
		const h = (el) => (el ? el.getBoundingClientRect().height : 0);
		const first_h = h(q(".rv-page-top-first"));
		const next_h = h(q(".rv-page-top-next"));
		const foot_h = foot_height(q(".rv-page-foot"));
		const body_h = Math.max(40, box.inner_h - next_h - foot_h - SAFETY_PX);
		const first_body_h = Math.max(40, box.inner_h - first_h - foot_h - SAFETY_PX);
		if (this.sig_leaves_no_room(box.inner_h - next_h - foot_h - SAFETY_PX, box)) return this.layout_custom(token, box, dir);
		let units;
		let wide;
		// blocks measured before stand, unless one taller than the new room was kept whole
		if (known && !known.units.some((u) => u.h > body_h && u.node?.children?.length)) {
			({ units, wide } = known);
		} else {
			if (known) return this.layout_custom(token, box, dir, true);
			const flow = q(".rv-page-flow");
			wide = flow.scrollWidth > box.inner_w + 1 || [...flow.querySelectorAll("td, th")].some((c) => c.getBoundingClientRect().width < 1);
			units = this.flow_units(flow, body_h);
			// a block placed out of the flow (absolute, fixed) can stand beyond the flow's box:
			// the pages of such a format are checked element by element (fit_custom_pages)
			const loose = [...flow.querySelectorAll("*")].some((el) => /^(absolute|fixed)$/.test(getComputedStyle(el).position));
			this.flow_cache = { key: flow_key, units, wide, loose };
		}
		this.flow_loose = Boolean(this.flow_cache?.loose);
		if (wide) this.note(__("The print format is wider than the page: try landscape or a larger paper."), true);
		this.custom_styles = units.filter((u) => u.style).map((u) => u.node.outerHTML).join("");
		// the format's styles once, for the pages measured and the pages shown: a <style> in
		// every page would make the browser restyle the whole window for each of them
		this.set_format_css(this.custom_styles);
		this.custom_room = body_h;
		const pages = this.pack_units(units.filter((u) => !u.style), first_body_h, body_h);
		this.custom_pages = pages;
		this.pages = pages.map((p, i) => ({ start: 0, end: 0, first: i === 0, last: i === pages.length - 1 }));
		await this.fit_custom_pages(token, box, dir);
		if (token !== this.token) return;
		if (this.foot_overflow) this.note(__("The footer, the page number and the signature are taller than the room under the content: make them smaller or show them on fewer pages."), true);
		this.probe.replaceChildren();
		this.mount_pages(box, dir);
	}

	/**
	 * The blocks of a format packed into pages by their measured places: a page holds from
	 * its first block to its last (a page opening with a table's row repeats the table's
	 * head). A break of the format starts a page (`forced`) at the next block of content: the
	 * signature after the format's last page stays on that page.
	 */
	pack_units(units, first_room, room) {
		const pages = [];
		let page = { units: [], used: 0 };
		const cap = () => (pages.length ? room : first_room);
		let brk = false;
		for (const u of units) {
			if (u.brk) {
				brk = true;
				continue;
			}
			if (brk && !u.sig && page.units.length) {
				pages.push(page);
				page = { units: [], used: 0, forced: true };
			}
			if (!u.sig) brk = false;
			const height = (first) => u.bottom - first.top + (first.table ? first.table.head_h : 0);
			if (page.units.length && height(page.units[0]) > cap()) {
				pages.push(page);
				page = { units: [], used: 0 };
			}
			page.units.push(u);
			page.used = height(page.units[0]);
		}
		if (page.units.length || !pages.length) pages.push(page);
		return pages;
	}

	/**
	 * The pages of a format as they will be drawn, checked in the probe: a run of pages is
	 * drawn at once and the first page whose content reaches its foot is put right alone (its
	 * last blocks move on: the wrappers of a format, its paddings and margins, can take more
	 * than the measured blocks). What that page gave up tells how much the packing over-counts:
	 * the rest of its run is packed again with that much less room, so it is right at once.
	 */
	async fit_custom_pages(token, box, dir) {
		const pages = this.custom_pages;
		const sync = () => (this.pages = pages.map((p, i) => ({ start: 0, end: 0, first: i === 0, last: i === pages.length - 1 })));
		// the format's styles are in the stage once (set_format_css), for the probe too
		this.probe.innerHTML = "<div></div>";
		const holder = this.probe.lastElementChild;
		this.foot_overflow = false;
		const measure = (sheet) => {
			const foot = sheet.querySelector(".rv-page-foot").getBoundingClientRect();
			// a foot (footer, number, signature) beyond the paper: the content cannot push it
			// (the body clips), so moving rows would not help; the panel says so
			if (foot.bottom > sheet.getBoundingClientRect().bottom + 1) this.foot_overflow = true;
			// the content ends where the body ends (it clips), which is above the foot by the
			// margin of the foot's first part (a signature's space above it)
			const body = sheet.querySelector(".rv-page-body").getBoundingClientRect();
			const limit = Math.min(foot.top, body.bottom);
			const room = limit - body.top;
			// The flow clips what it holds (overflow:hidden): no element of it ends below its box
			// with what overflows it (scrollHeight). A page whose flow ends above the limit fits;
			// only the others, or a format with blocks out of the flow, are checked element by
			// element (thousands of boxes on a page of a long table).
			const flow = sheet.querySelector(".rv-page-body > .rv-page-flow");
			if (flow && !this.flow_loose) {
				const fr = flow.getBoundingClientRect();
				if (fr.top + Math.max(fr.height, flow.scrollHeight) <= limit) return { limit, over: false, room };
			}
			// the probe may stand above the window (the pages scrolled): places can be negative
			let bottom = -Infinity;
			for (const el of sheet.querySelectorAll(".rv-page-body *")) bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
			return { limit, over: bottom > limit + 1, room };
		};
		const limit = () => Math.min(pages.length, this.max_pages());
		let images = true;
		let from = 0;
		while (from < limit()) {
			if (token !== this.token) return;
			sync();
			const upto = Math.min(limit(), from + FIT_RUN);
			let html = "";
			for (let i = from; i < upto; i++) html += this.page_shell(i, box, dir, this.custom_page_html(i, true));
			holder.innerHTML = html;
			if (images) await wait_images(holder);
			images = false;
			await breathe();
			if (token !== this.token) return;
			let bad = -1;
			for (const [k, sheet] of [...holder.children].entries()) {
				if (measure(sheet).over && pages[from + k].units.length > 1) {
					bad = from + k;
					break;
				}
			}
			if (bad < 0) {
				from = upto;
				continue;
			}
			const moved = await this.fit_page(token, bad, box, dir, holder, measure);
			if (moved === null) return;
			// the rest of the run (to the next break of the format) packed with less room
			if (moved.length) {
				const cut = moved.at(-1).bottom - moved[0].top;
				let end = bad + 1;
				while (end < pages.length && !pages[end].forced) end += 1;
				const rest = pages.slice(bad + 1, end).flatMap((p) => p.units);
				const room = Math.max(40, this.custom_room - cut);
				const packed = this.pack_units(rest, room, room);
				if (pages[bad + 1]?.forced) packed[0].forced = true;
				pages.splice(bad + 1, end - bad - 1, ...packed);
			}
			from = bad + 1;
		}
		sync();
	}

	/** One page put right in the probe; the blocks it gave up, or null when superseded. */
	async fit_page(token, i, box, dir, holder, measure) {
		const pages = this.custom_pages;
		const start = pages[i].units.slice();
		let room = 0;
		for (let guard = 0; guard < FIT_GUARD; guard++) {
			this.pages = pages.map((p, k) => ({ start: 0, end: 0, first: k === 0, last: k === pages.length - 1 }));
			holder.innerHTML = this.page_shell(i, box, dir, this.custom_page_html(i, true));
			await breathe();
			if (token !== this.token) return null;
			const sheet = holder.firstElementChild;
			const m = measure(sheet);
			room = m.room;
			if (!m.over || pages[i].units.length <= 1) break;
			// the blocks that reach the foot (rows, a signature, a section) move on together;
			// else (a wrapper's padding or margin) the last block alone
			let from = pages[i].units.length - 1;
			for (const el of sheet.querySelectorAll("[data-rv-unit]")) {
				if (el.getBoundingClientRect().bottom > m.limit + 1) {
					from = Math.max(1, Math.min(from, Number(el.dataset.rvUnit)));
					break;
				}
			}
			if (!pages[i + 1] || pages[i + 1].forced) pages.splice(i + 1, 0, { units: [], used: 0 });
			pages[i + 1].units.unshift(...pages[i].units.splice(from));
		}
		// A page left with one short block although the packing gave it several: what
		// overflowed was not its content (a measure gone wrong), and moving on would put one
		// block on every page. The page keeps its blocks.
		const kept = pages[i].units;
		if (start.length > 1 && kept.length === 1 && (kept[0].h || 0) < room / 2) {
			pages[i + 1].units.splice(0, start.length - 1);
			if (!pages[i + 1].units.length) pages.splice(i + 1, 1);
			pages[i].units = start;
			return [];
		}
		return start.slice(kept.length);
	}

	/**
	 * What a report print format reads from query-report's context (print_grid.html and the
	 * standard financial formats): the columns as the datatable describes them, the rows as
	 * the report returned them (Frappe's total row last, `is_total_row`), and the parts of
	 * the query-report object the formats call. Labels come in the language of the pages.
	 */
	/**
	 * The report's columns as the view shows them, for the templates (a print format, a
	 * heading, a signature): in the view's order, each with `hidden` when the columns panel or
	 * the pages hide it. The report's own columns only (an enrichment's are not in its rows).
	 * Null without a report (a document's pages).
	 */
	view_columns() {
		if (!this.report?.columns) return null;
		const hidden = new Set([...(this.state?.columns?.hidden || []), ...(this.settings.hidden || [])]);
		const pos = new Map((this.state?.columns?.order || []).map((k, i) => [k, i]));
		return ordered_columns(this.report)
			.filter((c) => !c.enriched && c.fieldname)
			.map((c, i) => ({ c, i }))
			.sort((a, b) => (pos.get(a.c.key) ?? UNORDERED + a.i) - (pos.get(b.c.key) ?? UNORDERED + b.i))
			.map(({ c }) => ({ fieldname: c.fieldname, label: c.label, hidden: Boolean(c.hidden) || hidden.has(c.key) }));
	}

	query_report_facade() {
		const ctx = this.ctx;
		const source = this.lang_entry?.report || this.report;
		// The report's own columns (not the enrichment's), hidden as on screen: what
		// query-report's get_visible_columns gives a format.
		const hidden = new Set([...(this.state?.columns?.hidden || []), ...this.settings.hidden]);
		const columns = source.columns
			.filter((c) => !c.enriched)
			.map((c, i) => {
				const docfield = { ...(c.original || {}), fieldname: c.fieldname, fieldtype: c.fieldtype, label: c.label, options: c.original?.options };
				return {
					id: c.fieldname,
					name: c.label,
					label: c.label,
					fieldname: c.fieldname,
					fieldtype: c.fieldtype,
					options: docfield.options,
					width: c.width,
					hidden: Boolean(c.hidden) || hidden.has(c.key),
					_index: i,
					docfield,
				};
			});
		// in the view's order (the columns panel)
		const at = new Map((this.view_columns() || []).map((c, i) => [c.fieldname, i]));
		columns.sort((a, b) => (at.get(a.fieldname) ?? UNORDERED + a._index) - (at.get(b.fieldname) ?? UNORDERED + b._index));
		const data = source.rows.map((r, i) => ({ ...r, _index: i }));
		const total = source.report_totals?.frappe_total;
		if (total) data.push({ ...total, _index: data.length, is_total_row: true });
		const filters = ctx.filters || {};
		const report = {
			report_name: ctx.report_name,
			report_doc: { name: ctx.report_name },
			report_settings: ctx.report_settings,
			columns,
			data,
			raw_data: ctx.raw,
			get_filter_values: () => filters,
			get_filter_value: (key) => filters[key],
			get_visible_columns: () => columns.filter((c) => !c.hidden),
			get_columns_for_print: () => columns.filter((c) => !c.hidden),
			get_data_for_print: () => data,
			get_filters_html_for_print: () => this.filters_html(),
		};
		return { columns, data, report };
	}

	// Atomic blocks of a flow with their heights: a table by its rows (with the table and
	// its header kept to repeat them), a block taller than a page by its children.
	flow_units(container, body_h) {
		const units = [];
		// where a block stands in the flow, its top margin included: what a page holds is the
		// distance from its first block to its last, with every margin and gap between them
		const span = (el) => {
			const r = el.getBoundingClientRect();
			return { top: r.top - (parseFloat(getComputedStyle(el).marginTop) || 0), bottom: r.bottom };
		};
		// `path`: shallow copies of the elements between the flow and a block (a format styles
		// its table through a wrapper such as .report-table: the pages rebuild it)
		const walk = (el, path) => {
			for (const child of el.children) {
				const hh = child.getBoundingClientRect().height;
				if (child.tagName === "STYLE") {
					units.push({ node: child.cloneNode(true), h: 0, table: null, style: true, path });
					continue;
				}
				if (child.tagName === "SCRIPT") continue;
				// Frappe's .page-break: a page of the format (a wrapper of its blocks, or an empty
				// marker); what follows starts a new page
				if (child.classList?.contains("page-break")) {
					if (child.children.length) walk(child, [...path, child.cloneNode(false)]);
					units.push({ brk: true, h: 0, table: null, path });
					continue;
				}
				// the signature closes the content: it follows the last page of the format
				if (child.classList?.contains("rv-page-sig")) {
					units.push({ node: child.cloneNode(true), h: child.getBoundingClientRect().height + this.outer_margins(child), ...span(child), table: null, path, sig: true });
					continue;
				}
				if (child.tagName === "TABLE") {
					const head = child.tHead;
					const table = {
						shell: child.cloneNode(false),
						head: head ? head.cloneNode(true) : null,
						head_h: head ? head.getBoundingClientRect().height : 0,
						colgroups: [...child.querySelectorAll(":scope > colgroup")].map((c) => c.cloneNode(true)),
						path,
					};
					for (const body of child.tBodies) {
						const tbody = body.cloneNode(false);
						for (const tr of body.rows) units.push({ node: tr.cloneNode(true), h: tr.getBoundingClientRect().height, ...span(tr), table, tbody, path });
					}
					if (child.tFoot) {
						const tbody = child.tFoot.cloneNode(false);
						for (const tr of child.tFoot.rows) units.push({ node: tr.cloneNode(true), h: tr.getBoundingClientRect().height, ...span(tr), table, tbody, path });
					}
					continue;
				}
				if (hh > body_h && child.children.length) {
					walk(child, [...path, child.cloneNode(false)]);
					continue;
				}
				units.push({ node: child.cloneNode(true), h: hh, ...span(child), table: null, path });
			}
		};
		walk(container, []);
		return units;
	}

	/** The head of a page of a report print format: the letter head, or a slim line. */
	custom_head(first, n = 1, total = 1) {
		const lh = this.letterhead?.header;
		const heading = this.heading_html(n, total);
		if (lh && on_page(this.settings.lh_pages, n, total)) return `${this.top_number(n, total)}<div class="rv-page-lh fit-${this.settings.lh_fit}">${lh}</div>${heading}`;
		return first ? this.top_number(n, total) + heading : this.head_html(false, null, n, total);
	}

	/** @param {boolean} [mark] measuring: each block carries its place (data-rv-unit) */
	custom_page_html(i, mark = false) {
		const page = this.custom_pages[i];
		const n = this.pages.length;
		const flow = document.createElement("div");
		flow.className = "rv-page-flow";
		// the open wrappers (by the path they copy), then the open table and tbody
		let stack = [];
		let table = null;
		let tbody = null;
		let tbody_src = null;
		const parent_for = (path) => {
			let k = 0;
			while (k < stack.length && k < path.length && stack[k].src === path[k]) k += 1;
			stack = stack.slice(0, k);
			let parent = k ? stack[k - 1].el : flow;
			for (let j = k; j < path.length; j++) {
				const el = path[j].cloneNode(false);
				parent.appendChild(el);
				stack.push({ src: path[j], el });
				parent = el;
			}
			return parent;
		};
		for (const [k, u] of page.units.entries()) {
			const node = u.node.cloneNode(true);
			if (mark && node.nodeType === 1) node.setAttribute("data-rv-unit", k);
			const before = stack.length;
			const parent = parent_for(u.path);
			if (stack.length !== before || (table && table.parentNode !== parent)) table = null;
			if (u.table) {
				if (!table || table.__src !== u.table) {
					table = u.table.shell.cloneNode(false);
					table.__src = u.table;
					for (const c of u.table.colgroups) table.appendChild(c.cloneNode(true));
					if (u.table.head) table.appendChild(u.table.head.cloneNode(true));
					parent.appendChild(table);
					tbody = null;
				}
				if (!tbody || tbody_src !== u.tbody) {
					tbody = u.tbody.cloneNode(false);
					tbody_src = u.tbody;
					table.appendChild(tbody);
				}
				tbody.appendChild(node);
			} else {
				table = null;
				parent.appendChild(node);
			}
		}
		return `<header class="rv-page-top">${this.custom_head(i === 0, i + 1, n)}</header><div class="rv-page-body">${flow.outerHTML}</div><footer class="rv-page-foot">${this.foot_html(i + 1, n, this.letterhead)}</footer>`;
	}
}
