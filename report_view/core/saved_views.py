"""Saved views (ADR-010, docs/architecture.md §6): a view of a report saved under a name.

Visibility: ``Private`` (its owner only), ``Roles`` (the users of the roles in ``roles``) or
``Public`` (every user); a shared view is seen only by a user who may open its report. One
rule (``is_visible``) is applied in three places, because the standard REST endpoints do not
pass through ``report_view.api.views``:

- ``permission_query_conditions`` (lists: ``frappe.get_list``, ``/api/resource``,
  ``frappe.desk.reportview``), for every user, Administrator included;
- the ``has_permission`` hook (one record): ``read`` by ``is_visible``, every write by the
  **stored** owner only (System Manager included: no role is exempt);
- ``report_view.api.views``, explicitly (Administrator passes the hook by name,
  ``frappe/permissions.py:107``).

The stored owner, never the ``owner`` of the request: REST applies the request's values to the
document before ``save`` checks the permission (``frappe/api/v1.py`` ``update_doc``), and
``owner`` is not a reserved key, so a request ``{"owner": "<me>"}`` must not hand a view over.
``validate`` refuses a change of owner or report and checks everything else (title, report,
visibility, roles, state) for the REST API too.

The defaults have no DocType: the user's own in ``frappe.defaults``
(``report_view_default::<report>``), the report's in ``Report View Settings.default_saved_view``
(a Data field, so deleting a view never fails on a link). Each is used only while the user
may see it.
"""

import hashlib
import json
import math
import re

import frappe
from frappe import _

from report_view.core import view_state
from report_view.core.errors import RVInvalidInput, RVInvalidViewState
from report_view.core.guard import guard_report, guard_report_quiet

DOCTYPE = "Report View Saved View"
ROLE_DOCTYPE = "Report View Saved View Role"
SETTINGS_DOCTYPE = "Report View Settings"
VISIBILITY = ("Private", "Roles", "Public")
# roles a view cannot be shared with: Guest is nobody signed in, All includes website users
NO_SHARE_ROLES = frozenset(("Guest", "All", "Administrator"))
OWNER_PTYPES = frozenset(("write", "delete", "cancel", "submit", "amend", "share"))
READ_PTYPES = frozenset(("read", "email", "print"))
DEFAULT_KEY = "report_view_default::"
# DefaultValue.defkey is a Data field (varchar 140)
_DEFKEY_MAX = 140
MAX_TITLE = 140
MAX_TEXT = 2000
MAX_STATE_BYTES = 256 * 1024
MAX_ROLES = 50
MAX_FILTER_KEYS = 100
MAX_LIST_VIEWS = 500
_FIELDNAME_RE = re.compile(r"^[A-Za-z0-9_]+$")
_PRIMITIVES = (str, int, float, bool, type(None))

# what the browser's view state holds beyond the server's export schema (core/view_state):
# the charts dashboard, the column groups and the Pages mode (state/view_state.js)
BROWSER_MODES = (*view_state.MODES, "pages")
CHART_KEYS = frozenset(("cards", "slicers", "cross"))
MAX_CARDS = 50
MAX_GROUPS = 50


# ---------------------------------------------------------------- who sees what


def allowed_report_names(user: str) -> set[str]:
	"""The reports ``user`` may open by their roles, as Desk's boot lists them (cached by
	Frappe per user, cleared with the user's cache)."""
	try:
		from frappe.desk.desk_views import DeskViews

		return set(DeskViews.get_allowed_report_names(cache=True, user=user))
	except ImportError:
		from frappe.boot import get_allowed_report_names

		return set(get_allowed_report_names(cache=True))


def report_allowed(report_name: str, user: str) -> bool:
	"""Whether ``user`` may open the report. The session user: ``guard_report`` itself (roles,
	``report`` permission on its doctype, disabled), with its refusal messages removed;
	another user: the reports their roles allow."""
	if not report_name:
		return False
	if user == frappe.session.user:
		return guard_report_quiet(report_name) is not None
	return report_name in allowed_report_names(user)


def _as_doc(doc):
	return frappe.get_doc(DOCTYPE, doc) if isinstance(doc, str) else doc


def stored_owner(doc) -> str | None:
	"""The owner in the database: the copy before save, else the row; a new view's own."""
	doc = _as_doc(doc)
	if doc.is_new():
		return doc.owner or frappe.session.user
	before = doc.get_doc_before_save() if hasattr(doc, "get_doc_before_save") else None
	if before:
		return before.owner
	return frappe.db.get_value(DOCTYPE, doc.name, "owner") or doc.owner


def view_roles(doc) -> set[str]:
	return {r.role for r in (doc.get("roles") or []) if r.get("role")}


