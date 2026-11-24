"""HID input lifecycle, gestures, buttons, display mode, and keep-awake control."""

import asyncio
import contextlib
import json
import logging
import time


async def release_input(server, release_touch=True):
    """Release held input, and drop the host keyboard connection without creating one."""
    async with server._hid_lock:
        uhs = server._uhs
        keyboard = server._kb_service_id
        if uhs is not None and keyboard is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(uhs.send_keyboard(keyboard, []), 1)
        point = getattr(server, '_mirros_contact', None) if release_touch else None
        if uhs is not None and point is not None:
            from pymobiledevice3.remote.core_device.hid_service import TOUCHSCREEN_STATE_RELEASE
            with contextlib.suppress(Exception):
                await asyncio.wait_for(uhs.send_touchscreen(TOUCHSCREEN_STATE_RELEASE, *point), 1)
        if release_touch:
            server._mirros_contact = None
            server._mirros_contact_at = None
        if uhs is not None and keyboard is not None:
            try:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(uhs.close(), 1)
            finally:
                server._uhs = None
                server._kb_service_id = None
        server._kb_service_id = None


async def touch_request(server, body, original):
    """Preserve a real tap dwell even when opening HID delayed the queued down."""
    try:
        data = json.loads(body)
    except (ValueError, TypeError):
        return await original(server, body)
    if not isinstance(data, dict):
        return await original(server, body)
    sent_at = getattr(server, '_mirros_contact_at', None)
    if data.get('type') == 'release' and sent_at is not None:
        # Windows asyncio clocks may wake timers early; check elapsed real time.
        while True:
            remaining = .04 - (time.perf_counter() - sent_at)
            if remaining <= 0:
                break
            await asyncio.sleep(max(.016, remaining))
    result = await original(server, body)
    if result[0] == 200:
        if data.get('type') == 'contact':
            if getattr(server, '_mirros_contact', None) is None:
                server._mirros_contact_at = time.perf_counter()
            server._mirros_contact = (data.get('x', 0), data.get('y', 0))
            if getattr(server, '_mirros_display_mode', 'dual') == 'aod':
                with contextlib.suppress(Exception):
                    server._last_good_au_t = asyncio.get_running_loop().time()
                    if callable(getattr(server, '_request_recovery_idr', None)):
                        server._request_recovery_idr(reason='aod_interaction')
        else:
            server._mirros_contact = None
            server._mirros_contact_at = None
    return result


async def keyboard_request(server, body, original):
    try:
        data = json.loads(body)
        usages = [int(u) for u in data.get('usages', [])]
    except (TypeError, ValueError, AttributeError):
        return await original(server, body)
    previous = getattr(server, '_mirros_keyboard_lease', None)
    if previous is not None:
        previous.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await previous
        server._mirros_keyboard_lease = None
    if data.get('detach'):
        await release_input(server)
        return 200, b'ok'
    if not usages and server._kb_service_id is None:
        return 200, b'ok'
    result = await original(server, body)
    if usages and getattr(server, '_mirros_display_mode', 'dual') == 'aod':
        with contextlib.suppress(Exception):
            server._last_good_au_t = asyncio.get_running_loop().time()
            if callable(getattr(server, '_request_recovery_idr', None)):
                server._request_recovery_idr(reason='aod_key')

    # A lost USB connection/window cannot leave a held key indefinitely.
    async def expire():
        await asyncio.sleep(5)
        await release_input(server, release_touch=False)

    server._mirros_keyboard_lease = asyncio.create_task(expire())
    return result


async def warm_input(server, worker):
    """Open HID before the first click; preserve upstream lazy recovery on failure."""
    try:
        await asyncio.wait_for(server._ensure_hid(), timeout=3)
    except Exception:
        logging.getLogger(__name__).debug('HID warm-up deferred until first input', exc_info=True)
    await worker(server)


def get_display_mode(server):
    mode = getattr(server, '_mirros_display_mode', 'dual')
    keep_awake = getattr(server, '_mirros_keep_awake', True)
    return {'mode': mode, 'keepAwake': keep_awake}


