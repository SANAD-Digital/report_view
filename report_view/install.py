"""Install and migrate hooks (hooks.py): what has no native place in Frappe. Report View's
Chromium for PDFs lives outside the app and is downloaded here (core/chromium.py)."""

from report_view.core import chromium


def after_install():
	chromium.ensure()


def after_migrate():
	chromium.ensure()
