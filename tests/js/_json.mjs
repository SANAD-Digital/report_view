// Loads `import X from "….json"` (no import attribute) as the bundles do: esbuild reads the
// JSON, node needs `with { type: "json" }`, which esbuild 0.14 of the bench cannot parse.
// Test files import this first, then import the modules under test with `await import()`,
// so the hook is in place before those modules are loaded. Not a test (no .test.mjs).
// Node 22.15+ has the synchronous registerHooks; Node 20 only the off-thread register(),
// which takes the same load hook from a module (_json_hook.mjs).
import * as node_module from "node:module";
import { load } from "./_json_hook.mjs";

if (node_module.registerHooks) {
	node_module.registerHooks({ load });
} else {
	node_module.register("./_json_hook.mjs", import.meta.url);
}
