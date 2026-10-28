"""Configured drill of a report (phase 5d): the rules of Report View Settings «Drill» and of the
shipped ``defaults/<report>.json`` (key ``drilldowns``).

A rule: ``{label, source_column, report, filters: {<target filter>: <value>}}``; a value is
``"row:<column>"`` (the row's value of a column), ``"filter:<name>"`` (a filter of the report
drilled from), any other literal, or a list of those (a MultiSelectList filter). The browser
maps the values (``state/drill.js``) and runs the target through the same ``api.run`` as the
page, with the user's own permissions: a rule maps values, it grants nothing. Saving a rule
checks that the target report exists and is enabled in Report View; who may run it is checked
when it runs, for the user who runs it.
"""

import re

import frappe
from frappe import _

MAX_RULES = 20
_FIELDNAME_RE = re.compile(r"^[A-Za-z0-9_]+$")
_PREFIXES = ("row:", "filter:")


def _bad(strict: bool, message: str) -> bool:
	if strict:
		frappe.throw(message)
	return False


def _valid_value(value: object) -> bool:
	if isinstance(value, list):
		return bool(value) and all(
			isinstance(v, str | int | float) and not isinstance(v, bool) for v in value
		)
	return isinstance(value, str | int | float | bool)


def _valid_ref(value: object) -> bool:
	"""``row:<column>`` and ``filter:<name>`` name a fieldname."""
	items = value if isinstance(value, list) else [value]
	for v in items:
		if isinstance(v, str):
			for prefix in _PREFIXES:
				if v.startswith(prefix) and not _FIELDNAME_RE.match(v[len(prefix) :]):
					return False
	return True


def parse_drill_rules(items: list, strict: bool = False) -> list[dict]:
	"""The valid rules of a list (``strict``: an invalid one throws, as on save)."""
	out = []
	if not isinstance(items, list):
		_bad(strict, _("Drill rules must be a list"))
		return out
	if strict and len(items) > MAX_RULES:
		frappe.throw(_("A report has at most {0} drill rules").format(MAX_RULES))
	labels = set()
	for i, r in enumerate(items[:MAX_RULES], 1):
		if not isinstance(r, dict):
			_bad(strict, _("Drill rule {0} must be an object").format(i))
			continue
		label = r.get("label")
		report = r.get("report")
		source = r.get("source_column")
		filters = r.get("filters") or {}
		if not isinstance(label, str) or not label.strip():
			_bad(strict, _("Drill rule {0} needs a label").format(i))
			continue
		label = label.strip()
		if not isinstance(report, str) or not report.strip():
			_bad(strict, _("Drill rule {0} needs the report it opens").format(i))
			continue
		if not isinstance(source, str) or not _FIELDNAME_RE.match(source):
			_bad(strict, _("Drill rule {0}: the source column must be a column fieldname").format(i))
			continue
		if not isinstance(filters, dict):
			_bad(strict, _("Drill rule {0}: filters must be an object").format(i))
			continue
		bad = [
			k
			for k, v in filters.items()
			if not _FIELDNAME_RE.match(str(k)) or not _valid_value(v) or not _valid_ref(v)
		]
		if bad:
			_bad(
				strict,
				_(
					"Drill rule {0}: the filter {1} must map to row:<column>, filter:<name>, a value or a list of them"
				).format(i, bad[0]),
			)
			continue
		if label in labels:
			_bad(strict, _("Drill rule {0}: the label {1} is used twice").format(i, label))
			continue
		labels.add(label)
		out.append(
			{"label": label, "source_column": source, "report": report.strip(), "filters": dict(filters)}
		)
	return out


def validate_drill_rules(rules: list[dict], report_name: str | None = None) -> None:
	"""On save: every target report exists and is not this report turned off in Report View.
	Whether the user may run it is not decided here: ``api.run`` checks it for whoever runs it."""
	from report_view.core.settings import load_settings

	for i, rule in enumerate(rules, 1):
		target = rule["report"]
		if not frappe.db.exists("Report", target):
			frappe.throw(
				_("Drill rule {0}: report {1} not found").format(i, target), frappe.DoesNotExistError
			)
		if frappe.db.get_value("Report", target, "disabled"):
			frappe.throw(_("Drill rule {0}: report {1} is disabled").format(i, target))
		if target != report_name and not load_settings(target)["enabled"]:
			frappe.throw(_("Drill rule {0}: report {1} is not enabled in Report View").format(i, target))
