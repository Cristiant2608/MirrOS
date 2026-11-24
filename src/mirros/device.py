"""Detección USB y preflight de confianza/Modo Desarrollador usando pymobiledevice3."""

import asyncio
import contextlib
import os
import socket
from typing import Any, List, Optional


def _select_devices(devices: Any, include_wifi: bool = False) -> list[Any]:
    """Filter discovered devices by connection type and deduplicate by serial, preferring USB."""
    allowed = ("USB", "Network") if include_wifi else ("USB",)
    selected: dict[str, Any] = {}
    for device in devices:
        conn = getattr(device, "connection_type", None)
        if conn not in allowed:
            continue
        serial = getattr(device, "serial", None)
        if not serial:
            continue
        if serial not in selected or (
            conn == "USB" and getattr(selected[serial], "connection_type", None) != "USB"
        ):
            selected[serial] = device
    return list(selected.values())


def check_usbmuxd_socket() -> bool:
    """Apple usa TCP en Windows; usbmuxd usa un socket Unix en Linux."""
    if os.name == "nt":
        try:
            with socket.create_connection(("127.0.0.1", 27015), timeout=1):
                return True
        except OSError:
            return False
    for path in ("/var/run/usbmuxd", "/run/usbmuxd"):
        if os.path.exists(path):
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
                    s.settimeout(1)
                    s.connect(path)
                    return True
            except OSError:
                continue
    return False


def list_connected_devices(include_wifi: bool = False) -> List[str]:
    """No requiere idevice_id; por defecto solo USB (opt-in Wi-Fi local con include_wifi=True)."""
    from pymobiledevice3.usbmux import list_devices

    async def discover():
        return await asyncio.wait_for(list_devices(), timeout=3)

    return [device.serial for device in _select_devices(asyncio.run(discover()), include_wifi=include_wifi)]


async def inspect_device(
    udid: str,
    reveal_developer_mode: bool = True,
    connection_type: str = "USB",
) -> dict[str, Any]:
    """Inspecciona un iPhone por USB o Wi-Fi local: verifica confianza, versión de iOS y Modo Desarrollador."""
    from packaging.version import Version
    from pymobiledevice3.exceptions import (
        NotPairedError,
        PairingDialogResponsePendingError,
        PairingError,
        PasscodeRequiredError,
        PasswordRequiredError,
        UserDeniedPairingError,
    )
    from pymobiledevice3.lockdown import create_using_usbmux
    from mirros.diagnostics import record_diagnostic_error

    pairing_errors = (
        NotPairedError,
        PairingDialogResponsePendingError,
        PairingError,
        PasscodeRequiredError,
        PasswordRequiredError,
        UserDeniedPairingError,
    )
    info: dict[str, Any] = {
        "udid": udid,
        "name": "iPhone",
        "model": "iPhone",
        "product_type": "",
        "version": "",
        "connection_type": connection_type,
        "paired": True,
        "developer_mode": True,
        "developer_mode_revealed": False,
        "userspace_supported": True,
    }
    try:
        create_kwargs: dict[str, Any] = {"serial": udid, "autopair": False}
        if connection_type != "USB":
            create_kwargs["connection_type"] = connection_type
        async with await asyncio.wait_for(create_using_usbmux(**create_kwargs), timeout=5) as lockdown:
            all_values = getattr(lockdown, "all_values", None) or {}
            version_str = getattr(lockdown, "product_version", "") or all_values.get("ProductVersion") or ""
            if version_str and version_str != "1.0":
                info["version"] = str(version_str)
            paired = getattr(lockdown, "paired", True)
            if not paired:
                pair_fn = getattr(lockdown, "pair", None)
                validate_fn = getattr(lockdown, "validate_pairing", None)
                if callable(pair_fn):
                    try:
                        await asyncio.wait_for(pair_fn(timeout=0), timeout=2)
                        if callable(validate_fn):
                            paired = bool(await asyncio.wait_for(validate_fn(), timeout=2))
                        else:
                            paired = True
                    except Exception:
                        paired = False
            if not paired:
                info["paired"] = False
                record_diagnostic_error("usb_not_paired")
                return info

            all_values = getattr(lockdown, "all_values", None) or {}
            info["name"] = all_values.get("DeviceName") or "iPhone"
            product_type = all_values.get("ProductType") or getattr(lockdown, "product_type", "")
            if product_type:
                info["product_type"] = product_type
                try:
                    from pymobiledevice3.lockdown import IRECV_DEVICES
                    for d in IRECV_DEVICES:
                        if getattr(d, "product_type", None) == product_type:
                            info["model"] = getattr(d, "display_name", None) or product_type
                            break
                    else:
                        info["model"] = product_type
                except Exception:
                    info["model"] = product_type
            version_str = getattr(lockdown, "product_version", "") or all_values.get("ProductVersion") or info["version"]
            if version_str:
                info["version"] = str(version_str)
                with contextlib.suppress(Exception):
                    info["userspace_supported"] = Version(str(version_str)) >= Version("17.4")

            has_dev_mode = getattr(lockdown, "has_developer_mode", None)
            if has_dev_mode is None and info["version"]:
                with contextlib.suppress(Exception):
                    has_dev_mode = Version(info["version"]) >= Version("16.0")
            if has_dev_mode is not False:
                get_dev = getattr(lockdown, "get_developer_mode_status", None)
                if callable(get_dev):
                    with contextlib.suppress(Exception):
                        enabled = bool(await asyncio.wait_for(get_dev(), timeout=3))
                        info["developer_mode"] = enabled
                        if not enabled:
                            record_diagnostic_error("developer_mode_disabled")
                            if reveal_developer_mode:
                                from pymobiledevice3.services.amfi import AmfiService
                                await asyncio.wait_for(
                                    AmfiService(lockdown).reveal_developer_mode_option_in_ui(),
                                    timeout=3,
                                )
                                info["developer_mode_revealed"] = True
    except pairing_errors:
        info["paired"] = False
        record_diagnostic_error("usb_not_paired")
    except Exception:
        pass
    return info


