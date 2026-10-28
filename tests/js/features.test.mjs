// What a report shows (Report View Settings, ADR-023): the features object, the page's
// configuration made of it, and the view state held to it (state/features.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	FEATURES,
	sanitize_features,
	allowed_modes,
	server_config,
	restrict_state,
	allowed_cards,
} from "../../report_view/public/js/report_view/state/features.js";
import { CARD_TYPES } from "../../report_view/public/js/report_view/state/dashboard_state.js";
import { default_state, sanitize } from "../../report_view/public/js/report_view/state/view_state.js";
import { build_search } from "../../report_view/public/js/report_view/state/url.js";
import { plan_criteria } from "../../report_view/public/js/report_view/filters/criteria.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOCTYPE = path.resolve(here, "../../report_view/report_view/doctype/report_view_settings/report_view_settings.json");
const SETTINGS_PY = path.resolve(here, "../../report_view/core/settings.py");

const off = (...keys) => sanitize_features(Object.fromEntries(keys.map((k) => [k, false])));

test("no settings: every tool is on, every chart type allowed", () => {
	const f = sanitize_features(undefined);
	for (const k of FEATURES) assert.equal(f[k], true, k);
	assert.deepEqual(f.chart_types, CARD_TYPES);
	assert.deepEqual(sanitize_features({ grouping: "no", evil: false, chart_types: "bar" }), f);
});

test("chart types: known ones in their order; none left turns the charts off", () => {
	assert.deepEqual(sanitize_features({ chart_types: ["kpi", "nope", "bar"] }).chart_types, ["bar", "kpi"]);
	assert.equal(sanitize_features({ chart_types: [] }).charts, false);
});

test("the side panel and its tabs go together", () => {
	assert.equal(off("columns_panel", "filters_panel").side_panel, false);
	const f = off("side_panel");
	assert.equal(f.columns_panel, false);
	assert.equal(f.filters_panel, false);
});

test("views: the table always, Pages needs the flag and the print permission", () => {
	assert.deepEqual(allowed_modes(sanitize_features({})), ["grid", "pivot", "charts", "pages"]);
	assert.deepEqual(allowed_modes(sanitize_features({}), false), ["grid", "pivot", "charts"]);
	assert.deepEqual(allowed_modes(off("pivot", "charts", "pages")), ["grid"]);
});

test("server defaults win over register; a default that is off is no default", () => {
	const reg = { default_mode: "charts", default_hidden: ["x"], quick_filters: [{ id: "q" }], period: { from_key: "a" } };
	const settings = { default_mode: "pivot", default_view: { group_by: ["party"], hidden: ["y"], pinned: ["voucher_no"] } };
	const c = server_config(reg, settings, sanitize_features({}));
	assert.equal(c.default_mode, "pivot");
	assert.deepEqual(c.default_hidden, ["y"]);
	assert.deepEqual(c.default_group_by, ["party"]);
	assert.deepEqual(c.default_pinned, ["voucher_no"]);
	assert.equal(reg.default_mode, "charts", "the registered config is not changed");
	const none = server_config(reg, settings, off("pivot", "grouping", "pinning", "quick_filters", "period_picker"));
	assert.equal(none.default_mode, "grid");
	assert.deepEqual(none.default_group_by, []);
	assert.deepEqual(none.default_pinned, []);
	assert.deepEqual(none.quick_filters, []);
	assert.equal(none.period, false);
	// no server default view: register's own default stays
	assert.equal(server_config(reg, {}, sanitize_features({})).default_mode, "charts");
	assert.deepEqual(server_config(reg, {}, sanitize_features({})).default_hidden, ["x"]);
});

test("the default state carries the server's grouping, pins and subtotals; the URL stays clean", () => {
	const config = server_config({}, { default_view: { group_by: ["a", "b"], pinned: ["p"] } }, off("subtotals"));
	const base = default_state(config);
	assert.deepEqual(base.group.by, ["a", "b"]);
	assert.deepEqual(base.columns.pinned.start, ["p"]);
	assert.equal(base.group.subtotals, false);
	assert.equal(build_search({}, sanitize(null, config), "/desk/report-view/x", base).search, "");
	// the user took the grouping off: the link says so
	const s = sanitize({ group: { by: [] } }, config);
	assert.deepEqual(s.group.by, []);
	assert.match(build_search({}, s, "/desk/report-view/x", base).search, /rv=/);
});

