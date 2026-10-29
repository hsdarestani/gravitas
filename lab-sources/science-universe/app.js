/* Science Universe — interactive frontend. Every statistic comes from engine.js. */
(function(){
'use strict';
const E=window.ScienceUniverseEngine;
if(!E)throw Error('Science Universe engine missing');
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
const domainColors=['#65b6cf','#95aadf','#bea0ef','#d5ac6f'];
const domainNames=E.DOMAINS;
const G=window.GraviLab||{register:()=>{},emit:()=>{},onControl:()=>{},onCommand:()=>{},onLayer:()=>{},onSection:()=>{}};
const worlds=[E.make(20261029),null],selected=[null,null],eventSeen=[new Set(),new Set()];
let active=0,playing=false,compareMode=false,view='labs',plot='published',speed=3;
let show={links:true,flows:true,labels:true},drag=null,lastSimulation=performance.now(),raf=0;
let currentSection='observe',lastBridge=0,drawerOpen=false,latestFirst=true;
const policyDescriptions={
  generation:['Hypothesis generation','Rate of candidate research questions'],
  verification:['Peer review capacity','Number of manuscript reviews per day'],
  replication:['Replication capacity','Number of independent repeat tests'],
  funding:['Research funding','Daily flow of research credits'],
  aiAdoption:['AI workforce','AI share of idea generation'],
  alpha:['Statistical leniency','Larger values increase the false-positive chance'],
  sampleSize:['Sample size','Larger studies detect nonzero effects more often'],
  transparency:['Open methods','Reduces modeled analytical flexibility'],
  diversity:['Exploration diversity','Promotes out-of-specialty search'],
  pressure:['Publication pressure','Rewards positive results over careful restraint'],
  network:['Knowledge diffusion','Speed of attention and citation cascades'],
  uncertainty:['Uncertainty disclosure','Pedagogical control, currently non-causal'],
};
const human=n=>Math.round(n).toLocaleString('en-US');
const nowWorld=()=>worlds[active];
const runningWorlds=()=>compareMode&&worlds[1]?worlds:[nowWorld()];
function emit(event,s=nowWorld(),section=currentSection){
  if(performance.now()-lastBridge<650&&event!=='policy_changed')return;
  lastBridge=performance.now();
  const m=E.summary(s);
  G.emit(event,{
    day:m.day,hypotheses:m.generated,experiments:m.tested,published:m.published,
    live_papers:m.healthyPapers,false_claims:m.falsePublished,
    replications:m.replicated,retractions:m.retracted,
    review_backlog:m.reviewBacklog,citations:m.citations,
    replication_queue:m.replicationBacklog
  },section);
}
function play(on){
  playing=!!on;
  $('play').textContent=playing?'Ⅱ Pause':'▶ Play';
  $('status-label').textContent=playing?'SIMULATION RUNNING':'SIMULATION PAUSED';
  $('session-state').classList.toggle('spinning',playing);
}
function reset(){
  const s=nowWorld();
  worlds[active]=E.make(s.seed,{...s.policy});
  selected[active]=null;eventSeen[active].clear();
  play(false);render();emit('world_reset',nowWorld(),'observe');
}
function chooseWorld(index){
  if(index===1&&!worlds[1])return;
  active=index;
  for(let i=0;i<2;i++){
    const b=$('world-'+(i?'b':'a'));
    b.classList.toggle('active',i===index);
    b.setAttribute('aria-pressed',String(i===index));
  }
  $('policy-world').textContent='EDITING WORLD '+(index?'B':'A');
  renderPolicies();render();
}
function compare(on){
  if(on&&!worlds[1])return;
  compareMode=!!on;
  $('canvas-holder-b').hidden=!compareMode;
  $('canvases').classList.toggle('split',compareMode);
  $('comparison').hidden=!compareMode;
  $('compare').textContent=compareMode?'◉ Comparison active':'Compare realities';
  $('compare').classList.toggle('active',compareMode);
  $('stage-title').textContent=compareMode?'Two worlds. One starting point.':'The research network';
  render();
}
function fork(){
  worlds[1]=E.fork(worlds[0]);
  selected[1]=selected[0];
  E.editPolicy(worlds[1],'verification',Math.min(10,worlds[1].policy.verification+3));
  E.editPolicy(worlds[1],'replication',Math.min(10,worlds[1].policy.replication+3));
  eventSeen[1]=new Set(worlds[1].events.map(e=>e.id));
  $('world-b').disabled=false;$('compare').disabled=false;
  compare(true);chooseWorld(1);
  emit('universe_forked',worlds[1],'compare');
}
function advance(n){
  for(const s of runningWorlds())E.step(s,n);
  render();interesting();
}
function summary(){
  const s=nowWorld(),m=E.summary(s);
  for(const [id,value] of Object.entries({
    day:String(m.day).padStart(3,'0'),agents:human(s.agents.length),
    hypotheses:human(m.generated),published:human(m.healthyPapers),
    replications:human(m.replicated),backlog:human(m.reviewBacklog)
  }))$(id).textContent=value;
}
function inspector(){
  const id=selected[active],s=nowWorld();
  $('inspector-start').hidden=id!==null;
  $('inspector-content').hidden=id===null;
  if(id===null)return;
  const l=s.labs[id];
  $('selected-domain').textContent=domainNames[l.domain].toUpperCase()+' / LAB '+String(l.id+1).padStart(2,'0');
  $('selected-title').textContent=l.name;
  $('selected-world').textContent='WORLD '+(active?'B':'A');
  $('selected-funds').textContent=human(l.budget);
  $('selected-agents').textContent=human(s.agents.filter(a=>a.labId===id).length);
  $('selected-methods').textContent=Math.round(l.method*100)+'%';
  $('selected-active').textContent=human(l.active);
  $('freeze-lab').textContent=l.locked?'Resume generation':'Pause generation';
  const agents=$('agent-list');agents.replaceChildren();
  for(const a of s.agents.filter(a=>a.labId===id)){
    const row=make('div','agent-row');
    row.append(make('span',a.role==='AI'?'role-ai':'role-human',a.role==='AI'?'AI':'H'),
      make('span','agent-name',a.name),make('span','agent-score',a.produced+' ideas'));
    agents.append(row);
  }
  const papers=$('paper-list');papers.replaceChildren();
  const list=l.papers.map(x=>s.hypotheses.find(h=>h.id===x)).filter(Boolean).slice(-7).reverse();
  if(!list.length)papers.append(make('p','empty','No published papers yet.'));
  for(const paper of list){
    const b=make('button','paper-row');b.type='button';
    b.append(make('strong','',paper.topic),make('small','',paper.retracted?'Withdrawn':
      paper.replications?'Repeated '+paper.replications+'×':'Not independently repeated'));
    b.addEventListener('click',()=>{
      const result=E.intervention(s,'replicate_paper',id,paper.id);
      $('intervention-status').textContent=result.ok?'Replication queued for '+paper.topic:result.error.replaceAll('_',' ');
      render();if(result.ok)emit('replication_requested',s,'verify');
    });
    papers.append(b);
  }
}
function feed(){
  const host=$('feed');host.replaceChildren();
  const events=latestFirst?nowWorld().events.slice(0,15):[...nowWorld().events].reverse().slice(0,15);
  for(const event of events){
    const button=make('button','feed-event');button.type='button';
    const cat=event.type.includes('retract')?'warning':event.type.includes('replication')?'verify':
      event.type.includes('published')?'published':'general';
    const detail=make('span','event-body');
    detail.append(make('strong','',event.text),make('small','',
      'DAY '+String(event.day).padStart(3,'0')+' · '+event.type.replaceAll('_',' ')));
    button.append(make('span','event-indicator '+cat),detail);
    if(Number.isInteger(event.labId)&&event.labId>=0)button.addEventListener('click',()=>{
      selected[active]=event.labId;inspector();
    });else button.disabled=true;
    host.append(button);
  }
}
function series(s){
  const history=s.history||[],current=E.summary(s);
  return history.length&&history[history.length-1].day===current.day?history:history.concat([current]);
}
function drawChart(){
  const canvas=$('history-chart'),ctx=canvas.getContext('2d');
  const r=canvas.getBoundingClientRect(),w=r.width,h=r.height,dpr=Math.min(2,window.devicePixelRatio||1);
  if(w<20||h<20)return;
  canvas.width=Math.floor(w*dpr);canvas.height=Math.floor(h*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const all=runningWorlds().map(series);
  const max=Math.max(1,...all.flat().map(x=>Number(x[plot])||0));
  const xmax=Math.max(1,...all.flat().map(x=>x.day||0));
  const left=39,top=13,cw=w-57,ch=h-43;
  ctx.strokeStyle='rgba(144,185,210,.16)';ctx.fillStyle='#9db7c9';
  ctx.font='10px system-ui';ctx.lineWidth=1;
  for(let i=0;i<4;i++){
    const y=top+ch*i/3;
    ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-10,y);ctx.stroke();
    ctx.fillText(human(max*(1-i/3)),2,y+3);
  }
  ctx.fillText('DAY 0',left,h-7);ctx.fillText('DAY '+xmax,Math.max(left,w-75),h-7);
  all.forEach((line,index)=>{
    if(line.length<1)return;
    ctx.strokeStyle=index?'#e5bb84':'#7abed5';ctx.lineWidth=2;ctx.beginPath();
    line.forEach((x,i)=>{
      const px=left+x.day/xmax*cw,py=top+ch-(Number(x[plot])||0)/max*ch;
      if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    });ctx.stroke();
  });
  $('plot-caption').textContent={
    published:'Cumulative publications. Acceptance is not independent proof.',
    falsePublished:'False claims still published, based on hidden SYNTHETIC ground truth.',
    reviewBacklog:'Manuscripts waiting for modelled peer review.'
  }[plot];
}
function comparison(){
  if(!worlds[1])return;
  const host=$('comparison-results'),a=E.summary(worlds[0]),b=E.summary(worlds[1]);
  host.replaceChildren();
  for(const [label,key,lowerBetter] of [
    ['Live published papers','healthyPapers',false],['False published claims','falsePublished',true],
    ['Independent replications','replicated',false],['Review backlog','reviewBacklog',true],
    ['Retracted papers','retracted',null],['Citation connections','citations',null]]){
    const delta=b[key]-a[key],row=make('div','comparison-row');
    let clazz='comparison-delta';
    if(lowerBetter!==null&&delta!==0)clazz+=((delta<0)===lowerBetter)?' better':' worse';
    row.append(make('span','comparison-label',label),make('strong','comparison-a',human(a[key])),
      make('strong','comparison-b',human(b[key])),
      make('span',clazz,(delta>0?'+':'')+human(delta)));
    host.append(row);
  }
  $('branch-explainer').textContent='WORLD A · Review '+worlds[0].policy.verification+'/10, replication '+
    worlds[0].policy.replication+'/10     |     WORLD B · Review '+
    worlds[1].policy.verification+'/10, replication '+worlds[1].policy.replication+'/10';
}
function render(){summary();inspector();feed();drawChart();comparison();}
function interesting(){
  const types=['paper_retracted','replication_failed','review_rejected','replication_passed','paper_published','hypothesis_generated'];
  const s=nowWorld(),seen=eventSeen[active];
  const items=s.events.filter(e=>types.includes(e.type)&&!seen.has(e.id));
  s.events.forEach(e=>seen.add(e.id));
  if(!items.length||s.day<=4)return;
  const best=items.sort((a,b)=>types.indexOf(a.type)-types.indexOf(b.type))[0];
  emit(best.type,s,best.type.includes('replication')||best.type.includes('retract')?'verify':
    best.type.includes('published')?'network':'discover');
}
function canvasGeometry(canvas){
  const r=canvas.getBoundingClientRect();if(r.width<3||r.height<3)return null;
  const dpr=Math.min(2,window.devicePixelRatio||1);
  if(canvas.width!==Math.round(r.width*dpr)||canvas.height!==Math.round(r.height*dpr)){
    canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);
  }
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,w:r.width,h:r.height,pad:28};
}
function position(l,g){return {x:g.pad+l.x*(g.w-g.pad*2),y:g.pad+l.y*(g.h-g.pad*2)};}
function draw(canvas,s,index,t){
  if(!s)return;
  const g=canvasGeometry(canvas);if(!g)return;
  const {ctx,w,h}=g;
  ctx.clearRect(0,0,w,h);
  const bg=ctx.createLinearGradient(0,0,w,h);
  bg.addColorStop(0,'#071a29');bg.addColorStop(.55,'#0b2839');bg.addColorStop(1,'#081525');
  ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='rgba(125,165,194,.09)';ctx.lineWidth=.7;
  for(let x=0;x<w;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  for(let y=0;y<h;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  if(show.links){
    for(const edge of s.links){
      const a=position(s.labs[edge.a],g),b=position(s.labs[edge.b],g);
      ctx.strokeStyle=view==='papers'?'rgba(222,183,123,.30)':'rgba(115,181,203,.23)';
      ctx.lineWidth=.6+edge.weight*1.1;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
  }
  if(show.flows&&s.links.length){
    for(let i=0;i<Math.min(120,s.links.length*2);i++){
      const edge=s.links[i%s.links.length],a=position(s.labs[edge.a],g),b=position(s.labs[edge.b],g);
      const f=(t*(.07+(i%7)*.012)+i*.127)%1;
      ctx.beginPath();ctx.arc(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f,i%5===0?2.2:1.1,0,6.283);
      ctx.fillStyle=view==='papers'?'rgba(223,189,134,.75)':'rgba(156,214,234,.75)';ctx.fill();
    }
  }
  s.labs.forEach((l,i)=>{
    const p=position(l,g),isSelected=selected[index]===i;
    const r=view==='papers'?Math.min(22,6+Math.sqrt(l.papers.length)*2):Math.min(18,7+Math.sqrt(l.active+1)*1.4);
    const halo=ctx.createRadialGradient(p.x,p.y,1,p.x,p.y,34);
    halo.addColorStop(0,domainColors[l.domain]+'33');halo.addColorStop(1,'transparent');
    ctx.fillStyle=halo;ctx.beginPath();ctx.arc(p.x,p.y,34,0,6.283);ctx.fill();
    if(isSelected){
      ctx.strokeStyle='#f4d7a3';ctx.lineWidth=1.6;
      ctx.beginPath();ctx.arc(p.x,p.y,r+10+Math.sin(t*2),0,6.283);ctx.stroke();
    }
    ctx.fillStyle=l.locked?'#385365':'#0e3045';ctx.strokeStyle=domainColors[l.domain];ctx.lineWidth=1.5;
    ctx.beginPath();ctx.arc(p.x,p.y,r,0,6.283);ctx.fill();ctx.stroke();
    ctx.fillStyle=domainColors[l.domain];ctx.beginPath();ctx.arc(p.x,p.y,2.8,0,6.283);ctx.fill();
    if(view==='labs'&&show.flows){
      const agents=s.agents.filter(a=>a.labId===i);
      agents.forEach((a,j)=>{
        const ang=t*(a.role==='AI'?.59:.31)+j*2.4+a.id*.1;
        const orbit=r+8+(j%3)*4;
        ctx.fillStyle=a.role==='AI'?'#e4c789':'#a5d4e7';
        ctx.beginPath();ctx.arc(p.x+Math.cos(ang)*orbit,p.y+Math.sin(ang)*orbit,1.8,0,6.283);ctx.fill();
      });
    }
    if(show.labels&&(isSelected||w>340||i%3===0)){
      ctx.fillStyle=isSelected?'#fff8e9':'rgba(218,234,243,.82)';
      ctx.font=isSelected?'600 11px system-ui':'10px system-ui';ctx.textAlign='center';
      ctx.fillText(l.name,p.x,p.y-r-10);
    }
  });
  if(view==='papers'){
    ctx.textAlign='left';ctx.font='10px system-ui';ctx.fillStyle='rgba(210,228,241,.8)';
    ctx.fillText(s.papers.length+' published · '+s.stats.citations+' citations',16,h-14);
  }
}
function drawMap(time){
  if(compareMode&&worlds[1]){
    draw($('network-a'),worlds[0],0,time);
    draw($('network-b'),worlds[1],1,time);
  }else draw(active===0?$('network-a'):$('network-b'),worlds[active],active,time);
}
function nearest(s,g,x,y){
  let best=-1,d=24;
  for(const l of s.labs){const p=position(l,g),r=Math.hypot(p.x-x,p.y-y);if(r<d){best=l.id;d=r;}}
  return best;
}
function canvasEvents(index){
  const canvas=$('network-'+(index?'b':'a'));canvas.tabIndex=0;
  const local=e=>{const b=canvas.getBoundingClientRect();return {x:e.clientX-b.left,y:e.clientY-b.top};};
  canvas.addEventListener('pointerdown',e=>{
    if(index===1&&!worlds[1])return;
    chooseWorld(index);
    const p=local(e),id=nearest(nowWorld(),canvasGeometry(canvas),p.x,p.y);
    selected[index]=id<0?null:id;
    if(id>=0){drag={index,id,start:p,moved:false};canvas.setPointerCapture(e.pointerId);}
    inspector();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag||drag.index!==index)return;
    const p=local(e);
    if(Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>8)drag.moved=true;
    if(drag.moved){
      const g=canvasGeometry(canvas),l=nowWorld().labs[drag.id];if(!g)return;
      l.x=Math.max(.04,Math.min(.96,(p.x-g.pad)/(g.w-g.pad*2)));
      l.y=Math.max(.07,Math.min(.93,(p.y-g.pad)/(g.h-g.pad*2)));
    }
  });
  canvas.addEventListener('pointerup',()=>{
    if(!drag||drag.index!==index)return;
    if(drag.moved){
      const l=worlds[index].labs[drag.id];
      E.intervention(worlds[index],'move',drag.id,{x:l.x,y:l.y});
      $('intervention-status').textContent='Network connections recomputed.';
      emit('collaboration_changed',worlds[index],'network');
    }
    drag=null;inspector();
  });
  canvas.addEventListener('pointercancel',()=>drag=null);
  canvas.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();chooseWorld(index);
    const delta=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;
    selected[index]=selected[index]===null?0:(selected[index]+delta+28)%28;
    inspector();
  });
}
function changeLab(action){
  const id=selected[active];if(id===null)return;
  const result=E.intervention(nowWorld(),action,id);
  $('intervention-status').textContent=result.ok?'Intervention applied. Observe subsequent simulated outcomes.':
    result.error.replaceAll('_',' ');
  render();if(result.ok)emit(action==='audit'?'replication_requested':
    action==='fund'?'funding_changed':'method_changed',nowWorld(),'intervene');
}
function renderPolicies(){
  const host=$('policy-controls');host.replaceChildren();
  for(const [key,value] of Object.entries(nowWorld().policy)){
    const [name,hint]=policyDescriptions[key];
    const line=make('label','policy-control');
    const head=make('div','policy-name');
    head.append(make('strong','',name),make('output','',value+'/10'));
    const range=make('input');range.type='range';range.min=1;range.max=10;range.step=1;range.value=value;
    range.dataset.policy=key;
    range.addEventListener('input',()=>{
      E.editPolicy(nowWorld(),key,range.value);
      head.querySelector('output').textContent=range.value+'/10';
      emit('policy_changed',nowWorld(),'intervene');comparison();
    });
    line.append(head,make('p','',hint),range);host.append(line);
  }
}
function settings(on){
  drawerOpen=!!on;$('policy-drawer').hidden=!on;
  if(on){renderPolicies();$('close-settings').focus();}else $('settings').focus();
}
function setView(name){
  view=name;
  for(const key of ['labs','papers']){
    $('view-'+key).classList.toggle('active',name===key);
    $('view-'+key).setAttribute('aria-pressed',String(name===key));
  }
}
function bridge(){
  G.register({section:'observe',controls:[
    {key:'generation',label:'Generation speed',min:1,max:10,step:1,value:nowWorld().policy.generation},
    {key:'verification',label:'Review capacity',min:1,max:10,step:1,value:nowWorld().policy.verification},
    {key:'replication',label:'Replication capacity',min:1,max:10,step:1,value:nowWorld().policy.replication},
    {key:'ai_adoption',label:'AI adoption',min:1,max:10,step:1,value:nowWorld().policy.aiAdoption},
  ],layers:[
    {key:'links',label:'Collaborations',enabled:true},
    {key:'flows',label:'Moving agents',enabled:true},
    {key:'labels',label:'Labels',enabled:true},
  ]});
  G.onControl(({key,value})=>{
    const field=key==='ai_adoption'?'aiAdoption':key;
    if(E.editPolicy(nowWorld(),field,value)){renderPolicies();comparison();emit('policy_changed',nowWorld(),'intervene');}
  });
  G.onCommand(cmd=>{
    if(cmd==='play')play(true);if(cmd==='pause')play(false);
    if(cmd==='reset'||cmd==='replay'){reset();if(cmd==='replay')play(true);}
  });
  G.onLayer(({key,enabled})=>{
    if(Object.prototype.hasOwnProperty.call(show,key)){
      show[key]=!!enabled;$('layer-'+key).checked=!!enabled;
    }
  });
  G.onSection(section=>{
    currentSection=section;
    if(section==='verify')setView('papers');
    if(section==='network')setView('labs');
    if(section==='compare'&&worlds[1])compare(true);
  });
  emit('world_started',nowWorld(),'observe');
}
function bind(){
  $('play').addEventListener('click',()=>play(!playing));
  $('advance').addEventListener('click',()=>advance(10));
  $('reset').addEventListener('click',reset);
  $('speed').addEventListener('change',e=>speed=Number(e.target.value)||1);
  $('world-a').addEventListener('click',()=>chooseWorld(0));
  $('world-b').addEventListener('click',()=>chooseWorld(1));
  $('fork').addEventListener('click',fork);
  $('compare').addEventListener('click',()=>compare(!compareMode));
  $('close-compare').addEventListener('click',()=>compare(false));
  $('view-labs').addEventListener('click',()=>setView('labs'));
  $('view-papers').addEventListener('click',()=>setView('papers'));
  $('fund-lab').addEventListener('click',()=>changeLab('fund'));
  $('method-lab').addEventListener('click',()=>changeLab('method'));
  $('audit-lab').addEventListener('click',()=>changeLab('audit'));
  $('freeze-lab').addEventListener('click',()=>changeLab('freeze'));
  for(const name of ['links','flows','labels'])
    $('layer-'+name).addEventListener('change',e=>show[name]=e.target.checked);
  document.querySelectorAll('[data-plot]').forEach(b=>b.addEventListener('click',()=>{
    plot=b.dataset.plot;document.querySelectorAll('[data-plot]').forEach(x=>{
      x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));
    });drawChart();
  }));
  $('settings').addEventListener('click',()=>settings(true));
  $('close-settings').addEventListener('click',()=>settings(false));
  $('drawer-close-area').addEventListener('click',()=>settings(false));
  $('policy-reset').addEventListener('click',()=>{
    for(const [k,v] of Object.entries(E.DEFAULTS))E.editPolicy(nowWorld(),k,v);
    renderPolicies();comparison();emit('policy_changed',nowWorld(),'intervene');
  });
  const dialog=$('method-dialog');
  $('methodology').addEventListener('click',()=>dialog.showModal());
  $('method-close').addEventListener('click',()=>dialog.close());
  $('method-done').addEventListener('click',()=>dialog.close());
  $('pause-feed').addEventListener('click',()=>{
    latestFirst=!latestFirst;
    $('pause-feed').textContent=latestFirst?'Latest first':'Oldest first';feed();
  });
  window.addEventListener('resize',drawChart,{passive:true});
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&drawerOpen)settings(false);
    if(e.code==='Space'&&e.target===document.body){e.preventDefault();play(!playing);}
  });
  canvasEvents(0);canvasEvents(1);
}
function animation(now){
  if(playing&&now-lastSimulation>=250){
    const chunks=Math.min(4,Math.floor((now-lastSimulation)/250));
    lastSimulation+=chunks*250;
    for(const s of runningWorlds())E.step(s,speed*chunks);
    render();interesting();
  }
  if(!playing)lastSimulation=now;
  drawMap(now/1000);
  raf=requestAnimationFrame(animation);
}
bind();render();bridge();
raf=requestAnimationFrame(animation);
window.addEventListener('pagehide',()=>cancelAnimationFrame(raf),{once:true});
})();
