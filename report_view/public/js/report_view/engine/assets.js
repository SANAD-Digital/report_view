// Static files of the engine, shared by the page (perspective_engine.js) and the entry
// button (report_view_entry.bundle.js), which fetches them ahead so that opening Report
// View finds them in the browser cache. Imports nothing: the entry bundle stays tiny.

// Must equal the pinned version in package.json (tests/js/engine.test.mjs checks it): it
// breaks the one-year cache of /assets on upgrade.
export const VERSION = "3.8.0";
// The files are the app's own (report_view/public/vendor/perspective, copies of the pinned
// package's dist/wasm and dist/cdn; tests/js/engine.test.mjs checks they are the same bytes):
// served wherever the app's public files are. Through node_modules they hung on the link
// bench build makes into the app's folder, which a server whose assets are served apart
// (containers) does not have: the WASM came back empty (production, 2026-11-16).
const BASE = "/assets/report_view/vendor/perspective";

export const SERVER_WASM = `${BASE}/perspective-server.wasm?v=${VERSION}`;
export const CLIENT_WASM = `${BASE}/perspective-js.wasm?v=${VERSION}`;
export const WORKER_JS = `${BASE}/perspective-server.worker.js?v=${VERSION}`;
