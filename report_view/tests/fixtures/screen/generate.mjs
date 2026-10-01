// What the browser engine shows for (fixture, view state) cases, for the Python engine tests
// (report_view/tests/test_engine.py, docs/architecture.md §4.3): the rows of the grid in
// display order with their subtotal rows, the pinned report rows, the grand total and
// `expected`. Read from Perspective in node through the modules of the page itself.
//
// Regenerate after a change of the browser engine:
//   node report_view/tests/fixtures/screen/generate.mjs
// One node process per case (a Perspective engine each), merged into cases.json.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "../../../..");
const J = `${APP}/report_view/public/js/report_view`;
const OUT = path.join(here, "cases.json");
const FIXTURES = `${APP}/report_view/tests/fixtures/normalize`;
const HIERARCHICAL = new Set(["tree", "levels", "group"]);

const { normalize } = await import(`${J}/adapter/normalize.js`);
const { default_state } = await import(`${J}/state/view_state.js`);
const { build_layout, entry_at } = await import(`${J}/engine/row_layout.js`);

const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")).input);

// Rows of the grid body as grid_view.read_records names them: a report row (by __rid), a
// group Perspective computed (with its aggregates), or the subtotal row of one of them.
function screen_rows(session, opened, cols) {
	const { post } = opened;
	const paths = cols.__ROW_PATH__ || null;
	const depths = opened.depths || new Uint8Array(opened.body_rows);
	const layout = build_layout(depths, { subtotals: post.subtotals && HIERARCHICAL.has(post.shape), top: 0 });
	const values = (i) => Object.fromEntries(post.measures.map((k) => [k, cols[k][i]]));
	const rows = [];
	for (let y = 0; y < layout.size; y++) {
		const entry = entry_at(layout, y);
		const i = entry.row + post.row_offset;
		const open = Boolean(layout.open[entry.row]);
		let rec;
		if (!post.row_offset) {
			const parent = Boolean(cols.__has_children?.[i]);
			rec = { t: "row", rid: cols.__rid[i], depth: cols.__depth ? cols.__depth[i] : 0, parent, open };
		} else {
			const p = paths[i];
			const depth = p.length - 1;
			const filled = post.shape === "levels" && p.length <= post.group_keys.length && cols.__levels[i] < p.length;
			if (p.length === post.leaf_depth) rec = { t: "row", rid: p[depth], depth, parent: false };
			else if (filled) rec = { t: "row", rid: cols.__rid[i], depth, parent: false };
			else {
				const node = post.shape === "levels" ? session.level_rids.get(JSON.stringify(p)) ?? null : null;
				rec = { t: "group", depth, open, count: cols.__kind[i], value: p[depth], node, vals: values(i) };
			}
		}
		if (entry.kind !== "foot") rows.push(rec);
		else if (rec.t === "group") rows.push({ t: "foot", depth: rec.depth, of: rec.node, vals: rec.vals });
		else rows.push({ t: "foot", depth: rec.depth, of: rec.rid, vals: null });
	}
	return rows;
}

async function dump(fixture, name, patch, lang = "ar") {
	const require = createRequire(`${APP}/package.json`);
	const perspective = (await import(require.resolve("@finos/perspective"))).default;
	const { EngineHandles, ReportSession } = await import(`${J}/engine/perspective_engine.js`);
	const session = await ReportSession.create(new EngineHandles(perspective), load(fixture), { locale: lang });
	try {
		const opened = await session.open({ ...default_state(), ...patch });
		const { post } = opened;
		const rows = screen_rows(session, opened, await opened.view.to_columns());
		await session.close_view(opened);
		return {
			name,
			fixture,
			lang,
			state: patch,
			shape: post.shape,
			keys: post.keys,
			subtotals: post.subtotals,
			pinned: post.pinned_rows,
			total_source: post.total.source,
			rows,
			totals: opened.totals.values,
			mixed: opened.totals.mixed,
			expected: opened.expected,
		};
	} finally {
		await session.close();
	}
}

const tb = load("trial_balance_fy2026");
const parents = tb.rows.filter((r) => r.__kind === "data" && !r.__is_leaf).map((r) => r.__rid);
const ar = load("accounts_receivable_group_by_party");
const parties = [...new Set(ar.facts.map((r) => r.party))];
const vtypes = [...new Set(ar.facts.map((r) => r.voucher_type))];
const dates = [...new Set(ar.facts.map((r) => r.posting_date))];
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const group = (by, subtotals = true, expanded = "all") => ({ group: { by, subtotals, expanded } });
const tree = (depth, expanded = null) => ({ tree: { depth, expanded } });
const TB = "trial_balance_fy2026";
const AR = "accounts_receivable_group_by_party";
const GL = "general_ledger_consolidated";
const GLA = "general_ledger_by_account";

