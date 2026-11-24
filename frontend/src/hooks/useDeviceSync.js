import {useCallback, useEffect, useRef, useState} from 'react';

const DEFAULT_DIM_SHORTCUT = 'MirrOS Dim';
const DEFAULT_RESTORE_SHORTCUT = 'MirrOS Restore';

function readStoredShortcut(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

export function useDeviceSync({connected, canvas, cameraCanvas, state, bridge, native, setNotice, t}) {
  const targetCanvas = cameraCanvas || canvas;
  const tRef = useRef(t);
  tRef.current = t;

  const [battery, setBattery] = useState({capacity: null, charging: false, connected: false});
  const [mediaPaused, setMediaPaused] = useState(false);
  const [mediaPauseReason, setMediaPauseReason] = useState(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [iosStyle, setIosStyle] = useState(null);
  const [accessibility, setAccessibility] = useState({
    reduce_motion: false,
    reduce_transparency: false,
    increase_contrast: false,
  });
  const [accessibilityBusy, setAccessibilityBusy] = useState(false);
  const [screenDimActive, setScreenDimActive] = useState(false);
  const [screenDimBusy, setScreenDimBusy] = useState(false);
  const [browserAutoDim, setBrowserAutoDim] = useState(() => {
    try { return localStorage.getItem('mirros_auto_dim') === '1'; } catch { return false; }
  });
  const [localShortcuts, setLocalShortcuts] = useState(() => ({
    dimShortcutName: readStoredShortcut('mirros_dim_shortcut', DEFAULT_DIM_SHORTCUT),
    restoreShortcutName: readStoredShortcut('mirros_restore_shortcut', DEFAULT_RESTORE_SHORTCUT),
  }));
  const [cameraLive, setCameraLive] = useState(false);

  const mediaBusyRef = useRef(false);
  const mediaStateRef = useRef({paused: false, reason: null});

  const autoDimOnConnect = bridge ? Boolean(state.autoDimOnConnect) : browserAutoDim;
  const dimShortcutName = (bridge ? state.dimShortcutName : null) || localShortcuts.dimShortcutName || DEFAULT_DIM_SHORTCUT;
  const restoreShortcutName = (bridge ? state.restoreShortcutName : null) || localShortcuts.restoreShortcutName || DEFAULT_RESTORE_SHORTCUT;

  const applyMediaState = useCallback((paused, reason) => {
    const nextReason = paused ? (reason || 'manual') : null;
    mediaStateRef.current = {paused, reason: nextReason};
    setMediaPaused(paused);
    setMediaPauseReason(nextReason);
  }, []);

  // Battery telemetry polling (/battery)
  useEffect(() => {
    if (!connected) {
      setBattery({capacity: null, charging: false, connected: false});
      return;
    }
    let cancelled = false;
    const pollBattery = async () => {
      try {
        const res = await fetch('/battery', {cache: 'no-store'});
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data && typeof data === 'object') {
          setBattery({
            capacity: typeof data.capacity === 'number' ? data.capacity : null,
            charging: Boolean(data.charging),
            connected: Boolean(data.connected),
          });
        }
      } catch {}
    };
    pollBattery();
    const interval = setInterval(pollBattery, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connected]);

  // Media-state polling + initial /style, /accessibility, /screen-dim sync
  useEffect(() => {
    if (!connected) {
      applyMediaState(false, null);
      setIosStyle(null);
      setScreenDimActive(false);
      return;
    }
    let cancelled = false;
    const syncMediaState = () => {
      if (mediaBusyRef.current) return;
      fetch('/media-state', {cache: 'no-store'}).then(r => r.ok ? r.json() : null).then(data => {
        if (cancelled || mediaBusyRef.current || !data || typeof data.paused !== 'boolean') return;
        const previous = mediaStateRef.current;
        if (previous.paused === data.paused && previous.reason === (data.paused ? data.reason || 'manual' : null)) return;
        if (data.paused && !previous.paused && data.reason === 'auto_sensor') {
          setNotice(tRef.current.notices.cameraDetected);
        } else if (!data.paused && previous.paused && previous.reason === 'auto_sensor') {
          setNotice(tRef.current.notices.cameraClosed);
        }
        applyMediaState(data.paused, data.reason);
      }).catch(() => {});
    };
    syncMediaState();
    const interval = setInterval(syncMediaState, 1000);

    fetch('/style').then(r => r.ok ? r.json() : null).then(data => {
      if (!cancelled && data && (data.style === 'light' || data.style === 'dark')) setIosStyle(data.style);
    }).catch(() => {});

    fetch('/accessibility', {cache: 'no-store'}).then(r => r.ok ? r.json() : null).then(data => {
      if (cancelled || !data || !Array.isArray(data.settings)) return;
      const next = {reduce_motion: false, reduce_transparency: false, increase_contrast: false};
      for (const item of data.settings) {
        if (item && typeof item.key === 'string' && item.key in next) {
          next[item.key] = Boolean(item.value);
        }
      }
      setAccessibility(next);
    }).catch(() => {});

    fetch('/screen-dim', {cache: 'no-store'}).then(r => r.ok ? r.json() : null).then(data => {
      if (cancelled || !data || typeof data.active !== 'boolean') return;
      setScreenDimActive(data.active);
      if (!bridge && browserAutoDim && !data.active && state.displayMode !== 'aod') {
        fetch('/screen-dim', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            action: 'dim',
            dimShortcut: dimShortcutName,
            restoreShortcut: restoreShortcutName,
          }),
        }).then(r => r.ok ? r.json() : null).then(res => {
          if (!cancelled && res && typeof res.active === 'boolean') setScreenDimActive(res.active);
        }).catch(() => {});
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connected, bridge, browserAutoDim, state.displayMode, applyMediaState, dimShortcutName, restoreShortcutName, setNotice]);

  // DVT live camera viewfinder loop when media stream is paused for camera access
  useEffect(() => {
    if (!connected || !mediaPaused) {
      setCameraLive(false);
      return;
    }
    let cancelled = false;
    const abort = new AbortController();

    async function streamCamera() {
      while (!cancelled) {
        try {
          const res = await fetch('/camera-frame', {
            signal: abort.signal,
            cache: 'no-store',
          });
          if (!res.ok) {
            await new Promise(r => setTimeout(r, 200));
            continue;
          }
          const blob = await res.blob();
          if (cancelled) break;
          const bitmap = await createImageBitmap(blob);
          if (cancelled) {
            bitmap.close();
            break;
          }
          const c = targetCanvas?.current;
          if (c) {
            if (c.width !== bitmap.width || c.height !== bitmap.height) {
              c.width = bitmap.width;
              c.height = bitmap.height;
            }
            const ctx = c.getContext('2d');
            if (ctx) {
              ctx.drawImage(bitmap, 0, 0);
              if (!cancelled) setCameraLive(true);
            }
          }
          bitmap.close();
        } catch {
          if (cancelled) break;
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }

    streamCamera();
    return () => {
      cancelled = true;
      abort.abort();
      setCameraLive(false);
    };
  }, [connected, mediaPaused, targetCanvas]);

  const toggleAutoDimOnConnect = useCallback(async () => {
    const next = !autoDimOnConnect;
    if (bridge) {
      await native('autoDim', next);
    } else {
      setBrowserAutoDim(next);
      try { localStorage.setItem('mirros_auto_dim', next ? '1' : '0'); } catch {}
    }
    setNotice(tRef.current.notices.autoDimSaved(next));
  }, [autoDimOnConnect, bridge, native, setNotice]);

  const updateDimShortcuts = useCallback(async (dimName, restoreName) => {
    const nextDim = String(dimName || '').trim() || DEFAULT_DIM_SHORTCUT;
    const nextRestore = String(restoreName || '').trim() || DEFAULT_RESTORE_SHORTCUT;
    setLocalShortcuts({dimShortcutName: nextDim, restoreShortcutName: nextRestore});
    try {
      localStorage.setItem('mirros_dim_shortcut', nextDim);
      localStorage.setItem('mirros_restore_shortcut', nextRestore);
    } catch {}
    if (bridge) {
      try {
        await native('dimShortcuts', {dimShortcutName: nextDim, restoreShortcutName: nextRestore});
      } catch {}
    }
    setNotice(tRef.current.notices?.dimShortcutsSaved || 'OLED dim shortcut names saved.');
  }, [bridge, native, setNotice]);

  const triggerScreenDim = useCallback(async action => {
    if (!connected || screenDimBusy || (action !== 'dim' && action !== 'restore')) return;
    setScreenDimBusy(true);
    try {
      const res = await fetch('/screen-dim', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action,
          force: action === 'restore',
          dimShortcut: dimShortcutName,
          restoreShortcut: restoreShortcutName,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status === 'error') throw new Error(tRef.current.notices.screenDimFailed);
      setScreenDimActive(Boolean(body.active));
      setNotice(action === 'dim' ? tRef.current.notices.screenDimApplied : tRef.current.notices.screenDimRestored);
    } catch (err) {
      setNotice(err.message || tRef.current.notices.screenDimFailed);
    } finally {
      setScreenDimBusy(false);
    }
  }, [connected, screenDimBusy, dimShortcutName, restoreShortcutName, setNotice]);

  const toggleAccessibility = useCallback(async (key, nextValue = !accessibility[key]) => {
    if (!connected || accessibilityBusy) return;
    setAccessibilityBusy(true);
    try {
      const res = await fetch('/accessibility/set', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({key, value: Boolean(nextValue)}),
      });
      if (!res.ok) throw new Error(tRef.current.notices.accessibilityUpdateFailed);
      setAccessibility(prev => ({...prev, [key]: Boolean(nextValue)}));
      const label = tRef.current.notices.accessibilityLabels[key] || key;
      setNotice(tRef.current.notices.accessibilityUpdated(label, nextValue));
    } catch (err) {
      setNotice(err.message);
    } finally {
      setAccessibilityBusy(false);
    }
  }, [connected, accessibility, accessibilityBusy, setNotice]);

  const toggleMediaPause = useCallback(async (nextPaused = !mediaPaused, {exitApp = false} = {}) => {
    if (!connected || mediaBusyRef.current) return false;
    mediaBusyRef.current = true;
    setMediaBusy(true);
    try {
      const res = await fetch('/media-state', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({paused: Boolean(nextPaused), exit_app: Boolean(exitApp && !nextPaused)}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.code === 'media_in_use') applyMediaState(true, body.reason || 'auto_sensor');
        throw new Error(body.message || body.error || tRef.current.notices.mediaToggleFailed);
      }
      applyMediaState(Boolean(nextPaused), body.reason || 'manual');
      setNotice(nextPaused
        ? tRef.current.notices.mediaReleased
        : exitApp ? tRef.current.notices.mediaClosingCamera : tRef.current.notices.mediaResuming);
      return true;
    } catch (err) {
      setNotice(err.message);
      return false;
    } finally {
      mediaBusyRef.current = false;
      setMediaBusy(false);
    }
  }, [connected, mediaPaused, applyMediaState, setNotice]);

  const changeIosStyle = useCallback(async style => {
    if (!connected) return;
    try {
      const res = await fetch('/style', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({style}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || tRef.current.notices.iosStyleFailed);
      setIosStyle(style);
      setNotice(tRef.current.notices.iosStyleApplied(style === 'dark'));
    } catch (err) {
      setNotice(err.message);
    }
  }, [connected, setNotice]);

  return {
    battery,
    mediaPaused,
    mediaPauseReason,
    mediaBusy,
    toggleMediaPause,
    iosStyle,
    changeIosStyle,
    accessibility,
    accessibilityBusy,
    toggleAccessibility,
    screenDimActive,
    screenDimBusy,
    autoDimOnConnect,
    toggleAutoDimOnConnect,
    triggerScreenDim,
    dimShortcutName,
    restoreShortcutName,
    updateDimShortcuts,
    cameraLive,
    cameraCanvas: targetCanvas,
  };
}
