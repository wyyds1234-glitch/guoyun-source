import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');
function functionSource(name, next) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(`  function ${next}(`, start + 1);
  assert.ok(start >= 0 && end > start, `found ${name} before ${next}`);
  return source.slice(start, end);
}

test('event infantry joins a real army and survives national total synchronization', () => {
  const army = { id: 'a', infantry: 50, archers: 10, cavalry: 0 };
  const state = { armies: { a: army }, infantry: 50, archers: 10, cavalry: 0, morale: 60 };
  const ctx = vm.createContext({
    state,
    primarySelectedArmy: () => army,
    activeArmies: () => [army],
    nationalArmyTotals: () => ({ infantry: army.infantry, archers: army.archers, cavalry: army.cavalry }),
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  });
  vm.runInContext(functionSource('syncNationalArmyTotals', 'distributeArmyLoss')
    + functionSource('applyEffects', 'showEvent'), ctx);
  ctx.applyEffects({ infantry: 120, morale: -2 });
  assert.equal(army.infantry, 170);
  ctx.syncNationalArmyTotals();
  assert.equal(state.infantry, 170);
  assert.equal(state.morale, 58);
});

test('province takeover rewards are granted only on the ownership transition', () => {
  const regions = {
    capital: { id: 'capital', province: 'p', controllerId: 'player', garrison: 20 },
    second: { id: 'second', province: 'p', controllerId: 'player', garrison: 20 },
    third: { id: 'third', province: 'p', controllerId: 'player', garrison: 20 },
    fourth: { id: 'fourth', province: 'p', controllerId: 'enemy', garrison: 20 },
  };
  const state = { regions, provinces: { p: { name: 'Province', owner: 'enemy', fieldTroops: 100, garrison: 80 } }, prestige: 0, morale: 50 };
  const logs = [];
  const ctx = vm.createContext({ state, PROVINCE_CAPITAL_REGION: { p: 'capital' },
    regionController: (region) => region.controllerId, selectedProvince: null,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)), addLog: (message) => logs.push(message) });
  vm.runInContext(functionSource('updateProvinceFromRegions', 'advanceFrontlineArmies'), ctx);
  ctx.updateProvinceFromRegions('p');
  regions.fourth.controllerId = 'player';
  ctx.updateProvinceFromRegions('p');
  assert.equal(state.provinces.p.owner, 'player');
  assert.equal(state.prestige, 8);
  assert.equal(state.morale, 52);
  assert.equal(state.provinces.p.garrison, 80);
  assert.equal(logs.length, 1);
});

test('a siege cannot use an assigned army that has marched away', () => {
  const away = { id: 'a', province: 'other', destinationRegion: 'far', infantry: 200, supply: 80 };
  const siege = { armyId: 'a', progress: 50, rounds: 0 };
  const state = { armies: { a: away }, provinces: { p: { owner: 'enemy', capital: 'Capital', siege } } };
  const ctx = vm.createContext({ state, activeArmies: () => [away], armySize: (army) => army.infantry,
    addLog: () => {} });
  vm.runInContext(functionSource('advancePlayerSieges', 'advanceEnemyCampaigns'), ctx);
  ctx.advancePlayerSieges();
  assert.equal(siege.progress, 38);
  assert.equal(away.supply, 80);
});

