/* Science Evidence Bench v1.
   Standard normal sampling and two-sided z tests with known population sigma=1.
   Coefficients are USER-DEFINED ASSUMPTIONS, not empirically calibrated estimates.
   Pure deterministic seeded model; no network, model services or user data. */
(function(root,factory){
  var m=factory();
  if(typeof module==='object'&&module.exports)module.exports=m;
  if(root)root.GraviScienceBench=m;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  var VERSION='1.0.0';
  function clamp(x,lo,hi){return Math.min(hi,Math.max(lo,x));}
  function seeded(seed,key){
    var str=String(seed)+':'+String(key),h=2166136261;
    for(var i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
    h=h>>>0;
    return function(){
      h+=0x6D2B79F5;var t=h;
      t=Math.imul(t^(t>>>15),t|1);
      t^=t+Math.imul(t^(t>>>7),t|61);
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }
  function normal(rng){
    var u=Math.max(1e-12,rng()),v=rng();
    return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
  }
  // Abramowitz-Stegun 7.1.26 approximation to Phi, max error ~7.5e-8.
  function cdf(x){
    var a=Math.abs(x),t=1/(1+0.2316419*a);
    var poly=t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    var phi=1-Math.exp(-a*a/2)/Math.sqrt(2*Math.PI)*poly;
    return clamp(x>=0?phi:1-phi,0,1);
  }
  function pTwoSided(z){return clamp(2*(1-cdf(Math.abs(z))),0,1);}
  function zCritical(alpha){
    var lo=0,hi=7;
    for(var i=0;i<64;i++){
      var mid=(lo+hi)/2;
      if(pTwoSided(mid)>alpha)lo=mid;else hi=mid;
    }
    return (hi+lo)/2;
  }
  function theoreticalPower(alpha,effect,n){
    var cut=zCritical(alpha),shift=effect*Math.sqrt(n);
    return clamp((1-cdf(cut-shift))+cdf(-cut-shift),0,1);
  }
  function validate(p){
    p=p||{};
    function num(key,def,lo,hi,integer){
      var v=p[key]===undefined?def:Number(p[key]);
      if(!Number.isFinite(v)||v<lo||v>hi||(integer&&!Number.isInteger(v)))throw Error('invalid_'+key);
      return v;
    }
    var workload=num('baseCandidates',4,1,30,true)*num('aiMultiplier',2.5,1,5)*
      num('days',60,5,365,true)*num('runs',120,10,400,true);
    if(workload>250000)throw Error('computation_budget_exceeded');
    return {
      truthPrior:num('truthPrior',.15,0,1),
      effect:num('effect',.4,0,2),
      n:num('n',64,8,2000,true),
      alpha:num('alpha',.05,.001,.2),
      baseCandidates:num('baseCandidates',4,1,30,true),
      aiMultiplier:num('aiMultiplier',2.5,1,5),
      reviewers:num('reviewers',6,1,100,true),
      replicationCapacity:num('replicationCapacity',2,1,100,true),
      analyses:num('analyses',1,1,8,true),
      correction:p.correction===undefined?'none':String(p.correction),
      days:num('days',60,5,365,true),
      runs:num('runs',120,10,400,true),
      seed:num('seed',20261029,1,4294967295,true)
    };
  }
  function check(p){if(p.correction!=='none'&&p.correction!=='bonferroni')throw Error('invalid_correction');return p;}
  function scenario(base,id){
    var s=Object.assign({},base);
    if(id==='baseline'){s.aiMultiplier=1;s.analyses=1;s.correction='none';}
    else if(id==='ai'){s.analyses=1;s.correction='none';}
    else if(id==='rigor'){s.analyses=1;s.correction='none';
      s.reviewers=Math.min(100,Math.ceil(base.reviewers*base.aiMultiplier));
      s.replicationCapacity=Math.min(100,Math.ceil(base.replicationCapacity*base.aiMultiplier));
    }
    else if(id==='flexibility'){s.analyses=4;s.correction='none';}
    else if(id==='corrected'){s.analyses=4;s.correction='bonferroni';}
    else throw Error('invalid_scenario');
    return s;
  }
  function resultFor(seed,day,slot,stage,truth,effect,n,analyses,threshold){
    // Independent normal outcomes for each prespecified or opportunistic analysis.
    // Each test's z = sqrt(n)*theta + N(0,1). The end-point independence
    // assumption is a controllable teaching simplification.
    var rng=seeded(seed,day+':'+slot+':'+stage);
    var best=1;
    for(var j=0;j<analyses;j++){
      var z=(truth?effect:0)*Math.sqrt(n)+normal(rng);
      best=Math.min(best,pTwoSided(z));
    }
    return {significant:best<=threshold,p:best};
  }
  function one(p,seed){
    p=check(validate(Object.assign({},p,{seed:seed})));
    var q=[],repeat=[],out={generated:0,tested:0,significant:0,published:0,
      truePublished:0,falsePublished:0,replicated:0,confirmed:0,trueConfirmed:0,falseConfirmed:0,
      reviewBacklog:0,replicationBacklog:0,publicationByLab:Array(28).fill(0)};
    var threshold=p.alpha/(p.correction==='bonferroni'?p.analyses:1);
    var total=Math.max(1,Math.round(p.baseCandidates*p.aiMultiplier));
    for(var day=1;day<=p.days;day++){
      for(var slot=0;slot<total;slot++){
        // Counterfactual pairing: common candidate truth and analytic random
        // streams for all arms wherever candidate (day,slot) overlaps.
        var truth=seeded(seed,day+':'+slot+':truth')()<p.truthPrior;
        var t=resultFor(seed,day,slot,'initial',truth,p.effect,p.n,p.analyses,threshold);
        out.generated++;out.tested++;
        if(t.significant){
          out.significant++;
          q.push({day:day,slot:slot,truth:truth,lab:(day+slot)%28});
        }
      }
      var available=p.reviewers;
      while(available-->0&&q.length){
        var paper=q.shift();
        out.published++;
        if(paper.truth)out.truePublished++;else out.falsePublished++;
        out.publicationByLab[paper.lab]++;
        repeat.push(Object.assign({due:day+3},paper));
      }
      var allowed=p.replicationCapacity,remaining=[];
      for(var k=0;k<repeat.length;k++){
        var study=repeat[k];
        if(study.due>day||allowed<=0){remaining.push(study);continue;}
        allowed--;out.replicated++;
        // A separate replication data draw, one prespecified primary analysis.
        var again=resultFor(seed,study.day,study.slot,'replication',study.truth,
          p.effect,p.n,1,p.alpha);
        if(again.significant){
          out.confirmed++;
          if(study.truth)out.trueConfirmed++;else out.falseConfirmed++;
        }
      }
      repeat=remaining;
    }
    out.reviewBacklog=q.length;out.replicationBacklog=repeat.length;
    out.publishedPPV=out.published?out.truePublished/out.published:null;
    out.confirmationPPV=out.confirmed?out.trueConfirmed/out.confirmed:null;
    out.truthAmongTests=p.truthPrior;
    return out;
  }
  function mean(x){return x.reduce(function(a,b){return a+b;},0)/x.length;}
  function summarise(data,key){
    var sample=data.map(function(x){return key===undefined?Number(x):x[key];});
    var n=sample.length,m=mean(sample);
    var sd=Math.sqrt(sample.reduce(function(a,b){return a+(b-m)*(b-m);},0)/(n-1));
    var se=sd/Math.sqrt(n);
    return {mean:m,sd:sd,ci:[m-1.96*se,m+1.96*se]};
  }
  function benchmark(raw){
    var p=check(validate(raw)),ids=['baseline','ai','rigor','flexibility','corrected'],series={};
    for(var i=0;i<ids.length;i++)series[ids[i]]=[];
    for(var run=0;run<p.runs;run++){
      var seed=(p.seed+Math.imul(run,2654435761))>>>0||1;
      for(var j=0;j<ids.length;j++)series[ids[j]].push(one(scenario(p,ids[j]),seed));
    }
    var metrics=['generated','published','falsePublished','truePublished',
      'confirmed','trueConfirmed','falseConfirmed','reviewBacklog','replicationBacklog'];
    var summary={};
    ids.forEach(function(id){
      summary[id]={};
      metrics.forEach(function(key){summary[id][key]=summarise(series[id],key);});
      ['trueConfirmed','falsePublished','published'].forEach(function(key){
        var delta=series[id].map(function(row,index){return row[key]-series.baseline[index][key];});
        summary[id][key+'Delta']=summarise(delta);
      });
    });
    var zPower=theoreticalPower(p.alpha,p.effect,p.n);
    return {version:VERSION,parameters:p,scenarios:summary,individual:series,
      mechanism:{type1:p.alpha,power:zPower,
        nominalPPV:p.truthPrior*zPower/(p.truthPrior*zPower+(1-p.truthPrior)*p.alpha),
        independentAnalysesFWER:1-Math.pow(1-p.alpha,4),
        bonferroniFWER:1-Math.pow(1-p.alpha/4,4)},
      evidenceStatus:'theory-grounded simulation; parameters not calibrated to real research',
      description:'Normal sampling with known variance, paired seeds, finite review and replication capacity'};
  }
  return {version:VERSION,cdf:cdf,pTwoSided:pTwoSided,zCritical:zCritical,
    theoreticalPower:theoreticalPower,validate:validate,scenario:scenario,
    resultFor:resultFor,one:one,benchmark:benchmark};
});
