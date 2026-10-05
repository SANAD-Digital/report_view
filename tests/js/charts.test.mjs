// Charts dashboard: the cards, slicers and cross-filter of a view state (state/dashboard_state.js,
// engine/chart_config.js), the ECharts option of a card (views/chart_option.js), and, in the
// Perspective engine for node, the numbers of every card against the grid's for the same
// filters and the handle lifecycle of card views.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import perspective from "@finos/perspective";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { default_state, sanitize } from "../../report_view/public/js/report_view/state/view_state.js";
import { build_search } from "../../report_view/public/js/report_view/state/url.js";
import { sanitize_dashboard, new_card_id, LIMIT_CARDS } from "../../report_view/public/js/report_view/state/dashboard_state.js";
import { EngineHandles, ReportSession } from "../../report_view/public/js/report_view/engine/perspective_engine.js";
import {
	CARD_LIMITS,
	MAX_SERIES,
	PCT_PREFIX,
	chart_dimensions,
	chart_measures,
	slicer_dimensions,
	default_cards,
	resolve_dashboard,
	dashboard_terms,
	to_card_config,
	card_sort,
	card_limit,
	date_text,
	level_of,
} from "../../report_view/public/js/report_view/engine/chart_config.js";
import { chart_option } from "../../report_view/public/js/report_view/views/chart_option.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);
const state = (patch = {}) => ({ ...default_state(), ...patch });
const card = (patch) => ({ id: "c1", type: "bar", x: null, series: [], agg: null, sort: null, top: null, size: "half", title: null, filter: [], ...patch });
const TB_CARD = card({ x: "level_1", series: ["closing_debit", "closing_credit"] });
const TOLERANCE = 0.005;
const handles = new EngineHandles(perspective);

after(async () => {
	await handles.delete_all();
});

function close(actual, expected, label) {
	assert.ok(Math.abs((actual ?? 0) - (expected ?? 0)) < TOLERANCE, `${label}: ${actual} != ${expected}`);
}

async function with_session(report, fn) {
	const session = await ReportSession.create(handles, report, { locale: "ar" });
	try {
		return await fn(session);
	} finally {
		await session.close();
	}
}

// A trial balance with the root type of every account, as the enrichment adds it on the site.
function tb_with_root_type() {
	const tb = load("trial_balance_fy2026");
	const ROOT = { 1: "Asset", 2: "Liability", 3: "Equity", 4: "Income", 5: "Expense" };
	tb.columns.push({ key: "account__root_type", fieldname: "account__root_type", label: "Root Type", fieldtype: "Select", role: "dimension", enriched: { source: "account" }, original: {} });
	for (const r of tb.rows) r.account__root_type = r.account ? ROOT[String(r.account)[0]] || null : null;
	return tb;
}

// ------------------------------------------------------------------ dimensions, measures, state

test("chart dimensions and measures: tree levels first, report columns; numeric measures only; slicer kinds", () => {
	const tb = load("trial_balance_fy2026");
	assert.deepEqual(
		chart_dimensions(tb).map((d) => d.key),
		["level_1", "level_2", "level_3", "account"]
	);
	assert.deepEqual(chart_measures(tb, state()), ["opening_debit", "opening_credit", "debit", "credit", "closing_debit", "closing_credit"]);
	const ar = load("accounts_receivable_frappe_total");
	const dims = chart_dimensions(ar).map((d) => d.key);
	assert.ok(dims.includes("party") && dims.includes("posting_date") && !dims.includes("invoiced"));
	assert.ok(chart_measures(ar, state()).every((k) => ar.columns.find((c) => c.key === k).role === "measure"));
	const kinds = Object.fromEntries(slicer_dimensions(ar).map((d) => [d.key, d.kind]));
	assert.equal(kinds.posting_date, "date");
	assert.equal(kinds.party, "set");
	assert.equal(level_of("level_3"), 3);
	assert.equal(level_of("account"), null);
	assert.equal(date_text(Date.UTC(2026, 1, 3)), "2026-02-03");
});

