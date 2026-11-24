"""Automatic physical screen dimming via iOS Shortcuts (Reduce White Point + 0% brightness)."""

import asyncio
import contextlib
import logging
from typing import Any, Optional

DEFAULT_DIM_SHORTCUT = 'MirrOS Dim'
DEFAULT_RESTORE_SHORTCUT = 'MirrOS Restore'
DIM_ACTION_TIMEOUT = 4.0

# USB HID Keyboard/Keypad usage page (0x07) constants.
HID_MOD_LSHIFT = 0xE1
HID_MOD_LGUI = 0xE3  # Command on iOS / macOS
HID_KEY_A = 0x04
HID_KEY_RETURN = 0x28
HID_KEY_ESCAPE = 0x29
HID_KEY_BACKSPACE = 0x2A
HID_KEY_SPACE = 0x2C
HID_KEY_MINUS = 0x2D


def sanitize_shortcut_name(name: Any, fallback: str) -> str:
    """Return a safe, bounded iOS Shortcut name."""
    if not isinstance(name, str):
        return fallback
    cleaned = ' '.join(name.strip().split())
    if not cleaned or len(cleaned) > 80:
        return fallback
    return cleaned


def char_to_hid_usages(ch: str) -> Optional[list[int]]:
    """Map ASCII alphanumeric, space, and dash characters to HID usage page 0x07 codes."""
    if 'a' <= ch <= 'z':
        return [0x04 + (ord(ch) - ord('a'))]
    if 'A' <= ch <= 'Z':
        return [HID_MOD_LSHIFT, 0x04 + (ord(ch) - ord('A'))]
    if '1' <= ch <= '9':
        return [0x1E + (ord(ch) - ord('1'))]
    if ch == '0':
        return [0x27]
    if ch == ' ':
        return [HID_KEY_SPACE]
    if ch == '-':
        return [HID_KEY_MINUS]
    if ch == '_':
        return [HID_MOD_LSHIFT, HID_KEY_MINUS]
    return None


def _get_dim_lock(server) -> asyncio.Lock:
    lock = getattr(server, '_mirros_dim_lock', None)
    if lock is None:
        lock = asyncio.Lock()
        server._mirros_dim_lock = lock
    return lock


def get_screen_dim_state(server) -> dict[str, Any]:
    return {
        'active': bool(getattr(server, '_mirros_dim_active', False)),
        'dimShortcut': getattr(server, '_mirros_dim_shortcut', DEFAULT_DIM_SHORTCUT),
        'restoreShortcut': getattr(server, '_mirros_restore_shortcut', DEFAULT_RESTORE_SHORTCUT),
    }


async def _tap_keys(uhs, kb_id: int, usages: list[int], hold: float, gap: float) -> None:
    await uhs.send_keyboard(kb_id, usages)
    if hold > 0:
        await asyncio.sleep(hold)
    await uhs.send_keyboard(kb_id, [])
    if gap > 0:
        await asyncio.sleep(gap)


async def run_ios_shortcut_via_spotlight(
    server,
    shortcut_name: str,
    *,
    key_delay: float = 0.02,
    spotlight_delay: float = 0.35,
    match_delay: float = 0.45,
    post_delay: float = 0.25,
) -> None:
    """Invoke a named iOS Shortcut through Spotlight using the active UniversalHID keyboard."""
    await server._ensure_keyboard()
    hid_lock = getattr(server, '_hid_lock', None)
    uhs = getattr(server, '_uhs', None)
    kb_id = getattr(server, '_kb_service_id', None)
    if uhs is None or kb_id is None:
        raise RuntimeError('Virtual keyboard is unavailable.')

    async def _sequence() -> None:
        try:
            await uhs.send_keyboard(kb_id, [])
            # Open iOS Spotlight (Cmd + Space)
            await _tap_keys(uhs, kb_id, [HID_MOD_LGUI, HID_KEY_SPACE], 0.05, spotlight_delay)
            # Clear any previous query (Cmd + A, Backspace)
            await _tap_keys(uhs, kb_id, [HID_MOD_LGUI, HID_KEY_A], 0.025, 0.025)
            await _tap_keys(uhs, kb_id, [HID_KEY_BACKSPACE], 0.025, 0.04)
            # Type shortcut name
            for ch in shortcut_name:
                usages = char_to_hid_usages(ch)
                if usages is None:
                    continue
                await _tap_keys(uhs, kb_id, usages, key_delay, key_delay)
            if match_delay > 0:
                await asyncio.sleep(match_delay)
            # Launch Top Hit shortcut
            await _tap_keys(uhs, kb_id, [HID_KEY_RETURN], 0.04, post_delay)
            # Dismiss Spotlight cleanly if still visible
            await _tap_keys(uhs, kb_id, [HID_KEY_ESCAPE], 0.03, 0.02)
        finally:
            with contextlib.suppress(Exception):
                await uhs.send_keyboard(kb_id, [])

    if hid_lock is not None:
        async with hid_lock:
            await _sequence()
    else:
        await _sequence()


