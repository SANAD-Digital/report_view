// Every server call of the app's JavaScript (frappe.call, frappe.xcall, the wrappers around
// them, fetch of /api/method/…) against the `@frappe.whitelist(methods=[…])` of its target:
// a call with a verb the method refuses fails here, not first on a site (B5). The files of
// the letter head builder, the custom print and the presets are read like the others.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { http_methods, js_calls, python_whitelist } from "./_http_methods.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, "../..");
const all = http_methods(app);

test("every server call of the app is read (no way of calling the server the test does not know)", () => {
	assert.deepEqual(all.unknown, []);
	// the known callers are all there: the page's api.js, the document print, the presets,
	// the letter head builder, the custom print, the PDF of the pages (views/pages/output.js), the settings doctype
	const files = new Set(all.calls.map((c) => path.basename(c.file)));
	for (const f of ["api.js", "doc_print.js", "print_presets.js", "page.js", "custom_print.js", "output.js", "report_view_entry.bundle.js", "report_view_global_settings.js"]) {
		assert.ok(files.has(f), `no call read in ${f}`);
	}
	assert.ok(all.calls.length >= 40, `only ${all.calls.length} calls read`);
});

test("every call names a whitelisted method that exists", () => {
	const missing = all.calls.filter((c) => c.allowed === undefined).map((c) => `${c.file}:${c.line} ${c.method}`);
	assert.deepEqual(missing, []);
});

test("every call uses a verb its method allows", () => {
	const wrong = all.calls
		.filter((c) => c.allowed && !c.allowed.includes(c.verb))
		.map((c) => `${c.file}:${c.line} ${c.method} sends ${c.verb}, the server allows ${c.allowed.join("/")}`);
	assert.deepEqual(wrong, []);
});

test("the reader of the Python side: methods=[…] read per function, under other decorators", () => {
	const wl = python_whitelist(app, path.join(app, "report_view/api"));
	assert.deepEqual(wl.get("report_view.api.run").methods, ["POST"]);
	assert.deepEqual(wl.get("report_view.api.get_meta").methods, ["GET"]);
	assert.deepEqual(wl.get("report_view.api.pdf.pages_pdf_status").methods, ["GET"]);
	assert.ok(wl.has("report_view.api.chromium.engine_install"));
});

test("the reader of the JS side: verbs of every form, a wrong verb is seen, an unknown form is reported", () => {
	const src = `
const API = "report_view.api.letterhead";
const call = (method, args, type = "GET") => frappe.call({ method: \`\${API}.\${method}\`, args, type }).then((r) => r.message);
function rpc(method, args, { type = "GET" } = {}) {
	return frappe.call({ method, args, type, callback() {} });
}
// a comment: frappe.call({ method: "nothing.in.a.comment" })
const re = /["'(]/g;
call("builder_context", {});
call("preview", { layout: "{}" }, "POST");
rpc("report_view.api.run", {}, { type: "POST" });
rpc("report_view.api.get_meta", {});
frappe.call({ method: "report_view.api.enrich", args: {} });
frappe.call({ method: "report_view.api.get_print_format", type: "GET" });
frappe.xcall("report_view.api.chromium.engine_status", {}, "GET");
fetch(\`/api/method/report_view.api.pdf.pages_pdf_status?\${new URLSearchParams({ job })}\`, { headers: {} });
fetch("/api/method/report_view.api.pdf.pages_pdf_cancel", { method: "POST", body });
const url = "/api/method/report_view.api.get_entry_state";
fetch(url, { headers: {} });
frappe.call({ method: some.other.thing });
`;
	const { calls, unknown } = js_calls("sample.js", src);
	const got = calls.map((c) => `${c.verb} ${c.method}`);
	assert.deepEqual(got, [
		"POST report_view.api.enrich",
		"GET report_view.api.get_print_format",
		"GET report_view.api.chromium.engine_status",
		"GET report_view.api.letterhead.builder_context",
		"POST report_view.api.letterhead.preview",
		"POST report_view.api.run",
		"GET report_view.api.get_meta",
		"GET report_view.api.pdf.pages_pdf_status",
		"POST report_view.api.pdf.pages_pdf_cancel",
		"GET report_view.api.get_entry_state",
	]);
	assert.equal(unknown.length, 1);
	assert.match(unknown[0].why, /some\.other\.thing/);
});