test("dashboard state: sanitized (types, limits, unique ids, values), cross-filter only on a card that exists", () => {
	assert.equal(sanitize_dashboard(null), null);
	assert.equal(sanitize_dashboard({ cards: "x" }), null);
	const d = sanitize_dashboard({
		cards: [
			{ id: "a", type: "radar", x: 3, series: ["p", "p", 4, "q"], agg: "median", sort: "up", top: 7, size: "huge", title: "  T  ", filter: [{ key: "k", values: ["v", {}, null] }, { key: 1 }] },
			{ id: "a", type: "donut", x: "party", series: ["paid"], top: 10, size: "full" },
			{ id: "bad id!", type: "kpi" },
			null,
		],
		slicers: [{ key: "party", type: "set", values: ["x", { o: 1 }] }, { key: "party", type: "set" }, { key: "d", type: "date", from: "2026-01-01", to: "nope" }, { type: "set" }],
		cross: { card: "a", key: "party", value: "x" },
	});
	assert.deepEqual(d.cards[0], { id: "a", type: "bar", x: null, series: ["p", "q"], agg: null, sort: null, top: null, size: "half", title: "T", filter: [{ key: "k", values: ["v", null] }] });
	assert.equal(d.cards.length, 3);
	assert.notEqual(d.cards[1].id, "a");
	assert.deepEqual([d.cards[1].type, d.cards[1].top, d.cards[1].size], ["donut", 10, "full"]);
	assert.equal(new Set(d.cards.map((c) => c.id)).size, 3);
	assert.deepEqual(d.slicers, [
		{ key: "party", type: "set", values: ["x"] },
		{ key: "d", type: "date", from: "2026-01-01", to: null },
	]);
	assert.deepEqual(d.cross, { card: "a", key: "party", value: "x" });
	assert.equal(sanitize_dashboard({ cards: [{ id: "a" }], cross: { card: "zz", key: "k", value: 1 } }).cross, null);
	assert.equal(sanitize_dashboard({ cards: Array.from({ length: 40 }, () => ({})) }).cards.length, LIMIT_CARDS);
	assert.equal(new_card_id([{ id: "c1" }, { id: "c3" }]), "c4");
});

test("view state: charts sanitized and the dashboard makes the view a non-default one in the URL", () => {
	const s = sanitize({ v: 1, charts: { cards: [{ id: "x", type: "donut", x: "party", series: ["paid"] }], slicers: [] } });
	assert.equal(s.charts.cards[0].type, "donut");
	assert.equal(sanitize({ v: 1, charts: { nope: 1 } }).charts, null);
	assert.equal(default_state().charts, null);
	assert.equal(build_search({}, default_state(), "/desk/report-view/X", default_state()).search, "");
	assert.match(build_search({}, s, "/desk/report-view/X", default_state()).search, /rv=/);
});

// ------------------------------------------------------------------ default dashboard

const TB_REGISTER = {
	charts: {
		cards: [
			{ id: "closing", type: "bar", x: "level_1", series: ["closing_debit", "closing_credit"], title: "Closing" },
			{ id: "expenses", type: "donut", x: "account", series: ["closing_debit"], filter: [{ key: "account__root_type", values: ["Expense"] }] },
			{ id: "moving", type: "hstacked", x: "account", series: ["debit", "credit"], top: 10, size: "full" },
		],
	},
};

test("default cards: register.charts (a card whose filter column is missing is left out), else from the first dimensions", () => {
	const tb = tb_with_root_type();
	const own = default_cards(tb, state(), TB_REGISTER, "account");
	assert.deepEqual(own.map((c) => [c.id, c.type, c.x, c.series.join()]), [
		["closing", "bar", "level_1", "closing_debit,closing_credit"],
		["expenses", "donut", "account", "closing_debit"],
		["moving", "hstacked", "account", "debit,credit"],
	]);
	// without the enrichment column: the expenses card cannot say what it says
	assert.deepEqual(default_cards(load("trial_balance_fy2026"), state(), TB_REGISTER, "account").map((c) => c.id), ["closing", "moving"]);
	// no register: the tree's levels and accounts
	assert.deepEqual(default_cards(load("trial_balance_fy2026"), state(), {}, "account").map((c) => [c.type, c.x]), [
		["bar", "level_1"],
		["donut", "level_2"],
		["hstacked", "account"],
	]);
	// a flat report: a linked dimension, another text dimension, the dates
	const gl = default_cards(load("general_ledger_consolidated"), state(), {}, "posting_date");
	assert.deepEqual(gl.map((c) => [c.type, c.x]), [
		["hbar", "account"],
		["donut", "voucher_type"],
		["area", "posting_date"],
	]);
	assert.deepEqual(gl[0].series, ["debit", "credit"]);
	assert.equal(gl[0].top, 10);
	// x: null in a register card: the measures side by side
	const ar = default_cards(load("accounts_receivable_frappe_total"), state(), { charts: { cards: [{ id: "a", type: "bar", x: null, series: ["range1", "range2", "nope"] }] } });
	assert.deepEqual([ar[0].x, ar[0].series], [null, ["range1", "range2"]]);
});

