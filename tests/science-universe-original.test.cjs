// The original 28-lab motor, not a separate scientific calculator.
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../lab-sources/science-universe/engine.js');
test('original universe still has 28 labs, AI/human agents and 12 policies',()=>{
 const s=E.make(20261029);
 assert.equal(s.labs.length,28);
 assert.ok(s.agents.length>90);
 assert.equal(Object.keys(s.policy).length,12);
 E.step(s,20);
 assert.equal(s.day,20);
 assert.ok(s.stats.generated>0);
});
test('Gaussian sampling has calibrated type I false positives for null',()=>{
 const s=E.make(9871),h={labId:0,truth:false,effect:0};
 const alpha=Math.max(.007,Math.min(.18,.005*Math.pow(2,s.policy.alpha*.43)));
 let positive=0;const n=20000;
 for(let i=0;i<n;i++)if(E.statisticalTest(s,h,true))positive++;
 assert.ok(Math.abs(positive/n-alpha)<.008,'Observed '+positive/n+' expected '+alpha);
});
test('independent study data are stochastic but runs reproducible by seed',()=>{
 const a=E.make(8888),b=E.make(8888);
 E.step(a,100);E.step(b,100);
 assert.deepEqual(E.summary(a),E.summary(b));
 assert.deepEqual(a.events,b.events);
});
test('theory-backed sampling reacts to stronger effects and larger samples',()=>{
 function power(sampleSize,effect){
   const s=E.make(2542,{sampleSize});
   const h={labId:0,truth:true,effect};
   let pass=0;
   for(let i=0;i<2000;i++)if(E.statisticalTest(s,h,true))pass++;
   return pass/2000;
 }
 assert.ok(power(9,.45)>power(2,.45));
 assert.ok(power(5,.45)>power(5,.1));
});
test('same normal CDF as reference statistical distribution',()=>{
 assert.ok(Math.abs(E.normalCDF(0)-.5)<1e-6);
 assert.ok(Math.abs(E.normalCDF(1.96)-.975)<.00005);
});

test('lab counts and AI roles are adjustable',()=>{
  const a=E.make(120,{}, {labsPerDomain:3,aiRoleFraction:0});
  const b=E.make(120,{}, {labsPerDomain:14,aiRoleFraction:1});
  assert.equal(a.labs.length,12);
  assert.equal(b.labs.length,56);
  assert.ok(a.agents.every(x=>x.role==='Human'));
  assert.ok(b.agents.every(x=>x.role==='AI'));
});
test('a review decision depends on evidence, not hidden truth',()=>{
  for(let seed=1;seed<=36;seed++){
    const a=E.make(seed);
    const h={id:999999,labId:0,status:'review',truth:true,
      documentedQuality:.42,registeredPlan:false,analyses:2,
      effect:.4,tested:true,significant:true,pValue:.03,
      retracted:false,replications:0,failedReplications:0,citations:0};
    a.hypotheses.push(h);
    a.queues.review.push(h.id);
    const b=E.fork(a);
    b.hypotheses[b.hypotheses.length-1].truth=false;
    E.step(a,1);E.step(b,1);
    assert.equal(a.hypotheses.find(x=>x.id===999999).status,
                 b.hypotheses.find(x=>x.id===999999).status);
  }
});

test('every policy and central design choice has an inspectable explanation',()=>{
 const fs=require('node:fs');
 const app=fs.readFileSync('lab-sources/science-universe/app.js','utf8');
 const html=fs.readFileSync('lab-sources/science-universe/index.html','utf8');
 const registry=app.slice(app.indexOf('const POLICY_RATIONALE='),
   app.indexOf('const human='));
 for(const key of Object.keys(E.DEFAULTS))
   assert.ok(registry.includes(key+':['),'missing rationale '+key);
 for(const term of ['labPopulation','aiFraction','prior','review','fork','citations'])
   assert.ok(app.includes("id:'"+term+"'"),'missing design rationale '+term);
 assert.match(html,/id="decision-registry"/);
 assert.match(html,/id="audit-labs"/);
 assert.match(html,/id="audit-ai-fraction"/);
 assert.doesNotMatch(app,/E\.editPolicy\(worlds\[1\],'verification'/);
});

test('moving one lab preserves unrelated links and the experiment random stream',()=>{
 const s=E.make(20261029),original=E.fork(s),rng=s.rng;
 E.intervention(s,'move',0,{x:.48,y:.48});
 assert.equal(s.rng,rng,'a layout intervention must not consume scientific samples');
 const unrelated=x=>x.links.filter(e=>e.a!==0&&e.b!==0);
 assert.deepEqual(unrelated(s),unrelated(original),'unmoved pairs cannot be rerolled');
 assert.notDeepEqual(s.links,original.links,'a changed network position is a real intervention');
 E.intervention(s,'move',0,{x:original.labs[0].x,y:original.labs[0].y});
 assert.deepEqual(s.links,original.links,'returning to the same positions restores the same topology');
});

test('a network connection changes numeric citation preference, not existing paper evidence',()=>{
 const s=E.make(20261029),from=s.labs[0],to=s.labs[4];
 const paper={labId:to.id,domain:to.domain,citations:0,truth:false,pValue:.03,effect:0};
 const evidence=JSON.stringify(paper);
 E.intervention(s,'move',from.id,{x:to.x>.5?.04:.96,y:to.y>.5?.07:.93});
 assert.ok(!s.links.some(e=>(e.a===from.id&&e.b===to.id)||(e.b===from.id&&e.a===to.id)));
 const far=E.citationWeight(s,from,paper);
 E.intervention(s,'move',from.id,{x:to.x,y:to.y});
 const near=E.citationWeight(s,from,paper);
 assert.ok(Math.abs(near/far-1.7)<1e-12);
 assert.equal(JSON.stringify(paper),evidence);
});

test('out-of-field research is an actual topic change and responds to exploration policy',()=>{
 const a=E.make(20261029,{diversity:1},{truthPriorOverride:.3});
 const b=E.make(20261029,{diversity:10},{truthPriorOverride:.3});
 E.step(a,90);E.step(b,90);
 const cross=s=>s.hypotheses.filter(h=>h.domain!==s.labs[h.labId].domain).length;
 assert.equal(E.summary(b).crossFieldStudies,cross(b));
 assert.ok(cross(b)>cross(a));
 assert.ok(b.hypotheses.some(h=>h.novelty&&h.domain===b.labs[h.labId].domain),'novelty alone is not proof of cross-field work');
});
