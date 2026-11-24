import {useEffect, useRef} from 'react';
import {createInput, coordinates, edgeStart, keyUsages} from '../input.js';
import {devicePoint} from '../orientation.js';
import {post} from '../transport.js';

export function usePhoneInput({canvas, connected, sensitivity, rotation, floating, onError, button, capture, setKeyboard, clipboardShortcut, wake, appSwitcher, toggleRecording}) {
  const input = useRef(null), callbacks = useRef(null);
  callbacks.current = {onError, button, capture, setKeyboard, clipboardShortcut, wake, appSwitcher, toggleRecording};
  useEffect(() => {
    if (!canvas.current || !connected) return;
    const node = canvas.current;
    let cachedRect = null;
    const getRect = () => cachedRect || (cachedRect = node.getBoundingClientRect());
    const invalidateRect = () => { cachedRect = null; };
    const rectObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(invalidateRect) : null;
    rectObserver?.observe(node);
    const send = (path, data) => post(path, path === '/touch' ? {...data, ...devicePoint(data, rotation)} : data);
    const controls = createInput(send, error => callbacks.current.onError(error.message), {getSize: getRect}); input.current = controls;
    const point = event => coordinates(event.clientX, event.clientY, getRect());
    let activeDrag = false;
    const down = event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault(); node.focus({preventScroll: true});
      const rect = (cachedRect = node.getBoundingClientRect());
      const raw = coordinates(event.clientX, event.clientY, rect), start = edgeStart(raw, rect, 6);
      if (controls.down(event.pointerId, start)) {
        activeDrag = true;
        node.setPointerCapture(event.pointerId);
      }
    };
    const move = event => { if (!activeDrag) return; controls.move(event.pointerId, point(event.getCoalescedEvents?.().at(-1) || event)); };
    const up = event => { if (!activeDrag) return; activeDrag = false; controls.release(event.pointerId, point(event)); };
    const release = () => { if (!activeDrag) return; activeDrag = false; controls.release(null); };
    const wheel = event => { event.preventDefault(); const rect = getRect(); controls.wheel(coordinates(event.clientX, event.clientY, rect), event.deltaY, event.deltaMode, rect.height, sensitivity, event.deltaX, rect.width); };
    const context = event => { event.preventDefault(); callbacks.current.button('home'); };
    const held = new Set(); let clipboardInFlight = false;
    const sendKeys = () => { const snapshot = [...held]; controls.enqueueAction(() => post('/key', {usages: snapshot})); };
    // Refresh the backend lease while modifiers or keys are deliberately held.
    const heartbeat = setInterval(() => { if (held.size) sendKeys(); }, 1500);
    const keys = event => {
      if (document.activeElement !== node) return;
      const lower = event.key.toLowerCase();
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && ['c','v'].includes(lower)) {
        event.preventDefault();
        if (event.repeat || clipboardInFlight) return;
        clipboardInFlight = true;
        const action = lower === 'c' ? 'copy' : 'paste';
        held.clear();
        controls.enqueueAction(async () => { await post('/key', {usages:[]}); await callbacks.current.clipboardShortcut(action); })
          .finally(() => {clipboardInFlight = false;});
        return;
      }
      // Map Ctrl+A (Select All), Ctrl+X (Cut), Ctrl+Z (Undo) to iOS Cmd + key (from Pane keys.js)
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && ['a', 'x', 'z'].includes(lower)) {
        event.preventDefault();
        if (event.repeat) return;
        const codeMap = {a: keyUsages.KeyA, x: keyUsages.KeyX, z: keyUsages.KeyZ};
        const targetUsage = codeMap[lower];
        held.clear();
        controls.enqueueAction(async () => {
          await post('/key', {usages: [227, targetUsage]});
          await post('/key', {usages: []});
          if (lower === 'x') await callbacks.current.clipboardShortcut?.('copy');
        });
        return;
      }
      const shortcuts = {h: 'home', l: 'lock', '[': 'volume-down', ']': 'volume-up', s: 'siri'};
      if (event.type === 'keydown' && event.ctrlKey && shortcuts[event.key.toLowerCase()]) { event.preventDefault(); callbacks.current.button(shortcuts[event.key.toLowerCase()]); return; }
      if (event.type === 'keydown' && event.ctrlKey && (event.key.toLowerCase() === 'm' || event.key === 'Tab')) { event.preventDefault(); callbacks.current.appSwitcher?.(); return; }
      if (event.type === 'keydown' && event.ctrlKey && event.key.toLowerCase() === 'u') { event.preventDefault(); callbacks.current.wake?.(); return; }
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.shiftKey && (event.key.toLowerCase() === 'r' || event.code === 'KeyR')) { event.preventDefault(); callbacks.current.toggleRecording?.(); return; }
      if (event.type === 'keydown' && event.ctrlKey && event.key.toLowerCase() === 'p') { event.preventDefault(); callbacks.current.capture(); return; }
      const usage = keyUsages[event.code]; if (!usage) return;
      event.preventDefault(); if (event.repeat) return;
      event.type === 'keydown' ? held.add(usage) : held.delete(usage); sendKeys();
    };
    const blur = () => { release(); if (held.size) { held.clear(); sendKeys(); } controls.enqueueAction(() => post('/key', {usages: [], detach: true})); callbacks.current.setKeyboard(false); };
    const visibility = () => { if (document.hidden) blur(); };
    const focus = () => callbacks.current.setKeyboard(true);
    node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', release); node.addEventListener('lostpointercapture', release);
    node.addEventListener('wheel', wheel, {passive: false}); node.addEventListener('contextmenu', context); node.addEventListener('focus', focus); node.addEventListener('blur', blur);
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', release); window.addEventListener('blur', blur); window.addEventListener('resize', invalidateRect); document.addEventListener('visibilitychange', visibility); window.addEventListener('keydown', keys); window.addEventListener('keyup', keys);
    return () => { rectObserver?.disconnect(); clearInterval(heartbeat); blur(); controls.dispose(); input.current = null; node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', release); node.removeEventListener('lostpointercapture', release); node.removeEventListener('wheel', wheel); node.removeEventListener('contextmenu', context); node.removeEventListener('focus', focus); node.removeEventListener('blur', blur); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', release); window.removeEventListener('blur', blur); window.removeEventListener('resize', invalidateRect); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('keydown', keys); window.removeEventListener('keyup', keys); };
  }, [connected, sensitivity, rotation]);
  return input;
}
