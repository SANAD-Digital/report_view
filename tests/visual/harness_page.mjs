// Visual harness page: renders the real Report View page (index.js, header, filters,
// toolbar, grid_view, status bar, the Perspective engine in its worker and the app CSS) with
// fixture data and stubbed Frappe. The page code itself comes from harness.mjs (sources) or
// from the bundle `bench build` produced (harness_built.mjs).
// URL parameters: report=tb|ar|ar_party|ar_jq|gl|gl_account, lang=ar|en, desk=light|dark (Desk theme), density=compact,
// pref=light|dark (Desk's theme as the page's theme button leaves it, ADR-022), group=<column key>[,<column key>],
// rows=N (repeat the report's rows up to about N, for performance checks), pipe=1 (the first
// voucher type of the general ledger gets a "|" in its name: Perspective's column path separator),
// pages=<JSON> (saved settings of the Pages view, e.g. {"orientation":"landscape"}),
// presets=<JSON> (print presets on the "server", ADR-020: [{name, preset_name, public, is_default,
// target, settings, owner}]), publish=0 (the user may not make presets public),
// rvs=<JSON> (the report's server settings, e.g. {"features":{"pivot":false}}, ADR-023).

const params = new URLSearchParams(window.location.search);
const which = params.get("report") || "tb";

const ROOT_TYPES = { 1: "Asset", 2: "Liability", 3: "Equity", 4: "Income", 5: "Expense" };

