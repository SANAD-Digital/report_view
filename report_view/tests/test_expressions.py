from frappe.tests import UnitTestCase

from report_view.core.expressions import (
	MAX_DEPTH,
	MAX_EXPRESSION_LENGTH,
	ExpressionError,
	compile_expression,
)

# The table of the Perspective 3.8.0 probe (ADR-013): x and y are float columns.
ROWS = [
	{"x": 1.5, "y": None},
	{"x": None, "y": 2.0},
	{"x": 0.0, "y": 0.0},
	{"x": -3.0, "y": None},
	{"x": None, "y": None},
]
T, F = True, False
# expression -> what Perspective answered, row by row (measured in node, see the ADR).
MEASURED = {
	'abs("x") > 0.005': [T, F, F, T, F],
	'"x" > 0.005': [T, T, F, F, T],
	'"x" < 0.005': [F, F, T, T, F],
	'"x" == 0': [F, F, T, F, F],
	'"x" != 0': [T, T, F, T, T],
	'abs("x") > 0.005 or abs("y") > 0.005': [T, T, F, T, F],
	'abs("x") > 0.005 and abs("y") > 0.005': [F, F, F, F, F],
	'abs("x") == 0': [F, F, T, F, F],
	'abs("x") > 0.005 or "y" > 1': [T, T, F, T, T],
	'(abs("x") > 0.005 or abs("y") > 0.005) and "x" >= -2': [T, T, F, F, F],
	'"x" >= 0': [T, T, T, F, T],
	'"x" <= 0': [F, F, T, T, F],
	'0.005 < abs("x")': [T, F, F, T, F],
	'"x" > 1 or "y" > 1 and "x" < 0': [T, T, F, T, T],
	'abs("x") < 1': [F, T, T, F, T],
	'abs("x") <= 1': [F, T, T, F, T],
	'abs("x") != 0': [T, T, F, T, T],
	'abs("x") >= 0': [T, F, T, T, F],
	'0.005 < "x"': [T, T, F, F, T],
	'"x" != 1': [T, T, T, T, T],
	'"x" > -10': [T, T, T, T, T],
	'"x" < 1e12': [T, F, T, T, F],
	'(("x" > 0))': [T, T, F, F, T],
	'"x" > 0 and "y" > 0': [T, T, F, F, T],
	'"x" > 0 or "y" > 0': [T, T, F, T, T],
	'abs("x") > 1': [T, F, F, T, F],
	'abs("x") > 1e0': [T, F, F, T, F],
	'"x" == 1.5': [T, F, F, F, F],
}
# Outside the grammar: valid or not in Perspective, the server does not guess them.
REFUSED = (
	'not(abs("x") > 0.005)',
	'"x" > "y"',
	'-"x" > 1',
	"\"s\" == 'a'",
	'abs("x")',
	'"x" + 1 > 0',
	'is_null("x")',
	'"x" > 1 or',
	'("x" > 1',
	'"x" > 1 and and "y" > 1',
	'"x" >> 1',
	'"a b" > 1',
	"abs > 1",
	"",
	"   ",
	'"x" > 1 ; drop',
	'"x" > nan',
	'"x" > 1 or x',
	'"x" > ' + "9" * 400,
)


class TestExpressions(UnitTestCase):
	def test_null_semantics_match_perspective(self):
		for text, want in MEASURED.items():
			expression = compile_expression(text)
			with self.subTest(expression=text):
				self.assertEqual([expression.matches(row) for row in ROWS], want)

	def test_keys(self):
		self.assertEqual(compile_expression('abs("x") > 0.005 or "y" > 1').keys, {"x", "y"})
		self.assertEqual(compile_expression('"amount__2" >= 10').keys, {"amount__2"})

	def test_refused(self):
		for text in REFUSED:
			with self.subTest(expression=text), self.assertRaises(ExpressionError):
				compile_expression(text)
		with self.assertRaises(ExpressionError):
			compile_expression('"x" > 1' + " " * MAX_EXPRESSION_LENGTH)
		with self.assertRaises(ExpressionError):
			compile_expression("(" * (MAX_DEPTH + 2) + '"x" > 1' + ")" * (MAX_DEPTH + 2))
		for bad in (None, 1, ["x"], {"x": 1}):
			with self.subTest(expression=bad), self.assertRaises(ExpressionError):
				compile_expression(bad)

	def test_missing_key_is_null(self):
		"""A key absent from the values (the column is empty in the row) is a null."""
		self.assertTrue(compile_expression('"x" > 0').matches({}))
		self.assertFalse(compile_expression('abs("x") > 0').matches({}))
