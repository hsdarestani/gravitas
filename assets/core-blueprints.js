(function(){
'use strict';
window.__gravitasCoreBlueprintLoaded=true;

var content=document.getElementById('ws-content');
var actions=document.getElementById('ws-primary-actions');
var alertBox=document.getElementById('ws-alert');
var boot=null;
var zoom=1;

var sections=[
  {id:'strategy',n:'01',title:'Content Strategy & Objectives',short:'Strategy',owner:'Ahmad',icon:'◎',group:'flow',desc:'Defines why Gravitas+ creates content, who it is for, which themes matter, and what success should look like.',scope:['Purpose & North Star','Audience & pillars','Strategic value']},
  {id:'formats',n:'02',title:'Content Types & Formats',short:'Types & Formats',owner:'Ahmad + Kiarash',icon:'▤',group:'support',tone:'cyan',desc:'Defines the content formats Gravitas+ can produce and when each format should be used across channels.',scope:['Format catalogue','Use case by format','Channel fit']},
  {id:'discovery',n:'03',title:'Idea & Content Discovery',short:'Discovery',owner:'Ahmad',icon:'✦',group:'flow',desc:'Creates a repeatable way to find, capture and prioritize strong content ideas from signals, questions and opportunities.',scope:['Signals & sources','Idea intake','Prioritisation']},
  {id:'research',n:'04',title:'Research & Scientific Validation',short:'Research',owner:'Sajad',icon:'⌕',group:'flow',desc:'Turns an approved idea into evidence-backed material and checks scientific accuracy before production moves forward.',scope:['Research process','Evidence standard','Scientific validation']},
  {id:'planning',n:'05',title:'Content Planning',short:'Planning',owner:'Ahmad',icon:'≡',group:'flow',desc:'Converts the idea and research into a clear brief, required resources, production approach and expected deliverables.',scope:['Brief','Resources','Production plan']},
  {id:'production',n:'06',title:'Content Production',short:'Production',owner:'Kiarash + Ahmad',icon:'◉',group:'flow',desc:'Creates the actual content through writing, recording, visual production and assembly. Every production task must still have one clear owner.',scope:['Writing & script','Recording / build','Revision loop'],note:'Shared section ownership. Each task created inside Production must have exactly one named owner.'},
  {id:'design',n:'07',title:'Design & Content Experience',short:'Design & Experience',owner:'Kiarash',icon:'✎',group:'support',tone:'blue',desc:'Defines how content looks and feels, including visual language, templates, hierarchy and interactive presentation.',scope:['Visual language','Templates','Interactive experience']},
  {id:'review',n:'08',title:'Review & Quality Control',short:'Review',owner:'Sajad',icon:'◇',group:'flow',desc:'Checks scientific correctness, clarity and quality, then gives the final content approval before release.',scope:['Scientific review','Editorial quality','Approval logic']},
  {id:'publishing',n:'09',title:'Publishing',short:'Publish',owner:'Kiarash',icon:'↑',group:'flow',desc:'Prepares the approved asset for release with the correct format, metadata, presentation and publishing checklist.',scope:['Publishing checklist','Metadata & SEO','Final release']},
  {id:'distribution',n:'10',title:'Distribution',short:'Distribution',owner:'Ahmad',icon:'⌘',group:'flow',desc:'Decides where, when and how published content is distributed so it reaches the right audience across channels.',scope:['Channels','Timing','Cross-distribution']},
  {id:'repurposing',n:'11',title:'Repurposing & Content Atomization',short:'Repurpose',owner:'Ahmad',icon:'↻',group:'flow',desc:'Turns strong existing content into smaller or adapted assets for new formats, channels and future reuse.',scope:['Derivative assets','Format conversion','Reuse logic']},
  {id:'measurement',n:'12',title:'Measurement & Learning',short:'Measure',owner:'Kiarash',icon:'▥',group:'flow',desc:'Tracks performance, captures what worked or failed, and feeds practical learning back into the next content cycle.',scope:['KPIs','Analytics','Learning loop']},
  {id:'archive',n:'13',title:'Content Archive & Knowledge Integration',short:'Archive',owner:'Hossein',icon:'▣',group:'flow',desc:'Stores final assets, source material and lessons in a searchable system so future work can reuse the knowledge.',scope:['Asset library','Knowledge links','Version history']},
  {id:'operations',n:'14',title:'Content Operations & Workflow',short:'Content Ops & Workflow',owner:'Hossein',icon:'⚙',group:'support',tone:'blue',desc:'Defines statuses, ownership rules, dependencies and how the whole content process is represented inside Core Workspace.',scope:['Statuses & ownership','Dependencies','Workspace implementation']},
  {id:'ai',n:'15',title:'AI & Automation',short:'AI & Automation',owner:'Hossein',icon:'✣',group:'support',tone:'violet',desc:'Defines where AI or automation can accelerate the workflow and where human judgment or review must remain mandatory.',scope:['Assistive AI','Automation points','Human review boundaries']},
  {id:'governance',n:'16',title:'Content Risk & Governance',short:'Risk & Governance',owner:'Hossein + Sajad',icon:'⬡',group:'governance',tone:'gold',desc:'Sets the cross-cutting rules for scientific risk, copyright, AI use, corrections, accountability and content ownership.',scope:['Scientific risk','Copyright & AI use','Corrections & ownership']}
];
var flowIds=['strategy','discovery','research','planning','production','review','publishing','distribution','measurement','repurposing','archive'];
var supportTop=['formats','operations'];
var supportBottom=['design','ai'];

function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function find(id){return sections.find(function(x){return x.id===id})}
function coreAllowed(d){return !!(d&&d.access&&d.access.core)}
function setHeader(title,subtitle,kicker){
  var t=document.getElementById('ws-title'),s=document.getElementById('ws-subtitle'),k=document.getElementById('ws-kicker');
  if(t)t.textContent=title;if(s)s.textContent=subtitle;if(k)k.textContent=kicker||'CORE · ASSETS';
}
function setActions(html){if(actions)actions.innerHTML=html||''}
function chip(label,value){return '<span class="cb-meta-chip">'+esc(label)+(value?' · <strong>'+esc(value)+'</strong>':'')+'</span>'}
function sectionHref(){return '/workspace/core/assets/content-studio-blueprint'}
function say(text){if(!alertBox)return;alertBox.hidden=false;alertBox.textContent=text;clearTimeout(say.timer);say.timer=setTimeout(function(){alertBox.hidden=true},3200)}

function renderLibrary(){
  setHeader('Assets & Blueprints','System-level intellectual property, frameworks and operating assets owned by Gravitas+.','CORE · ASSETS');
  setActions('');
  content.innerHTML='<div class="cb-shell cb-library">'+
    '<div class="cb-library-head"><div><div class="cb-eyebrow">Core asset library</div><h2>Reusable systems, not loose files.</h2><p>Blueprints live here as versioned operating assets. Each one can become the source of tasks, standards and implementation work across Core.</p></div><span class="cb-count">1 system asset</span></div>'+
    '<div class="cb-asset-grid"><a class="cb-asset-card" href="'+sectionHref()+'" data-cb-go><div class="cb-card-top"><div class="cb-card-icon">⌘</div><div class="cb-card-tags">'+chip('Type','Blueprint')+chip('Status','Team approval')+'</div></div><h3>Content Studio Blueprint</h3><p>The draft architecture of Gravitas+ content operations: the complete section map from strategy and discovery through research, production, publishing, learning and governance.</p><div class="cb-card-foot"><div><small>Structure</small><b>16 sections · 11-stage lifecycle</b></div><span class="cb-open">Open approval draft →</span></div></a>'+
    '<aside class="cb-side-card"><h3>Current phase</h3><p>Approve section scope and ownership first. After approval, each section is broken into single-owner tasks and owners commit delivery deadlines.</p><div class="cb-side-stat"><span>Current assets</span><b>1</b></div><div class="cb-side-stat"><span>Draft sections</span><b>16</b></div><div class="cb-side-stat"><span>Current release</span><b>v0.2</b></div></aside></div></div>';
}

function supportCard(id){var x=find(id);return '<article class="cb-support" data-cb-section="'+x.id+'" data-tone="'+x.tone+'"><div class="cb-support__icon">'+x.icon+'</div><div><h4>'+esc(x.short)+'</h4><p>'+esc(x.desc)+'</p></div><span class="cb-owner">'+esc(x.owner)+'</span></article>'}
function stageCard(id){var x=find(id);return '<article class="cb-stage" data-cb-section="'+x.id+'"><div class="cb-stage__top"><span class="cb-stage__n">'+x.n+'</span><span class="cb-stage__icon">'+x.icon+'</span></div><h4>'+esc(x.short)+'</h4><p class="cb-stage__desc">'+esc(x.desc)+'</p><span class="cb-owner">'+esc(x.owner)+'</span></article>'}
function inspector(id){var x=find(id)||find('strategy');return '<div class="cb-inspector" id="cb-inspector"><div><div class="cb-eyebrow">Section '+x.n+'</div><h3>'+esc(x.title)+'</h3><p>'+esc(x.desc)+'</p>'+(x.note?'<p class="cb-inspector__note">'+esc(x.note)+'</p>':'')+'</div><div class="cb-inspector__tags">'+x.scope.map(function(t){return '<span class="cb-meta-chip">'+esc(t)+'</span>'}).join('')+'</div><span class="cb-inspector__state">Approval pending · '+esc(x.owner)+'</span></div>'}
function approvalSteps(){return '<section class="cb-approval"><div class="cb-approval__intro"><div class="cb-eyebrow">Approval workflow</div><h3>Approve the blueprint before turning it into execution.</h3><p>This version is for confirming section meaning and ownership. Task breakdown and deadlines come only after the team signs off on this structure.</p></div><div class="cb-approval__steps"><article class="is-current"><b>01</b><div><strong>Approve scope & ownership</strong><span>Team reviews this blueprint and confirms the section boundaries and owners.</span></div></article><article><b>02</b><div><strong>Break sections into tasks</strong><span>Each section becomes concrete tasks. Every task has exactly one owner.</span></div></article><article><b>03</b><div><strong>Commit deadlines</strong><span>Task owners confirm realistic delivery dates and execution starts.</span></div></article></div><div class="cb-approval__actions"><button type="button" class="ws-secondary-btn" data-cb-copy-link>Copy approval link</button><button type="button" class="ws-secondary-btn" data-cb-copy-summary>Copy approval summary</button></div></section>'}

function renderAsset(){
  setHeader('Content Studio Blueprint','Team approval draft: confirm section meaning and ownership before task breakdown.','CORE · SYSTEM ASSET');
  setActions('<a class="ws-secondary-btn" href="/workspace/core/assets" data-cb-go style="text-decoration:none">Asset library</a>');
  var top=supportTop.map(supportCard).join('');
  var bottom=supportBottom.map(supportCard).join('');
  var flow=flowIds.map(stageCard).join('');
  var gov=find('governance');
  var ledger=sections.map(function(x){return '<div class="cb-ledger-item" data-cb-section="'+x.id+'"><b>'+x.n+'</b><div><strong>'+esc(x.title)+'</strong><small>'+esc(x.desc)+'</small></div><span class="cb-owner">'+esc(x.owner)+'</span></div>'}).join('');
  content.innerHTML='<div class="cb-shell cb-blueprint-page"><a class="cb-back" href="/workspace/core/assets" data-cb-go>← Assets & Blueprints</a>'+
    '<section class="cb-asset-hero"><div><div class="cb-eyebrow">Gravitas+ system asset · GSA-001</div><h2>Content Studio Blueprint</h2><p>Approval draft for the Gravitas+ content operating system. Confirm the meaning and owner of each section first; only then break the approved sections into single-owner tasks and collect deadlines.</p></div><div class="cb-asset-hero__meta">'+chip('Version','v0.2')+chip('State','Team approval')+chip('Scope','Core')+chip('Sections','16')+'</div></section>'+approvalSteps()+
    '<section class="cb-map-shell" id="cb-map-shell"><div class="cb-map-head"><div><strong>System map</strong> <span>· every card includes a short definition</span></div><div class="cb-tools"><button class="cb-tool" type="button" data-cb-zoom="out" aria-label="Zoom out">−</button><button class="cb-tool" type="button" data-cb-zoom="fit" aria-label="Fit">⌁</button><button class="cb-tool" type="button" data-cb-zoom="in" aria-label="Zoom in">+</button><button class="cb-tool" type="button" data-cb-fullscreen aria-label="Fullscreen">⛶</button></div></div>'+
    '<div class="cb-viewport"><div class="cb-map" id="cb-map"><div class="cb-map-title"><small>Team approval draft · v0.2</small><h3>Gravitas+ Content Studio</h3><p>One operating architecture. Confirm scope and ownership before execution.</p></div><div class="cb-support-row">'+top+'</div><div class="cb-flow-label">End-to-end content lifecycle</div><div class="cb-flow">'+flow+'</div><div class="cb-support-row is-bottom">'+bottom+'</div><article class="cb-governance" data-cb-section="governance"><div class="cb-support__icon">'+gov.icon+'</div><div><h4>'+esc(gov.short)+'</h4><p>'+esc(gov.desc)+'</p></div><span class="cb-owner">'+esc(gov.owner)+'</span></article></div></div></section>'+inspector('strategy')+
    '<div class="cb-section-ledger">'+ledger+'</div></div>';
  applyZoom();
}

function render(){
  var path=location.pathname.replace(/\/$/,'');
  if(path==='/workspace/core/assets'||path==='/workspace/core/assets/')return renderLibrary();
  return renderAsset();
}
function go(path){if(location.pathname!==path)history.pushState({},'',path);render()}
function applyZoom(){var map=document.getElementById('cb-map');if(map)map.style.setProperty('--cb-zoom',zoom)}
function selectSection(id){var old=document.getElementById('cb-inspector');if(!old)return;old.outerHTML=inspector(id);var next=document.getElementById('cb-inspector');if(next&&window.innerWidth<760)next.scrollIntoView({behavior:'smooth',block:'nearest'})}
function toggleFullscreen(){var shell=document.getElementById('cb-map-shell');if(!shell)return;if(document.fullscreenElement){document.exitFullscreen().catch(function(){})}else if(shell.requestFullscreen){shell.requestFullscreen().catch(function(){shell.classList.toggle('cb-fullscreen')})}else shell.classList.toggle('cb-fullscreen')}
function approvalSummary(){return 'Gravitas+ Content Studio Blueprint · v0.2 · TEAM APPROVAL\n\nPlease review and confirm the section meaning and ownership before we break the blueprint into tasks and agree deadlines.\n\n'+sections.map(function(x){return x.n+'. '+x.title+' — '+x.owner+'\n'+x.desc}).join('\n\n')+'\n\nAfter approval: each section will be broken into concrete tasks, every task will have exactly one owner, and each owner will confirm a deadline.'}
function copyText(text,success){if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){say(success)}).catch(function(){say('Copy failed. Select and copy manually.')})}else{var t=document.createElement('textarea');t.value=text;t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();try{document.execCommand('copy');say(success)}catch(e){say('Copy failed. Select and copy manually.')}t.remove()}}

