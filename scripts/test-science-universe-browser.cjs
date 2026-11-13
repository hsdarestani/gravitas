'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const E=require('../lab-sources/science-universe/engine.js');
const {execFileSync}=require('node:child_process');
const viewportSizes=[[1440,900],[1280,720],[768,900],[390,844],[360,740]];
const playwright=require('playwright-core');
const root=process.cwd();
const prior=process.env.SCIENCE_UX_BEFORE;
const beforeSources=new Map(prior?['index.html','app.js','styles.css','engine.js'].map(name=>[
  name,execFileSync('git',['show',prior+':lab-sources/science-universe/'+name],{encoding:'utf8'})
]):[]);
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const published=pathname.startsWith('/lab-run/science-universe/');
  const priorSource=pathname.startsWith('/science-ux-before/');
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
  if(priorSource&&prior){
    const name=pathname.split('/').at(-1)||'index.html';
    res.setHeader('Content-Type',types[path.extname(name)]||'text/plain');
    res.end(beforeSources.get(name)||'');return;
  }
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
function portablePreview(){
  const source=path.join(root,'lab-sources/science-universe');
  const read=name=>fs.readFileSync(path.join(source,name),'utf8');
  const css=read('styles.css').replace(/url\("\/assets\/fonts\/([^"]+)"\)/g,(_,name)=>
    'url("data:font/ttf;base64,'+fs.readFileSync(path.join(root,'assets/fonts',name)).toString('base64')+'")');
  let html=read('index.html').replace('<link rel="stylesheet" href="styles.css">',()=>'<style>'+css+'</style>');
  for(const name of ['engine.js','app.js']){
    html=html.replace('<script src="'+name+'"></script>',()=>'<script>'+read(name).replace(/<\/script/gi,'<\\/script')+'</script>');
  }
  fs.writeFileSync('qa-artifacts/science-universe-preview.html',html);
}
async function screenshots(browser,host,after){
  const page=await browser.newPage({reducedMotion:'reduce'});
  try{
    for(const [width,height] of [[1440,900],[390,844]])for(const mode of ['Simple','Medium','Advanced']){
      await page.setViewportSize({width,height});
      await page.goto(after?host+'/lab-sources/science-universe/index.html':host+'/science-ux-before/');
      await page.getByRole('button',{name:mode,exact:true}).click();
      if(mode==='Advanced'){
        await page.locator('#advance').click();
        await page.locator('#start-comparison').click();
        for(let i=0;i<12;i++)await page.locator('#advance').click();
      }else await page.locator('#focus-run').click();
      await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
      await page.screenshot({path:'qa-artifacts/science-universe-'+(after?'after':'before')+'-'+mode.toLowerCase()+'-'+width+'.png'});
    }
  }finally{await page.close();}
}
async function recordDemos(browser,address){
  const page=await browser.newPage({viewport:{width:1280,height:820}});
  const session=await page.context().newCDPSession(page);
  try{
    for(const mode of ['Simple','Medium','Advanced']){
      await page.goto(address);
      await page.getByRole('button',{name:mode,exact:true}).click();
      await page.evaluate(()=>document.fonts.ready);
      const frames=[], started=performance.now(), metrics={};
      const append=({data,sessionId,metadata})=>{
        frames.push({data,time:metadata.timestamp??Date.now()/1000});
        void session.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});
      };
      session.on('Page.screencastFrame',append);
      try{
        await session.send('Page.startScreencast',{format:'jpeg',quality:86,maxWidth:1280,maxHeight:820,everyNthFrame:1});
        await page.waitForTimeout(1200);
        if(mode==='Advanced'){
          await page.locator('#advance').click();
          await page.locator('#start-comparison').click();
          await page.locator('#speed').selectOption('2');
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.locator('#play').click();
          await page.waitForFunction(()=>Number(document.querySelector('#day').textContent)>=18);
          await page.locator('#play').click();
          assert.ok(Number(await page.locator('#day').innerText())>=18);
        }else{
          const canvas=mode==='Simple'?'#research-flow':'#focus-world-a canvas';
          const before=await page.locator(canvas).evaluate(el=>el.toDataURL());
          assert.equal(await page.locator(canvas).getAttribute('data-studies'),'0');
          await page.locator('#focus-run').click();
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.waitForFunction(selector=>Number(document.querySelector(selector).dataset.day)>2,canvas);
          const samples=await page.locator(canvas).evaluate(async el=>{
            const changes=new Set(),durations=[];
            for(let i=0;i<45;i++){
              const start=performance.now();
              await new Promise(requestAnimationFrame);
              changes.add(el.dataset.day+':'+el.dataset.progress);
              durations.push(performance.now()-start);
            }
            return {frames:changes.size,slow:durations.filter(ms=>ms>48).length};
          });
          assert.ok(samples.frames>=15,mode+' has continuously changing animation frames');
          assert.notEqual(await page.locator(canvas).evaluate(el=>el.toDataURL()),before);
          metrics.animation=samples;
          if(mode==='Medium'){
            assert.ok(await page.evaluate(()=>document.querySelector('#focus-world-a canvas').dataset.day===document.querySelector('#focus-world-b canvas').dataset.day));
            await page.waitForFunction(()=>{
              const a=document.querySelector('#focus-world-a canvas'),b=document.querySelector('#focus-world-b canvas');
              return a.dataset.day===b.dataset.day&&a.dataset.queue!==b.dataset.queue;
            });
          }
          await page.locator('#focus-replay').waitFor({timeout:20000});
          assert.equal(await page.locator(canvas).getAttribute('data-day'),'45');
        }
        await page.waitForTimeout(1600);
      }finally{
        await session.send('Page.stopScreencast');session.off('Page.screencastFrame',append);
      }
      assert.ok(frames.length>40,mode+' recording contains real browser frames');
      const folder=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'science-video-'));
      try{
        // Real browser timestamps preserve playback speed and the before/after holds.
        const manifest=[];
        for(const [i,frame] of frames.entries()){
          const name=i+'.jpg';
          fs.writeFileSync(path.join(folder,name),Buffer.from(frame.data,'base64'));
          const duration=i===frames.length-1?1.6:Math.max(1/120,frames[i+1].time-frame.time);
          manifest.push("file '"+name+"'",'duration '+duration.toFixed(5));
        }
        manifest.push("file '"+(frames.length-1)+".jpg'");
        fs.writeFileSync(path.join(folder,'frames.txt'),manifest.join('\n'));
        execFileSync('ffmpeg',['-v','error','-y','-f','concat','-safe','0','-i',path.join(folder,'frames.txt'),
          '-vf','fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',
          'qa-artifacts/science-universe-'+mode.toLowerCase()+'.mp4']);
      }finally{fs.rmSync(folder,{recursive:true,force:true});}
      console.log(mode+' motion QA',JSON.stringify({...metrics,recordedFrames:frames.length,ms:Math.round(performance.now()-started)}));
    }
  }finally{await session.detach();await page.close();}
}
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
    const pulsarDock=await shell.locator('.lab-pulsar-widget').boundingBox();
    assert.ok(pulsarDock.height<80,'collapsed desktop Pulsar occupies one row');
    fs.mkdirSync('qa-artifacts',{recursive:true});
    if(prior)await screenshots(browser,host,false);
    portablePreview();
    await screenshots(browser,host,true);
    assert.equal(await frame.locator('#focus-chart').isHidden(),true,'pre-run does not show an empty chart');
    assert.equal(await frame.locator('#focus-pipeline strong').count(),0,'stage buttons are process illustrations');
    assert.equal(await frame.locator('#research-flow').getAttribute('data-studies'),'0','no study marks before a real run');
    for(const [width,height] of viewportSizes){
      await shell.setViewportSize({width,height});
      const field=await frame.locator('#research-flow').boundingBox();
      const launch=await run.boundingBox();
      assert.ok(field&&field.width>width*.65&&field.height>=Math.min(250,height*.3),
        'Science field dominates the initial viewport at '+width+'px');
      assert.ok(launch&&launch.y+launch.height<=height+15,'Run action is reachable at '+width+'px: '+JSON.stringify(launch));
      if(width===1440||width===390)await shell.screenshot({path:'qa-artifacts/science-universe-after-initial-'+width+'.png'});
    }
    await shell.setViewportSize({width:1440,height:900});
    assert.match(await slider.evaluate(el=>el.style.getPropertyValue('--fill')),/44\.444/);
    await run.click();
    const baseline=E.summary(E.step(E.make(20261029),45)).reviewBacklog;
    assert.equal(await frame.locator('#focus-results strong').innerText(),String(baseline));
    await frame.getByLabel('Smaller').check();
    await slider.press('End');
    assert.equal(await slider.evaluate(el=>el.style.getPropertyValue('--fill')),'calc(100% + -10px)');
    assert.match(await frame.locator('#focus-status').innerText(),/Settings changed/);
    assert.equal(await frame.locator('#focus-results strong').innerText(),String(baseline));
    await run.click();
    const trial=E.summary(E.step(E.make(20261029,{verification:10}),45)).reviewBacklog;
    assert.deepEqual(await frame.locator('#focus-results strong').allTextContents(),[String(baseline),String(trial)]);
    assert.match(await frame.locator('#focus-comparison').innerText(),/prediction/);
    assert.match(await frame.locator('#lifecycle-mode').innerText(),/^Hypothesis /);
    const trialWorld=E.step(E.make(20261029,{verification:10}),45);
    const repeat=trialWorld.events.findLast(e=>['replication_passed','replication_failed'].includes(e.type));
    assert.ok(repeat);
    await frame.locator('#focus-time').fill(String(repeat.day));
    assert.match(await frame.locator('#lifecycle-event').innerText(),/Independent repeat/);
    const firstRepeated=trialWorld.hypotheses.find(study=>study.id===repeat.hypothesisId);
    assert.equal(await frame.locator('#lifecycle-mode').innerText(),firstRepeated.topic);
    const dayWorld=E.step(E.make(20261029,{verification:10}),repeat.day);
    assert.equal(await frame.locator('#research-flow').getAttribute('data-queue'),String(dayWorld.queues.review.length));
    assert.equal(await frame.locator('#research-flow').getAttribute('data-trace-stage'),'replicated');
    await frame.locator('#focus-time').press('End');
    for(const [width,height] of [[1440,900],[390,844]]){
      await shell.setViewportSize({width,height});
      await frame.locator('#focus-pipeline').evaluate(el=>window.scrollTo(0,0));
      await shell.screenshot({path:'qa-artifacts/science-universe-after-completed-'+width+'.png'});
    }
    await shell.setViewportSize({width:1440,height:900});
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
    assert.deepEqual(await frame.locator('#focus-world-a .world-station strong').allTextContents(),
      ['activeStudies','reviewBacklog','published','replicated'].map(key=>String(E.summary(E.step(E.make(20261029),45))[key])));
    assert.equal(await frame.locator('#focus-world-a').getAttribute('data-day'),'45');
    assert.equal(await frame.locator('#focus-world-b').getAttribute('data-day'),'45');
    await frame.locator('#focus-policy-disclosure summary').click();
    const worldReview=frame.getByRole('slider',{name:'Peer-review policy in World B'});
    await worldReview.press('End');
    assert.equal(await worldReview.evaluate(el=>el.style.getPropertyValue('--fill')),'calc(100% + -10px)');
    assert.match(await frame.locator('#focus-causal-warning').innerText(),/combined effect/);
    await run.click();
    assert.match(await frame.locator('#focus-io-caption').innerText(),/Multiple changes/);
    await frame.getByRole('button',{name:'Simple',exact:true}).click();
    await frame.locator('#focus-reset').click();
    assert.equal(await slider.inputValue(),'5');
    assert.match(await slider.evaluate(el=>el.style.getPropertyValue('--fill')),/44\.444/);
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
    const integrated=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
    integrated.on('pageerror',e=>errors.push(e.message));
    let rejectAtlas=false;
    await integrated.route('**/api/labs/science-universe/coach/',route=>route.fulfill({status:503,json:{error:'coaching_unavailable'}}));
    const createAtlasRun=value=>{
      const run=E.make(20261029,{verification:value}),parameters={...run.policy},design=run.design;
      E.step(run,20);
      return {parameters,design,result:E.summary(run),signature:'fixture-'+value};
    };
    const atlasA=createAtlasRun(3),atlasB=createAtlasRun(9);
    await integrated.route('**/scenarios/compare/?*',route=>{
      if(rejectAtlas)return route.fulfill({status:404,json:{error:'unavailable'}});
      const metrics=Object.fromEntries(['published','falsePublished','replicated','reviewBacklog'].map(key=>{
        const a=atlasA.result[key],b=atlasB.result[key];return [key,{a,b,delta:b-a,delta_min:b-a,delta_max:b-a}];
      }));
      return route.fulfill({json:{policy:'verification',low:3,high:9,matched_seeds:1,days:20,metrics,
        pairs:[{seed:20261029,design:atlasA.design,a:atlasA,b:atlasB}],trajectory:[],limitations:'Fixture runs use the real seeded engine.'}});
    });
    await integrated.goto(host+'/lab.html?lab=science-universe');
    const embedded=integrated.frameLocator('.lab-frame');
    await embedded.locator('#focus-run').click();
    await embedded.locator('#focus-explain').click();
    await integrated.getByText(/The live model is unavailable/).waitFor();
    await embedded.getByRole('button',{name:'Advanced',exact:true}).click();
    await embedded.locator('#atlas').click();
    await integrated.getByText(/1 matched seeds/).waitFor();
    rejectAtlas=true;
    await integrated.getByRole('button',{name:'Compare stored runs'}).click();
    await integrated.getByText(/A matched comparison is not stored/).waitFor();
    rejectAtlas=false;
    await integrated.getByRole('button',{name:'Compare stored runs'}).click();
    await integrated.getByRole('button',{name:'Try this comparison in the Lab'}).click();
    assert.match(await embedded.locator('#branch-explainer').innerText(),/Reproduced stored comparison/);
    assert.equal(await embedded.locator('#day').innerText(),'020');
    assert.equal(Number(await embedded.locator('#published').innerText()),atlasB.result.published);
    await embedded.locator('#snapshot').click();
    await integrated.getByText(/snapshot: .*published/).waitFor();
    await integrated.close();
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
    await page.locator('#zoom-in').click();
    await page.waitForFunction(()=>Number(document.querySelector('#network-a').dataset.zoom)>1);
    await page.locator('#network-a').press('0');
    await page.waitForFunction(()=>document.querySelector('#network-a').dataset.zoom==='1');
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
    assert.match(await range.evaluate(el=>el.style.getPropertyValue('--fill')),/44\.444/);
    await range.evaluate(el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await range.inputValue(),'10');
    assert.equal(await range.evaluate(el=>el.style.getPropertyValue('--fill')),'calc(100% + -10px)');
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
    const renderTiming=await page.evaluate(async()=>{
      const canvas=document.querySelector('#network-b'),times=[];
      const draw=canvas.getContext('2d').clearRect;
      const ctx=canvas.getContext('2d');let draws=0;
      ctx.clearRect=function(...args){draws++;return draw.apply(this,args);};
      await new Promise(resolve=>setTimeout(resolve,180));
      const idle=draws;draws=0;
      for(let i=0;i<6;i++){
        const start=performance.now();document.querySelector('#advance').click();
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        times.push(performance.now()-start);
      }
      delete ctx.clearRect;
      return {idle,draws,times:times.map(Math.round)};
    });
    assert.equal(renderTiming.idle,0,'a paused map does not continuously redraw');
    assert.ok(renderTiming.draws>=6,'stepping schedules map rendering');
    console.log('Advanced frame delivery (Chrome CI, ms):',renderTiming.times.join(', '));
    const pausedImage=await page.locator('#network-b').evaluate(x=>x.toDataURL());
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#network-b').evaluate(x=>x.toDataURL()),pausedImage,'paused model has no independent visual animation');
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
    for(const [width,height] of viewportSizes){
      await page.setViewportSize({width,height});
      for(const [name,selector] of [['Simple','#focus-pipeline'],['Medium','#focus-worlds'],['Advanced','#canvases']]){
        await page.getByRole('button',{name,exact:true}).click();
        await page.locator(selector).waitFor();
        const geometry=await page.locator(selector).evaluate(el=>{
          const box=el.getBoundingClientRect();
          return {left:box.left,right:box.right,screen:document.documentElement.clientWidth};
        });
        assert.ok(geometry.left>=0&&geometry.right<=geometry.screen+1,name+' workspace fits '+width+'px');
        if(width===1440||width===390){
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.screenshot({path:'qa-artifacts/science-universe-'+name.toLowerCase()+'-'+width+'.png'});
        }
      }
    }
    if(process.env.SCIENCE_RECORD_DEMOS)await recordDemos(browser,address);
    assert.deepEqual(errors,[],'browser must have no JavaScript runtime errors');
    console.log('BROWSER PASS: 100+ agents, 12 policies, model-driven generation, lab interventions, fork, dual worlds, charts, model limitations, mobile.');
  }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>server.close());
