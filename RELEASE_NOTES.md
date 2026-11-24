# MirrOS 1.4.0

Open-source iPhone screen mirroring, real-time audio streaming, 60 FPS screen recording, and USB HID control for Windows and Linux (`scrcpy` for iOS 17.4+ / iOS 18+).

## Downloads / Descargas

- **Windows x64:** `Mirros-1.4.0-Windows.exe` — Portable executable: download and run.
- **Linux x64 (AppImage):** `Mirros-1.4.0-Linux-x64.AppImage` — Portable AppImage: make executable (`chmod +x`) and run.
- **Linux x64 (Debian / Ubuntu):** `Mirros-1.4.0-Linux-x64.deb` — Native `.deb` package (`sudo apt install ./Mirros-1.4.0-Linux-x64.deb`).
- **Source Code:** `Mirros-1.4.0-Source.zip` — Generated from the verified release tag.
- **Checksums:** `SHA256SUMS.txt` — SHA-256 digests for all release artifacts.

Standalone packages bundle Electron, Python, and the MirrOS backend. Neither Python nor Node.js needs to be installed on the target machine.

## What's New in 1.4.0 / Novedades en 1.4.0

- **Auto-Dim Physical OLED Screen (0% Brightness + Reduce White Point):** Opt-in iOS Shortcuts integration (`MirrOS Dim` / `MirrOS Restore`) triggered automatically on connect and restored before closing the USB tunnel on disconnect (`/screen-dim`, `/session/end`), keeping 100% PC stream brightness while the physical iPhone screen dims nearly pitch black — plus an optional iOS automation safety net for sudden cable unplugs.
- **Visual Multi-iPhone USB Switcher & Per-Device Local Presets:** Live USB device picker right inside Desktop Studio to switch between multiple plugged-in iPhones without `--udid`, paired with local per-UDID saved presets (`theme`, `size`, `displayMode`, `autoDimOnConnect`, `alwaysOnTop`, `floatingBounds`, `controlsVisible`) and 1-click preset reset.
- **Window Mode Responsiveness & Floating Battery Rail:** Eliminates Studio window hover lag via `ref` + `requestAnimationFrame` cursor updates, `React.memo` on `InspectorContent`, cached `DOMRect` and 750 ms throttled `detectContentCrop`, CSS `contain` isolation, removal of heavy backdrop/shadow filters, disabled Linux CSD window shadows, and moves live battery telemetry cleanly into the `.phone-controls` side rail.
- **Native Linux `.deb` Package & Backend/Frontend Modularity:** Adds `.deb` packages alongside `.AppImage` and Windows `.exe`, splits `src/mirros/adapter.py` into focused submodules (`adapter_hid.py`, `adapter_media.py`, `adapter_device.py`, `adapter_http.py`), externalizes locales into `frontend/src/locales/{en,es}.json`, and separates `StudioShell` and `FloatingShell`.

## System Requirements / Requisitos

- Unlocked iPhone with a USB data cable, **"Trust This Computer"** accepted, and **Developer Mode** enabled (*Settings → Privacy & Security → Developer Mode*).
- **iOS 17.4 or newer** (including iOS 18+) for userspace USB tunneling.
- **Windows:** *Apple Mobile Device Service* (via Apple Devices or iTunes).
- **Linux:** `usbmuxd` service (`sudo systemctl start usbmuxd`); `wl-clipboard` on Wayland for cross-app clipboard sharing.
