// The Print Format form for a Custom format (ADR-019): HTML (with Jinja for the data) and
// CSS, nothing else; the data comes from the caller. Every other field of doctype and
// report formats is hidden, a help panel tells what the template reads and how a page
// prints with it, and a preview opens the print page with sample data the user may edit.

const CUSTOM = "Custom";
const TABLE_FORMAT = "Report View Table";
// fields of Frappe's own print (a doctype's or a report's) that a Custom format does not use
const NOT_FOR_CUSTOM = [
	"doc_type",
	"report",
	"custom_format",
	"print_format_type",
	"raw_printing",
	"raw_commands",
	"absolute_value",
	"print_format_help",
	"custom_html_help",
	"format_data",
	"align_labels_right",
	"show_section_headings",
	"line_breaks",
	"font",
	"standard",
	"module",
	"default_print_language",
	"section_break_9",
	"print_format_builder",
	"print_format_builder_beta",
	"margin_top",
	"margin_bottom",
	"margin_left",
	"margin_right",
	"font_size",
	"page_number",
	"pdf_generator",
	// other apps' fields on Print Format (SND Print, SND Data Hub): page setup and defaults of
	// their own print, not of the print page a Custom format opens in
	"page_size",
	"page_layout",
	"disable_pagination",
	"with_letterhead",
	"is_default",
	"preview_image",
	"section_break_custom",
	"col_break_custom",
];

const SAMPLE = {
	company: "",
	customer: "Acme Trading",
	date: "2026-10-21",
	rows: [
		{ item: "Paper A4", qty: 10, rate: 12.5, amount: 125 },
		{ item: "Toner", qty: 2, rate: 210, amount: 420 },
	],
	total: 545,
};

const TABLE_SAMPLE = {
	columns: [
		{ label: "Item", fieldname: "item", fieldtype: "Data" },
		{ label: "Qty", fieldname: "qty", fieldtype: "Int" },
		{ label: "Amount", fieldname: "amount", fieldtype: "Currency" },
	],
	rows: [
		{ item: "Paper A4", qty: 10, amount: 125 },
		["Toner", 2, 420],
	],
	totals: true,
	subtitle: "October 2026",
};

function is_custom(frm) {
	return frm.doc.print_format_for === CUSTOM;
}

function sample_for(frm) {
	const table = frm.doc.name === TABLE_FORMAT || /data\.columns/.test(frm.doc.html || "");
	return table ? TABLE_SAMPLE : { ...SAMPLE, company: frappe.defaults.get_user_default("Company") || "" };
}

function code(text) {
	return `<pre class="rv-cp-code"><code>${frappe.utils.escape_html(text)}</code></pre>`;
}

// the place of markup inside a translated sentence: the sentence is escaped, then the markup put in
const RV_CP_SLOT = "\u0000";
const rv_cp_esc = (s) => frappe.utils.escape_html(s);

