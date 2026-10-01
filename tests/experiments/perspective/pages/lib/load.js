// Experiment helper: loads @finos/perspective 3.8.0 in several ways and reports timings.
// Used only by the experiment pages (phase 1, axis F). Not production code.
export const NM = "/assets/report_view/node_modules";
export const PSP = `${NM}/@finos/perspective/dist`;
export const SERVER_WASM = `${PSP}/wasm/perspective-server.wasm`;
export const CLIENT_WASM = `${PSP}/wasm/perspective-js.wasm`;
export const WORKER_JS = `${PSP}/cdn/perspective-server.worker.js`;

function load_classic_script(src) {
	return new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = src;
		s.onload = resolve;
		s.onerror = () => reject(new Error("script failed: " + src));
		document.head.appendChild(s);
	});
}

/**
 * @param {object} opts
 * @param {"esm"|"cdn"|"inline"|"bundle"} opts.mode
 * @param {"blob"|"url"} opts.worker  blob = worker inlined by perspective (Blob URL); url = same-origin worker file
 * @param {string} [opts.bundle]      URL of the Frappe-built IIFE bundle (mode=bundle)
 */
export async function load_perspective({ mode = "esm", worker = "blob", bundle = null } = {}) {
	const t = { mode, worker };
	const t0 = performance.now();
	let perspective;
	if (mode === "inline") {
		perspective = (await import(`${PSP}/esm/perspective.inline.js`)).default;
	} else if (mode === "cdn") {
		// cdn build calls init_server(fetch(new URL("../wasm/perspective-server.wasm", import.meta.url))) itself
		perspective = (await import(`${PSP}/cdn/perspective.js`)).default;
		perspective.init_client(fetch(CLIENT_WASM));
	} else if (mode === "bundle") {
		await load_classic_script(bundle);
		perspective = window.__rv_psp_probe;
		perspective.init_server(fetch(SERVER_WASM));
		perspective.init_client(fetch(CLIENT_WASM));
	} else {
		perspective = (await import(`${PSP}/esm/perspective.js`)).default;
		perspective.init_server(fetch(SERVER_WASM));
		perspective.init_client(fetch(CLIENT_WASM));
	}
	t.import_ms = performance.now() - t0;
	const t1 = performance.now();
	let client;
	if (worker === "url") {
		client = await perspective.worker(Promise.resolve(new Worker(WORKER_JS, { type: "module" })));
	} else {
		client = await perspective.worker();
	}
	t.worker_ms = performance.now() - t1;
	t.engine_ready_ms = performance.now() - t0;
	return { perspective, client, timings: t };
}

export function params() {
	return Object.fromEntries(new URLSearchParams(location.search).entries());
}
