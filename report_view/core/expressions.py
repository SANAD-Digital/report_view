"""Closed grammar of the quick-filter expressions (ADR-013, docs/architecture.md §4.2 bis).

A quick filter (``register.quick_filters``) is a boolean Perspective expression the browser
adds as an expression column and filters with ``== true``. The export model carries the
definitions of the active ones and the server evaluates them on the facts of its own run with
this module: a parser for the subset below and an evaluator with the null semantics measured
on Perspective 3.8.0 (``docs/adr/013-quick-filters-export.md``). Pure functions, no database.

    expr       := term ("or" term)*
    term       := factor ("and" factor)*
    factor     := "(" expr ")" | comparison
    comparison := operand op number | number op operand
    operand    := '"' key '"' | "abs" "(" '"' key '"' ")"
    op         := ">" | ">=" | "<" | "<=" | "==" | "!="

``key`` is a column key (``[A-Za-z0-9_]+``). Anything else (functions other than ``abs``,
column against column, string literals, ``not``) is refused: the file must not guess.

Null semantics of Perspective, mirrored exactly:
- a bare column that is null compares as the largest value: ``>``, ``>=``, ``!=`` hold,
  ``<``, ``<=``, ``==`` do not (the same rule as its sort: nulls are the largest value);
- ``abs(null)`` is null and compares as the smallest value: ``<``, ``<=``, ``!=`` hold,
  ``>``, ``>=``, ``==`` do not;
- ``and`` binds tighter than ``or``.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from typing import Any

MAX_EXPRESSION_LENGTH = 500
MAX_DEPTH = 20

_TOKEN_RE = re.compile(
	r"""\s*(?:
	(?P<column>"[A-Za-z0-9_]+")
	|(?P<number>-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)
	|(?P<op>>=|<=|==|!=|>|<)
	|(?P<word>[A-Za-z_][A-Za-z0-9_]*)
	|(?P<paren>[()])
	)""",
	re.VERBOSE,
)
_OPERATORS: dict[str, Callable[[float, float], bool]] = {
	">": lambda a, b: a > b,
	">=": lambda a, b: a >= b,
	"<": lambda a, b: a < b,
	"<=": lambda a, b: a <= b,
	"==": lambda a, b: a == b,
	"!=": lambda a, b: a != b,
}
_FLIPPED = {">": "<", ">=": "<=", "<": ">", "<=": ">=", "==": "==", "!=": "!="}
# What a null is worth in a comparison (measured, see the module docstring).
_NULL_BARE = math.inf
_NULL_ABS = -math.inf

# Compiled node: ("or", [nodes]) | ("and", [nodes]) | ("cmp", key, is_abs, op, number)
Node = tuple


class ExpressionError(ValueError):
	"""The text is not an expression of the grammar."""


class Expression:
	"""A compiled quick-filter expression: ``keys`` it reads and ``matches(values)``."""

	__slots__ = ("_node", "keys", "text")

	def __init__(self, text: str, node: Node, keys: frozenset[str]) -> None:
		self.text = text
		self._node = node
		self.keys = keys

	def matches(self, values: dict[str, float | None]) -> bool:
		"""Whether a row passes; ``values`` maps every key of ``keys`` to a float or None."""
		return _evaluate(self._node, values)


def compile_expression(text: Any) -> Expression:
	"""Parse ``text``; raise ``ExpressionError`` when it is outside the grammar."""
	if not isinstance(text, str) or not text.strip():
		raise ExpressionError("empty expression")
	if len(text) > MAX_EXPRESSION_LENGTH:
		raise ExpressionError("expression too long")
	parser = _Parser(_tokenize(text))
	node = parser.expr(0)
	if parser.peek() is not None:
		raise ExpressionError(f"unexpected token {parser.peek()[1]!r}")
	keys: set[str] = set()
	_collect_keys(node, keys)
	return Expression(text, node, frozenset(keys))


def _tokenize(text: str) -> list[tuple[str, str]]:
	tokens: list[tuple[str, str]] = []
	pos = 0
	while pos < len(text):
		if text[pos:].strip() == "":
			break
		match = _TOKEN_RE.match(text, pos)
		if not match:
			raise ExpressionError(f"unexpected character {text[pos]!r}")
		kind = match.lastgroup or ""
		value = match.group(kind)
		if kind == "word" and value not in ("and", "or", "abs"):
			raise ExpressionError(f"unknown word {value!r}")
		tokens.append((kind, value))
		pos = match.end()
	return tokens


class _Parser:
	def __init__(self, tokens: list[tuple[str, str]]) -> None:
		self.tokens = tokens
		self.at = 0

	def peek(self) -> tuple[str, str] | None:
		return self.tokens[self.at] if self.at < len(self.tokens) else None

	def take(self, kind: str, value: str | None = None) -> str:
		token = self.peek()
		if token is None or token[0] != kind or (value is not None and token[1] != value):
			want = value if value is not None else kind
			raise ExpressionError(f"expected {want!r}" + (f", got {token[1]!r}" if token else ""))
		self.at += 1
		return token[1]

	def expr(self, depth: int) -> Node:
		terms = [self.term(depth)]
		while self.peek() == ("word", "or"):
			self.at += 1
			terms.append(self.term(depth))
		return terms[0] if len(terms) == 1 else ("or", terms)

	def term(self, depth: int) -> Node:
		factors = [self.factor(depth)]
		while self.peek() == ("word", "and"):
			self.at += 1
			factors.append(self.factor(depth))
		return factors[0] if len(factors) == 1 else ("and", factors)

	def factor(self, depth: int) -> Node:
		if depth > MAX_DEPTH:
			raise ExpressionError("expression nested too deep")
		if self.peek() == ("paren", "("):
			self.at += 1
			node = self.expr(depth + 1)
			self.take("paren", ")")
			return node
		return self.comparison()

	def comparison(self) -> Node:
		token = self.peek()
		if token is not None and token[0] == "number":
			number = float(self.take("number"))
			op = _FLIPPED[self.take("op")]
			key, is_abs = self.operand()
		else:
			key, is_abs = self.operand()
			op = self.take("op")
			number = float(self.take("number"))
		if not math.isfinite(number):
			raise ExpressionError("number out of range")
		return ("cmp", key, is_abs, op, number)

	def operand(self) -> tuple[str, bool]:
		if self.peek() == ("word", "abs"):
			self.at += 1
			self.take("paren", "(")
			key = self.take("column")[1:-1]
			self.take("paren", ")")
			return key, True
		return self.take("column")[1:-1], False


def _collect_keys(node: Node, keys: set[str]) -> None:
	if node[0] == "cmp":
		keys.add(node[1])
	else:
		for child in node[1]:
			_collect_keys(child, keys)


def _evaluate(node: Node, values: dict[str, float | None]) -> bool:
	kind = node[0]
	if kind == "or":
		return any(_evaluate(child, values) for child in node[1])
	if kind == "and":
		return all(_evaluate(child, values) for child in node[1])
	_kind, key, is_abs, op, number = node
	value = values.get(key)
	if value is None:
		value = _NULL_ABS if is_abs else _NULL_BARE
	elif is_abs:
		value = abs(value)
	return _OPERATORS[op](value, number)
