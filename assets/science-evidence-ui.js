(function(){
'use strict';
const E=window.GraviScienceBench;
if(!E){document.body.textContent='Scientific engine failed to load.';return;}
const $=id=>document.getElementById(id);
let last=null;
const labels={baseline:'Baseline',ai:'AI · speed only',rigor:'AI · scaled validation',flexibility:'AI · flexible analyses',corrected:'AI · Bonferroni corrected'};
const ids=Object.keys(labels);
const fmt=(n,k=1)=>Number(n).toLocaleString('en-US',{maximumFractionDigits:k,minimumFractionDigits:k});
function loadDefaults(){
 const defaults={prior:15,effect:.4,size:64,alpha:5,multiplier:2.5,days:60,runs:120,seed:20261029};
 for(const [id,value] of Object.entries(defaults))$(id).value=value;
}
function params(){
 return E.validate({
 truthPrior:Number($('prior').value)/100,effect:Number($('effect').value),
 n:Number($('size').value),alpha:Number($('alpha').value)/100,
 aiMultiplier:Number($('multiplier').value),days:Number($('days').value),
 runs:Number($('runs').value),seed:Number($('seed').value)
 });
}
function cell(row,label){
 const c=document.createElement('td');c.textContent=label;row.append(c);
}
function metric(m){
 return fmt(m.mean,1)+' ['+fmt(m.ci[0],1)+', '+fmt(m.ci[1],1)+']';
}
function bar(id,val,max){
 const item=document.createElement('div');item.className='bar';
 const head=document.createElement('div');head.className='bar-label';
 const title=document.createElement('span');title.textContent=labels[id];
 const number=document.createElement('strong');number.textContent=fmt(val.mean,1);
 head.append(title,number);
 const track=document.createElement('div');track.className='bar-track';
 const fill=document.createElement('div');fill.className='bar-fill';
 fill.style.setProperty('--w',fmt(max>0?100*val.mean/max:0,2)+'%');
 fill.title='95% simulation-run CI: '+fmt(val.ci[0],2)+' to '+fmt(val.ci[1],2);
 track.append(fill);item.append(head,track);return item;
}
function render(report){
 const all=report.scenarios,chart=$('chart'),rows=$('rows'),primary=$('primary');
 chart.replaceChildren();rows.replaceChildren();primary.replaceChildren();
 const max=Math.max(1,...ids.map(id=>all[id].trueConfirmed.mean));
 ids.forEach(id=>{
   chart.append(bar(id,all[id].trueConfirmed,max));
   const tr=document.createElement('tr');cell(tr,labels[id]);
   for(const metricKey of ['published','falsePublished','trueConfirmed','reviewBacklog']){
     const metricData=all[id][metricKey];
     const td=document.createElement('td');td.textContent=fmt(metricData.mean,1);
     td.title='95% run CI: '+fmt(metricData.ci[0],1)+' – '+fmt(metricData.ci[1],1);
     tr.append(td);
   }
   rows.append(tr);
 });
 for(const [label,value] of [
   ['Theoretical Type I error',fmt(100*report.mechanism.type1,1)+'%'],
   ['Analytical test power',fmt(100*report.mechanism.power,1)+'%'],
   ['Prior-based positive predictive value',fmt(100*report.mechanism.nominalPPV,1)+'%']
 ]){
   const card=document.createElement('div');card.className='num';
   const strong=document.createElement('strong');strong.textContent=value;
   const small=document.createElement('small');small.textContent=label;
   card.append(strong,small);primary.append(card);
 }
 primary.hidden=false;$('csv').disabled=false;
 $('execution').textContent=report.parameters.runs+' paired simulation runs, '+report.parameters.days+' days each. The same random seed set was used across scenarios.';
}
function exportCSV(report){
 const fields=['generated','published','falsePublished','truePublished','replicated','confirmed',
 'trueConfirmed','falseConfirmed','reviewBacklog','replicationBacklog'];
 const header=['model_version','scenario','paired_run','seed','days','truth_prior','effect','sample_n','alpha','ai_multiplier',...fields];
 const data=[header.join(',')];
 const p=report.parameters;
 ids.forEach(id=>{
   report.individual[id].forEach((x,i)=>{
     let seed=(p.seed+Math.imul(i,2654435761))>>>0||1;
     data.push([report.version,id,i+1,seed,p.days,p.truthPrior,p.effect,p.n,p.alpha,p.aiMultiplier,...fields.map(k=>x[k])].join(','));
   });
 });
 const blob=new Blob([data.join('\n')+'\n'],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob);
 const anchor=document.createElement('a');
 anchor.href=url;anchor.download='graviquest-science-evidence-'+p.seed+'.csv';
 document.body.append(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(url),2000);
}
$('parameters').addEventListener('submit',e=>{
 e.preventDefault();
 const button=$('run');button.disabled=true;button.textContent='Computing paired simulations…';
 $('execution').textContent='Sampling independent evidence and replications…';
 setTimeout(()=>{
   try{last=E.benchmark(params());render(last);}
   catch(err){$('execution').textContent='Cannot run: '+err.message;}
   finally{button.disabled=false;button.innerHTML='Run experiment <span>→</span>';}
 },25);
});
$('reset').addEventListener('click',()=>{loadDefaults();$('execution').textContent='Defaults restored. Run the experiment to update results.';});
$('csv').addEventListener('click',()=>{if(last)exportCSV(last);});
$('ask').addEventListener('click',async()=>{
 const input=$('question'),q=input.value.trim(),source=$('provider'),answer=$('answer');
 if(!q){source.textContent='Enter a question about the experiment.';return;}
 if(!last){source.textContent='Run the experiment first to give Pulsar grounded metrics.';return;}
 const b=$('ask');b.disabled=true;source.textContent='Requesting GraviQuest Pulsar…';answer.textContent='';
 const p=last.parameters,a=last.scenarios;
 // Backend intentionally treats supplied numbers as client-reported telemetry,
 // not verified research results. Never present a scripted fallback as AI.
 const context=' Synthetic model: prior='+fmt(p.truthPrior,2)+', n='+p.n+
 ', alpha='+fmt(p.alpha,3)+', baseline confirmed='+fmt(a.baseline.trueConfirmed.mean,1)+
 ', AI confirmed='+fmt(a.ai.trueConfirmed.mean,1)+
 ', AI false published='+fmt(a.ai.falsePublished.mean,1)+
 '. State uncertainty; no empirical calibration.';
 const question=(q+context).slice(0,450);
 const metrics={hypotheses:Math.round(a.ai.generated.mean),published:Math.round(a.ai.published.mean),
 false_claims:Math.round(a.ai.falsePublished.mean),replications:Math.round(a.ai.confirmed.mean),
 true_discoveries:Math.round(a.ai.trueConfirmed.mean),baseline_discoveries:Math.round(a.baseline.trueConfirmed.mean),
 review_backlog:Math.round(a.ai.reviewBacklog.mean),sample_size:p.n,alpha:p.alpha,prior:p.truthPrior};
 try{
   const res=await fetch('/api/labs/science-universe/coach/',{
     method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({event:'ask',section:'compare',question,metrics,locale:'en'})
   });
   const data=await res.json();
   if(!res.ok||!data.ok)throw Error(data.error||'unavailable');
   answer.textContent=String(data.reply||'No reply');
   source.textContent=data.provider==='script'?'Guided note · AI unavailable or not configured':
     'Pulsar live · '+String(data.provider||'configured model')+
     (data.run_id?' · run '+String(data.run_id).slice(0,12):'');
 }catch(err){source.textContent='Pulsar could not answer: '+err.message;}
 finally{b.disabled=false;}
});
$('question').addEventListener('keydown',e=>{if(e.key==='Enter')$('ask').click();});
// No auto-run: the user explicitly controls experiments and expenditures.
})();
