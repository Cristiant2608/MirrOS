import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const LANG_CODES = ['en', 'es', 'pt', 'fr', 'de'];

const localeRaw = {};
const locales = {};
for (const code of LANG_CODES) {
  localeRaw[code] = await fs.readFile(new URL(`../frontend/src/locales/${code}.json`, import.meta.url), 'utf8');
  locales[code] = JSON.parse(localeRaw[code]);
}

const rawSource = await fs.readFile(new URL('../frontend/src/i18n.js', import.meta.url), 'utf8');
let testableSource = rawSource.replace(
  "import {useState, useEffect} from 'react';",
  'let __hookState;\nfunction useState(init) { if (__hookState === undefined) __hookState = typeof init === "function" ? init() : init; return [__hookState, next => { __hookState = typeof next === "function" ? next(__hookState) : next; }]; }\nfunction useEffect() {}\nexport function __resetHookState(val) { __hookState = val; }\nexport function __getHookState() { return __hookState; }',
);
for (const code of LANG_CODES) {
  testableSource = testableSource.replace(
    `import ${code}Locale from './locales/${code}.json';`,
    `const ${code}Locale = ${localeRaw[code]};`,
  );
}

const {
  SUPPORTED_LANGS,
  STRINGS,
  translateBackendText,
  useLanguage,
  __resetHookState,
  __getHookState,
} = await import(
  `data:text/javascript;base64,${Buffer.from(testableSource, 'utf8').toString('base64')}`
);

function collectShape(obj, prefix = '') {
  const entries = [];
  for (const [key, val] of Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      entries.push(...collectShape(val, path));
    } else if (Array.isArray(val)) {
      entries.push([path, `array(${val.length})`]);
    } else {
      entries.push([path, typeof val]);
    }
  }
  return entries;
}

function collectPlaceholders(obj, prefix = '') {
  const map = new Map();
  for (const [key, val] of Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const [k, v] of collectPlaceholders(val, path)) {
        map.set(k, v);
      }
    } else if (typeof val === 'string') {
      const vars = [...val.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
      if (vars.length > 0) {
        map.set(path, vars);
      }
    }
  }
  return map;
}

test('all 5 locale JSON files have identical keys, shapes, and internal option codes', () => {
  const enShape = collectShape(locales.en);
  for (const code of LANG_CODES.slice(1)) {
    assert.deepEqual(
      collectShape(locales[code]),
      enShape,
      `locales/${code}.json shape does not match locales/en.json`,
    );
    assert.deepEqual(
      locales[code].inspector.themes.map(([k]) => k),
      locales.en.inspector.themes.map(([k]) => k),
      `locales/${code}.json theme keys mismatch`,
    );
    assert.deepEqual(
      locales[code].inspector.sizes.map(([k]) => k),
      locales.en.inspector.sizes.map(([k]) => k),
      `locales/${code}.json size keys mismatch`,
    );
    assert.deepEqual(
      locales[code].inspector.pointerShapes.map(([k]) => k),
      locales.en.inspector.pointerShapes.map(([k]) => k),
      `locales/${code}.json pointerShape keys mismatch`,
    );
  }
});

test('STRINGS.{en,es,pt,fr,de} have identical keys and value shapes', () => {
  const enShape = collectShape(STRINGS.en);
  for (const code of LANG_CODES.slice(1)) {
    assert.deepEqual(
      collectShape(STRINGS[code]),
      enShape,
      `STRINGS.${code} shape does not match STRINGS.en`,
    );
  }
});

test('every {placeholder} in en.json exists identically in es, pt, fr, and de', () => {
  const enPlaceholders = collectPlaceholders(locales.en);
  assert.ok(enPlaceholders.size > 0, 'Expected placeholder strings in en.json');
  for (const code of LANG_CODES.slice(1)) {
    const otherPlaceholders = collectPlaceholders(locales[code]);
    assert.deepEqual(
      [...otherPlaceholders.entries()],
      [...enPlaceholders.entries()],
      `Placeholder mismatch in locales/${code}.json`,
    );
  }
});

test('required new UX keys exist in all 5 locales', () => {
  for (const code of LANG_CODES) {
    const loc = locales[code];
    assert.equal(typeof loc.notices.dropImageSent, 'string');
    assert.equal(typeof loc.notices.dropTextSent, 'string');
    assert.equal(typeof loc.notices.dropUnsupported, 'string');
    assert.equal(typeof loc.notices.dimShortcutsSaved, 'string');
    assert.equal(typeof loc.inspector.dimShortcutLabel, 'string');
    assert.equal(typeof loc.inspector.restoreShortcutLabel, 'string');
    assert.equal(typeof loc.inspector.saveShortcutsBtn, 'string');
    assert.equal(typeof loc.preview.dropHint, 'string');
    assert.ok(
      loc.inspector.shortcutsHelpRows.some(([, keys]) => keys === 'Ctrl + Shift + D'),
      `Missing Ctrl + Shift + D shortcut row in locales/${code}.json`,
    );
  }
});

