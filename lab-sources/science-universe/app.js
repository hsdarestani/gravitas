/* Science Universe — interactive frontend. Every statistic comes from engine.js. */
(function(){
'use strict';
const E=window.ScienceUniverseEngine;
if(!E)throw Error('Science Universe engine missing');
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=String(text);return e;};
// Canvas colours are the stylesheet's tokens (styles.css, --map-* and --domain-*),
// read again whenever the host switches theme, so the map, the chart and the
// panels around them never disagree. Literal colours here were the reason the
// map stayed navy on a light page.
const domainColors=['','','',''];
const ink={};
const FONT='"DM Sans",system-ui,sans-serif';
function readInk(){
  const css=getComputedStyle(document.documentElement),v=name=>css.getPropertyValue('--'+name).trim();
  for(let i=0;i<4;i++)domainColors[i]=v('domain-'+i);
  for(const key of ['map-bg','map-grid','map-lane-a','map-lane-b','map-node','map-node-locked','map-link','map-cross','map-cross-solid',
    'map-flow','map-flow-line','map-flow-focus','map-label','map-label-strong','map-select','claim-open','claim-pass','claim-fail',
    'agent-ai','agent-human','world-a','world-b','hairline','subtle','muted','flow-wait','flow-pass','flow-stop'])ink[key]=v(key);
}
readInk();
const domainNames=['Helix','Stratus','Axiom','Lattice'];
const G=window.GraviLab||{register:()=>{},emit:()=>{},onControl:()=>{},onCommand:()=>{},onLayer:()=>{},onSection:()=>{},onExperiment:()=>{},context:()=>{},experimentResult:()=>{}};
const FOCUS_SEED=20261029,FOCUS_DAYS=45;
const worlds=[E.make(FOCUS_SEED),null],selected=[null,null],selectedPaper=[null,null],eventSeen=[new Set(),new Set()];
let active=0,playing=false,compareMode=false,view='labs',plot='published',speed=1;
let show={links:true,flows:true,labels:true},drag=null,lastSimulation=performance.now(),raf=0;
let eventLimit=40,fieldFilter=null,mapKeyView='',inspectorListKey='',feedKey='',historyKey='';
let selectionDeferred=false,claimOptionsKey='';
const paperNodeCache=new WeakMap();
const cameras=Array.from({length:2},()=>({scale:1,x:0,y:0}));
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
let mapFrame=0, mapMotionUntil=0;
function queueMap(){
 if(!mapFrame)mapFrame=requestAnimationFrame(time=>{mapFrame=0;drawMap(time);});
}
function moveCamera(index,scale,anchor){
 const camera=cameras[index],canvas=$('network-'+(index?'b':'a')),g=canvasGeometry(canvas);
 if(!g)return;
 const {x,y}=anchor||{x:g.w/2,y:g.h/2};
 const next=Math.max(1,Math.min(4,scale)),ratio=next/camera.scale;
 camera.x=Math.min(0,Math.max(g.w*(1-next),x-(x-camera.x)*ratio));
 camera.y=Math.min(0,Math.max(g.h*(1-next),y-(y-camera.y)*ratio));
 camera.scale=next;canvas.dataset.zoom=String(next);queueMap();
}
const text=(id,value)=>{const el=typeof id==='string'?$(id):id;const next=String(value);if(el&&el.textContent!==next)el.textContent=next;};
// The thumb travels between its radius and the opposite inset, including at the endpoints.
function syncRange(range,value=range.value,baseline){
 if(range.value!==String(value))range.value=value;
 const min=range.min===''?0:Number(range.min),max=range.max===''?100:Number(range.max);
 const stop=value=>{
  const fraction=max>min?Math.max(0,Math.min(1,(Number(value)-min)/(max-min))):0;
  return 'calc('+100*fraction+'% + '+(10-20*fraction)+'px)';
 };
 range.style.setProperty('--fill',stop(range.value));
 if(baseline!==undefined)range.style.setProperty('--baseline',stop(baseline));
}
function readingSelection(){const selection=window.getSelection();return !!selection&&!selection.isCollapsed&&String(selection).length>0;}
function shellAction(action){if(G.shellAction)G.shellAction(action);}
function showDialog(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
function openMapGuide(){mapLegend();showDialog('map-dialog');}
const snapshotStates=new WeakMap(),intervals=new WeakMap(),focusEvents=new WeakMap();
let currentSection='observe',lastBridge=0,lastStateSent=0,drawerOpen=false,latestFirst=true;

const policyDescriptions={
  generation:['Hypothesis generation','Rate of candidate research questions'],
  verification:['Peer-review policy','Changes review throughput and methodological scrutiny together. At 7+, one failed repeat can trigger withdrawal.'],
  replication:['Replication capacity','Number of independent repeat tests'],
  funding:['Research funding','Daily flow of research credits'],
  aiAdoption:['AI workforce','AI share of idea generation'],
  alpha:['Statistical leniency','Larger values increase the false-positive chance'],
  sampleSize:['Sample size','Larger studies detect nonzero effects more often'],
  transparency:['Open methods','Reduces modeled analytical flexibility'],
  diversity:['Exploration diversity','Promotes outside-community search'],
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
function trackUsage(kind,data={}){if(G.usage)G.usage(kind,{world:active?'B':'A',day:nowWorld().day,...data});}
const runningWorlds=()=>worlds[1]?worlds:[nowWorld()];
let lesson=null,lessonCheckpoint=null;
function updateSetupBaseline(){
 const baseline=nowWorld().policy[$('setup-policy').value];
 text('setup-baseline','A · '+baseline+'/10');
 syncRange($('setup-value'),$('setup-value').value,baseline);
}
function ensureComparison(){if(worlds[1])return true;$('comparison-setup').hidden=false;updateSetupBaseline();$('setup-status').textContent='First create World B, then advance both worlds together.';$('comparison-setup').scrollIntoView({block:'start'});return false;}
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
  if(level!=='advanced'){publishFocusedContext();return;}
  const s=nowWorld(),m=E.summary(s),labId=selected[active];
  const lab=Number.isInteger(labId)?s.labs[labId]:null;
  const paperId=selectedPaper[active],paper=paperId===null?null:
    s.hypotheses.find(h=>h.id===paperId&&h.published&&h.labId===labId);
  G.context({
    world:active===0?'A':'B',day:s.day,playing:playing,
    view:view,lab:lab?{id:lab.id,name:lab.name,domain:domainNames[lab.domain],
      paperCount:lab.papers.length}:null,
    paper:paper?{id:paper.id,title:paper.topic,labId:paper.labId,
      status:paper.retracted?'withdrawn':'published',
      replications:paper.replications||0,
      pValue:Number.isFinite(paper.pValue)?paper.pValue:null}:null,
    seed:s.seed,design:{...s.design},metrics:m,delta:intervals.get(s)?.delta||{},
    interval:intervals.get(s)?{fromDay:intervals.get(s).fromDay,toDay:intervals.get(s).toDay}:null,
    focusEvent:focusEvents.get(s)?{day:focusEvents.get(s).day,type:focusEvents.get(s).type,text:focusEvents.get(s).text,labId:focusEvents.get(s).labId,hypothesisId:focusEvents.get(s).hypothesisId}:null,
    graph:networkFacts(s),policyEditing:drawerOpen,
    comparison:worlds[1]?{dayA:worlds[0].day,dayB:worlds[1].day,a:E.summary(worlds[0]),b:E.summary(worlds[1]),changes:Object.keys(E.DEFAULTS).filter(k=>worlds[0].policy[k]!==worlds[1].policy[k]).map(key=>({key,a:worlds[0].policy[key],b:worlds[1].policy[key]}))}:null,
    lesson:lesson?{policy:lesson.policy,observed:lesson.observed}:null,
    events:s.events.slice(0,8).map(e=>({day:e.day,type:e.type,text:e.text})),changes:(s.policyChanges||[]).slice(-8),
    published:m.published,falseClaims:m.falsePublished,reviewBacklog:m.reviewBacklog,
    replications:m.replicated,policies:{...s.policy},hasFork:!!worlds[1],
    capabilities:['inspect_lab','select_paper','replicate_selected_paper',
      'compare_worlds','run_guided_scenario']
  });
}
const ICON='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
const PLAY_ICON=ICON+'<path d="M8.2 5.6v12.8a.7.7 0 0 0 1.07.6l10.1-6.4a.7.7 0 0 0 0-1.2L9.27 5a.7.7 0 0 0-1.07.6z"/></svg>';
const PAUSE_ICON=ICON+'<path d="M8.6 5.4v13.2M15.4 5.4v13.2"/></svg>';
function play(on){
  if(on&&!ensureComparison())return;
  const wasPlaying=playing;
  playing=!!on;
  if(wasPlaying!==playing){
    trackUsage(playing?'play':'pause');
    if(playing){lastSimulation=performance.now();raf=requestAnimationFrame(animation);}
    else{cancelAnimationFrame(raf);queueMap();}
  }
  $('play').innerHTML=(playing?PAUSE_ICON:PLAY_ICON)+'<span>'+(playing?'Pause':'Play')+'</span>';
  $('status-label').textContent=playing?'SIMULATION RUNNING':'SIMULATION PAUSED';
  $('session-state').classList.toggle('spinning',playing);
  document.body.dataset.playing=String(playing);
  const label=document.querySelector('.live-indicator');if(label)label.lastChild.textContent=playing?' MODEL RUNNING':' MODEL PAUSED';
}
function reset(){
 for(let i=0;i<2;i++)if(worlds[i]){const s=worlds[i];worlds[i]=E.make(s.seed,{...s.policy},{...s.design});selected[i]=null;selectedPaper[i]=null;eventSeen[i].clear();}
 cameras.forEach(camera=>Object.assign(camera,{x:0,y:0,scale:1}));
 play(false);render();emit('world_reset',nowWorld(),'observe');trackUsage('reset');
}
function arrangeCanvases(){
  $('canvas-holder-a').hidden=active===1;
  $('canvas-holder-b').hidden=active===0;
  $('canvases').classList.remove('split');
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
  trackUsage('comparison_created');
}
function advance(n){
  if(!ensureComparison())return;
  for(const s of runningWorlds())E.step(s,n);
  trackUsage('step',{days:n});
  if(lesson)reportLesson(true);
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
 crossFieldStudies:['Cross-community studies','Retained studies whose topic differs from the origin laboratory field.'],
 crossFieldPublished:['Cross-community live papers','Live publications from outside-community research. No built-in truth bonus.'],
 crossFieldLinks:['Cross-community connections','Collaboration edges linking different laboratory communities.']
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
 const workspace=make('div','model-and-policies');layout.before(workspace);workspace.append(layout);workspace.after($('comparison-setup'));side.append($('policy-drawer'));
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
 for(const [key,[label]] of Object.entries(policyDescriptions)){const option=make('option','',label);option.value=key;$('setup-policy').append(option);}$('setup-policy').value='verification';
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
 if(!host.children.length){host.append(make('h3','','Research across communities'),make('p','small-print','Compare live publications, false claims and citations by topic. Community labels do not imply a proven scientific advantage.'));
   const grid=make('div','domain-grid');for(const [i,name] of domainNames.entries()){
     const card=make('div','domain-card');card.style.setProperty('--field-color','var(--domain-'+i+')');card.append(make('strong','',name),make('span','domain-value'));grid.append(card);
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
  text('network-clock','Day '+m.day);
  for(const [id,value] of Object.entries({
    day:String(m.day).padStart(3,'0'),agents:human(s.agents.length),
    hypotheses:human(m.generated),published:human(m.published),
    replications:human(m.replicated),backlog:human(m.reviewBacklog)
  }))$(id).textContent=value;
}
function inspector(){
  const id=selected[active],s=nowWorld();
  $('inspector-start').hidden=id!==null;
  const chip=$('inspector-start').querySelector('.method-chip');if(chip)chip.textContent=s.labs.length+' teams · '+domainNames.length+' communities · '+s.agents.length+' simulated research agents';
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
  text('inspector-more',selectedPaper[active]!==null?'See paper #'+selectedPaper[active]+' · details & actions':'See more · team, papers & actions');
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
  ctx.strokeStyle=ink.hairline;ctx.fillStyle=ink.subtle;
  ctx.font='11px '+FONT;ctx.lineWidth=1;
  for(let i=0;i<4;i++){
    const y=top+ch*i/3;
    ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-10,y);ctx.stroke();
    ctx.fillText(human(max*(1-i/3)),2,y+3);
  }
  ctx.fillText('DAY 0',left,h-7);ctx.fillText('DAY '+xmax,Math.max(left,w-75),h-7);
  all.forEach((line,index)=>{
    if(line.length<1)return;
    ctx.strokeStyle=index?ink['world-b']:ink['world-a'];ctx.lineWidth=2;ctx.beginPath();
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
  const current=nowWorld(),snapshot=E.summary(current);
  const relevant=METRIC_INPUTS[plot]||['verification'];
  text('plot-io-caption','Inputs · '+relevant.map(key=>policyDescriptions[key][0]+': '+
   (current.policy[key]??'—')+'/10').join(' · ')+' → Output · '+metricInfo(plot)[0]+': '+
   (Number(snapshot[plot]||0).toLocaleString('en-US',{maximumFractionDigits:2})));
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
 if(level==='advanced'){mapMotionUntil=performance.now()+300;queueMap();}
 // Keep the user's selected text and reading position intact while the numerical model continues.
 if(readingSelection()){selectionDeferred=true;publishContext();drawChart();return;}
 selectionDeferred=false;renderPipeline();summary();inspector();feed();drawChart();comparison();renderMetricTrends();renderDomainResults();mapLegend();publishContext();
}
function renderPipeline(){
 const host=$('model-pipeline'),m=E.summary(nowWorld());
 const items=[['generated','Ideas','total'],['activeStudies','Testing','in progress'],['reviewBacklog','Review','waiting'],['healthyPapers','Published','live'],['replicated','Repeats','completed']];
 if(!host.children.length)for(const [key,label,unit] of items){const tile=make('div','pipeline-stage');tile.dataset.key=key;tile.append(make('span','',label),make('strong'),make('small','',unit));host.append(tile);}
 for(const tile of host.children)text(tile.querySelector('strong'),human(m[tile.dataset.key]||0));
}
function reportLesson(observed=false){
 if(!lesson||!worlds[1])return;lesson.observed=observed||lesson.observed;
 const changed=Object.keys(E.DEFAULTS).filter(k=>worlds[0].policy[k]!==worlds[1].policy[k]);
 if(G.lessonState)G.lessonState({policy:lesson.policy,changed:changed.length===1&&changed[0]===lesson.policy,observed:lesson.observed,days:worlds[0].day-lesson.startDay,a:E.summary(worlds[0]),b:E.summary(worlds[1])});
}
function startLesson({action,policy,days}){
 if(action==='welcome'){$('comparison-setup').hidden=true;return;}
 if(action==='skip'){lesson=null;$('comparison-setup').hidden=!!worlds[1];document.querySelectorAll('.lesson-highlight').forEach(e=>e.classList.remove('lesson-highlight'));return;}
 if(!Object.hasOwn(E.DEFAULTS,policy))return;
 if(action==='start'||action==='focus')document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
 if(action==='start'){
  if(!lessonCheckpoint)lessonCheckpoint=E.fork(worlds[0]);
  play(false);worlds[0]=E.fork(lessonCheckpoint);worlds[1]=E.fork(lessonCheckpoint);selected.fill(null);selectedPaper.fill(null);
  $('world-b').disabled=false;$('compare').disabled=false;$('comparison-setup').hidden=true;compare(true);chooseWorld(1);
  lesson={policy,startDay:worlds[0].day,observed:false};reportLesson();
 }
 if(action==='observe'){
  const differences=Object.keys(E.DEFAULTS).filter(k=>worlds[1]&&worlds[0].policy[k]!==worlds[1].policy[k]);
  if(lesson?.policy===policy&&differences.length===1&&differences[0]===policy){advance(Number.isInteger(days)&&days>=1&&days<=120?days:20);settings(false,false);}return;
 }
 if(action==='start'||action==='focus'){chooseWorld(1);settings(true,false);const range=document.querySelector('[data-policy="'+policy+'"]');document.querySelectorAll('.lesson-highlight').forEach(e=>e.classList.remove('lesson-highlight'));range.closest('.policy-control').classList.add('lesson-highlight');range.scrollIntoView({block:'center'});range.focus({preventScroll:true});}
}
function runAtlasComparison(data){
 if(!Object.hasOwn(E.DEFAULTS,data.policy)||!Number.isInteger(data.low)||!Number.isInteger(data.high)||data.low<1||data.low>10||data.high<1||data.high>10||data.low===data.high||!Number.isInteger(data.seed)||data.seed<0||data.seed>4294967295||!Number.isInteger(data.days)||data.days<1||data.days>120)return;
 const parameters={};for(const key of Object.keys(E.DEFAULTS)){const v=data.parameters?.[key];if(!Number.isInteger(v)||v<1||v>10)return;parameters[key]=v;}
 selectLevel('advanced');play(false);lesson=null;worlds[0]=E.make(data.seed,{...parameters,[data.policy]:data.low},E.normalizeDesign(data.design||{}));worlds[1]=E.make(data.seed,{...parameters,[data.policy]:data.high},E.normalizeDesign(data.design||{}));
 selected.fill(null);selectedPaper.fill(null);$('world-b').disabled=false;$('compare').disabled=false;$('comparison-setup').hidden=true;compare(true);chooseWorld(1);advance(data.days);trackUsage('atlas_replayed',{parameter:data.policy,low:data.low,high:data.high,days:data.days,seed:data.seed});
 $('branch-explainer').textContent='Reproduced stored comparison · seed '+data.seed+' · '+data.days+' model days · '+policyDescriptions[data.policy][0]+': '+data.low+' in A, '+data.high+' in B. Other settings and initial design equal.';document.querySelector('.analysis').scrollIntoView({block:'start'});
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
   return {paper,x:left+(best.c+.5)/cols*(right-left),y:top+band*lane+25+(best.row+.5)/rows*(lane-34),r:4.5+Math.min(2,Math.sqrt(paper.replications||0))};
 });
 paperNodeCache.set(s,{key:cacheKey,nodes});return nodes;
}
function mapLegend(){
 const s=nowWorld(),papers=view==='papers';
 $('claim-focusbar').hidden=!papers;
 const visible=papers?livePaperNodes(s,{w:$(active?'network-b':'network-a').clientWidth,h:$(active?'network-b':'network-a').clientHeight}).map(n=>n.paper):[];
 if(papers){const key=active+':'+visible.map(p=>p.id).join(',');if(key!==claimOptionsKey){claimOptionsKey=key;const select=$('claim-select');select.replaceChildren(make('option','','Choose a claim…'));select.firstChild.value='';for(const p of [...visible].reverse()){const option=make('option','','#'+p.id+' · '+domainNames[p.domain]+' · day '+p.publishedOn);option.value=p.id;select.append(option);}}$('claim-select').value=selectedPaper[active]===null?'':String(selectedPaper[active]);}
 text('stage-title',('World '+(active?'B':'A')+' · ')+(papers?'Knowledge, one claim at a time':'Teams and collaboration'));
 text('map-explanation',papers?'Small dots are published claims. Pick one to see its citations.':'Drag a lab to change its possible collaborators. Select a lab to inspect its research.');
 text('canvas-instruction',papers?'Select a claim → inspect its citations':'Size: active studies · Dashed links: between communities');
 text('links-label',papers?'Selected citations':'Collaborations');text('flows-label',papers?'Recent activity':'People, citations & repeats');
 text('map-key-summary',papers?'Color shows repeat-test history · Each row is a community':'Choose a community to focus the map.');
 if(mapKeyView!==view){
  mapKeyView=view;
  const key=$('map-key-content'),tiles=make('div','map-guide-tiles');
  const guide=papers?[
   ['One dot, one claim','Rows group claims by community. Newer claims are farther right.',
    '<path d="M10 29H158M10 58H158" class="guide-grid"/><circle cx="39" cy="29" r="5" fill="var(--domain-0)"/><circle cx="104" cy="29" r="5" fill="var(--domain-0)"/><circle cx="65" cy="58" r="5" fill="var(--domain-1)"/><circle cx="141" cy="58" r="5" fill="var(--domain-1)"/>'],
   ['Read repeat tests','Gold means waiting. Green means passed. Orange means at least one failed.',
    '<circle cx="31" cy="37" r="8" fill="var(--claim-open)"/><circle cx="84" cy="37" r="8" fill="var(--claim-pass)"/><circle cx="137" cy="37" r="8" fill="var(--claim-fail)"/><path d="M27 58h8m44 0 4 4 8-8m40 0 12 12m0-12-12 12" class="guide-grid"/>'],
   ['Follow a citation','Select a claim to reveal arrows from labs that cited it.',
    '<path d="M28 25 116 45M33 65 116 49m-10-9 10 5-11 3" class="guide-link"/><circle cx="26" cy="25" r="6" fill="var(--domain-0)"/><circle cx="31" cy="65" r="6" fill="var(--domain-1)"/><circle cx="132" cy="47" r="14" class="guide-grid"/><circle cx="132" cy="47" r="7" fill="var(--claim-pass)"/>']
  ]:[
   ['Read a research team','Larger circles have more studies in progress. Small marks are team members.',
    '<circle cx="54" cy="45" r="20" class="guide-ring"/><circle cx="124" cy="45" r="11" class="guide-ring"/><circle cx="54" cy="45" r="4" fill="var(--domain-0)"/><circle cx="124" cy="45" r="3" fill="var(--domain-0)"/><circle cx="54" cy="18" r="3" fill="var(--agent-ai)"/><circle cx="30" cy="62" r="3" fill="var(--agent-human)"/><circle cx="78" cy="62" r="3" fill="var(--agent-human)"/>'],
   ['Spot possible partners','Lines connect possible collaborators. Purple lines cross communities.',
    '<path d="M34 45H84L134 29M84 45l47 22" class="guide-link"/><circle cx="33" cy="45" r="10" class="guide-ring"/><circle cx="84" cy="45" r="10" class="guide-ring"/><circle cx="134" cy="29" r="10" class="guide-ring-other"/><circle cx="131" cy="67" r="8" class="guide-ring-other"/>'],
   ['Move a team','Drag a team to change its possible partners. Tap it for details.',
    '<path d="M47 44h71m-11-8 11 8-11 8" class="guide-link" stroke-dasharray="4 4"/><circle cx="33" cy="44" r="13" class="guide-grid"/><circle cx="134" cy="44" r="16" class="guide-ring"/><circle cx="134" cy="44" r="4" fill="var(--domain-0)"/>']
  ];
  for(const [title,caption,art] of guide){
   const tile=make('figure','map-guide-tile'),image=make('div','map-guide-art'),description=make('figcaption');
   image.innerHTML='<svg viewBox="0 0 168 88" aria-hidden="true">'+art+'</svg>';
   description.append(make('strong','',title),make('span','',caption));tile.append(image,description);tiles.append(tile);
  }
  key.replaceChildren(tiles);
 }
 for(const id of ['network-a','network-b'])$(id).setAttribute('aria-label',papers?'Published claims arranged by field and publication time; select a paper for its recorded citations':'Laboratory map; size indicates active studies, lines show possible partners; drag a lab to change its network position');
}
function drawArrow(ctx,a,b,color){
 const angle=Math.atan2(b.y-a.y,b.x-a.x),x=b.x-Math.cos(angle)*6,y=b.y-Math.sin(angle)*6;
 ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1;
 ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(x,y);ctx.stroke();
 ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-6*Math.cos(angle-.45),y-6*Math.sin(angle-.45));ctx.lineTo(x-6*Math.cos(angle+.45),y-6*Math.sin(angle+.45));ctx.closePath();ctx.fill();
}
function drawTerritories(ctx,s,g,radius){
 const {w,h}=g;
 for(let domain=0;domain<4;domain++){
  const labs=s.labs.filter(lab=>lab.domain===domain);
  if(!labs.length)continue;
  const points=labs.map(lab=>position(lab,g));
  const center={x:points.reduce((sum,p)=>sum+p.x,0)/points.length,y:points.reduce((sum,p)=>sum+p.y,0)/points.length};
  const xx=points.reduce((sum,p)=>sum+(p.x-center.x)**2,0),yy=points.reduce((sum,p)=>sum+(p.y-center.y)**2,0);
  const xy=points.reduce((sum,p)=>sum+(p.x-center.x)*(p.y-center.y),0);
  const angle=.5*Math.atan2(2*xy,xx-yy),cos=Math.cos(angle),sin=Math.sin(angle);
  const rx=Math.max(30,...points.map(p=>Math.abs((p.x-center.x)*cos+(p.y-center.y)*sin)+28));
  const ry=Math.max(22,...points.map(p=>Math.abs((p.y-center.y)*cos-(p.x-center.x)*sin)+20));
  const color=domainColors[domain],visible=fieldFilter===null||fieldFilter===domain;
  ctx.save();ctx.translate(center.x,center.y);ctx.rotate(angle);
  for(const [scale,alpha] of [[1,.08],[.83,.08],[.66,.10]]){
   ctx.globalAlpha=visible?alpha:alpha*.17;ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=1.3;
   ctx.beginPath();ctx.ellipse(0,0,rx*scale,ry*scale,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  }
  ctx.restore();
  if(!show.labels||!visible)continue;
  const top=Math.min(...points.map(p=>p.y));
  ctx.fillStyle=color;ctx.textAlign='center';ctx.font='600 '+radius(w<420?12:15)+'px '+FONT;
  ctx.fillText(domainNames[domain],Math.min(w-36,Math.max(36,center.x)),Math.min(h-20,Math.max(23,top-26)));
 }
}
function drawLabNodes(ctx,s,g,index,pulse,radius){
 const agents=new Map(),repeats=new Map();
 if(show.flows){
  for(const agent of s.agents){
   if(!agents.has(agent.labId))agents.set(agent.labId,[]);
   agents.get(agent.labId).push(agent);
  }
  for(const event of s.events){
   if(event.day<s.day-2)break;
   if(['replication_passed','replication_failed','paper_retracted'].includes(event.type)&&!repeats.has(event.labId))
    repeats.set(event.labId,event);
  }
 }
 const connected=new Set(s.links.flatMap(({a,b})=>a===selected[index]?[b]:b===selected[index]?[a]:[]));
 for(const lab of s.labs){
  const {x,y}=position(lab,g),color=domainColors[lab.domain],selectedLab=selected[index]===lab.id;
  const r=radius(Math.min(24,7+Math.sqrt(lab.active)*3.4));
  const visible=fieldFilter===null||lab.domain===fieldFilter;
  ctx.globalAlpha=visible?(selected[index]===null||selectedLab||connected.has(lab.id)?1:.44):.16;
  if(selectedLab||lab.active>0){
   ctx.strokeStyle=color;ctx.lineWidth=radius(1.2);ctx.beginPath();
   ctx.arc(x,y,r+radius(selectedLab?9:4),0,Math.PI*2);ctx.stroke();
  }
  ctx.fillStyle=lab.locked?ink['map-node-locked']:ink['map-node'];
  ctx.strokeStyle=selectedLab?ink['map-select']:color;ctx.lineWidth=radius(selectedLab?2.1:1.3);
  ctx.beginPath();
  for(let i=0;i<6;i++){
   const angle=Math.PI/6+i*Math.PI/3,px=x+Math.cos(angle)*r,py=y+Math.sin(angle)*r;
   if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
  }
  ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle=color;
  if(lab.active)for(let i=0;i<Math.min(9,lab.active);i++){
   const cell=radius(2.4);
   ctx.fillRect(x+(i%3-1.5)*cell,y+(Math.floor(i/3)-1.5)*cell,cell-0.6,cell-0.6);
  }else{ctx.beginPath();ctx.arc(x,y,radius(1.8),0,Math.PI*2);ctx.fill();}
  const team=agents.get(lab.id)||[];
  team.forEach((agent,i)=>{
   const angle=-Math.PI/2+i*Math.PI*2/team.length,orbit=r+radius(7);
   const px=x+Math.cos(angle)*orbit,py=y+Math.sin(angle)*orbit;
   drawResearchToken(ctx,px,py,radius(1.7),agent.role==='AI'?ink['agent-ai']:ink['agent-human'],agent.role==='AI'?'wait':'study');
  });
  const event=repeats.get(lab.id);
  if(event){
   const passed=event.type==='replication_passed',eventColor=passed?FLOW_COLORS.pass:FLOW_COLORS.stop;
   drawResearchToken(ctx,x+r+radius(6),y-r,radius(3.7),eventColor,passed?'pass':'stop');
   if(event.day===s.day&&pulse<1){
    ctx.save();ctx.globalAlpha*=1-pulse;ctx.strokeStyle=eventColor;ctx.beginPath();
    ctx.arc(x,y,r+radius(5+pulse*17),0,Math.PI*2);ctx.stroke();ctx.restore();
   }
  }
  if(show.labels&&visible&&(selectedLab||fieldFilter!==null&&g.w>380||cameras[index].scale>1.6)){
   const label=lab.name+(selectedLab?' · '+lab.active+' active':'');
   ctx.font='600 '+radius(12)+'px '+FONT;ctx.textAlign='center';
   const width=ctx.measureText(label).width+12,top=y+r+radius(8);
   ctx.fillStyle=ink['map-bg'];ctx.fillRect(x-width/2,top,width,radius(17));
   ctx.fillStyle=ink['map-label-strong'];ctx.fillText(label,x,top+radius(12));
  }
 }
 ctx.globalAlpha=1;
}
function draw(canvas,s,index,t){
 if(!s)return;
 const g=canvasGeometry(canvas);if(!g)return;
 const {ctx,w,h}=g,camera=cameras[index],papers=view==='papers',nodes=papers?livePaperNodes(s,g):[],byPaper=new Map(nodes.map(n=>[n.paper.id,n]));
 ctx.clearRect(0,0,w,h);ctx.fillStyle=ink['map-bg'];ctx.fillRect(0,0,w,h);
 ctx.strokeStyle=ink['map-grid'];ctx.lineWidth=.7;
 for(let x=0;x<w;x+=32)for(let y=0;y<h;y+=32){ctx.fillStyle=ink['map-grid'];ctx.fillRect(x,y,2,2);}
 ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.scale,camera.scale);
 canvas.dataset.zoom=String(camera.scale);
 const pulse=!reducedMotion.matches&&Number.isFinite(t)?Math.min(1,Math.max(0,1-(mapMotionUntil-t)/300)):1;
 const radius=(r)=>r/Math.sqrt(camera.scale);
 if(!papers)drawTerritories(ctx,s,g,radius);
 if(show.links&&!papers)for(const edge of s.links){
  if(fieldFilter!==null&&s.labs[edge.a].domain!==fieldFilter&&s.labs[edge.b].domain!==fieldFilter)continue;
  const a=position(s.labs[edge.a],g),b=position(s.labs[edge.b],g);
  ctx.strokeStyle=s.labs[edge.a].domain!==s.labs[edge.b].domain?ink['map-cross']:ink['map-link'];
  const highlighted=edge.a===selected[index]||edge.b===selected[index];
  ctx.globalAlpha=selected[index]===null||highlighted?1:.36;
  ctx.setLineDash(s.labs[edge.a].domain!==s.labs[edge.b].domain?[4,4]:[]);
  drawChannel(ctx,a,b,.13,radius(highlighted?1.7:.8),ctx.strokeStyle);ctx.setLineDash([]);
  ctx.globalAlpha=1;
 }
 if(papers){
  const layout=paperLayout(s,g),focus=byPaper.get(selectedPaper[index]),sources=(s.citationEdges||[]).filter(e=>focus&&e.paperId===focus.paper.id);
  layout.domains.forEach((domain,i)=>{
   const y=layout.top+i*layout.lane;ctx.fillStyle=i%2?ink['map-lane-a']:ink['map-lane-b'];ctx.fillRect(0,y,w,layout.lane);
   ctx.fillStyle=domainColors[domain];ctx.font='600 11px '+FONT;ctx.textAlign='left';ctx.fillText(domainNames[domain],12,y+19);
  });
  ctx.font='11px '+FONT;ctx.fillStyle=ink.subtle;ctx.textAlign='left';ctx.fillText('PUBLISHED CLAIMS',12,20);
  ctx.fillText('Day '+layout.start,layout.left,h-12);ctx.textAlign='right';ctx.fillText('Day '+layout.end,layout.right,h-12);
  if(!nodes.length){ctx.textAlign='center';ctx.fillStyle=ink.muted;ctx.font='13px '+FONT;ctx.fillText('Advance model time to see published claims here.',w/2,h/2);}
  const fromLabs=[...new Set(sources.map(e=>e.from))];
  fromLabs.forEach((id,i)=>{
   const lab=s.labs[id],band=layout.domains.indexOf(lab.domain),other=fromLabs.filter(x=>s.labs[x].domain===lab.domain),j=other.indexOf(id);
   const y=band<0?layout.top+20+i*20:layout.top+band*layout.lane+34+(j+1)/(other.length+1)*(layout.lane-42),a={x:75,y};
   if(show.links){ctx.fillStyle=domainColors[lab.domain];ctx.beginPath();ctx.arc(a.x,a.y,4,0,6.283);ctx.fill();if(show.labels){ctx.font='10px '+FONT;ctx.textAlign='right';ctx.fillText(lab.name,a.x-8,a.y+3);}
    drawArrow(ctx,a,focus,lab.domain===focus.paper.domain?ink['map-flow-focus']:ink['map-cross']);}
   if(show.flows)for(const event of sources.filter(e=>e.from===id&&s.day-e.day<=8)){const f=Math.min(1,Math.max(0,(s.day-event.day)/8));ctx.fillStyle=ink['map-flow'];ctx.beginPath();ctx.arc(a.x+(focus.x-a.x)*f,a.y+(focus.y-a.y)*f,2.5,0,6.283);ctx.fill();}
  });
 }
 if(!papers&&show.flows)for(const flow of (s.citationEdges||[]).filter(e=>s.day-e.day<=8)){
  if(fieldFilter!==null&&s.labs[flow.from].domain!==fieldFilter&&s.labs[flow.to].domain!==fieldFilter)continue;
  const a=position(s.labs[flow.from],g),b=position(s.labs[flow.to],g),f=flow.day===s.day?pulse:1;
  const c=drawChannel(ctx,a,b,-.24,radius(flow.day===s.day?1.8:.85),ink[flow.day===s.day?'map-flow-focus':'map-flow-line']);
  if(flow.day===s.day){
   const x=(1-f)**2*a.x+2*f*(1-f)*c.x+f*f*b.x,y=(1-f)**2*a.y+2*f*(1-f)*c.y+f*f*b.y;
   drawResearchToken(ctx,x,y,radius(3.1),ink['map-flow'],'paper');
  }
 }
 if(!papers)drawLabNodes(ctx,s,g,index,pulse,radius);
 for(const n of nodes){
  const paper=n.paper,passed=(paper.replications||0)-(paper.failedReplications||0);
  ctx.fillStyle=paper.failedReplications?ink['claim-fail']:passed>0?ink['claim-pass']:ink['claim-open'];ctx.strokeStyle=domainColors[paper.domain];ctx.lineWidth=1.4;
  ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,6.283);ctx.fill();ctx.stroke();
  if(paper.domain!==s.labs[paper.labId].domain){ctx.strokeStyle=ink['map-cross-solid'];ctx.lineWidth=1;ctx.beginPath();ctx.arc(n.x,n.y,n.r+3,0,6.283);ctx.stroke();}
  if(selectedPaper[index]===paper.id){ctx.strokeStyle=ink['map-select'];ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(n.x,n.y,n.r+5,0,6.283);ctx.stroke();if(show.labels){ctx.fillStyle=ink['map-label-strong'];ctx.font='11px '+FONT;ctx.textAlign='left';ctx.fillText('#'+paper.id,n.x+10,n.y-8);}}
 }
 ctx.restore();
 canvas.dataset.mapView=view;canvas.dataset.visiblePapers=String(nodes.length);
 if(playing&&!reducedMotion.matches&&Number.isFinite(t)&&t<mapMotionUntil&&s.events[0]?.day===s.day)queueMap();
}
function drawMap(time){
  if(compareMode&&worlds[1]){
    draw($('network-a'),worlds[0],0,time);
    draw($('network-b'),worlds[1],1,time);
  }else draw(active===0?$('network-a'):$('network-b'),worlds[active],active,time);
}
function nearest(s,g,x,y){
  let best=-1,d=24/Math.sqrt(g.scale||1);
  for(const l of s.labs){if(fieldFilter!==null&&l.domain!==fieldFilter)continue;const p=position(l,g),r=Math.hypot(p.x-x,p.y-y);if(r<d){best=l.id;d=r;}}
  return best;
}
function canvasEvents(index){
  const canvas=$('network-'+(index?'b':'a'));canvas.tabIndex=0;
  const camera=cameras[index];
  const local=e=>{const b=canvas.getBoundingClientRect();return {x:e.clientX-b.left,y:e.clientY-b.top};};
  const mapPoint=p=>({x:(p.x-camera.x)/camera.scale,y:(p.y-camera.y)/camera.scale});
  canvas.addEventListener('wheel',e=>{
    if(!e.ctrlKey&&!e.metaKey)return;
    e.preventDefault();moveCamera(index,camera.scale*Math.exp(-e.deltaY*.005),local(e));
  },{passive:false});
  canvas.addEventListener('pointerdown',e=>{
    if(drag||e.button!==0||(index===1&&!worlds[1]))return;
    if(index!==active)chooseWorld(index);
    const start=local(e),p=mapPoint(start),g=canvasGeometry(canvas);
    if(!g)return;
    if(view==='papers'){
      const hit=livePaperNodes(nowWorld(),g).map(node=>({node,distance:Math.hypot(node.x-p.x,node.y-p.y)}))
        .filter(({node,distance})=>distance<node.r+5).sort((a,b)=>a.distance-b.distance)[0]?.node;
      if(hit){selected[index]=hit.paper.labId;selectedPaper[index]=hit.paper.id;inspector();drawMap();publishContext(true);return;}
    }
    const id=view==='labs'?nearest(nowWorld(),{...g,scale:camera.scale},p.x,p.y):-1;
    if(id<0){
      if(camera.scale>1||e.pointerType!=='touch'){
        drag={index,pointer:e.pointerId,start,pan:true,x:camera.x,y:camera.y};
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }
    const lab=nowWorld().labs[id];
    selected[index]=id;selectedPaper[index]=null;
    drag={index,pointer:e.pointerId,id,start,startPosition:{x:lab.x,y:lab.y},moved:false,wasPlaying:playing,before:networkFacts(nowWorld(),id)};
    play(false);canvas.setPointerCapture(e.pointerId);
    inspector();publishContext(true);queueMap();
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag||drag.index!==index||drag.pointer!==e.pointerId)return;
    const p=local(e),g=canvasGeometry(canvas);
    if(!g)return;
    const dx=p.x-drag.start.x,dy=p.y-drag.start.y;
    if(drag.pan){
      camera.x=Math.min(0,Math.max(g.w*(1-camera.scale),drag.x+dx));
      camera.y=Math.min(0,Math.max(g.h*(1-camera.scale),drag.y+dy));
    }else{
      if(Math.hypot(dx,dy)>8)drag.moved=true;
      if(!drag.moved)return;
      const lab=nowWorld().labs[drag.id];
      lab.x=Math.max(.04,Math.min(.96,drag.startPosition.x+dx/camera.scale/(g.w-g.pad*2)));
      lab.y=Math.max(.07,Math.min(.93,drag.startPosition.y+dy/camera.scale/(g.h-g.pad*2)));
    }
    queueMap();
  });
  function finishDrag(e,canceled){
    if(!drag||drag.index!==index||drag.pointer!==e.pointerId)return;
    const gesture=drag;drag=null;
    if(gesture.pan)return;
    if(gesture.moved){
      const lab=worlds[index].labs[gesture.id];
      if(canceled)Object.assign(lab,gesture.startPosition);
      else{
        E.intervention(worlds[index],'move',gesture.id,{x:lab.x,y:lab.y});
        trackUsage('laboratory_moved',{laboratory:gesture.id+1});
        const after=networkFacts(worlds[index],gesture.id);
        $('intervention-status').textContent=lab.name+': links '+gesture.before.selectedLinks+' → '+after.selectedLinks+'; across communities '+gesture.before.selectedCrossLinks+' → '+after.selectedCrossLinks+'.';
        mapLegend();emit('collaboration_changed',worlds[index],'network');
      }
    }
    inspector();publishContext(true);queueMap();if(gesture.wasPlaying)play(true);
  }
  canvas.addEventListener('pointerup',e=>finishDrag(e,false));
  canvas.addEventListener('pointercancel',e=>finishDrag(e,true));
  canvas.addEventListener('lostpointercapture',e=>finishDrag(e,true));
  canvas.addEventListener('keydown',e=>{
    if(['+','=','-','0'].includes(e.key)){
      e.preventDefault();moveCamera(index,e.key==='0'?1:camera.scale*(e.key==='-'?1/1.4:1.4));return;
    }
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();chooseWorld(index);
    const delta=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;
    const labs=worlds[index].labs.filter(lab=>fieldFilter===null||lab.domain===fieldFilter);
    const current=labs.findIndex(lab=>lab.id===selected[index]);
    selected[index]=labs[current<0?0:(current+delta+labs.length)%labs.length]?.id??null;
    selectedPaper[index]=null;inspector();publishContext(true);queueMap();
  });
}
function changeLab(action){
  if(!ensureComparison())return;
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
    syncRange(range,value,active?worlds[0].policy[key]:E.DEFAULTS[key]);
    range.dataset.policy=key;range.setAttribute('aria-label',name);
    range.addEventListener('input',()=>{
      if(!ensureComparison()){syncRange(range,nowWorld().policy[key]);return;}
      if(lesson&&active!==1){syncRange(range,nowWorld().policy[key]);return;}
      if(lesson?.observed){worlds[0]=E.fork(lessonCheckpoint);worlds[1]=E.fork(lessonCheckpoint);lesson.observed=false;lesson.startDay=worlds[0].day;render();}
      E.editPolicy(nowWorld(),key,range.value);syncRange(range);
      const current=$('policy-controls').querySelector('[data-policy='+key+']');
      if(current!==range){syncRange(current,range.value);text(current.closest('.policy-control').querySelector('output'),range.value+'/10');}
      trackUsage('parameter_changed',{parameter:key,value:Number(range.value)});
      head.querySelector('output').textContent=range.value+'/10';
      $('policy-live-status').textContent=name+' is now '+range.value+'/10 in World '+(active?'B':'A')+'. '+(playing?'Watch future model days; the effect can take time to appear.':'The model is paused. Advance days or press Play to observe the effect.');
      publishContext(true);emit('policy_changed',nowWorld(),'intervene');comparison();renderMetricTrends();queueMap();
      if(lesson)reportLesson(false);
      const spark=line.querySelector('svg');if(spark)spark.replaceWith(sparkline(series(nowWorld()).map(x=>x['policy_'+key]),name));
    });
    line.append(head,make('p','',hint),range,make('small','policy-reference','Applied immediately · Baseline '+(active?worlds[0].policy[key]:E.DEFAULTS[key])+'/10'));
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
    ' laboratories; truth prior '+(prior==='original'?'community-specific illustrative rates':(100*Number(prior)).toFixed(0)+'%')+
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
  if(on){
    renderPolicies();$('close-settings').focus({preventScroll:true});
    // Keep the actual map above the compact policy dock on narrow screens.
    if(innerWidth<=1120)$('canvases').scrollIntoView({block:'start',behavior:'instant'});
  }else if(returnFocus)$('settings').focus({preventScroll:true});
  publishContext(true);drawChart();
}
function setView(name){
  if(view!==name)trackUsage('view_changed',{view:name});
  view=name;
  for(const key of ['labs','papers']){
    $('view-'+key).classList.toggle('active',name===key);
    $('view-'+key).setAttribute('aria-pressed',String(name===key));
  }
  mapLegend();drawMap();publishContext(true);
}
/* Experiment recipes are transparent, authored model interventions, not
   generated science. The user explicitly chooses to advance both worlds. */
const REVIEW_CAPACITY={
 name:'Can peer review keep up with faster research?',key:'verification',label:'Peer-review policy',metric:'reviewBacklog',
 outcome:'Studies waiting for review',low:E.DEFAULTS.verification,high:8
};
const GUIDED_EXPERIMENTS={
 review_bottleneck:{
   name:'Can review keep up with faster research?',key:'generation',label:'Idea generation',metric:'reviewBacklog',outcome:'Studies waiting for review',low:3,high:9,
   rationale:'More attempted hypotheses may increase the review queue if review staffing is fixed.',
   observe:'Review backlog and publication counts',
   caution:'The throughput rates and staffing coefficients are uncalibrated assumptions.'
 },
 selective_reporting:{
   name:'What if positive results are rewarded?',key:'pressure',label:'Publication pressure',metric:'falsePublished',outcome:'False claims published in the model',low:3,high:9,
   rationale:'Selecting a favorable p-value from additional analyses can increase false positives.',
   observe:'False published claims and published counts',
   caution:'The number of analyses and publication-pressure response are hypothetical.'
 },
 replication_capacity:{
   name:'What changes when replication is easier?',key:'replication',label:'Independent repeat capacity',metric:'replicated',outcome:'Completed independent repeats',low:2,high:9,
   rationale:'More repeat-study capacity can uncover non-replicating publications, but does not prove any claim true.',
   observe:'Independent replications, withdrawals and queue size',
   caution:'Replications use synthetic independent normal samples, not real laboratory studies.'
 }
};
let level='simple',mediumScenario='review_capacity';
const simpleRuns=new Map(),mediumRuns=new Map();
let focusedRuns=null;
const MEDIUM_KEYS=['generation','verification','replication','sampleSize','transparency','pressure'];
const METRIC_INPUTS={
  reviewBacklog:['generation','verification'], published:['generation','verification','pressure'],
  falsePublished:['pressure','transparency','sampleSize'],
  replicated:['replication','verification'], retracted:['replication','verification']
};
let mediumValues={...E.DEFAULTS,verification:REVIEW_CAPACITY.high};
let focusDay=0,focusReplay=0,focusStage='generated';
let simpleSetting=REVIEW_CAPACITY.low;
const mediumDrafts=new Map();
const FOCUS_STAGES={
 generated:['Ideas generated','Teams propose hypotheses to test.'],
 tested:['Studies tested','Studies with a statistically detectable effect enter the review queue.'],
 reviewBacklog:['Studies waiting for review','Manuscripts wait while reviewers check their methods.'],
 published:['Studies published','Studies that pass review become papers.'],
 replicated:['Independent repeats completed','Some papers are tested again with a fresh sample.']
};
function traceStudy(world,recorded){
 // Follow the first study to receive an independent repeat in this run.
 const repeat=recorded.find(e=>e.type==='replication_passed'||e.type==='replication_failed');
 const study=world.hypotheses.find(h=>h.id===repeat?.hypothesisId)||world.hypotheses[0];
 if(!study)return [];
 const events=recorded.filter(e=>e.hypothesisId===study.id);
 const trace=[
  {day:study.created,stage:'generated',label:study.topic+' proposed'},
  {day:study.created,stage:'tested',label:'Initial test begins'}
 ];
 if(study.significant)trace.push({day:study.complete,stage:'reviewBacklog',label:'Study enters peer review'});
 const stages={
  hypothesis_rejected:['tested','Initial test finds no detectable effect'],
  review_rejected:['reviewBacklog','Manuscript rejected in peer review'],
  paper_published:['published','Manuscript accepted and published'],
  replication_passed:['replicated','Independent repeat succeeds'],
  replication_failed:['replicated','Independent repeat fails'],
  paper_retracted:['replicated','Paper withdrawn after a failed repeat']
 };
 for(const event of events){
  const step=stages[event.type];
  if(step)trace.push({day:event.day,stage:step[0],label:step[1]});
 }
 return trace.sort((a,b)=>a.day-b.day);
}
function drawLifecycle(run){
 const trace=run?.trace||[];
 const visited=trace.filter(step=>step.day<=focusDay);
 const current=visited.at(-1);
 const reached=new Set(visited.map(step=>step.stage));
 text('lifecycle-mode',current?trace[0].label.replace(/ proposed$/,''):'From idea to evidence');
 text('lifecycle-clock',run?'Day '+focusDay+' / '+FOCUS_DAYS:'Ready to run');
 $('flow-empty').hidden=!!run;
 $('research-flow').dataset.traceStage=current?current.stage:'';
 const event=$('lifecycle-event');
 event.hidden=!run;
 text(event,current?'Day '+current.day+' · '+visited.filter(step=>step.day===current.day).map(step=>step.label).join(' → '):'Waiting for the traced hypothesis');
 const activity=$('lifecycle-activity');
 activity.hidden=!run;
 const daily=run?.events[focusDay]||[];
 const counts=new Map();
 for(const item of daily){
  const label=FLOW_EVENTS[item.type]?.label;
  if(label)counts.set(label,(counts.get(label)||0)+1);
 }
 if(activity.frame!==run?.days[focusDay]){
  activity.frame=run?.days[focusDay];
  activity.replaceChildren(...[...counts].map(([label,count])=>make('span','activity-count',label+' '+count)));
 }

 for(const button of document.querySelectorAll('[data-stage]')){
  const count=button.querySelector('.station-count');
  text(count,run?run.days[focusDay][button.dataset.stage]:'—');
  button.classList.toggle('is-reached',reached.has(button.dataset.stage));
  button.classList.toggle('is-current',current?.stage===button.dataset.stage);
  button.setAttribute('aria-pressed',String(button.dataset.stage===focusStage));
 }
 text('focus-stage-detail',FOCUS_STAGES[focusStage][0]+(run?' '+run.days[focusDay][focusStage]:'')+' · '+FOCUS_STAGES[focusStage][1]);
}
function stopFocusedReplay(){
 cancelAnimationFrame(focusReplay);
 focusReplay=0;$('focus-pause').hidden=true;$('focus-replay').hidden=false;
}
function focusPending(){
 const baseline=E.DEFAULTS.verification,setting=simpleSetting;
 const inputs=level==='medium'?mediumValues:{verification:setting};
 const reference=focusedRuns?.b?.world.policy||focusedRuns?.a.world.policy||E.DEFAULTS;
 const dirty=Object.keys(inputs).some(key=>inputs[key]!==reference[key]);
 text('focus-run',level==='medium'?'Compare worlds':!simpleRuns.size?
  (setting===baseline?'Run baseline':'Run baseline and trial'):setting===baseline?'Replay baseline':'Run trial');
 const capacity=Math.floor(1+setting*.55);
 syncRange($('focus-setting'),setting,baseline);
 text('focus-setting-value',setting+' / 10');
 text('focus-setting-hint','Up to '+capacity+' reviews per day. This policy couples throughput and scrutiny. At 7+, one failed repeat can trigger withdrawal.');
 text('focus-setting-applied','Baseline '+baseline+'/10 · Applied '+(focusedRuns?reference.verification+'/10':'after run'));
 $('focus-setting').setAttribute('aria-valuetext',setting+' out of 10, up to '+capacity+' model reviews per day');
 const count=MEDIUM_KEYS.filter(key=>mediumValues[key]!==E.DEFAULTS[key]).length;
 $('focus-world-b').classList.toggle('is-pending',dirty);
 $('focus-causal-warning').hidden=count<2;
 text('focus-causal-warning','Multiple policies differ from World A. This comparison measures their combined effect.');
 text('focus-state',dirty?'Pending':focusedRuns?'Applied':'Ready');
 text('world-b-state',dirty?'Pending':focusedRuns?'Applied':'Settings ready');
 document.querySelector('.experiment-console').classList.toggle('is-pending',dirty);
 text('focus-status',dirty?'Settings changed. Run to measure.':focusedRuns?
  'Same seed · '+FOCUS_DAYS+' model days':'Synthetic teaching model');
 publishFocusedContext();
}
function focusInputs(metric){
 const keys=METRIC_INPUTS[metric]||['verification'];
 const values=focusedRuns?.b?.world.policy||focusedRuns?.a?.world.policy||(level==='medium'?mediumValues:{verification:Number($('focus-setting').value)});
 return keys.filter(key=>values[key]!==undefined).map(key=>
  policyDescriptions[key][0]+': '+values[key]+'/10').join(' · ');
}
function focusMetricLabel(metric){return metricInfo(metric)[0];}
function renderMediumControls(){
 const medium=level==='medium',host=$('focus-policy-grid'),primary=$('focus-main-policy');
 $('focus-medium-controls').hidden=!medium;
 document.querySelector('.focus-slider').hidden=medium;
 if(!medium)return;
 host.replaceChildren();primary.replaceChildren();
 for(const key of MEDIUM_KEYS){
  const [name,hint]=policyDescriptions[key],baseline=E.DEFAULTS[key];
  const label=make('label','focus-policy'),head=make('span','focus-policy-header');
  const value=make('span','policy-value',mediumValues[key]+'/10');
  head.append(make('strong','',name),value);
  const input=make('input');
  input.type='range';input.min='1';input.max='10';input.step='1';
  syncRange(input,mediumValues[key],baseline);
  input.setAttribute('aria-label',name+' in World B');
  const applied=make('small','policy-reference','Baseline '+baseline+'/10 · Applied '+(focusedRuns?.b?focusedRuns.b.world.policy[key]+'/10':'after run'));
  input.addEventListener('input',()=>{
   syncRange(input);mediumValues[key]=Number(input.value);text(value,input.value+'/10');focusPending();
  });
  input.dataset.guidedPolicy=key;
  label.append(head,input,make('small','',hint),applied);
  (key===focusedRecipe().key?primary:host).append(label);
 }
}
const WORLD_METRICS=[
 ['activeStudies','Testing','Studies currently running'],['reviewBacklog','Review queue','Manuscripts waiting at the end of the day'],
 ['published','Published','Cumulative accepted papers'],['replicated','Repeated','Cumulative independent repeats']
];
// Capture compact view state after each complete model day. Intermediate same-day
// transitions come from study records and the engine's ordered events.
const FLOW_EVENTS={
 hypothesis_generated:{label:'Study started',metric:'activeStudies'},
 hypothesis_rejected:{label:'No detectable effect',metric:'activeStudies',route:[1,5]},
 review_rejected:{label:'Rejected in review',metric:'reviewBacklog',route:[2,5]},
 paper_published:{label:'Paper published',metric:'published',route:[2,3]},
 replication_passed:{label:'Repeat passed',metric:'replicated',route:[4,6]},
 replication_failed:{label:'Repeat failed',metric:'replicated',route:[4,5]},
 paper_retracted:{label:'Paper withdrawn',metric:'replicated',route:[5,5]}
};
const worldPreviews=E.make(FOCUS_SEED).labs.map(({id,x,y,domain})=>({id,x,y,domain}));
function recordResearchDay(world,events,previous){
 const byId=new Map(world.hypotheses.map(study=>[study.id,study]));
 const identity=({id,labId,domain})=>({id,labId,domain});
 const review=world.queues.review.map(id=>identity(byId.get(id)));
 const replication=world.queues.replication.map(({id})=>identity(byId.get(id)));
 const testing=world.hypotheses.filter(study=>study.status==='testing').map(identity);
 const published=world.hypotheses.filter(study=>study.published&&!study.retracted).map(identity);
 const changes=[];
 for(const study of world.hypotheses){
  if(study.created===world.day)changes.push({...identity(study),route:[0,1],type:'hypothesis_generated'});
  if(study.tested&&study.significant&&study.complete===world.day)
   changes.push({...identity(study),route:[1,2],type:'review_entered'});
 }
 for(const event of events){
  const route=FLOW_EVENTS[event.type]?.route,study=byId.get(event.hypothesisId);
  if(route&&study)changes.push({...identity(study),route,type:event.type});
 }
 const priorRepeat=new Set(previous?.replication.map(study=>study.id));
 for(const study of replication){
  if(!priorRepeat.has(study.id))changes.push({...study,route:[3,4],type:'replication_queued'});
 }
 const movements=new Map();
 for(const change of changes){
  if(!movements.has(change.id))movements.set(change.id,[]);
  movements.get(change.id).push(change);
 }
 const repeats=events.filter(event=>event.type==='replication_passed'||event.type==='replication_failed')
  .map(({hypothesisId,type})=>({id:hypothesisId,passed:type==='replication_passed'}));
 return {testing,review,replication,published,movements,repeats:[...(previous?.repeats||[]),...repeats]};
}
const FLOW_COLORS={get wait(){return ink['flow-wait'];},get pass(){return ink['flow-pass'];},get stop(){return ink['flow-stop'];}};
const curve=(a,b,bend)=>({x:(a.x+b.x)/2+bend*(b.y-a.y),y:(a.y+b.y)/2-bend*(b.x-a.x)});
function drawChannel(ctx,a,b,bend,width,color){
 const c=curve(a,b,bend);
 ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.quadraticCurveTo(c.x,c.y,b.x,b.y);ctx.stroke();
 return c;
}
function drawResearchToken(ctx,x,y,r,color,kind){
 ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=1.35;ctx.beginPath();
 if(kind==='stop'){ctx.moveTo(x-r,y-r);ctx.lineTo(x+r,y+r);ctx.moveTo(x+r,y-r);ctx.lineTo(x-r,y+r);ctx.stroke();return;}
 if(kind==='pass'){ctx.moveTo(x-r,y);ctx.lineTo(x-r*.2,y+r*.72);ctx.lineTo(x+r,y-r);ctx.stroke();return;}
 if(kind==='wait'){ctx.moveTo(x,y-r);ctx.lineTo(x+r,y);ctx.lineTo(x,y+r);ctx.lineTo(x-r,y);ctx.closePath();}
 else if(kind==='paper')ctx.rect(x-r*.65,y-r,r*1.3,r*2);
 else ctx.arc(x,y,r,0,Math.PI*2);
 ctx.fill();
}
function drawResearchRun(canvas,run,side,progress){
 const g=canvasGeometry(canvas);if(!g)return;
 const {ctx,w,h}=g,world=side!==null,vertical=!world&&innerWidth<=620;
 const day=run?.research[focusDay];
 const at=(x,y)=>({x:w*x,y:h*y});
 const stations=world?[at(.17,.5),at(.38,.52),at(.61,.49),at(.81,.32),at(.83,.65),at(.67,.86),at(.94,.80)]:
  vertical?[at(.34,.10),at(.44,.30),at(.34,.51),at(.47,.70),at(.55,.89),at(.84,.59),at(.82,.91)]:
   [at(.10,.46),at(.30,.42),at(.50,.46),at(.70,.38),at(.90,.49),at(.53,.81),at(.91,.78)];
 const accent=ink['world-'+(side||'a')];
 const shade=(color,alpha)=>color+Math.round(alpha*2.55).toString(16).padStart(2,'0');
 ctx.clearRect(0,0,w,h);
 // The channel plan is visible before day zero. No study or outcome is drawn until observed.
 const routes=[[0,1],[1,2],[2,3],[3,4],[1,5],[2,5],[4,5],[4,6]];
 for(const [from,to] of routes){
  const branch=to>=5,wide=world?7:vertical?17:25;
  drawChannel(ctx,stations[from],stations[to],.23,branch?1:wide,shade(accent,branch?19:14));
  ctx.setLineDash(branch?[3,5]:[]);
  drawChannel(ctx,stations[from],stations[to],.23,1,shade(accent,branch?30:48));ctx.setLineDash([]);
 }
 const r=world?Math.max(8,Math.min(w*.048,24)):vertical?18:28;
 for(const [i,p] of stations.entries()){
  ctx.strokeStyle=shade(i===5?FLOW_COLORS.stop:i===6?FLOW_COLORS.pass:accent,i<5?53:29);
  const size=i<5?r:r*.56;
  if(i<5){
   const lens=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,size*1.8);
   lens.addColorStop(0,shade(accent,21));lens.addColorStop(1,'transparent');
   ctx.fillStyle=lens;ctx.fillRect(p.x-size*1.8,p.y-size*1.8,size*3.6,size*3.6);
  }
  ctx.lineWidth=1;ctx.beginPath();ctx.arc(p.x,p.y,size,0,Math.PI*2);ctx.stroke();
  if(i===2||i===4){ctx.beginPath();ctx.arc(p.x,p.y,r+5,0,Math.PI*2);ctx.stroke();}
 }
 const labPositions=world?worldPreviews.map(lab=>{
  // Use the same laboratory positions and scale for both matched worlds.
  const theta=lab.domain*Math.PI/2+Math.PI*.22;
  const x=.35+Math.cos(theta)*.24+(lab.x-.5)*.24,y=.47+Math.sin(theta)*.32+(lab.y-.5)*.26;
  return at(x,y);
 }):[];
 if(world){
  for(let domain=0;domain<4;domain++){
   const members=worldPreviews.filter(lab=>lab.domain===domain).map(lab=>labPositions[lab.id]);
   const center={x:members.reduce((sum,p)=>sum+p.x,0)/members.length,y:members.reduce((sum,p)=>sum+p.y,0)/members.length};
   const glow=ctx.createRadialGradient(center.x,center.y,0,center.x,center.y,w*.23);
   glow.addColorStop(0,shade(domainColors[domain],24));glow.addColorStop(1,'transparent');
   ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
  }
  const loads=new Map();
  for(const study of day?.testing||[])loads.set(study.labId,(loads.get(study.labId)||0)+1);
  for(const lab of worldPreviews){
   const p=labPositions[lab.id],load=loads.get(lab.id)||0;
   ctx.strokeStyle=shade(domainColors[lab.domain],load?68:42);
   ctx.fillStyle=shade(domainColors[lab.domain],load?28:10);
   ctx.beginPath();ctx.arc(p.x,p.y,2.5+Math.sqrt(load)*(w<230?1.4:2.4),0,Math.PI*2);ctx.fill();ctx.stroke();
  }
 }
 if(!day){canvas.dataset.studies='0';canvas.dataset.day='';canvas.dataset.progress='1';return;}
 const active=day.movements;
 const spread=(i,columns,step)=>({cross:(i%columns-(columns-1)/2)*step,along:Math.floor(i/columns)*step});
 const cohorts=[[day.testing,1,'study'],[day.review,2,'wait'],[day.replication,4,'wait'],[day.published,3,'paper']];
 for(const [studies,stage,kind] of cohorts){
  const color=kind==='wait'?FLOW_COLORS.wait:kind==='paper'?shade(accent,57):shade(accent,76);
  const columns=world?7:vertical?7:12,spacing=world?Math.min(7,w*.027):vertical?7:9;
  for(const [i,study] of studies.entries()){
   if(progress<1&&active.has(study.id))continue;
   const p=world&&stage===1?labPositions[study.labId]:stations[stage];
   const offset=spread(world&&stage===1?study.id%15:i,columns,spacing);
   let x=vertical?p.x+offset.cross:p.x-offset.along;
   let y=vertical?p.y-offset.along:p.y+offset.cross;
   if(!world&&stage===1){
    x=p.x+offset.cross;
    y=p.y+14+offset.along;
   }
   if(stage===2){x=p.x+offset.cross;y=p.y+12+offset.along;}
   if(stage===4){x=p.x+offset.cross;y=p.y-offset.along;}

   if(stage===3){x=p.x+offset.cross;y=p.y+offset.along+7;}
   if(world&&stage===1){x=p.x+offset.cross*.45;y=p.y+offset.along*.55-4;}
   if(x<5||x>w-5||y<5||y>h-5)continue;
   drawResearchToken(ctx,x,y,kind==='wait'?2.9:2.2,color,kind);
  }
 }
 // Archived repeat outcomes use the same per-mark scale in both worlds.
 day.repeats.forEach((repeat,i)=>{
  if(progress<1&&active.has(repeat.id))return;
  const p=stations[6],gap=world?3.8:5.4,cols=world?7:11;
  const x=p.x-(i%cols)*gap,y=p.y+13+Math.floor(i/cols)*gap;
  if(y<h-3)drawResearchToken(ctx,x,y,world?1.65:2.3,repeat.passed?FLOW_COLORS.pass:FLOW_COLORS.stop,repeat.passed?'pass':'stop');
 });
 for(const transitions of day.movements.values()){
  const index=Math.min(transitions.length-1,Math.floor(progress*transitions.length));
  const {id,labId,type,route:[from,to]}=transitions[index];
  const p0=world&&from===1?labPositions[labId]:stations[from],p1=world&&to===1?labPositions[labId]:stations[to];
  const offset=(id%9-4)*(world?1.6:3.3);
  const a={x:p0.x+offset,y:p0.y-offset},b={x:p1.x+offset,y:p1.y-offset};
  const t=Math.max(0,Math.min(1,progress*transitions.length-index)),c=curve(a,b,.23);
  const kind=to===5?'stop':to===6?'pass':'study';
  const color=kind==='stop'?FLOW_COLORS.stop:kind==='pass'?FLOW_COLORS.pass:to===2?FLOW_COLORS.wait:accent;
  if(progress===1&&kind==='study'&&to!==3)continue;
  const x=(1-t)**2*a.x+2*t*(1-t)*c.x+t*t*b.x,y=(1-t)**2*a.y+2*t*(1-t)*c.y+t*t*b.y;
  if(progress<1&&from!==to){
   drawChannel(ctx,a,{x,y},.1,2,shade(color,45));
  }
  drawResearchToken(ctx,x,y,world?3:4.4,color,kind);
  if(type==='paper_retracted'){ctx.strokeStyle=color;ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);ctx.stroke();}
 }
 canvas.dataset.studies=String(day.testing.length+day.review.length+day.replication.length);
 canvas.dataset.day=String(focusDay);canvas.dataset.progress=progress.toFixed(2);
 canvas.dataset.queue=String(day.review.length);

}
function drawFocusedAnimation(progress){
 if(level==='simple')drawResearchRun($('research-flow'),focusedRuns?.a,null,progress);
 if(level==='medium')for(const side of ['a','b'])
  drawResearchRun($('focus-world-'+side).querySelector('canvas'),focusedRuns?.[side],side,progress);
}
let inspectedWorld='a',inspectedMetric='reviewBacklog';
function mountWorldFields(){
 for(const side of ['a','b']){
  const field=$('focus-world-'+side).querySelector('.world-field');
  for(const [key,label] of WORLD_METRICS){
   const station=make('button','world-station');
   station.type='button';station.dataset.metric=key;
   station.append(make('span','world-metric',label),make('strong','','—'));
   station.addEventListener('click',()=>{inspectedWorld=side;inspectedMetric=key;drawFocusDay();publishFocusedContext();});
   field.append(station);
  }
 }
 for(const station of document.querySelectorAll('[data-stage]')){
  const count=make('span','station-count','—');count.setAttribute('aria-hidden','true');station.append(count);
 }
}
function drawWorldFields(a,b){
 const left=a?.days[focusDay],right=b?.days[focusDay];
 for(const [side,run,row] of [['a',a,left],['b',b,right]]){
  const host=$('focus-world-'+side);
  host.dataset.day=row?.day??'';
  for(const station of host.querySelectorAll('[data-metric]')){
   const key=station.dataset.metric;
   text(station.querySelector('strong'),row?.[key]??'—');
   station.setAttribute('aria-pressed',String(side===inspectedWorld&&key===inspectedMetric));
  }
 }
 const inspected=inspectedWorld==='a'?a:b;
 const metric=WORLD_METRICS.find(([key])=>key===inspectedMetric);
 const counts=new Map();
 for(const event of inspected?.events[focusDay]||[]){
  const item=FLOW_EVENTS[event.type];
  if(item?.metric===inspectedMetric)counts.set(item.label,(counts.get(item.label)||0)+1);
 }
 text('world-clock',a?'Day '+focusDay+' / '+FOCUS_DAYS:'Ready to run');
 text('world-inspection','World '+inspectedWorld.toUpperCase()+' · '+metric[2]+
  (inspected?' · '+(counts.size?[...counts].map(([label,count])=>label+' × '+count).join(' · '):'No recorded events at this station today.'):' · Run to observe'));
}
function focusedChartCard(metric,a,b){
 const card=make('article','focus-trend-card');
 const title=focusMetricLabel(metric),left=a?.summary[metric],right=b?.summary[metric];
 const head=make('div','focus-trend-head');
 head.append(make('h3','',title),make('strong','',left===undefined?'—':
  b?'A '+left+' · B '+right:String(left)));
 card.append(head);
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 640 110');svg.setAttribute('preserveAspectRatio','none');
 svg.setAttribute('role','img');svg.setAttribute('aria-label',title+' over 45 model days');
 const runs=[a,b].filter(Boolean),lines=runs.map(run=>run.days);
 const maximum=Math.max(1,...lines.flat().map(row=>Number(row[metric])||0));
 lines.forEach((rows,i)=>{
  const line=document.createElementNS(ns,'polyline');
  line.setAttribute('class',i?'focus-line-b':'focus-line-a');
  line.setAttribute('points',rows.map(row=>
   (8+(Number(row.day)||0)/FOCUS_DAYS*624)+','+(103-(Number(row[metric])||0)/maximum*95)).join(' '));
  svg.append(line);
 });card.append(svg);
 const inputs=focusInputs(metric),previous=level==='simple'?[...simpleRuns.values()].at(-2):null;
 const before=previous?.a?.summary[metric],difference=b&&Number.isFinite(right)&&Number.isFinite(left)?
  ' (Δ '+(right-left>0?'+':'')+(right-left)+')':
  before!==undefined&&left!==undefined?' (previous '+before+' → '+left+
  ', Δ '+(left-before>0?'+':'')+(left-before)+')':'';
 const outputs=left===undefined?'Run to measure':(b?'World A: '+left+' · World B: '+right:
  'Measured: '+left)+difference;
 const inputChange=level==='simple'&&previous&&previous.value!==focusedRuns.value?
  ' · review capacity '+previous.value+'/10 → '+focusedRuns.value+'/10':'';
 card.append(make('p','focus-chart-caption','Input · '+inputs+inputChange+' → Output · '+title+' · '+outputs));
 const ask=make('button','text-btn','Ask Pulsar to explain this graph');
 ask.type='button';ask.addEventListener('click',()=>{
  G.askPulsar?.('Explain the '+title+' chart in '+level+' mode. Inputs: '+inputs+
   '. Outputs: '+outputs+'. Why might the values change and what cannot be concluded?');
 });card.append(ask);
 return card;
}
function renderFocusedCharts(a,b){
 const host=$('focus-extra-charts');host.replaceChildren();
 const metrics=level==='medium'?['published','falsePublished','replicated']:['published','falsePublished'];
 for(const key of metrics)host.append(focusedChartCard(key,a,b));
 const measured=a?.summary[focusedRecipe().metric];
 const changed=level==='medium'&&focusedRuns?.changes?.length?
  ' · Changed inputs: '+focusedRuns.changes.map(key=>policyDescriptions[key][0]).join(', '):'';
 text('focus-io-caption','Inputs · '+focusInputs(focusedRecipe().metric)+
  ' → Output · '+focusedRecipe().outcome+': '+(measured===undefined?'not yet measured':b?
   'World A '+measured+' / World B '+b.summary[focusedRecipe().metric]:measured)+changed+
  (level==='medium'&&focusedRuns?.changes?.length>1?' · Multiple changes cannot isolate one cause.':''));
}
function focusedRecipe(){return level==='simple'?REVIEW_CAPACITY:GUIDED_EXPERIMENTS[mediumScenario]||REVIEW_CAPACITY;}
function selectLevel(next,scenario,focus=false){
 if(!['simple','medium','advanced'].includes(next))return;
 stopFocusedReplay();focusDay=FOCUS_DAYS;
 if(level==='medium')mediumDrafts.set(mediumScenario,mediumValues);
 if(level==='advanced'&&next!==level){play(false);if(drawerOpen)settings(false,false);}
 if(next==='medium'&&(scenario==='review_capacity'||Object.hasOwn(GUIDED_EXPERIMENTS,scenario))){
  mediumScenario=scenario;
  const selected=GUIDED_EXPERIMENTS[scenario]||REVIEW_CAPACITY;
  // Guided scenarios start with one clearly labeled intervention.
  // A visitor may then explore up to six input policies deliberately.
  mediumValues=mediumDrafts.get(scenario)||{...E.DEFAULTS,[selected.key]:selected.high};
 }
 level=next;$('universe-app').dataset.level=level;
 document.querySelectorAll('[data-level-choice]').forEach(button=>{
  const active=button.dataset.levelChoice===level;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
 });
 if(level==='advanced'){render();drawMap();}
 else{
  focusedRuns=level==='simple'?[...simpleRuns.values()].at(-1):mediumRuns.get(mediumScenario);
  if(!focusedRuns)focusDay=0;
  $('focus-scenario').value=mediumScenario;
  const recipe=focusedRecipe(),medium=level==='medium';
  renderMediumControls();
  text('focus-kicker',medium?'Science Universe / Parallel Worlds':'Science Universe / Research Journey');
  text('focus-title',medium?'Two worlds, one starting point':recipe.name);
  text('focus-description',medium?'Change World B and watch both worlds run on the same clock.':'Follow studies from first hypothesis to independent repeat.');
  text('focus-setting-label','Peer-review policy');
  syncRange($('focus-setting'),simpleSetting,REVIEW_CAPACITY.low);
  drawFocused();focusPending();
  if(focus){const control=$(medium?'focus-scenario':'focus-setting');control.focus({preventScroll:true});control.scrollIntoView({block:'nearest'});}
 }
 publishContext(true);reportFocusedProgress();
}
function modelRun(recipe,value){
 const world=E.make(FOCUS_SEED,typeof value==='object'?value:{[recipe.key]:value});
 const days=[E.summary(world)],events=[[]],research=[recordResearchDay(world,[])];
 for(let day=1;day<=FOCUS_DAYS;day++){
  E.step(world,1);
  days.push(E.summary(world));
  const daily=world.events.filter(event=>event.day===day).reverse();
  events.push(daily);research.push(recordResearchDay(world,daily,research.at(-1)));
 }
 return {world,days,events,research,summary:days.at(-1),trace:traceStudy(world,events.flat())};
}
function runFocused(){
 if(level==='advanced')return;
 const recipe=focusedRecipe(),value=Number($('focus-setting').value);
 stopFocusedReplay();
 focusDay=FOCUS_DAYS;
 if(level==='medium'){
  const changed=MEDIUM_KEYS.filter(key=>mediumValues[key]!==E.DEFAULTS[key]);
  if(!changed.length){text('focus-status','Change at least one input in World B to compare outcomes.');return;}
  focusedRuns={value:mediumValues[recipe.key],
   a:modelRun(recipe,E.DEFAULTS),b:modelRun(recipe,mediumValues),changes:changed};
  mediumRuns.set(mediumScenario,focusedRuns);
  for(const input of document.querySelectorAll('[data-guided-policy]')){
   const key=input.dataset.guidedPolicy;
   text(input.parentElement.querySelector('.policy-reference'),'Baseline '+E.DEFAULTS[key]+'/10 · Applied '+mediumValues[key]+'/10');
  }
 }else{
  const baseline=recipe.low;
  if(!simpleRuns.has(baseline))simpleRuns.set(baseline,{value:baseline,a:modelRun(recipe,baseline),changes:[]});
  const run=simpleRuns.get(value)||{value,a:modelRun(recipe,value),changes:['verification']};
  simpleRuns.delete(value);simpleRuns.set(value,run);
  focusedRuns=run;
  focusStage='reviewBacklog';
 }
 trackUsage('step',{days:FOCUS_DAYS});
 drawFocused();focusPending();reportFocusedProgress();
 replayFocused();
}
function replayFocused(){
 if(!focusedRuns)return;
 stopFocusedReplay();
 if(matchMedia('(prefers-reduced-motion: reduce)').matches){focusDay=FOCUS_DAYS;drawFocusDay();return;}
 const start=performance.now(),from=focusDay>=FOCUS_DAYS?0:focusDay;
 function tick(now){
  const elapsed=(now-start)/(level==='simple'?285:235);
  const day=Math.min(FOCUS_DAYS,from+Math.floor(elapsed)+1);
  if(day!==focusDay){focusDay=day;drawFocusDay(false);}
  drawFocusedAnimation(Math.min(1,elapsed-Math.floor(elapsed)));
  if(elapsed<FOCUS_DAYS-from)focusReplay=requestAnimationFrame(tick);
  else{drawFocusedAnimation(1);stopFocusedReplay();focusPending();}
 }
 focusDay=from;drawFocusDay();
 $('focus-replay').hidden=true;$('focus-pause').hidden=false;
 text('focus-status','Playing recorded model days.');
 focusReplay=requestAnimationFrame(tick);
}
function focusComparison(){
 const baseline=simpleRuns.get(REVIEW_CAPACITY.low);
 const trial=focusedRuns;
 if(level!=='simple'||!baseline||!trial||baseline===trial)return '';
 const before=baseline.a.summary.reviewBacklog,after=trial.a.summary.reviewBacklog;
 const change=after-before;
 const direction=change<0?'smaller':change>0?'larger':'the same size';
 const prediction=document.querySelector('[name="queue-prediction"]:checked');
 const check=prediction?' Your prediction '+(Number(prediction.value)===Math.sign(change)?'matched this run.':'differed from this run.'):'';
 return 'Day 45 queue: '+before+' at '+baseline.value+'/10 → '+after+' at '+trial.value+'/10 ('+direction+').'+check+
  ' The queue grows when studies arrive faster than reviews finish. These results are from one matched seed.';
}
function drawFocusDay(drawCanvas=true){
 const recipe=focusedRecipe(),medium=level==='medium';
 const baseline=simpleRuns.get(REVIEW_CAPACITY.low);
 const a=medium?focusedRuns?.a:(baseline||focusedRuns)?.a;
 const b=medium?focusedRuns?.b:focusedRuns&&baseline!==focusedRuns?focusedRuns.a:null;
 const metric=medium?recipe.metric:focusStage;
 const left=a?.days[focusDay],right=b?.days[focusDay];
 const host=$('focus-results');
 text('focus-metric',medium?recipe.outcome:FOCUS_STAGES[metric][0]);
 if(medium)drawWorldFields(a,b);else drawLifecycle(b||a);
 if(drawCanvas)drawFocusedAnimation(1);
 const scores=medium?[['World A · baseline',left],['World B · intervention',right]]:
  right?[[baseline.value+'/10 · baseline',left],[focusedRuns.value+'/10 · trial',right]]:
  [[a?focusedRuns.value+'/10 · baseline':'Day 0',left||{[metric]:0}]];
 host.replaceChildren(...scores.map(([label,row])=>{
  const score=make('div','focus-world-value');
  score.append(make('strong','',row?.[metric]??'—'),make('small','',label));
  return score;
 }));
 const maximum=Math.max(1,...[a,b].flatMap(run=>run?.days.map(row=>row[metric])||[]));
 for(const [side,run] of [['a',a],['b',b]]){
  const xy=(run?.days||[]).slice(0,focusDay+1).map(row=>
   [10+row.day/FOCUS_DAYS*620,168-row[metric]/maximum*151]);
  $('focus-line-'+side).setAttribute('points',xy.map(point=>point.join(',')).join(' '));
  const end=$('focus-point-'+side);
  end.toggleAttribute('hidden',!xy.length);
  if(xy.length){end.setAttribute('cx',xy.at(-1)[0]);end.setAttribute('cy',xy.at(-1)[1]);}
 }
 syncRange($('focus-time'),focusDay);
 text('focus-replay',focusDay>0&&focusDay<FOCUS_DAYS?'Resume':'Replay');
 document.querySelector('.focus-stage').hidden=!focusedRuns||focusDay<1;
 $('focus-more').hidden=!focusedRuns||focusDay<FOCUS_DAYS;
 $('focus-io-caption').hidden=$('focus-more').hidden;
 $('focus-comparison').hidden=focusDay<FOCUS_DAYS||!focusComparison();
 $('focus-next').hidden=$('focus-comparison').hidden;
 text('focus-time-label',focusDay);
}
function drawFocused(){
 const a=focusedRuns?.a,b=focusedRuns?.b;
 const simple=level==='simple';
 $('focus-pipeline').hidden=!simple;
 $('focus-worlds').hidden=simple;
 document.querySelector('.focus-stage').hidden=simple&&!focusedRuns;
 $('focus-more').hidden=!focusedRuns;
 $('focus-io-caption').hidden=simple&&!focusedRuns;
 $('focus-timeline').hidden=!focusedRuns;
 $('focus-prediction').hidden=!simple||!simpleRuns.size;
 const comparison=focusComparison();
 $('focus-comparison').hidden=!comparison;
 $('focus-next').hidden=!comparison;
 text('focus-comparison',comparison);
 drawFocusDay();
 renderFocusedCharts(a,b);
}
function resetFocused(){
 stopFocusedReplay();focusDay=FOCUS_DAYS;
 if(level==='simple'){
  simpleRuns.clear();focusStage='generated';simpleSetting=REVIEW_CAPACITY.low;
  for(const option of document.querySelectorAll('[name="queue-prediction"]'))option.checked=false;
 }else{
  mediumRuns.delete(mediumScenario);
  mediumValues={...E.DEFAULTS,[focusedRecipe().key]:focusedRecipe().high};
 }
 selectLevel(level);
}
function reportFocusedProgress(){
 if(level==='advanced'){G.learningProgress?.({level});return;}
 const recipe=focusedRecipe();
 const runs=level==='simple'?[...simpleRuns.values()].slice(-2):focusedRuns?[focusedRuns]:[];
 G.learningProgress?.({
  level,metric:recipe.metric,scenario:level==='medium'?mediumScenario:'',
  trials:runs.map(run=>({setting:run.value,result:(run.b||run.a).summary[recipe.metric]})),
  baseline:level==='medium'?{setting:E.DEFAULTS[recipe.key],result:focusedRuns?.a.summary[recipe.metric]??null}:null
 });
}
function publishFocusedContext(){
 const a=focusedRuns?.a,b=focusedRuns?.b,run=b||a,recipe=focusedRecipe();
 const baseline=level==='simple'?simpleRuns.get(REVIEW_CAPACITY.low)?.a:null;
 const observed=run?.days[focusDay];
 const inputs=level==='medium'?mediumValues:{verification:Number($('focus-setting').value)};
 const applied=run?.world.policy||E.DEFAULTS;
 const changes=Object.keys(inputs).filter(key=>inputs[key]!==applied[key]);
 G.context({level,world:b?'B':'A',day:observed?.day||0,hasFork:!!b,view:'focused',
  policies:applied,metrics:observed||{},seed:FOCUS_SEED,policyEditing:!!changes.length,
  comparison:b?{a:a.summary,b:b.summary}:baseline&&a&&baseline!==a?{a:baseline.summary,b:a.summary}:null,
  lesson:{policy:recipe.key,observed:!!run},focusedMetric:level==='simple'?focusStage:inspectedMetric,
  changes:changes.length?changes.map(key=>({key,before:applied[key],after:inputs[key],day:run?.world.day||0})):
   (focusedRuns?.changes||[]).map(key=>({key,before:E.DEFAULTS[key],after:applied[key],day:0}))});
}
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
    if(!ensureComparison())return;
    const field=key==='ai_adoption'?'aiAdoption':key;
    if(E.editPolicy(nowWorld(),field,value)){renderPolicies();comparison();emit('policy_changed',nowWorld(),'intervene');}
  });
  G.onCommand(cmd=>{
    if(cmd==='play')play(true);if(cmd==='pause')play(false);
    if(cmd==='reset'||cmd==='replay'){reset();if(cmd==='replay')play(true);}
  });
  G.onLayer(({key,enabled})=>{
    if(Object.prototype.hasOwnProperty.call(show,key)){
      show[key]=!!enabled;$('layer-'+key).checked=!!enabled;queueMap();
    }
  });
  G.onExperiment(id=>{selectLevel('advanced');runGuidedExperiment(id);});
  G.onLevel?.(({level,scenario,focus})=>selectLevel(level,scenario,focus));
  if(G.onLesson)G.onLesson(startLesson);
  if(G.onComparison)G.onComparison(runAtlasComparison);
  G.onSection(section=>{
    if(section==='companion')return;
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
  $('back-labs').addEventListener('click',event=>{if(window.parent!==window){event.preventDefault();shellAction('catalog');}});
  document.querySelectorAll('[data-level-choice]').forEach(button=>button.addEventListener('click',()=>selectLevel(button.dataset.levelChoice)));
  $('focus-setting').addEventListener('input',event=>{simpleSetting=Number(event.target.value);focusPending();});
  $('plot-ask').addEventListener('click',()=>G.askPulsar?.('Explain the '+metricInfo(plot)[0]+' chart. '+$('plot-io-caption').textContent+'. Explain the causal uncertainty of this simulated outcome.'));
  $('focus-run').addEventListener('click',runFocused);
  $('focus-replay').addEventListener('click',replayFocused);
  $('focus-pause').addEventListener('click',()=>{stopFocusedReplay();drawFocusedAnimation(1);text('focus-status','Paused at day '+focusDay+'.');$('focus-replay').focus();});
  $('focus-reset').addEventListener('click',resetFocused);
  $('focus-next').addEventListener('click',()=>selectLevel('medium','review_bottleneck',true));
  $('focus-scenario').addEventListener('change',event=>selectLevel('medium',event.target.value,true));
  $('focus-sources').addEventListener('click',()=>{
   if(window.parent===window)showDialog('method-dialog');
   else shellAction('sources');
  });
  $('focus-explain').hidden=window.parent===window;
  $('focus-explain').addEventListener('click',()=>{
   publishFocusedContext();
   G.askPulsar?.(focusedRuns?'What did this completed experiment show, and why might the result have changed?':'How should I interpret the settings before running this experiment?');
  });
  $('focus-time').addEventListener('input',event=>{
   stopFocusedReplay();
   focusDay=Number(event.target.value);
   drawFocusDay();focusPending();
  });
  $('focus-prediction').addEventListener('change',()=>text('focus-comparison',focusComparison()));
  for(const button of document.querySelectorAll('[data-stage]'))button.addEventListener('click',()=>{
   focusStage=button.dataset.stage;
   drawFocusDay();publishFocusedContext();
  });
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
  $('advance').addEventListener('click',()=>advance(1));
  $('reset').addEventListener('click',reset);
  $('speed').addEventListener('change',e=>speed=Number(e.target.value)||1);
  $('world-a').addEventListener('click',()=>chooseWorld(0));
  $('world-b').addEventListener('click',()=>chooseWorld(1));
  $('fork').addEventListener('click',()=>{$('comparison-setup').hidden=false;updateSetupBaseline();$('comparison-setup').scrollIntoView({block:'start'});});
  $('setup-policy').addEventListener('change',updateSetupBaseline);
  $('setup-value').addEventListener('input',()=>{syncRange($('setup-value'));text('setup-output',$('setup-value').value+'/10');});
  syncRange($('setup-value'),$('setup-value').value,nowWorld().policy.verification);
  $('start-comparison').addEventListener('click',()=>{const key=$('setup-policy').value,value=Number($('setup-value').value);const checkpoint=E.fork(nowWorld());if(value===checkpoint.policy[key]){text('setup-status','Choose a value different from World A.');return;}play(false);worlds[0]=E.fork(checkpoint);fork();E.editPolicy(worlds[1],key,value);lesson=null;$('comparison-setup').hidden=true;renderPolicies();render();emit('policy_changed',worlds[1],'intervene');});
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
    $('layer-'+name).addEventListener('change',e=>{show[name]=e.target.checked;queueMap();});
  $('zoom-in').addEventListener('click',()=>moveCamera(active,cameras[active].scale*1.4));
  $('zoom-out').addEventListener('click',()=>moveCamera(active,cameras[active].scale/1.4));
  $('zoom-reset').addEventListener('click',()=>moveCamera(active,1));
  new ResizeObserver(()=>{if(level==='advanced')queueMap();}).observe($('canvases'));
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
    if(level==='advanced'&&e.code==='Space'&&e.target===document.body){e.preventDefault();play(!playing);}
  });
  canvasEvents(0);canvasEvents(1);
}
function animation(now){
  const tick=1000/speed;
  if(playing&&now-lastSimulation>=tick){
    const chunks=Math.min(4,Math.floor((now-lastSimulation)/tick));
    lastSimulation+=chunks*tick;
    for(const s of runningWorlds())E.step(s,chunks);
    render();interesting();snapshotInsight();
  }
   if(playing)raf=requestAnimationFrame(animation);
}
/* Dropdowns. The list a browser draws for <select> belongs to the operating
   system (a white-on-blue strip on Windows) and CSS cannot reach it, so the
   list is drawn here, as the workspace does in assets/ws/ws-select.js. The
   sandbox cannot import that module, so this is the same behaviour in brief:
   the native <select> stays the closed control and keeps its value; a click
   or opening key opens our list instead, and choosing sets selectedIndex and
   fires input and change, so every caller keeps working. Touch keeps the
   phone's own picker. The list is a popover so it sits above open dialogs. */
