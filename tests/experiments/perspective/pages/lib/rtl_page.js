// Experiment 2: regular-table bound to a Perspective view of the Trial Balance fixture.
// Query: v=native|shim|shim2|reverse|flip  dir=rtl|ltr  lang=ar|en  split=0|1  pinend=0|1  theme=light|dark  rh=tree|path
import { load_perspective, params, NM } from "./load.js";
import { fetch_fixture, build_facts, MEASURES } from "./tb.js";
await import(`${NM}/regular-table/dist/esm/regular-table.js`);

const p = Object.assign({ v: "native", dir: "rtl", lang: "ar", split: "0", pinend: "0", theme: "light", rh: "tree" }, params());
const AR = p.lang === "ar";
document.documentElement.lang = p.lang;
document.body.classList.toggle("dark", p.theme === "dark");
document.getElementById("bar").textContent = `variant=${p.v} dir=${p.dir} lang=${p.lang} split=${p.split} pinend=${p.pinend} rh=${p.rh}`;

const BANDS = AR
	? { opening: "الرصيد الافتتاحي", period: "حركة الفترة", closing: "الرصيد الختامي", dr: "مدين", cr: "دائن", total: "الإجمالي", account: "الحساب", net: "الصافي" }
	: { opening: "Opening", period: "Period movement", closing: "Closing", dr: "Debit", cr: "Credit", total: "Total", account: "Account", net: "Net" };
const HEAD = {
	opening_debit: [BANDS.opening, BANDS.dr], opening_credit: [BANDS.opening, BANDS.cr],
	debit: [BANDS.period, BANDS.dr], credit: [BANDS.period, BANDS.cr],
	closing_debit: [BANDS.closing, BANDS.dr], closing_credit: [BANDS.closing, BANDS.cr],
};
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (v) => (v === null || v === undefined ? "" : v === 0 ? "—" : nf.format(v));

const wrap = document.getElementById("wrap");
const rt = document.getElementById("rt");
const logical_dir = p.dir;
// which CSS direction the <regular-table> element itself gets
if (p.v === "native" || p.v === "shim" || p.v === "shim2") wrap.dir = logical_dir;
else if (p.v === "reverse") wrap.dir = "ltr";
else if (p.v === "flip") { wrap.dir = "ltr"; wrap.classList.toggle("flip", logical_dir === "rtl"); }
const FLIP = p.v === "flip" && logical_dir === "rtl";
const REVERSE = p.v === "reverse" && logical_dir === "rtl";

if ((p.v === "shim" || p.v === "shim2") && logical_dir === "rtl") {
	// regular-table reads/writes this.scrollLeft assuming LTR (0..max). In RTL browsers report 0..-max.
	const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");
	Object.defineProperty(rt, "scrollLeft", {
		configurable: true,
		get() { return -desc.get.call(this); },
		set(v) { desc.set.call(this, -v); },
	});
}

if (p.v === "shim2" && logical_dir === "rtl") {
	// regular-table pins its table with `position: sticky; left: 0` (inline style on the shadow-DOM clip).
	// In an RTL scroller the clip starts at the right edge, so it needs the constraint on the right instead.
	const clip = rt.shadowRoot.querySelector(".rt-scroll-table-clip");
	clip.style.right = "0px";
	clip.style.removeProperty("left");
}

const { client } = await load_perspective({ mode: "esm" });
const fx = await fetch_fixture();
const { schema, data, level_names } = build_facts(fx.expected.rows);
const table = await client.table(schema);
await table.update(data);
const config = { group_by: [...level_names, "account"], columns: MEASURES, aggregates: Object.fromEntries(MEASURES.map((m) => [m, "sum"])) };
if (p.split === "1") config.split_by = ["account"];
const view = await table.view(config);
await view.set_depth(level_names.length + 1);
const all_paths = (await view.column_paths()).filter((c) => c !== "__ROW_PATH__");
const N = all_paths.length;
// REVERSE: the label becomes the LAST data column (it cannot be a row header: row headers always render at the inline start of an LTR table)
const NCOLS = REVERSE ? N + 1 : N;
const header_of = (path) => {
	const parts = path.split("|");
	const m = parts.pop();
	return [...parts, ...HEAD[m]];
};
const label_of = (path) => (path.length === 0 ? BANDS.total : path[path.length - 1] === null ? "(null)" : path[path.length - 1]);

