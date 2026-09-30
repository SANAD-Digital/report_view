"""Input parsing shared by the whitelisted functions (§2.0)."""

import json
from typing import Any

import frappe
from frappe import _

from report_view.core.errors import RVInvalidInput

MAX_JSON_BYTES = 256 * 1024
_PRIMITIVES = (str, int, float, bool, type(None))


def parse_json_arg(value: Any, name: str, expected: type | tuple[type, ...], allow_none: bool = False) -> Any:
	"""Parse a JSON argument (string or already-decoded value) and check its type and size."""
	if value is None or value == "":
		if allow_none:
			return None
		frappe.throw(_("{0} is required").format(name), RVInvalidInput)
	if isinstance(value, str):
		if len(value.encode("utf-8")) > MAX_JSON_BYTES:
			frappe.throw(_("{0} is too large").format(name), RVInvalidInput)
		try:
			value = json.loads(value)
		except ValueError:
			frappe.throw(_("{0} is not valid JSON").format(name), RVInvalidInput)
	else:
		try:
			size = len(json.dumps(value, default=str).encode("utf-8"))
		except TypeError, ValueError:
			frappe.throw(_("{0} is not valid JSON").format(name), RVInvalidInput)
		if size > MAX_JSON_BYTES:
			frappe.throw(_("{0} is too large").format(name), RVInvalidInput)
	if value is None and allow_none:
		return None
	if not isinstance(value, expected):
		frappe.throw(_("{0} has an invalid type").format(name), RVInvalidInput)
	return value


def validate_report_filters(filters: dict) -> dict:
	"""Filters: dict with string keys and primitive or list-of-primitive values."""
	for key, value in filters.items():
		if not isinstance(key, str):
			frappe.throw(_("Invalid filter name"), RVInvalidInput)
		if isinstance(value, list):
			if not all(isinstance(v, _PRIMITIVES) for v in value):
				frappe.throw(_("Invalid value for filter {0}").format(key), RVInvalidInput)
		elif not isinstance(value, _PRIMITIVES):
			frappe.throw(_("Invalid value for filter {0}").format(key), RVInvalidInput)
	return filters


def validate_js_filters(js_filters: list) -> list[dict]:
	"""Browser filter definitions: keep only ``fieldname``, ``fieldtype``, ``options`` strings."""
	out = []
	for item in js_filters:
		if not isinstance(item, dict) or not isinstance(item.get("fieldname"), str):
			frappe.throw(_("Invalid filter definition"), RVInvalidInput)
		fieldtype = item.get("fieldtype")
		options = item.get("options")
		out.append(
			{
				"fieldname": item["fieldname"],
				"fieldtype": fieldtype if isinstance(fieldtype, str) else None,
				"options": options if isinstance(options, str) else None,
			}
		)
	return out