test("resolve_dashboard: the user's dashboard made valid for the report; else the default", () => {
	const ar = load("accounts_receivable_frappe_total");
	const base = resolve_dashboard(state(), ar, {}, "posting_date");
	assert.equal(base.own, false);
	assert.ok(base.cards.length > 0);
	const s = state({
		charts: {
			cards: [
				{ id: "a", type: "line", x: "nope", series: ["nope"] },
				{ id: "b", type: "kpi", x: "party", series: ["paid", "outstanding"] },
			],
			slicers: [
				{ key: "party", type: "set", values: ["x"] },
				{ key: "posting_date", type: "set", values: ["x"] },
				{ key: "posting_date", type: "date", from: "2026-01-01" },
				{ key: "nope", type: "set", values: null },
			],
			cross: { card: "a", key: "nope", value: "x" },
		},
	});
	const d = resolve_dashboard(s, ar, {}, "posting_date");
	assert.equal(d.own, true);
	assert.equal(d.cards[0].x, "posting_date");
	assert.deepEqual(d.cards[0].series, ["invoiced", "paid"]);
	assert.equal(d.cards[1].x, null);
	assert.deepEqual(d.slicers.map((x) => x.key), ["party"]);
	assert.equal(d.cross, null);
});

// ------------------------------------------------------------------ filters of the dashboard

test("dashboard filters: set and date slicers, the card's own filter, the cross-filter of another card", () => {
	const ar = load("accounts_receivable_frappe_total");
	const dash = {
		slicers: [
			{ key: "party", type: "set", values: ["A", "B"] },
			{ key: "voucher_type", type: "set", values: null },
			{ key: "posting_date", type: "date", from: "2026-01-01", to: "2026-03-31" },
			{ key: "party_type", type: "set", values: [null] },
		],
		cross: { card: "src", key: "posting_date", value: "2026-02-01" },
	};
	const other = card({ id: "other", filter: [{ key: "voucher_type", values: ["Sales Invoice"] }] });
	assert.deepEqual(dashboard_terms(dash, other, ar), [
		["party", "in", ["A", "B"]],
		["posting_date", ">=", "2026-01-01"],
		["posting_date", "<=", "2026-03-31"],
		["party_type", "is null", null],
		["voucher_type", "in", ["Sales Invoice"]],
		["posting_date", "==", "2026-02-01"],
	]);
	// the card that was clicked keeps all its categories
	assert.equal(dashboard_terms(dash, card({ id: "src" }), ar).length, 4);
	// a tree level and a null category
	const tb = load("trial_balance_fy2026");
	assert.deepEqual(dashboard_terms({ slicers: [{ key: "level_1", type: "set", values: ["X"] }], cross: { card: "a", key: "level_2", value: null } }, card({ id: "b" }), tb), [
		["level_1", "in", ["X"]],
		["level_2", "is null", null],
	]);
	// "nothing selected" filters everything out (as the grid's set filter)
	assert.deepEqual(dashboard_terms({ slicers: [{ key: "party", type: "set", values: [] }] }, card({}), ar), [["party", "in", []]]);
});

// ------------------------------------------------------------------ view config of a card

test("card config: a tree level with no filter reads the report's rows of that depth, each its own group", () => {
	const tb = load("trial_balance_fy2026");
	const spec = to_card_config(state(), tb, TB_CARD, { categories: 4 });
	assert.equal(spec.route, "nodes");
	assert.deepEqual(spec.config.group_by, ["__path"]);
	assert.deepEqual(spec.config.filter, [["__depth", "==", 0]]);
	assert.deepEqual(spec.config.sort, [["__rid", "asc"]]);
	assert.equal(spec.config.aggregates.account, "unique");
	assert.equal(spec.post.label_key, "account");
	// a slicer, a quick filter or a cross-filter of another card: the facts grouped by the level
	const sliced = to_card_config(state(), tb, TB_CARD, { dashboard: { slicers: [{ key: "level_2", type: "set", values: ["x"] }] } });
	assert.equal(sliced.route, "facts");
	assert.deepEqual(sliced.config.group_by, ["level_1"]);
	assert.deepEqual(sliced.config.filter, [["level_2", "in", ["x"]]]);
	// an aggregate of the user's: the facts
	assert.equal(to_card_config(state(), tb, { ...TB_CARD, agg: "avg" }).config.aggregates.closing_debit, "avg");
});

