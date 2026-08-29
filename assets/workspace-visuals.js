/* Gravitas workspace visual layer.
 * Icon geometry uses a small locally-vendored subset of Lucide (ISC License):
 * https://github.com/lucide-icons/lucide
 */
(function(){
'use strict';
var paths={
  dashboard:'<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  target:'<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  workflow:'<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  tasks:'<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><rect x="3" y="4" width="6" height="6" rx="1"/>',
  calendar:'<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M8 17h.01"/><path d="M12 17h.01"/><path d="M16 17h.01"/>',
  flask:'<path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2"/><path d="M6.453 15h11.094"/><path d="M8.5 2h7"/>',
  database:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  network:'<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  shield:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  brain:'<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M9 13a4.5 4.5 0 0 0 3-4"/><path d="M12 13h4"/><path d="M12 18h6a2 2 0 0 1 2 2v1"/><path d="M12 8h8"/><path d="M16 8V5a2 2 0 0 1 2-2"/><circle cx="16" cy="13" r=".5"/><circle cx="18" cy="3" r=".5"/><circle cx="20" cy="21" r=".5"/><circle cx="20" cy="8" r=".5"/>',
  folder:'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.91 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file:'<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="8" x2="16" y1="13" y2="13"/><line x1="8" x2="16" y1="17" y2="17"/>',
  share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
  layers:'<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="m22 12.5-9.17 4.17a2 2 0 0 1-1.66 0L2 12.5"/><path d="m22 17.5-9.17 4.17a2 2 0 0 1-1.66 0L2 17.5"/>',
  plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
  arrow:'<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  spark:'<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  lock:'<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'
};
function icon(name,cls){return '<svg class="'+(cls||'gvi')+'" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+(paths[name]||paths.spark)+'</svg>'}
window.GravitasVisualIcons={icon:icon};
var navMap=[
  ['my-work','dashboard'],['core/tasks','tasks'],['core/content','layers'],['operating','workflow'],['research/projects','flask'],['research/notes','file'],['research/files','folder'],['research/datasets','database'],['research/mindmaps','network'],['people','users'],['community','spark'],['shared','share'],['research','flask'],['core','dashboard']
];
function iconForHref(href){for(var i=0;i<navMap.length;i++)if(href.indexOf(navMap[i][0])>=0)return navMap[i][1];return 'spark'}
function decorateNav(){document.querySelectorAll('.ws-sidebar nav a').forEach(function(a){var span=a.querySelector(':scope > span');if(!span||span.dataset.gvi)return;span.dataset.gvi='1';span.innerHTML=icon(iconForHref(a.getAttribute('href')||''),'gvi gvi-nav')})}
function decorateButtons(){document.querySelectorAll('.ws-primary-btn,.ws-secondary-btn,.ws-link-btn,.v2-mini-btn').forEach(function(b){if(b.dataset.gvi)return;var t=(b.textContent||'').trim().toLowerCase(),name='arrow';if(t.indexOf('new ')===0||t.indexOf('create')===0||t.indexOf('add ')===0)name='plus';else if(t.indexOf('upload')>=0)name='file';else if(t.indexOf('share')>=0)name='share';else if(t.indexOf('research')>=0)name='flask';else if(t.indexOf('view')>=0||t.indexOf('open')>=0)name='arrow';b.dataset.gvi='1';b.insertAdjacentHTML('afterbegin',icon(name,'gvi gvi-btn'))})}
function statIcon(label){label=label.toLowerCase();if(label.indexOf('objective')>=0||label.indexOf('key result')>=0)return 'target';if(label.indexOf('initiative')>=0)return 'workflow';if(label.indexOf('task')>=0||label.indexOf('blocker')>=0)return 'tasks';if(label.indexOf('research')>=0)return 'flask';if(label.indexOf('dataset')>=0)return 'database';if(label.indexOf('people')>=0||label.indexOf('researcher')>=0)return 'users';if(label.indexOf('file')>=0)return 'folder';return 'spark'}
function decorateStats(){document.querySelectorAll('.ws-stat,.v2-summary article').forEach(function(card){if(card.dataset.gvi)return;var label=(card.querySelector('span,small')||{}).textContent||'';card.dataset.gvi='1';card.insertAdjacentHTML('afterbegin','<div class="gvi-stat-icon">'+icon(statIcon(label))+'</div>')})}
function decoratePanelHeads(){document.querySelectorAll('.ws-panel__head h2,.v2-panel__head h2').forEach(function(h){if(h.dataset.gvi)return;var text=h.textContent.toLowerCase(),name='layers';if(text.indexOf('task')>=0)name='tasks';else if(text.indexOf('okr')>=0||text.indexOf('strategy')>=0)name='target';else if(text.indexOf('research')>=0)name='flask';else if(text.indexOf('risk')>=0)name='shield';else if(text.indexOf('milestone')>=0||text.indexOf('cycle')>=0)name='calendar';else if(text.indexOf('people')>=0||text.indexOf('researcher')>=0)name='users';else if(text.indexOf('file')>=0||text.indexOf('data room')>=0)name='folder';h.dataset.gvi='1';h.insertAdjacentHTML('afterbegin','<span class="gvi-heading">'+icon(name)+'</span>')})}
function decorateEmpty(){document.querySelectorAll('.ws-empty,.v2-empty').forEach(function(e){if(e.dataset.gvi)return;e.dataset.gvi='1';e.insertAdjacentHTML('afterbegin','<div class="gvi-empty-art"><span>'+icon('spark')+'</span><i></i><b></b></div>')})}
function strategyVisual(){if(!/^\/workspace\/operating\/?$/.test(location.pathname))return;var note=document.querySelector('.op-section-note');if(!note||document.querySelector('.gvi-trace-map'))return;var html='<div class="gvi-trace-map" aria-label="Operating traceability"><div>'+icon('target')+'<span><b>Objective</b><small>Direction</small></span></div><i>'+icon('arrow')+'</i><div>'+icon('target')+'<span><b>Key Result</b><small>Measure</small></span></div><i>'+icon('arrow')+'</i><div>'+icon('workflow')+'<span><b>Initiative</b><small>Work</small></span></div><i>'+icon('arrow')+'</i><div>'+icon('tasks')+'<span><b>Task</b><small>Execution</small></span></div></div>';note.insertAdjacentHTML('afterend',html)}
function processVisuals(){document.querySelectorAll('.op-flow').forEach(function(flow){if(flow.dataset.gvi)return;flow.dataset.gvi='1';flow.classList.add('gvi-stage-flow');flow.querySelectorAll('span').forEach(function(s,idx){s.insertAdjacentHTML('afterbegin','<b class="gvi-stage-dot">'+String(idx+1).padStart(2,'0')+'</b>')})})}
function dataRoomVisual(){document.querySelectorAll('.v2-data-room').forEach(function(x){if(x.dataset.gvi)return;x.dataset.gvi='1';x.insertAdjacentHTML('afterbegin','<div class="gvi-data-room-icon">'+icon('lock')+'</div>')})}
function projectVisual(){document.querySelectorAll('.v2-project').forEach(function(x){if(x.dataset.gvi)return;x.dataset.gvi='1';var top=x.querySelector('.v2-project__top');if(top)top.insertAdjacentHTML('afterbegin','<div class="gvi-project-mark">'+icon('flask')+'</div>')})}
function run(){decorateNav();decorateButtons();decorateStats();decoratePanelHeads();decorateEmpty();strategyVisual();processVisuals();dataRoomVisual();projectVisual()}
var timer,observer=new MutationObserver(function(){clearTimeout(timer);timer=setTimeout(run,80)});observer.observe(document.body,{childList:true,subtree:true});run();
})();