test('SUPPORTED_LANGS exposes all 5 codes and useLanguage cycles en -> es -> pt -> fr -> de -> en', () => {
  assert.deepEqual(
    SUPPORTED_LANGS,
    [
      ['en', 'EN', 'English'],
      ['es', 'ES', 'Español'],
      ['pt', 'PT', 'Português'],
      ['fr', 'FR', 'Français'],
      ['de', 'DE', 'Deutsch'],
    ],
  );

  __resetHookState('en');
  for (const expectedNext of ['es', 'pt', 'fr', 'de', 'en']) {
    const {toggleLang} = useLanguage();
    toggleLang();
    assert.equal(__getHookState(), expectedNext);
  }

  for (const code of LANG_CODES) {
    const {setLang} = useLanguage();
    setLang(code);
    assert.equal(__getHookState(), code);
  }
  const {setLang} = useLanguage();
  setLang('invalid');
  assert.equal(__getHookState(), 'en');
});

test('STRINGS template wrappers produce expected interpolated strings across locales', () => {
  assert.equal(STRINGS.en.status.connectedViaUsb('iPhone 16'), 'iPhone 16 connected via USB');
  assert.equal(STRINGS.es.status.connectedViaUsb('iPhone 16'), 'iPhone 16 conectado por USB');
  assert.equal(STRINGS.pt.status.connectedViaUsb('iPhone 16'), 'iPhone 16 conectado via USB');
  assert.equal(STRINGS.fr.status.connectedViaUsb('iPhone 16'), 'iPhone 16 connecté par USB');
  assert.equal(STRINGS.de.status.connectedViaUsb('iPhone 16'), 'iPhone 16 per USB verbunden');
  assert.equal(STRINGS.en.status.pcAudio(true), 'PC Audio on');
  assert.equal(STRINGS.en.status.pcAudio(false), 'PC Audio off');
  assert.equal(STRINGS.es.status.pcAudio(true), 'Audio PC activado');
  assert.equal(STRINGS.es.status.pcAudio(false), 'Audio PC desactivado');
  assert.equal(STRINGS.en.preview.batteryTitle(85, true), 'Battery: 85% (Charging)');
  assert.equal(STRINGS.en.preview.batteryTitle(85, false), 'Battery: 85%');
  assert.equal(STRINGS.es.preview.batteryTitle(85, true), 'Batería: 85% (Cargando)');
  assert.equal(STRINGS.pt.preview.batteryTitle(85, true), 'Bateria: 85% (Carregando)');
  assert.equal(STRINGS.fr.preview.batteryTitle(85, true), 'Batterie : 85% (En charge)');
  assert.equal(STRINGS.de.preview.batteryTitle(85, true), 'Akku: 85% (Wird geladen)');
  assert.equal(STRINGS.en.preview.batteryAria(40, true), 'Battery 40%, charging');
  assert.equal(STRINGS.es.preview.batteryAria(40, false), 'Batería 40%');
  assert.equal(STRINGS.en.inspector.switchDeviceAria('Work iPhone'), 'Switch to Work iPhone');
  assert.equal(STRINGS.es.inspector.switchDeviceAria('Work iPhone'), 'Cambiar a Work iPhone');
  assert.equal(STRINGS.en.inspector.audioOutputNote('Linux'), 'Uses the default audio output device on Linux.');
  assert.equal(STRINGS.es.inspector.downloadVersion('1.4.0'), 'Descargar 1.4.0');
  assert.equal(STRINGS.en.appsModal.title(12), 'Applications (12)');
  assert.equal(STRINGS.es.notices.accessibilityUpdated('Reducir movimiento', true), 'Reducir movimiento: activado en el iPhone.');
});

test('translateBackendText translates runtime and audio messages bidirectionally between EN and ES', () => {
  assert.equal(translateBackendText('Connect your iPhone via USB', 'es'), 'Conecta tu iPhone por USB');
  assert.equal(translateBackendText('Conecta tu iPhone por USB', 'en'), 'Connect your iPhone via USB');
  assert.equal(translateBackendText('You are on version 1.3.0.', 'es'), 'Tienes la versión 1.3.0.');
  assert.equal(translateBackendText('Tienes la versión 1.3.0.', 'en'), 'You are on version 1.3.0.');
  assert.equal(translateBackendText('MirrOS 1.4.0 is available.', 'es'), 'MirrOS 1.4.0 está disponible.');
  assert.equal(translateBackendText('Download checksum verification failed. Update will not be installed.', 'es'), 'La verificación de la descarga falló. No se instalará.');
  assert.equal(translateBackendText('Copied to PC clipboard.', 'es'), 'Copiado del iPhone al portapapeles del PC.');
  assert.equal(translateBackendText('Unlock your iPhone and tap "Trust" to continue.', 'es'), 'Desbloquea el iPhone y pulsa «Confiar» en la pantalla del teléfono.');

  const audioPairs = [
    ['Sonando en este PC', 'Playing on this PC'],
    ['Estabilizando audio…', 'Stabilizing audio…'],
    ['Esperando sonido del iPhone', 'Waiting for iPhone audio'],
    ['Reconectando audio…', 'Reconnecting audio…'],
    ['No se pudo iniciar el audio del iPhone.', 'Could not start iPhone audio.'],
    ['La transmisión de audio se interrumpió.', 'Audio stream was interrupted.'],
    ['No se pudo reproducir el audio.', 'Could not play audio.'],
  ];
  for (const [esMsg, enMsg] of audioPairs) {
    assert.equal(translateBackendText(enMsg, 'es'), esMsg);
    assert.equal(translateBackendText(esMsg, 'en'), enMsg);
    assert.equal(translateBackendText(enMsg, 'pt'), enMsg);
    assert.equal(translateBackendText(esMsg, 'fr'), enMsg);
    assert.equal(translateBackendText(enMsg, 'de'), enMsg);
  }
});
