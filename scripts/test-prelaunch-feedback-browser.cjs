'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright-core');

const root=path.resolve(__dirname,'..');
const captured=[];
const types={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/api/auth/csrf/'){
    res.setHeader('Content-Type','application/json');
    res.setHeader('Set-Cookie','csrftoken=qa-token; Path=/; SameSite=Lax');
    res.end(JSON.stringify({ok:true}));return;
  }
  if(url.pathname==='/api/auth/me/'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({authenticated:false}));return;
  }
  if(url.pathname==='/api/prelaunch/feedback/'&&req.method==='GET'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ok:true,submission:null}));return;
  }
  if(url.pathname==='/api/prelaunch/feedback/'&&req.method==='POST'){
    let body='';
    req.on('data',part=>{body+=part;});
    req.on('end',()=>{
      if(req.headers['x-csrftoken']!=='qa-token'){
        res.writeHead(403);res.end('{}');return;
      }
      captured.push(JSON.parse(body));
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({ok:true,submission:{...captured.at(-1),created_at:new Date().toISOString()}}));
    });return;
  }
  const filename=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!filename.startsWith(root+path.sep)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){
    res.writeHead(404);res.end('Missing fixture asset');return;
  }
  res.setHeader('Content-Type',types[path.extname(filename)]||'application/octet-stream');
  res.end(fs.readFileSync(filename));
});
async function assertSequentialVisibleNumbers(page,scenario){
  // The native details "toggle" event is queued; wait for numbering to settle.
  await page.waitForFunction(()=>{
    const visible=Array.from(document.querySelectorAll('#fb-question-groups .fb-question'))
      .filter(question=>!question.hidden && (!question.closest('details') || question.closest('details').open));
    return visible.length>0 && visible.every((question,index)=>
      question.querySelector('.fb-question__id')?.textContent===String(index+1).padStart(2,'0'));
  },null,{timeout:3000}).catch(error=>{throw new Error('Non-sequential numbering: '+scenario,{cause:error});});
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({
    headless:true,executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',
    args:['--no-sandbox','--disable-dev-shm-usage']
  });
  try{
    for(const width of [340,390,768,1363]){
      const page=await browser.newPage({viewport:{width,height:840},reducedMotion:'reduce'});
      try{
        await page.goto('http://127.0.0.1:'+server.address().port+'/prelaunch-feedback.html',{waitUntil:'networkidle'});
        await page.locator('[data-question="site_works"]').waitFor();
        assert.equal(await page.locator('#prelaunch-form [required]').count(),0,'All fields optional');
        assert.equal(await page.locator('input[type="password"]').count(),0,'No login');
        assert.equal(await page.locator('.fb-group').count(),10,'Ten categories A–J with separate final comments');
        assert.equal(await page.locator('.fb-question__optional').count(),0,'Do not repeat Optional beside each question');
        assert.equal(await page.locator('[data-more="about"]').count(),0,'No empty About you accordion');
        assert.equal(await page.locator('[data-more="overall"]').count(),0,'Final comments must not be buried in Overall accordion');
        assert.equal(await page.locator('[data-section="final_comments"] [data-question="other_feedback"]').isVisible(),true,'Final freeform feedback is visible');
        assert.equal(await page.locator('[data-question="contact_email"]').isVisible(),true,'Follow-up email is visible');
        await assertSequentialVisibleNumbers(page,width+'px: initial collapsed form');
        const widthCheck=await page.evaluate(()=>({
          scroll:document.documentElement.scrollWidth,
          viewport:window.innerWidth
        }));
        assert.ok(widthCheck.scroll<=widthCheck.viewport+1,'Horizontal overflow at '+width+'px '+JSON.stringify(widthCheck));
        if(width===340){
          assert.equal(await page.locator('[data-question="persona_other"]').isHidden(),true);
          await page.locator('[data-question="persona"] label.fb-persona').last().click();
          assert.equal(await page.locator('[data-question="persona_other"]').isVisible(),true,'Other reveals its inline follow-up');
          await page.locator('[data-question="persona_other"] textarea').fill('Educator');
          await assertSequentialVisibleNumbers(page,'Other-persona revealed');
          await page.locator('[data-question="persona"] label.fb-persona').first().click();
          assert.equal(await page.locator('[data-question="persona_other"]').isHidden(),true,'Follow-up hides for other choices');
          await assertSequentialVisibleNumbers(page,'Other-persona hidden');
          assert.equal(await page.locator('input[name="persona"]:checked').count(),1);
          await page.locator('[data-clear-radio="persona"]').click();
          assert.equal(await page.locator('input[name="persona"]:checked').count(),0);
          await page.locator('[data-question="site_works"] .fb-choice').nth(3).click();
          await page.locator('[data-question="goals_clear"] .fb-choice').nth(4).click();
          await page.locator('[data-question="anything_broken"] label.fb-option').first().click();
          assert.equal(await page.locator('[data-question="broken_where"]').isVisible(),true);
          await page.locator('[data-question="anything_broken"] label.fb-option').last().click();
          assert.equal(await page.locator('[data-question="broken_where"]').isHidden(),true);
          await assertSequentialVisibleNumbers(page,'broken-location field hidden');

          await page.locator('[data-question="video_watched"] label.fb-option').last().click();
          assert.equal(await page.locator('[data-question="video_content_quality"]').isHidden(),true,'No video => skip video ratings');
          await page.locator('[data-question="video_watched"] label.fb-option').nth(1).click();
          assert.equal(await page.locator('[data-question="video_content_quality"]').isVisible(),true);
          await assertSequentialVisibleNumbers(page,'video-rating question revealed');
          await page.locator('[data-question="video_content_quality"] .fb-choice').nth(4).click();
          await page.locator('[data-question="community_visited"] label.fb-option').last().click();
          assert.equal(await page.locator('[data-question="community_purpose"]').isHidden(),true);

          const more=page.locator('[data-more="first"]');
          await more.locator('summary').click();
          await assertSequentialVisibleNumbers(page,'extra questions accordion expanded');
          await more.locator('summary').click();
          await assertSequentialVisibleNumbers(page,'extra questions accordion collapsed');
          await page.locator('[data-question="recommend_likelihood"] .fb-choice').nth(10).click();
          await page.locator('[data-question="one_change"] textarea').fill('Make the first-time navigation simpler.');
          await page.locator('[data-section="final_comments"] [data-question="other_feedback"] textarea').fill('The forum discussion needs clearer guidance.');
          await page.locator('input[name="contact_email"]').fill('visitor@example.com');
          await page.locator('#fb-submit-button').click();
          await page.waitForFunction(()=>document.querySelector('#fb-status')?.dataset.state==='success');
          assert.equal(captured.length,1);
          assert.equal(captured[0].name,'');
          assert.equal(captured[0].answers.site_works,4);
          assert.equal(captured[0].answers.recommend_likelihood,10);
          assert.equal(captured[0].answers.video_content_quality,5);
          assert.equal(captured[0].answers.video_watched,'part');
          assert.equal(captured[0].answers.community_visited,'no');
          assert.ok(!('community_purpose' in captured[0].answers));
          assert.ok(!('broken_where' in captured[0].answers));
          assert.equal(captured[0].answers.contact_email,'visitor@example.com');
          assert.equal(captured[0].answers.other_feedback,'The forum discussion needs clearer guidance.');
          assert.ok(!('persona_other' in captured[0].answers),'Hidden Other details do not submit');
          assert.ok(!('persona' in captured[0].answers));
          assert.match(page.url(),/prelaunch-feedback.html/);
        }else if(width===390){
          await page.locator('#fb-submit-button').click();
          await page.waitForFunction(()=>document.querySelector('#fb-status')?.dataset.state==='success');
          assert.equal(captured.length,2);
          assert.equal(captured[1].name,'');
          assert.deepEqual(captured[1].answers,{},'Empty anonymous submission is valid');
        }
      }finally{await page.close();}
      process.stdout.write('Expanded prelaunch browser QA: '+width+'px passed\n');
    }
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
