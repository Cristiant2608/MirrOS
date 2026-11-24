"""Adaptación del visor del backend fijado, sin modificar sus archivos instalados."""

import asyncio
import contextlib
from importlib.metadata import version
from importlib.resources import files
import sys
import time  # noqa: F401 - preserved for monkeypatch compatibility (mirros.adapter.time)

from mirros.adapter_device import (
    clipboard_revision,
    close_orientation,
    get_battery_info,
    get_device_model,
    get_ios_style,
    get_lockdown_client,
    launch_device_app,
    list_device_apps,
    product_type_to_name,
    read_device_clipboard,
    read_orientation,
    set_ios_style,
)
from mirros.adapter_hid import (
    controlled_keep_awake,
    get_display_mode,
    keyboard_request,
    press_button_indigo,
    press_home_indigo,
    release_input,
    set_display_mode,
    touch_request,
    trigger_app_switcher,
    wake_device,
    warm_input,
)
from mirros.adapter_http import (
    FALLBACK_INDEX_HTML,
    MIRROS_ROUTES,
    WEB_ASSETS,
    PrefixedReader,
    orientation_connection,
    read_web_asset,
    write_json,
)
from mirros.adapter_media import (
    CAMERA_BUNDLE_IDS,
    SENSOR_BUNDLE_IDS,
    _is_media_9022,
    _png_to_jpeg,
    camera_snapshot,
    classify_sensor_log,
    close_camera_snapshot,
    get_media_state,
    guarded_fresh_stream,
    schedule_auto_pause,
    sensor_activity_loop,
    session_health,
    set_media_state,
    settled_decoder_refresh_loop,
)

__all__ = [
    'CAMERA_BUNDLE_IDS',
    'FALLBACK_INDEX_HTML',
    'MIRROS_ROUTES',
    'PrefixedReader',
    'SENSOR_BUNDLE_IDS',
    'WEB_ASSETS',
    '_is_media_9022',
    '_png_to_jpeg',
    'camera_snapshot',
    'check_backend_contract',
    'classify_sensor_log',
    'clipboard_revision',
    'close_camera_snapshot',
    'close_orientation',
    'configure_viewer',
    'controlled_keep_awake',
    'get_battery_info',
    'get_device_model',
    'get_display_mode',
    'get_ios_style',
    'get_lockdown_client',
    'get_media_state',
    'guarded_fresh_stream',
    'keyboard_request',
    'launch_device_app',
    'list_device_apps',
    'orientation_connection',
    'press_button_indigo',
    'press_home_indigo',
    'product_type_to_name',
    'read_device_clipboard',
    'read_orientation',
    'read_web_asset',
    'release_input',
    'schedule_auto_pause',
    'sensor_activity_loop',
    'session_health',
    'set_display_mode',
    'set_ios_style',
    'set_media_state',
    'settled_decoder_refresh_loop',
    'touch_request',
    'trigger_app_switcher',
    'wake_device',
    'warm_input',
    'write_json',
]


def check_backend_contract(module):
    """Fail before patching anything when the pinned upstream contract changes."""
    if version('pymobiledevice3') != '11.32.0':
        raise RuntimeError('MirrOS requiere pymobiledevice3 11.32.0. Repite la instalación.')
    required = ('_hid_worker', '_serve_connection', '_handle_key', '_handle_touch',
                '_stop_hid', '_ensure_hid', '_missing_audio_deps', 'serve', '_keep_awake_loop')
    missing = [name for name in required if not callable(getattr(module.ScreenStreamServer, name, None))]
    marker = b'const decoderConfig = { codec, description, optimizeForLatency: true };'
    if missing or not callable(getattr(module, 'read_pasteboard', None)) or module.VIEWER_JS_TEMPLATE.count(marker) != 1:
        raise RuntimeError('El contrato del backend cambió; revisa el adaptador de MirrOS.')