test("card config: order and Top N by the engine (sort + rows read), label order by the language's sort keys", () => {
	const ar = load("accounts_receivable_frappe_total");
	const bar = card({ x: "party", series: ["paid", "invoiced"] });
	assert.equal(card_sort(bar), "label");
	assert.equal(card_sort({ ...bar, top: 10 }), "desc");
	assert.equal(card_sort({ ...bar, type: "donut" }), "desc");
	assert.equal(card_limit({ ...bar, top: 10 }), 10);
	assert.equal(card_limit({ ...bar, type: "donut", top: 20 }), CARD_LIMITS.donut);
	assert.equal(card_limit(bar), CARD_LIMITS.bar);
	assert.deepEqual(to_card_config(state(), ar, bar).config.sort, [["__sort__party", "asc"], ["__rid", "asc"]]);
	const top = to_card_config(state(), ar, { ...bar, top: 5 }, { categories: 9 });
	assert.deepEqual(top.config.sort, [["paid", "desc"], ["__rid", "asc"]]);
	assert.deepEqual([top.post.limit, top.post.top, top.post.categories], [5, true, 9]);
	assert.equal(to_card_config(state(), ar, { ...bar, top: 5 }, { categories: 5 }).post.top, false);
	assert.deepEqual(to_card_config(state(), ar, { ...bar, sort: "asc" }).config.sort[0], ["paid", "asc"]);
	// stacked measures that add up: ordered by their sum, an engine expression
	const stacked = to_card_config(state(), ar, { ...bar, type: "hstacked" });
	assert.deepEqual(stacked.config.sort[0], ["__sumsort__", "desc"]);
	assert.equal(stacked.config.expressions.__sumsort__, '"paid" + "invoiced"');
	// dates in time: a copy of the date column, its lowest value per category
	const dates = to_card_config(state(), ar, card({ type: "area", x: "posting_date", series: ["paid"] }));
	assert.deepEqual(dates.config.sort[0], ["__lblsort__", "asc"]);
	assert.equal(dates.config.aggregates.__lblsort__, "min");
	// every sort column is a view column (Perspective mis-windows hidden sort columns)
	for (const spec of [top, stacked, dates]) for (const [k] of spec.config.sort) assert.ok(spec.config.columns.includes(k), k);
});

test("card config: a donut's shares, a number card and the measures side by side", () => {
	const gl = load("general_ledger_consolidated");
	const donut = to_card_config(state(), gl, card({ type: "donut", x: "voucher_type", series: ["debit"] }));
	assert.equal(donut.config.aggregates[PCT_PREFIX + "debit"], "pct sum grand total");
	assert.equal(donut.config.expressions[PCT_PREFIX + "debit"], '"debit"');
	const kpi = to_card_config(state(), gl, card({ type: "kpi", series: ["debit", "credit"] }));
	assert.equal(kpi.route, "totals");
	assert.deepEqual(kpi.config.group_by, ["__kind"]);
	assert.equal(kpi.count, null);
	const tb = load("trial_balance_fy2026");
	const side = to_card_config(state(), tb, card({ x: null, series: ["debit", "credit"] }));
	assert.equal(side.table, "nodes");
	assert.deepEqual(side.config.filter, [["__top", "==", true]]);
	assert.equal(MAX_SERIES, 7);
});

// ------------------------------------------------------------------ ECharts option

const THEME = {
	text: "t1",
	text_2: "t2",
	text_3: "t3",
	line: "l1",
	line_2: "l2",
	line_3: "l3",
	surface: "s",
	hover: "h",
	font: "F",
	font_size: 12,
};
const opt = (patch) =>
	chart_option({
		type: "bar",
		rtl: false,
		labels: ["A", "<B>"],
		series: [
			{ key: "d", name: "Debit", color: "c1", values: [1, 2] },
			{ key: "c", name: "Credit", color: "c2", values: [3, null] },
		],
		palette: ["p1", "p2"],
		theme: THEME,
		axis_text: (v) => `ax${v}`,
		value_text: (k, i) => `${k}:${i}`,
		esc: (s) => String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;"),
		width: 800,
		...patch,
	});

