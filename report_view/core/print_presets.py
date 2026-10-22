"""Print presets (ADR-020): saved settings of the print pages, private or public.

A preset follows Frappe's ``List Filter`` convention: ``for_user`` set = private to that
user, empty = public. The privacy is enforced in three places, as for saved views
(ADR-010): ``permission_query_conditions`` (lists), ``has_permission`` (one record, every
ptype) and the controller's ``validate`` (who may publish, who owns a private preset).

- A private preset is seen and edited by its owner only (CLAUDE.md), System Manager
  included; ``for_user`` is always the stored owner.
- A public preset is read by every Desk user and written (edited, deleted, made the
  default, made private again by its owner) by a *publisher*: System Manager or Report
  Manager (``PUBLISH_ROLES``).
"""

import json
import math

import frappe
from frappe import _

from report_view.core.errors import RVInvalidInput

DOCTYPE = "Print Preset"
CONTEXTS = ("Report", "Document", "Custom")
# the field that names the target of a preset, per context ("" = every target)
TARGET_FIELD = {"Report": "report", "Document": "reference_doctype", "Custom": "print_format"}
PUBLISH_ROLES = ("System Manager", "Report Manager")
MAX_SETTINGS_BYTES = 32 * 1024
MAX_TEXT = 2000
MAX_LIST = 500
BOX_SIDES = {"top", "bottom", "start", "end"}
WRITE_PTYPES = {"write", "create", "delete", "submit", "cancel", "amend", "share"}

# The keys of the Pages settings a preset may hold: DEFAULT_SETTINGS of
# public/js/report_view/views/pages_view.js without "zoom" (a view's own, not a print
# setting). tests/js/print_presets.test.mjs checks the two lists stay the same.
SETTINGS_KEYS = frozenset(
	{
		"size",
		"orientation",
		"margins",
		"page_m",
		"template",
		"style",
		"letter_head",
		"heading",
		"heading_pages",
		"heading_replace",
		"heading_align",
		"heading_size",
		"heading_m",
		"heading_line_w",
		"heading_line_c",
		"heading_line_s",
		"signature",
		"sig_pages",
		"sig_pos",
		"sig_size",
		"sig_m",
		"lang",
		"include_filters",
		"include_subtotals",
		"include_total",
		"signatures",
		"page_numbers",
		"printed_on",
		"lh_pages",
		"lh_height",
		"lh_align",
		"lh_fit",
		"lh_m",
		"foot_pages",
		"foot_height",
		"foot_align",
		"foot_m",
		"number_pos",
		"number_format",
		"number_start",
		"number_size",
		"number_caption",
		"num_m",
		"head_line_w",
		"head_line_c",
		"head_line_s",
		"foot_line_w",
		"foot_line_c",
		"foot_line_s",
		"num_line_w",
		"num_line_c",
		"num_line_s",
		"pb_on",
		"pb_w",
		"pb_s",
		"pb_c",
		"pb_offset",
		"pb_radius",
		"pb_pages",
		"wm_type",
		"wm_text",
		"wm_image",
		"wm_size",
		"wm_scale",
		"wm_color",
		"wm_opacity",
		"wm_angle",
		"wm_pages",
		"font",
		"hidden",
	}
)


# ---------------------------------------------------------------- who may do what


def can_publish(user: str | None = None) -> bool:
	"""Whether ``user`` may make a preset public, edit or delete a public one."""
	user = user or frappe.session.user
	return user == "Administrator" or bool(set(PUBLISH_ROLES) & set(frappe.get_roles(user)))


def _stored(doc) -> frappe._dict:
	"""The owner and audience stored in the database (REST applies the request's values
	before the permission check: the stored ones decide, ADR-010)."""
	if doc.is_new():
		return frappe._dict(owner=doc.owner or frappe.session.user, for_user=doc.for_user)
	before = doc.get_doc_before_save() if hasattr(doc, "get_doc_before_save") else None
	if before:
		return frappe._dict(owner=before.owner, for_user=before.for_user)
	row = frappe.db.get_value(DOCTYPE, doc.name, ["owner", "for_user"], as_dict=True)
	return row or frappe._dict(owner=doc.owner, for_user=doc.for_user)


