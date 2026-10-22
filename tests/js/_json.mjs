// Loads `import X from "….json"` (no import attribute) as the bundles do: esbuild reads the
// JSON, node needs `with { type: "json" }`, which esbuild 0.14 of the bench cannot parse.
// Test files import this first, then import the modules under test with `await import()`,
// so the hook is in place before those modules are loaded. Not a test (no .test.mjs).
import { registerHooks } from "node:module";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
	load(url, context, next) {
		if (url.startsWith("file:") && url.endsWith(".json") && !context.importAttributes?.type) {
			return { format: "module", source: `export default ${fs.readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
		}
		return next(url, context);
	},
});
