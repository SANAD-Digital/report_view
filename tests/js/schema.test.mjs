// N8: explicit schema and value conversion (docs/architecture.md §3.2أ).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	perspective_type,
	convert,
	sort_keys,
	make_collator,
	aux_currency_keys,
	build_table_input,
	batches,
	RID,
	KIND,
	SORT_PREFIX,
} from "../../report_view/public/js/report_view/engine/schema.js";

test("fieldtype -> Perspective type (Int is float, never integer)", () => {
	for (const ft of ["Currency", "Float", "Percent", "Duration", "Int"]) assert.equal(perspective_type(ft), "float");
	assert.equal(perspective_type("Date"), "date");
	assert.equal(perspective_type("Datetime"), "datetime");
	assert.equal(perspective_type("Check"), "boolean");
	for (const ft of ["Link", "Data", "Select", "Dynamic Link", "Small Text", "Whatever"]) {
		assert.equal(perspective_type(ft), "string");
	}
});

test("float: finite numbers only; '' and text become null, not 0", () => {
	assert.equal(convert("float", 12.5), 12.5);
	assert.equal(convert("float", 0), 0);
	assert.equal(convert("float", "12.5"), 12.5);
	for (const bad of ["", "abc", "1,234.5", null, undefined, NaN, Infinity, true, [], {}]) {
		assert.equal(convert("float", bad), null, JSON.stringify(bad));
	}
	assert.equal(convert("float", 3000000000), 3000000000);
});

test("date: only a real YYYY-MM-DD; one bad value would drop the whole batch", () => {
	assert.equal(convert("date", "2026-01-15"), "2026-01-15");
	assert.equal(convert("date", "2026-01-15 10:30:00"), "2026-01-15");
	for (const bad of ["", "05-01-2026", "2026-02-30", "2026-13-01", "abc", null, 20260115]) {
		assert.equal(convert("date", bad), null, JSON.stringify(bad));
	}
});

test("datetime: naive site datetimes as UTC milliseconds", () => {
	assert.equal(convert("datetime", "2026-01-15 10:30:00"), Date.UTC(2026, 0, 15, 10, 30, 0));
	assert.equal(convert("datetime", "2026-01-15T10:30:05.250000"), Date.UTC(2026, 0, 15, 10, 30, 5, 250));
	assert.equal(convert("datetime", "2026-01-15"), Date.UTC(2026, 0, 15));
	for (const bad of ["", "2026-01-15 25:00:00", "yesterday", null]) assert.equal(convert("datetime", bad), null);
});

test("boolean and string", () => {
	assert.equal(convert("boolean", 1), true);
	assert.equal(convert("boolean", "0"), false);
	assert.equal(convert("boolean", "Yes"), null);
	assert.equal(convert("boolean", ""), null);
	assert.equal(convert("string", ""), null);
	assert.equal(convert("string", null), null);
	assert.equal(convert("string", 1.5), "1.5");
	assert.equal(convert("string", ["a", "", "b"]), "a, b");
	assert.equal(convert("string", []), null);
});

test("sort keys follow Intl.Collator, not code units; empty values last", () => {
	const words = ["محمود", "مُحمد", "أحمد", "ابتسام", null, "Zed", "آدم", "محمد"];
	const collator = make_collator("ar");
	const keys = sort_keys(words, collator);
	const by_key = words.map((w, i) => [keys[i], w]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
	const expected = [...words.filter((w) => w !== null)].sort(collator.compare);
	assert.deepEqual(by_key, [...expected, null]);
	const code_units = [...words.filter((w) => w !== null)].sort();
	assert.notDeepEqual(expected, code_units);
});

const COLUMNS = [
	{ key: "party", fieldtype: "Link" },
	{ key: "amount", fieldtype: "Currency", currency: { kind: "row", key: "account_currency" } },
	{ key: "qty", fieldtype: "Int" },
	{ key: "posted", fieldtype: "Date" },
	{ key: "ok", fieldtype: "Check" },
];
const ROWS = [
	{ __rid: 0, __kind: "data", party: "ب", amount: 10, qty: "", posted: "2026-01-01", ok: 1, account_currency: "YER" },
	{ __rid: 1, __kind: "data", party: "", amount: "abc", qty: 3, posted: "", ok: 0, account_currency: "" },
	{ __rid: 2, __kind: "data", party: "ا", amount: null, qty: 2147483648, posted: "bad", ok: null },
];

test("table input: explicit schema, converted columns, sort keys, technical and currency columns", () => {
	assert.deepEqual(aux_currency_keys(COLUMNS), ["account_currency"]);
	const { schema, data, size } = build_table_input(COLUMNS, ROWS, {
		locale: "ar",
		extras: [{ name: "__depth", type: "float", values: [0, 1, 1] }],
	});
	assert.equal(size, 3);
	assert.deepEqual(schema, {
		party: "string",
		[SORT_PREFIX + "party"]: "float",
		amount: "float",
		qty: "float",
		posted: "date",
		ok: "boolean",
		account_currency: "string",
		[RID]: "float",
		[KIND]: "string",
		__depth: "float",
	});
	assert.deepEqual(data.party, ["ب", null, "ا"]);
	assert.deepEqual(data[SORT_PREFIX + "party"], [1, 2, 0]);
	assert.deepEqual(data.amount, [10, null, null]);
	assert.deepEqual(data.qty, [null, 3, 2147483648]);
	assert.deepEqual(data.posted, ["2026-01-01", null, null]);
	assert.deepEqual(data.ok, [true, false, null]);
	assert.deepEqual(data.account_currency, ["YER", null, null]);
	assert.deepEqual(data[RID], [0, 1, 2]);
	for (const values of Object.values(data)) assert.equal(values.length, 3);
});

test("a report column may not take the name of an engine column", () => {
	assert.throws(() => build_table_input([{ key: RID, fieldtype: "Data" }], ROWS), /duplicate engine column/);
});

test("batches: columnar, at most `size` rows each, nothing lost", () => {
	const data = { a: Array.from({ length: 120001 }, (_, i) => i), b: Array.from({ length: 120001 }, () => "x") };
	const parts = [...batches(data, 120001)];
	assert.deepEqual(parts.map((p) => p.a.length), [50000, 50000, 20001]);
	assert.equal(parts[2].a.at(-1), 120000);
	assert.ok(parts.every((p) => p.a.length === p.b.length));
	assert.deepEqual([...batches({ a: [] }, 0)], []);
});
