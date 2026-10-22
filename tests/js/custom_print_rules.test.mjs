// The Custom print rules of the browser (custom_print_rules.js) are the server's
// (core/custom_print.py): the same token and method patterns, the same option keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { TOKEN, METHOD, OPTION_KEYS, TABLE_FORMAT } from "../../report_view/public/js/report_view/custom_print_rules.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PY = fs.readFileSync(path.join(HERE, "..", "..", "report_view", "core", "custom_print.py"), "utf8");
const py_regex = (name) => PY.match(new RegExp(`^${name} = re\\.compile\\(r"([^"]+)"\\)`, "m"))?.[1];

test("the token, the method and the option keys are the server's", () => {
	assert.equal(TOKEN.source, py_regex("_TOKEN"));
	assert.equal(METHOD.source, py_regex("_METHOD"));
	const keys = PY.match(/^_OPTION_KEYS = \(([^)]*)\)/m)[1].match(/"([a-z_]+)"/g).map((k) => k.slice(1, -1));
	assert.deepEqual([...OPTION_KEYS], keys);
	assert.ok(METHOD.test("my_app.api.get_rows") && !METHOD.test("get_rows") && !METHOD.test("a.b;c"));
	assert.ok(TOKEN.test("a".repeat(24)) && !TOKEN.test("A".repeat(24)));
	assert.match(fs.readFileSync(path.join(HERE, "..", "..", "report_view", "public", "js", "print_format_form.js"), "utf8"), new RegExp(`"${TABLE_FORMAT}"`));
});
