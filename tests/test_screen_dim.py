import asyncio
import json
import unittest
from unittest.mock import patch

from mirros.adapter import orientation_connection
from mirros.diagnostics import ALLOWED_ERROR_CODES, clear_diagnostic_errors, collect_report
from mirros.screen_dim import (
    DEFAULT_DIM_SHORTCUT,
    DEFAULT_RESTORE_SHORTCUT,
    HID_KEY_A,
    HID_KEY_BACKSPACE,
    HID_KEY_ESCAPE,
    HID_KEY_RETURN,
    HID_KEY_SPACE,
    HID_MOD_LGUI,
    HID_MOD_LSHIFT,
    apply_screen_dim,
    char_to_hid_usages,
    get_screen_dim_state,
    restore_screen_dim,
    run_ios_shortcut_via_spotlight,
    sanitize_shortcut_name,
)


class FakeUHS:
    def __init__(self, fail_on_call=None):
        self.events = []
        self.fail_on_call = fail_on_call

    async def send_keyboard(self, kb_id, usages):
        self.events.append((kb_id, list(usages)))
        if self.fail_on_call is not None and len(self.events) == self.fail_on_call:
            raise RuntimeError('HID write failed')


class FakeServer:
    def __init__(self, uhs=None):
        self._uhs = uhs or FakeUHS()
        self._kb_service_id = 42
        self._hid_lock = asyncio.Lock()
        self._mirros_serve_task = None
        self.ensure_kb_calls = 0

    async def _ensure_keyboard(self):
        self.ensure_kb_calls += 1

    def _refuse_request(self, _headers):
        return None

    async def _read_body(self, reader, headers):
        length = int(headers.get('content-length', '0'))
        return await reader.readexactly(length) if length else b''


class FakeWriter:
    def __init__(self):
        self.data = bytearray()
        self.closed = False

    def write(self, chunk):
        self.data.extend(chunk)

    async def drain(self):
        return None

    def close(self):
        self.closed = True


async def _http_call(server, method: str, path: str, body=None):
    raw_body = json.dumps(body).encode('utf-8') if body is not None else b''
    headers = f'{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: {len(raw_body)}\r\n\r\n'.encode('latin-1')
    reader = asyncio.StreamReader()
    reader.feed_data(headers + raw_body)
    reader.feed_eof()
    writer = FakeWriter()

    async def _fallback(_server, _reader, _writer):
        raise AssertionError('Should be handled by MIRROS_ROUTES')

    await orientation_connection(server, reader, writer, _fallback)
    raw = bytes(writer.data)
    head, _, payload = raw.partition(b'\r\n\r\n')
    status_line = head.split(b'\r\n', 1)[0].decode('latin-1')
    return status_line, payload


