// Visual harness entry (default): stubs of Frappe, the page from its sources, then the page.
import "./stubs.mjs";
import "../../report_view/public/js/report_view.bundle.js";
// The page loads it with frappe.require on first use of the Charts view.
import "../../report_view/public/js/report_view_charts.bundle.js";
// And the Pages view the first time it is used.
import "../../report_view/public/js/report_view_pages.bundle.js";
import { start } from "./harness_page.mjs";

start();
