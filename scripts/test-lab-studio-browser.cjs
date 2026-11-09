'use strict';
/* Browser-only fixture. Does not seed a real Lab or touch production records. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const playwright=require('playwright-core');
const root=process.cwd();
let empty=true,science=false;
let detailedFixture=false,guestQuestions=0,signedIn=false,savedConversation=[],lastScienceRequest=null,failScienceReply=false;
const atlasRuns=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(root,'backend/core/data/lab-scenario-atlas.json.gz')))).runs;
const scienceRoot=path.join(root,"lab-sources/science-universe");
const scienceManifest=JSON.parse(fs.readFileSync(path.join(scienceRoot,"manifest.json")));
const scienceLab={...scienceManifest,ready:true,run_url:"/lab-run/science-universe/",published_version:4};
const lab={
  slug:'fixture-lab',title:'Fixture Lab',summary:'Browser-only test',
  ready:true,run_url:'/lab-run/fixture-lab/',published_version:1,
  config:{components:['stage','controls','metrics','timeline','compare','layers','charts'],
    pulsar_enabled:true,auto_coach:false,learning_goal:'Learn one variable',
    sections:[{id:'observe',title:'Observe',hint:'Begin with a baseline.'}],
    guidance:[{event:'density_changed',section:'observe',hint:'Compare the density reading.'}]},
};
const sim=[
  '<!doctype html><html><head><meta charset="utf-8">',
  '<script src="/assets/lab-bridge.js"></script></head><body><script>',
  "window.GraviLab.register({section:'observe',",
  "controls:[{key:'density',label:'Density',min:0,max:1,step:0.1,value:0.4}],",
  "layers:[{key:'vectors',label:'Vectors',enabled:true}]});",
  "window.GraviLab.onControl(({key,value}) => {if(key==='density')window.GraviLab.emit('density_changed',{density:value},'observe');});",
  "window.GraviLab.emit('density_changed',{density:0.4},'observe');",
  '</script></body></html>',
].join('');
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/labs/'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ok:true,labs:empty?[]:[science?scienceLab:lab]}));return;
  }
  if(url.pathname==='/api/labs/fixture-lab/coach/'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ok:true,provider:'script',reply:'Try changing one variable.'}));return;
  }
  if(url.pathname==='/api/labs/science-universe/access/'){
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,authenticated:signedIn,owner_id:signedIn?1:null,used:guestQuestions,limit:25,remaining:signedIn?null:25-guestQuestions,simulation_open:true}));return;
  }
  if(url.pathname==='/api/auth/csrf/'){
    res.setHeader('Set-Cookie','csrftoken=fixturetoken; Path=/; SameSite=Lax');res.end('{}');return;
  }
  if(url.pathname==='/api/labs/science-universe/conversation/'){
    res.setHeader('Content-Type','application/json');if(!signedIn){res.writeHead(401);res.end('{}');return;}
    if(req.method==='POST'){let raw='';req.on('data',x=>raw+=x);req.on('end',()=>{savedConversation=JSON.parse(raw).messages;res.end(JSON.stringify({ok:true}));});return;}
    res.end(JSON.stringify({ok:true,messages:savedConversation}));return;
  }
  if(url.pathname==='/api/labs/science-universe/scenarios/compare/'){
    const data=require('./lab-atlas-preview.cjs').compareStored(atlasRuns,url.searchParams.get('policy')||'verification',Number(url.searchParams.get('low')||3),Number(url.searchParams.get('high')||9));
    res.setHeader('Content-Type','application/json');res.writeHead(data?200:404);res.end(JSON.stringify(data||{error:'comparison_not_available'}));return;
  }
  if(url.pathname==='/api/labs/science-universe/coach/'){
    let raw='';req.on('data',x=>raw+=x);req.on('end',()=>{const data=JSON.parse(raw);lastScienceRequest=data;res.setHeader('Content-Type','application/json');
      if(failScienceReply){res.writeHead(503);res.end(JSON.stringify({ok:false,error:'unavailable'}));return;}
      if(data.question&&data.event==='ask'){
        if(!signedIn&&guestQuestions>=25){res.writeHead(401);res.end(JSON.stringify({ok:false,error:'trial_exhausted',access:{authenticated:false,remaining:0,limit:25,used:25}}));return;}
        if(!signedIn)guestQuestions++;
      }
      const reply=data.question?'Fixture answer '+guestQuestions+': compare the two matched outcomes.':'Fixture guided note.';
      const detail=data.reply_detail==='detailed'?'\n\nCompare the review queues at the same point in both runs.'.repeat(19)+' End of detailed answer.':'';
      res.end(JSON.stringify({ok:true,provider:detailedFixture?'live':'script',reply:reply+detail,access:{authenticated:signedIn,remaining:signedIn?null:25-guestQuestions,limit:25,used:guestQuestions}}));
    });return;
  }
  if(url.pathname==='/lab-run/fixture-lab/'){
    res.setHeader('Content-Type','text/html');
    res.setHeader('X-Frame-Options','SAMEORIGIN');
    res.setHeader('Content-Security-Policy',
      "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; "+
      "style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; frame-ancestors 'self'");
    res.end(sim);return;
  }
  if(url.pathname.startsWith('/lab-run/science-universe/')){
    const name=url.pathname.slice('/lab-run/science-universe/'.length)||'index.html';
    if(!['index.html','styles.css','engine.js','app.js'].includes(name)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',types[path.extname(name)]||'text/plain');
    res.setHeader('Cross-Origin-Resource-Policy',name==='index.html'?'same-origin':'cross-origin');
    let code=fs.readFileSync(path.join(scienceRoot,name),'utf8');
    if(name==='index.html'){
      res.setHeader('Content-Security-Policy',"sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; frame-ancestors 'self'");
      code=code.replace('<head>','<head><script src="/assets/lab-bridge.js"></script>');
    }
    res.end(code);return;
  }
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    res.writeHead(404);res.end('Not found');return;
  }
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const browser=await playwright.chromium.launch({headless:true,
    executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',
    args:['--no-sandbox','--disable-dev-shm-usage']});
  let page;const runtimeErrors=[];
  try{
    page=await browser.newPage({viewport:{width:1200,height:900}});
    page.on('pageerror',err=>runtimeErrors.push(err.message));
    const url='http://127.0.0.1:'+port+'/lab.html';
    await page.goto(url,{waitUntil:'networkidle'});
    assert.equal(await page.locator('#lab-title').innerText(),'Change the conditions. Watch what follows.');
    assert.equal(await page.locator('#lab-experiences').isHidden(),true,
      'public Lab must remain empty before publish');
    empty=false;
    await page.reload({waitUntil:'networkidle'});
    await page.locator('.lab-catalog-card').waitFor();
    await page.locator('.lab-catalog-card').click();
    assert.equal(await page.locator('.lab-frame').count(),0,'science preview precedes the simulation');
    await page.getByRole('button',{name:'Enter simulation',exact:true}).click();
    await page.locator('.lab-frame').waitFor();
    await page.locator('.lab-metric-value').first().waitFor({timeout:10000});
    const initial=await page.locator('.lab-metric-value').first().innerText();
    assert.equal(initial,'0.4');
    const sliders=page.locator('.lab-dynamic-control input[type=range]');
    await sliders.first().waitFor({timeout:5000});
    await sliders.first().evaluate(el=>{el.value='0.7';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.lab-metric-value'))
      .some(el=>el.textContent==='0.7'));
    await page.getByPlaceholder('Ask about this experiment').fill('What changed?');
    await page.getByRole('button',{name:'Ask',exact:true}).click();
    await page.getByText('Try changing one variable.').waitFor({timeout:8000});
    assert.match(await page.locator('.lab-pulsar-source').innerText(),/guided note/i);
    await page.setViewportSize({width:390,height:844});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(overflow<=1,'mobile Lab horizontal overflow: '+overflow);
    console.log('Browser PASS: empty public Lab, published fixture, sandbox events, reactive slider and metrics, Pulsar scripted fallback, mobile.');
    science=true;
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(url+'?lab=science-universe',{waitUntil:'networkidle'});
    assert.equal(await page.locator('.lab-gallery-thumb').count(),6);
    await page.getByRole('button',{name:'Medium · Publication pressure'}).click();
    assert.match(await page.locator('.lab-preview-gallery figcaption').innerText(),/Publication pressure/);
    await page.getByRole('button',{name:'Enter simulation',exact:true}).click();
    const frame=page.frameLocator('.lab-frame');
    await frame.locator('#focused-model').waitFor();
    await page.getByText('Try a guided experiment',{exact:true}).waitFor();
    assert.equal(lastScienceRequest,null,'the first mission works without an AI request');
    const simPage=page.frame({url:/\/lab-run\/science-universe\//});
    assert.ok(simPage,'Science Universe frame has completed navigation');
    assert.equal(await frame.locator('#focused-model input').count(),1);
    assert.equal(await frame.locator('#focus-results strong').count(),1);
    assert.equal(await frame.locator('#comparison-setup').isVisible(),false);
    const setReview=value=>frame.locator('#focus-setting').evaluate((range,v)=>{range.value=v;range.dispatchEvent(new Event('input',{bubbles:true}));},value);
    for(const [setting,result] of [[2,'21'],[8,'0']]){
      await setReview(setting);await frame.locator('#focus-run').click();
      assert.equal(await frame.locator('#focus-results').innerText(),result);
    }
    await page.locator('.lab-mission').getByRole('button',{name:'8 / 10'}).click();
    assert.match(await page.locator('.lab-mission-feedback').innerText(),/try again/);
    await page.locator('.lab-mission').getByRole('button',{name:'2 / 10'}).click();
    await page.getByRole('button',{name:'Continue to Medium'}).click();
    await frame.locator('#universe-app[data-level=medium]').waitFor();
    await frame.locator('#focus-run').click();
    assert.deepEqual(await frame.locator('#focus-results strong').allInnerTexts(),['4','0']);
    await page.locator('.lab-mission').getByRole('button',{name:'World A'}).click();
    await page.getByRole('button',{name:'Continue to Advanced'}).click();
    await frame.locator('#network-a').waitFor();
    const mapHost=await page.locator('.lab-frame').boundingBox(),companion=await page.locator('.lab-pulsar-widget').boundingBox();
    assert.ok(mapHost.x+mapHost.width<=companion.x+1,'Pulsar has its own desktop column');
    assert.ok(companion.width>=252,'conversation remains readable');
    assert.equal(await page.locator('.lab-chat-body').isVisible(),true,'Pulsar starts available');
    await frame.getByRole('button',{name:'Guided tour',exact:true}).click();
    await page.getByRole('button',{name:'Build my first comparison',exact:true}).click();
    const controls=['verification','generation','replication','funding','aiAdoption','sampleSize','alpha','transparency','pressure','diversity','network','uncertainty'];
    for(let i=0;i<controls.length;i++){
      const key=controls[i],range=frame.locator('input[data-policy="'+key+'"]');
      await range.waitFor({state:'visible'});
      assert.equal(await frame.locator('#day').innerText(),'000','each lesson restarts from the matched checkpoint');
      const before=Number(await range.inputValue());
      await range.evaluate((node,value)=>{node.value=String(value);node.dispatchEvent(new Event('input',{bubbles:true}));},before+2);
      const observe=page.getByRole('button',{name:'Test both · 20 days',exact:true});
      await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Test both · 20 days')?.disabled);
      await observe.click();
      await simPage.waitForFunction(()=>document.getElementById('day').textContent==='020');
      await frame.locator('#world-a').click();assert.equal(await frame.locator('#day').innerText(),'020');
      await frame.locator('#world-b').click();assert.equal(await frame.locator('#day').innerText(),'020');
      if(i===0){assert.equal(await page.evaluate(()=>localStorage.getItem('graviquest:science-ecosystem:guide:v2')),'done','one observed comparison completes the first experiment');await page.getByRole('button',{name:'Finish first experiment',exact:true}).waitFor();}
      if(i<controls.length-1)await page.getByRole('button',{name:i===0?'Explore other controls':'Next control',exact:true}).click();
    }
    await page.getByRole('button',{name:'Skip guide',exact:true}).click();
    await frame.locator('#atlas').click();
    await page.locator('.atlas-outcome').first().waitFor();
    assert.equal(await page.locator('.lab-chat-body').isVisible(),true,'Pulsar is interactive while atlas is open');
    const atlasBounds=await page.locator('.lab-focus-workspace').boundingBox(),chatBounds=await page.locator('.lab-pulsar-widget').boundingBox();
    assert.ok(atlasBounds.x+atlasBounds.width<=chatBounds.x+1,'atlas never covers Pulsar');
    assert.match(await page.locator('.atlas-pair-basis').innerText(),/3 matched seeds/);
    await page.getByRole('group',{name:'Suggested replies'}).getByRole('button',{name:'Explain this result',exact:true}).click();
    await page.locator('.lab-chat-bubble').filter({hasText:'Fixture answer 1:'}).waitFor();
    assert.ok((await page.getByRole('group',{name:'Suggested replies'}).getByRole('button').count())>=2,'a completed answer always leaves prepared follow-ups');
    assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.lab-chat-starters')),true,'keyboard focus stays with prepared replies after an answer');
    // The explicit atlas action sends stored run signatures to the server, where they are resolved again.
    await page.getByRole('button',{name:'Ask Pulsar about these results',exact:true}).click();
    await page.locator('.lab-chat-bubble').filter({hasText:'Fixture answer 2:'}).waitFor();
    assert.equal(lastScienceRequest.atlas_comparison.signatures.length,6);
    await page.getByRole('button',{name:'Try this comparison in the Lab',exact:true}).click();
    await simPage.waitForFunction(()=>document.getElementById('day').textContent==='060');
    assert.equal(await page.locator('.lab-focus-workspace').count(),0);
    const expected=require('./lab-atlas-preview.cjs').compareStored(atlasRuns).pairs[0].b.result.published;
    assert.equal(Number((await frame.locator('#published').innerText()).replaceAll(',','')),expected,'replaying an atlas pair reproduces its actual stored B result');
    for(let i=3;i<=25;i++){
      await page.getByRole('textbox',{name:'Message Pulsar'}).fill('Fixture learning question '+i);
      await page.getByRole('button',{name:'Send to Pulsar'}).click();
      await page.locator('.lab-chat-bubble').filter({hasText:'Fixture answer '+i+':'}).waitFor();
    }
    assert.match(await page.locator('.lab-access-strip').innerText(),/25 guest questions are complete/);
    assert.match(await page.locator('.lab-access-strip').innerText(),/simulation and atlas stay open/);
    await frame.locator('#advance').click();assert.equal(await frame.locator('#day').innerText(),'061','the guest gate does not close the model');
    signedIn=true;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByRole('button',{name:'Save this conversation',exact:true}).waitFor();
    await page.getByRole('button',{name:'Save this conversation',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.lab-access-strip').dataset.saved==='true');
    assert.ok(savedConversation.some(m=>m.text==='Fixture learning question 25'));
    await page.reload({waitUntil:'networkidle'});
    await page.locator('.lab-frame').waitFor();
    assert.equal(await page.locator('.lab-pulsar-welcome').count(),0,'returning visitors go straight to the simulator');
    assert.equal(await page.locator('.lab-science-preview').count(),0,'refresh stays in the Lab');
    await page.locator('.lab-chat-bubble').filter({hasText:'Fixture learning question 25'}).waitFor();
    await page.getByRole('textbox',{name:'Message Pulsar'}).fill('Account-only learning question');
    await page.getByRole('button',{name:'Send to Pulsar'}).click();
    await page.waitForFunction(()=>document.querySelector('.lab-access-strip').dataset.saved==='true');
    assert.ok(savedConversation.some(m=>m.text==='Account-only learning question'));
    signedIn=false;
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(()=>document.querySelector('.lab-access-strip').textContent.includes('25 guest questions are complete'));
    assert.equal(await page.locator('.lab-chat-bubble').filter({hasText:'Account-only learning question'}).count(),0,'signing out restores guest history without exposing account-only messages');
    await page.setViewportSize({width:390,height:844});
    await page.getByText('Try a guided experiment',{exact:true}).waitFor();
    await frame.getByRole('button',{name:'Advanced',exact:true}).click();
    const mobileMap=await page.locator('.lab-frame').boundingBox(),mobileCompanion=await page.locator('.lab-pulsar-widget').boundingBox();
    assert.ok(mobileMap.y+mobileMap.height<=mobileCompanion.y+1,'mobile companion sits below the simulation, never over it');
    assert.ok(mobileCompanion.y+mobileCompanion.height<=845);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1);
    await page.frameLocator('.lab-frame').locator('#atlas').click();
    await page.locator('.atlas-outcome').first().waitFor();
    assert.equal(await page.getByRole('textbox',{name:'Message Pulsar'}).isVisible(),true,'mobile atlas and Pulsar are available together');
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.frameLocator('.lab-frame').locator('#back-labs').click();
    assert.equal(await page.locator('body>.g-header').isVisible(),true);
    console.log('Science learning PASS: all 12 controls, isolated paired lessons, atlas evidence and replay, non-overlapping desktop/mobile companion, 25-question guest gate, private account continuation, refresh.');
    assert.deepEqual(runtimeErrors,[],'Lab runtime must not throw browser errors');
    await page.close();
    guestQuestions=0;detailedFixture=true;
    const fresh=await browser.newContext({viewport:{width:390,height:700},isMobile:true,hasTouch:true});page=await fresh.newPage();page.on('pageerror',err=>runtimeErrors.push(err.message));
    await page.goto(url+'?lab=science-universe',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Enter simulation',exact:true}).click();
    await page.getByText('Try a guided experiment',{exact:true}).waitFor();
    const mobileFrame=page.frameLocator('.lab-frame');
    const replies=page.getByRole('group',{name:'Suggested replies'});
    const input=page.getByRole('textbox',{name:'Message Pulsar'});
    const views=page.getByRole('group',{name:'Pulsar view'});
    const compact=await page.locator('.lab-pulsar-widget').boundingBox();
    assert.equal(await input.isVisible(),false,'experiment dock gives the simulation more room');
    await views.getByRole('button',{name:'Chat',exact:true}).click();
    const expanded=await page.locator('.lab-pulsar-widget').boundingBox();
    assert.ok(expanded.height>=compact.height+100,'the transcript gets a larger dock');
    assert.equal(await page.getByText('Try a guided experiment',{exact:true}).isVisible(),false,'experiment controls do not crowd the transcript');
    failScienceReply=true;
    await input.fill('Explain this result');await page.getByRole('button',{name:'Send to Pulsar'}).click();
    await replies.getByRole('button',{name:'Try again',exact:true}).waitFor();
    failScienceReply=false;await replies.getByRole('button',{name:'Try again',exact:true}).click();
    await page.locator('.lab-chat-bubble').filter({hasText:'Fixture answer 1:'}).waitFor();
    assert.equal(lastScienceRequest.context.level,'simple');
    assert.equal(lastScienceRequest.reply_detail,undefined);
    await input.fill('این نتیجه را ساده توضیح بده');await page.getByRole('button',{name:'Send to Pulsar'}).click();
    await page.locator('.lab-chat-bubble').filter({hasText:'Fixture answer 2:'}).waitFor();
    await replies.getByRole('button',{name:'مفصل‌تر توضیح بده',exact:true}).click();
    await page.locator('.lab-chat-bubble').filter({hasText:'Fixture answer 3:'}).waitFor();
    assert.equal(lastScienceRequest.reply_detail,'detailed');
    assert.equal(await replies.getAttribute('dir'),'rtl','prepared replies follow the user’s conversation language');
    const longReply=await page.locator('.lab-chat-history').evaluate(history=>{
      const answer=history.querySelector('.lab-chat-bubble:last-child'),bounds=history.getBoundingClientRect();
      const start=answer.getBoundingClientRect().top;
      history.scrollTop=history.scrollHeight;
      const composer=history.nextElementSibling.getBoundingClientRect();
      return {start:Math.round(start-bounds.top),scrollable:history.scrollHeight>history.clientHeight,
        endVisible:answer.getBoundingClientRect().bottom<=bounds.bottom+1,
        composerVisible:composer.bottom<=window.innerHeight+1};
    });
    assert.ok(longReply.start>=0&&longReply.start<=15,'a long reply opens at the first line');
    assert.ok(longReply.scrollable&&longReply.endVisible&&longReply.composerVisible,'scroll to the end while the composer stays visible');
    await input.focus();
    await page.getByRole('button',{name:'Close Pulsar conversation',exact:true}).click();
    await page.getByRole('button',{name:'Open Pulsar conversation',exact:true}).click();
    assert.equal(await input.evaluate(el=>el===document.activeElement),false,'reopening the dock does not restore keyboard focus');
    await views.getByRole('button',{name:'Experiment',exact:true}).click();
    await page.getByText('Try a guided experiment',{exact:true}).click();
    await page.getByRole('button',{name:'Publication pressure',exact:true}).click();
    await mobileFrame.getByText('False claims published in the model',{exact:true}).waitFor();
    await mobileFrame.locator('#focus-run').click();
    assert.deepEqual(await mobileFrame.locator('#focus-results strong').allInnerTexts(),['4','12']);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1);
    assert.deepEqual(runtimeErrors,[]);await fresh.close();
    console.log('Progressive Lab PASS: gallery, one-control mission, level unlocking, guided scenario, concise/detailed requests and mobile.');
  }catch(err){
    console.error('Browser errors:',runtimeErrors);
    if(page){fs.mkdirSync('qa-artifacts',{recursive:true});await page.screenshot({path:'qa-artifacts/lab-workspace-failure.png',fullPage:true}).catch(()=>{});}
    throw err;
  }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>server.close());
