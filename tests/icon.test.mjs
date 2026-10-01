import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('native and website icons derive from one original Guoyun vector', () => {
  const source = readFileSync('public/data/brand/guoyun-icon-v2.svg', 'utf8');
  assert.match(source, /国运 · 朱砂国印/);
  assert.doesNotMatch(source, /<text\b|<image\b|href=/);
  for (const file of ['src-tauri/icons/icon.svg', 'public/favicon.svg', 'public/icon-192.svg', 'public/icon-512.svg']) {
    assert.equal(readFileSync(file, 'utf8'), source, file);
  }
  for (const [file, size] of [['32x32.png', 32], ['128x128.png', 128], ['128x128@2x.png', 256]]) {
    const png = readFileSync(`src-tauri/icons/${file}`);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  assert.equal(readFileSync('src-tauri/icons/icon.icns').subarray(0, 4).toString(), 'icns');
  assert.deepEqual([...readFileSync('src-tauri/icons/icon.ico').subarray(0, 4)], [0, 0, 1, 0]);
});
