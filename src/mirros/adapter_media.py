"""Media, camera viewfinder, sensor monitoring, stream guard, and session health."""

import asyncio
import contextlib
import logging
import posixpath

from mirros.adapter_hid import press_home_indigo

CAMERA_BUNDLE_IDS = frozenset({
    'com.apple.camera',
    'com.apple.Magnifier',
})

SENSOR_BUNDLE_IDS = CAMERA_BUNDLE_IDS


def session_health(server):
    """Cached codec data does not prove that the USB tunnel is still usable."""
    from mirros.diagnostics import record_diagnostic_error
    try:
        connection = server._rsd.service
        if connection.reader.at_eof() or connection.writer.is_closing():
            record_diagnostic_error('transport_closed')
            return {'healthy': False, 'reason': 'transport_closed'}
    except Exception:
        record_diagnostic_error('transport_closed')
        return {'healthy': False, 'reason': 'transport_closed'}
    if getattr(server, '_mirros_media_paused', False):
        return {'healthy': True, 'reason': 'media_paused'}
    last_frame = server._last_good_au_t or getattr(server, '_mirros_started', 0)
    age = asyncio.get_running_loop().time() - last_frame
    if age >= 20 and getattr(server, '_mirros_display_mode', 'dual') == 'aod':
        return {'healthy': True, 'reason': 'aod_idle'}
    if age >= 20:
        record_diagnostic_error('video_stalled')
    return {'healthy': age < 20, 'reason': 'ok' if age < 20 else 'video_stalled'}


def classify_sensor_log(filename: str, message: str):
    """Clasifica eventos de os_trace de la app Cámara/Lupa en 'hot', 'cold' o None."""
    if not filename or not message:
        return None
    if 'cameracaptured' not in filename and 'audiomxd' not in filename:
        return None
    # os_trace entrega la ruta completa del ejecutable (p. ej. /usr/libexec/cameracaptured).
    filename = posixpath.basename(filename)
    if filename == 'cameracaptured':
        # Solo el estado MediaSafetyNet es fiable; "Looking for ... in the Main Display layout"
        # se registra con cualquier cambio de pantalla (incluso bloqueada) y no indica uso real.
        if 'MediaSafetyNet state:' not in message:
            return None
        if 'Cam(Hot:' in message:
            cam_section = message.split('Cam(Hot:', 1)[1].split(')', 1)[0]
            if any(bundle_id in cam_section for bundle_id in CAMERA_BUNDLE_IDS):
                return 'hot'
            return 'cold'
        if 'Cam(Cold:' in message:
            return 'cold'
    elif filename == 'audiomxd':
        if 'is now Foreground' in message and any(f'Client {bundle_id}' in message for bundle_id in CAMERA_BUNDLE_IDS):
            return 'hot'
        if 'is now Background' in message and any(f'Client {bundle_id}' in message for bundle_id in CAMERA_BUNDLE_IDS):
            return 'cold'
    return None


def _is_media_9022(error: BaseException) -> bool:
    if getattr(error, 'code', None) == 9022:
        return True
    try:
        from pymobiledevice3.remote.core_device.display_service import is_media_in_use_error
        if is_media_in_use_error(error):
            return True
    except Exception:
        pass
    msg = str(error)
    return '9022' in msg or 'in use' in msg.lower() or 'in_use' in msg.lower()


def get_media_state(server):
    paused = bool(getattr(server, '_mirros_media_paused', False))
    reason = getattr(server, '_mirros_media_pause_reason', 'manual') if paused else None
    return {'paused': paused, 'reason': reason}


