import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the shipping functions rather than checking whether a keyword exists.
const source = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');
function functionSource(name, next) {
  return source.slice(source.indexOf(`  function ${name}(`), source.indexOf(`  function ${next}(`));
}
function runtime() {
  const army = { id:'a', region:'home', province:'dao', supply:80, cavalry:0, battleState:'marching', destinationRegion:'enemy', order:{type:'ATTACK',targetRegionId:'enemy',route:['home','enemy'],routeIndex:0,movementProgress:0,etaDays:10,attackPlanId:'plan'} };
  const state = {armies:{a:army}, regions:{home:{id:'home',name:'长安',province:'dao',terrain:'平原',neighbors:['enemy','other']},enemy:{id:'enemy',name:'目标',province:'dao',terrain:'平原',neighbors:['home','other']},other:{id:'other',province:'dao',neighbors:['home','enemy']}},attackPlans:{plan:{id:'plan',armyIds:['a','b'],arrivedArmyIds:[],coordinationMode:'WAIT_FOR_ALL'}}};
  const points={home:[0,0],enemy:[100,0],other:[100,100]};
  const ctx = vm.createContext({state,REGIONS:state.regions,ARMY_ORDER_TYPES:['ATTACK','MOVE','RETREAT'],COORDINATION_MODES:['WAIT_FOR_ALL','ATTACK_ON_ARRIVAL'],regionPosition:id=>points[id],armyDisplayName:army=>army?.name||'未命名军团',renderCalls:0,saveCalls:0,activeArmies:()=>Object.values(state.armies),routeBetween:()=>({kind:'road'}),regionTerrainModifier:()=>1,armySize:()=>500,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),routeDistance:()=>1,regionController:()=> 'enemy',syncNationalArmyTotals:()=>{},saveState:()=>{},addLog:()=>{},resolveRegionBattle:()=>{},resolveAttackPlan:()=>{},render:()=>ctx.renderCalls++});
  vm.runInContext(functionSource('normalizeArmyOrder','syncSelectedArmySelection')+functionSource('makeArmyOrder','syncNationalArmyTotals')+functionSource('remainingRoutePoints','routeVisible')+functionSource('stopArmyOrder','advanceArmyOrders')+functionSource('advanceArmyOrders','resolveAttackPlan'),ctx);
  return {ctx,state,army};
}
test('stop order renders once and removes plan membership without throwing',()=>{
  const {ctx,army,state}=runtime();
  assert.equal(ctx.stopArmyOrder('a'),true);
  assert.equal(army.order,null);
  assert.equal(ctx.renderCalls,1);
  assert.deepEqual([...state.attackPlans.plan.armyIds],['b']);
});
test('progress-only days do not request a full map/game render',()=>{
  const {ctx,army}=runtime();
  assert.equal(ctx.advanceArmyOrders(1),false);
  assert.ok(army.movementProgress>0);
  assert.equal(army.region,'home');
});
test('arrival estimate follows actual edge progress, not the stale countdown',()=>{
  const {ctx,army}=runtime();
  army.order.movementProgress=80;
  army.order.etaDays=11;
  ctx.advanceArmyOrders(1);
  assert.equal(army.order.etaDays,1);
  assert.equal(army.eta,1);
  ctx.advanceArmyOrders(1);
  assert.equal(army.region,'enemy');
  assert.equal(army.eta,0);
});
test('an army waiting for its ally does not march or consume supply again',()=>{
  const {ctx,army,state}=runtime();
  army.region='enemy';army.order.routeIndex=1;army.battleState='arrived';
  state.attackPlans.plan.arrivedArmyIds=['a'];
  state.armies.b={id:'b',order:{},battleState:'marching'};
  const supply=army.supply;
  ctx.advanceArmyOrders(5);
  assert.equal(army.supply,supply);
  assert.equal(army.order.routeIndex,1);
  assert.equal(army.order.movementProgress,0);
});
test('an arrived army with a missing plan leaves waiting state without moving or consuming supply',()=>{
  const {ctx,army,state}=runtime();
  army.region='enemy'; army.order.routeIndex=1; army.battleState='arrived';
  state.attackPlans={};
  const supply=army.supply;
  ctx.advanceArmyOrders(1);
  assert.equal(army.order,null);
  assert.equal(army.region,'enemy');
  assert.equal(army.supply,supply);
});
test('starvation selects an army without referencing a variable before initialization',()=>{
  const ctx=vm.createContext({activeArmies:()=>[{supply:80},{supply:15}]});
  const expression=source.match(/const army = activeArmies\(\)\.sort\([^;]+;/)[0];
  assert.equal(vm.runInContext(`${expression} army.supply`,ctx),15);
});
test('month skip only advances the remaining days of the current month',()=>{
  const expression=source.match(/if \(!movementAlreadyAdvanced\) advanceArmyOrders\([^;]+;/)[0];
  let days;
  vm.runInNewContext(expression,{movementAlreadyAdvanced:false,DAYS_PER_MONTH:30,state:{calendar:{day:20}},advanceArmyOrders:n=>days=n});
  assert.equal(days,11);
});
test('arrival preserves the actual attacking edge for combat and save recovery',()=>{
  const {ctx,army}=runtime();
  army.order.movementProgress=99;
  ctx.advanceArmyOrders(1);
  assert.equal(army.region,'enemy');
  assert.equal(army.battleApproachRegionId,'home');
  const copy=JSON.parse(JSON.stringify(army));
  copy.order=null;
  const combat=vm.createContext({routeBetween:(a,b)=>a==='home'&&b==='enemy'?{kind:'river'}:null});
  vm.runInContext(functionSource('battleApproach','regionNeighbors'),combat);
  assert.equal(combat.battleApproach(army,'enemy').kind,'river');
  assert.equal(combat.battleApproach(copy,'enemy').kind,'river');
});
test('single-army river crossing still reduces attack after the army reaches the target',()=>{
  function fight(kind){
    const region={id:'enemy',province:'dao',garrison:600,defense:0,type:'city'};
    const army={region:'enemy',supply:80,morale:80,battleApproachRegionId:'home',order:{route:['home','enemy'],routeIndex:1}};
    const ctx=vm.createContext({state:{regions:{enemy:region},provinces:{dao:{}},attackPlans:{}},
      routeBetween:(a,b)=>a==='home'&&b==='enemy'?{kind}:null,regionTerrainModifier:()=>1,
      armyPower:()=>500,armySize:()=>500,distributeArmyLoss:()=>0,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),
      addLog:()=>{},toast:()=>{},fmt:String,armyDisplayName:army=>army?.name||'未命名军团',Math:Object.assign(Object.create(Math),{random:()=>1})});
    vm.runInContext(functionSource('battleApproach','regionNeighbors')+functionSource('resolveRegionBattle','updateProvinceFromRegions'),ctx);
    ctx.resolveRegionBattle(army,'enemy');return region.garrison;
  }
  assert.ok(fight('river')>fight('road'),'river approach leaves more defenders than an otherwise identical road attack');
});
test('1x through 4x share one game-time basis and pause removes the timer',()=>{
  const calls=[],cleared=[];
  const ctx=vm.createContext({state:{started:true,speed:1},strategicTimer:null,cloudHydrationPending:false,advanceDay:()=>{},
    window:{setInterval:(_fn,ms)=>{calls.push(ms);return calls.length;},clearInterval:id=>cleared.push(id)}});
  vm.runInContext(functionSource('restartStrategicClock','growEnemies'),ctx);
  for(const speed of [1,2,3,4]){ctx.state.speed=speed;ctx.restartStrategicClock();}
  assert.deepEqual(calls,[1200,600,400,300]);
  ctx.state.speed=0;ctx.restartStrategicClock();
  assert.equal(ctx.strategicTimer,null);
  assert.deepEqual(cleared,[1,2,3,4]);
});

test('army flag and remaining arrow use the current edge, not progress across the entire route',()=>{
  const {ctx,army}=runtime();
  army.order.route=['home','enemy','other'];army.order.movementProgress=50;
  assert.deepEqual([...ctx.armyMapPosition(army)],[50,0]);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.remainingRoutePoints(army,army.order.route))),[[50,0],[100,0],[100,100]]);
  army.region='enemy';army.order.routeIndex=1;army.order.movementProgress=25;
  assert.deepEqual([...ctx.armyMapPosition(army)],[100,25]);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.remainingRoutePoints(army,army.order.route))),[[100,25],[100,100]]);
});

