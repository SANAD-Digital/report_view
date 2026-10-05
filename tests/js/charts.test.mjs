// Charts view (phase 5d task 1): the chart of a view state (engine/chart_config.js), its
// ECharts option (views/chart_option.js), and, in the Perspective engine for node, the chart
// numbers against the grid's for the same filters and the handle lifecycle of chart views.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import perspective from "@finos/perspective";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { default_state, sanitize } from "../../report_view/public/js/report_view/state/view_state.js";
import { build_search } from "../../report_view/public/js/report_view/state/url.js";
import { EngineHandles, ReportSession } from "../../report_view/public/js/report_view/engine/perspective_engine.js";
import {
	CHART_LIMITS,
	MAX_SERIES,
	chart_dimensions,
	chart_measures,
	default_chart,
	resolve_chart,
	to_chart_config,
	level_of,
} from "../../report_view/public/js/report_view/engine/chart_config.js";
import { chart_option } from "../../report_view/public/js/report_view/views/chart_option.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);
const state = (patch = {}) => ({ ...default_state(), ...patch });
const TB_CHART = { type: "bar", x: "level_1", series: ["closing_debit", "closing_credit"] };
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

// ------------------------------------------------------------------ chart of a view state

test("chart dimensions and measures: tree levels first, report columns; numeric measures only", () => {
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
	assert.equal(level_of("level_3"), 3);
	assert.equal(level_of("account"), null);
});

test("default chart: register.chart, else the top-level groups or the first linked dimension and the first measures", () => {
	const tb = load("trial_balance_fy2026");
	assert.deepEqual(default_chart(tb, state(), { chart: TB_CHART }, "account"), TB_CHART);
	assert.deepEqual(default_chart(tb, state(), {}, "account"), { type: "bar", x: "level_1", series: ["opening_debit", "opening_credit"] });
	assert.deepEqual(default_chart(load("accounts_receivable_frappe_total"), state(), {}, "posting_date"), {
		type: "bar",
		x: "party",
		series: ["invoiced", "paid"],
	});
	assert.deepEqual(default_chart(load("general_ledger_consolidated"), state(), {}, "posting_date"), {
		type: "bar",
		x: "account",
		series: ["debit", "credit"],
	});
	// A register chart that does not fit the report falls back, key by key.
	assert.deepEqual(default_chart(tb, state(), { chart: { type: "pie", x: "nope", series: ["nope"] } }, "account").x, "level_1");
});

test("resolve_chart keeps what fits the report and drops the rest", () => {
	const tb = load("trial_balance_fy2026");
	const reg = { chart: TB_CHART };
	assert.deepEqual(resolve_chart(state({ chart: { type: "donut", x: "level_2", series: ["debit"] } }), tb, reg), {
		type: "donut",
		x: "level_2",
		series: ["debit"],
	});
	assert.deepEqual(resolve_chart(state({ chart: { type: "radar", x: "nope", series: ["nope", "debit", "debit"] } }), tb, reg), {
		type: "bar",
		x: "level_1",
		series: ["debit"],
	});
	assert.deepEqual(resolve_chart(state({ chart: null }), tb, reg), TB_CHART);
});

test("view state: chart is sanitized and makes the view a non-default one in the URL", () => {
	const s = sanitize({ v: 1, mode: "charts", chart: { type: "hbar", x: "party", series: ["a", 2, "b", "c", "d", "e", "f", "g", "h"] } });
	assert.equal(s.mode, "charts");
	assert.deepEqual(s.chart, { type: "hbar", x: "party", series: ["a", "b", "c", "d", "e", "f", "g"] });
	assert.equal(sanitize({ v: 1, chart: { type: "x" } }).chart.type, "bar");
	assert.equal(sanitize({ v: 1, chart: "bar" }).chart, null);
	const base = default_state();
	assert.equal(build_search({}, sanitize({ v: 1 }), "/desk/report-view/x", base).search, "");
	assert.match(build_search({}, sanitize({ v: 1, mode: "charts" }), "/desk/report-view/x", base).search, /rv=/);
	assert.match(build_search({}, sanitize({ v: 1, chart: TB_CHART }), "/desk/report-view/x", base).search, /rv=/);
});

