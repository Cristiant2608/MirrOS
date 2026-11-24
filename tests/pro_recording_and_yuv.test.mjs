import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {
  createRecorder,
  formatBytes,
  getBestSupportedMimeType,
  RECORDING_PRESETS,
} from '../frontend/src/recorder.mjs';

let videoSource = await fs.readFile(new URL('../frontend/src/video.js', import.meta.url), 'utf8');
videoSource = videoSource.replace(/import \{iosScrcpyHevcDimensions\}[^;]+;/, 'const iosScrcpyHevcDimensions=()=>({codedWidth:16,codedHeight:16});');
videoSource = videoSource.replace(/import \{frameRotation\}[^;]+;/, 'const frameRotation=()=>0;');
videoSource = videoSource.replace('./packets.mjs', new URL('../frontend/src/packets.mjs', import.meta.url).href);
const {decodeYuvFramePacket, startVideo} = await import('data:text/javascript;base64,' + Buffer.from(videoSource).toString('base64'));

function buildYuvPacket(width, height, timestampUs, fill = 0x55) {
  const planeBytes = width * height + (width >> 1) * (height >> 1) * 2;
  const buf = new Uint8Array(12 + planeBytes);
  const view = new DataView(buf.buffer);
  view.setUint16(0, width, false);
  view.setUint16(2, height, false);
  view.setBigUint64(4, BigInt(timestampUs), false);
  buf.fill(fill, 12);
  return buf;
}

function framePacket(payload) {
  const framed = new Uint8Array(4 + payload.byteLength);
  new DataView(framed.buffer).setUint32(0, payload.byteLength, false);
  framed.set(payload, 4);
  return framed;
}

test('decodeYuvFramePacket parses valid I420 packets with big-endian header and rejects invalid packets', () => {
  const created = [];
  class MockVideoFrame {
    constructor(data, init) {
      this.data = new Uint8Array(data);
      this.init = init;
      this.displayWidth = init.codedWidth;
      this.displayHeight = init.codedHeight;
      this.closed = false;
      created.push(this);
    }
    close() { this.closed = true; }
  }

  // Test valid packet with >32-bit timestamp and non-zero byteOffset subarray
  const raw = buildYuvPacket(16, 12, 5_000_000_123, 0x7A);
  const padded = new Uint8Array(raw.byteLength + 6);
  padded.set(raw, 4);
  const slice = padded.subarray(4, 4 + raw.byteLength);

  const frame = decodeYuvFramePacket(slice, MockVideoFrame);
  assert.ok(frame instanceof MockVideoFrame);
  assert.equal(frame.init.format, 'I420');
  assert.equal(frame.init.codedWidth, 16);
  assert.equal(frame.init.codedHeight, 12);
  assert.equal(frame.init.timestamp, 5_000_000_123);
  assert.equal(frame.data.byteLength, 16 * 12 + 8 * 6 * 2);
  assert.equal(frame.data[0], 0x7A);
  assert.equal(created.length, 1);

  // Reject truncated header
  assert.equal(decodeYuvFramePacket(new Uint8Array(11), MockVideoFrame), null);
  // Reject odd dimensions
  const oddW = new Uint8Array(12 + 15 * 10 + 7 * 5 * 2);
  new DataView(oddW.buffer).setUint16(0, 15, false);
  new DataView(oddW.buffer).setUint16(2, 10, false);
  assert.equal(decodeYuvFramePacket(oddW, MockVideoFrame), null);

  const oddH = new Uint8Array(12 + 16 * 9 + 8 * 4 * 2);
  new DataView(oddH.buffer).setUint16(0, 16, false);
  new DataView(oddH.buffer).setUint16(2, 9, false);
  assert.equal(decodeYuvFramePacket(oddH, MockVideoFrame), null);

  // Reject zero dimensions
  const zeroDim = new Uint8Array(12);
  assert.equal(decodeYuvFramePacket(zeroDim, MockVideoFrame), null);

  // Reject truncated plane data and oversized plane data
  assert.equal(decodeYuvFramePacket(raw.subarray(0, raw.byteLength - 1), MockVideoFrame), null);
  const oversized = new Uint8Array(raw.byteLength + 1);
  oversized.set(raw, 0);
  assert.equal(decodeYuvFramePacket(oversized, MockVideoFrame), null);

  // Reject missing VideoFrame constructor
  assert.equal(decodeYuvFramePacket(raw, undefined), null);
});