async def set_display_mode(server, mode: str):
    if mode not in ('dual', 'aod'):
        return {'status': 'error', 'message': 'Modo de pantalla no válido.'}
    if mode == 'aod':
        if getattr(server, '_mirros_display_mode', 'dual') != 'aod':
            try:
                from pymobiledevice3.remote.core_device.hid_service import HID_BUTTON_STATE_DOWN, HID_BUTTON_STATE_UP
                from pymobiledevice3.remote.core_device.screen_stream import _NAMED_BUTTONS
                usage_page, usage_code, hold_seconds = _NAMED_BUTTONS['lock']
                # _ensure_hid acquires _hid_lock itself (asyncio locks are not reentrant).
                await server._ensure_hid()
                async with server._hid_lock:
                    indigo = getattr(server, '_indigo', None)
                    if indigo is None:
                        raise RuntimeError('HID no disponible')
                    try:
                        await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_DOWN)
                        await asyncio.sleep(hold_seconds)
                    finally:
                        await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_UP)
            except Exception as error:
                from mirros.diagnostics import record_diagnostic_error
                record_diagnostic_error('aod_failed')
                logging.getLogger(__name__).warning('Failed to send lock command for AOD mode: %s', error)
                return {'status': 'error', 'message': 'Could not switch the iPhone to standby mode.'}
        server._mirros_display_mode = 'aod'
        server._mirros_keep_awake = False
        return {'mode': 'aod', 'keepAwake': False}
    else:
        server._mirros_display_mode = 'dual'
        server._mirros_keep_awake = True
        event = getattr(server, '_mirros_keep_awake_event', None)
        if event is not None:
            event.set()
        return {'mode': 'dual', 'keepAwake': True}


async def wake_device(server):
    """Send a wake gesture. Authentication remains controlled by iOS."""
    was_aod = getattr(server, '_mirros_display_mode', 'dual') == 'aod'
    try:
        await server._ensure_hid()
        async with server._hid_lock:
            indigo = getattr(server, '_indigo', None)
            if was_aod and indigo is not None:
                from pymobiledevice3.remote.core_device.hid_service import HID_BUTTON_STATE_DOWN, HID_BUTTON_STATE_UP
                from pymobiledevice3.remote.core_device.screen_stream import _NAMED_BUTTONS
                usage_page, usage_code, _ = _NAMED_BUTTONS['home']
                with contextlib.suppress(Exception):
                    await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_DOWN)
                    await asyncio.sleep(0.04)
                    await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_UP)
                    await asyncio.sleep(0.08)
            uhs = getattr(server, '_uhs', None)
            if uhs is not None:
                from pymobiledevice3.remote.core_device.hid_service import (
                    TOUCHSCREEN_STATE_CONTACT,
                    TOUCHSCREEN_STATE_RELEASE,
                )
                start_x, start_y = 32768, 62000
                end_y = 15000
                steps = 12
                cur_y = start_y
                try:
                    await uhs.send_touchscreen(TOUCHSCREEN_STATE_CONTACT, start_x, start_y)
                    await asyncio.sleep(0.04)
                    for i in range(1, steps + 1):
                        cur_y = int(start_y + (end_y - start_y) * (i / steps))
                        await uhs.send_touchscreen(TOUCHSCREEN_STATE_CONTACT, start_x, cur_y)
                        await asyncio.sleep(0.016)
                finally:
                    await uhs.send_touchscreen(TOUCHSCREEN_STATE_RELEASE, start_x, cur_y)
            else:
                raise RuntimeError('HID unavailable')
    except Exception as error:
        from mirros.diagnostics import record_diagnostic_error
        record_diagnostic_error('wake_failed')
        logging.getLogger(__name__).warning('Failed to wake device: %s', error)
        return {'status': 'error', 'message': 'Could not send wake gesture to the iPhone.'}
    server._mirros_display_mode = 'dual'
    server._mirros_keep_awake = True
    event = getattr(server, '_mirros_keep_awake_event', None)
    if event is not None:
        event.set()
    server._consecutive_restarts = 0
    with contextlib.suppress(Exception):
        server._last_good_au_t = asyncio.get_running_loop().time()
    if not getattr(server, '_mirros_media_paused', False):
        if getattr(server, '_active_service', None) is not None and callable(getattr(server, '_request_recovery_idr', None)):
            with contextlib.suppress(Exception):
                server._request_recovery_idr(reason='wake')
        elif callable(getattr(server, '_ensure_fresh_stream', None)):
            asyncio.create_task(server._ensure_fresh_stream(force=True))
    return {'status': 'ok', 'mode': 'dual', 'keepAwake': True}


