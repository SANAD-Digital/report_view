"""Install and migrate hooks (hooks.py): what has no native place in Frappe. Report View's
Chromium for PDFs lives outside the app (core/chromium.py): `bench install-app` installs it
inline (a short wait at most), every `bench migrate` only queues its install on the long
queue, so a migrate never waits on a download."""

import click
import frappe
from frappe.desk.page.setup_wizard.setup_wizard import setup_complete
from frappe.utils import getdate, nowdate

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


def before_tests():
	"""A fresh site (the CI's) has no company and no fiscal year until the setup wizard
	runs: it runs here once, as Frappe's own ``before_tests`` does, with ERPNext's company,
	chart of accounts and fiscal year. A site set up already is left as it is."""
	if frappe.is_setup_complete():
		return
	year = getdate(nowdate()).year
	result = setup_complete(
		{
			"language": "English",
			"email": "test@example.com",
			"full_name": "Test User",
			"password": "test",
			"country": "United States",
			"timezone": "America/New_York",
			"currency": "USD",
			"company_name": "_Test RV Company",
			"company_abbr": "_TRV",
			"chart_of_accounts": "Standard",
			"fy_start_date": f"{year}-01-01",
			"fy_end_date": f"{year}-12-31",
			"enable_telemetry": 0,
		}
	)
	frappe.db.commit()
	if not frappe.is_setup_complete():
		raise RuntimeError(f"The setup wizard did not complete: {result}")
	frappe.clear_cache()
