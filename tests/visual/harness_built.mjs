// Visual harness entry for `?built=1`: stubs of Frappe only. harness.html then loads the
// report_view.bundle.js that `bench build` wrote (sites/assets/assets.json) and calls
// rv_start(), so the artifact the site serves is what runs.
import "./stubs.mjs";
import { start } from "./harness_page.mjs";

window.rv_start = start;
