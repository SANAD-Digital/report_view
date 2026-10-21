"""Bench commands of Report View."""

import subprocess

import click


@click.command("report-view-install-chromium")
@click.option("--force", is_flag=True, default=False, help="Replace the Chromium that is installed")
def install_chromium(force=False):
	"""Install (or reinstall) the pinned Chromium of Report View's PDF agent in <bench>/chromium-rv.
	It belongs to the bench, not to a site: no --site is needed."""
	from frappe.utils import get_bench_path

	from report_view.core.chromium import script_path

	args = ["bash", script_path(), "--bench", get_bench_path()] + (["--force"] if force else [])
	raise SystemExit(subprocess.call(args))


commands = [install_chromium]
