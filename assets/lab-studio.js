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
var tourActive=false, tourIndex=0, tourUI=null;
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
  {target:'fork',title:'Fork a parallel universe',
   description:'World B copies the exact state and random-generator position of World A. The app then raises World B review and replication policies by three points, capped at ten.',
   task:'Press Fork universe. Keep track of which rules differ between the two worlds.'},
  {target:'compare',title:'Compare results, not predictions',
   description:'Both worlds advance independently after the fork. Compare live papers, false claims, replications and withdrawals—but do not read one run as a real-world causal estimate.',
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
  if(!mobileLabFrame()){iframe.style.height='';return;}
  tellIframe('lab:measure');
}
window.addEventListener('resize',adjustFrameForViewport,{passive:true});
function feedback(message,source){
  if(!speaking||!shell||!message)return;
  shell.line.textContent=String(message).slice(0,480);
  shell.source.textContent=source==='ai'?'Pulsar · live':source==='script'?'Guided note':'Pulsar · Lab guide';
  shell.line.dataset.animated='true';
}
function hintFor(event,section){
  var guidance=active?.config?.guidance||[];
  return guidance.find(function(g){return g.event===event&&(!g.section||g.section===section);})||null;
}
function introFor(section){
  return (active?.config?.sections||[]).find(function(s){return s.id===section;})||null;
}
function renderSteps(){
  if(!shell)return;
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
    tourUI.status.textContent='Action detected. You can continue to the next step.';
  }
  updateMetrics(data.metrics);
  if(section&&section!==currentSection){currentSection=section;renderSteps();}
  var lesson=hintFor(ev,currentSection),intro=introFor(currentSection);
  if(lesson?.hint)feedback(lesson.hint,'script');
  else if(intro?.hint&&ev==='section')feedback(intro.hint,'script');
  if(!active.config.pulsar_enabled||!active.config.auto_coach||!speaking)return;
  if(ev===lastEventKey&&Date.now()-lastEventAt<12000)return;
  lastEventKey=ev;lastEventAt=Date.now();
  if(scheduled)clearTimeout(scheduled);
  // Low-frequency, debounced coaching: not a model invocation per slider tick.
  scheduled=setTimeout(function(){if(Date.now()-lastCoachAt>=20000)askPulsar('',ev);},1500);
}
async function askPulsar(question,event){
  if(!active||aiBusy||!active.config.pulsar_enabled)return;
  aiBusy=true;lastCoachAt=Date.now();
  if(controller)controller.abort();
  controller=new AbortController();
  var which=session,labSlug=active.slug;
  shell.source.textContent='Pulsar · interpreting';
  try{
    var res=await fetch('/api/labs/'+encodeURIComponent(labSlug)+'/coach/',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({event:event||'ask',section:currentSection,question:question||'',
        metrics:lastMetrics,locale:document.documentElement.lang||'en'}),
      signal:controller.signal,credentials:'same-origin',
    });
    if(!res.ok)throw Error('coaching_unavailable');
    var result=await res.json();
    if(which!==session)return;
    if(result.ok&&result.reply)feedback(result.reply,result.provider==='script'?'script':'ai');
  }catch(err){
    if(which!==session||err.name==='AbortError')return;
    shell.source.textContent='Pulsar · guidance available';
  }finally{if(which===session)aiBusy=false;}
}
function configPanel(container,title){
  var section=node('section','lab-ui-panel');
  section.append(node('h3','lab-ui-heading',title));
  var inner=node('div','lab-ui-panel-body');section.append(inner);container.append(section);return inner;
}
function runLab(lab){
  if(!lab||!lab.ready)return;
  tourActive=false;tourUI=null;
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
  if(lab.slug==='science-universe')makeTourUI(main,bar);
  if(lab.summary)main.append(node('p','lab-runtime-summary',lab.summary));
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
  var source=node('p','lab-pulsar-source','Pulsar · Lab guide');
  var title=node('h2','lab-assistant-title','Pulsar');
  var intro=node('p','lab-assistant-intro','Learn the simulator, explore changes and question the results.');
  var steps=node('div','lab-guided-steps');
  var speech=node('p','lab-assistant-line','Make a change or choose a learning step. I will help you understand what it means.');
  var controlsBar=node('div','lab-assistant-actions');
  var askInput=node('input','lab-ask-input');
  askInput.type='text';askInput.maxLength=450;askInput.placeholder='Ask about this experiment';
  askInput.setAttribute('aria-label','Ask Pulsar about this Lab');
  var ask=btn('Ask',function(){
    var q=askInput.value.trim();if(!q)return;
    askInput.value='';askPulsar(q,'ask');
  });
  askInput.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();ask.click();}});
  var mute=btn('Pause commentary',function(){
    speaking=!speaking;mute.textContent=speaking?'Pause commentary':'Resume commentary';
  });
  var explain=btn('Explain this state',function(){
    if(!Object.keys(lastMetrics).length)return;
    askPulsar('Explain what these reported values may imply, and what to try next.','ask');
  });
  controlsBar.append(askInput,ask);
  if(cfg.pulsar_enabled!==false){
    sidebar.append(title,intro,source,speech,steps,controlsBar,explain,mute);
  }else{
    sidebar.append(title,node('p','lab-note','Guidance is not enabled for this Lab.'));
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
  tourActive=false;tourUI=null;
  delete root.dataset.labSlug;
  if(controller)controller.abort();if(scheduled)clearTimeout(scheduled);
  session++;active=null;iframe=null;shell=null;
  var catalog=node('section','lab-catalog');
  var head=node('div','lab-catalog-head');
  head.append(node('h2',null,'Experiments'),node('p',null,'Choose a Lab to explore.'));
  var cards=node('div','lab-catalog-grid');
  labs.forEach(function(lab){
    var card=node('button','lab-catalog-card');
    card.type='button';
    if(lab.topic_slug)card.append(node('small','lab-card-kicker','Topic · '+lab.topic_slug));
    card.append(node('strong','lab-card-title',lab.title),
      node('span','lab-card-summary',lab.summary||'Explore the simulation and change its conditions.'),
      node('span','lab-card-open','Open Lab'));
    card.addEventListener('click',function(){history.replaceState(null,'','?lab='+encodeURIComponent(lab.slug));runLab(lab);});
    cards.append(card);
  });
  catalog.append(head,cards);root.replaceChildren(catalog);root.hidden=false;
}
window.addEventListener('message',function(e){
  if(!active||!iframe||e.source!==iframe.contentWindow||e.origin!=='null')return;
  var data=e.data;if(!data||data.schema!==protocol||typeof data.type!=='string')return;
  if(data.type==='lab:resize'){
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
    if(requested)runLab(requested);else showCatalog();
  }).catch(function(){ /* Silence is intentional on an unpublished surface. */ });
})();