test('startVideo uses /frames.yuv when VideoFrame is available and renders I420 VideoFrames', async () => {
  const original = {
    fetch: globalThis.fetch,
    VideoFrame: globalThis.VideoFrame,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const requested = [];
  const drawn = [];
  const dims = [];

  class MockVideoFrame {
    constructor(data, init) {
      this.data = new Uint8Array(data);
      this.format = init.format;
      this.displayWidth = init.codedWidth;
      this.displayHeight = init.codedHeight;
      this.timestamp = init.timestamp;
      this.closed = false;
    }
    close() { this.closed = true; }
  }

  globalThis.VideoFrame = MockVideoFrame;
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = clearTimeout;

  const yuvFramed = framePacket(buildYuvPacket(64, 48, 33_333, 0x33));
  let sent = false;
  globalThis.fetch = async url => {
    requested.push(url);
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (sent) return {done: true};
            sent = true;
            return {done: false, value: yuvFramed};
          },
          cancel: async () => {},
          releaseLock: () => {},
        }),
      },
    };
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      setTransform: () => {},
      translate: () => {},
      rotate: () => {},
      drawImage: (src, ...rest) => { drawn.push({src, rest}); },
    }),
  };

  let stop;
  try {
    stop = startVideo(canvas, {
      onFrame: () => {},
      onStatus: () => {},
      onDimensions: d => dims.push(d),
      quality: 'balanced',
      forceSoftware: true,
    });
    for (let i = 0; i < 30 && drawn.length < 1; i++) await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(requested, ['/frames.yuv?quality=balanced']);
    assert.equal(drawn.length, 1);
    assert.ok(drawn[0].src instanceof MockVideoFrame);
    assert.equal(drawn[0].src.format, 'I420');
    assert.deepEqual(dims, [{width: 64, height: 48}]);
  } finally {
    stop?.();
    Object.assign(globalThis, original);
    if (original.VideoFrame === undefined) delete globalThis.VideoFrame;
  }
});

test('startVideo falls back to /frames.bin when /frames.yuv returns 404', async () => {
  const original = {
    fetch: globalThis.fetch,
    VideoFrame: globalThis.VideoFrame,
    createImageBitmap: globalThis.createImageBitmap,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const requested = [];
  let drawn = 0;

  globalThis.VideoFrame = class MockVideoFrame {
    constructor(_data, init) {
      this.displayWidth = init.codedWidth;
      this.displayHeight = init.codedHeight;
    }
    close() {}
  };
  globalThis.createImageBitmap = async () => ({width: 32, height: 64, close: () => {}});
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
  globalThis.cancelAnimationFrame = clearTimeout;

  let sent = false;
  globalThis.fetch = async url => {
    requested.push(url);
    if (String(url).startsWith('/frames.yuv')) {
      return {ok: false, status: 404};
    }
    if (String(url).startsWith('/frames.bin')) {
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              if (sent) return {done: true};
              sent = true;
              return {done: false, value: Uint8Array.from([0, 0, 0, 2, 0xFF, 0xD8])};
            },
            cancel: async () => {},
            releaseLock: () => {},
          }),
        },
      };
    }
    return {ok: false};
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      setTransform: () => {},
      translate: () => {},
      rotate: () => {},
      drawImage: () => { drawn++; },
    }),
  };

  let stop;
  try {
    stop = startVideo(canvas, {
      onFrame: () => {},
      onStatus: () => {},
      onDimensions: () => {},
      quality: 'detail',
      forceSoftware: true,
    });
    for (let i = 0; i < 30 && drawn < 1; i++) await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(requested, ['/frames.yuv?quality=detail', '/frames.bin?quality=detail']);
    assert.equal(drawn, 1);
  } finally {
    stop?.();
    Object.assign(globalThis, original);
    if (original.VideoFrame === undefined) delete globalThis.VideoFrame;
  }
});

