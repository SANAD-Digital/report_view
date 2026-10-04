// Static server of the visual harness (no dependencies). Same URL layout as the site for
// what the engine loads at run time:
//   /assets/report_view/node_modules/* -> node_modules/*   (Perspective WASM files and worker)
//   /assets/report_view/dist/*         -> report_view/public/dist/*   (output of `bench build`)
//   /assets/assets.json                -> sites/assets/assets.json    (manifest of `bench build`)
//   /assets/frappe/*                   -> sites/assets/frappe/*       (fonts the desk CSS refers to)
//   /*                                 -> tests/visual/*   (harness.html, dist/)
// Usage: node tests/visual/serve.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const MAP = [
	["/assets/report_view/node_modules/", path.join(root, "node_modules")],
	["/assets/report_view/dist/", path.join(root, "report_view/public/dist")],
	["/assets/assets.json", path.resolve(root, "../../sites/assets/assets.json")],
	["/assets/frappe/", path.resolve(root, "../../sites/assets/frappe")],
	["/", here],
];
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".json": "application/json",
	".css": "text/css",
	".wasm": "application/wasm",
	".woff2": "font/woff2",
	".map": "application/json",
};

const port = Number(process.argv[2] || 8791);
http
	.createServer((req, res) => {
		const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
		for (const [prefix, dir] of MAP) {
			if (!url.startsWith(prefix)) continue;
			const file = path.join(dir, url.slice(prefix.length));
			if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
			res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
			fs.createReadStream(file).pipe(res);
			return;
		}
		res.writeHead(404);
		res.end("not found");
	})
	.listen(port, "127.0.0.1");
