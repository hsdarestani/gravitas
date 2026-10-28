/* GraviQuest AI Lab: progressive enhancement, explicit AI calls, honest simulations. */
(function(){
  'use strict';
  var root=document.querySelector('.ai-lab-page');
  if(!root)return;
  function el(id){return document.getElementById(id);}
  function txt(id,value){var node=el(id);if(node)node.textContent=value;}
  function div(parent,cls,text){var n=document.createElement('div');if(cls)n.className=cls;if(text!==undefined)n.textContent=text;parent.appendChild(n);return n;}
  var modes=['understand','reliability','agent','artifact'], current='reliability';
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function switchMode(mode,scroll){
    if(modes.indexOf(mode)===-1)mode='reliability';
    current=mode;
    modes.forEach(function(m){
      var tab=el('ai-tab-'+m),panel=el('ai-panel-'+m),on=m===mode;
      tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;panel.hidden=!on;
    });
    if(scroll!==false)el('ai-workspace').scrollIntoView({behavior:reduced?'auto':'smooth',block:'start'});
    try{var u=new URL(window.location.href);u.searchParams.set('mode',mode);window.history.replaceState(null,'',u.pathname+u.search+u.hash);}catch(err){}
    if(mode==='artifact')drawOrbit();
  }
  document.addEventListener('click',function(event){
    var b=event.target.closest('[data-open-lab],[data-tab]');
    if(b){switchMode(b.dataset.openLab||b.dataset.tab,true);return;}
    if(event.target.closest('#ai-back-top'))window.scrollTo({top:0,behavior:reduced?'auto':'smooth'});
  });
  document.querySelector('.ai-tabs').addEventListener('keydown',function(e){
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight'&&e.key!=='Home'&&e.key!=='End')return;
    e.preventDefault();var i=modes.indexOf(current),n=e.key==='Home'?0:e.key==='End'?modes.length-1:(i+(e.key==='ArrowRight'?1:-1)+modes.length)%modes.length;
    switchMode(modes[n],false);el('ai-tab-'+modes[n]).focus();
  });
  /* Foundation preview: no invented AI response. */
  function drawUnderstand(){
    var context=el('ai-understand-context').checked,verify=el('ai-understand-cite').checked;
    txt('ai-understand-prompt','QUESTION: How long does Mars take to orbit the Sun?\n\n'+(context?'REFERENCE: Mars completes one orbit in approximately 687 Earth days.':'REFERENCE: None provided.')+'\n\n'+(verify?'INSTRUCTION: Identify evidence and explicitly state what cannot be verified.':'INSTRUCTION: Answer the question.'));
    var result=el('ai-understand-output');result.replaceChildren();
    div(result,'ai-label',context?'REFERENCE AVAILABLE':'NO REFERENCE PROVIDED');
    div(result,'',context?'The provided reference states approximately 687 Earth days. The AI can use that information when answering.':'Without a supplied source, an AI may answer from its training, but the user cannot trace that answer to evidence in this prompt.');
    div(result,'ai-label',verify?'EVIDENCE REQUESTED':'NO EVIDENCE REQUEST');
    div(result,'',verify?'You asked for explicit attribution and uncertainty. This improves inspectability but does not enforce truth.':'There is no explicit request for evidence. A fluent response may still omit its basis.');
    var note=div(result,'ai-fineprint','Illustrative explanation only — this panel does not call an AI model.');note.style.marginTop='14px';
  }
  ['ai-understand-context','ai-understand-cite'].forEach(function(id){el(id).addEventListener('change',drawUnderstand);});drawUnderstand();
  /* Live AI Reliability. The public API uses managed Pulsar; provider=fallback is not a real run. */
  var example='Study note (illustrative training data): 40 participants: 20 received a training program and 20 did not. Reported average improvement was 12% versus 9%, respectively. Group assignment was not randomized. There is no reported confidence interval or statistical significance test. This study alone does not establish causation.';
  var questions={leading:'This study clearly proves that the training program causes better results, right?',neutral:'What can and cannot be concluded about the training program from this study?'};
  var lastRun=null,comparison=[],busy=false;
  function renderQuestion(){txt('ai-reliability-question',questions[el('ai-framing').value]);}
  el('ai-framing').addEventListener('change',renderQuestion);renderQuestion();
  function buildPrompt(){
    var question=questions[el('ai-framing').value],include=el('ai-evidence').checked,verify=el('ai-verify').checked;
    return ['GraviQuest AI Lab experiment. Please answer the visitor question directly. This is an AI literacy exercise, not a request to explain the site itself.','Question: '+question,include?'Reference supplied by the user:\n'+example:'No study excerpt was supplied. Do not invent methods, sample statistics or details.',verify?'Verification request: state explicitly which claims are supported by the supplied information, which are uncertain, and whether causation is established. If evidence is missing, say so.':'Please answer concisely.','Keep your answer under 180 words.'].join('\n\n');
  }
  async function askAI(message){
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},28000);
    try{
      var response=await fetch('/api/pulsar/ask/',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:message.slice(0,4000),page:'/lab.html',locale:'en'}),signal:controller.signal});
      if(!response.ok)throw new Error('The AI service returned HTTP '+response.status+'.');
      var data=await response.json();
      if(!data||data.ok!==true||!data.reply||data.provider==='fallback')throw new Error('The managed AI service is not available at the moment. No result has been generated.');
      return {text:String(data.reply),provider:String(data.provider||'managed'),runId:data.run_id||null};
    }finally{clearTimeout(timer);}
  }
  var runButton=el('ai-run-reliability');
  runButton.addEventListener('click',async function(){
    if(busy)return;
    busy=true;lastRun=null;el('ai-save-run').disabled=true;
    runButton.disabled=true;txt('ai-run-status','RUNNING');txt('ai-live-response','Sending the current conditions to the managed AI service…');
    var config={framing:el('ai-framing').value,evidence:el('ai-evidence').checked,verify:el('ai-verify').checked};
    try{
      var out=await askAI(buildPrompt());
      lastRun={config:config,reply:out.text,provider:out.provider,runId:out.runId};
      txt('ai-live-response',out.text);txt('ai-run-status','LIVE AI RESPONSE');el('ai-save-run').disabled=false;
    }catch(error){txt('ai-run-status','UNAVAILABLE');txt('ai-live-response',error.name==='AbortError'?'The request timed out. Try again later.':error.message);}
    finally{busy=false;runButton.disabled=false;}
  });
  el('ai-save-run').addEventListener('click',function(){
    if(!lastRun)return;comparison.push({config:Object.assign({},lastRun.config),reply:lastRun.reply,provider:lastRun.provider});comparison=comparison.slice(-2);renderCompare();
    txt('ai-run-status','SAVED TO COMPARISON');
  });
  el('ai-clear-runs').addEventListener('click',function(){comparison=[];lastRun=null;renderCompare();txt('ai-live-response','Your answer will appear here when you run the experiment.');txt('ai-run-status','NOT RUN');el('ai-save-run').disabled=true;});
  function renderCompare(){
    var container=el('ai-compare'),grid=el('ai-compare-grid');grid.replaceChildren();
    container.hidden=comparison.length===0;
    txt('ai-compare-count',comparison.length+' saved run'+(comparison.length===1?'':'s')+' · current session');
    comparison.forEach(function(run,i){
      var card=div(grid,'ai-compare-card');
      var title=document.createElement('h5');title.textContent='Run '+(i+1)+' · '+(run.config.framing==='leading'?'Leading':'Neutral');card.appendChild(title);
      var info=document.createElement('p');info.textContent='Source: '+(run.config.evidence?'on':'off')+' · Verification request: '+(run.config.verify?'on':'off');card.appendChild(info);
      var pre=document.createElement('pre');pre.textContent=run.reply;card.appendChild(pre);
    });
  }
  /* Rules-only agent scenario, never calls tools or publishes real data. */
  function simulateAgent(){
    var search=el('ai-agent-search').checked,files=el('ai-agent-files').checked,publish=el('ai-agent-publish').checked,approval=el('ai-agent-approval').checked,threshold=Number(el('ai-agent-confidence').value);
    var target=el('ai-agent-trace');target.replaceChildren();
    var steps=[
      {status:search?'ok':'blocked',name:'01 · Retrieve papers',reason:search?'Public research search permitted in this scenario.':'Search permission is disabled; the agent cannot retrieve sources.'},
      {status:search?'ok':'blocked',name:'02 · Extract evidence',reason:search?'Illustrative evidence coverage: 70% of required claims.':'Cannot inspect evidence without retrieved sources.'},
      {status:files&&search?'ok':'blocked',name:'03 · Prepare a draft',reason:files&&search?'Draft creation is permitted in the sandbox.':'A source or draft-writing permission is missing.'}
    ];
    var meets=search&&files&&threshold<=70;
    var pubStatus=!publish?'blocked':!meets?'blocked':approval?'review':'ok';
    steps.push({status:pubStatus,name:'04 · Publish findings',reason:!publish?'Publishing permission is off.':!meets?'Required evidence coverage is not met (illustrative coverage: 70%).':approval?'Human review is required: execution stops awaiting approval.':'Allowed by your simulated policy; no actual publication takes place.'});
    steps.forEach(function(s){
      var card=div(target,'ai-agent-step');card.dataset.status=s.status;
      div(card,'',s.status==='ok'?'✓':s.status==='review'?'!':'×');
      var body=div(card,'');var title=document.createElement('b');title.textContent=s.name;body.appendChild(title);var p=document.createElement('p');p.textContent=s.reason;body.appendChild(p);
    });
    var label=pubStatus==='ok'?'Would proceed in the simulation':pubStatus==='review'?'Waiting for human approval':'Publication blocked by policy';
    txt('ai-agent-summary',label+'. No real tools, accounts or publications were involved.');
  }
  el('ai-agent-confidence').addEventListener('input',function(){txt('ai-agent-confidence-value',el('ai-agent-confidence').value+'%');simulateAgent();});
  ['ai-agent-search','ai-agent-files','ai-agent-publish','ai-agent-approval'].forEach(function(id){el(id).addEventListener('change',simulateAgent);});
  el('ai-agent-run').addEventListener('click',simulateAgent);simulateAgent();
  /* Keplerian orbital artifact, deterministic numerical calculation. */
  var orbit={mass:1,axis:1,ecc:.2,speed:1,playing:!reduced,time:0},prev=0;
  var svgNS='http://www.w3.org/2000/svg',starGroup=el('ai-orbit-stars');
  for(var i=0;i<65;i++){var star=document.createElementNS(svgNS,'circle');star.setAttribute('cx',String((i*113+27)%520));star.setAttribute('cy',String((i*71+15)%390));star.setAttribute('r',i%7===0?'1.3':'.65');star.setAttribute('fill','#b9d4e3');star.setAttribute('opacity',String(.18+(i%5)*.085));starGroup.appendChild(star);}
  function period(){return Math.sqrt(Math.pow(orbit.axis,3)/orbit.mass);}
  function drawOrbit(){
    var base=113,rx=base*orbit.axis,b=rx*Math.sqrt(1-orbit.ecc*orbit.ecc),focusX=248,cy=195,cx=focusX+rx*orbit.ecc;
    var ellipse=el('ai-orbit-ellipse');ellipse.setAttribute('cx',String(cx));ellipse.setAttribute('cy',String(cy));ellipse.setAttribute('rx',String(rx));ellipse.setAttribute('ry',String(b));
    var sun=el('ai-orbit-sun'),glow=el('ai-star-glow-shape');sun.setAttribute('cx',String(focusX));glow.setAttribute('cx',String(focusX));
    var anomaly=(orbit.time/period())*2*Math.PI;anomaly=((anomaly%(2*Math.PI))+(2*Math.PI))%(2*Math.PI);
    var E=anomaly;for(var k=0;k<8;k++)E=E-(E-orbit.ecc*Math.sin(E)-anomaly)/(1-orbit.ecc*Math.cos(E));
    var x=cx+rx*Math.cos(E),y=cy+b*Math.sin(E),planet=el('ai-orbit-planet'),radius=el('ai-orbit-radius'),label=el('ai-orbit-planet-label');
    planet.setAttribute('cx',String(x));planet.setAttribute('cy',String(y));
    radius.setAttribute('x1',String(focusX));radius.setAttribute('y1',String(cy));radius.setAttribute('x2',String(x));radius.setAttribute('y2',String(y));
    label.setAttribute('x',String(Math.min(487,x+14)));label.setAttribute('y',String(y-14));
    txt('ai-orbit-period',period().toFixed(2)+' yr');txt('ai-orbit-min',(orbit.axis*(1-orbit.ecc)).toFixed(2)+' AU');txt('ai-orbit-max',(orbit.axis*(1+orbit.ecc)).toFixed(2)+' AU');txt('ai-orbit-time',orbit.time.toFixed(2)+' years');
  }
  var sliders=[{id:'mass',prop:'mass',format:function(v){return v.toFixed(1)+' M☉';}},{id:'axis',prop:'axis',format:function(v){return v.toFixed(1)+' AU';}},{id:'ecc',prop:'ecc',format:function(v){return v.toFixed(2);}},{id:'speed',prop:'speed',format:function(v){return v.toFixed(2).replace(/0$/,'').replace(/\.$/,'')+'×';}}];
  function updateSliders(){sliders.forEach(function(s){el('ai-orbit-'+s.id).value=String(orbit[s.prop]);txt('ai-orbit-'+s.id+'-value',s.format(orbit[s.prop]));});drawOrbit();}
  sliders.forEach(function(s){el('ai-orbit-'+s.id).addEventListener('input',function(){orbit[s.prop]=Number(this.value);txt('ai-orbit-'+s.id+'-value',s.format(orbit[s.prop]));drawOrbit();});});
  function updatePause(){txt('ai-orbit-play',orbit.playing?'Pause':'Play');el('ai-orbit-play').setAttribute('aria-pressed',String(orbit.playing));}
  el('ai-orbit-play').addEventListener('click',function(){orbit.playing=!orbit.playing;updatePause();});
  el('ai-orbit-reset').addEventListener('click',function(){orbit={mass:1,axis:1,ecc:.2,speed:1,playing:!reduced,time:0};updateSliders();updatePause();});
  el('ai-orbit-export').addEventListener('click',function(){
    var obj={artifact:'GraviQuest Keplerian Orbit',type:'educational two-body model',units:{starMass:'solar masses',semiMajorAxis:'AU',period:'years'},parameters:{mass:orbit.mass,axis:orbit.axis,eccentricity:orbit.ecc,playbackSpeed:orbit.speed},derived:{periodYears:period(),periapsisAU:orbit.axis*(1-orbit.ecc),apoapsisAU:orbit.axis*(1+orbit.ecc)},disclaimer:'Simplified mathematical visualization, not an N-body simulation.'};
    var blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='graviquest-orbit-artifact.json';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1500);
  });
  el('ai-orbit-ask').addEventListener('click',async function(){
    var button=this;button.disabled=true;txt('ai-orbit-answer','Asking the managed AI service…');
    try{var q='Explain the orbital effects of a star mass of '+orbit.mass+' solar masses, semimajor axis '+orbit.axis+' AU, eccentricity '+orbit.ecc+'. The approximate orbital period is '+period().toFixed(3)+' years. Be accurate about Keplerian two-body assumptions. Give a clear explanation in under 140 words.';var result=await askAI(q);txt('ai-orbit-answer',result.text);}
    catch(e){txt('ai-orbit-answer',e.name==='AbortError'?'AI response timed out.':e.message);}
    finally{button.disabled=false;}
  });
  function tick(now){
    var dt=prev?Math.min((now-prev)/1000,.08):0;prev=now;
    if(orbit.playing&&current==='artifact'){orbit.time+=dt*.14*orbit.speed;drawOrbit();}
    window.requestAnimationFrame(tick);
  }
  updateSliders();updatePause();if(window.requestAnimationFrame)window.requestAnimationFrame(tick);
  try{var start=new URL(location.href).searchParams.get('mode');if(modes.indexOf(start)!==-1)switchMode(start,false);}catch(e){}
})();