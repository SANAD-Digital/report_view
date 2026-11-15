// What opens first and the choice a person makes against it (view_choice.js): the site's
// routes from Desk's boot, Frappe's own page chosen for one report or one print in a tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_setup.mjs";

// the tab's storage (sessionStorage), as a browser keeps it
const store = new Map();
globalThis.window = {
	location: { search: "?company=SND" },
	sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
};
globalThis.frappe = { boot: { report_view: { report_route: "report-view-a", print_route: "" } } };

const vc = await import("../../report_view/public/js/report_view/view_choice.js");

test("the site's choice comes from Desk's boot; none is Frappe's own page", () => {
	assert.equal(vc.default_report_route(), "report-view-a");
	assert.equal(vc.default_print_route(), "");
	const boot = globalThis.frappe.boot;
	globalThis.frappe.boot = {};
	assert.equal(vc.default_report_route(), "");
	globalThis.frappe.boot = boot;
});

test("Frappe's page chosen for one report or one print stays chosen in the tab, until dropped", () => {
	assert.equal(vc.stays_on_system("report", "General Ledger"), false);
	vc.stay_on_system("report", "General Ledger");
	vc.stay_on_system("print", "Sales Invoice/SINV-1");
	assert.equal(vc.stays_on_system("report", "General Ledger"), true);
	assert.equal(vc.stays_on_system("report", "Trial Balance"), false);
	assert.equal(vc.stays_on_system("print", "Sales Invoice/SINV-1"), true);
	// a report and a print of the same name are two choices
	assert.equal(vc.stays_on_system("print", "General Ledger"), false);
	vc.stay_on_system("report", "General Ledger", false);
	assert.equal(vc.stays_on_system("report", "General Ledger"), false);
	assert.equal(vc.stays_on_system("print", "Sales Invoice/SINV-1"), true);
});

test("without the tab's storage (a private window) nothing breaks and nothing is kept", () => {
	const saved = globalThis.window.sessionStorage;
	globalThis.window.sessionStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
	vc.stay_on_system("report", "X");
	assert.equal(vc.stays_on_system("report", "X"), false);
	globalThis.window.sessionStorage = saved;
});

test("a report's address on a page keeps the filters of the page left", () => {
	assert.equal(vc.report_url("report-view-c", "Accounts Receivable"), "/desk/report-view-c/Accounts%20Receivable?company=SND");
	assert.equal(vc.report_url("query-report", "A/B", ""), "/desk/query-report/A%2FB");
	assert.deepEqual(vc.REPORT_VIEWS.map((v) => v.route), ["report-view", "report-view-a", "report-view-c"]);
});
