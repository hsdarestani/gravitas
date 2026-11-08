/* GraviQuest Lab shell — public read-only presentation and supervised event coaching.
   Nothing appears while the Lab registry is empty. The simulator is always
   in an opaque-origin iframe; neither code nor instructions run in this shell. */
(function(){
'use strict';
var root=document.getElementById('lab-experiences');
var learning=window.GraviLabLearning,focusWorkspace=null;
if(!root)return;
var protocol='graviquest.lab.v1', validKey=/^[a-z][a-z0-9_-]{0,63}$/;
var iframe=null, active=null, shell=null, currentSection='', lastMetrics={}, metricHistory={};
var lastCoachAt=0, scheduled=null, lastEventKey='', lastEventAt=0, aiBusy=false;
var speaking=true, controller=null, session=0;
var requestSequence=0;
var chat=null,chatHistory=[],chatUnread=0,chatBusy=false,chatOpen=false,chatMountAt=0,chatHistoryReady=true;
var usage=null,lastQuestion='',replyFailed=false;
var notices=[],chatSequence=0,fullscreenButton=null,companionGeometry=null;
var labLevel='simple',missionProgress=null,missionEnabled=true,missionUnlocks=new Set();
function enteredLab(slug){try{return sessionStorage.getItem('graviquest:lab:entered:'+slug)==='yes';}catch(_){return false;}}
function positionCompanion(){
 if(root.classList.contains('learning-split'))return;
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
function focusTour(){}
function startTour(){if(learning){tellIframe('lab:level',{level:'advanced'});learning.startGuide();}}
function makeTourUI(main,bar){const launch=btn('Guided tour',startTour,'lab-tour-launch');bar.append(launch);tourUI={launch};}

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
 if(!chatHistoryReady)return;
 try{localStorage.setItem(CHAT_KEY,JSON.stringify(chatHistory.slice(-70)));}catch(_){}
 if(active?.slug==='science-universe'&&learning)learning.sync(chatHistory);
}
function messageText(m){
 var text=m.text;
 // Translate leaked telemetry identifiers into the terms a visitor sees in the Lab.
 var fa=/[پچژگکی]/.test(text),terms={
   server_model_facts:fa?'قواعد مدل':'the model’s rules',
   falsePublished:fa?'ادعاهای غلط':'false claims',
   falseDiscoveryRate:fa?'سهم ادعاهای غلط':'the share of false claims',
   reviewBacklog:fa?'صف داوری':'the review queue',
   replicationBacklog:fa?'صف تکرارهای مستقل':'the queue for independent repeats',
   healthyPapers:fa?'مقاله‌های باقی‌مانده در انتشار':'papers still published'
 };
 text=text.split(/(`[^`]+`|https?:\/\/[^\s)]+)/).map(function(part,i){
   return i%2?part:part.replace(/\b(server_model_facts|falsePublished|falseDiscoveryRate|reviewBacklog|replicationBacklog|healthyPapers)\b/g,function(key){return terms[key];});
 }).join('');
 if(!fa)text=text.replace(/The concrete A\/B contrast is between /g,'Here we compare ')
   .replace(/The plausible mechanism from the model’s rules is that /g,'In this model, ')
   .replace(/The uncertainty or trade-off to watch is that /g,'The trade-off is that ')
   .replace(/One next check is to examine the delta values for /g,'Next, compare the differences in ');
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
   renderReplies();
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
 root.classList.toggle('companion-collapsed',!chatOpen);
 positionCompanion();
}
// Pulsar stays invisible until the simulator has said where its dock is.
// Shown at once, it sat in the window's corner for the moment before the
// frame loaded and then jumped into place.
function revealCompanion(){
 var widget=chat?.box.closest('.lab-pulsar-widget');
 if(widget)widget.classList.remove('is-pending');
}
function updateMission(progress){
 if(!chat?.mission||!['simple','medium','advanced'].includes(progress?.level))return;
 const prevLevel=labLevel;
 labLevel=progress.level;root.dataset.level=labLevel;
 if(prevLevel!==labLevel&&labLevel!=='advanced')learning?.hideGuide();
 const cleanTrial=trial=>trial&&Number.isInteger(trial.setting)&&trial.setting>=1&&trial.setting<=10&&Number.isInteger(trial.result)&&trial.result>=0&&trial.result<1e6;
 missionProgress={
  trials:Array.isArray(progress.trials)?progress.trials.slice(0,2).filter(cleanTrial):[],
  baseline:cleanTrial(progress.baseline)?progress.baseline:null
 };
 renderMission();
 renderReplies();
}
function renderMission(){
 const host=chat?.mission;if(!host)return;
 host.hidden=labLevel==='advanced'||!missionEnabled;
 if(host.hidden)return;
 const medium=labLevel==='medium',next=medium?'Advanced':'Medium';
 const progress=missionProgress||{trials:[],baseline:null};
 const samples=medium&&progress.baseline?[progress.baseline,...progress.trials]:progress.trials;
 host.replaceChildren(node('span','lab-mission-step',medium?'MISSION 02 · COMPARE':'MISSION 01 · OBSERVE'));
 if(missionUnlocks.has(labLevel)){
  host.append(node('p','','Nice work. '+next+' is ready.'),btn('Continue to '+next,()=>tellIframe('lab:level',{level:next.toLowerCase()}),'lab-mission-next'));return;
 }
 if(samples.length!==2){
  host.append(node('p','',medium?'Change World B, then compare both worlds.':'Run the model at two different review settings.'));return;
 }
 const [a,b]=samples;
 const question=node('p','',medium?'Which world ended with a larger count?':'Which setting left more studies waiting?');
 const options=node('div','lab-mission-options'),feedback=node('small','lab-mission-feedback');
 feedback.setAttribute('role','status');
 const labels=medium?['World A','World B','Same count']:[a.setting+' / 10',b.setting+' / 10','Same count'];
 const correct=a.result===b.result?2:a.result>b.result?0:1;
 labels.forEach((label,index)=>options.append(btn(label,()=>{
  if(index!==correct){feedback.textContent=medium?'Check the two numbers above the chart.':'Check the two runs below and try again.';return;}
  missionUnlocks.add(labLevel);
  addChat('pulsar',medium?'You compared worlds from the same starting point. In Advanced, you can explore the full model.':'You spotted the difference. In Medium, you can compare two worlds side by side.','guide');
  renderMission();
  host.querySelector('button')?.focus();
 })));
 if(!medium)host.append(node('small','lab-mission-trials',a.setting+'/10 → '+a.result+' waiting   ·   '+b.setting+'/10 → '+b.result+' waiting'));
 host.append(question,options,feedback);
}
function renderReplies(){
 if(!chat?.starters||active?.slug!=='science-universe')return;
 const hadFocus=chat.starters.contains(document.activeElement),focusedLabel=hadFocus?document.activeElement.textContent:'';
 const latest=chatHistory.findLast(m=>m.role==='user')?.text||chatHistory.at(-1)?.text||'',fa=/[\u0600-\u06ff]/.test(latest);
 const label=(en,persian)=>fa?persian:en;
 const canAsk=active.config.pulsar_enabled!==false&&!(learning?.access()?.remaining===0&&!learning.access()?.authenticated);
 let actions=learning?.replyActions(fa);
 if(!actions)actions=replyFailed&&lastQuestion?[
  {label:label('Try that question again','دوباره تلاش کن'),ai:true,action:()=>askPulsar(lastQuestion,'ask')},
  {label:label('Read the scientific sources','منابع علمی را ببینم'),action:()=>openKnowledge()}
 ]:[
  {label:label(chatHistory.some(m=>m.provider==='ai')?'Explain more simply':'Explain this result',chatHistory.some(m=>m.provider==='ai')?'ساده‌تر توضیح بده':'این نتیجه را توضیح بده'),ai:true,action:()=>askPulsar(fa?'نتیجهٔ فعلی را ساده توضیح بده. چه چیزی تغییر کرد و چرا؟':'Explain the current result more simply: what changed, and why?','ask')},
  {label:label('Suggest an experiment','یک آزمایش پیشنهاد بده'),ai:true,action:()=>askPulsar(fa?'یک تغییر برای آزمایش بعدی در این مدل پیشنهاد بده و بگو چه نتیجه‌ای را مقایسه کنم.':'Suggest one policy change for my next controlled experiment, and which outcome to compare.','ask')},
  {label:label('Compare stored runs','مقایسه‌های ذخیره‌شده'),action:openAtlas}
 ];
 if(!canAsk)actions=[{label:label('Guide a comparison','یک مقایسه را راهنمایی کن'),action:()=>learning?.startGuide()},{label:label('Compare stored runs','مقایسه‌های ذخیره‌شده'),action:openAtlas}];
 if(labLevel!=='advanced'&&!learning?.atlasContext())actions=replyFailed&&lastQuestion?[{label:label('Try again','دوباره تلاش کن'),ai:true,action:()=>askPulsar(lastQuestion,'ask')}]:[];
 if(canAsk&&!replyFailed&&chatHistory.some(m=>m.provider==='ai')){
  actions.push({label:label('Explain in more detail','مفصل‌تر توضیح بده'),ai:true,action:()=>askPulsar(fa?'پاسخ قبلی‌ات را با جزئیات بیشتری توضیح بده.':'Explain your previous answer in more detail.','ask',null,'detailed')});
 }
 chat.starters.replaceChildren();chat.starters.hidden=!actions.length;chat.starters.dir=fa?'rtl':'ltr';
 for(const action of actions){const b=btn(action.label,()=>{if(!chatBusy||!action.ai)action.action();});b.disabled=!!(action.ai&&chatBusy);chat.starters.append(b);}
 if(hadFocus){const buttons=Array.from(chat.starters.querySelectorAll('button:not(:disabled)'));(buttons.find(b=>b.textContent===focusedLabel)||buttons[0])?.focus({preventScroll:true});}
}
function mountPulsarChat(sidebar){
 CHAT_KEY='graviquest:pulsar:'+active.slug+':history:v3:guest';
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
 starters.setAttribute('role','group');starters.setAttribute('aria-label','Suggested replies');
 var status=node('div','lab-chat-status','Conversation saved on this device');
 var form=document.createElement('form');form.className='lab-chat-compose';
 var input=node('input','lab-chat-input');
 input.type='text';input.required=true;input.maxLength=600;input.dir='auto';
 input.placeholder='Or type your own question…';
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
 var tools=node('div','lab-chat-tools'),mission=null;
 if(active.slug==='science-universe'){
  mission=node('section','lab-mission');
  mission.setAttribute('aria-label','Pulsar mission');
  body.append(mission);
 }
 if(active.slug==='science-universe'){var tips=btn('Tips on',function(){speaking=!speaking;tips.textContent=speaking?'Tips on':'Tips off';tips.setAttribute('aria-pressed',String(speaking));if(!speaking)clearNotices();},'lab-tips-toggle');tips.setAttribute('aria-pressed','true');tools.append(observation,tips);}
 body.append(tools,log,starters,status,form);box.append(toggle,body);sidebar.append(box);
 if(window.GraviLabUsage)body.insertBefore(window.GraviLabUsage.privacyControl(document.createDocumentFragment()),form);
 if(active.config.pulsar_enabled===false){input.disabled=true;send.disabled=true;input.placeholder='AI explanations are disabled for this Lab';tools.hidden=true;}
 chat={box,body,log,status,input,send,toggle,badge,arrow,observation,starters,mission,notices:noticeStack};
 chatOpen=true;
 try{
   var old=JSON.parse(localStorage.getItem(CHAT_KEY)||'[]');
   if(active.slug!=='science-universe'&&Array.isArray(old))chatHistory=old.slice(-70).filter(function(m){
     return m&&(m.role==='user'||m.role==='pulsar')&&
       typeof m.text==='string'&&m.text.length<=1800;
   });
 }catch(_){chatHistory=[];}
 chatHistory.forEach(addBubble);
 if(!chatHistory.length&&active.slug!=='science-universe'){
   addChat('pulsar',active.slug==='directory'?'Tell me what you want to understand. I can help you choose an available Lab and explain what you will learn.':'What would you like to understand? Choose a lab, change one policy, or ask me about the science. We can follow what changes and work through why.','guide');
 }
 if(scienceGuide&&active.slug==='science-universe'){
  scienceGuide.mount(body,mission,function(recipe){
   missionEnabled=true;
   if(!recipe){
    tellIframe('lab:level',{level:'simple',focus:true});return false;
   }
   if(labLevel!=='advanced'){
    tellIframe('lab:level',{level:'medium',scenario:recipe.id,focus:true});return false;
   }
   addChat('user','Run experiment: '+recipe.title,'guide');
   chat.status.textContent='Comparing two synthetic worlds…';
   tellIframe('lab:experiment',{id:recipe.id});return true;
  });
  renderMission();
 }
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
 renderReplies();
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
 updateMetrics(data.metrics);
 if(section&&section!==currentSection){currentSection=section;renderSteps();}
 var lesson=hintFor(ev,currentSection),intro=introFor(currentSection);
 if(active?.slug==='science-universe'){
   if(labLevel!=='advanced')return;
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
async function askPulsar(question,event,fallback,detail){
 var q=String(question||'').trim();
 if(!active||!active.config.pulsar_enabled||(aiBusy&&(!q||chatBusy)))return;
 if(active.slug==='science-universe'&&learning&&!learning.mayAsk())return;
 var isChat=['science-universe','directory'].includes(active.slug);
 var observed=active.slug==='science-universe'&&scienceGuide?scienceGuide.context():null;
 var atlasSelection=active.slug==='science-universe'&&learning?learning.atlasContext():null;
 var context=chatHistory.slice(-8).map(function(m){return {
   role:m.role,text:m.text.slice(0,480)
 };});
 if(isChat&&q)addChat('user',q);
 if(q){lastQuestion=q;replyFailed=false;}
 aiBusy=true;chatBusy=isChat&&!!q;lastCoachAt=Date.now();
 if(isChat&&chat){chat.send.disabled=chatBusy;chat.status.textContent='Pulsar is thinking…';renderReplies();}
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
       metrics:lastMetrics,history:context,context:observed,reply_detail:detail,
       locale:document.documentElement.lang||'en',atlas_comparison:atlasSelection,usage_visit:usage?.visit()}),
     signal:thisController.signal,credentials:'same-origin'
   });
   var result=await res.json();
   if(which!==session||request!==requestSequence)return;
   if(result.access&&learning)learning.updateAccess(result.access);
   if(result.error==='trial_exhausted')return;
   if(!res.ok)throw Error('coaching_unavailable');
   if(which!==session||request!==requestSequence)return;
   if(!q&&event==='policy_changed'&&observed&&JSON.stringify(observed.policies)!==JSON.stringify(scienceGuide?.context()?.policies))return;
   var observation=result.observation||observed;
   var title=atlasSelection?'Pulsar · Scenario atlas · A '+atlasSelection.low+' / B '+atlasSelection.high:
     labLevel==='advanced'&&observation&&Number.isFinite(observation.day)?'Pulsar · World '+observation.world+' · day '+observation.day:'';
   if(result.ok&&result.reply){feedback(result.reply,result.provider==='script'?'script':'ai',result.citations,title);}
   else if(fallback)feedback(fallback,'script');
 }catch(err){
   if(which!==session||request!==requestSequence)return;
   replyFailed=!!q;
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
       renderReplies();
     }
   }
 }
}
function configPanel(container,title){
  var section=node('section','lab-ui-panel');
  section.append(node('h3','lab-ui-heading',title));
  var inner=node('div','lab-ui-panel-body');section.append(inner);container.append(section);return inner;
}
function runLab(lab,initialScenario){
  if(!lab||!lab.ready)return;
  lastQuestion='';replyFailed=false;
  labLevel='simple';missionProgress=null;missionUnlocks=new Set();root.dataset.level=labLevel;
  if(usage)usage.stop();usage=window.GraviLabUsage?window.GraviLabUsage.start(lab):null;
  if(focusWorkspace)focusWorkspace.close();focusWorkspace=null;root.classList.remove('is-reading-lab');
  clearNotices();lastInsightAt=0;companionGeometry=null;chatMountAt=Date.now();chatHistoryReady=lab.slug!=='science-universe';
  try{sessionStorage.setItem('graviquest:lab:entered:'+lab.slug,'yes');}catch(_){}
  tourActive=false;tourUI=null;chat=null;chatHistory=[];chatUnread=0;chatBusy=false;chatOpen=false;
  if(scienceGuide)scienceGuide.reset();
  root.dataset.labSlug = lab.slug;root.classList.toggle('learning-split',lab.slug==='science-universe');
  root.classList.remove('is-editing-policy','is-sim-modal');
  root.setAttribute('aria-live','off');
  if(controller)controller.abort();if(scheduled)clearTimeout(scheduled);
  session++;active=lab;lastCoachAt=0;lastEventKey='';lastEventAt=0;currentSection='';
  metricHistory={};lastMetrics={};speaking=true;aiBusy=false;
  active=lab;
  var cfg=lab.config||{};
  missionEnabled=cfg.learning_workspace?.auto_start_guide!==false||!!initialScenario;
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
    if(initialScenario)tellIframe('lab:level',{level:'medium',scenario:initialScenario});
    // The simulator reports its dock as soon as it lays out; this only covers
    // a Lab that never does, so Pulsar cannot stay hidden.
    var current=session;setTimeout(function(){if(current===session)revealCompanion();},1500);
  });
  canvas.append(iframe);stageCol.append(canvas);
  var controls=null,metrics=null,chart=null;
  if(lab.slug!=='science-universe'&&cfg.components.includes('controls'))controls=configPanel(stageCol,'Parameters');
  if(lab.slug!=='science-universe'&&cfg.components.includes('timeline')){
    var timeline=configPanel(stageCol,'Timeline');
    ['play','pause','reset','replay'].forEach(function(command){
      timeline.append(btn(command[0].toUpperCase()+command.slice(1),function(){
        usage?.record(command==='replay'?'reset':command);
        tellIframe('lab:command',{command:command});
      },'lab-command'));
    });
  }
  if(lab.slug!=='science-universe'&&cfg.components.includes('layers'))shellLayerContainer=configPanel(stageCol,'Layers');
  else shellLayerContainer=null;
  if(lab.slug!=='science-universe'&&cfg.components.includes('metrics'))metrics=configPanel(stageCol,'Live measurements');
  if(lab.slug!=='science-universe'&&cfg.components.includes('charts'))chart=configPanel(stageCol,'Trends');
  var compareA=null;
  if(lab.slug!=='science-universe'&&cfg.components.includes('compare')){
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
  if(lab.slug!=='science-universe'&&window.GraviLabUsage)window.GraviLabUsage.privacyControl(sidebar);
  grid.append(stageCol,sidebar);main.append(grid);root.replaceChildren(main);root.hidden=false;
  shell={line:speech,source:source,steps:steps,metrics:metrics,chart:chart,layers:shellLayerContainer,controls:controls,stage:stageCol,canvas:canvas};
  if(lab.slug==='science-universe'&&learning){learning.mount({assistant:sidebar,body:chat.body,form:chat.body.querySelector('form'),settings:cfg.learning_workspace,pulsarEnabled:cfg.pulsar_enabled!==false,track:(kind,data)=>usage?.record(kind,data),refreshReplies:renderReplies,
    tell:tellIframe,ask:askPulsar,session:()=>session,history:()=>chatHistory,openAtlas:openAtlas,
    atlasOpen:()=>!!focusWorkspace?.querySelector('.lab-atlas'),closeAtlas:()=>focusWorkspace?.close(),
    openChat:()=>{chatOpen=true;sidebar.dataset.mode='chat';refreshChat();},
    restoreGuest:(preserveFresh=true)=>{chatHistoryReady=true;const fresh=preserveFresh?chatHistory.filter(m=>m.at>=chatMountAt):[];CHAT_KEY='graviquest:pulsar:science-universe:history:v3:guest';try{const stored=JSON.parse(localStorage.getItem(CHAT_KEY)||'[]');const merged=new Map([...stored,...fresh].filter(m=>m&&typeof m.id==='string'&&typeof m.text==='string'&&m.text.length<=1800&&['user','pulsar'].includes(m.role)).map(m=>[m.id,m]));chatHistory=[...merged.values()].slice(-70);chat.log.replaceChildren();chatHistory.forEach(addBubble);if(!chatHistory.length)addChat('pulsar','Ask me what changed and why.','guide');saveChat();}catch(_){}},
    restore:(messages,owner,preserveFresh)=>{chatHistoryReady=true;const fresh=preserveFresh?chatHistory.filter(m=>m.at>=chatMountAt&&(m.role==='user'||m.provider==='ai')):[];CHAT_KEY='graviquest:pulsar:science-universe:history:v3:'+owner;
      const merged=new Map([...messages,...fresh].map(m=>[m.id,m]));chatHistory=[...merged.values()].slice(-70);chat.log.replaceChildren();chatHistory.forEach(addBubble);if(!chatHistory.length)addChat('pulsar','Ask me what changed and why.','guide');saveChat();}
  });
  }
  if(steps&&cfg.sections?.length){
    currentSection=cfg.sections[0].id;renderSteps();
    feedback(cfg.sections[0].hint,'script');
  }
  if(metrics)showMetrics();

}
var shellLayerContainer=null;
function showCatalog(){
  if(usage)usage.stop();usage=null;
  if(focusWorkspace)focusWorkspace.close();focusWorkspace=null;root.classList.remove('is-reading-lab');
  if(tourActive)tellIframe('lab:tutorial',{target:'off'});
  clearNotices();fullscreenButton=null;
  if(active?.slug==='science-universe'&&document.fullscreenElement)document.exitFullscreen().catch(function(){});
  tourActive=false;tourUI=null;chat=null;chatHistory=[];chatUnread=0;chatBusy=false;
  companionGeometry=null;root.classList.remove('learning-split');root.dataset.labSlug='directory';
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
    body.append(meta,node('h2','lab-card-title',lab.title),node('p','lab-card-summary',lab.summary||'Change a setting and see what happens.'));
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
 var titleId='lab-dialog-title-'+Date.now();
 if(eyebrow)heading.append(node('p','g-eyebrow g-eyebrow--bare',eyebrow));
 var h=node('h2','',title);h.id=titleId;heading.append(h);
 var close=node('button','lab-dialog__close');close.type='button';close.setAttribute('aria-label','Close');close.innerHTML=icon('close');
 close.addEventListener('click',function(){dialog.close();});
 header.append(heading,close);dialog.setAttribute('aria-labelledby',titleId);
 dialog.append(header,body);dialog.labBody=body;
 dialog.addEventListener('close',function(){dialog.remove();if(focusWorkspace===dialog){focusWorkspace=null;root.classList.remove('is-reading-lab');if(shell?.canvas)shell.canvas.hidden=false;}});
 // A click on the backdrop lands on the dialog element itself.
 dialog.addEventListener('click',function(e){if(e.target===dialog)dialog.close();});
 // Focus the dialog itself: handing it to the first control drew a focus ring
 // on a button the reader had not reached by keyboard.
 dialog.tabIndex=-1;
 if(active?.slug==='science-universe'&&shell?.stage){
  if(focusWorkspace)focusWorkspace.close();focusWorkspace=dialog;root.classList.add('is-reading-lab');chatOpen=true;const companion=chat?.box.closest('.lab-pulsar-widget');if(companion)companion.dataset.mode='chat';refreshChat();dialog.classList.add('lab-focus-workspace');shell.canvas.hidden=true;shell.stage.append(dialog);tellIframe('lab:command',{command:'pause'});dialog.show();
 }else{document.body.append(dialog);dialog.showModal();}
 dialog.focus();return dialog;
}
const SCIENCE_GALLERY=[
 {title:'Featured · Science Ecosystem',alt:'Featured Science Ecosystem thumbnail showing the research network'},
 {title:'Simple · Peer review',alt:'Simple simulation with one review slider and one result',image:'review'},
 {title:'Medium · Review bottleneck',alt:'Matched runs comparing studies waiting for review',image:'bottleneck',scenario:'review_bottleneck'},
 {title:'Medium · Publication pressure',alt:'Matched runs comparing false claims published in the model',image:'pressure',scenario:'selective_reporting'},
 {title:'Medium · Independent repeats',alt:'Matched runs comparing completed independent repeats',image:'repeats',scenario:'replication_capacity'},
 {title:'Advanced · Research network',alt:'Advanced simulation showing the four named research communities',image:'network'}
];
function scienceGallery(onSelect){
 const gallery=node('section','lab-preview-gallery'),figure=node('figure'),media=node('div','lab-gallery-main'),caption=node('figcaption');
 gallery.setAttribute('aria-label','Lab image gallery');
 const rail=node('div','lab-gallery-rail');rail.setAttribute('role','group');rail.setAttribute('aria-label','Choose a preview image');
 const picture=(item,alt)=>{
  if(!item.image)return scienceThumbs(alt);
  const img=node('img');img.src='/assets/thumbnails/science-universe-'+item.image+'.webp';
  img.alt=alt;img.width=1040;img.height=608;img.loading='lazy';img.decoding='async';return [img];
 };
 const show=(item,index)=>{
  media.replaceChildren(...picture(item,item.alt));caption.textContent=item.title;
  Array.from(rail.children).forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
  onSelect(item);
 };
 SCIENCE_GALLERY.forEach((item,index)=>{
  const button=node('button','lab-gallery-thumb');button.type='button';button.setAttribute('aria-label',item.title);
  button.append(...picture(item,''));button.addEventListener('click',()=>show(item,index));rail.append(button);
 });
 caption.setAttribute('aria-live','polite');
 figure.append(media,caption);gallery.append(figure,rail);show(SCIENCE_GALLERY[0],0);return gallery;
}
function previewLab(lab){
 var dialog=modal(lab.title,['Interactive model',lab.duration_text].filter(Boolean).join(' · ')),body=node('div','lab-science-preview');
 var selectedImage=null;
 if(lab.slug==='science-universe')body.append(scienceGallery(item=>{selectedImage=item;}));
 body.append(node('p','lab-preview-summary',lab.summary));
 var concepts=lab.slug==='science-universe'?[
  ['Simple','Change peer review capacity and watch how many studies are left waiting.'],
  ['Medium','Keep one world fixed, change the other, and compare the result with Pulsar.'],
  ['Advanced','Explore the research network, individual teams, all policies and the Scenario Atlas.']
 ]:[['What you will explore',lab.description||lab.summary],['Learning goal',lab.config?.learning_goal||'Change a condition, observe the result and examine the explanation.']];
 var facts=node('dl','lab-preview-facts');
 for(var pair of concepts){var item=node('div');item.append(node('dt','',pair[0]),node('dd','',pair[1]));facts.append(item);}
 body.append(facts);dialog.labBody.append(body);
 var foot=node('footer','lab-dialog__foot');
 foot.append(node('p','lab-dialog__note','Runs in your browser · seeded teaching model'));
 var enter=node('button','g-btn g-btn--primary lab-enter');enter.type='button';
 enter.innerHTML='<span>Enter simulation</span>'+icon('arrow');
 enter.addEventListener('click',function(){dialog.close();history.replaceState(null,'','?lab='+encodeURIComponent(lab.slug));runLab(lab);});
 if(lab.slug==='science-universe')foot.append(btn('Open selected scenario',function(){
  if(!selectedImage?.scenario)return;
  dialog.close();history.replaceState(null,'','?lab='+encodeURIComponent(lab.slug));runLab(lab,selectedImage.scenario);
 },'lab-gallery-scenario'));
 foot.append(enter);dialog.append(foot);
 if(lab.slug==='science-universe'){
  const scenarioButton=foot.querySelector('.lab-gallery-scenario');
  const update=()=>{scenarioButton.hidden=!selectedImage?.scenario;};
  body.querySelector('.lab-gallery-rail').addEventListener('click',update);update();
 }
}
var lastInsightAt=0;
function showInsight(title,text,citations){
 if(!active||active.slug!=='science-universe'||!speaking||active.config.auto_coach===false)return;
 addChat('pulsar',text,'guide',citations,title.slice(0,90));
}
async function openKnowledge(documentSlug,anchor){
 if(!active||active.slug!=='science-universe')return;
 usage?.record('sources_opened');
 var dialog=modal('Scientific sources','Behind the model'),content=node('div','lab-knowledge-reader','Loading sources…');dialog.labBody.append(content);
 try{
  var res=await fetch('/api/labs/science-universe/knowledge/'+(documentSlug?encodeURIComponent(documentSlug)+'/':''),{credentials:'same-origin'});
  if(!res.ok)throw Error('Sources are unavailable');var data=await res.json();content.replaceChildren();
  if(!documentSlug){
   (data.documents||[]).forEach(function(doc){var section=node('section','lab-source-card');section.append(node('h3','',doc.title),node('p','',doc.kind==='reading_note'?'Original reading note; full paper at the source.':'Stored Markdown · '+doc.sections.length+' sections'),btn('Read sections',function(){dialog.close();openKnowledge(doc.slug);}));content.append(section);});return;
  }
  var doc=data.document;
  usage?.record('source_read',{document:documentSlug});
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
function openAtlas(){
 if(!active||active.slug!=='science-universe')return;
 usage?.record('atlas_opened');
 var dialog=modal('Scenario atlas','Compare one decision'),content=node('div','lab-atlas');dialog.labBody.append(content);
 if(learning)learning.mountAtlas(content);
}
async function saveSnapshot(seed){
 usage?.record('snapshot_requested');
 var state=scienceGuide?.context();if(!state)return;
 try{var saved=JSON.parse(localStorage.getItem('graviquest:lab:snapshots:v1')||'[]');saved.push({at:Date.now(),seed:seed,context:state});localStorage.setItem('graviquest:lab:snapshots:v1',JSON.stringify(saved.slice(-30)));}catch(_){}
 addChat('pulsar','Day '+state.day+' · '+state.world+' snapshot: '+(state.metrics.published||0)+' published; '+(state.metrics.falsePublished||0)+' false live claims; '+(state.metrics.reviewBacklog||0)+' awaiting review; '+(state.metrics.replicated||0)+' independent repeats.','guide');
 if(learning&&!learning.access()?.authenticated){learning.requestSave();chatOpen=true;refreshChat();return;}
 function csrfCookie(){return (document.cookie.match(/(?:^|; )(?:csrftoken|gravitas_staging_csrftoken)=([^;]*)/)||[])[1]||'';}
 var csrf=csrfCookie();if(!csrf){try{await fetch('/api/auth/csrf/',{credentials:'same-origin'});csrf=csrfCookie();}catch(_){}}
 try{var r=await fetch('/api/labs/science-universe/snapshots/',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRFToken':decodeURIComponent(csrf)},body:JSON.stringify({seed:seed,context:state,usage_visit:usage?.visit()})});
  if(r.status===401){addChat('pulsar','Snapshot captured on this device. Sign in to save it to your account.','guide');return;}
  if(!r.ok)throw Error('Snapshot could not be saved to your account.');var result=await r.json();addChat('pulsar','Snapshot #'+result.id+' saved. These are browser-reported model measurements. Ask me what changed or why.','guide');
 }catch(e){addChat('pulsar',e.message,'guide');}
}
window.addEventListener('message',function(e){
  if(!active||!iframe||e.source!==iframe.contentWindow||e.origin!=='null')return;
  var data=e.data;if(!data||data.schema!==protocol||typeof data.type!=='string')return;
  if(data.type==='lab:usage'&&usage&&data.usage){if(data.usage.kind==='parameter_changed')usage.debounced(data.usage.kind,data.usage.data);else usage.record(data.usage.kind,data.usage.data);return;}
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
  if(active.slug==='science-universe'&&data.type==='lab:learning-progress'){updateMission(data.progress);return;}
  if(active.slug==='science-universe'&&data.type==='lab:lesson-state'){learning?.updateLesson(data.lesson);return;}
  if(active.slug==='science-universe'&&data.type==='lab:open-atlas'){openAtlas();return;}
  if(active.slug==='science-universe'&&data.type==='lab:save-snapshot'){saveSnapshot(data.seed);return;}
  if(active.slug==='science-universe'&&data.type==='lab:note'){
    if(speaking&&data.note&&Date.now()-lastInsightAt>18000){showInsight(String(data.note.title||'Model snapshot'),String(data.note.text||''));lastInsightAt=Date.now();}return;
  }
  if(active.slug==='science-universe'&&data.type==='lab:context'){
    root.classList.toggle('is-editing-policy',data.context?.policyEditing===true);

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
    if(active.slug==='science-universe')learning?.prepare();
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
          usage?.debounced('parameter_changed',{parameter:ctrl.key,value:Number(slider.value)});
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