test("a link asking for a view or a tool that is off opens the default view", () => {
	const asked = sanitize({
		mode: "pivot",
		pivot: { rows: ["a"], cols: ["b"], values: [] },
		charts: { cards: [{ id: "c1", type: "donut", x: "a" }, { id: "c2", type: "bar", x: "a" }], cross: { card: "c1", key: "a", value: "v" } },
		group: { by: ["a"], subtotals: true },
		columns: { pinned: { start: ["a"] }, groups: [{ label: "G", keys: ["a", "b"] }] },
		quick_filters: ["q"],
		filters: [{ key: "a", type: "set", values: ["v"] }, { key: "b", type: "text", op: "contains", value: "x" }],
		ui: { side_panel: "filters" },
	});
	const f = off("pivot", "grouping", "subtotals", "pinning", "column_groups", "quick_filters", "set_filters", "filters_panel");
	f.chart_types = ["bar"];
	const s = restrict_state(structuredClone(asked), f, { default_mode: "charts" });
	assert.equal(s.mode, "charts");
	assert.equal(s.pivot, null);
	assert.deepEqual(s.charts.cards.map((c) => c.id), ["c2"]);
	assert.equal(s.charts.cross, null);
	assert.deepEqual(s.group.by, []);
	assert.equal(s.group.subtotals, false);
	assert.deepEqual(s.columns.pinned.start, []);
	assert.equal(s.columns.groups, null);
	assert.deepEqual(s.quick_filters, []);
	assert.deepEqual(s.filters.map((x) => x.type), ["text"]);
	assert.equal(s.ui.side_panel, null);
	// no Pages without print; the default when the default itself is off is the table
	assert.equal(restrict_state(sanitize({ mode: "pages" }), sanitize_features({}), { can_print: false, default_mode: "pages" }).mode, "grid");
	// every way of filtering off: no browser filter
	assert.deepEqual(restrict_state(structuredClone(asked), off("column_filters", "filters_panel", "quick_search")).filters, []);
	// everything on: nothing changes
	assert.deepEqual(restrict_state(structuredClone(asked), sanitize_features({})), asked);
});

test("saved cards of a type that is off are dropped", () => {
	assert.deepEqual(allowed_cards([{ type: "bar" }, { type: "kpi" }], ["kpi"]), [{ type: "kpi" }]);
});

test("the Period field off: the dates stay the report's own filters", () => {
	const defs = [
		{ fieldname: "from_date", fieldtype: "Date" },
		{ fieldname: "to_date", fieldtype: "Date" },
	];
	assert.equal(plan_criteria(defs, {}).has_period, true);
	const plan = plan_criteria(defs, false);
	assert.equal(plan.has_period, false);
	assert.equal(plan.place.get("from_date"), "main");
});

test("the DocType and the server know the same features and chart types as the browser", () => {
	const fields = JSON.parse(fs.readFileSync(DOCTYPE, "utf8")).fields;
	const checks = new Set(fields.filter((d) => d.fieldtype === "Check").map((d) => d.fieldname));
	for (const k of FEATURES) assert.ok(checks.has(k), `no Check field ${k}`);
	assert.deepEqual(
		fields.filter((d) => d.fieldname.startsWith("chart_")).map((d) => d.fieldname.slice(6)),
		CARD_TYPES
	);
	for (const d of fields.filter((x) => FEATURES.includes(x.fieldname) || x.fieldname.startsWith("chart_"))) {
		assert.equal(d.default, "1", `${d.fieldname} is on by default`);
	}
	const py = fs.readFileSync(SETTINGS_PY, "utf8");
	const tuple = (name) => [...new RegExp(`${name} = \\(([^)]*)\\)`).exec(py)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
	assert.deepEqual(tuple("FEATURES"), FEATURES);
	assert.deepEqual(tuple("CHART_TYPES"), CARD_TYPES);
});
