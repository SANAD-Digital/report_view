// The criteria bar plan: what stands on the line, what is behind More options (filters/criteria.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { plan_criteria } from "../../report_view/public/js/report_view/filters/criteria.js";

test("criteria bar: company and period on the line, required filters never hidden, the rest behind More options", () => {
	const tb = plan_criteria([
		{ fieldname: "company", fieldtype: "Link", reqd: 1 },
		{ fieldname: "fiscal_year", fieldtype: "Link", reqd: 1 },
		{ fieldname: "from_date", fieldtype: "Date" },
		{ fieldname: "to_date", fieldtype: "Date" },
		{ fieldname: "cost_center", fieldtype: "MultiSelectList" },
		{ fieldname: "show_zero_values", fieldtype: "Check" },
	]);
	assert.equal(tb.has_period, true);
	assert.deepEqual(Object.fromEntries(tb.place), {
		company: "main",
		fiscal_year: "period",
		from_date: "period",
		to_date: "period",
		cost_center: "more",
		show_zero_values: "more",
	});
	const ar = plan_criteria([
		{ fieldname: "company", fieldtype: "Link", reqd: 1 },
		{ fieldname: "report_date", fieldtype: "Date" },
		{ fieldname: "party_type", fieldtype: "Link", reqd: 1 },
		{ fieldname: "range", fieldtype: "Data" },
	]);
	assert.equal(ar.has_period, false);
	assert.deepEqual(Object.fromEntries(ar.place), { company: "main", report_date: "main", party_type: "main", range: "more" });
});

test("criteria bar: hidden filters stay hidden; a Timespan the dates depend on belongs to the period", () => {
	// Shape of snd_accounting's party balance reports (Customer Trial Balance).
	const snd = plan_criteria([
		{ fieldname: "company", fieldtype: "Link", reqd: 1 },
		{ fieldname: "timespan", fieldtype: "Select", reqd: 1, default: "Select Date Range" },
		{ fieldname: "from_date", fieldtype: "Date", depends_on: "eval:doc.timespan == 'Select Date Range'" },
		{ fieldname: "to_date", fieldtype: "Date", depends_on: "eval:doc.timespan == 'Select Date Range'" },
		{ fieldname: "party_type", fieldtype: "Link", read_only: 1, hidden: 1 },
		{ fieldname: "party_name", fieldtype: "Data", hidden: 1 },
		{ fieldname: "party", fieldtype: "MultiSelectList" },
	]);
	assert.deepEqual(snd.range, { key: "timespan", value: "Select Date Range" });
	assert.deepEqual(Object.fromEntries(snd.place), {
		company: "main",
		timespan: "period",
		from_date: "period",
		to_date: "period",
		party_type: "hidden",
		party_name: "hidden",
		party: "more",
	});
});