const REPORTS = {
	tb: {
		name: "Trial Balance",
		fixture: "trial_balance_fy2026.json",
		module: "Accounts",
		report_type: "Script Report",
		enrich_rules: [{ source_column: "account", link_doctype: "Account", fields: ["root_type", "account_type"] }],
		filters: (f) => [
			{ fieldname: "company", label: "Company", fieldtype: "Link", options: "Company", default: f.company, reqd: 1 },
			{ fieldname: "fiscal_year", label: "Fiscal Year", fieldtype: "Link", options: "Fiscal Year", default: f.fiscal_year, reqd: 1 },
			{ fieldname: "from_date", label: "From Date", fieldtype: "Date", default: f.from_date },
			{ fieldname: "to_date", label: "To Date", fieldtype: "Date", default: f.to_date },
			{ fieldname: "cost_center", label: "Cost Center", fieldtype: "MultiSelectList", options: "Cost Center", get_data: () => [] },
			{ fieldname: "finance_book", label: "Finance Book", fieldtype: "Link", options: "Finance Book" },
			{ fieldname: "presentation_currency", label: "Currency", fieldtype: "Select", options: "\nYER\nUSD" },
			{ fieldname: "with_period_closing_entry_for_opening", label: "With Period Closing Entry For Opening Balances", fieldtype: "Check", default: 1 },
			{ fieldname: "show_zero_values", label: "Show zero values", fieldtype: "Check" },
			{ fieldname: "show_net_values", label: "Show net values in opening and closing columns", fieldtype: "Check", default: 1 },
			{ fieldname: "show_group_accounts", label: "Show Group Accounts", fieldtype: "Check", default: 1 },
		],
		// Same shape as erpnext.financial_statements.formatter: the account column becomes a
		// link to the General Ledger, group accounts are bold.
		formatter(value, row, column, data, default_formatter) {
			if (data && column.fieldname === "account") {
				value = data.account_name || value;
				column.link_onclick = "void 0";
			}
			value = default_formatter(value, row, column, data);
			if (data && (!data.parent_account || data.is_group_account)) {
				value = `<p><span style="font-weight: bold">${value}</span></p>`;
			}
			return value;
		},
		enrich: (name) => ({ root_type: ROOT_TYPES[String(name)[0]] || null, account_type: null }),
	},
	ar: {
		name: "Accounts Receivable",
		fixture: "accounts_receivable_frappe_total.json",
		module: "Accounts",
		report_type: "Script Report",
		enrich_rules: [],
		filters: (f) => [
			{ fieldname: "company", label: "Company", fieldtype: "Link", options: "Company", default: f.company, reqd: 1 },
			{ fieldname: "report_date", label: "Posting Date", fieldtype: "Date", default: f.report_date },
			{ fieldname: "ageing_based_on", label: "Ageing Based On", fieldtype: "Select", options: "Posting Date\nDue Date", default: f.ageing_based_on },
			{ fieldname: "range", label: "Ageing Range", fieldtype: "Data", default: f.range },
			{ fieldname: "party_type", label: "Party Type", fieldtype: "Link", options: "Party Type", default: f.party_type },
			{ fieldname: "group_by_party", label: "Group By Customer", fieldtype: "Check" },
		],
		formatter: null,
	},
};
REPORTS.ar_party = { ...REPORTS.ar, fixture: "accounts_receivable_group_by_party.json" };
// A formatter in the style of snd_accounting's party reports: it wraps default_formatter's
// output with $(out), which needs the HTML query_report.js gives (a bare "100.00" or an
// Arabic name is read by jQuery as a selector and throws).
REPORTS.ar_jq = {
	...REPORTS.ar,
	formatter(value, row, column, data, default_formatter) {
		const out = default_formatter(value, row, column, data);
		if (data && column.fieldtype === "Currency") {
			return $(out).css("font-weight", "bold").wrap("<span></span>").parent().html();
		}
		if (data && column.fieldname === "party") return $(out).css("font-weight", "bold").wrap("<span></span>").parent().html();
		return out;
	},
};
REPORTS.gl = {
	name: "General Ledger",
	fixture: "general_ledger_consolidated.json",
	module: "Accounts",
	report_type: "Script Report",
	enrich_rules: [],
	filters: (f) => [
		{ fieldname: "company", label: "Company", fieldtype: "Link", options: "Company", default: f.company, reqd: 1 },
		{ fieldname: "from_date", label: "From Date", fieldtype: "Date", default: f.from_date, reqd: 1 },
		{ fieldname: "to_date", label: "To Date", fieldtype: "Date", default: f.to_date, reqd: 1 },
		{ fieldname: "account", label: "Account", fieldtype: "MultiSelectList", options: "Account", get_data: () => [] },
		{ fieldname: "categorize_by", label: "Categorize By", fieldtype: "Select", options: "\nCategorize by Voucher\nCategorize by Voucher (Consolidated)\nCategorize by Account\nCategorize by Party", default: f.categorize_by },
		{ fieldname: "include_default_book_entries", label: "Include Default FB Entries", fieldtype: "Check", default: f.include_default_book_entries },
	],
	formatter: null,
};
REPORTS.gl_account = { ...REPORTS.gl, fixture: "general_ledger_by_account.json" };

