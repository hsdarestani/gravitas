/* GraviQuest Lab shell — public read-only presentation and supervised event coaching.
   Nothing appears while the Lab registry is empty. The simulator is always
   in an opaque-origin iframe; neither code nor instructions run in this shell. */
(function(){
'use strict';
var root=document.getElementById('lab-experiences');
if(!root)return;
var protocol='graviquest.lab.v1', validKey=/^[a-z][a-z0-9_-]{0,63}$/;
var iframe=null, active=null, shell=null, currentSection='', lastMetrics={}, metricHistory={};
var lastCoachAt=0, scheduled=null, lastEventKey='', lastEventAt=0, aiBusy=false;
var speaking=true, controller=null, session=0;
var chat=null,chatHistory=[],chatUnread=0,chatBusy=false,chatOpen=false;
var tourActive=false, tourIndex=0, tourUI=null;
var CHAT_KEY='graviquest:pulsar:lab01:history:v1';
var scienceGuide=window.GraviScienceCoach||null;
var TOUR_STORAGE='graviquest:science-universe:tour:v1';
var SCIENCE_TOUR=[
  {target:'overview',title:'Your synthetic science universe',
   description:'Twenty-eight laboratories span biology, climate, physics and materials. Nodes are laboratories; connecting lines represent modeled collaboration.',
   task:'Look at the research network. Select a laboratory to inspect its own researchers and budget.'},
  {target:'play',title:'Time runs the research process',
   description:'The agents are simulated humans and AI roles following mathematical rules. Each model day can generate, test, review and publish hypotheses.',
   task:'Press Play, or advance 10 days, then watch the counters change.'},
  {target:'hypotheses',title:'An idea is not a discovery',
   description:'The engine gives each synthetic hypothesis a hidden truth value. Studies can produce false positives or fail to detect real effects.',
   task:'Compare the hypothesis count with published papers and replications.'},
  {target:'policy',title:'Change the rules, not the answers',
   description:'Twelve policy sliders control rates and incentives. A higher review setting changes review capacity and rigor; it does not make every paper true.',
   task:'Open Policies and change one slider, such as Peer review capacity.'},
  {target:'quality',title:'Evidence must survive criticism',
   description:'Papers pass modeled review, but can still be wrong. Independent replication may support them or lead to withdrawal.',
   task:'Inspect the outcomes chart and Scientific event stream below it.'},
  {target:'network',title:'Attention is different from truth',
   description:'Collaboration and proximity shape citation chances. Citations measure the modeled spread of attention, not scientific validity.',
   task:'Select or move a lab in the network; inspect its agents, published claims and connections.'},
  {target:'fork',title:'Create a controlled comparison',
   description:'World B copies the exact state and random-generator position of World A. Nothing changes automatically; choose one policy in B to explore its impact.',
   task:'Press Create comparison. Keep track of which rules differ between the two worlds.'},
  {target:'compare',title:'Compare results, not predictions',
   description:'Both worlds advance independently after the checkpoint. Compare live papers, false claims, replications and withdrawals—but do not read one run as a real-world causal estimate.',
   task:'Advance both worlds and inspect the Parallel realities comparison.'},
  {target:'limits',title:'Know what the model cannot claim',
   description:'This is a deterministic-seed, stochastic and entirely synthetic teaching model. Its base rates and other parameters are assumptions, not measurements of real research.',
   task:'Open Model assumptions for the scientific limitations, then explore freely.'}
];
function tourSeen(){
  try{return localStorage.getItem(TOUR_STORAGE)==='done';}catch(_){return false;}
}
function markTourSeen(){
  try{localStorage.setItem(TOUR_STORAGE,'done');}catch(_){}
}
function focusTour(){
  if(!tourActive||!active||active.slug!=='science-universe')return;
  tellIframe('lab:tutorial',{target:SCIENCE_TOUR[tourIndex].target});
}
function renderTour(){
  if(!tourActive||!tourUI)return;
  var step=SCIENCE_TOUR[tourIndex];
  tourUI.count.textContent='STEP '+(tourIndex+1)+' / '+SCIENCE_TOUR.length;
  tourUI.progress.value=tourIndex+1;
  tourUI.title.textContent=step.title;
  tourUI.description.textContent=step.description;
  tourUI.task.textContent=step.task;
  tourUI.status.textContent='Try the highlighted control, or continue when ready.';
  tourUI.previous.disabled=tourIndex===0;
  tourUI.next.textContent=tourIndex===SCIENCE_TOUR.length-1?'Finish tour':'Next step';
  focusTour();
}
function startTour(){
  if(!tourUI||!active||active.slug!=='science-universe')return;
  tourActive=true;tourIndex=0;
  tourUI.card.hidden=false;renderTour();
}
function finishTour(){
  tourActive=false;markTourSeen();
  tellIframe('lab:tutorial',{target:'off'});
  if(tourUI){tourUI.card.hidden=true;tourUI.launch.focus();}
}
function makeTourUI(main,bar){
  var launch=btn('Guided tour',startTour,'lab-tour-launch');
  bar.append(launch);
  var card=node('section','lab-tour');
  card.hidden=true;card.setAttribute('aria-label','Science Universe guided tour');
  var head=node('div','lab-tour-head');
  var count=node('span','lab-tour-kicker','STEP 1 / 9');
  var skip=btn('Skip tour',finishTour,'lab-tour-skip');
  head.append(count,skip);
  var progress=node('progress','lab-tour-progress');
  progress.max=SCIENCE_TOUR.length;progress.value=1;
  progress.setAttribute('aria-label','Tutorial progress');
  var title=node('h2','lab-tour-title');
  var description=node('p','lab-tour-description');
  var task=node('p','lab-tour-task');
  var status=node('p','lab-tour-status');
  status.setAttribute('aria-live','polite');
  var actions=node('div','lab-tour-actions');
  var previous=btn('Previous',function(){if(tourIndex>0){tourIndex--;renderTour();}},'lab-tour-prev');
  var show=btn('Show control',focusTour,'lab-tour-focus');
  var next=btn('Next step',function(){
    if(tourIndex<SCIENCE_TOUR.length-1){tourIndex++;renderTour();}
    else finishTour();
  },'lab-tour-next');
  actions.append(previous,show,next);
  card.append(head,progress,title,description,task,status,actions);
  main.append(card);
  tourUI={card:card,launch:launch,count:count,progress:progress,title:title,
    description:description,task:task,status:status,previous:previous,next:next};
}

function node(tag,cls,content){
  var n=document.createElement(tag);if(cls)n.className=cls;
  if(content!==undefined)n.textContent=String(content);return n;
}
function btn(label,onClick,cls){
  var b=node('button','g-btn g-btn--secondary g-btn--sm '+(cls||''),label);
  b.type='button';b.addEventListener('click',onClick);return b;
}
function numeric(data){
  var r={};
  if(!data||typeof data!=='object'||Array.isArray(data))return r;
  Object.keys(data).slice(0,12).forEach(function(k){
    var v=data[k];if(validKey.test(k)&&typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<1e12)r[k]=v;
  });return r;
}
function tellIframe(type,data){
  if(iframe&&iframe.contentWindow)iframe.contentWindow.postMessage(Object.assign({schema:protocol,type:type},data||{}),'*');
}
function mobileLabFrame(){
  return !!(active&&active.slug==='science-universe'&&window.matchMedia('(max-width: 1050px)').matches);
}
function adjustFrameForViewport(){
  if(!iframe||!active||active.slug!=='science-universe')return;
  // A workspace owns its viewport; model content scrolls inside it.
  // Never feed document height back into this iframe's own min-height.
  iframe.style.height='';
}
window.addEventListener('resize',adjustFrameForViewport,{passive:true});
window.matchMedia('(max-width: 1050px)').addEventListener('change',function(e){
 if(active?.slug==='science-universe'&&chat){chatOpen=!e.matches;refreshChat();}
});
function saveChat(){
 try{localStorage.setItem(CHAT_KEY,JSON.stringify(chatHistory.slice(-70)));}catch(_){}
}
function addChat(role,text,provider,citations){
 var value=String(text||'').trim().slice(0,1800);
 if(!value)return;
 var m={role:role==='user'?'user':'pulsar',text:value,
   provider:provider==='ai'?'ai':'guide',citations:Array.isArray(citations)?citations.slice(0,6):[],at:Date.now()};
 chatHistory.push(m);chatHistory=chatHistory.slice(-70);saveChat();
 if(chat){
   addBubble(m);
   if(!chatOpen&&m.role==='pulsar'){chatUnread++;refreshChat();}
 }
}
function addBubble(m){
 if(!chat)return;
 var row=node('div','lab-chat-bubble '+(m.role==='user'?'is-user':'is-pulsar'));
 var displayText=m.text;
 (m.citations||[]).forEach(function(c){if(c.id)displayText=displayText.split('['+c.id+']').join('');});
 var p=node('p','',displayText.replace(/  +/g,' ').trim());
 var date=new Date(Number(m.at)||Date.now());
 var stamp=date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
 var meta=node('small','lab-chat-meta',stamp+(m.role==='pulsar'?
     ' · '+(m.provider==='ai'?'Pulsar · live':'Guided note'):''));
 row.append(p);
 (m.citations||[]).forEach(function(c){
  if(!/^[a-z0-9-]+$/.test(c.document||'')||!/^[a-z0-9-]+$/.test(c.anchor||''))return;
  row.append(btn(c.section||c.title,function(){openKnowledge(c.document,c.anchor);},'lab-source-ref'));
 });
 row.append(meta);chat.log.append(row);
 chat.log.scrollTop=chat.log.scrollHeight;
}
function refreshChat(){
 if(!chat)return;
 chatOpen=!!chatOpen;
 chat.box.classList.toggle('is-open',chatOpen);
 chat.body.hidden=!chatOpen;
 chat.toggle.setAttribute('aria-expanded',String(chatOpen));
 chat.badge.hidden=chatOpen||chatUnread===0;
 chat.badge.textContent=chatUnread>9?'9+':String(chatUnread);
 if(chatOpen){chatUnread=0;chat.log.scrollTop=chat.log.scrollHeight;}
}
function mountPulsarChat(sidebar){
 CHAT_KEY='graviquest:pulsar:'+active.slug+':history:v2';
 sidebar.classList.add('lab-pulsar-widget');
 var box=node('section','lab-chat');
 var toggle=node('button','lab-chat-head');toggle.type='button';
 toggle.setAttribute('aria-controls','lab-chat-thread');
 var avatar=node('span','lab-chat-avatar');
 var mark=document.createElement('img');
 mark.src='/assets/pulsar-mark.svg';mark.alt='';mark.width=28;mark.height=28;
 avatar.append(mark);
 var name=node('span','lab-chat-name');
 name.append(node('strong','','Pulsar'),node('small','','Scientific companion'));
 var badge=node('span','lab-chat-badge');badge.hidden=true;
 var arrow=node('span','lab-chat-arrow','⌄');
 toggle.append(avatar,name,badge,arrow);
 var body=node('div','lab-chat-body');body.id='lab-chat-thread';
 var log=node('div','lab-chat-log');
 log.setAttribute('role','log');log.setAttribute('aria-label','Pulsar conversation');
 log.setAttribute('aria-live','polite');
 var status=node('div','lab-chat-status','Conversation saved on this device');
 var form=document.createElement('form');form.className='lab-chat-compose';
 var input=node('input','lab-chat-input');
 input.type='text';input.required=true;input.maxLength=600;
 input.placeholder='Ask a question about the science…';
 input.setAttribute('aria-label','Message Pulsar');
 var send=node('button','lab-chat-send','↗');send.type='submit';
 send.setAttribute('aria-label','Send to Pulsar');
 form.append(input,send);
 body.append(log,status,form);box.append(toggle,body);sidebar.append(box);
 chat={box,body,log,status,input,send,toggle,badge};
 try{
   var old=JSON.parse(localStorage.getItem(CHAT_KEY)||'[]');
   if(Array.isArray(old))chatHistory=old.slice(-70).filter(function(m){
     return m&&(m.role==='user'||m.role==='pulsar')&&
       typeof m.text==='string'&&m.text.length<=1800;
   });
 }catch(_){chatHistory=[];}
 chatHistory.forEach(addBubble);
 if(!chatHistory.length){
   addChat('pulsar',active.slug==='directory'?'Tell me what you want to understand. I can help you choose an available Lab and explain what you will learn.':'Change a parameter or ask any question about this Lab. I can explain the model, interpret your current measurements and point to the scientific sources.','guide');
 }
 if(scienceGuide&&active.slug==='science-universe')scienceGuide.mount(body,form,function(recipe){
   addChat('user','Run experiment: '+recipe.title,'guide');
   chat.status.textContent='Comparing two synthetic worlds…';
   tellIframe('lab:experiment',{id:recipe.id});
 });
 chatOpen=!matchMedia('(max-width: 1050px)').matches;
 toggle.addEventListener('click',function(){
   chatOpen=!chatOpen;refreshChat();if(chatOpen)input.focus();
 });
 form.addEventListener('submit',function(e){
   e.preventDefault();var q=input.value.trim();
   if(!q||chatBusy)return;
   input.value='';
   askPulsar(q,'ask');
 });
 refreshChat();
}
function feedback(message,source,citations){
 if(!message)return;
 if(['science-universe','directory'].includes(active?.slug)){addChat('pulsar',message,source,citations);return;}
 if(!speaking||!shell)return;
 shell.line.textContent=String(message).slice(0,480);
 shell.source.textContent=source==='ai'?'Pulsar · live':'Pulsar · guided note';
}
function hintFor(event,section){
  var guidance=active?.config?.guidance||[];
  return guidance.find(function(g){return g.event===event&&(!g.section||g.section===section);})||null;
}
function introFor(section){
  return (active?.config?.sections||[]).find(function(s){return s.id===section;})||null;
}
function renderSteps(){
  if(active?.slug==='science-universe'||!shell)return;
  shell.steps.replaceChildren();
  var steps=active.config.sections||[];
  if(!steps.length){shell.steps.hidden=true;return;}
  shell.steps.hidden=false;
  steps.forEach(function(step,i){
    var b=btn(String(i+1)+' · '+(step.title||step.id),function(){
      currentSection=step.id;
      tellIframe('lab:section',{section:step.id});
      feedback(step.hint||'Explore this section.','script');
      renderSteps();
    },'lab-step');
    b.dataset.current=String(step.id===currentSection);
    shell.steps.append(b);
  });
}
function showMetrics(){
  if(!shell)return;
  var keys=Object.keys(lastMetrics);
  shell.metrics.replaceChildren();
  if(!keys.length){shell.metrics.append(node('p','lab-empty-reading','Metrics will appear when the simulator reports them.'));return;}
  keys.forEach(function(key){
    var m=node('div','lab-metric');
    m.append(node('span','lab-metric-label',key.replace(/[_-]/g,' ')),
      node('strong','lab-metric-value',String(Number(lastMetrics[key].toFixed(3)))));
    shell.metrics.append(m);
  });
}
function showChart(){
  if(!shell||!shell.chart)return;
  shell.chart.replaceChildren();
  var keys=Object.keys(metricHistory);
  if(!keys.length)return;
  var values=(metricHistory[keys[0]]||[]).slice(-38);
  if(values.length<2)return;
  var min=Math.min.apply(null,values),max=Math.max.apply(null,values),span=(max-min)||1;
  var points=values.map(function(v,i){return (12+(i/Math.max(1,values.length-1))*276)+','+(76-((v-min)/span)*60);}).join(' ');
  var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 300 88');svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Recent '+keys[0]+' trend');
  var poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
  poly.setAttribute('points',points);poly.setAttribute('fill','none');
  poly.setAttribute('stroke','currentColor');poly.setAttribute('stroke-width','2');
  svg.append(poly);shell.chart.append(node('small','',keys[0]+' · recent values'),svg);
}
function updateMetrics(incoming){
  lastMetrics=Object.assign({},lastMetrics,numeric(incoming));
  Object.keys(numeric(incoming)).forEach(function(key){
    metricHistory[key]=(metricHistory[key]||[]).concat([lastMetrics[key]]).slice(-48);
  });
  if(active.config.components.includes('metrics'))showMetrics();
  if(active.config.components.includes('charts'))showChart();
}
function reportEvent(data){
 var ev=String(data.event||'').slice(0,64),section=String(data.section||'').slice(0,64);
 if(!validKey.test(ev)||section&&!validKey.test(section))return;
 if(tourActive&&tourUI&&(
   (SCIENCE_TOUR[tourIndex].target==='policy'&&ev==='policy_changed')||
   (SCIENCE_TOUR[tourIndex].target==='fork'&&ev==='universe_forked')||
   (SCIENCE_TOUR[tourIndex].target==='network'&&ev==='collaboration_changed'))){
   tourUI.status.textContent='Action detected. Continue when ready.';
 }
 updateMetrics(data.metrics);
 if(section&&section!==currentSection){currentSection=section;renderSteps();}
 var lesson=hintFor(ev,currentSection),intro=introFor(currentSection);
 if(active?.slug==='science-universe'){
   // Important milestones only, at most one unsolicited message per 90s.
   // No activity ticker, no per-hypothesis/slider message flood.
   var notable=['policy_changed','universe_forked','replication_failed',
     'paper_retracted','replication_requested','world_reset','method_improved','snapshot_saved','scenario_completed'];
   if(!active.config.pulsar_enabled||!active.config.auto_coach||!speaking||
      !notable.includes(ev)||chatBusy||Date.now()-lastCoachAt<18000)return;
   if(ev===lastEventKey&&Date.now()-lastEventAt<18000)return;
   lastEventKey=ev;lastEventAt=Date.now();
   askPulsar('',ev,lesson?.hint||intro?.hint||'');
   return;
 }
 if(lesson?.hint)feedback(lesson.hint,'script');
 else if(intro?.hint&&ev==='section')feedback(intro.hint,'script');
 if(!active.config.pulsar_enabled||!active.config.auto_coach||!speaking)return;
 if(ev===lastEventKey&&Date.now()-lastEventAt<12000)return;
 lastEventKey=ev;lastEventAt=Date.now();
 if(scheduled)clearTimeout(scheduled);
 scheduled=setTimeout(function(){if(Date.now()-lastCoachAt>=20000)askPulsar('',ev);},1500);
}
async function askPulsar(question,event,fallback){
 if(!active||aiBusy||!active.config.pulsar_enabled)return;
 var isChat=['science-universe','directory'].includes(active.slug);
 var q=String(question||'').trim();
 var context=chatHistory.slice(-8).map(function(m){return {
   role:m.role,text:m.text.slice(0,210)
 };});
 if(isChat&&q)addChat('user',q);
 aiBusy=true;chatBusy=isChat;lastCoachAt=Date.now();
 if(isChat&&chat){chat.send.disabled=true;chat.status.textContent='Pulsar is thinking…';}
 if(controller)controller.abort();
 controller=new AbortController();
 var timeout=setTimeout(function(){controller?.abort();},45000);
 var which=session,labSlug=active.slug;
 if(!isChat&&shell?.source)shell.source.textContent='Pulsar · interpreting';
 try{
   var res=await fetch('/api/labs/'+encodeURIComponent(labSlug)+'/coach/',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({event:event||'ask',section:currentSection,question:q,
       metrics:lastMetrics,history:context,context:active.slug==='science-universe'&&scienceGuide?scienceGuide.context():null,
       locale:document.documentElement.lang||'en'}),
     signal:controller.signal,credentials:'same-origin'
   });
   if(!res.ok)throw Error('coaching_unavailable');
   var result=await res.json();
   if(which!==session)return;
   if(result.ok&&result.reply){feedback(result.reply,result.provider==='script'?'script':'ai',result.citations);if(!q&&isChat)showInsight('Pulsar · '+(result.provider==='script'?'guided note':'live explanation'),result.reply,result.citations);}
   else if(fallback)feedback(fallback,'script');
 }catch(err){
   if(which!==session)return;
   if(err.name==='AbortError'){if(isChat)feedback('Pulsar took too long to answer. Please try again.','script');return;}
   if(isChat)feedback(fallback||
     'The live model is unavailable. You can still check Model assumptions and the linked research sources.','script');
   else if(shell?.source)shell.source.textContent='Pulsar · guidance available';
 }finally{
   clearTimeout(timeout);
   if(which===session){
     aiBusy=false;chatBusy=false;
     if(isChat&&chat){
       chat.send.disabled=false;
       chat.status.textContent='Saved on this device · simulation outcomes are synthetic';
     }
   }
 }
}
function configPanel(container,title){
  var section=node('section','lab-ui-panel');
  section.append(node('h3','lab-ui-heading',title));
  var inner=node('div','lab-ui-panel-body');section.append(inner);container.append(section);return inner;
}
function runLab(lab){
  if(!lab||!lab.ready)return;
  tourActive=false;tourUI=null;chat=null;chatHistory=[];chatUnread=0;chatBusy=false;chatOpen=false;
  if(scienceGuide)scienceGuide.reset();
  root.dataset.labSlug = lab.slug;
  if(controller)controller.abort();if(scheduled)clearTimeout(scheduled);
  session++;active=lab;lastCoachAt=0;lastEventKey='';lastEventAt=0;currentSection='';
  metricHistory={};lastMetrics={};speaking=true;aiBusy=false;
  var cfg=lab.config||{};
  cfg.components=Array.isArray(cfg.components)?cfg.components:['stage','controls','metrics'];
  var main=node('div','lab-runtime');
  var bar=node('div','lab-runtime-top');
  var back=btn('All Labs',showCatalog);
  bar.append(back,node('span','lab-runtime-title',lab.title));
  if(lab.topic_slug){
    var link=node('a','lab-topic-link','Related Topic');
    link.href='/topic.html?slug='+encodeURIComponent(lab.topic_slug);
    bar.append(link);
  }
  main.append(bar);
  if(lab.slug==='science-universe'){makeTourUI(main,bar);bar.append(btn('Scientific sources',function(){openKnowledge();}),btn('Scenario atlas',openAtlas));var auto=btn('Pulsar tips on',function(){speaking=!speaking;auto.textContent=speaking?'Pulsar tips on':'Pulsar tips off';});bar.append(auto);}
  if(lab.summary&&lab.slug!=='science-universe')main.append(node('p','lab-runtime-summary',lab.summary));
  var grid=node('div','lab-runtime-grid'),stageCol=node('div','lab-stage-column'),sidebar=node('aside','lab-assistant');
  var canvas=node('div','lab-frame-wrap');
  iframe=node('iframe','lab-frame');iframe.title=lab.title+' · simulation';
  iframe.sandbox='allow-scripts';iframe.referrerPolicy='no-referrer';
  iframe.src=lab.run_url;
  iframe.addEventListener('load',function(){adjustFrameForViewport();focusTour();});
  canvas.append(iframe);stageCol.append(canvas);
  var controls=null,metrics=null,chart=null;
  if(cfg.components.includes('controls'))controls=configPanel(stageCol,'Parameters');
  if(cfg.components.includes('timeline')){
    var timeline=configPanel(stageCol,'Timeline');
    ['play','pause','reset','replay'].forEach(function(command){
      timeline.append(btn(command[0].toUpperCase()+command.slice(1),function(){
        tellIframe('lab:command',{command:command});
      },'lab-command'));
    });
  }
  if(cfg.components.includes('layers'))shellLayerContainer=configPanel(stageCol,'Layers');
  else shellLayerContainer=null;
  if(cfg.components.includes('metrics'))metrics=configPanel(stageCol,'Live measurements');
  if(cfg.components.includes('charts'))chart=configPanel(stageCol,'Trends');
  var compareA=null;
  if(cfg.components.includes('compare')){
    var compare=configPanel(stageCol,'Compare runs');
    var text=node('p','lab-note','Store a measurement snapshot, then change the simulation and compare.');
    compare.append(text,btn('Save A',function(){compareA=Object.assign({},lastMetrics);text.textContent='A saved. Change the conditions, then save B.';}),
      btn('Compare B',function(){
        if(!compareA){text.textContent='Save A first.';return;}
        var changed=Object.keys(lastMetrics).map(function(k){
          var a=compareA[k],b=lastMetrics[k];
          if(typeof a!=='number')return null;
          return k+': '+a.toFixed(2)+' → '+b.toFixed(2)+' ('+(b-a>=0?'+':'')+(b-a).toFixed(2)+')';
        }).filter(Boolean);
        text.textContent=changed.join(' · ')||'No comparable measurements yet.';
      }));
  }
  var source=null,steps=null,speech=null;
  if(lab.slug==='science-universe'){
    mountPulsarChat(sidebar);
  }else{
    source=node('p','lab-pulsar-source','Pulsar · Lab guide');
    var title=node('h2','lab-assistant-title','Pulsar');
    var intro=node('p','lab-assistant-intro','Learn the simulator, explore changes and question results.');
    steps=node('div','lab-guided-steps');
    speech=node('p','lab-assistant-line','Explore this Lab and ask questions.');
    var controlsBar=node('div','lab-assistant-actions');
    var askInput=node('input','lab-ask-input');askInput.type='text';askInput.maxLength=450;
    askInput.placeholder='Ask about this experiment';
    var ask=btn('Ask',function(){
      var q=askInput.value.trim();if(!q)return;askInput.value='';askPulsar(q,'ask');
    });
    askInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'){e.preventDefault();ask.click();}
    });
    controlsBar.append(askInput,ask);
    if(cfg.pulsar_enabled!==false)sidebar.append(title,intro,source,speech,steps,controlsBar);
    else sidebar.append(title,node('p','lab-note','Guidance is not enabled for this Lab.'));
  }
  grid.append(stageCol,sidebar);main.append(grid);root.replaceChildren(main);root.hidden=false;
  shell={line:speech,source:source,steps:steps,metrics:metrics,chart:chart,layers:shellLayerContainer,controls:controls};
  if(steps&&cfg.sections?.length){
    currentSection=cfg.sections[0].id;renderSteps();
    feedback(cfg.sections[0].hint,'script');
  }
  if(metrics)showMetrics();
  if(lab.slug==='science-universe'&&!tourSeen())startTour();
}
var shellLayerContainer=null;
function showCatalog(){
  if(tourActive)tellIframe('lab:tutorial',{target:'off'});
  tourActive=false;tourUI=null;chat=null;chatHistory=[];chatUnread=0;chatBusy=false;
  document.querySelector('.lab-insight')?.remove();
  root.dataset.labSlug='directory';
  if(controller)controller.abort();if(scheduled)clearTimeout(scheduled);
  session++;iframe=null;shell=null;aiBusy=false;
  active={slug:'directory',config:{pulsar_enabled:true,components:[]}};
  history.replaceState(null,'',location.pathname);
  var catalog=node('section','lab-catalog');
  var head=node('div','lab-catalog-head');
  head.append(node('small','lab-card-kicker','LEARN BY CHANGING THE SYSTEM'),node('h2',null,'A question. An experiment. A clearer idea.'),node('p',null,'Choose what you want to understand. Each Lab connects an interactive model to its scientific foundations.'));
  var layout=node('div','lab-discovery-layout'),cards=node('div','lab-catalog-grid');
  labs.forEach(function(lab){
    var card=node('button','lab-catalog-card');card.type='button';
    if(lab.slug==='science-universe'){
      var img=node('img','lab-card-preview');img.src='/assets/thumbnails/science-universe-preview.webp';img.alt='Science Universe simulation: live research network, event log and outcome trends';img.width=720;img.height=480;card.append(img);
    }
    var content=node('span','lab-card-body');
    content.append(node('small','lab-card-kicker',lab.duration_text||'INTERACTIVE EXPERIMENT'),node('strong','lab-card-title',lab.title),node('span','lab-card-summary',lab.summary||'Explore the simulation and change its conditions.'));
    if(lab.slug==='science-universe'){
      var goals=node('span','lab-card-learning');
      goals.append(node('strong','','Your question'),node('span','','Does faster research lead to more reliable knowledge?'),node('strong','','Your experiment'),node('span','','Change AI use, peer review or replication. Follow how the results change.'));
      content.append(goals);
    }
    content.append(node('span','lab-card-open','Explore the science'));card.append(content);
    card.addEventListener('click',function(){previewLab(lab);});cards.append(card);
  });
  var companion=node('aside','lab-assistant lab-directory-assistant');layout.append(cards,companion);
  catalog.append(head,layout);root.replaceChildren(catalog);root.hidden=false;
  mountPulsarChat(companion);chatOpen=true;refreshChat();
}
function modal(title){
 var dialog=node('dialog','lab-science-dialog'),header=node('div','lab-dialog-head');
 dialog.setAttribute('aria-label',title);header.append(node('h2','',title),btn('Close',function(){dialog.close();}));
 dialog.append(header);dialog.addEventListener('close',function(){dialog.remove();});document.body.append(dialog);dialog.showModal();return dialog;
}
function previewLab(lab){
 var dialog=modal(lab.title),body=node('div','lab-science-preview');
 if(lab.slug==='science-universe'){
   var image=node('img','lab-preview-image');image.src='/assets/thumbnails/science-universe-preview.webp';image.alt='Actual Science Universe simulation';body.append(image);
 }
 body.append(node('p','lab-preview-summary',lab.summary));
 var concepts=lab.slug==='science-universe'?[
  ['The scientific idea','More ideas do not automatically produce more reliable discoveries. Statistical power, review queues, selective reporting and independent replication interact.'],
  ['What you can test','Start two worlds from the same checkpoint. Change one policy and compare the live model, event log and outcome trends.'],
  ['How to read the result','A seeded synthetic teaching model. Papers support scientific mechanisms; the model’s numerical policies remain uncalibrated assumptions.']
 ]:[['What you will explore',lab.description||lab.summary],['Learning goal',lab.config?.learning_goal||'Change a condition, observe the result and examine the explanation.']];
 for(var pair of concepts){var section=node('section','lab-preview-concept');section.append(node('h3','',pair[0]),node('p','',pair[1]));body.append(section);}
 var enter=btn('Enter simulation',function(){dialog.close();history.replaceState(null,'','?lab='+encodeURIComponent(lab.slug));runLab(lab);},'lab-enter');
 body.append(enter);dialog.append(body);enter.focus();
}
var lastInsightAt=0,insightTimer=null;
function showInsight(title,text,citations){
 if(!active||active.slug!=='science-universe'||!speaking)return;
 document.querySelector('.lab-insight')?.remove();
 var box=node('aside','lab-insight');box.setAttribute('aria-live','polite');
 box.append(node('strong','',title.slice(0,90)),node('p','',text.slice(0,400)),btn('Explain this',function(){chatOpen=true;refreshChat();askPulsar('Explain this snapshot and what I should try next: '+text.slice(0,240),'ask');box.remove();}),btn('Dismiss',function(){box.remove();}));
 document.body.append(box);clearTimeout(insightTimer);insightTimer=setTimeout(function(){box.remove();},16000);
}
async function openKnowledge(documentSlug,anchor){
 if(!active||active.slug!=='science-universe')return;
 var dialog=modal('Scientific sources'),content=node('div','lab-knowledge-reader','Loading sources…');dialog.append(content);
 try{
  var res=await fetch('/api/labs/science-universe/knowledge/'+(documentSlug?encodeURIComponent(documentSlug)+'/':''),{credentials:'same-origin'});
  if(!res.ok)throw Error('Sources are unavailable');var data=await res.json();content.replaceChildren();
  if(!documentSlug){
   (data.documents||[]).forEach(function(doc){var section=node('section','lab-source-card');section.append(node('h3','',doc.title),node('p','',doc.kind==='reading_note'?'Original reading note; full paper at the source.':'Stored Markdown · '+doc.sections.length+' sections'),btn('Read sections',function(){dialog.close();openKnowledge(doc.slug);}));content.append(section);});return;
  }
  var doc=data.document;
  content.append(node('p','lab-note',doc.license));
  var download=node('a','lab-download','Download Markdown');download.href='/api/labs/science-universe/knowledge/'+encodeURIComponent(doc.slug)+'/?format=md';content.append(download);
  if(doc.source_url?.startsWith('https://')){var original=node('a','lab-download','Original source');original.href=doc.source_url;original.target='_blank';original.rel='noopener noreferrer';content.append(original);}
  var toc=node('nav','lab-source-toc');toc.setAttribute('aria-label','Article sections');
  doc.sections.forEach(function(section){toc.append(btn(section.title,function(){content.querySelector('[data-anchor="'+section.anchor+'"]')?.scrollIntoView({block:'start'});}));});content.append(toc);
  doc.sections.forEach(function(section){var part=node('section','lab-article-section');part.dataset.anchor=section.anchor;part.append(node('h3','',section.title),node('pre','lab-markdown-text',section.text.replace(/^#{1,4} .+\n?/,'')));content.append(part);});
  if(anchor)requestAnimationFrame(function(){content.querySelector('[data-anchor="'+anchor+'"]')?.scrollIntoView({block:'start'});});
 }catch(err){content.textContent=err.message;}
}
var POLICY_LABELS={generation:'Hypothesis generation',verification:'Peer review capacity',replication:'Replication capacity',funding:'Research funding',aiAdoption:'AI-assisted generation',alpha:'Statistical leniency',sampleSize:'Sample size',transparency:'Open methods',diversity:'Exploration diversity',pressure:'Publication pressure',network:'Knowledge diffusion',uncertainty:'AI abstention'};
function scenarioLabel(family){
 var parts=String(family||'').split(':');
 if(parts[0]==='baseline')return 'Baseline conditions';
 if(parts[0]==='design_sensitivity')return 'Population and prior assumptions';
 return (parts[0]==='single'?'One parameter · ':'Two parameters · ')+parts.slice(1).map(function(k){return POLICY_LABELS[k]||k;}).join(' / ');
}
async function openAtlas(){
 if(!active||active.slug!=='science-universe')return;
 var dialog=modal('Scenario atlas'),content=node('div','lab-atlas','Loading executed model scenarios…');dialog.append(content);
 try{
  var res=await fetch('/api/labs/science-universe/scenarios/',{credentials:'same-origin'});if(!res.ok)throw Error('Scenario atlas unavailable');var data=await res.json();content.replaceChildren();
  content.append(node('p','',data.runs_for_current_engine+' executed runs for this engine. '+Number(data.policy_combinations).toLocaleString()+' possible policy combinations. Coverage is sampled.'),node('p','lab-note',data.limits+' A seed reproduces the same random draws when all settings and interventions match.'));
  var form=node('div','lab-atlas-filter'),select=node('select');select.setAttribute('aria-label','Scenario family');
  [ ['','All sampled families'] ].concat((data.families||[]).map(function(f){return [f,scenarioLabel(f)];})).forEach(function(pair){var o=node('option','',pair[1]);o.value=pair[0];select.append(o);});
  var list=node('div','lab-atlas-runs'),more=btn('More scenarios',function(){load(false);});var offset=0;
  async function load(reset){if(reset){offset=0;list.replaceChildren();}more.disabled=true;
    try{var r=await fetch('/api/labs/science-universe/scenarios/?family='+encodeURIComponent(select.value)+'&offset='+offset);if(!r.ok)throw Error('Could not load scenarios');var page=await r.json();
    (page.examples||[]).forEach(function(row){var card=node('details','lab-atlas-run');card.append(node('summary','',scenarioLabel(row.family)+' · seed '+row.seed+' · '+row.days+' model days'),node('p','',row.result.published+' published · '+row.result.falsePublished+' false live claims · '+row.result.reviewBacklog+' awaiting review'));
      card.append(node('p','lab-note','Policy settings (1–10): '+Object.keys(row.parameters).map(function(k){return (POLICY_LABELS[k]||k)+' '+row.parameters[k];}).join(' · ')));
      var design=row.design||{};card.append(node('p','lab-note',(design.labsPerDomain*4)+' laboratories · '+design.agentsMin+'–'+design.agentsMax+' agents per laboratory · '+Math.round(design.aiRoleFraction*100)+'% AI roles · truth prior '+(design.truthPriorOverride==null?'field-specific assumptions':Math.round(design.truthPriorOverride*100)+'% across fields')));
      card.append(node('p','lab-note',row.result.tested+' tested studies · '+row.result.replicated+' independent repeats · '+row.result.retracted+' withdrawals · '+row.result.crossFieldPublished+' cross-field live papers'));list.append(card);});offset=page.next_offset;more.hidden=offset===null;
    }catch(e){list.append(node('p','',e.message));}finally{more.disabled=false;}}
  select.addEventListener('change',function(){load(true);});form.append(select);content.append(form,list,more);await load(true);
 }catch(err){content.textContent=err.message;}
}
async function saveSnapshot(seed){
 var state=scienceGuide?.context();if(!state)return;
 try{var saved=JSON.parse(localStorage.getItem('graviquest:lab:snapshots:v1')||'[]');saved.push({at:Date.now(),seed:seed,context:state});localStorage.setItem('graviquest:lab:snapshots:v1',JSON.stringify(saved.slice(-30)));}catch(_){}
 addChat('pulsar','Day '+state.day+' · '+state.world+' snapshot: '+(state.metrics.published||0)+' published; '+(state.metrics.falsePublished||0)+' false live claims; '+(state.metrics.reviewBacklog||0)+' awaiting review; '+(state.metrics.replicated||0)+' independent repeats.','guide');
 function csrfCookie(){return (document.cookie.match(/(?:^|; )(?:csrftoken|gravitas_staging_csrftoken)=([^;]*)/)||[])[1]||'';}
 var csrf=csrfCookie();if(!csrf){try{await fetch('/api/auth/csrf/',{credentials:'same-origin'});csrf=csrfCookie();}catch(_){}}
 try{var r=await fetch('/api/labs/science-universe/snapshots/',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRFToken':decodeURIComponent(csrf)},body:JSON.stringify({seed:seed,context:state})});
  if(r.status===401){addChat('pulsar','Snapshot captured on this device. Sign in to save it to your account.','guide');return;}
  if(!r.ok)throw Error('Snapshot could not be saved to your account.');var result=await r.json();addChat('pulsar','Snapshot #'+result.id+' saved. These are browser-reported model measurements. Ask me what changed or why.','guide');
 }catch(e){addChat('pulsar',e.message,'guide');}
}
window.addEventListener('message',function(e){
  if(!active||!iframe||e.source!==iframe.contentWindow||e.origin!=='null')return;
  var data=e.data;if(!data||data.schema!==protocol||typeof data.type!=='string')return;
  if(data.type==='lab:resize'){
    if(active.slug==='science-universe')return;
    if(!mobileLabFrame())return;
    var height=Number(data.height);
    // Ignore malformed or unreasonable dimensions from untrusted Lab code.
    if(!Number.isFinite(height)||height<300||height>12000)return;
    var next=Math.ceil(height), current=parseInt(iframe.style.height,10)||0;
    if(Math.abs(current-next)>3)iframe.style.height=next+'px';
    return;
  }
  if(data.type==='lab:tutorial:done'){
    if(tourActive&&tourUI&&data.target===SCIENCE_TOUR[tourIndex].target)
      tourUI.status.textContent='Action detected. Continue when ready.';
    return;
  }
  if(data.type==='lab:tutorial:position'){
    if(!tourActive||!mobileLabFrame()||data.target!==SCIENCE_TOUR[tourIndex].target)return;
    var offset=Number(data.top);
    if(!Number.isFinite(offset)||offset<0||offset>12000)return;
    var place=window.scrollY+iframe.getBoundingClientRect().top+offset-
      Math.min(window.innerHeight*.42,355);
    window.scrollTo({top:Math.max(0,place),behavior:'smooth'});
    return;
  }
  if(active.slug==='science-universe'&&data.type==='lab:open-atlas'){openAtlas();return;}
  if(active.slug==='science-universe'&&data.type==='lab:save-snapshot'){saveSnapshot(data.seed);return;}
  if(active.slug==='science-universe'&&data.type==='lab:note'){
    if(speaking&&data.note&&Date.now()-lastInsightAt>18000){showInsight(String(data.note.title||'Model snapshot'),String(data.note.text||''));lastInsightAt=Date.now();}return;
  }
  if(active.slug==='science-universe'&&data.type==='lab:context'){
    if(scienceGuide)scienceGuide.context(data.context);
    return;
  }
  if(active.slug==='science-universe'&&data.type==='lab:experiment:result'){
    var explanation=scienceGuide?scienceGuide.result(data.result):null;
    if(explanation){addChat('pulsar',explanation,'guide');saveSnapshot(data.result?.seed);askPulsar('Explain the mechanism in this completed model comparison: '+explanation.slice(0,390),'ask');}
    if(chat)chat.status.textContent=explanation?
      'Experiment complete · inspect World A/B in the simulator.':'Scenario result unavailable.';
    return;
  }
  if(data.type==='lab:event')reportEvent(data);
  if(data.type==='lab:ready'){
    if(data.section&&validKey.test(data.section)){currentSection=data.section;renderSteps();}
    if(shell?.layers&&Array.isArray(data.layers)){
      shell.layers.replaceChildren();
      data.layers.slice(0,24).forEach(function(layer){
        if(!validKey.test(String(layer.key||'')))return;
        var label=node('label','lab-dynamic-control');
        var toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=layer.enabled!==false;
        toggle.addEventListener('change',function(){tellIframe('lab:layer',{key:layer.key,enabled:toggle.checked});});
        label.append(toggle,node('span',null,String(layer.label||layer.key).slice(0,80)));
        shell.layers.append(label);
      });
    }
    if(shell?.controls&&Array.isArray(data.controls)){
      shell.controls.replaceChildren();
      data.controls.slice(0,24).forEach(function(ctrl){
        if(!validKey.test(String(ctrl.key||'')))return;
        var min=Number(ctrl.min),max=Number(ctrl.max),step=Number(ctrl.step);
        if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min)return;
        var line=node('label','lab-dynamic-control');
        var text=node('span','',String(ctrl.label||ctrl.key).slice(0,80));
        var number=node('output','',String(ctrl.value||min));
        var slider=document.createElement('input');slider.type='range';slider.min=String(min);
        slider.max=String(max);slider.step=String(step>0?step:1);
        slider.value=String(Number(ctrl.value)||min);
        slider.addEventListener('input',function(){
          number.value=slider.value;number.textContent=slider.value;
          tellIframe('lab:control',{key:ctrl.key,value:Number(slider.value)});
        });
        line.append(text,slider,number);shell.controls.append(line);
      });
    }
  }
});
var labs=[];
fetch('/api/labs/',{credentials:'same-origin',cache:'no-store'})
  .then(function(res){if(!res.ok)throw Error('registry unavailable');return res.json();})
  .then(function(payload){
    labs=(Array.isArray(payload.labs)?payload.labs:[]).filter(function(l){return l.ready;});
    if(!labs.length)return; // Intentionally EMPTY until first explicit publication.
    var slug=new URLSearchParams(location.search).get('lab');
    var requested=labs.find(function(l){return l.slug===slug;});
    if(requested){showCatalog();previewLab(requested);}else showCatalog();
  }).catch(function(){ /* Silence is intentional on an unpublished surface. */ });
})();
