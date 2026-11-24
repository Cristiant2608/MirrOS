import React from 'react';
import {
  Smartphone, Minus, X, Maximize2, Volume2, VolumeX, Mouse, Keyboard, Scan,
  ExternalLink, ChevronRight,
} from 'lucide-react';
import {IconButton, Logo, RecordButton, RecordingBadge} from './Controls.jsx';
import {FrameRate} from './FrameRate.jsx';
import {InspectorContent} from './InspectorContent.jsx';
import {resolveBatteryIcon} from '../battery.mjs';
import {translateBackendText} from '../i18n.js';

export function StudioShell({
  state, connected, live, cameraLive, isDisplaying, statusLabel,
  battery, batteryIcons, sections, tab, setTab, currentSection,
  switchMode, recording, recordingDuration, toggleRecording,
  lang, toggleLang, bridge, native, videoMode, videoQuality,
  frames, dimensions, keyboard, audioEnabled, preview,
  inspectorProps, modals, notice, t,
}) {
  const SectionIcon = currentSection[0];

  function toggleFullscreen() {
    if (bridge) native('fullscreen');
    else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  return (
    <div className="studio">
      <aside className="sidebar">
        <div className="sidebar-brand"><Logo/></div>
        <div className="sidebar-label">{t.studio.deviceHeader}</div>
        <div className={`sidebar-device ${connected ? 'connected' : ''}`}>
          <div className="device-avatar"><Smartphone size={20}/></div>
          <div>
            <strong>{state.device?.name || 'iPhone'}</strong>
            {state.device?.model && <small className="device-model-label">{state.device.model}</small>}
            <small><i/>{statusLabel}{connected && battery && battery.capacity !== null ? ` · ${battery.capacity}%` : ''}</small>
          </div>
        </div>
        <div className="sidebar-label">{t.studio.controlsHeader}</div>
        <nav aria-label={t.studio.sectionsAria}>
          {sections.map(([Icon, id, label]) => (
            <button
              key={id}
              className={tab === id ? 'selected' : ''}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={17}/>
              <span>{label}</span>
              {tab === id && <span className="nav-dot"/>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="floating-launch" onClick={() => switchMode('phone')}>
            <ExternalLink size={16}/>
            <span>{t.studio.phoneOnlyBtn}</span>
          </button>
          <div className="sidebar-app-info">
            <span>Mirros</span>
            <span>{state.version?.split('.').slice(0, 2).join('.') || '—'} · USB</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="toolbar">
          <div className="toolbar-title">
            <strong>{state.device?.name || 'iPhone'}</strong>
            {state.device?.model && <span className="device-model-badge">{state.device.model}</span>}
            <ChevronRight size={14}/>
            <span>{currentSection[2]}</span>
          </div>
          {recording && <RecordingBadge duration={recordingDuration} onStop={toggleRecording} t={t}/>}
          {connected && battery && battery.capacity !== null && (
            <div
              className={`battery-pill ${battery.charging ? 'is-charging' : ''} ${battery.capacity <= 20 ? 'is-low' : ''}`}
              title={t.preview.batteryTitle(battery.capacity, battery.charging)}
              aria-label={t.preview.batteryAria(battery.capacity, battery.charging)}
            >
              {React.createElement(resolveBatteryIcon(batteryIcons, battery.capacity, battery.charging), {size: 15})}
              <span>{battery.capacity}%</span>
            </div>
          )}
          <div className="window-actions">
            <button
              type="button"
              className="small-button"
              style={{padding: '4px 9px', fontSize: 11, fontWeight: 600, marginRight: 4}}
              title={t.controls.switchLang}
              onClick={toggleLang}
            >
              {lang === 'en' ? '🇺🇸 EN' : '🇪🇸 ES'}
            </button>
            <RecordButton recording={recording} disabled={!isDisplaying && !recording} onClick={toggleRecording} t={t}/>
            <IconButton icon={Maximize2} label={t.controls.fullscreen} onClick={toggleFullscreen}/>
            <IconButton icon={Minus} label={t.controls.minimize} onClick={() => native('minimize')}/>
            <IconButton icon={Maximize2} label={t.controls.maximize} onClick={() => native('maximize')}/>
            <IconButton icon={X} label={t.controls.quit} className="close-button" onClick={() => native('close')}/>
          </div>
        </header>
        <div className="workspace-content">
          <section className="viewer" aria-label={t.studio.viewerAria}>
            <div className="viewer-heading">
              <span className={`connection-pill ${connected ? 'connected' : ''}`}>
                <i/>{connected ? t.status.usbConnected : statusLabel}
              </span>
              <span className="stream-info">
                {live ? (
                  <>
                    {videoMode && (
                      <span
                        className={`engine-badge ${videoMode}`}
                        title={videoMode === 'software' ? t.studio.softwareDecodeTitle : t.studio.hevcDecodeTitle}
                      >
                        {videoMode === 'software' ? t.studio.compatibleBadge(t.studio.qualityNames[videoQuality] || 'Soft') : 'HEVC'}
                      </span>
                    )}
                    <FrameRate frames={frames}/> · {dimensions.width} × {dimensions.height}
                  </>
                ) : cameraLive ? (
                  <>
                    <span className="engine-badge detail" title={t.studio.cameraBadgeTitle}>{t.studio.cameraBadge}</span> · {t.studio.dvtLive}
                  </>
                ) : t.studio.liveView}
              </span>
            </div>
            {preview}
            <div className="viewer-hints">
              <span><Mouse size={13}/>{t.studio.hintClickDrag}</span>
              <span><Scan size={13}/>{t.studio.hintScroll}</span>
              <span><Keyboard size={13}/>{keyboard ? t.studio.hintKeyboardActive : t.studio.hintClickToType}</span>
            </div>
          </section>
          <aside className="inspector" aria-label={currentSection[2]}>
            <div className="inspector-heading">
              <span className="section-symbol"><SectionIcon size={20}/></span>
              <div>
                <h1>{currentSection[2]}</h1>
                <p>{t.sections[tab][1]}</p>
              </div>
            </div>
            <InspectorContent {...inspectorProps}/>
          </aside>
        </div>
        <footer className="statusbar">
          <span className={state.phase === 'error' ? 'error-text' : ''}>
            <i className={connected ? 'connected' : ''}/>
            {connected ? t.status.connectedViaUsb(state.device?.name || 'iPhone') : translateBackendText(state.message, lang)}
          </span>
          <span>
            {audioEnabled ? <Volume2 size={12}/> : <VolumeX size={12}/>}
            {t.status.pcAudio(audioEnabled)}
          </span>
        </footer>
      </div>
      {modals}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}
