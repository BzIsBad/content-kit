// Machine checks: cloud-synced folders and free disk space.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Folder names that mean "this is synced to the cloud". Matched against whole path segments,
// case-insensitively. "OneDrive - Company" style names are matched by prefix.
const SYNC_SEGMENTS = [
  { re: /^onedrive( - .*)?$/i, service: 'OneDrive' },
  { re: /^dropbox( \(.*\))?$/i, service: 'Dropbox' },
  { re: /^google ?drive$/i, service: 'Google Drive' },
  { re: /^my drive$/i, service: 'Google Drive' },
  { re: /^googledrive-.*$/i, service: 'Google Drive' },
  { re: /^icloud ?drive$/i, service: 'iCloud Drive' },
  { re: /^mobile documents$/i, service: 'iCloud Drive' },
  { re: /^com~apple~clouddocs$/i, service: 'iCloud Drive' },
  { re: /^box( sync)?$/i, service: 'Box' },
  { re: /^pcloud ?drive$/i, service: 'pCloud' },
  { re: /^sync$/i, service: 'Sync.com' },
  { re: /^mega$/i, service: 'MEGA' },
];

/**
 * Is `dir` inside a cloud-synced folder? Returns { synced: false } or { synced: true, service, reason }.
 * `env`, `home` and `platform` are injectable for tests.
 */
export function cloudSyncCheck(dir, { env = process.env, home = os.homedir(), platform = process.platform, existsFn = fs.existsSync } = {}) {
  const abs = path.resolve(dir);
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  const norm = (p) => (platform === 'win32' ? p.toLowerCase() : p);

  // 1. Known sync roots from the environment (Windows sets these for OneDrive).
  for (const key of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) {
    const root = env[key];
    if (root && isInside(norm(root), norm(abs), pathMod)) {
      return { synced: true, service: 'OneDrive', reason: `it is inside your OneDrive folder (${root})` };
    }
  }

  // 2. macOS keeps third-party sync folders under ~/Library/CloudStorage.
  const cloudStorage = pathMod.join(home, 'Library', 'CloudStorage');
  if (platform === 'darwin' && isInside(cloudStorage, abs, pathMod)) {
    const provider = abs.slice(cloudStorage.length + 1).split(pathMod.sep)[0] || 'a cloud service';
    return { synced: true, service: provider.split('-')[0], reason: `it is inside ${provider}, which syncs to the cloud` };
  }

  // 3. Any path segment that names a sync service.
  for (const seg of abs.split(/[\\/]+/)) {
    for (const s of SYNC_SEGMENTS) {
      if (s.re.test(seg)) return { synced: true, service: s.service, reason: `it is inside a ${s.service} folder ("${seg}")` };
    }
  }

  // 4. macOS "Desktop & Documents in iCloud": the folders stay at ~/Desktop and ~/Documents
  //    but are synced. When that is on, iCloud Drive holds matching Desktop/Documents folders.
  if (platform === 'darwin') {
    const icloud = pathMod.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    for (const name of ['Desktop', 'Documents']) {
      if (isInside(pathMod.join(home, name), abs, pathMod) && existsFn(pathMod.join(icloud, name))) {
        return { synced: true, service: 'iCloud Drive', reason: `your ${name} folder is synced to iCloud` };
      }
    }
  }
  return { synced: false };
}

function isInside(root, p, pathMod) {
  const rel = pathMod.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !pathMod.isAbsolute(rel));
}

/** Free bytes on the volume holding `dir` (or its nearest existing parent). */
export function freeBytes(dir) {
  let p = path.resolve(dir);
  while (!fs.existsSync(p)) {
    const up = path.dirname(p);
    if (up === p) break;
    p = up;
  }
  try {
    const s = fs.statfsSync(p);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export const DISK = Object.freeze({
  minBytes: 5e9, // below this, installs and renders are likely to fail
  comfortableBytes: 20e9, // below this, warn: an hour of 4K footage alone can be 20 GB+
});

export function systemSummary() {
  return {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpus: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1e9),
  };
}
