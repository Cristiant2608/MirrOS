# Usage Guide (`v1.4.0`)

[Versión en español (USO.md)](USO.md)

MirrOS lets you mirror, record, and control your iPhone over USB from Windows or Linux without jailbreak or App Store companion apps.

![MirrOS Desktop Studio interactive demo](screenshots/mirros-demo.gif)

> *All screenshots and animated previews in this guide use a simulated iPhone screen and contain no personal device data.*

## Requirements

- **PC:** Windows 10/11 or Linux (x86_64) with USB data access (`usbmuxd` on Linux, Apple Devices or iTunes USB driver on Windows).
- **iPhone:** iOS 17 or newer, unlocked over a data-capable USB cable, with **Developer Mode** enabled (`Settings → Privacy & Security → Developer Mode`).
- **Source setup:** Chromium / Microsoft Edge / Chrome (or Electron via `pnpm run desktop`) plus Python 3.10+.

## First-Time USB Setup

1. Connect your iPhone to your PC with a USB data cable.
2. Unlock the iPhone and tap **Trust** when prompted.
3. Enable **Developer Mode** under `Settings → Privacy & Security → Developer Mode` and restart the phone if requested.
4. Launch **MirrOS** (desktop app or `mirros` CLI). On first connection, MirrOS automatically mounts the iOS Developer Disk Image (DDI) over USB.

## Desktop & Floating UI (`v1.4.0`)

MirrOS opens directly in a **compact floating phone window** with a collapsible side control rail so you can keep your iPhone beside an editor, browser, or terminal:

![Floating borderless phone workflow over desktop editor and terminal](screenshots/floating-usage.gif)

![Floating phone pinned side-by-side in a developer workspace](screenshots/desktop-workflow.png)

- **Top titlebar:** drag handle, device status indicator, minimize/maximize/fullscreen (`F11`), `EN / ES` language toggle, and close button.
- **Docked control rail:** collapse/expand tab, live battery telemetry indicator (kept cleanly off the mirrored phone screen), swipe left/right, Home (`Ctrl+H`), App Switcher (`Ctrl+M`), Control Center, Notification Center, rotate view (`90°`), fit height, open **Studio Panel**, pin always-on-top, PC audio mute, iPhone mute, screenshot (`Ctrl+P`), screen & audio recording (`Ctrl+Shift+R`), camera/microphone live viewfinder toggle, AOD / Standby mode, Wake (`Ctrl+U`), Lock (`Ctrl+L`), and safe disconnect.
- **Studio Panel:** expands the full sidebar workspace with **Screen**, **Audio**, **Clipboard**, **Appearance**, and **Help** tabs (plus the live **Multi-iPhone USB switcher**, installed app launcher modal, and one-click private diagnostics export).

## Multi-iPhone USB Switcher & Per-Device Presets

When multiple iPhones are connected over USB, open the **Device** section in Desktop Studio to pick or switch active devices live without restarting or passing `--udid` in the CLI.

MirrOS automatically remembers local per-device (per-UDID) preferences with zero cloud telemetry, including **theme**, **floating window size & bounds**, **physical display mode**, **Auto-Dim on Connect**, and **always-on-top** state.

## Auto-Dim Physical Screen (0% Brightness + Reduce White Point via iOS Shortcuts)

Apple's USB `CoreDevice` transport does not expose a native API to power off the OLED panel completely while keeping touch input and screen capture alive. As an opt-in alternative, MirrOS supports **Auto-Dim Physical Screen**, which dims your iPhone to **0% brightness + Reduce White Point** while keeping the mirrored PC video at **100% brightness**, and automatically restores brightness before closing the USB tunnel on disconnect.

### 1. Create Two iOS Shortcuts on Your iPhone

Open Apple's **Shortcuts** app and create two shortcuts with these exact names:

1. **`MirrOS Dim`**
   - **Set Brightness** → `0%`
   - **Set White Point** → `Turn On`
2. **`MirrOS Restore`**
   - **Set White Point** → `Turn Off`
   - **Set Brightness** → your preferred normal level (for example, `50%`)

### 2. Enable Auto-Dim in MirrOS

In Desktop Studio, go to **Screen → Physical Display Mode** and enable **Auto-Dim on Connect** (you can also trigger dim/restore manually). MirrOS runs `MirrOS Dim` once connected and triggers `MirrOS Restore` cleanly during safe disconnect (`/session/end`).

### 3. Optional Safety Automation for Sudden Cable Unplugs

If the USB cable is unplugged abruptly before MirrOS can send the restore command, iOS can restore your screen automatically:

1. Open **Shortcuts → Automation → +** on your iPhone.
2. Choose **Charger** → **Is Disconnected** → **Run Immediately**.
3. Select the **`MirrOS Restore`** shortcut.

| Mode / Tab | Preview |
| :--- | :--- |
| **Studio Workspace** | ![MirrOS Studio Screen View](screenshots/pantalla.png) |
| **Floating Side Rail** | ![Floating phone with expanded controls](screenshots/telefono-flotante.png) |
| **Landscape Floating Mode** | ![Landscape floating phone view](screenshots/telefono-horizontal.png) |
| **Real-Time USB Audio** | ![MirrOS Audio settings tab](screenshots/audio.png) |
| **Clipboard Sync** | ![MirrOS Clipboard transfer tab](screenshots/portapapeles.png) |
| **Appearance, Themes & Language** | ![MirrOS Appearance and EN/ES settings](screenshots/apariencia.png) |

## Keyboard & Mouse Shortcuts

| Action | Shortcut / Input |
| :--- | :--- |
| Tap | Left click on phone screen |
| Swipe / Drag | Click and drag |
| Scroll | Mouse wheel |
| Go Home | Right click or `Ctrl + H` |
| App Switcher | `Ctrl + M` |
| Wake iPhone | `Ctrl + U` |
| Lock / Standby | `Ctrl + L` |
| Save Screenshot (PNG) | `Ctrl + P` |
| Start / Stop Recording (WebM/MP4) | `Ctrl + Shift + R` |
| Fullscreen | `F11` |
| Select All / Cut / Undo (on iPhone) | `Ctrl + A` / `Ctrl + X` / `Ctrl + Z` |
| Clipboard Sync | Standard copy & paste over focused phone view (or manual sync buttons in Studio) |

## Command-Line Interface (`mirros` / `ios-scrcpy`)

```bash
# Default compact floating view (English UI)
mirros

# Open directly in full Studio layout
mirros --studio

# Launch UI in Spanish
mirros --lang es

# Enable PCM audio streaming on startup
mirros --audio

# Force software decoding fallback (recommended on Linux without HEVC hardware support)
mirros --force-software --video-quality balanced

# Specify iPhone UDID, port, or browser executable
mirros --udid <UDID> --port 8080 --browser chromium

# Installed app helpers & diagnostics
mirros --list-apps
mirros --app-switcher
mirros --launch-app com.apple.Preferences
mirros --diagnose
```

For Linux hardware decode & optimization notes, see [OPTIMIZACION.md](OPTIMIZACION.md).
