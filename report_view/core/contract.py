"""The layout contract of the letter head builder and the font library's constants
(ADR-018): ``report_view/letterhead_contract.json``, the one source the server (here) and
the browser (``public/js/report_view/letterhead/model.js`` and ``fonts.js`` import the
same file into their bundles) read: limits, tokens, element defaults, band defaults."""

import json
import os

PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "letterhead_contract.json")

with open(PATH, encoding="utf-8") as _f:
	CONTRACT: dict = json.load(_f)
