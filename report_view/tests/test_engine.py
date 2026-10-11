import copy
import json
import os

from frappe.tests import UnitTestCase

from report_view.core import engine
from report_view.core.normalize import normalize
from report_view.tests.utils import FIXTURES_DIR, TB_MEASURES, load_fixtures

SCREEN_CASES = os.path.join(os.path.dirname(FIXTURES_DIR), "screen", "cases.json")
ROW_KINDS = {"group": "group", "foot": "foot"}
# What the browser names the source of the grand total (post.total.source).
TOTAL_SOURCES = {"row": "reference", "frappe_total": "frappe_total", "row0": "engine", "view": "engine"}


def _nr(name: str) -> dict:
	case = next(c for c in load_fixtures() if c["name"] == name)
	i = case["input"]
	return normalize(i["raw"], i["filters"], i["report_settings"], i["register"])


def _num(value) -> float:
	return float(value) if value not in (None, "") else 0.0


def _visible(result: dict) -> list[dict]:
	return [r for r in result["rows"] if not r["hidden"]]


def _kinds(result: dict) -> list[str]:
	return [r["kind"] for r in result["rows"]]


class TestEngineMatchesBrowser(UnitTestCase):
	"""The Python engine against what Perspective shows for the same view state.

	``fixtures/screen/cases.json`` is written by ``fixtures/screen/generate.mjs`` from the
	browser engine itself (the modules of the page, Perspective in node).
	"""

	def test_rows_totals_and_columns(self):
		with open(SCREEN_CASES, encoding="utf-8") as f:
			cases = json.load(f)
		self.assertGreaterEqual(len(cases), 30)
		for case in cases:
			with self.subTest(case=case["name"]):
				self._compare(case)

	def _compare(self, case: dict) -> None:
		nr = _nr(case["fixture"])
		result = engine.apply(nr, {"v": 1, **case["state"]}, lang=case["lang"])
		by_rid = {r["__rid"]: r for r in nr["rows"]}
		by_key = {c["key"]: c for c in nr["columns"]}
		measures = [c["key"] for c in nr["columns"] if c["role"] == "measure"]

		# "report" (the rows as reported) is the flat shape of a report with inner summary rows.
		self.assertEqual(result["layout_mode"], {"report": "flat"}.get(case["shape"], case["shape"]))
		pinned = [{"t": "row", "rid": rid, "depth": 0} for rid in case["pinned"]["top"]]
		screen = [*pinned, *case["rows"]]
		screen += [{"t": "row", "rid": rid, "depth": 0} for rid in case["pinned"]["bottom"]]
		shown = _visible(result)
		self.assertEqual(len(shown), len(screen))
		for n, (want, have) in enumerate(zip(screen, shown, strict=True)):
			where = f"row {n}"
			self.assertEqual(ROW_KINDS.get(have["kind"], "row"), want["t"], where)
			self.assertEqual(have["level"], want["depth"], where)
			moved = case["subtotals"] and want.get("open")
			if want["t"] == "row":
				self.assertEqual(have["rid"], want["rid"], where)
				if want.get("parent"):
					self.assertEqual((have["kind"], have["open"]), ("parent", want["open"]), where)
					# An open parent keeps its title only: its numbers stand in its subtotal row.
					carried = [k for k in measures if have["values"].get(k) is not None]
					self.assertEqual(bool(carried), not moved, where)
			elif want["t"] == "group":
				self.assertEqual((have["open"], have["count"]), (want["open"], want["count"]), where)
				if want["node"] is not None:
					self.assertEqual(have["rid"], want["node"], where)
				else:
					column = by_key[have["group_key"]]
					value = engine.typed_value({column["key"]: have["group_value"]}, column)
					self.assertEqual(engine._group_path_value(value, column)[1], want["value"], where)
				for key, value in want["vals"].items():
					self._same(have["values"].get(key), None if moved else value, f"{where} {key}")
			else:
				values = want["vals"]
				if values is None:
					# Subtotal row of a parent of the tree "as is": the parent's own values.
					self.assertEqual(have["rid"], want["of"], where)
					values = {k: by_rid[want["of"]].get(k) for k in measures}
				for key, value in values.items():
					self._same(have["values"].get(key), value, f"{where} {key}")

		for key, value in case["totals"].items():
			if case["mixed"].get(key):
				self.assertEqual(result["totals"][key], {"mixed": True}, key)
			else:
				self._same(result["totals"][key], value, f"total {key}")
		# What the browser sends as `expected` is what the server compares (§8أ.6).
		self.assertEqual(result["row_count"], case["expected"]["row_count"])
		for key, value in case["expected"]["totals"].items():
			self._same(result["totals"][key], value, f"expected {key}")
		self.assertEqual(result["total_source"], TOTAL_SOURCES[case["total_source"]])
		self.assertEqual([c["key"] for c in result["columns"] if not c["hidden"]], case["keys"])

	def _same(self, have, want, msg: str) -> None:
		if isinstance(have, dict):
			return
		if isinstance(want, int | float) or want is None:
			self.assertAlmostEqual(_num(have), _num(want), places=2, msg=msg)


