"""HTTP routing, static web asset serving, and MirrOS endpoint dispatch."""

import asyncio
import contextlib
from importlib.resources import files
import json
import logging
import sys
from urllib.parse import parse_qs, urlsplit

from mirros import adapter_device, adapter_hid, adapter_media

_ORIG_HANDLERS = {
    'press_button_indigo': adapter_hid.press_button_indigo,
    'release_input': adapter_hid.release_input,
    'get_display_mode': adapter_hid.get_display_mode,
    'set_display_mode': adapter_hid.set_display_mode,
    'wake_device': adapter_hid.wake_device,
    'trigger_app_switcher': adapter_hid.trigger_app_switcher,
    'session_health': adapter_media.session_health,
    'get_media_state': adapter_media.get_media_state,
    'set_media_state': adapter_media.set_media_state,
    'camera_snapshot': adapter_media.camera_snapshot,
    'clipboard_revision': adapter_device.clipboard_revision,
    'read_orientation': adapter_device.read_orientation,
    'get_ios_style': adapter_device.get_ios_style,
    'set_ios_style': adapter_device.set_ios_style,
    'list_device_apps': adapter_device.list_device_apps,
    'launch_device_app': adapter_device.launch_device_app,
    'get_battery_info': adapter_device.get_battery_info,
    'get_device_model': adapter_device.get_device_model,
}


def _resolve(module, name: str):
    """Resolve a handler while honoring patches on both mirros.adapter and submodules."""
    orig = _ORIG_HANDLERS[name]
    adapter = sys.modules.get('mirros.adapter')
    if adapter is not None:
        patched = getattr(adapter, name, None)
        if patched is not None and patched is not orig:
            return patched
    return getattr(module, name)


class PrefixedReader:
    """Return a peeked request line before delegating to the original stream."""

    def __init__(self, line, reader):
        self.line, self.reader = line, reader

    async def readline(self):
        if self.line is not None:
            line, self.line = self.line, None
            return line
        return await self.reader.readline()

    def __getattr__(self, name):
        return getattr(self.reader, name)


WEB_ASSETS = {
    b'/': ('web/index.html', b'text/html; charset=utf-8'),
    b'/index.html': ('web/index.html', b'text/html; charset=utf-8'),
    b'/viewer.js': ('web/viewer.js', b'application/javascript; charset=utf-8'),
    b'/viewer.css': ('web/viewer.css', b'text/css; charset=utf-8'),
    b'/audio-worklet.js': ('web/audio-worklet.js', b'application/javascript; charset=utf-8'),
}

FALLBACK_INDEX_HTML = (
    b'<!doctype html><html lang="en"><head><meta charset="UTF-8"/>'
    b'<meta name="viewport" content="width=device-width, initial-scale=1.0"/>'
    b'<title>MirrOS</title><link rel="stylesheet" href="/viewer.css"/></head>'
    b'<body><div id="root"></div><script type="module" src="/viewer.js"></script></body></html>'
)


def read_web_asset(asset_rel: str) -> bytes:
    target = files('mirros').joinpath(asset_rel)
    if target.is_file():
        return target.read_bytes()
    if asset_rel == 'web/index.html':
        return FALLBACK_INDEX_HTML
    return b''


MIRROS_ROUTES = frozenset({
    (b'GET', b'/'),
    (b'GET', b'/index.html'),
    (b'GET', b'/viewer.js'),
    (b'GET', b'/viewer.css'),
    (b'GET', b'/audio-worklet.js'),
    (b'GET', b'/battery'),
    (b'GET', b'/info'),
    (b'GET', b'/camera-frame'),
    (b'POST', b'/camera-shutter'),
    (b'GET', b'/control'),
    (b'GET', b'/orientation'),
    (b'POST', b'/session/end'),
    (b'GET', b'/frames.bin'),
    (b'GET', b'/health'),
    (b'GET', b'/clipboard/state'),
    (b'GET', b'/display-mode'),
    (b'POST', b'/display-mode'),
    (b'GET', b'/screen-dim'),
    (b'POST', b'/screen-dim'),
    (b'GET', b'/media-state'),
    (b'POST', b'/media-state'),
    (b'GET', b'/style'),
    (b'POST', b'/style'),
    (b'POST', b'/wake'),
    (b'POST', b'/app-switcher'),
    (b'GET', b'/apps'),
    (b'POST', b'/apps/launch'),
    (b'GET', b'/diagnostics'),
})


