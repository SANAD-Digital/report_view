// Row details (ADR-023): the config of the settings made complete, which columns of a row the
// panel shows and which of them become tiles, the document a row stands for, and the row as
// the server's template reads it (state/row_details.js); the formatting of a field
// (host/row_details_host.js field_html) through frappe.format.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./_setup.mjs";

const {
	row_details_config,
	detail_columns,
	pick_tiles,
	document_of,
	row_payload,
	columns_payload,
	DRAWER_WIDTHS,
} = await import("../../report_view/public/js/report_view/state/row_details.js");

const col = (key, extra = {}) => ({ key, fieldname: key, label: key, fieldtype: "Data", role: "dimension", hidden: false, ...extra });
const num = (key, extra = {}) => col(key, { fieldtype: "Currency", role: "measure", ...extra });

test("config: nothing from the server is a drawer of fields, on", () => {
	assert.deepEqual(row_details_config(undefined), { enabled: true, container: "drawer", width: "medium", content: "fields", print_format: null, document: null });
	assert.equal(DRAWER_WIDTHS.medium, 520);
});

test("config: the server's keys and the Select labels both read", () => {
	const server = row_details_config({ enabled: true, container: "dialog", width: "wide", content: "print_format", print_format: "Account summary", document: true, doc_fields: { doctype_field: "voucher_type", name_field: "voucher_no" } });
	assert.equal(server.container, "dialog");
	assert.equal(server.width, "wide");
	assert.equal(server.content, "print_format");
	assert.equal(server.print_format, "Account summary");
	assert.deepEqual(server.document, { doctype_field: "voucher_type", name_field: "voucher_no" });
	const labels = row_details_config({ enabled: 1, container: "Dialog", content: "HTML template", document: { doctype_field: "dt", name_field: "dn" } });
	assert.equal(labels.container, "dialog");
	assert.equal(labels.content, "html");
	assert.deepEqual(labels.document, { doctype_field: "dt", name_field: "dn" });
	assert.equal(row_details_config({ enabled: 0 }).enabled, false);
	assert.equal(row_details_config({ container: "Popup", content: "<script>", width: "huge" }).container, "drawer");
	assert.equal(row_details_config({ content: "nope" }).content, "fields");
	assert.equal(row_details_config({ width: "huge" }).width, "medium");
	// a document field that is not a fieldname is no document
	assert.equal(row_details_config({ document: { doctype_field: "a b", name_field: "x" } }).document, null);
	assert.equal(row_details_config({ document: true, doc_fields: null }).document, null);
});

// The grid's model of a Trial Balance (views/grid_rows.js build_model): the label, three bands
// of debit and credit columns.
const TB_COLUMNS = [
	col("account", { fieldtype: "Link", options: "Account", link: { kind: "static", doctype: "Account" } }),
	num("opening_debit"),
	num("opening_credit"),
	num("debit"),
	num("credit"),
	num("closing_debit"),
	num("closing_credit"),
	col("currency", { fieldtype: "Link", role: "attribute" }),
	col("parent_account", { hidden: true }),
	col("account__root_type", { enriched: { source: "account" } }),
];
const by_key = new Map(TB_COLUMNS.map((c) => [c.key, c]));
const d = (key, band, side, title) => ({ column: by_key.get(key), title, numeric: true, band, side });
const TB_MODEL = {
	label: by_key.get("account"),
	label_title: "Account",
	pinned: [],
	data: [
		d("opening_debit", "opening", "dr", "Debit"),
		d("opening_credit", "opening", "cr", "Credit"),
		d("debit", "period", "dr", "Debit"),
		d("credit", "period", "cr", "Credit"),
		d("closing_debit", "closing", "dr", "Debit"),
		d("closing_credit", "closing", "cr", "Credit"),
	],
	bands: new Map([
		["opening", { label: "Opening Balance" }],
		["period", { label: "Period Movement" }],
		["closing", { label: "Closing Balance" }],
	]),
};

test("columns: the table's order with their group, then the columns the user hid, never the report's hidden ones", () => {
	const cols = detail_columns(TB_MODEL, TB_COLUMNS);
	assert.deepEqual(
		cols.map((c) => c.label),
		[
			"Account",
			"Opening Balance · Debit",
			"Opening Balance · Credit",
			"Period Movement · Debit",
			"Period Movement · Credit",
			"Closing Balance · Debit",
			"Closing Balance · Credit",
			"currency",
			"account__root_type",
		]
	);
	assert.ok(!cols.some((c) => c.column.key === "parent_account"));
	assert.equal(cols[0].numeric, false);
	assert.equal(cols[1].numeric, true);
});

test("tiles: debit and credit columns, the closing and period ones before the opening ones, in the table's order", () => {
	const tiles = pick_tiles(detail_columns(TB_MODEL, TB_COLUMNS));
	assert.deepEqual(
		tiles.map((t) => t.column.key),
		["debit", "credit", "closing_debit", "closing_credit"]
	);
});

