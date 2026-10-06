import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function createReleaseManifest(directory, version, publishedAt = new Date().toISOString()) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const platform = name => {
    const asset = `/downloads/${name}`;
    const bytes = readFileSync(join(directory, asset));
    if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error('Installer exceeds Pages asset limit');
    return { available: true, asset, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const mac = platform(`Guoyun-${version}-arm64.dmg`);
  const windows = platform(`Guoyun-Setup-${version}.exe`);
  return { version, mac_arm64_url: mac.asset, windows_x64_url: windows.asset, mac_size: mac.size, windows_size: windows.size,
    published_at: publishedAt, platforms: { mac_arm64: mac, windows_x64: windows } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [directory, version] = process.argv.slice(2);
  if (!directory || !version) throw new Error('Usage: node scripts/release-manifest.mjs <public-directory> <version>');
  writeFileSync(join(directory, 'downloads/latest.json'), JSON.stringify(createReleaseManifest(directory, version), null, 2) + '\n');
}
