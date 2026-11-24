import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {createSession} = require('../desktop/session.cjs');

function fakeChild({autoExitCode = null, stdout = ''} = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  if (autoExitCode !== null) {
    queueMicrotask(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      child.exitCode = autoExitCode;
      child.emit('exit', autoExitCode);
    });
  }
  return child;
}

test('session calls POST /screen-dim on connect when autoDimOnConnect is enabled', async () => {
  const calls = [];
  const states = [];
  let current = {
    phase: 'buscando',
    displayMode: 'dual',
    autoDimOnConnect: true,
    dimShortcutName: 'MirrOS Dim',
    restoreShortcutName: 'MirrOS Restore',
  };
  let backendChild = null;
  const session = createSession({
    workerArgs: args => ['python', args],
    publish: patch => { current = {...current, ...patch}; states.push(current); },
    getState: () => current,
    writeLog: () => {},
    fetchRequest: async (url, options = {}) => {
      calls.push({url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null});
      if (url.endsWith('/codec')) {
        return {ok: true, json: async () => ({codec: 'hevc', description: 'desc'})};
      }
      if (url.endsWith('/screen-dim')) {
        return {ok: true, json: async () => ({status: 'ok', active: true})};
      }
      return {ok: true, json: async () => ({})};
    },
    spawnProcess: (_file, argv) => {
      if (argv[0] === 'status') {
        return fakeChild({
          autoExitCode: 0,
          stdout: JSON.stringify({devices: [{udid: 'u1', name: 'iPhone', paired: true, developer_mode: true}]}),
        });
      }
      if (argv[0] === 'prepare') return fakeChild({autoExitCode: 0});
      backendChild = fakeChild();
      return backendChild;
    },
    stopWorker: async () => {},
    endSession: async () => {},
  });

  await session.scan();
  const dimCall = calls.find(c => c.url.endsWith('/screen-dim'));
  assert.ok(dimCall, 'Expected POST /screen-dim on connect');
  assert.equal(dimCall.method, 'POST');
  assert.deepEqual(dimCall.body, {
    action: 'dim',
    dimShortcut: 'MirrOS Dim',
    restoreShortcut: 'MirrOS Restore',
  });
  assert.equal(current.phase, 'conectado');
  await session.close();
});

test('session skips /screen-dim when autoDimOnConnect is false or displayMode is aod', async () => {
  for (const stateOverride of [
    {autoDimOnConnect: false, displayMode: 'dual'},
    {autoDimOnConnect: true, displayMode: 'aod'},
  ]) {
    const calls = [];
    let current = {phase: 'buscando', ...stateOverride};
    const session = createSession({
      workerArgs: args => ['python', args],
      publish: patch => { current = {...current, ...patch}; },
      getState: () => current,
      writeLog: () => {},
      fetchRequest: async (url, options = {}) => {
        calls.push({url, method: options.method || 'GET'});
        if (url.endsWith('/codec')) return {ok: true, json: async () => ({codec: 'hevc', description: 'desc'})};
        return {ok: true, json: async () => ({status: 'ok'})};
      },
      spawnProcess: (_file, argv) => {
        if (argv[0] === 'status') {
          return fakeChild({
            autoExitCode: 0,
            stdout: JSON.stringify({devices: [{udid: 'u1', name: 'iPhone', paired: true, developer_mode: true}]}),
          });
        }
        if (argv[0] === 'prepare') return fakeChild({autoExitCode: 0});
        return fakeChild();
      },
      stopWorker: async () => {},
      endSession: async () => {},
    });

    await session.scan();
    assert.equal(calls.some(c => c.url.endsWith('/screen-dim')), false);
    assert.equal(current.phase, 'conectado');
    await session.close();
  }
});

test('desktop main, runtime, and inspector wire /screen-dim cleanly', () => {
  const mainSrc = fs.readFileSync(path.resolve('desktop/main.cjs'), 'utf8');
  const runtimeSrc = fs.readFileSync(path.resolve('desktop/runtime.cjs'), 'utf8');
  const inspectorSrc = fs.readFileSync(path.resolve('frontend/src/components/InspectorContent.jsx'), 'utf8');

  assert.match(mainSrc, /'\/screen-dim'/);
  assert.match(mainSrc, /case 'autoDim':/);
  assert.match(mainSrc, /autoDimOnConnect/);
  assert.match(runtimeSrc, /AbortSignal\.timeout\(5000\)/);
  assert.match(inspectorSrc, /s\.autoDimOnConnect/);
  assert.match(inspectorSrc, /triggerScreenDim\?\.\('dim'\)/);
  assert.match(inspectorSrc, /triggerScreenDim\?\.\('restore'\)/);
  assert.match(inspectorSrc, /dim-guide/);
});
