import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One original SVG is the source of truth. Tauri rasterizes/encodes native
// .icns/.ico sizes; never redraw a different logo for each OS or use a font.
const source = 'public/data/brand/guoyun-icon-v2.svg';
const staging = await mkdtemp(join(tmpdir(), 'guoyun-icons-'));
try {
  const cachedCli = process.env.TAURI_CLI;
  execFileSync(cachedCli ? process.execPath : 'npx',
    [...(cachedCli ? [cachedCli] : ['--yes', '@tauri-apps/cli@2']), 'icon', source, '--output', staging],
    { stdio: 'inherit' });
  for (const file of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.png', 'icon.icns', 'icon.ico']) {
    await copyFile(join(staging, file), join('src-tauri/icons', file));
  }
  await copyFile(source, 'src-tauri/icons/icon.svg');
  await copyFile(source, 'public/favicon.svg');
  await copyFile(source, 'public/icon-192.svg');
  await copyFile(source, 'public/icon-512.svg');
} finally {
  await rm(staging, { recursive: true });
}
