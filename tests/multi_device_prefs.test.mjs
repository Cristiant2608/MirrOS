import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEVICE_PREF_KEYS,
  MAX_DEVICE_PREFS,
  sanitizeDevicePrefs,
  sanitizeDevicePrefsMap,
  loadDevicePrefs,
  saveDevicePrefs,
  clearDevicePrefs,
} = require('../desktop/device-prefs.cjs');
const {createSession} = require('../desktop/session.cjs');

const GLOBAL_DEFAULTS = {
  alwaysOnTop: false,
  mode: 'studio',
  size: 'mediano',
  theme: 'claro',
  floatingBounds: null,
  controlsVisible: true,
  displayMode: 'dual',
  autoDimOnConnect: false,
  dimShortcutName: 'MirrOS Dim',
  restoreShortcutName: 'MirrOS Restore',
};

test('DEVICE_PREF_KEYS exports all expected device-scoped keys', () => {
  assert.deepEqual(
    [...DEVICE_PREF_KEYS],
    [
      'theme',
      'size',
      'displayMode',
      'autoDimOnConnect',
      'dimShortcutName',
      'restoreShortcutName',
      'alwaysOnTop',
      'floatingBounds',
      'controlsVisible',
    ]
  );
});

test('sanitizeDevicePrefs validates each field safely and ignores invalid values', () => {
  assert.deepEqual(sanitizeDevicePrefs(null), {});
  assert.deepEqual(sanitizeDevicePrefs('invalid'), {});
  assert.deepEqual(sanitizeDevicePrefs([]), {});

  const clean = sanitizeDevicePrefs({
    theme: 'oscuro',
    size: 'grande',
    displayMode: 'aod',
    autoDimOnConnect: true,
    dimShortcutName: '  Night Dim  ',
    restoreShortcutName: '  Day Restore  ',
    alwaysOnTop: true,
    floatingBounds: {width: 420.4, height: 860.6},
    controlsVisible: false,
    mode: 'phone', // global-only, not a device-scoped key
    unknownKey: 'should-be-dropped',
  });
  assert.deepEqual(clean, {
    theme: 'oscuro',
    size: 'grande',
    displayMode: 'aod',
    autoDimOnConnect: true,
    dimShortcutName: 'Night Dim',
    restoreShortcutName: 'Day Restore',
    alwaysOnTop: true,
    floatingBounds: {width: 420, height: 861},
    controlsVisible: false,
  });

  const rejected = sanitizeDevicePrefs({
    theme: 'neon',
    size: 'enorme',
    displayMode: 'mirror',
    autoDimOnConnect: 'yes',
    dimShortcutName: '   ',
    restoreShortcutName: 'x'.repeat(81),
    alwaysOnTop: 1,
    floatingBounds: {width: 100, height: 99999},
    controlsVisible: 'false',
  });
  assert.deepEqual(rejected, {});

  // Explicit null floatingBounds is valid so a device can clear inherited bounds.
  assert.deepEqual(sanitizeDevicePrefs({floatingBounds: null}), {floatingBounds: null});
});

test('loadDevicePrefs isolates per-UDID presets and merges fallback defaults cleanly', () => {
  let store = {};
  store = saveDevicePrefs(store, 'udid-iphone-a', {
    ...GLOBAL_DEFAULTS,
    theme: 'oscuro',
    displayMode: 'aod',
    alwaysOnTop: true,
  });
  store = saveDevicePrefs(store, 'udid-iphone-b', {
    ...GLOBAL_DEFAULTS,
    theme: 'lavanda',
    autoDimOnConnect: true,
    dimShortcutName: 'Dim B',
  });

  const effA = loadDevicePrefs(store, 'udid-iphone-a', GLOBAL_DEFAULTS);
  const effB = loadDevicePrefs(store, 'udid-iphone-b', GLOBAL_DEFAULTS);
  const effC = loadDevicePrefs(store, 'udid-iphone-c', GLOBAL_DEFAULTS);

  assert.equal(effA.theme, 'oscuro');
  assert.equal(effA.displayMode, 'aod');
  assert.equal(effA.alwaysOnTop, true);
  assert.equal(effA.autoDimOnConnect, false);
  assert.equal(effA.mode, 'studio');

  assert.equal(effB.theme, 'lavanda');
  assert.equal(effB.displayMode, 'dual');
  assert.equal(effB.autoDimOnConnect, true);
  assert.equal(effB.dimShortcutName, 'Dim B');

  assert.deepEqual(effC, GLOBAL_DEFAULTS);

  // Partial preset falls back for unset keys.
  const partialStore = {'udid-partial': {theme: 'oceano', displayMode: 'invalid-mode'}};
  const effPartial = loadDevicePrefs(partialStore, 'udid-partial', GLOBAL_DEFAULTS);
  assert.equal(effPartial.theme, 'oceano');
  assert.equal(effPartial.displayMode, 'dual');
  assert.equal(effPartial.size, 'mediano');
});

