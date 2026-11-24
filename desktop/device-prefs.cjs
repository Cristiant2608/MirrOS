// Pure local per-UDID preference helpers stored inside preferencias.json.
// Strictly local — zero network or cloud telemetry.

const DEVICE_PREF_KEYS = Object.freeze([
  'theme',
  'size',
  'displayMode',
  'autoDimOnConnect',
  'dimShortcutName',
  'restoreShortcutName',
  'alwaysOnTop',
  'floatingBounds',
  'controlsVisible',
]);

const MAX_DEVICE_PREFS = 32;
const VALID_THEMES = new Set(['claro', 'oscuro', 'lavanda', 'oceano', 'sistema']);
const VALID_SIZES = new Set(['pequeño', 'mediano', 'grande']);
const VALID_DISPLAY_MODES = new Set(['dual', 'aod']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeUdid(udid) {
  if (typeof udid !== 'string') return null;
  const trimmed = udid.trim();
  if (!trimmed || trimmed.length > 128 || FORBIDDEN_KEYS.has(trimmed)) return null;
  return trimmed;
}

function sanitizeShortcutName(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  return trimmed;
}

function sanitizeFloatingBounds(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const {width, height} = value;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
  if (width < 240 || width > 8192 || height < 360 || height > 8192) return undefined;
  return {width: Math.round(width), height: Math.round(height)};
}

function sanitizeDevicePrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clean = {};
  if (VALID_THEMES.has(raw.theme)) clean.theme = raw.theme;
  if (VALID_SIZES.has(raw.size)) clean.size = raw.size;
  if (VALID_DISPLAY_MODES.has(raw.displayMode)) clean.displayMode = raw.displayMode;
  if (typeof raw.autoDimOnConnect === 'boolean') clean.autoDimOnConnect = raw.autoDimOnConnect;
  const dimShortcut = sanitizeShortcutName(raw.dimShortcutName);
  if (dimShortcut !== undefined) clean.dimShortcutName = dimShortcut;
  const restoreShortcut = sanitizeShortcutName(raw.restoreShortcutName);
  if (restoreShortcut !== undefined) clean.restoreShortcutName = restoreShortcut;
  if (typeof raw.alwaysOnTop === 'boolean') clean.alwaysOnTop = raw.alwaysOnTop;
  if (Object.prototype.hasOwnProperty.call(raw, 'floatingBounds')) {
    const bounds = sanitizeFloatingBounds(raw.floatingBounds);
    if (bounds !== undefined) clean.floatingBounds = bounds;
  }
  if (typeof raw.controlsVisible === 'boolean') clean.controlsVisible = raw.controlsVisible;
  return clean;
}

function sanitizeDevicePrefsMap(rawMap, maxDevices = MAX_DEVICE_PREFS) {
  const cleanMap = {};
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return cleanMap;
  const entries = [];
  for (const [key, value] of Object.entries(rawMap)) {
    const udid = normalizeUdid(key);
    if (!udid) continue;
    const clean = sanitizeDevicePrefs(value);
    if (Object.keys(clean).length > 0) entries.push([udid, clean]);
  }
  const limit = Number.isInteger(maxDevices) && maxDevices > 0 ? maxDevices : MAX_DEVICE_PREFS;
  const kept = entries.length > limit ? entries.slice(entries.length - limit) : entries;
  for (const [udid, clean] of kept) cleanMap[udid] = clean;
  return cleanMap;
}

function loadDevicePrefs(store, udid, fallbackPrefs = {}) {
  const base = fallbackPrefs && typeof fallbackPrefs === 'object' ? {...fallbackPrefs} : {};
  const id = normalizeUdid(udid);
  if (!id || !store || typeof store !== 'object' || Array.isArray(store)) return base;
  if (!Object.prototype.hasOwnProperty.call(store, id)) return base;
  const devicePatch = sanitizeDevicePrefs(store[id]);
  return {...base, ...devicePatch};
}

function saveDevicePrefs(store, udid, currentPrefs, maxDevices = MAX_DEVICE_PREFS) {
  const limit = Number.isInteger(maxDevices) && maxDevices > 0 ? maxDevices : MAX_DEVICE_PREFS;
  const id = normalizeUdid(udid);
  if (!id) return sanitizeDevicePrefsMap(store, limit);

  const ordered = [];
  if (store && typeof store === 'object' && !Array.isArray(store)) {
    for (const [key, value] of Object.entries(store)) {
      const norm = normalizeUdid(key);
      if (!norm || norm === id) continue;
      const clean = sanitizeDevicePrefs(value);
      if (Object.keys(clean).length > 0) ordered.push([norm, clean]);
    }
  }

  const entry = sanitizeDevicePrefs(currentPrefs);
  if (Object.keys(entry).length > 0) {
    ordered.push([id, entry]);
  }

  const kept = ordered.length > limit ? ordered.slice(ordered.length - limit) : ordered;
  const next = {};
  for (const [key, value] of kept) next[key] = value;
  return next;
}

function clearDevicePrefs(store, udid) {
  const id = normalizeUdid(udid);
  const next = {};
  if (!store || typeof store !== 'object' || Array.isArray(store)) return next;
  for (const [key, value] of Object.entries(store)) {
    const norm = normalizeUdid(key);
    if (!norm || norm === id) continue;
    const clean = sanitizeDevicePrefs(value);
    if (Object.keys(clean).length > 0) next[norm] = clean;
  }
  return next;
}

module.exports = {
  DEVICE_PREF_KEYS,
  MAX_DEVICE_PREFS,
  normalizeUdid,
  sanitizeDevicePrefs,
  sanitizeDevicePrefsMap,
  loadDevicePrefs,
  saveDevicePrefs,
  clearDevicePrefs,
};
