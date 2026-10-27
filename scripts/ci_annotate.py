"""GitHub annotations from the output of ``bench run-tests`` (the CI's server job).

The logs of a public repository's job need a sign-in; annotations do not. Each FAIL or
ERROR of the unittest output becomes one ``::error`` line with the test id as its title
and the end of its traceback as its message. A run that failed before any test (an import
error, a site that does not start) gets the end of the log instead.

    python scripts/ci_annotate.py run-tests.log
"""

import re
import sys

# GitHub shows at most 10 error annotations of a step
MAX_ANNOTATIONS = 10
TRACE_LINES = 25
LOG_TAIL = 60
# unittest prints "FAIL: name (id)"; Frappe's runner " FAIL  name (id)"
_HEAD = re.compile(r"^\s*(FAIL|ERROR):?\s+(\S+) \(([^)]+)\)")
_RULE = re.compile(r"^(=|-){20,}$")


def _escape(text: str) -> str:
	return text.replace("%", "%25").replace("\r", "").replace("\n", "%0A")


def _title(text: str) -> str:
	return _escape(text).replace(":", "%3A").replace(",", "%2C")


def failures(lines: list[str]) -> list[tuple[str, list[str]]]:
	"""``[(kind and test id, traceback lines)]`` of the unittest report."""
	out = []
	i = 0
	while i < len(lines):
		m = _HEAD.match(lines[i])
		if not m:
			i += 1
			continue
		title = f"{m.group(1)} {m.group(3)}"
		i += 1
		if i < len(lines) and _RULE.match(lines[i]):
			i += 1
		body = []
		while i < len(lines) and not _HEAD.match(lines[i]) and not _RULE.match(lines[i]):
			body.append(lines[i])
			i += 1
		out.append((title, body))
	return out


def annotations(lines: list[str]) -> list[str]:
	found = failures(lines)
	if not found:
		tail = "\n".join(lines[-LOG_TAIL:])
		return [f"::error title=run-tests failed before or outside the tests::{_escape(tail)}"]
	# one annotation lists every failure; the others show the first tracebacks
	names = "\n".join(title for title, _body in found)
	out = [f"::error title={len(found)} failures and errors::{_escape(names)}"]
	shown = found[: MAX_ANNOTATIONS - 1]
	out += [
		f"::error title={_title(title)}::{_escape(chr(10).join(body[-TRACE_LINES:]))}"
		for title, body in shown
	]
	return out


def main(path: str) -> None:
	with open(path, encoding="utf-8", errors="replace") as f:
		lines = f.read().splitlines()
	for line in annotations(lines):
		sys.stdout.write(line + "\n")


if __name__ == "__main__":
	main(sys.argv[1])
