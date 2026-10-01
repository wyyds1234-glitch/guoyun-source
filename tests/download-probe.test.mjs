import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const source=readFileSync(new URL('../public/download/download.js',import.meta.url),'utf8').replace(/loadReleaseManifest\(\);\s*$/,'');
function probe(responses){
 let calls=0,canceled=0;
 const ctx=vm.createContext({document:{querySelectorAll:()=>[],querySelector:()=>({})},AbortSignal,fetch:async()=>{
   calls++;const response=responses.shift();return {...response,ok:response.status>=200&&response.status<300,headers:new Headers(response.headers),body:{cancel:async()=>canceled++}};
 }});vm.runInContext(source,ctx);return{run:ctx.probeInstaller,stats:()=>({calls,canceled})};
}
test('Pages HEAD without content-length probes GET headers and cancels body',async()=>{
 const p=probe([{status:200,headers:{'content-type':'application/octet-stream'}},{status:200,headers:{'content-type':'application/octet-stream','content-length':'9000'}}]);
 assert.equal(await p.run('/downloads/app.dmg',9000),9000);assert.deepEqual(p.stats(),{calls:2,canceled:1});
});
test('partial response uses whole-file content-range size',async()=>{
 const p=probe([{status:200,headers:{}},{status:206,headers:{'content-range':'bytes 0-0/9000','content-length':'1'}}]);
 assert.equal(await p.run('/downloads/app.dmg',9000),9000);
});
test('HTML fallback, missing asset and size mismatch cannot enable downloads',async()=>{
 for(const response of [{status:404,headers:{}},{status:200,headers:{'content-type':'text/html','content-length':'9000'}},{status:200,headers:{'content-length':'8000'}}]){
   await assert.rejects(probe([response]).run('/downloads/app.dmg',9000));
 }
});

test('release manifest never advertises a missing static installer',()=>{
 const dir=dirname(fileURLToPath(new URL('../public/downloads/latest.json',import.meta.url)));
 const manifest=JSON.parse(readFileSync(join(dir,'latest.json'),'utf8'));
 for(const [id,platform] of Object.entries(manifest.platforms||{})){
   if(platform.available!==true) continue;
   const url=id==='mac_arm64'?manifest.mac_arm64_url:manifest.windows_x64_url;
   assert.ok(url,`${id} must include a URL when available`);
   const file=String(url).split('/').pop();
   assert.ok(file && existsSync(join(dir,file)),`${id} advertises missing installer ${file}`);
 }
});
