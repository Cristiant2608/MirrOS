import {useState, useEffect} from 'react';
import enLocale from './locales/en.json';
import esLocale from './locales/es.json';

export function getInitialLang() {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const urlLang = params.get('lang');
    if (urlLang === 'en' || urlLang === 'es') return urlLang;
    const saved = localStorage.getItem('lang');
    if (saved === 'en' || saved === 'es') return saved;
  }
  return 'en';
}

const BACKEND_MESSAGE_PAIRS = [
  ['Conectado', 'Connected'],
  ['Conectando…', 'Connecting…'],
  ['Conectando', 'Connecting'],
  ['Esperando conexión', 'Waiting for connection'],
  ['Esperando iPhone', 'Waiting for iPhone'],
  ['Conecta tu iPhone por USB', 'Connect your iPhone via USB'],
  ['Audio desactivado', 'Audio muted'],
  ['Audio activo', 'Audio active'],
  ['Sesión terminada', 'Session ended'],
  ['Pantalla en reposo · Control activo', 'Screen in standby · Control active'],
  ['Conecta el cable USB y desbloquea el teléfono.', 'Connect the USB cable and unlock your iPhone.'],
  ['Desbloquea el iPhone y pulsa «Confiar» en la pantalla del teléfono.', 'Unlock your iPhone and tap "Trust" on the phone screen.'],
  ['Desbloquea el iPhone y pulsa «Confiar».', 'Unlock your iPhone and tap "Trust".'],
  ['Activa Modo Desarrollador en el iPhone (Ajustes → Privacidad y seguridad → Modo Desarrollador).', 'Enable Developer Mode on your iPhone (Settings → Privacy & Security → Developer Mode).'],
  ['Activa Modo Desarrollador en Ajustes → Privacidad y seguridad.', 'Enable Developer Mode in Settings → Privacy & Security.'],
  ['Buscando tu iPhone…', 'Searching for your iPhone…'],
  ['El iPhone no respondió. Prueba de nuevo.', 'The iPhone did not respond. Please try again.'],
  ['Preparando pantalla e imagen de desarrollo…', 'Preparing screen and developer disk image…'],
  ['Abriendo túnel USB…', 'Opening USB tunnel…'],
  ['Abriendo pantalla del iPhone…', 'Opening iPhone screen…'],
  ['Actualizaciones desde GitHub', 'Updates from GitHub'],
  ['Actualización', 'Update'],
  ['Consulta automáticamente las versiones publicadas en GitHub.', 'Automatically checks for releases published on GitHub.'],
  ['Comprobando GitHub…', 'Checking GitHub…'],
  ['Todavía no hay una versión publicada en GitHub.', 'No published release was found on GitHub yet.'],
  ['GitHub no responde ahora mismo.', 'GitHub is not responding right now.'],
  ['Descargando actualización…', 'Downloading update…'],
  ['Descarga verificada. Lista para instalar al reiniciar.', 'Download verified. Ready to install on restart.'],
  ['La verificación de la descarga falló. No se instalará.', 'Download checksum verification failed. Update will not be installed.'],
  ['Abre el EXE portátil o el AppImage para instalar la actualización.', 'Open the portable EXE or AppImage directly to install updates.'],
  ['Captura guardada.', 'Screenshot saved.'],
  ['Diagnóstico exportado.', 'Diagnostics exported.'],
  ['Despertando iPhone…', 'Waking iPhone…'],
  ['Pegado en el iPhone.', 'Pasted on iPhone.'],
  ['La pantalla se detuvo inesperadamente.', 'The screen stopped unexpectedly.'],
  ['Conecta tu iPhone primero.', 'Connect your iPhone first.'],
  ['No se pudo enviar el gesto. Revisa la conexión.', 'Could not send gesture. Check connection.'],
  ['Se interrumpió el control. Revisa la conexión.', 'Control connection interrupted. Check connection.'],
  ['No se pudo girar el iPhone. Revisa la conexión.', 'Could not rotate the iPhone. Check connection.'],
  ['No se pudo solicitar reposo al iPhone.', 'Could not switch the iPhone to standby mode.'],
  ['No se pudo enviar el gesto al iPhone.', 'Could not send wake gesture to the iPhone.'],
  ['No se pudo liberar cámara y micrófono en el iPhone.', 'Could not release camera and microphone on the iPhone.'],
  ['Cierra primero la app Cámara o micrófono en el iPhone para reanudar la pantalla.', 'Close the Camera or microphone app on the iPhone first to resume screen mirroring.'],
  ['No se pudo reanudar la transmisión de pantalla.', 'Could not resume screen mirroring.'],
  ['No se pudo cambiar el aspecto en el iPhone.', 'Could not change iOS appearance on the iPhone.'],
  ['No se pudo abrir el selector de aplicaciones.', 'Could not open the app switcher.'],
  ['No se pudo abrir la aplicación en el iPhone.', 'Could not open the application on the iPhone.'],
  ['No se pudo capturar la pantalla del iPhone.', 'Could not capture the iPhone camera viewfinder.'],
  ['No se pudo ejecutar el atajo de atenuación en el iPhone.', 'Could not run the iPhone dim shortcut.'],
  ['No se pudo ejecutar el atajo de restauración en el iPhone.', 'Could not run the iPhone restore shortcut.'],
];

const BACKEND_ES_TO_EN = Object.fromEntries(BACKEND_MESSAGE_PAIRS);
const BACKEND_EN_TO_ES = Object.fromEntries(BACKEND_MESSAGE_PAIRS.map(([es, en]) => [en, es]));