test("chart config: a tree level without browser filter reads the report's rows of that depth", () => {
	const tb = load("trial_balance_fy2026");
	const spec = to_chart_config(state(), tb, TB_CHART, { categories: 4 });
	assert.equal(spec.route, "nodes");
	assert.equal(spec.table, "nodes");
	assert.deepEqual(spec.config.filter, [["__depth", "==", 0]]);
	assert.deepEqual(spec.config.sort, [["__path", "asc"]]);
	assert.ok(!spec.config.group_by);
	assert.equal(spec.post.order, "report");
	assert.equal(spec.count.grouped, false);
});

test("chart config: with a browser filter, or any other dimension, the facts grouped by the dimension", () => {
	const tb = load("trial_balance_fy2026");
	const filtered = state({ filters: [{ key: "account", type: "text", op: "contains", value: "1" }] });
	const spec = to_chart_config(filtered, tb, TB_CHART, { categories: 3 });
	assert.equal(spec.route, "facts");
	assert.deepEqual(spec.config.group_by, ["level_1"]);
	assert.deepEqual(spec.config.filter, [["account", "contains", "1"]]);
	assert.deepEqual(spec.config.aggregates.closing_debit, "sum");
	assert.deepEqual(spec.config.sort, [["__rid", "asc"]]);
	assert.equal(spec.post.row_offset, 1);
	assert.deepEqual(spec.count.config.group_by, ["level_1"]);

	const ar = load("accounts_receivable_frappe_total");
	const avg = state({ values: [{ key: "paid", agg: "avg" }], quick_filters: ["big"] });
	const quick = [{ id: "big", expression: '"paid" > 100' }];
	const s2 = to_chart_config(avg, ar, { type: "bar", x: "party", series: ["invoiced", "paid"] }, { quick_filters: quick, categories: 2 });
	assert.equal(s2.config.aggregates.paid, "avg");
	assert.deepEqual(s2.config.filter, [["__qf__big", "==", true]]);
	assert.equal(s2.config.expressions.__qf__big, '"paid" > 100');
	// row currency: the currency of each category and whether it mixes currencies
	assert.equal(s2.config.aggregates.currency, "unique");
	assert.equal(s2.config.aggregates.__curn__currency, "distinct count");
});

test("chart config: horizontal bars and donut largest first; more categories than shown, largest first too", () => {
	const ar = load("accounts_receivable_frappe_total");
	const chart = { type: "hbar", x: "party", series: ["paid"] };
	assert.deepEqual(to_chart_config(state(), ar, chart, { categories: 5 }).config.sort[0], ["paid", "desc"]);
	assert.deepEqual(to_chart_config(state(), ar, { ...chart, type: "donut" }, { categories: 5 }).config.sort[0], ["paid", "desc"]);
	const bar = { ...chart, type: "bar" };
	assert.deepEqual(to_chart_config(state(), ar, bar, { categories: 5 }).config.sort[0], ["__rid", "asc"]);
	const many = to_chart_config(state(), ar, bar, { categories: CHART_LIMITS.bar + 1 });
	assert.equal(many.post.top, true);
	assert.deepEqual(many.config.sort[0], ["paid", "desc"]);
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
		{ name: "A", value: 1, itemStyle: { color: "p1" } },
		{ name: "<B>", value: 2, itemStyle: { color: "p2" } },
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
		const opened = await session.open_chart(state(), TB_CHART);
		const grid = await session.open(state());
		const cols = await grid.view.to_columns();
		const top = cols.__rid.map((rid, i) => [rid, i]).filter(([, i]) => cols.__depth[i] === 0);
		assert.deepEqual(opened.data.rids, top.map(([rid]) => rid));
		for (const key of TB_CHART.series) {
			top.forEach(([rid, i], at) => close(opened.data.series[key][at], cols[key][i], `${rid} ${key}`));
			// the top rows add up to the grand total shown
			close(opened.data.series[key].reduce((a, v) => a + v, 0), grid.totals.values[key], `total ${key}`);
		}
		await session.close_view(grid);
		await session.close_chart(opened);
	});
	assert.deepEqual(handles.debug_handles(), []);
});

