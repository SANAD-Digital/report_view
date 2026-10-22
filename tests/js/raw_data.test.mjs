// frappe.query_report.raw_data rebuilt from the normalised rows (adapter/raw_data.js, B7):
// for every normalisation fixture, the rebuilt `result` is the server's own (each row's keys
// and values; a list row as a list; Frappe's total row last), so the page need not keep the
// raw rows next to their normalised copy. The facade (ADR-006) answers with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";
import { keep_raw, rebuild_result, raw_data_cache } from "../../report_view/public/js/report_view/adapter/raw_data.js";
import { make_facade } from "../../report_view/public/js/report_view/filters/facade.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

/** The row as rebuilt equals the server's: same values for its keys; only null keys added. */
function same_row(got, want, where) {
	if (Array.isArray(want)) {
		assert.ok(Array.isArray(got), `${where}: a list row came back as ${typeof got}`);
		want.forEach((v, k) => assert.deepEqual(got[k] ?? null, v ?? null, `${where}[${k}]`));
		return;
	}
	for (const [k, v] of Object.entries(want)) assert.deepEqual(got[k], v, `${where}.${k}`);
	for (const k of Object.keys(got)) if (!(k in want)) assert.equal(got[k], null, `${where}: ${k} added with a value`);
}

for (const file of files) {
	const fixture = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
	const raw = fixture.input.raw || {};
	if (!Array.isArray(raw.result)) continue;
	test(`raw_data: ${fixture.name || file}: result rebuilt as the server sent it`, () => {
		const input = structuredClone(fixture.input);
		const kept = keep_raw(input.raw);
		const report = normalize(input);
		assert.equal("result" in kept.meta, false);
		const result = rebuild_result(kept, report);
		assert.equal(result.length, raw.result.length);
		raw.result.forEach((want, i) => same_row(result[i], want, `${file} row ${i}`));
	});
}

test("raw_data of the facade: the kept answer without its rows, rebuilt once and then kept", () => {
	const fixture = JSON.parse(fs.readFileSync(path.join(dir, "accounts_receivable_frappe_total.json"), "utf8"));
	const input = structuredClone(fixture.input);
	const kept = keep_raw(input.raw);
	const report = normalize(input);
	const cache = raw_data_cache();
	const host = { report, raw_kept: kept, raw_data: () => cache(host.raw_kept, host.report) };
	const facade = make_facade(host);
	const first = facade.raw_data;
	assert.equal(first.result.length, fixture.input.raw.result.length);
	assert.equal(first.add_total_row, fixture.input.raw.add_total_row);
	assert.deepEqual(first.columns, fixture.input.raw.columns);
	assert.equal(facade.raw_data, first);
	// another report: rebuilt from it
	host.report = normalize(structuredClone(fixture.input));
	assert.notEqual(facade.raw_data, first);
	host.raw_kept = null;
	assert.equal(facade.raw_data, null);
});
