// Period presets of the period picker, the fiscal parts and the calendar grid (filters/periods.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { preset_list, fiscal_range, fiscal_part_of, month_cells, week_columns, days_between, eom } from "../../report_view/public/js/report_view/filters/periods.js";

test("period presets: ranges of the design, fiscal years when known", () => {
	const fys = [
		{ name: "2025", from: "2025-04-01", to: "2026-03-31" },
		{ name: "2026", from: "2026-04-01", to: "2027-03-31" },
	];
	const list = preset_list("2026-10-07", { first_day: 0, fiscal_years: fys });
	const by = Object.fromEntries(list.filter((p) => !p.sep).map((p) => [p.id, [p.from, p.to]]));
	assert.deepEqual(by.today, ["2026-10-07", "2026-10-07"]);
	assert.deepEqual(by.yesterday, ["2026-10-06", "2026-10-06"]);
	assert.deepEqual(by.last_7, ["2026-10-01", "2026-10-07"]);
	assert.deepEqual(by.week, ["2026-10-04", "2026-10-10"]);
	assert.deepEqual(by.month, ["2026-10-01", "2026-10-31"]);
	assert.deepEqual(by.last_month, ["2026-09-01", "2026-09-30"]);
	assert.deepEqual(by.quarter, ["2026-10-01", "2026-12-31"]);
	assert.deepEqual(by.last_quarter, ["2026-07-01", "2026-09-30"]);
	assert.deepEqual(by.last_6_months, ["2026-05-01", "2026-10-31"]);
	assert.deepEqual(by.fiscal_year, ["2026-04-01", "2027-03-31"]);
	assert.deepEqual(by.last_year, ["2025-04-01", "2026-03-31"]);
	assert.deepEqual(by.year_to_date, ["2026-04-01", "2026-10-07"]);
	assert.equal(list.filter((p) => p.sep).length, 2);
	// Monday first: the week starts on the Monday before
	const monday = preset_list("2026-10-07", { first_day: 1 }).find((p) => p.id === "week");
	assert.deepEqual([monday.from, monday.to], ["2026-10-05", "2026-10-11"]);
	// no fiscal year: calendar years
	const cal = preset_list("2026-10-07").find((p) => p.id === "fiscal_year");
	assert.deepEqual([cal.from, cal.to], ["2026-01-01", "2026-12-31"]);
	assert.equal(eom(2028, 1), "2028-02-29");
	assert.equal(days_between("2026-04-01", "2026-09-30"), 183);
});

test("fiscal parts: months of the fiscal year, and back from a range", () => {
	const fy = { name: "2026", from: "2026-04-01", to: "2027-03-31" };
	assert.deepEqual(fiscal_range(fy, 0, 11), ["2026-04-01", "2027-03-31"]);
	assert.deepEqual(fiscal_range(fy, 3, 5), ["2026-07-01", "2026-09-30"]);
	assert.deepEqual(fiscal_range(fy, 9, 11), ["2027-01-01", "2027-03-31"]);
	assert.deepEqual(fiscal_part_of(fy, "2026-07-01", "2026-09-30"), { m0: 3, m1: 5 });
	assert.equal(fiscal_part_of(fy, "2026-07-02", "2026-09-30"), null);
});

test("calendar grid: blanks before the first day, columns from the first weekday", () => {
	const apr = month_cells(2026, 3, 0);
	assert.equal(apr.filter((d) => d === null).length, 3); // 1 April 2026 is a Wednesday
	assert.equal(apr.at(-1), "2026-04-30");
	assert.equal(month_cells(2026, 3, 1).filter((d) => d === null).length, 2);
	assert.deepEqual(week_columns(6), [6, 0, 1, 2, 3, 4, 5]);
});
