const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..');
function setup(lang='en',demo='physics',fetch){
  const file=lang==='de'?'education-de.html':'education.html';
  const dom=new JSDOM(fs.readFileSync(path.join(root,file),'utf8'),{url:`https://graviquest.com/${file}?demo=${demo}#erleben`,runScripts:'outside-only',pretendToBeVisual:true});
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  dom.window.fetch=fetch||(()=>{throw Error('Unexpected network call');});
  for(const file of ['education-models.js','education-catalog.js','education-studio.js','education-pulsar.js'])dom.window.eval(fs.readFileSync(path.join(root,'assets',file),'utf8'));
  return dom;
}
function click(w,sel){w.document.querySelector(sel).click();}
function change(w,sel,value,event='change'){const el=w.document.querySelector(sel);el.value=String(value);el.dispatchEvent(new w.Event(event,{bubbles:true}));}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('EN/DE pages present five sections, unique ids, original cart, direct demo and shared scripts',()=>{
  for(const lang of ['en','de']){const dom=setup(lang,'chemistry'),d=dom.window.document;assert.deepEqual([...d.querySelectorAll('.ed-nav > a')].slice(0,3).map(a=>a.hash),['#idee','#erleben','#sprint']);assert.equal(d.querySelectorAll('.ed-slide').length,5);assert.equal(d.querySelectorAll('h1').length,1);assert.equal(d.querySelectorAll('[data-demo]').length,9);const ids=[...d.querySelectorAll('[id]')].map(x=>x.id);assert.equal(new Set(ids).size,ids.length);assert.ok(d.getElementById('ps-studio'));assert.equal(d.getElementById('el-discipline').value,'chemistry');assert.ok(d.querySelector('[data-lang-switch]').href.includes('demo=chemistry'));assert.ok(!/[€$£]|\b2,200\b/.test(d.body.textContent));dom.window.close();}
});
test('all twelve scenarios work in both languages and resets keep evidence separate from exploration',()=>{
  for(const lang of ['en','de']){const dom=setup(lang),w=dom.window,d=w.document;
    for(const[id,c]of Object.entries(w.GQEducationCatalog)){change(w,'#el-discipline',id);for(let i=0;i<c.lessons.length;i++){change(w,'#el-lesson',i);assert.equal(d.getElementById('el-test').disabled,true);click(w,`#el-choices button:nth-child(${c.lessons[i].correct+1})`);assert.equal(d.getElementById('el-test').disabled,false);click(w,'#el-test');assert.equal(d.getElementById('el-evidence').hidden,false);assert.equal(d.querySelectorAll('#el-comparison tr').length,c.metric.length);assert.ok(!/NaN|Infinity|undefined/.test(d.getElementById('el-readings').textContent));const frozen=d.getElementById('el-comparison').textContent;change(w,'#el-param-'+c.controls[0].key,c.controls[0].max,'input');assert.equal(d.getElementById('el-comparison').textContent,frozen);click(w,'#el-restart');assert.equal(d.getElementById('el-evidence').hidden,true);}}
    dom.window.close();
  }
});
test('friction constraints, mass comparison, motion controls and original cart remain functional',()=>{
  const dom=setup(),w=dom.window,d=w.document;
  change(w,'#el-param-kinetic',.8,'input');assert.equal(d.getElementById('el-param-static').value,'0.8');
  change(w,'#el-param-static',.2,'input');assert.equal(d.getElementById('el-param-kinetic').value,'0.2');
  change(w,'#el-lesson',1);click(w,'#el-choices button:nth-child(2)');click(w,'#el-test');const row=d.querySelector('#el-comparison tr');assert.equal(row.children[1].textContent,row.children[2].textContent);
  click(w,'#el-rewind');click(w,'#el-play');assert.match(d.getElementById('el-play').textContent,/Pause/);click(w,'#el-rewind');assert.match(d.getElementById('el-time').textContent,/0.00/);
  click(w,'[data-prediction="half"]');click(w,'#ps-run');assert.match(d.getElementById('ps-acceleration').textContent,/2.00/);click(w,'#ps-reset');assert.equal(d.getElementById('ps-mass').disabled,true);dom.window.close();
});
test('free-form request includes current and frozen states, history and locale; replies render as text',async()=>{
  const requests=[];const dom=setup('de','physics',async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,provider:'cloudflare',run_id:'test-fixture',reply:'<img src=x onerror=alert(1)> Erklärung'})};});const w=dom.window,d=w.document;
  change(w,'#el-lesson',1);click(w,'#el-choices button:nth-child(2)');click(w,'#el-test');change(w,'#el-param-angle',40,'input');d.getElementById('el-message').value='Warum bleibt die Beschleunigung gleich?';click(w,'#el-send');await flush();
  assert.equal(requests[0].url,'/api/pulsar/ask/');assert.equal(requests[0].body.locale,'de');assert.match(requests[0].body.message,/"angle":40/);assert.match(requests[0].body.message,/"comparison":/);assert.match(requests[0].body.message,/"mass":8/);assert.ok(requests[0].body.message.length<=4000);assert.match(d.getElementById('el-chat-log').textContent,/LIVE-KI/);assert.equal(d.querySelectorAll('#el-chat-log img').length,0);
  d.getElementById('el-message').value='Und die Normalkraft?';click(w,'#el-send');await flush();assert.equal(requests[1].body.history.length,2);dom.window.close();
});
test('at-rest context states the friction regime and shows an independent numerical reference',async()=>{
  const requests=[];const dom=setup('en','physics',async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({ok:true,provider:'cloudflare',reply:'A generated explanation'})};}),w=dom.window,d=w.document;
  d.getElementById('el-message').value='Why is friction below its static maximum?';click(w,'#el-send');await flush();
  assert.match(requests[0].message,/"motion":"AT_REST"/);assert.match(requests[0].message,/"frictionRegime":"STATIC_BALANCING"/);assert.match(requests[0].message,/does NOT imply kinetic friction/);
  const log=d.getElementById('el-chat-log').textContent;assert.match(log,/MODEL REFERENCE · AT SEND TIME/);assert.match(log,/At rest · static friction 6.71 N · a = 0.00/);dom.window.close();
});
test('maximum question plus A/B snapshot stays inside the existing API message limit',async()=>{
  for(const lang of ['en','de']){const dom=setup(lang),w=dom.window,d=w.document;let sent;
    w.fetch=async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,provider:'fallback',reply:'fixture'})};};
    for(const[id,c]of Object.entries(w.GQEducationCatalog)){change(w,'#el-discipline',id);change(w,'#el-lesson',c.lessons.length-1);click(w,'#el-choices button');click(w,'#el-test');d.getElementById('el-message').value='x'.repeat(1000);click(w,'#el-send');await flush();assert.ok(sent.message.length<=4000);assert.ok(sent.message.endsWith(lang==='de'?'Gleitreibung.':'maximum.'),id+' context was truncated');}
    dom.window.close();
  }
});
test('fallback and failed service responses never masquerade as live AI and remain retryable',async()=>{
  for(const reply of [{ok:true,json:async()=>({ok:true,provider:'fallback',reply:'Unavailable'})},{ok:false,status:503},{ok:true,json:async()=>({ok:true,reply:''})}]){const dom=setup('en','physics',async()=>reply),w=dom.window,d=w.document;d.getElementById('el-message').value='My question';click(w,'#el-send');await flush();const log=d.getElementById('el-chat-log').textContent;assert.ok(!log.includes('PULSAR · LIVE AI'));assert.equal(d.getElementById('el-send').disabled,false);assert.equal(d.getElementById('el-message').value,'My question');dom.window.close();}
});
test('cancel and changing discipline abort outstanding requests without stale replies',async()=>{
  const dom=setup('en','physics',(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))),w=dom.window,d=w.document;
  d.getElementById('el-message').value='Explain this';click(w,'#el-send');assert.equal(d.getElementById('el-send').disabled,true);click(w,'#el-cancel');await flush();assert.equal(d.getElementById('el-send').disabled,false);
  click(w,'#el-send');change(w,'#el-discipline','biology');await flush();assert.equal(d.getElementById('el-chat-log').children.length,0);assert.equal(d.getElementById('el-send').disabled,false);dom.window.close();
});
test('catalog and language links retain demo; hash-only navigation does not erase experiment',()=>{
  const dom=setup(),w=dom.window,d=w.document;click(w,'[data-demo="neuroscience"]');assert.match(w.location.href,/demo=neuroscience/);assert.match(d.querySelector('[data-lang-switch="de"]').href,/demo=neuroscience/);click(w,'#el-choices button');click(w,'#el-test');w.history.replaceState(null,'','#produkt');w.dispatchEvent(new w.PopStateEvent('popstate'));assert.equal(d.getElementById('el-evidence').hidden,false);dom.window.close();
});
test('progressive depth exposes one meaningful control, numerical investigation and advanced equations',()=>{
  for(const lang of ['en','de']){const dom=setup(lang),w=dom.window,d=w.document;
    const visible=()=>[...d.querySelectorAll('.el-control')].filter(el=>!el.hidden).length;
    assert.equal(visible(),1);assert.equal(d.getElementById('el-equation').hidden,true);assert.equal(d.getElementById('el-chart').hidden,true);
    click(w,'[data-level="investigate"]');assert.equal(visible(),4);assert.equal(d.getElementById('el-chart').hidden,false);assert.equal(d.getElementById('el-number-angle').hidden,false);
    change(w,'#el-number-angle',999);assert.equal(d.getElementById('el-param-angle').value,'60');change(w,'#el-number-static',.3);change(w,'#el-number-kinetic',.8);assert.equal(d.getElementById('el-param-static').value,'0.8');
    click(w,'[data-level="advanced"]');assert.equal(visible(),5);assert.equal(d.getElementById('el-equation').hidden,false);click(w,'#el-reset');assert.equal(d.getElementById('el-param-angle').value,'20');dom.window.close();
  }
});
test('journey preserves frozen A/B, bounded history, private reflections and replay independently of exploration',()=>{
  const dom=setup(),w=dom.window,d=w.document;click(w,'#el-choices button:nth-child(2)');click(w,'#el-test');const frozen=d.getElementById('el-comparison').textContent;
  d.getElementById('el-reflection').value='Private <script>reflection</script>';d.getElementById('el-reflection').dispatchEvent(new w.Event('input'));
  assert.match(d.getElementById('el-journey-content').textContent,/Private <script>reflection/);assert.equal(d.querySelectorAll('#el-journey script').length,0);assert.ok(!w.sessionStorage.getItem('gq:education:session:v1').includes('Private'));
  change(w,'#el-param-angle',55,'input');click(w,'.el-replay-actions button:first-child');assert.equal(d.getElementById('el-param-angle').value,'20');assert.equal(d.getElementById('el-comparison').textContent,frozen);click(w,'.el-replay-actions button:last-child');assert.equal(d.getElementById('el-param-angle').value,'35');assert.equal(d.getElementById('el-comparison').textContent,frozen);
  for(let i=0;i<7;i++){click(w,'#el-restart');click(w,'#el-choices button');click(w,'#el-test');}assert.equal(d.querySelectorAll('#el-replay-select option').length,6);dom.window.close();
});
test('language switch restores validated model settings, scenario, prediction and comparison without storing free text',()=>{
  const dom=setup(),w=dom.window,d=w.document;change(w,'#el-lesson',1);click(w,'#el-choices button:nth-child(2)');click(w,'#el-test');click(w,'[data-level="advanced"]');change(w,'#el-param-angle',41,'input');
  const saved=w.sessionStorage.getItem('gq:education:session:v1');assert.equal(JSON.parse(saved).tested,true);
  const next=new JSDOM(fs.readFileSync(path.join(root,'education-de.html'),'utf8'),{url:'https://graviquest.com/education-de.html?demo=physics#erleben',runScripts:'outside-only',pretendToBeVisual:true});next.window.HTMLElement.prototype.scrollIntoView=function(){};next.window.sessionStorage.setItem('gq:education:session:v1',saved);
  for(const file of ['education-models.js','education-catalog.js','education-studio.js'])next.window.eval(fs.readFileSync(path.join(root,'assets',file),'utf8'));
  const nd=next.window.document;assert.equal(nd.getElementById('el-lesson').value,'1');assert.equal(nd.getElementById('el-param-angle').value,'41');assert.equal(nd.getElementById('education-lab').dataset.level,'advanced');assert.equal(nd.getElementById('el-evidence').hidden,false);assert.equal(nd.getElementById('el-reflection').value,'');assert.equal(nd.getElementById('el-chat-log').children.length,0);dom.window.close();next.window.close();
});
test('duplicate grounded live answers are reused and explicit sends are bounded per tab',async()=>{
  let calls=0;const dom=setup('en','physics',async()=>{calls++;return{ok:true,json:async()=>({ok:true,provider:'cloudflare-workers-ai',reply:'A short explanation.'})};}),w=dom.window,d=w.document;
  d.getElementById('el-message').value='Why?';click(w,'#el-send');await flush();click(w,'#el-send');await flush();assert.equal(calls,1);assert.match(d.getElementById('el-chat-log').textContent,/CACHED LIVE ANSWER/);
  for(let i=0;i<15;i++){d.getElementById('el-message').value='Question '+i;click(w,'#el-send');await flush();}assert.equal(calls,12);assert.match(d.getElementById('el-chat-log').textContent,/REQUEST LIMIT/);assert.equal(d.getElementById('el-send').disabled,false);dom.window.close();
});
test('suggested questions require an explicit send and oversized responses remain service errors',async()=>{
  let calls=0;const dom=setup('en','physics',async()=>{calls++;return{ok:true,json:async()=>({ok:true,provider:'cloudflare',reply:'x'.repeat(4001)})};}),w=dom.window,d=w.document;
  click(w,'#el-suggestions button');assert.ok(d.getElementById('el-message').value);assert.equal(calls,0);click(w,'#el-send');await flush();assert.equal(calls,1);assert.match(d.getElementById('el-api-status').textContent,/No live answer/);assert.ok(!d.getElementById('el-chat-log').textContent.includes('PULSAR · LIVE AI'));dom.window.close();
});
function pageSetup(lang='en') {const dom=setup(lang);dom.window.matchMedia=()=>({matches:false});dom.window.eval(fs.readFileSync(path.join(root,'assets/education-page.js'),'utf8'));return dom;}
test('email inquiry validates and prepares a reviewable draft without delivery or storage',()=>{
  for(const lang of ['en','de']){const dom=pageSetup(lang),w=dom.window,d=w.document,form=d.getElementById('education-inquiry');
    form.querySelector('[name=institution]').value='Example Institute';form.querySelector('[name=email]').value='teacher@example.org';form.querySelector('[name=subject]').value='Physics';form.querySelector('[name=challenge]').value='How do we teach friction? <img src=x>';
    form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));const link=new URL(d.getElementById('inquiry-link').href);assert.equal(link.pathname,'webmaster@gravitasplus.com');assert.match(link.searchParams.get('body'),/teacher@example.org/);assert.match(link.searchParams.get('body'),/teach friction/);assert.equal(d.getElementById('inquiry-ready').hidden,false);assert.ok(!JSON.stringify([...Object.entries(w.sessionStorage)]).includes('teacher@'));assert.equal(d.querySelectorAll('#inquiry-ready img').length,0);
    form.querySelector('[name=subject]').dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(d.getElementById('inquiry-ready').hidden,true);dom.window.close();
  }
});
test('three featured models, six disclosed models, computed previews, metadata and theme remain bilingual',()=>{
  for(const lang of ['en','de']){const dom=pageSetup(lang),d=dom.window.document;assert.equal(d.querySelectorAll('#anwendung > .ed-container > .el-catalog [data-demo]').length,3);assert.equal(d.querySelectorAll('#all-disciplines [data-demo]').length,6);assert.equal(d.querySelectorAll('[data-preview] svg,[data-preview] .ed-thumb-grid').length,9);assert.equal(d.querySelector('meta[name=robots]').content,'noindex,nofollow');assert.equal(d.querySelectorAll('[hreflang][rel=alternate]').length,3);click(dom.window,'#ed-theme');assert.equal(d.documentElement.dataset.theme,'light');dom.window.close();}
});
test('timeout is explicit and leaves the question available for a manual retry',async()=>{
  const dom=setup('en','physics',(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))),w=dom.window,d=w.document;let expire;
  const timer=w.setTimeout;w.setTimeout=(callback,ms)=>ms===22000?(expire=callback,1):timer(callback,ms);d.getElementById('el-message').value='Explain this result';click(w,'#el-send');expire();await flush();assert.match(d.getElementById('el-chat-log').textContent,/timed out/);assert.equal(d.getElementById('el-message').value,'Explain this result');assert.equal(d.getElementById('el-send').disabled,false);dom.window.close();
});
test('a cached answer is not reused after intervening conversation changes its context',async()=>{
  let calls=0;const dom=setup('en','physics',async()=>({ok:true,json:async()=>({ok:true,provider:'cloudflare',reply:'Answer '+(++calls)})})),w=dom.window,d=w.document;
  for(const q of ['Why?','Now discuss mass.','Why?']){d.getElementById('el-message').value=q;click(w,'#el-send');await flush();}assert.equal(calls,3);dom.window.close();
});
test('replaying an older scenario restores its question, evidence, reflection and language state together',()=>{
  const dom=setup(),w=dom.window,d=w.document;click(w,'#el-choices button:nth-child(2)');click(w,'#el-test');const threshold=d.getElementById('el-comparison').textContent;
  change(w,'#el-lesson',1);click(w,'#el-choices button:nth-child(2)');click(w,'#el-test');change(w,'#el-replay-select',0);click(w,'.el-replay-actions button:first-child');assert.equal(d.getElementById('el-lesson').value,'0');assert.equal(d.getElementById('el-param-angle').value,'20');assert.equal(d.getElementById('el-comparison').textContent,threshold);
  d.getElementById('el-reflection').value='Reflection for the threshold';d.getElementById('el-reflection').dispatchEvent(new w.Event('input'));assert.match(d.getElementById('el-journey-content').textContent,/Reflection for the threshold/);const saved=JSON.parse(w.sessionStorage.getItem('gq:education:session:v1'));assert.equal(saved.lesson,0);assert.equal(saved.parameters.angle,20);assert.ok(!JSON.stringify(saved).includes('Reflection for'));dom.window.close();
});
test('typing a valid numerical value updates the model without a blur and incomplete decimals remain editable',()=>{
  const dom=setup(),w=dom.window,d=w.document;click(w,'button[data-level="advanced"]');change(w,'#el-number-angle',41,'input');assert.equal(d.getElementById('el-param-angle').value,'41');assert.match(d.getElementById('el-out-angle').textContent,/41/);change(w,'#el-number-mass','0','input');assert.equal(d.getElementById('el-number-mass').value,'0');assert.equal(d.getElementById('el-param-mass').value,'2');change(w,'#el-number-mass',.5,'input');assert.equal(d.getElementById('el-param-mass').value,'0.5');dom.window.close();
});
test('incline questions separate the paused current frame from the predicted trajectory endpoint',async()=>{
  let payload;const dom=setup('en','physics',async(url,options)=>{payload=JSON.parse(options.body);return{ok:true,json:async()=>({ok:true,provider:'fallback',reply:'Fixture'})};}),w=dom.window,d=w.document;
  change(w,'#el-param-angle',35,'input');d.getElementById('el-message').value='What are the current velocity and position?';click(w,'#el-send');await flush();assert.match(payload.message,/"currentTimeSeconds":0/);assert.match(payload.message,/"currentVelocityMps":0/);assert.match(payload.message,/"currentPositionMetres":0/);assert.match(payload.message,/"endOfRunVelocityMps":8\./);assert.match(payload.message,/"playback":"PAUSED"/);assert.match(d.getElementById('el-chat-log').textContent,/t = 0.00 s · v = 0.00 m\/s · x = 0.00 m/);dom.window.close();
});
