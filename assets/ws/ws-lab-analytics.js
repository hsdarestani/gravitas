/* Lab usage belongs to the shared admin workspace. No private chat text is requested. */
import * as K from './ws-admin-kit.js?v=20261016-task1';
const {el}=K,BASE='/api/platform/admin/labs/usage/';
const N=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:1});
const duration=s=>{s=Math.round(Number(s)||0);return s>=3600?Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m':s>=60?Math.floor(s/60)+'m '+s%60+'s':s+'s';};
const stamp=s=>s?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tehran',dateStyle:'medium',timeStyle:'short'}).format(new Date(s)):'—';
const LABELS={opened:'Lab opened',closed:'Lab closed',play:'Simulation played',pause:'Simulation paused',step:'Model time advanced',reset:'Simulation reset',comparison_created:'Comparison created',comparison_viewed:'Comparison viewed',atlas_replayed:'Stored comparison replayed',parameter_changed:'Parameter changed',laboratory_moved:'Laboratory moved',view_changed:'Map view changed',guide_started:'Guide started',guide_step:'Guide control opened',guide_test:'Guided comparison tested',guide_completed:'Guide completed',guide_skipped:'Guide skipped',atlas_opened:'Scenario atlas opened',atlas_compared:'Stored comparison viewed',sources_opened:'Scientific sources opened',source_read:'Scientific source read',snapshot_requested:'Snapshot requested',snapshot_saved:'Snapshot saved',pulsar_question:'Pulsar question received',pulsar_answered:'Pulsar answered',pulsar_failed:'Pulsar could not answer',trial_exhausted:'Guest account invitation reached'};
const POLICIES={verification:'Peer review capacity',generation:'Idea generation',replication:'Independent repeats',funding:'Research funding',aiAdoption:'AI-assisted generation',sampleSize:'Sample size',alpha:'Statistical threshold',transparency:'Open methods',pressure:'Publication pressure',diversity:'Search across communities',network:'Knowledge diffusion',uncertainty:'AI caution'};
async function get(suffix='',params=new URLSearchParams()){
 const r=await fetch(BASE+suffix+'?'+params,{credentials:'same-origin',cache:'no-store'});
 const data=await r.json();if(!r.ok)throw Error(r.status===401||r.status===403?'Core admin access is required.':data.error||'Usage data could not be loaded.');return data;
}
function table(headers,rows){const wrap=el('div','ls-usage-table-wrap'),t=el('table','ls-usage-table'),head=el('thead'),h=el('tr');headers.forEach(x=>h.append(el('th',null,x)));head.append(h);const body=el('tbody');for(const cells of rows){const r=el('tr');for(const cell of cells){const td=el('td');td.append(cell instanceof Node?cell:document.createTextNode(String(cell??'—')));r.append(td);}body.append(r);}t.append(head,body);wrap.append(t);return wrap;}
function nameCell(row){const n=el('div','ls-usage-person');n.append(el('strong',null,row.user?.name||'Guest '+row.guest_id));if(row.user)n.append(el('small',null,row.user.email||row.user.username));else n.append(el('small',null,'Pseudonymous browser identifier'));return n;}
function pager(host,data,onPage){if(data.pages<=1)return;const p=el('div','ls-usage-pager');const prev=K.button('Previous',()=>onPage(data.page-1),{tiny:true}),next=K.button('Next',()=>onPage(data.page+1),{tiny:true});prev.disabled=data.page<=1;next.disabled=data.page>=data.pages;p.append(prev,el('span',null,'Page '+data.page+' / '+data.pages+' · '+N(data.total)+' records'),next);host.append(p);}
function tiles(host,items){const grid=el('div','ls-usage-stats');for(const [label,value,note] of items){const tile=el('article','ls-usage-stat');tile.append(el('span',null,label),el('strong',null,value));if(note)tile.append(el('small',null,note));grid.append(tile);}host.append(grid);}
function chart(data,period){
 const ns='http://www.w3.org/2000/svg',section=el('section','ls-usage-chart');section.append(K.heading('Tracked sessions over time'),el('p','ls-note','By session start date · Tehran time'));
 const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 800 210');svg.setAttribute('role','img');svg.setAttribute('aria-label','Lab sessions by start date');
 const source=new Map(data.map(x=>[x.day,x.sessions])),start=new Date(period.from+'T00:00:00Z'),end=new Date(period.to+'T00:00:00Z'),days=[];
 for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1))days.push({day:d.toISOString().slice(0,10),sessions:source.get(d.toISOString().slice(0,10))||0});
 const bucket=Math.max(1,Math.ceil(days.length/90)),bins=[];for(let i=0;i<days.length;i+=bucket){const part=days.slice(i,i+bucket);bins.push({from:part[0].day,to:part.at(-1).day,n:part.reduce((s,x)=>s+x.sessions,0)});}
 const max=Math.max(3,Math.ceil(Math.max(0,...bins.map(x=>x.n))/3)*3),width=720/Math.max(1,bins.length);
 for(let i=0;i<4;i++){const line=document.createElementNS(ns,'path');line.setAttribute('d','M45 '+(15+i*50)+'H775');line.setAttribute('class','ls-usage-grid-line');svg.append(line);const text=document.createElementNS(ns,'text');text.setAttribute('x','3');text.setAttribute('y',String(19+i*50));text.textContent=N(max*(1-i/3));svg.append(text);}
 bins.forEach((bin,i)=>{const r=document.createElementNS(ns,'rect'),title=document.createElementNS(ns,'title');r.setAttribute('x',String(47+i*width));r.setAttribute('y',String(165-bin.n/max*150));r.setAttribute('width',String(Math.max(1,width-3)));r.setAttribute('height',String(bin.n/max*150));r.setAttribute('rx','2');r.setAttribute('class','ls-usage-bar');title.textContent=bin.from+(bin.from!==bin.to?' – '+bin.to:'')+': '+bin.n+' sessions';r.append(title);svg.append(r);});
 for(const [label,x,anchor] of [[period.from,45,'start'],[period.to,775,'end']]){const t=document.createElementNS(ns,'text');t.setAttribute('x',String(x));t.setAttribute('y','200');t.setAttribute('text-anchor',anchor);t.textContent=label;svg.append(t);}section.append(svg);if(bucket>1)section.append(el('p','ls-note','Bars group '+bucket+' days.'));return section;
}

