// The Frappe globals the front-end modules read when they are imported or called in node:
// `__` with Frappe's {0} placeholders. Test files import it before the modules under test
// (`await import()`). Not a test (no .test.mjs).
globalThis.__ ??= (s, args) => String(s).replace(/\{(\d+)\}/g, (m, i) => (args && args[i] !== undefined ? args[i] : m));
