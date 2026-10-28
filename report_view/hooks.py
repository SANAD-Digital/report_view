app_name = "report_view"
app_title = "Report View"
app_publisher = "Sanad Digital"
app_description = "Report View"
app_email = "sanad@digital.info"
app_license = "mit"

# The print options and the Excel title read ERPNext's Company; the shipped settings and
# headings are for ERPNext's accounting reports.
required_apps = ["erpnext"]

# Entry button on the query-report page (ADR-007)
app_include_js = ["report_view_entry.bundle.js"]

# Desk-wide CSS (hashed bundle): the @font-face rules of the font library (public/fonts,
# ADR-018; a file loads only when a font is used) and the Print Format form's help box
app_include_css = ["rv_desk.bundle.css"]

# The "Design with the builder" button of the Letter Head form (ADR-018)
doctype_js = {
	"Letter Head": "public/js/letter_head_form.js",
	"Print Format": "public/js/print_format_form.js",
}

# a builder letter head (ADR-018) gets the page margins wkhtmltopdf needs to repeat it
pdf_body_html = "report_view.core.letterhead.pdf_body_html"

# A Print Signature of type Document in a document's print format (ADR-015):
# {{ report_view_signature("Name", doc) }}
jinja = {"methods": ["report_view.core.printing.report_view_signature"]}

# The standard print headings and signatures (ADR-015), synced on migrate; a record the
# user edited stays as edited (its `modified` is newer than the file's).
fixtures = [
	{
		"dt": "Print Heading",
		"filters": [
			[
				"name",
				"in",
				[
					"Financial Statement",
					"Account Statement",
					"Confidential Report",
					"Draft Report",
					"Board Report",
				],
			]
		],
	},
	{
		"dt": "Print Signature",
		"filters": [
			[
				"name",
				"in",
				[
					"Prepared, Reviewed, Approved",
					"Accountant and Finance Manager",
					"Audit Committee",
					"Treasury and Payments",
					"Inventory Count Committee",
					"Signature and Company Stamp",
					"Authorized Signatory",
					"Balance Confirmation",
					"Signature Grid",
					"Issued by and Received by",
					"Approval Steps",
					"Accountant, Manager and Stamp",
					"Receipt Acknowledgement",
				],
			]
		],
	},
	# the Custom print source (ADR-019): the option of print_format_for and its table format
	{"dt": "Property Setter", "filters": [["name", "in", ["Print Format-print_format_for-options"]]]},
	{"dt": "Print Format", "filters": [["name", "in", ["Report View Table"]]]},
	# the variables of a print format (ADR-024): a hidden JSON field
	{"dt": "Custom Field", "filters": [["name", "in", ["Print Format-rv_variables"]]]},
]

# Report View's own Chromium for PDFs (ADR-016): downloaded outside the app when missing;
# both also warn when another app's pdf_body_html replaces ours (ADR-018)
after_install = "report_view.install.after_install"
after_migrate = "report_view.install.after_migrate"

# print presets (ADR-020): a private preset is its user's only; a public one is written by a publisher;
# saved views (ADR-010): seen by its owner, or shared with users who may open the report;
# written by its stored owner only
permission_query_conditions = {
	"Print Preset": "report_view.core.print_presets.permission_query_conditions",
	"Report View Saved View": "report_view.core.saved_views.permission_query_conditions",
}
has_permission = {
	"Print Preset": "report_view.core.print_presets.has_permission",
	"Report View Saved View": "report_view.core.saved_views.has_permission",
}

# where a Custom print opens by default, known before any request (ADR-019)
extend_bootinfo = "report_view.core.settings.boot_session"

# a Custom print format is HTML and CSS only (ADR-019); a builder letter head keeps its
# source on insert and takes its layout with it when deleted (ADR-018)
doc_events = {
	# … and the variables of any print format are checked (ADR-024)
	"Print Format": {
		"before_validate": [
			"report_view.core.custom_print.before_validate_print_format",
			"report_view.core.print_variables.validate_print_format",
		]
	},
	"Letter Head": {
		"before_insert": "report_view.core.letterhead.keep_builder_source",
		"on_trash": "report_view.core.letterhead.delete_layout",
	},
}

# Files of background exports (Excel) and server PDFs never downloaded go after an hour.
scheduler_events = {
	"hourly": [
		"report_view.core.export.jobs.cleanup",
		"report_view.core.pdf.cleanup_stale",
	],
}

# a fresh site gets its setup wizard (company, fiscal year) before the tests
before_tests = "report_view.install.before_tests"
