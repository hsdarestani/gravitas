'use strict';
/* Browser-only fixture. Does not seed a real Lab or touch production records. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const playwright=require('playwright-core');
const root=process.cwd();
let empty=true,science=false;
let receiveScienceReply=null;
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
  if(url.pathname==='/api/labs/science-universe/coach/'){
    // Deliberately scripted fixture, released by each test after it closes chat.
    res.setHeader('Content-Type','application/json');
    if(receiveScienceReply){const receive=receiveScienceReply;receiveScienceReply=null;receive(res);}
    else res.end(JSON.stringify({ok:true,provider:'script',reply:'Fixture guidance.'}));
    return;
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
    assert.equal(await page.locator('main h1').innerText(),'Lab');
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
    await page.setViewportSize({width:1400,height:1000});
    await page.goto(url+'?lab=science-universe',{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Enter simulation',exact:true}).click();
    const frame=page.frameLocator('.lab-frame');
    await frame.locator('.metric-trend').first().waitFor();
    const skip=page.getByRole('button',{name:'Skip tour',exact:true});
    if(await skip.isVisible())await skip.click();
    await page.locator('.lab-chat-head').click();
    await page.getByRole('button',{name:'Tips on',exact:true}).click();
    await page.locator('.lab-chat-head').click();
    assert.equal(await page.locator('.lab-chat-body').isHidden(),true,'Pulsar starts as a launcher, without a sidebar');
    // The site header stays while a Lab runs; the simulator takes everything under it.
    assert.equal(await page.locator('body>.g-header').isVisible(),true,'site navigation stays available in the Lab');
    assert.equal(await page.locator('.g-footer').isHidden(),true,'the footer gives the Lab its space');
    const desktopFrame=await page.locator('.lab-frame').boundingBox();
    const headerBottom=await page.locator('body>.g-header').evaluate(el=>el.getBoundingClientRect().bottom);
    assert.ok(desktopFrame.width>=1398,'simulator uses the full window width');
    assert.ok(Math.abs(desktopFrame.y-headerBottom)<2&&desktopFrame.y+desktopFrame.height>=999,'simulator fills the window under the header');
    // The Lab follows the header's theme control.
    assert.equal(await frame.locator('html').getAttribute('data-theme'),'dark');
    await page.locator('.gh-actions .theme-toggle').click();
    await frame.locator('html[data-theme="light"]').waitFor();
    await page.locator('.gh-actions .theme-toggle').click();
    await frame.locator('html[data-theme="dark"]').waitFor();
    // Each completed answer arrives while the panel is closed. No new AI request
    // is made when the visitor opens an existing notification.
    async function answerInBackground(text){
      if(await page.locator('.lab-chat-body').isHidden())await page.locator('.lab-chat-head').click();
      const replyReceived=new Promise(resolve=>{receiveScienceReply=resolve;});
      await page.getByRole('textbox',{name:'Message Pulsar'}).fill('Fixture science question');
      await page.getByRole('button',{name:'Send to Pulsar'}).click();
      const response=await replyReceived;
      await page.locator('.lab-chat-head').click();
      response.end(JSON.stringify({ok:true,provider:'script',reply:text}));
      await page.locator('.lab-pulsar-notice').filter({hasText:text}).waitFor();
    }
    await answerInBackground('First retained fixture explanation.');
    await page.locator('.lab-notice-read').click();
    assert.equal(await page.locator('.lab-chat-body').isVisible(),true);
    assert.equal(await page.locator('.lab-pulsar-notice').count(),0,'opening history clears transient notifications');
    assert.equal(await page.locator('.lab-chat-bubble').filter({hasText:'First retained fixture explanation.'}).count(),1);
    await page.getByRole('textbox',{name:'Message Pulsar'}).press('Escape');
    assert.equal(await page.locator('.lab-chat-body').isHidden(),true);
    // Supply three distinct model notes from the actual sandboxed simulator,
    // not from the parent window, to exercise source validation and persistence.
    await page.clock.install();
    const simPage=page.frame({url:/\/lab-run\/science-universe\/(#theme=(dark|light))?$/});
    for(let i=1;i<=4;i++){
      await page.clock.fastForward(18100);
      await simPage.evaluate(i=>parent.postMessage({schema:'graviquest.lab.v1',type:'lab:note',note:{title:'Fixture snapshot',text:'Retained model snapshot '+i}},'*'),i);
      // Tips are off, so model notes must not interrupt the visitor.
      assert.equal(await page.locator('.lab-pulsar-notice').count(),0);
    }
    await page.locator('.lab-chat-head').click();
    await page.getByRole('button',{name:'Tips off',exact:true}).click();
    await page.locator('.lab-chat-head').click();
    let noteTime=Date.now();
    for(let i=1;i<=4;i++){
      // Move Date.now past the coaching throttle without firing expiry timers,
      // so four independent accepted notes exercise the three-card stack.
      await page.clock.setSystemTime(new Date(noteTime+=18100));
      await simPage.evaluate(i=>parent.postMessage({schema:'graviquest.lab.v1',type:'lab:note',note:{title:'Fixture snapshot',text:'Retained model snapshot '+i}},'*'),i);
      await page.locator('.lab-pulsar-notice').filter({hasText:'Retained model snapshot '+i}).waitFor();
    }
    assert.equal(await page.locator('.lab-pulsar-notice').count(),3,'notification stack is bounded');
    assert.equal(await page.locator('.lab-pulsar-notice').filter({hasText:'Retained model snapshot 1'}).count(),0,'the oldest preview leaves the stack');
    await page.locator('.lab-notice-read').last().click();
    assert.equal(await page.locator('.lab-chat-bubble').filter({hasText:/Retained model snapshot [1-4]/}).count(),4,'every snapshot remains in conversation');
    await page.locator('.lab-chat-head').click();
    await page.clock.fastForward(18100);
    await simPage.evaluate(()=>parent.postMessage({schema:'graviquest.lab.v1',type:'lab:note',note:{title:'Expiry fixture',text:'This toast fades, its message remains.'}},'*'));
    await page.locator('.lab-pulsar-notice').filter({hasText:'This toast fades'}).waitFor();
    await page.clock.fastForward(10000);
    await page.locator('.lab-pulsar-notice').waitFor({state:'detached'});
    await page.locator('.lab-chat-head').click();
    assert.equal(await page.locator('.lab-chat-bubble').filter({hasText:'This toast fades'}).count(),1,'expiration does not delete conversation');
    await page.locator('.lab-chat-head').click();
    await page.locator('.lab-chat-head').click();
    await page.getByRole('button',{name:'Tips on',exact:true}).click();
    await page.locator('.lab-chat-head').click();
    assert.equal(await frame.locator('.metric-trend').count(),21);
    assert.equal(await frame.locator('#outcome-data').isHidden(),true);
    const right=await frame.locator('.workspace-side').boundingBox(),dock=await frame.locator('#pulsar-anchor').boundingBox(),companion=await page.locator('.lab-chat').boundingBox();
    assert.ok(Math.abs(companion.x-right.x)<2&&Math.abs(companion.width-right.width)<2,'Pulsar aligns with the right column');
    assert.ok(Math.abs(companion.y-dock.y)<3,'Pulsar sits in its reserved dock');
    const initialHeight=await page.locator('.lab-frame').evaluate(x=>x.getBoundingClientRect().height);
    await frame.locator('#advance').click();
    await page.frame({url:/\/lab-run\/science-universe\/(#theme=(dark|light))?$/}).waitForFunction(()=>document.getElementById('day').textContent==='010');
    assert.equal(await frame.locator('#day').innerText(),'010');
    const paused=await frame.locator('#network-a').evaluate(x=>x.toDataURL());
    await page.waitForTimeout(600);
    assert.equal(await frame.locator('#network-a').evaluate(x=>x.toDataURL()),paused,'paused research picture is stable');
    await frame.locator('#metric-select').selectOption('crossFieldStudies');
    await frame.locator('#toggle-data').click();
    assert.ok(await frame.locator('#outcome-data tbody tr').count()>1);
    await frame.locator('#toggle-data').click();
    await frame.locator('#settings').click();
    assert.equal(await frame.locator('.policy-control .sparkline').count(),12);
    await frame.locator('#close-settings').click();
    await page.setViewportSize({width:390,height:844});
    const mobileHeight=await page.locator('.lab-frame').evaluate(x=>x.getBoundingClientRect().height);
    await frame.locator('#advance').click();
    await frame.locator('#toggle-data').click();
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.lab-frame').evaluate(x=>x.getBoundingClientRect().height),mobileHeight,'model content never expands the host viewport');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1,'science workspace mobile overflow');
    assert.ok(initialHeight<=1100);
    const mobileFrame=await page.locator('.lab-frame').boundingBox();
    assert.ok(mobileFrame.width>=388&&mobileFrame.y+mobileFrame.height<=845,'mobile workspace fits the viewport');
    await page.locator('.lab-chat-head').click();
    const chatBounds=await page.locator('.lab-chat').boundingBox();
    assert.ok(chatBounds.x>=0&&chatBounds.x+chatBounds.width<=390&&chatBounds.y>=0&&chatBounds.y+chatBounds.height<=844,'mobile conversation fits the viewport');
    await page.locator('.lab-chat-head').click();
    await page.reload({waitUntil:'networkidle'});
    await page.locator('.lab-frame').waitFor();
    assert.equal(await page.locator('.lab-science-preview').count(),0,'reload returns to the Lab without repeating its entry popup');
    await page.frameLocator('.lab-frame').locator('#back-labs').click();
    assert.equal(await page.locator('body>.g-header').isVisible(),true,'leaving the Lab restores site navigation');
    assert.equal(await page.locator('.lab-pulsar-notice').count(),0);
    console.log('Science workspace PASS: immersive desktop/mobile, persisted stacked notifications, expiration, history, 21 metric trends, 12 policy trends, pause, optional table, stable frame.');
    assert.deepEqual(runtimeErrors,[],'Lab runtime must not throw browser errors');
    await page.close();
  }catch(err){
    console.error('Browser errors:',runtimeErrors);
    if(page){fs.mkdirSync('qa-artifacts',{recursive:true});await page.screenshot({path:'qa-artifacts/lab-workspace-failure.png',fullPage:true}).catch(()=>{});}
    throw err;
  }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;}).finally(()=>server.close());
