import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, val] of Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      keys.push(...collectKeys(val, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

test('en.json and es.json parse cleanly and share 100% matching top-level and nested keys', async () => {
  const enRaw = await fs.readFile(new URL('../frontend/src/locales/en.json', import.meta.url), 'utf8');
  const esRaw = await fs.readFile(new URL('../frontend/src/locales/es.json', import.meta.url), 'utf8');
  const en = JSON.parse(enRaw);
  const es = JSON.parse(esRaw);

  assert.deepEqual(Object.keys(en).sort(), Object.keys(es).sort());
  assert.deepEqual(collectKeys(en), collectKeys(es));

  for (const requiredKey of [
    'connectedIphones',
    'activeDevice',
    'switchDeviceAria',
    'devicePresetLabel',
    'devicePresetActive',
    'devicePresetDefault',
    'resetDevicePreset',
  ]) {
    assert.equal(typeof en.inspector[requiredKey], 'string', `en.inspector.${requiredKey} must be a string`);
    assert.equal(typeof es.inspector[requiredKey], 'string', `es.inspector.${requiredKey} must be a string`);
    assert.ok(en.inspector[requiredKey].length > 0, `en.inspector.${requiredKey} must be non-empty`);
    assert.ok(es.inspector[requiredKey].length > 0, `es.inspector.${requiredKey} must be non-empty`);
  }
});

test('StudioShell.jsx and FloatingShell.jsx exist and are imported and rendered by App.jsx', async () => {
  const appSrc = await fs.readFile(new URL('../frontend/src/App.jsx', import.meta.url), 'utf8');
  const studioSrc = await fs.readFile(new URL('../frontend/src/components/StudioShell.jsx', import.meta.url), 'utf8');
  const floatingSrc = await fs.readFile(new URL('../frontend/src/components/FloatingShell.jsx', import.meta.url), 'utf8');

  assert.match(studioSrc, /export function StudioShell\b/);
  assert.match(floatingSrc, /export function FloatingShell\b/);
  assert.match(appSrc, /import\s+\{StudioShell\}\s+from\s+'\.\/components\/StudioShell\.jsx'/);
  assert.match(appSrc, /import\s+\{FloatingShell\}\s+from\s+'\.\/components\/FloatingShell\.jsx'/);
  assert.ok(appSrc.includes('<StudioShell'), 'App.jsx must render <StudioShell>');
  assert.ok(appSrc.includes('<FloatingShell'), 'App.jsx must render <FloatingShell>');
  assert.ok(appSrc.includes('pointerNode') && !appSrc.includes('setPointerPosition'), 'App.jsx must keep ref+rAF pointer tracking');
});

test('InspectorContent.jsx renders multi-device USB selector and per-device preset controls', async () => {
  const inspectorSrc = await fs.readFile(new URL('../frontend/src/components/InspectorContent.jsx', import.meta.url), 'utf8');
  const cssSrc = await fs.readFile(new URL('../frontend/src/style.css', import.meta.url), 'utf8');

  assert.match(inspectorSrc, /export const InspectorContent = memo\(/, 'InspectorContent must stay wrapped in React.memo');
  assert.ok(inspectorSrc.includes('state.devices') && inspectorSrc.includes('state.devices.length > 1'), 'InspectorContent must conditionally render multi-device switcher when multiple devices are connected');
  assert.ok(inspectorSrc.includes("native('device', d.udid)"), 'InspectorContent must invoke native("device", udid) to switch devices');
  assert.ok(inspectorSrc.includes('state.hasDevicePreset'), 'InspectorContent must display per-device preset state');
  assert.ok(inspectorSrc.includes("native('resetDevicePreset')"), 'InspectorContent must wire resetDevicePreset button');
  assert.ok(cssSrc.includes('.device-switcher') && cssSrc.includes('.device-option'), 'style.css must style .device-switcher and .device-option');
  assert.ok(cssSrc.includes('contain:layout style paint'), 'style.css must preserve CSS containment rules');
});
