import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/geo-map.js',import.meta.url),'utf8');
const layoutSource=source.slice(source.indexOf('  function labelPriority('),source.indexOf('  function queueLabelCollisions('));
function node(classes,x,width,importance){
  const names=new Set(classes.split(' '));
  const item={dataset:{cityImportance:importance},isConnected:true,
    classList:{contains:c=>names.has(c),add:c=>names.add(c),remove:c=>names.delete(c)},
    getBoundingClientRect:()=>({left:x,right:x+width,top:20,bottom:40,width: names.has('label-collided')?0:width,height:20})};
  item.closest=()=>names.has('strategic-region')?item:null;
  return item;
}
function layout(candidates,obstacles=[]){
  const svgNode={getBoundingClientRect:()=>({left:0,right:500,top:0,bottom:300,width:500,height:300}),
    querySelectorAll:s=>s.includes('obstacle')?obstacles:candidates};
  const context=vm.createContext({svg:{node:()=>svgNode},screenSpaceNodes:new Set(candidates),diagnostics:{collisionPasses:0},labelCollisionFrame:1});
  vm.runInContext(layoutSource+'\nresolveLabelCollisions();',context);
  return ()=>vm.runInContext('resolveLabelCollisions();',context);
}
test('city icon and name hide together; selected city outranks overlapping ordinary nodes',()=>{
  const ordinary=node('strategic-region map-label-candidate city',90,70,'local');
  const selected=node('strategic-region map-label-candidate selected city',100,70,'local');
  const distant=node('strategic-region map-label-candidate city',300,70,'local');
  layout([ordinary,selected,distant]);
  assert.equal(ordinary.classList.contains('label-collided'),true);
  assert.equal(selected.classList.contains('label-collided'),false);
  assert.equal(distant.classList.contains('label-collided'),false);
});
test('capitals and historical major cities take precedence over legacy capital markers',()=>{
  const legacy=node('strategic-region map-label-candidate capital',80,70,'local');
  const major=node('strategic-region map-label-candidate city',90,70,'major');
  const capital=node('strategic-region map-label-candidate city',100,70,'capital');
  layout([legacy,major,capital]);
  assert.equal(capital.classList.contains('label-collided'),false);
  assert.equal(major.classList.contains('label-collided'),true);
  assert.equal(legacy.classList.contains('label-collided'),true);
});
test('an army remains clickable and moving the camera can reveal a previously hidden city',()=>{
  const city=node('strategic-region map-label-candidate city',100,60,'major');
  const army=node('army-marker map-label-obstacle',110,30);
  const again=layout([city],[army]);
  assert.equal(city.classList.contains('label-collided'),true);
  assert.equal(army.classList.contains('label-collided'),false);
  army.getBoundingClientRect=()=>({left:400,right:430,top:20,bottom:40,width:30,height:20});
  again();
  assert.equal(city.classList.contains('label-collided'),false);
});
