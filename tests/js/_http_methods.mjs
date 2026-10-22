// The HTTP verb of every server call of the app's JavaScript, and the verbs the Python side
// allows (`@frappe.whitelist(methods=[...])`). Shared by tests/js/http_methods.test.mjs and
// the visual harness (tests/visual/build.mjs writes the table the frappe.call stub checks).
// A call with a verb its method refuses passes every test that stubs the server and fails
// on a site only: this keeps the two sides in step.
import fs from "node:fs";
import path from "node:path";

const VERBS = new Set(["GET", "POST", "PUT", "DELETE"]);
// Frappe's frappe.call and frappe.xcall send POST unless told otherwise (request.js).
const FRAPPE_DEFAULT = "POST";

// ------------------------------------------------------------------------------- Python

/** The module path of a Python file of an app ("report_view/api/pdf.py" → "report_view.api.pdf"). */
function module_of(app_dir, file) {
	const rel = path.relative(app_dir, file).replace(/\.py$/, "").split(path.sep);
	if (rel.at(-1) === "__init__") rel.pop();
	return rel.join(".");
}

/**
 * The whitelisted functions of the Python files under `dir` (an app's package), by dotted
 * path: the verbs `methods=` allows, or null (Frappe's default: every verb).
 * @returns {Map<string, {methods: string[]|null, file: string, line: number}>}
 */
