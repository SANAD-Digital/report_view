"""hooks.py against what the app ships (ADR-007)."""

import json
import os

from frappe.tests import UnitTestCase

from report_view import hooks

FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")


def _file_names(doctype: str) -> set[str]:
	path = os.path.join(FIXTURES, doctype.lower().replace(" ", "_") + ".json")
	with open(path, encoding="utf-8") as f:
		return {row["name"] for row in json.load(f)}


class TestFixtureFilters(UnitTestCase):
	def test_every_shipped_record_is_in_the_fixture_filter(self):
		"""``bench export-fixtures`` writes only what the filter names: a shipped record
		missing from the filter would be dropped from the file on the next export."""
		for entry in hooks.fixtures:
			names = {n for f in entry["filters"] if f[:2] == ["name", "in"] for n in f[2]}
			with self.subTest(doctype=entry["dt"]):
				self.assertEqual(names, _file_names(entry["dt"]))

	def test_every_shipped_record_goes_with_the_app(self):
		"""``bench remove-app`` deletes the records of the app's module (ADR-019): the
		Property Setter and the shipped Custom format must be of module Report View."""
		for doctype in ("Property Setter", "Print Format"):
			path = os.path.join(FIXTURES, doctype.lower().replace(" ", "_") + ".json")
			with open(path, encoding="utf-8") as f:
				for row in json.load(f):
					with self.subTest(doctype=doctype, name=row["name"]):
						self.assertEqual(row.get("module"), "Report View")
