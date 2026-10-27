// The default column order with enrichment columns, and the user's column groups.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { apply_enrichment } from "../../report_view/public/js/report_view/adapter/enrich.js";
import { default_state, sanitize } from "../../report_view/public/js/report_view/state/view_state.js";
import { ordered_columns, visible_columns } from "../../report_view/public/js/report_view/engine/view_config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const load = (name) => normalize(JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8")).input);

// Trial balance with its account enrichment, as the page has it after api.enrich.
function trial_balance() {
	const report = load("trial_balance_fy2026");
	const values = {};
	for (const r of report.rows) if (r.account) values[r.account] = { root_type: r.account.startsWith("1") ? "Asset" : "Expense", account_type: null };
	apply_enrichment(report, { source_column: "account", link_doctype: "Account" }, values, ["root_type", "account_type"], (f) => f, {
		root_type: { fieldtype: "Select", options: "Asset\nExpense" },
	});
	return report;
}

test("column order: enrichment columns stand right after their source column", () => {
	const report = trial_balance();
	const keys = ordered_columns(report).map((c) => c.key);
	assert.deepEqual(keys.slice(0, 3), ["account", "account__root_type", "account__account_type"]);
	const shown = visible_columns(report, sanitize(default_state({ default_hidden: ["account__root_type"] })));
	assert.deepEqual(shown.slice(0, 3).map((c) => c.key), ["account", "account__account_type", "opening_debit"]);
	// an explicit order still wins
	const ordered = visible_columns(report, { columns: { hidden: [], order: ["credit", "account"] } });
	assert.deepEqual(ordered.slice(0, 2).map((c) => c.key), ["credit", "account"]);
});

test("column groups: sanitized, one group per column, members kept side by side, bands from the user's groups", async () => {
	const { sanitize_groups, order_for_groups, header_bands } = await import("../../report_view/public/js/report_view/state/column_groups.js");
	assert.equal(sanitize_groups(undefined), null);
	assert.deepEqual(
		sanitize_groups([
			{ label: " Opening ", keys: ["od", "oc"] },
			{ label: "Dup", keys: ["oc", "cd"] },
			{ label: "", keys: ["x"] },
			{ label: "Empty", keys: [] },
		]),
		[
			{ label: "Opening", keys: ["od", "oc"] },
			{ label: "Dup", keys: ["cd"] },
		]
	);
	assert.deepEqual(order_for_groups(["a", "od", "b", "oc", "c"], [{ keys: ["od", "oc"] }]), ["a", "od", "oc", "b", "c"]);
	const user = header_bands({ columns: { groups: [{ label: "G", keys: ["od"] }] } }, { bands: [{ id: "x", label: "X" }], columns: { oc: { band: "x" } } });
	assert.equal(user.bands.get(user.band_of({ key: "od", fieldname: "od" })).label, "G");
	assert.equal(user.band_of({ key: "oc", fieldname: "oc" }), null);
	const report = header_bands({ columns: { groups: null } }, { bands: [{ id: "x", label: "X" }], columns: { oc: { band: "x" } } });
	assert.equal(report.band_of({ key: "oc", fieldname: "oc" }), "x");
});
