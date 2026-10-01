import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
if (!playwrightModule) {
  throw new Error('浏览器实玩需要 PLAYWRIGHT_MODULE，请设置为已安装的 playwright-core/index.mjs 路径。');
}
const {chromium}=await import(pathToFileURL(resolve(playwrightModule)));
const origin=process.argv[2]||'http://127.0.0.1:8791';
const output=resolve(process.env.QA_OUTPUT_ROOT||'output/playwright',process.env.QA_LABEL||'flow');await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-quic']});
const context=await browser.newContext({viewport:{width:1920,height:1080},acceptDownloads:true});
// Never attach to a player's browser/profile or import storage into the test.
const initialStorage=await context.storageState();
assert.equal(initialStorage.cookies.length,0);
assert.equal(initialStorage.origins.length,0);
// Optional transport workaround for Chrome TLS failures in this QA host.
// Responses still come from the REAL production origin, never localhost/mock.
async function productionTransport(context){
 if(process.env.QA_NODE_TRANSPORT!=='1')return;
 await context.route(`${origin}/**`,async route=>{
   try{
     const request=route.request();const headers={...await request.allHeaders()};
     delete headers.host;delete headers['content-length'];
     const response=await fetch(request.url(),{method:request.method(),headers,body:request.postDataBuffer()||undefined,signal:AbortSignal.timeout(30000)});
     const resultHeaders=Object.fromEntries(response.headers);delete resultHeaders['content-encoding'];delete resultHeaders['content-length'];
     await route.fulfill({status:response.status,headers:resultHeaders,body:Buffer.from(await response.arrayBuffer())});
   }catch{await route.abort();}
 });
}
await productionTransport(context);
const page=await context.newPage();
const report={origin,transport:process.env.QA_NODE_TRANSPORT==='1'?'Node HTTPS forwarding':'direct Chrome',checks:[],errors:[]};
const qaCloudAccessCodes=new Set();
page.on('pageerror',e=>report.errors.push(e.message));
const state=()=>page.evaluate(()=>window.TianxiaGame.getState());
async function check(name,fn){await fn();report.checks.push(name);console.log(name);await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));}
async function pause(){if(await page.locator('#pauseButton').textContent()==='Ⅱ')await page.locator('#pauseButton').click();else if((await state()).speed>0)await page.locator('#pauseButton').click();}
async function selectRegion(id){
  await page.evaluate(id=>window.TianxiaMap.focusRegion(id),id);await page.waitForTimeout(550);
  const point=await page.evaluate(id=>{
    const region=window.TianxiaGame.getState().regions[id];
    const [x,y]=window.TianxiaMap.position(region);const matrix=document.querySelector('#mapWorld').getScreenCTM();
    const p=new DOMPoint(x,y).matrixTransform(matrix);return{x:p.x,y:p.y};
  },id);
  await page.mouse.move(point.x,point.y);await page.mouse.click(point.x,point.y);await page.waitForTimeout(200);
  return page.evaluate(()=>window.TianxiaGameDiagnostics.snapshot().selectedRegionId);
}
try{
 await page.goto(`${origin}/play/`,{waitUntil:'domcontentloaded',timeout:45000});
 await page.waitForFunction(()=>window.TianxiaMap?.ready);
 assert.equal((await state()).started,false,'refuse to operate an existing campaign');
 const cloudPreflight=await page.evaluate(async()=>{
   const result=await window.TianxiaCloudSave.load();
   return {found:result.found,offline:!!result.offline,started:result.state?.started,accessCode:window.TianxiaCloudSave.getAccessCode()};
 });
 qaCloudAccessCodes.add(cloudPreflight.accessCode);
 assert.equal(cloudPreflight.offline,false,'test cloud slot must be reachable');
 assert.ok(!cloudPreflight.found || cloudPreflight.started===false,'test cloud slot must contain no started campaign');
 await check('历史身份与自建政权入口分离，玄宗固定唐室开局',async()=>{
   assert.equal(await page.locator('#politicalPathFieldset').isVisible(),false);
   assert.equal(await page.locator('#kingdomField').isVisible(),false);
   assert.equal(await page.locator('#rulerField').isVisible(),false);
   await page.locator('#characterMode').selectOption('custom');
   assert.equal(await page.locator('#politicalPathFieldset').isVisible(),true);
   assert.equal(await page.locator('#kingdomField').isVisible(),true);
   assert.equal(await page.locator('#rulerField').isVisible(),true);
   await page.locator('#characterMode').selectOption('historical');
   assert.equal(await page.locator('#historicalCharacter').isVisible(),true);
   assert.equal(await page.locator('#politicalPathFieldset').isVisible(),false);
 });
 if(process.env.QA_CHARACTER)await page.locator('#historicalCharacter').selectOption(process.env.QA_CHARACTER);
 await page.getByRole('button',{name:'受命于天 · 开始游戏'}).click();
 await page.getByRole('button',{name:'已知晓',exact:true}).click();
 await check('新游戏只挂载运行界面，初始冬季、1/15=7%',async()=>{
   assert.equal(await page.locator('#setupModal').count(),0);
   assert.match(await page.locator('body').innerText(),/7%/);
   assert.equal((await state()).calendar.month,1);
   if(!process.env.QA_CHARACTER){const started=await state();assert.equal(started.characterMode,'historical');assert.equal(started.characterName,'玄宗');assert.equal(started.kingdom,'大唐');assert.equal(started.politicalPath,'loyal');}
   if(process.env.QA_CHARACTER && process.env.QA_CHARACTER!=='玄宗'){
     assert.equal(await page.locator('#rulerName').textContent(),process.env.QA_CHARACTER);
     assert.equal(await page.locator('#rulerRole').textContent(),'唐室将领');
   }
 });
 await check('聚焦控件后 Tab 继续移动键盘焦点',async()=>{
   await page.locator('#cloudButton').focus();
   const panelsBefore=await page.locator('#toggleAllPanels').getAttribute('aria-pressed');
   await page.keyboard.press('Tab');
   assert.notEqual(await page.evaluate(()=>document.activeElement?.id),'cloudButton');
   assert.equal(await page.locator('#toggleAllPanels').getAttribute('aria-pressed'),panelsBefore);
 });
 if(process.env.QA_ATOMIC_CLOUD==='1')await check('云端拒绝同版本并发覆盖，存档版本仅增加一次',async()=>{
   await page.waitForFunction(()=>window.TianxiaCloudSave.getStatus().state==='ready');
   const result=await page.evaluate(async()=>{
     const api=window.TianxiaCloudSave,snapshot=window.TianxiaGame.getState();
     await api.save(snapshot);
     const headers={authorization:`Bearer ${api.getAccessCode()}`,'content-type':'application/json'};
     const before=await (await fetch('/api/save',{headers})).json();
     const body=JSON.stringify({state:snapshot,expectedRevision:before.save.revision});
     const replies=await Promise.all([fetch('/api/save',{method:'PUT',headers,body}),fetch('/api/save',{method:'PUT',headers,body})]);
     const after=await api.load();
     return {statuses:replies.map(r=>r.status).sort(),delta:after.revision-before.save.revision};
   });
   assert.deepEqual(result.statuses,[200,409]);assert.equal(result.delta,1);
 });
 if(process.env.QA_CONCURRENT_CLOUD==='1')await check('自动保存与手动同步重叠不会产生自身版本冲突',async()=>{
   await page.waitForFunction(()=>window.TianxiaCloudSave.getStatus().state==='ready');
   const outcomes=await page.evaluate(async()=>{
     const snapshot=window.TianxiaGame.getState();
     return (await Promise.allSettled([window.TianxiaCloudSave.save(snapshot),window.TianxiaCloudSave.save(snapshot)])).map(r=>({status:r.status,code:r.reason?.code}));
   });
   assert.ok(outcomes.every(r=>r.status==='fulfilled'),JSON.stringify(outcomes));
 });
 if(process.env.QA_LOD_CHECK==='1')await check('中距离隐藏普通战略区边界，7×后恢复且不重建路径',async()=>{
   const count=await page.locator('[data-region-cell]').count();
   for(const k of [3.5,4.5,6,8]){
     await page.evaluate(k=>window.TianxiaMap.setCamera([[108,33],[110,35]],{scale:k}),k);
     await page.waitForTimeout(600);
     const borders=await page.locator('#regionBorderLayer path.region-border:not(.dao-border):not(.political-border):not(.frontline-border)').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).visibility));
     assert.ok(borders.length>0,'plain internal borders must exist');
     assert.ok(borders.every(v=>v===(k<7?'hidden':'visible')),`${k}× internal-border LOD`);
     assert.equal(await page.locator('[data-region-cell]').count(),count);
     const markers=await page.locator('#regionLayer .strategic-region').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width>0).map(n=>({importance:n.dataset.cityImportance,selected:n.classList.contains('selected')})));
     if(k===3.5)assert.ok(markers.every(m=>m.selected||m.importance==='capital'||m.importance==='major'),'nation view must not expose every pass/port marker');
     const overlaps=await page.locator('#regionLayer .strategic-region').evaluateAll(nodes=>{
       const boxes=nodes.map(n=>n.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
       return boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));
     });
     assert.equal(overlaps,false,`${k}× marker icons and names must avoid each other`);
     await page.screenshot({path:`${output}/lod-${k}.png`});
   }
 });
 await check('地区可直接点击，邻接地区非空并可点击',async()=>{
   assert.equal(await selectRegion('changan'),'changan');
   const actual=page.locator('#adjacencyList button');
   assert.ok(await actual.count()>0,'adjacency buttons missing');
   await actual.first().click();
   assert.notEqual(await page.evaluate(()=>window.TianxiaGameDiagnostics.snapshot().selectedRegionId),'changan');
 });
 if(process.env.QA_SPEED_CHECK==='1')await check('1×至4×按真实比例推进，暂停后日期停止',async()=>{
   const day=s=>s.calendar.year*360+s.calendar.month*30+s.calendar.day;
   for(const speed of [1,2,3,4]){
     const before=day(await state());
     await page.locator(`[data-speed="${speed}"]`).click();
     await page.waitForTimeout(1280);await pause();
     const after=day(await state());
     assert.equal(after-before,speed,`${speed}× must advance ${speed} days in one base-day interval`);
     await page.waitForTimeout(350);assert.equal(day(await state()),after);
   }
 });
 await check('多选军团与作战计划使用同一选择状态',async()=>{
   await page.locator('[data-right-tab="army"]').click();
   await page.locator('#armyList .army-card').nth(0).click();
   await page.locator('#armyList .army-card').nth(1).click({modifiers:['Shift']});
   assert.equal((await page.evaluate(()=>window.TianxiaGameDiagnostics.snapshot())).selectedArmyIds.length,2);
   await page.locator('[data-right-tab="operation"]').click();
   assert.match(await page.locator('#battlePlanSelection').innerText(),/已选 2军/);
   if(process.env.QA_GROUP_CONTROLS==='1'){
     await page.locator('#clearArmyGroup').click();
     assert.deepEqual((await page.evaluate(()=>window.TianxiaGameDiagnostics.snapshot())).selectedArmyIds,[]);
     assert.equal(await page.locator('#orderHintArmy').textContent(),'');
     await page.locator('#selectAllArmies').click();
     assert.equal((await page.evaluate(()=>window.TianxiaGameDiagnostics.snapshot())).selectedArmyIds.length,2);
     assert.equal(await page.locator('#battlePlanTitle').textContent(),'作战编组');
     assert.match(await page.locator('#battlePlanSelection').innerText(),/已选 2军/);
   }
 });
 const before=await state();const army=Object.values(before.armies)[0];
 const target=before.regions[army.region].neighbors.map(n=>typeof n==='string'?n:n.id).find(id=>before.regions[id]?.controller!=='player'&&before.regions[id]?.owner!=='player');
 if(!target)throw new Error('No adjacent hostile target in initial scenario');
 await check('两军预览敌区后确认军令，生成独立路线',async()=>{
   assert.equal(await selectRegion(target),target);
   await page.locator('#viewRegionTarget').click();
   assert.equal(await page.locator('.right-rail').getAttribute('data-active-tab'),'region');
   assert.equal((await page.evaluate(()=>window.TianxiaGameDiagnostics.snapshot())).pendingOrderTargetId,null);
   assert.equal(await selectRegion(target),target);
   await page.locator('#confirmRegionOrder').click();
   const orders=Object.values((await state()).armies).filter(a=>a.order);
   assert.equal(orders.length,2);assert.ok(orders.every(a=>a.order.route.length>=2));
 });
 await check('4×行军、暂停停止、停止军令不报错',async()=>{
   const anchors=()=>page.locator('#armyLayer [data-army-id]').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.dataset.armyId,[Number(n.dataset.mapAnchorX),Number(n.dataset.mapAnchorY)]])));
   const starting=await anchors();
   await page.locator('[data-speed="4"]').click();await page.waitForTimeout(900);await pause();
   const s=await state();assert.ok(Object.values(s.armies).some(a=>a.order?.movementProgress>0));
   const marching=await anchors();
   assert.notDeepEqual(marching,starting,'army flags must actually move along their routes');
   const dots=await page.locator('#movementMarkerLayer .movement-marker').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.armyId,point:[Number(n.dataset.mapAnchorX),Number(n.dataset.mapAnchorY)]})));
   for(const dot of dots)assert.deepEqual(marching[dot.id],dot.point,'flag and route progress share one location');
   const flagOverlaps=await page.locator('#armyLayer .flag-body').evaluateAll(nodes=>{
     const boxes=nodes.map(n=>n.getBoundingClientRect());
     return boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top));
   });
   assert.equal(flagOverlaps,false,'individual marching flags must remain separately clickable');
   await page.waitForTimeout(600);assert.deepEqual((await state()).calendar,s.calendar);
   await page.screenshot({path:`${output}/marching.png`});
   if(process.env.QA_GROUP_CONTROLS==='1'){
     await page.locator('[data-right-tab="operation"]').click();
     assert.match(await page.locator('.battle-plan-card-meta').first().innerText(),/途中/);
     const beforeStop=await state();const ids=Object.keys(beforeStop.armies).filter(id=>beforeStop.armies[id].order);
     await page.locator(`[data-stop-army-id="${ids[0]}"]`).click();
     const afterStop=await state();
     assert.equal(afterStop.armies[ids[0]].order,null);
     assert.deepEqual(afterStop.armies[ids[1]],beforeStop.armies[ids[1]],'stopping one army must not alter another');
     await page.locator('[data-right-tab="army"]').click();
   }
   await page.locator('#stopArmyOrders').click();
   assert.equal(Object.values((await state()).armies).filter(a=>a.order).length,0);
   assert.deepEqual(await anchors(),marching,'stop must not teleport flags back to their origin');
 });
 await check('重新下令后云端同步，刷新恢复途中进度',async()=>{
   await selectRegion(target);await page.locator('#confirmRegionOrder').click();
   await page.locator('[data-speed="4"]').click();await page.waitForTimeout(700);await pause();
   await page.locator('#cloudButton').click();await page.locator('#syncCloudButton').click();
   await page.waitForFunction(()=>!document.querySelector('#syncCloudButton').disabled&&window.TianxiaCloudSave.getStatus().state==='ready'&&!!window.TianxiaCloudSave.getStatus().updatedAt);
   await page.evaluate(()=>window.TianxiaCloudSave.waitForPendingSaves());
   const previous=await state();
   await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.TianxiaMap?.ready);
   await page.waitForTimeout(1000);
   assert.deepEqual((await state()).armies,previous.armies);
   assert.equal(await page.locator('#setupModal').count(),0);
 });
 await check('继续推进完成接敌与月度结算',async()=>{
   const month=(await state()).calendar.month;
   await page.locator('#endTurnButton').click();
   assert.equal((await state()).calendar.month,month+1);
   assert.ok(Object.values((await state()).armies).every(a=>Number.isFinite(a.supply)));
   assert.ok(Object.values((await state()).armies).some(a=>a.battleApproachRegionId),'arrival preserves real approach edge');
 });
 await check('军府可编成第三个军团，非固定两军上限',async()=>{
   const n=Object.keys((await state()).armies).length;
   await page.locator('[data-view="army"]').click();
   await page.locator('#createArmyButton').click();
   assert.equal(Object.keys((await state()).armies).length,n+1);
   await page.locator('[data-view="map"]').click();
 });
 await check('全新浏览器通过存档码恢复云端王业',async()=>{
   await page.locator('#cloudButton').click();await page.locator('#syncCloudButton').click();
   await page.waitForFunction(()=>!document.querySelector('#syncCloudButton').disabled&&window.TianxiaCloudSave.getStatus().state==='ready');
   await page.evaluate(()=>window.TianxiaCloudSave.waitForPendingSaves());
   const code=await page.locator('#cloudCode').inputValue();const saved=await state();
   const other=await browser.newContext({viewport:{width:1440,height:900}});await productionTransport(other);const tab=await other.newPage();
   await tab.goto(`${origin}/play/`,{waitUntil:'domcontentloaded'});
   await tab.waitForFunction(()=>window.TianxiaMap?.ready);
   // This clean context also generates an empty cloud slot on startup.
   // Track it before switching codes so it cannot leak after the QA run.
   qaCloudAccessCodes.add(await tab.evaluate(()=>window.TianxiaCloudSave.ensureAccessCode()));
   tab.on('pageerror',e=>report.errors.push(e.message));
   await tab.getByRole('button',{name:'受命于天 · 开始游戏'}).click();
   await tab.getByRole('button',{name:'已知晓',exact:true}).click();
   await tab.locator('#cloudButton').click();await tab.locator('#importCloudCode').fill(code);await tab.locator('#importCloudButton').click();
   await tab.waitForFunction(()=>!document.querySelector('#importCloudButton').disabled&&window.TianxiaCloudSave.getStatus().state!=='syncing');
   const restored=await tab.evaluate(()=>window.TianxiaGame.getState());
   report.restoreStatus=await tab.evaluate(()=>({state:window.TianxiaCloudSave.getStatus().state,feedback:document.querySelector('#toastStack').innerText}));
   assert.deepEqual(restored.calendar,saved.calendar);assert.deepEqual(restored.armies,saved.armies);
   await other.close();await page.locator('#cloudModal .modal-close').click();
 });
 for(const [width,height]of [[1920,1080],[1728,1117],[1440,900],[1366,768]]){
   await check(`${width}×${height} 面板收起/展开保持地图尺寸和缩放`,async()=>{
     await page.setViewportSize({width,height});await page.waitForTimeout(350);
     const k=await page.evaluate(()=>window.TianxiaMap.transform.k);
     await page.locator('#toggleAllPanels').click();await page.waitForTimeout(350);
     const rect=await page.locator('#worldMap').boundingBox();assert.ok(rect.height>height*.6);
     assert.equal(await page.evaluate(()=>window.TianxiaMap.transform.k),k);
     await page.locator('#toggleAllPanels').click();await page.waitForTimeout(350);
     const boxes=await page.evaluate(()=>{
       const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,right:r.right,width:r.width,height:r.height};};
       return {map:box('#worldMap'),right:box('.right-rail'),frame:box('.map-frame'),windowWidth:innerWidth};
     });
     assert.ok(Math.abs(boxes.map.width-boxes.frame.width)<3,'map must fill its frame');
     assert.ok(boxes.right.right<=boxes.windowWidth+3,'expanded sidebar must return inside viewport');
     assert.ok(Math.abs(boxes.map.right-boxes.right.x)<3,'no blank strip between map and sidebar');
     const flags=await page.locator('.army-marker .flag-body').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect()).filter(r=>r.width>0));
     assert.ok(flags.length>0,'army markers remain mounted');
     assert.ok(flags.every(r=>Math.abs(r.width-21)<1 && Math.abs(r.height-20)<1),'flags keep screen-pixel size after viewport resize');
     await page.screenshot({path:`${output}/layout-${width}.png`});
   });
 }
 await check('天下视角无空战况黑框，近景文字避让军旗',async()=>{
   await page.locator('#mapResetView').click();
   await page.waitForTimeout(500);
   assert.equal(await page.locator('.battle-badge').count(),0);
   assert.equal(await page.locator('#outerPolityLayer path').count(),0,'unverified foreign hulls must not be mounted');
   await page.screenshot({path:`${output}/world.png`});
   await page.evaluate(()=>window.TianxiaMap.setCamera([[108,33],[110,35]],{scale:20}));
   await page.waitForTimeout(500);
   const overlaps=await page.evaluate(()=>{
     const visible=s=>[...document.querySelectorAll(s)].map(n=>({text:n.textContent,rect:n.getBoundingClientRect()})).filter(a=>a.rect.width>0&&a.rect.height>0);
     const labels=visible('#mapUi .map-label-candidate'),armies=visible('#mapUi .map-label-obstacle');
     const inside=r=>r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight;
     return labels.filter(a=>inside(a.rect)&&armies.some(b=>inside(b.rect)&&a.rect.left<b.rect.right&&a.rect.right>b.rect.left&&a.rect.top<b.rect.bottom&&a.rect.bottom>b.rect.top)).map(a=>a.text);
   });
   assert.deepEqual(overlaps,[],'visible labels must not cover army hitboxes');
 });
 await page.screenshot({path:`${output}/completed.png`});
 await check('断网刷新仍恢复游戏，官网与游戏离线缓存不串页',async()=>{
   await page.evaluate(()=>navigator.serviceWorker.ready);
   await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
   await page.waitForTimeout(800);
   const saved=await state();
   await context.setOffline(true);
   try{
     await page.reload({waitUntil:'domcontentloaded'});
     await page.waitForFunction(()=>window.TianxiaMap?.ready);
     assert.deepEqual((await state()).armies,saved.armies);
     assert.equal(await page.locator('#setupModal').count(),0);
     await page.goto(`${origin}/`,{waitUntil:'domcontentloaded'});
     assert.equal(await page.locator('#worldMap').count(),0);
     assert.match(await page.locator('#world').innerText(),/天下不是固定的版图/);
     if(process.env.QA_CATEGORY_CHECK==='1'){
       assert.match(await page.locator('[aria-label="网站类别"]').innerText(),/类别：历史/);
       assert.equal(await page.locator('meta[name="category"]').getAttribute('content'),'历史');
       await page.screenshot({path:`${output}/historical-home.png`});
     }
   }finally{await context.setOffline(false);}
 });
}catch(error){report.failure=error.stack;console.error(error);process.exitCode=1;}
finally{
 // Stop pending autosave timers before DELETE, otherwise a last PUT could
 // recreate the QA slot between deletion and browser shutdown.
 await browser.close();
 report.testSaveCleanup=[];
 for(const qaCloudAccessCode of qaCloudAccessCodes){
   try{
     const cleanup=await fetch(`${origin}/api/save`,{method:'DELETE',headers:{authorization:`Bearer ${qaCloudAccessCode}`},signal:AbortSignal.timeout(10000)});
     if(!cleanup.ok&&cleanup.status!==404)throw new Error(`temporary QA save cleanup returned ${cleanup.status}`);
     report.testSaveCleanup.push(cleanup.status===404?'already absent':'deleted');
   }catch(error){report.testSaveCleanup.push('failed');report.cleanupError=error.message;process.exitCode=1;}
 }
 await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
}