test('saveDevicePrefs caps stored UDIDs, ignores invalid UDIDs, and stays immutable', () => {
  const original = {};
  let store = original;
  for (let i = 1; i <= MAX_DEVICE_PREFS + 5; i++) {
    store = saveDevicePrefs(store, `udid-${i}`, {theme: 'oscuro'});
  }
  assert.deepEqual(original, {});
  assert.equal(Object.keys(store).length, MAX_DEVICE_PREFS);
  assert.equal(Object.prototype.hasOwnProperty.call(store, 'udid-1'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(store, 'udid-5'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(store, `udid-${MAX_DEVICE_PREFS + 5}`), true);

  // Invalid UDIDs do not add entries or pollute prototypes.
  for (const bad of ['', '   ', null, undefined, 123, '__proto__', 'constructor', 'prototype', 'a'.repeat(129)]) {
    const next = saveDevicePrefs(store, bad, {theme: 'lavanda'});
    assert.deepEqual(next, store);
  }
  assert.equal(({}).theme, undefined);

  // sanitizeDevicePrefsMap drops invalid keys and caps entries.
  const sanitized = sanitizeDevicePrefsMap({'__proto__': {theme: 'oscuro'}, 'valid-1': {theme: 'oceano', size: 'bad'}});
  assert.deepEqual(sanitized, {'valid-1': {theme: 'oceano'}});
});

test('clearDevicePrefs removes only the target UDID without mutating input', () => {
  let store = saveDevicePrefs({}, 'u1', {theme: 'oscuro'});
  store = saveDevicePrefs(store, 'u2', {theme: 'lavanda'});
  const snapshot = structuredClone(store);

  const cleared = clearDevicePrefs(store, 'u1');
  assert.deepEqual(store, snapshot);
  assert.equal(Object.prototype.hasOwnProperty.call(cleared, 'u1'), false);
  assert.deepEqual(cleared.u2, {theme: 'lavanda'});
  assert.deepEqual(loadDevicePrefs(cleared, 'u1', GLOBAL_DEFAULTS), GLOBAL_DEFAULTS);
});

test('session exposes devices while connected and switches seamlessly between plugged-in USB iPhones', async () => {
  const phoneA = {udid: 'u1', name: 'iPhone A', paired: true, developer_mode: true};
  const phoneB = {udid: 'u2', name: 'iPhone B', paired: true, developer_mode: true};
  let pluggedIn = [phoneA];
  let state = {phase: 'buscando', devices: [], ...GLOBAL_DEFAULTS};

  // Simulate main.cjs per-UDID preference swap inside publish().
  const devicePrefs = {
    u1: {displayMode: 'dual', autoDimOnConnect: false, theme: 'claro'},
    u2: {displayMode: 'aod', autoDimOnConnect: false, theme: 'oscuro'},
  };
  let activeUdid = null;
  let activePrefs = {...GLOBAL_DEFAULTS};

  const spawnedServes = [];
  const displayModesApplied = [];
  const activeChildren = new Set();

  const stopWorker = async child => {
    if (!child || child.exitCode !== null) return;
    activeChildren.delete(child);
    child.exitCode = 0;
    child.emit('exit', 0);
  };

  const session = createSession({
    workerArgs: args => ['fake-worker', args],
    spawnProcess: (_file, args, opts) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: Math.floor(Math.random() * 10000) + 1,
        exitCode: null,
        udid: opts?.env?.PYMOBILEDEVICE3_UDID || null,
      });
      activeChildren.add(child);
      if (args[0] === 'serve') {
        spawnedServes.push(child.udid);
      } else {
        queueMicrotask(() => {
          if (args[0] === 'status') {
            child.stdout.write(JSON.stringify({devices: pluggedIn}));
          }
          stopWorker(child);
        });
      }
      return child;
    },
    fetchRequest: async (url, fetchOptions = {}) => {
      if (url.endsWith('/health')) {
        return {ok: true, json: async () => ({healthy: true})};
      }
      if (url.endsWith('/display-mode')) {
        displayModesApplied.push({udid: state.device?.udid, body: JSON.parse(fetchOptions.body)});
        return {ok: true, json: async () => ({status: 'ok'})};
      }
      return {ok: true, json: async () => ({codec: 'hev1', description: 'fixture'})};
    },
    stopWorker,
    endSession: stopWorker,
    publish: patch => {
      if (Object.prototype.hasOwnProperty.call(patch, 'device')) {
        const nextUdid = patch.device?.udid || null;
        if (nextUdid !== activeUdid) {
          activeUdid = nextUdid;
          activePrefs = nextUdid ? loadDevicePrefs(devicePrefs, nextUdid, GLOBAL_DEFAULTS) : {...GLOBAL_DEFAULTS};
        }
      }
      state = {...state, ...patch, ...activePrefs};
    },
    getState: () => state,
    writeLog: () => {},
  });

  try {
    // 1. Single device connects and devices list is published.
    await session.scan();
    assert.equal(state.phase, 'conectado');
    assert.equal(state.device.udid, 'u1');
    assert.deepEqual(state.devices.map(d => d.udid), ['u1']);
    assert.equal(state.theme, 'claro');
    assert.deepEqual(spawnedServes, ['u1']);
    assert.equal(displayModesApplied.length, 0);

    // 2. Plug in second iPhone while already connected -> scan publishes updated devices list.
    pluggedIn = [phoneA, phoneB];
    await session.scan();
    assert.equal(state.phase, 'conectado');
    assert.equal(state.device.udid, 'u1');
    assert.deepEqual(state.devices.map(d => d.udid), ['u1', 'u2']);

    // 3. Selecting the currently connected UDID is a no-op (no unnecessary reconnect).
    await session.select('u1');
    assert.deepEqual(spawnedServes, ['u1']);

    // 4. Selecting an unknown UDID while connected is a no-op.
    await session.select('unknown-udid');
    assert.equal(state.device.udid, 'u1');
    assert.deepEqual(spawnedServes, ['u1']);

    // 5. Switching to iPhone B cleanly stops iPhone A backend and connects iPhone B with its AOD preset!
    await session.select('u2');
    assert.equal(state.phase, 'conectado');
    assert.equal(state.device.udid, 'u2');
    assert.equal(state.theme, 'oscuro');
    assert.equal(state.displayMode, 'aod');
    assert.deepEqual(spawnedServes, ['u1', 'u2']);
    assert.equal(activeChildren.size, 1);
    assert.deepEqual(displayModesApplied, [{udid: 'u2', body: {mode: 'aod'}}]);

    // 6. Pause (disconnect), then select iPhone A directly from paused phase.
    await session.disconnect();
    assert.equal(state.phase, 'pausado');
    assert.equal(activeChildren.size, 0);
    await session.select('u1');
    assert.equal(state.phase, 'conectado');
    assert.equal(state.device.udid, 'u1');
    assert.equal(state.theme, 'claro');
    assert.deepEqual(spawnedServes, ['u1', 'u2', 'u1']);
  } finally {
    await session.close();
  }
  assert.equal(activeChildren.size, 0);
});

test('desktop/main.cjs wires device-prefs, hasDevicePreset, and resetDevicePreset cleanly', () => {
  const mainSrc = fs.readFileSync(path.resolve('desktop/main.cjs'), 'utf8');
  assert.match(mainSrc, /require\('\.\/device-prefs\.cjs'\)/);
  assert.match(mainSrc, /loadDevicePrefs/);
  assert.match(mainSrc, /saveDevicePrefs/);
  assert.match(mainSrc, /clearDevicePrefs/);
  assert.match(mainSrc, /hasDevicePreset/);
  assert.match(mainSrc, /case 'resetDevicePreset':/);
  assert.match(mainSrc, /devicePreferences/);
});
