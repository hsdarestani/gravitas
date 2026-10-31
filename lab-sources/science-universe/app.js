/* Science Universe — interactive frontend. Every statistic comes from engine.js. */
(function(){
'use strict';
const E=window.ScienceUniverseEngine;
if(!E)throw Error('Science Universe engine missing');
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
const domainColors=['#65b6cf','#95aadf','#bea0ef','#d5ac6f'];
const domainNames=E.DOMAINS;
const G=window.GraviLab||{register:()=>{},emit:()=>{},onControl:()=>{},onCommand:()=>{},onLayer:()=>{},onSection:()=>{},onExperiment:()=>{},context:()=>{},experimentResult:()=>{}};
const worlds=[E.make(20261029),null],selected=[null,null],selectedPaper=[null,null],eventSeen=[new Set(),new Set()];
let active=0,playing=false,compareMode=false,view='labs',plot='published',speed=3;
let show={links:true,flows:true,labels:true},drag=null,lastSimulation=performance.now(),raf=0;
let eventLimit=40,fieldFilter=null,mapKeyView='',inspectorListKey='',feedKey='',historyKey='';
let selectionDeferred=false,claimOptionsKey='';
const paperNodeCache=new WeakMap();
const text=(id,value)=>{const el=typeof id==='string'?$(id):id;const next=String(value);if(el&&el.textContent!==next)el.textContent=next;};
function readingSelection(){const selection=window.getSelection();return !!selection&&!selection.isCollapsed&&String(selection).length>0;}
function shellAction(action){if(G.shellAction)G.shellAction(action);}
function showDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
function openMapGuide(){mapLegend();showDialog('map-dialog');}
const snapshotStates=new WeakMap(),intervals=new WeakMap(),focusEvents=new WeakMap();
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
  {id:'fork',group:'Comparisons',title:'Why compare the same starting world?',
   kind:'theory',why:'Cloning the starting state and RNG supports controlled model counterfactual exploration.',
   mechanism:'World B copies all state and the random-generator position. No policy is changed automatically.',
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
  const trigger=s.events.find(e=>e.type===event);
  if(trigger)focusEvents.set(s,trigger);
  publishContext(true);
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
    seed:s.seed,design:{...s.design},metrics:m,delta:intervals.get(s)?.delta||{},
    interval:intervals.get(s)?{fromDay:intervals.get(s).fromDay,toDay:intervals.get(s).toDay}:null,
    focusEvent:focusEvents.get(s)?{day:focusEvents.get(s).day,type:focusEvents.get(s).type,text:focusEvents.get(s).text,labId:focusEvents.get(s).labId,hypothesisId:focusEvents.get(s).hypothesisId}:null,
    graph:networkFacts(s),policyEditing:drawerOpen,
    events:s.events.slice(0,8).map(e=>({day:e.day,type:e.type,text:e.text})),changes:(s.policyChanges||[]).slice(-8),
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
  document.body.dataset.playing=String(playing);
  const label=document.querySelector('.live-indicator');if(label)label.lastChild.textContent=playing?' MODEL RUNNING':' MODEL PAUSED';
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
  $('comparison').hidden=!worlds[1];
  $('comparison').classList.toggle('is-collapsed',!compareMode);
  $('close-compare').textContent=compareMode?'Hide comparison':'Show comparison';
  $('close-compare').setAttribute('aria-expanded',String(compareMode));
  $('compare').textContent=compareMode?'Hide comparison':'Compare results';
  $('compare').setAttribute('aria-expanded',String(compareMode));
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
  render();interesting();snapshotInsight();
}
const METRICS={
 generated:['Hypotheses','Candidate questions generated; not discoveries.'],
 tested:['Studies tested','Completed synthetic statistical tests.'],
 published:['Published','Cumulative journal acceptances.'],
 healthyPapers:['Live papers','Accepted papers minus withdrawals.'],
 falsePublished:['False live claims','Hidden synthetic truth: false papers still in circulation.'],
 falseDiscoveryRate:['False share (%)','False LIVE claims divided by all LIVE papers; 0 when no live papers.'],
 truePublished:['True live claims','Model truth only; not available to reviewers.'],
 replicated:['Independent repeats','Number of repeat studies, not number of unique confirmed papers.'],
 replicationFailures:['Failed repeats','Fresh synthetic samples that did not pass the test.'],
 retracted:['Withdrawals','Papers withdrawn under the assumed correction policy.'],
 rejected:['Rejected studies','Nonsignificant tests and methodological review rejections.'],
 reviewBacklog:['Review queue','Manuscripts awaiting review.'],
 replicationBacklog:['Repeat queue','Scheduled independent repeats.'],
 activeStudies:['Active studies','Hypotheses currently in testing.'],
 citations:['Citations','Attention connections, not evidence of truth.'],
 spent:['Research credits spent','Cumulative synthetic study costs.'],
 meanBudget:['Mean budget','Available research credits per laboratory.'],
 agents:['Research agents','Simulated people and AI roles following rules.'],
 crossFieldStudies:['Cross-field studies','Retained studies whose topic differs from the origin laboratory field.'],
 crossFieldPublished:['Cross-field live papers','Live publications from out-of-field research. No built-in truth bonus.'],
 crossFieldLinks:['Cross-field connections','Collaboration edges linking different laboratory fields.']
};
function metricInfo(key){return METRICS[key]||(key.startsWith('policy_')?
 [policyDescriptions[key.slice(7)]?.[0]||key,'Policy setting over model time (1–10).']: [key,key]);}
function sparkline(values,label){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 120 30');svg.setAttribute('role','img');svg.setAttribute('aria-label',label+' trend');svg.classList.add('sparkline');
 const a=values.filter(Number.isFinite),min=Math.min(0,...a),max=Math.max(1,...a);
 const line=document.createElementNS(ns,'polyline');line.setAttribute('fill','none');line.setAttribute('stroke','currentColor');line.setAttribute('stroke-width','1.7');
 line.setAttribute('points',a.map((v,i)=>(2+i/Math.max(1,a.length-1)*116)+','+(27-(v-min)/(max-min||1)*24)).join(' '));svg.append(line);return svg;
}
function mountWorkspace(){
 const side=make('div','workspace-side'),layout=document.querySelector('.world-layout');
 side.append($('inspector'),document.querySelector('.activity'));layout.append(side);
 const dock=make('div','pulsar-anchor');dock.id='pulsar-anchor';dock.setAttribute('aria-hidden','true');side.append(dock);
 const workspace=make('div','model-and-policies');layout.before(workspace);workspace.append(layout);side.append($('policy-drawer'));
 // The companion is hosted outside the opaque-origin iframe. Only bounded viewport geometry crosses the bridge.
 let geometryPending=false,lastGeometry='';
 function reportGeometry(){geometryPending=false;const r=side.getBoundingClientRect(),d=dock.getBoundingClientRect();
   const payload={left:r.left,top:r.top,width:r.width,height:r.height,dockTop:d.top,viewportWidth:innerWidth,viewportHeight:innerHeight};
   const key=JSON.stringify(payload);if(key!==lastGeometry&&G.companionLayout){lastGeometry=key;G.companionLayout(payload);}}
 function queueGeometry(){if(!geometryPending){geometryPending=true;requestAnimationFrame(reportGeometry);}}
 new ResizeObserver(queueGeometry).observe(layout);window.addEventListener('scroll',queueGeometry,{passive:true});window.addEventListener('resize',queueGeometry,{passive:true});queueGeometry();
 const analysis=document.querySelector('.analysis');analysis.querySelector('.section-head').after(document.querySelector('.top-strip'));
 const modes=document.querySelector('.mode-rail');modes.prepend(document.querySelector('.header-actions'));
 for(const key of [...Object.keys(METRICS),...Object.keys(E.DEFAULTS).map(k=>'policy_'+k)]){
   const option=make('option','',metricInfo(key)[0]);option.value=key;$('metric-select').append(option);
 }
 document.body.dataset.playing='false';
}
function renderMetricTrends(){
 const host=$('metric-trends');if(!host)return;
 const s=nowWorld(),m=E.summary(s),history=series(s);
 if(!host.children.length)for(const key of Object.keys(METRICS)){
   const [label,hint]=metricInfo(key),button=make('button','metric-trend');button.type='button';button.title=hint;button.dataset.metric=key;
   button.append(make('span','',label),make('strong',''),sparkline([],label));
   button.addEventListener('click',()=>{plot=key;$('metric-select').value=key;drawChart();renderMetricTrends();});host.append(button);
 }
 for(const button of host.children){const key=button.dataset.metric;
   button.setAttribute('aria-pressed',String(key===plot));
   text(button.querySelector('strong'),Number(m[key]||0).toLocaleString('en-US',{maximumFractionDigits:1}));
   button.querySelector('svg').replaceWith(sparkline(history.map(x=>x[key]),metricInfo(key)[0]));
 }
}
function renderDataTable(){
 const host=$('outcome-data');host.replaceChildren();const table=make('table'),head=make('tr');
 for(const name of ['World','Model day',...Object.keys(METRICS).map(k=>metricInfo(k)[0])])head.append(make('th','',name));
 const thead=make('thead');thead.append(head);table.append(thead);const body=make('tbody');
 for(const s of runningWorlds())for(const row of series(s)){
   const tr=make('tr');tr.append(make('td','',worlds[1]===s?'B':'A'),make('td','',row.day));
   for(const key of Object.keys(METRICS))tr.append(make('td','',row[key]??'—'));body.append(tr);
 }
 table.append(body);host.append(table);
}
function renderDomainResults(){
 const host=$('domain-results');
 if(!host.children.length){host.append(make('h3','','Research across fields'),make('p','small-print','Compare live publications, false claims and citations by topic. Field labels do not imply a proven scientific advantage.'));
   const grid=make('div','domain-grid');for(const [i,name] of E.DOMAINS.entries()){
     const card=make('div','domain-card');card.style.setProperty('--field-color',domainColors[i]);card.append(make('strong','',name),make('span','domain-value'));grid.append(card);
   }host.append(grid);
 }
 E.researchBreakdown(nowWorld()).forEach((d,i)=>text(host.querySelectorAll('.domain-value')[i],d.published+' live papers · '+d.falsePublished+' false · '+d.citations+' citations'));
}
function snapshotInsight(){
 const s=nowWorld(),m=E.summary(s);
 const previous=snapshotStates.get(s)||{metrics:s.history[0]||m,day:(s.history[0]||m).day};
 if(s.day-previous.day<12)return;
 const before=previous.metrics,delta=Object.fromEntries(Object.keys(m).filter(k=>Number.isFinite(m[k])).map(k=>[k,m[k]-(before[k]||0)]));
 intervals.set(s,{fromDay:previous.day,toDay:s.day,delta});snapshotStates.set(s,{metrics:m,day:s.day});publishContext(true);
 if(!G.note)return;
 let text;
 if(delta.reviewBacklog>0)text='Ideas are reaching review faster than they leave it: the waiting list grew '+before.reviewBacklog+' → '+m.reviewBacklog+'. Try more review capacity; clearing a queue is different from proving the papers right.';
 else if(delta.replicationFailures>0)text='A fresh sample failed to reproduce '+delta.replicationFailures+' result'+(delta.replicationFailures===1?'':'s')+'. That weakens the evidence, but one failed repeat does not prove a claim false; compare sample size and independent repeats.';
 else if(delta.falsePublished>0)text='More output also brought '+delta.falsePublished+' additional false live claim'+(delta.falsePublished===1?'':'s')+' in this synthetic world. Watch the false-share trend alongside publications; a larger literature can still contain weaker evidence.';
 else if(delta.reviewBacklog<0)text='Reviewers caught up: the waiting list fell '+before.reviewBacklog+' → '+m.reviewBacklog+' while '+delta.published+' papers were accepted. This is faster processing, so check independent repeats before treating it as stronger evidence.';
 else text=delta.published+' papers passed review in this interval, while the queue ended at '+m.reviewBacklog+'. Acceptance is a first filter; follow independent repeats to see whether the findings survive a fresh sample.';
 G.note({title:'Days '+previous.day+'–'+s.day+' · what this means',text});
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
  const chip=$('inspector-start').querySelector('.method-chip');if(chip)chip.textContent=s.labs.length+' labs · '+E.DOMAINS.length+' fields · '+s.agents.length+' simulated research agents';
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
  const network=networkFacts(s,l.id);
  $('selected-links').textContent=network.selectedLinks;
  $('selected-cross-links').textContent=network.selectedCrossLinks;
  text('inspector-dialog-title',l.name+' · World '+(active?'B':'A'));
  text('inspector-more',selectedPaper[active]!==null?'See paper #'+selectedPaper[active]+' · details & actions ↗':'See more · team, papers & actions ↗');
  text('selected-summary',network.selectedLinks+' connections · '+network.selectedCrossLinks+' across fields'+(selectedPaper[active]!==null?' · Paper #'+selectedPaper[active]+' selected':''));
  $('selected-network').textContent='Drag this lab to change its possible partners. A linked partner has ×1.7 citation weight in this model; positions do not directly change statistical evidence or hidden truth.';
  $('freeze-lab').textContent=l.locked?'Resume proposals':'Slow proposals';
  const listKey=JSON.stringify([active,id,selectedPaper[active],s.agents.filter(a=>a.labId===id).map(a=>[a.id,a.produced]),l.papers.slice(-7),s.hypotheses.filter(h=>l.papers.slice(-7).includes(h.id)).map(h=>[h.id,h.replications,h.retracted])]);
  if(listKey===inspectorListKey){publishContext();return;}inspectorListKey=listKey;
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
       ' · published on day '+target.publishedOn+' · independent repeats '+(target.replications||0)));
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
function eventButton(event){
 const button=make('button','feed-event');button.type='button';button.dataset.eventId=event.id;
 const cat=event.type.includes('retract')?'warning':event.type.includes('replication')?'verify':event.type.includes('published')?'published':'general';
 const detail=make('span','event-body');detail.append(make('strong','',event.text),make('small','','DAY '+String(event.day).padStart(3,'0')+' · '+event.type.replaceAll('_',' ')));
 button.append(make('span','event-indicator '+cat),detail);
 if(Number.isInteger(event.labId)&&event.labId>=0)button.addEventListener('click',()=>{selected[active]=event.labId;selectedPaper[active]=null;inspector();publishContext(true);});else button.disabled=true;
 return button;
}
function feed(){
 const state=nowWorld(),all=latestFirst?state.events:[...state.events].reverse(),events=all.slice(0,3);
 text('event-retention','Day '+state.day+' · '+human(state.eventCount||state.events.length)+' recorded events');
 const key=active+':'+events.map(e=>e.id).join(',');
 if(key!==feedKey){feedKey=key;$('feed').replaceChildren(...(events.length?events.map(eventButton):[make('p','empty','Advance model time to see what changes.')]));}
 if(!$('events-dialog').open)return;
 text('event-history-retention','Showing '+Math.min(eventLimit,all.length)+' of '+all.length+' retained events. The latest 2,000 are kept; '+(state.eventCount||all.length)+' events occurred in total.');
 const retained=all.slice(0,eventLimit),next=active+':'+retained.map(e=>e.id).join(',');
 if(next!==historyKey){historyKey=next;$('event-history').replaceChildren(...retained.map(eventButton));}
 $('load-events').hidden=eventLimit>=all.length;
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
  text('plot-caption',{
    published:'Cumulative publications. Acceptance is not independent proof.',
    falsePublished:'False claims still published, based on hidden SYNTHETIC ground truth.',
    reviewBacklog:'Manuscripts waiting for modelled peer review.'
  }[plot]||metricInfo(plot)[1]);
  if($('metric-select'))$('metric-select').value=plot;
  if(!$('outcome-data').hidden&&!readingSelection())renderDataTable();
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
function render(){
 // Keep the user's selected text and reading position intact while the numerical model continues.
 if(readingSelection()){selectionDeferred=true;publishContext();drawChart();return;}
 selectionDeferred=false;summary();inspector();feed();drawChart();comparison();renderMetricTrends();renderDomainResults();mapLegend();publishContext();
}
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
function networkFacts(s,labId=selected[active]){
 const links=s.links.filter(e=>e.a===labId||e.b===labId);
 return {links:s.links.length,crossFieldLinks:s.links.filter(e=>s.labs[e.a].domain!==s.labs[e.b].domain).length,
  selectedLinks:links.length,selectedCrossLinks:links.filter(e=>s.labs[e.a].domain!==s.labs[e.b].domain).length,
  retainedCitations:(s.citationEdges||[]).length,
  recentCitations:(s.citationEdges||[]).filter(e=>s.day-e.day<=8).length};
}
function paperWindow(s){
 const all=s.hypotheses.filter(p=>p.published&&!p.retracted&&(fieldFilter===null||p.domain===fieldFilter));
 return all.sort((a,b)=>a.publishedOn-b.publishedOn||a.id-b.id).slice(-180);
}
function paperLayout(s,g){
 const papers=paperWindow(s),domains=fieldFilter===null?[0,1,2,3]:[fieldFilter];
 const start=Math.max(0,Math.min(s.day-30,...papers.map(p=>p.publishedOn))),end=Math.max(start+10,s.day);
 return {papers,domains,start,end,left:98,right:g.w-25,top:38,lane:(g.h-76)/domains.length};
}
function livePaperNodes(s,g){
 const cacheKey=[s.day,s.stats.published,s.stats.retracted,g.w,g.h,fieldFilter].join(':');const cached=paperNodeCache.get(s);if(cached?.key===cacheKey)return cached.nodes;
 const layout=paperLayout(s,g),{papers,domains,left,right,top,lane,start,end}=layout;
 const cols=Math.max(1,Math.floor((right-left)/14)),rows=Math.max(1,Math.floor((lane-32)/13)),used=new Map();
 const counts=new Map(),fitting=[...papers].reverse().filter(p=>{const n=counts.get(p.domain)||0;counts.set(p.domain,n+1);return n<cols*rows;}).reverse();
 const nodes=fitting.map(paper=>{
   const band=domains.indexOf(paper.domain),fraction=(paper.publishedOn-start)/(end-start),col=Math.max(0,Math.min(cols-1,Math.round(fraction*(cols-1))));
   let best=null,bestCost=Infinity;
   // Nearest free display slot keeps points separate. The horizontal guide reports exact dates on selection.
   for(let c=0;c<cols;c++)for(let row=0;row<rows;row++){
     const key=band+':'+c+':'+row;if(used.has(key))continue;
     const cost=Math.abs(c-col)*3+Math.abs(row-(rows-1)/2);
     if(cost<bestCost){best={c,row,key};bestCost=cost;}
   }
   if(!best)best={c:col,row:paper.id%rows,key:band+':overflow:'+paper.id};used.set(best.key,true);
   return {paper,x:left+(best.c+.5)/cols*(right-left),y:top+band*lane+25+(best.row+.5)/rows*(lane-34),r:3+Math.min(2,Math.sqrt(paper.replications||0))};
 });
 paperNodeCache.set(s,{key:cacheKey,nodes});return nodes;
}
function mapLegend(){
 const s=nowWorld(),m=E.summary(s),n=networkFacts(s),papers=view==='papers';
 $('claim-focusbar').hidden=!papers;
 const visible=papers?livePaperNodes(s,{w:$(active?'network-b':'network-a').clientWidth,h:$(active?'network-b':'network-a').clientHeight}).map(n=>n.paper):[];
 if(papers){const key=active+':'+visible.map(p=>p.id).join(',');if(key!==claimOptionsKey){claimOptionsKey=key;const select=$('claim-select');select.replaceChildren(make('option','','Choose a claim…'));select.firstChild.value='';for(const p of [...visible].reverse()){const option=make('option','','#'+p.id+' · '+domainNames[p.domain]+' · day '+p.publishedOn);option.value=p.id;select.append(option);}}$('claim-select').value=selectedPaper[active]===null?'':String(selectedPaper[active]);}
 text('stage-title',(compareMode?'World A / B · ':'')+(papers?'Knowledge, one claim at a time':'Teams and collaboration'));
 text('map-explanation',papers?'Small dots are published claims, arranged by research field and publication time. Select a claim to reveal its recorded citations.':'Circle size follows studies in progress. Select a lab to inspect it, or drag it to change its possible collaborators.');
 text('canvas-instruction',papers?'Select a claim → inspect its citations':'Size = active studies · Lines = possible collaborators');
 text('links-label',papers?'Selected citations':'Collaborations');text('flows-label',papers?'Recent activity':'Team & citations');
 text('map-counts',papers?visible.length+' / '+m.healthyPapers+' live papers shown · '+n.retainedCitations+' retained citation records':s.labs.length+' laboratories · '+m.activeStudies+' active studies · '+n.links+' links, '+n.crossFieldLinks+' across fields');
 text('map-key-summary',papers?'Color = repeat-test history · Rows = topic fields':'Field colors identify teams. Select a field to focus.');
 if(mapKeyView!==view){mapKeyView=view;const key=$('map-key-content');key.replaceChildren();
   const illustration=make('div','map-guide-illustration');
   // Authored legend, explicitly schematic, never fabricated research data.
   illustration.innerHTML=papers?'<svg viewBox="0 0 460 150" role="img" aria-label="Schematic example: Biology and Climate paper lanes, with a citation arrow toward a selected paper"><path d="M90 48H440M90 112H440" stroke="#8bb5c5" stroke-opacity=".25"/><text x="8" y="52" fill="#65b6cf">Biology</text><text x="8" y="116" fill="#95aadf">Climate</text><circle cx="150" cy="48" r="6" fill="#e5c58f"/><circle cx="230" cy="48" r="7" fill="#a4d5bd"/><circle cx="350" cy="112" r="7" fill="#e4a080"/><circle cx="230" cy="48" r="13" fill="none" stroke="#fff"/><path d="M90 112Q130 25 215 48m-7-6 7 6-9 2" fill="none" stroke="#c1a0e7"/><text x="270" y="28" fill="#c4d5df">Select one claim</text><text x="225" y="143" fill="#a5b9c8">Earlier → later publication</text></svg>':'<svg viewBox="0 0 460 150" role="img" aria-label="Schematic example: two laboratories, a collaboration line and small team-member marks"><path d="M130 75H330" stroke="#c1a0e7" stroke-width="2"/><circle cx="130" cy="75" r="21" fill="#0e3045" stroke="#65b6cf" stroke-width="2"/><circle cx="330" cy="75" r="13" fill="#0e3045" stroke="#bea0ef" stroke-width="2"/><circle cx="130" cy="75" r="4" fill="#65b6cf"/><circle cx="330" cy="75" r="3" fill="#bea0ef"/><circle cx="130" cy="43" r="3" fill="#e4c789"/><circle cx="104" cy="94" r="3" fill="#a5d4e7"/><circle cx="156" cy="94" r="3" fill="#a5d4e7"/><text x="75" y="127" fill="#c4d5df">More active studies</text><text x="285" y="127" fill="#c4d5df">Fewer studies</text><text x="177" y="55" fill="#c1a0e7">Possible partners</text></svg>';
   key.append(illustration,make('small','small-print','Schematic legend · not measurements from your run'));
   const items=papers?[
     ['One dot, one claim','Up to the newest 180 live papers are grouped by topic field; smaller maps keep the newest claims in each field as space allows. Horizontal position follows publication time, adjusted into free slots for legibility. Select a dot for its exact publication day, origin lab and repeat tests. Dot positions never change model outcomes.'],
     ['Read the evidence color','Gold: no completed repeat. Green: passed repeat(s), no failed repeat. Orange: at least one failed repeat. Size follows completed repeats. These are observations, not proof of truth.'],
     ['Follow one citation','Select a claim to show retained arrows from citing labs at the left to that paper. The origin-field color surrounds each dot; a violet outer ring means its topic differs from its lab’s specialty. Only 120 recent citation records are retained.'],
     ['Watch model time','A moving mark represents an actual citation from the last 8 model days. Its position shows age, not the physical speed of knowledge. Pausing model time freezes it.']
   ]:[
     ['Read a laboratory','Circle color is its field; circle size follows active studies with a visual cap. Small stationary marks are actual human (blue) and AI (gold) team members. Grey means proposals are reduced to 17% of the usual rate.'],
     ['Follow the connections','Blue lines join possible partners in one field; violet lines cross fields. A connection multiplies citation preference by 1.7 in this model. A line is an opportunity, not proof that a joint paper exists.'],
     ['Move with a purpose','Dragging a lab changes possible partners and later citation choices. It does not directly change truth, funding or evidence. The inspector reports its exact connection counts.'],
     ['Compare the two views','Laboratories shows the teams. Knowledge flow shows actual published claims, organized into readable field lanes. Select one claim to focus its citations.']
   ];
   for(const [title,body] of items){const item=make('section','guide-fact');item.append(make('h3','',title),make('p','',body));key.append(item);}
 }
 for(const id of ['network-a','network-b'])$(id).setAttribute('aria-label',papers?'Published claims arranged by field and publication time; select a paper for its recorded citations':'Laboratory map; size indicates active studies, lines show possible partners; drag a lab to change its network position');
}
function drawArrow(ctx,a,b,color){
 const angle=Math.atan2(b.y-a.y,b.x-a.x),x=b.x-Math.cos(angle)*6,y=b.y-Math.sin(angle)*6;
 ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1;
 ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(x,y);ctx.stroke();
 ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-6*Math.cos(angle-.45),y-6*Math.sin(angle-.45));ctx.lineTo(x-6*Math.cos(angle+.45),y-6*Math.sin(angle+.45));ctx.closePath();ctx.fill();
}
function draw(canvas,s,index,t){
 if(!s)return;
 const g=canvasGeometry(canvas);if(!g)return;
 const {ctx,w,h}=g,papers=view==='papers',nodes=papers?livePaperNodes(s,g):[],byPaper=new Map(nodes.map(n=>[n.paper.id,n]));
 ctx.clearRect(0,0,w,h);ctx.fillStyle='#071e2e';ctx.fillRect(0,0,w,h);
 ctx.strokeStyle='rgba(125,165,194,.07)';ctx.lineWidth=.7;
 for(let x=0;x<w;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
 for(let y=0;y<h;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
 if(show.links&&!papers)for(const edge of s.links){
  if(fieldFilter!==null&&s.labs[edge.a].domain!==fieldFilter&&s.labs[edge.b].domain!==fieldFilter)continue;
  const a=position(s.labs[edge.a],g),b=position(s.labs[edge.b],g);
  ctx.strokeStyle=s.labs[edge.a].domain!==s.labs[edge.b].domain?'rgba(193,160,231,.55)':'rgba(115,181,203,.32)';
  ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
 }
 if(papers){
  const layout=paperLayout(s,g),focus=byPaper.get(selectedPaper[index]),sources=(s.citationEdges||[]).filter(e=>focus&&e.paperId===focus.paper.id);
  layout.domains.forEach((domain,i)=>{
   const y=layout.top+i*layout.lane;ctx.fillStyle=i%2?'rgba(154,190,213,.025)':'rgba(154,190,213,.055)';ctx.fillRect(0,y,w,layout.lane);
   ctx.fillStyle=domainColors[domain];ctx.font='600 11px system-ui';ctx.textAlign='left';ctx.fillText(domainNames[domain],12,y+19);
  });
  ctx.font='10px system-ui';ctx.fillStyle='#a5b9c8';ctx.textAlign='left';ctx.fillText('PUBLISHED CLAIMS',12,20);
  ctx.fillText('Day '+layout.start,layout.left,h-12);ctx.textAlign='right';ctx.fillText('Day '+layout.end,layout.right,h-12);
  if(!nodes.length){ctx.textAlign='center';ctx.fillStyle='#c4d5df';ctx.font='12px system-ui';ctx.fillText('Advance model time to see published claims here.',w/2,h/2);}
  const fromLabs=[...new Set(sources.map(e=>e.from))];
  fromLabs.forEach((id,i)=>{
   const lab=s.labs[id],band=layout.domains.indexOf(lab.domain),other=fromLabs.filter(x=>s.labs[x].domain===lab.domain),j=other.indexOf(id);
   const y=band<0?layout.top+20+i*20:layout.top+band*layout.lane+34+(j+1)/(other.length+1)*(layout.lane-42),a={x:75,y};
   if(show.links){ctx.fillStyle=domainColors[lab.domain];ctx.beginPath();ctx.arc(a.x,a.y,4,0,6.283);ctx.fill();if(show.labels){ctx.font='9px system-ui';ctx.textAlign='right';ctx.fillText(lab.name,a.x-8,a.y+3);}
    drawArrow(ctx,a,focus,lab.domain===focus.paper.domain?'rgba(229,197,143,.6)':'rgba(193,160,231,.7)');}
   if(show.flows)for(const event of sources.filter(e=>e.from===id&&s.day-e.day<=8)){const f=Math.min(1,Math.max(0,(s.day-event.day)/8));ctx.fillStyle='#e5c58f';ctx.beginPath();ctx.arc(a.x+(focus.x-a.x)*f,a.y+(focus.y-a.y)*f,2.5,0,6.283);ctx.fill();}
  });
 }
 if(!papers&&show.flows)for(const flow of (s.citationEdges||[]).filter(e=>s.day-e.day<=8)){
  const a=position(s.labs[flow.from],g),b=position(s.labs[flow.to],g),f=Math.min(1,Math.max(0,(s.day-flow.day)/8));
  drawArrow(ctx,a,b,'rgba(229,197,143,.35)');ctx.fillStyle='#e5c58f';ctx.beginPath();ctx.arc(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f,2.5,0,6.283);ctx.fill();
 }
 if(!papers)s.labs.forEach((l,i)=>{
  ctx.globalAlpha=fieldFilter===null||l.domain===fieldFilter?1:.18;
  const p=position(l,g),isSelected=selected[index]===i,r=papers?5:Math.min(18,7+Math.sqrt(l.active+1)*1.4);
  if(isSelected){ctx.strokeStyle='#f4d7a3';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,r+8,0,6.283);ctx.stroke();}
  ctx.fillStyle=l.locked?'#385365':'#0e3045';ctx.strokeStyle=domainColors[l.domain];ctx.lineWidth=papers?1:1.5;
  ctx.beginPath();ctx.arc(p.x,p.y,r,0,6.283);ctx.fill();ctx.stroke();
  if(!papers){ctx.fillStyle=domainColors[l.domain];ctx.beginPath();ctx.arc(p.x,p.y,2.8,0,6.283);ctx.fill();}
  if(!papers&&show.flows){
   const agents=s.agents.filter(a=>a.labId===i);
   agents.forEach((a,j)=>{const ang=-Math.PI/2+j*2*Math.PI/agents.length,orbit=r+9;
    ctx.fillStyle=a.role==='AI'?'#e4c789':'#a5d4e7';ctx.beginPath();ctx.arc(p.x+Math.cos(ang)*orbit,p.y+Math.sin(ang)*orbit,1.9,0,6.283);ctx.fill();});
  }
  if(show.labels&&(isSelected||w>340||i%3===0)){
   ctx.fillStyle=isSelected?'#fff8e9':'rgba(218,234,243,.7)';ctx.font=isSelected?'600 11px system-ui':'10px system-ui';ctx.textAlign='center';ctx.fillText(l.name,p.x,p.y-r-12);
  }
 });
 ctx.globalAlpha=1;
 for(const n of nodes){
  const paper=n.paper,passed=(paper.replications||0)-(paper.failedReplications||0);
  ctx.fillStyle=paper.failedReplications?'#e4a080':passed>0?'#a4d5bd':'#e5c58f';ctx.strokeStyle=domainColors[paper.domain];ctx.lineWidth=1.4;
  ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,6.283);ctx.fill();ctx.stroke();
  if(paper.domain!==s.labs[paper.labId].domain){ctx.strokeStyle='#c1a0e7';ctx.lineWidth=1;ctx.beginPath();ctx.arc(n.x,n.y,n.r+3,0,6.283);ctx.stroke();}
  if(selectedPaper[index]===paper.id){ctx.strokeStyle='#fff';ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(n.x,n.y,n.r+5,0,6.283);ctx.stroke();if(show.labels){ctx.fillStyle='#fff';ctx.font='11px system-ui';ctx.textAlign='left';ctx.fillText('#'+paper.id,n.x+10,n.y-8);}}
 }
 canvas.dataset.mapView=view;canvas.dataset.visiblePapers=String(nodes.length);
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
    if(view==='papers'){
      const p=local(e),g=canvasGeometry(canvas);
      const hit=livePaperNodes(nowWorld(),g).filter(n=>Math.hypot(n.x-p.x,n.y-p.y)<n.r+5).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
      if(hit){selected[index]=hit.paper.labId;selectedPaper[index]=hit.paper.id;inspector();drawMap();publishContext(true);return;}
    }
    const p=local(e),id=nearest(nowWorld(),canvasGeometry(canvas),p.x,p.y);
    selected[index]=id<0?null:id;selectedPaper[index]=null;
    if(id>=0){drag={index,id,start:p,startPosition:{x:nowWorld().labs[id].x,y:nowWorld().labs[id].y},moved:false,wasPlaying:playing,before:networkFacts(nowWorld(),id)};play(false);canvas.setPointerCapture(e.pointerId);}
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
      const after=networkFacts(worlds[index],drag.id);
      $('intervention-status').textContent=l.name+': links '+drag.before.selectedLinks+' → '+after.selectedLinks+'; across fields '+drag.before.selectedCrossLinks+' → '+after.selectedCrossLinks+'. This changes future citation preferences, not existing evidence.';
      mapLegend();
      emit('collaboration_changed',worlds[index],'network');
    }
    const resume=drag.wasPlaying;drag=null;inspector();publishContext(true);if(resume)play(true);
  });
  canvas.addEventListener('pointercancel',()=>{const resume=drag?.wasPlaying;if(drag)Object.assign(worlds[drag.index].labs[drag.id],drag.startPosition);drag=null;if(resume)play(true);});
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
    const line=make('section','policy-control');
    const head=make('div','policy-name');
    head.append(make('strong','',name),make('output','',value+'/10'));
    const range=make('input');range.type='range';range.min=1;range.max=10;range.step=1;range.value=value;
    range.dataset.policy=key;range.setAttribute('aria-label',name);
    range.addEventListener('input',()=>{
      E.editPolicy(nowWorld(),key,range.value);
      head.querySelector('output').textContent=range.value+'/10';
      $('policy-live-status').textContent=name+' is now '+range.value+'/10 in World '+(active?'B':'A')+'. '+(playing?'Watch future model days; the effect can take time to appear.':'The model is paused. Advance days or press Play to observe the effect.');
      publishContext(true);emit('policy_changed',nowWorld(),'intervene');comparison();renderMetricTrends();
      const spark=line.querySelector('svg');if(spark)spark.replaceWith(sparkline(series(nowWorld()).map(x=>x['policy_'+key]),name));
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
    const rationale=make('details','policy-rationale');rationale.append(make('summary','','Why this matters'),evidence);
    line.append(sparkline(series(nowWorld()).map(x=>x['policy_'+key]),name),rationale);host.append(line);
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
  $('compare').textContent='Compare results';
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
function settings(on,returnFocus=true){
  drawerOpen=!!on;$('policy-drawer').hidden=!on;
  document.querySelector('.model-and-policies').classList.toggle('policy-open',drawerOpen);
  $('inspector').inert=drawerOpen;document.querySelector('.activity').inert=drawerOpen;
  $('settings').setAttribute('aria-expanded',String(drawerOpen));
  if(on){renderPolicies();$('close-settings').focus({preventScroll:true});if(innerWidth<=800)document.querySelector('.world-stage').scrollIntoView({block:'start'});}else if(returnFocus)$('settings').focus({preventScroll:true});
  publishContext(true);drawChart();
}
function setView(name){
  view=name;
  for(const key of ['labs','papers']){
    $('view-'+key).classList.toggle('active',name===key);
    $('view-'+key).setAttribute('aria-pressed',String(name===key));
  }
  mapLegend();drawMap();publishContext(true);
}
/* Experiment recipes are transparent, authored model interventions, not
   generated science. The user explicitly chooses to advance both worlds. */
const GUIDED_EXPERIMENTS={
 review_bottleneck:{
   name:'Can review keep up with faster research?',key:'generation',low:3,high:9,
   rationale:'More attempted hypotheses may increase the review queue if review staffing is fixed.',
   observe:'Review backlog and publication counts',
   caution:'The throughput rates and staffing coefficients are uncalibrated assumptions.'
 },
 selective_reporting:{
   name:'What if positive results are rewarded?',key:'pressure',low:3,high:9,
   rationale:'Selecting a favorable p-value from additional analyses can increase false positives.',
   observe:'False published claims and published counts',
   caution:'The number of analyses and publication-pressure response are hypothetical.'
 },
 replication_capacity:{
   name:'What changes when replication is easier?',key:'replication',low:2,high:9,
   rationale:'More repeat-study capacity can uncover non-replicating publications, but does not prove any claim true.',
   observe:'Independent replications, withdrawals and queue size',
   caution:'Replications use synthetic independent normal samples, not real laboratory studies.'
 }
};
function runGuidedExperiment(id){
  const recipe=GUIDED_EXPERIMENTS[id];
  if(!recipe||typeof G.experimentResult!=='function')return;
  play(false);
  const checkpoint=E.fork(nowWorld());
  // Both worlds start from exactly the same checkpoint. Only the stated
  // pre-registered model policy differs; no silent second intervention.
  const a=E.fork(checkpoint),b=E.fork(checkpoint);
  E.editPolicy(a,recipe.key,recipe.low);
  E.editPolicy(b,recipe.key,recipe.high);
  const beforeA=E.summary(a),beforeB=E.summary(b),days=45;
  E.step(a,days);E.step(b,days);
  worlds[0]=a;worlds[1]=b;
  active=1;compareMode=true;selected[0]=null;selected[1]=null;
  selectedPaper[0]=null;selectedPaper[1]=null;
  eventSeen[0].clear();eventSeen[1].clear();
  $('world-b').disabled=false;$('compare').disabled=false;
  compare(true);chooseWorld(1);
  const endA=E.summary(a),endB=E.summary(b);
  const measure=['generated','tested','published','falsePublished','replicated','retracted',
    'reviewBacklog','replicationBacklog'];
  const change=(end,start)=>Object.fromEntries(measure.map(k=>[k,
    k.endsWith('Backlog')?end[k]:end[k]-start[k]]));
  const observedA=change(endA,beforeA),observedB=change(endB,beforeB);
  $('branch-explainer').textContent=recipe.name+' Model changes: '+recipe.key+
    ' = '+recipe.low+' in A versus '+recipe.high+' in B. '+
    days+' modeled days from a matched checkpoint. All other policies equal. '+
    recipe.caution;
  render();publishContext(true);
  G.experimentResult({id,name:recipe.name,policy:recipe.key,low:recipe.low,
    high:recipe.high,seed:a.seed,design:a.design,policiesA:a.policy,policiesB:b.policy,days,worldA:observedA,worldB:observedB,
    rationale:recipe.rationale,observe:recipe.observe,caution:recipe.caution});
  emit('scenario_completed',b,'compare');
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
  G.onExperiment(runGuidedExperiment);
  G.onSection(section=>{
    if(section==='companion'){if(drawerOpen)settings(false,false);return;}
    currentSection=section;
    if(section==='verify')setView('papers');
    if(section==='network')setView('labs');
    if(section==='compare'&&worlds[1])compare(true);
  });
  emit('world_started',nowWorld(),'observe');
}
function bind(){
  $('more-events').addEventListener('click',()=>{showDialog('events-dialog');feed();});
  $('load-events').addEventListener('click',()=>{eventLimit+=80;feed();});
  $('close-events').addEventListener('click',()=>$('events-dialog').close());
  $('inspector-more').addEventListener('click',()=>showDialog('inspector-dialog'));
  $('close-inspector').addEventListener('click',()=>$('inspector-dialog').close());
  for(const id of ['map-help','inspector-map-help'])$(id).addEventListener('click',openMapGuide);
  $('close-map-help').addEventListener('click',()=>$('map-dialog').close());
  $('guide-knowledge').addEventListener('click',()=>{setView('papers');$('map-dialog').close();});
  $('back-labs').addEventListener('click',()=>shellAction('catalog'));
  $('guided-tour').addEventListener('click',()=>shellAction('tour'));
  $('fullscreen').addEventListener('click',()=>shellAction('fullscreen'));
  $('scientific-sources').addEventListener('click',()=>shellAction('sources'));
  document.querySelectorAll('[data-site-page]').forEach(button=>button.addEventListener('click',()=>shellAction(button.dataset.sitePage==='labs'?'catalog':'navigate:'+button.dataset.sitePage)));
  document.querySelectorAll('[data-domain]').forEach(button=>button.addEventListener('click',()=>{fieldFilter=button.dataset.domain==='all'?null:Number(button.dataset.domain);document.querySelectorAll('[data-domain]').forEach(b=>{const on=b===button;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});render();drawMap();}));
  document.addEventListener('selectionchange',()=>{if(selectionDeferred&&!readingSelection())render();});
  $('toggle-data').addEventListener('click',()=>{const open=$('outcome-data').hidden;$('outcome-data').hidden=!open;$('toggle-data').setAttribute('aria-expanded',String(open));$('toggle-data').textContent=open?'Hide data table':'Data table';if(open)renderDataTable();});
  $('metric-select').addEventListener('change',e=>{plot=e.target.value;drawChart();renderMetricTrends();});
  $('snapshot').addEventListener('click',()=>{publishContext(true);if(G.saveSnapshot)G.saveSnapshot({seed:nowWorld().seed});snapshotStates.set(nowWorld(),{metrics:E.summary(nowWorld()),day:nowWorld().day});$('snapshot-status').textContent='Snapshot captured. Pulsar can explain the measurements and changes.';emit('snapshot_saved',nowWorld());});
  $('atlas').addEventListener('click',()=>{if(G.openAtlas)G.openAtlas();else $('snapshot-status').textContent='Open this Lab through GraviQuest to explore the database scenario atlas.';});
  $('play').addEventListener('click',()=>play(!playing));
  $('advance').addEventListener('click',()=>advance(10));
  $('reset').addEventListener('click',reset);
  $('speed').addEventListener('change',e=>speed=Number(e.target.value)||1);
  $('world-a').addEventListener('click',()=>chooseWorld(0));
  $('world-b').addEventListener('click',()=>chooseWorld(1));
  $('fork').addEventListener('click',fork);
  $('compare').addEventListener('click',()=>compare(!compareMode));
  $('close-compare').addEventListener('click',()=>compare(!compareMode));
  $('claim-select').addEventListener('change',e=>{const paper=nowWorld().hypotheses.find(p=>p.id===Number(e.target.value));if(!e.target.value||!paper)return;selected[active]=paper.labId;selectedPaper[active]=paper.id;inspector();drawMap();publishContext(true);});
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
  $('settings').addEventListener('click',()=>settings(!drawerOpen));
  $('close-settings').addEventListener('click',()=>settings(false));
  $('policy-advance').addEventListener('click',()=>advance(10));
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
    render();interesting();snapshotInsight();
  }
  if(!playing)lastSimulation=now;
  drawMap(nowWorld().day);
  raf=requestAnimationFrame(animation);
}
mountWorkspace();bind();render();bridge();
raf=requestAnimationFrame(animation);
window.addEventListener('pagehide',()=>cancelAnimationFrame(raf),{once:true});
})();
