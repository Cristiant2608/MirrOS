export const PREFERRED_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

export const RECORDING_PRESETS = {
  standard: {videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000},
  high: {videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000},
};

export function formatDuration(seconds) {
  const total = Math.floor(Math.max(0, Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  const value = Math.floor(Math.max(0, Number(bytes) || 0));
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function getBestSupportedMimeType(isTypeSupportedFn, preferredFormat = 'auto') {
  const check = typeof isTypeSupportedFn === 'function'
    ? isTypeSupportedFn
    : (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? MediaRecorder.isTypeSupported.bind(MediaRecorder)
      : null);

  let candidates = PREFERRED_MIME_TYPES;
  if (preferredFormat === 'mp4') {
    candidates = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', ...PREFERRED_MIME_TYPES];
  } else if (preferredFormat === 'webm') {
    candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  }

  if (check) {
    const seen = new Set();
    for (const type of candidates) {
      if (seen.has(type)) continue;
      seen.add(type);
      if (check(type)) return type;
    }
  }
  return 'video/webm';
}

export function createRecorder({
  canvas,
  audioStream,
  includeAudio = true,
  preferredFormat = 'auto',
  qualityPreset = 'standard',
  onTick,
  onProgress,
  onStateChange,
  MediaRecorderClass = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null,
  MediaStreamClass = typeof MediaStream !== 'undefined' ? MediaStream : null,
} = {}) {
  if (!canvas || (typeof canvas.captureStream !== 'function' && typeof canvas.mozCaptureStream !== 'function')) {
    throw new Error('Canvas no válido para captura de video.');
  }

  const videoStream = typeof canvas.captureStream === 'function'
    ? canvas.captureStream(60)
    : canvas.mozCaptureStream(60);

  const videoTracks = videoStream?.getVideoTracks?.() || [];
  const audioTracks = includeAudio !== false ? (audioStream?.getAudioTracks?.() || []) : [];
  const combinedTracks = [...videoTracks, ...audioTracks];

  let stream;
  if (MediaStreamClass) {
    stream = new MediaStreamClass(combinedTracks);
  } else if (typeof MediaStream !== 'undefined') {
    stream = new MediaStream(combinedTracks);
  } else if (videoStream) {
    stream = videoStream;
    for (const track of audioTracks) {
      stream.addTrack?.(track);
    }
  } else {
    stream = {
      getTracks: () => combinedTracks,
      getVideoTracks: () => videoTracks,
      getAudioTracks: () => audioTracks,
    };
  }

  const RecorderConstructor = MediaRecorderClass || (typeof MediaRecorder !== 'undefined' ? MediaRecorder : null);
  if (!RecorderConstructor) {
    throw new Error('MediaRecorder no disponible en este entorno.');
  }

  const mimeType = getBestSupportedMimeType(
    RecorderConstructor.isTypeSupported?.bind(RecorderConstructor),
    preferredFormat,
  );
  const preset = qualityPreset ? RECORDING_PRESETS[qualityPreset] : null;
  const options = {};
  if (mimeType) options.mimeType = mimeType;
  if (preset?.videoBitsPerSecond) options.videoBitsPerSecond = preset.videoBitsPerSecond;
  if (preset?.audioBitsPerSecond) options.audioBitsPerSecond = preset.audioBitsPerSecond;

  let recorder;
  try {
    recorder = new RecorderConstructor(stream, Object.keys(options).length ? options : undefined);
  } catch {
    recorder = new RecorderConstructor(stream, mimeType ? {mimeType} : undefined);
  }

  const chunks = [];
  let duration = 0;
  let recordedBytes = 0;
  let timer = null;
  let startTime = 0;

  recorder.ondataavailable = event => {
    const size = event?.data?.size || event?.data?.byteLength || 0;
    if (event?.data && size > 0) {
      chunks.push(event.data);
      recordedBytes += size;
      onProgress?.({duration, bytes: recordedBytes});
    }
  };

  recorder.onerror = event => {
    onStateChange?.('error', event);
  };

  startTime = Date.now();
  timer = setInterval(() => {
    duration = Math.floor((Date.now() - startTime) / 1000);
    onTick?.(duration);
    onProgress?.({duration, bytes: recordedBytes});
  }, 1000);
  timer.unref?.();

  try {
    recorder.start(1000);
  } catch {
    recorder.start();
  }
  onStateChange?.(recorder.state);

  let stopPromise = null;

  async function stop() {
    if (stopPromise) return stopPromise;

    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    const finalDuration = Math.max(duration, Math.floor((Date.now() - startTime) / 1000));

    stopPromise = new Promise(resolve => {
      const handleStop = () => {
        onStateChange?.(recorder.state);

        // Stop all media tracks to release camera/canvas/audio capturing
        const tracks = stream?.getTracks ? stream.getTracks() : combinedTracks;
        for (const track of tracks) {
          try {
            track.stop?.();
          } catch {}
        }

        const selectedMime = recorder.mimeType || mimeType || 'video/webm';
        const extension = selectedMime.startsWith('video/mp4') ? 'mp4' : 'webm';
        const blob = typeof Blob !== 'undefined'
          ? new Blob(chunks, {type: selectedMime})
          : {chunks, size: chunks.reduce((acc, c) => acc + (c.size || c.length || 0), 0), type: selectedMime};

        resolve({
          blob,
          mimeType: selectedMime,
          extension,
          duration: finalDuration,
          bytes: recordedBytes,
        });
      };

      if (recorder.state === 'inactive') {
        handleStop();
      } else {
        recorder.onstop = handleStop;
        try {
          recorder.stop();
        } catch {
          handleStop();
        }
      }
    });

    return stopPromise;
  }

  return {
    recorder,
    stream,
    stop,
    getDuration: () => duration,
    getBytes: () => recordedBytes,
    isRecording: () => recorder.state === 'recording',
  };
}
