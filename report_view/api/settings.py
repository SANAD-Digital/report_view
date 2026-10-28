"""The ``Report View Settings`` form (ADR-023): the shipped values it loads and the merged
settings it previews. System Manager or Report View Manager, after the report's own check (as every
function of the API); the browser of any other user receives the merged settings through
``get_meta`` alone."""

import json

import frappe

from report_view.api import _guard
from report_view.core import settings as rs
from report_view.core.inputs import parse_json_arg

_MODE_LABELS = {v: k for k, v in rs.DEFAULT_MODES.items()}


@frappe.whitelist(methods=["GET"])
def shipped_values(report_name: str) -> dict:
	"""The values of the form that stand for the shipped file of the report (``Load from
	shipped defaults``); the JSON parts are empty when it ships none."""
	report = _guard(report_name)
	frappe.only_for(rs.MANAGER_ROLES)
	data = rs.shipped_data(report.name) or {}
	shipped = rs.shipped_settings(report.name)
	values = {"enabled": 1 if shipped["enabled"] else 0}
	for part in rs.JSON_PARTS:
		value = data.get(part)
		values[part] = json.dumps(value, indent=1, ensure_ascii=False) if value else None
	values.update(_feature_values(shipped["features"]))
	values["default_mode"] = _MODE_LABELS.get(shipped["default_mode"] or "", "")
	values.update(_row_values(shipped["row_details"]))
	return {"values": values, "shipped": bool(data)}


@frappe.whitelist(methods=["GET"])
def reset_values(report_name: str) -> dict:
	"""The values of the form that leave the shipped file as it is (``Reset to shipped``):
	no JSON part of its own, every feature as shipped, no default view."""
	report = _guard(report_name)
	frappe.only_for(rs.MANAGER_ROLES)
	shipped = rs.shipped_settings(report.name)
	values = {"enabled": 1 if shipped["enabled"] else 0, "description": None}
	values.update(dict.fromkeys(rs.JSON_PARTS))
	values.update(_feature_values(shipped["features"]))
	values.update(
		{"default_mode": "", "default_group_by": None, "default_hidden": None, "default_pinned": None}
	)
	values.update(_row_values(shipped["row_details"]))
	return {"values": values}


@frappe.whitelist(methods=["POST"])
def preview(report_name: str, doc: dict | str) -> dict:
	"""The settings the report would read with the form's values (unsaved ones too): the
	shipped file with them over it, as ``load_settings`` merges them. A value the loader
	would drop is dropped here as well; saving says why."""
	report = _guard(report_name)
	frappe.only_for(rs.MANAGER_ROLES)
	values = parse_json_arg(doc, "doc", dict)
	draft = frappe.new_doc(rs.REPORT_SETTINGS)
	for field in draft.meta.get_valid_columns():
		if field in values:
			draft.set(field, values[field])
	draft.report = report.name
	try:
		layer = rs.record_layer(draft, strict=True)
		error = None
	except frappe.ValidationError as e:
		frappe.clear_last_message()
		layer = rs.record_layer(draft)
		error = str(e)
	return {"settings": rs.merge_settings(rs.shipped_settings(report.name), layer), "error": error}


def _feature_values(features: dict) -> dict:
	out = {k: 1 if features[k] else 0 for k in rs.FEATURES}
	for t in rs.CHART_TYPES:
		out["chart_" + t] = 1 if t in features["chart_types"] else 0
	return out


def _label(choices: dict, key: str) -> str:
	return next(k for k, v in choices.items() if v == key)


def _row_values(conf: dict) -> dict:
	return {
		"row_details_enabled": 1 if conf["enabled"] else 0,
		"row_details_container": _label(rs.ROW_CONTAINERS, conf["container"]),
		"row_details_width": _label(rs.ROW_WIDTHS, conf["width"]),
		"row_details_content": _label(rs.ROW_CONTENTS, conf["content"]),
		"row_details_html": None,
		"row_details_print_format": conf["print_format"],
		"row_details_document": 1 if conf["document"] else 0,
		"row_details_doc_fields": json.dumps(conf["doc_fields"]) if conf["doc_fields"] else None,
	}
