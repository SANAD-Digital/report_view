"""Saved views of the report page (ADR-010, docs/architecture.md §2.7).

Every function takes ``report_name`` first and calls ``guard_report`` on its first line: a
view is seen only through a report the user may open. Reads go through ``frappe.get_list`` /
``check_permission`` (the hooks of ``core.saved_views``) and then ``is_visible`` explicitly,
because Administrator passes the ``has_permission`` hook by name; writes go through
``doc.save`` / ``doc.delete``, so the controller's checks apply as they do to REST.
"""

import json

import frappe
from frappe import _

from report_view.api import _rate_limit
from report_view.core import saved_views as sv
from report_view.core.errors import RVInvalidInput, RVNotOwner, RVViewNotFound
from report_view.core.guard import guard_report
from report_view.core.inputs import parse_json_arg


def _trim_messages(mark: int) -> None:
	"""Frappe's own refusal ("not found", "no permission") is replaced by ours."""
	log = getattr(frappe.local, "message_log", None)
	if log is not None:
		del log[mark:]


def _mark() -> int:
	return len(getattr(frappe.local, "message_log", None) or [])


def _not_found():
	frappe.throw(_("This saved view does not exist or is not shared with you"), RVViewNotFound)


def _view(report_name: str, name, ptype: str = "read"):
	"""The view ``name`` of the report, if the user may ``ptype`` it: a view that does not
	exist, is of another report or is not visible is «not found» (nothing is said of a view
	the user may not see); a visible view the user does not own is ``RVNotOwner`` for a write."""
	if not isinstance(name, str) or not name.strip():
		_not_found()
	mark = _mark()
	try:
		doc = frappe.get_doc(sv.DOCTYPE, name)
		doc.check_permission("read")
	except (frappe.DoesNotExistError, frappe.PermissionError):
		_trim_messages(mark)
		_not_found()
	if doc.report != report_name or not sv.is_visible(doc):
		_not_found()
	if ptype != "read":
		try:
			doc.check_permission(ptype)
			sv.check_owner(doc)
		except frappe.PermissionError:
			_trim_messages(mark)
			frappe.throw(_("Only the owner of a saved view can change or delete it"), RVNotOwner)
	return doc


def _roles_arg(roles) -> list[str]:
	if roles in (None, ""):
		return []
	roles = parse_json_arg(roles, "roles", list)
	if not all(isinstance(r, str) for r in roles):
		frappe.throw(_("Invalid roles"), RVInvalidInput)
	return roles


def as_view(doc) -> dict:
	"""What the page applies: the state migrated (§7.3) and the columns it was saved with."""
	user = frappe.session.user
	return {
		"name": doc.name,
		"title": doc.title,
		"visibility": doc.visibility,
		"roles": sorted(sv.view_roles(doc)),
		"description": doc.description or "",
		"state": sv.parse_state(doc.state),
		"columns_ref": sv._json_or_none(doc.columns_ref),
		"owner": doc.owner,
		"is_owner": sv.stored_owner(doc) == user,
		"modified": str(doc.modified or ""),
	}


@frappe.whitelist(methods=["GET"])
@_rate_limit(120)
def list_views(report_name: str) -> list[dict]:
	"""The views of the report the user may see: their own and the shared ones."""
	report = guard_report(report_name)
	user = frappe.session.user
	rows = frappe.get_list(
		sv.DOCTYPE,
		filters={"report": report_name},
		fields=["name", "title", "visibility", "owner", "modified", "description"],
		order_by="title asc",
		limit=sv.MAX_LIST_VIEWS,
	)
	user_default = sv.user_default_name(report_name)
	global_default = sv.global_default_name(report)
	out = []
	for row in rows:
		own = row.owner == user
		# the pqc chose them; the rule again here, for Administrator (and a role shared view
		# is checked on its roles)
		if not own:
			if row.visibility == "Private":
				continue
			if row.visibility == "Roles" and not sv.is_visible(frappe.get_doc(sv.DOCTYPE, row.name)):
				continue
		out.append(
			{
				"name": row.name,
				"title": row.title,
				"visibility": row.visibility,
				"owner": row.owner,
				"owner_name": frappe.utils.get_fullname(row.owner),
				"is_owner": own,
				"is_global_default": row.name == global_default and row.visibility != "Private",
				"is_user_default": row.name == user_default,
				"description": row.description or "",
				"modified": str(row.modified or ""),
			}
		)
	return out


@frappe.whitelist(methods=["GET"])
@_rate_limit(120)
def get_view(report_name: str, name: str) -> dict:
	"""One view to apply (``RVViewNotFound`` when it is not there for this user)."""
	guard_report(report_name)
	return as_view(_view(report_name, name))


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def save_view(
	report_name: str,
	title: str | None = None,
	state: dict | str | None = None,
	visibility: str | None = None,
	roles: list | str | None = None,
	name: str | None = None,
	description: str | None = None,
	columns: list | str | None = None,
) -> dict:
	"""Create a view (no ``name``) or update one the user owns; only what is sent changes
	(a new view is ``Private`` unless ``visibility`` says otherwise). ``columns``: the report's
	columns now (``[{key, label, fieldtype, source_index}]``), from which the server keeps the
	ones the state refers to (``columns_ref``). The checks are the controller's (§6)."""
	guard_report(report_name)
	if name:
		doc = _view(report_name, name, "write")
	else:
		frappe.has_permission(sv.DOCTYPE, "create", throw=True)
		if state is None or not (title or "").strip():
			frappe.throw(_("Name the view and send its state"), RVInvalidInput)
		doc = frappe.new_doc(sv.DOCTYPE)
		doc.report = report_name
		doc.visibility = "Private"
	if title is not None:
		doc.title = title
	if state is not None:
		doc.state = sv.clean_state(state)
	if visibility is not None:
		doc.visibility = visibility
	if roles is not None or visibility is not None:
		doc.set("roles", [{"role": r} for r in _roles_arg(roles)])
	if description is not None:
		doc.description = description
	if columns is not None:
		doc.flags.rv_columns = parse_json_arg(columns, "columns", list)
	if isinstance(doc.state, dict):
		doc.state = json.dumps(doc.state)
	if doc.is_new():
		doc.insert()
	else:
		doc.save()
	return {"name": doc.name, "title": doc.title, "modified": str(doc.modified)}


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def delete_view(report_name: str, name: str) -> dict:
	"""Delete a view the user owns. Nothing links to it (the defaults are a user default and a
	Data field), so the delete never fails on a link; the user's own default is cleared."""
	guard_report(report_name)
	doc = _view(report_name, name, "delete")
	doc.delete()
	if sv.user_default_name(report_name) == name:
		frappe.defaults.clear_user_default(sv.default_key(report_name))
	return {"ok": True}


@frappe.whitelist(methods=["POST"])
@_rate_limit(60)
def set_default(report_name: str, name: str | None = None) -> dict:
	"""The user's own default view of the report (``name`` empty: none). Only for the session
	user: there is no way to set another user's default."""
	guard_report(report_name)
	key = sv.default_key(report_name)
	if name:
		_view(report_name, name)
		frappe.defaults.set_user_default(key, name)
	else:
		frappe.defaults.clear_user_default(key)
	return {"ok": True}
