// Visual harness page: renders the real Report View page (index.js, header, filters,
// toolbar, grid_view, status bar, the Perspective engine in its worker and the app CSS) with
// fixture data and stubbed Frappe. The page code itself comes from harness.mjs (sources) or
// from the bundle `bench build` produced (harness_built.mjs).
// URL parameters: report=tb|ar|ar_party|gl|gl_account, lang=ar|en, desk=light|dark (Desk theme), density=compact,
// pref=light|dark (the page's own theme button), group=<column key>[,<column key>].

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

	if (params.get("desk") === "dark") document.documentElement.setAttribute("data-theme", "dark");
	else document.documentElement.setAttribute("data-theme", "light");
	window.localStorage.clear();
	if (params.get("density")) window.localStorage.setItem("report_view:density", params.get("density"));
	if (params.get("pref")) window.localStorage.setItem("report_view:theme", params.get("pref"));

	const settings = { ...input.report_settings, filters: conf.filters(input.filters) };
	if (conf.formatter) settings.formatter = conf.formatter;
	frappe.query_reports[conf.name] = settings;

	window.RV_SERVER = (method, args) => {
		if (method === "report_view.api.get_meta") {
			return {
				report: { name: conf.name, report_type: conf.report_type, module: conf.module },
				script: { script: "", filters: settings.filters },
				perms: { can_export: 1, can_print: 1 },
				settings: { enabled: 1, enrich_rules: conf.enrich_rules },
				include_js: [],
			};
		}
		if (method === "report_view.api.run") return { status: "ok", raw: input.raw };
		if (method === "report_view.api.enrich") {
			const rows = {};
			for (const n of args.names) rows[n] = conf.enrich(n);
			const fields = {
				root_type: { fieldtype: "Select", options: "Asset\nLiability\nIncome\nExpense\nEquity", label: __("Root Type") },
				account_type: { fieldtype: "Select", options: "", label: __("Account Type") },
			};
			return { rows, fields, dropped_fields: [] };
		}
		throw new Error(`harness: no stub for ${method}`);
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
	const page = new report_view.ReportViewPage(wrapper);
	window.rv_page = page;
	page.show();
	const shown = () => page.opened && page.grid.current === page.opened && page.grid.rt;
	await wait_for(shown);
	const group = params.get("group");
	if (group) {
		page.controls.set_group(group.split(","));
		await wait_for(() => page.result?.mode === "group" && shown());
	}
	await window.rv_settle();
	document.body.dataset.ready = "1";
}

// Resolves when the table has drawn everything that is pending.
window.rv_settle = async () => {
	const rt = window.rv_page.grid.rt;
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
