"""Report View's own Chromium for the PDF agent (ADR-016), installed with the app but kept
outside it: a pinned Chrome for Testing "chrome-headless-shell" in <bench>/chromium-rv
(about 260 MB, Linux x86-64 only), downloaded and checked by scripts/install_chromium.sh.

`ensure()` runs after `bench install-app` and every `bench migrate` (hooks.py): it installs
the pinned build when it is missing or another version is there, and never fails the
install: without it the PDF agent falls back to Frappe's Chromium (core/pdf.py) and says
so in the settings. `bench report-view-install-chromium` (commands.py) and the button of
Report View Global Settings run the same installer."""

import fcntl
import os
import platform
import re
import subprocess

import frappe

from report_view.core.pdf import DEFAULT_CHROMIUM, chromium_path

INSTALL_TIMEOUT = 900
# the installer is shared by every site of the bench: one run at a time
LOCK_FILE = "rv-chromium-install.lock"
STATUS_KEY = "report_view:chromium_install"


def script_path() -> str:
	return os.path.realpath(os.path.join(frappe.get_app_path("report_view"), "..", "scripts", "install_chromium.sh"))


def pinned_version() -> str | None:
	"""The version the installer pins (its VERSION line): one place to change it."""
	try:
		with open(script_path()) as f:
			m = re.search(r'^VERSION="([0-9.]+)"', f.read(), re.M)
	except OSError:
		return None
	return m.group(1) if m else None


def supported() -> bool:
	return platform.system() == "Linux" and platform.machine() in ("x86_64", "AMD64")


def installed_version(path: str | None = None) -> str | None:
	path = path or chromium_path()
	if not path:
		return None
	try:
		out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20).stdout
	except (OSError, subprocess.SubprocessError):
		return None
	m = re.search(r"([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)", out)
	return m.group(1) if m else None


def status() -> dict:
	"""What the PDF agent prints with: its own Chromium (pinned or another version) or
	Frappe's, and whether an install is running."""
	path = chromium_path()
	version = installed_version(path)
	pinned = pinned_version()
	return {
		"supported": supported(),
		"pinned": pinned,
		"path": path or os.path.join(frappe.utils.get_bench_path(), DEFAULT_CHROMIUM),
		"installed": bool(path),
		"version": version,
		"current": bool(path and version and version == pinned),
		"fallback": not path,
		"installing": bool(frappe.cache.get_value(STATUS_KEY)),
		"last": frappe.cache.get_value(f"{STATUS_KEY}:last"),
	}


def install(force: bool = False, timeout: int = INSTALL_TIMEOUT) -> tuple[bool, str]:
	"""Runs the installer (one at a time on the bench); returns (ok, its output)."""
	if not supported():
		return False, "Chrome for Testing has no build for this system"
	lock_dir = os.path.join(frappe.utils.get_bench_path(), "tmp")
	os.makedirs(lock_dir, exist_ok=True)
	args = ["bash", script_path(), "--bench", frappe.utils.get_bench_path()] + (["--force"] if force else [])
	with open(os.path.join(lock_dir, LOCK_FILE), "w") as lock:
		try:
			fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
		except BlockingIOError:
			return False, "another install is running"
		frappe.cache.set_value(STATUS_KEY, 1, expires_in_sec=timeout + 60)
		try:
			run = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
			ok, out = run.returncode == 0, (run.stdout + run.stderr).strip()
		except subprocess.TimeoutExpired:
			ok, out = False, f"the install took more than {timeout} s"
		except OSError as e:
			ok, out = False, str(e)
		finally:
			frappe.cache.delete_value(STATUS_KEY)
	frappe.cache.set_value(f"{STATUS_KEY}:last", {"ok": ok, "output": out[-2000:], "at": frappe.utils.now()}, expires_in_sec=7 * 86400)
	return ok, out


def ensure(verbose: bool = True) -> bool:
	"""Installs the pinned Chromium when it is missing or another version is installed.
	Never raises: a failed download leaves the PDF agent on Frappe's Chromium."""
	try:
		if not supported():
			return False
		path = chromium_path()
		pinned = pinned_version()
		if path and installed_version(path) == pinned:
			return True
		if frappe.get_common_site_config().get("report_view_chromium_path"):
			# a Chromium of the site's own choosing: left as it is
			return bool(path)
		ok, out = install(force=bool(path))
		if verbose:
			print(("Report View: Chromium {0} installed" if ok else "Report View: Chromium {0} not installed ({1}); PDFs use Frappe's Chromium").format(pinned, out.splitlines()[-1] if out else ""))
		if not ok:
			frappe.logger("report_view").warning("Report View Chromium install failed: %s", out[-2000:])
		return ok
	except Exception:
		frappe.logger("report_view").warning("Report View Chromium install failed", exc_info=True)
		return False


def install_job(force: bool = False) -> None:
	"""Background job of the settings' button."""
	install(force=force)
