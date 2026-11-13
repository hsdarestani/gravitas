'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../lab-sources/science-universe/engine.js');
const playwright=require('playwright-core');
const root=process.cwd();
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const published=pathname.startsWith('/lab-run/science-universe/');
  if(pathname==='/api/labs/'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({labs:[{slug:'science-universe',ready:true,title:'Science Ecosystem',
      run_url:'/lab-run/science-universe/',config:{components:['stage'],pulsar_enabled:true}}]}));
    return;
  }
  if(pathname==='/api/labs/science-universe/access/'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({authenticated:false,remaining:5}));return;
  }
  const source=published?pathname.replace('/lab-run/','/lab-sources/').replace(/\/$/,'/index.html'):pathname;
  const file=path.resolve(root,'.'+source);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    res.writeHead(404);res.end('Not found');return;
  }
  res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');
  if(published&&path.extname(file)==='.html'){
    res.setHeader('Content-Security-Policy',"sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'");
    res.end(fs.readFileSync(file,'utf8').replace('<head>','<head><script src="/assets/lab-bridge.js"></script>'));return;
  }
  res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await playwright.chromium.launch({
    headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',
    args:['--no-sandbox','--disable-dev-shm-usage']
  });
  try{
    const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const address='http://127.0.0.1:'+server.address().port+'/lab-sources/science-universe/index.html';
    await page.goto(address,{waitUntil:'networkidle'});
    const host='http://127.0.0.1:'+server.address().port;
    const shell=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    shell.on('pageerror',e=>errors.push(e.message));
    let posted;
    await shell.route('**/api/labs/science-universe/coach/',route=>{
      posted=route.request().postDataJSON();
      return route.fulfill({json:{ok:true,provider:'script',reply:'The fixture received the simulation result.'}});
    });
    await shell.goto(host+'/lab.html?lab=science-universe');
    const frame=shell.frameLocator('.lab-frame');
    const run=frame.locator('#focus-run'),slider=frame.locator('#focus-setting');
    await run.waitFor();
    assert.equal(await shell.getByRole('button',{name:'Enter simulation'}).count(),0);
    assert.equal(await shell.getByRole('button',{name:/Open Pulsar conversation/}).getAttribute('aria-expanded'),'false');
    fs.mkdirSync('qa-artifacts',{recursive:true});
    for(const [width,height] of [[1440,900],[1280,720],[768,900],[390,844],[360,740]]){
      await shell.setViewportSize({width,height});
      for(const element of [run,slider,frame.locator('#focus-chart')]){
        const rect=await element.boundingBox();
        assert.ok(rect&&rect.x>=0&&rect.x+rect.width<=width+1&&rect.y>=0&&rect.y+rect.height<=height,
          'Primary experiment controls fit at '+width+'px: '+JSON.stringify(rect));
      }
      if(width===1440||width===390)await shell.screenshot({path:'qa-artifacts/science-universe-after-'+width+'.png'});
    }
    await shell.setViewportSize({width:1440,height:900});
    await run.click();
    const baseline=E.summary(E.step(E.make(20261029),45)).reviewBacklog;
    assert.equal(await frame.locator('#focus-results strong').innerText(),String(baseline));
    await frame.getByLabel('Smaller').check();
    await slider.press('End');
    assert.match(await frame.locator('#focus-status').innerText(),/Settings changed/);
    assert.equal(await frame.locator('#focus-results strong').innerText(),String(baseline));
    await run.click();
    const trial=E.summary(E.step(E.make(20261029,{verification:10}),45)).reviewBacklog;
    assert.deepEqual(await frame.locator('#focus-results strong').allTextContents(),[String(baseline),String(trial)]);
    assert.match(await frame.locator('#focus-comparison').innerText(),/prediction/);
    await frame.getByRole('button',{name:'Testing'}).click();
    await frame.locator('#focus-time').press('Home');
    assert.deepEqual(await frame.locator('#focus-results strong').allTextContents(),['0','0']);
    await frame.locator('#focus-replay').click();
    assert.equal(await frame.locator('#focus-time').inputValue(),'45');
    await frame.locator('#focus-explain').click();
    await shell.getByText('The fixture received the simulation result.').waitFor();
    assert.equal(posted.context.focusedMetric,'tested');
    assert.equal(posted.context.comparison.b.reviewBacklog,trial);
    await frame.locator('#focus-next').click();
    await frame.locator('#focus-medium-controls').waitFor();
    await run.click();
    assert.match(await frame.locator('#focus-io-caption').innerText(),/World A.*World B/);
    await frame.getByRole('slider',{name:'Peer review capacity in World B'}).press('End');
    await run.click();
    assert.match(await frame.locator('#focus-io-caption').innerText(),/Multiple changes/);
    await frame.getByRole('button',{name:'Simple',exact:true}).click();
    await frame.locator('#focus-reset').click();
    assert.equal(await slider.inputValue(),'5');
    await shell.reload();
    await run.waitFor();
    await shell.goto(host+'/lab.html');
    await shell.locator('.lab-catalog-card').filter({hasText:'Science Ecosystem'}).click();
    await shell.getByRole('button',{name:'Enter simulation'}).waitFor();
    const touch=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
    await touch.goto(host+'/lab.html?lab=science-universe');
    const touchFrame=touch.frameLocator('.lab-frame');
    await touchFrame.locator('#focus-run').tap();
    await touchFrame.getByRole('button',{name:/Publication/}).tap();
    assert.equal(await touchFrame.locator('#focus-metric').innerText(),'Studies published');
    await touch.close();
    await shell.close();
    await page.getByRole('button',{name:'Advanced',exact:true}).click();
    await page.locator('#agents').waitFor();
    assert.equal(await page.locator('.tiny-metric').count(),6);
    assert.equal(await page.locator('#policy-drawer').isHidden(),true);
    const agents=Number((await page.locator('#agents').innerText()).replaceAll(',',''));
    assert.ok(agents>=100,'research world needs 100+ agents');
    await page.locator('#advance').click();
    assert.equal(await page.locator('#day').innerText(),'000','time waits for a controlled comparison');
    await page.locator('#start-comparison').click();
    await page.locator('#world-a').click();
    for(let i=0;i<10;i++)await page.locator('#advance').click();
    const day=await page.locator('#day').innerText();
    assert.equal(day,'010');
    const generated=Number((await page.locator('#hypotheses').innerText()).replaceAll(',',''));
    assert.ok(generated>0,'real engine generates ideas after time advance');
    const labPicture=await page.locator('#network-a').evaluate(x=>x.toDataURL());
    await page.locator('#view-papers').click();
    assert.match(await page.locator('#map-explanation').innerText(),/Small dots are published claims/);
    assert.ok(Number(await page.locator('#network-a').getAttribute('data-visible-papers'))>0);
    assert.notEqual(await page.locator('#network-a').evaluate(x=>x.toDataURL()),labPicture,'the views represent different model objects');
    const claimDates=await page.locator('#claim-select option').evaluateAll(options=>options.slice(1).map(o=>Number(o.textContent.match(/day (\d+)/)[1])));
    assert.ok(claimDates.every((day,i)=>i===0||claimDates[i-1]>=day),'claims are ordered by publication time, not hypothesis creation');
    const claim=await page.locator('#claim-select option').nth(1).getAttribute('value');
    await page.locator('#claim-select').selectOption(claim);
    assert.equal(await page.locator('#inspector-dialog').evaluate(x=>x.open),false,'claim selection keeps the overview readable');
    await page.locator('#inspector-more').click();
    await page.locator('#selected-paper').waitFor({state:'visible'});
    assert.match(await page.locator('#selected-paper').innerText(),new RegExp('Paper #'+claim));
    await page.locator('#close-inspector').click();
    await page.locator('#view-labs').click();
    const click=await page.evaluate(()=>{
      const canvas=document.getElementById('network-a');
      const lab=ScienceUniverseEngine.make(20261029).labs[0];
      const r=canvas.getBoundingClientRect();
      return {x:r.left+28+lab.x*(r.width-56),y:r.top+28+lab.y*(r.height-56)};
    });
    await page.mouse.click(click.x,click.y);
    await page.locator('#inspector-content').waitFor({state:'visible'});
    assert.match(await page.locator('#selected-title').innerText(),/Helix|Stratus|Axiom|Lattice/);
    const aligned=await page.evaluate(()=>{const a=document.querySelector('.world-stage').getBoundingClientRect(),b=document.querySelector('.workspace-side').getBoundingClientRect();return {top:Math.abs(a.top-b.top),bottom:Math.abs(a.bottom-b.bottom),inspectorScroll:document.getElementById('inspector').scrollHeight-document.getElementById('inspector').clientHeight};});
    assert.ok(aligned.top<1&&aligned.bottom<1,'right panels and companion align with the map');
    assert.ok(aligned.inspectorScroll<2,'the summary has no internal scrollbar');
    await page.setViewportSize({width:1280,height:720});
    const compactSummary=await page.locator('#inspector').evaluate(el=>({overflow:el.scrollHeight-el.clientHeight,moreBottom:el.querySelector('#inspector-more').getBoundingClientRect().bottom,bottom:el.getBoundingClientRect().bottom}));
    assert.ok(compactSummary.overflow<2&&compactSummary.moreBottom<compactSummary.bottom,'See more remains visible on short desktop windows');
    await page.setViewportSize({width:1365,height:900});
    await page.locator('#inspector-more').click();
    await page.locator('#fund-lab').click();
    assert.match(await page.locator('#intervention-status').innerText(),/Intervention applied/);
    await page.locator('#close-inspector').click();
    const mapBeforePolicy=await page.locator('#network-a').boundingBox();
    await page.locator('#settings').click();
    assert.equal(await page.locator('.policy-control').count(),12);
    const policyLayout=await page.evaluate(()=>{
      const map=document.getElementById('network-a').getBoundingClientRect(),panel=document.querySelector('.drawer-panel').getBoundingClientRect();
      return {width:map.width,height:map.height,mapRight:map.right,panelLeft:panel.left,hit:document.elementFromPoint(map.left+map.width/2,map.top+map.height/2)?.id};
    });
    assert.equal(policyLayout.width,mapBeforePolicy.width,'opening policies never resizes the map');
    assert.equal(policyLayout.height,mapBeforePolicy.height,'opening policies keeps map height');
    assert.ok(policyLayout.mapRight<=policyLayout.panelLeft,'policies dock beside the map');
    assert.equal(policyLayout.hit,'network-a','there is no dark or blocking policy overlay');
    const range=page.locator('input[data-policy=pressure]');
    await range.evaluate(el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.match(await page.locator('input[data-policy=pressure]').inputValue(),/10/);
    await page.locator('#policy-advance').click();
    assert.equal(await page.locator('#day').innerText(),'020','model continues while the policy panel is open');
    await page.locator('#close-settings').click();
    await page.locator('#world-b').click();
    await page.locator('#comparison').waitFor({state:'visible'});
    await page.locator('#network-b').waitFor({state:'visible'});
    assert.equal(await page.locator('.comparison-row').count(),6);
    assert.equal(await page.locator('#policy-world').innerText(),'EDITING WORLD B');
    await page.locator('#close-compare').click();
    assert.equal(await page.locator('#close-compare').innerText(),'Show comparison');
    await page.locator('#close-compare').click();
    assert.equal(await page.locator('#close-compare').innerText(),'Hide comparison','comparison can reopen in place');
    await page.locator('#advance').click();
    await page.locator('#view-papers').click();
    await page.locator('#metric-select').selectOption('falsePublished');
    assert.equal(await page.locator('#outcome-data').isHidden(),true);
    await page.locator('#toggle-data').click();
    assert.ok(await page.locator('#outcome-data tbody tr').count()>0);
    await page.locator('#toggle-data').click();
    const still=await page.locator('#network-b').evaluate(x=>x.toDataURL());
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#network-b').evaluate(x=>x.toDataURL()),still,'paused model has no independent visual animation');
    await page.locator('#play').click();
    const selectedText=await page.evaluate(()=>{const node=document.getElementById('map-explanation');const range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);return String(getSelection());});
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(()=>String(getSelection())),selectedText,'text selection survives running model updates');
    await page.evaluate(()=>getSelection().removeAllRanges());
    await page.locator('#play').click();
    await page.locator('#map-help').click();
    assert.equal(await page.locator('#map-key-content svg').count(),3,'a visual legend explains the map');
    await page.locator('#close-map-help').click();
    await page.locator('#more-events').click();
    assert.ok(await page.locator('#event-history .feed-event').count()>3,'full event history is available on demand');
    await page.locator('#close-events').click();
    await page.locator('#methodology').click();
    assert.equal(await page.locator('#method-dialog').evaluate(x=>x.open),true);
    await page.locator('#method-done').click();
    fs.mkdirSync('qa-artifacts',{recursive:true});
    await page.screenshot({path:'qa-artifacts/science-universe-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('#settings').click();
    const mobilePolicy=await page.evaluate(()=>{
      const r=document.getElementById('network-b').getBoundingClientRect(),p=document.querySelector('.drawer-panel').getBoundingClientRect();
      return {visibleMap:Math.max(0,Math.min(r.bottom,p.top)-Math.max(r.top,0)),panelWidth:p.width};
    });
    assert.ok(mobilePolicy.visibleMap>150,'mobile policies leave part of the live map visible');
    assert.ok(mobilePolicy.panelWidth<=390);
    await page.locator('#close-settings').click();
    await page.screenshot({path:'qa-artifacts/science-universe-mobile.png',fullPage:true});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(overflow<=2,'mobile horizontal overflow: '+overflow);
    assert.deepEqual(errors,[],'browser must have no JavaScript runtime errors');
    console.log('BROWSER PASS: 100+ agents, 12 policies, model-driven generation, lab interventions, fork, dual worlds, charts, model limitations, mobile.');
  }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>server.close());