test('audio-worklet gently slews sustained backlog back toward target without hard drops or extra port messages', async () => {
  const code = await fs.readFile(new URL('../frontend/public/audio-worklet.js', import.meta.url), 'utf8');
  let Player;
  const messages = [];
  vm.runInNewContext(code, {
    ArrayBuffer,
    DataView,
    Float32Array,
    sampleRate: 48000,
    AudioWorkletProcessor: class {
      constructor() {
        this.port = {postMessage: message => messages.push(message)};
      }
    },
    registerProcessor(_name, type) { Player = type; },
  });

  const p = new Player();
  const push = (frames, sample = 4096) => {
    const data = new ArrayBuffer(frames * 4);
    const pcm = new DataView(data);
    for (let i = 0; i < frames; i++) {
      pcm.setInt16(i * 4, sample, true);
      pcm.setInt16(i * 4 + 2, -sample, true);
    }
    p.port.onmessage({data});
  };
  const render = (frames = 128) => {
    const out = [new Float32Array(frames), new Float32Array(frames)];
    assert.equal(p.process([], [out]), true);
    return out;
  };

  // Start with target (5760) + 4800 (100 ms sustained excess backlog)
  const initialCount = p.target + 4800;
  push(initialCount);
  assert.equal(p.count, initialCount);

  // Continuously feed 128 frames per 128-frame render block (nominal 1:1 rate)
  let maxDropPerBlock = 0;
  let prev = p.count;
  for (let i = 0; i < 8000; i++) {
    render(128);
    push(128);
    const delta = prev - p.count;
    if (delta > maxDropPerBlock) maxDropPerBlock = delta;
    prev = p.count;
  }

  assert.equal(p.playing, true);
  assert.deepEqual(messages, ['playing'], 'must only emit playing without buffering or extra messages');
  assert.ok(maxDropPerBlock <= 2, `convergence must be smooth without hard drops (max delta=${maxDropPerBlock})`);
  assert.ok(p.count <= p.target + 128, `backlog should converge back to target (${p.target}), got ${p.count}`);
  assert.ok(p.count >= p.target - 128, `backlog should not undershoot target (${p.target}), got ${p.count}`);
});

test('recorder formatBytes, presets, preferredFormat mp4, qualityPreset high, includeAudio false, and onProgress byte tracking', async () => {
  assert.deepEqual(RECORDING_PRESETS, {
    standard: {videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000},
    high: {videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000},
  });

  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-10), '0 B');
  assert.equal(formatBytes(null), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(512 * 1024), '512 KB');
  assert.equal(formatBytes(Math.round(14.2 * 1024 * 1024)), '14.2 MB');
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), '2.00 GB');

  // Preferred format ordering
  const allSupported = () => true;
  assert.equal(getBestSupportedMimeType(allSupported, 'mp4'), 'video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  assert.equal(getBestSupportedMimeType(t => t === 'video/mp4' || t.includes('vp9'), 'mp4'), 'video/mp4');
  assert.equal(getBestSupportedMimeType(t => t.includes('vp9'), 'mp4'), 'video/webm;codecs=vp9,opus');
  assert.equal(getBestSupportedMimeType(allSupported, 'webm'), 'video/webm;codecs=vp9,opus');
  assert.equal(getBestSupportedMimeType(allSupported, 'auto'), 'video/webm;codecs=vp9,opus');

  // createRecorder with mp4, high quality, includeAudio: false, and onProgress
  let capturedTracks = null;
  let capturedOptions = null;
  let recorderInstance = null;

  class MockStream {
    constructor(tracks) {
      this.tracks = tracks;
      capturedTracks = tracks;
    }
    getTracks() { return this.tracks; }
  }

  class MockRecorder {
    static isTypeSupported(type) {
      return type.startsWith('video/mp4');
    }
    constructor(stream, options) {
      recorderInstance = this;
      capturedOptions = options;
      this.stream = stream;
      this.mimeType = options?.mimeType || 'video/mp4';
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({data: {size: 1024 * 1024, byteLength: 1024 * 1024}});
      this.onstop?.();
    }
  }

  const vTrack = {id: 'v1', stop() {}};
  const aTrack = {id: 'a1', stop() {}};
  const progressEvents = [];

  const rec = createRecorder({
    canvas: {captureStream: () => ({getVideoTracks: () => [vTrack]})},
    audioStream: {getAudioTracks: () => [aTrack]},
    includeAudio: false,
    preferredFormat: 'mp4',
    qualityPreset: 'high',
    onProgress: info => progressEvents.push(info),
    MediaRecorderClass: MockRecorder,
    MediaStreamClass: MockStream,
  });

  assert.deepEqual(capturedTracks, [vTrack], 'includeAudio: false must exclude audio tracks');
  assert.equal(capturedOptions.mimeType, 'video/mp4;codecs=avc1.42E01E,mp4a.40.2');
  assert.equal(capturedOptions.videoBitsPerSecond, 8_000_000);
  assert.equal(capturedOptions.audioBitsPerSecond, 192_000);

  recorderInstance.ondataavailable({data: {size: 256 * 1024, byteLength: 256 * 1024}});
  assert.equal(rec.getBytes(), 256 * 1024);
  assert.equal(progressEvents.length, 1);
  assert.equal(progressEvents[0].bytes, 256 * 1024);

  const result = await rec.stop();
  assert.equal(result.extension, 'mp4');
  assert.equal(rec.getBytes(), 256 * 1024 + 1024 * 1024);
  assert.equal(progressEvents[progressEvents.length - 1].bytes, 256 * 1024 + 1024 * 1024);
});