test("trial balance with a browser filter: the levels of the re-grouped grid", async () => {
	const tb = load("trial_balance_fy2026");
	const s = state({ filters: [{ key: "closing_debit", type: "range", min: 1, max: null }] });
	await with_session(tb, async (session) => {
		const chart = await session.open_chart(s, TB_CHART);
		assert.equal(chart.spec.post.route, "facts");
		const { groups, totals } = await grid_groups(session, s, TB_CHART.series);
		assert.deepEqual(chart.data.categories, [...groups.keys()]);
		chart.data.categories.forEach((name, i) => {
			for (const key of TB_CHART.series) close(chart.data.series[key][i], groups.get(name)[key], `${name} ${key}`);
		});
		for (const key of TB_CHART.series) close(chart.data.total[key].value, totals[key], `total ${key}`);
		await session.close_chart(chart);
	});
});

for (const [fixture, x, series] of [
	["accounts_receivable_frappe_total", "party", ["invoiced", "paid", "outstanding"]],
	["general_ledger_consolidated", "account", ["debit", "credit"]],
]) {
	test(`${fixture}: categories = the grid grouped by ${x}, total = the grid's grand total`, async () => {
		const report = load(fixture);
		for (const type of ["bar", "hbar", "donut"]) {
			await with_session(report, async (session) => {
				const s = state();
				const chart = await session.open_chart(s, { type, x, series });
				const { groups } = await grid_groups(session, state({ group: { by: [x], subtotals: true, expanded: "all" } }), series);
				const shown = await session.open(s);
				assert.equal(chart.data.categories.length, Math.min(groups.size, CHART_LIMITS[type]));
				chart.data.categories.forEach((name, i) => {
					for (const key of series) close(chart.data.series[key][i], groups.get(name)[key], `${type} ${name} ${key}`);
				});
				for (const key of series) {
					close(chart.data.total[key].value, shown.expected.totals[key], `${type} total ${key}`);
				}
				if (type !== "bar") {
					const first = chart.data.series[series[0]];
					assert.ok(first.every((v, i) => i === 0 || first[i - 1] >= v), `${type}: largest first`);
				}
				await session.close_view(shown);
				await session.close_chart(chart);
			});
		}
		assert.deepEqual(handles.debug_handles(), []);
	});
}

test("chart views: the newest of racing charts wins, nothing is left after 20 changes", async () => {
	const ar = load("accounts_receivable_frappe_total");
	await with_session(ar, async (session) => {
		const charts = [
			{ type: "bar", x: "party", series: ["paid"] },
			{ type: "donut", x: "party", series: ["invoiced"] },
			{ type: "line", x: "posting_date", series: ["paid", "outstanding"] },
			{ type: "hbar", x: "voucher_type", series: ["outstanding"] },
		];
		const [a, b] = await Promise.all([session.open_chart(state(), charts[0]), session.open_chart(state(), charts[1])]);
		assert.equal(a, null);
		assert.ok(b);
		let previous = b;
		for (let i = 0; i < 20; i++) {
			const next = await session.open_chart(state(), charts[i % charts.length]);
			await session.close_chart(previous);
			previous = next;
			const views = handles.debug_handles().filter((h) => h.kind === "view");
			assert.equal(views.length, 1, `change ${i}`);
		}
		await session.close_chart(previous);
		assert.equal(handles.debug_handles().filter((h) => h.kind === "view").length, 0);
	});
	assert.deepEqual(handles.debug_handles(), []);
});