async def press_button_indigo(server, button_name: str) -> bool:
    """Envía un botón de hardware mediante IndigoHIDService incluso cuando DisplayService está detenido."""
    from pymobiledevice3.remote.core_device.hid_service import (
        HID_BUTTON_STATE_DOWN,
        HID_BUTTON_STATE_UP,
        IndigoHIDService,
    )
    from pymobiledevice3.remote.core_device.screen_stream import _NAMED_BUTTONS

    button_info = _NAMED_BUTTONS.get(button_name)
    if not button_info:
        return False
    usage_page, usage_code, _ = button_info
    indigo = getattr(server, '_indigo', None)
    if indigo is not None:
        try:
            await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_DOWN)
            await asyncio.sleep(0.05)
            await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_UP)
            return True
        except Exception:
            logging.getLogger(__name__).debug('Reintentando botón %s con sesión IndigoHID dedicada', button_name, exc_info=True)
    try:
        async with IndigoHIDService(server._rsd) as temp_indigo:
            await temp_indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_DOWN)
            await asyncio.sleep(0.05)
            await temp_indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_UP)
        return True
    except Exception as error:
        logging.getLogger(__name__).warning('Failed to send IndigoHID button %s: %s', button_name, error)
        return False


async def press_home_indigo(server) -> bool:
    """Envía el botón Inicio mediante IndigoHIDService incluso cuando DisplayService está detenido."""
    return await press_button_indigo(server, 'home')


async def trigger_app_switcher(server):
    """Abre el selector de aplicaciones de iOS (multitarea / apps en segundo plano)."""
    try:
        await server._ensure_hid()
        async with server._hid_lock:
            uhs = getattr(server, '_uhs', None)
            if uhs is not None:
                from pymobiledevice3.remote.core_device.hid_service import (
                    TOUCHSCREEN_STATE_CONTACT,
                    TOUCHSCREEN_STATE_RELEASE,
                )
                start_x, start_y = 32768, 64500
                end_y = 38000
                steps = 10
                cur_y = start_y
                try:
                    await uhs.send_touchscreen(TOUCHSCREEN_STATE_CONTACT, start_x, start_y)
                    await asyncio.sleep(0.02)
                    for i in range(1, steps + 1):
                        cur_y = int(start_y + (end_y - start_y) * (i / steps))
                        await uhs.send_touchscreen(TOUCHSCREEN_STATE_CONTACT, start_x, cur_y)
                        await asyncio.sleep(0.015)
                    # Pausa en el centro para que iOS active el App Switcher
                    await asyncio.sleep(0.35)
                finally:
                    await uhs.send_touchscreen(TOUCHSCREEN_STATE_RELEASE, start_x, cur_y)
                return {'status': 'ok', 'method': 'gesture'}

            indigo = getattr(server, '_indigo', None)
            if indigo is not None:
                from pymobiledevice3.remote.core_device.hid_service import HID_BUTTON_STATE_DOWN, HID_BUTTON_STATE_UP
                from pymobiledevice3.remote.core_device.screen_stream import _NAMED_BUTTONS
                usage_page, usage_code, _ = _NAMED_BUTTONS['home']
                await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_DOWN)
                await asyncio.sleep(0.05)
                await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_UP)
                await asyncio.sleep(0.08)
                await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_DOWN)
                await asyncio.sleep(0.05)
                await indigo.send_button(usage_page, usage_code, HID_BUTTON_STATE_UP)
                return {'status': 'ok', 'method': 'double-home'}
            raise RuntimeError('HID unavailable')
    except Exception as error:
        from mirros.diagnostics import record_diagnostic_error
        record_diagnostic_error('app_switcher_failed')
        logging.getLogger(__name__).warning('Failed to open app switcher: %s', error)
        return {'status': 'error', 'message': 'Could not open the app switcher.'}


async def controlled_keep_awake(server):
    """Maintain CoreDevice power assertions while display keep-awake is enabled."""
    assertion_timeout = 300
    refresh_interval = 120
    event = getattr(server, '_mirros_keep_awake_event', None)
    if event is None:
        event = asyncio.Event()
        server._mirros_keep_awake_event = event
    try:
        while True:
            if getattr(server, '_mirros_keep_awake', True):
                try:
                    from pymobiledevice3.services.power_assertion import PowerAssertionService
                    svc = PowerAssertionService(server._rsd)
                    async with svc.create_power_assertion(
                        "PreventUserIdleSystemSleep",
                        "pymobiledevice3.serve-web",
                        assertion_timeout,
                        "MirrOS keeping device awake for screen mirroring",
                    ):
                        pass
                except Exception:
                    logging.getLogger(__name__).debug("keep-awake renew failed", exc_info=True)
            event.clear()
            try:
                await asyncio.wait_for(event.wait(), timeout=refresh_interval)
            except asyncio.TimeoutError:
                pass
            except asyncio.CancelledError:
                return
    except asyncio.CancelledError:
        return
    except Exception:
        logging.getLogger(__name__).warning("keep-awake loop crashed", exc_info=True)
