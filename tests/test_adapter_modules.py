"""Tests for modularized mirros.adapter_* submodules and re-export contract."""

from pathlib import Path
import unittest

from mirros import adapter, adapter_device, adapter_hid, adapter_http, adapter_media


class AdapterModulesStructureTests(unittest.TestCase):
    def test_adapter_hid_exports(self):
        expected = (
            'release_input',
            'touch_request',
            'keyboard_request',
            'warm_input',
            'press_button_indigo',
            'press_home_indigo',
            'wake_device',
            'trigger_app_switcher',
            'set_display_mode',
            'get_display_mode',
            'controlled_keep_awake',
        )
        for name in expected:
            with self.subTest(symbol=name):
                self.assertTrue(hasattr(adapter_hid, name))
                self.assertIs(getattr(adapter, name), getattr(adapter_hid, name))

    def test_adapter_media_exports(self):
        expected = (
            'CAMERA_BUNDLE_IDS',
            'SENSOR_BUNDLE_IDS',
            'classify_sensor_log',
            'get_media_state',
            'set_media_state',
            'sensor_activity_loop',
            'camera_snapshot',
            'close_camera_snapshot',
            'guarded_fresh_stream',
            'schedule_auto_pause',
            'session_health',
            'settled_decoder_refresh_loop',
        )
        for name in expected:
            with self.subTest(symbol=name):
                self.assertTrue(hasattr(adapter_media, name))
                self.assertIs(getattr(adapter, name), getattr(adapter_media, name))

    def test_adapter_device_exports(self):
        expected = (
            'read_device_clipboard',
            'clipboard_revision',
            'read_orientation',
            'close_orientation',
            'get_ios_style',
            'set_ios_style',
            'list_device_apps',
            'launch_device_app',
            'product_type_to_name',
            'get_lockdown_client',
            'get_device_model',
            'get_battery_info',
        )
        for name in expected:
            with self.subTest(symbol=name):
                self.assertTrue(hasattr(adapter_device, name))
                self.assertIs(getattr(adapter, name), getattr(adapter_device, name))

    def test_adapter_http_exports(self):
        expected = (
            'WEB_ASSETS',
            'FALLBACK_INDEX_HTML',
            'MIRROS_ROUTES',
            'PrefixedReader',
            'read_web_asset',
            'write_json',
            'orientation_connection',
        )
        for name in expected:
            with self.subTest(symbol=name):
                self.assertTrue(hasattr(adapter_http, name))
                self.assertIs(getattr(adapter, name), getattr(adapter_http, name))

    def test_adapter_orchestrator_is_concise_and_exposes_entry_points(self):
        self.assertTrue(callable(adapter.configure_viewer))
        self.assertTrue(callable(adapter.check_backend_contract))
        adapter_path = Path(adapter.__file__)
        line_count = len(adapter_path.read_text(encoding='utf-8').splitlines())
        self.assertLess(line_count, 260, f'adapter.py should stay concise (< 260 lines), got {line_count}')


if __name__ == '__main__':
    unittest.main()