class ScreenDimTests(unittest.TestCase):
    def setUp(self):
        clear_diagnostic_errors()

    def test_sanitize_shortcut_name(self):
        self.assertEqual(sanitize_shortcut_name('  MirrOS   Dim  ', 'Fallback'), 'MirrOS Dim')
        self.assertEqual(sanitize_shortcut_name('', 'Fallback'), 'Fallback')
        self.assertEqual(sanitize_shortcut_name(None, 'Fallback'), 'Fallback')
        self.assertEqual(sanitize_shortcut_name('x' * 81, 'Fallback'), 'Fallback')

    def test_char_to_hid_usages(self):
        self.assertEqual(char_to_hid_usages('a'), [0x04])
        self.assertEqual(char_to_hid_usages('M'), [HID_MOD_LSHIFT, 0x04 + (ord('M') - ord('A'))])
        self.assertEqual(char_to_hid_usages(' '), [HID_KEY_SPACE])
        self.assertEqual(char_to_hid_usages('0'), [0x27])
        self.assertEqual(char_to_hid_usages('5'), [0x22])
        self.assertIsNone(char_to_hid_usages('!'))

    def test_spotlight_sequence_and_key_release(self):
        server = FakeServer()
        asyncio.run(run_ios_shortcut_via_spotlight(
            server, 'Hi', key_delay=0, spotlight_delay=0, match_delay=0, post_delay=0
        ))
        usages = [u for _, u in server._uhs.events]
        self.assertIn([HID_MOD_LGUI, HID_KEY_SPACE], usages)
        self.assertIn([HID_MOD_LGUI, HID_KEY_A], usages)
        self.assertIn([HID_KEY_BACKSPACE], usages)
        self.assertIn([HID_KEY_RETURN], usages)
        self.assertIn([HID_KEY_ESCAPE], usages)
        # Must always release all keys at the end
        self.assertEqual(usages[-1], [])

    def test_spotlight_releases_keys_on_error(self):
        server = FakeServer(uhs=FakeUHS(fail_on_call=2))
        with self.assertRaises(RuntimeError):
            asyncio.run(run_ios_shortcut_via_spotlight(
                server, 'MirrOS Dim', key_delay=0, spotlight_delay=0, match_delay=0, post_delay=0
            ))
        # Final call in finally block clears held keys
        self.assertEqual(server._uhs.events[-1][1], [])

    def test_apply_is_idempotent_and_restore_clears_state(self):
        server = FakeServer()
        calls = []

        async def fake_run(_server, name):
            calls.append(name)

        with patch('mirros.screen_dim.run_ios_shortcut_via_spotlight', side_effect=fake_run):
            first = asyncio.run(apply_screen_dim(server))
            second = asyncio.run(apply_screen_dim(server))
            self.assertEqual(first['status'], 'ok')
            self.assertTrue(first['active'])
            self.assertTrue(second.get('alreadyActive'))
            self.assertEqual(calls, [DEFAULT_DIM_SHORTCUT])

            restored = asyncio.run(restore_screen_dim(server, reason='manual'))
            self.assertEqual(restored['status'], 'ok')
            self.assertFalse(restored['active'])
            self.assertEqual(calls, [DEFAULT_DIM_SHORTCUT, DEFAULT_RESTORE_SHORTCUT])

            skipped = asyncio.run(restore_screen_dim(server, reason='session_end'))
            self.assertTrue(skipped.get('skipped'))
            self.assertEqual(len(calls), 2)

            forced = asyncio.run(restore_screen_dim(server, reason='manual', force=True))
            self.assertEqual(forced['status'], 'ok')
            self.assertEqual(len(calls), 3)

    def test_http_routes_and_session_end_restores_before_canceling(self):
        server = FakeServer()
        events = []

        async def fake_run(_server, name):
            events.append(('shortcut', name))

        async def run_scenario():
            with patch('mirros.screen_dim.run_ios_shortcut_via_spotlight', side_effect=fake_run):
                status, body = await _http_call(server, 'GET', '/screen-dim')
                self.assertIn('200 OK', status)
                self.assertFalse(json.loads(body)['active'])

                status, body = await _http_call(server, 'POST', '/screen-dim', {'action': 'invalid'})
                self.assertIn('400 Bad Request', status)

                status, body = await _http_call(server, 'POST', '/screen-dim', {'action': 'dim'})
                self.assertIn('200 OK', status)
                self.assertTrue(json.loads(body)['active'])
                self.assertTrue(get_screen_dim_state(server)['active'])

                class DummyTask:
                    def cancel(self):
                        events.append(('cancel',))

                server._mirros_serve_task = DummyTask()
                status, body = await _http_call(server, 'POST', '/session/end')
                self.assertIn('200 OK', status)
                self.assertEqual(body, b'ok')
                self.assertFalse(get_screen_dim_state(server)['active'])
                # Wait past 0.1s call_later
                await asyncio.sleep(0.15)
                self.assertEqual(
                    events,
                    [('shortcut', DEFAULT_DIM_SHORTCUT), ('shortcut', DEFAULT_RESTORE_SHORTCUT), ('cancel',)],
                )

        asyncio.run(run_scenario())

    def test_error_records_diagnostic_and_clears_active_on_disconnect(self):
        self.assertIn('screen_dim_failed', ALLOWED_ERROR_CODES)
        self.assertIn('screen_restore_failed', ALLOWED_ERROR_CODES)
        server = FakeServer()

        async def boom(_server, _name):
            raise TimeoutError('timed out')

        with patch('mirros.screen_dim.run_ios_shortcut_via_spotlight', side_effect=boom):
            res = asyncio.run(apply_screen_dim(server))
            self.assertEqual(res['status'], 'error')
            self.assertFalse(res['active'])

            server._mirros_dim_active = True
            res_restore = asyncio.run(restore_screen_dim(server, reason='session_end'))
            self.assertEqual(res_restore['status'], 'error')
            self.assertFalse(server._mirros_dim_active)

        codes = [item['code'] for item in collect_report()['recent_errors']]
        self.assertIn('screen_dim_failed', codes)
        self.assertIn('screen_restore_failed', codes)


if __name__ == '__main__':
    unittest.main()
