"""Report View's own Chromium for the PDF agent (ADR-016), installed with the app but kept
outside it: a pinned Chrome for Testing "chrome-headless-shell" in <bench>/chromium-rv
(about 260 MB, Linux x86-64 only), downloaded and checked by scripts/install_chromium.sh.

After `bench install-app` (`ensure`, inline with a short timeout, after a quick check that the
download host answers) and after every `bench migrate` (`ensure_in_background`: a job on the
long queue, so a migrate never waits on the download) the pinned build is installed when it
is missing or another version is there. Neither ever fails: without it the PDF agent falls
back to Frappe's Chromium (core/pdf.py) and says so in the settings.
`bench report-view-install-chromium` (commands.py) and the button of Report View Global
Settings run the same installer. The installer, its lock and its last result belong to the
bench (<bench>/tmp), not to a site: every site sees the same state."""

import fcntl
import json
import os
import platform
import re
import socket
import subprocess

import frappe

from report_view.core.pdf import DEFAULT_CHROMIUM, chromium_path, sandbox_works

INSTALL_TIMEOUT = 900
# after_install: the install runs inline, but not for long
INSTALL_APP_TIMEOUT = 300
DOWNLOAD_HOST = ("storage.googleapis.com", 443)
JOB_ID = "report_view_chromium_install"
# the installer is shared by every site of the bench: one run at a time
LOCK_FILE = "rv-chromium-install.lock"
LAST_FILE = "rv-chromium-install.last.json"


def _bench_tmp(name: str) -> str:
	folder = os.path.join(frappe.utils.get_bench_path(), "tmp")
	os.makedirs(folder, exist_ok=True)
	return os.path.join(folder, name)


def script_path() -> str:
	return os.path.realpath(
		os.path.join(frappe.get_app_path("report_view"), "..", "scripts", "install_chromium.sh")
	)


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


def run_check(path: str | None = None) -> tuple[bool, str]:
	"""Whether the binary runs on this server at all, and what it said when it does not (a
	missing system library shows here: "error while loading shared libraries: libnss3.so")."""
	path = path or chromium_path()
	if not path:
		return False, ""
	try:
		run = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20)
	except (OSError, subprocess.SubprocessError) as e:
		return False, str(e)
	return run.returncode == 0, (run.stderr or "").strip()[-1000:]


def apt_command() -> str:
	"""The system packages the pinned build needs, as the installer lists them (APT_PACKAGES)."""
	try:
		with open(script_path()) as f:
			m = re.search(r'^APT_PACKAGES="([^"]+)"', f.read(), re.M | re.S)
	except OSError:
		return ""
	return "sudo apt-get install -y " + " ".join(m.group(1).replace("\\\n", " ").split()) if m else ""


def installed_version(path: str | None = None) -> str | None:
	path = path or chromium_path()
	if not path:
		return None
	try:
		out = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=20).stdout
	except OSError, subprocess.SubprocessError:
		return None
	m = re.search(r"([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)", out)
	return m.group(1) if m else None


def installing() -> bool:
	"""An install holds the bench's lock right now (any site, the command or a job)."""
	try:
		with open(_bench_tmp(LOCK_FILE), "a") as lock:
			try:
				fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
			except BlockingIOError:
				return True
			fcntl.flock(lock, fcntl.LOCK_UN)
	except OSError:
		return False
	return False


def last_result() -> dict | None:
	try:
		with open(_bench_tmp(LAST_FILE)) as f:
			return json.load(f)
	except OSError, ValueError:
		return None


def status() -> dict:
	"""What the PDF agent prints with: its own Chromium (pinned or another version) or
	Frappe's, whether it runs sandboxed (``sandbox``: only Report View's own Chromium is
	probed; the AppArmor profile of ``scripts/install_apparmor.sh`` covers that one only), and
	whether an install is running."""
	path = chromium_path()
	version = installed_version(path)
	pinned = pinned_version()
	runs, run_error = run_check(path) if path else (False, "")
	return {
		"runs": runs,
		"run_error": run_error,
		"apt_command": apt_command(),
		"supported": supported(),
		"pinned": pinned,
		"path": path or os.path.join(frappe.utils.get_bench_path(), DEFAULT_CHROMIUM),
		"installed": bool(path),
		"version": version,
		"current": bool(path and version and version == pinned),
		"fallback": not path,
		"installing": installing(),
		"last": last_result(),
		"sandbox": bool(path and sandbox_works(path)),
		"apparmor_command": apparmor_command(),
	}


