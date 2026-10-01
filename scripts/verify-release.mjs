import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
if (!playwrightModule) {
  throw new Error('发布验收需要 PLAYWRIGHT_MODULE，请设置为已安装的 playwright-core/index.mjs 路径。');
}
const {chromium}=await import(pathToFileURL(resolve(playwrightModule)));
const origin=process.argv[2]||'https://tianxia-ddr.pages.dev';
const output=resolve(process.env.QA_OUTPUT_ROOT||'output/playwright','release');await mkdir(output,{recursive:true});
const report={origin,transport:'Node HTTPS forwarding',checks:[],downloads:[]};
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-quic']});
const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:900}});
await context.route(`${origin}/**`,async route=>{
 try{const req=route.request();const response=await fetch(req.url(),{method:req.method(),headers:await req.allHeaders(),body:req.postDataBuffer()||undefined,signal:AbortSignal.timeout(30000)});
 const headers=Object.fromEntries(response.headers);delete headers['content-encoding'];if(req.method()!=='HEAD')delete headers['content-length'];
 await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});}catch{await route.abort();}
});
const page=await context.newPage();const requests=[];page.on('request',r=>requests.push(r.url()));
try{
 await page.goto(origin,{waitUntil:'networkidle'});
 assert.equal(requests.filter(url=>/\/game\.js|\/geo-map\.js|\/data\//.test(url)).length,0);
 assert.ok(await page.locator('a[href="/play/"]').count()>0);report.checks.push('官网不加载游戏/地图');
 await page.goto(`${origin}/#world`,{waitUntil:'domcontentloaded'});
 assert.match(await page.locator('#world').innerText(),/天下不是固定的版图/);report.checks.push('world为内容介绍，不加载地图');
 await page.goto(`${origin}/download/`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!document.querySelector('#releaseNotice').textContent.includes('读取'));
 await page.waitForTimeout(1200);
 for(const platform of ['mac_arm64','windows_x64']){
   const card=page.locator(`[data-release-card="${platform}"]`);const link=card.locator('a[download]');
   if(!await link.count()){report.downloads.push({platform,available:false});continue;}
   const waiting=page.waitForEvent('download');await link.click();const download=await waiting;
   const filename=download.suggestedFilename();const path=resolve(output,filename);await download.saveAs(path);
   const bytes=await readFile(path);
   assert.ok(bytes.length>1e6);
   assert.equal(platform==='mac_arm64'?bytes.subarray(-512,-508).toString():bytes.subarray(0,2).toString(),platform==='mac_arm64'?'koly':'MZ');
   const hash=createHash('sha256').update(bytes).digest('hex');
   const expected=await readFile(resolve('public/downloads',filename));
   assert.equal(hash,createHash('sha256').update(expected).digest('hex'));
   report.downloads.push({platform,filename,bytes:bytes.length,sha256:hash,browserDownload:true});
 }
 await page.screenshot({path:resolve(output,'download-page.png')});
 const cors=await fetch(`${origin}/api/save`,{method:'OPTIONS',headers:{Origin:'tauri://localhost','Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'authorization,content-type'}});
 report.desktopCors={status:cors.status,allowedOrigin:cors.headers.get('access-control-allow-origin')};
 assert.equal(report.desktopCors.allowedOrigin,'tauri://localhost');
}catch(error){report.failure=error.stack;process.exitCode=1;}
finally{await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();}
