import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const enJsonRaw = await fs.readFile(new URL('../frontend/src/locales/en.json', import.meta.url), 'utf8');
const esJsonRaw = await fs.readFile(new URL('../frontend/src/locales/es.json', import.meta.url), 'utf8');
const enLocale = JSON.parse(enJsonRaw);
const esLocale = JSON.parse(esJsonRaw);

const rawSource = await fs.readFile(new URL('../frontend/src/i18n.js', import.meta.url), 'utf8');
const testableSource = rawSource
  .replace(
    "import {useState, useEffect} from 'react';",
    'function useState(init) { return [typeof init === "function" ? init() : init, () => {}]; }\nfunction useEffect() {}',
  )
  .replace("import enLocale from './locales/en.json';", `const enLocale = ${enJsonRaw};`)
  .replace("import esLocale from './locales/es.json';", `const esLocale = ${esJsonRaw};`);

const {STRINGS, translateBackendText} = await import(
  `data:text/javascript;base64,${Buffer.from(testableSource, 'utf8').toString('base64')}`
);

function collectShape(obj, prefix = '') {
  const entries = [];
  for (const [key, val] of Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      entries.push(...collectShape(val, path));
    } else {
      entries.push([path, Array.isArray(val) ? 'array' : typeof val]);
    }
  }
  return entries;
}

test('locales/en.json and locales/es.json have identical keys and value shapes', () => {
  assert.deepEqual(collectShape(enLocale), collectShape(esLocale));
});

test('STRINGS.en and STRINGS.es have identical keys and value shapes', () => {
  assert.deepEqual(collectShape(STRINGS.en), collectShape(STRINGS.es));
});

test('STRINGS template wrappers produce expected interpolated strings in EN and ES', () => {
  assert.equal(STRINGS.en.status.connectedViaUsb('iPhone 16'), 'iPhone 16 connected via USB');
  assert.equal(STRINGS.es.status.connectedViaUsb('iPhone 16'), 'iPhone 16 conectado por USB');
  assert.equal(STRINGS.en.status.pcAudio(true), 'PC Audio on');
  assert.equal(STRINGS.en.status.pcAudio(false), 'PC Audio off');
  assert.equal(STRINGS.es.status.pcAudio(true), 'Audio PC activado');
  assert.equal(STRINGS.es.status.pcAudio(false), 'Audio PC desactivado');
  assert.equal(STRINGS.en.preview.batteryTitle(85, true), 'Battery: 85% (Charging)');
  assert.equal(STRINGS.en.preview.batteryTitle(85, false), 'Battery: 85%');
  assert.equal(STRINGS.es.preview.batteryTitle(85, true), 'Batería: 85% (Cargando)');
  assert.equal(STRINGS.en.preview.batteryAria(40, true), 'Battery 40%, charging');
  assert.equal(STRINGS.es.preview.batteryAria(40, false), 'Batería 40%');
  assert.equal(STRINGS.en.inspector.switchDeviceAria('Work iPhone'), 'Switch to Work iPhone');
  assert.equal(STRINGS.es.inspector.switchDeviceAria('Work iPhone'), 'Cambiar a Work iPhone');
  assert.equal(STRINGS.en.inspector.audioOutputNote('Linux'), 'Uses the default audio output device on Linux.');
  assert.equal(STRINGS.es.inspector.downloadVersion('1.4.0'), 'Descargar 1.4.0');
  assert.equal(STRINGS.en.appsModal.title(12), 'Applications (12)');
  assert.equal(STRINGS.es.notices.accessibilityUpdated('Reducir movimiento', true), 'Reducir movimiento: activado en el iPhone.');
});

test('translateBackendText translates runtime messages bidirectionally between EN and ES', () => {
  assert.equal(translateBackendText('Connect your iPhone via USB', 'es'), 'Conecta tu iPhone por USB');
  assert.equal(translateBackendText('Conecta tu iPhone por USB', 'en'), 'Connect your iPhone via USB');
  assert.equal(translateBackendText('You are on version 1.3.0.', 'es'), 'Tienes la versión 1.3.0.');
  assert.equal(translateBackendText('Tienes la versión 1.3.0.', 'en'), 'You are on version 1.3.0.');
  assert.equal(translateBackendText('MirrOS 1.4.0 is available.', 'es'), 'MirrOS 1.4.0 está disponible.');
  assert.equal(translateBackendText('Download checksum verification failed. Update will not be installed.', 'es'), 'La verificación de la descarga falló. No se instalará.');
  assert.equal(translateBackendText('Copied to PC clipboard.', 'es'), 'Copiado del iPhone al portapapeles del PC.');
  assert.equal(translateBackendText('Unlock your iPhone and tap "Trust" to continue.', 'es'), 'Desbloquea el iPhone y pulsa «Confiar» en la pantalla del teléfono.');
});
