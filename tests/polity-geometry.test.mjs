import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('public/geo-map.js','utf8');
const context=vm.createContext({window:{}});
vm.runInContext(readFileSync('public/data/eurasia-factions-741.js','utf8'),context);
vm.runInContext(source.slice(source.indexOf('  function hasVerifiedPolityGeometry('),source.indexOf('  function buildOuterPolities(')),context);
const records=context.window.EURASIA_FACTIONS_741;
test('unverified foreign ranges never become country polygons',()=>{
  for(const item of records){
    assert.equal(item.geometry,null);
    assert.equal(item.coordinates,undefined,'remove old hand-authored bounding rings');
    assert.equal(context.hasVerifiedPolityGeometry(item),false);
    if(item.displayOnMap!==false)assert.ok(item.labelAnchor.length===2&&item.labelAnchor.every(Number.isFinite));
  }
  assert.doesNotMatch(source,/smoothRing|path\.centroid\(item\.feature\)/);
});
test('historical geometry requires dated, licensed, verified provenance',()=>{
  const item={geometry:{type:'Polygon'},geometrySource:{status:'verified',year:741,url:'https://example.test/source',license:'CC0'}};
  assert.equal(context.hasVerifiedPolityGeometry(item),true);
  for(const bad of [{year:800},{status:'approximate'},{url:''},{license:'unknown'}]){
    assert.equal(context.hasVerifiedPolityGeometry({...item,geometrySource:{...item.geometrySource,...bad}}),false);
  }
});
test('Tibet and Beiting label anchors stay at referenced sites, not old hull centres',()=>{
  const tibet=records.find(item=>item.id==='tubo');
  assert.ok(tibet.labelAnchor[0]>90&&tibet.labelAnchor[0]<92);
  assert.ok(tibet.labelAnchor[1]>29&&tibet.labelAnchor[1]<31);
  assert.match(tibet.anchorSource,/whc\.unesco\.org/);
  const beiting=records.find(item=>item.id==='beiting');
  assert.ok(beiting.labelAnchor[0]>89&&beiting.labelAnchor[0]<90);
  assert.equal(records.find(item=>item.id==='rajput').displayOnMap,false);
});
test('markers compensate for zoom and non-square SVG display scaling',()=>{
  const marker=vm.createContext({canvasDisplayScaleX:.6,canvasDisplayScaleY:.8,
    currentTransform:{x:10,y:20,k:20},isValidTransform:()=>true});
  vm.runInContext(source.slice(source.indexOf('  function screenSpaceTransform('),source.indexOf('  function registerScreenSpace(')),marker);
  assert.equal(marker.screenSpaceTransform(100,200,undefined,12,16),
    'translate(2030 4040) scale(1.6666666666666667 1.25)');
});