test("chart option: values and colours as given; RTL mirrors the axes, not the data", () => {
	const ltr = opt();
	assert.deepEqual(ltr.series.map((s) => s.data), [[1, 2], [3, null]]);
	assert.deepEqual(ltr.series.map((s) => s.itemStyle.color), ["c1", "c2"]);
	assert.equal(ltr.xAxis.inverse, false);
	assert.equal(ltr.yAxis.position, "left");
	assert.equal(ltr.yAxis.axisLabel.formatter(5), "ax5");
	assert.equal(ltr.textStyle.fontFamily, "F");
	const rtl = opt({ rtl: true });
	assert.equal(rtl.xAxis.inverse, true);
	assert.equal(rtl.yAxis.position, "right");
	assert.deepEqual(rtl.xAxis.data, ["A", "<B>"]);
	assert.equal(opt({ type: "stacked" }).series[0].stack, "total");
	assert.equal(opt({ type: "line" }).series[1].type, "line");
});

test("chart option: horizontal bars and donut", () => {
	const h = opt({ type: "hbar", rtl: true });
	assert.equal(h.yAxis.type, "category");
	assert.equal(h.yAxis.inverse, true);
	assert.equal(h.yAxis.position, "right");
	assert.equal(h.xAxis.inverse, true);
	const d = opt({ type: "donut" });
	assert.equal(d.series.length, 1);
	assert.equal(d.series[0].type, "pie");
	assert.deepEqual(d.series[0].data, [
		{ name: "A", value: 1, itemStyle: { color: "p1", opacity: 1 } },
		{ name: "<B>", value: 2, itemStyle: { color: "p2", opacity: 1 } },
	]);
});

test("chart option: tooltips show the formatted values, escaped", () => {
	const html = opt().tooltip.formatter([
		{ dataIndex: 1, seriesIndex: 0 },
		{ dataIndex: 1, seriesIndex: 1 },
	]);
	assert.match(html, /&lt;B&gt;/);
	assert.match(html, /d:1/);
	assert.match(html, /c:1/);
	assert.doesNotMatch(html, /<B>/);
	const pie = opt({ type: "donut" }).tooltip.formatter({ dataIndex: 0, seriesIndex: 0, percent: 25 });
	assert.match(pie, /d:0/);
	assert.match(pie, /25%/);
	assert.match(opt({ rtl: true }).tooltip.extraCssText, /direction:rtl/);
});

test("chart option: few labels that fit are whole, many or narrow ones turn", () => {
	assert.equal(opt().xAxis.axisLabel.overflow, "break");
	assert.equal(opt().xAxis.axisLabel.rotate, 0);
	const narrow = opt({ width: 100 });
	assert.equal(narrow.xAxis.axisLabel.overflow, "truncate");
	assert.equal(narrow.xAxis.axisLabel.rotate, 90);
	assert.equal(narrow.xAxis.axisLabel.interval, 0);
	// no room for a line per label: ECharts leaves out those that would overlap
	const crowded = opt({ width: 20 });
	assert.equal(crowded.xAxis.axisLabel.interval, "auto");
	assert.equal(crowded.xAxis.axisLabel.hideOverlap, true);
});

test("chart option: area, stacked horizontal bars and the category of a cross-filter dimmed", () => {
	const area = opt({ type: "area" });
	assert.equal(area.series[0].type, "line");
	assert.ok(area.series[0].areaStyle);
	const hs = opt({ type: "hstacked", label_width: 120 });
	assert.equal(hs.series[0].stack, "total");
	assert.equal(hs.yAxis.axisLabel.width, 120);
	const sel = opt({ selected: 1 });
	assert.deepEqual(sel.series[0].data, [{ value: 1, itemStyle: { opacity: 0.3 } }, 2]);
	assert.equal(opt({ type: "donut", selected: 0 }).series[0].data[1].itemStyle.opacity, 0.3);
});

// ------------------------------------------------------------------ engine

