#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

const REPO_URL = 'https://github.com/Cristiant2608/MirrOS';
const PACKAGE_IDENTIFIER = 'Cristiant2608.MirrOS';
const PLACEHOLDER_SHA256 = '0'.repeat(64);
const SHA256_RE = /^[0-9a-fA-F]{64}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function assertValidVersion(version) {
  if (typeof version !== 'string' || !VERSION_RE.test(version.trim())) {
    throw new Error(`Invalid version: ${String(version)}`);
  }
  return version.trim();
}

function normalizeAurSha256(sha256) {
  if (sha256 == null || sha256 === '' || sha256 === 'SKIP') {
    return 'SKIP';
  }
  const value = String(sha256).trim();
  if (!SHA256_RE.test(value)) {
    throw new Error(`Invalid DEB SHA-256 checksum: ${value}`);
  }
  return value.toLowerCase();
}

function normalizeWingetSha256(sha256) {
  if (sha256 == null || sha256 === '') {
    return PLACEHOLDER_SHA256;
  }
  const value = String(sha256).trim();
  if (!SHA256_RE.test(value)) {
    throw new Error(`Invalid Windows SHA-256 checksum: ${value}`);
  }
  return value.toUpperCase();
}

export function readPyprojectVersion(rootDir = DEFAULT_ROOT) {
  const pyprojectPath = path.join(rootDir, 'pyproject.toml');
  const content = fs.readFileSync(pyprojectPath, 'utf8');
  const projectBlockMatch = content.match(/\[project\]([\s\S]*?)(?:\n\[|$)/);
  const scope = projectBlockMatch ? projectBlockMatch[1] : content;
  const versionMatch = scope.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!versionMatch) {
    throw new Error(`Could not find [project] version in ${pyprojectPath}`);
  }
  return assertValidVersion(versionMatch[1]);
}

export function parseChecksumsText(text) {
  const result = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!match) continue;
    const [, digest, fileName] = match;
    result[fileName.trim()] = digest.toLowerCase();
  }
  return result;
}

export function renderAurPkgbuild({ version, debSha256 = 'SKIP' }) {
  const pkgver = assertValidVersion(version);
  const checksum = normalizeAurSha256(debSha256);
  return [
    `# Maintainer: Cristiant2608 <${REPO_URL}>`,
    'pkgname=mirros-bin',
    `pkgver=${pkgver}`,
    'pkgrel=1',
    'pkgdesc="Open-source iPhone screen mirroring, audio streaming, screen recording, and USB HID control for Windows and Linux (scrcpy for iOS)"',
    "arch=('x86_64')",
    `url="${REPO_URL}"`,
    "license=('MIT')",
    "depends=('usbmuxd' 'gtk3' 'nss' 'alsa-lib')",
    "optdepends=('wl-clipboard: Wayland clipboard sync')",
    "provides=('mirros')",
    "conflicts=('mirros')",
    "options=('!strip')",
    `source=("${REPO_URL}/releases/download/v\${pkgver}/Mirros-\${pkgver}-Linux-x64.deb")`,
    `sha256sums=('${checksum}')`,
    '',
    'package() {',
    '  bsdtar -xf "${srcdir}/data.tar."* -C "${pkgdir}/"',
    '  if [ -f "${pkgdir}/opt/Mirros/mirros" ] && [ ! -e "${pkgdir}/usr/bin/mirros" ]; then',
    '    install -dm755 "${pkgdir}/usr/bin"',
    '    ln -s /opt/Mirros/mirros "${pkgdir}/usr/bin/mirros"',
    '  fi',
    '}',
    '',
  ].join('\n');
}

export function renderWingetVersionManifest({ version }) {
  const packageVersion = assertValidVersion(version);
  return [
    '# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json',
    `PackageIdentifier: ${PACKAGE_IDENTIFIER}`,
    `PackageVersion: ${packageVersion}`,
    'DefaultLocale: en-US',
    'ManifestType: version',
    'ManifestVersion: 1.6.0',
    '',
  ].join('\n');
}

export function renderWingetInstallerManifest({ version, winSha256 }) {
  const packageVersion = assertValidVersion(version);
  const installerSha256 = normalizeWingetSha256(winSha256);
  const installerUrl = `${REPO_URL}/releases/download/v${packageVersion}/Mirros-${packageVersion}-Windows.exe`;
  return [
    '# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json',
    `PackageIdentifier: ${PACKAGE_IDENTIFIER}`,
    `PackageVersion: ${packageVersion}`,
    'InstallerType: portable',
    'Commands:',
    '  - mirros',
    'Installers:',
    '  - Architecture: x64',
    `    InstallerUrl: ${installerUrl}`,
    `    InstallerSha256: ${installerSha256}`,
    'ManifestType: installer',
    'ManifestVersion: 1.6.0',
    '',
  ].join('\n');
}