let last = null;
rt.setDataListener(async (x0, y0, x1, y1) => {
	// logical column window -> view column window
	let vx0 = x0, vx1 = x1;
	if (REVERSE) {
		// visual col i (0 = leftmost) shows: i < N ? view col N-1-i : label
		vx0 = Math.max(0, N - Math.min(x1, N));
		vx1 = N - Math.min(x0, N);
	}
	const cols = await view.to_columns({ start_row: y0, end_row: y1, start_col: vx0, end_col: vx1 });
	const num_rows = await view.num_rows();
	const row_paths = cols.__ROW_PATH__ || [];
	let names = all_paths.slice(vx0, vx1);
	let columns = names.map((n) => cols[n] || []);
	let headers = names.map(header_of);
	let metadata = names.map((n, i) => columns[i].map((v, j) => ({ key: n.split("|").pop(), raw: v, depth: row_paths[j].length, leaf: row_paths[j].length === level_names.length + 1 })));
	let dataf = columns.map((c) => c.map(fmt));
	const resp = { num_rows, num_columns: NCOLS };
	if (REVERSE) {
		names = names.slice().reverse(); dataf.reverse(); headers.reverse(); metadata.reverse();
		if (x1 > N) {
			const depth = headers[0] ? headers[0].length : 2;
			dataf.push(row_paths.map(label_of));
			headers.push(Array.from({ length: depth }, () => BANDS.account));
			metadata.push(row_paths.map((rp) => ({ key: "__label", depth: rp.length, leaf: rp.length === level_names.length + 1 })));
		}
	} else if (p.rh === "path") {
		resp.row_headers = row_paths.map((rp) => Array.from({ length: level_names.length + 1 }, (_, i) => (i < rp.length ? (rp[i] === null ? "(null)" : rp[i]) : "")));
	} else {
		resp.row_headers = row_paths.map((rp) => [label_of(rp)]);
	}
	resp.data = dataf;
	resp.column_headers = headers;
	resp.metadata = metadata;
	last = { x0, y0, x1, y1, row_paths, pin: null };
	if (p.pinend === "1") {
		// pinned-at-end column: computed by the engine (expression), fetched for the same row window from a second view
		const pc = await pin_view.to_columns({ start_row: y0, end_row: y1 });
		last.pin = pc.net_closing;
	}
	return resp;
});

let pin_view = null;
let pin_el = null;
if (p.pinend === "1") {
	pin_view = await table.view({
		group_by: config.group_by,
		columns: ["net_closing"],
		expressions: { net_closing: '"closing_debit" - "closing_credit"' },
		aggregates: { net_closing: "sum" },
	});
	await pin_view.set_depth(level_names.length + 1);
	pin_el = document.createElement("div");
	pin_el.id = "pinend";
	wrap.appendChild(pin_el);
}

rt.addStyleListener(() => {
	const depth_max = level_names.length + 1;
	for (const td of rt.querySelectorAll("tbody td")) {
		const meta = rt.getMeta(td);
		const u = meta && meta.user;
		if (!u) continue;
		if (FLIP && !td.firstElementChild) wrap_cell(td);
		td.classList.toggle("dr", /debit$/.test(u.key) && !!u.raw);
		td.classList.toggle("cr", /credit$/.test(u.key) && !!u.raw);
		td.classList.toggle("zero", u.raw === 0);
		for (let d = 0; d < 3; d++) td.classList.toggle(`grp-${d}`, !u.leaf && u.depth === d);
		if (u.key === "__label") { td.style.direction = "rtl"; td.style.textAlign = "start"; td.style.paddingInlineStart = `${10 + u.depth * 16}px`; }
		else { td.style.removeProperty("direction"); td.style.removeProperty("text-align"); td.style.removeProperty("padding-inline-start"); }
	}
	for (const th of rt.querySelectorAll("tbody th")) {
		const meta = rt.getMeta(th);
		if (!meta) continue;
		const rp = last && last.row_paths[meta.y - last.y0];
		const depth = rp ? rp.length : 0;
		const leaf = depth === depth_max;
		for (let d = 0; d < 3; d++) th.classList.toggle(`grp-${d}`, !leaf && depth === d);
		if (FLIP && !th.firstElementChild) wrap_cell(th);
		if (p.rh === "tree") {
			const target = FLIP ? th.firstElementChild : th;
			if (FLIP) target.style.direction = "rtl";
			target.style.paddingInlineStart = `${depth * 16}px`;
		}
	}
	if (FLIP) for (const th of rt.querySelectorAll("thead th")) { if (!th.firstElementChild || !th.firstElementChild.classList.contains("cell")) wrap_cell(th); th.firstElementChild.style.direction = "rtl"; }
	if (pin_el && last && last.pin) sync_pin();
});

function wrap_cell(cell) {
	// regular-table writes textContent on every draw, so the wrapper has to be re-created each time
	const span = document.createElement("span");
	span.className = "cell";
	span.textContent = cell.textContent;
	cell.textContent = "";
	cell.appendChild(span);
}