// The rows of a grouped grid view by their first-level path: {name: {measure: value}}.
async function grid_groups(session, s, keys) {
	const opened = await session.open(s);
	try {
		const cols = await opened.view.to_columns();
		const out = new Map();
		cols.__ROW_PATH__.forEach((p, i) => {
			if (p.length === 1) out.set(p[0], Object.fromEntries(keys.map((k) => [k, cols[k][i]])));
		});
		return { groups: out, totals: opened.totals.values };
	} finally {
		await session.close_view(opened);
	}
}

test("trial balance: top-level groups = the grid's top rows of the tree (the report's values)", async () => {
	const tb = load("trial_balance_fy2026");
	await with_session(tb, async (session) => {
		const { spec, data } = await session.read_card(state(), TB_CARD, { slicers: [], cross: null });
		assert.equal(spec.post.route, "nodes");
		const grid = await session.open(state());
		const cols = await grid.view.to_columns();
		const top = cols.__rid.map((rid, i) => [rid, i]).filter(([, i]) => cols.__depth[i] === 0);
		assert.deepEqual(data.rids, top.map(([rid]) => rid));
		for (const key of TB_CARD.series) {
			top.forEach(([rid, i], at) => close(data.series[key][at], cols[key][i], `${rid} ${key}`));
			// the top rows add up to the grand total shown, and to the card's own total
			close(data.series[key].reduce((a, v) => a + v, 0), grid.totals.values[key], `total ${key}`);
			close(data.total[key].value, grid.totals.values[key], `card total ${key}`);
		}
		await session.close_view(grid);
		// nothing of the card stays open
		assert.equal(handles.debug_handles().filter((h) => h.kind === "view").length, 0);
	});
	assert.deepEqual(handles.debug_handles(), []);
});

test("trial balance: a slicer gives the numbers of the grid under the same filter (levels re-grouped)", async () => {
	const tb = tb_with_root_type();
	const dash = { slicers: [{ key: "account__root_type", type: "set", values: ["Asset", "Expense"] }], cross: null };
	await with_session(tb, async (session) => {
		const { spec, data } = await session.read_card(state(), TB_CARD, dash);
		assert.equal(spec.post.route, "facts");
		const grid_state = state({ filters: [{ key: "account__root_type", type: "set", values: ["Asset", "Expense"], exclude: false }] });
		const { groups, totals } = await grid_groups(session, grid_state, TB_CARD.series);
		assert.deepEqual(data.categories, [...groups.keys()]);
		data.categories.forEach((name, i) => {
			for (const key of TB_CARD.series) close(data.series[key][i], groups.get(name)[key], `${name} ${key}`);
		});
		for (const key of TB_CARD.series) close(data.total[key].value, totals[key], `total ${key}`);
		// the expenses donut: the expense accounts, their shares from the engine
		const donut = card({ id: "e", type: "donut", x: "account", series: ["closing_debit"], filter: [{ key: "account__root_type", values: ["Expense"] }] });
		const d = await session.read_card(state(), donut, { slicers: [], cross: null });
		assert.ok(d.data.categories.length > 0 && d.data.categories.every((a) => String(a).startsWith("5")));
		const pct = d.data.pct.closing_debit;
		d.data.series.closing_debit.forEach((v, i) => close(pct[i], (v / d.data.total.closing_debit.value) * 100, `share ${i}`));
	});
	assert.deepEqual(handles.debug_handles(), []);
});

for (const [fixture, x, series] of [
	["accounts_receivable_frappe_total", "party", ["invoiced", "paid", "outstanding"]],
	["general_ledger_consolidated", "account", ["debit", "credit"]],
]) {
	test(`${fixture}: every card type by ${x} = the grid grouped by ${x}; total = the grid's grand total`, async () => {
		const report = load(fixture);
		for (const type of ["bar", "stacked", "hbar", "hstacked", "line", "area", "donut"]) {
			await with_session(report, async (session) => {
				const s = state();
				const def = card({ type, x, series });
				const { data } = await session.read_card(s, def, { slicers: [], cross: null });
				const { groups } = await grid_groups(session, state({ group: { by: [x], subtotals: true, expanded: "all" } }), series);
				const shown = await session.open(s);
				assert.equal(data.categories.length, Math.min(groups.size, CARD_LIMITS[type]));
				data.categories.forEach((name, i) => {
					for (const key of series) close(data.series[key][i], groups.get(name)[key], `${type} ${name} ${key}`);
				});
				for (const key of series) close(data.total[key].value, shown.expected.totals[key], `${type} total ${key}`);
				if (card_sort(def) === "desc" && !type.includes("stacked")) {
					const first = data.series[series[0]];
					assert.ok(first.every((v, i) => i === 0 || first[i - 1] >= v), `${type}: largest first`);
				}
				await session.close_view(shown);
			});
		}
		assert.deepEqual(handles.debug_handles(), []);
	});
}

