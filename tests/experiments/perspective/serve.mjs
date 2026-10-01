// Minimal static server for the experiment pages (no dependencies).
// Mirrors the site URL layout so the same pages run locally and on the site:
//   /assets/report_view/experiments/data/* -> tests/experiments/perspective/data/*   (fixtures; never exposed on the site)
//   /assets/report_view/experiments/*      -> tests/experiments/perspective/pages/*
//   /assets/report_view/node_modules/*     -> node_modules/*
//   /assets/report_view/dist/*             -> report_view/public/dist/*
// Usage: node tests/experiments/perspective/serve.mjs [port]   (CSP=... env adds a Content-Security-Policy header)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const MAP = [
	["/assets/report_view/experiments/data/", path.join(here, "data")],
	["/assets/report_view/experiments/", path.join(here, "pages")],
	["/assets/report_view/node_modules/", path.join(root, "node_modules")],
	["/assets/report_view/dist/", path.join(root, "report_view/public/dist")],
];
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".json": "application/json",
	".css": "text/css",
	".wasm": "application/wasm",
	".map": "application/json",
};

export function start(port = 0, { csp = process.env.CSP || "" } = {}) {
	const server = http.createServer((req, res) => {
		const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
		for (const [prefix, dir] of MAP) {
			if (!url.startsWith(prefix)) continue;
			const file = path.join(dir, url.slice(prefix.length));
			if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) break;
			const headers = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" };
			if (csp && file.endsWith(".html")) headers["Content-Security-Policy"] = csp;
			res.writeHead(200, headers);
			fs.createReadStream(file).pipe(res);
			return;
		}
		res.writeHead(404);
		res.end("not found");
	});
	return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const server = await start(Number(process.argv[2] || 8765));
	process.stdout.write(`http://127.0.0.1:${server.address().port}/assets/report_view/experiments/\n`);
}