def has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""``has_permission`` hook: a private preset is its user's only; a public one is read by
	all and written by a publisher. Can only deny (Frappe's DocPerm decides the rest)."""
	user = user or frappe.session.user
	stored = _stored(doc)
	if stored.for_user:
		# private: the user it is for, and nobody else (System Manager included)
		if stored.for_user != user:
			return False
	elif ptype in WRITE_PTYPES and not can_publish(user):
		return False
	# a request that makes the record private for another user
	if doc.for_user and doc.for_user != user and ptype in WRITE_PTYPES:
		return False
	return True


def permission_query_conditions(user=None, doctype=None) -> str:
	"""Lists: the public presets and the user's own private ones."""
	user = user or frappe.session.user
	return f"(ifnull(`tab{DOCTYPE}`.`for_user`, '') = '' or `tab{DOCTYPE}`.`for_user` = {frappe.db.escape(user)})"


# ---------------------------------------------------------------- validation


def _bad(message: str):
	frappe.throw(message, RVInvalidInput)


def _check_value(key: str, value) -> None:
	if isinstance(value, bool) or value is None:
		return
	if isinstance(value, int | float):
		if not math.isfinite(value):
			_bad(_("The print setting {0} has an invalid value").format(key))
		return
	if isinstance(value, str):
		if len(value) > MAX_TEXT:
			_bad(_("The print setting {0} is too long").format(key))
		return
	if isinstance(value, list):
		if len(value) > MAX_LIST or not all(isinstance(v, str) and len(v) <= 140 for v in value):
			_bad(_("The print setting {0} has an invalid value").format(key))
		return
	if isinstance(value, dict):
		if not set(value) <= BOX_SIDES or not all(
			isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v)
			for v in value.values()
		):
			_bad(_("The print setting {0} has an invalid value").format(key))
		return
	_bad(_("The print setting {0} has an invalid value").format(key))


def clean_settings(raw) -> dict:
	"""The settings of a preset: a JSON object of at most 32 KB, known keys only, plain
	values (text, numbers, switches, a list of column keys, a box of four margins). The
	browser checks every value again when it applies them (sanitize_settings)."""
	if isinstance(raw, str):
		if len(raw.encode("utf-8")) > MAX_SETTINGS_BYTES:
			_bad(_("The print settings are too large"))
		try:
			raw = json.loads(raw)
		except ValueError:
			_bad(_("The print settings are not valid JSON"))
	if not isinstance(raw, dict):
		_bad(_("The print settings must be an object"))
	unknown = sorted(set(raw) - SETTINGS_KEYS)
	if unknown:
		_bad(_("Unknown print settings: {0}").format(", ".join(unknown[:10])))
	for key, value in raw.items():
		_check_value(key, value)
	if len(json.dumps(raw, separators=(",", ":")).encode("utf-8")) > MAX_SETTINGS_BYTES:
		_bad(_("The print settings are too large"))
	return raw


def validate_preset(doc) -> None:
	"""The controller's checks (REST included): context and target, settings, audience."""
	user = frappe.session.user
	doc.preset_name = (doc.preset_name or "").strip()
	if not doc.preset_name:
		_bad(_("Name the print preset"))
	if len(doc.preset_name) > 140:
		_bad(_("The name of the print preset is too long"))
	if doc.context not in CONTEXTS:
		_bad(_("Invalid print preset type"))
	# one target field, the context's own
	for context, field in TARGET_FIELD.items():
		if context != doc.context:
			doc.set(field, None)
	if doc.context == "Custom" and doc.print_format:
		if frappe.db.get_value("Print Format", doc.print_format, "print_format_for") != "Custom":
			_bad(_("{0} is not a Custom print format").format(doc.print_format))
	doc.settings = json.dumps(clean_settings(doc.settings), separators=(",", ":"), sort_keys=True)
	doc.description = (doc.description or "").strip()[:MAX_TEXT] or None
	doc.is_default = 1 if doc.is_default else 0

	stored = _stored(doc)
	if doc.for_user:
		# private: always its stored owner's
		if doc.for_user != stored.owner:
			frappe.throw(_("A private print preset belongs to the user who made it"), frappe.PermissionError)
		if not doc.is_new() and not stored.for_user and stored.owner != user:
			frappe.throw(
				_("Only the user who made a public print preset can make it private"), frappe.PermissionError
			)
	elif (doc.is_new() or stored.for_user) and not can_publish(user):
		frappe.throw(
			_("Only a System Manager or a Report Manager can make a print preset public"),
			frappe.PermissionError,
		)

	if _name_taken(doc):
		_bad(_("A print preset named {0} already exists here").format(doc.preset_name))