test("receivables: Top 3 parties by outstanding, the measures side by side and a number card = the grid's totals", async () => {
	const ar = load("accounts_receivable_frappe_total");
	await with_session(ar, async (session) => {
		const s = state();
		const top = await session.read_card(s, card({ type: "hbar", x: "party", series: ["outstanding"], top: 3 }), { slicers: [], cross: null });
		const { groups } = await grid_groups(session, state({ group: { by: ["party"], subtotals: true, expanded: "all" } }), ["outstanding"]);
		const expected = [...groups.values()].map((g) => g.outstanding).sort((a, b) => b - a).slice(0, 3);
		assert.equal(top.spec.post.top, groups.size > 3);
		top.data.series.outstanding.forEach((v, i) => close(v, expected[i], `top ${i}`));
		const shown = await session.open(s);
		for (const type of ["kpi", "bar"]) {
			const keys = ["range1", "range2", "outstanding"];
			const { spec, data } = await session.read_card(s, card({ type, x: null, series: keys }), { slicers: [], cross: null });
			assert.equal(spec.post.route, "totals");
			for (const k of keys) close(data.total[k].value, shown.expected.totals[k] ?? 0, `${type} ${k}`);
		}
		await session.close_view(shown);
	});
});

test("cross-filter and slicer values: the other cards and the value lists follow, nothing is left open", async () => {
	const gl = load("general_ledger_consolidated");
	await with_session(gl, async (session) => {
		const s = state();
		const by_type = card({ id: "t", type: "donut", x: "voucher_type", series: ["debit"] });
		const by_account = card({ id: "a", type: "hbar", x: "account", series: ["debit"] });
		const cross = { slicers: [], cross: { card: "t", key: "voucher_type", value: "Payment Entry" } };
		const own = await session.read_card(s, by_type, cross);
		assert.ok(own.data.categories.length > 1, "the card that was clicked keeps all its categories");
		const others = await session.read_card(s, by_account, cross);
		const { groups } = await grid_groups(
			session,
			state({ group: { by: ["account"], subtotals: true, expanded: "all" }, filters: [{ key: "voucher_type", type: "set", values: ["Payment Entry"] }] }),
			["debit"]
		);
		assert.equal(others.data.categories.length, groups.size);
		others.data.categories.forEach((name, i) => close(others.data.series.debit[i], groups.get(name).debit, name));
		// a slicer's values: under the page's filters and the other slicers, with their counts
		const dash = { slicers: [{ key: "voucher_type", type: "set", values: ["Payment Entry"] }, { key: "account", type: "set", values: null }], cross: null };
		const accounts = await session.slicer_values(s, "account", dash);
		assert.equal(accounts.values.length, groups.size);
		const types = await session.slicer_values(s, "voucher_type", dash);
		assert.ok(types.values.length > 1, "a slicer's own selection does not narrow its list");
		assert.equal(handles.debug_handles().filter((h) => h.kind === "view").length, 0);
	});
	assert.deepEqual(handles.debug_handles(), []);
});

test("card views: 20 reads of changing cards and dashboards leave no view", async () => {
	const ar = load("accounts_receivable_frappe_total");
	await with_session(ar, async (session) => {
		const cards = [
			card({ type: "bar", x: "party", series: ["paid"] }),
			card({ type: "donut", x: "party", series: ["invoiced"] }),
			card({ type: "area", x: "posting_date", series: ["paid", "outstanding"] }),
			card({ type: "hstacked", x: "voucher_type", series: ["paid", "outstanding"], top: 5 }),
			card({ type: "kpi", series: ["paid"] }),
		];
		const reads = [];
		for (let i = 0; i < 20; i++) {
			const dash = { slicers: i % 2 ? [{ key: "voucher_type", type: "set", values: ["Sales Invoice"] }] : [], cross: null };
			reads.push(session.read_card(state(), cards[i % cards.length], dash));
		}
		await Promise.all(reads);
		assert.equal(handles.debug_handles().filter((h) => h.kind === "view").length, 0);
	});
	assert.deepEqual(handles.debug_handles(), []);
});
