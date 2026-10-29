/* Science Universe · Pulsar interaction guide.
   Only first-party allowlisted actions; no arbitrary code or model-tool calls.
   The sandboxed Lab supplies client-reported state, never trusted server facts. */
(function(root){
 'use strict';
 var state=null,pending=null;
 var SCENARIOS=Object.freeze([
  {id:'review_bottleneck',title:'Review bottleneck',
   description:'More hypotheses, review capacity unchanged · 45 model days'},
  {id:'selective_reporting',title:'Publication pressure',
   description:'Higher pressure, possible selective reporting · 45 model days'},
  {id:'replication_capacity',title:'Independent verification',
   description:'More capacity for independent repeats · 45 model days'}
 ]);
 function clean(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  var c={world:raw.world==='B'?'B':'A',
    day:Number.isInteger(raw.day)?Math.max(0,raw.day):0,
    view:raw.view==='papers'?'papers':'labs',
    published:Number.isInteger(raw.published)?Math.max(0,raw.published):0,
    reviewBacklog:Number.isInteger(raw.reviewBacklog)?Math.max(0,raw.reviewBacklog):0,
    replications:Number.isInteger(raw.replications)?Math.max(0,raw.replications):0,
    lab:null,paper:null};
  if(raw.lab&&Number.isInteger(raw.lab.id)){
    c.lab={id:raw.lab.id,name:String(raw.lab.name||'').slice(0,70),
      domain:String(raw.lab.domain||'').slice(0,45),
      paperCount:Number.isInteger(raw.lab.paperCount)?raw.lab.paperCount:0};
  }
  if(c.lab&&raw.paper&&Number.isInteger(raw.paper.id)&&raw.paper.labId===c.lab.id)
    c.paper={id:raw.paper.id,title:String(raw.paper.title||'').slice(0,95),
      status:raw.paper.status==='withdrawn'?'withdrawn':'published',
      replications:Number.isInteger(raw.paper.replications)?raw.paper.replications:0,
      pValue:typeof raw.paper.pValue==='number'&&Number.isFinite(raw.paper.pValue)?
        raw.paper.pValue:null};
  return c;
 }
 function navigation(question){
  var q=String(question||'').toLowerCase(),c=state||{};
  if(/what.*select|which.*select|can you see.*select|selected (paper|claim)|کدوم.*انتخاب|چی.*انتخاب/i.test(q)){
   if(c.paper)return 'The selected paper is #'+c.paper.id+' (“'+c.paper.title+
     '”) in '+(c.lab?.name||'the lab')+'. Click “Request independent replication” in its details.';
   if(c.lab)return 'You selected '+c.lab.name+
     ', but no paper is selected. Tap a paper in “Latest published claims” in the inspector.';
   return 'No paper or laboratory is selected right now. Choose a laboratory node first, then a paper in “Latest published claims”.';
  }
  if(/where.*(published|claim|paper)|where can i find|کجا.*(مقاله|یافته|منتشر)/i.test(q))
   return 'Select a laboratory node on the map, then scroll to “Latest published claims” in the inspector. Tap a paper to select it. If there are no papers, advance model days or pick another lab. The “published” metric is a count, not a list.';
  if(/how.*replicat|how.*fresh sample|چطور.*(تکرار|بازآزمایی|نمونه)/i.test(q))
   return 'Select a lab, tap a published claim under “Latest published claims”, then choose “Request independent replication”. Advance model days to see another synthetic experiment. A successful repeat is not proof of truth.';
  return '';
 }
 function mount(body,form,submit){
  var panel=document.createElement('details');panel.className='lab-chat-scenarios';
  var summary=document.createElement('summary');summary.textContent='Try a guided experiment';
  summary.className='lab-chat-scenario-title';
  var content=document.createElement('div');content.className='lab-chat-scenario-content';
  SCENARIOS.forEach(function(item){
   var block=document.createElement('div');block.className='lab-chat-scenario-item';
   var button=document.createElement('button');button.type='button';
   button.className='lab-chat-scenario-button';button.textContent=item.title;
   button.addEventListener('click',function(){
    if(pending)return;
    pending=item.id;panel.open=false;submit(item);
   });
   var p=document.createElement('p');p.className='lab-chat-scenario-hint';
   p.textContent=item.description+'. Demonstration only; no empirical calibration.';
   block.append(button,p);content.append(block);
  });
  panel.append(summary,content);body.insertBefore(panel,form);
 }
 function result(payload){
  if(!payload||!SCENARIOS.some(x=>x.id===payload.id)||payload.id!==pending)return null;
  pending=null;
  var a=payload.worldA,b=payload.worldB;
  if(!a||!b)return null;
  var keys=[['Hypotheses','generated'],['Published','published'],
   ['False published','falsePublished'],['Independent repeats','replicated'],
   ['Retracted','retracted'],['Review backlog','reviewBacklog']];
  if(!keys.every(x=>Number.isFinite(a[x[1]])&&Number.isFinite(b[x[1]])))return null;
  var table=keys.map(function(x){return x[0]+': '+a[x[1]]+' → '+b[x[1]];}).join(' · ');
  return String(payload.name||'Guided experiment').slice(0,90)+
   '. Matched checkpoint; '+String(payload.policy).slice(0,25)+' is '+payload.low+
   ' in A versus '+payload.high+' in B. Both advanced '+payload.days+
   ' model days.\n'+table+'\nThis is a synthetic model comparison with uncalibrated assumptions, not a real-world prediction.';
 }
 root.GraviScienceCoach={
  context:function(value){if(arguments.length)state=clean(value);return state;},
  navigation:navigation,mount:mount,result:result,
  reset:function(){state=null;pending=null;},
  scenarios:SCENARIOS
 };
})(window);
