"""Unit tests for opt-in local Wi-Fi discovery, Wi-Fi pairing enablement, and CLI flags."""

import asyncio
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from mirros.cli import main
from mirros.device import (
    enable_wifi_cli,
    enable_wifi_connections,
    inspect_connected_devices,
    inspect_device,
    list_connected_devices,
)
from mirros.runner import run_mirros


class WifiDiscoveryTests(unittest.TestCase):
    def test_list_connected_devices_default_ignores_network_devices(self):
        devices = [
            SimpleNamespace(serial="usb-1", connection_type="USB"),
            SimpleNamespace(serial="wifi-1", connection_type="Network"),
        ]
        with patch("pymobiledevice3.usbmux.list_devices", new=AsyncMock(return_value=devices)):
            self.assertEqual(list_connected_devices(), ["usb-1"])

    def test_list_connected_devices_include_wifi_returns_network_and_deduplicates_preferring_usb(self):
        devices = [
            SimpleNamespace(serial="shared-1", connection_type="Network"),
            SimpleNamespace(serial="wifi-only", connection_type="Network"),
            SimpleNamespace(serial="shared-1", connection_type="USB"),
            SimpleNamespace(serial="usb-only", connection_type="USB"),
            SimpleNamespace(serial="usb-only", connection_type="Network"),
        ]
        with patch("pymobiledevice3.usbmux.list_devices", new=AsyncMock(return_value=devices)):
            result = list_connected_devices(include_wifi=True)
        self.assertEqual(result, ["shared-1", "wifi-only", "usb-only"])

    def test_inspect_connected_devices_default_stays_usb_only(self):
        devices = [
            SimpleNamespace(serial="usb-1", connection_type="USB"),
            SimpleNamespace(serial="wifi-1", connection_type="Network"),
        ]
        lockdown = SimpleNamespace(
            paired=True,
            all_values={"DeviceName": "USB iPhone"},
            product_version="18.1",
            has_developer_mode=False,
        )
        ctx = AsyncMock()
        ctx.__aenter__.return_value = lockdown
        with patch("pymobiledevice3.usbmux.list_devices", new=AsyncMock(return_value=devices)), \
             patch("pymobiledevice3.lockdown.create_using_usbmux", new=AsyncMock(return_value=ctx)) as create_mock:
            infos = asyncio.run(inspect_connected_devices(reveal_developer_mode=False))
        self.assertEqual(len(infos), 1)
        self.assertEqual(infos[0]["udid"], "usb-1")
        self.assertEqual(infos[0]["connection_type"], "USB")
        create_mock.assert_awaited_once_with(serial="usb-1", autopair=False)

    def test_inspect_connected_devices_include_wifi_preserves_connection_type_and_prefers_usb(self):
        devices = [
            SimpleNamespace(serial="dup-1", connection_type="Network"),
            SimpleNamespace(serial="wifi-only", connection_type="Network"),
            SimpleNamespace(serial="dup-1", connection_type="USB"),
        ]

        async def fake_create(**kwargs):
            serial = kwargs["serial"]
            lockdown = SimpleNamespace(
                paired=True,
                all_values={"DeviceName": f"Phone {serial}"},
                product_version="18.2",
                has_developer_mode=False,
            )
            ctx = AsyncMock()
            ctx.__aenter__.return_value = lockdown
            return ctx

        with patch("pymobiledevice3.usbmux.list_devices", new=AsyncMock(return_value=devices)), \
             patch("pymobiledevice3.lockdown.create_using_usbmux", new=AsyncMock(side_effect=fake_create)) as create_mock:
            infos = asyncio.run(inspect_connected_devices(reveal_developer_mode=False, include_wifi=True))

        self.assertEqual(len(infos), 2)
        by_udid = {info["udid"]: info for info in infos}
        self.assertEqual(by_udid["dup-1"]["connection_type"], "USB")
        self.assertEqual(by_udid["wifi-only"]["connection_type"], "Network")

        calls = create_mock.await_args_list
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0].kwargs, {"serial": "dup-1", "autopair": False})
        self.assertEqual(calls[1].kwargs, {"serial": "wifi-only", "autopair": False, "connection_type": "Network"})

    def test_inspect_device_records_connection_type_for_network(self):
        lockdown = SimpleNamespace(
            paired=True,
            all_values={"DeviceName": "Wi-Fi iPhone"},
            product_version="18.0",
            has_developer_mode=False,
        )
        ctx = AsyncMock()
        ctx.__aenter__.return_value = lockdown
        with patch("pymobiledevice3.lockdown.create_using_usbmux", new=AsyncMock(return_value=ctx)) as create_mock:
            info = asyncio.run(inspect_device("wifi-udid", reveal_developer_mode=False, connection_type="Network"))
        self.assertEqual(info["connection_type"], "Network")
        self.assertEqual(info["name"], "Wi-Fi iPhone")
        create_mock.assert_awaited_once_with(serial="wifi-udid", autopair=False, connection_type="Network")

    def test_enable_wifi_connections_invokes_set_enable_wifi_connections_true(self):
        lockdown = SimpleNamespace(
            paired=True,
            set_enable_wifi_connections=AsyncMock(),
        )
        ctx = AsyncMock()
        ctx.__aenter__.return_value = lockdown
        with patch("pymobiledevice3.lockdown.create_using_usbmux", new=AsyncMock(return_value=ctx)) as create_mock:
            ok = asyncio.run(enable_wifi_connections("usb-udid"))
        self.assertTrue(ok)
        create_mock.assert_awaited_once_with(serial="usb-udid", autopair=False)
        lockdown.set_enable_wifi_connections.assert_awaited_once_with(True)

    def test_enable_wifi_connections_returns_false_when_unpaired(self):
        lockdown = SimpleNamespace(
            paired=False,
            set_enable_wifi_connections=AsyncMock(),
        )
        ctx = AsyncMock()
        ctx.__aenter__.return_value = lockdown
        with patch("pymobiledevice3.lockdown.create_using_usbmux", new=AsyncMock(return_value=ctx)):
            ok = asyncio.run(enable_wifi_connections("unpaired-udid"))
        self.assertFalse(ok)
        lockdown.set_enable_wifi_connections.assert_not_awaited()

    def test_enable_wifi_cli_enables_single_usb_device(self):
        with patch("mirros.device.check_usbmuxd_socket", return_value=True), \
             patch("mirros.device.list_connected_devices", return_value=["usb-1"]), \
             patch("mirros.device.enable_wifi_connections", new=AsyncMock(return_value=True)) as enable_mock, \
             patch("builtins.print"):
            self.assertEqual(enable_wifi_cli(), 0)
            enable_mock.assert_awaited_once_with("usb-1")

    def test_enable_wifi_cli_rejects_multiple_devices_without_udid(self):
        with patch("mirros.device.check_usbmuxd_socket", return_value=True), \
             patch("mirros.device.list_connected_devices", return_value=["usb-1", "usb-2"]), \
             patch("builtins.print") as mock_print:
            self.assertEqual(enable_wifi_cli(), 1)
            printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list if c.args)
            self.assertIn("--udid", printed)


