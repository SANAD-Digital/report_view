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
