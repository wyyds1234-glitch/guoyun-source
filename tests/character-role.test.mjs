import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('public/game.js','utf8');
function character(characterName,characterMode='historical',politicalPath='loyal'){
  const ctx=vm.createContext({state:{characterName,characterMode,politicalPath,scenarioType:'historicalScenario'}});
  vm.runInContext(source.slice(source.indexOf('  function isPlayerEmperor('),source.indexOf('  function playerForceLabel(')),ctx);
  return {role:ctx.playerRoleLabel(),address:ctx.playerAddress()};
}
test('loyal historical generals are not treated as emperors',()=>{
  for(const name of ['郭子仪','李光弼'])assert.deepEqual(character(name),{role:'唐室将领',address:'主公'});
  assert.deepEqual(character('玄宗'),{role:'唐室天子',address:'陛下'});
});
test('custom characters and political paths cannot inherit an emperor title',()=>{
  assert.deepEqual(character('玄宗','custom'),{role:'地方主事',address:'主公'});
  for(const path of ['rebel','independent','observer'])assert.notEqual(character('玄宗','historical',path).address,'陛下');
  assert.match(source,/event\.description\.replaceAll\("陛下", playerAddress\(\)\)/);
  assert.doesNotMatch(source,/state\.ruler\}陛下/);
});
