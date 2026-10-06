import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/cloud-save.js',import.meta.url),'utf8');
const codeA='TX-ABCDEFGH-JKMNPQRS-TUVWXYZ2-3456789A';
const codeB='TX-ZZZZZZZZ-YYYYYYYY-XXXXXXXX-WWWWWWWW';
function client(fetch,meta={revision:1}){
  const storage=new Map([['tianxia-cloud-access-code-v1',codeA],['tianxia-cloud-save-meta-v1',JSON.stringify(meta)]]);
  const window={location:{search:''},setTimeout,clearTimeout,dispatchEvent(){},addEventListener(){}};
  const context=vm.createContext({window,URLSearchParams,crypto,AbortController,fetch,navigator:{onLine:true},CustomEvent:class{},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
  vm.runInContext(source,context);return window.TianxiaCloudSave;
}
const reply=revision=>new Response(JSON.stringify({revision,updatedAt:'2026-09-19T00:00:00Z'}));
test('overlapping saves are ordered and use the preceding committed revision',async()=>{
  const calls=[];let release;
  const api=client(async(url,options)=>{
    calls.push(JSON.parse(options.body));
    if(calls.length===1)await new Promise(resolve=>release=resolve);
    return reply(calls.length+1);
  });
  const first=api.save({gold:1});const state={gold:2};const second=api.save(state);state.gold=3;
  await new Promise(setImmediate);
  assert.equal(calls.length,1);release();await Promise.all([first,second]);
  assert.deepEqual(calls.map(c=>c.expectedRevision),[1,2]);
  assert.deepEqual(calls.map(c=>c.state.gold),[1,2]);
});
test('a completed older save cannot mark newly advanced game state clean',async()=>{
  let release;const api=client(()=>new Promise(resolve=>release=()=>resolve(reply(2))));
  api.markDirty();const pending=api.save({gold:1});await new Promise(setImmediate);
  api.markDirty();release();await pending;assert.equal(api.isDirty(),true);
});
test('network failure does not permanently block the save queue',async()=>{
  let calls=0;const api=client(async()=>{if(++calls===1)throw new Error('offline');return reply(2);});
  await assert.rejects(api.save({gold:1}));await api.save({gold:2});
  assert.equal(api.getStatus().state,'ready');assert.equal(api.isDirty(),false);
});
test('storage quota failures retain dirty local progress without retrying as offline', async () => {
  const api=client(async()=>new Response(JSON.stringify({ok:false,error:{code:'save_storage_full',message:'云端存档空间已满；本地进度仍保留。'}}),{status:507}));
  await assert.rejects(api.save({gold:1}),error=>error.code==='save_storage_full');
  assert.equal(api.isDirty(),true);
  assert.equal(api.getStatus().state,'failed');
  assert.match(api.getStatus().message,/本地进度仍保留/);
});
test('waiting for pending saves settles after queued writes even when an earlier write fails',async()=>{
  let releaseFirst,calls=0,settled=false;
  const api=client(async()=>{
    calls+=1;
    if(calls===1)await new Promise((_resolve,reject)=>{releaseFirst=()=>reject(new Error('offline'));});
    return reply(2);
  });
  const first=api.save({gold:1});
  const firstFailure=assert.rejects(first,/offline/);
  const second=api.save({gold:2});
  const drain=api.waitForPendingSaves().then(()=>{settled=true;});
  await new Promise(setImmediate);
  assert.equal(settled,false);
  releaseFirst();
  await Promise.all([firstFailure,second,drain]);
  assert.equal(calls,2);
  assert.equal(settled,true);
});
test('dirty local save retains its base revision when another device has advanced D1',async()=>{
  let expectedRevision;
  const api=client(async(_url,options={})=>{
    if(!options.method)return Response.json({save:{revision:2,updatedAt:'2026-09-19T00:00:00Z',state:{gold:200}}});
    expectedRevision=JSON.parse(options.body).expectedRevision;
    return new Response(null,{status:409});
  },{revision:1,dirty:true});
  const remote=await api.load();
  assert.equal(remote.localDirty,true);
  assert.equal(remote.conflict,true);
  assert.equal(api.isDirty(),true);
  assert.equal(api.getStatus().state,'conflict');
  await assert.rejects(api.save({gold:100}),error=>error.code==='save_conflict');
  assert.equal(expectedRevision,1);
});
test('load sees edits made while the remote request is pending',async()=>{
  let release;
  const api=client(async()=>new Promise(resolve=>{release=()=>resolve(Response.json({save:{revision:2,updatedAt:'2026-09-19T00:00:00Z',state:{gold:200}}}));}));
  const pending=api.load();
  await new Promise(setImmediate);
  api.markDirty();
  release();
  const remote=await pending;
  assert.equal(remote.localDirty,true);
  assert.equal(remote.conflict,true);
  assert.equal(api.isDirty(),true);
});
test('dirty local save can sync when D1 still has its base revision',async()=>{
  let expectedRevision;
  const api=client(async(_url,options={})=>{
    if(!options.method)return Response.json({save:{revision:1,updatedAt:'2026-09-19T00:00:00Z',state:{gold:100}}});
    expectedRevision=JSON.parse(options.body).expectedRevision;
    return reply(2);
  },{revision:1,dirty:true});
  const remote=await api.load();
  assert.equal(remote.conflict,false);
  await api.save({gold:101});
  assert.equal(expectedRevision,1);
  assert.equal(api.isDirty(),false);
});
test('dirty local save conflicts with a deleted remote save when it has a base revision',async()=>{
  const api=client(async()=>Response.json({save:null}),{revision:3,dirty:true});
  const remote=await api.load();
  assert.equal(remote.found,false);
  assert.equal(remote.localDirty,true);
  assert.equal(remote.conflict,true);
  assert.equal(api.isDirty(),true);
  assert.equal(api.getStatus().state,'conflict');
});
test('dirty first save can sync when D1 has no save',async()=>{
  const api=client(async()=>Response.json({save:null}),{revision:null,dirty:true});
  const remote=await api.load();
  assert.equal(remote.conflict,false);
  assert.equal(api.getStatus().state,'syncing');
  assert.equal(api.isDirty(),true);
});
test('delete clears the old revision so a new cloud save can be created',async()=>{
  let expectedRevision;
  const api=client(async(_url,options={})=>{
    if(options.method==='DELETE')return new Response(null,{status:204});
    expectedRevision=JSON.parse(options.body).expectedRevision;
    return reply(1);
  },{revision:3});
  api.ensureAccessCode();
  await api.remove();
  assert.equal(api.isAutoSyncDisabled(),true);
  await assert.rejects(api.save({gold:100}),error=>error.code==='auto_sync_disabled');
  await api.save({gold:100},{manual:true});
  assert.equal(expectedRevision,0);
  assert.equal(api.isAutoSyncDisabled(),false);
});
test('failed access-code import can restore the old dirty revision and status',async()=>{
  let expectedRevision;
  const api=client(async(_url,options)=>{
    expectedRevision=JSON.parse(options.body).expectedRevision;
    return reply(4);
  },{revision:3,dirty:true});
  const originalCode=api.ensureAccessCode();
  const originalStatus=api.getStatus();
  const previous=api.setAccessCode(codeB);
  assert.equal(api.isDirty(),false);
  api.restoreAccessCode(previous);
  assert.equal(api.getAccessCode(),originalCode);
  assert.equal(api.isDirty(),true);
  assert.deepEqual(api.getStatus(),originalStatus);
  await api.save({gold:100});
  assert.equal(expectedRevision,3);
});
test('old code load resolving after an import cannot replace the new code metadata or campaign',async()=>{
  let releaseOld,expectedRevision;
  const api=client(async(_url,options={})=>{
    if(options.method==='PUT'){
      expectedRevision=JSON.parse(options.body).expectedRevision;
      return reply(8);
    }
    if(options.headers.authorization===`Bearer ${codeB}`){
      return Response.json({save:{revision:7,updatedAt:'2026-09-20T00:00:00Z',state:{gold:700}}});
    }
    return {ok:true,status:200,json:()=>new Promise(resolve=>{releaseOld=()=>resolve({save:{revision:4,updatedAt:'2026-09-19T00:00:00Z',state:{gold:400}}});})};
  });
  const oldLoad=api.load();
  await new Promise(setImmediate);
  api.setAccessCode(codeB);
  const imported=await api.load();
  assert.equal(imported.state.gold,700);
  releaseOld();
  const stale=await oldLoad;
  assert.equal(stale.cancelled,true);
  assert.equal(stale.state,undefined);
  assert.equal(api.getAccessCode(),codeB);
  assert.equal(api.getStatus().updatedAt,'2026-09-20T00:00:00Z');
  await api.save({gold:701});
  assert.equal(expectedRevision,7);
});
test('returning to the original code still cancels its earlier load',async()=>{
  let releaseOld;
  const api=client(async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{releaseOld=()=>resolve({save:{revision:4,updatedAt:'2026-09-19T00:00:00Z',state:{gold:400}}});})}));
  const oldLoad=api.load();
  await new Promise(setImmediate);
  const previous=api.setAccessCode(codeB);
  api.restoreAccessCode(previous);
  releaseOld();
  const stale=await oldLoad;
  assert.equal(stale.cancelled,true);
  assert.equal(api.getAccessCode(),codeA);
});
test('a GET started before a successful PUT cannot roll the revision back',async()=>{
  let releaseOld,expectedRevision;
  const api=client(async(_url,options={})=>{
    if(options.method==='PUT'){
      expectedRevision=JSON.parse(options.body).expectedRevision;
      return reply(expectedRevision+1);
    }
    return {ok:true,status:200,json:()=>new Promise(resolve=>{releaseOld=()=>resolve({save:{revision:1,updatedAt:'2026-09-19T00:00:00Z',state:{gold:100}}});})};
  });
  const oldLoad=api.load();
  await new Promise(setImmediate);
  await api.save({gold:200});
  releaseOld();
  assert.equal((await oldLoad).cancelled,true);
  await api.save({gold:201});
  assert.equal(expectedRevision,2);
});
test('delete runs after queued writes and blocks autosaves already queued behind it',async()=>{
  let releaseFirst;
  const methods=[];
  const api=client(async(_url,options={})=>{
    methods.push(options.method);
    if(options.method==='PUT'){
      await new Promise(resolve=>{releaseFirst=resolve;});
      return reply(2);
    }
    return new Response(null,{status:204});
  });
  const first=api.save({gold:100});
  await new Promise(setImmediate);
  const deletion=api.remove();
  const queued=api.save({gold:101});
  releaseFirst();
  await first;
  await deletion;
  await assert.rejects(queued,error=>error.code==='auto_sync_disabled');
  assert.deepEqual(methods,['PUT','DELETE']);
});
test('incompatible cloud payload can suppress autosync without discarding the prior revision',async()=>{
  let expectedRevision;
  const api=client(async(_url,options={})=>{
    if(!options.method)return Response.json({save:{revision:4,updatedAt:'2026-09-19T00:00:00Z',state:{invalid:true}}});
    expectedRevision=JSON.parse(options.body).expectedRevision;
    return new Response(null,{status:409});
  },{revision:1});
  const prior=api.snapshotAccessCode();
  await api.load();
  api.restoreAccessCode(prior);
  api.suppressAutoSync();
  assert.equal(api.isAutoSyncDisabled(),true);
  await assert.rejects(api.save({gold:100}),error=>error.code==='auto_sync_disabled');
  await assert.rejects(api.save({gold:100},{manual:true}),error=>error.code==='recovery_required');
  assert.equal(expectedRevision,undefined);
  assert.equal(api.isAutoSyncDisabled(),true);
});
test('explicit recovery inspects D1 without adopting its revision and overwrites only the inspected version',async()=>{
  let serverRevision=4;
  const writes=[];
  const api=client(async(_url,options={})=>{
    if(!options.method)return Response.json({save:{revision:serverRevision,updatedAt:'2026-09-20T00:00:00Z',state:{invalid:true}}});
    const body=JSON.parse(options.body);
    writes.push(body.expectedRevision);
    if(body.expectedRevision!==serverRevision)return new Response(null,{status:409});
    serverRevision+=1;
    return reply(serverRevision);
  },{revision:1,dirty:true,autoSyncDisabled:true,autoSyncReason:'incompatible'});
  const before=api.snapshotAccessCode().meta;
  const inspected=await api.inspectRemoteSave();
  assert.equal(inspected.revision,4);
  assert.equal(api.snapshotAccessCode().meta,before);
  assert.equal(api.getAutoSyncReason(),'incompatible');
  await assert.rejects(api.save({gold:100},{manual:true}),error=>error.code==='recovery_required');
  assert.equal(writes.length,0);
  serverRevision=5;
  await assert.rejects(api.overwriteRemote({gold:100},inspected),error=>error.code==='save_conflict');
  assert.equal(writes[0],4);
  assert.equal(api.isAutoSyncDisabled(),true);
  const current=await api.inspectRemoteSave();
  await api.overwriteRemote({gold:100},current);
  assert.equal(writes[1],5);
  assert.equal(serverRevision,6);
  assert.equal(api.isAutoSyncDisabled(),false);
  assert.equal(api.getAutoSyncReason(),null);
});
test('inspection cannot overwrite a different access code after an import',async()=>{
  let writes=0;
  const api=client(async(_url,options={})=>{
    if(options.method==='PUT'){writes+=1;return reply(2);}
    return Response.json({save:{revision:4,updatedAt:'2026-09-20T00:00:00Z',state:{invalid:true}}});
  },{revision:1,autoSyncDisabled:true,autoSyncReason:'incompatible'});
  const inspected=await api.inspectRemoteSave();
  api.setAccessCode(codeB);
  await assert.rejects(api.overwriteRemote({gold:100},inspected),error=>error.code==='save_conflict');
  assert.equal(writes,0);
});
test('remote inspection exposes its state without changing local metadata',async()=>{
  const remoteState={version:99,gold:700,provinces:{},regions:{}};
  const api=client(async()=>Response.json({save:{revision:4,updatedAt:'2026-09-20T00:00:00Z',state:remoteState}}),
    {revision:1,dirty:true,autoSyncDisabled:true,autoSyncReason:'incompatible'});
  const before=api.snapshotAccessCode().meta;
  const inspection=await api.inspectRemoteSave();
  assert.equal(inspection.state.version,99);
  assert.equal(inspection.state.gold,700);
  assert.equal(api.snapshotAccessCode().meta,before);
  assert.equal(api.isAutoSyncDisabled(),true);
});
