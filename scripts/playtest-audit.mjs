import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Browser QA, not a mocked renderer. Point PLAYWRIGHT_MODULE at the installed
// playwright-core package. Reports contain no player save codes or credentials.
const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('Set PLAYWRIGHT_MODULE to playwright-core/index.mjs');
const { chromium } = await import(pathToFileURL(resolve(modulePath)));
const origin = process.argv[2] || 'http://127.0.0.1:8791';
const label = (process.argv[3] || 'audit').replace(/[^a-z0-9-]/gi, '-');
const output = resolve(process.env.QA_OUTPUT_ROOT || 'output/playwright', label);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-quic', '--disable-http2', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
if (process.env.QA_NODE_TRANSPORT === '1') {
  await context.route(`${origin}/**`, async route => {
    try {
      const request = route.request(); const headers = { ...await request.allHeaders() };
      delete headers.host; delete headers['content-length'];
      const response = await fetch(request.url(), { method: request.method(), headers, body: request.postDataBuffer() || undefined, signal: AbortSignal.timeout(30000) });
      const resultHeaders = Object.fromEntries(response.headers); delete resultHeaders['content-encoding']; delete resultHeaders['content-length'];
      await route.fulfill({ status: response.status, headers: resultHeaders, body: Buffer.from(await response.arrayBuffer()) });
    } catch { await route.abort(); }
  });
}
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const report = { origin, transport: process.env.QA_NODE_TRANSPORT === '1' ? 'Node HTTPS forwarding' : 'direct Chrome', viewport: '1920x1080', browser: browser.version(), headless: true, measurements: [], checks: [], errors };
let qaCloudAccessCode = null;
await page.addInitScript(() => {
  window.__qa = { intervals: [], tasks: [], frames: [], running: false };
  new PerformanceObserver(list => {
    if (window.__qa.running) window.__qa.tasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })));
  }).observe({ type: 'longtask', buffered: true });
  window.__qa.start = () => {
    window.__qa.frames = []; window.__qa.tasks = []; window.__qa.running = true;
    let last;
    const tick = now => { if (!window.__qa.running) return; if (last) window.__qa.frames.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };
});

