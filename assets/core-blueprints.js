(function(){
'use strict';
window.__gravitasCoreBlueprintLoaded=true;

var content=document.getElementById('ws-content');
var actions=document.getElementById('ws-primary-actions');
var boot=null;
var zoom=1;

var sections=[
  {id:'strategy',n:'01',title:'Content Strategy & Objectives',short:'Strategy',owner:'Sajjad',icon:'◎',group:'flow',scope:['Purpose & North Star','Audience & pillars','Strategic value']},
  {id:'formats',n:'02',title:'Content Types & Formats',short:'Types & Formats',owner:'Ahmad + Kiarash',icon:'▤',group:'support',tone:'cyan',scope:['Format catalogue','Use case by format','Channel fit']},
  {id:'discovery',n:'03',title:'Idea & Content Discovery',short:'Discovery',owner:'Ahmad',icon:'✦',group:'flow',scope:['Signals & sources','Idea intake','Prioritisation']},
  {id:'research',n:'04',title:'Research & Scientific Validation',short:'Research',owner:'Sajjad',icon:'⌕',group:'flow',scope:['Research process','Evidence standard','Scientific validation']},
  {id:'planning',n:'05',title:'Content Planning',short:'Planning',owner:'Ahmad',icon:'≡',group:'flow',scope:['Brief','Resources','Production plan']},
  {id:'production',n:'06',title:'Content Production',short:'Production',owner:'Ahmad',icon:'◉',group:'flow',scope:['Writing & script','Recording / build','Revision loop']},
  {id:'design',n:'07',title:'Design & Content Experience',short:'Design & Experience',owner:'Kiarash',icon:'✎',group:'support',tone:'blue',scope:['Visual language','Templates','Interactive experience']},
  {id:'review',n:'08',title:'Review & Quality Control',short:'Review',owner:'Sajjad + Ahmad + Kiarash',icon:'◇',group:'flow',scope:['Scientific review','Editorial & visual QA','Approval logic']},
  {id:'publishing',n:'09',title:'Publishing',short:'Publish',owner:'Ahmad + Hossein',icon:'↑',group:'flow',scope:['Publishing checklist','Metadata & SEO','Final release']},
  {id:'distribution',n:'10',title:'Distribution',short:'Distribution',owner:'Ahmad',icon:'⌘',group:'flow',scope:['Channels','Timing','Cross-distribution']},
  {id:'repurposing',n:'11',title:'Repurposing & Content Atomization',short:'Repurpose',owner:'Ahmad + Kiarash',icon:'↻',group:'flow',scope:['Derivative assets','Format conversion','Reuse logic']},
  {id:'measurement',n:'12',title:'Measurement & Learning',short:'Measure',owner:'Hossein + Ahmad',icon:'▥',group:'flow',scope:['KPIs','Analytics','Learning loop']},
  {id:'archive',n:'13',title:'Content Archive & Knowledge Integration',short:'Archive',owner:'Hossein',icon:'▣',group:'flow',scope:['Asset library','Knowledge links','Version history']},
  {id:'operations',n:'14',title:'Content Operations & Workflow',short:'Content Ops & Workflow',owner:'Hossein',icon:'⚙',group:'support',tone:'blue',scope:['Statuses & ownership','Dependencies','Workspace implementation']},
  {id:'ai',n:'15',title:'AI & Automation',short:'AI & Automation',owner:'Hossein',icon:'✣',group:'support',tone:'violet',scope:['Assistive AI','Automation points','Human review boundaries']},
  {id:'governance',n:'16',title:'Content Risk & Governance',short:'Risk & Governance',owner:'Hossein + Sajjad',icon:'⬡',group:'governance',tone:'gold',scope:['Scientific risk','Copyright & AI use','Corrections & ownership']}
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

function renderLibrary(){
  setHeader('Assets & Blueprints','System-level intellectual property, frameworks and operating assets owned by Gravitas.','CORE · ASSETS');
  setActions('');
  content.innerHTML='<div class="cb-shell cb-library">'+
    '<div class="cb-library-head"><div><div class="cb-eyebrow">Core asset library</div><h2>Reusable systems, not loose files.</h2><p>Blueprints live here as versioned operating assets. Each one can become the source of tasks, standards and implementation work across Core.</p></div><span class="cb-count">1 system asset</span></div>'+
    '<div class="cb-asset-grid"><a class="cb-asset-card" href="'+sectionHref()+'" data-cb-go><div class="cb-card-top"><div class="cb-card-icon">⌘</div><div class="cb-card-tags">'+chip('Type','Blueprint')+chip('Status','Draft v0.1')+'</div></div><h3>Content Studio Blueprint</h3><p>The draft architecture of Gravitas content operations: the complete section map from strategy and discovery through research, production, publishing, learning and governance.</p><div class="cb-card-foot"><div><small>Structure</small><b>16 sections · 11-stage lifecycle</b></div><span class="cb-open">Open system asset →</span></div></a>'+
    '<aside class="cb-side-card"><h3>Asset standard</h3><p>Core assets are durable team IP. Drafts define the architecture first; owners then complete their assigned sections before a version is promoted.</p><div class="cb-side-stat"><span>Current assets</span><b>1</b></div><div class="cb-side-stat"><span>Draft sections</span><b>16</b></div><div class="cb-side-stat"><span>Current release</span><b>v0.1</b></div></aside></div></div>';
}

function supportCard(id){var x=find(id);return '<article class="cb-support" data-cb-section="'+x.id+'" data-tone="'+x.tone+'"><div class="cb-support__icon">'+x.icon+'</div><div><h4>'+esc(x.short)+'</h4><p>Section '+x.n+' · definition owned by team</p></div><span class="cb-owner">'+esc(x.owner)+'</span></article>'}
function stageCard(id){var x=find(id);return '<article class="cb-stage" data-cb-section="'+x.id+'"><span class="cb-stage__n">'+x.n+'</span><span class="cb-stage__icon">'+x.icon+'</span><h4>'+esc(x.short)+'</h4><span class="cb-owner">'+esc(x.owner)+'</span></article>'}
function inspector(id){var x=find(id)||find('strategy');return '<div class="cb-inspector" id="cb-inspector"><div><div class="cb-eyebrow">Section '+x.n+'</div><h3>'+esc(x.title)+'</h3><p>This is intentionally a draft boundary. The owner defines the detailed workflow, standards, inputs and outputs for this section.</p></div><div class="cb-inspector__tags">'+x.scope.map(function(t){return '<span class="cb-meta-chip">'+esc(t)+'</span>'}).join('')+'</div><span class="cb-inspector__state">Definition pending · '+esc(x.owner)+'</span></div>'}

function renderAsset(){
  setHeader('Content Studio Blueprint','Draft architecture for assigning ownership before detailed process design.','CORE · SYSTEM ASSET');
  setActions('<a class="ws-secondary-btn" href="/workspace/core/assets" data-cb-go style="text-decoration:none">Asset library</a>');
  var top=supportTop.map(supportCard).join('');
  var bottom=supportBottom.map(supportCard).join('');
  var flow=flowIds.map(stageCard).join('');
  var gov=find('governance');
  var ledger=sections.map(function(x){return '<div class="cb-ledger-item" data-cb-section="'+x.id+'"><b>'+x.n+'</b><div><strong>'+esc(x.title)+'</strong><small>Draft section · owner completes definition</small></div><span class="cb-owner">'+esc(x.owner)+'</span></div>'}).join('');
  content.innerHTML='<div class="cb-shell cb-blueprint-page"><a class="cb-back" href="/workspace/core/assets" data-cb-go>← Assets & Blueprints</a>'+
    '<section class="cb-asset-hero"><div><div class="cb-eyebrow">Gravitas system asset · GSA-001</div><h2>Content Studio Blueprint</h2><p>A schematic draft of the complete content system. The architecture is fixed enough to assign work; the detailed process inside each section remains intentionally open for its owner to define.</p></div><div class="cb-asset-hero__meta">'+chip('Version','v0.1')+chip('State','Draft')+chip('Scope','Core')+chip('Sections','16')+'</div></section>'+
    '<section class="cb-map-shell" id="cb-map-shell"><div class="cb-map-head"><div><strong>System map</strong> <span>· click any section to inspect ownership</span></div><div class="cb-tools"><button class="cb-tool" type="button" data-cb-zoom="out" aria-label="Zoom out">−</button><button class="cb-tool" type="button" data-cb-zoom="fit" aria-label="Fit">⌁</button><button class="cb-tool" type="button" data-cb-zoom="in" aria-label="Zoom in">+</button><button class="cb-tool" type="button" data-cb-fullscreen aria-label="Fullscreen">⛶</button></div></div>'+
    '<div class="cb-viewport"><div class="cb-map" id="cb-map"><div class="cb-map-title"><small>Draft structure v0.1</small><h3>Gravitas Content Studio</h3><p>One operating architecture. Section owners define the detail.</p></div><div class="cb-support-row">'+top+'</div><div class="cb-flow-label">End-to-end content lifecycle</div><div class="cb-flow">'+flow+'</div><div class="cb-support-row is-bottom">'+bottom+'</div><article class="cb-governance" data-cb-section="governance"><div class="cb-support__icon">'+gov.icon+'</div><div><h4>'+esc(gov.short)+'</h4><p>Cross-cutting governance layer across the full lifecycle</p></div><span class="cb-owner">'+esc(gov.owner)+'</span></article></div></div></section>'+inspector('strategy')+
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

document.addEventListener('click',function(e){
  var goEl=e.target.closest('[data-cb-go]');if(goEl){e.preventDefault();go(goEl.getAttribute('href'));return}
  var sec=e.target.closest('[data-cb-section]');if(sec){selectSection(sec.dataset.cbSection);return}
  var z=e.target.closest('[data-cb-zoom]');if(z){var mode=z.dataset.cbZoom;if(mode==='in')zoom=Math.min(1.35,+(zoom+.1).toFixed(2));else if(mode==='out')zoom=Math.max(.75,+(zoom-.1).toFixed(2));else zoom=1;applyZoom();return}
  if(e.target.closest('[data-cb-fullscreen]'))toggleFullscreen();
});
window.addEventListener('popstate',render);
document.addEventListener('fullscreenchange',function(){var shell=document.getElementById('cb-map-shell');if(shell&&!document.fullscreenElement)shell.classList.remove('cb-fullscreen')});

fetch('/api/platform/bootstrap/',{credentials:'same-origin',headers:{Accept:'application/json'}}).then(function(r){if(r.status===401){location.href='/login';throw new Error('auth')}return r.json()}).then(function(d){boot=d;if(!coreAllowed(boot)){location.replace('/workspace/research');return}render()}).catch(function(e){if(e.message!=='auth'){content.innerHTML='<div class="v2-empty"><strong>Could not open Core assets</strong><span>Refresh the workspace and try again.</span></div>'}});
})();
