'use strict';
/* Disposable local fixture in CI. Never signs in to or mutates production. */
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const playwright=require('playwright-core'),root=process.cwd(),fixture=require('./lab-admin-fixture.cjs')(root),source=path.join(root,'lab-sources/science-universe');
const atlas=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'backend/core/data/lab-scenario-atlas.json.gz')))).runs;
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');if(fixture.handle(req,res,url))return;
 if(url.pathname==='/api/labs/science-universe/scenarios/compare/'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(require('./lab-atlas-preview.cjs').compareStored(atlas)));return;}
 const match=url.pathname.match(/^\/(?:lab-run\/science-universe|api\/platform\/admin\/labs\/1\/preview)\/(.*)$/);
 let file=match?path.join(source,match[1]||'index.html'):path.resolve(root,'.'+decodeURIComponent(url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
 res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cross-Origin-Resource-Policy','cross-origin');let data=fs.readFileSync(file);
 if(match&&path.extname(file)==='.html'){res.setHeader('Content-Security-Policy',"sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; frame-ancestors 'self'");data=data.toString().replace('<head>','<head><script src="/assets/lab-bridge.js"></script>');}
 res.end(data);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 const browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox','--disable-dev-shm-usage']});let page;const errors=[];
 try{
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(url+'/__qa__/lab-admin/',{waitUntil:'networkidle'});
  await page.getByText('Source matches live',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Pulsar & lessons',exact:true}).click();
  assert.equal(await page.locator('.ls-guided-control').count(),12);
  await page.getByLabel('Guest questions before an account is needed',{exact:false}).fill('3');
  await page.getByLabel('Model days per guided test',{exact:false}).fill('7');
  await page.getByRole('switch',{name:/Offer the guide on the first visit/}).uncheck();
  const lesson=page.locator('.ls-guided-control').first();await lesson.locator('summary').click();await lesson.getByLabel('Question to explore',{exact:true}).fill('Which queue is limiting research?');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Settings have draft changes',{exact:true}).waitFor();
  assert.equal(fixture.published.config.learning_workspace.lesson_days,20,'draft changes stay private');
  assert.equal(fixture.draft.config.learning_workspace.lesson_days,7);
  await page.getByRole('button',{name:'Publish new version',exact:true}).click();await page.getByText('Settings match live',{exact:true}).waitFor();
  assert.equal(fixture.published.config.learning_workspace.guest_question_limit,3);
  await page.getByRole('button',{name:'History',exact:true}).click();await page.waitForFunction(()=>document.querySelector('select')&&Array.from(document.querySelectorAll('.ls-tabpane:not([hidden]) select option')).length>=2);
  await page.getByRole('button',{name:'Scientific context',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('.ls-tabpane:not([hidden]) select option')).length===5);
  await page.getByRole('button',{name:'Usage analytics',exact:true}).click();await page.getByText('QA Researcher',{exact:true}).waitFor();
  const patches=fixture.patches;
  await page.getByRole('combobox',{name:'Visitor type',exact:true}).selectOption('guests');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.getByText('QA Researcher',{exact:true}).waitFor({state:'hidden'});await page.getByText('Guest aaaaaaaaaaaa',{exact:true}).waitFor();
  assert.equal(await page.getByText('QA Researcher',{exact:true}).count(),0);assert.equal(fixture.patches,patches,'analytics filtering never submits the Lab draft form');
  await page.getByRole('combobox',{name:'Visitor type',exact:true}).selectOption('all');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.getByText('QA Researcher',{exact:true}).waitFor();
  await page.getByRole('button',{name:'View activity',exact:true}).first().click();await page.getByRole('button',{name:'View events',exact:true}).click();
  await page.getByText('Parameter changed',{exact:true}).waitFor();assert.equal(await page.getByText('Server confirmed',{exact:true}).count(),2);assert.match(await page.locator('.ls-usage-events').innerText(),/Peer review capacity/);
  await page.getByRole('button',{name:'Saved-user records',exact:true}).click();await page.getByRole('heading',{name:'Saved-user records',exact:true}).waitFor();assert.match(await page.locator('.ls-usage-table tbody').innerText(),/researcher@example.test/);
  await page.getByRole('button',{name:'All Lab usage',exact:true}).click();await page.locator('.ls-usage-global').getByText('QA Researcher',{exact:true}).waitFor();assert.equal(await page.locator('.ls-layout').isHidden(),true);
  fs.mkdirSync('qa-artifacts',{recursive:true});await page.screenshot({path:'qa-artifacts/lab-admin-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1,'admin analytics must not stretch the mobile page');await page.screenshot({path:'qa-artifacts/lab-admin-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.goto(url+'/lab.html?lab=science-universe',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Enter simulation',exact:true}).click();
  const sim=page.frameLocator('.lab-frame');await sim.locator('#focused-model').waitFor();await page.getByText('3 of 3 guest questions left.',{exact:true}).waitFor();assert.equal(await page.locator('.lab-learning-guide').isHidden(),true,'published first-visit setting is honored');assert.equal(await page.locator('.lab-mission').isHidden(),true,'the published setting disables automatic mission prompts');
  assert.equal(fixture.batches.length,0,'optional usage analytics sends nothing before consent');
  const firstVisit=page.waitForResponse(r=>r.url().endsWith('/usage/')&&r.request().method()==='POST');await page.getByRole('checkbox',{name:'Share usage statistics (optional)',exact:true}).check();await firstVisit;
  await sim.getByRole('button',{name:'Advanced',exact:true}).click();
  await sim.getByRole('button',{name:'Guided tour',exact:true}).click();await page.getByRole('button',{name:'Build my first comparison',exact:true}).click();await page.getByText('Which queue is limiting research?',{exact:true}).waitFor();
  await sim.getByRole('slider',{name:'Peer review capacity',exact:true}).press('ArrowRight');
  const observe=page.getByRole('button',{name:'Test both · 7 days',exact:true});await observe.waitFor();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test both · 7 days')?.disabled);const guidedBatch=page.waitForResponse(r=>r.url().endsWith('/usage/')&&r.request().method()==='POST'&&r.request().postDataJSON()?.events?.some(e=>e.kind==='guide_test'),{timeout:20000});await observe.click();
  const model=page.frame({url:/\/lab-run\/science-universe\//});await model.waitForFunction(()=>document.getElementById('day').textContent==='007');
  await guidedBatch;assert.ok(fixture.batches.flatMap(b=>b.events).some(e=>e.kind==='parameter_changed'));assert.ok(fixture.batches.flatMap(b=>b.events).some(e=>e.kind==='guide_test'));assert.ok(!JSON.stringify(fixture.batches).includes('Which queue is limiting research?'),'guide and question text are excluded from analytics');
  await page.getByRole('checkbox',{name:'Share usage statistics (optional)',exact:true}).uncheck();const count=fixture.batches.length;await sim.locator('#advance').click();await page.waitForTimeout(900);assert.equal(fixture.batches.length,count,'withdrawing consent stops further analytics');
  await page.getByRole('textbox',{name:'Message Pulsar',exact:true}).fill('Can I keep using the Lab after declining optional statistics?');await page.getByRole('button',{name:'Send to Pulsar',exact:true}).click();await page.getByText('QA fixture response. No live AI model is called here.',{exact:true}).last().waitFor();assert.equal(fixture.coachRequests.at(-1).usage_visit,null);
  assert.deepEqual(errors,[],'admin and public learning workspace have no runtime errors');
  console.log('Lab admin PASS: source/settings sync, all 12 guide texts, private draft/publish, live guest limit and 7-day lessons, visitor filters, session events, saved-record metadata, mobile layout, opt-in/withdrawal without blocking the Lab.');
 }catch(e){if(page){fs.mkdirSync('qa-artifacts',{recursive:true});await page.screenshot({path:'qa-artifacts/lab-admin-browser-failure.png',fullPage:true}).catch(()=>{});}throw e;}
 finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
