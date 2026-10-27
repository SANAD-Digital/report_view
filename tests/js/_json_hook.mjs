// The load hook of _json.mjs: a .json file imported without an attribute becomes a module
// whose default export is the parsed file. The same function serves both
// hook APIs: it returns what `next` returns, a value or a promise.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function load(url, context, next) {
	if (url.startsWith("file:") && url.endsWith(".json") && !context.importAttributes?.type) {
		return { format: "module", source: `export default ${fs.readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
	}
	return next(url, context);
}