async def set_media_state(server, paused: bool, *, reason: str = 'manual', exit_app: bool = False):
    """Pausa o reanuda la observación remota de CoreDevice para liberar cámara y micrófono en el iPhone."""
    from mirros.diagnostics import record_diagnostic_error
    if not isinstance(paused, bool):
        return {'status': 'error', 'message': 'Invalid media state.'}
    pause_reason = reason if reason in ('manual', 'auto_sensor') else 'manual'
    if paused:
        server._mirros_media_paused = True
        server._mirros_media_pause_reason = pause_reason
        with contextlib.suppress(Exception):
            server._mirros_media_paused_at = asyncio.get_running_loop().time()
        try:
            if hasattr(server, '_stream_lock') and callable(getattr(server, '_stop_active_stream', None)):
                async with server._stream_lock:
                    await server._stop_active_stream()
            elif callable(getattr(server, '_stop_active_stream', None)):
                await server._stop_active_stream()
            if hasattr(server, '_audio_lock') and callable(getattr(server, '_stop_audio_stream', None)):
                async with server._audio_lock:
                    await server._stop_audio_stream()
            elif callable(getattr(server, '_stop_audio_stream', None)):
                await server._stop_audio_stream()
            from pymobiledevice3.remote.core_device.display_service import DisplayService
            await asyncio.wait_for(DisplayService.stop_all_streams(server._rsd), timeout=6.0)
        except Exception as error:
            server._mirros_media_paused = False
            server._mirros_media_pause_reason = None
            record_diagnostic_error('media_pause_failed')
            logging.getLogger(__name__).warning('Failed to release media session: %s', error)
            return {'status': 'error', 'paused': False, 'message': 'Could not release camera and microphone on the iPhone.'}
        return {'status': 'ok', 'paused': True, 'reason': pause_reason}

    if exit_app:
        await press_home_indigo(server)
        await asyncio.sleep(0.7)

    server._mirros_media_paused = False
    server._mirros_media_pause_reason = None
    server._mirros_display_mode = 'dual'
    server._mirros_keep_awake = True
    event = getattr(server, '_mirros_keep_awake_event', None)
    if event is not None:
        event.set()
    server._mirros_media_resuming = True
    try:
        if callable(getattr(server, '_ensure_audio_stream', None)):
            with contextlib.suppress(Exception):
                await asyncio.wait_for(server._ensure_audio_stream(), timeout=10.0)
        if callable(getattr(server, '_ensure_fresh_stream', None)):
            for attempt in range(3 if exit_app else 1):
                try:
                    await asyncio.wait_for(server._ensure_fresh_stream(force=True), timeout=15.0)
                    break
                except Exception as err:
                    if exit_app and attempt < 2 and _is_media_9022(err):
                        await asyncio.sleep(0.5)
                        continue
                    raise
        server._consecutive_restarts = 0
        with contextlib.suppress(Exception):
            server._last_good_au_t = asyncio.get_running_loop().time()
        return {'status': 'ok', 'paused': False, 'reason': None}
    except Exception as error:
        server._mirros_media_paused = True
        if _is_media_9022(error):
            server._mirros_media_pause_reason = 'auto_sensor'
            record_diagnostic_error('media_in_use')
            return {
                'status': 'error',
                'code': 'media_in_use',
                'paused': True,
                'reason': 'auto_sensor',
                'message': 'Close the Camera or microphone app on the iPhone first to resume screen mirroring.',
            }
        server._mirros_media_pause_reason = 'manual'
        record_diagnostic_error('media_pause_failed')
        logging.getLogger(__name__).warning('Failed to resume media session: %s', error)
        return {'status': 'error', 'paused': True, 'reason': 'manual', 'message': 'Could not resume screen mirroring.'}
    finally:
        server._mirros_media_resuming = False


async def guarded_fresh_stream(server, original, force=False):
    """Evita que el watchdog o peticiones secundarias reinicien el stream durante AOD o pausa de cámara."""
    if getattr(server, '_mirros_media_paused', False):
        raise RuntimeError('Captura multimedia en pausa para liberar cámara y micrófono.')
    if force and getattr(server, '_mirros_display_mode', 'dual') == 'aod':
        server._consecutive_restarts = 0
        with contextlib.suppress(Exception):
            server._last_good_au_t = asyncio.get_running_loop().time()
            if callable(getattr(server, '_request_recovery_idr', None)):
                server._request_recovery_idr(reason='aod_watchdog_idr')
        return None
    try:
        return await original(server, force=force)
    except Exception as error:
        from pymobiledevice3.remote.core_device.display_service import is_media_in_use_error
        if is_media_in_use_error(error) or getattr(error, 'code', None) == 9022:
            if not getattr(server, '_mirros_media_resuming', False):
                schedule_auto_pause(server)
        raise


