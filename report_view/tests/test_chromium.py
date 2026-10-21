"""Report View's Chromium for the PDF agent (ADR-016): installed after install and migrate
when missing, never failing them; its state in the settings."""

from unittest.mock import patch

import frappe

from report_view.api import chromium as api
from report_view.core import chromium
from report_view.tests.utils import RVTestCase


class TestChromium(RVTestCase):
	def test_pinned_version_comes_from_the_installer(self):
		self.assertRegex(chromium.pinned_version() or "", r"^\d+\.\d+\.\d+\.\d+$")

	def test_status(self):
		s = chromium.status()
		for key in ("supported", "pinned", "path", "installed", "version", "current", "fallback", "installing"):
			self.assertIn(key, s)
		self.assertEqual(s["fallback"], not s["installed"])

	def test_ensure_installs_only_when_needed(self):
		with patch.object(chromium, "supported", return_value=True), patch.object(chromium, "install", return_value=(True, "ok")) as install:
			with patch.object(chromium, "chromium_path", return_value=None):
				self.assertTrue(chromium.ensure(verbose=False))
				install.assert_called_once_with(force=False)
			install.reset_mock()
			with patch.object(chromium, "chromium_path", return_value="/x/chrome"), patch.object(chromium, "installed_version", return_value=chromium.pinned_version()):
				self.assertTrue(chromium.ensure(verbose=False))
				install.assert_not_called()
			with patch.object(chromium, "chromium_path", return_value="/x/chrome"), patch.object(chromium, "installed_version", return_value="1.0.0.0"):
				chromium.ensure(verbose=False)
				install.assert_called_once_with(force=True)

	def test_ensure_never_fails_an_install(self):
		with patch.object(chromium, "supported", return_value=True), patch.object(chromium, "chromium_path", return_value=None), patch.object(chromium, "install", side_effect=RuntimeError("no network")):
			self.assertFalse(chromium.ensure(verbose=False))
		with patch.object(chromium, "supported", return_value=True), patch.object(chromium, "chromium_path", return_value=None), patch.object(chromium, "install", return_value=(False, "download failed")):
			self.assertFalse(chromium.ensure(verbose=False))

	def test_a_chromium_of_the_sites_own_choosing_is_left_alone(self):
		conf = dict(frappe.get_common_site_config(), report_view_chromium_path="/opt/chrome")
		with patch.object(chromium, "supported", return_value=True), patch.object(chromium, "chromium_path", return_value=None), patch("frappe.get_common_site_config", return_value=conf), patch.object(chromium, "install") as install:
			self.assertFalse(chromium.ensure(verbose=False))
			install.assert_not_called()

	def test_settings_api_is_for_system_managers(self):
		with self.as_user("accountant"):
			with self.assertRaises(frappe.PermissionError):
				api.engine_status()
