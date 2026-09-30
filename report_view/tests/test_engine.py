from frappe.tests import UnitTestCase

from report_view.core import engine
from report_view.core.normalize import normalize
from report_view.tests.utils import TB_MEASURES, load_fixtures

# GL `balance` is a running balance: not additive, no reference (ADR-008 amendment).
NON_ADDITIVE = {"general_ledger_consolidated": {"balance"}, "general_ledger_by_account": {"balance"}}


def _nr(name: str) -> dict:
	case = next(c for c in load_fixtures() if c["name"] == name)
	i = case["input"]
	return normalize(i["raw"], i["filters"], i["report_settings"], i["register"])


def _num(value) -> float:
	return float(value) if value not in (None, "") else 0.0


class TestEngine(UnitTestCase):
	def test_totals_match_reference_rows(self):
		"""ADR-008: engine grand totals = internal 'Total' or Frappe total row, unfiltered."""
		for case in load_fixtures():
			i = case["input"]
			nr = normalize(i["raw"], i["filters"], i["report_settings"], i["register"])
			internal = nr["report_totals"]["internal"]
			reference = internal[-1] if internal else nr["report_totals"]["frappe_total"]
			if reference is None:
				continue
			result = engine.apply(nr, {"v": 1})
			skip = NON_ADDITIVE.get(case["name"], set())
			with self.subTest(case=case["name"]):
				for key, value in result["totals"].items():
					if key in skip or reference.get(key) is None or isinstance(value, dict):
						continue
					self.assertAlmostEqual(_num(value), _num(reference[key]), places=2, msg=key)

	def test_trial_balance_tree_total_is_root_sum(self):
		nr = _nr("trial_balance_fy2026")
		result = engine.apply(nr, {"v": 1, "tree": {"depth": 3}})
		total = nr["report_totals"]["internal"][-1]
		for key in TB_MEASURES:
			self.assertAlmostEqual(result["totals"][key], total[key], places=2)
		self.assertEqual(result["layout_mode"], "tree")
		self.assertEqual(result["row_count"], len(nr["facts"]))
		# The report's own 'Total' row is replaced by the engine's grand total row.
		self.assertNotIn(total["__rid"], [r["rid"] for r in result["rows"]])
		self.assertTrue(any(r["collapsed"] for r in result["rows"]))

	def test_tree_filter_keeps_ancestors(self):
		nr = _nr("trial_balance_fy2026")
		leaf = next(r for r in nr["facts"] if r["debit"])
		state = {
			"v": 1,
			"filters": [{"key": "account", "type": "text", "op": "equals", "value": leaf["account"]}],
		}
		result = engine.apply(nr, state)
		self.assertEqual(result["row_count"], 1)
		self.assertEqual(result["totals"]["debit"], leaf["debit"])
		self.assertEqual(result["rows"][-1]["rid"], leaf["__rid"])
		self.assertEqual(result["rows"][0]["level"], 0)

	def test_group_by_with_subtotals(self):
		nr = _nr("accounts_receivable_frappe_total")
		result = engine.apply(nr, {"v": 1, "group": {"by": ["party"], "subtotals": True}})
		groups = [r for r in result["rows"] if r["kind"] == "group"]
		self.assertTrue(groups)
		self.assertEqual(sum(g["count"] for g in groups), len(nr["facts"]))
		self.assertAlmostEqual(sum(g["values"]["paid"] for g in groups), result["totals"]["paid"], places=2)

	def test_filters_and_sort(self):
		nr = _nr("accounts_receivable_frappe_total")
		parties = sorted({r["party"] for r in nr["facts"]})
		state = {
			"v": 1,
			"filters": [
				{"key": "party", "type": "set", "values": [parties[0]], "exclude": False},
				{"key": "paid", "type": "range", "min": 0.01, "max": None},
			],
			"sort": [{"key": "paid", "dir": "desc"}],
		}
		result = engine.apply(nr, state)
		expected = [r for r in nr["facts"] if r["party"] == parties[0] and (r["paid"] or 0) >= 0.01]
		self.assertEqual(result["row_count"], len(expected))
		paid = [r["values"]["paid"] for r in result["rows"]]
		self.assertEqual(paid, sorted(paid, reverse=True))
		self.assertAlmostEqual(result["totals"]["paid"], sum(r["paid"] for r in expected), places=2)

	def test_text_search_and_exclude(self):
		nr = _nr("stock_balance")
		result = engine.apply(
			nr,
			{
				"v": 1,
				"filters": [
					{"key": "*", "type": "text", "op": "contains", "value": "TEST", "source": "search"}
				],
			},
		)
		self.assertTrue(all("test" in r["values"]["item_code"].lower() for r in result["rows"]))
		excluded = engine.apply(
			nr,
			{"v": 1, "filters": [{"key": "item_code", "type": "set", "values": ["test"], "exclude": True}]},
		)
		self.assertEqual(result["row_count"] + excluded["row_count"], len(nr["facts"]))

	def test_mixed_currency_and_percent_avg(self):
		nr = _nr("synthetic_edge_shapes")
		result = engine.apply(
			nr, {"v": 1, "filters": [{"key": "label", "type": "text", "op": "starts_with", "value": "a"}]}
		)
		self.assertEqual(result["totals"]["amount"], {"mixed": True})
		self.assertEqual(result["totals"]["amount__2"], 15.5)
		self.assertEqual(result["totals"]["rate"], 37.5)

	def test_selection_and_columns(self):
		nr = _nr("stock_balance")
		rids = [nr["facts"][0]["__rid"], nr["facts"][1]["__rid"]]
		result = engine.apply(nr, {"v": 1}, {"row_rids": rids, "column_keys": ["item_code", "bal_qty"]})
		self.assertEqual(result["row_count"], 2)
		self.assertEqual([c["key"] for c in result["columns"]], ["item_code", "bal_qty"])

	def test_derived_date_keys(self):
		row = {"d": "2026-05-17"}
		self.assertEqual(engine.derived_value(row, "d__year"), "2026")
		self.assertEqual(engine.derived_value(row, "d__quarter"), "2026-Q2")
		self.assertEqual(engine.derived_value(row, "d__month"), "2026-05")
