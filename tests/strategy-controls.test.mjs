import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');
function controls() {
  let panels = 0;
  const document = { activeElement: null, querySelectorAll: () => [] };
  const ctx = vm.createContext({ state: { started: true, speed: 4 }, lastRunningSpeed: 4,
    document, clamp: (n,a,b) => Math.max(a,Math.min(b,n)),
    restartStrategicClock: () => {}, render: () => {}, toggleAllPanels: () => panels++ });
  vm.runInContext(source.slice(source.indexOf('  function setSpeed('), source.indexOf('  function restartStrategicClock(')),ctx);
  const key = (key, extra={}) => {
    const event = { key, code: key === ' ' ? 'Space' : `Digit${key}`, defaultPrevented: false,
      preventDefault(){ this.defaultPrevented = true; }, ...extra };
    ctx.handleStrategyKeydown(event);
    return event;
  };
  return { ctx, document, key, panels: () => panels };
}
test('strategy shortcuts pause and restore chosen speed without advancing the simulation', () => {
  const {ctx,key} = controls();
  key(' '); assert.equal(ctx.state.speed,0);
  key(' '); assert.equal(ctx.state.speed,4);
  key('2'); assert.equal(ctx.state.speed,2);
  key(' ',{repeat:true}); assert.equal(ctx.state.speed,2);
});
test('dialogs and text input retain keyboard control and cannot advance game time', () => {
  const {ctx,document,key,panels} = controls();
  for (const tagName of ['INPUT','TEXTAREA','SELECT']) {
    document.activeElement={tagName}; key('1'); key('Tab');
  }
  document.activeElement={isContentEditable:true}; key('1');
  assert.equal(ctx.state.speed,4); assert.equal(panels(),0);
  let closed=0;
  document.activeElement=null;
  document.querySelectorAll=()=>[{close:()=>closed++},{close:()=>closed++}];
  key('1'); key('Tab'); assert.equal(ctx.state.speed,4); assert.equal(panels(),0);
  key('Escape'); assert.equal(closed,1);
});
test('space preserves native button activation; modifiers do not trigger game commands', () => {
  const {ctx,document,key} = controls();
  document.activeElement={closest:()=>({})}; key(' ');
  key('1',{metaKey:true}); key('1',{ctrlKey:true});
  assert.equal(ctx.state.speed,4);
});
test('Tab toggles panels from the page background but preserves focused-control navigation', () => {
  const {document,key,panels} = controls();
  document.body={tagName:'BODY'};
  document.documentElement={tagName:'HTML'};
  document.activeElement=document.body;
  assert.equal(key('Tab').defaultPrevented,true);
  assert.equal(panels(),1);
  for (const tagName of ['BUTTON','A','path']) {
    document.activeElement={tagName};
    assert.equal(key('Tab').defaultPrevented,false,`${tagName} should retain forward Tab navigation`);
  }
  assert.equal(panels(),1);
  assert.equal(key('Tab',{shiftKey:true}).defaultPrevented,false);
});
