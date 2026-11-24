import React, {useEffect, useRef, useState} from 'react';
import {Smartphone, Pin, Minus, X, Maximize2, Home, LockKeyhole, Volume2, VolumeX, Camera, CameraOff, Play, ArrowLeft, ArrowRight, Palette, Clipboard, ExternalLink, ChevronRight, Cable, CircleHelp, GripHorizontal, Monitor, LoaderCircle, RotateCw, ChevronLeft, LogOut, Moon, Sun, Layers, Battery, BatteryCharging, BatteryLow, BatteryMedium, BatteryFull, SlidersHorizontal, Bell, Languages} from 'lucide-react';
import {post} from './transport.js';
import {bridge, native} from './bridge.js';
import {resolveBatteryIcon} from './battery.mjs';
import {rotateDevice} from './orientation.js';
import {useLanguage, translateBackendText} from './i18n.js';
import {useConnection} from './hooks/useConnection.js';
import {useAudio} from './hooks/useAudio.js';
import {usePhoneVideo} from './hooks/usePhoneVideo.js';
import {usePhoneInput} from './hooks/usePhoneInput.js';
import {useRecording} from './hooks/useRecording.js';
import {useDeviceSync} from './hooks/useDeviceSync.js';
import {IconButton, RecordButton, RecordingBadge} from './components/Controls.jsx';
import {AppsModal} from './components/AppsModal.jsx';
import {FloatingShell} from './components/FloatingShell.jsx';
import {StudioShell} from './components/StudioShell.jsx';
import './style.css';

const BATTERY_ICONS = {Battery, BatteryCharging, BatteryLow, BatteryMedium, BatteryFull};
const SECTION_DEFS = [[Smartphone, 'phone'], [Volume2, 'audio'], [Clipboard, 'clipboard'], [Palette, 'appearance'], [CircleHelp, 'help']];
const DROP_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const stripIpcError = err => (err?.message || '').replace(/^Error invoking remote method '[^']+': Error: /, '');

function readInitialQuality() {
  const q = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('quality') : null;
  const pick = q || localStorage.getItem('videoQuality');
  return ['economy', 'balanced', 'detail'].includes(pick) ? pick : 'balanced';
}
function readInitialSoftware() {
  const p = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  return p?.has('software') ? ['1', 'true'].includes(p.get('software')) : localStorage.getItem('forceSoftware') === 'true';
}

async function fileToPngBytes(file) {
  if (file.type === 'image/png') return file.arrayBuffer();
  const bitmap = await createImageBitmap(file);
  try {
    const offscreen = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(bitmap.width, bitmap.height)
      : Object.assign(document.createElement('canvas'), {width: bitmap.width, height: bitmap.height});
    offscreen.getContext('2d')?.drawImage(bitmap, 0, 0);
    const blob = typeof offscreen.convertToBlob === 'function'
      ? await offscreen.convertToBlob({type: 'image/png'})
      : await new Promise((resolve, reject) => offscreen.toBlob(b => b ? resolve(b) : reject(new Error('PNG conversion failed')), 'image/png'));
    return blob.arrayBuffer();
  } finally { bitmap.close?.(); }
}

