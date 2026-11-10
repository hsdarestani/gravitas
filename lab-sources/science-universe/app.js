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
    'agent-ai','agent-human','world-a','world-b','hairline','subtle','muted'])ink[key]=v(key);
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
function ensureComparison(){if(worlds[1])return true;$('comparison-setup').hidden=false;$('setup-status').textContent='First create World B, then advance both worlds together.';$('comparison-setup').scrollIntoView({block:'start'});return false;}
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
  if(wasPlaying!==playing)trackUsage(playing?'play':'pause');
  $('play').innerHTML=(playing?PAUSE_ICON:PLAY_ICON)+'<span>'+(playing?'Pause':'Play')+'</span>';
  $('status-label').textContent=playing?'SIMULATION RUNNING':'SIMULATION PAUSED';
  $('session-state').classList.toggle('spinning',playing);
  document.body.dataset.playing=String(playing);
  const label=document.querySelector('.live-indicator');if(label)label.lastChild.textContent=playing?' MODEL RUNNING':' MODEL PAUSED';
}
function reset(){
 for(let i=0;i<2;i++)if(worlds[i]){const s=worlds[i];worlds[i]=E.make(s.seed,{...s.policy},{...s.design});selected[i]=null;selectedPaper[i]=null;eventSeen[i].clear();}
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
 text('map-explanation',papers?'Small dots are published claims. Pick one to see its citations.':'Larger circles have more studies in progress. Drag a team to change its possible collaborators.');
 text('canvas-instruction',papers?'Select a claim → inspect its citations':'Size = active studies · Lines = possible collaborators');
 text('links-label',papers?'Selected citations':'Collaborations');text('flows-label',papers?'Recent activity':'Team & citations');
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
function draw(canvas,s,index,t){
 if(!s)return;
 const g=canvasGeometry(canvas);if(!g)return;
 const {ctx,w,h}=g,papers=view==='papers',nodes=papers?livePaperNodes(s,g):[],byPaper=new Map(nodes.map(n=>[n.paper.id,n]));
 ctx.clearRect(0,0,w,h);ctx.fillStyle=ink['map-bg'];ctx.fillRect(0,0,w,h);
 ctx.strokeStyle=ink['map-grid'];ctx.lineWidth=.7;
 for(let x=0;x<w;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
 for(let y=0;y<h;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
 if(!papers)for(let domain=0;domain<4;domain++){
  const group=s.labs.filter(l=>l.domain===domain).map(l=>position(l,g));if(!group.length)continue;
  const x=group.reduce((sum,p)=>sum+p.x,0)/group.length,y=group.reduce((sum,p)=>sum+p.y,0)/group.length;
  const rx=Math.max(48,...group.map(p=>Math.abs(p.x-x)+24)),ry=Math.max(44,...group.map(p=>Math.abs(p.y-y)+24));
  ctx.save();const aura=ctx.createRadialGradient(x,y,0,x,y,Math.max(rx,ry));
  aura.addColorStop(0,domainColors[domain]);aura.addColorStop(1,'transparent');
  ctx.globalAlpha=(fieldFilter===null||fieldFilter===domain) ? .19 : .04;ctx.fillStyle=aura;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();ctx.restore();
  ctx.fillStyle=domainColors[domain];ctx.globalAlpha=.7;ctx.font='600 11px '+FONT;ctx.textAlign='left';ctx.fillText(domainNames[domain],Math.max(10,x-rx+12),Math.max(18,y-ry+16));ctx.globalAlpha=1;
 }
 if(show.links&&!papers)for(const edge of s.links){
  if(fieldFilter!==null&&s.labs[edge.a].domain!==fieldFilter&&s.labs[edge.b].domain!==fieldFilter)continue;
  const a=position(s.labs[edge.a],g),b=position(s.labs[edge.b],g);
  ctx.strokeStyle=s.labs[edge.a].domain!==s.labs[edge.b].domain?ink['map-cross']:ink['map-link'];
  ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
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
  const a=position(s.labs[flow.from],g),b=position(s.labs[flow.to],g),f=Math.min(1,Math.max(0,(s.day-flow.day)/8));
  drawArrow(ctx,a,b,ink['map-flow-line']);ctx.fillStyle=ink['map-flow'];ctx.beginPath();ctx.arc(a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f,2.5,0,6.283);ctx.fill();
 }
 if(!papers)s.labs.forEach((l,i)=>{
  ctx.globalAlpha=fieldFilter===null||l.domain===fieldFilter?1:.18;
  const p=position(l,g),isSelected=selected[index]===i,r=papers?5:Math.min(18,9+Math.sqrt(l.active+1)*1.8);
  if(isSelected){ctx.strokeStyle=ink['map-select'];ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,r+8,0,6.283);ctx.stroke();}
  ctx.fillStyle=l.locked?ink['map-node-locked']:ink['map-node'];ctx.strokeStyle=domainColors[l.domain];ctx.lineWidth=papers?1:1.5;
  ctx.beginPath();ctx.arc(p.x,p.y,r,0,6.283);ctx.fill();ctx.stroke();
  if(!papers){ctx.fillStyle=domainColors[l.domain];ctx.beginPath();ctx.arc(p.x,p.y,2.8,0,6.283);ctx.fill();}
  if(!papers&&show.flows){
   const agents=s.agents.filter(a=>a.labId===i);
   agents.forEach((a,j)=>{const ang=-Math.PI/2+j*2*Math.PI/agents.length,orbit=r+9;
    ctx.fillStyle=a.role==='AI'?ink['agent-ai']:ink['agent-human'];ctx.beginPath();ctx.arc(p.x+Math.cos(ang)*orbit,p.y+Math.sin(ang)*orbit,1.9,0,6.283);ctx.fill();});
  }
  if(show.labels&&(isSelected||fieldFilter===l.domain||w>850)){
   ctx.fillStyle=isSelected?ink['map-label-strong']:ink['map-label'];ctx.font=isSelected?'600 11px '+FONT:'11px '+FONT;ctx.textAlign='center';ctx.fillText(l.name,p.x,p.y-r-12);
  }
 });
 ctx.globalAlpha=1;
 for(const n of nodes){
  const paper=n.paper,passed=(paper.replications||0)-(paper.failedReplications||0);
  ctx.fillStyle=paper.failedReplications?ink['claim-fail']:passed>0?ink['claim-pass']:ink['claim-open'];ctx.strokeStyle=domainColors[paper.domain];ctx.lineWidth=1.4;
  ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,6.283);ctx.fill();ctx.stroke();
  if(paper.domain!==s.labs[paper.labId].domain){ctx.strokeStyle=ink['map-cross-solid'];ctx.lineWidth=1;ctx.beginPath();ctx.arc(n.x,n.y,n.r+3,0,6.283);ctx.stroke();}
  if(selectedPaper[index]===paper.id){ctx.strokeStyle=ink['map-select'];ctx.lineWidth=1.6;ctx.beginPath();ctx.arc(n.x,n.y,n.r+5,0,6.283);ctx.stroke();if(show.labels){ctx.fillStyle=ink['map-label-strong'];ctx.font='11px '+FONT;ctx.textAlign='left';ctx.fillText('#'+paper.id,n.x+10,n.y-8);}}
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
      trackUsage('laboratory_moved',{laboratory:drag.id+1});
      const after=networkFacts(worlds[index],drag.id);
      $('intervention-status').textContent=l.name+': links '+drag.before.selectedLinks+' → '+after.selectedLinks+'; across communities '+drag.before.selectedCrossLinks+' → '+after.selectedCrossLinks+'. This changes future citation preferences, not existing evidence.';
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
    range.dataset.policy=key;range.setAttribute('aria-label',name);
    range.addEventListener('input',()=>{
      if(!ensureComparison()){range.value=nowWorld().policy[key];return;}
      if(lesson&&active!==1){range.value=nowWorld().policy[key];return;}
      if(lesson?.observed){worlds[0]=E.fork(lessonCheckpoint);worlds[1]=E.fork(lessonCheckpoint);lesson.observed=false;lesson.startDay=worlds[0].day;render();}
      E.editPolicy(nowWorld(),key,range.value);
      trackUsage('parameter_changed',{parameter:key,value:Number(range.value)});
      head.querySelector('output').textContent=range.value+'/10';
      $('policy-live-status').textContent=name+' is now '+range.value+'/10 in World '+(active?'B':'A')+'. '+(playing?'Watch future model days; the effect can take time to appear.':'The model is paused. Advance days or press Play to observe the effect.');
      publishContext(true);emit('policy_changed',nowWorld(),'intervene');comparison();renderMetricTrends();
      if(lesson)reportLesson(false);
      const spark=line.querySelector('svg');if(spark)spark.replaceWith(sparkline(series(nowWorld()).map(x=>x['policy_'+key]),name));
    });
    // The filled part of the track is drawn from --fill (styles.css).
    const fill=()=>range.style.setProperty('--fill',((range.value-1)/9*100)+'%');
    fill();range.addEventListener('input',fill);
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
 name:'Can peer review keep up?',key:'verification',label:'Peer review capacity',metric:'reviewBacklog',
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
const simpleExtraInputs={generation:E.DEFAULTS.generation,replication:E.DEFAULTS.replication};
let mediumDraft={};
const mediumChoices=['generation','verification','replication','funding','aiAdoption','transparency'];
const focusOutputLabels={reviewBacklog:'Studies awaiting peer review',published:'Published claims',replicated:'Completed independent repeats',falsePublished:'False claims published'};
function focusedRecipe(){return level==='simple'?REVIEW_CAPACITY:GUIDED_EXPERIMENTS[mediumScenario]||REVIEW_CAPACITY;}
// Complexity is an information gradient, not three labels on the same chart.
// Simple: three independent, single-input graphs. Medium: six of twelve policy
// inputs acting together on matched worlds. Advanced retains all twelve.
function renderMediumControls(){
 const host=$('focus-medium-controls');host.replaceChildren();
 host.hidden=level!=='medium';
 if(host.hidden)return;
 const recipe=focusedRecipe();
 const keys=[...new Set([recipe.key,...mediumChoices])].slice(0,6);
 const head=make('div','focus-medium-head');
 head.append(make('h2','','Six adjustable inputs · level 5 of 10'),
   make('p','','World A is the reference. Change up to six policy settings in World B; the other six stay at their model defaults.'));
 const grid=make('div','focus-medium-grid');
 for(const key of keys.filter(key=>key!==recipe.key)){
   const label=make('label','focus-slider');
   const name=make('span','',policyDescriptions[key][0]);
   const current=Number.isFinite(mediumDraft[key])?mediumDraft[key]:E.DEFAULTS[key];
   const output=make('output','',current+' / 10');
   const slider=make('input');
   slider.type='range';slider.min='1';slider.max='10';slider.step='1';slider.value=String(current);
   slider.setAttribute('aria-label',policyDescriptions[key][0]);
   slider.addEventListener('input',()=>{output.textContent=slider.value+' / 10';});
   slider.addEventListener('change',()=>{mediumDraft[key]=Number(slider.value);runFocused();});
   const hint=make('small','focus-model-disclaimer',policyDescriptions[key][1]+' · input scale 1–10');
   label.append(name,output,slider,hint);grid.append(label);
 }
 host.append(head,grid,make('p','focus-model-disclaimer',
   'Output graphs show counts after 45 synthetic model days. If several inputs change, their combined effect cannot be attributed to one setting.'));
}
function additionalGraph(rowsA,rowsB,metric){
 const svgNS='http://www.w3.org/2000/svg',svg=document.createElementNS(svgNS,'svg');
 svg.setAttribute('viewBox','0 0 640 105');svg.setAttribute('preserveAspectRatio','none');
 svg.setAttribute('role','img');svg.setAttribute('aria-label',metric+' by model day'+(rowsB.length?', World A and World B':''));
 const ymax=Math.max(1,...rowsA.concat(rowsB).map(row=>Number(row[metric])||0));
 const guide=document.createElementNS(svgNS,'line');guide.setAttribute('x1','0');guide.setAttribute('y1','102');
 guide.setAttribute('x2','640');guide.setAttribute('y2','102');svg.append(guide);
 for(const [rows,side] of [[rowsA,'a'],[rowsB,'b']]){
   if(!rows.length)continue;
   const line=document.createElementNS(svgNS,'polyline');
   if(side==='b')line.setAttribute('class','world-b');
   line.setAttribute('points',rows.map(row=>{
     const y=101-(Number(row[metric])||0)/ymax*94;
     return (8+Math.min(FOCUS_DAYS,row.day)/FOCUS_DAYS*624).toFixed(1)+','+y.toFixed(1);
   }).join(' '));
   svg.append(line);
 }
 return svg;
}
function renderAdditionalCharts(){
 const host=$('focus-secondary');host.replaceChildren();
 if(level==='advanced')return;
 const medium=level==='medium',primary=focusedRecipe().metric;
 const choices=medium?
   [{metric:'reviewBacklog',title:'Studies waiting for review'},
    {metric:'published',title:'Published research claims'},
    {metric:'replicated',title:'Independent repeat tests'},
    {metric:'falsePublished',title:'False claims published'}]
      .filter(item=>item.metric!==primary).slice(0,2):
   [{key:'generation',metric:'published',title:'Published research claims'},
    {key:'replication',metric:'replicated',title:'Independent repeat tests'}];
 for(const choice of choices){
   const key=choice.key;
   const value=medium?null:simpleExtraInputs[key];
   const a=medium?focusedRuns?.a:modelRun({key},value);
   const b=medium?focusedRuns?.b:null;
   const countA=a?.summary[choice.metric],countB=b?.summary[choice.metric];
   const card=make('article','focus-mini');
   const head=make('div','focus-mini-head');
   head.append(make('h2','',choice.title),make('strong','',countA===undefined?'—':medium&&countB!==undefined?countA+' / '+countB:countA));
   card.append(head,additionalGraph(a?[...a.world.history,a.summary]:[],
     b?[...b.world.history,b.summary]:[],choice.metric));
   if(!medium){
     const control=make('label','focus-slider');
     const name=make('span','',policyDescriptions[key][0]+' · input');
     const output=make('output','',value+' / 10');
     const slider=make('input');
     slider.type='range';slider.min='1';slider.max='10';slider.value=String(value);
     slider.setAttribute('aria-label',policyDescriptions[key][0]);
     slider.addEventListener('input',()=>{output.textContent=slider.value+' / 10';});
     slider.addEventListener('change',()=>{
       simpleExtraInputs[key]=Number(slider.value);
       renderAdditionalCharts();
       const focused=modelRun({key},simpleExtraInputs[key]);
       G.context?.({level:'simple',world:'A',day:FOCUS_DAYS,view:'focused',
         policies:focused.world.policy,metrics:focused.summary,focusedMetric:choice.metric,
         lesson:{policy:key,observed:true}});
     });
     control.append(name,output,slider);
     card.append(control);
   }
   const row=make('div','focus-mini-caption');
   const explanation=medium?
     'Input: up to six policy settings (1–10). Output: '+choice.title.toLowerCase()+
       ' · A '+(countA??'—')+' / B '+(countB??'—')+' · 45 days; model counts.':
     'Input: '+policyDescriptions[key][0]+' '+value+'/10. Output: '+choice.title.toLowerCase()+
       ' '+(countA??'—')+' after 45 days; model count.';
   const ask=make('button','focus-ask','Ask Pulsar why');ask.type='button';
   ask.addEventListener('click',()=>G.askPulsar?.(
     'Explain this simulation graph: '+explanation+
     ' What does the input change, what does the output measure, and what are its limits?'));
   row.append(make('span','',explanation),ask);
   card.append(row);host.append(card);
 }
}
function selectLevel(next,scenario,focus=false){
 if(!['simple','medium','advanced'].includes(next))return;
 if(level==='advanced'&&next!==level){play(false);if(drawerOpen)settings(false,false);}
 if(next==='medium'&&(scenario==='review_capacity'||Object.hasOwn(GUIDED_EXPERIMENTS,scenario)))mediumScenario=scenario;
 level=next;$('universe-app').dataset.level=level;
 document.querySelectorAll('[data-level-choice]').forEach(button=>{
  const active=button.dataset.levelChoice===level;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
 });
 if(level==='advanced'){render();drawMap();}
 else{
  focusedRuns=level==='simple'?[...simpleRuns.values()].at(-1):mediumRuns.get(mediumScenario);
  const recipe=focusedRecipe(),medium=level==='medium';
  if(medium)mediumDraft={...(focusedRuns?.overrides||{[recipe.key]:recipe.high})};
  text('focus-title',recipe.name);
  text('focus-description',medium?'World A stays fixed. Change World B and run both from the same starting point.':'Set the review capacity, run the model, then watch how many studies are still waiting.');
  text('focus-setting-label',recipe.label+(medium?' · World B':''));
  $('focus-setting').value=focusedRuns?.value??(medium?recipe.high:recipe.low);
  text('focus-setting-value',$('focus-setting').value+' / 10');
  text('focus-run',medium?'Compare both worlds':'Run simulation');
  renderMediumControls();
  drawFocused();
  if(focus){$('focus-setting').focus({preventScroll:true});$('focus-setting').scrollIntoView({block:'nearest'});}
 }
 publishContext(true);reportFocusedProgress();
}
function modelRun(recipe,value,overrides){
 const world=E.make(FOCUS_SEED,{[recipe.key]:value,...(overrides||{})});E.step(world,FOCUS_DAYS);
 return {world,summary:E.summary(world)};
}
function runFocused(){
 const recipe=focusedRecipe(),value=Number($('focus-setting').value);
 if(level==='medium'&&value===recipe.low){text('focus-status','Give World B a different setting from World A.');return;}
 const medium=level==='medium';
 const overrides=medium?{...mediumDraft,[recipe.key]:value}:null;
 const a=modelRun(recipe,medium?recipe.low:value),b=medium?modelRun(recipe,value,overrides):null;
 const changed=medium?Object.keys(E.DEFAULTS).filter(key=>a.world.policy[key]!==b.world.policy[key]):[];
 if(medium&&!changed.length){text('focus-status','Change at least one input in World B to compare.');return;}
 focusedRuns={value,a,b,overrides,changed};
 if(level==='simple'){simpleRuns.delete(value);simpleRuns.set(value,focusedRuns);}
 else mediumRuns.set(mediumScenario,focusedRuns);
 trackUsage('step',{days:FOCUS_DAYS});
 drawFocused();publishContext(true);reportFocusedProgress();
}
function drawFocused(){
 const recipe=focusedRecipe(),medium=level==='medium',a=focusedRuns?.a,b=focusedRuns?.b;
 const metric=recipe.metric,host=$('focus-results');
 text('focus-metric',recipe.outcome);
 if(medium){
  const scores=[['World A · '+recipe.low+'/10',a],['World B'+(b?' · '+focusedRuns.value+'/10':''),b]];
  host.replaceChildren(...scores.map(([label,run])=>{
   const score=make('div','focus-world-value');score.append(make('strong','',run?.summary[metric]??'—'),make('small','',label));return score;
  }));
 }else host.replaceChildren(make('strong','',a?.summary[metric]??'—'));
 const changed=focusedRuns?.changed||[];
 text('focus-status',a?(medium?
   'Worlds share a seed and duration · '+changed.length+' changed input'+(changed.length===1?'':'s')+(changed.length>1?' (combined effects; not a one-variable test).':'.'):
   'Completed at '+focusedRuns.value+'/10. Change a setting and run again.'):'45 model days per run · synthetic teaching model');
 text('focus-input-output','Input: '+recipe.label+' '+(a?.world.policy[recipe.key]??recipe.low)+'/10'+(b?' → '+b.world.policy[recipe.key]+'/10':'')+
   ' · Output: '+recipe.outcome.toLowerCase()+' after 45 model days · count (synthetic)');
 const series=run=>run?[...run.world.history,run.summary]:[];
 const pointsA=series(a),pointsB=series(b);
 const max=Math.max(1,...[...pointsA,...pointsB].map(row=>row[metric]));
 function drawLine(rows,side){
  const xy=rows.map(row=>[10+row.day/FOCUS_DAYS*620,168-row[metric]/max*151]);
  $('focus-line-'+side).setAttribute('points',xy.map(p=>p.join(',')).join(' '));
  const end=$('focus-point-'+side);end.toggleAttribute('hidden',!xy.length);
  if(xy.length){end.setAttribute('cx',xy.at(-1)[0]);end.setAttribute('cy',xy.at(-1)[1]);}
  return xy;
 }
 const xy=drawLine(pointsA,'a');drawLine(pointsB,'b');
 $('focus-area').setAttribute('d',!medium&&xy.length?'M'+xy.map(p=>p.join(',')).join(' L')+' L630 168 H10 Z':'');
 renderAdditionalCharts();
}
function reportFocusedProgress(){
 if(level==='advanced'){G.learningProgress?.({level});return;}
 const recipe=focusedRecipe();
 const runs=level==='simple'?[...simpleRuns.values()].slice(-2):focusedRuns?[focusedRuns]:[];
 G.learningProgress?.({
  level,metric:recipe.metric,scenario:level==='medium'?mediumScenario:'',
  trials:level==='medium'&&focusedRuns?.changed?.length>1?[]:runs.map(run=>({setting:run.value,result:(run.b||run.a).summary[recipe.metric]})),
  baseline:level==='medium'?{setting:recipe.low,result:focusedRuns?.a.summary[recipe.metric]??null}:null,
  multiChange:level==='medium'&&focusedRuns?.changed?.length>1
 });
}
function publishFocusedContext(){
 const a=focusedRuns?.a,b=focusedRuns?.b,run=b||a,recipe=focusedRecipe();
 G.context({level,world:b?'B':'A',day:run?.world.day||0,hasFork:!!b,view:'focused',
  policies:run?.world.policy||{...E.DEFAULTS},metrics:run?.summary||{},seed:FOCUS_SEED,
  comparison:b?{a:a.summary,b:b.summary}:null,
  lesson:{policy:recipe.key,observed:!!run},focusedMetric:recipe.metric});
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
      show[key]=!!enabled;$('layer-'+key).checked=!!enabled;
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
  $('focus-setting').addEventListener('input',event=>text('focus-setting-value',event.target.value+' / 10'));
  $('focus-run').addEventListener('click',runFocused);
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
  $('fork').addEventListener('click',()=>{$('comparison-setup').hidden=false;$('comparison-setup').scrollIntoView({block:'start'});});
  $('setup-policy').addEventListener('change',()=>text('setup-baseline','A · '+nowWorld().policy[$('setup-policy').value]+'/10'));
  $('setup-value').addEventListener('input',()=>text('setup-output',$('setup-value').value+'/10'));
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
  if(!playing)lastSimulation=now;
  if(level==='advanced')drawMap(nowWorld().day);
  raf=requestAnimationFrame(animation);
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
mountWorkspace();bind();render();bridge();installSelects();selectLevel('simple');
if(G.onTheme)G.onTheme(()=>{readInk();drawChart();drawMap(nowWorld().day);});
// The host hides Pulsar while a dialog in here dims the workspace, so the
// companion never floats undimmed over a modal backdrop.
if(G.modal)new MutationObserver(()=>G.modal(!!document.querySelector('dialog[open]')))
  .observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});
raf=requestAnimationFrame(animation);
window.addEventListener('pagehide',()=>cancelAnimationFrame(raf),{once:true});
})();
