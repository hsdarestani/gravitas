/* Science Universe v1 — deterministic, fully synthetic agent-based research ecosystem.
   No empirical calibration; do not generalise simulated outcomes to real-world science.
   Pure model: no DOM, network, credentials or calls to AI services. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.ScienceUniverseEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const DOMAINS=['Biology','Climate','Physics','Materials'];
const BASE_RATES=[.28,.36,.31,.42];
const DEFAULTS=Object.freeze({
  generation:5,verification:5,replication:4,funding:6,aiAdoption:6,
  alpha:5,sampleSize:5,transparency:5,diversity:5,pressure:5,
  network:5,uncertainty:5,
});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const avg=(a)=>a.length?a.reduce((p,c)=>p+c,0)/a.length:0;
const rnd=(s)=>{let x=s.rng|0;x^=x<<13;x^=x>>>17;x^=x<<5;s.rng=x|0;return (s.rng>>>0)/4294967296;};
const choice=(s,arr)=>arr[Math.floor(rnd(s)*arr.length)];
const fixed=(n,k=2)=>Math.round(n*10**k)/10**k;
const NEWS_MAX=75, HYPO_MAX=950;
function make(seed=21061,policy={}){
  const state={seed:seed>>>0,rng:(seed>>>0)||1,day:0,policy:{...DEFAULTS,...policy},
    labs:[],agents:[],papers:[],links:[],hypotheses:[],events:[],history:[],nextId:1,
    pool:250,stats:{generated:0,tested:0,published:0,rejected:0,replicated:0,
      retracted:0,falsePublished:0,truePublished:0,spent:0,citations:0,replicationFailures:0},
    queues:{review:[],replication:[]},selected:0,
  };
  // Four fields, seven labs each. Positions are intentionally stable.
  for(let i=0;i<28;i++){
    const d=i%4,ring=Math.floor(i/4),angle=d*Math.PI/2+ring*.21,rad=.18+ring*.095;
    const l={
      id:i,domain:d,name:['Helix','Stratus','Axiom','Lattice'][d]+' '+String(ring+1).padStart(2,'0'),
      x:clamp(.5+rad*Math.cos(angle)+(.5-rnd(state))*.045,.07,.93),
      y:clamp(.5+rad*Math.sin(angle)+(.5-rnd(state))*.045,.10,.90),
      budget:35+Math.floor(rnd(state)*35),method:fixed(.3+rnd(state)*.65),
      caution:fixed(.2+rnd(state)*.75),ai:fixed(.2+rnd(state)*.75),
      output:0,verified:0,failed:0,papers:[],active:0,locked:false,
    };state.labs.push(l);
    const count=3+Math.floor(rnd(state)*3);
    for(let j=0;j<count;j++){
      const role=rnd(state)<.48?'AI':'Human';
      state.agents.push({
        id:state.agents.length,labId:i,role,domain:d,
        rigour:fixed(.32+rnd(state)*.62),creativity:fixed(.25+rnd(state)*.74),
        speed:fixed(.35+rnd(state)*.65),produced:0,name:(role==='AI'?'Agent ':'Researcher ')+(state.agents.length+1),
      });
    }
  }
  rebuildLinks(state);
  event(state,'world_started',null,'A research world with 28 laboratories and '+state.agents.length+' agents was initialized.');
  snapshot(state);
  return state;
}
function rebuildLinks(s){
  let edges=[];
  for(let i=0;i<s.labs.length;i++)for(let j=i+1;j<s.labs.length;j++){
    let a=s.labs[i],b=s.labs[j];
    const dist=Math.hypot(a.x-b.x,a.y-b.y);
    if((a.domain===b.domain&&dist<.49)||(dist<.24&&rnd(s)<.74))
      edges.push({a:i,b:j,weight:fixed(clamp(1.1-dist*1.6,.12,1),3)});
  }
  s.links=edges;
}
function event(s,type,labId,text,extra={}){
  const item={id:s.nextId++,day:s.day,type,labId,text,...extra};
  s.events.unshift(item);
  if(s.events.length>NEWS_MAX)s.events.length=NEWS_MAX;
  return item;
}
function snapshot(s){
  s.history.push({day:s.day,...summary(s)});
  if(s.history.length>260)s.history.shift();
}
function summary(s){
  const st=s.stats,queue=s.queues;
  return {
    day:s.day,generated:st.generated,tested:st.tested,published:st.published,
    rejected:st.rejected,retracted:st.retracted,replicated:st.replicated,
    falsePublished:st.falsePublished,truePublished:st.truePublished,
    falseDiscoveryRate:st.published?fixed(st.falsePublished/st.published*100,1):0,
    citations:st.citations,reviewBacklog:queue.review.length,
    replicationBacklog:queue.replication.length,spent:fixed(st.spent,0),
    meanBudget:fixed(avg(s.labs.map(l=>l.budget)),1),
    healthyPapers:st.published-st.retracted,
  };
}
function domainBase(s,d){
  // Diversity changes search on novel, low-prior questions; not objective truth.
  return clamp(BASE_RATES[d]+(.5-s.policy.diversity/10)*.06,.1,.8);
}
function generate(s,lab,agent){
  const aiMultiplier=agent.role==='AI'?(.35+s.policy.aiAdoption/10):(.65+(10-s.policy.aiAdoption)/22);
  // AI agents with higher uncertainty disclosure can abstain instead of
  // generating a weakly grounded candidate. This is a model assumption.
  const abstention=agent.role==='AI'?clamp(1-.075*(s.policy.uncertainty-1)*(1-agent.rigour),.47,1):1;
  const chance=abstention*(.02+s.policy.generation*.022)*agent.speed*aiMultiplier*
    (.6+lab.ai*.6)*(lab.locked?.17:1)*(lab.budget>1?1:.05);
  if(rnd(s)>chance)return;
  const novelty=rnd(s)<(s.policy.diversity/16);
  const domain=novelty?Math.floor(rnd(s)*4):lab.domain;
  const actual=rnd(s)<domainBase(s,domain);
  const effect=actual?(.24+rnd(s)*.68):0;
  const inquiry={
    id:s.nextId++,labId:lab.id,agentId:agent.id,domain,
    topic:'Hypothesis '+String(s.stats.generated+1).padStart(4,'0'),
    truth:actual,effect,novelty,
    status:'testing',created:s.day,complete:s.day+2+Math.floor(rnd(s)*7),
    tested:false,significant:false,published:false,retracted:false,
    replications:0,failedReplications:0,citations:0,reason:'',
  };
  lab.budget=clamp(lab.budget-(.4+s.policy.sampleSize*.16),0,500);
  s.stats.spent+=.4+s.policy.sampleSize*.16;
  agent.produced++;lab.output++;lab.active++;s.hypotheses.push(inquiry);s.stats.generated++;
  if(s.stats.generated%25===1)event(s,'hypothesis_generated',lab.id,lab.name+' proposed '+inquiry.topic,{hypothesisId:inquiry.id});
}
function statisticalTest(s,h,independent=false){
  const lab=s.labs[h.labId];
  // Under the null, type-I error is alpha; under an effect the probability
  // of detection grows with sample size, signal and scientific rigor.
  const alpha=clamp(.005*Math.pow(2,s.policy.alpha*.43),.007,.18);
  const n=18+s.policy.sampleSize*16;
  const effectiveN=n*(.75+lab.method*.4)*(independent?(.86+s.policy.replication*.025):1);
  const signal=h.effect*Math.sqrt(effectiveN)/3.7;
  const power=clamp(.035+.91*(1-Math.exp(-signal*signal/3)),alpha,.992);
  const fishing=independent?0:Math.max(0,(s.policy.pressure-5))*.008*(1-s.policy.transparency/13);
  const prob=h.truth?power:clamp(alpha+fishing,0,.30);
  return rnd(s)<prob;
}
function processTesting(s){
  for(const h of s.hypotheses){
    if(h.status!=='testing'||h.complete>s.day)continue;
    const lab=s.labs[h.labId];
    if(lab)lab.active=Math.max(0,lab.active-1);
    h.tested=true;h.significant=statisticalTest(s,h);
    s.stats.tested++;
    if(h.significant){
      h.status='review';s.queues.review.push(h.id);
    } else {
      h.status='rejected';h.reason='No statistically detectable effect in the synthetic test';
      s.stats.rejected++;
      if(s.stats.rejected%35===0)event(s,'hypothesis_rejected',h.labId,'An experiment rejected a candidate',{hypothesisId:h.id});
    }
  }
}
function find(s,id){return s.hypotheses.find(h=>h.id===id);}
function publish(s,h){
  h.published=true;h.status='published';h.publishedOn=s.day;
  s.papers.push(h.id);s.labs[h.labId].papers.push(h.id);s.stats.published++;
  if(h.truth)s.stats.truePublished++;else s.stats.falsePublished++;
  const e=event(s,'paper_published',h.labId,'Journal accepted '+h.topic,{hypothesisId:h.id});
  if(s.papers.length>1&&(s.stats.published%4===0))scheduleReplication(s,h.id,'journal');
  return e;
}
function processReview(s){
  // Capacity is not equal to throughput of generation.
  let capacity=Math.floor(1+s.policy.verification*.55);
  while(capacity--&&s.queues.review.length){
    const id=s.queues.review.shift(),h=find(s,id);if(!h||h.status!=='review')continue;
    const lab=s.labs[h.labId];
    const rigour=clamp(.16+s.policy.verification*.048+lab.method*.22+s.policy.transparency*.017-
      s.policy.pressure*.028,.08,.9);
    // A weak study's apparent significance can fool review. Review does not
    // have oracle access to ground truth; below is a conditional detection model.
    const criticalFailure=rnd(s)<(h.truth?(.045+(.8-lab.method)*.055):
      clamp(.08+rigour*.65,.06,.76));
    if(criticalFailure){
      h.status='rejected';h.reason='Rejected by independent methodological review';
      s.stats.rejected++;s.labs[h.labId].failed++;
      if(s.stats.rejected%23===0)event(s,'review_rejected',h.labId,'Peer review rejected a manuscript',{hypothesisId:h.id});
    } else publish(s,h);
  }
}
function scheduleReplication(s,id,reason){
  const h=find(s,id);
  if(!h||!h.published||h.retracted||s.queues.replication.some(r=>r.id===id))return false;
  s.queues.replication.push({id,due:s.day+3+Math.floor(rnd(s)*7),reason});
  return true;
}
function processReplication(s){
  const capacity=Math.floor(s.policy.replication/3)+1;
  const due=s.queues.replication.filter(q=>q.due<=s.day).slice(0,capacity);
  const selected=new Set(due.map(q=>q.id));
  s.queues.replication=s.queues.replication.filter(q=>!selected.has(q.id));
  for(const q of due){
    const h=find(s,q.id);if(!h||h.retracted)continue;
    const passes=statisticalTest(s,h,true);
    h.replications++;s.stats.replicated++;
    if(!passes){
      h.failedReplications++;s.stats.replicationFailures++;
      event(s,'replication_failed',h.labId,h.topic+' did not replicate',{hypothesisId:h.id});
      const threshold=s.policy.verification>=7?1:2;
      if(h.failedReplications>=threshold){
        h.retracted=true;h.status='retracted';
        if(h.truth)s.stats.truePublished--;else s.stats.falsePublished--;
        s.stats.retracted++;
        event(s,'paper_retracted',h.labId,h.topic+' was withdrawn after failed replication',{hypothesisId:h.id});
      }
    }else if(h.replications===1)event(s,'replication_passed',h.labId,h.topic+' replicated in a new synthetic test',{hypothesisId:h.id});
  }
}
function newCitations(s){
  if(s.papers.length<2)return;
  // Attention and network proximity shape citation cascades; not evidence quality.
  const attempts=Math.ceil(s.policy.network/2);
  for(let i=0;i<attempts;i++){
    const from=choice(s,s.labs);
    const pool=s.papers.slice(-260).map(id=>find(s,id)).filter(h=>h&&!h.retracted&&h.labId!==from.id);
    if(!pool.length)continue;
    const weighted=pool.map(h=>{
      const to=s.labs[h.labId],near=s.links.some(e=>
        (e.a===from.id&&e.b===to.id)||(e.b===from.id&&e.a===to.id));
      return (1+Math.sqrt(h.citations+1))*(near?1.7:1)*(h.domain===from.domain?1.8:.65);
    });
    let target=rnd(s)*weighted.reduce((a,b)=>a+b,0),h=pool[0];
    for(let j=0;j<pool.length;j++){target-=weighted[j];if(target<=0){h=pool[j];break;}}
    h.citations++;s.stats.citations++;
    if(rnd(s)<s.policy.replication*.012)scheduleReplication(s,h.id,'citation');
  }
}
function fund(s){
  const inflow=6+s.policy.funding*3;
  s.pool+=inflow;
  // Retain a central reserve for user-directed grants; automatic
  // distribution may spend at most 65% of each day's inflow.
  const perLab=Math.min(s.pool/s.labs.length,inflow*.65/s.labs.length);
  for(const l of s.labs){l.budget=clamp(l.budget+perLab,0,500);s.pool-=perLab;}
  s.pool=clamp(s.pool,0,10000);
}
function step(s,count=1){
  count=clamp(Math.floor(count),1,250);
  for(let k=0;k<count;k++){
    s.day++;fund(s);
    for(const agent of s.agents)generate(s,s.labs[agent.labId],agent);
    processTesting(s);processReview(s);processReplication(s);
    if(s.day%3===0)newCitations(s);
    if(s.day%4===0)snapshot(s);
    if(s.hypotheses.length>HYPO_MAX){
      // Do not discard live queues or published records. Trim only old rejects.
      let remove=s.hypotheses.length-HYPO_MAX;
      s.hypotheses=s.hypotheses.filter(h=>!(remove>0&&h.status==='rejected'&&h.created<s.day-20&&remove--));
    }
  }
  return s;
}
function intervention(s,action,labId,argument){
  const lab=s.labs[labId];
  if(!lab)return {ok:false,error:'lab_not_found'};
  if(action==='fund'){
    const qty=clamp(Number(argument)||15,1,60);
    if(s.pool<qty)return {ok:false,error:'insufficient_pool'};
    lab.budget+=qty;s.pool-=qty;
    event(s,'funding_changed',labId,lab.name+' received '+qty+' research credits');
  }else if(action==='audit'){
    const published=lab.papers.map(id=>find(s,id)).filter(h=>h&&!h.retracted);
    const target=published.slice(-1)[0];
    if(!target)return {ok:false,error:'no_published_paper'};
    if(!scheduleReplication(s,target.id,'manual'))return {ok:false,error:'already_under_review'};
    event(s,'replication_requested',labId,'Independent replication requested for '+target.topic,{hypothesisId:target.id});
  }else if(action==='freeze'){
    lab.locked=!lab.locked;event(s,'lab_paused',labId,lab.name+(lab.locked?' paused new hypotheses':' resumed discovery'));
  }else if(action==='method'){
    lab.method=clamp(lab.method+.15,.1,1);
    lab.budget=Math.max(0,lab.budget-10);
    event(s,'method_improved',labId,lab.name+' invested in methods training');
  }else if(action==='move'){
    lab.x=clamp(Number(argument?.x),.04,.96);
    lab.y=clamp(Number(argument?.y),.07,.93);
    rebuildLinks(s);
    event(s,'collaboration_changed',labId,lab.name+' changed network position');
  }else if(action==='replicate_paper'){
    const target=find(s,Number(argument));
    if(!target||!target.published||target.retracted)return {ok:false,error:'paper_not_available'};
    if(!scheduleReplication(s,target.id,'manual'))return {ok:false,error:'already_under_review'};
    event(s,'replication_requested',labId,'Independent replication requested for '+target.topic,{hypothesisId:target.id});
  }else return {ok:false,error:'unsupported_action'};
  return {ok:true};
}
function editPolicy(s,key,value){
  if(!Object.prototype.hasOwnProperty.call(DEFAULTS,key))return false;
  const num=Number(value);
  if(!Number.isFinite(num))return false;
  s.policy[key]=clamp(Math.round(num),1,10);
  return true;
}
function fork(s){
  return JSON.parse(JSON.stringify(s));
}
function researchBreakdown(s){
  const domains=DOMAINS.map((name,i)=>{
    const papers=s.hypotheses.filter(h=>h.domain===i&&h.published&&!h.retracted);
    return {name,domain:i,active:s.labs.filter(l=>l.domain===i).length,
      published:papers.length,falsePublished:papers.filter(h=>!h.truth).length,
      citations:papers.reduce((a,h)=>a+h.citations,0)};
  });
  return domains;
}
return {make,step,fork,summary,intervention,editPolicy,researchBreakdown,DOMAINS,DEFAULTS};
});
