"""Device metadata, clipboard, orientation, appearance, apps, and battery helpers."""

import asyncio
import contextlib
import logging
import time

from mirros.adapter_media import SENSOR_BUNDLE_IDS, set_media_state


async def read_device_clipboard(rsd):
    # Manual pulls may resolve an image inside a rich representation (e.g. Notes).
    # The upstream monitor retains its fast primary-type policy; no background reads.
    from pymobiledevice3.remote.core_device.pasteboard_service import read_pasteboard
    return await read_pasteboard(rsd, allow_full_pull=True)


async def clipboard_revision(server):
    from pymobiledevice3.remote.core_device.pasteboard_service import POLICY_ALL_PROMISED, PasteboardService
    async with PasteboardService(server._rsd) as service:
        snapshot = await service.get(data_policy=POLICY_ALL_PROMISED)
    metadata = (snapshot.get('pasteboard') or {}).get('metadata') or {}
    if 'nonce' not in metadata or 'changeCount' not in metadata:
        raise RuntimeError('iOS no informó el estado del portapapeles.')
    return f"{metadata['nonce']}:{metadata['changeCount']}"


async def close_orientation(server):
    service = getattr(server, '_mirros_springboard', None)
    server._mirros_springboard = None
    server._mirros_springboard_rsd = None
    if service is not None:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(service.close(), 1)


async def read_orientation(server):
    if getattr(server, '_mirros_display_mode', 'dual') == 'aod' or getattr(server, '_mirros_media_paused', False):
        cached = getattr(server, '_mirros_last_orientation', None)
        if cached:
            return cached
    lock = getattr(server, '_mirros_orientation_lock', None)
    if lock is None:
        lock = asyncio.Lock()
        server._mirros_orientation_lock = lock
    async with lock:
        from pymobiledevice3.services.springboard import SpringBoardServicesService
        service = getattr(server, '_mirros_springboard', None)
        current_rsd = getattr(server, '_rsd', None)
        if service is not None and getattr(server, '_mirros_springboard_rsd', current_rsd) is not current_rsd:
            await close_orientation(server)
            service = None
        for attempt in range(2):
            try:
                if service is None:
                    service = SpringBoardServicesService(current_rsd)
                    await asyncio.wait_for(service.connect(), 1.5)
                    server._mirros_springboard = service
                    server._mirros_springboard_rsd = current_rsd
                value = await asyncio.wait_for(service.get_interface_orientation(), 1.5)
                orientation = {1: 'portrait', 2: 'portraitUpsideDown', 3: 'landscapeLeft', 4: 'landscapeRight'}[int(value)]
                server._mirros_last_orientation = orientation
                return orientation
            except Exception:
                await close_orientation(server)
                service = None
                if attempt == 1:
                    raise


async def get_ios_style(server):
    from pymobiledevice3.remote.core_device.configuration_service import ConfigurationService
    async with ConfigurationService(server._rsd) as cfg:
        style = await cfg.get_user_interface_style()
    return {'style': str(style)}


async def set_ios_style(server, style: str):
    if style not in ('light', 'dark'):
        return {'status': 'error', 'message': 'Invalid iOS appearance style.'}
    try:
        from pymobiledevice3.remote.core_device.configuration_service import ConfigurationService
        async with ConfigurationService(server._rsd) as cfg:
            await cfg.set_user_interface_style(style)
        return {'status': 'ok', 'style': style}
    except Exception as error:
        from mirros.diagnostics import record_diagnostic_error
        record_diagnostic_error('style_failed')
        logging.getLogger(__name__).warning('Failed to set iOS appearance to %s: %s', style, error)
        return {'status': 'error', 'message': 'Could not change iOS appearance on the iPhone.'}


async def list_device_apps(server):
    """Obtiene la lista de aplicaciones instaladas en el iPhone."""
    from pymobiledevice3.services.installation_proxy import InstallationProxyService

    async with InstallationProxyService(server._rsd) as service:
        apps = await service.get_apps(application_type='User')
    result = []
    for bundle_id, data in sorted(
        apps.items(),
        key=lambda x: (x[1].get('CFBundleDisplayName') or x[1].get('CFBundleName') or x[0]).lower(),
    ):
        name = data.get('CFBundleDisplayName') or data.get('CFBundleName') or bundle_id
        app_version = data.get('CFBundleShortVersionString') or data.get('CFBundleVersion') or ''
        result.append({'bundle_id': bundle_id, 'name': name, 'version': str(app_version)})
    return result