def schedule_auto_pause(server):
    """Marca la pausa al instante (detiene el watchdog) y libera DisplayService en segundo plano."""
    if getattr(server, '_mirros_media_paused', False):
        return None
    server._mirros_media_paused = True
    server._mirros_media_pause_reason = 'auto_sensor'
    pending = getattr(server, '_mirros_auto_pause_task', None)
    if pending is not None and not pending.done():
        return pending
    task = asyncio.create_task(set_media_state(server, True, reason='auto_sensor'))
    server._mirros_auto_pause_task = task
    return task


async def sensor_activity_loop(server):
    """Detecta en tiempo real la apertura o cierre de Cámara/Micrófono en el iPhone para liberar o reanudar DisplayService."""
    from pymobiledevice3.services.os_trace import OsActivityStreamFlag, OsTraceService

    stream_flags = (
        OsActivityStreamFlag.PAYLOAD
        | OsActivityStreamFlag.INFO
        | OsActivityStreamFlag.DEBUG
    )
    resume_task = None

    async def delayed_resume():
        try:
            await asyncio.sleep(0.85)
            for _attempt in range(3):
                if not (getattr(server, '_mirros_media_paused', False)
                        and getattr(server, '_mirros_media_pause_reason', None) == 'auto_sensor'):
                    return
                result = await set_media_state(server, False)
                if result.get('code') != 'media_in_use':
                    return
                await asyncio.sleep(1.5)
        except asyncio.CancelledError:
            return
        except Exception:
            logging.getLogger(__name__).debug('Auto-resume tras cierre de cámara falló', exc_info=True)

    log = logging.getLogger(__name__)
    failures = 0
    try:
        while True:
            sensor_state = None
            try:
                async with OsTraceService(server._rsd) as trace:
                    log.info('Monitor de cámara activo')
                    failures = 0
                    entries_seen = 0
                    async for entry in trace.syslog(stream_flags=stream_flags):
                        entries_seen += 1
                        if entries_seen % 32 == 0:
                            await asyncio.sleep(0)
                        state = classify_sensor_log(entry.filename, entry.message)
                        if state is None or state == sensor_state:
                            continue
                        previous, sensor_state = sensor_state, state
                        if state == 'hot':
                            # Solo en la transición: si el usuario reanuda a mano con la cámara abierta, no se le contradice.
                            if resume_task is not None and not resume_task.done():
                                resume_task.cancel()
                                resume_task = None
                            if not getattr(server, '_mirros_media_paused', False):
                                log.info('Cámara o micrófono en uso en el iPhone: pausando captura')
                                await set_media_state(server, True, reason='auto_sensor')
                        elif previous == 'hot' and (
                            getattr(server, '_mirros_media_paused', False)
                            and getattr(server, '_mirros_media_pause_reason', None) == 'auto_sensor'
                        ):
                            if resume_task is None or resume_task.done():
                                log.info('Cámara o micrófono liberados en el iPhone: reanudando captura')
                                resume_task = asyncio.create_task(delayed_resume())
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failures += 1
                (log.warning if failures == 1 else log.debug)(
                    'Monitor de cámara y micrófono no disponible (%s); reintentando', type(error).__name__,
                )
                await asyncio.sleep(min(2.0 * failures, 15.0))
    except asyncio.CancelledError:
        if resume_task is not None and not resume_task.done():
            resume_task.cancel()
        return