test('createRecorder falls back to minimal mimeType options when MediaRecorder rejects bitrate options', async () => {
  const attempts = [];
  class FallbackRecorder {
    static isTypeSupported(t) { return t === 'video/webm'; }
    constructor(stream, options) {
      attempts.push(options);
      if (options && 'videoBitsPerSecond' in options) {
        throw new Error('NotSupportedError');
      }
      this.stream = stream;
      this.mimeType = options?.mimeType || 'video/webm';
      this.state = 'inactive';
    }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.onstop?.(); }
  }

  const rec = createRecorder({
    canvas: {captureStream: () => ({getVideoTracks: () => [{stop() {}}]})},
    qualityPreset: 'high',
    MediaRecorderClass: FallbackRecorder,
    MediaStreamClass: class { constructor(t) { this.t = t; } getTracks() { return this.t; } },
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].videoBitsPerSecond, 8_000_000);
  assert.deepEqual(attempts[1], {mimeType: 'video/webm'});
  await rec.stop();
});

test('UI components wire Pro Recording settings and live recordingBytes while preserving App.jsx invariants', async () => {
  const [appSrc, inspectorSrc, studioSrc, controlsSrc, hookSrc] = await Promise.all([
    fs.readFile(new URL('../frontend/src/App.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/components/InspectorContent.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/components/StudioShell.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/components/Controls.jsx', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/hooks/useRecording.js', import.meta.url), 'utf8'),
  ]);

  assert.ok(appSrc.split('\n').length < 500, 'App.jsx must remain under 500 lines');
  assert.ok(appSrc.includes('recordingBytes') && appSrc.includes('recordingFormat') && appSrc.includes('recordingQuality') && appSrc.includes('recordingIncludeAudio'));
  assert.ok(inspectorSrc.includes('recordingGroup') && inspectorSrc.includes('recordingFormat') && inspectorSrc.includes('recordingBitrate') && inspectorSrc.includes('recordingIncludeAudio'));
  assert.ok(studioSrc.includes('recordingBytes'));
  assert.ok(controlsSrc.includes('formatBytes') && controlsSrc.includes('recordingBytes'));
  assert.ok(hookSrc.includes('recordingFormat') && hookSrc.includes('recordingQuality') && hookSrc.includes('recordingIncludeAudio') && hookSrc.includes('recordingBytes'));
});
