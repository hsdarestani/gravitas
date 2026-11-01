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
var requestSequence=0;
var chat=null,chatHistory=[],chatUnread=0,chatBusy=false,chatOpen=false;
var notices=[],chatSequence=0,fullscreenButton=null,companionGeometry=null;
function enteredLab(slug){try{return sessionStorage.getItem('graviquest:lab:entered:'+slug)==='yes';}catch(_){return false;}}
function positionCompanion(){
 if(!chat||active?.slug!=='science-universe')return;
 const widget=chat.box.closest('.lab-pulsar-widget'),frame=iframe?.getBoundingClientRect(),g=companionGeometry;
 if(!widget||!frame)return;
 widget.classList.remove('is-docked');widget.style.cssText='';
 if(!g||g.viewportWidth<=900||g.width<250)return;
 // Once the reader scrolls the dock out of view, Pulsar returns to the corner
 // instead of pinning itself over whatever has scrolled under the header.
 const dock=frame.top+g.dockTop;
 if(dock<frame.top+12||dock>innerHeight-84)return;
 const left=Math.max(12,Math.min(innerWidth-g.width-12,frame.left+g.left));
 let top=chatOpen?Math.max(frame.top+12,frame.top+g.top):Math.max(frame.top+12,Math.min(innerHeight-84,frame.top+g.dockTop));
 const bottom=Math.min(innerHeight-12,frame.top+g.top+g.height),height=Math.max(250,bottom-top);
 if(chatOpen&&top>innerHeight-280)top=Math.max(frame.top+12,innerHeight-Math.min(g.height,600)-12);
 widget.style.left=left+'px';widget.style.top=top+'px';widget.style.bottom='auto';widget.style.right='auto';widget.style.width=Math.min(g.width,innerWidth-24)+'px';
 widget.style.setProperty('--companion-height',Math.min(innerHeight-top-12,Math.max(250,height))+'px');widget.classList.add('is-docked');
}
window.addEventListener('resize',positionCompanion,{passive:true});
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
  {target:'map',title:'Read one claim at a time',
   description:'Knowledge flow arranges published claims in rows by field and publication time. Select one dot to reveal its recorded citations. Dot color describes independent repeat tests.',
   task:'Open Visual guide for an illustrated key, then try Knowledge flow. Gold: not repeated; green: passed repeats; orange: a failed repeat.'},
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
// Interface marks from the brand set (assets/gravitas-icons.js), inlined because
// this script also runs on pages that do not load the icon module. Typographic
// stand-ins (↗, ×) rendered at whatever weight the font supplied.
var ICONS={
  arrow:'<g transform="translate(-0.406 -0.406) scale(1.033855)" stroke-width="1.644"><path d="M3.4 12h17.2"/><path d="m14.2 5.6 6.4 6.4-6.4 6.4"/></g>',
  close:'<g transform="translate(-3.700 -3.704) scale(1.313744)" stroke-width="1.294"><path d="m5.2 5.2 13.6 13.6"/><path d="m18.8 5.2-13.6 13.6"/></g>',
  chevronUp:'<g transform="rotate(-90 12 12) translate(-3.054 -2.465) scale(1.209200)" stroke-width="1.406"><path d="m9 4.6 7.4 7.4L9 19.4"/></g>',
  pulsar:'<g transform="translate(3.3 3.3) scale(0.174)" fill="currentColor" stroke="none"><path d="M0,50v-20.2c16.46,0,29.8-13.34,29.8-29.8h20.2c0,27.62-22.38,50-50,50Z"/><path d="M50,100h-20.2c0-16.46-13.34-29.8-29.8-29.8v-20.2c27.62,0,50,22.38,50,50Z"/><path d="M100,50c-27.62,0-50-22.38-50-50h20.2c0,16.46,13.34,29.8,29.8,29.8v20.2Z"/><path d="M70.2,100h-20.2c0-27.62,22.38-50,50-50v20.2c-16.46,0-29.8,13.34-29.8,29.8Z"/><circle cx="50" cy="50" r="10.1"/></g>'
};
function icon(name){
  return '<svg class="g-ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'+ICONS[name]+'</svg>';
}
function siteTheme(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';}
// The Lab follows the header's theme control while it runs (lab-bridge.js).
new MutationObserver(function(){tellIframe('lab:theme',{theme:siteTheme()});})
  .observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
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
document.addEventListener('fullscreenchange',function(){
 if(fullscreenButton){
  fullscreenButton.textContent=document.fullscreenElement?'Exit fullscreen':'Fullscreen';
  fullscreenButton.setAttribute('aria-pressed',String(!!document.fullscreenElement));
 }
});
document.addEventListener('keydown',function(e){
 if(e.key==='Escape'&&active?.slug==='science-universe'&&chatOpen&&!document.querySelector('dialog[open]')){
  e.preventDefault();chatOpen=false;refreshChat();chat?.toggle.focus();
 }
});
function saveChat(){
 try{localStorage.setItem(CHAT_KEY,JSON.stringify(chatHistory.slice(-70)));}catch(_){}
}
function messageText(m){
 var text=m.text;
 // Source buttons carry the complete citation; keep long source URLs out of prose.
 text=text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,function(all,label,url){
  var cited=(m.citations||[]).find(function(c){return c.id===label||c.source_url===url;});
  return cited?(cited.id===label?'['+((m.citations||[]).indexOf(cited)+1)+']':label):all;
 });
 (m.citations||[]).forEach(function(c,i){if(c.id)text=text.split('['+c.id+']').join('['+(i+1)+']');});
 return text.replace(/  +/g,' ').trim();
}
function clearNotices(){
 notices.forEach(function(n){clearTimeout(n.timer);clearTimeout(n.removal);n.box.remove();});
 notices=[];
}
function positionNotices(){
 notices.forEach(function(n,i){n.box.style.setProperty('--notice-slot',String(notices.length-i-1));});
}
function removeNotice(n,immediate){
 clearTimeout(n.timer);clearTimeout(n.removal);
 function remove(){n.box.remove();notices=notices.filter(function(x){return x!==n;});positionNotices();}
 if(immediate){remove();return;}
 n.box.classList.add('is-leaving');n.removal=setTimeout(remove,300);
}
function openPulsarMessage(m){
 if(!chat)return;
 chatOpen=true;refreshChat();
 var row=Array.from(chat.log.children).find(function(el){return el.dataset.messageId===m.id;});
 if(row){row.focus({preventScroll:true});row.scrollIntoView({block:'center'});}
 else chat.input.focus();
}
function notifyPulsar(m){
 if(!chat?.notices||chatOpen)return;
 while(notices.length>=3)removeNotice(notices[0],true);
 var box=node('div','lab-pulsar-notice'),read=node('button','lab-notice-read');read.type='button';
 read.setAttribute('aria-label','Read Pulsar message and open conversation');
 var title=m.title||('Pulsar · '+(m.provider==='ai'?'live explanation':'guided note'));
 var text=messageText(m).replace(/\s+/g,' ');
 var preview=node('span','',text.length>170?text.slice(0,167)+'…':text);preview.dir='auto';
 read.append(node('strong','',title),preview,node('small','','Open conversation'));
 read.addEventListener('click',function(){openPulsarMessage(m);});
 var close=node('button','lab-notice-dismiss');close.type='button';close.innerHTML=icon('close');
 close.setAttribute('aria-label','Dismiss Pulsar notification');
 var n={box:box,timer:null,removal:null,remaining:9000,deadline:0};
 function pause(){clearTimeout(n.timer);n.remaining=Math.max(0,n.deadline-Date.now());}
 function resume(){if(!box.isConnected||box.classList.contains('is-leaving')||box.contains(document.activeElement)||box.matches(':hover'))return;n.deadline=Date.now()+n.remaining;n.timer=setTimeout(function(){removeNotice(n);},n.remaining);}
 close.addEventListener('click',function(){removeNotice(n);});
 box.addEventListener('pointerenter',pause);box.addEventListener('pointerleave',resume);
 box.addEventListener('focusin',pause);box.addEventListener('focusout',function(e){if(!box.contains(e.relatedTarget))resume();});
 box.append(read,close);chat.notices.append(box);notices.push(n);positionNotices();
 requestAnimationFrame(function(){if(box.isConnected)box.classList.add('is-visible');});
 n.deadline=Date.now()+n.remaining;n.timer=setTimeout(function(){removeNotice(n);},n.remaining);
}
function addChat(role,text,provider,citations,title){
 var value=String(text||'').trim().slice(0,1800);
 if(!value)return;
 var m={id:Date.now().toString(36)+'-'+(++chatSequence),role:role==='user'?'user':'pulsar',text:value,title:title||'',
   provider:provider==='ai'?'ai':'guide',citations:Array.isArray(citations)?citations.slice(0,6):[],at:Date.now()};
 chatHistory.push(m);chatHistory=chatHistory.slice(-70);saveChat();
 if(chat){
   addBubble(m);
   if(!chatOpen&&m.role==='pulsar'){chatUnread++;refreshChat();notifyPulsar(m);}
 }
}
function addBubble(m){
 if(!chat)return;
 var row=node('div','lab-chat-bubble '+(m.role==='user'?'is-user':'is-pulsar'));
 if(!m.id)m.id='restored-'+(++chatSequence);
 row.dataset.messageId=m.id;row.tabIndex=-1;
 var p=node('p','',messageText(m));p.dir='auto';
 var date=new Date(Number(m.at)||Date.now());
 var stamp=date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
 var meta=node('small','lab-chat-meta',stamp+(m.role==='pulsar'?
     ' · '+(m.provider==='ai'?'Pulsar · live':'Guided note'):''));
 if(m.title)row.append(node('strong','lab-chat-message-title',String(m.title).slice(0,100)));
 row.append(p);
 (m.citations||[]).forEach(function(c,i){
  if(!/^[a-z0-9-]+$/.test(c.document||'')||!/^[a-z0-9-]+$/.test(c.anchor||''))return;
  row.append(btn('['+(i+1)+'] '+(c.section||c.title),function(){openKnowledge(c.document,c.anchor);},'lab-source-ref'));
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
 chat.toggle.setAttribute('aria-label',chatOpen?'Close Pulsar conversation':'Open Pulsar conversation'+(chatUnread?' · '+chatUnread+' unread':''));
 chat.arrow.innerHTML=icon(chatOpen?'close':'chevronUp');
 chat.log.setAttribute('aria-live',chatOpen?'polite':'off');
 chat.badge.hidden=chatOpen||chatUnread===0;
 chat.badge.textContent=chatUnread>9?'9+':String(chatUnread);
 if(chatOpen){chatUnread=0;clearNotices();chat.log.scrollTop=chat.log.scrollHeight;}
 positionCompanion();
}
// Pulsar stays invisible until the simulator has said where its dock is.
// Shown at once, it sat in the window's corner for the moment before the
// frame loaded and then jumped into place.
function revealCompanion(){
 var widget=chat?.box.closest('.lab-pulsar-widget');
 if(widget)widget.classList.remove('is-pending');
}
function mountPulsarChat(sidebar){
 CHAT_KEY='graviquest:pulsar:'+active.slug+':history:v2';
 sidebar.classList.add('lab-pulsar-widget');
 if(active.slug==='science-universe')sidebar.classList.add('is-pending');
 var box=node('section','lab-chat');
 var toggle=node('button','lab-chat-head');toggle.type='button';
 toggle.setAttribute('aria-controls','lab-chat-thread');
 var avatar=node('span','lab-chat-avatar');avatar.innerHTML=icon('pulsar');
 var name=node('span','lab-chat-name');
 name.append(node('strong','','Pulsar'),node('small','','Make sense of what you see'));
 var badge=node('span','lab-chat-badge');badge.hidden=true;
 var arrow=node('span','lab-chat-arrow');arrow.setAttribute('aria-hidden','true');
 toggle.append(avatar,name,badge,arrow);
 var body=node('div','lab-chat-body');body.id='lab-chat-thread';
 var log=node('div','lab-chat-log');
 log.setAttribute('role','log');log.setAttribute('aria-label','Pulsar conversation');
 log.setAttribute('aria-live','polite');
 var observation=node('div','lab-chat-observation','Your scientific companion');
 var starters=node('div','lab-chat-starters');
 if(active.slug==='science-universe'){
  [['Explain this result','Explain the current result in plain language: what changed, why might it have changed, and what should I watch next?'],['Suggest an experiment','Help me choose one policy change for a useful controlled experiment in this Lab.']].forEach(function(pair){starters.append(btn(pair[0],function(){askPulsar(pair[1],'ask');}));});
 }
 var status=node('div','lab-chat-status','Conversation saved on this device');
 var form=document.createElement('form');form.className='lab-chat-compose';
 var input=node('input','lab-chat-input');
 input.type='text';input.required=true;input.maxLength=600;input.dir='auto';
 input.placeholder='Ask a question about the science…';
 input.setAttribute('aria-label','Message Pulsar');
 var send=node('button','lab-chat-send');send.type='submit';send.innerHTML=icon('arrow');
 send.setAttribute('aria-label','Send to Pulsar');
 form.append(input,send);
 var noticeStack=null;
 if(active.slug==='science-universe'){
  noticeStack=node('div','lab-pulsar-notices');noticeStack.setAttribute('role','log');
  noticeStack.setAttribute('aria-label','Pulsar notifications');noticeStack.setAttribute('aria-live','polite');
  sidebar.append(noticeStack);
 }
 var tools=node('div','lab-chat-tools');
 if(active.slug==='science-universe'){var tips=btn('Tips on',function(){speaking=!speaking;tips.textContent=speaking?'Tips on':'Tips off';tips.setAttribute('aria-pressed',String(speaking));if(!speaking)clearNotices();},'lab-tips-toggle');tips.setAttribute('aria-pressed','true');tools.append(observation,tips);}
 body.append(tools,starters,log,status,form);box.append(toggle,body);sidebar.append(box);
 chat={box,body,log,status,input,send,toggle,badge,arrow,observation,notices:noticeStack};
 chatOpen=active.slug!=='science-universe';
 try{
   var old=JSON.parse(localStorage.getItem(CHAT_KEY)||'[]');
   if(Array.isArray(old))chatHistory=old.slice(-70).filter(function(m){
     return m&&(m.role==='user'||m.role==='pulsar')&&
       typeof m.text==='string'&&m.text.length<=1800;
   });
 }catch(_){chatHistory=[];}
 chatHistory.forEach(addBubble);
 if(!chatHistory.length){
   addChat('pulsar',active.slug==='directory'?'Tell me what you want to understand. I can help you choose an available Lab and explain what you will learn.':'What would you like to understand? Choose a lab, change one policy, or ask me about the science. We can follow what changes and work through why.','guide');
 }
 if(scienceGuide&&active.slug==='science-universe')scienceGuide.mount(body,form,function(recipe){
   addChat('user','Run experiment: '+recipe.title,'guide');
   chat.status.textContent='Comparing two synthetic worlds…';
   tellIframe('lab:experiment',{id:recipe.id});
 });
 toggle.addEventListener('click',function(){
   chatOpen=!chatOpen;if(chatOpen)tellIframe('lab:section',{section:'companion'});refreshChat();if(chatOpen)input.focus();
 });
 form.addEventListener('submit',function(e){
   e.preventDefault();var q=input.value.trim();
   if(!q||chatBusy)return;
   input.value='';
   askPulsar(q,'ask');
 });
 refreshChat();
}
function feedback(message,source,citations,title){
 if(!message)return;
 if(['science-universe','directory'].includes(active?.slug)){addChat('pulsar',message,source,citations,title);return;}
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
   // Important milestones only, at most one unsolicited message per 18s.
   // No activity ticker, no per-hypothesis/slider message flood.
   var notable=['policy_changed','universe_forked','replication_failed',
     'paper_retracted','replication_requested','world_reset','method_improved','snapshot_saved','scenario_completed'];
   if(!active.config.pulsar_enabled||!active.config.auto_coach||!speaking||!notable.includes(ev)||chatBusy)return;
   if(ev==='policy_changed'){
    clearTimeout(scheduled);
    scheduled=setTimeout(function(){if(speaking&&!chatBusy)askPulsar('',ev,lesson?.hint||intro?.hint||'');},Math.max(850,18000-(Date.now()-lastCoachAt)));
    return;
   }
   if(Date.now()-lastCoachAt<18000)return;
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
 var q=String(question||'').trim();
 if(!active||!active.config.pulsar_enabled||(aiBusy&&(!q||chatBusy)))return;
 var isChat=['science-universe','directory'].includes(active.slug);
 var observed=active.slug==='science-universe'&&scienceGuide?scienceGuide.context():null;
 var context=chatHistory.slice(-8).map(function(m){return {
   role:m.role,text:m.text.slice(0,210)
 };});
 if(isChat&&q)addChat('user',q);
 aiBusy=true;chatBusy=isChat&&!!q;lastCoachAt=Date.now();
 if(isChat&&chat){chat.send.disabled=chatBusy;chat.status.textContent='Pulsar is thinking…';}
 if(controller)controller.abort();
 controller=new AbortController();
 var thisController=controller,request=++requestSequence;
 var timeout=setTimeout(function(){thisController.abort();},45000);
 var which=session,labSlug=active.slug;
 if(!isChat&&shell?.source)shell.source.textContent='Pulsar · interpreting';
 try{
   var res=await fetch('/api/labs/'+encodeURIComponent(labSlug)+'/coach/',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({event:event||'ask',section:currentSection,question:q,
       metrics:lastMetrics,history:context,context:observed,
       locale:document.documentElement.lang||'en'}),
     signal:thisController.signal,credentials:'same-origin'
   });
   if(!res.ok)throw Error('coaching_unavailable');
   var result=await res.json();
   if(which!==session||request!==requestSequence)return;
   if(!q&&event==='policy_changed'&&observed&&JSON.stringify(observed.policies)!==JSON.stringify(scienceGuide?.context()?.policies))return;
   var observation=result.observation||observed;
   var title=observation&&Number.isFinite(observation.day)?'Pulsar · World '+observation.world+' · day '+observation.day:'';
   if(result.ok&&result.reply){feedback(result.reply,result.provider==='script'?'script':'ai',result.citations,title);}
   else if(fallback)feedback(fallback,'script');
 }catch(err){
   if(which!==session||request!==requestSequence)return;
   if(err.name==='AbortError'){if(isChat)feedback('Pulsar took too long to answer. Please try again.','script');return;}
   if(isChat)feedback(fallback||
     'The live model is unavailable. You can still check Model assumptions and the linked research sources.','script');
   else if(shell?.source)shell.source.textContent='Pulsar · guidance available';
 }finally{
   clearTimeout(timeout);
   if(which===session&&request===requestSequence){
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
  clearNotices();lastInsightAt=0;companionGeometry=null;
  try{sessionStorage.setItem('graviquest:lab:entered:'+lab.slug,'yes');}catch(_){}
  tourActive=false;tourUI=null;chat=null;chatHistory=[];chatUnread=0;chatBusy=false;chatOpen=false;
  if(scienceGuide)scienceGuide.reset();
  root.dataset.labSlug = lab.slug;
  root.classList.remove('is-editing-policy','is-sim-modal');
  root.setAttribute('aria-live','off');
  if(controller)controller.abort();if(scheduled)clearTimeout(scheduled);
  session++;active=lab;lastCoachAt=0;lastEventKey='';lastEventAt=0;currentSection='';
  metricHistory={};lastMetrics={};speaking=true;aiBusy=false;
  var cfg=lab.config||{};
  cfg.components=Array.isArray(cfg.components)?cfg.components:['stage','controls','metrics'];
  var main=node('div','lab-runtime');
  var bar=node('div','lab-runtime-top');
  var back=btn('Back to Labs',showCatalog);
  bar.append(back,node('span','lab-runtime-title',lab.title));
  if(lab.topic_slug){
    var link=node('a','lab-topic-link','Related Topic');
    link.href='/topic.html?slug='+encodeURIComponent(lab.topic_slug);
    bar.append(link);
  }
  main.append(bar);
  if(lab.slug==='science-universe'){
   makeTourUI(main,bar);
   if(document.fullscreenEnabled){
    fullscreenButton=btn('Fullscreen',async function(){
     try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
     catch(_){fullscreenButton.title='Browser fullscreen is unavailable. The Lab still fills this window.';}
    },'lab-fullscreen');fullscreenButton.setAttribute('aria-pressed','false');bar.append(fullscreenButton);
   }
  }
  if(lab.summary&&lab.slug!=='science-universe')main.append(node('p','lab-runtime-summary',lab.summary));
  var grid=node('div','lab-runtime-grid'),stageCol=node('div','lab-stage-column'),sidebar=node('aside','lab-assistant');
  var canvas=node('div','lab-frame-wrap');
  iframe=node('iframe','lab-frame');iframe.title=lab.title+' · simulation';
  iframe.sandbox='allow-scripts';iframe.referrerPolicy='no-referrer';
  // The fragment never reaches the server; lab-bridge.js reads it before first paint.
  iframe.src=lab.run_url+'#theme='+siteTheme();
  canvas.classList.add('is-loading');
  iframe.addEventListener('load',function(){
    canvas.classList.remove('is-loading');adjustFrameForViewport();focusTour();
    // The simulator reports its dock as soon as it lays out; this only covers
    // a Lab that never does, so Pulsar cannot stay hidden.
    var current=session;setTimeout(function(){if(current===session)revealCompanion();},1500);
  });
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
  clearNotices();fullscreenButton=null;
  if(active?.slug==='science-universe'&&document.fullscreenElement)document.exitFullscreen().catch(function(){});
  tourActive=false;tourUI=null;chat=null;chatHistory=[];chatUnread=0;chatBusy=false;
  companionGeometry=null;root.dataset.labSlug='directory';
  root.setAttribute('aria-live','off');
  if(controller)controller.abort();if(scheduled)clearTimeout(scheduled);
  session++;iframe=null;shell=null;aiBusy=false;
  active={slug:'directory',config:{pulsar_enabled:true,components:[]}};
  history.replaceState(null,'',location.pathname);
  // The page head already says Lab; a published catalog adds only its lead.
  // Pulsar is the site-wide launcher here (chat.js), as on every other page.
  var headInner=document.querySelector('.page-head .g-container');
  if(headInner&&!headInner.querySelector('.lab-lead'))
    headInner.append(node('p','g-lead lab-lead','Interactive models you can change and question. Each Lab is tied to the scientific sources behind it.'));
  var catalog=node('section','g-section lab-catalog'),wrap=node('div','g-container'),cards=node('div','g-grid g-grid--2 lab-catalog-grid');
  labs.forEach(function(lab){
    var card=node('a','g-card g-card--interactive lab-catalog-card');
    card.href='?lab='+encodeURIComponent(lab.slug);
    if(lab.slug==='science-universe'){
      var media=node('span','lab-card-media');media.append.apply(media,scienceThumbs(''));card.append(media);
    }
    var body=node('span','lab-card-body'),meta=node('span','lab-card-meta');
    meta.append(node('span','g-eyebrow g-eyebrow--bare','Interactive model'));
    if(lab.duration_text)meta.append(node('span','lab-card-time',lab.duration_text));
    body.append(meta,node('h2','lab-card-title',lab.title),node('p','lab-card-summary',lab.summary||'Explore the simulation and change its conditions.'));
    if(lab.slug==='science-universe'){
      var question=node('p','lab-card-question');
      question.append(node('span','','The question'),document.createTextNode('Does faster research lead to more reliable knowledge?'));
      body.append(question);
    }
    var cta=node('span','lab-card-cta');cta.innerHTML='<span>Preview the Lab</span>'+icon('arrow');body.append(cta);
    card.append(body);
    card.addEventListener('click',function(e){
      if(e.metaKey||e.ctrlKey||e.shiftKey||e.button!==0)return;
      e.preventDefault();previewLab(lab);
    });
    cards.append(card);
  });
  wrap.append(cards);catalog.append(wrap);root.replaceChildren(catalog);root.hidden=false;
}
// One capture per theme; the stylesheet shows the one matching the header's
// control, so flipping the theme never leaves a dark picture on a light card.
function scienceThumbs(alt,cls){
  return ['','-light'].map(function(suffix){
    var img=node('img',(cls?cls+' ':'')+'lab-thumb lab-thumb--'+(suffix?'light':'dark'));
    img.src='/assets/thumbnails/science-universe-preview'+suffix+'.webp?v=20261101-brand1';
    img.alt=alt;img.width=1280;img.height=720;img.loading='lazy';img.decoding='async';
    return img;
  });
}
function modal(title,eyebrow){
 var dialog=node('dialog','lab-dialog'),header=node('header','lab-dialog__head'),heading=node('div'),body=node('div','lab-dialog__body');
 var titleId='lab-dialog-title-'+(++requestSequence);
 if(eyebrow)heading.append(node('p','g-eyebrow g-eyebrow--bare',eyebrow));
 var h=node('h2','',title);h.id=titleId;heading.append(h);
 var close=node('button','lab-dialog__close');close.type='button';close.setAttribute('aria-label','Close');close.innerHTML=icon('close');
 close.addEventListener('click',function(){dialog.close();});
 header.append(heading,close);dialog.setAttribute('aria-labelledby',titleId);
 dialog.append(header,body);dialog.labBody=body;
 dialog.addEventListener('close',function(){dialog.remove();});
 // A click on the backdrop lands on the dialog element itself.
 dialog.addEventListener('click',function(e){if(e.target===dialog)dialog.close();});
 // Focus the dialog itself: handing it to the first control drew a focus ring
 // on a button the reader had not reached by keyboard.
 dialog.tabIndex=-1;document.body.append(dialog);dialog.showModal();dialog.focus();return dialog;
}
function previewLab(lab){
 var dialog=modal(lab.title,['Interactive model',lab.duration_text].filter(Boolean).join(' · ')),body=node('div','lab-science-preview');
 if(lab.slug==='science-universe')
   body.append.apply(body,scienceThumbs('The Science Universe workspace: a map of research laboratories, field notes and an event log','lab-preview-image'));
 body.append(node('p','lab-preview-summary',lab.summary));
 var concepts=lab.slug==='science-universe'?[
  ['The idea','More ideas do not automatically produce more reliable discoveries. Statistical power, review queues, selective reporting and independent replication interact.'],
  ['What you can test','Start two worlds from the same checkpoint. Change one policy and compare the live model, event log and outcome trends.'],
  ['How to read it','A seeded synthetic teaching model. Its mechanisms come from the literature; its numerical policies are uncalibrated assumptions.']
 ]:[['What you will explore',lab.description||lab.summary],['Learning goal',lab.config?.learning_goal||'Change a condition, observe the result and examine the explanation.']];
 var facts=node('dl','lab-preview-facts');
 for(var pair of concepts){var item=node('div');item.append(node('dt','',pair[0]),node('dd','',pair[1]));facts.append(item);}
 body.append(facts);dialog.labBody.append(body);
 var foot=node('footer','lab-dialog__foot');
 foot.append(node('p','lab-dialog__note','Runs in your browser. A synthetic teaching model, not a forecast.'));
 var enter=node('button','g-btn g-btn--primary lab-enter');enter.type='button';
 enter.innerHTML='<span>Enter simulation</span>'+icon('arrow');
 enter.addEventListener('click',function(){dialog.close();history.replaceState(null,'','?lab='+encodeURIComponent(lab.slug));runLab(lab);});
 foot.append(enter);dialog.append(foot);
}
var lastInsightAt=0;
function showInsight(title,text,citations){
 if(!active||active.slug!=='science-universe'||!speaking)return;
 addChat('pulsar',text,'guide',citations,title.slice(0,90));
}
async function openKnowledge(documentSlug,anchor){
 if(!active||active.slug!=='science-universe')return;
 var dialog=modal('Scientific sources','Behind the model'),content=node('div','lab-knowledge-reader','Loading sources…');dialog.labBody.append(content);
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
 var dialog=modal('Scenario atlas','Executed model runs'),content=node('div','lab-atlas','Loading executed model scenarios…');dialog.labBody.append(content);
 try{
  var res=await fetch('/api/labs/science-universe/scenarios/',{credentials:'same-origin'});if(!res.ok)throw Error('Scenario atlas unavailable');var data=await res.json();content.replaceChildren();
  content.append(node('p','',data.runs_for_current_engine+' executed runs for this engine. '+Number(data.policy_combinations).toLocaleString()+' possible policy combinations. Coverage is sampled.'),node('p','lab-note',data.limits+' A seed reproduces the same random draws when all settings and interventions match.'));
  var form=node('div','lab-atlas-filter'),select=node('select','g-select');select.setAttribute('aria-label','Scenario family');
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
  if(active.slug==='science-universe'&&data.type==='lab:companion-layout'){
    var g=data.layout;if(!g||typeof g!=='object'||!['left','top','width','height','dockTop','viewportWidth','viewportHeight'].every(function(k){return Number.isFinite(g[k])&&Math.abs(g[k])<=20000;})||g.width<=0||g.height<=0)return;
    companionGeometry=g;positionCompanion();revealCompanion();return;
  }
  if(active.slug==='science-universe'&&data.type==='lab:modal'){
    root.classList.toggle('is-sim-modal',data.open===true);
    if(data.open===true)clearNotices();
    return;
  }
  if(active.slug==='science-universe'&&data.type==='lab:shell-action'){
    if(data.action==='catalog')showCatalog();
    if(data.action==='tour')startTour();
    if(data.action==='sources')openKnowledge();
    if(data.action==='fullscreen'&&fullscreenButton)fullscreenButton.click();
    var destinations={'navigate:home':'/index.html','navigate:topics':'/topics.html','navigate:learn':'/learn.html','navigate:community':'/community.html','navigate:about':'/about.html','navigate:youtube':'https://www.youtube.com/@GraviQuest','navigate:linkedin':'https://www.linkedin.com/company/graviquest/','navigate:instagram':'https://www.instagram.com/graviquest'};
    if(typeof data.action==='string'&&Object.prototype.hasOwnProperty.call(destinations,data.action))location.assign(destinations[data.action]);return;
  }
  if(active.slug==='science-universe'&&data.type==='lab:open-atlas'){openAtlas();return;}
  if(active.slug==='science-universe'&&data.type==='lab:save-snapshot'){saveSnapshot(data.seed);return;}
  if(active.slug==='science-universe'&&data.type==='lab:note'){
    if(speaking&&data.note&&Date.now()-lastInsightAt>18000){showInsight(String(data.note.title||'Model snapshot'),String(data.note.text||''));lastInsightAt=Date.now();}return;
  }
  if(active.slug==='science-universe'&&data.type==='lab:context'){
    root.classList.toggle('is-editing-policy',data.context?.policyEditing===true);
    if(data.context?.policyEditing===true&&chatOpen){chatOpen=false;refreshChat();}
    if(chat?.observation){var observedText='World '+String(data.context?.world||'A').replace(/^World /,'')+' · Day '+String(data.context?.day||0);if(chat.observation.textContent!==observedText)chat.observation.textContent=observedText;}
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
    if(requested){if(enteredLab(requested.slug))runLab(requested);else{showCatalog();previewLab(requested);}}else showCatalog();
  }).catch(function(){ /* Silence is intentional on an unpublished surface. */ });
})();
