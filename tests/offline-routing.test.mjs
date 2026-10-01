import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('offline homepage and game use independent cached navigation shells',async()=>{
  const handlers={};const reads=[],writes=[];let online=true;
  const context=vm.createContext({URL,
    self:{location:{origin:'https://game.test'},addEventListener:(name,fn)=>handlers[name]=fn},
    fetch:async()=>{if(!online)throw new Error('offline');return{ok:true,clone:()=>({})};},
    caches:{open:async()=>({put:async key=>writes.push(key)}),match:async key=>{reads.push(key);return key;}},
  });
  vm.runInContext(readFileSync('public/sw.js','utf8'),context);
  async function navigate(path){let result;handlers.fetch({request:{method:'GET',mode:'navigate',url:`https://game.test${path}`},respondWith:p=>result=p});return await result;}
  await navigate('/play/');await navigate('/');await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(writes,['/play/','/']);
  online=false;
  assert.equal(await navigate('/play/?perf=1'),'/play/');
  assert.equal(await navigate('/#world'),'/');
  assert.deepEqual(reads,['/play/','/']);
});
