"""N6, the enrichment columns (docs/architecture.md §3.2, ADR-011).

The browser adds them after a run (``adapter/enrich.js``) from ``api.enrich``; an export adds
them here, the same way, so that a view that shows, hides or groups by one is exported as it
is shown (the critic's review of 2026-11-08: a trial balance hides ``account__root_type`` by
default, and every export of it was refused for a column the server did not know).

``fetch`` is the one read of the linked documents, as the user: the fields the user may read,
``frappe.get_list`` with its permissions. A rule the user may not read at all is left out, as
the browser leaves it out.
"""

import frappe
from frappe import _

# names per read of the linked documents (api.enrich takes as many per request)
BATCH = 5000


def fetch(doctype: str, names: list[str], fields: list[str]) -> dict:
	"""The fields of the linked documents the user may read: ``{rows: {name: {field: value}},
	fields: {field: {fieldtype, options, label}}, dropped_fields, missing}``."""
	permitted_all = set(frappe.get_meta(doctype).get_permitted_fieldnames(user=frappe.session.user))
	permitted = [f for f in dict.fromkeys(fields) if f in permitted_all]
	dropped = [f for f in dict.fromkeys(fields) if f not in permitted_all]
	unique = list(dict.fromkeys(names))
	rows: dict[str, dict] = {}
	if unique:
		for doc in frappe.get_list(
			doctype,
			filters={"name": ["in", unique]},
			fields=["name", *permitted],
			limit=0,
		):
			rows[doc["name"]] = {f: doc.get(f) for f in permitted}
	meta = frappe.get_meta(doctype)
	field_meta = {}
	for f in permitted:
		df = meta.get_field(f)
		field_meta[f] = {
			"fieldtype": df.fieldtype if df else "Data",
			"options": df.options if df and df.fieldtype in ("Select", "Link") else None,
			"label": _(df.label) if df and df.label else f,
		}
	return {
		"doctype": doctype,
		"rows": rows,
		"fields": field_meta,
		"dropped_fields": dropped,
		"missing": len(unique) - len(rows),
	}


def apply(nr: dict, rules: list[dict]) -> None:
	"""Add the ``<source>__<field>`` columns of every rule to a NormalizedReport (mutated),
	as ``adapter/enrich.js`` apply_enrichment does: the original values never change."""
	for rule in rules or []:
		source_key = rule.get("source_column")
		fields = list(rule.get("fields") or [])
		source = next((c for c in nr["columns"] if c["key"] == source_key), None)
		if not source or (source.get("link") or {}).get("kind") != "static" or not fields:
			continue
		names = list(dict.fromkeys(r.get(source_key) for r in nr["facts"] if r.get(source_key)))
		values: dict[str, dict] = {}
		field_meta: dict[str, dict] = {}
		try:
			for i in range(0, len(names), BATCH):
				out = fetch(rule["link_doctype"], names[i : i + BATCH], fields)
				values.update(out["rows"])
				field_meta.update(out["fields"])
				dropped = set(out["dropped_fields"])
				fields = [f for f in fields if f not in dropped]
		except frappe.PermissionError:
			continue
		_add_columns(nr, source_key, rule["link_doctype"], fields, values, field_meta)


def _add_columns(nr: dict, source_key: str, doctype: str, fields: list[str], values: dict, field_meta: dict):
	columns = nr["columns"]
	for i, field in enumerate(fields):
		key = f"{source_key}__{field}"
		if any(c["key"] == key for c in columns):
			continue
		fm = field_meta.get(field) or {}
		# Select and Link keep their type (the browser formats them); everything else is text
		fieldtype = fm.get("fieldtype") if fm.get("fieldtype") in ("Select", "Link") else "Data"
		options = None if fieldtype == "Data" else fm.get("options")
		label = fm.get("label") or _(frappe.unscrub(field))
		columns.append(
			{
				"key": key,
				"fieldname": key,
				"label": label,
				"fieldtype": fieldtype,
				"options": options,
				"width": 140,
				"hidden": False,
				"export_hidden": False,
				"role": "dimension",
				"agg": None,
				"currency": None,
				"link": None,
				"date": False,
				"source_index": len(columns) + i,
				"original": {"fieldname": key, "label": label, "fieldtype": fieldtype, "options": options},
				"enriched": {"source": source_key, "doctype": doctype, "field": field},
			}
		)
		seen = set()
		for row in [*nr["rows"], *nr["facts"]]:
			if id(row) in seen:
				continue
			seen.add(id(row))
			name = row.get(source_key)
			row[key] = (values.get(name) or {}).get(field) if name else None
