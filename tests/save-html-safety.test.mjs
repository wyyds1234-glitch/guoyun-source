import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');
function fn(name, next) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(`  function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test('all game HTML template sinks escape their dynamic values', () => {
  const sinks = [...source.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)];
  assert.equal(sinks.length, 6);
  assert.ok(sinks.every(match => match[1].startsWith('safeHtml`')));
  const context = vm.createContext({});
  vm.runInContext(fn('safeHtml', 'eraText'), context);
  const text = `<img src=x onerror="alert(1)"> & ' test`;
  const html = context.safeHtml(['<b>', '</b>'], text);
  assert.equal(html, '<b>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39; test</b>');
});

test('region tooltip renders save-derived owner/name text literally', () => {
  const tooltip = { dataset: {}, classList: { remove() {} } };
  const region = { id: 'home', province: 'p', admin: '<b>admin</b>', terrain: '平原', type: 'city', garrison: 20, defense: 30, fort: 1 };
  const state = { ruler: '<b>audit</b>', kingdom: '唐', calendar: { year: 741 }, regions: { home: region } };
  const context = vm.createContext({
    state, PROVINCES: { p: { name: '京畿道' } }, REGION_DATA: { typeNames: { city: '城' } },
    window: {}, $: () => tooltip, fmt: String, regionController: () => 'player',
    regionDisplayName: () => '<img src=x>', regionOwnerName: () => state.ruler,
    hideMapTooltip() {}, queueTooltipPosition() {},
  });
  vm.runInContext(fn('safeHtml', 'eraText') + fn('showRegionTooltip', 'queueTooltipPosition'), context);
  context.showRegionTooltip({ clientX: 1, clientY: 1 }, 'home');
  assert.ok(tooltip.innerHTML.includes('&lt;b&gt;audit&lt;/b&gt;'));
  assert.ok(tooltip.innerHTML.includes('&lt;img src=x&gt;'));
  assert.ok(!tooltip.innerHTML.includes('<img'));
  state.ruler = 'changed & name';
  context.showRegionTooltip({}, 'home');
  assert.ok(tooltip.innerHTML.includes('changed &amp; name'));
});