test('a staggered attack plan ends when later armies reach an already captured target', () => {
  const makeArmy = (id, progress) => ({ id, name: id, region: 'home', province: 'p',
    infantry: 500, archers: 0, cavalry: 0, supply: 80, morale: 80,
    destinationRegion: 'target', battleState: 'marching_attack',
    order: { type: 'ATTACK', targetRegionId: 'target', route: ['home', 'target'],
      routeIndex: 0, movementProgress: progress, attackPlanId: 'plan' } });
  const a = makeArmy('a', 95);
  const b = makeArmy('b', 0);
  const target = { id: 'target', name: 'Target', province: 'p', terrain: 'plain',
    type: 'city', garrison: 40, defense: 0, controllerId: 'enemy' };
  const state = { armies: { a, b }, regions: {
    home: { id: 'home', name: 'Home', province: 'p', terrain: 'plain', controllerId: 'player' }, target,
  }, attackPlans: { plan: { id: 'plan', armyIds: ['a', 'b'], arrivedArmyIds: [],
    targetRegionId: 'target', routesByArmyId: { a: ['home', 'target'], b: ['home', 'target'] },
    coordinationMode: 'ATTACK_ON_ARRIVAL', status: 'marching' } }, enemyCampaigns: {} };
  const ctx = vm.createContext({ state,
    activeArmies: () => Object.values(state.armies).filter((army) => army.infantry > 0),
    armySize: (army) => army.infantry, armyPower: (army) => army.infantry * 3,
    armyTravelLeg: (army) => army.order?.routeIndex < army.order.route.length - 1
      ? { fromRegionId: army.region, toRegionId: army.order.route[army.order.routeIndex + 1],
        progress: army.order.movementProgress } : null,
    routeBetween: () => ({ kind: 'road' }), battleApproach: () => ({ kind: 'road' }),
    regionTerrainModifier: () => 1, regionController: (region) => region.controllerId,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    estimateArmyArrival: () => 1, distributeArmyLoss: () => 0,
    setRegionControl: (region, owner) => { region.controllerId = owner; },
    addLog: () => {}, toast: () => {}, armyDisplayName: (army) => army?.name || '未命名军团', updateProvinceFromRegions: () => {},
    syncNationalArmyTotals: () => {}, saveState: () => {}, render: () => {},
    fmt: String, ownerName: String, Math: Object.assign(Object.create(Math), { random: () => 0 }),
  });
  vm.runInContext(functionSource('stopArmyOrder', 'advanceArmyOrders')
    + functionSource('advanceArmyOrders', 'resolveAttackPlan')
    + functionSource('resolveAttackPlan', 'resolveReliefArmy'), ctx);
  ctx.advanceArmyOrders(1);
  assert.equal(target.controllerId, 'player');
  assert.deepEqual([...state.attackPlans.plan.armyIds], ['b']);
  ctx.advanceArmyOrders(10);
  assert.equal(b.order, null);
  assert.equal(state.attackPlans.plan, undefined);
});

function resultContext(state) {
  const nodes = new Map();
  const dialog = { open: false, dataset: {}, showModal() { this.open = true; } };
  nodes.set('resultModal', dialog);
  const clockStates = [];
  const ctx = vm.createContext({ state, TOTAL_PROVINCES: 1,
    ownedProvinces: () => Object.keys(state.provinces).filter((id) => state.provinces[id].owner === 'player'),
    ensureModal: () => dialog,
    $: (id) => { if (!nodes.has(id)) nodes.set(id, { textContent: '', dataset: {} }); return nodes.get(id); },
    saveState: () => {}, restartStrategicClock: () => clockStates.push(state.speed), updateHeader: () => {},
    renderResultStats: () => {}, playerAddress: () => 'ruler',
  });
  vm.runInContext(functionSource('checkVictory', 'renderResultStats'), ctx);
  return { ctx, dialog, clockStates };
}

test('daily region conquest opens victory and pauses the clock', () => {
  const state = { provinces: { p: { owner: 'enemy' } }, calendar: { day: 5 }, speed: 4,
    ruler: 'Ruler', kingdom: 'Realm', morale: 50, population: 1000 };
  const { ctx, dialog, clockStates } = resultContext(state);
  ctx.DAYS_PER_MONTH = 30;
  ctx.advanceArmyOrders = () => { state.provinces.p.owner = 'player'; return true; };
  ctx.render = () => {};
  ctx.renderRealtime = () => {};
  vm.runInContext(functionSource('advanceDay', 'setSpeed'), ctx);
  ctx.advanceDay();
  assert.equal(dialog.open, true);
  assert.equal(state.speed, 0);
  assert.deepEqual(clockStates, [0]);
});

test('monthly siege conquest opens victory and a result dialog stops further ticks', () => {
  const state = { provinces: { p: { owner: 'enemy' } }, calendar: { year: 741, month: 1, day: 30 },
    speed: 4, ruler: 'Ruler', kingdom: 'Realm', morale: 50, population: 1000,
    turns: 0, gold: 0, grain: 0, actionPoints: 0 };
  const { ctx, dialog } = resultContext(state);
  Object.assign(ctx, {
    DAYS_PER_MONTH: 30, MAX_ACTIONS: 3,
    syncNationalArmyTotals: () => {}, calculateMonthlyBalance: () => ({ gold: 0, grain: 0, population: 0 }),
    fmt: String, addLog: () => {}, growEnemies: () => {}, advanceArmyOrders: () => false,
    advanceFrontlineArmies: () => {}, advancePlayerSieges: () => { state.provinces.p.owner = 'player'; },
    advanceEnemyCampaigns: () => {}, enemyStrategy: () => {}, seasonForMonth: () => 0,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)), sound: () => {}, render: () => {},
    window: { clearTimeout: () => {}, setTimeout: () => 1 }, pendingEventTimer: 0,
  });
  vm.runInContext(functionSource('endTurn', 'advanceDay') + functionSource('advanceDay', 'setSpeed'), ctx);
  ctx.advanceDay();
  assert.equal(dialog.open, true);
  assert.equal(state.speed, 0);
  assert.equal(state.turns, 1);
});
