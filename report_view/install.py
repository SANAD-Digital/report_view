"""Install and migrate hooks (hooks.py): what has no native place in Frappe. Report View's
Chromium for PDFs lives outside the app (core/chromium.py): `bench install-app` installs it
inline (a short wait at most), every `bench migrate` only queues its install on the long
queue, so a migrate never waits on a download."""

import click

from report_view.core import chromium
from report_view.core.letterhead import check_pdf_body_html_hook


def after_install():
	if chromium.ensure():
		click.echo(f"Report View: Chromium {chromium.pinned_version()} installed")
	elif chromium.needed() is not None:
		click.echo(
			"Report View: Chromium not installed; PDFs use Frappe's Chromium. Run: bench report-view-install-chromium"
		)
	check_pdf_body_html_hook()


def after_migrate():
	chromium.ensure_in_background()
	check_pdf_body_html_hook()
