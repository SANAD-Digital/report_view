import json

import frappe
from frappe import _
from frappe.model.document import Document

from report_view.core.custom_print import CUSTOM
from report_view.core.drill import validate_drill_rules
from report_view.core.row_details import check_template
from report_view.core.saved_views import validate_global_default
from report_view.core.settings import (
	_FIELDNAME_RE,
	DEFAULT_MODES,
	clear_settings_cache,
	record_layer,
	shipped_settings,
)

# the feature a default mode needs (the table is always there)
_MODE_FEATURE = {"pivot": "pivot", "charts": "charts", "pages": "pages"}


class ReportViewSettings(Document):
	"""What one report shows in Report View and the JSON its look depends on
	(docs/architecture.md §5.2, ADR-023). Read by ``core.settings.load_settings`` over the
	shipped ``defaults/<report>.json``; the shipped filter definitions always win (ADR-021)."""

	def validate(self):
		if not frappe.db.exists("Report", self.report):
			frappe.throw(_("Report {0} not found").format(self.report), frappe.DoesNotExistError)
		# the loader's own parsers, strict: what it would drop is refused here
		layer = record_layer(self, strict=True)
		self.validate_filter_defs(layer["filter_defs"] or [])
		features = layer["features"]
		if features["charts"] and not features["chart_types"]:
			frappe.throw(_("Charts are on: choose at least one chart type"))
		mode = layer["default_mode"]
		if mode in _MODE_FEATURE and not features[_MODE_FEATURE[mode]]:
			label = next(k for k, v in DEFAULT_MODES.items() if v == mode)
			frappe.throw(_("The default view {0} is turned off in What the report shows").format(_(label)))
		for field in ("default_group_by", "default_hidden", "default_pinned"):
			for key in _keys_typed(self.get(field)):
				if not _FIELDNAME_RE.match(key):
					frappe.throw(_("{0}: {1} is not a column key").format(_(self.meta.get_label(field)), key))
		self.validate_row_details(layer["row_details"])
		# the drill rules (phase 5d): every target report exists and is enabled in Report View
		validate_drill_rules(layer["drilldowns"] or [], self.report)
		# the report's default saved view (ADR-010): a shared view of this report
		validate_global_default(self)
		if (self.default_group_by or "").strip() and not features["grouping"]:
			frappe.throw(_("Group rows by needs Row grouping"))
		if (self.default_pinned or "").strip() and not features["pinning"]:
			frappe.throw(_("Pinned columns needs Pin columns"))

	def validate_row_details(self, conf: dict) -> None:
		"""The template compiles in its sandbox; the print format is a Custom one."""
		if not conf["enabled"]:
			return
		if conf["content"] == "html":
			if not (self.row_details_html or "").strip():
				frappe.throw(_("Row details: the HTML template is empty"))
			check_template(self.row_details_html)
		elif conf["content"] == "print_format":
			pf = conf["print_format"]
			if not pf or frappe.db.get_value("Print Format", pf, "print_format_for") != CUSTOM:
				frappe.throw(_("Row details: {0} is not a Custom print format").format(pf or ""))
		if conf["document"] and not conf["doc_fields"]:
			frappe.throw(_("Row details: Document fields are needed to offer the row's document"))

	def validate_filter_defs(self, defs: list[dict]) -> None:
		"""ADR-021: a shipped definition may be repeated as it is, never removed or changed."""
		shipped = {d["fieldname"]: d for d in shipped_settings(self.report)["filter_defs"]}
		for d in defs:
			own = shipped.get(d["fieldname"])
			if own and own != d:
				frappe.throw(
					_(
						"The filter definition of {0} is shipped with the app ({1} {2}) and cannot be changed here"
					).format(d["fieldname"], own["fieldtype"], own["options"])
				)

	def on_update(self):
		self.clear_cache_of(self.name)

	def on_trash(self):
		self.clear_cache_of(self.name)

	def after_rename(self, old, new, merge=False):
		self.clear_cache_of(old)
		self.clear_cache_of(new)

	@staticmethod
	def clear_cache_of(report_name: str) -> None:
		"""Now, and again when the transaction ends: a read in between (this request, another
		worker) cached what the end of the transaction may undo."""
		clear_settings_cache(report_name)
		frappe.db.after_commit.add(lambda: clear_settings_cache(report_name))
		frappe.db.after_rollback.add(lambda: clear_settings_cache(report_name))


def _keys_typed(value) -> list[str]:
	text = (value or "").strip()
	if text.startswith("["):
		try:
			items = json.loads(text)
		except ValueError:
			frappe.throw(_("{0} is not valid JSON").format(text[:40]))
		return [str(x).strip() for x in items if str(x).strip()]
	return [line.strip() for line in text.splitlines() if line.strip()]