export function renderLabUsage(host,{labId='',labs=[]}={}){
 host.replaceChildren();let generation=0,currentPage=1;
 const form=el('div','ls-usage-filters'),lab=K.select([['','All Labs'],...labs.map(x=>[String(x.id),x.title])],String(labId||'')),audience=K.select([['all','Members and guests'],['members','Members only'],['guests','Guests only']],'all');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),before=new Date(today+'T00:00:00Z');before.setUTCDate(before.getUTCDate()-29);
 const from=K.input(before.toISOString().slice(0,10),'date'),to=K.input(today,'date'),query=K.input('','search','Name, email or guest identifier');
 for(const [node,label] of [[lab,'Analytics Lab'],[audience,'Visitor type'],[from,'From date'],[to,'To date'],[query,'Search visitors']])node.setAttribute('aria-label',label);
 const apply=K.button('Apply filters',()=>load(1),{solid:true,type:'button',tiny:true}),csv=K.anchor('Export CSV','#',{tiny:true}),saved=K.button('Saved-user records',()=>showSaved(1),{tiny:true});
 form.append(K.fields([K.field('Lab',lab),K.field('Visitor type',audience),K.field('From',from),K.field('To',to),K.field('Search',query)]),K.cardActions([apply,csv,saved]));
 const status=K.status(),view=el('div','ls-usage-content');host.append(form,status,view);
 const params=(page=1)=>new URLSearchParams({lab:lab.value,audience:audience.value,from:from.value,to:to.value,q:query.value.trim(),page:String(page),tz:'Asia/Tehran'});
 function back(label,action){const bar=el('div','ls-usage-detail-head');bar.append(K.button('Back to '+label,action,{tiny:true}));view.append(bar);}
 async function load(page=1){const turn=++generation;currentPage=page;apply.disabled=true;K.setStatus(status,'Loading usage…');
  try{const data=await get('',params(page));if(turn!==generation||!host.isConnected)return;view.replaceChildren();
   const s=data.summary;tiles(view,[['Tracked Lab sessions',N(s.sessions),'Visitors who opted in'],['Signed-in users',N(s.member_users),'Verified account identities'],['Guest browsers',N(s.guest_visitors),'Pseudonymous identifiers'],['Active time',duration(s.active_seconds),'Foreground with recent interaction'],['Matched experiments',N(s.comparisons),'Created, replayed or guided tests'],['Pulsar answers',N(s.pulsar_answers),N(s.pulsar_questions)+' questions · '+N(s.pulsar_failures)+' failures'],['Completed guides',N(s.completed_guides),N(s.guide_tests)+' guided comparisons'],['Saved snapshots',N(s.snapshots),'Server-confirmed saves in tracked sessions']]);
   view.append(chart(data.daily,data.period));
   const coverage=el('details','ls-usage-coverage'),summary=el('summary',null,'What these statistics cover');coverage.append(summary,...Object.values(data.coverage).filter(Boolean).map(x=>el('p','ls-note',x)));view.append(coverage);
   if(data.by_lab.length>1)view.append(K.heading('By Lab'),table(['Lab','Sessions','Active time','Experiments','Pulsar answers'],data.by_lab.map(r=>[r.lab__title,N(r.sessions),duration(r.active_seconds),N(r.comparisons),N(r.pulsar_answers)])));
   view.append(K.heading('People and guests in tracked sessions'));
   if(!data.visitors.items.length)view.append(K.empty('No tracked sessions match these filters. Visitors can opt in using Share usage statistics in the Lab. Earlier untracked visits are not reconstructed.'));
   else view.append(table(['Visitor','Sessions','Active time','Experiments','Guide tests','Pulsar answers','Last seen',''],data.visitors.items.map(r=>[nameCell(r),N(r.sessions),duration(r.active_seconds),N(r.comparisons),N(r.guide_tests),N(r.pulsar_answers),stamp(r.last_seen),K.button('View activity',()=>showVisitor(r,1),{tiny:true})])));
   pager(view,data.visitors,load);const records=data.saved_records_all_time;tiles(view,[['Existing saved snapshots',N(records.snapshots),'All time · selected Lab'],['Saved conversations',N(records.conversations),'All time · account-owned threads'],['Guest questions answered',N(records.guest_questions),'All time · stored trial counters']]);
   const exportParams=params(1);exportParams.set('format','csv');csv.href=BASE+'?'+exportParams;K.setStatus(status,'Updated · dates and times shown in Tehran time.','ok');
  }catch(error){if(turn===generation)K.setStatus(status,error.message,'bad');}finally{if(turn===generation)apply.disabled=false;}
 }
 async function showVisitor(row,page=1){const turn=++generation;K.setStatus(status,'Loading sessions…');const p=params(page);p.set('visitor',row.identity);
  try{const data=await get('visits/',p);if(turn!==generation||!host.isConnected)return;view.replaceChildren();back('usage overview',()=>load(currentPage));view.append(K.heading(row.user?.name||'Guest '+row.guest_id));if(row.user?.email)view.append(el('p','ls-note',row.user.email));
   if(!data.items.length)view.append(K.empty('No tracked sessions in this range. Saved records are shown separately.'));
   for(const visit of data.items){const card=el('article','ls-usage-session');card.append(el('h4',null,visit.lab.title+' · v'+visit.published_version),el('p','ls-note',stamp(visit.started_at)+' · '+visit.device+' · '+visit.browser+' / '+visit.operating_system));
    card.append(K.kv({'Active time':duration(visit.active_seconds),'Last seen':stamp(visit.last_seen_at),'Experiments':N(visit.comparisons),'Parameter changes':N(visit.policy_changes),'Guide tests':N(visit.guide_tests),'Pulsar answers':N(visit.pulsar_answers),'Pulsar failures':N(visit.pulsar_failures),'Saved snapshots':N(visit.snapshots)}),K.button('View events',()=>showEvents(visit,row,page,1),{tiny:true}));view.append(card);}
   pager(view,data,p=>showVisitor(row,p));K.setStatus(status,'Sessions loaded.','ok');
  }catch(error){if(turn===generation)K.setStatus(status,error.message,'bad');}
 }
 async function showEvents(visit,owner,ownerPage,page){const turn=++generation;K.setStatus(status,'Loading session events…');
  try{const data=await get('visits/'+encodeURIComponent(visit.id)+'/',new URLSearchParams({page:String(page)}));if(turn!==generation||!host.isConnected)return;view.replaceChildren();back('visitor sessions',()=>showVisitor(owner,ownerPage));view.append(K.heading(visit.lab.title+' · session activity'),el('p','ls-note',stamp(visit.started_at)+' · '+(visit.user?.name||'Guest '+visit.guest_id)));
   if(!data.events.items.length)view.append(K.empty('No interaction events have arrived for this session.'));
   const list=el('ol','ls-usage-events');for(const e of data.events.items){const item=el('li'),head=el('div','ls-usage-event-head');head.append(el('strong',null,LABELS[e.kind]||e.kind.replaceAll('_',' ')),K.badge(e.provenance==='server_confirmed'?'Server confirmed':'Browser reported',e.provenance==='server_confirmed'?'ok':''));item.append(head,el('small',null,'Received '+stamp(e.received_at)));const d=e.data,detail={};if(d.parameter)detail.Parameter=POLICIES[d.parameter]||d.parameter.replaceAll('_',' ');for(const [key,label] of [['world','World'],['day','Model day'],['days','Model days advanced'],['step','Guide control'],['value','Value'],['low','World A setting'],['high','World B setting'],['view','Map view'],['document','Scientific source'],['laboratory','Laboratory'],['provider','Pulsar provider'],['error','Service status'],['seed','Model seed']])if(d[key]!==undefined)detail[label]=d[key];if(Object.keys(detail).length)item.append(K.kv(detail));list.append(item);}view.append(list);pager(view,data.events,p=>showEvents(visit,owner,ownerPage,p));K.setStatus(status,'Activity loaded. Questions and conversation text are not included in usage analytics.','ok');
  }catch(error){if(turn===generation)K.setStatus(status,error.message,'bad');}
 }
 async function showSaved(page){const turn=++generation;K.setStatus(status,'Loading saved-user records…');const p=new URLSearchParams({lab:lab.value,q:query.value.trim(),page:String(page)});
  try{const data=await get('saved/',p);if(turn!==generation||!host.isConnected)return;view.replaceChildren();back('usage overview',()=>load(currentPage));view.append(K.heading('Saved-user records'),el('p','ls-note','All time for the selected Lab. These are existing account-owned service records, separate from optional visit analytics. Message counts describe currently saved history, not total historical AI usage. Conversation text is not shown.'));
   if(!data.items.length)view.append(K.empty('No saved account records for this Lab.'));
   else view.append(table(['Account','Snapshots','Threads','Saved messages','Last saved'],data.items.map(r=>[nameCell({user:r.user}),N(r.snapshots),N(r.conversations),N(r.saved_messages),stamp(r.last_saved)])));
   pager(view,data,showSaved);K.setStatus(status,'Saved records loaded.','ok');
  }catch(error){if(turn===generation)K.setStatus(status,error.message,'bad');}
 }
 form.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();load(1);}});load();return {refresh:()=>load(1)};
}