async def launch_device_app(server, bundle_id: str):
    """Abre una aplicación de usuario en el iPhone mediante CoreDevice."""
    if not isinstance(bundle_id, str) or not bundle_id.strip() or len(bundle_id.strip()) > 255 or any(c.isspace() for c in bundle_id.strip()):
        return {'status': 'error', 'message': 'Invalid application bundle identifier.'}
    clean_id = bundle_id.strip()
    try:
        if clean_id in SENSOR_BUNDLE_IDS and not getattr(server, '_mirros_media_paused', False):
            await set_media_state(server, True, reason='auto_sensor')
        from pymobiledevice3.remote.core_device.app_service import AppServiceService
        async with AppServiceService(server._rsd) as service:
            await service.launch_application(clean_id, kill_existing=False)
        return {
            'status': 'ok',
            'bundle_id': clean_id,
            'media_paused': bool(getattr(server, '_mirros_media_paused', False)),
        }
    except Exception as error:
        from mirros.diagnostics import record_diagnostic_error
        record_diagnostic_error('app_launch_failed')
        logging.getLogger(__name__).warning('Failed to launch app %s: %s', clean_id, error)
        return {'status': 'error', 'message': 'Could not open the application on the iPhone.'}


def product_type_to_name(product_type: str) -> str:
    if not product_type:
        return ''
    try:
        from pymobiledevice3.lockdown import IRECV_DEVICES
        for device in IRECV_DEVICES:
            if getattr(device, 'product_type', None) == product_type:
                return getattr(device, 'display_name', None) or product_type
    except Exception:
        pass
    return product_type


def get_lockdown_client(server):
    lockdown = getattr(server, '_lockdown', None)
    if lockdown is not None:
        return lockdown
    lockdown = getattr(server, 'lockdown', None)
    if lockdown is not None:
        return lockdown
    rsd = getattr(server, '_rsd', None)
    if rsd is not None:
        lockdown = getattr(rsd, '_lockdown', None)
        if lockdown is not None:
            return lockdown
        if hasattr(rsd, 'get_value'):
            return rsd
    return None


async def get_device_model(server) -> str:
    cached = getattr(server, '_mirros_device_model', None)
    if cached:
        return cached
    lockdown = get_lockdown_client(server)
    if lockdown is not None:
        display_name = getattr(lockdown, 'display_name', None)
        if display_name:
            with contextlib.suppress(Exception):
                server._mirros_device_model = display_name
            return display_name
        product_type = getattr(lockdown, 'product_type', None) or getattr(lockdown, 'all_values', {}).get('ProductType')
        if not product_type and hasattr(lockdown, 'get_value'):
            with contextlib.suppress(Exception):
                product_type = await asyncio.wait_for(lockdown.get_value(key='ProductType'), timeout=3)
        if product_type:
            name = product_type_to_name(product_type)
            with contextlib.suppress(Exception):
                server._mirros_device_model = name
                server._mirros_product_type = product_type
            return name
    return ''


async def get_battery_info(server):
    now = time.monotonic()
    cache = getattr(server, '_mirros_battery_cache', None)
    if cache is not None:
        cached_at, cached_data = cache
        if now - cached_at < 15.0:
            return cached_data

    safe_fallback = {'capacity': None, 'charging': False, 'connected': False}
    lockdown = get_lockdown_client(server)
    if lockdown is None or not hasattr(lockdown, 'get_value'):
        return safe_fallback

    try:
        data = await asyncio.wait_for(
            lockdown.get_value(domain="com.apple.mobile.battery"),
            timeout=5.0,
        )
        if not isinstance(data, dict):
            res = safe_fallback
        else:
            raw_cap = data.get('BatteryCurrentCapacity', data.get('capacity'))
            cap = int(raw_cap) if raw_cap is not None and isinstance(raw_cap, (int, float)) else None
            charging = bool(data.get('BatteryIsCharging', data.get('charging', False)))
            connected = bool(data.get('ExternalConnected', data.get('connected', True if cap is not None else False)))
            res = {'capacity': cap, 'charging': charging, 'connected': connected}
    except Exception as error:
        logging.getLogger(__name__).debug('Could not query battery status: %s', error)
        res = safe_fallback

    with contextlib.suppress(Exception):
        server._mirros_battery_cache = (now, res)
    return res