export function python_whitelist(app_dir, dir = app_dir) {
	const out = new Map();
	const walk = (d) => {
		for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, ent.name);
			if (ent.isDirectory()) {
				if (!["node_modules", "__pycache__", "public", "tests"].includes(ent.name)) walk(p);
			} else if (ent.name.endsWith(".py")) read_py(p);
		}
	};
	const read_py = (file) => {
		const lines = fs.readFileSync(file, "utf8").split("\n");
		const mod = module_of(app_dir, file);
		for (let i = 0; i < lines.length; i++) {
			const m = /^\s*@frappe\.whitelist\((.*)\)\s*$/.exec(lines[i]);
			if (!m) continue;
			let j = i + 1;
			while (j < lines.length && /^\s*(@|$)/.test(lines[j])) j += 1;
			const def = /^\s*(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[j] || "");
			if (!def) continue;
			const list = /methods\s*=\s*[[(]([^\])]*)[\])]/.exec(m[1]);
			const single = /methods\s*=\s*["'](\w+)["']/.exec(m[1]);
			const methods = list ? [...list[1].matchAll(/["'](\w+)["']/g)].map((x) => x[1].toUpperCase()) : single ? [single[1].toUpperCase()] : null;
			out.set(`${mod}.${def[1]}`, { methods, file, line: i + 1 });
		}
		// a module-level alias of a whitelisted function (`list = list_presets`) is the same function
		for (let i = 0; i < lines.length; i++) {
			const a = /^(\w+)\s*=\s*(\w+)\s*(?:#.*)?$/.exec(lines[i]);
			const target = a && out.get(`${mod}.${a[2]}`);
			if (target) out.set(`${mod}.${a[1]}`, { ...target, line: i + 1, alias_of: a[2] });
		}
	};
	walk(dir);
	return out;
}

/** The whitelist entry of a dotted path of another app of the bench (frappe.utils.x.fn), or null. */
export function bench_whitelist(apps_dir, dotted) {
	const parts = dotted.split(".");
	const app = parts[0];
	const app_dir = path.join(apps_dir, app);
	const mod = parts.slice(0, -1);
	for (const file of [path.join(app_dir, ...mod) + ".py", path.join(app_dir, ...mod, "__init__.py")]) {
		if (fs.existsSync(file)) return python_whitelist(app_dir, path.dirname(file)).get(dotted) || null;
	}
	return null;
}

// --------------------------------------------------------------------------- JavaScript

/**
 * The source with its comments blanked (offsets kept), and a map telling, for every offset,
 * whether it stands inside a string or template literal. Regular expression literals are
 * told from a division by the token before them (enough for this code base).
 */
function scan(src) {
	const out = src.split("");
	const in_str = new Uint8Array(src.length);
	let i = 0;
	let last = "";
	const tpl = [];
	const regex_ok = () => last === "" || /[(,=:[!&|?{};+\-*%<>~^]$/.test(last) || /\b(return|typeof|case|in|of|delete|void)$/.test(last);
	const string = (q) => {
		const start = i++;
		while (i < src.length && src[i] !== q) {
			if (src[i] === "\\") i += 1;
			else if (src[i] === "\n") break;
			i += 1;
		}
		in_str.fill(1, start, i + 1);
		i += 1;
		last = "x";
	};
	// the body of a template literal, from `i` (after its backtick, or after a `}` closing ${…})
	const template = () => {
		while (i < src.length) {
			if (src[i] === "\\") {
				in_str.fill(1, i, i + 2);
				i += 2;
				continue;
			}
			if (src[i] === "`") {
				in_str[i] = 1;
				i += 1;
				last = "x";
				return;
			}
			if (src[i] === "$" && src[i + 1] === "{") {
				in_str.fill(1, i, i + 2);
				i += 2;
				tpl.push(0);
				last = "{";
				return;
			}
			in_str[i] = 1;
			i += 1;
		}
	};
	while (i < src.length) {
		const c = src[i];
		const n = src[i + 1];
		if (c === "/" && n === "/") {
			while (i < src.length && src[i] !== "\n") out[i++] = " ";
			continue;
		}
		if (c === "/" && n === "*") {
			const end = src.indexOf("*/", i + 2);
			const stop = end < 0 ? src.length : end + 2;
			for (; i < stop; i++) if (src[i] !== "\n") out[i] = " ";
			continue;
		}
		if (c === '"' || c === "'") {
			string(c);
			continue;
		}
		if (c === "`") {
			in_str[i] = 1;
			i += 1;
			template();
			continue;
		}
		if (c === "/" && regex_ok()) {
			const start = i;
			i += 1;
			let cls = false;
			while (i < src.length && src[i] !== "\n") {
				if (src[i] === "\\") i += 1;
				else if (src[i] === "[") cls = true;
				else if (src[i] === "]") cls = false;
				else if (src[i] === "/" && !cls) break;
				i += 1;
			}
			i += 1;
			while (/[a-z]/.test(src[i] || "")) i += 1;
			in_str.fill(1, start, i);
			last = "x";
			continue;
		}
		if (tpl.length && (c === "{" || c === "}")) {
			if (c === "{") tpl[tpl.length - 1] += 1;
			else if (tpl[tpl.length - 1] === 0) {
				tpl.pop();
				in_str[i] = 1;
				i += 1;
				template();
				continue;
			} else tpl[tpl.length - 1] -= 1;
		}
		if (!/\s/.test(c)) last = /\w/.test(c) ? (/\w/.test(last.slice(-1)) ? last + c : c) : c;
		i += 1;
	}
	return { code: out.join(""), in_str };
}

/** The text between the parenthesis at `open` and the one that closes it (strings skipped). */
function args_at(code, in_str, open) {
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		if (in_str[i]) continue;
		const c = code[i];
		if (c === "(" || c === "[" || c === "{") depth += 1;
		else if (c === ")" || c === "]" || c === "}") {
			depth -= 1;
			if (depth === 0) return { text: code.slice(open + 1, i), start: open + 1, end: i };
		}
	}
	return null;
}

/** The top-level parts of an argument list, as [text, offset]. */
function split_top(text, in_str, offset) {
	const parts = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < text.length; i++) {
		if (in_str[offset + i]) continue;
		const c = text[i];
		if ("([{".includes(c)) depth += 1;
		else if (")]}".includes(c)) depth -= 1;
		else if (c === "," && depth === 0) {
			parts.push([text.slice(from, i), offset + from]);
			from = i + 1;
		}
	}
	if (text.slice(from).trim()) parts.push([text.slice(from), offset + from]);
	return parts.map(([t, o]) => [t.trim(), o + (t.length - t.trimStart().length)]);
}

const literal = (t) => {
	const m = /^(["'])([^"'`$]*)\1$/.exec(t) || /^`([^`$]*)`$/.exec(t);
	return m ? m[m.length - 1] : null;
};
const verb_of = (t) => {
	const v = literal(t || "");
	return v && VERBS.has(v.toUpperCase()) ? v.toUpperCase() : null;
};
/** `type: "POST"` (or `method: "POST"` of fetch) at the top level of an object literal. */
function prop_of(obj_text, name) {
	if (!/^\{[\s\S]*\}$/.test(obj_text)) return undefined;
	const re = new RegExp(`(?:^|[,{\\s])${name}\\s*:\\s*`);
	const m = re.exec(obj_text);
	if (m) {
		// the value up to the next comma or brace of the object (strings and ${…} kept whole)
		const { code, in_str } = scan(obj_text);
		let depth = 0;
		let i = m.index + m[0].length;
		const from = i;
		for (; i < obj_text.length; i++) {
			if (in_str[i]) continue;
			const c = code[i];
			if ("([{".includes(c)) depth += 1;
			else if (")]}".includes(c)) {
				if (depth === 0) break;
				depth -= 1;
			} else if (c === "," && depth === 0) break;
		}
		return obj_text.slice(from, i).trim();
	}
	// shorthand `{ method, args, type }`
	if (new RegExp(`(?:^|[,{\\s])${name}\\s*[,}]`).test(obj_text)) return name;
	return undefined;
}

const line_of = (src, idx) => src.slice(0, idx).split("\n").length;

/** The function that holds offset `idx`: its name and its parameter list (nearest head before it). */
function enclosing_function(code, idx) {
	const head = /(?:(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>|(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)|^\s*(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{)/gm;
	const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "with", "return", "function"]);
	let found = null;
	let m;
	while ((m = head.exec(code)) && m.index < idx) {
		const name = m[1] || m[3] || m[5];
		if (!KEYWORDS.has(name)) found = { name, params: m[2] ?? m[4] ?? m[6] ?? "" };
	}
	return found;
}

/**
 * Every server call of a JavaScript file: {method, verb, line, via}; wrappers (a function of
 * the file around frappe.call) are followed to their calls. `unknown` lists what could not
 * be read (a new way of calling the server): the test fails on it rather than miss a call.
 * @param {object} [o]
 * @param {Set<string>} [o.dynamic] functions whose method comes from their caller (allowed)
 * @param {Map<string, string[]>} [o.targets] methods a `${x.method}` URL can stand for
 */
export function js_calls(file, src, { dynamic = new Set(), targets = new Map() } = {}) {
	const { code, in_str } = scan(src);
	const calls = [];
	const unknown = [];
	const consts = new Map([...code.matchAll(/(?:const|let)\s+(\w+)\s*=\s*["'`]([\w.]+)["'`]/g)].map((m) => [m[1], m[2]]));
	const wrappers = new Map();
	const add = (method, verb, idx, via) => calls.push({ file, method, verb, line: line_of(src, idx), via });
	const odd = (idx, why) => unknown.push({ file, line: line_of(src, idx), why });

	// frappe.call({...}) / frappe.call("m", args) / frappe.xcall("m", args, verb)
	for (const m of code.matchAll(/\bfrappe\.(x?call)\s*\(/g)) {
		if (in_str[m.index]) continue;
		const a = args_at(code, in_str, m.index + m[0].length - 1);
		if (!a) {
			odd(m.index, "unbalanced call");
			continue;
		}
		const parts = split_top(src.slice(a.start, a.end), in_str, a.start);
		const first = parts[0]?.[0] || "";
		if (m[1] === "xcall" || !first.startsWith("{")) {
			const name = literal(first);
			const verb = m[1] === "xcall" ? verb_of(parts[2]?.[0]) || FRAPPE_DEFAULT : FRAPPE_DEFAULT;
			if (name) add(name, verb, m.index, `frappe.${m[1]}`);
			else wrap_or_dynamic(m.index, first, verb, null);
			continue;
		}
		const method = prop_of(first, "method");
		const type = prop_of(first, "type");
		const name = literal(method || "");
		const fixed = type === undefined ? FRAPPE_DEFAULT : verb_of(type);
		if (name) {
			if (!fixed) odd(m.index, `verb of ${name} is not a literal`);
			else add(name, fixed, m.index, "frappe.call");
			continue;
		}
		wrap_or_dynamic(m.index, method || "", fixed, type);
	}

	// a function of the file that calls frappe.call with a method of its caller
	function wrap_or_dynamic(idx, method, fixed, type) {
		const fn = enclosing_function(code, idx);
		const prefix = /^`\$\{(\w+)\}\.\$\{\w+\}`$/.exec(method);
		const param = /^\w+$/.test(method) ? method : prefix ? /\$\{(\w+)\}`$/.exec(method)[1] : null;
		if (!fn || !param || !new RegExp(`\\b${param}\\b`).test(fn.params.split(",")[0] || "")) {
			if (fn && dynamic.has(fn.name)) return;
			odd(idx, `method ${method} is neither a literal nor its function's first parameter`);
			return;
		}
		// the verb: fixed in the call, or the function's parameter with its default
		let def = fixed;
		let verb_param = null;
		if (!fixed && type) {
			const t = new RegExp(`\\b${type}\\s*=\\s*["'](\\w+)["']`).exec(fn.params);
			def = t ? t[1].toUpperCase() : FRAPPE_DEFAULT;
			verb_param = type;
		}
		wrappers.set(fn.name, { prefix: prefix ? `${consts.get(prefix[1])}.` : "", def, verb_param, params: fn.params });
	}

	// the calls of the wrappers: call("name", args[, "POST" | { type: "POST" }])
	for (const [name, w] of wrappers) {
		for (const m of code.matchAll(new RegExp(`(?<![.\\w])${name}\\s*\\(`, "g"))) {
			if (in_str[m.index]) continue;
			const before = code.slice(Math.max(0, m.index - 12), m.index);
			if (/function\s+$/.test(before)) continue;
			const a = args_at(code, in_str, m.index + m[0].length - 1);
			if (!a) continue;
			const parts = split_top(src.slice(a.start, a.end), in_str, a.start);
			const lit = literal(parts[0]?.[0] || "");
			if (!lit) {
				// the wrapper's own head, or a method of the caller (allowed by name)
				const fn = enclosing_function(code, m.index);
				if (code.slice(m.index - 30, m.index).match(/(const|let|var)\s+$|=\s*$/) && !parts.length) continue;
				if (fn && (fn.name === name || dynamic.has(fn.name))) continue;
				odd(m.index, `${name}(${parts[0]?.[0]}) has no literal method`);
				continue;
			}
			let verb = w.def;
			for (const [t] of parts.slice(2)) verb = verb_of(t) || verb_of(prop_of(t, "type")) || verb;
			add(w.prefix + lit, verb, m.index, name);
		}
	}

	// fetch("/api/method/…", {method: "POST"}): GET unless the options say otherwise
	for (const m of src.matchAll(/\/api\/method\/(\$\{([\w.]+)\}|[\w.]+)/g)) {
		if (!in_str[m.index]) continue;
		// the literal holding it, then the fetch it is passed to (directly or by a name)
		let s = m.index;
		while (s > 0 && in_str[s - 1]) s -= 1;
		const before = code.slice(Math.max(0, s - 40), s);
		let opts = null;
		const direct = /fetch\s*\(\s*$/.exec(before);
		if (direct) {
			const b = args_at(code, in_str, code.lastIndexOf("(", s));
			opts = split_top(src.slice(b.start, b.end), in_str, b.start)[1]?.[0] || null;
		} else {
			const named = /(?:const|let)\s+(\w+)\s*=\s*$/.exec(before);
			if (!named) {
				odd(m.index, "an /api/method/ address that is not fetched directly or by a name");
				continue;
			}
			const use = new RegExp(`\\bfetch\\s*\\(\\s*${named[1]}\\b`).exec(code.slice(s));
			if (!use) {
				odd(m.index, `${named[1]} is never fetched`);
				continue;
			}
			const open = s + use.index + use[0].indexOf("(");
			const b = args_at(code, in_str, open);
			opts = split_top(src.slice(b.start, b.end), in_str, b.start)[1]?.[0] || null;
		}
		const verb = (opts && verb_of(prop_of(opts, "method"))) || "GET";
		if (m[2]) {
			const list = targets.get(m[2]);
			if (!list) {
				odd(m.index, `an /api/method/\${${m[2]}} address with no known targets`);
				continue;
			}
			for (const t of list) add(t, verb, m.index, `fetch \${${m[2]}}`);
			continue;
		}
		add(m[1], verb, m.index, "fetch");
	}
	return { calls, unknown };
}

/** The `method: "…"` strings returned by the functions named `fn` (a host's pages_pdf_target). */
export function returned_methods(sources, fn) {
	const out = [];
	for (const src of sources) {
		const { code, in_str } = scan(src);
		for (const m of code.matchAll(new RegExp(`(?:^|\\s)${fn}\\s*\\([^)]*\\)\\s*\\{`, "gm"))) {
			const open = m.index + m[0].length - 1;
			const body = args_at(code, in_str, open);
			if (!body) continue;
			for (const x of src.slice(body.start, body.end).matchAll(/method:\s*["']([\w.]+)["']/g)) out.push(x[1]);
		}
	}
	return out;
}

/** The JavaScript files of the app that may call its server (sources, not the built bundles). */
export function app_js_files(app_dir) {
	const out = [];
	const walk = (d) => {
		for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, ent.name);
			if (ent.isDirectory()) {
				if (!["node_modules", "dist", "__pycache__"].includes(ent.name)) walk(p);
			} else if (ent.name.endsWith(".js")) out.push(p);
		}
	};
	walk(path.join(app_dir, "report_view"));
	return out.sort();
}

/**
 * The whole picture: every call of the app's JavaScript with the verbs its target allows.
 * @returns {{calls: object[], unknown: object[], table: Record<string, string[]|null>}}
 */
export function http_methods(app_dir) {
	const apps_dir = path.dirname(app_dir);
	const files = app_js_files(app_dir);
	const sources = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));
	const targets = new Map([["target.method", returned_methods([...sources.values()], "pages_pdf_target")]]);
	// functions that call a method named by their caller (a Custom print's data method)
	const dynamic = {
		"report_view/public/js/report_view/custom_print.js": ["print"],
		"report_view/public/js/report_view/doc_print.js": ["load"],
	};
	const whitelist = python_whitelist(app_dir, path.join(app_dir, "report_view"));
	const calls = [];
	const unknown = [];
	for (const [file, src] of sources) {
		const rel = path.relative(app_dir, file);
		const r = js_calls(rel, src, { dynamic: new Set(dynamic[rel] || []), targets });
		calls.push(...r.calls);
		unknown.push(...r.unknown);
	}
	const table = {};
	for (const [k, v] of whitelist) table[k] = v.methods;
	for (const c of calls) {
		if (!(c.method in table)) {
			const other = c.method.startsWith("report_view.") ? null : bench_whitelist(apps_dir, c.method);
			if (other) table[c.method] = other.methods;
		}
		c.allowed = c.method in table ? table[c.method] : undefined;
	}
	return { calls, unknown, table };
}
