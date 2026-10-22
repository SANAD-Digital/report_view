"""Report View's Chromium for the PDF agent (ADR-016): installed after install (inline, briefly)
and queued after migrate (never waited on) when missing, never failing either; one installer
and one state for the whole bench; its state in the settings."""

import fcntl
import os
import subprocess
from unittest.mock import patch

import frappe

from report_view import install as hooks
from report_view.api import chromium as api
from report_view.core import chromium
from report_view.tests.utils import RVTestCase


def _supported():
	return patch.object(chromium, "supported", return_value=True)


class TestChromium(RVTestCase):
	def test_pinned_version_comes_from_the_installer(self):
		self.assertRegex(chromium.pinned_version() or "", r"^\d+\.\d+\.\d+\.\d+$")

	def test_status(self):
		s = chromium.status()
		for key in (
			"supported",
			"pinned",
			"path",
			"installed",
			"version",
			"current",
			"fallback",
			"installing",
			"last",
		):
			self.assertIn(key, s)
		self.assertEqual(s["fallback"], not s["installed"])

	def test_needed_only_when_missing_or_another_version(self):
		with _supported():
			with patch.object(chromium, "chromium_path", return_value=None):
				self.assertIs(chromium.needed(), False)
			with (
				patch.object(chromium, "chromium_path", return_value="/x/chrome"),
				patch.object(chromium, "installed_version", return_value=chromium.pinned_version()),
			):
				self.assertIsNone(chromium.needed())
			with (
				patch.object(chromium, "chromium_path", return_value="/x/chrome"),
				patch.object(chromium, "installed_version", return_value="1.0.0.0"),
			):
				self.assertIs(chromium.needed(), True)
		with patch.object(chromium, "supported", return_value=False):
			self.assertIsNone(chromium.needed())

	def test_ensure_installs_inline_after_install(self):
		with (
			_supported(),
			patch.object(chromium, "reachable", return_value=True),
			patch.object(chromium, "install", return_value=(True, "ok")) as install,
		):
			with patch.object(chromium, "chromium_path", return_value=None):
				self.assertTrue(chromium.ensure())
				install.assert_called_once_with(force=False, timeout=chromium.INSTALL_APP_TIMEOUT)
			install.reset_mock()
			with (
				patch.object(chromium, "chromium_path", return_value="/x/chrome"),
				patch.object(chromium, "installed_version", return_value=chromium.pinned_version()),
			):
				self.assertTrue(chromium.ensure())
				install.assert_not_called()

	def test_ensure_never_fails_nor_waits_on_a_dead_network(self):
		with _supported(), patch.object(chromium, "chromium_path", return_value=None):
			with (
				patch.object(chromium, "reachable", return_value=False),
				patch.object(chromium, "install") as install,
			):
				self.assertFalse(chromium.ensure())
				install.assert_not_called()
			with (
				patch.object(chromium, "reachable", return_value=True),
				patch.object(chromium, "install", side_effect=RuntimeError("no network")),
			):
				self.assertFalse(chromium.ensure())
			with (
				patch.object(chromium, "reachable", return_value=True),
				patch.object(chromium, "install", return_value=(False, "download failed")),
			):
				self.assertFalse(chromium.ensure())

	def test_after_migrate_only_queues_the_install(self):
		with (
			_supported(),
			patch.object(chromium, "chromium_path", return_value=None),
			patch.object(chromium, "install") as install,
			patch("frappe.enqueue") as enqueue,
		):
			self.assertTrue(chromium.ensure_in_background())
			install.assert_not_called()
			kwargs = enqueue.call_args.kwargs
			self.assertEqual(enqueue.call_args.args, ("report_view.core.chromium.install_job",))
			self.assertEqual(
				(kwargs["queue"], kwargs["job_id"], kwargs["deduplicate"], kwargs["force"]),
				("long", chromium.JOB_ID, True, False),
			)
			# the hook itself: no download inline
			hooks.after_migrate()
			install.assert_not_called()
		# a queue that does not answer: nothing runs inline, nothing fails
		with (
			_supported(),
			patch.object(chromium, "chromium_path", return_value=None),
			patch.object(chromium, "install") as install,
			patch("frappe.utils.background_jobs.get_redis_conn", side_effect=ConnectionError("down")),
			patch("frappe.enqueue") as enqueue,
		):
			self.assertFalse(chromium.ensure_in_background())
			enqueue.assert_not_called()
			install.assert_not_called()
		with (
			_supported(),
			patch.object(chromium, "chromium_path", return_value="/x/chrome"),
			patch.object(chromium, "installed_version", return_value=chromium.pinned_version()),
			patch("frappe.enqueue") as enqueue,
		):
			self.assertFalse(chromium.ensure_in_background())
			enqueue.assert_not_called()

	def test_the_job_does_nothing_once_another_site_installed_it(self):
		with (
			patch.object(chromium, "needed", return_value=None),
			patch.object(chromium, "install") as install,
		):
			chromium.install_job(force=True)
			install.assert_not_called()
		with (
			patch.object(chromium, "needed", return_value=True),
			patch.object(chromium, "install") as install,
		):
			chromium.install_job()
			install.assert_called_once_with(force=True)

	def test_install_runs_once_on_the_bench_and_keeps_its_result(self):
		lock_path = chromium._bench_tmp(chromium.LOCK_FILE)
		with _supported(), open(lock_path, "a") as held:
			fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
			try:
				self.assertTrue(chromium.installing())
				self.assertEqual(chromium.install(), (False, "another install is running"))
			finally:
				fcntl.flock(held, fcntl.LOCK_UN)
		self.assertFalse(chromium.installing())
		last = chromium._bench_tmp(chromium.LAST_FILE)
		saved = None
		if os.path.exists(last):
			with open(last) as f:
				saved = f.read()
		try:
			with _supported(), patch("subprocess.run", side_effect=subprocess.TimeoutExpired("bash", 5)):
				ok, out = chromium.install(timeout=5)
			self.assertFalse(ok)
			self.assertIn("more than 5 s", out)
			self.assertEqual(chromium.last_result()["ok"], False)
			with _supported(), patch("subprocess.run", side_effect=OSError("no bash")):
				self.assertEqual(chromium.install(), (False, "no bash"))
		finally:
			if saved is None:
				if os.path.exists(last):
					os.remove(last)
			else:
				with open(last, "w") as f:
					f.write(saved)

	def test_a_chromium_of_the_sites_own_choosing_is_left_alone(self):
		conf = dict(frappe.get_common_site_config(), report_view_chromium_path="/opt/chrome")
		with (
			_supported(),
			patch.object(chromium, "chromium_path", return_value=None),
			patch("frappe.get_common_site_config", return_value=conf),
			patch.object(chromium, "install") as install,
		):
			self.assertFalse(chromium.ensure())
			install.assert_not_called()

	def test_settings_api_is_for_system_managers(self):
		with self.as_user("accountant"):
			with self.assertRaises(frappe.PermissionError):
				api.engine_status()
			with self.assertRaises(frappe.PermissionError):
				api.engine_install()
