'use strict';
/* Browser-test adapter: averages actual stored atlas executions, never invented outcomes. */
exports.compareStored=(runs,policy='verification',low=3,high=9)=>{
 const rows=runs.filter(r=>r.family==='baseline'||r.family==='single:'+policy),reference=rows[0];
 if(!reference||low===high||low<1||high>10)return null;
 const fixed=Object.keys(reference.parameters).filter(k=>k!==policy),groups=new Map();
 for(const row of rows){if(![low,high].includes(row.parameters[policy])||fixed.some(k=>row.parameters[k]!==reference.parameters[k]))continue;
  const key=JSON.stringify([row.seed,row.days,row.design]);if(!groups.has(key))groups.set(key,{});groups.get(key)[row.parameters[policy]]=row;
 }
 const pairs=[...groups.values()].filter(g=>g[low]&&g[high]).map(g=>({seed:g[low].seed,days:g[low].days,design:g[low].design,a:g[low],b:g[high]}));
 if(!pairs.length)return null;
 const avg=a=>a.reduce((x,y)=>x+y,0)/a.length,metrics={};
 for(const metric of ['published','falsePublished','replicated','reviewBacklog','healthyPapers','generated','tested','retracted','citations','falseDiscoveryRate']){
  if(!pairs.every(p=>['a','b'].every(s=>Number.isFinite(p[s].result[metric]))))continue;
  const a=pairs.map(p=>p.a.result[metric]),b=pairs.map(p=>p.b.result[metric]),delta=b.map((v,i)=>v-a[i]);metrics[metric]={a:avg(a),b:avg(b),delta:avg(delta),delta_min:Math.min(...delta),delta_max:Math.max(...delta)};
 }
 const trajectory=pairs[0].a.trajectory.map(row=>{const point={day:row.day,a:{},b:{}};for(const side of ['a','b'])for(const metric of Object.keys(metrics)){const values=pairs.map(p=>p[side].trajectory.find(t=>t.day===row.day)?.[metric]);if(values.every(Number.isFinite))point[side][metric]=avg(values);}return point;});
 return {ok:true,engine_sha:reference.engine_sha,policy,low,high,matched_seeds:pairs.length,days:pairs[0].days,metrics,trajectory,pairs,provenance:'stored_model_execution',limitations:'Paired synthetic model runs. Sampled seed spread is not a confidence interval or empirical evidence.'};
};
