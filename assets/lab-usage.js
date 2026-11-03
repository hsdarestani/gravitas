/* First-party Lab analytics. Never sends chat text, names, email, IP or raw UA. */
(function(root){
'use strict';
const KINDS=new Set(['opened','closed','play','pause','step','reset','comparison_created','comparison_viewed','atlas_replayed','parameter_changed','laboratory_moved','view_changed','guide_started','guide_step','guide_test','guide_completed','guide_skipped','atlas_opened','atlas_compared','sources_opened','source_read','snapshot_requested']);
const uuid=()=>crypto.randomUUID?crypto.randomUUID():'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.random()*16|0;return(c==='x'?n:(n&3|8)).toString(16);});
function start(lab){
 let id=uuid(),queue=[],active=0,lastTick=performance.now(),lastInput=lastTick,
     wasActive=document.visibilityState==='visible'&&document.hasFocus(),busy=false,ended=false,
     allowed=root.GravitasConsent?.analyticsAllowed()===true,initialized=false;
 let closingRetry=false;
 const pending=new Map(),url='/api/labs/'+encodeURIComponent(lab.slug)+'/usage/';
 function sample(){const now=performance.now();if(allowed&&wasActive)active+=Math.min(20,Math.max(0,(Math.min(now,lastInput+90000)-lastTick)/1000));lastTick=now;wasActive=document.visibilityState==='visible'&&document.hasFocus();}
 function clean(raw){const out={};if(!raw||typeof raw!=='object')return out;
  for(const k of ['parameter','document','view','provider','error'])if(typeof raw[k]==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(raw[k]))out[k]=raw[k];
  for(const k of ['value','from','day','days','step','seed','low','high','laboratory'])if(typeof raw[k]==='number'&&Number.isFinite(raw[k])&&Math.abs(raw[k])<=1e12)out[k]=raw[k];
  if(['A','B'].includes(raw.world))out.world=raw.world;return out;
 }
 function record(kind,data){if(ended||!allowed||!KINDS.has(kind))return;queue.push({id:uuid(),kind,data:clean(data)});if(queue.length>100)queue.shift();if(queue.length>=20)flush();}
 function debounced(kind,data){if(!allowed||ended)return;const key=kind+':'+(data?.parameter||'');clearTimeout(pending.get(key)?.timer);pending.set(key,{kind,data,timer:setTimeout(()=>{pending.delete(key);record(kind,data);flush();},700)});}
 function drain(){for(const [key,item] of pending){clearTimeout(item.timer);queue.push({id:uuid(),kind:item.kind,data:clean(item.data)});pending.delete(key);}}
 async function flush(){sample();drain();if(busy||!allowed)return;const batch=queue.splice(0,30),visit=id;if(!batch.length&&!wasActive&&!ended)return;busy=true;
  try{const response=await fetch(url,{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({visit,active_seconds:Math.floor(active),events:batch})});
   if(visit!==id||!allowed)return;
   if(response.status===409){const data=await response.json();if(data.error==='visit_conflict'&&!ended){id=uuid();active=0;queue=[];initialized=false;record('opened');}}
   else if(response.status>=500)queue.unshift(...batch);
   else if(response.status===404){ended=true;dispose();}
   else if(response.ok)initialized=true;
  }catch(_){if(allowed)queue.unshift(...batch);}finally{queue=queue.slice(-100);busy=false;if(ended&&queue.length&&allowed&&!closingRetry){closingRetry=true;flush();}}
 }
 function input(){sample();lastInput=performance.now();}
 function visibility(){sample();if(document.visibilityState==='visible')lastInput=performance.now();flush();}
 function focus(){sample();if(document.hasFocus())lastInput=performance.now();flush();}
 const events=['pointerdown','keydown','wheel','touchstart'];
 function consent(){const next=root.GravitasConsent?.analyticsAllowed()===true;if(allowed===next)return;allowed=next;queue=[];for(const item of pending.values())clearTimeout(item.timer);pending.clear();active=0;initialized=false;lastTick=lastInput=performance.now();if(allowed){id=uuid();record('opened');flush();}}
 function storage(e){if(e.key==='gravitas:consent:v1')consent();}
 function dispose(){clearInterval(timer);events.forEach(k=>document.removeEventListener(k,input));document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',focus);window.removeEventListener('blur',focus);window.removeEventListener('pagehide',stop);window.removeEventListener('gravitas:consent',consent);window.removeEventListener('storage',storage);}
 function stop(){if(ended)return;sample();drain();record('closed');ended=true;dispose();flush();}
 const timer=setInterval(()=>{sample();if(wasActive||queue.length)flush();},15000);
 events.forEach(k=>document.addEventListener(k,input,{passive:true}));document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',focus);window.addEventListener('blur',focus);window.addEventListener('pagehide',stop);window.addEventListener('gravitas:consent',consent);window.addEventListener('storage',storage);
 record('opened');if(allowed)flush();return {record,debounced,flush,stop,visit:()=>allowed&&initialized?id:null};
}
function privacyControl(host){
 const label=document.createElement('label');label.className='lab-usage-choice';
 const input=document.createElement('input');input.type='checkbox';input.checked=root.GravitasConsent?.analyticsAllowed()===true;
 const text=document.createElement('span');text.textContent='Share usage statistics (optional)';
 label.title='Shares interaction counts and active time with platform admins. For members this is linked to the account; guests use a random ID. Message text is excluded. You can turn this off at any time.';
 input.addEventListener('change',()=>{if(input.checked)root.GravitasConsent?.allowAnalytics();else root.GravitasConsent?.necessaryOnly();});
 label.append(input,text);host.append(label);
 function refresh(e){if(e?.type==='storage'&&e.key!=='gravitas:consent:v1')return;
  if(!label.isConnected){window.removeEventListener('gravitas:consent',refresh);window.removeEventListener('storage',refresh);return;}
  input.checked=root.GravitasConsent?.analyticsAllowed()===true;
 }
 window.addEventListener('gravitas:consent',refresh);window.addEventListener('storage',refresh);return label;
}
root.GraviLabUsage={start,privacyControl};
})(window);
