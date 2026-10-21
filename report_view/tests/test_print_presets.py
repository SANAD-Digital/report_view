"""Print presets (ADR-020): a private preset is its owner's only, public ones are seen by all
and written by a publisher (System Manager or Report Manager), the settings are checked."""

import json

import frappe

from report_view.api import print_presets as api
from report_view.core import print_presets as pp
from report_view.core.errors import RVInvalidInput
from report_view.tests.utils import DOMAIN, RVTestCase

TB = "Trial Balance"
SETTINGS = {"size": "A4", "orientation": "landscape", "page_numbers": True, "page_m": {"top": 10, "bottom": 10, "start": 8, "end": 8}, "hidden": ["debit"]}
PUBLISHER = f"rv_t_publisher@{DOMAIN}"
# a System Manager who may also run the accounting reports (rv_t_admin may not)
MANAGER = f"rv_t_sysmanager@{DOMAIN}"


def _save(**kw):
	args = {"context": "Report", "target": TB, "preset_name": "Landscape", "settings": json.dumps(SETTINGS)}
	args.update(kw)
	return api.save(**args)


def _names(out, group):
	return {r["name"] for r in out[group]}


class TestPrintPresets(RVTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		for email, roles in ((PUBLISHER, ("Accounts User", "Report Manager")), (MANAGER, ("Accounts User", "System Manager"))):
			if not frappe.db.exists("User", email):
				frappe.get_doc(
					{
						"doctype": "User",
						"email": email,
						"first_name": email.split("@")[0],
						"send_welcome_email": 0,
						"user_type": "System User",
						"enabled": 0,
						"roles": [{"role": r} for r in roles],
					}
				).insert()

	def as_email(self, email):
		return self.set_user(email)

	def test_a_private_preset_is_its_owners_only(self):
		with self.as_user("restricted"):
			mine = _save(preset_name="Mine only")
		self.assertFalse(mine["public"])
		self.assertTrue(mine["can_edit"])
		self.assertEqual(frappe.db.get_value("Print Preset", mine["name"], "for_user"), self.users["restricted"])
		with self.as_user("restricted"):
			self.assertIn(mine["name"], _names(api.list("Report", TB), "mine"))
		for other in (self.users["accountant"], MANAGER):
			with self.as_email(other):
				out = api.list("Report", TB)
				self.assertNotIn(mine["name"], _names(out, "mine") | _names(out, "public"))
				self.assertNotIn(mine["name"], frappe.get_list("Print Preset", pluck="name"))
				self.assertFalse(frappe.has_permission("Print Preset", "read", doc=mine["name"]))
				with self.assertRaises(frappe.PermissionError):
					api.save(context="Report", target=TB, name=mine["name"], preset_name="Taken")
				with self.assertRaises(frappe.PermissionError):
					api.delete(mine["name"])
				with self.assertRaises(frappe.PermissionError):
					api.set_default(mine["name"])
		# REST-like edit that hands it to another user is refused for the owner too
		with self.as_user("restricted"):
			doc = frappe.get_doc("Print Preset", mine["name"])
			doc.for_user = self.users["accountant"]
			with self.assertRaises(frappe.PermissionError):
				doc.save()

	def test_public_presets_are_seen_by_all_and_written_by_publishers(self):
		with self.as_email(MANAGER):
			public = _save(preset_name="House style", public=1)
		self.assertTrue(public["public"])
		for kind in ("accountant", "restricted"):
			with self.as_user(kind):
				out = api.list("Report", TB)
				self.assertIn(public["name"], _names(out, "public"))
				self.assertFalse(out["can_publish"])
				row = next(r for r in out["public"] if r["name"] == public["name"])
				self.assertFalse(row["can_edit"])
				with self.assertRaises(frappe.PermissionError):
					api.save(context="Report", target=TB, name=public["name"], preset_name="Mine now")
				with self.assertRaises(frappe.PermissionError):
					api.delete(public["name"])
		with self.as_email(PUBLISHER):
			out = api.list("Report", TB)
			self.assertTrue(out["can_publish"])
			edited = api.save(context="Report", target=TB, name=public["name"], description="Edited by a Report Manager")
			self.assertEqual(edited["description"], "Edited by a Report Manager")

	def test_only_publishers_make_a_preset_public(self):
		with self.as_user("accountant"):
			with self.assertRaises(frappe.PermissionError):
				_save(preset_name="Everyone", public=1)
			mine = _save(preset_name="Soon public")
			with self.assertRaises(frappe.PermissionError):
				api.save(context="Report", target=TB, name=mine["name"], public=1)
			# the REST way, on the record itself
			doc = frappe.get_doc("Print Preset", mine["name"])
			doc.for_user = None
			with self.assertRaises(frappe.PermissionError):
				doc.save()
		with self.as_email(PUBLISHER):
			out = _save(preset_name="Team style", public=1)
			self.assertTrue(out["public"])

	def test_target_and_general_presets(self):
		with self.as_user("accountant"):
			general = _save(preset_name="All reports", for_all=1)
			own = _save(preset_name="TB only")
			self.assertFalse(general["specific"])
			self.assertTrue(own["specific"])
			out = api.list("Report", TB)
			order = [r["name"] for r in out["mine"]]
			self.assertLess(order.index(own["name"]), order.index(general["name"]))
			self.assertTrue(all(r["specific"] for r in out["mine"][: order.index(own["name"]) + 1]))
			other = api.list("Report", "General Ledger")
			self.assertIn(general["name"], _names(other, "mine"))
			self.assertNotIn(own["name"], _names(other, "mine"))
			self.assertEqual(sorted(out["keys"]), sorted(pp.SETTINGS_KEYS))

	def test_the_target_is_checked_first(self):
		with self.as_user("none"):
			with self.assertRaises(frappe.PermissionError):
				api.list("Report", TB)
		with self.as_user("accountant"):
			with self.assertRaises(RVInvalidInput):
				api.list("Spreadsheet", TB)
			with self.assertRaises(frappe.DoesNotExistError):
				api.list("Document", "No Such Doctype")

	def test_one_default_per_audience_and_target(self):
		with self.as_user("accountant"):
			a = _save(preset_name="A", is_default=1)
			b = _save(preset_name="B", is_default=1)
			self.assertEqual(frappe.db.get_value("Print Preset", a["name"], "is_default"), 0)
			self.assertEqual(frappe.db.get_value("Print Preset", b["name"], "is_default"), 1)
			api.set_default(a["name"])
			self.assertEqual(frappe.db.get_value("Print Preset", b["name"], "is_default"), 0)
			api.set_default(a["name"], 0)
			self.assertEqual(frappe.db.get_value("Print Preset", a["name"], "is_default"), 0)
		# another user's default is theirs: untouched
		with self.as_user("restricted"):
			c = _save(preset_name="C", is_default=1)
		with self.as_user("accountant"):
			_save(preset_name="D", is_default=1)
		self.assertEqual(frappe.db.get_value("Print Preset", c["name"], "is_default"), 1)

	def test_the_settings_are_validated(self):
		with self.as_user("accountant"):
			with self.assertRaises(RVInvalidInput):
				_save(settings=json.dumps({"size": "A4", "evil": "<script>"}))
			with self.assertRaises(RVInvalidInput):
				_save(settings=json.dumps({"wm_text": "x" * (40 * 1024)}))
			with self.assertRaises(RVInvalidInput):
				_save(settings=json.dumps({"page_m": {"top": "1; drop"}}))
			with self.assertRaises(RVInvalidInput):
				_save(settings="[1, 2]")
			with self.assertRaises(RVInvalidInput):
				_save(settings="{not json")
			with self.assertRaises(RVInvalidInput):
				_save(preset_name="   ")
			ok = _save(preset_name="Valid")
			self.assertEqual(ok["settings"], SETTINGS)
			with self.assertRaises(RVInvalidInput):
				_save(preset_name="Valid")

	def test_save_as_new_and_update_and_delete(self):
		with self.as_user("accountant"):
			first = _save(preset_name="Draft")
			copy = api.save(context="Report", target=TB, name=first["name"], as_new=1, preset_name="Draft copy", settings=json.dumps({"size": "A5"}))
			self.assertNotEqual(copy["name"], first["name"])
			self.assertEqual(frappe.db.get_value("Print Preset", first["name"], "preset_name"), "Draft")
			updated = api.save(context="Report", target=TB, name=first["name"], settings=json.dumps({"size": "Letter"}))
			self.assertEqual(updated["settings"], {"size": "Letter"})
			self.assertEqual(updated["preset_name"], "Draft")
			with self.assertRaises(RVInvalidInput):
				api.save(context="Document", target="Journal Entry", name=first["name"], preset_name="x")
			api.delete(first["name"])
			self.assertFalse(frappe.db.exists("Print Preset", first["name"]))