function sync_pin() {
	const base = wrap.getBoundingClientRect();
	pin_el.textContent = "";
	const head = rt.querySelector("thead");
	if (head) {
		const hb = head.getBoundingClientRect();
		const h = document.createElement("div");
		h.className = "c h";
		h.style.top = `${hb.top - base.top}px`;
		h.style.height = `${hb.height}px`;
		h.style.lineHeight = `${hb.height}px`;
		h.textContent = BANDS.net;
		pin_el.appendChild(h);
	}
	const trs = rt.querySelectorAll("tbody tr");
	trs.forEach((tr, i) => {
		const b = tr.getBoundingClientRect();
		if (b.bottom > base.bottom || last.pin[i] === undefined) return;
		const c = document.createElement("div");
		c.className = "c";
		c.style.top = `${b.top - base.top}px`;
		c.textContent = fmt(last.pin[i]);
		pin_el.appendChild(c);
	});
}

await rt.draw();
if (REVERSE) { rt.scrollLeft = rt.scrollWidth; await rt.draw(); }

// --- probes used by the Playwright driver ---
window.__rt = rt;
window.__probe = () => {
	const base = wrap.getBoundingClientRect();
	const rh = rt.querySelector("tbody th");
	const rhb = rh ? rh.getBoundingClientRect() : null;
	const head_cells = [...rt.querySelectorAll("thead tr:last-child th")].map((th) => ({ t: th.textContent, l: Math.round(th.getBoundingClientRect().left - base.left), w: Math.round(th.getBoundingClientRect().width) })).filter((c) => c.w > 0);
	const band_cells = [...rt.querySelectorAll("thead tr:first-child th")].map((th) => ({ t: th.textContent, l: Math.round(th.getBoundingClientRect().left - base.left), w: Math.round(th.getBoundingClientRect().width), colspan: th.colSpan })).filter((c) => c.w > 0);
	const first_td = rt.querySelector("tbody td");
	const metas = [...rt.querySelectorAll("tbody tr:first-child td")].map((td) => rt.getMeta(td)).filter(Boolean);
	return {
		wrap_w: Math.round(base.width),
		native_scrollLeft: Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft").get.call(rt),
		scrollLeft: rt.scrollLeft, scrollTop: rt.scrollTop, scrollWidth: rt.scrollWidth, clientWidth: rt.clientWidth,
		row_header: rhb ? { left: Math.round(rhb.left - base.left), right: Math.round(base.right - rhb.right), width: Math.round(rhb.width), text: rh.textContent } : null,
		first_row_x: metas.map((m) => m.x), window: last && [last.x0, last.x1, last.y0, last.y1],
		first_body_row_label: rt.querySelector("tbody tr th") ? rt.querySelector("tbody tr th").textContent : null,
		head_cells: head_cells.slice(0, 14), band_cells: band_cells.slice(0, 8),
		first_td_text: first_td ? first_td.textContent : null,
	};
};
window.__scroll = async (fx, fy) => {
	// fx, fy in 0..1 of the logical scroll range (0 = start: right edge in RTL).
	// regular-table estimates the width of columns it has not rendered yet, so the scroll range grows while
	// scrolling; repeat until the position is stable (a user simply keeps scrolling).
	const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");
	let passes = 0;
	for (let prev = null; passes < 8; passes++) {
		const max_x = rt.scrollWidth - rt.clientWidth;
		const max_y = rt.scrollHeight - rt.clientHeight;
		let x = fx * max_x;
		if (REVERSE) x = (1 - fx) * max_x; // start is the right edge of an LTR scroller
		else if ((p.v === "native" || p.v === "shim" || p.v === "shim2") && logical_dir === "rtl") x = -fx * max_x; // native RTL scroll offset is negative
		desc.set.call(rt, x);
		rt.scrollTop = fy * max_y;
		await new Promise((r) => setTimeout(r, 200));
		await rt.draw();
		await new Promise((r) => setTimeout(r, 80));
		if (prev === max_x) break;
		prev = max_x;
	}
	const out = window.__probe();
	out.scroll_passes = passes;
	out.last_column_visible = [...rt.querySelectorAll("tbody tr:first-child td")].some((td) => { const m = rt.getMeta(td); return m && m.x === NCOLS - 1 && td.getBoundingClientRect().width > 0; });
	return out;
};
window.__cleanup = async () => {
	if (pin_view) await pin_view.delete();
	await view.delete();
	await table.delete();
};
window.__result = { ok: true, num_columns: NCOLS, probe: window.__probe() };
