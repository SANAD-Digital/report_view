"""The font library that ships with Report View (``public/fonts``; its list and licences in
``public/fonts/README.md``).

``report_view/fonts.json`` is the one registry: Python reads it here, the browser imports the
same file into its bundles (``public/js/report_view/fonts_registry.js``), and
``scripts/build_fonts.py`` writes ``public/css/rv_fonts.css`` from it. An entry::

    {"family": "Cairo", "slug": "cairo", "scripts": ["arabic", "latin"],
     "category": "sans" | "serif" | "naskh" | "kufi" | "display" | "mono",
     "weights": {"400": {"woff2": "cairo/cairo-400.woff2", "ttf": "cairo/cairo-400.ttf"}, ...},
     "italic": {...}          # optional, same shape
     "licence": "OFL-1.1", "source": "https://github.com/google/fonts/tree/main/ofl/cairo",
     "system": true}          # optional: installed on the server, no file shipped

Paths are relative to ``/assets/report_view/fonts/``. Each face lists ``woff2`` first and then
``truetype``: browsers take the woff2, wkhtmltopdf (QtWebKit reads no woff2) the TrueType;
some fonts whose licence forbids any change ship as their original TrueType only.
"""

import functools
import json
import os

from report_view.core.contract import CONTRACT

# the library's constants: letterhead_contract.json ("fonts"), as fonts.js reads them
ASSET_BASE = CONTRACT["fonts"]["asset_base"]
DEFAULT_FONT = CONTRACT["fonts"]["default"]
CATEGORIES = tuple(CONTRACT["fonts"]["categories"])
FORMATS = (("woff2", "woff2"), ("ttf", "truetype"))
# the generic family after the chosen one, by category
GENERIC = dict(CONTRACT["fonts"]["generic"])

REGISTRY_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fonts.json")
FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "fonts")


@functools.cache
def registry() -> tuple[dict, ...]:
	"""Every family of the library, in the registry's order."""
	with open(REGISTRY_PATH, encoding="utf-8") as f:
		return tuple(json.load(f))


@functools.cache
def _by_family() -> dict[str, dict]:
	return {e["family"]: e for e in registry()}


def families() -> tuple[str, ...]:
	return tuple(e["family"] for e in registry())


def get_font(family: str | None) -> dict | None:
	return _by_family().get(family) if isinstance(family, str) else None


def font_stack(family: str) -> str:
	"""The CSS ``font-family`` value of a registry family: itself, then its generic family."""
	entry = get_font(family) or {}
	return f"'{family}',{GENERIC.get(entry.get('category'), 'sans-serif')}"


def font_files(entry: dict):
	"""``(style, weight, {format: relative path})`` of every face of an entry."""
	for style, key in (("normal", "weights"), ("italic", "italic")):
		for weight, files in (entry.get(key) or {}).items():
			yield style, int(weight), files


def nearest_weight(available, wanted: int) -> int:
	"""The face CSS font matching picks for ``wanted`` among ``available`` weights: 400 and
	500 look at each other first, then lighter; above 500, heavier first."""
	available = sorted(available)
	if wanted in available:
		return wanted
	if wanted in (400, 500) and (900 - wanted) in available:
		return 900 - wanted
	lighter = [w for w in available if w < wanted]
	heavier = [w for w in available if w > wanted]
	if wanted <= 500:
		return lighter[-1] if lighter else heavier[0]
	return heavier[0] if heavier else lighter[-1]


def print_weights(family: str, used) -> list[int]:
	"""The upright faces a page printing ``family`` at the ``used`` weights needs. wkhtmltopdf
	(QtWebKit) cannot tell 400 from 500: with both declared it prints every regular text with
	the 500 face, so 500 is left out when 400 is needed (a 500 text prints regular)."""
	entry = get_font(family)
	available = [int(w) for w in (entry or {}).get("weights", {})]
	if not available:
		return []
	out = {nearest_weight(available, int(w)) for w in used}
	if 400 in out:
		out.discard(500)
	return sorted(out)


def font_face_css(family: str, base: str = ASSET_BASE, weights=None) -> str:
	"""The ``@font-face`` rules of one family, its urls under ``base`` (``ASSET_BASE``, or an
	absolute or Jinja prefix ending in ``/``). ``weights``: only those upright faces (every
	face otherwise).
	Empty for a system font or an unknown family."""
	entry = get_font(family)
	if not entry:
		return ""
	rules = []
	for style, weight, files in font_files(entry):
		if weights is not None and (style != "normal" or weight not in weights):
			continue
		src = ",".join(f"url('{base}{files[k]}') format('{fmt}')" for k, fmt in FORMATS if files.get(k))
		rules.append(
			f"@font-face{{font-family:'{family}';font-style:{style};font-weight:{weight};font-display:swap;src:{src}}}"
		)
	return "".join(rules)