def configure_viewer() -> None:
    from pymobiledevice3.remote.core_device import screen_stream
    if getattr(screen_stream, '_mirros_configured', False):
        return
    check_backend_contract(screen_stream)
    screen_stream.read_pasteboard = read_device_clipboard
    if sys.platform in ('win32', 'linux'):
        from mirros.audio import AACELDDecoder
        screen_stream.AACELDDecoder = AACELDDecoder
        screen_stream.ScreenStreamServer._missing_audio_deps = staticmethod(lambda: [])

    marker = b'const decoderConfig = { codec, description, optimizeForLatency: true };'
    replacement = b'''const dimensions = iosScrcpyHevcDimensions(description);
    log('video size: ' + dimensions.codedWidth + 'x' + dimensions.codedHeight);
    const decoderConfig = { codec, description, ...dimensions, optimizeForLatency: true };'''
    source = screen_stream.VIEWER_JS_TEMPLATE
    if source.count(marker) != 1:
        raise RuntimeError('El visor del backend cambió; revisa la versión fijada de pymobiledevice3.')
    parser = files('mirros').joinpath('assets/hevc_dimensions.js').read_bytes()
    screen_stream.VIEWER_JS_TEMPLATE = parser + b'\n' + source.replace(marker, replacement)

    original_worker = screen_stream.ScreenStreamServer._hid_worker
    async def ready_worker(server):
        await warm_input(server, original_worker)
    screen_stream.ScreenStreamServer._hid_worker = ready_worker

    original_connection = screen_stream.ScreenStreamServer._serve_connection
    async def with_orientation(server, reader, writer):
        return await orientation_connection(server, reader, writer, original_connection)
    screen_stream.ScreenStreamServer._serve_connection = with_orientation

    original_key = screen_stream.ScreenStreamServer._handle_key
    async def safe_key(server, body):
        from mirros.control import control_lock
        async with control_lock(server):
            return await keyboard_request(server, body, original_key)
    screen_stream.ScreenStreamServer._handle_key = safe_key

    original_touch = screen_stream.ScreenStreamServer._handle_touch
    async def tracked_touch(server, body):
        from mirros.control import control_lock
        async with control_lock(server):
            return await touch_request(server, body, original_touch)
    screen_stream.ScreenStreamServer._handle_touch = tracked_touch

    original_stop = screen_stream.ScreenStreamServer._stop_hid
    async def safe_stop(server):
        lease = getattr(server, '_mirros_keyboard_lease', None)
        if lease is not None and lease is not asyncio.current_task():
            lease.cancel()
        await release_input(server)
        await close_orientation(server)
        await original_stop(server)
    screen_stream.ScreenStreamServer._stop_hid = safe_stop

    original_fresh_stream = getattr(screen_stream.ScreenStreamServer, '_ensure_fresh_stream', None)
    if callable(original_fresh_stream):
        async def safe_fresh_stream(server, force=False):
            return await guarded_fresh_stream(server, original_fresh_stream, force=force)
        screen_stream.ScreenStreamServer._ensure_fresh_stream = safe_fresh_stream

    original_audio_stream = getattr(screen_stream.ScreenStreamServer, '_ensure_audio_stream', None)
    if callable(original_audio_stream):
        async def safe_audio_stream(server):
            if getattr(server, '_mirros_media_paused', False):
                raise RuntimeError('Audio en pausa para liberar cámara y micrófono.')
            return await original_audio_stream(server)
        screen_stream.ScreenStreamServer._ensure_audio_stream = safe_audio_stream

    screen_stream.ScreenStreamServer._keep_awake_loop = controlled_keep_awake
    if callable(getattr(screen_stream.ScreenStreamServer, '_decoder_refresh_loop', None)):
        screen_stream.ScreenStreamServer._decoder_refresh_loop = settled_decoder_refresh_loop

    original_serve = screen_stream.ScreenStreamServer.serve
    async def cancellable_serve(server):
        server._mirros_started = asyncio.get_running_loop().time()
        server._mirros_serve_task = asyncio.current_task()
        server._motion_idr = False
        with contextlib.suppress(Exception):
            if hasattr(server, '_rsd') and hasattr(server._rsd, 'set_value'):
                await server._rsd.set_value(True, domain='com.apple.coredevice.dtremotedisplayd', key='disableDisplayWakeOnStart')
        sensor_task = asyncio.create_task(sensor_activity_loop(server))
        server._mirros_sensor_task = sensor_task
        try:
            return await original_serve(server)
        finally:
            if getattr(server, '_mirros_dim_active', False):
                from mirros.screen_dim import restore_screen_dim
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await restore_screen_dim(server, reason='serve_finally')
            sensor_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await sensor_task
    screen_stream.ScreenStreamServer.serve = cancellable_serve
    screen_stream._mirros_configured = True
