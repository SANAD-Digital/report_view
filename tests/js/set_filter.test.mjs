// The set filter selection (components/set_filter.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { toggle_value } from "../../report_view/public/js/report_view/components/set_filter.js";
import { parse_number } from "../../report_view/public/js/report_view/components/header_cells.js";

test("set filter selection: null is everything; unticking one keeps the others; all again is null", () => {
	const all = ["A", "B", null];
	const one_off = toggle_value(null, all, "B");
	assert.deepEqual(one_off, ["A", null]);
	assert.equal(toggle_value(one_off, all, "B"), null);
	assert.deepEqual(toggle_value(["A"], all, ""), ["A", ""]);
	assert.equal(parse_number(" 1,234.50 "), 1234.5);
	assert.equal(parse_number("-12"), -12);
	assert.equal(parse_number("12a"), null);
	assert.equal(parse_number(""), null);
});