class TestEngine(UnitTestCase):
	# ------------------------------------------------------------ 1. tree

	def test_tree_as_is_is_the_report_itself(self):
		"""N9 / ADR-008: the report's rows with their own values; total = reference row."""
		nr = _nr("trial_balance_fy2026")
		result = engine.apply(nr, {"v": 1, "group": {"by": [], "subtotals": False}, "tree": {"depth": 9}})
		nodes = [r for r in nr["rows"] if r["__kind"] == "data"]
		self.assertEqual(result["layout_mode"], "tree")
		self.assertEqual([r["rid"] for r in result["rows"]], [r["__rid"] for r in nodes])
		for out, row in zip(result["rows"], nodes, strict=True):
			for key in TB_MEASURES:
				self.assertEqual(out["values"][key], row[key])
		reference = nr["report_totals"]["internal"][-1]
		self.assertEqual(result["total_source"], "reference")
		self.assertEqual(result["totals"], {k: reference[k] for k in TB_MEASURES})
		self.assertEqual(result["row_count"], len(nr["facts"]))
		self.assertNotIn(reference["__rid"], [r["rid"] for r in result["rows"]])

	def test_tree_total_is_the_reference_row_not_a_sum(self):
		nr = copy.deepcopy(_nr("trial_balance_fy2026"))
		reference = nr["report_totals"]["internal"][-1]
		roots = sum(r["closing_debit"] for r in nr["rows"] if r["__kind"] == "data" and r["__parent"] is None)
		reference["closing_debit"] = roots + 1000
		self.assertEqual(engine.apply(nr, {"v": 1})["totals"]["closing_debit"], roots + 1000)

	def test_tree_filtered_and_grouped_views_come_from_the_leaves(self):
		nr = _nr("trial_balance_fy2026")
		leaves_closing = sum(r["closing_debit"] for r in nr["facts"])
		reference = nr["report_totals"]["internal"][-1]
		self.assertNotAlmostEqual(leaves_closing, reference["closing_debit"], places=2)
		state = {"v": 1, "filters": [{"key": "debit", "type": "range", "min": None, "max": 1e15}]}
		filtered = engine.apply(nr, state)
		self.assertEqual(filtered["layout_mode"], "levels")
		self.assertEqual(filtered["total_source"], "engine")
		self.assertAlmostEqual(filtered["totals"]["closing_debit"], leaves_closing, places=2)
		grouped = engine.apply(nr, {"v": 1, "group": {"by": ["currency"]}})
		self.assertAlmostEqual(grouped["totals"]["closing_debit"], leaves_closing, places=2)
		# A parent of the re-grouped tree is the sum of its matching leaves.
		info = engine.tree_index(nr)
		for out in filtered["rows"]:
			if out["kind"] != "foot":
				continue
			leaves = [f for f in nr["facts"] if out["rid"] in info[f["__rid"]]["ancestors"]]
			self.assertAlmostEqual(out["values"]["debit"], sum(f["debit"] for f in leaves), places=2)

	def test_tree_filter_keeps_ancestors(self):
		nr = _nr("trial_balance_fy2026")
		leaf = next(r for r in nr["facts"] if r["debit"])
		state = {
			"v": 1,
			"group": {"by": [], "subtotals": False},
			"tree": {"depth": 9},
			"filters": [{"key": "account", "type": "text", "op": "equals", "value": leaf["account"]}],
		}
		result = engine.apply(nr, state)
		self.assertEqual(result["row_count"], 1)
		self.assertEqual(result["totals"]["debit"], leaf["debit"])
		self.assertEqual(result["rows"][-1]["rid"], leaf["__rid"])
		self.assertEqual([r["level"] for r in result["rows"]], list(range(len(result["rows"]))))
		self.assertTrue(all(r["values"]["debit"] == leaf["debit"] for r in result["rows"]))

	# ------------------------------------------- 2-3. the report's own rows

	def test_flat_total_is_the_reference_row_as_reported(self):
		"""GL: `balance` of the grand total is the reference row's, not a sum of balances."""
		for name in ("general_ledger_consolidated", "general_ledger_by_account"):
			nr = _nr(name)
			reference = nr["report_totals"]["internal"][-1]
			result = engine.apply(nr, {"v": 1})
			with self.subTest(case=name):
				self.assertEqual(result["total_source"], "reference")
				self.assertEqual(result["totals"]["balance"], reference["balance"])
				self.assertNotAlmostEqual(sum(_num(r["balance"]) for r in nr["facts"]), reference["balance"])
				self.assertEqual(result["totals"]["debit"], reference["debit"])
				self.assertNotIn(reference["__rid"], [r["rid"] for r in result["rows"]])

	def test_flat_total_with_filter_or_group_is_the_engine_sum(self):
		nr = _nr("general_ledger_consolidated")
		balances = sum(_num(r["balance"]) for r in nr["facts"])
		for state in (
			{"v": 1, "filters": [{"key": "debit", "type": "range", "min": -1e15, "max": None}]},
			{"v": 1, "group": {"by": ["voucher_type"]}},
		):
			result = engine.apply(nr, state)
			with self.subTest(state=state):
				self.assertEqual(result["total_source"], "engine")
				self.assertEqual(result["row_count"], len(nr["facts"]))
				self.assertAlmostEqual(result["totals"]["balance"], balances, places=2)
				self.assertFalse({"opening", "closing", "internal_total"} & set(_kinds(result)))

	def test_sort_alone_keeps_opening_first_and_closing_last(self):
		nr = _nr("general_ledger_consolidated")
		reference = nr["report_totals"]["internal"][-1]
		for sort in ([], [{"key": "debit", "dir": "desc"}]):
			result = engine.apply(nr, {"v": 1, "sort": sort})
			kinds = _kinds(result)
			with self.subTest(sort=sort):
				self.assertEqual(kinds, ["opening", *["data"] * len(nr["facts"]), "closing"])
				self.assertEqual(result["totals"]["balance"], reference["balance"])
		debits = [_num(r["values"]["debit"]) for r in result["rows"] if r["kind"] == "data"]
		self.assertEqual(debits, sorted(debits, reverse=True))

	def test_rows_of_the_reports_own_groups(self):
		"""GL by account / AR by party: in place as reported; a sort keeps the report's own only."""
		nr = _nr("general_ledger_by_account")
		reference = nr["report_totals"]["internal"][-1]["__rid"]
		plain = engine.apply(nr, {"v": 1})
		order = [r["__rid"] for r in nr["rows"] if r["__kind"] != "separator" and r["__rid"] != reference]
		# The report's closing follows its total in the report; the total is the last row of the file.
		self.assertEqual([r["rid"] for r in plain["rows"]], order)
		self.assertEqual((plain["rows"][0]["kind"], plain["rows"][-1]["kind"]), ("opening", "closing"))
		self.assertEqual(_kinds(plain).count("opening"), 1 + _kinds(plain).count("internal_total"))

		sorted_view = engine.apply(nr, {"v": 1, "sort": [{"key": "posting_date", "dir": "desc"}]})
		self.assertEqual(_kinds(sorted_view), ["opening", *["data"] * len(nr["facts"]), "closing"])
		self.assertEqual(sorted_view["rows"][0]["rid"], plain["rows"][0]["rid"])
		self.assertEqual(sorted_view["rows"][-1]["rid"], plain["rows"][-1]["rid"])
		self.assertEqual(sorted_view["total_source"], "reference")

		ar = _nr("accounts_receivable_group_by_party")
		result = engine.apply(ar, {"v": 1})
		self.assertEqual(_kinds(result).count("internal_total"), len(ar["report_totals"]["internal"]) - 1)
		self.assertEqual(result["totals"]["paid"], ar["report_totals"]["internal"][-1]["paid"])

	# ------------------------------------------------- 4-5. groups and folding

	def test_group_subtotals(self):
		nr = _nr("accounts_receivable_group_by_party")
		with_feet = engine.apply(nr, {"v": 1, "group": {"by": ["party"], "subtotals": True}})
		groups = [r for r in with_feet["rows"] if r["kind"] == "group"]
		feet = [r for r in with_feet["rows"] if r["kind"] == "foot"]
		self.assertEqual(len(groups), len(feet))
		self.assertEqual(sum(g["count"] for g in groups), len(nr["facts"]))
		self.assertTrue(all(g["values"] == {} and g["open"] for g in groups))
		self.assertAlmostEqual(sum(f["values"]["paid"] for f in feet), with_feet["totals"]["paid"], places=2)
		# A subtotal row stands right after the rows of its group.
		first_foot = with_feet["rows"].index(feet[0])
		self.assertEqual(first_foot, 1 + groups[0]["count"])
		self.assertEqual(feet[0]["group_value"], groups[0]["group_value"])
		for group, foot in zip(groups, feet, strict=True):
			members = [r for r in nr["facts"] if r["party"] == group["group_value"]]
			self.assertAlmostEqual(foot["values"]["paid"], sum(_num(r["paid"]) for r in members), places=2)

		without = engine.apply(nr, {"v": 1, "group": {"by": ["party"], "subtotals": False}})
		self.assertNotIn("foot", _kinds(without))
		heads = [r for r in without["rows"] if r["kind"] == "group"]
		self.assertEqual([h["values"]["paid"] for h in heads], [f["values"]["paid"] for f in feet])

	def test_group_fold_is_hidden_not_removed(self):
		nr = _nr("accounts_receivable_group_by_party")
		parties = list(dict.fromkeys(r["party"] for r in nr["facts"]))
		open_all = engine.apply(nr, {"v": 1, "group": {"by": ["party"], "subtotals": False}})
		state = {"v": 1, "group": {"by": ["party"], "subtotals": True, "expanded": [[parties[1]]]}}
		result = engine.apply(nr, state)
		# The same rows as the open view, plus the subtotal row of the one open group.
		self.assertEqual(len(result["rows"]), len(open_all["rows"]) + 1)
		for out in result["rows"]:
			if out["kind"] == "group":
				is_open = out["group_value"] == parties[1]
				self.assertEqual(out["open"], is_open)
				# A folded group always carries its numbers; an open one leaves them to its subtotal row.
				self.assertEqual("paid" in out["values"], not is_open)
				self.assertFalse(out["hidden"])
			elif out["kind"] == "data":
				self.assertEqual(out["hidden"], out["values"]["party"] != parties[1])
		self.assertEqual([r["group_value"] for r in result["rows"] if r["kind"] == "foot"], [parties[1]])

		none = engine.apply(nr, {"v": 1, "group": {"by": ["party"], "expanded": "none"}})
		self.assertEqual({r["kind"] for r in _visible(none)}, {"group"})
		self.assertEqual(sum(1 for r in none["rows"] if r["hidden"]), len(nr["facts"]))
		self.assertEqual(none["totals"], open_all["totals"])

	def test_tree_fold(self):
		nr = _nr("trial_balance_fy2026")
		info = engine.tree_index(nr)
		# Without tree.depth the tree opens to the report's initial depth, as on screen.
		default = engine.apply(nr, {"v": 1, "group": {"by": [], "subtotals": False}})
		initial = nr["tree"]["initial_depth"]
		self.assertEqual(len(default["rows"]), len(info))
		for out in default["rows"]:
			self.assertEqual(out["hidden"], out["level"] > initial)
			if out["kind"] == "parent":
				self.assertEqual(out["open"], out["level"] < initial)

		roots = [rid for rid, node in info.items() if node["depth"] == 0 and node["children"]]
		listed = engine.apply(nr, {"v": 1, "tree": {"depth": None, "expanded": [roots[0]]}})
		for out in listed["rows"]:
			if out["kind"] == "foot":
				self.assertEqual(out["rid"], roots[0])
				continue
			ancestors = info[out["rid"]]["ancestors"]
			self.assertEqual(out["hidden"], bool(ancestors) and ancestors != [roots[0]])
		# The open parent keeps its title, its subtotal row its numbers; folded ones carry theirs.
		head = next(r for r in listed["rows"] if r["rid"] == roots[0] and r["kind"] == "parent")
		foot = next(r for r in listed["rows"] if r["kind"] == "foot")
		self.assertNotIn("debit", head["values"])
		self.assertEqual(foot["values"]["debit"], info[roots[0]]["row"]["debit"])
		self.assertEqual(foot["label"], info[roots[0]]["row"]["account"])
		folded = next(r for r in listed["rows"] if r["kind"] == "parent" and r["rid"] != roots[0])
		self.assertEqual(folded["values"]["debit"], info[folded["rid"]]["row"]["debit"])

	# ------------------------------------------------------- 6. columns

	def test_pinned_columns_follow_the_label_column(self):
		nr = _nr("accounts_receivable_group_by_party")
		state = {"v": 1, "columns": {"pinned": {"start": ["voucher_no", "paid", "party"]}}}
		result = engine.apply(nr, state)
		keys = [c["key"] for c in result["columns"]]
		source = [c["key"] for c in nr["columns"] if not c["hidden"]]
		# A measure is not pinned on screen: it stays in its place.
		self.assertEqual(keys[:3], [source[0], "voucher_no", "party"])
		self.assertEqual(keys[3:], [k for k in source[1:] if k not in ("voucher_no", "party")])
		self.assertEqual(result["label_key"], source[0])

		layout = [{"key": k} for k in reversed(source)]
		result = engine.apply(nr, state, layout_columns=layout)
		keys = [c["key"] for c in result["columns"]]
		at = keys.index(source[0])
		self.assertEqual(keys[at : at + 3], [source[0], "voucher_no", "party"])

	def test_column_order_and_hidden(self):
		nr = _nr("accounts_receivable_group_by_party")
		state = {"v": 1, "columns": {"order": ["paid", "party"], "hidden": ["posting_date"]}}
		keys = [c["key"] for c in engine.apply(nr, state)["columns"]]
		self.assertEqual(keys[:2], ["paid", "party"])
		self.assertNotIn("posting_date", keys)
		self.assertEqual(len(keys), len([c for c in nr["columns"] if not c["hidden"]]) - 1)

	def test_selection_and_columns(self):
		nr = _nr("stock_balance")
		rids = [nr["facts"][0]["__rid"], nr["facts"][1]["__rid"]]
		result = engine.apply(nr, {"v": 1}, {"row_rids": rids, "column_keys": ["item_code", "bal_qty"]})
		self.assertEqual(result["row_count"], 2)
		self.assertEqual([c["key"] for c in result["columns"]], ["item_code", "bal_qty"])
		self.assertEqual(result["total_source"], "engine")

	# ---------------------------------------------- 7. Perspective semantics

	def test_null_semantics_of_aggregates(self):
		column = {"key": "n", "fieldtype": "Float", "role": "measure", "agg": "sum"}
		rows = [{"n": 3}, {"n": None}, {"n": ""}, {"n": -5}, {"n": 3}]
		empty = [{"n": None}, {"n": ""}]
		self.assertEqual(engine.aggregate(rows, column), 1)
		self.assertEqual(engine.aggregate(empty, column), 0)
		self.assertAlmostEqual(engine.aggregate(rows, column, "avg"), 1 / 3)
		self.assertIsNone(engine.aggregate(empty, column, "avg"))
		self.assertEqual(engine.aggregate(rows, column, "min"), -5)
		self.assertEqual(engine.aggregate(rows, column, "max"), 3)
		self.assertIsNone(engine.aggregate(empty, column, "max"))
		self.assertEqual(engine.aggregate(rows, column, "count"), 5)
		self.assertEqual(engine.aggregate(rows, column, "count_distinct"), 3)
		self.assertIsNone(engine.aggregate(rows, {**column, "original": {"disable_total": 1}}))

	def test_sort_puts_nulls_last_ascending_first_descending(self):
		nr = _nr("accounts_receivable_group_by_party")
		for direction, at in (("asc", -1), ("desc", 0)):
			state = {"v": 1, "sort": [{"key": "due_date", "dir": direction}]}
			result = engine.apply(nr, state)
			dates = [r["values"]["due_date"] for r in result["rows"] if r["kind"] == "data"]
			present = [d for d in dates if d]
			self.assertEqual(present, sorted(present, reverse=direction == "desc"))
			if len(present) < len(dates):
				self.assertIsNone(dates[at])

	def test_text_filters_as_perspective(self):
		nr = _nr("general_ledger_consolidated")
		kinds = {r["voucher_type"] for r in nr["facts"]}
		one = sorted(kinds)[0]

		def count(op: str, value: str) -> int:
			flt = {"key": "voucher_type", "type": "text", "op": op, "value": value}
			return engine.apply(nr, {"v": 1, "filters": [flt]})["row_count"]

		expected = sum(1 for r in nr["facts"] if r["voucher_type"] == one)
		self.assertEqual(count("equals", one), expected)
		# "==" is exact; "contains" and "begins with" ignore the case of ASCII letters.
		self.assertEqual(count("equals", one.lower()), 0)
		self.assertEqual(count("starts_with", one.lower()), count("starts_with", one))
		self.assertGreaterEqual(count("contains", one[1:].upper()), expected)
		# A filter without a value is no filter: the summary rows stay.
		empty = {"key": "voucher_type", "type": "text", "op": "contains", "value": ""}
		self.assertEqual(engine.apply(nr, {"v": 1, "filters": [empty]})["total_source"], "reference")

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
		excluded = engine.apply(
			nr,
			{"v": 1, "filters": [{"key": "party", "type": "set", "values": [parties[0]], "exclude": True}]},
		)
		included = sum(1 for r in nr["facts"] if r["party"] == parties[0])
		self.assertEqual(excluded["row_count"] + included, len(nr["facts"]))

	def test_quick_filter_narrows_the_facts(self):
		"""ADR-013: an active quick filter is a browser filter; its definition travels with it."""
		nr = _nr("trial_balance_fy2026")
		definitions = [
			{"id": "debit_closing", "expression": 'abs("closing_debit") > 0.005'},
			{"id": "other", "expression": '"debit" > 1e9'},
		]
		expected = [r for r in nr["facts"] if abs(r.get("closing_debit") or 0) > 0.005]
		self.assertTrue(0 < len(expected) < len(nr["facts"]))
		result = engine.apply(nr, {"v": 1, "quick_filters": ["debit_closing"]}, quick_filters=definitions)
		self.assertEqual(result["layout_mode"], "levels")
		self.assertEqual(result["total_source"], "engine")
		self.assertEqual(result["row_count"], len(expected))
		for key in TB_MEASURES:
			self.assertAlmostEqual(
				result["totals"][key], sum(_num(r[key]) for r in expected), places=2, msg=key
			)
		leaves = [r["rid"] for r in result["rows"] if r["kind"] == "data"]
		self.assertEqual(leaves, [r["__rid"] for r in expected])
		# Two active quick filters are an "and"; an id without a definition is not applied.
		both = engine.apply(
			nr, {"v": 1, "quick_filters": ["debit_closing", "other"]}, quick_filters=definitions
		)
		self.assertEqual(both["row_count"], 0)
		unknown = engine.apply(
			nr, {"v": 1, "quick_filters": ["debit_closing", "nope"]}, quick_filters=definitions
		)
		self.assertEqual(unknown["row_count"], len(expected))
		# Without an active id the definitions change nothing: the tree "as is".
		plain = engine.apply(nr, {"v": 1}, quick_filters=definitions)
		self.assertEqual((plain["layout_mode"], plain["total_source"]), ("tree", "reference"))
		# With a column filter too, both narrow.
		state = {
			"v": 1,
			"quick_filters": ["debit_closing"],
			"filters": [{"key": "credit", "type": "range", "min": 0.005, "max": None}],
		}
		narrowed = engine.apply(nr, state, quick_filters=definitions)
		self.assertEqual(narrowed["row_count"], sum(1 for r in expected if (r.get("credit") or 0) >= 0.005))

	def test_frappe_total_row_matches_engine_total(self):
		"""ADR-008: without filters the engine total equals Frappe's own total row."""
		for name in ("accounts_receivable_frappe_total", "stock_balance", "stock_projected_qty"):
			nr = _nr(name)
			reference = nr["report_totals"]["frappe_total"]
			result = engine.apply(nr, {"v": 1})
			with self.subTest(case=name):
				self.assertEqual(result["total_source"], "engine")
				for key, value in result["totals"].items():
					if reference.get(key) in (None, "") or isinstance(value, dict):
						continue
					self.assertAlmostEqual(_num(value), _num(reference[key]), places=2, msg=key)

	def test_mixed_currency_and_percent_avg(self):
		nr = _nr("synthetic_edge_shapes")
		result = engine.apply(
			nr, {"v": 1, "filters": [{"key": "label", "type": "text", "op": "starts_with", "value": "a"}]}
		)
		self.assertEqual(result["totals"]["amount"], {"mixed": True})
		self.assertEqual(result["totals"]["amount__2"], 15.5)
		self.assertEqual(result["totals"]["rate"], 37.5)

	def test_collation_key(self):
		words = ["b", "A", "أحمد", "ب", "10", "9", "x10", "x9", "_x", "é", "f"]
		arabic = sorted(words, key=lambda w: engine.collation_key(w, "ar"))
		self.assertEqual(arabic, ["_x", "9", "10", "أحمد", "ب", "A", "b", "é", "f", "x9", "x10"])
		english = sorted(words, key=lambda w: engine.collation_key(w, "en"))
		self.assertEqual(english, ["_x", "9", "10", "A", "b", "é", "f", "x9", "x10", "أحمد", "ب"])
		# Alef with hamza and the bare alef are one letter for the collator.
		self.assertEqual(engine.collation_key("\u0623", "ar"), engine.collation_key("\u0627", "ar"))

	def test_typed_values(self):
		import datetime
		from decimal import Decimal

		date_col = {"key": "d", "fieldtype": "Date"}
		self.assertEqual(engine.typed_value({"d": datetime.date(2026, 5, 17)}, date_col), "2026-05-17")
		self.assertEqual(engine.typed_value({"d": "2026-05-17 10:00:00"}, date_col), "2026-05-17")
		self.assertIsNone(engine.typed_value({"d": "17-05-2026"}, date_col))
		stamp = {"key": "d", "fieldtype": "Datetime"}
		self.assertEqual(engine.typed_value({"d": "1970-01-02 00:00:01"}, stamp), 86401000.0)
		number = {"key": "d", "fieldtype": "Currency"}
		self.assertEqual(engine.typed_value({"d": Decimal("2.5")}, number), 2.5)
		self.assertIsNone(engine.typed_value({"d": "abc"}, number))
		self.assertIsNone(engine.typed_value({"d": ""}, {"key": "d", "fieldtype": "Data"}))
