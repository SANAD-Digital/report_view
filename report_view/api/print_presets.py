"""Print presets of the print toolbar (ADR-020): list, save, delete, make the default.

Every function first checks the print target (the report, the document type or the
Custom print format the pages print, as the other print functions do) and then the
permission on ``Print Preset``; reads go through ``frappe.get_list`` and writes through
``doc.save`` / ``doc.delete``, so the privacy hooks of ``core.print_presets`` apply.
"""

import frappe
from frappe import _

from report_view.api import _rate_limit
from report_view.core import print_presets as pp
from report_view.core.custom_print import guard_custom_format
from report_view.core.errors import RVInvalidInput
from report_view.core.guard import guard_print, guard_report


def guard_target(context: str, target: str | None) -> str:
	"""The target the pages print, if the user may print it: a report (``guard_report`` and
	``guard_print``), a document type (``print`` on it) or a Custom print format."""
	if context not in pp.CONTEXTS:
		frappe.throw(_("Invalid print preset type"), RVInvalidInput)
	if not isinstance(target, str) or not target.strip():
		frappe.throw(_("The print target is required"), RVInvalidInput)
	if context == "Report":
		guard_print(guard_report(target))
		return target
	if context == "Custom":
		return guard_custom_format(target).name
	if not frappe.db.exists("DocType", target) or frappe.get_meta(target).istable:
		frappe.throw(_("Document type {0} not found").format(target), frappe.DoesNotExistError)
	if not frappe.has_permission(target, "print"):
		frappe.throw(_("Not permitted to print {0}").format(_(target)), frappe.PermissionError)
	return target


def _check(value) -> bool:
	return str(value).lower() in ("1", "true", "yes")


@frappe.whitelist(methods=["GET"])
def list(context: str, target: str) -> dict:
	"""The presets the user may apply here: ``{mine, public, can_publish, keys}``, each list
	with the target's own presets first, then the general ones."""
	target = guard_target(context, target)
	frappe.has_permission(pp.DOCTYPE, "read", throw=True)
	return pp.list_presets(context, target)


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def save(
	context: str,
	target: str,
	preset_name: str | None = None,
	settings: dict | str | None = None,
	public: int | str | None = None,
	for_all: int | str | None = None,
	description: str | None = None,
	is_default: int | str | None = None,
	name: str | None = None,
	as_new: int | str | None = None,
) -> dict:
	"""Create a preset (no ``name``, or ``as_new``), or update one the user may edit: only the
	values sent change. ``for_all``: for every report / document type / Custom format of
	the context, else for ``target`` only. Returns the preset as the toolbar lists it."""
	target = guard_target(context, target)
	if name and not _check(as_new):
		doc = frappe.get_doc(pp.DOCTYPE, name)
		doc.check_permission("write")
		if doc.context != context:
			frappe.throw(_("This print preset is for another kind of print"), RVInvalidInput)
	else:
		frappe.has_permission(pp.DOCTYPE, "create", throw=True)
		if settings is None or not preset_name:
			frappe.throw(_("Name the print preset and send its settings"), RVInvalidInput)
		doc = frappe.new_doc(pp.DOCTYPE)
		doc.context = context
		doc.set(pp.TARGET_FIELD[context], None if _check(for_all) else target)
		public = public if public is not None else 0
	if preset_name is not None:
		doc.preset_name = preset_name
	if settings is not None:
		doc.settings = pp.clean_settings(settings)
	if public is not None:
		if _check(public):
			if not pp.can_publish():
				frappe.throw(_("Only a System Manager or a Report Manager can make a print preset public"), frappe.PermissionError)
			doc.for_user = None
		else:
			# private: its owner's (a new one: the session user's)
			doc.for_user = doc.owner if not doc.is_new() else frappe.session.user
	if description is not None:
		doc.description = description
	if is_default is not None:
		doc.is_default = 1 if _check(is_default) else 0
	doc.save() if not doc.is_new() else doc.insert()
	return pp.as_row(doc)


@frappe.whitelist(methods=["POST"])
def delete(name: str) -> dict:
	"""Delete a preset the user may edit (their own private one, or a public one as a publisher)."""
	doc = frappe.get_doc(pp.DOCTYPE, name)
	doc.check_permission("delete")
	doc.delete()
	return {"name": name}


@frappe.whitelist(methods=["POST"])
def set_default(name: str, value: int | str = 1) -> dict:
	"""Make a preset the default of its audience and target (or stop it being the default)."""
	doc = frappe.get_doc(pp.DOCTYPE, name)
	doc.check_permission("write")
	doc.is_default = 1 if _check(value) else 0
	doc.save()
	return pp.as_row(doc)
