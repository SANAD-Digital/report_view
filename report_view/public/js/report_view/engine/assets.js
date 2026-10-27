// Static files of the engine, shared by the page (perspective_engine.js) and the entry
// button (report_view_entry.bundle.js), which fetches them ahead so that opening Report
// View finds them in the browser cache. Imports nothing: the entry bundle stays tiny.

// Must equal the pinned version in package.json (tests/js/engine.test.mjs checks it): it
// breaks the one-year cache of /assets on upgrade.
export const VERSION = "3.8.0";
const BASE = "/assets/report_view/node_modules/@finos/perspective/dist";

export const SERVER_WASM = `${BASE}/wasm/perspective-server.wasm?v=${VERSION}`;
export const CLIENT_WASM = `${BASE}/wasm/perspective-js.wasm?v=${VERSION}`;
export const WORKER_JS = `${BASE}/cdn/perspective-server.worker.js?v=${VERSION}`;