async function main() {
	const conf = REPORTS[which];
	const fixture = await (await fetch(`dist/${conf.fixture}`)).json();
	const input = fixture.input;
	window.RV_REPORT = conf.name;
	// rows=N (performance checks): the report's own rows repeated up to about N, its first
	// (opening) and last two (total, closing) rows kept once with their amounts scaled.
	const want = Number(params.get("rows")) || 0;
	if (want && Array.isArray(input.raw.result) && input.raw.result.length > 3) {
		const rows = input.raw.result;
		const body = rows.slice(1, -2);
		const k = Math.max(1, Math.ceil(want / body.length));
		const scale = (r) => {
			const out = { ...r };
			for (const key of ["debit", "credit", "debit_in_account_currency", "credit_in_account_currency"]) {
				if (typeof out[key] === "number") out[key] *= k;
			}
			return out;
		};
		const copies = [];
		for (let i = 0; i < k; i++) for (const r of body) copies.push(i ? { ...r, voucher_no: `${r.voucher_no}-${i}` } : r);
		// Rows as the server sends them, parsed from JSON: an object built key by key (a spread
		// lowered by the build, Object.assign) is a dictionary-mode object in V8, which makes
		// every pass over the rows several times slower than on the site.
		input.raw.result = JSON.parse(JSON.stringify([rows[0], ...copies, scale(rows[rows.length - 2]), scale(rows[rows.length - 1])]));
	}

	if (params.get("pipe") && Array.isArray(input.raw.result)) {
		const first = input.raw.result.find((r) => r && r.voucher_type)?.voucher_type;
		for (const r of input.raw.result) if (r && r.voucher_type === first) r.voucher_type = `${first.split(" ")[0]}|${first.split(" ").slice(1).join(" ") || "X"}`;
	}
	if (params.get("desk") === "dark") document.documentElement.setAttribute("data-theme", "dark");
	else document.documentElement.setAttribute("data-theme", "light");
	window.localStorage.clear();
	// Saved settings of the Pages view, as frappe.model.user_settings would return them.
	if (params.get("pages")) {
		frappe.model.user_settings.store[`Report View:${conf.name}`] = { pages: JSON.parse(params.get("pages")) };
	}
	if (params.get("density")) window.localStorage.setItem("report_view:density", params.get("density"));
	if (params.get("pref")) document.documentElement.setAttribute("data-theme", params.get("pref"));

	const settings = { ...input.report_settings, filters: conf.filters(input.filters) };
	if (conf.formatter) settings.formatter = conf.formatter;
	frappe.query_reports[conf.name] = settings;

	window.RV_SERVER = (method, args) => {
		if (method === "report_view.api.get_meta") {
			return {
				report: { name: conf.name, report_type: conf.report_type, module: conf.module },
				script: { script: "", filters: settings.filters },
				perms: { can_export: 1, can_print: 1 },
				// rvs=<JSON>: the report's Report View Settings as get_meta merges them
				// (features, default_mode, default_view; ADR-023)
				settings: { enabled: 1, enrich_rules: conf.enrich_rules, ...JSON.parse(params.get("rvs") || "{}") },
				include_js: [],
			};
		}
		if (method === "report_view.api.run") return { status: "ok", raw: input.raw };
		// Pages view: what the site offers a user who may print.
		if (method === "report_view.api.get_print_options") {
			return {
				letter_heads: [{ name: "SND Accounting", is_default: true }, { name: "Company Letterhead", is_default: false }],
				default_letter_head: "SND Accounting",
				print_formats: [],
				print_headings: ["Statement heading"],
				print_signatures: [{ name: "Finance approvals", content_type: "Table" }],
				languages: [{ name: "ar", label: "العربية" }, { name: "en", label: "English" }],
				lang: frappe.boot.lang,
				defaults: window.RV_PRINT_DEFAULTS || {},
				limits: { print_max_pages: 600 },
			};
		}
		// ADR-015: a heading and a signature as the server renders them (the filters inside)
		if (method === "report_view.api.render_print_heading") {
			const company = args.filters?.company || "";
			return { name: args.name, title: `Statement of ${company}`, html: `Prepared for the board<br>${company}` };
		}
		if (method === "report_view.api.render_print_signature") {
			const box = (t, p) => `<div class="rv-sig"><div class="rv-sig-t">${t}</div><div class="rv-sig-ln"><span>Name:</span>${p ? `<b>${p}</b>` : "<i></i>"}</div><div class="rv-sig-ln"><span>Signature:</span><i></i></div></div>`;
			return {
				name: args.name,
				type: "Table",
				html: `<div class="rv-sig-row" style="grid-template-columns:repeat(2,minmax(0,1fr))">${box("Prepared by", "Sara Ali")}${box("Approved by", "")}</div>`,
				css: ".rv-signature{.rv-sig-t{color:#8A2D3B}}",
			};
		}
		if (method === "report_view.api.get_print_format") throw new Error("harness: no print formats");
		if (method === "report_view.api.get_translations") {
			const dict = args.lang === "ar" ? window.RV_MESSAGES || {} : {};
			return Object.fromEntries(args.messages.filter((m) => dict[m]).map((m) => [m, dict[m]]));
		}
		if (method === "frappe.utils.print_format.render_letterhead_for_print") {
			return {
				header: `<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:6px"><div><div style="font-size:16px;font-weight:700">${args.letterhead}</div><div style="font-size:9px;color:#666">P.O. Box 1234 · Sana'a · +967 1 234 567</div></div><div style="width:46px;height:46px;border-radius:8px;background:#1E5C45"></div></div>`,
				footer: `<div style="text-align:center;font-size:8.5px;color:#666">${args.letterhead} · www.example.com · CR 1234567</div>`,
			};
		}
		if (method === "report_view.api.enrich") {
			const rows = {};
			for (const n of args.names) rows[n] = conf.enrich(n);
			const fields = {
				root_type: { fieldtype: "Select", options: "Asset\nLiability\nIncome\nExpense\nEquity", label: __("Root Type") },
				account_type: { fieldtype: "Select", options: "", label: __("Account Type") },
			};
			return { rows, fields, dropped_fields: [] };
		}
		// ADR-023: a row's details as the server renders the report's template with the row
		if (method === "report_view.api.render_row_details") {
			window.RV_ROW_CALLS = [...(window.RV_ROW_CALLS || []), JSON.parse(JSON.stringify(args))];
			const row = typeof args.row === "string" ? JSON.parse(args.row) : args.row;
			const text = (v) => String(v ?? "").replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
			return { html: `<h1 class="rd-t">${text(row.account_name || row.account)}</h1><p class="rd-v">${text(row.closing_debit)}</p>`, css: ".rd-t{font-size:18px}" };
		}
		if (method.startsWith("report_view.api.print_presets.")) return preset_server(method.split(".").pop(), args);
		throw new Error(`harness: no stub for ${method}`);
	};

	// ADR-020: the print presets as report_view.api.print_presets answers (privacy, defaults)
	const me = frappe.session.user;
	const can_publish = params.get("publish") !== "0";
	window.RV_PRESETS = JSON.parse(params.get("presets") || "[]").map((r, i) => ({ name: `pp-${i}`, owner: me, public: false, is_default: false, target: null, description: "", settings: {}, ...r }));
	let preset_seq = window.RV_PRESETS.length;
	const preset_row = (r) => ({
		name: r.name,
		preset_name: r.preset_name,
		public: r.public,
		is_default: r.is_default,
		context: "Report",
		target: r.target,
		specific: Boolean(r.target),
		description: r.description || "",
		settings: JSON.parse(JSON.stringify(r.settings)),
		can_edit: r.public ? can_publish : r.owner === me,
		owner_name: r.owner,
	});
	const preset_server = (fn, a) => {
		const store = window.RV_PRESETS;
		window.RV_PRESET_CALLS = [...(window.RV_PRESET_CALLS || []), { fn, args: a }];
		const visible = (r) => r.public || r.owner === me;
		const find = (name) => {
			const r = store.find((x) => x.name === name && visible(x));
			if (!r) throw new Error("harness: no such preset");
			return r;
		};
		const clear_defaults = (r) => {
			if (!r.is_default) return;
			for (const o of store) if (o !== r && o.is_default && o.public === r.public && (r.public || o.owner === r.owner) && o.target === r.target) o.is_default = false;
		};
		if (fn === "list_presets") {
			const rows = store.filter((r) => visible(r) && (!r.target || r.target === a.target)).map(preset_row);
			rows.sort((x, y) => Number(y.specific) - Number(x.specific) || x.preset_name.localeCompare(y.preset_name));
			return { mine: rows.filter((r) => !r.public), public: rows.filter((r) => r.public), can_publish };
		}
		if (fn === "save") {
			let r;
			if (a.name && !Number(a.as_new)) {
				r = find(a.name);
				if (!preset_row(r).can_edit) throw new Error("harness: not permitted");
			} else {
				r = { name: `pp-${preset_seq++}`, owner: me, public: false, is_default: false, target: Number(a.for_all) ? null : a.target, description: "", settings: {} };
				store.push(r);
			}
			if (a.preset_name !== undefined) r.preset_name = a.preset_name;
			if (a.settings !== undefined) r.settings = JSON.parse(a.settings);
			if (a.public !== undefined) r.public = Boolean(Number(a.public)) && can_publish;
			if (a.description !== undefined) r.description = a.description;
			if (a.is_default !== undefined) r.is_default = Boolean(Number(a.is_default));
			clear_defaults(r);
			return preset_row(r);
		}
		if (fn === "delete") {
			const r = find(a.name);
			store.splice(store.indexOf(r), 1);
			return { name: a.name };
		}
		if (fn === "set_default") {
			const r = find(a.name);
			r.is_default = Boolean(Number(a.value));
			clear_defaults(r);
			return preset_row(r);
		}
		throw new Error(`harness: no preset stub for ${fn}`);
	};

	const wrapper = document.getElementById("page-report-view");
	const main_el = wrapper.querySelector(".layout-main-section");
	const title_el = wrapper.querySelector(".page-head .title-text");
	wrapper.page = {
		main: $(main_el),
		page_actions: $(wrapper.querySelector(".page-actions")),
		set_title(t) {
			title_el.textContent = t;
		},
	};
	// The page starts here (tests/perf/measure.cjs measures the load from this mark).
	performance.mark("rv:page:start");
	const page = new report_view.ReportViewPage(wrapper);
	window.rv_page = page;
	page.show();
	// The table of the view state's mode: the grid, the pivot (rv with mode "pivot") or the pages.
	const shown = () =>
		page.opened &&
		((page.grid.current === page.opened && page.grid.rt) ||
			(page.state.mode === "pivot" && page.pivot.current && page.pivot.rt) ||
			(page.state.mode === "pages" && page.pages.current === page.opened && page.pages.pages.length && page.pages.filled.size));
	await wait_for(shown);
	const group = params.get("group");
	if (group) {
		page.controls.set_group(group.split(","));
		await wait_for(() => page.result?.mode === "group" && shown());
	}
	await window.rv_settle();
	document.body.dataset.ready = "1";
}

