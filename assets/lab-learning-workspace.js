/* Learning workspace: real paired atlas evidence, a skippable tutor, and account continuity. */
(function(root){
'use strict';
const POLICIES=[
 ['verification','Peer review capacity','How many studies can reviewers check?','Watch the review queue and publications. An empty queue does not establish reliability.'],
 ['generation','Idea generation','What happens when ideas arrive faster?','Compare the review queue with the number of studies tested.'],
 ['replication','Independent repeats','What changes when more findings can be tested again?','Watch repeat tests, failed repeats and withdrawals together.'],
 ['funding','Research funding','Does more funding remove the bottleneck?','Compare active studies and publications; another stage may limit throughput.'],
 ['aiAdoption','AI-assisted generation','Can faster idea production outpace checking?','Compare generated ideas, review queues and model-known false claims.'],
 ['sampleSize','Sample size','What does a larger sample change?','Follow tested studies and false claims; resource costs can also change.'],
 ['alpha','Statistical threshold','What happens when a positive result becomes easier to declare?','Compare publications with model-known false claims.'],
 ['transparency','Open methods','Can a predeclared analysis reduce selective reporting?','Compare false claims and publication counts, keeping the other settings equal.'],
 ['pressure','Publication pressure','What if positive results receive more reward?','Compare output and false claims; more papers is not necessarily better knowledge.'],
 ['diversity','Search across communities','What happens when teams explore outside their own community?','Watch cross-community studies and live claims. There is no built-in proven quality bonus.'],
 ['network','Knowledge diffusion','Does more attention bring more checking?','Compare citations and independent repeats. Attention is not evidence of truth.'],
 ['uncertainty','AI caution','What changes when uncertain agents hold back?','Compare ideas, tested studies and false claims; useful ideas may also be missed.']
];
const METRICS={published:'Published papers',falsePublished:'Model-known false claims',replicated:'Independent repeats',reviewBacklog:'Waiting for review',healthyPapers:'Live papers',generated:'Ideas generated',tested:'Studies tested',retracted:'Withdrawals',citations:'Citations',falseDiscoveryRate:'False share (%)'};
function el(tag,cls,content){const n=document.createElement(tag);if(cls)n.className=cls;if(content!==undefined)n.textContent=String(content);return n;}
function button(label,action,cls=''){const n=el('button','g-btn g-btn--secondary g-btn--sm '+cls,label);n.type='button';n.addEventListener('click',action);return n;}
function number(v){return Number(v).toLocaleString('en-US',{maximumFractionDigits:1});}
let host=null,guide=null,guideIndex=-1,lessonState=null,atlas=null,atlasSequence=0,access=null,canSync=false,syncTimer=null,loading=false;
let config=null,authOwner=null,accessReady=false,notice=null,saveRequested=false;
let lessonPolicies=POLICIES,guideDays=20,firstComplete=false;
const GUIDE_KEY='graviquest:science-ecosystem:guide:v2';
function prepare(){if(guide&&!guide.hidden&&guideIndex<0)config.tell('lab:lesson',{action:'welcome'});}
function startGuide(){guideIndex=-1;firstComplete=false;guide.hidden=false;renderGuide();prepare();config.openChat();host.dataset.mode='guide';}
function rememberGuide(){try{localStorage.setItem(GUIDE_KEY,'done');}catch(_){}}
function skipGuide(){if(!guide.hidden&&!firstComplete&&guideIndex<lessonPolicies.length)config.track?.('guide_skipped',{step:Math.max(0,guideIndex+1)});guide.hidden=true;host.dataset.mode='chat';rememberGuide();config.tell('lab:lesson',{action:'skip'});config.refreshReplies?.();}
function beginComparison(){config.track?.('guide_started');guideIndex=0;showPolicy();renderGuide();}
function nextControl(){guideIndex++;showPolicy();renderGuide();}
function showPolicy(){config.closeAtlas();const p=lessonPolicies[guideIndex];if(p){config.track?.('guide_step',{step:guideIndex+1,parameter:p[0]});config.tell('lab:lesson',{action:'start',policy:p[0]});}}
function renderGuide(){
 if(!guide)return;guide.replaceChildren();queueMicrotask(()=>config?.refreshReplies?.());
 const head=el('div','learning-guide-head');head.append(el('span','g-eyebrow','PULSAR · YOUR FIRST EXPERIMENT'),button('Skip guide',skipGuide,'learning-skip'));guide.append(head);
 if(guideIndex<0){guide.append(el('h3','','Let’s try one change together'),el('p','','I’m Pulsar. We’ll keep World A as a baseline, change one setting in World B, and compare the result. Choose how you’d like to begin — typing is optional.'),button('Build my first comparison',beginComparison,'learning-primary'),button('Show a stored comparison',()=>{skipGuide();config.openAtlas();}),button('Explore on my own',skipGuide));return;}
 if(guideIndex>=POLICIES.length){guide.append(el('h3','','You have tested all 12 controls'),el('p','','Keep exploring your comparison, or use the atlas to inspect paired runs across several seeds.'),button('Explore scenario atlas',()=>{skipGuide();config.openAtlas();}),button('Finish guide',skipGuide));return;}
 const [key,title,question,watch]=lessonPolicies[guideIndex],step=el('div','learning-step');step.append(el('span','',guideIndex===0?(firstComplete?'FIRST COMPARISON COMPLETE':'YOUR FIRST COMPARISON'):'OPTIONAL · CONTROL '+(guideIndex+1)+' / '+POLICIES.length),el('progress'));step.lastChild.max=2;step.lastChild.value=lessonState?.observed?2:1;guide.append(step,el('h3','',title),el('p','',question),el('p','learning-watch',watch));
 const current=lessonState?.policy===key?lessonState:null;
 const status=el('p','learning-guide-status',current?.observed?'Result ready · '+current.days+' matched model days. Compare A and B below.':current?.changed?'Change recorded in B. Advance both worlds to observe the result.':'Change the highlighted slider in World B. A stays at its baseline.');status.setAttribute('role','status');guide.append(status);
 if(current?.observed){const results=el('dl','learning-mini-results');for(const metric of ['published','falsePublished','reviewBacklog']){const row=el('div');row.append(el('dt','',METRICS[metric]),el('dd','','A '+number(current.a[metric])+' · B '+number(current.b[metric])));results.append(row);}guide.append(results);}
 const actions=el('div','learning-guide-actions');actions.append(button('Show control',()=>{config.closeAtlas();config.tell('lab:lesson',{action:'focus',policy:key});}),button('Test both · '+guideDays+' days',()=>{config.track?.('guide_test',{parameter:key,step:guideIndex+1,days:guideDays});config.tell('lab:lesson',{action:'observe',policy:key,days:guideDays});},'learning-observe'));
 actions.lastChild.disabled=!current?.changed||current?.observed;
 if(current?.observed){actions.replaceChildren(button('Finish first experiment',skipGuide,'learning-primary'),button('Explain this comparison',()=>{config.openChat();config.ask('Explain the current matched A/B result simply. What changed, and what cannot be concluded?','ask');}),button(guideIndex===POLICIES.length-1?'See all controls completed':guideIndex===0?'Explore other controls':'Next control',nextControl));}
 guide.append(actions);
}
function updateLesson(raw){
 if(!raw||!POLICIES.some(p=>p[0]===raw.policy)||!Number.isFinite(raw.days))return;
 const clean={policy:raw.policy,changed:raw.changed===true,observed:raw.observed===true,days:raw.days,a:{},b:{}};
 for(const side of ['a','b'])for(const m of Object.keys(METRICS))if(Number.isFinite(raw[side]?.[m]))clean[side][m]=raw[side][m];
 lessonState=clean;
 if(!guide.hidden&&clean.policy===lessonPolicies[guideIndex]?.[0]&&clean.observed&&!firstComplete){firstComplete=true;rememberGuide();config.track?.('guide_completed');}
 if(!guide.hidden)renderGuide();
}
function replyActions(fa=false){
 const label=(en,faText)=>fa?faText:en;
 if(!guide||guide.hidden||guideIndex<0||guideIndex>=lessonPolicies.length)return null;
 const p=lessonPolicies[guideIndex],observed=lessonState?.policy===p[0]&&lessonState.observed;
 return observed?[
  {label:label('Explain A vs B','تفاوت A و B را توضیح بده'),ai:true,action:()=>config.ask(fa?'نتیجهٔ مقایسهٔ فعلی A و B را ساده توضیح بده. چه چیزی تغییر کرد و چه محدودیت‌هایی دارد؟':'Explain the current matched A/B result simply. What changed, and what cannot be concluded?','ask')},
  {label:label('Finish this experiment','این آزمایش را تمام کنیم'),action:skipGuide}
 ]:[
  {label:label('Explain this setting','این تنظیم را توضیح بده'),ai:true,action:()=>config.ask((fa?'این تنظیم در مدل چه کاری انجام می‌دهد؟ ':'What does this setting do in the model? ')+p[1],'ask')},
  {label:label('Show the control','تنظیم را نشان بده'),action:()=>config.tell('lab:lesson',{action:'focus',policy:p[0]})},
  {label:label('Explore on my own','خودم بررسی می‌کنم'),action:skipGuide}
 ];
}
function accountLink(label,mode='in'){const link=el('a','g-btn g-btn--secondary g-btn--sm',label);link.href='/account.html?next='+encodeURIComponent('/lab.html?lab=science-universe')+'#'+mode;link.target='_blank';link.rel='noopener';return link;}
function renderAccess(){
 config.refreshReplies?.();
 if(!notice||!access)return;notice.replaceChildren();notice.classList.toggle('is-exhausted',!access.authenticated&&access.remaining===0);
 if(config.pulsarEnabled===false){notice.append(el('span','','AI explanations are disabled for this Lab. The guide, simulation and scientific sources remain available.'));if(saveRequested&&!access.authenticated)notice.append(accountLink('Save to my account','up'));return;}
 if(access.authenticated){notice.append(el('span','','Signed in · conversation and snapshots can stay with your account.'));
  if(!canSync)notice.append(button('Save this conversation',()=>{canSync=true;sync(config.history());renderAccess();}));return;}
 const limit=access.limit||25;notice.append(el('span','',access.remaining===0?'Your '+limit+' guest questions are complete. Sign in to continue Pulsar.':access.remaining+' of '+limit+' guest questions left.'));
 if(access.remaining>5&&!saveRequested)return;
 const reason=el('small','','An account keeps your conversations and snapshots across visits and devices. The simulation and atlas stay open.');notice.append(reason,accountLink(access.remaining===0?'Continue with an account':'Save to my account','up'));
 notice.classList.toggle('is-exhausted',access.remaining===0);
}
async function refreshAccess(){
 if(loading)return;loading=true;const epoch=config.session();
 try{const response=await fetch('/api/labs/science-universe/access/',{credentials:'same-origin',cache:'no-store'});if(!response.ok)return;const next=await response.json();if(epoch!==config.session())return;
  const wasReady=accessReady,wasGuest=access&&!access.authenticated;access=next;accessReady=true;
  if(next.authenticated&&(!wasReady||authOwner!==next.owner_id)){
   authOwner=next.owner_id;canSync=!wasGuest;
   if(canSync){const r=await fetch('/api/labs/science-universe/conversation/',{credentials:'same-origin',cache:'no-store'});if(r.ok&&epoch===config.session()){const data=await r.json();config.restore(data.messages||[],authOwner,!wasReady);}}
  }else if(!next.authenticated){const wasAccount=authOwner!==null;authOwner=null;canSync=false;clearTimeout(syncTimer);if(!wasReady||wasAccount)config.restoreGuest(!wasReady);}
  renderAccess();
 }catch(_){}finally{loading=false;}
}
async function csrf(){let token=(document.cookie.match(/(?:^|; )(?:csrftoken|gravitas_staging_csrftoken)=([^;]*)/)||[])[1]||'';if(!token){await fetch('/api/auth/csrf/',{credentials:'same-origin'});token=(document.cookie.match(/(?:^|; )(?:csrftoken|gravitas_staging_csrftoken)=([^;]*)/)||[])[1]||'';}return decodeURIComponent(token);}
function sync(messages){
 if(!access?.authenticated||!canSync)return;clearTimeout(syncTimer);notice.dataset.saved='pending';const epoch=config.session(),owner=authOwner,copy=messages.slice(-70);
 syncTimer=setTimeout(async()=>{try{const token=await csrf();if(epoch!==config.session()||owner!==authOwner||loading)return;const r=await fetch('/api/labs/science-universe/conversation/',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRFToken':token},body:JSON.stringify({messages:copy})});if(!r.ok)throw Error();notice.dataset.saved='true';}catch(_){notice.dataset.saved='false';}},450);
}
function updateAccess(value){if(value&&Number.isInteger(value.remaining)){access={...access,...value};renderAccess();}}
function mayAsk(){if(access&&!access.authenticated&&access.remaining===0){renderAccess();notice.scrollIntoView({block:'nearest'});return false;}return true;}
function atlasContext(){return atlas&&config.atlasOpen()?{signatures:atlas.pairs.flatMap(p=>[p.a.signature,p.b.signature]),policy:atlas.policy,low:atlas.low,high:atlas.high}:null;}
function trend(data,metric){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 680 230');svg.setAttribute('role','img');svg.setAttribute('aria-label',METRICS[metric]+' in World A and B, means of matched stored runs');svg.classList.add('atlas-chart');
 const rows=data.trajectory.filter(p=>Number.isFinite(p.a[metric])&&Number.isFinite(p.b[metric])),max=Math.max(1,...rows.flatMap(p=>[p.a[metric],p.b[metric]])),last=Math.max(1,...rows.map(p=>p.day));
 for(let i=0;i<4;i++){const y=18+i*58,line=document.createElementNS(ns,'path');line.setAttribute('d','M48 '+y+'H660');line.setAttribute('class','atlas-grid-line');svg.append(line);const label=document.createElementNS(ns,'text');label.setAttribute('x','3');label.setAttribute('y',String(y+4));label.textContent=number(max*(1-i/3));svg.append(label);}
 for(const side of ['a','b']){const line=document.createElementNS(ns,'polyline');line.setAttribute('points',rows.map(p=>[48+p.day/last*610,192-p[side][metric]/max*174].join(',')).join(' '));line.setAttribute('class','atlas-series atlas-series-'+side);svg.append(line);}
 for(const [label,x,anchor] of [['Day 0',48,'start'],['Day '+last,658,'end']]){const t=document.createElementNS(ns,'text');t.setAttribute('x',String(x));t.setAttribute('y','220');t.setAttribute('text-anchor',anchor);t.textContent=label;svg.append(t);}return svg;
}
function mountAtlas(content){
 let metric='published';const head=el('div','atlas-intro');head.append(el('span','g-eyebrow','COMPARE EXECUTED MODEL RUNS'),el('h3','','One change. Two outcomes.'),el('p','','Choose a setting to compare. These results come from stored model executions with the same seed, starting design and time horizon. Pulsar can help you interpret the differences.'));content.append(head);
 const presets=el('div','atlas-question-cards');for(const [title,key] of [['Can review keep up?','generation'],['What does stronger checking change?','verification'],['Does repeating studies help?','replication']])presets.append(button(title,()=>{policy.value=key;low.value='3';high.value='9';load();}));content.append(presets);
 const form=el('form','atlas-comparison-controls'),policy=el('select'),low=el('select'),high=el('select');policy.setAttribute('aria-label','Parameter to compare');low.setAttribute('aria-label','World A setting');high.setAttribute('aria-label','World B setting');
 POLICIES.forEach(p=>{const o=el('option','',p[1]);o.value=p[0];policy.append(o);});for(let i=1;i<=10;i++)for(const select of [low,high]){const o=el('option','',i+'/10');o.value=i;select.append(o);}low.value='3';high.value='9';
 for(const [label,input] of [['Change one setting',policy],['World A',low],['World B',high]]){const box=el('label','',label);box.append(input);form.append(box);}const submit=button('Compare stored runs',()=>{});submit.type='submit';form.append(submit);form.addEventListener('submit',e=>{e.preventDefault();load();});content.append(form);
 const results=el('div','atlas-comparison-result');results.setAttribute('aria-live','polite');content.append(results);
 async function load(){const sequence=++atlasSequence;atlas=null;results.replaceChildren(el('p','atlas-loading','Loading matched model runs…'));submit.disabled=true;
  try{const response=await fetch('/api/labs/science-universe/scenarios/compare/?policy='+encodeURIComponent(policy.value)+'&low='+low.value+'&high='+high.value,{credentials:'same-origin'});const data=await response.json();if(sequence!==atlasSequence)return;
   if(!response.ok)throw Error(data.error==='invalid_comparison'?'Choose two different values between 1 and 10.':'A matched comparison is not stored for these settings. Try another pair.');atlas=data;config.track?.('atlas_compared',{parameter:data.policy,low:data.low,high:data.high,days:data.days});render(data);
  }catch(error){if(sequence===atlasSequence)results.replaceChildren(el('p','atlas-error',error.message));}finally{if(sequence===atlasSequence)submit.disabled=false;}
 }
 function render(data){results.replaceChildren();const chosen=POLICIES.find(p=>p[0]===data.policy);results.append(el('h3','',chosen[1]+': '+data.low+' → '+data.high),el('p','atlas-pair-basis',data.matched_seeds+' matched seeds · '+data.days+' model days · all other settings and the initial design equal'));
  const score=el('div','atlas-outcome-grid');for(const key of ['published','falsePublished','replicated','reviewBacklog']){const m=data.metrics[key];if(!m)continue;const card=el('article','atlas-outcome');card.append(el('h4','',METRICS[key]),el('p','atlas-values','A '+number(m.a)+'   B '+number(m.b)),el('strong','',(m.delta>0?'+':'')+number(m.delta)+' in B'),el('small','','Paired seed differences: '+number(m.delta_min)+' to '+number(m.delta_max)));score.append(card);}results.append(score);
  const chart=el('section','atlas-trend'),picker=el('select');picker.setAttribute('aria-label','Atlas trend metric');for(const key of Object.keys(METRICS))if(data.metrics[key]){const o=el('option','',METRICS[key]);o.value=key;picker.append(o);}if(!data.metrics[metric])metric='published';picker.value=metric;const picture=el('div');picture.append(trend(data,metric));picker.addEventListener('change',()=>{metric=picker.value;picture.replaceChildren(trend(data,metric));});chart.append(picker,el('p','atlas-chart-key','World A · blue   /   World B · gold   ·   means of matched runs'),picture);results.append(chart);
  const detail=el('details','atlas-evidence-table');detail.append(el('summary','','See each seed and the fixed settings'));const table=el('table'),thead=el('thead'),headrow=el('tr');['Seed','A papers','B papers','A false claims','B false claims'].forEach(x=>headrow.append(el('th','',x)));thead.append(headrow);table.append(thead);const body=el('tbody');for(const pair of data.pairs){const row=el('tr');[pair.seed,pair.a.result.published,pair.b.result.published,pair.a.result.falsePublished,pair.b.result.falsePublished].forEach(x=>row.append(el('td','',x)));body.append(row);}table.append(body);detail.append(table,el('p','',Object.entries(data.pairs[0].a.parameters).filter(([k])=>k!==data.policy).map(([k,v])=>(POLICIES.find(p=>p[0]===k)?.[1]||k)+': '+v+'/10').join(' · ')));results.append(detail);
  const actions=el('div','atlas-result-actions');actions.append(button('Try this comparison in the Lab',()=>{skipGuide();config.closeAtlas();config.tell('lab:comparison',{policy:data.policy,low:data.low,high:data.high,seed:data.pairs[0].seed,days:data.days,parameters:data.pairs[0].a.parameters,design:data.pairs[0].design});}),button('Ask Pulsar about these results',()=>{config.openChat();config.ask('Explain this selected atlas comparison in plain language: what differs between A and B, what trade-off should I watch, and what cannot be concluded from these '+data.matched_seeds+' paired model runs?','ask');}));results.append(actions,el('p','atlas-limit',data.limitations+' These are simulated outcomes, not observations of real research communities.'));
 }
 load();
}
function mount(options){
 config=options;access=null;accessReady=false;saveRequested=false;authOwner=null;canSync=false;atlas=null;firstComplete=false;clearTimeout(syncTimer);
 const settings=options.settings||{};guideDays=Number.isInteger(settings.lesson_days)&&settings.lesson_days>=1&&settings.lesson_days<=120?settings.lesson_days:20;lessonPolicies=POLICIES.map(p=>{const custom=settings.lessons?.[p[0]]||{};return [p[0],custom.title||p[1],custom.question||p[2],custom.watch||p[3]];});
 host=options.assistant;host.dataset.mode='chat';const tabs=el('div','learning-mobile-tabs');tabs.append(button('Pulsar guide',()=>{host.dataset.mode='guide';if(guide.hidden)startGuide();}),button('Ask Pulsar',()=>{host.dataset.mode='chat';config.openChat();}));host.prepend(tabs);guide=el('section','lab-learning-guide');guide.hidden=true;guideIndex=-1;lessonState=null;tabs.after(guide);renderGuide();
 notice=el('section','lab-access-strip');notice.setAttribute('aria-label','Pulsar guest access');options.body.insertBefore(notice,options.form);
 refreshAccess();
}
window.addEventListener('focus',()=>{if(config&&root.document.querySelector('#lab-experiences[data-lab-slug="science-universe"]'))refreshAccess();});
function hideGuide(){if(guide&&!guide.hidden){guide.hidden=true;host.dataset.mode='chat';}}
root.GraviLabLearning={hideGuide,POLICIES,METRICS,mount,startGuide,prepare,updateLesson,mountAtlas,atlasContext,updateAccess,mayAsk,sync,refreshAccess,replyActions,requestSave:()=>{saveRequested=true;renderAccess();config.openChat();},access:()=>access};
})(window);
