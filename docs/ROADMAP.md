# MirrOS Roadmap

[Español / Documentación](USO.md) · [Changelog](../CHANGELOG.md) · [Releases](https://github.com/Cristiant2608/mirros/releases)

This roadmap tracks planned engineering improvements, packaging channels, and user-facing features for **MirrOS** on **Windows and Linux** (no jailbreak, iOS 17.4+ / iOS 18). Priorities are organized by release horizon and verified constraints.

---

## Overview

| Horizon | Target | Focus | Key Deliverables |
| :--- | :--- | :--- | :--- |
| **Maintenance & Hygiene** | **`v1.3.x`** | Quality, CI stability, docs | English-first backend alignment, `ruff` + link validation in CI, Windows CI test hardening, `docs/ROADMAP.md`, `docs/notes/` archive, Help → Export Diagnostics button |
| **Packaging & Multi-Device** | **`v1.4.0`** | Easy install & multi-iPhone | Native `.deb` release package, `winget` & AUR manifests, SLSA build attestations, visual multi-iPhone USB selector, per-device preferences, PyPI distribution |
| **Performance & Wireless** | **`v1.5.0`** | Lower CPU & local Wi-Fi | Direct `I420` YUV / `VideoFrame` software fallback, adaptive A/V drift correction & Pro Recording controls, opt-in local Wi-Fi discovery (`--wifi`/`--enable-wifi`), community locales (`PT`/`FR`/`DE`) |
| **Pro Ecosystem** | **`v2.0.0`** | Trust & automation | Code-signed Windows portable binary, exploratory macOS desktop support, scriptable CLI/HID QA automation macros |

---

## Detailed Milestones

### `v1.3.x` — Engineering Quality & Modularity (Completed)
- [x] English-first desktop, web, and CLI localization with live `EN` / `ES` toggle (`v1.3.0`)
- [x] Interactive simulated demos & desktop workflow gallery across README and GitHub Pages
- [x] Linux `.deb` packaging target in `electron-builder` + CI release pipeline
- [x] Automated link validation, Python linting (`ruff`), and Dependabot monitoring
- [x] Split [`src/mirros/adapter.py`](../src/mirros/adapter.py) into focused submodules (`adapter_hid.py`, `adapter_media.py`, `adapter_device.py`, `adapter_http.py`)
- [x] Extract frontend locales into `frontend/src/locales/{en,es}.json` and break `App.jsx` into `StudioShell` / `FloatingShell`
- [x] Wire one-click **Export Diagnostic Report** directly inside the desktop Help tab

### `v1.4.0` — Distribution Channels & Multi-Device Workflow
- [x] **Visual multi-device picker:** Detect multiple USB-connected iPhones in Desktop Studio and let users switch active devices live without passing `--udid` in CLI.
- [x] **Per-device persisted presets:** Remember theme, floating size/bounds, physical display mode, auto-dim on connect, and always-on-top state per UDID (stored locally with zero cloud telemetry).
- [x] **Auto-Dim physical OLED screen (opt-in) & Studio responsiveness:** 0% brightness + Reduce White Point via customizable iOS Shortcuts (`MirrOS Dim` / `MirrOS Restore` + `Ctrl + Shift + D`) with safe restore on disconnect, side-rail battery telemetry, and zero-lag Studio window pointer updates.
- [x] **Native packaging manifests & SLSA attestations:** Debian `.deb` release asset, `winget` manifest, AUR `PKGBUILD`, and verifiable SLSA build provenance attestations alongside `SHA256SUMS.txt`.
- [ ] **PyPI distribution:** Publish Python wheel/sdist to PyPI (`pip install mirros` / `uv tool install mirros`).

### `v1.5.0` — Rendering Efficiency, Audio/Video Sync & Community i18n (Completed)
- [x] **Direct `I420` YUV / `VideoFrame` software fallback:** Direct `I420` YUV frame upload into WebCodecs `VideoFrame` in Chromium, eliminating JPEG encode/decode overhead when software decoding is active.
- [x] **Adaptive A/V drift correction & Pro Recording controls:** Coordinated frame timestamps and `audio-worklet.js` adaptive drift correction alongside Pro Recording controls (format, bitrate, and iPhone audio mix toggle) for up to 60 FPS captures.
- [x] **Opt-in local Wi-Fi discovery (`--wifi` / `--enable-wifi`):** Guided, opt-in workflow via `pymobiledevice3` `tunneld` for USB-paired iPhones on trusted local networks.
- [x] **Community UI locales (`PT` / `FR` / `DE`):** Full JSON localization parity for Portuguese, French, and German alongside English and Spanish (additional languages such as Japanese welcome via community PRs).

### `v2.0.0` — Trusted Binaries & Cross-Platform Expansion
- **Signed Windows executables:** Authenticode code signing for `Mirros-*-Windows.exe` building on the existing `SHA256SUMS.txt` digests and SLSA provenance attestations.
- **macOS support exploration:** Native Apple Silicon / Intel packaging parity while keeping Linux and Windows as first-class targets.
- **Scriptable HID / QA hooks:** Deterministic touch/key playback helpers for iOS app testing and automated demos.

---

## What Remains Explicitly Research-Only

MirrOS follows strict technical transparency and only ships capabilities backed by reproducible testing on real USB iOS devices:

- **Interactive mirroring with the iPhone screen physically powered completely off:** `CoreDevice` / `DisplayService` does not expose a supported USB path to power off the OLED panel completely while keeping touch input and frame capture alive (see [`MEJORAS.md`](MEJORAS.md)). Instead of claiming hardware panel shutoff, MirrOS provides opt-in **0% Brightness + Reduce White Point** automation via iOS Shortcuts (`MirrOS Dim` / `MirrOS Restore`) that keeps the PC stream at 100% brightness and restores the phone on disconnect, alongside AOD / Standby Mode.
- **Concurrent unrestricted sensor capture:** Camera/microphone access continues to isolate cleanly via DVT viewfinder + CoreDevice 9022 release rather than bypassing OS privacy hardware indicators.

Have an idea or want to contribute? Open a [Feature Request](https://github.com/Cristiant2608/mirros/issues/new?template=feature_request.yml) or read [`CONTRIBUTING.md`](../CONTRIBUTING.md).
