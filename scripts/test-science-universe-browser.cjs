'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const playwright=require('playwright-core');
const root=process.cwd();
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    res.writeHead(404);res.end('Not found');return;
  }
  res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');
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
    await page.locator('#agents').waitFor();
    assert.equal(await page.locator('.tiny-metric').count(),6);
    assert.equal(await page.locator('#policy-drawer').isHidden(),true);
    const agents=Number((await page.locator('#agents').innerText()).replaceAll(',',''));
    assert.ok(agents>=100,'research world needs 100+ agents');
    await page.locator('#advance').click();
    const day=await page.locator('#day').innerText();
    assert.equal(day,'010');
    const generated=Number((await page.locator('#hypotheses').innerText()).replaceAll(',',''));
    assert.ok(generated>0,'real engine generates ideas after time advance');
    const labPicture=await page.locator('#network-a').evaluate(x=>x.toDataURL());
    await page.locator('#view-papers').click();
    assert.match(await page.locator('#map-explanation').innerText(),/Small dots are published claims/);
    assert.ok(Number(await page.locator('#network-a').getAttribute('data-visible-papers'))>0);
    assert.notEqual(await page.locator('#network-a').evaluate(x=>x.toDataURL()),labPicture,'the views represent different model objects');
    const paperClick=await page.evaluate(()=>{
      const s=ScienceUniverseEngine.make(20261029);ScienceUniverseEngine.step(s,10);
      const p=s.hypotheses.filter(h=>h.published&&!h.retracted).at(-1),lab=s.labs[p.labId];
      const rect=document.getElementById('network-a').getBoundingClientRect(),a=p.id*2.399963,r=23+Math.sqrt((p.id%43)+1)*7;
      return {id:p.id,x:rect.left+Math.max(9,Math.min(rect.width-9,28+lab.x*(rect.width-56)+Math.cos(a)*r)),
        y:rect.top+Math.max(9,Math.min(rect.height-9,28+lab.y*(rect.height-56)+Math.sin(a)*r))};
    });
    await page.mouse.click(paperClick.x,paperClick.y);
    await page.locator('#selected-paper').waitFor({state:'visible'});
    assert.match(await page.locator('#selected-paper').innerText(),new RegExp('Paper #'+paperClick.id));
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
    await page.locator('#fund-lab').click();
    assert.match(await page.locator('#intervention-status').innerText(),/Intervention applied/);
    await page.locator('#settings').click();
    assert.equal(await page.locator('.policy-control').count(),12);
    const policyLayout=await page.evaluate(()=>{
      const map=document.getElementById('network-a').getBoundingClientRect(),panel=document.querySelector('.drawer-panel').getBoundingClientRect();
      return {mapRight:map.right,panelLeft:panel.left,hit:document.elementFromPoint(map.left+map.width/2,map.top+map.height/2)?.id};
    });
    assert.ok(policyLayout.mapRight<=policyLayout.panelLeft,'policies dock beside the map');
    assert.equal(policyLayout.hit,'network-a','there is no dark or blocking policy overlay');
    const range=page.locator('input[data-policy=pressure]');
    await range.evaluate(el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.match(await page.locator('input[data-policy=pressure]').inputValue(),/10/);
    await page.locator('#policy-advance').click();
    assert.equal(await page.locator('#day').innerText(),'020','model continues while the policy panel is open');
    await page.locator('#close-settings').click();
    await page.locator('#fork').click();
    await page.locator('#comparison').waitFor({state:'visible'});
    await page.locator('#network-b').waitFor({state:'visible'});
    assert.equal(await page.locator('.comparison-row').count(),6);
    assert.equal(await page.locator('#policy-world').innerText(),'EDITING WORLD B');
    await page.locator('#advance').click();
    await page.locator('#view-papers').click();
    await page.locator('#metric-select').selectOption('falsePublished');
    assert.equal(await page.locator('#outcome-data').isHidden(),true);
    await page.locator('#toggle-data').click();
    assert.ok(await page.locator('#outcome-data tbody tr').count()>0);
    await page.locator('#toggle-data').click();
    const still=await page.locator('#network-a').evaluate(x=>x.toDataURL());
    await page.waitForTimeout(500);
    assert.equal(await page.locator('#network-a').evaluate(x=>x.toDataURL()),still,'paused model has no independent visual animation');
    await page.locator('#methodology').click();
    assert.equal(await page.locator('#method-dialog').evaluate(x=>x.open),true);
    await page.locator('#method-done').click();
    fs.mkdirSync('qa-artifacts',{recursive:true});
    await page.screenshot({path:'qa-artifacts/science-universe-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.locator('#settings').click();
    const mobilePolicy=await page.evaluate(()=>{
      const r=document.getElementById('network-a').getBoundingClientRect(),p=document.querySelector('.drawer-panel').getBoundingClientRect();
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