def apparmor_script_path() -> str:
	return os.path.realpath(
		os.path.join(frappe.get_app_path("report_view"), "..", "scripts", "install_apparmor.sh")
	)


def apparmor_command() -> str:
	"""The one line, for root, that lets the sandbox start (scripts/install_apparmor.sh)."""
	return f"sudo bash {apparmor_script_path()} --bench {frappe.utils.get_bench_path()}"


def install(force: bool = False, timeout: int = INSTALL_TIMEOUT) -> tuple[bool, str]:
	"""Runs the installer (one at a time on the bench); returns (ok, its output)."""
	if not supported():
		return False, "Chrome for Testing has no build for this system"
	args = ["bash", script_path(), "--bench", frappe.utils.get_bench_path()] + (["--force"] if force else [])
	with open(_bench_tmp(LOCK_FILE), "a") as lock:
		try:
			fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
		except BlockingIOError:
			return False, "another install is running"
		try:
			run = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
			ok, out = run.returncode == 0, (run.stdout + run.stderr).strip()
		except subprocess.TimeoutExpired:
			ok, out = False, f"the install took more than {timeout} s"
		except OSError as e:
			ok, out = False, str(e)
		try:
			with open(_bench_tmp(LAST_FILE), "w") as f:
				json.dump({"ok": ok, "output": out[-2000:], "at": str(frappe.utils.now())}, f)
		except OSError:
			pass
	return ok, out


def needed() -> bool | None:
	"""None: nothing to do (unsupported, current, or a Chromium of the site's own choosing);
	else whether an install must replace another version (``force``)."""
	if not supported():
		return None
	path = chromium_path()
	if path and installed_version(path) == pinned_version():
		return None
	if frappe.get_common_site_config().get("report_view_chromium_path"):
		# a Chromium of the site's own choosing: left as it is
		return None
	return bool(path)


def reachable(host: tuple[str, int] = DOWNLOAD_HOST, timeout: float = 5) -> bool:
	try:
		with socket.create_connection(host, timeout=timeout):
			return True
	except OSError:
		return False


def ensure(timeout: int = INSTALL_APP_TIMEOUT) -> bool:
	"""Installs the pinned Chromium now when it is missing or another version is installed
	(after_install). Never raises: a failed or skipped download leaves the PDF agent on
	Frappe's Chromium. True when the pinned build is there afterwards."""
	log = frappe.logger("report_view")
	try:
		force = needed()
		if force is None:
			return bool(chromium_path())
		if not reachable():
			log.warning(
				"Report View Chromium not installed: %s:%s does not answer; run bench report-view-install-chromium",
				*DOWNLOAD_HOST,
			)
			return False
		ok, out = install(force=force, timeout=timeout)
		if not ok:
			log.warning("Report View Chromium install failed: %s", out[-2000:])
		return ok
	except Exception:
		log.warning("Report View Chromium install failed", exc_info=True)
		return False


def ensure_in_background() -> bool:
	"""after_migrate: queues the install (long queue, once for the bench) when it is needed,
	and never waits on it: without a reachable queue it only says how to install by hand.
	True when a job was queued."""
	log = frappe.logger("report_view")
	try:
		force = needed()
		if force is None:
			return False
		from frappe.utils.background_jobs import get_redis_conn

		# frappe.enqueue would run the job inline during a migrate when Redis is down
		get_redis_conn().ping()
		frappe.enqueue(
			"report_view.core.chromium.install_job",
			queue="long",
			timeout=INSTALL_TIMEOUT + 60,
			job_id=JOB_ID,
			deduplicate=True,
			force=force,
		)
		return True
	except Exception:
		log.warning(
			"Report View Chromium install not queued; run bench report-view-install-chromium", exc_info=True
		)
		return False


def install_job(force: bool = False) -> None:
	"""Background job of the settings' button and of after_migrate. Every site of the bench
	may queue one: once the first has installed the pinned build, the others have nothing
	left to do."""
	need = needed()
	if need is None:
		return
	install(force=bool(force or need))