def _scope_filters(doc) -> dict:
	"""The presets a default competes with: the same audience, context and target."""
	field = TARGET_FIELD[doc.context]
	return {
		"context": doc.context,
		"for_user": doc.for_user or ("is", "not set"),
		field: doc.get(field) or ("is", "not set"),
		"name": ("!=", doc.name),
	}


def _name_taken(doc) -> bool:
	filters = _scope_filters(doc)
	filters["preset_name"] = doc.preset_name
	return bool(frappe.get_list(DOCTYPE, filters=filters, fields=["name"], limit=1))


def clear_other_defaults(doc) -> None:
	"""One default per audience, context and target: a new default takes the place of the
	previous one (as Frappe's Letter Head does). The other presets are ones the user may
	write: their own private ones, or public ones (the user is a publisher)."""
	if not doc.is_default:
		return
	filters = _scope_filters(doc)
	filters["is_default"] = 1
	for name in frappe.get_list(DOCTYPE, filters=filters, pluck="name", limit=0):
		other = frappe.get_doc(DOCTYPE, name)
		other.is_default = 0
		other.save()


# ---------------------------------------------------------------- reading


def target_of(row) -> str | None:
	return row.get(TARGET_FIELD.get(row.get("context"), "")) or None


def as_row(doc, user: str | None = None) -> dict:
	"""What the toolbar shows of a preset."""
	user = user or frappe.session.user
	settings = doc.get("settings")
	if isinstance(settings, str):
		try:
			settings = json.loads(settings)
		except ValueError:
			settings = {}
	public = not doc.get("for_user")
	return {
		"name": doc.get("name"),
		"preset_name": doc.get("preset_name"),
		"public": public,
		"is_default": bool(doc.get("is_default")),
		"context": doc.get("context"),
		"target": target_of(doc),
		"specific": bool(target_of(doc)),
		"description": doc.get("description") or "",
		"settings": settings if isinstance(settings, dict) else {},
		"can_edit": (can_publish(user) if public else doc.get("for_user") == user),
		"owner_name": frappe.utils.get_fullname(doc.get("owner")) if doc.get("owner") else "",
		"modified": str(doc.get("modified") or ""),
	}


def list_presets(context: str, target: str | None) -> dict:
	"""The presets of ``context`` the user may see, for ``target`` or for every target:
	the target's own first, then the general ones; the user's private ones apart."""
	field = TARGET_FIELD[context]
	rows = frappe.get_list(
		DOCTYPE,
		filters={"context": context},
		or_filters=[[field, "is", "not set"]] + ([[field, "=", target]] if target else []),
		fields=[
			"name",
			"preset_name",
			"for_user",
			"is_default",
			"context",
			field,
			"description",
			"settings",
			"owner",
			"modified",
		],
		order_by="preset_name asc",
		limit=500,
	)
	user = frappe.session.user
	out = [as_row(r, user) for r in rows]
	out.sort(key=lambda r: (not r["specific"], (r["preset_name"] or "").lower()))
	return {
		"mine": [r for r in out if not r["public"]],
		"public": [r for r in out if r["public"]],
		"can_publish": can_publish(user),
		"keys": sorted(SETTINGS_KEYS),
	}
