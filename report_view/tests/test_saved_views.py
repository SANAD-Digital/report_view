"""Saved views (ADR-010, docs/architecture.md §2.7 and §6): the privacy matrix.

A private view is seen and changed by its owner only (CLAUDE.md), System Manager included;
a shared view (Roles, Public) is read by the users who may open its report and written by its
stored owner only; the REST API cannot take a view over (``{"owner": "<me>"}``); the defaults
are the user's own (frappe.defaults) and the report's (Report View Settings), each used only
while visible."""

import json
from unittest.mock import patch

import frappe
from frappe.api import v1 as rest

from report_view import api
from report_view.api import views
from report_view.core import saved_views as sv
from report_view.core.errors import RVInvalidInput, RVInvalidViewState, RVNotOwner, RVViewNotFound
from report_view.core.settings import MERGED_CACHE_KEY, REPORT_SETTINGS
from report_view.tests.utils import DOMAIN, RVTestCase

TB = "Trial Balance"
GL = "General Ledger"
STATE = {
	"v": 1,
	"mode": "grid",
	"columns": {
		"order": [],
		"hidden": ["opening_debit"],
		"widths": {"account": 240},
		"pinned": {"start": ["account"], "end": []},
		"groups": None,
	},
	"sort": [{"key": "closing_debit", "dir": "desc"}],
	"filters": [{"key": "account", "type": "text", "op": "contains", "value": "Cash"}],
	"quick_filters": [],
	"group": {"by": [], "subtotals": True, "expanded": "all"},
	"tree": {"depth": None, "expanded": None},
	"values": [],
	"charts": None,
	"pivot": None,
	"ui": {"density": "compact", "side_panel": None},
}
# a System Manager who may also open the accounting reports (rv_t_admin may not)
MANAGER = f"rv_t_sysmanager@{DOMAIN}"
# a Report View Manager without System Manager
RV_MANAGER = f"rv_t_rvmanager@{DOMAIN}"


def _save(**kw):
	args = {"report_name": TB, "title": "Cash first", "state": json.dumps(STATE)}
	args.update(kw)
	return views.save_view(**args)


def _names(rows):
	return {r["name"] for r in rows}


