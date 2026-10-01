// Experiment 5: raw / gzip -9 / brotli (q11) sizes of every file the engine can load, plus what the site really sends.
// Usage: node tests/experiments/perspective/exp5_sizes.mjs [--base https://acc.dev.sanad.digital] [extra files...]
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const base = (process.argv.includes("--base") && process.argv[process.argv.indexOf("--base") + 1]) || "https://acc.dev.sanad.digital";
const P = "node_modules/@finos/perspective/dist";
const files = [
	`${P}/wasm/perspective-server.wasm`,
	`${P}/wasm/perspective-js.wasm`,
	`${P}/esm/perspective.js`,
	`${P}/cdn/perspective.js`,
	`${P}/cdn/perspective-server.worker.js`,
	`${P}/esm/perspective.inline.js`,
	"node_modules/regular-table/dist/esm/regular-table.js",
	...fs.readdirSync(path.join(root, "report_view/public/dist/js")).filter((f) => /probe.*\.js$/.test(f)).map((f) => `report_view/public/dist/js/${f}`),
];
const rows = [];
for (const f of files) {
	const buf = fs.readFileSync(path.join(root, f));
	const gz = zlib.gzipSync(buf, { level: 9 }).length;
	const br = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_LGWIN]: 24 } }).length;
	const url = f.startsWith("node_modules/") ? `${base}/assets/report_view/${f}` : `${base}/assets/report_view/${f.replace("report_view/public/", "")}`;
	let sent = "", enc = "";
	try {
		const out = execFileSync("curl", ["-sk", "-o", "/dev/null", "-H", "Accept-Encoding: gzip, deflate, br, zstd", "-w", "%{size_download} %header{content-encoding} %header{content-type}", url]).toString();
		[sent, enc] = [out.split(" ")[0], out.split(" ").slice(1).join(" ")];
	} catch (e) {
		sent = "curl failed";
	}
	rows.push({ file: f, raw: buf.length, gzip9: gz, brotli11: br, server_bytes: Number(sent), server_encoding_and_type: enc.trim() });
}
process.stdout.write("| file | raw | gzip -9 | brotli 11 | sent by site | Content-Encoding / Content-Type |\n|---|---:|---:|---:|---:|---|\n");
for (const r of rows) process.stdout.write(`| ${r.file} | ${r.raw} | ${r.gzip9} | ${r.brotli11} | ${r.server_bytes} | ${r.server_encoding_and_type} |\n`);