test('stop and reload preserve the exact halfway position and do not consume marching supply',()=>{
  const {ctx,army}=runtime();army.order.movementProgress=40;
  const position=[...ctx.armyMapPosition(army)],supply=army.supply;
  ctx.stopArmyOrder('a');ctx.advanceArmyOrders(8);
  assert.deepEqual([...ctx.armyMapPosition(army)],position);
  assert.equal(army.supply,supply);
  const restored=JSON.parse(JSON.stringify(army));
  ctx.normalizeArmyOrder(restored);
  assert.deepEqual([...ctx.armyMapPosition(restored)],position);
  const resumed=ctx.makeArmyOrder(army,'enemy',{route:['home','enemy']});
  assert.equal(resumed.movementProgress,40);assert.equal(resumed.returnLeg,null);
});

test('a changed route retraces the old edge without teleporting or moving another army',()=>{
  const {ctx,army,state}=runtime();army.order.movementProgress=40;
  const position=[...ctx.armyMapPosition(army)];
  state.armies.b={id:'b',region:'other',supply:88};const other=JSON.stringify(state.armies.b);
  army.order=ctx.makeArmyOrder(army,'other',{route:['home','other']});army.destinationRegion='other';
  assert.deepEqual([...ctx.armyMapPosition(army)],position);
  const restored=JSON.parse(JSON.stringify(army));ctx.normalizeArmyOrder(restored);
  assert.deepEqual([...ctx.armyMapPosition(restored)],position);
  ctx.advanceArmyOrders(1);
  assert.ok(ctx.armyMapPosition(army)[0]<40 && ctx.armyMapPosition(army)[0]>0);
  assert.equal(JSON.stringify(state.armies.b),other);
  ctx.advanceArmyOrders(3);assert.equal(army.order.returnLeg,null);
  assert.deepEqual([...ctx.armyMapPosition(army)],[0,0]);
  ctx.advanceArmyOrders(1);assert.ok(ctx.armyMapPosition(army)[1]>0);
});