def is_visible(doc, user: str | None = None) -> bool:
	"""ADR-010: the owner; or, for a user who may open the report, a public view or one shared
	with one of their roles."""
	user = user or frappe.session.user
	doc = _as_doc(doc)
	if stored_owner(doc) == user:
		return True
	if doc.visibility not in ("Public", "Roles"):
		return False
	if not report_allowed(doc.report, user):
		return False
	if doc.visibility == "Public":
		return True
	return bool(view_roles(doc) & set(frappe.get_roles(user)))


def has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""``has_permission`` hook. Every branch returns a bool (``None`` denies in Frappe)."""
	user = user or frappe.session.user
	doc = _as_doc(doc)
	if ptype in OWNER_PTYPES:
		return stored_owner(doc) == user
	if ptype in READ_PTYPES:
		return is_visible(doc, user)
	# create (checked by validate: the report must open for the user) and the rest: DocPerm
	return True


def permission_query_conditions(user=None, doctype=None) -> str:
	"""Lists: the user's own views, and the shared ones of the reports their roles allow.
	Applied to every user (Administrator included: no private view of another in a list)."""
	user = user or frappe.session.user
	t = f"`tab{DOCTYPE}`"
	esc = frappe.db.escape
	branches = [f"{t}.`owner` = {esc(user)}"]
	reports = sorted(allowed_report_names(user))
	if reports:
		shared = [f"{t}.`visibility` = 'Public'"]
		roles = sorted(set(frappe.get_roles(user)) - NO_SHARE_ROLES)
		if roles:
			shared.append(
				f"({t}.`visibility` = 'Roles' and {t}.`name` in ("
				f"select `parent` from `tab{ROLE_DOCTYPE}` where `parenttype` = {esc(DOCTYPE)}"
				f" and `parentfield` = 'roles' and `role` in ({', '.join(esc(r) for r in roles)})))"
			)
		branches.append(
			f"({t}.`report` in ({', '.join(esc(r) for r in reports)}) and ({' or '.join(shared)}))"
		)
	return "(" + " or ".join(branches) + ")"


# ---------------------------------------------------------------- the state


def _bad_state(message: str):
	frappe.throw(message, RVInvalidViewState)


def _plain(value, depth: int = 0) -> bool:
	"""JSON of plain values: text, finite numbers, switches, null, lists and objects of them."""
	if depth > 8:
		return False
	if isinstance(value, float):
		return math.isfinite(value)
	if isinstance(value, _PRIMITIVES):
		return True
	if isinstance(value, list):
		return all(_plain(v, depth + 1) for v in value)
	if isinstance(value, dict):
		return all(isinstance(k, str) and _plain(v, depth + 1) for k, v in value.items())
	return False


def _check_report_filters(value) -> None:
	if not isinstance(value, dict) or len(value) > MAX_FILTER_KEYS:
		_bad_state(_("View state: invalid report_filters"))
	for key, v in value.items():
		if not isinstance(key, str) or not _FIELDNAME_RE.match(key):
			_bad_state(_("View state: invalid report_filters"))
		values = v if isinstance(v, list) else [v]
		if len(values) > view_state.MAX_SET_VALUES or not all(
			isinstance(x, _PRIMITIVES) and not (isinstance(x, str) and len(x) > MAX_TEXT) for x in values
		):
			_bad_state(_("View state: invalid report_filters"))
		if not _plain(v):
			_bad_state(_("View state: invalid report_filters"))


def _check_charts(value) -> None:
	"""The charts dashboard: its shape only; the browser checks every card again on apply
	(state/dashboard_state.js sanitize_dashboard)."""
	if value is None:
		return
	if not isinstance(value, dict) or not set(value) <= CHART_KEYS or not _plain(value):
		_bad_state(_("View state: invalid charts"))
	for key, limit in (("cards", MAX_CARDS), ("slicers", MAX_CARDS)):
		items = value.get(key)
		if items is not None and (
			not isinstance(items, list) or len(items) > limit or not all(isinstance(c, dict) for c in items)
		):
			_bad_state(_("View state: invalid charts"))
	if value.get("cross") is not None and not isinstance(value["cross"], dict):
		_bad_state(_("View state: invalid charts"))


def _check_groups(value) -> None:
	"""The column groups: null (the report's own) or a list of groups (state/column_groups.js)."""
	if value is None:
		return
	if (
		not isinstance(value, list)
		or len(value) > MAX_GROUPS
		or not all(isinstance(g, dict) for g in value)
		or not _plain(value)
	):
		_bad_state(_("View state: invalid columns.groups"))


def clean_state(raw) -> dict:
	"""The state of a view: a JSON object of at most 256 KB, schema v1 (``core/view_state``)
	with what the browser adds to it (the charts, the column groups, the Pages mode). The
	page's own preferences (``ui``: density, side panel) are not part of a view."""
	if isinstance(raw, str):
		if len(raw.encode("utf-8")) > MAX_STATE_BYTES:
			_bad_state(_("The view is too large"))
		try:
			raw = json.loads(raw)
		except ValueError:
			_bad_state(_("The view is not valid JSON"))
	if not isinstance(raw, dict):
		_bad_state(_("View state must be an object"))
	state = json.loads(json.dumps(raw))
	state.pop("ui", None)
	charts = state.pop("charts", None)
	_check_charts(charts)
	cols = state.get("columns")
	groups = cols.pop("groups", None) if isinstance(cols, dict) else None
	_check_groups(groups)
	if state.get("report_filters") is not None:
		_check_report_filters(state["report_filters"])
	mode = state.get("mode", "grid")
	if mode not in BROWSER_MODES:
		_bad_state(_("View state: invalid mode"))
	if mode == "pages":
		state["mode"] = "grid"
	state = view_state.validate(state)
	state["mode"] = mode
	state["charts"] = charts
	if isinstance(state.get("columns"), dict):
		state["columns"]["groups"] = groups
	if len(json.dumps(state, separators=(",", ":")).encode("utf-8")) > MAX_STATE_BYTES:
		_bad_state(_("The view is too large"))
	return state


def columns_ref(state: dict, columns) -> dict | None:
	"""``{key: {label, fieldtype, source_index}}`` of the columns the state refers to, built
	from the report's columns as the page sent them. Only a hint for finding a renamed or
	moved column again (§7.3): never read as a permission, never taken from the request as
	it is (the REST API cannot write it)."""
	if not isinstance(columns, list):
		return None
	keys = view_state.referenced_keys(state)
	out = {}
	for i, col in enumerate(columns[:2000]):
		if not isinstance(col, dict):
			continue
		key = col.get("key")
		if not isinstance(key, str) or key not in keys or len(key) > MAX_TITLE:
			continue
		label = col.get("label")
		fieldtype = col.get("fieldtype")
		index = col.get("source_index", i)
		out[key] = {
			"label": label[:MAX_TITLE] if isinstance(label, str) else "",
			"fieldtype": fieldtype[:40] if isinstance(fieldtype, str) else "",
			"source_index": index if isinstance(index, int) and not isinstance(index, bool) else i,
		}
	return out or None


def parse_state(value) -> dict:
	"""The stored state, migrated (§7.3); a state newer than this version as it is (the browser
	opens the report's default view and says why)."""
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except ValueError:
			return {}
	if not isinstance(value, dict):
		return {}
	version = value.get("v")
	if isinstance(version, int) and not isinstance(version, bool) and version > view_state.VERSION:
		return value
	try:
		return view_state.migrate(value)
	except frappe.ValidationError:
		return value


# ---------------------------------------------------------------- validation


def _bad(message: str):
	frappe.throw(message, RVInvalidInput)


def _clean_roles(doc) -> list[str]:
	seen = []
	for row in doc.get("roles") or []:
		role = (row.get("role") or "").strip()
		if role and role not in seen:
			seen.append(role)
	return seen


def validate_view(doc) -> None:
	"""The controller's checks, for ``api.views`` and REST alike (§6)."""
	if not doc.is_new():
		before = doc.get_doc_before_save()
		owner = before.owner if before else stored_owner(doc)
		if doc.owner != owner:
			frappe.throw(_("The owner of a saved view cannot be changed"), frappe.PermissionError)
		# its owner only, whoever asks (Administrator passes the has_permission hook by name)
		check_owner(doc, owner)
		if before and before.report != doc.report:
			frappe.throw(_("The report of a saved view cannot be changed"), RVInvalidInput)

	doc.title = (doc.title or "").strip()
	if not doc.title:
		_bad(_("Name the view"))
	if len(doc.title) > MAX_TITLE:
		_bad(_("The name of the view is too long"))
	if not isinstance(doc.report, str) or not doc.report:
		_bad(_("The report of the view is required"))
	# the view of a report the user may not open is never saved (REST included)
	guard_report(doc.report)

	if doc.visibility not in VISIBILITY:
		_bad(_("Invalid visibility of the view"))
	roles = _clean_roles(doc)
	if doc.visibility == "Roles":
		if not roles:
			_bad(_("Choose the roles the view is shared with"))
		if len(roles) > MAX_ROLES:
			_bad(_("A view can be shared with at most {0} roles").format(MAX_ROLES))
		for role in roles:
			if role in NO_SHARE_ROLES or not frappe.db.exists("Role", role):
				_bad(_("Role {0} not found").format(role))
		doc.set("roles", [{"role": r} for r in roles])
	else:
		doc.set("roles", [])

	state = clean_state(doc.state)
	doc.state = json.dumps(state, separators=(",", ":"), sort_keys=True)
	doc.state_version = view_state.VERSION
	# columns_ref: built here from the columns the page sent (api.views.save_view); what a
	# request writes into the field itself is dropped
	ref = columns_ref(state, doc.flags.rv_columns) if doc.flags.rv_columns is not None else None
	if ref is None and not doc.is_new() and doc.flags.rv_columns is None:
		before = doc.get_doc_before_save()
		same_state = before and _state_text(before.state) == doc.state
		ref = _json_or_none(before.columns_ref) if same_state else None
	doc.columns_ref = json.dumps(ref, separators=(",", ":"), sort_keys=True) if ref else None
	doc.description = (doc.description or "").strip()[:MAX_TEXT] or None

	if _title_taken(doc):
		_bad(_("A view named {0} already exists for this report").format(doc.title))


def check_owner(doc, owner: str | None = None) -> None:
	"""Only the owner writes or deletes a view: also Administrator, whom Frappe lets past the
	``has_permission`` hook (code that deletes on purpose passes ``ignore_permissions``)."""
	if doc.flags.ignore_permissions:
		return
	if (owner or stored_owner(doc)) != frappe.session.user:
		frappe.throw(_("Only the owner of a saved view can change or delete it"), frappe.PermissionError)


def _state_text(value) -> str:
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except ValueError:
			return value
	return json.dumps(value, separators=(",", ":"), sort_keys=True)


def _json_or_none(value):
	if isinstance(value, str):
		try:
			return json.loads(value)
		except ValueError:
			return None
	return value or None


def _title_taken(doc) -> bool:
	"""One title per owner and report (the owner always lists their own views)."""
	return bool(
		frappe.get_list(
			DOCTYPE,
			filters={
				"owner": stored_owner(doc),
				"report": doc.report,
				"title": doc.title,
				"name": ("!=", doc.name or ""),
			},
			pluck="name",
			limit=1,
		)
	)


# ---------------------------------------------------------------- defaults


def default_key(report_name: str) -> str:
	"""The user's default view of a report in ``frappe.defaults`` (a name longer than the key
	allows is hashed)."""
	key = DEFAULT_KEY + report_name
	if len(key) > _DEFKEY_MAX:
		key = DEFAULT_KEY + hashlib.sha1(report_name.encode("utf-8")).hexdigest()
	return key


def user_default_name(report_name: str, user: str | None = None) -> str | None:
	"""The user's own default (never a global ``frappe.defaults`` value of the same key)."""
	value = frappe.defaults.get_defaults_for(user or frappe.session.user).get(default_key(report_name))
	if isinstance(value, list):
		value = value[0] if value else None
	return value or None


def global_default_name(report) -> str | None:
	"""``Report View Settings.default_saved_view`` of the report (keyed by its resolved name)."""
	name = report.name if hasattr(report, "name") else report
	if not frappe.db.exists(SETTINGS_DOCTYPE, name):
		return None
	return frappe.db.get_value(SETTINGS_DOCTYPE, name, "default_saved_view") or None


def _visible_view(name: str | None, report_names: set[str], public_only: bool = False):
	"""The view named ``name`` if it exists, is of the report and the user may see it."""
	if not name or not isinstance(name, str):
		return None
	if not frappe.db.exists(DOCTYPE, name):
		return None
	doc = frappe.get_doc(DOCTYPE, name)
	if doc.report not in report_names or not is_visible(doc):
		return None
	if public_only and doc.visibility == "Private":
		return None
	return doc


def default_view(report_name: str, report) -> dict:
	"""The view to open with (get_meta.defaults): the user's default, then the report's,
	each only while the user may see it; read only (a stale default is ignored, not cleared,
	in a GET)."""
	names = {report_name, report.name}
	doc = _visible_view(user_default_name(report_name), names)
	if doc:
		return {"saved_view": doc.name, "source": "user", "title": doc.title}
	doc = _visible_view(global_default_name(report), names, public_only=True)
	if doc:
		return {"saved_view": doc.name, "source": "global", "title": doc.title}
	return {"saved_view": None, "source": None, "title": None}


def validate_global_default(settings_doc) -> None:
	"""``Report View Settings.default_saved_view``: a shared view of that report that the
	person saving the settings may see (a private view is nobody else's default)."""
	name = (settings_doc.get("default_saved_view") or "").strip()
	settings_doc.default_saved_view = name or None
	if not name:
		return
	rows = frappe.get_list(DOCTYPE, filters={"name": name}, fields=["name", "report", "visibility"], limit=1)
	if not rows or rows[0].report != settings_doc.report:
		frappe.throw(_("Saved view {0} of report {1} not found").format(name, settings_doc.report))
	if rows[0].visibility == "Private":
		frappe.throw(_("A private view cannot be the default of the report: share it first"))
