// Shared normalisation cases: the JS adapter must give exactly the output that the
// Python twin (report_view/core/normalize.py) recorded in the fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalize } from "../../report_view/public/js/report_view/adapter/normalize.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../report_view/tests/fixtures/normalize");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];

test("fixture directory is not empty", () => {
	assert.ok(files.length > 0, `no fixtures in ${dir}`);
});

for (const file of files) {
	const fixture = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
	test(`normalize: ${fixture.name || file}`, () => {
		const out = normalize(structuredClone(fixture.input));
		// JSON round trip: the contract is JSON (no undefined, no functions).
		assert.deepEqual(JSON.parse(JSON.stringify(out)), fixture.expected);
	});
}
