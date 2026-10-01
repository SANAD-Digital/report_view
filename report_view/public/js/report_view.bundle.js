// Loaded on demand by the report-view page (frappe.require), never on other pages.
// The JS of @finos/perspective (imported by engine/perspective_engine.js) and regular-table
// are bundled here; the two WASM files and the worker of Perspective are static assets of
// /assets/report_view/node_modules (docs/architecture.md §8أ.1).
import "regular-table";
import "./report_view/index.js";
import "./report_view/configs/trial_balance.js";