class TestSavedViews(RVTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		for address, roles in (
			(MANAGER, ("Accounts User", "System Manager")),
			(RV_MANAGER, ("Accounts User", "Report View Manager")),
		):
			if not frappe.db.exists("User", address):
				frappe.get_doc(
					{
						"doctype": "User",
						"email": address,
						"first_name": address.split("@")[0],
						"send_welcome_email": 0,
						"user_type": "System User",
						"enabled": 0,
						"roles": [{"role": r} for r in roles],
					}
				).insert()

	def setUp(self):
		frappe.set_user("Administrator")
		# the class shares one transaction: each test starts with no default of anyone's
		for user in (*self.users.values(), MANAGER, RV_MANAGER):
			frappe.defaults.clear_user_default(sv.default_key(TB), user)

	def tearDown(self):
		frappe.set_user("Administrator")
		if frappe.db.exists(REPORT_SETTINGS, TB):
			frappe.delete_doc(REPORT_SETTINGS, TB, force=True)
		frappe.cache.hdel(MERGED_CACHE_KEY, TB)

	def as_email(self, address):
		return self.set_user(address)

	def owner(self):
		return self.as_user("accountant")

	# ---------------------------------------------------------------- private

	def test_a_private_view_is_seen_and_changed_by_its_owner_only(self):
		with self.owner():
			mine = _save(title="Mine only")
			self.assertIn(mine["name"], _names(views.list_views(TB)))
			got = views.get_view(TB, mine["name"])
			self.assertTrue(got["is_owner"])
			self.assertEqual(got["visibility"], "Private")
			self.assertEqual(got["state"]["sort"], STATE["sort"])
			# ui is the page's own preference, not part of a view
			self.assertNotIn("ui", got["state"])
			self.assertTrue(frappe.has_permission(sv.DOCTYPE, "write", doc=mine["name"]))
		# another accountant, a System Manager who may open the report, a System Manager who may not
		for other in (self.users["restricted"], MANAGER, self.users["admin"]):
			with self.subTest(user=other), self.as_email(other):
				self.assertNotIn(mine["name"], frappe.get_list(sv.DOCTYPE, pluck="name"))
				self.assertEqual(frappe.db.count(sv.DOCTYPE, {"name": mine["name"]}), 1)  # it exists
				self.assertFalse(frappe.has_permission(sv.DOCTYPE, "read", doc=mine["name"]))
				self.assertFalse(frappe.has_permission(sv.DOCTYPE, "write", doc=mine["name"]))
				self.assertFalse(frappe.has_permission(sv.DOCTYPE, "delete", doc=mine["name"]))
				if other != self.users["admin"]:
					self.assertNotIn(mine["name"], _names(views.list_views(TB)))
					for call in (
						lambda: views.get_view(TB, mine["name"]),
						lambda: views.save_view(TB, name=mine["name"], title="Taken"),
						lambda: views.delete_view(TB, mine["name"]),
						lambda: views.set_default(TB, mine["name"]),
					):
						with self.assertRaises(RVViewNotFound):
							call()
				else:
					# rv_t_admin may not open the report: refused before the view is looked at
					with self.assertRaises(frappe.PermissionError):
						views.list_views(TB)
		self.assertEqual(frappe.db.get_value(sv.DOCTYPE, mine["name"], "title"), "Mine only")

	def test_system_manager_is_not_exempt(self):
		with self.owner():
			public = _save(title="Shared board", visibility="Public")
		with self.as_email(MANAGER):
			self.assertIn(public["name"], _names(views.list_views(TB)))
			self.assertFalse(frappe.has_permission(sv.DOCTYPE, "write", doc=public["name"]))
			self.assertFalse(frappe.has_permission(sv.DOCTYPE, "share", doc=public["name"]))
			with self.assertRaises(RVNotOwner):
				views.save_view(TB, name=public["name"], title="Managed")
			with self.assertRaises(RVNotOwner):
				views.delete_view(TB, public["name"])
			doc = frappe.get_doc(sv.DOCTYPE, public["name"])
			doc.title = "Managed"
			with self.assertRaises(frappe.PermissionError):
				doc.save()
			with self.assertRaises(frappe.PermissionError):
				frappe.delete_doc(sv.DOCTYPE, public["name"])
		self.assertTrue(frappe.db.exists(sv.DOCTYPE, public["name"]))
		self.assertEqual(frappe.db.get_value(sv.DOCTYPE, public["name"], "title"), "Shared board")

	def test_administrator(self):
		"""Administrator passes Frappe's has_permission hook by name (a known limit, ADR-010):
		the lists and our API still hide another user's private view, and no one but the
		owner writes or deletes it."""
		with self.owner():
			mine = _save(title="Private of the accountant")
		frappe.set_user("Administrator")
		self.assertNotIn(mine["name"], frappe.get_list(sv.DOCTYPE, pluck="name"))
		self.assertNotIn(mine["name"], _names(views.list_views(TB)))
		with self.assertRaises(RVViewNotFound):
			views.get_view(TB, mine["name"])
		with self.assertRaises(RVViewNotFound):
			views.save_view(TB, name=mine["name"], title="Admin")
		# the known limit: by name, Frappe lets Administrator read the record
		self.assertTrue(frappe.has_permission(sv.DOCTYPE, "read", doc=mine["name"]))
		# but writing or deleting it is still its owner's only (the controller)
		doc = frappe.get_doc(sv.DOCTYPE, mine["name"])
		doc.title = "Admin"
		with self.assertRaises(frappe.PermissionError):
			doc.save()
		with self.assertRaises(frappe.PermissionError):
			frappe.delete_doc(sv.DOCTYPE, mine["name"])
		self.assertEqual(frappe.db.get_value(sv.DOCTYPE, mine["name"], "title"), "Private of the accountant")

	# ---------------------------------------------------------------- shared

	def test_a_public_view_is_read_by_who_may_open_the_report(self):
		with self.owner():
			public = _save(title="For all", visibility="Public")
		with self.as_user("restricted"):
			rows = views.list_views(TB)
			row = next(r for r in rows if r["name"] == public["name"])
			self.assertFalse(row["is_owner"])
			self.assertEqual(row["owner"], self.users["accountant"])
			got = views.get_view(TB, public["name"])
			self.assertFalse(got["is_owner"])
			self.assertTrue(frappe.has_permission(sv.DOCTYPE, "read", doc=public["name"]))
			self.assertFalse(frappe.has_permission(sv.DOCTYPE, "write", doc=public["name"]))
			with self.assertRaises(RVNotOwner):
				views.save_view(TB, name=public["name"], title="Mine now")
			with self.assertRaises(RVNotOwner):
				views.delete_view(TB, public["name"])
			# any user may make a visible view their own default
			views.set_default(TB, public["name"])
			self.assertEqual(sv.default_view(TB, frappe.get_doc("Report", TB))["saved_view"], public["name"])
		# a user who may not open the report sees nothing of it, through any door (rv_t_none
		# has no desk role: a website user, not even «Desk User»; the doctype is closed to them)
		with self.as_user("none"):
			with self.assertRaises(frappe.PermissionError):
				frappe.get_list(sv.DOCTYPE, pluck="name")
			self.assertFalse(frappe.has_permission(sv.DOCTYPE, "read", doc=public["name"]))
			with self.assertRaises(frappe.PermissionError):
				views.get_view(TB, public["name"])
		# of another report: not found through this one
		with self.as_user("restricted"), self.assertRaises(RVViewNotFound):
			views.get_view(GL, public["name"])

	def test_a_view_shared_with_roles(self):
		with self.owner():
			shared = _save(title="Auditors", visibility="Roles", roles=json.dumps(["Auditor"]))
			got = views.get_view(TB, shared["name"])
			self.assertEqual(got["roles"], ["Auditor"])
		with self.as_user("auditor"):
			if not sv.report_allowed(TB, frappe.session.user):
				self.skipTest("the Auditor role may not open the Trial Balance on this site")
			self.assertIn(shared["name"], _names(views.list_views(TB)))
			self.assertIn(shared["name"], frappe.get_list(sv.DOCTYPE, pluck="name"))
			self.assertTrue(frappe.has_permission(sv.DOCTYPE, "read", doc=shared["name"]))
			views.get_view(TB, shared["name"])
		with self.as_user("restricted"):
			self.assertNotIn(shared["name"], _names(views.list_views(TB)))
			self.assertNotIn(shared["name"], frappe.get_list(sv.DOCTYPE, pluck="name"))
			self.assertFalse(frappe.has_permission(sv.DOCTYPE, "read", doc=shared["name"]))
			with self.assertRaises(RVViewNotFound):
				views.get_view(TB, shared["name"])
		# made private again: the roles go, the auditor loses it
		with self.owner():
			views.save_view(TB, name=shared["name"], visibility="Private")
			self.assertEqual(views.get_view(TB, shared["name"])["roles"], [])
		with self.as_user("auditor"):
			self.assertNotIn(shared["name"], frappe.get_list(sv.DOCTYPE, pluck="name"))

	def test_the_owner_keeps_a_view_of_a_report_they_lost(self):
		with self.owner():
			mine = _save(title="Mine")
		# without the report: the record is still the owner's (to delete it), the API refuses
		with self.as_user("accountant"), patch.object(sv, "report_allowed", return_value=False):
			self.assertTrue(frappe.has_permission(sv.DOCTYPE, "read", doc=mine["name"]))
			self.assertTrue(frappe.has_permission(sv.DOCTYPE, "delete", doc=mine["name"]))

	# ---------------------------------------------------------------- REST

	def rest_update(self, name, data):
		with patch.object(rest, "get_request_form_data", return_value=data):
			return rest.update_doc(sv.DOCTYPE, name)

	def test_rest_cannot_take_a_view_over(self):
		with self.owner():
			public = _save(title="Board", visibility="Public")
		attacker = self.users["restricted"]
		for who in (attacker, MANAGER):
			with self.subTest(user=who), self.as_email(who):
				# PUT /api/resource/Report View Saved View/<name> {"owner": "<me>"}
				with self.assertRaises(frappe.PermissionError):
					self.rest_update(public["name"], {"owner": who, "title": "Taken"})
				# the same with the update applied before the check (an older Frappe's order)
				doc = frappe.get_doc(sv.DOCTYPE, public["name"])
				doc.update({"owner": who, "title": "Taken", "visibility": "Private"})
				with self.assertRaises(frappe.PermissionError):
					doc.save()
				# DELETE /api/resource/…
				with self.assertRaises(frappe.PermissionError):
					rest.delete_doc(sv.DOCTYPE, public["name"])
		row = frappe.db.get_value(sv.DOCTYPE, public["name"], ["owner", "title", "visibility"], as_dict=True)
		self.assertEqual(row, {"owner": self.users["accountant"], "title": "Board", "visibility": "Public"})
		# the owner cannot hand it to someone else either
		with self.owner(), self.assertRaises(frappe.PermissionError):
			self.rest_update(public["name"], {"owner": attacker})
		# REST reads of a private view: refused
		with self.owner():
			mine = _save(title="Private")
		with self.as_email(attacker):
			with self.assertRaises(frappe.PermissionError):
				rest.read_doc(sv.DOCTYPE, mine["name"])
			listed = frappe.call(frappe.client.get_list, sv.DOCTYPE, fields=["name"], limit_page_length=0)
			self.assertNotIn(mine["name"], {r["name"] for r in listed})
			counted = frappe.call(frappe.client.get_count, sv.DOCTYPE, filters={"name": mine["name"]})
			self.assertEqual(counted, 0)

	def test_rest_create_is_checked_like_the_api(self):
		victim = self.users["accountant"]
		with self.as_user("restricted"):
			# POST /api/resource/… with someone else as the owner: the owner is the session user
			with patch.object(
				rest,
				"get_request_form_data",
				return_value={
					"title": "Planted",
					"report": TB,
					"state": json.dumps(STATE),
					"owner": victim,
					"visibility": "Public",
					"columns_ref": json.dumps({"x": {"label": "x"}}),
				},
			):
				doc = rest.create_doc(sv.DOCTYPE)
			self.assertEqual(doc.owner, self.users["restricted"])
			# what the request wrote into columns_ref is dropped
			self.assertIsNone(doc.columns_ref)
			# an invalid state is refused for REST as for the API
			with self.assertRaises(RVInvalidViewState):
				frappe.get_doc(
					{
						"doctype": sv.DOCTYPE,
						"title": "Bad",
						"report": TB,
						"state": json.dumps({"mode": "nope"}),
					}
				).insert()
		# a report the user may not open: no view of it
		with self.as_user("none"), self.assertRaises(frappe.PermissionError):
			frappe.get_doc(
				{"doctype": sv.DOCTYPE, "title": "No", "report": TB, "state": json.dumps(STATE)}
			).insert()

	def test_the_owner_and_the_report_never_change(self):
		with self.owner():
			mine = _save(title="Fixed")
			doc = frappe.get_doc(sv.DOCTYPE, mine["name"])
			doc.report = GL
			with self.assertRaises(frappe.ValidationError):
				doc.save()

	# ---------------------------------------------------------------- validation

	def test_validation(self):
		with self.owner():
			with self.assertRaises(RVInvalidViewState):
				_save(state=json.dumps({"mode": "grid", "sort": [{"key": 1}]}))
			with self.assertRaises(RVInvalidViewState):
				_save(state=json.dumps({**STATE, "secret": 1}))
			with self.assertRaises(RVInvalidViewState):
				_save(state=json.dumps({**STATE, "report_filters": {"bad key!": 1}}))
			with self.assertRaises(RVInvalidViewState):
				_save(state="x" * (sv.MAX_STATE_BYTES + 1))
			with self.assertRaises(RVInvalidInput):
				_save(visibility="Everyone")
			with self.assertRaises(RVInvalidInput):
				_save(visibility="Roles")
			with self.assertRaises(frappe.ValidationError):
				_save(visibility="Roles", roles=json.dumps(["No Such Role"]))
			with self.assertRaises(RVInvalidInput):
				_save(visibility="Roles", roles=json.dumps(["Guest"]))
			with self.assertRaises(RVInvalidInput):
				_save(title="   ")
			first = _save(title="Twice")
			with self.assertRaises(RVInvalidInput):
				_save(title=" Twice ")
			# the browser's own parts are kept: pages mode, charts, column groups, report filters
			state = {
				**STATE,
				"mode": "pages",
				"charts": {
					"cards": [{"id": "c1", "type": "bar", "x": "account", "series": ["debit"]}],
					"slicers": [],
					"cross": None,
				},
				"columns": {
					**STATE["columns"],
					"groups": [{"id": "g1", "label": "Opening", "keys": ["opening_debit"]}],
				},
				"report_filters": {"company": "X", "cost_center": ["A", "B"], "show_zero_values": 0},
			}
			out = _save(
				title="Everything",
				state=json.dumps(state),
				visibility="Public",
				roles=json.dumps(["Auditor"]),
				columns=json.dumps(
					[
						{
							"key": "closing_debit",
							"label": "Closing (Dr)",
							"fieldtype": "Currency",
							"source_index": 7,
						},
						{"key": "unused", "label": "U"},
					]
				),
			)
			got = views.get_view(TB, out["name"])
			self.assertEqual(got["state"]["mode"], "pages")
			self.assertEqual(got["state"]["charts"]["cards"][0]["id"], "c1")
			self.assertEqual(got["state"]["columns"]["groups"][0]["id"], "g1")
			self.assertEqual(got["state"]["report_filters"]["cost_center"], ["A", "B"])
			# Public: the roles are emptied
			self.assertEqual(got["roles"], [])
			# columns_ref: the columns the state refers to only
			self.assertEqual(
				got["columns_ref"],
				{"closing_debit": {"label": "Closing (Dr)", "fieldtype": "Currency", "source_index": 7}},
			)
			self.assertEqual(frappe.db.get_value(sv.DOCTYPE, out["name"], "state_version"), 1)
			# a rename keeps the state and its columns
			views.save_view(TB, name=out["name"], title="Everything, renamed")
			again = views.get_view(TB, out["name"])
			self.assertEqual(again["title"], "Everything, renamed")
			self.assertEqual(again["columns_ref"], got["columns_ref"])
			self.assertEqual(again["visibility"], "Public")
			self.assertTrue(first["name"])

	# ---------------------------------------------------------------- defaults

	def test_defaults(self):
		report = frappe.get_doc("Report", TB)
		with self.owner():
			mine = _save(title="My default")
			public = _save(title="The team's", visibility="Public")
			self.assertEqual(sv.default_view(TB, report)["saved_view"], None)
			views.set_default(TB, mine["name"])
			self.assertEqual(
				sv.default_view(TB, report),
				{"saved_view": mine["name"], "source": "user", "title": "My default"},
			)
			self.assertEqual(api.get_meta(TB)["defaults"]["saved_view"], mine["name"])
			rows = {r["name"]: r for r in views.list_views(TB)}
			self.assertTrue(rows[mine["name"]]["is_user_default"])
			self.assertFalse(rows[public["name"]]["is_user_default"])
			# stored in the user's own defaults, under the documented key
			self.assertEqual(
				frappe.defaults.get_defaults_for(self.users["accountant"]).get("report_view_default::" + TB),
				mine["name"],
			)
		# another user's default is theirs: the restricted user has none
		with self.as_user("restricted"):
			self.assertIsNone(sv.default_view(TB, report)["saved_view"])
			with self.assertRaises(RVViewNotFound):
				views.set_default(TB, mine["name"])

		# the report's default: a shared view, in Report View Settings
		settings = frappe.get_doc(
			{"doctype": REPORT_SETTINGS, "report": TB, "default_saved_view": mine["name"]}
		)
		with self.assertRaises(frappe.ValidationError):
			# Administrator does not list another's private view; and a private view is no one's default
			settings.insert()
		settings = frappe.get_doc(
			{"doctype": REPORT_SETTINGS, "report": TB, "default_saved_view": "no-such-view"}
		)
		with self.assertRaises(frappe.ValidationError):
			settings.insert()
		settings = frappe.get_doc(
			{"doctype": REPORT_SETTINGS, "report": TB, "default_saved_view": public["name"]}
		)
		settings.insert()
		with self.as_user("restricted"):
			self.assertEqual(
				sv.default_view(TB, report),
				{"saved_view": public["name"], "source": "global", "title": "The team's"},
			)
			rows = {r["name"]: r for r in views.list_views(TB)}
			self.assertTrue(rows[public["name"]]["is_global_default"])
		# the user's own default comes first
		with self.owner():
			self.assertEqual(sv.default_view(TB, report)["source"], "user")
			# made private: no longer anyone else's default, the owner's own still
			views.save_view(TB, name=public["name"], visibility="Private")
		with self.as_user("restricted"):
			self.assertIsNone(sv.default_view(TB, report)["saved_view"])
		with self.owner():
			views.save_view(TB, name=public["name"], visibility="Public")
			# deleting a view another record names never fails (a Data field, not a Link)
			views.delete_view(TB, public["name"])
			self.assertFalse(frappe.db.exists(sv.DOCTYPE, public["name"]))
			# deleting the user's own default clears it
			views.delete_view(TB, mine["name"])
			self.assertIsNone(sv.user_default_name(TB))
		with self.as_user("restricted"):
			self.assertIsNone(sv.default_view(TB, report)["saved_view"])
		# no default: set_default(None) clears
		with self.owner():
			other = _save(title="Again")
			views.set_default(TB, other["name"])
			views.set_default(TB, None)
			self.assertIsNone(sv.user_default_name(TB))

	def test_a_stale_default_is_ignored(self):
		report = frappe.get_doc("Report", TB)
		with self.owner():
			shared = _save(title="Shared", visibility="Public")
		with self.as_user("restricted"):
			views.set_default(TB, shared["name"])
		with self.owner():
			views.save_view(TB, name=shared["name"], visibility="Private")
		with self.as_user("restricted"):
			# no longer visible: ignored when read (nothing written in a GET)
			self.assertIsNone(sv.default_view(TB, report)["saved_view"])
			self.assertEqual(sv.user_default_name(TB), shared["name"])

	def test_the_report_view_manager_sets_the_reports_default(self):
		with self.owner():
			public = _save(title="Board of the managers", visibility="Public")
		with self.as_email(RV_MANAGER):
			self.assertTrue(frappe.has_permission(REPORT_SETTINGS, "create"))
			frappe.get_doc(
				{"doctype": REPORT_SETTINGS, "report": TB, "default_saved_view": public["name"]}
			).insert()
			# and still cannot change the view itself
			with self.assertRaises(RVNotOwner):
				views.save_view(TB, name=public["name"], title="Mine")
		self.assertEqual(frappe.db.get_value(REPORT_SETTINGS, TB, "default_saved_view"), public["name"])

	def test_long_report_names_get_a_hashed_key(self):
		self.assertEqual(sv.default_key(TB), "report_view_default::" + TB)
		long = "R" * 140
		self.assertLessEqual(len(sv.default_key(long)), 140)
		self.assertTrue(sv.default_key(long).startswith("report_view_default::"))

	def test_permission_query_conditions_shape(self):
		cond = sv.permission_query_conditions(self.users["none"])
		# no report allowed: the owner branch alone (no "in ()")
		self.assertNotIn("in ()", cond)
		self.assertIn("`owner` =", cond)
		cond = sv.permission_query_conditions("Administrator")
		self.assertIn("'Public'", cond)