const cases = [
	[TB, "tb_default", {}],
	[TB, "tb_depth1_no_subtotals", { ...tree(1), ...group([], false) }],
	[TB, "tb_expanded_list", tree(null, parents.slice(0, 3))],
	[TB, "tb_collapse_all", tree(0)],
	[TB, "tb_sort_no_effect", { sort: [{ key: "debit", dir: "desc" }], ...tree(9) }],
	[TB, "tb_filter_levels", { filters: [{ key: "debit", type: "range", min: 1, max: null }], ...tree(9) }],
	[
		TB,
		"tb_filter_levels_folded",
		{ filters: [{ key: "account", type: "text", op: "contains", value: "a" }], ...tree(null, parents.slice(0, 2)) },
	],
	[
		TB,
		"tb_filter_levels_no_subtotals",
		{ filters: [{ key: "debit", type: "range", min: 1, max: null }], ...tree(2), ...group([], false) },
	],
	[TB, "tb_group_currency", { ...group(["currency"]), sort: [{ key: "debit", dir: "desc" }] }],
	[TB, "tb_empty_filter_is_no_filter", { filters: [{ key: "account", type: "text", op: "contains", value: "" }] }],
	[AR, "ar_party_default", {}],
	[AR, "ar_party_sort", { sort: [{ key: "paid", dir: "desc" }] }],
	[
		AR,
		"ar_party_sort_text",
		{
			sort: [
				{ key: "voucher_no", dir: "desc" },
				{ key: "posting_date", dir: "asc" },
			],
		},
	],
	[AR, "ar_group_party", { ...group(["party"]), sort: [{ key: "paid", dir: "desc" }] }],
	[
		AR,
		"ar_group_party_desc",
		{
			...group(["party"], false),
			sort: [
				{ key: "party", dir: "desc" },
				{ key: "posting_date", dir: "asc" },
			],
		},
	],
	[
		AR,
		"ar_group_two_levels_paths",
		group(["party", "voucher_type"], true, [[parties[0]], [parties[0], vtypes[0]], [parties[2]]]),
	],
	[AR, "ar_group_none", group(["party"], true, "none")],
	[AR, "ar_group_date_path", group(["posting_date"], true, [[ms(dates[0])], [ms(dates[1])]])],
	[
		AR,
		"ar_filter",
		{
			filters: [
				{ key: "party", type: "set", values: [parties[0], parties[2]], exclude: false },
				{ key: "paid", type: "range", min: 0.01, max: null },
			],
			sort: [{ key: "paid", dir: "asc" }],
		},
	],
	[
		AR,
		"ar_filter_exclude_date",
		{
			filters: [
				{ key: "party", type: "set", values: [parties[2]], exclude: true },
				{ key: "posting_date", type: "date", from: dates[1], to: null },
			],
		},
	],
	[
		AR,
		"ar_pinned_columns",
		{ columns: { order: [], hidden: ["party_type"], widths: {}, pinned: { start: ["voucher_no", "paid", "party"], end: [] } } },
	],
	[
		AR,
		"ar_group_values_agg",
		{
			...group(["voucher_type"], false),
			values: [
				{ key: "paid", agg: "avg" },
				{ key: "invoiced", agg: "max" },
				{ key: "outstanding", agg: "min" },
				{ key: "age", agg: "count" },
				{ key: "range1", agg: "count_distinct" },
			],
		},
	],
	[GL, "gl_default", {}],
	[GL, "gl_sort", { sort: [{ key: "debit", dir: "desc" }] }],
	[GL, "gl_filter", { filters: [{ key: "debit", type: "range", min: 1, max: null }] }],
	[GL, "gl_text_filter", { filters: [{ key: "voucher_type", type: "text", op: "starts_with", value: "j" }] }],
	[GL, "gl_group_voucher_type", { ...group(["voucher_type"]), sort: [{ key: "posting_date", dir: "desc" }] }],
	[GLA, "glacc_default", {}],
	[GLA, "glacc_sort", { sort: [{ key: "posting_date", dir: "desc" }] }],
	[GLA, "glacc_group_account_none", group(["account"], true, "none")],
	["accounts_receivable_frappe_total", "arft_default", {}],
	["synthetic_edge_shapes", "syn_default", {}],
	["stock_balance", "sb_default", {}],
	["employee_leave_balance_float", "elb_default", {}],
	["employee_leave_balance_float", "elb_filter", { filters: [{ key: "employee", type: "text", op: "contains", value: "0" }] }],
];

const only = process.argv[2];
if (only) {
	const [fixture, name, patch] = cases.find((c) => c[1] === only);
	process.stdout.write(JSON.stringify(await dump(fixture, name, patch)));
	process.exit(0);
}
const self = fileURLToPath(import.meta.url);
const out = cases.map(([, name]) => execFileSync(process.execPath, [self, name], { maxBuffer: 64 * 1024 * 1024 }).toString());
fs.writeFileSync(OUT, `[\n${out.join(",\n")}\n]\n`);
process.stdout.write(`${out.length} cases written to ${path.relative(APP, OUT)}\n`);
process.exit(0);
