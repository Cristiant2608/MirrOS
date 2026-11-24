import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseChecksumsText,
  readPyprojectVersion,
  renderAurPkgbuild,
  renderWingetInstallerManifest,
  renderWingetLocaleManifest,
  renderWingetVersionManifest,
} from '../scripts/update-packaging.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const SAMPLE_WIN_SHA = '9a2db0ab3cbe63dcd6c73f6667551609d150a7f30f54e2619078b83600e58208';
const SAMPLE_DEB_SHA = '79c0d5a8ce8d49680ed70a10f0136ecf14357d7d3c62c0086b66507ebbe018ef';

test('renderAurPkgbuild renders exact AUR metadata, URL, and SHA-256', () => {
  const pkgbuild = renderAurPkgbuild({
    version: '1.4.0',
    debSha256: SAMPLE_DEB_SHA.toUpperCase(),
  });

  assert.match(pkgbuild, /^pkgname=mirros-bin$/m);
  assert.match(pkgbuild, /^pkgver=1\.4\.0$/m);
  assert.match(pkgbuild, /^license=\('MIT'\)$/m);
  assert.match(pkgbuild, /^depends=\('usbmuxd' 'gtk3' 'nss' 'alsa-lib'\)$/m);
  assert.match(pkgbuild, /^optdepends=\('wl-clipboard: Wayland clipboard sync'\)$/m);
  assert.match(
    pkgbuild,
    /^source=\("https:\/\/github\.com\/Cristiant2608\/MirrOS\/releases\/download\/v\$\{pkgver\}\/Mirros-\$\{pkgver\}-Linux-x64\.deb"\)$/m
  );
  assert.match(pkgbuild, new RegExp(`^sha256sums=\\('${SAMPLE_DEB_SHA}'\\)$`, 'm'));
});

test('renderAurPkgbuild defaults to SKIP when debSha256 is omitted', () => {
  const pkgbuild = renderAurPkgbuild({ version: '2.0.0' });
  assert.match(pkgbuild, /^pkgver=2\.0\.0$/m);
  assert.match(pkgbuild, /^sha256sums=\('SKIP'\)$/m);
});

test('renderWingetVersionManifest renders valid 1.6.0 version manifest', () => {
  const manifest = renderWingetVersionManifest({ version: '1.4.0' });
  assert.match(manifest, /^PackageIdentifier: Cristiant2608\.MirrOS$/m);
  assert.match(manifest, /^PackageVersion: 1\.4\.0$/m);
  assert.match(manifest, /^DefaultLocale: en-US$/m);
  assert.match(manifest, /^ManifestType: version$/m);
  assert.match(manifest, /^ManifestVersion: 1\.6\.0$/m);
});

test('renderWingetInstallerManifest renders portable x64 installer with uppercase SHA-256', () => {
  const manifest = renderWingetInstallerManifest({
    version: '1.4.0',
    winSha256: SAMPLE_WIN_SHA,
  });

  assert.match(manifest, /^PackageIdentifier: Cristiant2608\.MirrOS$/m);
  assert.match(manifest, /^PackageVersion: 1\.4\.0$/m);
  assert.match(manifest, /^InstallerType: portable$/m);
  assert.match(manifest, /^Commands:\n  - mirros$/m);
  assert.match(manifest, /^  - Architecture: x64$/m);
  assert.match(
    manifest,
    /^    InstallerUrl: https:\/\/github\.com\/Cristiant2608\/MirrOS\/releases\/download\/v1\.4\.0\/Mirros-1\.4\.0-Windows\.exe$/m
  );
  assert.match(
    manifest,
    new RegExp(`^    InstallerSha256: ${SAMPLE_WIN_SHA.toUpperCase()}$`, 'm')
  );
  assert.match(manifest, /^ManifestType: installer$/m);
  assert.match(manifest, /^ManifestVersion: 1\.6\.0$/m);
});