document.addEventListener('click',function(e){
  var goEl=e.target.closest('[data-cb-go]');if(goEl){e.preventDefault();go(goEl.getAttribute('href'));return}
  if(e.target.closest('[data-cb-copy-link]')){copyText(location.href,'Approval link copied.');return}
  if(e.target.closest('[data-cb-copy-summary]')){copyText(approvalSummary(),'Approval summary copied.');return}
  var sec=e.target.closest('[data-cb-section]');if(sec){selectSection(sec.dataset.cbSection);return}
  var z=e.target.closest('[data-cb-zoom]');if(z){var mode=z.dataset.cbZoom;if(mode==='in')zoom=Math.min(1.25,+(zoom+.1).toFixed(2));else if(mode==='out')zoom=Math.max(.8,+(zoom-.1).toFixed(2));else zoom=1;applyZoom();return}
  if(e.target.closest('[data-cb-fullscreen]'))toggleFullscreen();
});
window.addEventListener('popstate',render);
document.addEventListener('fullscreenchange',function(){var shell=document.getElementById('cb-map-shell');if(shell&&!document.fullscreenElement)shell.classList.remove('cb-fullscreen')});

fetch('/api/platform/bootstrap/',{credentials:'same-origin',headers:{Accept:'application/json'}}).then(function(r){if(r.status===401){location.href='/login';throw new Error('auth')}return r.json()}).then(function(d){boot=d;if(!coreAllowed(boot)){location.replace('/workspace/research');return}render()}).catch(function(e){if(e.message!=='auth'){content.innerHTML='<div class="v2-empty"><strong>Could not open Core assets</strong><span>Refresh the workspace and try again.</span></div>'}});
})();