async def apply_screen_dim(
    server,
    *,
    dim_shortcut: Any = DEFAULT_DIM_SHORTCUT,
    restore_shortcut: Any = DEFAULT_RESTORE_SHORTCUT,
    force: bool = False,
    timeout: float = DIM_ACTION_TIMEOUT,
) -> dict[str, Any]:
    """Run the iOS dim shortcut (idempotent unless force=True so saved brightness is not overwritten)."""
    clean_dim = sanitize_shortcut_name(dim_shortcut, DEFAULT_DIM_SHORTCUT)
    clean_restore = sanitize_shortcut_name(restore_shortcut, DEFAULT_RESTORE_SHORTCUT)
    server._mirros_dim_shortcut = clean_dim
    server._mirros_restore_shortcut = clean_restore

    async with _get_dim_lock(server):
        if getattr(server, '_mirros_dim_active', False) and not force:
            return {
                'status': 'ok',
                'active': True,
                'alreadyActive': True,
                'dimShortcut': clean_dim,
                'restoreShortcut': clean_restore,
            }
        try:
            await asyncio.wait_for(run_ios_shortcut_via_spotlight(server, clean_dim), timeout=timeout)
        except Exception as error:
            from mirros.diagnostics import record_diagnostic_error
            record_diagnostic_error('screen_dim_failed')
            logging.getLogger(__name__).warning('Failed to trigger dim shortcut %r: %s', clean_dim, error)
            return {
                'status': 'error',
                'active': bool(getattr(server, '_mirros_dim_active', False)),
                'dimShortcut': clean_dim,
                'restoreShortcut': clean_restore,
                'message': 'Could not run the iPhone dim shortcut.',
            }
        server._mirros_dim_active = True
        return {
            'status': 'ok',
            'active': True,
            'dimShortcut': clean_dim,
            'restoreShortcut': clean_restore,
        }


async def restore_screen_dim(
    server,
    *,
    restore_shortcut: Any = None,
    reason: str = 'manual',
    force: bool = False,
    timeout: float = DIM_ACTION_TIMEOUT,
) -> dict[str, Any]:
    """Run the iOS restore shortcut to recover previous brightness and turn off Reduce White Point."""
    fallback = getattr(server, '_mirros_restore_shortcut', DEFAULT_RESTORE_SHORTCUT)
    clean_restore = sanitize_shortcut_name(restore_shortcut, fallback)
    server._mirros_restore_shortcut = clean_restore
    clean_dim = getattr(server, '_mirros_dim_shortcut', DEFAULT_DIM_SHORTCUT)

    async with _get_dim_lock(server):
        if not getattr(server, '_mirros_dim_active', False) and not force:
            return {
                'status': 'ok',
                'active': False,
                'skipped': True,
                'dimShortcut': clean_dim,
                'restoreShortcut': clean_restore,
            }
        try:
            await asyncio.wait_for(run_ios_shortcut_via_spotlight(server, clean_restore), timeout=timeout)
        except Exception as error:
            from mirros.diagnostics import record_diagnostic_error
            record_diagnostic_error('screen_restore_failed')
            logging.getLogger(__name__).warning('Failed to trigger restore shortcut %r (%s): %s', clean_restore, reason, error)
            if reason != 'manual':
                server._mirros_dim_active = False
            return {
                'status': 'error',
                'active': bool(getattr(server, '_mirros_dim_active', False)),
                'dimShortcut': clean_dim,
                'restoreShortcut': clean_restore,
                'message': 'Could not run the iPhone restore shortcut.',
            }
        server._mirros_dim_active = False
        return {
            'status': 'ok',
            'active': False,
            'dimShortcut': clean_dim,
            'restoreShortcut': clean_restore,
        }
