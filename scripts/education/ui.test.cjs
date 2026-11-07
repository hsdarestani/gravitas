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
test('EN/DE pages retain nine chapters, unique ids, original cart, direct demo and shared scripts',()=>{
  for(const lang of ['en','de']){const dom=setup(lang,'chemistry'),d=dom.window.document;assert.deepEqual([...d.querySelectorAll('.ed-nav > a')].slice(0,3).map(a=>a.hash),['#idee','#erleben','#sprint']);assert.equal(d.querySelectorAll('.ed-slide').length,9);assert.equal(d.querySelectorAll('h1').length,1);assert.equal(d.querySelectorAll('[data-demo]').length,9);const ids=[...d.querySelectorAll('[id]')].map(x=>x.id);assert.equal(new Set(ids).size,ids.length);assert.ok(d.getElementById('ps-studio'));assert.equal(d.getElementById('el-discipline').value,'chemistry');assert.ok(d.querySelector('[data-lang-switch]').href.includes('demo=chemistry'));assert.ok(!/[€$£]|\b2,200\b/.test(d.body.textContent));dom.window.close();}
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
  click(w,'#el-play');assert.match(d.getElementById('el-play').textContent,/Pause/);click(w,'#el-rewind');assert.match(d.getElementById('el-time').textContent,/0.00/);
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
