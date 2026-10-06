import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReleaseManifest } from '../scripts/release-manifest.mjs';
import { publicSourceContent, exportPublicSource } from '../scripts/export-public-source.mjs';

const source = readFileSync(new URL('../public/download/download.js', import.meta.url), 'utf8').replace(/loadReleaseManifest\(\);\s*$/, '');
const bytes = new TextEncoder().encode('valid installer bytes');
const release = {url: '/downloads/Guoyun-Setup-1.0.0.exe', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
function client(payload = bytes, status = 200) {
  let requests = 0;
  const context = vm.createContext({ document: {querySelectorAll: () => [], querySelector: () => ({})}, URL, Blob, AbortSignal,
    location: {origin: 'https://example.com'}, crypto: webcrypto,
    fetch: async () => { requests++; return new Response(payload, {status, headers: {'content-type': 'application/octet-stream'}}); } });
  vm.runInContext(source, context);
  return {verify: context.verifiedInstallerBlob, requests: () => requests};
}
test('download returns exactly the verified bytes with no second fetch', async () => {
  const c = client();
  const blob = await c.verify(release);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  assert.equal(c.requests(), 1);
});
test('same-size tampering, truncation, overflow and missing assets fail closed', async () => {
  const altered = bytes.slice(); altered[0] ^= 1;
  for (const payload of [altered, bytes.slice(1), new Uint8Array(bytes.length + 1)]) await assert.rejects(client(payload).verify(release));
  await assert.rejects(client(bytes, 404).verify(release));
});
test('invalid hashes, external URLs and oversized metadata fail before fetching', async () => {
  for (const change of [{sha256: undefined}, {sha256: 'invalid'}, {url: 'https://attacker.example/app.exe'}, {size: 26 * 1024 * 1024}]) {
    const c = client(); await assert.rejects(c.verify({...release, ...change})); assert.equal(c.requests(), 0);
  }
});
test('release builder hashes each shipped platform file and rejects missing files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guoyun-release-test-'));
  try {
    mkdirSync(join(directory, 'downloads'));
    for (const name of ['Guoyun-1.0.0-arm64.dmg', 'Guoyun-Setup-1.0.0.exe']) writeFileSync(join(directory, 'downloads', name), bytes);
    const manifest = createReleaseManifest(directory, '1.0.0');
    for (const platform of Object.values(manifest.platforms)) assert.equal(platform.sha256, release.sha256);
    rmSync(join(directory, 'downloads', 'Guoyun-Setup-1.0.0.exe'));
    assert.throws(() => createReleaseManifest(directory, '1.0.0'));
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
test('public source export removes production commands and database identities', () => {
  const pkg = JSON.parse(publicSourceContent('package.json', readFileSync(new URL('../package.json', import.meta.url), 'utf8')));
  for (const key of ['deploy', 'deploy:preview', 'db:migrate:remote', 'db:migrate:preview']) assert.equal(pkg.scripts[key], undefined);
  assert.ok(pkg.scripts.dev);
  const config = JSON.parse(publicSourceContent('wrangler.jsonc', readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')));
  assert.equal(config.name, 'guoyun-local'); assert.equal(config.env, undefined);
  assert.ok(config.d1_databases.every(binding => binding.database_id === '00000000-0000-0000-0000-000000000000'));
});
test('all workflow actions use immutable commits and release jobs require the private repository', () => {
  const workflow = readFileSync(new URL('../.github/workflows/tauri-release.yml', import.meta.url), 'utf8');
  for (const [, action] of workflow.matchAll(/uses:\s+(\S+)/g)) assert.match(action, /@[a-f0-9]{40}$/);
  for (const [, job] of workflow.split('jobs:\n')[1].matchAll(/^  ([\w-]+):$/gm)) assert.ok(workflow.includes(`  ${job}:\n    if: github.repository == 'wyyds1234-glitch/guoyun'`));
});
test('source export preserves installer and binary asset bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'guoyun-export-test-'));
  const input = join(directory, 'source'); const output = join(directory, 'export');
  const binary = Buffer.from([0, 255, 254, 128, 42]);
  try {
    mkdirSync(join(input, 'public/downloads'), {recursive: true});
    writeFileSync(join(input, 'public/downloads/latest.json'), JSON.stringify({platforms: {windows_x64: {available: true, asset: '/downloads/app.exe'}}}));
    writeFileSync(join(input, 'public/downloads/app.exe'), binary);
    writeFileSync(join(input, 'public/map.dat'), binary);
    execFileSync('git', ['init', '--quiet', input]);
    execFileSync('git', ['-C', input, 'add', 'public']);
    exportPublicSource(input, output);
    for (const name of ['public/map.dat', 'public/downloads/app.exe']) assert.deepEqual(readFileSync(join(output, name)), binary);
  } finally {rmSync(directory, {recursive: true, force: true});}
});
