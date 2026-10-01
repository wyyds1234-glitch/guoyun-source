import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { allowedSource } from '../scripts/export-public-source.mjs';

test('player introductions credit development without exposing private reports or mounting the game', async () => {
  for (const path of ['README.md', 'public/index.html', 'public/download/index.html']) {
    const text = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(text, /ChatGPT/);
    assert.doesNotMatch(text, /docs\/private|REMAINING_ISSUES|欢迎在本仓库 Issues/);
    if (path.endsWith('.html')) assert.doesNotMatch(text, /src=["'][^"']*(?:game\.js|geo-map\.js|cloud-save\.js)/);
  }
});

test('public export excludes private documentation, history, credentials and obsolete installers', () => {
  const installers = new Set(['public/downloads/Guoyun-Setup-0.1.15.exe']);
  for (const path of ['docs/private/README.md', 'docs/private/bug-report-2026-09-30.md', 'docs/REMAINING_ISSUES.md', 'AGENTS.md', '.env', '.dev.vars', '.git/config', '.github/workflows/cloudflare-pages.yml', 'public/downloads/Guoyun-Setup-0.1.9.exe']) assert.equal(allowedSource(path, installers), false, path);
  for (const path of ['public/game.js', 'functions/api/health.js', 'tests/desktop.test.mjs', 'src-tauri/Cargo.toml', 'public/downloads/Guoyun-Setup-0.1.15.exe']) assert.equal(allowedSource(path, installers), true, path);
});
