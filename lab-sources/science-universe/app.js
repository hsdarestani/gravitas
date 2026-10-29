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
const worlds=[E.make(20261029),null],selected=[null,null],selectedPaper=[null,null],eventSeen=[new Set(),new Set()];
let active=0,playing=false,compareMode=false,view='labs',plot='published',speed=3;
let show={links:true,flows:true,labels:true},drag=null,lastSimulation=performance.now(),raf=0;
let currentSection='observe',lastBridge=0,lastStateSent=0,drawerOpen=false,latestFirst=true;

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
  uncertainty:['AI abstention','Higher caution allows uncertain AI agents to hold back weak candidates'],
};
/* A citation supports the scientific *concept*, not our uncalibrated coefficient. */
const policyEvidence={
  generation:['Assumed rate; model-only coefficient',null],
  verification:['Theory-inspired review bottleneck; uncalibrated rate','https://doi.org/10.1098/rsos.160384'],
  replication:['Independent hypothesis testing; uncalibrated queue rate','https://doi.org/10.1126/science.aac4716'],
  funding:['Assumed resource response; not empirically calibrated',null],
  aiAdoption:['Assumed productivity multiplier; not a live LLM',null],
  alpha:['Grounded in statistical Type I error and multiple testing','https://doi.org/10.1371/journal.pmed.0020124'],
  sampleSize:['Grounded in known-variance z-test and statistical power','https://doi.org/10.1371/journal.pmed.0020124'],
  transparency:['Publication bias concept; uncalibrated effect','https://doi.org/10.1177/0956797611417632'],
  diversity:['Assumed exploration rate, not a measured scientific law',null],
  pressure:['Selective analysis mechanism; assumed number of analyses','https://doi.org/10.1177/0956797611417632'],
  network:['Attention propagation rule; uncalibrated weights',null],
  uncertainty:['Assumed AI abstention behavior, not measured',null],
};
/* A scientific rationale register, not an attempt to manufacture evidence.
   Source links support concepts; NO source validates our invented coefficients.
   Every assumption must state a reason, alternative and falsification plan. */