function help_html(frm) {
	const name = frm.doc.name && !frm.is_new() ? frm.doc.name : "My Format";
	const n = JSON.stringify(name);
	const vars = [
		["data", __("The data as it was sent (an object or a list)")],
		["doc", __("The data when it is an object: {0}", ["doc.customer"])],
		["rows", __("The data when it is a list, or its «rows»")],
		["title", __("The title of the print")],
		["company", __("The data's company, else the user's default company")],
		["printed_by / printed_on", __("Who prints and when")],
		["lang", __("The language of the pages")],
		["_(), frappe.format(), frappe.utils", __("Frappe's Jinja, as in every print format")],
	];
	const rows = vars.map(([v, d]) => `<tr><td><code>${frappe.utils.escape_html(v)}</code></td><td>${frappe.utils.escape_html(d)}</td></tr>`).join("");
	return `<div class="rv-cp-help">
		<h5>${rv_cp_esc(__("A Custom print format"))}</h5>
		<p><b>${rv_cp_esc(__("It is HTML and CSS only: the HTML (with Jinja for the data) in the HTML field, the styles in the CSS field. The CSS reaches the printed content only, on screen and in the PDF."))}</b></p>
		<p>${rv_cp_esc(__("Its data does not come from a document or a report: the page or the method that prints sends it. The print page adds the paper, the letter head, the heading, the signature, the page numbers and the PDF."))}</p>
		<p>${rv_cp_esc(__("Text in the data prints HTML-escaped. The template is written once; any page can print with it."))}</p>
		<p>${rv_cp_esc(__("A page may also send its own template instead: {0}. It reads only the data sent; a template that looks records up is saved here.", [RV_CP_SLOT])).replace(RV_CP_SLOT, "<code>report_view.print({ html, css, data })</code>")}</p>
		<h6>${rv_cp_esc(__("What the template reads"))}</h6>
		<table class="rv-cp-vars"><tbody>${rows}</tbody></table>
		<h6>${rv_cp_esc(__("From a page, with the data"))}</h6>
		${code(`report_view.print({\n\tprint_format: ${n},\n\tdata: { customer: "Acme", rows: [{ item: "A", qty: 2 }] },\n\ttitle: "Delivery list",\n\t// letter_head, heading, signature, lang, open_in: "same" | "tab"\n});`)}
		<h6>${rv_cp_esc(__("From a page, with a method that returns the data"))}</h6>
		${code(`report_view.print({\n\tprint_format: ${n},\n\tmethod: "my_app.api.get_rows", // @frappe.whitelist(methods=["GET"])\n\targs: { from_date: "2026-01-01" },\n});`)}
		<h6>${rv_cp_esc(__("As an address (keeps the data live)"))}</h6>
		${code(`/desk/rv-print/Custom/${encodeURIComponent(name)}?method=my_app.api.get_rows&args={"from_date":"2026-01-01"}`)}
		<h6>${rv_cp_esc(__("From Python"))}</h6>
		${code(`from report_view.core.custom_print import print_url\n\n@frappe.whitelist()\ndef print_rows():\n\trows = frappe.get_list("ToDo", fields=["name", "description"])\n\treturn print_url(${n}, data={"rows": rows}, title=_("Open tasks"))\n\n# in the page: frappe.call("my_app.api.print_rows").then((r) => report_view.open_print(r.message));`)}
		<h6>${rv_cp_esc(__("Any table, without a template"))}</h6>
		${code(`report_view.print_table({\n\ttitle: "Stock",\n\tcolumns: [{ label: "Item", fieldname: "item" }, { label: "Qty", fieldname: "qty", fieldtype: "Float" }],\n\trows: [{ item: "A", qty: 2 }],\n\ttotals: true,\n});`)}
	</div>`;
}



function render_help(frm) {
	frm.$wrapper.find(".rv-cp-help").remove();
	if (!is_custom(frm)) return;
	// under the two fields a Custom format is made of: HTML, then CSS
	const field = frm.fields_dict.css || frm.fields_dict.html;
	if (field?.$wrapper) field.$wrapper.after(help_html(frm));
}

function preview(frm) {
	if (frm.is_new() || frm.is_dirty()) {
		frappe.msgprint(__("Save the print format first, then preview it."));
		return;
	}
	const dialog = new frappe.ui.Dialog({
		title: __("Preview with sample data"),
		size: "large",
		fields: [
			{
				fieldname: "data",
				fieldtype: "Code",
				options: "JSON",
				label: __("Data (JSON)"),
				default: JSON.stringify(sample_for(frm), null, 2),
				description: __("Paste the data a page would send; the print opens in a new tab."),
			},
			{ fieldname: "title", fieldtype: "Data", label: __("Title", null, "Report View"), default: __(frm.doc.name) },
		],
		primary_action_label: __("Preview"),
		primary_action(values) {
			let data;
			try {
				data = JSON.parse(values.data || "{}");
			} catch (e) {
				frappe.msgprint(__("The data is not valid JSON: {0}", [e.message]));
				return;
			}
			report_view.print({ print_format: frm.doc.name, data, title: values.title || null, open_in: "tab" }).then(() => dialog.hide());
		},
	});
	dialog.show();
}

// The fields' own visibility, as the doctype defines it (a Custom format hides them on its form only)
function meta_hidden(fieldname) {
	return frappe.get_meta("Print Format")?.fields.find((df) => df.fieldname === fieldname)?.hidden ? 1 : 0;
}

function apply(frm) {
	const custom = is_custom(frm);
	for (const f of NOT_FOR_CUSTOM) if (frm.fields_dict[f]) frm.set_df_property(f, "hidden", custom ? 1 : meta_hidden(f));
	frm.remove_custom_button(__("Preview with sample data"));
	if (custom && !frm.is_new() && window.report_view?.print) frm.add_custom_button(__("Preview with sample data"), () => preview(frm));
	render_help(frm);
}

frappe.ui.form.on("Print Format", {
	async refresh(frm) {
		// a Custom format saved before the server set its flags (or by a script): Frappe shows
		// the HTML section only with custom_format on, so the form sets them here too
		if (is_custom(frm) && !frm.doc.custom_format) {
			await frm.set_value({ custom_format: 1, standard: "No", print_format_type: "Jinja", raw_printing: 0 });
		}
		apply(frm);
	},
	async print_format_for(frm) {
		if (is_custom(frm)) {
			// as the server sets them (before_validate): a custom Jinja template
			await frm.set_value({ custom_format: 1, standard: "No", print_format_type: "Jinja", raw_printing: 0 });
		}
		apply(frm);
	},
	custom_format(frm) {
		// Frappe's own handler rebuilds the toolbar
		if (is_custom(frm)) apply(frm);
	},
});