class WifiCliAndRunnerTests(unittest.TestCase):
    def test_cli_wifi_flag_passes_include_wifi_to_runner(self):
        with patch.object(sys, "argv", ["mirros", "--wifi"]), \
             patch("mirros.cli.run_mirros", return_value=0) as mock_runner, \
             patch("sys.exit") as mock_exit:
            main()
            mock_runner.assert_called_once()
            self.assertTrue(mock_runner.call_args.kwargs["include_wifi"])
            mock_exit.assert_called_once_with(0)

    def test_cli_default_include_wifi_is_false(self):
        with patch.object(sys, "argv", ["mirros"]), \
             patch("mirros.cli.run_mirros", return_value=0) as mock_runner, \
             patch("sys.exit") as mock_exit:
            main()
            mock_runner.assert_called_once()
            self.assertFalse(mock_runner.call_args.kwargs["include_wifi"])
            mock_exit.assert_called_once_with(0)

    def test_cli_enable_wifi_dispatch(self):
        with patch.object(sys, "argv", ["mirros", "--enable-wifi", "-u", "usb-1"]), \
             patch("mirros.device.enable_wifi_cli", return_value=0) as mock_enable, \
             patch("mirros.cli.run_mirros") as mock_runner, \
             patch("sys.exit") as mock_exit:
            main()
            mock_enable.assert_called_once_with(udid="usb-1")
            mock_runner.assert_not_called()
            mock_exit.assert_called_once_with(0)

    def test_cli_accepts_pt_fr_de_lang_choices(self):
        for lang in ("pt", "fr", "de"):
            with patch.object(sys, "argv", ["mirros", "--lang", lang]), \
                 patch("mirros.cli.run_mirros", return_value=0) as mock_runner, \
                 patch("sys.exit") as mock_exit:
                main()
                mock_runner.assert_called_once()
                self.assertEqual(mock_runner.call_args.kwargs["lang"], lang)
                mock_exit.assert_called_once_with(0)

    def test_runner_passes_include_wifi_when_enabled_and_preserves_zero_arg_default(self):
        with patch("mirros.runner.list_connected_devices", return_value=["wifi-1"]) as mock_list, \
             patch("mirros.runner.device_instructions"), \
             patch("mirros.runner.prepare_device", return_value=False), \
             patch("builtins.print"):
            self.assertEqual(run_mirros(include_wifi=True), 1)
            mock_list.assert_called_once_with(include_wifi=True)

        with patch("mirros.runner.list_connected_devices", return_value=["usb-1"]) as mock_list, \
             patch("mirros.runner.device_instructions"), \
             patch("mirros.runner.prepare_device", return_value=False), \
             patch("builtins.print"):
            self.assertEqual(run_mirros(), 1)
            mock_list.assert_called_once_with()

    def test_runner_url_forwards_pt_fr_de_lang(self):
        with patch("mirros.runner.list_connected_devices", return_value=["test-device"]), \
             patch("mirros.runner.device_instructions"), \
             patch("mirros.runner.prepare_device", return_value=True), \
             patch("mirros.runner.get_available_port", return_value=8080), \
             patch("mirros.runner.wait_for_server", return_value=False), \
             patch("mirros.runner.start_process", return_value=None), \
             patch("mirros.runner.stop_server"), \
             patch("builtins.print") as mock_print:
            code = run_mirros(port=8080, lang="pt")
            self.assertEqual(code, 1)
            print_calls = [c.args[0] for c in mock_print.call_args_list if c.args]
            url_line = next((s for s in print_calls if "http://127.0.0.1:8080/" in s), None)
            self.assertIsNotNone(url_line)
            self.assertIn("lang=pt", url_line)


if __name__ == "__main__":
    unittest.main()