const DECISION_REGISTER=[
  {id:'purpose',group:'Research purpose',title:'Why model a research ecosystem?',
   kind:'hypothesis',why:'To illustrate how checking and publication bottlenecks interact with increased AI-assisted hypothesis throughput; this is not identical to a direct AI output trust test.',
   mechanism:'Idea production → evidence → review → replication → correction.',
   alternative:'The original Topic 01 Trust Test directly examines grounding, independent verification, uncertainty, distribution shift and accountability.',
   verify:'Sajad chooses a precise research question and checks whether an ecosystem model is necessary to answer it.',
   source:'https://github.com/hsdarestani/gravitas/blob/main/research/topics/ai-reliable-in-scientific-research/08-simulation.md'},
  {id:'domains',group:'Population and agents',title:'Why these four domains?',
   kind:'display',why:'They provide visibly different examples of research topics; they are not a representative scientific sample.',
   mechanism:'Four named categories, each assigned an equal number of labs.',
   alternative:'A single discipline, empirically sampled disciplines, or domain-neutral laboratories.',
   verify:'Check whether discipline labels change conclusions; if not, remove domain-specific truth priors.'},
  {id:'labPopulation',group:'Population and agents',title:'Why 28 laboratories?',
   kind:'display',why:'Four domains × seven nodes were chosen for a legible interactive network. There is no scientific optimum at 28.',
   mechanism:'Baseline 7 labs per domain; users can run the same model with another count.',
   alternative:'3, 7 or 14 labs per domain; compare normalized results over several random seeds.',
   verify:'Test output stability to lab count; report per-lab or per-study metrics rather than raw totals.'},
  {id:'teams',group:'Population and agents',title:'Why 3–5 agents per lab?',
   kind:'assumption',why:'A small heterogeneous team makes individual actions visible and keeps browser computation bounded; it does not reflect observed staffing.',
   mechanism:'Random team size within the configurable range.',
   alternative:'Empirical team-size distribution, or 1–12 actors per lab.',
   verify:'Compare outcomes over staffing distributions and keep research throughput per agent visible.'},
  {id:'aiFraction',group:'Population and agents',title:'Why approximately 48% synthetic AI agents?',
   kind:'assumption',why:'An illustrative split lets both agent types participate. 48% is not an observed prevalence of AI in science.',
   mechanism:'Bernoulli assignment at world creation; AI agents follow numerical rules rather than language models.',
   alternative:'0%, 25%, 50%, 75%, or 100% AI roles.',
   verify:'Use an explicitly specified AI adoption scenario and measure outcome sensitivity.'},
  {id:'prior',group:'Evidence and statistics',title:'Why different truth priors for each field?',
   kind:'assumption',why:'The default .28/.36/.31/.42 demonstrate the importance of pre-study probability, but no credible calibration supports these discipline rankings.',
   mechanism:'A synthetic Bernoulli ground-truth flag is sampled before an experiment.',
   alternative:'A uniform 10%, 30% or 50% truth prior; later estimate domain-specific priors from a justified dataset.',
   verify:'Change the prior and report sensitivity before drawing any interpretation.',
   source:'https://doi.org/10.1371/journal.pmed.0020124'},
  {id:'effects',group:'Evidence and statistics',title:'Why are true effect sizes 0.24–0.92?',
   kind:'assumption',why:'A simple range gives heterogeneous synthetic studies; its endpoints are not empirical estimates.',
   mechanism:'Uniformly generated positive effects; null effects are exactly zero.',
   alternative:'Log-normal, normal-mixture or empirically estimated effect-size distributions.',
   verify:'Compare statistical power and false discovery outcomes under alternative effect distributions.'},
  {id:'test',group:'Evidence and statistics',title:'Why a known-variance two-sided Z test?',
   kind:'theory',why:'It gives an interpretable baseline with an analytically checkable Type I error and test power.',
   mechanism:'Z = sqrt(n_eff) × effect + standard-normal noise; p=2[1−Phi(|Z|)].',
   alternative:'Estimated-variance t tests, correlated outcomes, multilevel models and real-data sampling.',
   verify:'Validate null rejection rate and power by Monte Carlo, then reproduce with independent R/Python code.',
   source:'https://doi.org/10.1371/journal.pmed.0020124'},
  {id:'sampleMapping',group:'Evidence and statistics',title:'Why does sample size use 18 + 16 × slider?',
   kind:'assumption',why:'This maps a small visual 1–10 scale into manageable sample sizes; 18 and 16 are not scientifically calibrated.',
   mechanism:'Effective sample also varies with the assumed lab method factor.',
   alternative:'Direct n with units, cost and feasible sample constraints.',
   verify:'Expose actual n and evaluate plausible sizes for the selected research domain.'},
  {id:'alpha',group:'Evidence and statistics',title:'Why this alpha mapping?',
   kind:'assumption',why:'Type I error is a valid statistical quantity, but the particular exponential mapping from a 1–10 slider is chosen for demonstrability.',
   mechanism:'alpha = clamp(.005 × 2^(0.43 × slider), .007, .18).',
   alternative:'Choose the actual alpha directly (e.g. .001, .01, .05).',
   verify:'Check null false-positive rates at every setting and document the actual threshold.'},
  {id:'flexibility',group:'Evidence and statistics',title:'Why multiple uncorrected analyses?',
   kind:'hypothesis',why:'Selecting the smallest p-value from more tests can inflate false-positive findings.',
   mechanism:'Publication pressure adds independent analyses; transparency may remove them. The number of analyses is assumed.',
   alternative:'Correlated candidate analyses, preregistration, and Bonferroni correction.',
   verify:'Compare family-wise error rates with theoretical values and other analysis-dependence assumptions.',
   source:'https://doi.org/10.1177/0956797611417632'},
  {id:'review',group:'Verification and correction',title:'Why use blinded evidence-based peer review?',
   kind:'hypothesis',why:'Reviewers cannot observe a hypothesis’s hidden truth. They can assess methods, preregistration, analysis selection and documentation.',
   mechanism:'Finite FIFO review capacity; an explicit assumed rejection function uses only observable quality signals.',
   alternative:'Multiple independent reviewers, disagreement, domain expertise, conflict-of-interest and noisy evaluation.',
   verify:'Prove via tests that changing hidden truth alone cannot change a review decision.',
   source:'https://doi.org/10.1098/rsos.160384'},
  {id:'replication',group:'Verification and correction',title:'Why independent replication?',
   kind:'theory',why:'Fresh independent evidence helps distinguish a robust effect from sampling noise.',
   mechanism:'Repeat studies draw a new random normal error and re-test significance.',
   alternative:'Different labs, instruments, protocols, shifted effect sizes and replication selection bias.',
   verify:'Use a study replication dataset to calibrate failure rates and evaluate statistical power.',
   source:'https://doi.org/10.1126/science.aac4716'},
  {id:'retraction',group:'Verification and correction',title:'Why withdraw after one or two failed repeats?',
   kind:'assumption',why:'This is an illustrative policy trigger, not a scientific consensus or real retraction protocol.',
   mechanism:'Threshold depends on Verification slider; failed replication does not imply a false claim.',
   alternative:'Evidence accumulation, editorial inquiry, investigation of errors, and severity-dependent decisions.',
   verify:'Remove fixed retraction certainty or validate decision processes with documented journal cases.'},
  {id:'funding',group:'Resources and incentives',title:'Why the 6+3×funding daily budget and 65% allocation?',
   kind:'assumption',why:'These maintain a replenishing resource pool with some grant flexibility; neither number is a measured funding response.',
   mechanism:'Budget enters a common pool and up to 65% is automatically allocated among labs.',
   alternative:'Realistic grant allocation data, dynamic delays, fixed budgets and inequitable funding distribution.',
   verify:'Stress-test 0 funding, scarce funding and abundant funding; inspect whether output scales plausibly.'},
  {id:'citations',group:'Networks and knowledge',title:'Why collaboration proximity and citation weights?',
   kind:'assumption',why:'The mechanism illustrates preferential attention and domain homophily, not experimentally validated citation behavior.',
   mechanism:'Link proximity, discipline match and existing citations change synthetic citation chance.',
   alternative:'Empirical collaboration/citation graphs and calibrated preferential-attachment models.',
   verify:'Fit network-level degree and citation distributions before making claims about actual diffusion.'},
  {id:'map',group:'Networks and knowledge',title:'Why can moving a map node change scientific collaboration?',
   kind:'display',why:'It is an interactive thought experiment, not a claim that physical or screen proximity causes scientific cooperation.',
   mechanism:'The simulator recomputes graph edges using displayed positions.',
   alternative:'Separate map layout from a scientifically defined collaboration graph.',
   verify:'If treating node movement as an intervention, state that it explicitly edits collaboration links rather than geography.'},
  {id:'fork',group:'Comparisons',title:'Why fork the same world?',
   kind:'theory',why:'Cloning the starting state and RNG supports controlled model counterfactual exploration.',
   mechanism:'World B copies all state. The current UI then adds +3 to Verification and +3 to Replication simultaneously.',
   alternative:'One-factor-at-a-time experiments and many paired seeds.',
   verify:'Use a single-intervention fork by default and repeat across seeds; a one-run A/B difference cannot establish causality.'},
  {id:'time',group:'Comparisons',title:'Why a simulated day and a fixed seed?',
   kind:'display',why:'A day is a computational step with user-controlled playback speed, not a calibrated calendar duration. A fixed seed makes repeated runs reproducible.',
   mechanism:'Discrete update schedule and seeded xorshift32 PRNG.',
   alternative:'Real event durations, discrete-event scheduling and independently derived seed ensembles.',
   verify:'Test deterministic reruns and sensitivity to duration assumptions.'},
  {id:'measurement',group:'Comparisons',title:'Why these dashboard outcomes?',
   kind:'theory',why:'Publications, false published claims, independent tests, withdrawals and queues distinguish research quantity from evidence quality.',
   mechanism:'Counters are program state, with a hidden truth flag for simulation evaluation only.',
   alternative:'Primary endpoint: true discoveries independently confirmed per tested hypothesis; report confidence intervals across seeds.',
   verify:'Pre-register metrics, denominators, queue censoring and uncertainty before comparing interventions.'},
  {id:'pulsar',group:'Assistant and governance',title:'Why is Pulsar part of the Lab?',
   kind:'display',why:'A scientific guide can help users distinguish evidence, hypotheses and assumptions without simplifying the simulator.',
   mechanism:'Event-based shared coaching API; responses may be live model output or explicitly labeled fallback.',
   alternative:'Static methodology guide only, or a reviewed research protocol coach.',
   verify:'Evaluate explanation correctness, source fidelity, history retention and hallucination rate with the science lead.'}
];
const POLICY_RATIONALE={
  generation:['assumption','Idea generation can vary across groups; the exact per-day chance is hand-chosen.','Count tested hypotheses per agent and compare rates across scenarios.'],
  verification:['assumption','Review throughput and rigor are distinguishable bottlenecks; daily capacity formula is uncalibrated.','Vary review headcount and quality independently.'],
  replication:['assumption','Replication is independent evidence; current scheduling and capacity values are arbitrary.','Compare workload-adjusted replication rates and selection rules.'],
  funding:['assumption','Resources affect which experiments can be run; the credit-to-output relation is a hypothesis.','Estimate a realistic funding response or show broad sensitivity bands.'],
  aiAdoption:['assumption','AI roles allow a productivity counterfactual; the numeric productivity effect is invented.','Vary AI shares and productivity separately, including zero AI.'],
  alpha:['theory','The concept of statistical Type I error is real; its 1–10 mapping is invented.','Display the implied alpha and test null calibration.'],
  sampleSize:['theory','Larger n improves power for fixed nonzero effects under the assumed Z-test; n mapping is invented.','Vary n explicitly and compare observed vs theoretical power.'],
  transparency:['hypothesis','Preregistration and transparent analysis can reduce selective reporting; coefficient is invented.','Test effects with and without multiple comparisons.'],
  diversity:['assumption','Out-of-field exploration is a conceivable mechanism; its causal benefit is not established here.','Vary novelty independently and test if conclusions reverse.'],
  pressure:['hypothesis','Incentives may increase selective analysis; the threshold and slope are assumed.','Compare preregistered vs selection-adjusted significance.'],
  network:['assumption','Collaboration/citation networks matter, but our drawn-distance coefficients are not measured.','Compare random, empirical and domain-homophily graphs.'],
  uncertainty:['hypothesis','AI abstention is a meaningful conceptual response to uncertainty; its numerical rate is assumed.','Assess false outputs and missed true candidates across abstention rates.']
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
/* Real selected-state telemetry. A metric called live_papers is a COUNT,
   never an addressable list of papers. No fabricated selection is sent. */
function publishContext(force=false){
  if(typeof G.context!=='function')return;
  const now=performance.now();
  if(!force&&now-lastStateSent<1600)return;
  lastStateSent=now;
  const s=nowWorld(),m=E.summary(s),labId=selected[active];
  const lab=Number.isInteger(labId)?s.labs[labId]:null;
  const paperId=selectedPaper[active],paper=paperId===null?null:
    s.hypotheses.find(h=>h.id===paperId&&h.published&&h.labId===labId);
  G.context({
    world:active===0?'A':'B',day:s.day,playing:playing,
    view:view,lab:lab?{id:lab.id,name:lab.name,domain:E.DOMAINS[lab.domain],
      paperCount:lab.papers.length}:null,
    paper:paper?{id:paper.id,title:paper.topic,labId:paper.labId,
      status:paper.retracted?'withdrawn':'published',
      replications:paper.replications||0,
      pValue:Number.isFinite(paper.pValue)?paper.pValue:null}:null,
    published:m.published,falseClaims:m.falsePublished,reviewBacklog:m.reviewBacklog,
    replications:m.replicated,policies:{...s.policy},hasFork:!!worlds[1],
    capabilities:['inspect_lab','select_paper','replicate_selected_paper',
      'compare_worlds','run_guided_scenario']
  });
}
function play(on){
  playing=!!on;
  $('play').textContent=playing?'Ⅱ Pause':'▶ Play';
  $('status-label').textContent=playing?'SIMULATION RUNNING':'SIMULATION PAUSED';
  $('session-state').classList.toggle('spinning',playing);
}
function reset(){
  const s=nowWorld();
  worlds[active]=E.make(s.seed,{...s.policy},{...s.design});
  selected[active]=null;selectedPaper[active]=null;eventSeen[active].clear();
  play(false);render();emit('world_reset',nowWorld(),'observe');
}
function arrangeCanvases(){
  $('canvas-holder-a').hidden=!compareMode&&active===1;
  $('canvas-holder-b').hidden=!compareMode&&active===0;
  $('canvases').classList.toggle('split',compareMode);
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
  arrangeCanvases();renderPolicies();render();publishContext(true);
}
function compare(on){
  if(on&&!worlds[1])return;
  compareMode=!!on;
  arrangeCanvases();
  $('comparison').hidden=!compareMode;
  $('compare').textContent=compareMode?'◉ Comparison active':'Compare realities';
  $('compare').classList.toggle('active',compareMode);
  $('stage-title').textContent=compareMode?'Two worlds. One starting point.':'The research network';
  render();
}
function fork(){
  worlds[1]=E.fork(worlds[0]);
  selected[1]=selected[0];selectedPaper[1]=selectedPaper[0];
  // Scientifically defensible baseline: B starts IDENTICALLY.
  // Do not silently change two different variables; the user chooses one.
  eventSeen[1]=new Set(worlds[1].events.map(e=>e.id));
  $('world-b').disabled=false;$('compare').disabled=false;
  compare(true);chooseWorld(1);
  $('branch-explainer').textContent='World B is an identical checkpoint. Change ONE policy in B to test a single assumed mechanism; repeat with different seeds before interpreting the result.';
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
  if(id===null){publishContext();return;}
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
  if(!list.length)papers.append(make('p','empty','No published papers yet. Advance days or choose a lab with papers.'));
  for(const paper of list){
    const b=make('button','paper-row');b.type='button';
    b.setAttribute('aria-pressed',String(selectedPaper[active]===paper.id));
    if(selectedPaper[active]===paper.id)b.classList.add('selected');
    b.append(make('strong','',paper.topic),make('small','',
      '#'+paper.id+' · '+(paper.retracted?'Withdrawn':paper.replications?
      'Repeated '+paper.replications+'×':'Published · not repeated')));
    b.addEventListener('click',()=>{
      selectedPaper[active]=paper.id;inspector();publishContext(true);
    });
    papers.append(b);
  }
  const detail=$('selected-paper');
  detail.replaceChildren();
  const target=s.hypotheses.find(h=>h.id===selectedPaper[active]&&h.labId===id&&h.published);
  if(!target){detail.hidden=true;publishContext();return;}
  detail.hidden=false;
  detail.append(make('strong','',target.topic),
    make('p','','Paper #'+target.id+' · '+(target.retracted?'Withdrawn':'Published')+
       ' · independent repeats '+(target.replications||0)));
  const action=make('button','btn small','Request independent replication');
  action.type='button';action.disabled=!!target.retracted;
  action.addEventListener('click',()=>{
    const result=E.intervention(s,'replicate_paper',id,target.id);
    $('intervention-status').textContent=result.ok?
      'Replication requested for paper #'+target.id+'. Advance days to see the result.':
      String(result.error||'unavailable').replaceAll('_',' ');
    if(result.ok)emit('replication_requested',s,'verify');
    render();publishContext(true);
  });
  detail.append(action);publishContext();
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
      selected[active]=event.labId;selectedPaper[active]=null;inspector();publishContext(true);
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
function render(){summary();inspector();feed();drawChart();comparison();publishContext();}
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
    selected[index]=id<0?null:id;selectedPaper[index]=null;
    if(id>=0){drag={index,id,start:p,moved:false};canvas.setPointerCapture(e.pointerId);}
    inspector();publishContext(true);
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
    selected[index]=selected[index]===null?0:(selected[index]+delta+worlds[index].labs.length)%worlds[index].labs.length;
    selectedPaper[index]=null;inspector();publishContext(true);
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
    line.append(head,make('p','',hint),range);
    const provenance=policyEvidence[key]||['Assumed simulation rule',null];
    const policyAudit=POLICY_RATIONALE[key];
    const evidence=make('small','policy-evidence',
      provenance[0]+' · '+(policyAudit?policyAudit[1]:'Not scientifically classified'));
    if(provenance[1]){
      const link=make('a','policy-evidence-link',' · Source ↗');
      link.href=provenance[1];link.target='_blank';link.rel='noopener noreferrer';
      link.addEventListener('click',event=>event.stopPropagation());
      evidence.append(link);
    }
    line.append(evidence);host.append(line);
  }
}
function showDecisionRegister(){
  const container=$('decision-registry');
  if(!container)return;
  container.replaceChildren();
  const groups=[...new Set(DECISION_REGISTER.map(x=>x.group))];
  for(const group of groups){
    const section=make('details','audit-group');
    const header=make('summary','audit-group-title',group+' · '+DECISION_REGISTER.filter(x=>x.group===group).length+' decisions');
    section.append(header);
    for(const item of DECISION_REGISTER.filter(x=>x.group===group)){
      const box=make('section','audit-decision');
      const title=make('h4','',item.title);
      const status=make('p','audit-status',item.kind==='theory'?'Theory-grounded mechanism':
        item.kind==='display'?'Design / UI choice':
        item.kind==='hypothesis'?'Testable model hypothesis':'Uncalibrated assumption');
      box.append(title,status);
      for(const [label,value] of [['Why',item.why],['Current rule',item.mechanism],
        ['Alternative',item.alternative],['How to check',item.verify]]){
        const p=make('p','audit-explanation');
        p.append(make('strong','',label+': '),document.createTextNode(value));
        box.append(p);
      }
      if(item.source){
        const a=make('a','audit-evidence-link','Read source / original brief ↗');
        a.href=item.source;a.target='_blank';a.rel='noopener noreferrer';box.append(a);
      }
      section.append(box);
    }
    container.append(section);
  }
  const policies=make('details','audit-group');
  const head=make('summary','audit-group-title','All 12 policy controls · causes and tests');
  policies.append(head);
  for(const key of Object.keys(E.DEFAULTS)){
    const [name,description]=policyDescriptions[key];
    const entry=POLICY_RATIONALE[key];
    const provenance=policyEvidence[key];
    const card=make('section','audit-decision');
    card.append(make('h4','',name),make('p','audit-status',
      entry[0]==='theory'?'Theoretical principle · numeric mapping uncalibrated':
      entry[0]==='hypothesis'?'Mechanism hypothesis · numerical coefficients uncalibrated':
      'Uncalibrated model assumption'));
    for(const [label,text] of [['What it changes',description],
      ['Why included',entry[1]],['How to check',entry[2]]]){
      const p=make('p','audit-explanation');
      p.append(make('strong','',label+': '),document.createTextNode(text));
      card.append(p);
    }
    if(provenance[1]){
      const a=make('a','audit-evidence-link','Related scientific foundation ↗');
      a.href=provenance[1];a.target='_blank';a.rel='noopener noreferrer';
      card.append(a);
    }
    policies.append(card);
  }
  container.append(policies);
}
function auditPopulation(){
  const s=nowWorld();
  const labs=parseInt($('audit-labs').value,10);
  const prior=$('audit-prior').value;
  const team=$('audit-team').value.split('-').map(Number);
  const fraction=Number($('audit-ai-fraction').value);
  const design={...s.design,labsPerDomain:labs,
    agentsMin:team[0],agentsMax:team[1],aiRoleFraction:fraction,
    truthPriorOverride:prior==='original'?null:Number(prior)};
  // Explicitly labeled restart action. Sandbox intentionally disallows modal
  // browser confirm(), so do not depend on a blocked native dialog.
  const seed=s.seed,policy={...s.policy};
  worlds[0]=E.make(seed,policy,design);worlds[1]=null;
  selected[0]=null;selected[1]=null;selectedPaper[0]=null;selectedPaper[1]=null;
  eventSeen[0].clear();eventSeen[1].clear();
  compareMode=false;active=0;play(false);
  $('world-b').disabled=true;$('compare').disabled=true;
  $('comparison').hidden=true;
  $('compare').classList.remove('active');
  $('compare').textContent='Compare realities';
  $('stage-title').textContent='The research network';
  chooseWorld(0);
  emit('world_reset',worlds[0],'observe');
  $('audit-design-status').textContent='New explicit assumptions: '+worlds[0].labs.length+
    ' laboratories; truth prior '+(prior==='original'?'field-specific illustrative rates':(100*Number(prior)).toFixed(0)+'%')+
    '; AI mix '+Math.round(fraction*100)+'%; team '+team[0]+' to '+team[1];
}
async function runSensitivity(){
  const go=$('audit-sensitivity'),out=$('audit-sensitivity-output');
  if(go.disabled)return;
  go.disabled=true;out.textContent='Testing multiple populations and random seeds…';
  const base=nowWorld(),seeds=6,days=55;
  const sizes=[3,7,14],lines=[];
  try{
    for(const n of sizes){
      const falseShares=[],confirmed=[],throughput=[];
      for(let j=0;j<seeds;j++){
        const state=E.make(base.seed+1000+j,{...base.policy},
          {...base.design,labsPerDomain:n});
        E.step(state,days);
        const stat=E.summary(state);
        falseShares.push(stat.healthyPapers?100*stat.falsePublished/stat.healthyPapers:0);
        throughput.push(stat.tested/Math.max(1,state.agents.length));
        confirmed.push(stat.replicated/Math.max(1,stat.published));
      }
      const mean=a=>a.reduce((sum,v)=>sum+v,0)/a.length;
      lines.push(n*4+' labs · 6 seeds: false-share '+mean(falseShares).toFixed(1)+
        '% (range '+Math.min(...falseShares).toFixed(1)+'–'+Math.max(...falseShares).toFixed(1)+
        '%); tests/agent '+mean(throughput).toFixed(1)+
        '; replications/publication '+mean(confirmed).toFixed(2));
      out.textContent=lines.join('\n');
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    out.textContent=lines.join('\n')+'\nThese are model-internal sensitivity results, not real scientific estimates. Comparisons use the same baseline policies but different populations.';
  }catch(e){out.textContent='Sensitivity run failed: '+e.message;}
  finally{go.disabled=false;}
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
  showDecisionRegister();
  $('audit-apply').addEventListener('click',auditPopulation);
  $('audit-sensitivity').addEventListener('click',runSensitivity);
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
