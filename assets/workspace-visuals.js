/* Gravitas workspace visual layer.
 *
 * Icons come from assets/gravitas-icons.js, which is drawn to the geometry the
 * brand book sets out in section 11. This file used to carry a vendored subset
 * of Lucide instead. Stock geometry is exactly what the book rules out — "not
 * interchangeable with stock", "do not swap in a stock equivalent, or the set
 * will start disagreeing with itself" — and it did disagree: Lucide sits on a
 * bounding-box centre rather than an ink centroid, has no common optical cap,
 * and was being drawn here at 1.8 rather than the brand's 1.7, so a workspace
 * icon never quite matched the mark next to it in the site header.
 *
 * The alias table below keeps the old call sites working while the names now
 * resolve to real Gravitas marks.
 */
(function(){
'use strict';
/* Old (Lucide) name -> Gravitas mark. Kept so every existing call site in
   this file reads the same as before. */
var alias={
  dashboard:'overview', target:'target',   workflow:'planning', tasks:'tasks',
  calendar:'meeting',   flask:'projects',  database:'datasets', users:'team',
  network:'mindmap',    shield:'secure',   brain:'mindmap',     folder:'files',
  file:'notes',         share:'share',     layers:'content',    plus:'plus',
  arrow:'arrow',        spark:'activity',  lock:'secure'
};

function icon(name,cls){
  var set=window.GravitasIcons;
  var resolved=alias[name]||name;
  if(!set)return '';
  return set.icon(set.has(resolved)?resolved:'activity',(cls||'gvi')+' g-wi');
}
window.GravitasVisualIcons={icon:icon};
var navMap=[
  ['my-work','dashboard'],['core/tasks','tasks'],['core/content','layers'],['operating','workflow'],['research/projects','flask'],['research/notes','file'],['research/files','folder'],['research/datasets','database'],['research/mindmaps','network'],['people','users'],['community','spark'],['shared','share'],['research','flask'],['core','dashboard']
];
function iconForHref(href){for(var i=0;i<navMap.length;i++)if(href.indexOf(navMap[i][0])>=0)return navMap[i][1];return 'spark'}
/* Only fills in a mark where the nav rendered none. The nav modules now draw
   their own icons, and each knows its route better than a substring match on
   the href does, so overwriting them here would both undo that and re-run on
   every mutation. */
function decorateNav(){document.querySelectorAll('.ws-sidebar nav a').forEach(function(a){var span=a.querySelector(':scope > span');if(!span||span.dataset.gvi||span.querySelector('svg'))return;span.dataset.gvi='1';span.innerHTML=icon(iconForHref(a.getAttribute('href')||''),'gvi gvi-nav')})}
function decorateButtons(){document.querySelectorAll('.ws-primary-btn,.ws-secondary-btn,.ws-link-btn,.v2-mini-btn').forEach(function(b){if(b.dataset.gvi)return;var t=(b.textContent||'').trim().toLowerCase(),name='arrow';if(t.indexOf('new ')===0||t.indexOf('create')===0||t.indexOf('add ')===0)name='plus';else if(t.indexOf('upload')>=0)name='file';else if(t.indexOf('share')>=0)name='share';else if(t.indexOf('research')>=0)name='flask';else if(t.indexOf('view')>=0||t.indexOf('open')>=0)name='arrow';b.dataset.gvi='1';b.insertAdjacentHTML('afterbegin',icon(name,'gvi gvi-btn'))})}
/* Ordered most specific first. The old version tested 'research' before
   anything else a research metric might say, so "Active projects", "Client
   projects" and "Community projects" all came back with the same mark and the
   row of stats read as one repeated icon. */
function statIcon(label){
  label=(label||'').toLowerCase();
  var table=[
    ['objective','target'],['key result','target'],['okr','target'],
    ['initiative','planning'],['milestone','meeting'],['cycle','cycle'],['meeting','meeting'],
    ['task','tasks'],['blocker','tasks'],
    ['request','share'],['shared','share'],['waiting','share'],
    ['client','secure'],['secure','secure'],['data room','secure'],
    ['community','collaboration'],['collaboration','collaboration'],
    ['people','team'],['researcher','team'],['member','team'],['team','team'],
    ['dataset','datasets'],['note','notes'],['paper','notes'],
    ['file','files'],['storage','storage'],['content','content'],
    ['mind map','mindmap'],['mindmap','mindmap'],
    ['project','projects'],['research','projects']
  ];
  for(var i=0;i<table.length;i++)if(label.indexOf(table[i][0])>=0)return table[i][1];
  return 'activity';
}
function decorateStats(){document.querySelectorAll('.ws-stat,.v2-summary article').forEach(function(card){if(card.dataset.gvi)return;var label=(card.querySelector('span,small')||{}).textContent||'';card.dataset.gvi='1';card.insertAdjacentHTML('afterbegin','<div class="gvi-stat-icon">'+icon(statIcon(label))+'</div>')})}
function decoratePanelHeads(){document.querySelectorAll('.ws-panel__head h2,.v2-panel__head h2').forEach(function(h){if(h.dataset.gvi)return;h.dataset.gvi='1';h.insertAdjacentHTML('afterbegin','<span class="gvi-heading">'+icon(statIcon(h.textContent))+'</span>')})}
function decorateEmpty(){document.querySelectorAll('.ws-empty,.v2-empty').forEach(function(e){if(e.dataset.gvi)return;e.dataset.gvi='1';e.insertAdjacentHTML('afterbegin','<div class="gvi-empty-art"><span>'+icon('spark')+'</span><i></i><b></b></div>')})}
function strategyVisual(){if(!/^\/workspace\/operating\/?$/.test(location.pathname))return;var note=document.querySelector('.op-section-note');if(!note||document.querySelector('.gvi-trace-map'))return;var html='<div class="gvi-trace-map" aria-label="Operating traceability"><div>'+icon('target')+'<span><b>Objective</b><small>Direction</small></span></div><i>'+icon('arrow')+'</i><div>'+icon('target')+'<span><b>Key Result</b><small>Measure</small></span></div><i>'+icon('arrow')+'</i><div>'+icon('workflow')+'<span><b>Initiative</b><small>Work</small></span></div><i>'+icon('arrow')+'</i><div>'+icon('tasks')+'<span><b>Task</b><small>Execution</small></span></div></div>';note.insertAdjacentHTML('afterend',html)}
function processVisuals(){document.querySelectorAll('.op-flow').forEach(function(flow){if(flow.dataset.gvi)return;flow.dataset.gvi='1';flow.classList.add('gvi-stage-flow');flow.querySelectorAll('span').forEach(function(s,idx){s.insertAdjacentHTML('afterbegin','<b class="gvi-stage-dot">'+String(idx+1).padStart(2,'0')+'</b>')})})}
function dataRoomVisual(){document.querySelectorAll('.v2-data-room').forEach(function(x){if(x.dataset.gvi)return;x.dataset.gvi='1';x.insertAdjacentHTML('afterbegin','<div class="gvi-data-room-icon">'+icon('lock')+'</div>')})}
function projectVisual(){document.querySelectorAll('.v2-project').forEach(function(x){if(x.dataset.gvi)return;x.dataset.gvi='1';var top=x.querySelector('.v2-project__top');if(top)top.insertAdjacentHTML('afterbegin','<div class="gvi-project-mark">'+icon('flask')+'</div>')})}
function run(){decorateNav();decorateButtons();decorateStats();decoratePanelHeads();decorateEmpty();strategyVisual();processVisuals();dataRoomVisual();projectVisual()}
var timer,observer=new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(run,80)});observer.observe(document.body,{childList:true,subtree:true});run();
})();
