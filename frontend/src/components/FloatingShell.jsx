import React from 'react';
import {ResizeHandles} from './Controls.jsx';
import {SUPPORTED_LANGS} from '../i18n.js';

const LANG_OPTIONS = Array.isArray(SUPPORTED_LANGS) && SUPPORTED_LANGS.length
  ? SUPPORTED_LANGS
  : [['en', 'EN', 'English'], ['es', 'ES', 'Español']];

export function FloatingShell({audioStatus, preview, bridge, notice, lang = 'en', toggleLang, t}) {
  const currentLang = LANG_OPTIONS.find(([code]) => code === lang) || [lang, String(lang || 'en').toUpperCase(), lang];
  return (
    <div className="floating-app" data-audio-status={audioStatus}>
      {preview}
      {toggleLang && (
        <button
          type="button"
          className="floating-lang-badge"
          title={`${t?.controls?.switchLang || 'Switch language'} (${currentLang[2]})`}
          aria-label={`${t?.controls?.switchLang || 'Switch language'}: ${currentLang[2]}`}
          onClick={toggleLang}
        >
          {currentLang[1]}
        </button>
      )}
      {bridge && <ResizeHandles t={t}/>}
      {notice && <div className="floating-notice" role="status">{notice}</div>}
    </div>
  );
}
