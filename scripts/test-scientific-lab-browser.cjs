'use strict';
// Real local Django integration, external calls are fixtures in the Python harness.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const url='http://127.0.0.1:18834',project=process.env.GQ_QA_PROJECT;
 const shots=path.resolve('qa-artifacts/scientific-lab');fs.mkdirSync(shots,{recursive:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addCookies([{name:'sessionid',value:process.env.GQ_QA_OWNER_SESSION,url}]);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url+'/lab-ai-reliability.html?project='+project);await page.waitForFunction(()=>!document.getElementById('create').disabled);
  await page.locator('#question').fill('Which references support this controlled QA question?');
  await page.locator('#hypothesis').fill('Retrieval changes the proportion of verifiable metadata in this QA fixture.');
  await page.locator('#repeats').fill('1');await page.locator('#reference_count').fill('1');
  await page.locator('#create').click();await page.getByRole('button',{name:'Submit protocol for review',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#run-detail .badge').textContent==='protocol review');
  const listed=await page.evaluate(async p=>(await (await fetch(`/api/platform/projects/${p}/scientific-lab/runs/`)).json()).runs,project);
  assert.equal(listed.length,1);const id=listed[0].id;
  await context.addCookies([{name:'sessionid',value:process.env.GQ_QA_REVIEWER_SESSION,url}]);
  await page.goto(`${url}/lab-ai-reliability.html?project=${project}&run=${id}`);
  page.on('dialog',d=>d.accept('Reviewed fixture methodology and explicitly limited claims.'));
  await page.getByRole('button',{name:'Approve protocol (independent manager)',exact:true}).click();
  await page.getByRole('button',{name:'Queue bounded experiment',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#run-detail .badge').textContent==='queued');
  await page.request.post(url+'/__qa__/execute');
  await page.getByRole('button',{name:'Refresh',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.reference').length===2);
  for(let i=0;i<2;i++){
   const form=page.locator('.reference form').nth(i);
   await form.locator('textarea').fill('The controlled fixture is not source evidence; support cannot be established.');
   await form.locator('input[type=number]').fill('30');
   const assessmentResponse=page.waitForResponse(resp=>resp.url().endsWith(id+'/') && resp.request().method()==='POST');
   await form.getByRole('button').click();
   assert.equal((await assessmentResponse).status(),200);
   await page.waitForFunction(n=>[...document.querySelectorAll('#run-detail summary')].filter(x=>x.textContent.startsWith('assessment ')).length===n,i+1);
  }
  // Wait for the latest render before submitting the review transition.
  await page.waitForTimeout(250);
  await page.getByRole('button',{name:'Complete independent scientific review',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#run-detail .badge').textContent==='reviewed');
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'JSON report',exact:true}).click();const file=await download;assert.ok(file.suggestedFilename().endsWith('.json'));
  const saved=path.join(shots,'fixture-report.json');await file.saveAs(saved);const report=JSON.parse(fs.readFileSync(saved,'utf8'));assert.equal(report.trials.length,2);assert.equal(report.events.filter(e=>e.kind==='assessment').length,2);
  await page.locator('#evidence').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(shots,'desktop-fixture-evidence.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(shots,'mobile-fixture-evidence.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.goto(url+'/lab-observations.html');await page.waitForFunction(()=>document.querySelectorAll('#observed-rows tr').length>50);
  const before=await page.locator('#observed-method').innerText();await page.locator('#observed-degree').selectOption('2');assert.notEqual(await page.locator('#observed-method').innerText(),before);
  await page.locator('#forecast').selectOption('2');await page.screenshot({path:path.join(shots,'mobile-noaa-observations.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await context.clearCookies();await page.goto(url+'/lab-ai-reliability.html');await page.getByText('Sign in to GraviQuest to create and resume research experiments.').waitFor();assert.equal(await page.locator('#create').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log('PASS: real local Django + CSRF + Chromium protocol/review/worker fixture/evidence/export/resume/mobile/auth/data analysis. No empirical external API results asserted.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