async def inspect_connected_devices(
    reveal_developer_mode: bool = True,
    include_wifi: bool = False,
) -> List[dict[str, Any]]:
    """Lista los dispositivos conectados (USB, o USB + Wi-Fi local si include_wifi=True) con su estado."""
    from pymobiledevice3.usbmux import list_devices

    devices = await asyncio.wait_for(list_devices(), timeout=4)
    result = []
    for device in _select_devices(devices, include_wifi=include_wifi):
        conn = getattr(device, "connection_type", "USB") or "USB"
        if conn == "USB":
            result.append(await inspect_device(device.serial, reveal_developer_mode=reveal_developer_mode))
        else:
            result.append(
                await inspect_device(
                    device.serial,
                    reveal_developer_mode=reveal_developer_mode,
                    connection_type=conn,
                )
            )
    return result


async def enable_wifi_connections(udid: str) -> bool:
    """Enable local Wi-Fi lockdown connections on a USB-connected, trusted iPhone."""
    from pymobiledevice3.lockdown import create_using_usbmux

    async with await asyncio.wait_for(create_using_usbmux(serial=udid, autopair=False), timeout=5) as lockdown:
        if not getattr(lockdown, "paired", True):
            return False
        await asyncio.wait_for(lockdown.set_enable_wifi_connections(True), timeout=5)
        return True


def enable_wifi_cli(udid: Optional[str] = None) -> int:
    """Enable local Wi-Fi pairing on a USB-connected iPhone from the CLI."""
    if not check_usbmuxd_socket():
        print("[!] USB service (usbmuxd / Apple Mobile Device Service) is unavailable.")
        return 1
    try:
        devices = list_connected_devices()
    except Exception as error:
        print(f"[!] Could not detect USB devices: {error}")
        return 1
    if udid:
        if udid not in devices:
            print(f"[!] USB device not found: {udid}. Connect the iPhone over USB first.")
            return 1
        target = udid
    else:
        if not devices:
            print("[!] No USB-connected iPhone found. Connect your iPhone via USB to enable Wi-Fi pairing.")
            return 1
        if len(devices) > 1:
            print("[!] Multiple USB devices found. Use --udid with one of: " + ", ".join(devices))
            return 1
        target = devices[0]
    try:
        enabled = asyncio.run(enable_wifi_connections(target))
    except Exception as error:
        print(f"[!] Could not enable local Wi-Fi pairing on {target}: {error}")
        return 1
    if not enabled:
        print(f"[!] iPhone {target} is not paired yet. Unlock it, tap 'Trust', and try again.")
        return 1
    print(f"[+] Local Wi-Fi pairing enabled on {target}. You can now run 'mirros --wifi' on the same local network.")
    return 0