test('return to the previous friendly city walks back rather than instantly stopping there',()=>{
  const {ctx,army}=runtime();army.order.movementProgress=25;
  army.order=ctx.makeArmyOrder(army,'home',{route:['home'],type:'RETREAT'});army.destinationRegion='home';
  assert.deepEqual([...ctx.armyMapPosition(army)],[25,0]);
  ctx.advanceArmyOrders(1);assert.ok(ctx.armyMapPosition(army)[0]>0);
  ctx.advanceArmyOrders(2);
  assert.equal(army.order,null);assert.equal(army.haltedLeg,null);
  assert.deepEqual([...ctx.armyMapPosition(army)],[0,0]);
});

test('save hydration validates stored transit without needing initialized game state',()=>{
  const {ctx}=runtime();
  ctx.state=undefined;
  assert.equal(ctx.normalizeTravelLeg({fromRegionId:'home',toRegionId:'enemy',progress:25}).progress,25);
  assert.equal(ctx.normalizeTravelLeg({fromRegionId:'home',toRegionId:'missing',progress:25}),null);
});

test('save hydration drops non-adjacent army routes and orphaned attack plans',()=>{
  const ctx=vm.createContext({
    REGIONS:{
      home:{neighbors:[{id:'mid'}]},
      mid:{neighbors:[{id:'home'},{id:'target'}]},
      target:{neighbors:[{id:'mid'}]},
    },
    COORDINATION_MODES:['WAIT_FOR_ALL','ATTACK_ON_ARRIVAL'],
    clamp:(n,min,max)=>Math.min(max,Math.max(min,n)),
    Date,
  });
  vm.runInContext(
    functionSource('normalizeSavedRoute','normalizeAttackPlans')+
    functionSource('normalizeAttackPlans','normalizeTravelLeg'),ctx,
  );
  assert.deepEqual([...ctx.normalizeSavedRoute(['home','target'],'target')],[]);
  assert.deepEqual([...ctx.normalizeSavedRoute(['home','mid','target'],'target','home',0)],['home','mid','target']);
  assert.deepEqual([...ctx.normalizeSavedRoute(['home','mid','target'],'target','target',0)],[]);
  const armies={
    a:{order:{attackPlanId:'plan-1',route:['home','mid','target']}},
    b:{order:{attackPlanId:'plan-1',route:['mid','target']}},
    orphan:{order:{attackPlanId:'missing',route:['home','mid']}},
  };
  const plans=ctx.normalizeAttackPlans({
    'plan-1':{armyIds:['a','b','missing'],targetRegionId:'target',routesByArmyId:{a:['home','mid','target'],b:['mid','target']},coordinationMode:'WAIT_FOR_ALL'},
    'broken':{armyIds:['orphan'],targetRegionId:'target',routesByArmyId:{orphan:['home','target']}},
  },armies);
  assert.deepEqual(Array.from(plans['plan-1'].armyIds),['a','b']);
  assert.equal(plans.broken,undefined);
});

test('save hydration infers a missing route index from the current region',()=>{
  const {ctx,army}=runtime();
  army.region='enemy';
  delete army.order.routeIndex;
  ctx.normalizeArmyOrder(army);
  assert.equal(army.order.routeIndex,1);
  assert.deepEqual(army.order.route,['home','enemy']);
});
