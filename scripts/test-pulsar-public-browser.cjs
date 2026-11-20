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
const liveCache = new Map();
const actualReplies = [];
let liveRequests = 0, liveModelCalls = 0, liveFailure = null;
let estimatedNeurons = 0;
const MAX_HTTP_REQUESTS = 6, MAX_MODEL_CALLS = 2;
// The SSH step must reserve these two calls in the persistent host ledger first.
if (live && process.env.PULSAR_QA_RESERVED_MODEL_CALLS !== '2') {
  throw Error('Missing host-shared production QA reservation');
}
function report() {
  fs.writeFileSync(path.join(out,'pulsar-responsive.json'),JSON.stringify({live,results,
    liveRequests,liveModelCalls,estimatedNeurons,actualReplies,liveFailure,
    reusedAnswers: liveCache.size,quota_exhausted:!!liveFailure},null,2));
}
function semanticKey(data) {
  return JSON.stringify([data.page,data.forum_topic,data.message,data.section,data.reading,
    data.locale,data.topic_slug,data.history,data.suggested]);
}
function validateAnswer(payload,data) {
  assert.equal(payload.version,'public-guide-v2');
  assert.equal(payload.ok,true);
  assert(payload.reply && payload.reply.split(/\s+/).length<=100,'missing or verbose answer');
  assert(!/https?:\/\/|\/[a-z-]+\.html/.test(payload.reply),'raw conversational URL');
  assert.notEqual(payload.provider,'fallback','Live inference unavailable: stop without retry');
  for(const link of payload.links||[]) {
    assert(link.label && link.href.startsWith('/') && !link.href.startsWith('//'));
    assert(!/^\/(workspace|lab|learn|path-|education|admin|api)/.test(link.href),'Unreleased destination');
  }
  const expectedModel = ['Why does this matter?','Summarize this discussion.'].includes(data.message);
  if(expectedModel) {
    assert.equal(payload.provider,'cloudflare-workers-ai','Expected real existing-provider answer');
    assert(++liveModelCalls<=MAX_MODEL_CALLS,'Model budget exceeded');
    const usage=payload.metrics||{};
    assert(usage.input_tokens>0 && usage.output_tokens>0,'Missing live usage measurement');
    // Published Cloudflare rates for the existing, pinned Llama 3.3 70B model.
    estimatedNeurons += (usage.input_tokens*26668+usage.output_tokens*204805)/1e6;
    assert(estimatedNeurons<=1500,'Production QA exceeded 15% of the daily free neuron allocation');
  } else {
    assert(['public_progression','public_navigation'].includes(payload.provider),'Unexpected inference on deterministic question');
  }
}

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
  if(liveFailure) throw Error(liveFailure);
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
      const warnings=[];
      page.on('console', entry=>{ if(entry.type()==='warning') warnings.push(entry.text()); });
      let failure=false;
      await page.route(/\/(?:api\/pulsar|gq-pulsar)\/ask\/$/, async route=>{
        const data=route.request().postDataJSON(); requests.push(data);
        if(failure && typeof failure==='object') return route.fulfill({status:429,
          contentType:'application/json',body:JSON.stringify(failure)});
        if(failure) return route.fulfill({status:503,body:'unavailable'});
        if(live) {
          const key=semanticKey(data);
          if(liveCache.has(key)) return route.fulfill({contentType:'application/json',body:JSON.stringify(liveCache.get(key))});
          try {
            assert(++liveRequests<=MAX_HTTP_REQUESTS,'HTTP QA budget exhausted: no request sent');
            assert(!liveFailure,'Earlier live failure: no request sent');
            const started=Date.now();
            const response=await route.fetch({maxRetries:0,maxRedirects:0,timeout:25000});
            assert.equal(response.status(),200,'Live API failure: stop without retry');
            const payload=await response.json();
            validateAnswer(payload,data);
            actualReplies.push({page:data.page,question:data.message,reply:payload.reply,
              links:payload.links,provider:payload.provider,metrics:payload.metrics,elapsed_ms:Date.now()-started});
            liveCache.set(key,payload);
            return route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});
          } catch(error) {
            liveFailure=error.message;
            return route.fulfill({status:503,body:'Stopped: live acceptance failed'});
          }
        }
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
      {
        const latest=requests.at(-1);
        assert.equal(latest.page,'/topic-answer-that-looked-right.html');
        assert.equal(latest.section,'essay');
        assert(latest.history.some(t=>t.content==='What next?'));
        assert(!('token' in latest) && !('cookie' in latest));
        failure=true;
        await ask(page,'Explain this in simple terms.');
        assert.match(await page.locator('.gchat__msg--bot').last().innerText(),/could not answer/);
        assert(await page.getByRole('button',{name:'Send',exact:true}).isEnabled());
        if(!live) {
          failure={ok:false,error:'cloudflare_ai_quota_exhausted',provider_codes:[4006],
            request_id:'e'.repeat(32),reply:'Pulsar has reached its AI provider’s free usage limit. Please try later.',links:[]};
          await ask(page,'PRIVATE_UI_QUESTION');
          assert.match(await page.locator('.gchat__msg--bot').last().innerText(),/free usage limit/);
          assert(warnings.some(line=>line.includes('cloudflare_ai_quota_exhausted')),'Structured quota code not logged');
          assert(warnings.every(line=>!line.includes('PRIVATE_UI_QUESTION')),'User content leaked to console');
          assert(await page.getByRole('button',{name:'Send',exact:true}).isEnabled());
        }
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
        if(live && route==='/lab.html') {
          await ask(page,'Can I use the Lab now?');
          assert.match(await page.locator('.gchat__msg--bot').last().innerText(),/not|under construction|pre-launch/i);
        }
      }
      let forumReply='';
      if(live) {
        await page.goto('https://forum.graviquest.com/t/108',{waitUntil:'domcontentloaded'});
        await page.getByRole('button',{name:'Ask Pulsar',exact:true}).click();
        const responsePromise=page.waitForResponse(r=>r.url().includes('/gq-pulsar/ask/') && r.request().method()==='POST');
        await ask(page,'Summarize this discussion.');
        const response=await responsePromise, payload=await response.json();
        assert.equal(payload.version,'public-guide-v2');
        assert.equal(response.request().postDataJSON().forum_topic,108);
        assert.notEqual(payload.provider,'fallback');
        forumReply=payload.reply;
        await ask(page,'How can I participate in the discussion?');
        assert.match(await page.locator('.gchat__msg--bot').last().innerText(),/sign in|log in/i);
        assert.match(await page.locator('.gchat__msg--bot').last().innerText(),/moderat/i);
        await fits(page,width);
        await page.screenshot({path:path.join(out,`pulsar-forum-${width}.png`)});
      }
      results.push({width,homeBounds,shortBounds,persisted:true,failureRecovery:true,forumReply});
      await context.close();
    }
  } finally { await browser.close(); }
  if(live) {assert.equal(liveModelCalls,2);assert.equal(liveRequests,6);}
  if(live) {
    const links=[...new Set(actualReplies.flatMap(row=>(row.links||[]).map(link=>link.href)))];
    for(const href of links) {
      const response=await fetch(new URL(href,'https://graviquest.com'));
      assert(response.ok,'Broken production link: '+href);
    }
  }
  report();
  console.log(JSON.stringify({live,results},null,2));
})().catch(error=>{report();console.error(error);process.exitCode=1;}).finally(()=>server?.kill());