def write_json(writer, status: bytes, payload):
    body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    writer.write(
        b'HTTP/1.1 ' + status +
        b'\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ' +
        str(len(body)).encode() + b'\r\nConnection: close\r\n\r\n' + body
    )


async def orientation_connection(server, reader, writer, original):
    # Upstream consumes all subsequent HID requests on a persistent socket itself.
    # Dispatch them here so the next request can still reach MirrOS-only routes.
    from mirros.diagnostics import record_diagnostic_error
    while True:
        line = await reader.readline()
        request = line.split()[:2]
        video_quality = 'balanced'
        if len(request) == 2 and request[0] == b'GET' and request[1].startswith(b'/frames.bin?'):
            query = parse_qs(urlsplit(request[1].decode('utf-8', errors='ignore')).query, keep_blank_values=True)
            video_quality = query.get('quality', ['balanced'])[0]
            request[1] = b'/frames.bin'
        elif len(request) == 2 and request[0] == b'GET' and b'?' in request[1]:
            clean_path = request[1].split(b'?', 1)[0] or b'/'
            if clean_path in WEB_ASSETS:
                request[1] = clean_path
        hid = len(request) == 2 and request[0] == b'POST' and request[1] in (b'/key', b'/touch', b'/button')
        route_key = tuple(request) if len(request) == 2 else ()
        if not hid and route_key not in MIRROS_ROUTES:
            return await original(server, PrefixedReader(line, reader), writer)
        headers = {}
        while True:
            header = await reader.readline()
            if header in (b'\r\n', b''):
                break
            name, _, value = header.decode('latin-1').partition(':')
            headers[name.strip().lower()] = value.strip()
        if not hid:
            break
        refusal = server._refuse_request(headers)
        if refusal is not None:
            writer.write(refusal)
            await writer.drain()
            writer.close()
            return
        body = await server._read_body(reader, headers)
        if request[1] == b'/button' and getattr(server, '_mirros_media_paused', False):
            try:
                bdata = json.loads(body.decode('utf-8'))
                bname = bdata.get('name') if isinstance(bdata, dict) else None
                if bname:
                    press_btn = _resolve(adapter_hid, 'press_button_indigo')
                    asyncio.create_task(press_btn(server, bname))
            except Exception:
                pass
        else:
            server._hid_queue.put_nowait((request[1].decode(), body))
        keep_alive = headers.get('connection', '').lower() != 'close'
        connection = b'keep-alive' if keep_alive else b'close'
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: ' + connection + b'\r\n\r\nok')
        await writer.drain()
        if not keep_alive:
            writer.close()
            return
    refusal = server._refuse_request(headers)
    if refusal is not None:
        writer.write(refusal)
    elif len(request) == 2 and request[0] == b'GET' and request[1] in WEB_ASSETS:
        asset_rel, content_type = WEB_ASSETS[request[1]]
        body = read_web_asset(asset_rel)
        writer.write(
            b'HTTP/1.1 200 OK\r\nContent-Type: ' + content_type +
            b'\r\nCache-Control: no-store\r\nContent-Length: ' +
            str(len(body)).encode() + b'\r\nConnection: close\r\n\r\n' + body
        )
    elif request == [b'GET', b'/control']:
        from mirros.control import serve_control
        return await serve_control(server, reader, writer, headers, _resolve(adapter_hid, 'release_input'))
    elif request == [b'GET', b'/frames.bin']:
        from mirros.video import VIDEO_PROFILES, software_stream
        if video_quality not in VIDEO_PROFILES:
            writer.write(b'HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            await writer.drain()
            writer.close()
            return
        return await software_stream(server, writer, video_quality)
    elif request == [b'POST', b'/session/end']:
        if getattr(server, '_mirros_dim_active', False):
            from mirros.screen_dim import restore_screen_dim
            with contextlib.suppress(Exception):
                await restore_screen_dim(server, reason='session_end')
        writer.write(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')
        task = getattr(server, '_mirros_serve_task', None)
        if task is not None:
            asyncio.get_running_loop().call_later(.1, task.cancel)
    elif request == [b'GET', b'/health']:
        health = _resolve(adapter_media, 'session_health')(server)
        write_json(writer, b'200 OK' if health['healthy'] else b'503 Service Unavailable', health)
    elif request == [b'GET', b'/clipboard/state']:
        try:
            rev = await asyncio.wait_for(_resolve(adapter_device, 'clipboard_revision')(server), 3)
            write_json(writer, b'200 OK', {'revision': rev})
        except Exception as error:
            record_diagnostic_error('clipboard_unavailable')
            logging.getLogger(__name__).warning('Clipboard state unavailable: %s: %s', type(error).__name__, error)
            write_json(writer, b'503 Service Unavailable', b'{"error":"clipboard_unavailable"}')
    elif request == [b'GET', b'/display-mode']:
        write_json(writer, b'200 OK', _resolve(adapter_hid, 'get_display_mode')(server))
    elif request == [b'POST', b'/display-mode']:
        raw_body = await server._read_body(reader, headers)
        try:
            data = json.loads(raw_body.decode('utf-8'))
            mode = data.get('mode')
        except Exception:
            mode = None
        result = await _resolve(adapter_hid, 'set_display_mode')(server, mode)
        status = b'400 Bad Request' if mode not in ('dual', 'aod') else b'503 Service Unavailable' if result.get('status') == 'error' else b'200 OK'
        write_json(writer, status, result)
    elif request == [b'GET', b'/screen-dim']:
        from mirros.screen_dim import get_screen_dim_state
        write_json(writer, b'200 OK', get_screen_dim_state(server))
    elif request == [b'POST', b'/screen-dim']:
        from mirros.screen_dim import apply_screen_dim, restore_screen_dim
        raw_body = await server._read_body(reader, headers)
        try:
            data = json.loads(raw_body.decode('utf-8')) if raw_body else {}
        except Exception:
            data = {}
        action = data.get('action') if isinstance(data, dict) else None
        if action == 'dim':
            result = await apply_screen_dim(
                server,
                dim_shortcut=data.get('dimShortcut'),
                restore_shortcut=data.get('restoreShortcut'),
                force=bool(data.get('force', False)),
            )
            status = b'503 Service Unavailable' if result.get('status') == 'error' else b'200 OK'
            write_json(writer, status, result)
        elif action == 'restore':
            result = await restore_screen_dim(
                server,
                restore_shortcut=data.get('restoreShortcut'),
                reason='manual',
                force=bool(data.get('force', False)),
            )
            status = b'503 Service Unavailable' if result.get('status') == 'error' else b'200 OK'
            write_json(writer, status, result)
        else:
            write_json(writer, b'400 Bad Request', {'status': 'error', 'message': 'Invalid screen-dim action.'})
    elif request == [b'GET', b'/media-state']:
        write_json(writer, b'200 OK', _resolve(adapter_media, 'get_media_state')(server))
    elif request == [b'GET', b'/camera-frame']:
        try:
            image_data, content_type = await _resolve(adapter_media, 'camera_snapshot')(server)
            writer.write(
                b'HTTP/1.1 200 OK\r\nContent-Type: ' + content_type.encode() +
                b'\r\nCache-Control: no-store\r\nContent-Length: ' +
                str(len(image_data)).encode() + b'\r\nConnection: close\r\n\r\n' + image_data
            )
        except Exception as error:
            record_diagnostic_error('camera_frame_failed')
            logging.getLogger(__name__).warning('Failed to capture camera viewfinder frame: %s', type(error).__name__)
            write_json(writer, b'503 Service Unavailable', {'status': 'error', 'message': 'Could not capture the iPhone camera viewfinder.'})
    elif request == [b'POST', b'/camera-shutter']:
        ok = await _resolve(adapter_hid, 'press_button_indigo')(server, 'volume-down')
        write_json(writer, b'200 OK' if ok else b'503 Service Unavailable', {'status': 'ok' if ok else 'error'})
    elif request == [b'POST', b'/media-state']:
        raw_body = await server._read_body(reader, headers)
        try:
            data = json.loads(raw_body.decode('utf-8'))
            paused = data.get('paused') if isinstance(data, dict) else None
            exit_app = bool(data.get('exit_app')) if isinstance(data, dict) else False
        except Exception:
            paused = None
            exit_app = False
        if not isinstance(paused, bool):
            write_json(writer, b'400 Bad Request', {'status': 'error', 'message': 'Invalid media state.'})
        else:
            result = await _resolve(adapter_media, 'set_media_state')(server, paused, reason='manual', exit_app=exit_app)
            status = (
                b'409 Conflict' if result.get('code') == 'media_in_use'
                else b'503 Service Unavailable' if result.get('status') == 'error'
                else b'200 OK'
            )
            write_json(writer, status, result)
    elif request == [b'GET', b'/style']:
        try:
            result = await asyncio.wait_for(_resolve(adapter_device, 'get_ios_style')(server), 5)
            write_json(writer, b'200 OK', result)
        except Exception:
            record_diagnostic_error('style_failed')
            write_json(writer, b'503 Service Unavailable', {'status': 'error', 'message': 'Could not query iOS appearance style.'})
    elif request == [b'POST', b'/style']:
        raw_body = await server._read_body(reader, headers)
        try:
            data = json.loads(raw_body.decode('utf-8'))
            style = data.get('style') if isinstance(data, dict) else None
        except Exception:
            style = None
        if style not in ('light', 'dark'):
            write_json(writer, b'400 Bad Request', {'status': 'error', 'message': 'Invalid iOS appearance style.'})
        else:
            result = await asyncio.wait_for(_resolve(adapter_device, 'set_ios_style')(server, style), 5)
            write_json(writer, b'503 Service Unavailable' if result.get('status') == 'error' else b'200 OK', result)
    elif request == [b'POST', b'/wake']:
        result = await _resolve(adapter_hid, 'wake_device')(server)
        write_json(writer, b'503 Service Unavailable' if result.get('status') == 'error' else b'200 OK', result)
    elif request == [b'POST', b'/app-switcher']:
        result = await _resolve(adapter_hid, 'trigger_app_switcher')(server)
        write_json(writer, b'503 Service Unavailable' if result.get('status') == 'error' else b'200 OK', result)
    elif request == [b'GET', b'/apps']:
        try:
            apps = await asyncio.wait_for(_resolve(adapter_device, 'list_device_apps')(server), 10)
            write_json(writer, b'200 OK', apps)
        except Exception as error:
            record_diagnostic_error('apps_unavailable')
            logging.getLogger(__name__).warning('Failed to list installed apps: %s', error)
            write_json(writer, b'503 Service Unavailable', b'{"error":"apps_unavailable"}')
    elif request == [b'POST', b'/apps/launch']:
        raw_body = await server._read_body(reader, headers)
        try:
            data = json.loads(raw_body.decode('utf-8'))
            bundle_id = data.get('bundle_id') if isinstance(data, dict) else None
        except Exception:
            bundle_id = None
        valid = isinstance(bundle_id, str) and 0 < len(bundle_id.strip()) <= 255 and not any(c.isspace() for c in bundle_id.strip())
        if not valid:
            write_json(writer, b'400 Bad Request', {'status': 'error', 'message': 'Identificador de aplicación no válido.'})
        else:
            result = await asyncio.wait_for(_resolve(adapter_device, 'launch_device_app')(server, bundle_id), 10)
            write_json(writer, b'503 Service Unavailable' if result.get('status') == 'error' else b'200 OK', result)
    elif request == [b'GET', b'/battery']:
        battery = await _resolve(adapter_device, 'get_battery_info')(server)
        write_json(writer, b'200 OK', battery)
    elif request == [b'GET', b'/info']:
        model = await _resolve(adapter_device, 'get_device_model')(server)
        product_type = getattr(server, '_mirros_product_type', None)
        write_json(writer, b'200 OK', {'model': model or 'iPhone', 'product_type': product_type})
    elif request == [b'GET', b'/diagnostics']:
        from mirros.diagnostics import collect_report
        report = await asyncio.to_thread(collect_report, True)
        model = await _resolve(adapter_device, 'get_device_model')(server)
        if model:
            report['model'] = model
            if getattr(server, '_mirros_product_type', None):
                report['product_type'] = getattr(server, '_mirros_product_type', None)
        write_json(writer, b'200 OK', report)
    else:
        try:
            orientation = await asyncio.wait_for(_resolve(adapter_device, 'read_orientation')(server), 3)
            write_json(writer, b'200 OK', {'orientation': orientation})
        except Exception:
            record_diagnostic_error('orientation_unavailable')
            write_json(writer, b'503 Service Unavailable', b'{"orientation":null}')
    await writer.drain()
    writer.close()
