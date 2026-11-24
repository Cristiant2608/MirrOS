import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('useRecording.js and useDeviceSync.js exist, are imported by App.jsx, and keep App.jsx slim', async () => {
  const [appSrc, recordingSrc, deviceSyncSrc] = await Promise.all([
    fs.readFile(new URL('../frontend/src/App.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/hooks/useRecording.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/hooks/useDeviceSync.js', import.meta.url), 'utf8'),
  ]);

  assert.match(recordingSrc, /export function useRecording\b/);
  assert.ok(recordingSrc.includes('recordingDuration') && recordingSrc.includes('toggleRecording') && recordingSrc.includes('recorderRef'));

  assert.match(deviceSyncSrc, /export function useDeviceSync\b/);
  for (const token of [
    '/battery', '/media-state', '/style', '/accessibility', '/screen-dim', '/camera-frame',
    'toggleMediaPause', 'changeIosStyle', 'toggleAccessibility',
    'triggerScreenDim', 'updateDimShortcuts', 'cameraLive', 'cameraCanvas',
  ]) {
    assert.ok(deviceSyncSrc.includes(token), `useDeviceSync.js must handle ${token}`);
  }

  assert.match(appSrc, /import\s+\{useRecording\}\s+from\s+'\.\/hooks\/useRecording\.js'/);
  assert.match(appSrc, /import\s+\{useDeviceSync\}\s+from\s+'\.\/hooks\/useDeviceSync\.js'/);

  const lineCount = appSrc.split('\n').length;
  assert.ok(lineCount < 500, `App.jsx should be slim (< 500 lines), got ${lineCount}`);
  assert.ok(appSrc.includes('pointerNode') && !appSrc.includes('setPointerPosition'), 'App.jsx must preserve ref+rAF pointer tracking');
  assert.ok(appSrc.includes('controls-battery') && !appSrc.includes('floating-battery-badge'), 'App.jsx must preserve .controls-battery');
});

test('Drag & Drop clipboard handlers and Ctrl+Shift+D OLED dim shortcut are wired in App.jsx and style.css', async () => {
  const [appSrc, cssSrc] = await Promise.all([
    fs.readFile(new URL('../frontend/src/App.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/style.css', import.meta.url), 'utf8'),
  ]);

  assert.ok(appSrc.includes('onDragOver='), 'App.jsx must wire onDragOver on .phone-shell');
  assert.ok(appSrc.includes('onDragLeave='), 'App.jsx must wire onDragLeave on .phone-shell');
  assert.ok(appSrc.includes('onDrop='), 'App.jsx must wire onDrop on .phone-shell');
  assert.ok(appSrc.includes('drop-active'), 'App.jsx must toggle .drop-active class during drag');
  assert.ok(appSrc.includes("'image/png'") && appSrc.includes("'image/jpeg'") && appSrc.includes("'image/webp'"), 'App.jsx must accept PNG, JPEG, and WebP drops');
  assert.ok(appSrc.includes("'text/plain'") && appSrc.includes("'text/uri-list'"), 'App.jsx must accept text/plain and text/uri-list drops');
  assert.ok(appSrc.includes('dropImageSent') && appSrc.includes('dropTextSent') && appSrc.includes('dropUnsupported'), 'App.jsx must use drag-and-drop notice keys');
  assert.ok(cssSrc.includes('.phone-shell.drop-active'), 'style.css must style .phone-shell.drop-active');

  assert.ok(appSrc.includes("event.code === 'KeyD'") || appSrc.includes("key === 'd'"), 'App.jsx must listen for Ctrl+Shift+D');
  assert.ok(appSrc.includes("triggerScreenDim("), 'App.jsx Ctrl+Shift+D must invoke triggerScreenDim');
});

test('InspectorContent, StudioShell, and FloatingShell wire editable dim shortcut names and SUPPORTED_LANGS', async () => {
  const [inspectorSrc, studioSrc, floatingSrc, cssSrc] = await Promise.all([
    fs.readFile(new URL('../frontend/src/components/InspectorContent.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/components/StudioShell.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/components/FloatingShell.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/style.css', import.meta.url), 'utf8'),
  ]);

  assert.match(inspectorSrc, /export const InspectorContent = memo\(/);
  assert.ok(inspectorSrc.includes('dimShortcutName') && inspectorSrc.includes('restoreShortcutName'), 'InspectorContent must expose editable dimShortcutName and restoreShortcutName inputs');
  assert.ok(inspectorSrc.includes('updateDimShortcuts'), 'InspectorContent must call updateDimShortcuts on save');
  assert.ok(inspectorSrc.includes('SUPPORTED_LANGS'), 'InspectorContent must import SUPPORTED_LANGS');
  assert.ok(inspectorSrc.includes('lang-grid'), 'InspectorContent must render multi-language selector');

  assert.ok(studioSrc.includes('SUPPORTED_LANGS'), 'StudioShell must import SUPPORTED_LANGS');
  assert.ok(floatingSrc.includes('SUPPORTED_LANGS'), 'FloatingShell must import SUPPORTED_LANGS');
  assert.ok(floatingSrc.includes('toggleLang'), 'FloatingShell must support cycling languages via toggleLang');

  assert.ok(cssSrc.includes('.lang-grid') && cssSrc.includes('.dim-shortcuts-form'), 'style.css must style .lang-grid and .dim-shortcuts-form');
});

test('audio.js uses normalized English base status and error strings', async () => {
  const audioSrc = await fs.readFile(new URL('../frontend/src/audio.js', import.meta.url), 'utf8');

  for (const english of [
    'Playing on this PC',
    'Stabilizing audio…',
    'Waiting for iPhone audio',
    'Reconnecting audio…',
    'Could not start iPhone audio.',
    'Audio stream was interrupted.',
    'Could not play audio.',
  ]) {
    assert.ok(audioSrc.includes(english), `audio.js must contain English string: ${english}`);
  }

  for (const legacySpanish of [
    'Sonando en este PC',
    'Estabilizando audio…',
    'Esperando sonido del iPhone',
    'Reconectando audio…',
    'No se pudo iniciar el audio del iPhone.',
    'La transmisión de audio se interrumpió.',
    'No se pudo reproducir el audio.',
  ]) {
    assert.ok(!audioSrc.includes(legacySpanish), `audio.js must not contain hardcoded Spanish string: ${legacySpanish}`);
  }
});
