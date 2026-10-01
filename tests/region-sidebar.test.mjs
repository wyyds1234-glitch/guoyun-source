import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');
const model = JSON.parse(readFileSync(new URL('../public/data/tang-map-model.json', import.meta.url), 'utf8'));
const historicalRegion = model.regions.find((region) => region.id === 'longxian');
const displayName = (region, year) => region.nameHistory.find((entry) =>
  entry.fromYear <= year && (entry.toYear == null || year <= entry.toYear))?.name || region.historicalName;
const functionSource = (name, next) => source.slice(
  source.indexOf(`  function ${name}(`), source.indexOf(`  function ${next}(`));

test('View target opens its selected region details after clearing the order preview', () => {
  const match = source.match(/\$\("viewRegionTarget"\)\.addEventListener\("click", (\(\) => \{[\s\S]*?\n    \})\);/);
  assert.ok(match, 'View target click handler must be bound');
  let activeTab = 'operation';
  let previewPending = true;
  const context = vm.createContext({
    clearPendingRegionOrder: () => { previewPending = false; },
    setRightSidebarTab: (tab) => { activeTab = tab; },
  });
  vm.runInContext(`(${match[1]})()`, context);
  assert.equal(previewPending, false);
  assert.equal(activeTab, 'region');
});

test('strategic map label and region card follow the historical name when the year changes', () => {
  const region = {
    ...historicalRegion, name: '秦州', province: 'longyou', type: 'city', terrain: '山地',
    controllerId: 'enemy', population: 40, grain: 50, garrison: 100, defense: 60, fort: 1,
  };
  const state = {
    calendar: { year: 741 }, regions: { longxian: region },
    provinces: { longyou: { name: '陇右道', owner: 'enemy', sigil: '陇', prosperity: 50, siege: null, fieldTroops: 0 } },
    enemyCampaigns: {}, ruler: '玄宗', kingdom: '大唐',
  };
  const label = { textContent: '' };
  const attributes = {};
  const marker = {
    dataset: {}, style: { setProperty() {} },
    toggleAttribute() {}, setAttribute(key, value) { attributes[key] = value; },
    querySelector(selector) { return selector === '.region-label' ? label : null; },
  };
  const nodes = new Map();
  const element = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', style: {}, disabled: false, childElementCount: 0,
      classList: { toggle() {} }, replaceChildren() {}, appendChild() {},
    });
    return nodes.get(id);
  };
  const routeLayer = { querySelectorAll: () => [] };
  const context = vm.createContext({
    state, regionDisplayName: displayName, strategicRoutesBuilt: true,
    strategicRegionNodes: new Map([['longxian', marker]]),
    commandArmies: () => [], regionPosition: () => [100, 100], regionNeighbors: () => [],
    regionController: () => 'enemy', regionOwnerName: () => '敌方', regionTerrainSummary: () => '山地',
    factionColor: () => '#123456', clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    renderDiagnostics: { strategicNodePatches: 0 },
    PROVINCES: { longyou: { name: '陇右道' } },
    REGION_DATA: { typeNames: { city: '城' }, routeNames: {} },
    window: { TianxiaMap: { transform: { k: 1 }, refreshLabelCollisions() {} } },
    $: (id) => id === 'routeLayer' ? routeLayer : element(id),
    lastProvinceCardKey: '', selectedRegionId: 'longxian', selectedProvince: 'longyou',
    selectedArmyIds: [], selectedMapObjectType: 'region', pendingOrderTargetId: null,
    primarySelectedArmy: () => null, activeArmies: () => [], selectedArmies: () => [],
    getFrontier: () => [], playerForceLabel: () => '唐军', displayKingdomName: () => '唐',
    fmt: String, document: { createElement: () => ({}) },
  });
  vm.runInContext(functionSource('renderStrategicRegions', 'regionTerrainSummary'), context);
  vm.runInContext(functionSource('renderProvinceCard', 'renderCourt'), context);
  context.renderStrategicRegions();
  context.renderProvinceCard();
  assert.equal(label.textContent, '秦州');
  assert.equal(element('provinceName').textContent, '秦州');

  state.calendar.year = 742;
  context.renderStrategicRegions();
  context.renderProvinceCard();
  assert.equal(label.textContent, '天水郡');
  assert.match(attributes['aria-label'], /天水郡/);
  assert.equal(element('provinceName').textContent, '天水郡');
  assert.match(element('selectionBreadcrumb').textContent, /天水郡/);
});