function installSelects(){
  const OPEN=new Set(['Enter',' ','ArrowDown','ArrowUp']),popover=typeof HTMLElement.prototype.showPopover==='function';
  const CHECK='<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  let cur=null,pointer='mouse',seq=0;
  const eligible=n=>n instanceof HTMLSelectElement&&!n.multiple&&!(n.size>1)&&!n.disabled;
  function close(refocus){
    if(!cur)return;const {select,pop}=cur;cur=null;
    select.removeAttribute('aria-expanded');select.removeAttribute('aria-activedescendant');select.classList.remove('is-open');
    if(popover){try{pop.hidePopover();}catch(_){}}pop.remove();
    if(refocus)select.focus({preventScroll:true});
  }
  function highlight(i){
    if(!cur||!cur.rows.length)return;
    const next=Math.max(0,Math.min(cur.rows.length-1,i));cur.active=next;
    cur.rows.forEach((r,j)=>r.classList.toggle('is-active',j===next));
    cur.select.setAttribute('aria-activedescendant',cur.rows[next].id);cur.rows[next].scrollIntoView({block:'nearest'});
  }
  function choose(i){
    if(!cur)return;const {select,rows}=cur,row=rows[i];close(true);if(!row)return;
    const index=Number(row.dataset.index);if(select.selectedIndex===index)return;
    select.selectedIndex=index;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function place(){
    const {select,pop}=cur,box=select.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=innerHeight;
    pop.style.minWidth=Math.round(box.width)+'px';pop.style.maxWidth=Math.max(box.width,Math.min(360,vw-32))+'px';
    const below=vh-box.bottom-12,above=box.top-12,up=below<180&&above>below;
    pop.style.maxHeight=Math.min(320,Math.max(120,up?above:below))+'px';
    const left=Math.max(8,Math.min(box.left,vw-pop.offsetWidth-8));
    pop.style.left=Math.round(left)+'px';pop.style.top=Math.round(up?box.top-pop.offsetHeight-6:box.bottom+6)+'px';pop.classList.toggle('is-up',up);
  }
  function open(select){
    close();
    const id='select-pop-'+(++seq),pop=make('div','select-pop');pop.id=id;pop.setAttribute('role','listbox');
    const name=select.getAttribute('aria-label')||select.labels?.[0]?.textContent?.trim();if(name)pop.setAttribute('aria-label',name);
    if(popover)pop.popover='manual';
    const rows=[];
    for(const option of select.options){
      if(option.hidden)continue;
      const row=make('div','select-pop__option'),i=rows.length,selected=option.index===select.selectedIndex;
      row.id=id+'-'+option.index;row.dataset.index=String(option.index);row.setAttribute('role','option');row.setAttribute('aria-selected',String(selected));
      row.append(make('span','',option.textContent));if(selected)row.insertAdjacentHTML('beforeend',CHECK);
      row.addEventListener('click',()=>choose(i));row.addEventListener('pointermove',()=>{if(cur&&cur.active!==i)highlight(i);});
      rows.push(row);pop.append(row);
    }
    if(!rows.length)return;
    pop.addEventListener('pointerdown',e=>e.preventDefault());
    (popover?document.body:(select.closest('dialog')||document.body)).append(pop);if(popover)pop.showPopover();
    cur={select,pop,rows,active:-1,typed:'',typedAt:0};
    select.setAttribute('aria-expanded','true');select.setAttribute('aria-controls',id);select.classList.add('is-open');
    place();highlight(Math.max(0,rows.findIndex(r=>r.getAttribute('aria-selected')==='true')));
  }
  document.addEventListener('pointerdown',e=>{pointer=e.pointerType||'mouse';if(cur&&!cur.pop.contains(e.target)&&e.target!==cur.select)close();},true);
  document.addEventListener('mousedown',e=>{
    const select=e.target instanceof Element&&e.target.closest('select');
    if(!eligible(select)||pointer==='touch'||e.button!==0)return;
    e.preventDefault();select.focus({preventScroll:true});
    if(cur?.select===select)close();else open(select);
  },true);
  document.addEventListener('keydown',e=>{
    const select=e.target;if(!eligible(select))return;const k=e.key;
    if(cur?.select!==select){if(OPEN.has(k)||(e.altKey&&k==='ArrowDown')){e.preventDefault();open(select);}return;}
    if(k==='ArrowDown'){e.preventDefault();highlight(cur.active+1);}
    else if(k==='ArrowUp'){e.preventDefault();highlight(cur.active-1);}
    else if(k==='Home'||k==='PageUp'){e.preventDefault();highlight(0);}
    else if(k==='End'||k==='PageDown'){e.preventDefault();highlight(cur.rows.length-1);}
    else if(k==='Enter'||k===' '){e.preventDefault();choose(cur.active);}
    else if(k==='Escape'){e.preventDefault();e.stopPropagation();close(true);}
    else if(k==='Tab')close();
    else if(k.length===1&&/\S/.test(k)&&!e.ctrlKey&&!e.metaKey){
      e.preventDefault();const now=Date.now();cur.typed=now-cur.typedAt>700?k.toLowerCase():cur.typed+k.toLowerCase();cur.typedAt=now;
      for(let step=1;step<=cur.rows.length;step++){const i=(cur.active+step)%cur.rows.length;if(cur.rows[i].textContent.trim().toLowerCase().startsWith(cur.typed)){highlight(i);break;}}
    }
  },true);
  document.addEventListener('focusout',e=>{if(cur&&e.target===cur.select)setTimeout(()=>{if(cur&&document.activeElement!==cur.select)close();});});
  // A list pinned to a control that has moved is worse than no list.
  document.addEventListener('scroll',e=>{if(cur&&!cur.pop.contains(e.target))close();},true);
  addEventListener('resize',()=>close());
}
mountWorkspace();mountWorldFields();bind();render();bridge();installSelects();selectLevel('simple');
if(G.onTheme)G.onTheme(()=>{readInk();drawChart();if(level==='advanced')queueMap();else drawFocusedAnimation(1);});
const focusResize=new ResizeObserver(()=>{if(level!=='advanced'&&!focusReplay)drawFocusedAnimation(1);});
for(const id of ['focus-worlds','research-flow'])focusResize.observe($(id));
// The host hides Pulsar while a dialog in here dims the workspace, so the
// companion never floats undimmed over a modal backdrop.
if(G.modal)new MutationObserver(()=>G.modal(!!document.querySelector('dialog[open]')))
  .observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);cancelAnimationFrame(mapFrame);mapFrame=0;stopFocusedReplay();});
window.addEventListener('pageshow',event=>{if(event.persisted){if(playing){lastSimulation=performance.now();raf=requestAnimationFrame(animation);}if(level==='advanced')queueMap();}});
})();