// What the tests read through a stable interface instead of the page's internals.
window.rv_test = {
	// the user settings the page saved for its report (the stub's store, under the page's own key)
	saved_settings: () => frappe.model.user_settings.store[window.rv_page.user_settings_key()],
};

// Resolves when the table has drawn everything that is pending.
window.rv_settle = async () => {
	const page = window.rv_page;
	if (page.state?.mode === "pages") {
		const v = page.pages;
		await v.ready;
		// every sheet on screen is filled: the IntersectionObserver reports them a little
		// later than the layout (later still on WebKit), so an empty queue alone is not enough
		const on_screen_empty = () => {
			const box = v.stage.getBoundingClientRect();
			return [...v.page_sheets()].some((el) => {
				const r = el.getBoundingClientRect();
				return r.bottom > box.top && r.top < box.bottom && !v.filled.has(Number(el.dataset.page));
			});
		};
		const start = Date.now();
		while (v.queue.length || v.filling.size || (on_screen_empty() && Date.now() - start < 10000)) await new Promise((r) => setTimeout(r, 30));
		await new Promise((r) => setTimeout(r, 150));
		return;
	}
	const rt = page.grid.rt || page.pivot.rt;
	await rt.draw();
	await rt.flush();
	await new Promise((r) => setTimeout(r, 150));
};

function wait_for(test, timeout = 20000) {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (test()) return resolve();
			if (Date.now() - start > timeout) return reject(new Error("harness: timeout"));
			setTimeout(tick, 30);
		};
		tick();
	});
}

export function start() {
	main().catch((e) => {
		document.body.dataset.error = String(e && e.stack ? e.stack : e);
		throw e;
	});
}
