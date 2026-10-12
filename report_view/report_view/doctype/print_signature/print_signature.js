// Print Signature (ADR-015): the help of the HTML and Jinja template, in the user's
// language, and the report/document links that follow the type.

frappe.ui.form.on("Print Signature", {
	refresh(frm) {
		frm.set_query("report", () => ({ filters: { disabled: 0 } }));
		frm.set_query("reference_doctype", () => ({ filters: { istable: 0, issingle: 0 } }));
		render_help(frm);
	},
	signature_for(frm) {
		render_help(frm);
	},
});

function render_help(frm) {
	const field = frm.fields_dict.jinja_help;
	if (!field) return;
	const esc = frappe.utils.escape_html;
	const report = frm.doc.signature_for !== "Document";
	const vars = report
		? [
				["title", __("the report's name, translated")],
				["report_name", __("the report's name as saved")],
				["filters.<fieldname>.label / .value", __("a filter of the report: its label and its value")],
				["doc.<fieldname>", __("the value of a filter, e.g. doc.company, doc.from_date")],
				["company", __("the company of the filters")],
		  ]
		: [
				["doc", __("the printed document, e.g. doc.name, doc.grand_total, doc.owner")],
				["title", __("the document type, translated")],
				["company", __("the company of the document")],
		  ];
	vars.push(
		["signatories", __("the rows of the table: label, person_name, designation, show_date")],
		["printed_by", __("the full name of who prints")],
		["printed_on", __("the date and time of printing")],
		["lang", __("the language of the print")]
	);
	const code = (s) => `<code>${esc(s)}</code>`;
	const example = report
		? `<div class="sig">
  <b>{{ _("Prepared by") }}</b>
  <span>{{ printed_by }}</span>
  <small>{{ frappe.utils.format_date(printed_on) }}</small>
</div>
{% if doc.company %}<p>{{ doc.company }}</p>{% endif %}`
		: `<div class="sig">
  <b>{{ _("Approved by") }}</b>
  <span>{{ frappe.utils.get_fullname(doc.owner) }}</span>
</div>`;
	const use = report
		? __("Choose it in Report View › Pages › Content › Signature. Leave «Report» empty to offer it for every report.")
		: __("Call it in the Jinja print format of a document:") + ` ${code('{{ report_view_signature("' + (frm.doc.name || "Name") + '", doc) }}')}`;
	field.$wrapper.html(`<div class="rv-sig-help" style="font-size:var(--text-sm);line-height:1.7;color:var(--text-color)">
		<p><b>${esc(__("How it is used"))}</b><br>${use}</p>
		<p><b>${esc(__("Content type"))}</b><br>${esc(__("Table: one box per signatory, with a line for the name and the signature (and the date when ticked). HTML: your own markup; it may use Jinja."))}</p>
		<p><b>${esc(__("Jinja"))}</b><br>${esc(__("Write {{ value }} to print a value and {% if %} / {% for %} for conditions and lists. _(\"text\") translates a text to the language of the print; frappe.utils functions (format_date, fmt_money, get_fullname…) are available."))}</p>
		<p><b>${esc(__("Variables"))}</b></p>
		<ul style="padding-inline-start:18px;margin:0 0 8px">${vars.map(([k, v]) => `<li>${code(k)} — ${esc(v)}</li>`).join("")}</ul>
		<p><b>${esc(__("Example"))}</b></p>
		<pre style="direction:ltr;text-align:left;background:var(--control-bg);padding:8px 10px;border-radius:6px;white-space:pre-wrap">${esc(example)}</pre>
		<p><b>CSS</b><br>${esc(__("The rules apply inside the signature only (they are nested in .rv-signature): write table { … } or .sig { … } without a prefix. Colours print as they are."))}</p>
	</div>`);
}
