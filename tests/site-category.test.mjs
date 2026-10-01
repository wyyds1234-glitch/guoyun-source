import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('website declares historical genre without loading game on the homepage', async () => {
  const read = path => readFile(new URL(`../public/${path}`, import.meta.url), 'utf8');
  const home = await read('index.html');
  const schema = JSON.parse(home.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(schema.genre, '历史');
  assert.match(home, /类别：历史/);
  assert.doesNotMatch(home, /src=["'][^"']*(?:game\.js|geo-map\.js)/);
  for (const path of ['index.html', 'play/index.html', 'download/index.html']) {
    assert.match(await read(path), /<meta name="category" content="历史"/);
  }
});
