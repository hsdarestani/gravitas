// Real anonymous Discourse UI over an SSH loopback bridge. Browser requests keep
// their HTTPS origin and the production CSP; no TLS/CSRF/security setting changes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const {chromium, request, devices} = await import(process.env.PLAYWRIGHT_MODULE);
const out = process.env.GQ_BROWSER_OUTPUT || '/tmp/graviquest-forum-browser';
await fs.mkdir(out, {recursive:true});
const bridge = process.env.GQ_DISCOURSE_BRIDGE || 'http://127.0.0.1:18881';
const api = await request.newContext();
const browser = await chromium.launch({headless:true});
try {
  for (const viewport of [{width:1440,height:1100},{width:390,height:844}]) {
    const mobile = viewport.width < 760 ? devices['Pixel 7'] : {};
    assert(mobile, 'Pinned Playwright provides the Android device descriptor');
    const context = await browser.newContext({...mobile, viewport, deviceScaleFactor:1});
    const errors = [];
    await context.route('https://forum.graviquest.com/**', async route => {
      const incoming=route.request(), url=new URL(incoming.url());
      try {
        const result=await api.fetch(bridge + url.pathname + url.search, {
          method:incoming.method(), data:incoming.postDataBuffer() || undefined,
          headers:{...incoming.headers(),host:'forum.graviquest.com','x-forwarded-proto':'https','accept-encoding':'identity'},
          maxRedirects:0, timeout:30000,
        });
        const headers={...result.headers()};
        delete headers['content-encoding']; delete headers['content-length']; delete headers['transfer-encoding'];
        await route.fulfill({status:result.status(), headers, body:await result.body()});
        await result.dispose();
      } catch (error) { await route.abort(); errors.push('bridge: ' + error.message); }
    });
    const page=await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    try {
    await page.goto('https://forum.graviquest.com/latest', {waitUntil:'domcontentloaded'});
    await page.locator('.gq-forum-heading h1').waitFor({timeout:60000});
    await page.locator('.topic-list .topic-list-item').first().waitFor({timeout:60000});
    await page.locator('.gq-community-poll .poll').waitFor({timeout:30000});
    await page.evaluate(()=>document.fonts.ready);
    const measurements=await page.evaluate(()=>({
      viewport:innerWidth, width:document.documentElement.scrollWidth,
      heading:document.querySelector('.gq-forum-heading h1')?.textContent,
      background:getComputedStyle(document.body).backgroundColor,
      font:getComputedStyle(document.body).fontFamily,
      topicRows:document.querySelectorAll('.topic-list .topic-list-item').length,
      themeFonts:[...document.fonts].filter(f=>f.family.includes('DM Sans')).map(f=>f.status),
    }));
    assert.equal(measurements.heading,'The Forum');
    assert(measurements.width<=measurements.viewport+1,'No horizontal page overflow');
    assert(measurements.font.includes('DM Sans'),'Existing brand typography loaded');
    assert(measurements.themeFonts.includes('loaded'),'Bundled brand font file actually loaded');
    assert(measurements.topicRows>0,'Real public discussions rendered');
    assert.deepEqual(errors,[],'Native theme has no uncaught runtime errors');
    await page.screenshot({path:`${out}/forum-${viewport.width}.png`,fullPage:true});
    console.log(JSON.stringify({viewport:viewport.width,...measurements,nativePollRendered:true,uncaughtErrors:errors.length}));
    // Small diagnostic thumbnail is safe: anonymous public UI only, no sessions,
    // private discussions, email addresses or secrets in screenshots/logs.
    const thumbnail=await page.screenshot({type:'jpeg',quality:35,fullPage:false,scale:'css'});
    console.log(`GQ_PUBLIC_SCREENSHOT_${viewport.width}:`+thumbnail.toString('base64'));
    const topic=page.locator('.topic-list a.title').first();
    await topic.click();
    await page.locator('.topic-post').first().waitFor({timeout:30000});
    assert(new URL(page.url()).pathname.startsWith('/t/'),'Discussion opens real native permalink');
    await page.screenshot({path:`${out}/topic-${viewport.width}.png`,fullPage:false});
    } catch (error) {
      const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(e).position!=='fixed').slice(0,12).map(e=>({tag:e.tagName,classes:e.className,width:Math.round(e.getBoundingClientRect().width)}))}));
      console.log('Native UI diagnostic: '+JSON.stringify({errors, url:page.url(), overflow, text:(await page.locator('body').innerText()).slice(0,3000)}));
      await page.screenshot({path:`${out}/failure-${viewport.width}.png`,fullPage:true});
      const failure=await page.screenshot({type:'jpeg',quality:35,fullPage:false});
      console.log(`GQ_PUBLIC_FAILURE_${viewport.width}:`+failure.toString('base64'));
      throw error;
    }
    await context.close();
  }
} finally { await browser.close(); await api.dispose(); }
