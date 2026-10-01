// run.html?exp=<name>: loads the engine, imports ./<name>.js and stores its return value in window.__result.
import { load_perspective, params } from "./load.js";
const p = params();
const result = { ok: false, exp: p.exp };
try {
	const { perspective, client, timings } = await load_perspective({ mode: p.mode || "esm", worker: p.worker || "blob" });
	const mod = await import(`./${p.exp}.js`);
	Object.assign(result, await mod.default({ perspective, client, timings, params: p }));
	if (result.ok === false && !("failed" in result)) result.ok = true;
} catch (e) {
	result.ok = false;
	result.error = String((e && e.stack) || e);
}
window.__result = result;
document.getElementById("out").textContent = JSON.stringify(result, null, 1);