test("tiles: a balance column comes first", () => {
	const columns = [col("party"), num("opening_balance"), num("debit"), num("credit"), num("closing_balance"), num("qty", { fieldtype: "Float" })];
	const model = { label: columns[0], label_title: "Party", pinned: [], data: columns.slice(1).map((c) => ({ column: c, title: c.label, numeric: true })), bands: new Map() };
	const tiles = pick_tiles(detail_columns(model, columns));
	assert.deepEqual(
		tiles.map((t) => t.column.key),
		["opening_balance", "debit", "credit", "closing_balance"]
	);
});

test("tiles: without balance, debit or credit, the first numeric columns; none without numbers", () => {
	const columns = [col("item"), col("warehouse"), num("qty", { fieldtype: "Float" }), num("rate"), num("amount"), num("tax"), num("total")];
	const model = { label: columns[0], label_title: "Item", pinned: [], data: columns.slice(1).map((c) => ({ column: c, title: c.label, numeric: c.role === "measure" })), bands: new Map() };
	assert.deepEqual(
		pick_tiles(detail_columns(model, columns)).map((t) => t.column.key),
		["qty", "rate", "amount", "tax"]
	);
	const words = [col("a"), col("b")];
	const plain = { label: words[0], label_title: "A", pinned: [], data: [{ column: words[1], title: "B", numeric: false }], bands: new Map() };
	assert.deepEqual(pick_tiles(detail_columns(plain, words)), []);
});

test("tiles: Arabic labels of debit and credit count too", () => {
	const columns = [col("acc"), num("c1", { label: "مدين" }), num("c2", { label: "دائن" }), num("c3", { label: "الكمية" })];
	const model = { label: columns[0], label_title: "الحساب", pinned: [], data: columns.slice(1).map((c) => ({ column: c, title: c.label, numeric: true })), bands: new Map() };
	assert.deepEqual(
		pick_tiles(detail_columns(model, columns)).map((t) => t.column.key),
		["c1", "c2"]
	);
});

test("document: the settings' fields, else a label column that links one DocType", () => {
	const conf = row_details_config({ document: { doctype_field: "voucher_type", name_field: "voucher_no" } });
	assert.deepEqual(document_of(conf, { voucher_type: "Journal Entry", voucher_no: "JV-1" }, null), { doctype: "Journal Entry", name: "JV-1" });
	assert.equal(document_of(conf, { voucher_type: "", voucher_no: "JV-1" }, null), null);
	const none = row_details_config(null);
	assert.deepEqual(document_of(none, { account: "1310 - Debtors - SA" }, by_key.get("account")), { doctype: "Account", name: "1310 - Debtors - SA" });
	assert.equal(document_of(none, { party: "X" }, col("party", { link: { kind: "dynamic", doctype_key: "party_type" } })), null);
	assert.equal(document_of(none, { account: "" }, by_key.get("account")), null);
});

test("payload: the row by fieldname without the page's own keys; the visible columns", () => {
	const columns = [col("account"), num("debit"), col("debit__2", { fieldname: "debit" }), col("x", { hidden: true })];
	const row = { __rid: 4, __kind: "data", account: "Cash", debit: 5, debit__2: 7, x: 1 };
	assert.deepEqual(row_payload(row, columns), { account: "Cash", debit: 5, debit__2: 7, x: 1 });
	assert.deepEqual(
		columns_payload(columns).map((c) => c.fieldname),
		["account", "debit", "debit"]
	);
});

test("field_html: values go through frappe.format with the column's own options; empty stays empty", async () => {
	const calls = [];
	globalThis.frappe = {
		format: (value, df, opts, row) => {
			calls.push({ value, df, opts, row });
			return `<fmt>${value}</fmt>`;
		},
		utils: { escape_html: (s) => String(s).replace(/</g, "&lt;") },
	};
	const { field_html } = await import("../../report_view/public/js/report_view/host/row_details_host.js");
	const c = num("debit", { fieldtype: "Currency", original: { fieldname: "debit", fieldtype: "currency", options: "currency", precision: 3 } });
	const row = { debit: -12.5, currency: "YER" };
	assert.equal(field_html(c, row), "<fmt>-12.5</fmt>");
	assert.equal(calls[0].df.fieldtype, "Currency");
	assert.equal(calls[0].df.options, "currency");
	assert.equal(calls[0].df.precision, 3);
	assert.deepEqual(calls[0].opts, { inline: true, always_show_decimals: true });
	assert.equal(calls[0].row, row);
	assert.equal(field_html(c, { debit: null }), "");
	assert.equal(field_html(col("tags"), { tags: ["a", "<b>"] }), "a, &lt;b>");
});