export function renderWingetLocaleManifest({ version }) {
  const packageVersion = assertValidVersion(version);
  return [
    '# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json',
    `PackageIdentifier: ${PACKAGE_IDENTIFIER}`,
    `PackageVersion: ${packageVersion}`,
    'PackageLocale: en-US',
    'Publisher: Cristiant2608',
    'PublisherUrl: https://github.com/Cristiant2608',
    `PublisherSupportUrl: ${REPO_URL}/issues`,
    'PackageName: MirrOS',
    `PackageUrl: ${REPO_URL}`,
    'License: MIT',
    `LicenseUrl: ${REPO_URL}/blob/main/LICENSE`,
    'ShortDescription: Open-source iPhone screen mirroring, audio streaming, screen recording, and USB HID control for Windows and Linux.',
    'Description: >-',
    '  MirrOS (scrcpy for iOS) provides low-latency iPhone screen mirroring,',
    '  system audio streaming, screen recording, clipboard sync, and USB HID',
    '  mouse and keyboard control for Windows and Linux.',
    'Moniker: mirros',
    'Tags:',
    '  - ios',
    '  - iphone',
    '  - mirroring',
    '  - screen-mirroring',
    '  - scrcpy',
    '  - usb',
    '  - hid',
    `ReleaseNotesUrl: ${REPO_URL}/releases/tag/v${packageVersion}`,
    'ManifestType: defaultLocale',
    'ManifestVersion: 1.6.0',
    '',
  ].join('\n');
}

export function writePackagingManifests({
  rootDir = DEFAULT_ROOT,
  version,
  winSha256,
  debSha256,
}) {
  const resolvedVersion = version ? assertValidVersion(version) : readPyprojectVersion(rootDir);
  const outputs = [
    {
      path: path.join(rootDir, 'packaging', 'aur', 'PKGBUILD'),
      content: renderAurPkgbuild({ version: resolvedVersion, debSha256 }),
    },
    {
      path: path.join(rootDir, 'packaging', 'winget', `${PACKAGE_IDENTIFIER}.yaml`),
      content: renderWingetVersionManifest({ version: resolvedVersion }),
    },
    {
      path: path.join(rootDir, 'packaging', 'winget', `${PACKAGE_IDENTIFIER}.installer.yaml`),
      content: renderWingetInstallerManifest({ version: resolvedVersion, winSha256 }),
    },
    {
      path: path.join(rootDir, 'packaging', 'winget', `${PACKAGE_IDENTIFIER}.locale.en-US.yaml`),
      content: renderWingetLocaleManifest({ version: resolvedVersion }),
    },
  ];

  for (const output of outputs) {
    fs.mkdirSync(path.dirname(output.path), { recursive: true });
    fs.writeFileSync(output.path, output.content, 'utf8');
  }
  return outputs.map((o) => o.path);
}

function parseArgs(argv) {
  const args = {
    rootDir: DEFAULT_ROOT,
    version: null,
    checksumsPath: null,
    winSha256: null,
    debSha256: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
    } else if (token === '--version') {
      args.version = argv[++i];
    } else if (token === '--checksums') {
      args.checksumsPath = argv[++i];
    } else if (token === '--win-sha256') {
      args.winSha256 = argv[++i];
    } else if (token === '--deb-sha256') {
      args.debSha256 = argv[++i];
    } else if (token === '--root') {
      args.rootDir = path.resolve(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      'Usage: node scripts/update-packaging.mjs [--version X.Y.Z] [--checksums SHA256SUMS.txt|-] [--win-sha256 HEX] [--deb-sha256 HEX|SKIP]'
    );
    return;
  }

  const version = args.version ? assertValidVersion(args.version) : readPyprojectVersion(args.rootDir);
  let checksums = {};
  if (args.checksumsPath) {
    const text =
      args.checksumsPath === '-'
        ? fs.readFileSync(0, 'utf8')
        : fs.readFileSync(args.checksumsPath, 'utf8');
    checksums = parseChecksumsText(text);
  }

  const winAsset = `Mirros-${version}-Windows.exe`;
  const debAsset = `Mirros-${version}-Linux-x64.deb`;
  const winSha256 = args.winSha256 ?? checksums[winAsset] ?? null;
  const debSha256 = args.debSha256 ?? checksums[debAsset] ?? 'SKIP';

  const written = writePackagingManifests({
    rootDir: args.rootDir,
    version,
    winSha256,
    debSha256,
  });

  for (const filePath of written) {
    console.log(`Updated ${path.relative(args.rootDir, filePath)}`);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  try {
    runCli();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
