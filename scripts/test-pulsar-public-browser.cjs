/* Responsive contract for the actual public widget and published HTML. The
   staged chat replies are replayed from real model acceptance, not hand-written
   success fixtures. Other public API reads use the existing preview proxy.
   Set PULSAR_LIVE=1 to exercise the deployed HTTP/model path after release. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright-core');

const live = process.env.PULSAR_LIVE === '1';
const base = live ? 'https://graviquest.com' : 'http://127.0.0.1:4173';
const out = path.resolve('qa-artifacts');
fs.mkdirSync(out, {recursive:true});
const replay = live ? null : JSON.parse(fs.readFileSync(path.join(out,'pulsar-conversations.json')));
const server = live ? null : spawn(process.execPath, ['scripts/preview-server.mjs'], {stdio:'ignore'});
const results = [];

async function ready() {
  for(let i=0;i<40;i++) {
    try { if((await fetch(base)).ok) return; } catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error('preview unavailable');
}

async function waitReply(page, before) {
  await page.waitForFunction(n => document.querySelectorAll('.gchat__msg--bot').length > n && !document.querySelector('.gchat__typing'), before, {timeout:30000});
}

async function ask(page, q) {
  const count = await page.locator('.gchat__msg--bot').count();
  await page.getByLabel('Your question', {exact:true}).fill(q);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await waitReply(page,count);
}

async function fits(page, width) {
  const bounds = await page.locator('.gchat__panel').evaluate(el=>{
    const r=el.getBoundingClientRect();
    const input=el.querySelector('textarea').getBoundingClientRect();
    const send=el.querySelector('.gchat__send').getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,inputRight:input.right,
      sendLeft:send.left,inputBottom:input.bottom,sendBottom:send.bottom,
      bad:[...el.querySelectorAll('.gchat__msg')].filter(m=>m.scrollWidth>m.clientWidth+2).length};
  });
  assert(bounds.left>=0 && bounds.right<=width+1,JSON.stringify(bounds));
  assert(bounds.inputRight<=bounds.sendLeft,JSON.stringify(bounds));
  assert(bounds.bad===0,JSON.stringify(bounds));
  assert(bounds.bottom<=await page.evaluate(()=>innerHeight)+1,JSON.stringify(bounds));
  assert(bounds.inputBottom<=bounds.bottom && bounds.sendBottom<=bounds.bottom,JSON.stringify(bounds));
  return bounds;
}

(async()=>{
  await ready();
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  try {
    for(const width of [340,390,768,1363]) {
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500});
      const page=await context.newPage();
      const requests=[];
      let failure=false;
      if(!live) await page.route('**/api/pulsar/ask/', async route=>{
        const data=route.request().postDataJSON(); requests.push(data);
        if(failure) return route.fulfill({status:503,body:'unavailable'});
        const match=replay.conversations.find(row=>row.page===data.page && row.question===data.message &&
          (data.message!=='What next?' || JSON.stringify(row.previous_destinations)===JSON.stringify(data.history.flatMap(t=>(t.links||[]).map(l=>l.href))))) ||
          replay.conversations.find(row=>row.question===data.message) || replay.conversations[5];
        await route.fulfill({contentType:'application/json',body:JSON.stringify(match)});
      });
      await page.goto(base+'/',{waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'Ask Pulsar',exact:true}).click();
      await ask(page,'Where should I start?');
      const first=await page.locator('.gchat__msg--bot').last().innerText();
      await ask(page,'What next?');
      const second=await page.locator('.gchat__msg--bot').last().innerText();
      assert.notEqual(first,second);
      const href=await page.locator('.gchat__msg--bot').last().locator('a').first().getAttribute('href');
      assert(href && href.startsWith('/topic-'),href);
      const homeBounds=await fits(page,width);
      await page.screenshot({path:path.join(out,`pulsar-home-${width}.png`)});
      await page.locator('.gchat__msg--bot').last().locator('a').first().click();
      await page.getByRole('button',{name:'Ask Pulsar',exact:true}).click();
      assert((await page.locator('.gchat__msg--me').count())>=2,'conversation lost on navigation');
      await ask(page,'Why does this matter?');
      await fits(page,width);
      if(!live) {
        const latest=requests.at(-1);
        assert.equal(latest.page,'/topic-answer-that-looked-right.html');
        assert.equal(latest.section,'essay');
        assert(latest.history.some(t=>t.content==='What next?'));
        assert(!('token' in latest) && !('cookie' in latest));
        failure=true;
        await ask(page,'Explain this in simple terms.');
        assert.match(await page.locator('.gchat__msg--bot').last().innerText(),/could not answer/);
        assert(await page.getByRole('button',{name:'Send',exact:true}).isEnabled());
        failure=false;
      }
      await page.setViewportSize({width,height:420});
      await page.getByLabel('Your question',{exact:true}).fill('A question while the keyboard reduces the viewport');
      const shortBounds=await fits(page,width);
      await page.screenshot({path:path.join(out,`pulsar-keyboard-${width}.png`)});
      await page.setViewportSize({width,height:844});
      for(const route of ['/topics.html','/about.html','/community.html','/lab.html','/learn.html','/education.html','/education-de.html','/privacy.html']) {
        await page.goto(base+route,{waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:'Ask Pulsar',exact:true}).click();
        await fits(page,width);
      }
      results.push({width,homeBounds,shortBounds,persisted:true,failureRecovery:!live});
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out,'pulsar-responsive.json'),JSON.stringify({live,results},null,2));
  console.log(JSON.stringify({live,results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server?.kill());