test('renderWingetInstallerManifest falls back to 64-zero hex placeholder when SHA-256 is omitted', () => {
  const manifest = renderWingetInstallerManifest({ version: '1.4.0' });
  assert.match(manifest, new RegExp(`^    InstallerSha256: ${'0'.repeat(64)}$`, 'm'));
});

test('renderWingetLocaleManifest renders MIT locale metadata, description, and tags', () => {
  const manifest = renderWingetLocaleManifest({ version: '1.4.0' });

  assert.match(manifest, /^PackageIdentifier: Cristiant2608\.MirrOS$/m);
  assert.match(manifest, /^PackageVersion: 1\.4\.0$/m);
  assert.match(manifest, /^PackageLocale: en-US$/m);
  assert.match(manifest, /^Publisher: Cristiant2608$/m);
  assert.match(manifest, /^PackageName: MirrOS$/m);
  assert.match(manifest, /^License: MIT$/m);
  assert.match(manifest, /^ShortDescription: .+$/m);
  assert.match(manifest, /^Description: >-$/m);
  assert.match(manifest, /^Tags:\n  - ios$/m);
  assert.match(
    manifest,
    /^ReleaseNotesUrl: https:\/\/github\.com\/Cristiant2608\/MirrOS\/releases\/tag\/v1\.4\.0$/m
  );
  assert.match(manifest, /^ManifestType: defaultLocale$/m);
  assert.match(manifest, /^ManifestVersion: 1\.6\.0$/m);
});

test('parseChecksumsText extracts asset digests cleanly', () => {
  const parsed = parseChecksumsText(
    `${SAMPLE_WIN_SHA}  Mirros-1.4.0-Windows.exe\n${SAMPLE_DEB_SHA}  Mirros-1.4.0-Linux-x64.deb\n`
  );
  assert.equal(parsed['Mirros-1.4.0-Windows.exe'], SAMPLE_WIN_SHA);
  assert.equal(parsed['Mirros-1.4.0-Linux-x64.deb'], SAMPLE_DEB_SHA);
});

test('committed packaging manifests exist and match pyproject.toml version', () => {
  const version = readPyprojectVersion(ROOT);

  const pkgbuildPath = path.join(ROOT, 'packaging', 'aur', 'PKGBUILD');
  const versionManifestPath = path.join(ROOT, 'packaging', 'winget', 'Cristiant2608.MirrOS.yaml');
  const installerManifestPath = path.join(
    ROOT,
    'packaging',
    'winget',
    'Cristiant2608.MirrOS.installer.yaml'
  );
  const localeManifestPath = path.join(
    ROOT,
    'packaging',
    'winget',
    'Cristiant2608.MirrOS.locale.en-US.yaml'
  );

  for (const filePath of [
    pkgbuildPath,
    versionManifestPath,
    installerManifestPath,
    localeManifestPath,
  ]) {
    assert.ok(fs.existsSync(filePath), `Expected manifest file to exist: ${filePath}`);
  }

  const pkgbuild = fs.readFileSync(pkgbuildPath, 'utf8');
  const versionManifest = fs.readFileSync(versionManifestPath, 'utf8');
  const installerManifest = fs.readFileSync(installerManifestPath, 'utf8');
  const localeManifest = fs.readFileSync(localeManifestPath, 'utf8');

  assert.match(pkgbuild, new RegExp(`^pkgver=${version.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(pkgbuild, /^sha256sums=\('[0-9a-f]{64}'\)$/m);

  assert.match(versionManifest, new RegExp(`^PackageVersion: ${version.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(installerManifest, new RegExp(`^PackageVersion: ${version.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(
    installerManifest,
    new RegExp(
      `^    InstallerUrl: https://github\\.com/Cristiant2608/MirrOS/releases/download/v${version.replace(/\./g, '\\.')}/Mirros-${version.replace(/\./g, '\\.')}-Windows\\.exe$`,
      'm'
    )
  );
  assert.match(installerManifest, /^    InstallerSha256: [0-9A-F]{64}$/m);
  assert.match(localeManifest, new RegExp(`^PackageVersion: ${version.replace(/\./g, '\\.')}$`, 'm'));
});