async function measure(name, action, trace = false) {
  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');
  const before = (await client.send('Performance.getMetrics')).metrics;
  const events = [];
  if (trace) {
    client.on('Tracing.dataCollected', data => events.push(...data.value));
    await client.send('Tracing.start', { categories: 'devtools.timeline,v8,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
  }
  const diagnosticsBefore = await page.evaluate(() => ({ map: window.TianxiaMap?.getDiagnostics(), game: window.TianxiaGameDiagnostics?.snapshot() }));
  await page.evaluate(() => window.__qa.start());
  await action();
  const frames = await page.evaluate(() => { window.__qa.running = false; return { frames: window.__qa.frames, tasks: window.__qa.tasks }; });
  const after = (await client.send('Performance.getMetrics')).metrics;
  const diagnosticsAfter = await page.evaluate(() => ({ map: window.TianxiaMap?.getDiagnostics(), game: window.TianxiaGameDiagnostics?.snapshot() }));
  if (trace) {
    const done = new Promise(resolve => client.once('Tracing.tracingComplete', resolve));
    await client.send('Tracing.end'); await done;
    await writeFile(`${output}/${name}-trace.json`, JSON.stringify({ traceEvents: events }));
  }
  await client.detach();
  const sorted = frames.frames.toSorted((a,b) => a-b);
  const average = sorted.reduce((sum,n) => sum+n,0) / Math.max(1,sorted.length);
  const diff = key => (after.find(m => m.name === key)?.value || 0) - (before.find(m => m.name === key)?.value || 0);
  const aggregate = names => Object.fromEntries(names.map(name => [name, events.filter(e => e.name === name && e.ph === 'X').reduce((sum,e) => sum+(e.dur || 0)/1000,0)]));
  const result = { name, fps: +(1000/average).toFixed(1), averageMs: +average.toFixed(2), p95Ms: +(sorted[Math.floor(sorted.length*.95)] || 0).toFixed(2), worstMs: +Math.max(0,...sorted).toFixed(2), longTasks: frames.tasks.length, maxTaskMs: Math.max(0,...frames.tasks.map(t => t.duration)), scriptingMs: +(diff('ScriptDuration')*1000).toFixed(1), layoutMs: +(diff('LayoutDuration')*1000).toFixed(1), taskMs: +(diff('TaskDuration')*1000).toFixed(1), trace: aggregate(['Paint','Layout','UpdateLayoutTree','MinorGC','MajorGC']), diagnosticsBefore, diagnosticsAfter };
  report.measurements.push(result);
  console.log(JSON.stringify({ ...result, diagnosticsBefore: undefined, diagnosticsAfter: undefined }));
  await writeFile(`${output}/report.json`, JSON.stringify(report,null,2));
}
async function zoom(seconds = 10) {
  const r = await page.locator('#worldMap').boundingBox();
  await page.mouse.move(r.x+r.width*.57,r.y+r.height*.47);
  const end = Date.now()+seconds*1000;
  let i=0;
  while (Date.now()<end) { await page.mouse.wheel(0, Math.floor(i++/12)%2 ? 25 : -25); await page.waitForTimeout(70); }
  await page.waitForTimeout(250);
}
async function pan(seconds = 10) {
  const r=await page.locator('#worldMap').boundingBox();
  const end=Date.now()+seconds*1000;
  while(Date.now()<end){
    await page.mouse.move(r.x+r.width*.45,r.y+r.height*.55); await page.mouse.down();
    await page.mouse.move(r.x+r.width*.65,r.y+r.height*.6,{steps:24});
    await page.mouse.move(r.x+r.width*.45,r.y+r.height*.55,{steps:24}); await page.mouse.up();
  }
}
try {
  if (!process.env.PERF_ONLY) {
  await page.goto(`${origin}/play/`, { waitUntil:'domcontentloaded', timeout:45000 });
  await page.waitForFunction(() => window.TianxiaMap?.ready);
  const initial = await page.evaluate(() => ({started:window.TianxiaGame.getState().started,code:window.TianxiaCloudSave.ensureAccessCode()}));
  if (initial.started) throw new Error('Refuse to profile an existing campaign');
  qaCloudAccessCode = initial.code;
  await page.getByRole('button', {name:'受命于天 · 开始游戏'}).click();
  await page.getByRole('button', {name:'已知晓',exact:true}).click();
  await page.waitForTimeout(1200);
  await page.screenshot({path:`${output}/opening.png`});
  await measure('idle',()=>page.waitForTimeout(10000));
  await measure('zoom',()=>zoom(),true);
  await measure('pan',()=>pan());
  await page.locator('[data-speed="4"]').click();
  await measure('speed4-zoom',()=>zoom(),true);
  await page.locator('#pauseButton').click();
  await measure('modes',async()=>{for(const mode of ['terrain','supply','population','military','economy','morale','grain','diplomacy','faction']){await page.locator(`[data-map-mode="${mode}"]`).click();await page.waitForTimeout(300);}});
  await page.screenshot({path:`${output}/after-play.png`});
  report.checks.push(await page.evaluate(()=>({name:'normal',cloud:document.querySelector('#cloudButtonText')?.textContent,setupMounted:!!document.querySelector('#setupModal'),regionPaths:document.querySelectorAll('[data-region-cell]').length,calendar:window.TianxiaGame.getState().calendar})));
  if (process.env.QA_HIGH_ZOOM === '1') {
    for (const k of [1,2,4,8,12,20,48]) {
      await page.evaluate(k=>window.TianxiaMap.setCamera([[108,33],[110,35]],{scale:k}),k);
      await page.waitForTimeout(700);
      await measure(`zoom${k}-pan`,()=>pan(3));
      await page.screenshot({path:`${output}/zoom${k}.png`});
    }
  }
  }
  for(let level=1;level<=8;level++){
    await page.goto(`${origin}/play/?perf=${level}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.TianxiaPerformanceHarness?.ready);
    await page.waitForTimeout(400);
    report.checks.push(await page.evaluate(()=>({name:`perf=${window.TianxiaPerformanceHarness.level}`,gameRuntime:!!window.TianxiaGame?.getState,cloudClient:!!window.TianxiaCloudSave,dialogs:document.querySelectorAll('dialog').length,regions:document.querySelectorAll('[data-region-cell]').length})));
    await measure(`perf${level}`,()=>zoom(5));
  }
  // Calibrate rAF against an empty page on the same browser/host. A 30Hz
  // host cap is not a 30FPS game regression; retain both raw measurements.
  await page.goto('about:blank');
  await measure('blank-baseline',()=>page.waitForTimeout(3000));
} catch(error) { report.failure=error.stack; console.error(error); process.exitCode=1; }
finally {
  await browser.close();
  if (qaCloudAccessCode) {
    try {
      const cleanup=await fetch(`${origin}/api/save`,{method:'DELETE',headers:{authorization:`Bearer ${qaCloudAccessCode}`},signal:AbortSignal.timeout(10000)});
      if(!cleanup.ok&&cleanup.status!==404)throw new Error(`QA cleanup returned ${cleanup.status}`);
      report.testSaveCleanup=cleanup.status===404?'already absent':'deleted';
    } catch(error) {report.testSaveCleanup='failed';report.cleanupError=error.message;process.exitCode=1;}
  }
  await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
}