function translateDynamicPattern(text, lang) {
  if (lang === 'en') {
    if (text.includes('Confiar')) return 'Unlock your iPhone and tap "Trust" on the phone screen.';
    if (text.includes('Modo Desarrollador')) return 'Enable Developer Mode on your iPhone (Settings → Privacy & Security → Developer Mode).';
    if (text.includes('cámara o el micrófono')) return 'Camera or microphone is in use on the iPhone. Live viewfinder active.';
    if (text.startsWith('Copiado del iPhone')) return 'Copied from iPhone to PC clipboard.';
    if (text.startsWith('Pegado en el iPhone') || text.startsWith('Enviado al portapapeles del iPhone') || text.startsWith('Copiado al iPhone')) {
      return 'Sent to iPhone clipboard.';
    }
    const upToDateEs = /^Tienes la versión (.+)\.$/.exec(text);
    if (upToDateEs) return `You are on version ${upToDateEs[1]}.`;
    const availableEs = /^Mirr?os (.+) disponible\.$/i.exec(text);
    if (availableEs) return `MirrOS ${availableEs[1]} is available.`;
    return text;
  }

  if (lang === 'es') {
    if (text.includes('"Trust"') || text.includes('Trust on the phone')) return 'Desbloquea el iPhone y pulsa «Confiar» en la pantalla del teléfono.';
    if (text.includes('Developer Mode')) return 'Activa Modo Desarrollador en el iPhone (Ajustes → Privacidad y seguridad → Modo Desarrollador).';
    if (text.includes('camera or microphone')) return 'La cámara o el micrófono están en uso en el iPhone. Visor en vivo activo.';
    if (text.startsWith('Copied to PC')) return 'Copiado del iPhone al portapapeles del PC.';
    if (text.startsWith('Copied to iPhone')) return 'Enviado al portapapeles del iPhone.';
    const upToDateEn = /^You are on version (.+)\.$/.exec(text);
    if (upToDateEn) return `Tienes la versión ${upToDateEn[1]}.`;
    const availableEn = /^Mirr?OS (.+) is available\.$/i.exec(text);
    if (availableEn) return `MirrOS ${availableEn[1]} está disponible.`;
    const installErr = /^Could not start installation: (.+)$/.exec(text);
    if (installErr) return `No se pudo iniciar la instalación: ${installErr[1]}`;
    return text;
  }

  return text;
}

export function translateBackendText(text, lang = 'en') {
  if (!text || typeof text !== 'string') return text;
  if (lang === 'es') {
    return BACKEND_EN_TO_ES[text] || translateDynamicPattern(text, 'es');
  }
  return BACKEND_ES_TO_EN[text] || translateDynamicPattern(text, 'en');
}

function interpolate(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => (vars[key] ?? ''));
}

function buildLocale(raw) {
  return {
    ...raw,
    status: {
      ...raw.status,
      connectedViaUsb: name => interpolate(raw.status.connectedViaUsb, {name}),
      pcAudio: enabled => (enabled ? raw.status.pcAudio.on : raw.status.pcAudio.off),
    },
    notices: {
      ...raw.notices,
      launchingApp: name => interpolate(raw.notices.launchingApp, {name}),
      recordingSaveError: msg => interpolate(raw.notices.recordingSaveError, {msg}),
      recordingStartError: msg => interpolate(raw.notices.recordingStartError, {msg}),
      accessibilityUpdated: (label, on) => interpolate(
        on ? raw.notices.accessibilityUpdated.enabled : raw.notices.accessibilityUpdated.disabled,
        {label},
      ),
      iosStyleApplied: dark => (dark ? raw.notices.iosStyleApplied.dark : raw.notices.iosStyleApplied.light),
      autoDimSaved: enabled => (enabled ? raw.notices.autoDimSaved.enabled : raw.notices.autoDimSaved.disabled),
      switchingDevice: name => interpolate(raw.notices.switchingDevice, {name}),
    },
    preview: {
      ...raw.preview,
      batteryTitle: (cap, charging) => interpolate(raw.preview.batteryTitle, {
        cap,
        charging: charging ? raw.preview.batteryChargingTitleSuffix : '',
      }),
      batteryAria: (cap, charging) => interpolate(raw.preview.batteryAria, {
        cap,
        charging: charging ? raw.preview.batteryChargingAriaSuffix : '',
      }),
    },
    studio: {
      ...raw.studio,
      compatibleBadge: q => interpolate(raw.studio.compatibleBadge, {q}),
    },
    appsModal: {
      ...raw.appsModal,
      title: count => interpolate(raw.appsModal.title, {count}),
      openOnIphone: name => interpolate(raw.appsModal.openOnIphone, {name}),
      copyId: id => interpolate(raw.appsModal.copyId, {id}),
      copyAria: name => interpolate(raw.appsModal.copyAria, {name}),
    },
    inspector: {
      ...raw.inspector,
      switchDeviceAria: name => interpolate(raw.inspector.switchDeviceAria, {name}),
      audioOutputNote: platform => interpolate(raw.inspector.audioOutputNote, {platform}),
      downloadVersion: v => interpolate(raw.inspector.downloadVersion, {v}),
    },
  };
}

export const STRINGS = {
  en: buildLocale(enLocale),
  es: buildLocale(esLocale),
};

export function useLanguage() {
  const [lang, setLangState] = useState(getInitialLang);
  useEffect(() => {
    try {
      localStorage.setItem('lang', lang);
      document.documentElement.lang = lang;
      document.title = STRINGS[lang]?.appTitle || STRINGS.en.appTitle;
    } catch {}
  }, [lang]);
  const setLang = next => setLangState(next === 'es' ? 'es' : 'en');
  const toggleLang = () => setLangState(prev => (prev === 'en' ? 'es' : 'en'));
  const t = STRINGS[lang] || STRINGS.en;
  return {lang, setLang, toggleLang, t};
}