export default function App() {
  const {lang, setLang, toggleLang, t} = useLanguage();
  const platformLabel = navigator.userAgent.includes('Windows') ? 'Windows' : navigator.userAgent.includes('Linux') ? 'Linux' : t.yourSystem;
  const sections = SECTION_DEFS.map(([Icon, id]) => [Icon, id, t.sections[id][0]]);
  const [state, setState] = useConnection();
  const [tab, setTab] = useState('phone'), [notice, setNotice] = useState('');
  const [keyboard, setKeyboard] = useState(false), [text, setText] = useState('');
  const [sensitivity, setSensitivity] = useState(() => Number(localStorage.getItem('sensibilidad') || 1));
  const [pointer, setPointer] = useState(() => ({
    shape: localStorage.getItem('puntero-forma') || 'flecha',
    color: localStorage.getItem('puntero-color') || '#ffffff',
    size: Number(localStorage.getItem('puntero-tamano') || 100),
  }));
  const pointerNode = useRef(null), canvasRectRef = useRef(null), pointerRaf = useRef(null), pointerPending = useRef(null);
  const canvas = useRef(null), stage = useRef(null), clipboardLock = useRef(false);
  const [phoneSize, setPhoneSize] = useState({width: 280, height: 610});
  const [rotating, setRotating] = useState(false), [clipboardBusy, setClipboardBusy] = useState(false), [dropActive, setDropActive] = useState(false);
  const [videoQuality, setVideoQuality] = useState(readInitialQuality), [forceSoftware, setForceSoftware] = useState(readInitialSoftware);
  const [showApps, setShowApps] = useState(false), [deviceApps, setDeviceApps] = useState([]);
  const [loadingApps, setLoadingApps] = useState(false), [launchingApp, setLaunchingApp] = useState(null);

  const floating = state.mode === 'phone', connected = state.phase === 'conectado', controlsVisible = state.controlsVisible !== false;
  useEffect(() => { localStorage.setItem('videoQuality', videoQuality); }, [videoQuality]);
  useEffect(() => { localStorage.setItem('forceSoftware', String(forceSoftware)); }, [forceSoftware]);
  useEffect(() => { if (!connected) setDropActive(false); }, [connected]);

  const sync = useDeviceSync({connected, canvas, state, bridge, native, setNotice, t});
  const {battery, mediaPaused, mediaBusy, toggleMediaPause, screenDimActive, triggerScreenDim, cameraLive} = sync;
  const {audioEnabled, audioStatus, volume, setVolume, toggleAudio, getAudioStream} = useAudio(connected && !mediaPaused);
  const {dimensions, frames, live, videoStatus, rotation, video, videoMode} = usePhoneVideo(canvas, connected && !mediaPaused, floating, videoQuality, forceSoftware);
  const {
    recording, recordingDuration, recordingBytes,
    recordingFormat, setRecordingFormat,
    recordingQuality, setRecordingQuality,
    recordingIncludeAudio, setRecordingIncludeAudio,
    toggleRecording,
  } = useRecording({canvas, connected, live, cameraLive, getAudioStream, bridge, native, setNotice, t});

  const shortcutRef = useRef({});
  shortcutRef.current = {connected, screenDimActive, triggerScreenDim, toggleRecording};
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === 'F11') {
        event.preventDefault();
        if (bridge) native('fullscreen');
        else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
        return;
      }
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return;
      const key = event.key?.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === 'r' || event.code === 'KeyR')) {
        event.preventDefault();
        shortcutRef.current.toggleRecording();
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === 'd' || event.code === 'KeyD')) {
        if (!shortcutRef.current.connected) return;
        event.preventDefault();
        shortcutRef.current.triggerScreenDim(shortcutRef.current.screenDimActive ? 'restore' : 'dim');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  async function runGesture(kind, noticeText, fallbackPath) {
    if (!connected) return;
    try {
      if (input.current?.swipe) await input.current.swipe(kind);
      else if (fallbackPath) await post(fallbackPath, {});
      setNotice(noticeText);
    } catch (error) { setNotice(error.message); }
  }
  const appSwitcher = () => runGesture('switcher', t.notices.appSwitcher, '/app-switcher');
  const controlCenterSwipe = () => runGesture('controlCenter', t.notices.controlCenter);
  const notificationsSwipe = () => runGesture('notifications', t.notices.notifications);

  async function loadDeviceApps() {
    if (!connected || loadingApps) return;
    setLoadingApps(true);
    try {
      const res = await fetch('/apps');
      if (!res.ok) throw new Error(t.notices.appsLoadFailed);
      const data = await res.json();
      setDeviceApps(Array.isArray(data) ? data : []);
      setShowApps(true);
    } catch (err) { setNotice(err.message); }
    finally { setLoadingApps(false); }
  }
  async function launchDeviceApp(app) {
    if (!connected || launchingApp) return;
    setLaunchingApp(app.bundle_id);
    try {
      await post('/apps/launch', {bundle_id: app.bundle_id});
      setShowApps(false);
      setNotice(t.notices.launchingApp(app.name));
    } catch (err) { setNotice(err.message); }
    finally { setLaunchingApp(null); }
  }
  async function exportDiagnostics() {
    try {
      if (bridge) { const msg = await native('diagnostics'); if (msg) setNotice(translateBackendText(msg, lang)); return; }
      const res = await fetch('/diagnostics');
      if (!res.ok) throw new Error(t.notices.diagnosticsFailed);
      const url = URL.createObjectURL(new Blob([JSON.stringify(await res.json(), null, 2) + '\n'], {type: 'application/json'}));
      Object.assign(document.createElement('a'), {download: 'mirros-diagnostics.json', href: url}).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(t.notices.diagnosticsExported);
    } catch (error) { setNotice(stripIpcError(error)); }
  }
  async function rotatePhone() {
    if (!connected || rotating) return;
    setRotating(true);
    video.current?.rotateView();
    try {
      const result = await rotateDevice();
      if (result.currentDeviceOrientation === 'portrait') setNotice(t.notices.rotatedPortraitKept);
    } catch { setNotice(t.notices.rotatedDeclined); }
    finally { setRotating(false); }
  }
  async function shareClipboard(direction) {
    setClipboardBusy(true);
    try { setNotice(translateBackendText(await native('clipboard', direction), lang)); }
    catch (error) { setNotice(stripIpcError(error)); }
    finally { setClipboardBusy(false); }
  }
  async function runClipboardShortcut(action) {
    if (clipboardLock.current || !connected || !bridge) return;
    clipboardLock.current = true; setClipboardBusy(true);
    try { setNotice(translateBackendText(await native('clipboardShortcut', action), lang)); }
    catch (error) { setNotice(stripIpcError(error)); }
    finally { clipboardLock.current = false; setClipboardBusy(false); }
  }
  function toggleControls() { bridge ? native('controls', !controlsVisible) : setState(v => ({...v, controlsVisible: !controlsVisible})); }
  function switchMode(nextMode) {
    if (bridge) { native('mode', nextMode); return; }
    setState(v => ({...v, mode: nextMode}));
    try { window.resizeTo?.(nextMode === 'studio' ? 1120 : 410, nextMode === 'studio' ? 800 : 860); } catch {}
  }
  async function disconnectSession() {
    if (bridge) { native('disconnect'); return; }
    try { await post('/session/end', {}); } catch {}
    setState(v => ({...v, phase: 'pausado', message: t.status.paused}));
    try { window.close(); } catch {}
  }
  const closeApp = () => (bridge ? native('close') : disconnectSession());
  async function setDisplayMode(mode) {
    try {
      if (bridge) await native('displayMode', mode);
      else { await post('/display-mode', {mode}); setState(v => ({...v, displayMode: mode})); }
      setNotice(connected ? (mode === 'aod' ? t.notices.displayModeAod : t.notices.displayModeDual) : t.notices.displayModeSaved);
    } catch (err) { setNotice(err.message); }
  }
  async function wakePhone() {
    if (!connected) return;
    try {
      if (mediaPaused && !(await toggleMediaPause(false))) return;
      if (bridge) await native('wake');
      else { await post('/wake', {}); if (state.displayMode === 'aod') setState(v => ({...v, displayMode: 'dual'})); }
      setNotice(t.notices.wakingPhone);
    } catch (err) { setNotice(err.message); }
  }
  function button(name) { if (connected) post('/button', {name, state: 'press'}).catch(error => setNotice(error.message)); }
  async function phoneAudioButton(name) {
    if (!connected) return;
    try { await post('/button', {name, state: 'press'}); setNotice(name === 'mute' ? t.notices.muteSent : t.notices.volumeAdjusted); }
    catch (error) { setNotice(error.message); }
  }
  async function capture() {
    if ((!live && !cameraLive) || !canvas.current) return;
    try {
      const image = await new Promise((resolve, reject) => canvas.current.toBlob(b => b ? resolve(b) : reject(new Error(t.notices.captureFailed)), 'image/png'));
      if (bridge) { if (await native('saveCapture', new Uint8Array(await image.arrayBuffer()))) setNotice(t.notices.captureSaved); }
      else {
        const url = URL.createObjectURL(image);
        Object.assign(document.createElement('a'), {download: 'MirrOS.png', href: url}).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { setNotice(error.message); }
  }
  async function sendText(event) {
    event.preventDefault(); if (!text.trim()) return;
    try { await post('/clipboard', {text}); await post('/key', {usages: [227, 25]}); await post('/key', {usages: []}); setText(''); setNotice(t.notices.textSent); }
    catch (error) { setNotice(error.message); }
  }
  function handleDragOver(event) {
    if (!connected) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (!dropActive) setDropActive(true);
  }
  function handleDragLeave(event) { if (!event.currentTarget.contains(event.relatedTarget)) setDropActive(false); }
  async function handleDrop(event) {
    event.preventDefault();
    setDropActive(false);
    if (!connected || !event.dataTransfer) return;
    const unsupported = t.notices?.dropUnsupported || 'Drop a PNG, JPEG, WebP image or text/URL.';
    const imageFile = Array.from(event.dataTransfer.files || []).find(file => DROP_IMAGE_TYPES.has(file.type));
    if (imageFile) {
      try {
        const res = await fetch('/clipboard', {method: 'POST', headers: {'Content-Type': 'image/png'}, body: await fileToPngBytes(imageFile)});
        if (!res.ok) throw new Error(unsupported);
        setNotice(t.notices?.dropImageSent || 'Image sent to iPhone clipboard.');
      } catch (err) { setNotice(err.message || unsupported); }
      return;
    }
    const droppedText = event.dataTransfer.getData('text/plain') || event.dataTransfer.getData('text/uri-list');
    if (droppedText?.trim()) {
      try {
        const res = await fetch('/clipboard', {method: 'POST', headers: {'Content-Type': 'text/plain; charset=utf-8'}, body: droppedText});
        if (!res.ok) throw new Error(unsupported);
        setNotice(t.notices?.dropTextSent || 'Text sent to iPhone clipboard.');
      } catch (err) { setNotice(err.message || unsupported); }
      return;
    }
    setNotice(unsupported);
  }

  useEffect(() => {
    document.body.classList.toggle('floating', floating);
    document.body.classList.toggle('is-browser', !bridge);
  }, [floating]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => { document.documentElement.dataset.theme = state.theme === 'sistema' ? (media.matches ? 'oscuro' : 'claro') : state.theme || 'claro'; };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [state.theme]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(id); }, [notice]);

  const setTheme = theme => (bridge ? native('theme', theme) : setState(v => ({...v, theme})));
  function updatePointer(key, value) {
    setPointer(prev => {
      const next = {...prev, [key]: value};
      localStorage.setItem(`puntero-${key === 'shape' ? 'forma' : key === 'color' ? 'color' : 'tamano'}`, String(value));
      return next;
    });
  }
  function hidePointer() {
    pointerPending.current = null;
    if (pointerRaf.current != null) { cancelAnimationFrame(pointerRaf.current); pointerRaf.current = null; }
    if (pointerNode.current && pointerNode.current.style.opacity !== '0') pointerNode.current.style.opacity = '0';
  }
  function trackPointer(event) {
    if (!pointerNode.current) return;
    const rect = canvasRectRef.current || (canvasRectRef.current = event.currentTarget.getBoundingClientRect());
    if (event.clientX <= rect.left || event.clientX >= rect.right || event.clientY <= rect.top || event.clientY >= rect.bottom) { hidePointer(); return; }
    pointerPending.current = {x: event.clientX - rect.left + 5, y: event.clientY - rect.top + 5};
    if (pointerRaf.current == null) {
      pointerRaf.current = requestAnimationFrame(() => {
        pointerRaf.current = null;
        const pos = pointerPending.current, target = pointerNode.current;
        if (!pos || !target) return;
        target.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
        if (target.style.opacity !== '1') target.style.opacity = '1';
      });
    }
  }

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    let fitRaf = null;
    const fit = () => {
      canvasRectRef.current = null;
      const {width, height} = node.getBoundingClientRect();
      const ratio = dimensions.width / dimensions.height;
      const availH = Math.max(100, height - (floating ? 28 : 24));
      const availW = Math.max(80, width - (controlsVisible ? (floating ? 78 : 74) : (floating ? 42 : 38)));
      const h = Math.min(availH, availW / ratio);
      const nextW = Math.round(h * ratio), nextH = Math.round(h);
      setPhoneSize(prev => prev.width === nextW && prev.height === nextH ? prev : {width: nextW, height: nextH});
    };
    const scheduleFit = () => { canvasRectRef.current = null; if (fitRaf == null) fitRaf = requestAnimationFrame(() => { fitRaf = null; fit(); }); };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(node); window.addEventListener('resize', scheduleFit); fit();
    return () => { observer.disconnect(); window.removeEventListener('resize', scheduleFit); if (fitRaf != null) cancelAnimationFrame(fitRaf); };
  }, [dimensions, floating, tab, controlsVisible]);

  const input = usePhoneInput({canvas, connected, sensitivity, rotation, floating, onError: setNotice, button, capture, setKeyboard, clipboardShortcut: runClipboardShortcut, wake: wakePhone, appSwitcher, toggleRecording});
  const isDisplaying = live || cameraLive;
  const statusLabel = connected ? t.status.connected : state.phase === 'preparando' ? t.status.preparing : state.phase === 'pausado' ? t.status.paused : state.phase === 'error' ? t.status.error : t.status.disconnected;
  const currentSection = sections.find(([, id]) => id === tab);

  const preview = (
    <div className={`preview-stage ${floating ? 'is-floating' : ''}`} ref={stage}>
      <div
        className={`phone-shell ${isDisplaying ? 'is-live' : ''} ${dropActive && connected ? 'drop-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{width: phoneSize.width + 12, height: phoneSize.height + 12, '--phone-radius': `${Math.round(Math.min(phoneSize.width, phoneSize.height) * .125)}px`}}
      >
        <canvas ref={canvas} tabIndex={0} onPointerEnter={event => { canvasRectRef.current = event.currentTarget.getBoundingClientRect(); trackPointer(event); }} onPointerMove={trackPointer} onPointerLeave={hidePointer} onPointerCancel={hidePointer} onLostPointerCapture={hidePointer} aria-label={t.preview.canvasAria} style={{width: phoneSize.width, height: phoneSize.height}}/>
        <span ref={pointerNode} className="phone-pointer-layer" aria-hidden="true" style={{opacity: 0, '--pointer-color': pointer.color, '--pointer-scale': pointer.size / 100}}><span className={`phone-pointer pointer-${pointer.shape}`}/></span>
        {dropActive && connected && <div className="phone-drop-overlay" aria-hidden="true"><span>{t.preview?.dropHint || 'Drop image or text to copy to iPhone'}</span></div>}
        {cameraLive && <div className="camera-live-overlay-top"><span className="camera-dot"/><span>{t.preview.liveCamera}</span></div>}
        {connected && state.displayMode === 'aod' && isDisplaying && (
          <div className="aod-live-badge" title={t.preview.aodTitle}>
            <Moon size={12}/><span>{t.preview.aodActive}</span>
            <button type="button" className="aod-badge-btn" onClick={wakePhone} title={t.preview.wakeTitle}>{t.preview.wakeBtn}</button>
          </div>
        )}
        {recording && <RecordingBadge duration={recordingDuration} bytes={recordingBytes} onStop={toggleRecording} className="phone-overlay-recording" t={t}/>}
        {!isDisplaying && (
          <div className="phone-placeholder">
            <div className="placeholder-symbol">{connected && mediaPaused ? <CameraOff size={26}/> : connected && state.displayMode === 'aod' ? <Moon size={26}/> : connected || state.phase === 'preparando' ? <LoaderCircle size={26} className="spin"/> : <Cable size={28}/>}</div>
            <strong>{state.phase === 'pausado' ? t.preview.placeholderTitle.paused : state.phase === 'error' ? t.preview.placeholderTitle.error : state.phase === 'preparando' ? t.preview.placeholderTitle.preparing : connected && mediaPaused ? t.preview.placeholderTitle.mediaPaused : connected && state.displayMode === 'aod' ? t.preview.placeholderTitle.aod : connected ? t.preview.placeholderTitle.loading : t.preview.placeholderTitle.disconnected}</strong>
            <span>{state.phase === 'pausado' ? t.preview.placeholderSub.paused : connected && mediaPaused ? t.preview.placeholderSub.mediaPaused : connected && state.displayMode === 'aod' ? t.preview.placeholderSub.aod : connected ? translateBackendText(videoStatus, lang) : state.phase === 'preparando' ? t.preview.placeholderSub.preparing : t.preview.placeholderSub.disconnected}</span>
            {['error', 'pausado'].includes(state.phase) && <button className="small-button" onClick={() => native('retry')}>{t.preview.retry}</button>}
            {connected && mediaPaused && <div className="placeholder-actions"><button className="small-button" disabled={mediaBusy} onClick={() => toggleMediaPause(false, {exitApp: true})}>{t.preview.exitCameraResume}</button><button className="small-button" disabled={mediaBusy} onClick={() => toggleMediaPause(false)}>{t.preview.resumeScreen}</button></div>}
            {connected && !mediaPaused && state.displayMode === 'aod' && <button className="small-button" onClick={wakePhone}>{t.preview.wakeIphone}</button>}
            <span className="placeholder-line"/>
          </div>
        )}
      </div>
      <div className={`controls-panel ${controlsVisible ? 'expanded' : 'collapsed'}`} style={{height: phoneSize.height + 12}}>
        <button className="controls-tab" aria-label={controlsVisible ? t.controls.collapse : t.controls.expand} aria-expanded={controlsVisible} title={controlsVisible ? t.controls.collapse : t.controls.expand} onClick={toggleControls}>{controlsVisible ? <ChevronLeft size={13}/> : <ChevronRight size={13}/>}</button>
        <div className="controls-drawer" inert={!controlsVisible} aria-hidden={!controlsVisible}>
          <div className="phone-controls" role="toolbar" aria-label={t.controls.toolbarAria} aria-orientation="vertical">
            {floating && connected && battery && battery.capacity !== null && (
              <>
                <div className={`controls-battery ${battery.charging ? 'is-charging' : ''} ${battery.capacity <= 20 ? 'is-low' : ''}`} title={t.preview.batteryTitle(battery.capacity, battery.charging)} aria-label={t.preview.batteryAria(battery.capacity, battery.charging)}>
                  {React.createElement(resolveBatteryIcon(BATTERY_ICONS, battery.capacity, battery.charging), {size: 13})}
                  <span>{battery.capacity}%</span>
                </div>
                <span className="control-separator"/>
              </>
            )}
            <IconButton icon={X} label={t.controls.quit} onClick={closeApp}/>
            <IconButton icon={ArrowLeft} label={t.controls.swipeLeft} disabled={!connected} onClick={() => input.current?.swipe('left')}/>
            <IconButton icon={ArrowRight} label={t.controls.swipeRight} disabled={!connected} onClick={() => input.current?.swipe('right')}/>
            <IconButton icon={Home} label={t.controls.home} disabled={!connected} onClick={() => button('home')}/>
            <IconButton icon={Layers} label={t.controls.appSwitcher} disabled={!connected} onClick={appSwitcher}/>
            <IconButton icon={SlidersHorizontal} label={t.controls.controlCenter} disabled={!connected} onClick={controlCenterSwipe}/>
            <IconButton icon={Bell} label={t.controls.notifications} disabled={!connected} onClick={notificationsSwipe}/>
            <span className="control-separator"/>
            <IconButton icon={RotateCw} label={t.controls.rotate} disabled={!connected || rotating} onClick={rotatePhone}/>
            {bridge && <IconButton icon={Maximize2} label={t.controls.fitHeight} onClick={() => native('fitHeight')}/>}
            <IconButton icon={floating ? Monitor : ExternalLink} label={floating ? t.controls.openStudio : t.controls.phoneOnlyView} onClick={() => switchMode(floating ? 'studio' : 'phone')}/>
            <IconButton icon={Languages} label={t.controls.switchLang} active={lang !== 'en'} onClick={toggleLang}/>
            {bridge && <IconButton icon={Pin} label={t.controls.alwaysOnTop} active={state.alwaysOnTop} onClick={() => native('pin', !state.alwaysOnTop)}/>}
            <span className="control-separator"/>
            <IconButton icon={audioEnabled ? Volume2 : VolumeX} label={audioEnabled ? t.controls.mutePc : t.controls.unmutePc} active={audioEnabled} onClick={toggleAudio}/>
            <IconButton icon={VolumeX} label={t.controls.toggleIphoneMute} disabled={!connected} onClick={() => phoneAudioButton('mute')}/>
            <IconButton icon={Camera} label={t.controls.screenshot} disabled={!isDisplaying} onClick={capture}/>
            <RecordButton recording={recording} recordingDuration={recordingDuration} recordingBytes={recordingBytes} disabled={!isDisplaying && !recording} onClick={toggleRecording} t={t}/>
            <IconButton icon={mediaPaused ? Play : CameraOff} label={mediaPaused ? t.controls.resumeIphoneScreen : t.controls.releaseCamMic} active={mediaPaused} disabled={!connected || mediaBusy} onClick={() => toggleMediaPause(!mediaPaused)}/>
            <span className="control-separator"/>
            <IconButton icon={state.displayMode === 'aod' ? Sun : Moon} label={state.displayMode === 'aod' ? t.controls.aodCurrent : t.controls.aodEnable} active={state.displayMode === 'aod'} disabled={!connected} onClick={() => setDisplayMode(state.displayMode === 'aod' ? 'dual' : 'aod')}/>
            <IconButton icon={Sun} label={t.controls.wakeShortcut} disabled={!connected} onClick={wakePhone}/>
            <IconButton icon={LockKeyhole} label={t.controls.lockShortcut} disabled={!connected} onClick={() => button('lock')}/>
            <IconButton icon={LogOut} label={t.controls.safeDisconnect} disabled={!connected} onClick={disconnectSession}/>
            {bridge && <IconButton icon={Minus} label={t.controls.minimize} onClick={() => native('minimize')}/>}
            {floating && bridge && <span className="control-drag" title={t.controls.dragWindow}><GripHorizontal size={16}/></span>}
          </div>
        </div>
      </div>
    </div>
  );

  if (floating) return <FloatingShell audioStatus={audioStatus} preview={preview} bridge={bridge} notice={notice} lang={lang} toggleLang={toggleLang} t={t}/>;

  const inspectorProps = {
    ...sync,
    tab, state, connected, live, bridge, native, switchMode, disconnectSession,
    videoMode, videoQuality, setVideoQuality, forceSoftware, setForceSoftware,
    recording, recordingFormat, setRecordingFormat, recordingQuality, setRecordingQuality, recordingIncludeAudio, setRecordingIncludeAudio,
    loadingApps, loadDeviceApps, appSwitcher, controlCenterSwipe, notificationsSwipe, setDisplayMode, wakePhone, rotatePhone, rotating,
    button, capture, audioEnabled, audioStatus, volume, setVolume, toggleAudio, phoneAudioButton,
    platformLabel, clipboardBusy, shareClipboard, text, setText, sendText,
    setTheme, sensitivity, setSensitivity, pointer, updatePointer, exportDiagnostics,
    lang, setLang, t,
  };

  const modals = <>
    {state.phase === 'seleccion' && (
      <div className="modal-backdrop"><section className="device-picker">
        <h2>{t.studio.selectIphone}</h2>
        {state.devices.map(device => (
          <button key={device.udid} onClick={() => native('device', device.udid)}>
            <Smartphone size={18}/>
            <span><strong>{device.name}</strong>{(device.model || device.version) && <small>{[device.model, device.version ? `iOS ${device.version}` : ''].filter(Boolean).join(' · ')}</small>}</span>
            <ChevronRight size={15}/>
          </button>
        ))}
      </section></div>
    )}
    {showApps && <AppsModal apps={deviceApps} loadingApps={loadingApps} launchingApp={launchingApp} onLaunch={launchDeviceApp} onRefresh={loadDeviceApps} onClose={() => setShowApps(false)} t={t}/>}
  </>;

  return <StudioShell
    state={state} connected={connected} live={live} cameraLive={cameraLive} isDisplaying={isDisplaying}
    statusLabel={statusLabel} battery={battery} batteryIcons={BATTERY_ICONS} sections={sections}
    tab={tab} setTab={setTab} currentSection={currentSection} switchMode={switchMode}
    recording={recording} recordingDuration={recordingDuration} recordingBytes={recordingBytes} toggleRecording={toggleRecording}
    lang={lang} toggleLang={toggleLang} bridge={bridge} native={native} videoMode={videoMode}
    videoQuality={videoQuality} frames={frames} dimensions={dimensions} keyboard={keyboard}
    audioEnabled={audioEnabled} preview={preview} inspectorProps={inspectorProps} modals={modals} notice={notice} t={t}
  />;
}
