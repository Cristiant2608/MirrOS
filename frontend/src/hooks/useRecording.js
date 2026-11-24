import {useCallback, useEffect, useRef, useState} from 'react';
import {createRecorder} from '../recorder.mjs';

const VALID_FORMATS = new Set(['auto', 'webm', 'mp4']);
const VALID_QUALITIES = new Set(['standard', 'high']);

function readStorage(key, fallback) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, String(value));
  } catch {}
}

export function useRecording({canvas, connected, live, cameraLive, getAudioStream, bridge, native, setNotice, t}) {
  const recorderRef = useRef(null);
  const recordingLock = useRef(false);
  const [recording, setRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingBytes, setRecordingBytes] = useState(0);
  const [recordingFormat, setRecordingFormat] = useState(() => {
    const saved = readStorage('recordingFormat', 'auto');
    return VALID_FORMATS.has(saved) ? saved : 'auto';
  });
  const [recordingQuality, setRecordingQuality] = useState(() => {
    const saved = readStorage('recordingQuality', 'standard');
    return VALID_QUALITIES.has(saved) ? saved : 'standard';
  });
  const [recordingIncludeAudio, setRecordingIncludeAudio] = useState(() => readStorage('recordingIncludeAudio', 'true') !== 'false');

  useEffect(() => { writeStorage('recordingFormat', recordingFormat); }, [recordingFormat]);
  useEffect(() => { writeStorage('recordingQuality', recordingQuality); }, [recordingQuality]);
  useEffect(() => { writeStorage('recordingIncludeAudio', recordingIncludeAudio); }, [recordingIncludeAudio]);

  const latest = useRef({canvas, live, cameraLive, getAudioStream, bridge, native, setNotice, t, recordingFormat, recordingQuality, recordingIncludeAudio});
  latest.current = {canvas, live, cameraLive, getAudioStream, bridge, native, setNotice, t, recordingFormat, recordingQuality, recordingIncludeAudio};

  const toggleRecording = useCallback(async () => {
    if (recordingLock.current) return;
    recordingLock.current = true;
    setTimeout(() => { recordingLock.current = false; }, 300);

    const {
      canvas: canvasRef,
      live: isLive,
      cameraLive: isCameraLive,
      getAudioStream: readAudioStream,
      bridge: hasBridge,
      native: invokeNative,
      setNotice: notify,
      t: strings,
      recordingFormat: preferredFormat,
      recordingQuality: qualityPreset,
      recordingIncludeAudio: includeAudio,
    } = latest.current;

    if (recorderRef.current) {
      const active = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      try {
        notify(strings.notices.recordingStopping);
        const {blob, extension} = await active.stop();
        if (!blob || (blob.size === 0 && (!blob.byteLength || blob.byteLength === 0))) {
          notify(strings.notices.recordingEmpty);
          return;
        }
        if (hasBridge) {
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const saved = await invokeNative('saveRecording', {bytes, extension});
          notify(saved ? strings.notices.recordingSaved : strings.notices.recordingCanceled);
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.download = `MirrOS-Recording.${extension}`;
          link.href = url;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          notify(strings.notices.recordingDownloaded);
        }
      } catch (err) {
        notify(strings.notices.recordingSaveError(err.message));
      } finally {
        setRecordingDuration(0);
        setRecordingBytes(0);
      }
      return;
    }

    if ((!isLive && !isCameraLive) || !canvasRef?.current) {
      notify(strings.notices.noActiveStreamToRecord);
      return;
    }
    try {
      const audioStream = includeAudio ? readAudioStream?.() : null;
      const rec = createRecorder({
        canvas: canvasRef.current,
        audioStream,
        includeAudio,
        preferredFormat,
        qualityPreset,
        onTick: secs => setRecordingDuration(secs),
        onProgress: ({duration, bytes}) => {
          setRecordingDuration(duration);
          setRecordingBytes(bytes);
        },
      });
      recorderRef.current = rec;
      setRecording(true);
      setRecordingDuration(0);
      setRecordingBytes(0);
      notify(strings.notices.recordingStarted);
    } catch (err) {
      notify(strings.notices.recordingStartError(err.message));
    }
  }, []);

  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        recorderRef.current.stop().catch(() => {});
        recorderRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!connected && recorderRef.current) {
      toggleRecording();
    }
  }, [connected, toggleRecording]);

  return {
    recording,
    recordingDuration,
    recordingBytes,
    recordingFormat,
    setRecordingFormat,
    recordingQuality,
    setRecordingQuality,
    recordingIncludeAudio,
    setRecordingIncludeAudio,
    recorderRef,
    toggleRecording,
  };
}