def _png_to_jpeg(png_bytes: bytes, quality: int = 75) -> bytes:
    """Convierte un fotograma PNG a JPEG comprimido para acelerar el transporte USB y decodificación."""
    import io
    from PIL import Image
    with Image.open(io.BytesIO(png_bytes)) as img:
        out = io.BytesIO()
        img.convert('RGB').save(out, format='JPEG', quality=quality)
        return out.getvalue()


async def close_camera_snapshot(server):
    stack = getattr(server, '_mirros_snapshot_stack', None)
    server._mirros_snapshot_stack = None
    server._mirros_snapshot = None
    if stack is not None:
        with contextlib.suppress(Exception):
            await stack.aclose()


async def camera_snapshot(server) -> tuple[bytes, str]:
    """Captura la pantalla por DVT; a diferencia de DisplayService, incluye el visor de la cámara.
    Devuelve (datos_imagen, content_type).
    """
    lock = getattr(server, '_mirros_snapshot_lock', None)
    if lock is None:
        lock = asyncio.Lock()
        server._mirros_snapshot_lock = lock
    async with lock:
        shot = getattr(server, '_mirros_snapshot', None)
        if shot is None:
            from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
            from pymobiledevice3.services.dvt.instruments.screenshot import Screenshot
            stack = contextlib.AsyncExitStack()
            try:
                dvt = await stack.enter_async_context(DvtProvider(server._rsd))
                shot = await stack.enter_async_context(Screenshot(dvt))
            except Exception:
                await stack.aclose()
                raise
            server._mirros_snapshot_stack = stack
            server._mirros_snapshot = shot
        try:
            png_data = await asyncio.wait_for(shot.get_screenshot(), 8)
        except Exception:
            await close_camera_snapshot(server)
            raise

    try:
        jpeg_data = await asyncio.to_thread(_png_to_jpeg, png_data, 75)
        return jpeg_data, 'image/jpeg'
    except Exception:
        return png_data, 'image/png'


async def settled_decoder_refresh_loop(server):
    """Trigger recovery IDR keyframes once screen motion settles or on heartbeat."""
    loop = asyncio.get_running_loop()
    motion_threshold_bps = 200_000
    settle_quiet = 0.9
    heartbeat = 10.0
    min_interval = 0.7
    active_interval = 1.0
    quiet_since = None
    motion_active = False
    motion_started_t = 0.0
    while True:
        try:
            await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            return
        if not getattr(server, '_subscribers', None):
            continue
        if getattr(server, '_active_service', None) is None or getattr(server, '_rtcp_dest', None) is None:
            continue
        if getattr(server, '_mirros_media_paused', False) or getattr(server, '_mirros_display_mode', 'dual') == 'aod':
            continue
        now = loop.time()
        window_bytes = sum(s for _, s in getattr(server, '_au_byte_window', ()))
        currently_active = window_bytes >= motion_threshold_bps
        if currently_active and not motion_active:
            motion_started_t = now
        motion_active = currently_active
        if currently_active:
            quiet_since = None
        elif quiet_since is None:
            quiet_since = now
        since_refresh = now - getattr(server, '_last_refresh_t', 0.0)
        if since_refresh < min_interval:
            continue
        quiet_for = None if quiet_since is None else (now - quiet_since)
        active = (
            bool(getattr(server, '_motion_idr', False))
            and currently_active
            and motion_started_t > 0
            and (now - motion_started_t) >= active_interval
            and since_refresh >= active_interval
        )
        settled = (
            quiet_since is not None
            and quiet_for is not None
            and quiet_for >= settle_quiet
            and getattr(server, '_last_refresh_t', 0.0) < quiet_since
        )
        heartbeat_due = quiet_for is not None and since_refresh >= heartbeat
        if not (active or settled or heartbeat_due):
            continue
        reason = 'active' if active else ('settled' if settled else 'heartbeat')
        if callable(getattr(server, '_fire_decoder_refresh', None)):
            server._fire_decoder_refresh(now, reason=reason)
